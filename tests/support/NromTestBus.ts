import type { CpuBus } from "../../src/nes/cpu/cpu_bus.js";

const CPU_ADDRESS_SPACE = 0x1_0000;
const RAM_BYTES = 0x0800;
const PRG_RAM_BYTES = 0x2000;
const PRG_RAM_START = 0x6000;
const PRG_ROM_START = 0x8000;
const PRG_ROM_16K = 0x4000;
const PRG_ROM_32K = 0x8000;
const RAM_MIRROR_MASK = RAM_BYTES - 1;

/** Minimal NROM bus for headless CPU test programs; it does not emulate PPU or APU registers. */
export class NromTestBus implements CpuBus {
    readonly #ram = new Uint8Array(RAM_BYTES);
    readonly #prg_ram = new Uint8Array(PRG_RAM_BYTES);
    readonly #prg_rom: Uint8Array;

    constructor(prg_rom: Uint8Array) {
        if (prg_rom.byteLength !== PRG_ROM_16K && prg_rom.byteLength !== PRG_ROM_32K) {
            throw new RangeError("The NROM CPU test bus requires 16 KiB or 32 KiB of PRG ROM.");
        }

        this.#prg_rom = new Uint8Array(prg_rom);
    }

    read_cpu(address: number): number {
        assert_cpu_address(address);

        if (address < 0x2000) {
            return read_memory(this.#ram, address & RAM_MIRROR_MASK);
        }

        if (address >= PRG_RAM_START && address < PRG_ROM_START) {
            return read_memory(this.#prg_ram, address - PRG_RAM_START);
        }

        if (address >= PRG_ROM_START) {
            const offset = (address - PRG_ROM_START) % this.#prg_rom.byteLength;

            return read_memory(this.#prg_rom, offset);
        }

        return 0;
    }

    write_cpu(address: number, value: number): void {
        assert_cpu_address(address);
        assert_byte_value(value);

        if (address < 0x2000) {
            this.#ram[address & RAM_MIRROR_MASK] = value;
            return;
        }

        if (address >= PRG_RAM_START && address < PRG_ROM_START) {
            this.#prg_ram[address - PRG_RAM_START] = value;
        }
    }
}

function assert_cpu_address(address: number): void {
    if (!Number.isInteger(address) || address < 0 || address >= CPU_ADDRESS_SPACE) {
        throw new RangeError(`CPU address ${address} is outside the 16-bit address space.`);
    }
}

function assert_byte_value(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
        throw new RangeError(`CPU bus value ${value} is outside the byte range.`);
    }
}

function read_memory(memory: Uint8Array, address: number): number {
    const value = memory[address];

    if (value === undefined) {
        throw new RangeError(`CPU test bus address ${address} is outside the mapped memory.`);
    }

    return value;
}
