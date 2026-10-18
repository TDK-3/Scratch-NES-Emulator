import { parse_ines_rom } from "../../src/nes/cartridge/ines.js";
import { resolve_mapper } from "../../src/nes/cartridge/mapper.js";
import { NromMapper } from "../../src/nes/cartridge/mapper_000.js";
import { make_cartridge_image } from "./cartridge_projection.js";

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
export const NROM_ERROR_IDS = {
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
function probe_prg_ram_bytes(mapper: NromMapper): number {
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
function probe_chr_ram_bytes(mapper: NromMapper): number {
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
        return [0, NROM_ERROR_IDS[created.error.code], 0, 0, 0, selection_kind, selection_error];
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
