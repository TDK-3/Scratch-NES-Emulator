import assert from "node:assert/strict";
import test from "node:test";

import { NromMapper } from "../src/nes/cartridge/mapper_000.js";
import type { InesRom, MirroringMode } from "../src/nes/cartridge/ines.js";
import { PpuMemoryBus } from "../src/nes/ppu/ppu_bus.js";

const PRG_ROM_16K_BYTES = 0x4000;
const PRG_ROM_32K_BYTES = 0x8000;
const CHR_MEMORY_BYTES = 0x2000;

test("maps 16 KiB NROM PRG ROM into both CPU banks and ignores ROM writes", () => {
    const prg_rom = new Uint8Array(PRG_ROM_16K_BYTES);
    prg_rom[0] = 0x12;
    prg_rom[PRG_ROM_16K_BYTES - 1] = 0x34;
    const mapper = create_mapper(make_nrom_rom({ prg_rom }));

    prg_rom[0] = 0x99;
    mapper.write_cpu(0x8000, 0xa5);

    assert.deepEqual(mapper.read_cpu(0x8000, 0), { value: 0x12, driven_mask: 0xff });
    assert.equal(read_cpu(mapper, 0xbfff), 0x34);
    assert.equal(read_cpu(mapper, 0xc000), 0x12);
    assert.equal(read_cpu(mapper, 0xffff), 0x34);
});

test("maps 32 KiB NROM PRG ROM linearly across the CPU cartridge window", () => {
    const prg_rom = new Uint8Array(PRG_ROM_32K_BYTES);
    prg_rom[0] = 0x11;
    prg_rom[PRG_ROM_16K_BYTES] = 0x22;
    prg_rom[PRG_ROM_32K_BYTES - 1] = 0x33;
    const mapper = create_mapper(make_nrom_rom({ prg_rom }));

    assert.equal(read_cpu(mapper, 0x8000), 0x11);
    assert.equal(read_cpu(mapper, 0xc000), 0x22);
    assert.equal(read_cpu(mapper, 0xffff), 0x33);
});

test("maps declared PRG RAM and mirrors smaller RAM through the 8 KiB CPU window", () => {
    const mapper = create_mapper(make_nrom_rom({ prg_ram_bytes: 0x0800, prg_nvram_bytes: 0 }));

    mapper.write_cpu(0x6000, 0xa5);

    assert.deepEqual(mapper.read_cpu(0x6000, 0), { value: 0xa5, driven_mask: 0xff });
    assert.deepEqual(mapper.read_cpu(0x6800, 0), { value: 0xa5, driven_mask: 0xff });

    const no_ram_mapper = create_mapper(make_nrom_rom({ prg_ram_bytes: 0, prg_nvram_bytes: 0 }));
    no_ram_mapper.write_cpu(0x6000, 0x5a);
    assert.equal(no_ram_mapper.read_cpu(0x6000, 0), null);
    assert.equal(no_ram_mapper.get_prg_nvram_snapshot().byteLength, 0);
    assert.doesNotThrow(() => no_ram_mapper.load_prg_nvram_snapshot(new Uint8Array(0)));
});

test("snapshots only declared PRG NVRAM and restores it without altering volatile PRG RAM", () => {
    const mapper = create_mapper(
        make_nrom_rom({ prg_ram_bytes: 0x1000, prg_nvram_bytes: 0x1000 }),
    );
    mapper.write_cpu(0x6000, 0x12);
    mapper.write_cpu(0x7000, 0x34);

    const snapshot = mapper.get_prg_nvram_snapshot();
    assert.equal(snapshot.byteLength, 0x1000);
    assert.equal(snapshot[0], 0x34);
    snapshot[0] = 0xff;
    assert.equal(read_cpu(mapper, 0x7000), 0x34);

    const restored = new Uint8Array(0x1000);
    restored[0] = 0xa5;
    mapper.load_prg_nvram_snapshot(restored);
    restored[0] = 0xff;
    assert.equal(read_cpu(mapper, 0x6000), 0x12);
    assert.equal(read_cpu(mapper, 0x7000), 0xa5);
    assert.throws(() => mapper.load_prg_nvram_snapshot(new Uint8Array(1)), RangeError);
});

test("snapshots only declared CHR NVRAM and preserves volatile CHR RAM", () => {
    const mapper = create_mapper(
        make_nrom_rom({
            chr_rom: new Uint8Array(0),
            chr_ram_bytes: 0x1000,
            chr_nvram_bytes: 0x1000,
        }),
    );
    mapper.write_pattern(0x0000, 0x12);
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

test("reads fixed CHR ROM and ignores writes to pattern memory", () => {
    const chr_rom = new Uint8Array(CHR_MEMORY_BYTES);
    chr_rom[0] = 0x13;
    chr_rom[CHR_MEMORY_BYTES - 1] = 0x57;
    const mapper = create_mapper(make_nrom_rom({ chr_rom }));

    mapper.write_pattern(0, 0xa5);
    mapper.write_pattern(CHR_MEMORY_BYTES - 1, 0x5a);

    assert.equal(mapper.read_pattern(0), 0x13);
    assert.equal(mapper.read_pattern(CHR_MEMORY_BYTES - 1), 0x57);
});

test("uses declared CHR RAM when the ROM has no CHR ROM", () => {
    const mapper = create_mapper(
        make_nrom_rom({ chr_rom: new Uint8Array(0), chr_ram_bytes: CHR_MEMORY_BYTES }),
    );

    mapper.write_pattern(0x0000, 0x12);
    mapper.write_pattern(0x1fff, 0x34);

    assert.equal(mapper.read_pattern(0x0000), 0x12);
    assert.equal(mapper.read_pattern(0x1fff), 0x34);
});

test("loads a trainer into the PRG RAM window at $7000", () => {
    const trainer = new Uint8Array(0x0200);
    trainer[0] = 0x16;
    trainer[trainer.length - 1] = 0x32;
    const mapper = create_mapper(make_nrom_rom({ trainer }));

    trainer[0] = 0xff;

    assert.equal(read_cpu(mapper, 0x7000), 0x16);
    assert.equal(read_cpu(mapper, 0x71ff), 0x32);
});

test("uses the ROM mirroring mode when connected to the PPU memory bus", () => {
    const cases: Array<{
        readonly mirroring: MirroringMode;
        readonly alias_address: number;
        readonly expected: number;
    }> = [
        { mirroring: "vertical", alias_address: 0x2800, expected: 0x42 },
        { mirroring: "horizontal", alias_address: 0x2400, expected: 0x42 },
        { mirroring: "four-screen", alias_address: 0x2400, expected: 0x00 },
    ];

    for (const test_case of cases) {
        const mapper = create_mapper(make_nrom_rom({ mirroring: test_case.mirroring }));
        const bus = new PpuMemoryBus(mapper);

        bus.write_ppu(0x2000, 0x42);

        assert.equal(bus.read_ppu(test_case.alias_address), test_case.expected);
        assert.equal(mapper.get_nametable_mirroring(), test_case.mirroring);
    }
});

test("returns structured errors for unsupported routes and NROM memory layouts", () => {
    const unsupported_route = NromMapper.create(make_nrom_rom({ mapper_id: 2 }));
    assert.equal(unsupported_route.ok, false);

    if (!unsupported_route.ok) {
        assert.equal(unsupported_route.error.code, "unsupported-mapper");
    }

    const wrong_family = NromMapper.create(make_nrom_rom({ mapper_id: 4 }));
    assert.equal(wrong_family.ok, false);

    if (!wrong_family.ok) {
        assert.equal(wrong_family.error.code, "wrong-mapper-family");
    }

    const unsupported_prg = NromMapper.create(
        make_nrom_rom({ prg_rom: new Uint8Array(PRG_ROM_16K_BYTES + 1) }),
    );
    assert.equal(unsupported_prg.ok, false);

    if (!unsupported_prg.ok) {
        assert.equal(unsupported_prg.error.code, "unsupported-prg-rom-size");
    }

    const unsupported_chr = NromMapper.create(
        make_nrom_rom({ chr_rom: new Uint8Array(0), chr_ram_bytes: 0 }),
    );
    assert.equal(unsupported_chr.ok, false);

    if (!unsupported_chr.ok) {
        assert.equal(unsupported_chr.error.code, "unsupported-chr-memory");
    }

    const oversized_prg_ram = NromMapper.create(
        make_nrom_rom({ prg_ram_bytes: 0x4000, prg_nvram_bytes: 0 }),
    );
    assert.equal(oversized_prg_ram.ok, false);

    if (!oversized_prg_ram.ok) {
        assert.equal(oversized_prg_ram.error.code, "unsupported-prg-ram-size");
    }

    const trainer_without_ram = NromMapper.create(
        make_nrom_rom({ trainer: new Uint8Array(0x0200), prg_ram_bytes: 0, prg_nvram_bytes: 0 }),
    );
    assert.equal(trainer_without_ram.ok, false);

    if (!trainer_without_ram.ok) {
        assert.equal(trainer_without_ram.error.code, "unsupported-trainer");
    }

    const invalid_trainer = NromMapper.create(make_nrom_rom({ trainer: new Uint8Array(0x01ff) }));
    assert.equal(invalid_trainer.ok, false);

    if (!invalid_trainer.ok) {
        assert.equal(invalid_trainer.error.code, "unsupported-trainer");
    }
});

interface NromRomOptions {
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

function make_nrom_rom(options: NromRomOptions = {}): InesRom {
    return {
        format: "ines-1.0",
        mapper_id: options.mapper_id ?? 0,
        submapper: options.submapper ?? 0,
        mirroring: options.mirroring ?? "vertical",
        battery_backed: false,
        trainer: options.trainer ?? null,
        prg_rom: options.prg_rom ?? new Uint8Array(PRG_ROM_16K_BYTES),
        chr_rom: options.chr_rom ?? new Uint8Array(CHR_MEMORY_BYTES),
        prg_ram_bytes: options.prg_ram_bytes ?? 0x2000,
        prg_nvram_bytes: options.prg_nvram_bytes ?? 0,
        chr_ram_bytes: options.chr_ram_bytes ?? 0,
        chr_nvram_bytes: options.chr_nvram_bytes ?? 0,
    };
}

function create_mapper(rom: InesRom): NromMapper {
    const result = NromMapper.create(rom);

    if (!result.ok) {
        assert.fail(`Expected an NROM mapper, received ${result.error.code}.`);
    }

    return result.value;
}

function read_cpu(mapper: NromMapper, address: number): number {
    const result = mapper.read_cpu(address, 0);

    assert.ok(result !== null);

    return result.value;
}
