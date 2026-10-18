import { parse_ines_rom } from "../../src/nes/cartridge/ines.js";
import { resolve_mapper } from "../../src/nes/cartridge/mapper.js";
import { NromMapper } from "../../src/nes/cartridge/mapper_000.js";
import { Mmc3Mapper } from "../../src/nes/cartridge/mapper_004.js";
import { NesCpuBus } from "../../src/nes/cpu/nes_cpu_bus.js";
import { CARTRIDGE_MIRRORING_IDS, make_cartridge_image } from "./cartridge_projection.js";
import { make_absent_bus_devices } from "./recording_cpu_bus.js";

/**
 * Reference-side projection of mapper selection and NROM board validation onto the flat array
 * shared vector suite 15 ("nrom") records, and that scratch/src/mapper.gs plus
 * scratch/src/mapper_000.gs report through the `mapper_selection_*` and `nrom_*` globals.
 *
 * A record carries the declared image length and the sixteen header bytes, exactly like the
 * suite-9 header records, and reports whether the board is acceptable, why it is not, and the two
 * memory sizes it would map. Those sizes are private to `NromMapper`, so they are measured through
 * the public CPU and pattern ports by aliasing: the first write offset that wraps onto the start of
 * a region is that region's size, and a pattern write that does not stick means CHR ROM is present.
 * Records only carry headers that parse, because a rejected header is suite 9's business.
 */

/** Board family ids in `mapper_kind`, matching the ported enum in scratch/src/mapper.gs. */
export const MAPPER_KIND_IDS = { nrom: 1, mmc3: 2 } as const;

/** Selection error ids in `mapper_selection_error`, matching the ported enum. */
export const MAPPER_SELECTION_ERROR_IDS = {
    "unsupported-mapper": 1,
    "unsupported-submapper": 2,
} as const;

/**
 * Board validation error ids in `nrom_error`. The first two are the selection codes, because the
 * ported validation reports a failed selection unchanged.
 */
export const MAPPER_ERROR_IDS = {
    "unsupported-mapper": 1,
    "unsupported-submapper": 2,
    "wrong-mapper-family": 3,
    "unsupported-prg-rom-size": 4,
    "unsupported-prg-ram-size": 5,
    "unsupported-trainer": 6,
    "unsupported-chr-memory": 7,
} as const;

/** Number of inputs a suite-15 record carries: the declared image length and the header bytes. */
export const MAPPER_CREATION_INPUT_COUNT = 17;

/** Number of values a suite-15 record reports. */
export const MAPPER_CREATION_VALUE_COUNT = 7;

const CPU_PRG_RAM_START = 0x6000;
const CPU_PRG_RAM_BYTES = 0x2000;
const PPU_PATTERN_BYTES = 0x2000;
const PROBE_MARK = 0xa5;
const PROBE_ALIAS = 0x3c;

/**
 * Measures the mapped PRG RAM by finding the offset that wraps onto `$6000`. The full 8 KiB case
 * has no in-window alias, because `$8000` is already PRG ROM, so no alias means the whole window.
 */
/**
 * The public memory ports both boards expose, which is all the size probes need: neither mapper
 * publishes its mapped sizes, so a probe measures them by aliasing through these methods.
 */
interface MemoryProbePort {
    read_cpu(address: number, open_bus: number): { readonly value: number; readonly driven_mask: number } | null;
    write_cpu(address: number, value: number): void;
    read_pattern(address: number): number;
    write_pattern(address: number, value: number): void;
}

function probe_prg_ram_bytes(mapper: MemoryProbePort): number {
    if (mapper.read_cpu(CPU_PRG_RAM_START, 0) === null) {
        return 0;
    }

    mapper.write_cpu(CPU_PRG_RAM_START, PROBE_MARK);

    for (let size = 1; size < CPU_PRG_RAM_BYTES; size += 1) {
        mapper.write_cpu(CPU_PRG_RAM_START + size, PROBE_ALIAS);
        const aliased = mapper.read_cpu(CPU_PRG_RAM_START, 0);

        if (aliased !== null && aliased.value === PROBE_ALIAS) {
            return size;
        }
    }

    return CPU_PRG_RAM_BYTES;
}

/**
 * Measures the mapped CHR RAM the same way, reporting zero when pattern writes do not stick. A
 * pattern address of `$2000` is outside the port, so a full 8 KiB CHR RAM has no in-window alias.
 */
function probe_chr_ram_bytes(mapper: MemoryProbePort): number {
    const rom_byte = mapper.read_pattern(0);

    if (rom_byte === PROBE_MARK || rom_byte === PROBE_ALIAS) {
        throw new RangeError("The probe bytes must not already be in the pattern memory.");
    }

    mapper.write_pattern(0, PROBE_MARK);

    if (mapper.read_pattern(0) !== PROBE_MARK) {
        return 0;
    }

    for (let size = 1; size < PPU_PATTERN_BYTES; size += 1) {
        mapper.write_pattern(size, PROBE_ALIAS);

        if (mapper.read_pattern(0) === PROBE_ALIAS) {
            return size;
        }
    }

    return PPU_PATTERN_BYTES;
}

/** Runs selection and NROM validation on one header and returns the seven suite-15 values. */
export function project_mapper_creation(image_bytes: number, header: readonly number[]): number[] {
    const parsed = parse_ines_rom(make_cartridge_image(image_bytes, header));

    if (!parsed.ok) {
        throw new RangeError(`Suite 15 needs a header that parses; this one reported ${parsed.error.code}.`);
    }

    const rom = parsed.value;
    const selection = resolve_mapper(rom);
    const selection_kind = selection.ok ? MAPPER_KIND_IDS[selection.value.kind] : 0;
    const selection_error = selection.ok ? 0 : MAPPER_SELECTION_ERROR_IDS[selection.error.code];
    const created = NromMapper.create(rom);

    if (!created.ok) {
        return [0, MAPPER_ERROR_IDS[created.error.code], 0, 0, 0, selection_kind, selection_error];
    }

    const mapper = created.value;

    return [
        1,
        0,
        MAPPER_KIND_IDS.nrom,
        probe_prg_ram_bytes(mapper),
        probe_chr_ram_bytes(mapper),
        selection_kind,
        selection_error,
    ];
}

/**
 * Suite 16 ("nrom_memory") runs a board's address windows instead of only validating it. A record
 * carries the same header as suite 15, the payload bytes it wants in PRG ROM and CHR ROM, and a
 * list of CPU, pattern, and NVRAM operations; it reports whether the board was accepted, the two
 * memory sizes it maps, and three values per operation. The NVRAM operations drive the board's
 * snapshot buffer: a get copies the declared nonvolatile tail out and reports its length, a load
 * restores it and reports whether the buffer held exactly that length, and a read reports one
 * buffered byte so a record can pin where the tail starts.
 */

/** Operation kinds a suite-16 record can run, in the order the ported handler dispatches them. */
export const NROM_MEMORY_OPS: readonly { readonly id: number; readonly name: string }[] = [
    { id: 1, name: "cpu-read" },
    { id: 2, name: "cpu-write" },
    { id: 3, name: "pattern-read" },
    { id: 4, name: "pattern-write" },
    { id: 5, name: "get-prg-nvram" },
    { id: 6, name: "load-prg-nvram" },
    { id: 7, name: "get-chr-nvram" },
    { id: 8, name: "load-chr-nvram" },
    { id: 9, name: "read-prg-nvram-byte" },
    { id: 10, name: "read-chr-nvram-byte" },
];

export const NROM_MEMORY_CPU_READ = 1;
export const NROM_MEMORY_CPU_WRITE = 2;
export const NROM_MEMORY_PATTERN_READ = 3;
export const NROM_MEMORY_PATTERN_WRITE = 4;
export const NROM_MEMORY_GET_PRG_NVRAM = 5;
export const NROM_MEMORY_LOAD_PRG_NVRAM = 6;
export const NROM_MEMORY_GET_CHR_NVRAM = 7;
export const NROM_MEMORY_LOAD_CHR_NVRAM = 8;
export const NROM_MEMORY_READ_PRG_NVRAM_BYTE = 9;
export const NROM_MEMORY_READ_CHR_NVRAM_BYTE = 10;

/**
 * Number of fixed inputs before a record's payload pairs and operations: the declared image length,
 * the sixteen header bytes, the PRG ROM prepare count, the CHR ROM prepare count, and the operation
 * count.
 */
export const NROM_MEMORY_FIXED_INPUT_COUNT = 20;

/** Values reported before the per-operation results: ok, error code, PRG RAM bytes, CHR RAM bytes. */
export const NROM_MEMORY_FIXED_VALUE_COUNT = 4;

/**
 * Values reported per operation: whether the board took it, the byte a read returned, and the bits
 * a CPU read drove. A write reports its acceptance and two zeroes.
 */
export const NROM_MEMORY_VALUES_PER_OP = 3;

export interface NromMemoryPrepare {
    readonly index: number;
    readonly value: number;
}

export interface NromMemoryOp {
    readonly kind: number;
    readonly address: number;
    readonly value: number;
}

/**
 * Builds the board a record describes, over an image whose payload carries its prepared bytes. The
 * header is parsed once to learn where the payload starts and how long it is, the prepared bytes
 * are written into a fresh image, and that image is parsed again, because the mapper copies the
 * payload the parser hands it and a later write to a separate image would not reach it. A board
 * that does not validate comes back as null with its error code.
 */
function build_board(
    image_bytes: number,
    header: readonly number[],
    prg_prepare: readonly NromMemoryPrepare[],
    chr_prepare: readonly NromMemoryPrepare[],
): { readonly mapper: NromMapper | null; readonly error_code: number } {
    const plain = parse_ines_rom(make_cartridge_image(image_bytes, header));

    if (!plain.ok) {
        throw new RangeError(`A board record needs a header that parses; this one reported ${plain.error.code}.`);
    }

    const prg_rom_offset = 16 + (plain.value.trainer === null ? 0 : 512);
    const chr_rom_offset = prg_rom_offset + plain.value.prg_rom.byteLength;
    const image = make_cartridge_image(image_bytes, header);

    for (const entry of prg_prepare) {
        if (entry.index < 0 || entry.index >= plain.value.prg_rom.byteLength) {
            throw new RangeError(`PRG ROM prepare index ${entry.index} is outside the declared payload.`);
        }

        image[prg_rom_offset + entry.index] = entry.value;
    }

    for (const entry of chr_prepare) {
        if (entry.index < 0 || entry.index >= plain.value.chr_rom.byteLength) {
            throw new RangeError(`CHR ROM prepare index ${entry.index} is outside the declared payload.`);
        }

        image[chr_rom_offset + entry.index] = entry.value;
    }

    const parsed = parse_ines_rom(image);

    if (!parsed.ok) {
        throw new RangeError(`The prepared image stopped parsing as ${parsed.error.code}.`);
    }

    const created = NromMapper.create(parsed.value);

    if (!created.ok) {
        return { mapper: null, error_code: MAPPER_ERROR_IDS[created.error.code] };
    }

    return { mapper: created.value, error_code: 0 };
}

/** Builds one board and refuses a record whose board does not validate. */
function create_board(
    image_bytes: number,
    header: readonly number[],
    prg_prepare: readonly NromMemoryPrepare[],
    chr_prepare: readonly NromMemoryPrepare[],
): NromMapper {
    const built = build_board(image_bytes, header, prg_prepare, chr_prepare);

    if (built.mapper === null) {
        throw new RangeError(`Suite 16 needs a board that validates; this one reported ${built.error_code}.`);
    }

    return built.mapper;
}

/**
 * Runs one suite-16 record. The mapped sizes come from a second board built over the same image,
 * because measuring them writes probe bytes into the memory the operations have to see untouched.
 */
export function project_nrom_memory(
    image_bytes: number,
    header: readonly number[],
    prg_prepare: readonly NromMemoryPrepare[],
    chr_prepare: readonly NromMemoryPrepare[],
    ops: readonly NromMemoryOp[],
): number[] {
    const probed = create_board(image_bytes, header, prg_prepare, chr_prepare);
    const prg_ram_bytes = probe_prg_ram_bytes(probed);
    const chr_ram_bytes = probe_chr_ram_bytes(probed);
    const mapper = create_board(image_bytes, header, prg_prepare, chr_prepare);
    const values: number[] = [1, 0, prg_ram_bytes, chr_ram_bytes];

    // The board's snapshot buffer, as the ported lists hold it: a get refills it from the board and
    // a load restores from whatever it holds, so a length that does not match is a refused restore.
    let prg_snapshot: number[] = [];
    let chr_snapshot: number[] = [];

    for (const op of ops) {
        if (op.value < 0 || op.value > 0xff) {
            throw new RangeError(`Operation value ${op.value} is outside the byte range the reference accepts.`);
        }

        if (op.kind === NROM_MEMORY_CPU_READ) {
            const read = mapper.read_cpu(op.address, 0);
            values.push(read === null ? 0 : 1, read?.value ?? 0, read?.driven_mask ?? 0);
        } else if (op.kind === NROM_MEMORY_CPU_WRITE) {
            const before = mapper.read_cpu(op.address, 0);

            if (before !== null && before.value === op.value) {
                throw new RangeError("A write record has to change the byte, or acceptance is not observable.");
            }

            mapper.write_cpu(op.address, op.value);
            const after = mapper.read_cpu(op.address, 0);
            values.push(after !== null && after.value === op.value ? 1 : 0, 0, 0);
        } else if (op.kind === NROM_MEMORY_PATTERN_READ) {
            values.push(1, mapper.read_pattern(op.address), 0);
        } else if (op.kind === NROM_MEMORY_PATTERN_WRITE) {
            if (mapper.read_pattern(op.address) === op.value) {
                throw new RangeError("A pattern write record has to change the byte it writes.");
            }

            mapper.write_pattern(op.address, op.value);
            values.push(mapper.read_pattern(op.address) === op.value ? 1 : 0, 0, 0);
        } else if (op.kind === NROM_MEMORY_GET_PRG_NVRAM) {
            prg_snapshot = [...mapper.get_prg_nvram_snapshot()];
            values.push(1, prg_snapshot.length, 0);
        } else if (op.kind === NROM_MEMORY_LOAD_PRG_NVRAM) {
            values.push(load_snapshot(mapper.load_prg_nvram_snapshot.bind(mapper), prg_snapshot), 0, 0);
        } else if (op.kind === NROM_MEMORY_GET_CHR_NVRAM) {
            chr_snapshot = [...mapper.get_chr_nvram_snapshot()];
            values.push(1, chr_snapshot.length, 0);
        } else if (op.kind === NROM_MEMORY_LOAD_CHR_NVRAM) {
            values.push(load_snapshot(mapper.load_chr_nvram_snapshot.bind(mapper), chr_snapshot), 0, 0);
        } else if (op.kind === NROM_MEMORY_READ_PRG_NVRAM_BYTE) {
            values.push(1, prg_snapshot[op.address] ?? 0, 0);
        } else if (op.kind === NROM_MEMORY_READ_CHR_NVRAM_BYTE) {
            values.push(1, chr_snapshot[op.address] ?? 0, 0);
        } else {
            throw new RangeError(`Unknown memory operation kind ${op.kind}.`);
        }
    }

    return values;
}

/**
 * Suite 17 ("cartridge_bus") runs the production CPU address decoder with the board a record
 * describes attached as its cartridge port, so it pins what the ported bus and board do together:
 * which addresses the board drives, what the open-bus latch holds where it does not, and that a
 * board which fails validation leaves the window undriven instead of half mapped.
 */

/** Bus operation kinds a suite-17 record can run, using suite 3's convention: 0 reads, 1 writes. */
export const CARTRIDGE_BUS_OPS: readonly { readonly id: number; readonly name: string }[] = [
    { id: 0, name: "read" },
    { id: 1, name: "write" },
];

export const CARTRIDGE_BUS_READ = 0;
export const CARTRIDGE_BUS_WRITE = 1;

/**
 * Number of fixed inputs before a record's payload pairs and operations: the declared image length,
 * the sixteen header bytes, the attach flag, the PRG ROM prepare count, and the operation count.
 */
export const CARTRIDGE_BUS_FIXED_INPUT_COUNT = 20;

/** Values reported before the per-operation results: whether a board is attached, and why not. */
export const CARTRIDGE_BUS_FIXED_VALUE_COUNT = 2;

/** Values reported per operation: the byte the bus returned and the latch it left behind. */
export const CARTRIDGE_BUS_VALUES_PER_OP = 2;

/** An address no ported device drives, so reading it reports the latch without changing it. */
const OPEN_BUS_PROBE_ADDRESS = 0x2000;

export interface CartridgeBusOp {
    readonly kind: number;
    readonly address: number;
    readonly value: number;
}

/**
 * Runs one suite-17 record. Every operation reports the byte the bus returned, which is the latch
 * for a write, and then the latch itself, read back through an address no device drives.
 */
export function project_cartridge_bus(
    image_bytes: number,
    header: readonly number[],
    attach_board: number,
    prg_prepare: readonly NromMemoryPrepare[],
    ops: readonly CartridgeBusOp[],
): number[] {
    const built = build_board(image_bytes, header, prg_prepare, []);
    const mapper = attach_board === 1 ? built.mapper : null;
    const devices = make_absent_bus_devices();
    const bus = new NesCpuBus(mapper === null ? devices : { ...devices, cartridge: mapper });
    const values: number[] = [mapper === null ? 0 : 1, built.error_code];

    for (const op of ops) {
        if (op.value < 0 || op.value > 0xff) {
            throw new RangeError(`Operation value ${op.value} is outside the byte range the bus accepts.`);
        }

        if (op.kind === CARTRIDGE_BUS_READ) {
            values.push(bus.read_cpu(op.address));
        } else if (op.kind === CARTRIDGE_BUS_WRITE) {
            bus.write_cpu(op.address, op.value);
            values.push(0);
        } else {
            throw new RangeError(`Unknown bus operation kind ${op.kind}.`);
        }

        values.push(bus.read_cpu(OPEN_BUS_PROBE_ADDRESS));
    }

    return values;
}

/**
 * Restores one snapshot buffer into a board and reports whether the reference accepted it. A buffer
 * whose length is not exactly the declared NVRAM size raises a range error there; the ported boards
 * report the refusal in their `*_nvram_loaded` flag instead and copy nothing.
 */
function load_snapshot(load: (snapshot: Uint8Array) => void, snapshot: readonly number[]): number {
    try {
        load(Uint8Array.from(snapshot));
        return 1;
    } catch (error) {
        if (!(error instanceof RangeError)) {
            throw error;
        }

        return 0;
    }
}

/** Values reported before the per-operation results: ok, board error code, and mapped PRG RAM bytes. */
export const MMC3_FIXED_VALUE_COUNT = 3;

/** Number of fixed inputs before a record's payload pairs and operations, as in suite 16. */
export const MMC3_FIXED_INPUT_COUNT = 20;

/** Values reported per operation, as in suite 16: taken, the byte a read returned, driven bits. */
export const MMC3_VALUES_PER_OP = 3;

/**
 * Suite 18 ("mmc3") runs an MMC3 board the way suite 16 runs an NROM one, with one extra operation:
 * reporting the mirroring mode the board would hand the PPU. Suite 19 ("mmc3_irq") uses the same
 * record layout and the same board to drive the scanline IRQ: its records write the four IRQ
 * registers through the CPU window, observe PPU addresses, clock PPU dots, and report the IRQ line.
 * The NVRAM snapshots are not ported yet, so no record saves or restores one.
 */

/** Operation kinds a suite-18 or suite-19 record can run, in the order the ported handler dispatches
 * them. */
export const MMC3_OPS: readonly { readonly id: number; readonly name: string }[] = [
    { id: 1, name: "cpu-read" },
    { id: 2, name: "cpu-write" },
    { id: 3, name: "pattern-read" },
    { id: 4, name: "pattern-write" },
    { id: 5, name: "report-mirroring" },
    { id: 6, name: "observe-ppu-access" },
    { id: 7, name: "clock-ppu-dot" },
    { id: 8, name: "report-irq" },
    { id: 9, name: "get-prg-nvram" },
    { id: 10, name: "load-prg-nvram" },
    { id: 11, name: "get-chr-nvram" },
    { id: 12, name: "load-chr-nvram" },
    { id: 13, name: "read-prg-nvram-byte" },
    { id: 14, name: "read-chr-nvram-byte" },
];

export const MMC3_CPU_READ = 1;
export const MMC3_CPU_WRITE = 2;
export const MMC3_PATTERN_READ = 3;
export const MMC3_PATTERN_WRITE = 4;
export const MMC3_REPORT_MIRRORING = 5;
export const MMC3_OBSERVE_PPU_ACCESS = 6;
export const MMC3_CLOCK_PPU_DOT = 7;
export const MMC3_REPORT_IRQ = 8;
export const MMC3_GET_PRG_NVRAM = 9;
export const MMC3_LOAD_PRG_NVRAM = 10;
export const MMC3_GET_CHR_NVRAM = 11;
export const MMC3_LOAD_CHR_NVRAM = 12;
export const MMC3_READ_PRG_NVRAM_BYTE = 13;
export const MMC3_READ_CHR_NVRAM_BYTE = 14;

/** The PPU access kinds a suite-19 record can name, matching the ported `mmc3_ppu_access` enum. */
export const MMC3_PPU_ACCESSES: readonly { readonly id: number; readonly name: string }[] = [
    { id: 1, name: "read-pattern" },
    { id: 2, name: "write-pattern" },
    { id: 3, name: "read-nametable" },
    { id: 4, name: "write-nametable" },
];

/** Builds the MMC3 board a record describes, or reports why the reference rejected it. */
function build_mmc3_board(
    image_bytes: number,
    header: readonly number[],
    prg_prepare: readonly NromMemoryPrepare[],
    chr_prepare: readonly NromMemoryPrepare[],
): { readonly mapper: Mmc3Mapper | null; readonly error_code: number } {
    const plain = parse_ines_rom(make_cartridge_image(image_bytes, header));

    if (!plain.ok) {
        throw new RangeError(`An MMC3 record needs a header that parses; this one reported ${plain.error.code}.`);
    }

    const prg_rom_offset = 16 + (plain.value.trainer === null ? 0 : 512);
    const chr_rom_offset = prg_rom_offset + plain.value.prg_rom.byteLength;
    const image = make_cartridge_image(image_bytes, header);

    for (const entry of prg_prepare) {
        if (entry.index < 0 || entry.index >= plain.value.prg_rom.byteLength) {
            throw new RangeError(`PRG ROM prepare index ${entry.index} is outside the declared payload.`);
        }

        image[prg_rom_offset + entry.index] = entry.value;
    }

    for (const entry of chr_prepare) {
        if (entry.index < 0 || entry.index >= plain.value.chr_rom.byteLength) {
            throw new RangeError(`CHR ROM prepare index ${entry.index} is outside the declared payload.`);
        }

        image[chr_rom_offset + entry.index] = entry.value;
    }

    const parsed = parse_ines_rom(image);

    if (!parsed.ok) {
        throw new RangeError(`The prepared image stopped parsing as ${parsed.error.code}.`);
    }

    const created = Mmc3Mapper.create(parsed.value);

    if (!created.ok) {
        return { mapper: null, error_code: MAPPER_ERROR_IDS[created.error.code] };
    }

    return { mapper: created.value, error_code: 0 };
}

/**
 * Runs one suite-18 record. A CPU write reports whether it landed in PRG RAM; a write to $8000 or
 * above is a bank register write, which reports zero there and shows up in the reads that follow it.
 */
export function project_mmc3_memory(
    image_bytes: number,
    header: readonly number[],
    prg_prepare: readonly NromMemoryPrepare[],
    chr_prepare: readonly NromMemoryPrepare[],
    ops: readonly NromMemoryOp[],
): number[] {
    const built = build_mmc3_board(image_bytes, header, prg_prepare, chr_prepare);

    if (built.mapper === null) {
        if (ops.length !== 0) {
            throw new RangeError("A rejected MMC3 board runs no memory operations.");
        }

        return [0, built.error_code, 0];
    }

    const mapper = built.mapper;
    const probed = build_mmc3_board(image_bytes, header, prg_prepare, chr_prepare);
    const probe_mapper = probed.mapper;

    if (probe_mapper === null) {
        throw new RangeError("The second MMC3 board was rejected after the first was accepted.");
    }

    // Only the PRG RAM size is probed. The CHR RAM aliasing probe suite 16 uses is meaningless here,
    // because a bank register decides which part of CHR RAM a pattern address reaches, so an alias it
    // finds is a bank switch rather than a wrap. The CHR bank count is observable instead, and the
    // records that wrap a CHR bank pin it.
    const values: number[] = [1, 0, probe_prg_ram_bytes(probe_mapper)];

    // The board's snapshot buffer, as the ported lists hold it: a get refills it from the board and
    // a load restores from whatever it holds, so a length that does not match is a refused restore.
    let prg_snapshot: number[] = [];
    let chr_snapshot: number[] = [];

    for (const op of ops) {
        if (op.value < 0 || op.value > 0xff) {
            throw new RangeError(`Operation value ${op.value} is outside the byte range the reference accepts.`);
        }

        if (op.kind === MMC3_CPU_READ) {
            const read = mapper.read_cpu(op.address, 0);
            values.push(read === null ? 0 : 1, read?.value ?? 0, read?.driven_mask ?? 0);
        } else if (op.kind === MMC3_CPU_WRITE) {
            if (op.address >= 0x6000 && op.address < 0x8000) {
                const before = mapper.read_cpu(op.address, 0);

                if (before !== null && before.value === op.value) {
                    throw new RangeError("A PRG RAM write record has to change the byte, or it is not observable.");
                }

                mapper.write_cpu(op.address, op.value);
                const after = mapper.read_cpu(op.address, 0);
                values.push(after !== null && after.value === op.value ? 1 : 0, 0, 0);
            } else {
                mapper.write_cpu(op.address, op.value);
                values.push(0, 0, 0);
            }
        } else if (op.kind === MMC3_PATTERN_READ) {
            values.push(1, mapper.read_pattern(op.address), 0);
        } else if (op.kind === MMC3_PATTERN_WRITE) {
            if (mapper.read_pattern(op.address) === op.value) {
                throw new RangeError("A pattern write record has to change the byte it writes.");
            }

            mapper.write_pattern(op.address, op.value);
            values.push(mapper.read_pattern(op.address) === op.value ? 1 : 0, 0, 0);
        } else if (op.kind === MMC3_REPORT_MIRRORING) {
            values.push(1, CARTRIDGE_MIRRORING_IDS[mapper.get_nametable_mirroring()], 0);
        } else if (op.kind === MMC3_OBSERVE_PPU_ACCESS) {
            // The reference raises a range error for an address outside its 14-bit space; the port
            // reports the refusal instead, so the projection turns the throw into a "not taken".
            try {
                mapper.observe_ppu_access({
                    kind: op.value === 2 || op.value === 4 ? "write" : "read",
                    address: op.address,
                    region: op.address >= 0x2000 && op.address < 0x4000 ? "nametable" : "pattern",
                });
                values.push(1, 0, 0);
            } catch (error) {
                if (!(error instanceof RangeError)) {
                    throw error;
                }

                values.push(0, 0, 0);
            }
        } else if (op.kind === MMC3_CLOCK_PPU_DOT) {
            mapper.clock_ppu_dot();
            values.push(1, 0, 0);
        } else if (op.kind === MMC3_REPORT_IRQ) {
            values.push(1, mapper.get_irq_line_asserted() ? 1 : 0, 0);
        } else if (op.kind === MMC3_GET_PRG_NVRAM) {
            prg_snapshot = [...mapper.get_prg_nvram_snapshot()];
            values.push(1, prg_snapshot.length, 0);
        } else if (op.kind === MMC3_LOAD_PRG_NVRAM) {
            values.push(load_snapshot(mapper.load_prg_nvram_snapshot.bind(mapper), prg_snapshot), 0, 0);
        } else if (op.kind === MMC3_GET_CHR_NVRAM) {
            chr_snapshot = [...mapper.get_chr_nvram_snapshot()];
            values.push(1, chr_snapshot.length, 0);
        } else if (op.kind === MMC3_LOAD_CHR_NVRAM) {
            values.push(load_snapshot(mapper.load_chr_nvram_snapshot.bind(mapper), chr_snapshot), 0, 0);
        } else if (op.kind === MMC3_READ_PRG_NVRAM_BYTE) {
            values.push(1, prg_snapshot[op.address] ?? 0, 0);
        } else if (op.kind === MMC3_READ_CHR_NVRAM_BYTE) {
            values.push(1, chr_snapshot[op.address] ?? 0, 0);
        } else {
            throw new RangeError(`Unknown MMC3 operation kind ${op.kind}.`);
        }
    }

    return values;
}
