import type { CpuBusDeviceRead } from "../cpu/cpu_bus.js";
import type { CartridgeCpuPort } from "../cpu/nes_cpu_bus.js";
import type { MapperPpuBusAccess, PpuMapperPort } from "../ppu/ppu_bus.js";
import type { InesRom, MirroringMode } from "./ines.js";
import { resolve_mapper } from "./mapper.js";

const CPU_ADDRESS_SPACE_BYTES = 0x1_0000;
const CPU_PRG_RAM_START = 0x6000;
const CPU_PRG_RAM_BYTES = 0x2000;
const CPU_PRG_ROM_START = 0x8000;
const PRG_ROM_16K_BYTES = 0x4000;
const PRG_ROM_32K_BYTES = 0x8000;
const TRAINER_BYTES = 0x0200;
const TRAINER_PRG_RAM_OFFSET = 0x1000;
const PPU_PATTERN_BYTES = 0x2000;
const FULL_BYTE_MASK = 0xff;
const MAX_BYTE = 0xff;

export type NromMapperCreationError =
    | {
          readonly code: "unsupported-mapper" | "unsupported-submapper";
          readonly mapper_id: number;
          readonly submapper: number;
          readonly message: string;
      }
    | {
          readonly code:
              | "unsupported-prg-rom-size"
              | "unsupported-prg-ram-size"
              | "unsupported-chr-memory"
              | "unsupported-trainer"
              | "wrong-mapper-family";
          readonly mapper_id: number;
          readonly submapper: number;
          readonly message: string;
      };

export type NromMapperCreationResult =
    | { readonly ok: true; readonly value: NromMapper }
    | { readonly ok: false; readonly error: NromMapperCreationError };

/** NROM-128/NROM-256 CPU and PPU cartridge mapping, including fixed CHR-ROM or CHR-RAM. */
export class NromMapper implements CartridgeCpuPort, PpuMapperPort {
    readonly #prg_rom: Uint8Array;
    readonly #prg_ram: Uint8Array;
    readonly #prg_nvram_bytes: number;
    readonly #chr_rom: Uint8Array;
    readonly #chr_ram: Uint8Array;
    readonly #chr_nvram_bytes: number;
    readonly #mirroring: MirroringMode;

    private constructor(rom: InesRom, prg_ram_bytes: number, chr_ram_bytes: number) {
        this.#prg_rom = new Uint8Array(rom.prg_rom);
        this.#prg_ram = new Uint8Array(prg_ram_bytes);
        this.#prg_nvram_bytes = rom.prg_nvram_bytes;
        this.#chr_rom = new Uint8Array(rom.chr_rom);
        this.#chr_ram = new Uint8Array(chr_ram_bytes);
        this.#chr_nvram_bytes = rom.chr_nvram_bytes;
        this.#mirroring = rom.mirroring;

        if (rom.trainer !== null) {
            for (let index = 0; index < TRAINER_BYTES; index += 1) {
                const value = read_memory(rom.trainer, index, "trainer");
                const ram_index = (TRAINER_PRG_RAM_OFFSET + index) % this.#prg_ram.byteLength;
                this.#prg_ram[ram_index] = value;
            }
        }
    }

    /** Validates mapper identity and NROM memory sizes before allocating a mapper instance. */
    static create(rom: InesRom): NromMapperCreationResult {
        const selection = resolve_mapper(rom);

        if (!selection.ok) {
            return { ok: false, error: selection.error };
        }

        if (selection.value.kind !== "nrom") {
            return creation_failure(
                rom,
                "wrong-mapper-family",
                `Mapper ${rom.mapper_id} is not an NROM board.`,
            );
        }

        const prg_rom_bytes = rom.prg_rom.byteLength;

        if (prg_rom_bytes !== PRG_ROM_16K_BYTES && prg_rom_bytes !== PRG_ROM_32K_BYTES) {
            return creation_failure(
                rom,
                "unsupported-prg-rom-size",
                `NROM requires 16 KiB or 32 KiB of PRG ROM; received ${prg_rom_bytes} bytes.`,
            );
        }

        const prg_ram_bytes = sum_memory_sizes(rom.prg_ram_bytes, rom.prg_nvram_bytes);

        if (prg_ram_bytes === null || prg_ram_bytes > CPU_PRG_RAM_BYTES) {
            return creation_failure(
                rom,
                "unsupported-prg-ram-size",
                `NROM supports at most ${CPU_PRG_RAM_BYTES} bytes of PRG RAM; received ${format_memory_size(
                    rom.prg_ram_bytes,
                    rom.prg_nvram_bytes,
                )}.`,
            );
        }

        if (rom.trainer !== null && rom.trainer.byteLength !== TRAINER_BYTES) {
            return creation_failure(
                rom,
                "unsupported-trainer",
                `NROM requires a ${TRAINER_BYTES}-byte trainer; received ${rom.trainer.byteLength} bytes.`,
            );
        }

        if (rom.trainer !== null && prg_ram_bytes === 0) {
            return creation_failure(
                rom,
                "unsupported-trainer",
                "NROM cannot map a trainer without PRG RAM at $7000-$71FF.",
            );
        }

        const chr_ram_bytes = sum_memory_sizes(rom.chr_ram_bytes, rom.chr_nvram_bytes);
        const chr_rom_bytes = rom.chr_rom.byteLength;
        const has_chr_rom = chr_rom_bytes !== 0;

        if (chr_ram_bytes === null) {
            return creation_failure(
                rom,
                "unsupported-chr-memory",
                "NROM received invalid CHR RAM size metadata.",
            );
        }

        if (
            (has_chr_rom && (chr_rom_bytes !== PPU_PATTERN_BYTES || chr_ram_bytes !== 0)) ||
            (!has_chr_rom && (chr_ram_bytes === 0 || chr_ram_bytes > PPU_PATTERN_BYTES))
        ) {
            return creation_failure(
                rom,
                "unsupported-chr-memory",
                `NROM requires exactly ${PPU_PATTERN_BYTES} bytes of CHR ROM or up to ${PPU_PATTERN_BYTES} ` +
                    `bytes of CHR RAM; received ${chr_rom_bytes} bytes of CHR ROM and ${format_memory_size(
                        rom.chr_ram_bytes,
                        rom.chr_nvram_bytes,
                    )} bytes of CHR RAM.`,
            );
        }

        return {
            ok: true,
            value: new NromMapper(rom, prg_ram_bytes, has_chr_rom ? 0 : chr_ram_bytes),
        };
    }

    /** Returns a copy of the cartridge's nonvolatile PRG memory, excluding volatile PRG RAM. */
    get_prg_nvram_snapshot(): Uint8Array {
        const nvram_start = this.#prg_ram.byteLength - this.#prg_nvram_bytes;

        return this.#prg_ram.slice(nvram_start);
    }

    /** Restores nonvolatile PRG memory without changing mapper enable/protection registers. */
    load_prg_nvram_snapshot(snapshot: Uint8Array): void {
        if (snapshot.byteLength !== this.#prg_nvram_bytes) {
            throw new RangeError(
                `PRG NVRAM snapshot must contain ${this.#prg_nvram_bytes} bytes; received ${snapshot.byteLength}.`,
            );
        }

        const nvram_start = this.#prg_ram.byteLength - this.#prg_nvram_bytes;
        this.#prg_ram.set(snapshot, nvram_start);
    }

    read_cpu(address: number, _open_bus: number): CpuBusDeviceRead {
        assert_cpu_address(address);

        if (address >= CPU_PRG_ROM_START) {
            const index = (address - CPU_PRG_ROM_START) % this.#prg_rom.byteLength;
            const value = read_memory(this.#prg_rom, index, "PRG ROM");

            return { value, driven_mask: FULL_BYTE_MASK };
        }

        if (address >= CPU_PRG_RAM_START && address < CPU_PRG_ROM_START && this.#prg_ram.byteLength > 0) {
            const index = (address - CPU_PRG_RAM_START) % this.#prg_ram.byteLength;
            const value = read_memory(this.#prg_ram, index, "PRG RAM");

            return { value, driven_mask: FULL_BYTE_MASK };
        }

        return null;
    }

    write_cpu(address: number, value: number): void {
        assert_cpu_address(address);
        assert_byte_value(value);

        if (address >= CPU_PRG_RAM_START && address < CPU_PRG_ROM_START && this.#prg_ram.byteLength > 0) {
            const index = (address - CPU_PRG_RAM_START) % this.#prg_ram.byteLength;
            this.#prg_ram[index] = value;
        }
    }

    /** Returns a copy of declared nonvolatile CHR memory, excluding volatile CHR RAM. */
    get_chr_nvram_snapshot(): Uint8Array {
        const nvram_start = this.#chr_ram.byteLength - this.#chr_nvram_bytes;

        return this.#chr_ram.slice(nvram_start);
    }

    /** Restores nonvolatile CHR memory without modifying CHR-ROM or volatile CHR RAM. */
    load_chr_nvram_snapshot(snapshot: Uint8Array): void {
        if (snapshot.byteLength !== this.#chr_nvram_bytes) {
            throw new RangeError(
                `CHR NVRAM snapshot must contain ${this.#chr_nvram_bytes} bytes; received ${snapshot.byteLength}.`,
            );
        }

        const nvram_start = this.#chr_ram.byteLength - this.#chr_nvram_bytes;
        this.#chr_ram.set(snapshot, nvram_start);
    }

    read_pattern(address: number): number {
        assert_pattern_address(address);

        if (this.#chr_rom.byteLength > 0) {
            return read_memory(this.#chr_rom, address, "CHR ROM");
        }

        const index = address % this.#chr_ram.byteLength;

        return read_memory(this.#chr_ram, index, "CHR RAM");
    }

    write_pattern(address: number, value: number): void {
        assert_pattern_address(address);
        assert_byte_value(value);

        if (this.#chr_rom.byteLength > 0) {
            return;
        }

        const index = address % this.#chr_ram.byteLength;
        this.#chr_ram[index] = value;
    }

    /** NROM has no PPU-address side effects such as mapper IRQs. */
    observe_ppu_access(_access: MapperPpuBusAccess): void {
        // NROM has no mapper-visible PPU side effects.
    }

    clock_ppu_dot(): void {
        // NROM has no PPU-dot timing state.
    }

    get_nametable_mirroring(): MirroringMode {
        return this.#mirroring;
    }
}

function creation_failure(
    rom: InesRom,
    code:
        | "unsupported-prg-rom-size"
        | "unsupported-prg-ram-size"
        | "unsupported-chr-memory"
        | "unsupported-trainer"
        | "wrong-mapper-family",
    message: string,
): NromMapperCreationResult {
    return {
        ok: false,
        error: { code, mapper_id: rom.mapper_id, submapper: rom.submapper, message },
    };
}

function sum_memory_sizes(first: number, second: number): number | null {
    if (
        !Number.isSafeInteger(first) ||
        first < 0 ||
        !Number.isSafeInteger(second) ||
        second < 0 ||
        !Number.isSafeInteger(first + second)
    ) {
        return null;
    }

    return first + second;
}

function format_memory_size(first: number, second: number): string {
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
        return "invalid";
    }

    return `${first + second}`;
}

function assert_cpu_address(address: number): void {
    if (!Number.isInteger(address) || address < 0 || address >= CPU_ADDRESS_SPACE_BYTES) {
        throw new RangeError(`CPU address ${address} is outside the 16-bit address space.`);
    }
}

function assert_pattern_address(address: number): void {
    if (!Number.isInteger(address) || address < 0 || address >= PPU_PATTERN_BYTES) {
        throw new RangeError(`PPU pattern address ${address} is outside $0000-$1FFF.`);
    }
}

function assert_byte_value(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_BYTE) {
        throw new RangeError(`Cartridge value ${value} is outside the byte range.`);
    }
}

function read_memory(memory: Uint8Array, address: number, region: string): number {
    const value = memory[address];

    if (value === undefined) {
        throw new RangeError(`${region} address ${address} is outside its mapped storage.`);
    }

    return value;
}
