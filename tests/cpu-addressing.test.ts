import assert from "node:assert/strict";
import test from "node:test";

import { Cpu2A03 } from "../src/nes/cpu/cpu_2a03.js";
import { FakeCpuBus } from "./support/FakeCpuBus.js";

test("implied and accumulator modes do not fetch operand bytes", () => {
    const bus = new FakeCpuBus();
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.a = 0xff;

    const implied = cpu.resolve_addressing_mode("implied");
    assert.equal(implied.kind, "implied");
    assert.throws(() => cpu.read_operand(implied), /implied/);

    const accumulator = cpu.resolve_addressing_mode("accumulator");
    assert.equal(cpu.read_operand(accumulator), 0xff);

    const accumulator_modify = cpu.resolve_addressing_mode("accumulator", "read_modify_write");
    assert.equal(cpu.modify_operand(accumulator_modify, (value) => value + 1), 0);
    assert.equal(cpu.program_counter, 0x8000);
    assert.deepEqual(bus.accesses, []);
});

test("immediate mode returns the fetched byte without a second bus read", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xa5]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;

    const operand = cpu.resolve_addressing_mode("immediate");

    assert.equal(operand.kind, "immediate");
    assert.equal(cpu.read_operand(operand), 0xa5);
    assert.equal(cpu.program_counter, 0x8001);
    assert.deepEqual(bus.accesses, [{ kind: "read", address: 0x8000, value: 0xa5 }]);
});

test("zero-page mode fetches a byte address and reads its memory operand", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x42]));
    bus.load(0x0042, new Uint8Array([0x99]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;

    const operand = cpu.resolve_addressing_mode("zero_page");

    assert.equal(operand.kind, "memory");
    assert.equal(operand.address, 0x0042);
    assert.equal(cpu.read_operand(operand), 0x99);
    assert.deepEqual(bus.accesses, [
        { kind: "read", address: 0x8000, value: 0x42 },
        { kind: "read", address: 0x0042, value: 0x99 },
    ]);
});

test("zero-page X and Y wrap at eight bits and perform the base-address dummy read", () => {
    const cases = [
        { mode: "zero_page_x" as const, index: "x" as const, value: 0x55 },
        { mode: "zero_page_y" as const, index: "y" as const, value: 0x66 },
    ];

    for (const { mode, index, value } of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([0xff]));
        bus.load(index === "x" ? 0x0001 : 0x0002, new Uint8Array([value]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu[index] = index === "x" ? 2 : 3;

        const operand = cpu.resolve_addressing_mode(mode);

        assert.equal(operand.kind, "memory");
        assert.equal(operand.base_address, 0x00ff);
        assert.equal(operand.address, index === "x" ? 0x0001 : 0x0002);
        assert.equal(cpu.read_operand(operand), value);
        assert.deepEqual(
            bus.accesses.map(({ kind, address }) => [kind, address]),
            [
                ["read", 0x8000],
                ["read", 0x00ff],
                ["read", index === "x" ? 0x0001 : 0x0002],
            ],
        );
    }
});

test("absolute mode fetches the low byte before the high byte", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x34, 0x12]));
    bus.load(0x1234, new Uint8Array([0x7b]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;

    const operand = cpu.resolve_addressing_mode("absolute");

    assert.equal(operand.kind, "memory");
    assert.equal(operand.address, 0x1234);
    assert.equal(cpu.read_operand(operand), 0x7b);
    assert.equal(cpu.program_counter, 0x8002);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0x8000, 0x8001, 0x1234],
    );
});

test("operand-byte fetches wrap the program counter at $FFFF", () => {
    const bus = new FakeCpuBus();
    bus.load(0xffff, new Uint8Array([0x34]));
    bus.load(0x0000, new Uint8Array([0x12]));
    bus.load(0x1234, new Uint8Array([0xa6]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0xffff;

    const operand = cpu.resolve_addressing_mode("absolute");

    assert.equal(operand.kind, "memory");
    assert.equal(operand.address, 0x1234);
    assert.equal(cpu.read_operand(operand), 0xa6);
    assert.equal(cpu.program_counter, 0x0001);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0xffff, 0x0000, 0x1234],
    );
});

test("absolute X reads add a wrong-page dummy read only when a page is crossed", () => {
    const no_cross_bus = new FakeCpuBus();
    no_cross_bus.load(0x8000, new Uint8Array([0xfe, 0x12]));
    no_cross_bus.load(0x12ff, new Uint8Array([0x31]));
    const no_cross_cpu = new Cpu2A03(no_cross_bus);
    no_cross_cpu.program_counter = 0x8000;
    no_cross_cpu.x = 1;

    const no_cross_operand = no_cross_cpu.resolve_addressing_mode("absolute_x");

    assert.equal(no_cross_operand.kind, "memory");
    assert.equal(no_cross_operand.address, 0x12ff);
    assert.equal(no_cross_operand.page_crossed, false);
    assert.equal(no_cross_cpu.read_operand(no_cross_operand), 0x31);
    assert.deepEqual(
        no_cross_bus.accesses.map(({ address }) => address),
        [0x8000, 0x8001, 0x12ff],
    );

    const crossed_bus = new FakeCpuBus();
    crossed_bus.load(0x8000, new Uint8Array([0xff, 0x12]));
    crossed_bus.load(0x1300, new Uint8Array([0x72]));
    const crossed_cpu = new Cpu2A03(crossed_bus);
    crossed_cpu.program_counter = 0x8000;
    crossed_cpu.x = 1;

    const crossed_operand = crossed_cpu.resolve_addressing_mode("absolute_x");

    assert.equal(crossed_operand.kind, "memory");
    assert.equal(crossed_operand.address, 0x1300);
    assert.equal(crossed_operand.page_crossed, true);
    assert.equal(crossed_cpu.read_operand(crossed_operand), 0x72);
    assert.deepEqual(
        crossed_bus.accesses.map(({ address }) => address),
        [0x8000, 0x8001, 0x1200, 0x1300],
    );
});

test("indexed stores perform a dummy read even without a page crossing", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x00, 0x20]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.y = 1;

    const operand = cpu.resolve_addressing_mode("absolute_y", "write");
    cpu.write_operand(operand, 0x5a);

    assert.equal(operand.kind, "memory");
    assert.equal(operand.address, 0x2001);
    assert.equal(operand.page_crossed, false);
    assert.equal(bus.peek(0x2001), 0x5a);
    assert.deepEqual(
        bus.accesses.map(({ kind, address }) => [kind, address]),
        [
            ["read", 0x8000],
            ["read", 0x8001],
            ["read", 0x2001],
            ["write", 0x2001],
        ],
    );
});

test("indirect JMP preserves the 6502 page-boundary high-byte wrap", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xff, 0x12]));
    bus.load(0x12ff, new Uint8Array([0x34]));
    bus.load(0x1200, new Uint8Array([0x56]));
    bus.load(0x1300, new Uint8Array([0x99]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;

    const operand = cpu.resolve_addressing_mode("indirect");

    assert.equal(operand.kind, "jump_target");
    assert.equal(operand.pointer_address, 0x12ff);
    assert.equal(operand.address, 0x5634);
    assert.equal(cpu.program_counter, 0x8002);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0x8000, 0x8001, 0x12ff, 0x1200],
    );
});

test("indexed-indirect wraps its pointer in zero page and reads the resolved address", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xfe]));
    bus.load(0x00ff, new Uint8Array([0x34]));
    bus.load(0x0000, new Uint8Array([0x12]));
    bus.load(0x1234, new Uint8Array([0xab]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.x = 1;

    const operand = cpu.resolve_addressing_mode("indexed_indirect");

    assert.equal(operand.kind, "memory");
    assert.equal(operand.address, 0x1234);
    assert.equal(cpu.read_operand(operand), 0xab);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0x8000, 0x00fe, 0x00ff, 0x0000, 0x1234],
    );
});

test("indexed-indirect wraps the operand-plus-X pointer within zero page", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xff]));
    bus.load(0x0000, new Uint8Array([0x78]));
    bus.load(0x0001, new Uint8Array([0x56]));
    bus.load(0x5678, new Uint8Array([0x9a]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.x = 1;

    const operand = cpu.resolve_addressing_mode("indexed_indirect");

    assert.equal(operand.kind, "memory");
    assert.equal(operand.address, 0x5678);
    assert.equal(cpu.read_operand(operand), 0x9a);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0x8000, 0x00ff, 0x0000, 0x0001, 0x5678],
    );
});

test("indirect-indexed wraps its zero-page pointer and adds Y with page-cross timing", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xff]));
    bus.load(0x00ff, new Uint8Array([0xff]));
    bus.load(0x0000, new Uint8Array([0x20]));
    bus.load(0x2100, new Uint8Array([0x80]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.y = 1;

    const operand = cpu.resolve_addressing_mode("indirect_indexed");

    assert.equal(operand.kind, "memory");
    assert.equal(operand.base_address, 0x20ff);
    assert.equal(operand.address, 0x2100);
    assert.equal(operand.page_crossed, true);
    assert.equal(cpu.read_operand(operand), 0x80);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0x8000, 0x00ff, 0x0000, 0x2000, 0x2100],
    );
});

test("relative branches sign-extend offsets and add one cycle when taken", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x05]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;

    const operand = cpu.resolve_addressing_mode("relative");

    assert.equal(operand.kind, "relative");
    assert.equal(operand.offset, 5);
    assert.equal(operand.origin_address, 0x8001);
    assert.equal(operand.target_address, 0x8006);
    assert.equal(operand.page_crossed, false);
    assert.equal(cpu.apply_relative_branch(operand, false), 0);
    assert.equal(cpu.program_counter, 0x8001);
    assert.equal(cpu.apply_relative_branch(operand, true), 1);
    assert.equal(cpu.program_counter, 0x8006);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0x8000, 0x8001],
    );
});

test("taken relative branches across a page read both intermediate addresses", () => {
    const bus = new FakeCpuBus();
    bus.load(0x80ff, new Uint8Array([0xfe]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x80ff;

    const operand = cpu.resolve_addressing_mode("relative");

    assert.equal(operand.kind, "relative");
    assert.equal(operand.offset, -2);
    assert.equal(operand.origin_address, 0x8100);
    assert.equal(operand.target_address, 0x80fe);
    assert.equal(operand.page_crossed, true);
    assert.equal(cpu.apply_relative_branch(operand, true), 2);
    assert.equal(cpu.program_counter, 0x80fe);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0x80ff, 0x8100, 0x81fe],
    );
});

test("memory read-modify-write emits a read, an old-value write, then the new value", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x10]));
    bus.load(0x0010, new Uint8Array([0x7f]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;

    const operand = cpu.resolve_addressing_mode("zero_page", "read_modify_write");
    const result = cpu.modify_operand(operand, (value) => value + 1);

    assert.equal(result, 0x80);
    assert.equal(bus.peek(0x0010), 0x80);
    assert.deepEqual(bus.accesses, [
        { kind: "read", address: 0x8000, value: 0x10 },
        { kind: "read", address: 0x0010, value: 0x7f },
        { kind: "write", address: 0x0010, value: 0x7f },
        { kind: "write", address: 0x0010, value: 0x80 },
    ]);
});

test("indexed read-modify-write includes its dummy read before the effective access", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xff, 0x12]));
    bus.load(0x1300, new Uint8Array([0x02]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.x = 1;

    const operand = cpu.resolve_addressing_mode("absolute_x", "read_modify_write");
    assert.equal(cpu.modify_operand(operand, (value) => value << 1), 0x04);

    assert.deepEqual(
        bus.accesses.map(({ kind, address, value }) => [kind, address, value]),
        [
            ["read", 0x8000, 0xff],
            ["read", 0x8001, 0x12],
            ["read", 0x1200, 0],
            ["read", 0x1300, 0x02],
            ["write", 0x1300, 0x02],
            ["write", 0x1300, 0x04],
        ],
    );
});

test("rejects invalid operand access before consuming instruction bytes", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x44, 0x12]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;

    assert.throws(() => cpu.resolve_addressing_mode("immediate", "read_modify_write"), /immediate/);
    assert.throws(() => cpu.resolve_addressing_mode("indirect", "write"), /indirect/);
    assert.equal(cpu.program_counter, 0x8000);
    assert.deepEqual(bus.accesses, []);
});
