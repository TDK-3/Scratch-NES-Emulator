import type { MirroringMode } from "../cartridge/ines.js";

const PPU_ADDRESS_SPACE_BYTES = 0x4000;
const MAX_PPU_ADDRESS_INPUT = 0xffff;
const PATTERN_TABLE_END = 0x2000;
const NAMETABLE_START = 0x2000;
const NAMETABLE_MIRROR_START = 0x3000;
const PALETTE_START = 0x3f00;
const PALETTE_BYTES = 0x20;
const PALETTE_ADDRESS_MASK = PALETTE_BYTES - 1;
const NAMETABLE_PAGE_BYTES = 0x400;
const NAMETABLE_PAGE_MASK = NAMETABLE_PAGE_BYTES - 1;
const NAMETABLE_BYTES = 4 * NAMETABLE_PAGE_BYTES;
const PALETTE_COLOR_MASK = 0x3f;
const OAM_BYTES = 0x100;
const MAX_BYTE = 0xff;

export type PpuBusAccessKind = "read" | "write";
export type PpuBusRegion = "pattern" | "nametable";

/** A PPU memory-bus operation that is visible to the cartridge mapper. */
export interface MapperPpuBusAccess {
    readonly kind: PpuBusAccessKind;
    /** Normalized 14-bit PPU address before nametable mirroring. */
    readonly address: number;
    readonly region: PpuBusRegion;
}

/** Cartridge-facing PPU memory operations. Nametable mirroring may change as mapper registers change. */
export interface PpuMapperPort {
    read_pattern(address: number): number;
    write_pattern(address: number, value: number): void;
    observe_ppu_access(access: MapperPpuBusAccess): void;
    /** Reports an address placed on the PPU bus by a CPU PPUADDR write, without inventing a memory read/write. */
    observe_ppu_address?(address: number): void;
    /** Advances mapper timing by one PPU dot; call once for every dot, including dots without bus access. */
    clock_ppu_dot(): void;
    get_nametable_mirroring(): MirroringMode;
}

/**
 * Routes the PPU's 14-bit memory bus to mapper pattern memory, mirrored nametable RAM, and palette RAM.
 * Primary OAM is a separate 8-bit address space exposed through read_oam/write_oam for the PPU and
 * OAMDATA register implementation.
 */
export class PpuMemoryBus {
    readonly #mapper: PpuMapperPort;
    readonly #nametable_ram = new Uint8Array(NAMETABLE_BYTES);
    readonly #palette_ram = new Uint8Array(PALETTE_BYTES);
    readonly #oam = new Uint8Array(OAM_BYTES);

    constructor(mapper: PpuMapperPort) {
        this.#mapper = mapper;
    }

    read_ppu(address: number): number {
        const ppu_address = normalize_ppu_address(address);

        if (ppu_address < PATTERN_TABLE_END) {
            this.#mapper.observe_ppu_access({ kind: "read", address: ppu_address, region: "pattern" });

            return assert_mapper_byte(this.#mapper.read_pattern(ppu_address));
        }

        if (ppu_address < PALETTE_START) {
            this.#mapper.observe_ppu_access({ kind: "read", address: ppu_address, region: "nametable" });
            const index = map_nametable_address(ppu_address, this.#mapper.get_nametable_mirroring());
            const value = this.#nametable_ram[index];

            if (value === undefined) {
                throw new RangeError(`Nametable RAM address ${index} is outside its physical storage.`);
            }

            return value;
        }

        const palette_index = map_palette_address(ppu_address);
        const value = this.#palette_ram[palette_index];

        if (value === undefined) {
            throw new RangeError(`Palette RAM address ${palette_index} is outside its storage.`);
        }

        return value;
    }

    write_ppu(address: number, value: number): void {
        const ppu_address = normalize_ppu_address(address);
        assert_byte_value(value);

        if (ppu_address < PATTERN_TABLE_END) {
            this.#mapper.observe_ppu_access({ kind: "write", address: ppu_address, region: "pattern" });
            this.#mapper.write_pattern(ppu_address, value);
            return;
        }

        if (ppu_address < PALETTE_START) {
            this.#mapper.observe_ppu_access({ kind: "write", address: ppu_address, region: "nametable" });
            const index = map_nametable_address(ppu_address, this.#mapper.get_nametable_mirroring());
            this.#nametable_ram[index] = value;
            return;
        }

        const palette_index = map_palette_address(ppu_address);
        this.#palette_ram[palette_index] = value & PALETTE_COLOR_MASK;
    }

    /** Reports the PPU address bus value set by PPUADDR without reporting a fabricated memory access. */
    observe_ppu_address(address: number): void {
        const ppu_address = normalize_ppu_address(address);
        this.#mapper.observe_ppu_address?.(ppu_address);
    }

    /** Forwards one elapsed PPU dot to the mapper, including dots without a memory-bus access. */
    clock_ppu_dot(): void {
        this.#mapper.clock_ppu_dot();
    }

    /** Reads one byte from primary OAM using an 8-bit OAM address. */
    read_oam(address: number): number {
        assert_oam_address(address);
        const value = this.#oam[address];

        if (value === undefined) {
            throw new RangeError(`OAM address ${address} is outside its storage.`);
        }

        return value;
    }

    /** Writes one byte to primary OAM using an 8-bit OAM address. */
    write_oam(address: number, value: number): void {
        assert_oam_address(address);
        assert_byte_value(value);
        this.#oam[address] = value;
    }
}

function normalize_ppu_address(address: number): number {
    if (!Number.isInteger(address) || address < 0 || address > MAX_PPU_ADDRESS_INPUT) {
        throw new RangeError(`PPU address ${address} is outside the 16-bit address range.`);
    }

    return address & (PPU_ADDRESS_SPACE_BYTES - 1);
}

function map_nametable_address(address: number, mirroring: MirroringMode): number {
    const base_address = address >= NAMETABLE_MIRROR_START ? address - 0x1000 : address;
    const logical_table = (base_address - NAMETABLE_START) >>> 10;
    const page_offset = base_address & NAMETABLE_PAGE_MASK;
    let physical_table: number;

    switch (mirroring) {
        case "vertical":
            physical_table = logical_table & 0x01;
            break;
        case "horizontal":
            physical_table = logical_table >>> 1;
            break;
        case "four-screen":
            physical_table = logical_table;
            break;
        default:
            return assert_never_mirroring(mirroring);
    }

    return physical_table * NAMETABLE_PAGE_BYTES + page_offset;
}

function map_palette_address(address: number): number {
    let index = address & PALETTE_ADDRESS_MASK;

    if (index >= 0x10 && index % 4 === 0) {
        index -= 0x10;
    }

    return index;
}

function assert_never_mirroring(value: never): never {
    throw new RangeError(`Unsupported nametable mirroring mode: ${String(value)}.`);
}

function assert_oam_address(address: number): void {
    if (!Number.isInteger(address) || address < 0 || address >= OAM_BYTES) {
        throw new RangeError(`OAM address ${address} is outside the 8-bit OAM address range.`);
    }
}

function assert_byte_value(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_BYTE) {
        throw new RangeError(`Memory value ${value} is outside the byte range.`);
    }
}

function assert_mapper_byte(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > MAX_BYTE) {
        throw new RangeError(`Mapper returned a PPU pattern value outside the byte range: ${value}.`);
    }

    return value;
}
