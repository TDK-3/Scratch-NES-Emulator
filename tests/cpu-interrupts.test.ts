import assert from "node:assert/strict";
import test from "node:test";

import { Cpu2A03, CPU_INTERRUPT_CYCLES, CPU_RESET_CYCLES } from "../src/nes/cpu/cpu_2a03.js";
import {
    BREAK_FLAG,
    CARRY_FLAG,
    INTERRUPT_DISABLE_FLAG,
    UNUSED_FLAG,
    has_status_flag,
} from "../src/nes/cpu/registers.js";
import { FakeCpuBus } from "./support/FakeCpuBus.js";

test("IRQ is level-sensitive, masked by I, and pushes status without the break bit", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xea, 0xea]));
    bus.load(0x1234, new Uint8Array([0xea]));
    bus.load(0xfffe, new Uint8Array([0x34, 0x12]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfd;
    cpu.status = UNUSED_FLAG | INTERRUPT_DISABLE_FLAG;
    cpu.set_irq_line(true);

    assert.equal(cpu.step(), 2);
    assert.equal(cpu.program_counter, 0x8001);
    assert.equal(cpu.stack_pointer, 0xfd);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0x8000, 0x8001],
    );

    cpu.status = UNUSED_FLAG;
    bus.clear_trace();
    assert.equal(cpu.step(), CPU_INTERRUPT_CYCLES);
    assert.equal(cpu.program_counter, 0x1234);
    assert.equal(cpu.stack_pointer, 0xfa);
    assert.equal(bus.peek(0x01fd), 0x80);
    assert.equal(bus.peek(0x01fc), 0x01);
    assert.equal(bus.peek(0x01fb), UNUSED_FLAG);
    assert.equal(has_status_flag(cpu.status, INTERRUPT_DISABLE_FLAG), true);
    assert.equal(bus.accesses.length, CPU_INTERRUPT_CYCLES);
    assert.deepEqual(
        bus.accesses.map(({ kind, address }) => [kind, address]),
        [
            ["read", 0x8001],
            ["read", 0x8001],
            ["write", 0x01fd],
            ["write", 0x01fc],
            ["write", 0x01fb],
            ["read", 0xfffe],
            ["read", 0xffff],
        ],
    );

    bus.clear_trace();
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.program_counter, 0x1235);
    assert.equal(bus.accesses.length, 2);

    cpu.status = UNUSED_FLAG;
    bus.clear_trace();
    assert.equal(cpu.step(), CPU_INTERRUPT_CYCLES);
    assert.equal(cpu.program_counter, 0x1234);
    assert.equal(bus.peek(0x01fa), 0x12);
});

test("NMI is latched, outranks IRQ, ignores I, and uses its own vector", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xea]));
    bus.load(0x5678, new Uint8Array([0xea]));
    bus.load(0xfffa, new Uint8Array([0x78, 0x56]));
    bus.load(0xfffe, new Uint8Array([0x34, 0x12]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfd;
    cpu.status = UNUSED_FLAG | INTERRUPT_DISABLE_FLAG | CARRY_FLAG;
    cpu.set_irq_line(true);
    cpu.request_nmi();
    cpu.request_nmi();

    assert.equal(cpu.step(), CPU_INTERRUPT_CYCLES);
    assert.equal(cpu.program_counter, 0x5678);
    assert.equal(cpu.stack_pointer, 0xfa);
    assert.equal(bus.peek(0x01fd), 0x80);
    assert.equal(bus.peek(0x01fc), 0x00);
    assert.equal(bus.peek(0x01fb), UNUSED_FLAG | INTERRUPT_DISABLE_FLAG | CARRY_FLAG);
    assert.equal(bus.peek(0x01fb) & BREAK_FLAG, 0);
    assert.equal(bus.accesses.length, CPU_INTERRUPT_CYCLES);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0x8000, 0x8000, 0x01fd, 0x01fc, 0x01fb, 0xfffa, 0xfffb],
    );

    bus.clear_trace();
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.program_counter, 0x5679);
    assert.equal(bus.accesses.length, 2);
});

test("IRQ recognition after CLI is delayed by one following instruction", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x58, 0xea, 0xea]));
    bus.load(0x9000, new Uint8Array([0xea]));
    bus.load(0xfffe, new Uint8Array([0x00, 0x90]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfd;
    cpu.status = UNUSED_FLAG | INTERRUPT_DISABLE_FLAG;
    cpu.set_irq_line(true);

    assert.equal(cpu.step(), 2);
    assert.equal(cpu.program_counter, 0x8001);
    assert.equal(has_status_flag(cpu.status, INTERRUPT_DISABLE_FLAG), false);

    bus.clear_trace();
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.program_counter, 0x8002);
    assert.equal(bus.accesses.length, 2);

    bus.clear_trace();
    assert.equal(cpu.step(), CPU_INTERRUPT_CYCLES);
    assert.equal(cpu.program_counter, 0x9000);
    assert.equal(bus.peek(0x01fd), 0x80);
    assert.equal(bus.peek(0x01fc), 0x02);
});

test("SEI polls IRQ using the interrupt mask sampled before the instruction", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x78, 0xea]));
    bus.load(0x9000, new Uint8Array([0xea]));
    bus.load(0xfffe, new Uint8Array([0x00, 0x90]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfd;
    cpu.status = UNUSED_FLAG;

    assert.equal(cpu.step(), 2);
    assert.equal(has_status_flag(cpu.status, INTERRUPT_DISABLE_FLAG), true);
    cpu.set_irq_line(true);

    assert.equal(cpu.step(), CPU_INTERRUPT_CYCLES);
    assert.equal(cpu.program_counter, 0x9000);
    assert.equal(bus.peek(0x01fd), 0x80);
    assert.equal(bus.peek(0x01fc), 0x01);
});

test("PLP delays IRQ polling but RTI's restored I flag is used at the next boundary", () => {
    const cases = [
        {
            name: "PLP",
            start_address: 0x8000,
            program: new Uint8Array([0x28, 0xea, 0xea]),
            stack_pointer: 0xfd,
            frame_address: 0x01fe,
            frame: new Uint8Array([UNUSED_FLAG]),
            first_cycles: 4,
            delays_irq: true,
        },
        {
            name: "RTI",
            start_address: 0x9000,
            program: new Uint8Array([0x40]),
            stack_pointer: 0xfa,
            frame_address: 0x01fb,
            frame: new Uint8Array([UNUSED_FLAG, 0x01, 0x80]),
            first_cycles: 6,
            delays_irq: false,
        },
    ];

    for (const scenario of cases) {
        const bus = new FakeCpuBus();
        bus.load(scenario.start_address, scenario.program);
        bus.load(0x8001, new Uint8Array([0xea, 0xea]));
        bus.load(scenario.frame_address, scenario.frame);
        bus.load(0xa000, new Uint8Array([0xea]));
        bus.load(0xfffe, new Uint8Array([0x00, 0xa0]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = scenario.start_address;
        cpu.stack_pointer = scenario.stack_pointer;
        cpu.status = UNUSED_FLAG | INTERRUPT_DISABLE_FLAG;
        cpu.set_irq_line(true);

        assert.equal(cpu.step(), scenario.first_cycles, scenario.name);
        assert.equal(cpu.program_counter, 0x8001, scenario.name);
        assert.equal(has_status_flag(cpu.status, INTERRUPT_DISABLE_FLAG), false, scenario.name);

        if (scenario.delays_irq) {
            assert.equal(cpu.step(), 2, scenario.name);
            assert.equal(cpu.program_counter, 0x8002, scenario.name);
        }

        assert.equal(cpu.step(), CPU_INTERRUPT_CYCLES, scenario.name);
        assert.equal(cpu.program_counter, 0xa000, scenario.name);
    }
});

test("reset clears a latched NMI and keeps IRQ masked by the reset I flag", () => {
    const bus = new FakeCpuBus();
    bus.load(0xfffc, new Uint8Array([0x00, 0x90]));
    bus.load(0xfffa, new Uint8Array([0x00, 0xa0]));
    bus.load(0x9000, new Uint8Array([0xea]));
    const cpu = new Cpu2A03(bus);
    cpu.request_nmi();
    cpu.set_irq_line(true);

    assert.equal(cpu.reset(), CPU_RESET_CYCLES);
    assert.equal(cpu.program_counter, 0x9000);
    assert.equal(has_status_flag(cpu.status, INTERRUPT_DISABLE_FLAG), true);
    bus.clear_trace();

    assert.equal(cpu.step(), 2);
    assert.equal(cpu.program_counter, 0x9001);
    assert.equal(bus.accesses.length, 2);
});
