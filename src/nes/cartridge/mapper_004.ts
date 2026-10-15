import type { CpuBusDeviceRead } from "../cpu/cpu_bus.js";
import type { CartridgeCpuPort } from "../cpu/nes_cpu_bus.js";
import type { MapperPpuBusAccess, PpuMapperPort } from "../ppu/ppu_bus.js";
import type { InesRom, MirroringMode } from "./ines.js";
import { resolve_mapper } from "./mapper.js";

const CPU_ADDRESS_SPACE_BYTES = 0x1_0000;
const CPU_PRG_RAM_START = 0x6000;
const CPU_PRG_RAM_BYTES = 0x2000;
const CPU_PRG_ROM_START = 0x8000;
const PRG_BANK_BYTES = 0x2000;
const MIN_PRG_ROM_BYTES = 4 * PRG_BANK_BYTES;
const PPU_ADDRESS_SPACE_BYTES = 0x4000;
const PPU_PATTERN_BYTES = 0x2000;
const CHR_BANK_BYTES = 0x0400;
const MIN_CHR_MEMORY_BYTES = 8 * CHR_BANK_BYTES;
const TRAINER_BYTES = 0x0200;
const TRAINER_PRG_RAM_OFFSET = 0x1000;
const IRQ_A12_LOW_FILTER_DOTS = 10;
const FULL_BYTE_MASK = 0xff;
const MAX_BYTE = 0xff;

export type Mmc3MapperCreationError =
    | {
          readonly code: "unsupported-mapper" | "unsupported-submapper";
          readonly mapper_id: number;
          readonly submapper: number;
          readonly message: string;
      }
    | {
          readonly code:
              | "wrong-mapper-family"
              | "unsupported-prg-rom-size"
              | "unsupported-prg-ram-size"
              | "unsupported-chr-memory"
              | "unsupported-trainer";
          readonly mapper_id: number;
          readonly submapper: number;
          readonly message: string;
      };

export type Mmc3MapperCreationResult =
    | { readonly ok: true; readonly value: Mmc3Mapper }
    | { readonly ok: false; readonly error: Mmc3MapperCreationError };

/** MMC3 banking, PRG-RAM protection, mirroring control, and filtered PPU A12 IRQ clocking. */
export class Mmc3Mapper implements CartridgeCpuPort, PpuMapperPort {
    readonly #prg_rom: Uint8Array;
    readonly #prg_ram: Uint8Array;
    readonly #prg_nvram_bytes: number;
    readonly #chr_rom: Uint8Array;
    readonly #chr_ram: Uint8Array;
    readonly #chr_nvram_bytes: number;
    readonly #prg_bank_count: number;
    readonly #chr_bank_count: number;
    readonly #header_mirroring: MirroringMode;
    readonly #four_screen_mirroring: boolean;

    #mirroring: MirroringMode;
    #bank_select = 0;
    #bank_registers = new Uint8Array(8);
    #prg_mode = 0;
    #chr_mode = 0;
    #prg_ram_enabled = true;
    #prg_ram_write_protected = false;
    #irq_latch = 0;
    #irq_counter = 0;
    #irq_reload_pending = false;
    #irq_enabled = false;
    #irq_line_asserted = false;
    #ppu_a12_high = false;
    #a12_low_dots = 0;

    private constructor(rom: InesRom, prg_ram_bytes: number, chr_ram_bytes: number) {
        this.#prg_rom = new Uint8Array(rom.prg_rom);
        this.#prg_ram = new Uint8Array(prg_ram_bytes);
        this.#prg_nvram_bytes = rom.prg_nvram_bytes;
        this.#chr_rom = new Uint8Array(rom.chr_rom);
        this.#chr_ram = new Uint8Array(chr_ram_bytes);
        this.#chr_nvram_bytes = rom.chr_nvram_bytes;
        this.#prg_bank_count = this.#prg_rom.byteLength / PRG_BANK_BYTES;
        this.#chr_bank_count = (this.#chr_rom.byteLength + this.#chr_ram.byteLength) / CHR_BANK_BYTES;
        this.#header_mirroring = rom.mirroring;
        this.#four_screen_mirroring = rom.mirroring === "four-screen";
        this.#mirroring = rom.mirroring;

        if (rom.trainer !== null) {
            for (let index = 0; index < TRAINER_BYTES; index += 1) {
                const value = read_memory(rom.trainer, index, "trainer");
                const ram_index = (TRAINER_PRG_RAM_OFFSET + index) % this.#prg_ram.byteLength;
                this.#prg_ram[ram_index] = value;
            }
        }

        this.reset();
    }

    /** Validates mapper identity and MMC3 memory sizes before allocating a mapper instance. */
    static create(rom: InesRom): Mmc3MapperCreationResult {
        const selection = resolve_mapper(rom);

        if (!selection.ok) {
            return { ok: false, error: selection.error };
        }

        if (selection.value.kind !== "mmc3") {
            return creation_failure(rom, "wrong-mapper-family", `Mapper ${rom.mapper_id} is not MMC3.`);
        }

        const prg_rom_bytes = rom.prg_rom.byteLength;

        if (prg_rom_bytes < MIN_PRG_ROM_BYTES || prg_rom_bytes % PRG_BANK_BYTES !== 0) {
            return creation_failure(
                rom,
                "unsupported-prg-rom-size",
                `MMC3 requires PRG ROM in 8 KiB banks and at least ${MIN_PRG_ROM_BYTES} bytes; ` +
                    `received ${prg_rom_bytes} bytes.`,
            );
        }

        const prg_ram_bytes = sum_memory_sizes(rom.prg_ram_bytes, rom.prg_nvram_bytes);

        if (prg_ram_bytes === null || prg_ram_bytes > CPU_PRG_RAM_BYTES) {
            return creation_failure(
                rom,
                "unsupported-prg-ram-size",
                `MMC3 supports at most ${CPU_PRG_RAM_BYTES} bytes of PRG RAM; received ${format_memory_size(
                    rom.prg_ram_bytes,
                    rom.prg_nvram_bytes,
                )}.`,
            );
        }

        if (rom.trainer !== null && rom.trainer.byteLength !== TRAINER_BYTES) {
            return creation_failure(
                rom,
                "unsupported-trainer",
                `MMC3 requires a ${TRAINER_BYTES}-byte trainer; received ${rom.trainer.byteLength} bytes.`,
            );
        }

        if (rom.trainer !== null && prg_ram_bytes === 0) {
            return creation_failure(
                rom,
                "unsupported-trainer",
                "MMC3 cannot map a trainer without PRG RAM at $7000-$71FF.",
            );
        }

        const chr_ram_bytes = sum_memory_sizes(rom.chr_ram_bytes, rom.chr_nvram_bytes);
        const chr_rom_bytes = rom.chr_rom.byteLength;
        const has_chr_rom = chr_rom_bytes > 0;

        if (chr_ram_bytes === null) {
            return creation_failure(rom, "unsupported-chr-memory", "MMC3 received invalid CHR RAM size metadata.");
        }

        const chr_memory_bytes = has_chr_rom ? chr_rom_bytes : chr_ram_bytes;
        const chr_is_valid =
            chr_memory_bytes >= MIN_CHR_MEMORY_BYTES && chr_memory_bytes % CHR_BANK_BYTES === 0;
        const has_conflicting_chr_memory = has_chr_rom && chr_ram_bytes !== 0;

        if (!chr_is_valid || has_conflicting_chr_memory) {
            return creation_failure(
                rom,
                "unsupported-chr-memory",
                `MMC3 requires one CHR ROM or CHR RAM region of at least ${MIN_CHR_MEMORY_BYTES} bytes ` +
                    `in 1 KiB banks; received ${chr_rom_bytes} bytes of CHR ROM and ${chr_ram_bytes} bytes of CHR RAM.`,
            );
        }

        return { ok: true, value: new Mmc3Mapper(rom, prg_ram_bytes, has_chr_rom ? 0 : chr_ram_bytes) };
    }

    /** Restores deterministic register/IRQ state without clearing cartridge RAM or CHR RAM. */
    reset(): void {
        this.#mirroring = this.#header_mirroring;
        this.#bank_select = 0;
        this.#bank_registers.fill(0);
        this.#prg_mode = 0;
        this.#chr_mode = 0;
        this.#prg_ram_enabled = true;
        this.#prg_ram_write_protected = false;
        this.#irq_latch = 0;
        this.#irq_counter = 0;
        this.#irq_reload_pending = false;
        this.#irq_enabled = false;
        this.#irq_line_asserted = false;
        this.#ppu_a12_high = false;
        this.#a12_low_dots = 0;
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
            const slot = (address - CPU_PRG_ROM_START) >>> 13;
            const bank = this.#get_prg_bank(slot);
            const offset = bank * PRG_BANK_BYTES + (address & (PRG_BANK_BYTES - 1));
            const value = read_memory(this.#prg_rom, offset, "PRG ROM");

            return { value, driven_mask: FULL_BYTE_MASK };
        }

        if (address >= CPU_PRG_RAM_START && address < CPU_PRG_ROM_START) {
            if (!this.#prg_ram_enabled || this.#prg_ram.byteLength === 0) {
                return null;
            }

            const index = (address - CPU_PRG_RAM_START) % this.#prg_ram.byteLength;
            const value = read_memory(this.#prg_ram, index, "PRG RAM");

            return { value, driven_mask: FULL_BYTE_MASK };
        }

        return null;
    }

    write_cpu(address: number, value: number): void {
        assert_cpu_address(address);
        assert_byte_value(value);

        if (address >= CPU_PRG_RAM_START && address < CPU_PRG_ROM_START) {
            if (this.#prg_ram_enabled && !this.#prg_ram_write_protected && this.#prg_ram.byteLength > 0) {
                const index = (address - CPU_PRG_RAM_START) % this.#prg_ram.byteLength;
                this.#prg_ram[index] = value;
            }

            return;
        }

        if (address >= CPU_PRG_ROM_START) {
            this.#write_mapper_register(address, value);
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
        const slot = address >>> 10;
        const bank = this.#get_chr_bank(slot);
        const offset = bank * CHR_BANK_BYTES + (address & (CHR_BANK_BYTES - 1));

        if (this.#chr_rom.byteLength > 0) {
            return read_memory(this.#chr_rom, offset, "CHR ROM");
        }

        return read_memory(this.#chr_ram, offset, "CHR RAM");
    }

    write_pattern(address: number, value: number): void {
        assert_pattern_address(address);
        assert_byte_value(value);

        if (this.#chr_ram.byteLength === 0) {
            return;
        }

        const slot = address >>> 10;
        const bank = this.#get_chr_bank(slot);
        const offset = bank * CHR_BANK_BYTES + (address & (CHR_BANK_BYTES - 1));
        this.#chr_ram[offset] = value;
    }

    observe_ppu_access(access: MapperPpuBusAccess): void {
        this.#observe_ppu_a12(access.address);
    }

    observe_ppu_address(address: number): void {
        this.#observe_ppu_a12(address);
    }

    clock_ppu_dot(): void {
        if (!this.#ppu_a12_high && this.#a12_low_dots < IRQ_A12_LOW_FILTER_DOTS) {
            this.#a12_low_dots += 1;
        }
    }

    get_nametable_mirroring(): MirroringMode {
        return this.#mirroring;
    }

    get_irq_line_asserted(): boolean {
        return this.#irq_line_asserted;
    }

    #write_mapper_register(address: number, value: number): void {
        switch (address & 0xe001) {
            case 0x8000:
                this.#bank_select = value & 0x07;
                this.#prg_mode = (value >>> 6) & 0x01;
                this.#chr_mode = (value >>> 7) & 0x01;
                break;
            case 0x8001:
                this.#write_bank_register(value);
                break;
            case 0xa000:
                this.#write_mirroring(value);
                break;
            case 0xa001:
                this.#prg_ram_enabled = (value & 0x80) !== 0;
                this.#prg_ram_write_protected = (value & 0x40) !== 0;
                break;
            case 0xc000:
                this.#irq_latch = value;
                break;
            case 0xc001:
                this.#irq_counter = 0;
                this.#irq_reload_pending = true;
                break;
            case 0xe000:
                this.#irq_enabled = false;
                this.#irq_line_asserted = false;
                break;
            case 0xe001:
                this.#irq_enabled = true;
                break;
        }
    }

    #write_bank_register(value: number): void {
        const register = this.#bank_select;
        let bank_value = value;

        if (register === 0 || register === 1) {
            bank_value &= 0xfe;
        } else if (register === 6) {
            bank_value &= 0x3f;
        } else if (register === 7) {
            bank_value &= 0x7f;
        }

        this.#bank_registers[register] = bank_value;
    }

    #write_mirroring(value: number): void {
        if (this.#four_screen_mirroring) {
            return;
        }

        this.#mirroring = (value & 0x01) === 0 ? "vertical" : "horizontal";
    }

    #get_prg_bank(slot: number): number {
        const last_bank = this.#prg_bank_count - 1;
        const second_last_bank = this.#prg_bank_count - 2;
        const bank6 = this.#bank_registers[6] ?? 0;
        const bank7 = this.#bank_registers[7] ?? 0;
        let bank: number;

        if (this.#prg_mode === 0) {
            bank = slot === 0 ? bank6 : slot === 1 ? bank7 : slot === 2 ? second_last_bank : last_bank;
        } else {
            bank = slot === 0 ? second_last_bank : slot === 1 ? bank7 : slot === 2 ? bank6 : last_bank;
        }

        return bank % this.#prg_bank_count;
    }

    #get_chr_bank(slot: number): number {
        const register0 = this.#bank_registers[0] ?? 0;
        const register1 = this.#bank_registers[1] ?? 0;
        let bank: number;

        if (this.#chr_mode === 0) {
            bank =
                slot === 0
                    ? register0
                    : slot === 1
                      ? register0 + 1
                      : slot === 2
                        ? register1
                        : slot === 3
                          ? register1 + 1
                          : (this.#bank_registers[slot - 2] ?? 0);
        } else {
            bank =
                slot < 4
                    ? (this.#bank_registers[slot + 2] ?? 0)
                    : slot === 4
                      ? register0
                      : slot === 5
                        ? register0 + 1
                        : slot === 6
                          ? register1
                          : register1 + 1;
        }

        return bank % this.#chr_bank_count;
    }

    #observe_ppu_a12(address: number): void {
        if (!Number.isInteger(address) || address < 0 || address >= PPU_ADDRESS_SPACE_BYTES) {
            throw new RangeError(`Observed PPU address ${address} is outside the 14-bit address space.`);
        }

        const next_a12_high = (address & 0x1000) !== 0;

        if (next_a12_high === this.#ppu_a12_high) {
            return;
        }

        if (next_a12_high && this.#a12_low_dots >= IRQ_A12_LOW_FILTER_DOTS) {
            this.#clock_irq_counter();
        }

        this.#ppu_a12_high = next_a12_high;
        this.#a12_low_dots = 0;
    }

    #clock_irq_counter(): void {
        if (this.#irq_counter === 0 || this.#irq_reload_pending) {
            this.#irq_counter = this.#irq_latch;
        } else {
            this.#irq_counter -= 1;
        }

        this.#irq_reload_pending = false;

        if (this.#irq_counter === 0 && this.#irq_enabled) {
            this.#irq_line_asserted = true;
        }
    }
}

function creation_failure(
    rom: InesRom,
    code:
        | "wrong-mapper-family"
        | "unsupported-prg-rom-size"
        | "unsupported-prg-ram-size"
        | "unsupported-chr-memory"
        | "unsupported-trainer",
    message: string,
): Mmc3MapperCreationResult {
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
