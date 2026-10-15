import assert from "node:assert/strict";
import test from "node:test";

import { Cpu2A03, CPU_RESET_CYCLES } from "../src/nes/cpu/cpu_2a03.js";
import {
    BREAK_FLAG,
    CARRY_FLAG,
    DECIMAL_FLAG,
    INTERRUPT_DISABLE_FLAG,
    NEGATIVE_FLAG,
    OVERFLOW_FLAG,
    UNUSED_FLAG,
} from "../src/nes/cpu/registers.js";
import { FakeCpuBus } from "./support/FakeCpuBus.js";

test("reset reads the reset vector and performs three stack-page decrements", () => {
    const bus = new FakeCpuBus();
    bus.load(0xfffc, new Uint8Array([0x34, 0x12]));
    const cpu = new Cpu2A03(bus);

    assert.equal(cpu.reset(), CPU_RESET_CYCLES);

    assert.equal(cpu.a, 0);
    assert.equal(cpu.x, 0);
    assert.equal(cpu.y, 0);
    assert.equal(cpu.stack_pointer, 0xfd);
    assert.equal(cpu.program_counter, 0x1234);
    assert.equal(cpu.status, UNUSED_FLAG | INTERRUPT_DISABLE_FLAG);
    assert.deepEqual(bus.accesses, [
        { kind: "read", address: 0x0000, value: 0 },
        { kind: "read", address: 0x0000, value: 0 },
        { kind: "read", address: 0x0100, value: 0 },
        { kind: "read", address: 0x01ff, value: 0 },
        { kind: "read", address: 0x01fe, value: 0 },
        { kind: "read", address: 0xfffc, value: 0x34 },
        { kind: "read", address: 0xfffd, value: 0x12 },
    ]);
});

test("soft reset preserves data registers and decrements the current stack pointer", () => {
    const bus = new FakeCpuBus();
    bus.load(0xfffc, new Uint8Array([0x78, 0x56]));
    const cpu = new Cpu2A03(bus);
    cpu.a = 0x11;
    cpu.x = 0x22;
    cpu.y = 0x33;
    cpu.stack_pointer = 0x80;
    cpu.program_counter = 0x4567;
    cpu.status = CARRY_FLAG | DECIMAL_FLAG | OVERFLOW_FLAG | NEGATIVE_FLAG;

    cpu.reset();

    assert.equal(cpu.a, 0x11);
    assert.equal(cpu.x, 0x22);
    assert.equal(cpu.y, 0x33);
    assert.equal(cpu.stack_pointer, 0x7d);
    assert.equal(cpu.program_counter, 0x5678);
    assert.equal(
        cpu.status,
        CARRY_FLAG | DECIMAL_FLAG | INTERRUPT_DISABLE_FLAG | UNUSED_FLAG | OVERFLOW_FLAG | NEGATIVE_FLAG,
    );
    assert.deepEqual(
        bus.accesses.slice(0, 5).map((access) => access.address),
        [0x4567, 0x4567, 0x0180, 0x017f, 0x017e],
    );
});

test("byte stack operations wrap the stack pointer and normalize values", () => {
    const bus = new FakeCpuBus();
    const cpu = new Cpu2A03(bus);
    cpu.stack_pointer = 0;

    cpu.push_byte(0x1ab);

    assert.equal(cpu.stack_pointer, 0xff);
    assert.equal(bus.peek(0x0100), 0xab);
    assert.equal(cpu.pop_byte(), 0xab);
    assert.equal(cpu.stack_pointer, 0);
});

test("word stack operations push high first and pop low first", () => {
    const bus = new FakeCpuBus();
    const cpu = new Cpu2A03(bus);
    cpu.stack_pointer = 0xfd;

    cpu.push_word(0x1234);

    assert.equal(bus.peek(0x01fd), 0x12);
    assert.equal(bus.peek(0x01fc), 0x34);
    assert.equal(cpu.stack_pointer, 0xfb);
    assert.equal(cpu.pop_word(), 0x1234);
    assert.equal(cpu.stack_pointer, 0xfd);
    assert.deepEqual(bus.accesses, [
        { kind: "write", address: 0x01fd, value: 0x12 },
        { kind: "write", address: 0x01fc, value: 0x34 },
        { kind: "read", address: 0x01fc, value: 0x34 },
        { kind: "read", address: 0x01fd, value: 0x12 },
    ]);
});

test("status pushes distinguish BRK from IRQ and NMI", () => {
    for (const source of ["brk", "irq", "nmi"] as const) {
        const bus = new FakeCpuBus();
        const cpu = new Cpu2A03(bus);
        cpu.stack_pointer = 0xfd;
        cpu.status = CARRY_FLAG | OVERFLOW_FLAG;

        cpu.push_status(source);

        const break_bit = source === "brk" ? BREAK_FLAG : 0;
        assert.equal(bus.peek(0x01fd), CARRY_FLAG | OVERFLOW_FLAG | UNUSED_FLAG | break_bit);
        assert.equal(cpu.status, CARRY_FLAG | OVERFLOW_FLAG | UNUSED_FLAG);
        assert.equal(cpu.stack_pointer, 0xfc);
    }
});

test("status restore clears the stack-only break bit and keeps the unused bit set", () => {
    const cpu = new Cpu2A03(new FakeCpuBus());

    cpu.restore_status_from_stack(0xff);

    assert.equal(cpu.status, 0xef);
});
