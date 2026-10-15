import assert from "node:assert/strict";
import test from "node:test";

import type { MirroringMode } from "../src/nes/cartridge/ines.js";
import type { MapperPpuBusAccess, PpuMapperPort } from "../src/nes/ppu/ppu_bus.js";
import { PpuMemoryBus } from "../src/nes/ppu/ppu_bus.js";

test("routes pattern reads and writes through the mapper in observed bus order", () => {
    const probe = make_ppu_bus();
    probe.pattern_read_value = 0x5a;

    assert.equal(probe.bus.read_ppu(0x5234), 0x5a);
    probe.bus.write_ppu(0x1abc, 0xa6);

    assert.deepEqual(probe.mapper_accesses, [
        { kind: "read", address: 0x1234, region: "pattern" },
        { kind: "write", address: 0x1abc, region: "pattern" },
    ]);
    assert.deepEqual(probe.mapper_events, [
        "observe:read:pattern:1234",
        "pattern-read:1234",
        "observe:write:pattern:1abc",
        "pattern-write:1abc:a6",
    ]);
});

test("maps logical nametables according to vertical, horizontal, and four-screen mirroring", () => {
    const cases: Array<{
        readonly mirroring: MirroringMode;
        readonly expected: readonly number[];
    }> = [
        { mirroring: "vertical", expected: [0x42, 0x43, 0x42, 0x43] },
        { mirroring: "horizontal", expected: [0x41, 0x41, 0x43, 0x43] },
        { mirroring: "four-screen", expected: [0x40, 0x41, 0x42, 0x43] },
    ];

    for (const test_case of cases) {
        const probe = make_ppu_bus(test_case.mirroring);

        for (let table = 0; table < 4; table += 1) {
            probe.bus.write_ppu(0x2000 + table * 0x400, 0x40 + table);
        }

        const actual = Array.from({ length: 4 }, (_, table) => probe.bus.read_ppu(0x2000 + table * 0x400));
        assert.deepEqual(actual, test_case.expected, `${test_case.mirroring} nametable pages`);
    }
});

test("mirrors $3000-$3EFF to nametable space and observes the original PPU address", () => {
    const probe = make_ppu_bus("vertical");

    probe.bus.write_ppu(0x3005, 0x39);
    probe.bus.write_ppu(0x3eff, 0x6f);

    assert.equal(probe.bus.read_ppu(0x2005), 0x39);
    assert.equal(probe.bus.read_ppu(0x2eff), 0x6f);
    assert.ok(probe.mapper_accesses.some((access) => access.address === 0x3005));
    assert.ok(probe.mapper_accesses.some((access) => access.address === 0x3eff));
});

test("mirrors palette RAM and aliases sprite universal-background entries with six-bit values", () => {
    const { bus } = make_ppu_bus();
    const aliases = [
        { alias: 0x3f10, canonical: 0x3f00, value: 0xff, expected: 0x3f },
        { alias: 0x3f14, canonical: 0x3f04, value: 0x65, expected: 0x25 },
        { alias: 0x3f18, canonical: 0x3f08, value: 0x44, expected: 0x04 },
        { alias: 0x3f1c, canonical: 0x3f0c, value: 0x3f, expected: 0x3f },
    ];

    for (const pair of aliases) {
        bus.write_ppu(pair.alias, pair.value);
        assert.equal(bus.read_ppu(pair.canonical), pair.expected);
        assert.equal(bus.read_ppu(pair.alias), pair.expected);
    }

    bus.write_ppu(0x3f23, 0x7c);
    assert.equal(bus.read_ppu(0x3f03), 0x3c);
    assert.equal(bus.read_ppu(0x3f23), 0x3c);

    bus.write_ppu(0x3f20, 0x2a);
    assert.equal(bus.read_ppu(0x3f00), 0x2a);
});

test("routes primary OAM through its separate 8-bit address space", () => {
    const probe = make_ppu_bus();

    probe.bus.write_oam(0x00, 0xa5);
    probe.bus.write_oam(0xff, 0x5a);

    assert.equal(probe.bus.read_oam(0x00), 0xa5);
    assert.equal(probe.bus.read_oam(0xff), 0x5a);
    assert.deepEqual(probe.mapper_accesses, []);
});

test("uses mapper mirroring changes per access and excludes internal palette/OAM from mapper notifications", () => {
    const probe = make_ppu_bus("vertical");
    probe.bus.write_ppu(0x2000, 0x11);
    probe.bus.write_ppu(0x2400, 0x22);
    assert.equal(probe.bus.read_ppu(0x2800), 0x11);

    probe.set_mirroring("horizontal");
    assert.equal(probe.bus.read_ppu(0x2400), 0x11);
    assert.equal(probe.bus.read_ppu(0x2800), 0x22);

    const mapper_access_count = probe.mapper_accesses.length;
    probe.bus.read_ppu(0x3f00);
    probe.bus.write_ppu(0x3f01, 0x12);
    probe.bus.read_oam(0);
    probe.bus.write_oam(0, 0x34);

    assert.equal(probe.mapper_accesses.length, mapper_access_count);
});

test("forwards PPU dots to the mapper even when no memory access occurs", () => {
    const probe = make_ppu_bus();

    probe.bus.clock_ppu_dot();
    probe.bus.clock_ppu_dot();

    assert.deepEqual(probe.mapper_events, ["clock:ppu-dot", "clock:ppu-dot"]);
});

test("rejects invalid PPU/OAM inputs and non-byte mapper pattern reads", () => {
    const probe = make_ppu_bus();

    assert.throws(() => probe.bus.read_ppu(-1), RangeError);
    assert.throws(() => probe.bus.read_ppu(0x1_0000), RangeError);
    assert.throws(() => probe.bus.write_ppu(0x2000, 0x100), RangeError);
    assert.throws(() => probe.bus.read_oam(0x100), RangeError);
    assert.throws(() => probe.bus.write_oam(0, -1), RangeError);

    probe.pattern_read_value = 0x100;
    assert.throws(() => probe.bus.read_ppu(0), RangeError);
});

interface PpuBusProbe {
    readonly bus: PpuMemoryBus;
    readonly mapper_accesses: MapperPpuBusAccess[];
    readonly mapper_events: string[];
    pattern_read_value: number;
    set_mirroring(mirroring: MirroringMode): void;
}

function make_ppu_bus(initial_mirroring: MirroringMode = "horizontal"): PpuBusProbe {
    const mapper_accesses: MapperPpuBusAccess[] = [];
    const mapper_events: string[] = [];
    let mirroring = initial_mirroring;
    let pattern_read_value = 0;
    const mapper: PpuMapperPort = {
        read_pattern(address) {
            mapper_events.push(`pattern-read:${address.toString(16)}`);

            return pattern_read_value;
        },
        write_pattern(address, value) {
            mapper_events.push(`pattern-write:${address.toString(16)}:${value.toString(16)}`);
        },
        observe_ppu_access(access) {
            mapper_accesses.push({ ...access });
            mapper_events.push(
                `observe:${access.kind}:${access.region}:${access.address.toString(16)}`,
            );
        },
        clock_ppu_dot() {
            mapper_events.push("clock:ppu-dot");
        },
        get_nametable_mirroring() {
            return mirroring;
        },
    };
    const bus = new PpuMemoryBus(mapper);

    return {
        bus,
        mapper_accesses,
        mapper_events,
        get pattern_read_value() {
            return pattern_read_value;
        },
        set pattern_read_value(value: number) {
            pattern_read_value = value;
        },
        set_mirroring(value) {
            mirroring = value;
        },
    };
}
