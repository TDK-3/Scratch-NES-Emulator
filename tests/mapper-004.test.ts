import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parse_ines_rom } from "../src/nes/cartridge/ines.js";
import type { InesRom, MirroringMode } from "../src/nes/cartridge/ines.js";
import { Mmc3Mapper } from "../src/nes/cartridge/mapper_004.js";
import { Ppu2C02 } from "../src/nes/ppu/ppu_2c02.js";
import { PpuMemoryBus } from "../src/nes/ppu/ppu_bus.js";

const PRG_BANK_BYTES = 0x2000;
const CHR_BANK_BYTES = 0x0400;
const PRG_RAM_BYTES = 0x2000;
const TEST_ROM = readFileSync(new URL("../test_rom.nes", import.meta.url));

test("creates MMC3 for the supplied mapper 4 ROM", () => {
    const parsed = parse_ines_rom(TEST_ROM);

    if (!parsed.ok) {
        assert.fail(`Expected a valid test ROM, received ${parsed.error.code}.`);
    }

    const mapper = create_mapper(parsed.value);

    assert.equal(mapper.get_nametable_mirroring(), "vertical");
    assert.ok(mapper.read_cpu(0x8000, 0) !== null);
});

test("maps MMC3 PRG banks in both modes and keeps the final banks fixed", () => {
    const mapper = create_mapper(make_mmc3_rom({ prg_rom: make_banked_memory(8, PRG_BANK_BYTES) }));

    assert.equal(read_cpu(mapper, 0x8000), 1);
    assert.equal(read_cpu(mapper, 0xa000), 1);
    assert.equal(read_cpu(mapper, 0xc000), 7);
    assert.equal(read_cpu(mapper, 0xe000), 8);

    set_bank_register(mapper, 6, 3);
    set_bank_register(mapper, 7, 4);

    assert.equal(read_cpu(mapper, 0x8000), 4);
    assert.equal(read_cpu(mapper, 0xa000), 5);
    assert.equal(read_cpu(mapper, 0xc000), 7);
    assert.equal(read_cpu(mapper, 0xe000), 8);

    mapper.write_cpu(0x8000, 0x46);

    assert.equal(read_cpu(mapper, 0x8000), 7);
    assert.equal(read_cpu(mapper, 0xa000), 5);
    assert.equal(read_cpu(mapper, 0xc000), 4);
    assert.equal(read_cpu(mapper, 0xe000), 8);
});

test("maps MMC3 CHR 2 KiB pairs, 1 KiB banks, and the alternate CHR mode", () => {
    const chr_rom = make_banked_memory(16, CHR_BANK_BYTES);
    const mapper = create_mapper(make_mmc3_rom({ chr_rom }));

    set_bank_register(mapper, 0, 3);
    set_bank_register(mapper, 1, 6);
    set_bank_register(mapper, 2, 8);
    set_bank_register(mapper, 3, 9);
    set_bank_register(mapper, 4, 10);
    set_bank_register(mapper, 5, 11);

    assert.equal(mapper.read_pattern(0x0000), 3);
    assert.equal(mapper.read_pattern(0x0400), 4);
    assert.equal(mapper.read_pattern(0x0800), 7);
    assert.equal(mapper.read_pattern(0x0c00), 8);
    assert.equal(mapper.read_pattern(0x1000), 9);
    assert.equal(mapper.read_pattern(0x1c00), 12);

    mapper.write_cpu(0x8000, 0x80);

    assert.equal(mapper.read_pattern(0x0000), 9);
    assert.equal(mapper.read_pattern(0x0400), 10);
    assert.equal(mapper.read_pattern(0x0c00), 12);
    assert.equal(mapper.read_pattern(0x1000), 3);
    assert.equal(mapper.read_pattern(0x1400), 4);
    assert.equal(mapper.read_pattern(0x1800), 7);
    assert.equal(mapper.read_pattern(0x1c00), 8);
});

test("banks CHR RAM and keeps CHR ROM writes disabled", () => {
    const mapper = create_mapper(
        make_mmc3_rom({ chr_rom: new Uint8Array(0), chr_ram_bytes: 8 * CHR_BANK_BYTES }),
    );

    set_bank_register(mapper, 2, 5);
    mapper.write_pattern(0x1003, 0xa6);
    assert.equal(mapper.read_pattern(0x1003), 0xa6);

    const chr_rom = new Uint8Array(8 * CHR_BANK_BYTES);
    chr_rom[0] = 0x39;
    const read_only_mapper = create_mapper(make_mmc3_rom({ chr_rom }));
    read_only_mapper.write_pattern(0, 0x55);
    assert.equal(read_only_mapper.read_pattern(0), 0x39);
});

test("snapshots PRG NVRAM separately and restores it despite mapper write protection", () => {
    const mapper = create_mapper(
        make_mmc3_rom({ prg_ram_bytes: 0x1000, prg_nvram_bytes: 0x1000 }),
    );
    mapper.write_cpu(0x6000, 0x12);
    mapper.write_cpu(0x7000, 0x34);
    mapper.write_cpu(0xa001, 0xc0);

    const snapshot = mapper.get_prg_nvram_snapshot();
    assert.equal(snapshot.byteLength, 0x1000);
    assert.equal(snapshot[0], 0x34);

    const restored = new Uint8Array(0x1000);
    restored[0] = 0xa5;
    mapper.load_prg_nvram_snapshot(restored);

    assert.equal(read_cpu(mapper, 0x6000), 0x12);
    assert.equal(read_cpu(mapper, 0x7000), 0xa5);
    assert.throws(() => mapper.load_prg_nvram_snapshot(new Uint8Array(0)), RangeError);
});

test("snapshots only declared CHR NVRAM across MMC3 banking", () => {
    const mapper = create_mapper(
        make_mmc3_rom({
            chr_rom: new Uint8Array(0),
            chr_ram_bytes: 0x1000,
            chr_nvram_bytes: 0x1000,
        }),
    );
    mapper.write_pattern(0x0000, 0x12);
    set_bank_register(mapper, 2, 4);
    mapper.write_pattern(0x1000, 0x34);

    const snapshot = mapper.get_chr_nvram_snapshot();
    assert.equal(snapshot.byteLength, 0x1000);
    assert.equal(snapshot[0], 0x34);

    const restored = new Uint8Array(0x1000);
    restored[0] = 0xa5;
    mapper.load_chr_nvram_snapshot(restored);
    restored[0] = 0xff;
    assert.equal(mapper.read_pattern(0x0000), 0x12);
    assert.equal(mapper.read_pattern(0x1000), 0xa5);
    assert.throws(() => mapper.load_chr_nvram_snapshot(new Uint8Array(0)), RangeError);
});

test("updates header mirroring and leaves four-screen wiring fixed", () => {
    const mapper = create_mapper(make_mmc3_rom({ mirroring: "vertical" }));
    const bus = new PpuMemoryBus(mapper);

    mapper.write_cpu(0xa000, 0x01);
    assert.equal(mapper.get_nametable_mirroring(), "horizontal");
    bus.write_ppu(0x2000, 0x42);
    assert.equal(bus.read_ppu(0x2400), 0x42);

    mapper.write_cpu(0xa000, 0x00);
    assert.equal(mapper.get_nametable_mirroring(), "vertical");

    const four_screen = create_mapper(make_mmc3_rom({ mirroring: "four-screen" }));
    four_screen.write_cpu(0xa000, 0x01);
    assert.equal(four_screen.get_nametable_mirroring(), "four-screen");
});

test("applies MMC3 PRG RAM enable and write-protect bits", () => {
    const mapper = create_mapper(make_mmc3_rom({ prg_ram_bytes: PRG_RAM_BYTES }));

    mapper.write_cpu(0x6000, 0x31);
    assert.equal(read_cpu(mapper, 0x6000), 0x31);

    mapper.write_cpu(0xa001, 0x00);
    mapper.write_cpu(0x6000, 0x42);
    assert.equal(mapper.read_cpu(0x6000, 0), null);

    mapper.write_cpu(0xa001, 0x80);
    assert.equal(read_cpu(mapper, 0x6000), 0x31);
    mapper.write_cpu(0x6000, 0x53);
    assert.equal(read_cpu(mapper, 0x6000), 0x53);

    mapper.write_cpu(0xa001, 0xc0);
    mapper.write_cpu(0x6000, 0x64);
    assert.equal(read_cpu(mapper, 0x6000), 0x53);
});

test("clocks the MMC3 IRQ counter only on A12 rises after ten low PPU dots", () => {
    const mapper = create_mapper(make_mmc3_rom());

    const ppu_bus = new PpuMemoryBus(mapper);
    mapper.write_cpu(0xc000, 0x02);
    mapper.write_cpu(0xc001, 0x00);
    mapper.write_cpu(0xe001, 0x00);

    clock_a12_rise(ppu_bus, 2);
    assert.equal(mapper.get_irq_line_asserted(), false);

    clock_a12_rise(ppu_bus, 9);
    assert.equal(mapper.get_irq_line_asserted(), false);
    clock_a12_rise(ppu_bus, 10);
    assert.equal(mapper.get_irq_line_asserted(), false);
    ppu_bus.read_ppu(0x1000);
    clock_a12_rise(ppu_bus, 10);
    assert.equal(mapper.get_irq_line_asserted(), false);

    mapper.write_cpu(0xc001, 0x00);
    clock_a12_rise(ppu_bus, 9);
    assert.equal(mapper.get_irq_line_asserted(), false);
    clock_a12_rise(ppu_bus, 10);
    assert.equal(mapper.get_irq_line_asserted(), false);
    clock_a12_rise(ppu_bus, 10);
    assert.equal(mapper.get_irq_line_asserted(), false);
    clock_a12_rise(ppu_bus, 10);
    assert.equal(mapper.get_irq_line_asserted(), true);

    mapper.write_cpu(0xe000, 0x00);
    assert.equal(mapper.get_irq_line_asserted(), false);
});

test("clocks MMC3 IRQs from A12 transitions committed through PPUADDR", () => {
    const mapper = create_mapper(make_mmc3_rom());
    const ppu = new Ppu2C02(new PpuMemoryBus(mapper));

    mapper.write_cpu(0xc000, 0x01);
    mapper.write_cpu(0xc001, 0x00);
    mapper.write_cpu(0xe001, 0x00);

    set_ppu_address(ppu, 0x0000);
    clock_ppu_dots(ppu, 10);
    set_ppu_address(ppu, 0x1000);
    assert.equal(mapper.get_irq_line_asserted(), false);

    clock_ppu_dots(ppu, 10);
    set_ppu_address(ppu, 0x0000);
    clock_ppu_dots(ppu, 10);
    set_ppu_address(ppu, 0x1000);

    assert.equal(mapper.get_irq_line_asserted(), true);
});

test("clocks MMC3 IRQs when PPUDATA increments the PPU address across A12", () => {
    const mapper = create_mapper(make_mmc3_rom());
    const ppu = new Ppu2C02(new PpuMemoryBus(mapper));

    mapper.write_cpu(0xc000, 0x01);
    mapper.write_cpu(0xc001, 0x00);
    mapper.write_cpu(0xe001, 0x00);

    set_ppu_address(ppu, 0x0fff);
    clock_ppu_dots(ppu, 10);
    ppu.read_cpu_register(7, 0);
    assert.equal(mapper.get_irq_line_asserted(), false);

    set_ppu_address(ppu, 0x0fff);
    clock_ppu_dots(ppu, 10);
    ppu.read_cpu_register(7, 0);

    assert.equal(mapper.get_irq_line_asserted(), true);
});

test("resets MMC3 bank, mirroring, and IRQ state without clearing PRG RAM", () => {
    const mapper = create_mapper(make_mmc3_rom({ prg_ram_bytes: PRG_RAM_BYTES }));
    const ppu_bus = new PpuMemoryBus(mapper);
    mapper.write_cpu(0x6000, 0x7a);
    set_bank_register(mapper, 6, 3);
    mapper.write_cpu(0xa000, 0x01);
    mapper.write_cpu(0xc000, 0x00);
    mapper.write_cpu(0xe001, 0x00);
    clock_a12_rise(ppu_bus, 10);
    assert.equal(mapper.get_irq_line_asserted(), true);

    mapper.reset();

    assert.equal(read_cpu(mapper, 0x8000), 1);
    assert.equal(mapper.get_nametable_mirroring(), "vertical");
    assert.equal(mapper.get_irq_line_asserted(), false);
    assert.equal(read_cpu(mapper, 0x6000), 0x7a);
});

test("returns structured creation errors for unsupported MMC3 routes and memory layouts", () => {
    const wrong_family = Mmc3Mapper.create(make_mmc3_rom({ mapper_id: 0 }));
    assert.equal(wrong_family.ok, false);

    if (!wrong_family.ok) {
        assert.equal(wrong_family.error.code, "wrong-mapper-family");
    }

    const unsupported_submapper = Mmc3Mapper.create(make_mmc3_rom({ submapper: 1 }));
    assert.equal(unsupported_submapper.ok, false);

    if (!unsupported_submapper.ok) {
        assert.equal(unsupported_submapper.error.code, "unsupported-submapper");
    }

    const small_prg = Mmc3Mapper.create(make_mmc3_rom({ prg_rom: new Uint8Array(PRG_BANK_BYTES * 3) }));
    assert.equal(small_prg.ok, false);

    if (!small_prg.ok) {
        assert.equal(small_prg.error.code, "unsupported-prg-rom-size");
        assert.equal(small_prg.error.mapper_id, 4);
        assert.equal(small_prg.error.submapper, 0);
    }

    const oversized_ram = Mmc3Mapper.create(make_mmc3_rom({ prg_ram_bytes: PRG_RAM_BYTES + 1 }));
    assert.equal(oversized_ram.ok, false);

    if (!oversized_ram.ok) {
        assert.equal(oversized_ram.error.code, "unsupported-prg-ram-size");
    }

    const no_chr = Mmc3Mapper.create(make_mmc3_rom({ chr_rom: new Uint8Array(0), chr_ram_bytes: 0 }));
    assert.equal(no_chr.ok, false);

    if (!no_chr.ok) {
        assert.equal(no_chr.error.code, "unsupported-chr-memory");
    }

    const conflicting_chr = Mmc3Mapper.create(
        make_mmc3_rom({ chr_rom: new Uint8Array(8 * CHR_BANK_BYTES), chr_ram_bytes: CHR_BANK_BYTES }),
    );
    assert.equal(conflicting_chr.ok, false);

    if (!conflicting_chr.ok) {
        assert.equal(conflicting_chr.error.code, "unsupported-chr-memory");
    }

    const invalid_trainer = Mmc3Mapper.create(
        make_mmc3_rom({ trainer: new Uint8Array(0x01ff), prg_ram_bytes: PRG_RAM_BYTES }),
    );
    assert.equal(invalid_trainer.ok, false);

    if (!invalid_trainer.ok) {
        assert.equal(invalid_trainer.error.code, "unsupported-trainer");
    }
});

interface Mmc3RomOptions {
    readonly mapper_id?: number;
    readonly submapper?: number;
    readonly mirroring?: MirroringMode;
    readonly prg_rom?: Uint8Array;
    readonly chr_rom?: Uint8Array;
    readonly prg_ram_bytes?: number;
    readonly prg_nvram_bytes?: number;
    readonly chr_ram_bytes?: number;
    readonly chr_nvram_bytes?: number;
    readonly trainer?: Uint8Array | null;
}

function make_mmc3_rom(options: Mmc3RomOptions = {}): InesRom {
    return {
        format: "ines-1.0",
        mapper_id: options.mapper_id ?? 4,
        submapper: options.submapper ?? 0,
        mirroring: options.mirroring ?? "vertical",
        battery_backed: false,
        trainer: options.trainer ?? null,
        prg_rom: options.prg_rom ?? make_banked_memory(8, PRG_BANK_BYTES),
        chr_rom: options.chr_rom ?? make_banked_memory(8, CHR_BANK_BYTES),
        prg_ram_bytes: options.prg_ram_bytes ?? 0x2000,
        prg_nvram_bytes: options.prg_nvram_bytes ?? 0,
        chr_ram_bytes: options.chr_ram_bytes ?? 0,
        chr_nvram_bytes: options.chr_nvram_bytes ?? 0,
    };
}

function create_mapper(rom: InesRom): Mmc3Mapper {
    const result = Mmc3Mapper.create(rom);

    if (!result.ok) {
        assert.fail(`Expected an MMC3 mapper, received ${result.error.code}.`);
    }

    return result.value;
}

function read_cpu(mapper: Mmc3Mapper, address: number): number {
    const result = mapper.read_cpu(address, 0);

    assert.ok(result !== null);

    return result.value;
}

function set_bank_register(mapper: Mmc3Mapper, register: number, value: number): void {
    mapper.write_cpu(0x8000, register);
    mapper.write_cpu(0x8001, value);
}

function set_ppu_address(ppu: Ppu2C02, address: number): void {
    ppu.write_cpu_register(6, (address >>> 8) & 0xff);
    ppu.write_cpu_register(6, address & 0xff);
}

function clock_ppu_dots(ppu: Ppu2C02, dots: number): void {
    for (let elapsed_dot = 0; elapsed_dot < dots; elapsed_dot += 1) {
        ppu.clock_ppu_dot();
    }
}

function clock_a12_rise(ppu_bus: PpuMemoryBus, low_dots: number): void {
    ppu_bus.read_ppu(0x0000);

    for (let dot = 0; dot < low_dots; dot += 1) {
        ppu_bus.clock_ppu_dot();
    }

    ppu_bus.read_ppu(0x1000);
}

function make_banked_memory(bank_count: number, bank_bytes: number): Uint8Array {
    const memory = new Uint8Array(bank_count * bank_bytes);

    for (let bank = 0; bank < bank_count; bank += 1) {
        memory.fill(bank + 1, bank * bank_bytes, (bank + 1) * bank_bytes);
    }

    return memory;
}
