import assert from "node:assert/strict";
import test from "node:test";

import { Cpu2A03, CPU_INTERRUPT_CYCLES, CPU_RESET_CYCLES } from "../src/nes/cpu/cpu_2a03.js";
import { OFFICIAL_OPCODE_DEFINITIONS } from "../src/nes/cpu/opcode_table.js";
import {
    INTERRUPT_DISABLE_FLAG,
    NEGATIVE_FLAG,
    UNUSED_FLAG,
} from "../src/nes/cpu/registers.js";
import { FakeCpuBus } from "./support/FakeCpuBus.js";

test("clock_cycle performs one opcode or operand bus access and commits state per cycle", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xa9, 0x80]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;

    const opcode_cycle = cpu.clock_cycle();

    assert.deepEqual(opcode_cycle, {
        sequence_kind: "instruction",
        sequence_cycle: 1,
        sequence_completed: false,
        access: { kind: "read", address: 0x8000, value: 0xa9 },
    });
    assert.equal(bus.accesses.length, 1);
    assert.equal(cpu.program_counter, 0x8001);
    assert.equal(cpu.a, 0);

    const operand_cycle = cpu.clock_cycle();

    assert.deepEqual(operand_cycle, {
        sequence_kind: "instruction",
        sequence_cycle: 2,
        sequence_completed: true,
        access: { kind: "read", address: 0x8001, value: 0x80 },
    });
    assert.equal(bus.accesses.length, 2);
    assert.equal(cpu.program_counter, 0x8002);
    assert.equal(cpu.a, 0x80);
    assert.equal(cpu.status & NEGATIVE_FLAG, NEGATIVE_FLAG);
});

test("all official opcode sequences expose exactly one bus transaction per cycle", () => {
    for (const definition of OFFICIAL_OPCODE_DEFINITIONS) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([definition.opcode, 0, 0, 0, 0]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        let cycle_count = 0;
        let sequence_completed = false;

        while (!sequence_completed) {
            const previous_access_count = bus.accesses.length;
            const cycle = cpu.clock_cycle();
            cycle_count += 1;
            sequence_completed = cycle.sequence_completed;

            assert.equal(
                bus.accesses.length,
                previous_access_count + 1,
                `${definition.mnemonic} opcode $${definition.opcode.toString(16).padStart(2, "0")}`,
            );
            assert.equal(cycle.sequence_kind, "instruction");
            assert.equal(cycle.sequence_cycle, cycle_count);
        }

        const branch_taken =
            definition.mnemonic === "BCC" ||
            definition.mnemonic === "BNE" ||
            definition.mnemonic === "BPL" ||
            definition.mnemonic === "BVC";
        const expected_cycles =
            definition.base_cycles + (definition.addressing_mode === "relative" && branch_taken ? 1 : 0);

        assert.equal(bus.accesses.length, cycle_count);
        assert.equal(cycle_count, expected_cycles, `${definition.mnemonic} cycle count`);
    }
});

test("taken page-crossing branches expose both discarded reads before changing PC", () => {
    const bus = new FakeCpuBus();
    bus.load(0x80fd, new Uint8Array([0xd0, 0x02]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x80fd;
    cpu.status = UNUSED_FLAG;

    const expected = [
        { kind: "read", address: 0x80fd, value: 0xd0 },
        { kind: "read", address: 0x80fe, value: 0x02 },
        { kind: "read", address: 0x80ff, value: 0x00 },
        { kind: "read", address: 0x8001, value: 0x00 },
    ];

    for (const [index, expected_access] of expected.entries()) {
        const cycle = cpu.clock_cycle();

        assert.deepEqual(cycle.access, expected_access);
        assert.equal(cycle.sequence_cycle, index + 1);
        assert.equal(cycle.sequence_completed, index === expected.length - 1);
        assert.equal(cpu.program_counter, index === expected.length - 1 ? 0x8101 : index === 0 ? 0x80fe : 0x80ff);
    }

    assert.equal(bus.accesses.length, 4);
});

test("IRQ entry is visible as seven bus cycles after delayed CLI polling", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x58, 0xea, 0xea]));
    bus.load(0xfffe, new Uint8Array([0x00, 0x90]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfd;
    cpu.status = UNUSED_FLAG | INTERRUPT_DISABLE_FLAG;
    cpu.set_irq_line(true);

    assert.equal(cpu.clock_cycle().sequence_kind, "instruction");
    const cli_last_cycle = cpu.clock_cycle();
    assert.equal(cli_last_cycle.sequence_completed, true);
    assert.equal(cpu.status & INTERRUPT_DISABLE_FLAG, 0);

    assert.equal(cpu.clock_cycle().sequence_kind, "instruction");
    const nop_last_cycle = cpu.clock_cycle();
    assert.equal(nop_last_cycle.sequence_completed, true);
    assert.equal(cpu.program_counter, 0x8002);

    const interrupt_accesses = [
        { kind: "read", address: 0x8002, value: 0xea },
        { kind: "read", address: 0x8002, value: 0xea },
        { kind: "write", address: 0x01fd, value: 0x80 },
        { kind: "write", address: 0x01fc, value: 0x02 },
        { kind: "write", address: 0x01fb, value: UNUSED_FLAG },
        { kind: "read", address: 0xfffe, value: 0x00 },
        { kind: "read", address: 0xffff, value: 0x90 },
    ];

    for (const [index, expected_access] of interrupt_accesses.entries()) {
        const cycle = cpu.clock_cycle();

        assert.equal(cycle.sequence_kind, "irq");
        assert.equal(cycle.sequence_cycle, index + 1);
        assert.equal(cycle.sequence_completed, index === interrupt_accesses.length - 1);
        assert.deepEqual(cycle.access, expected_access);
        assert.equal(bus.accesses.length, 5 + index);
    }

    assert.equal(interrupt_accesses.length, CPU_INTERRUPT_CYCLES);
    assert.equal(cpu.stack_pointer, 0xfa);
    assert.equal(cpu.program_counter, 0x9000);
    assert.equal(cpu.status & INTERRUPT_DISABLE_FLAG, INTERRUPT_DISABLE_FLAG);
});

test("NMI requested mid-instruction waits for the boundary and outranks IRQ", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xa9, 0x42, 0xea]));
    bus.load(0xfffa, new Uint8Array([0x00, 0x90]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfd;
    cpu.status = UNUSED_FLAG | INTERRUPT_DISABLE_FLAG;
    cpu.set_irq_line(true);

    const opcode_cycle = cpu.clock_cycle();
    assert.equal(opcode_cycle.sequence_kind, "instruction");
    cpu.request_nmi();

    const operand_cycle = cpu.clock_cycle();
    assert.equal(operand_cycle.sequence_kind, "instruction");
    assert.equal(operand_cycle.sequence_completed, true);
    assert.equal(cpu.a, 0x42);

    const interrupt_accesses = [
        { kind: "read", address: 0x8002, value: 0xea },
        { kind: "read", address: 0x8002, value: 0xea },
        { kind: "write", address: 0x01fd, value: 0x80 },
        { kind: "write", address: 0x01fc, value: 0x02 },
        { kind: "write", address: 0x01fb, value: UNUSED_FLAG | INTERRUPT_DISABLE_FLAG },
        { kind: "read", address: 0xfffa, value: 0x00 },
        { kind: "read", address: 0xfffb, value: 0x90 },
    ];

    for (const [index, expected_access] of interrupt_accesses.entries()) {
        const cycle = cpu.clock_cycle();

        assert.equal(cycle.sequence_kind, "nmi");
        assert.equal(cycle.sequence_cycle, index + 1);
        assert.equal(cycle.sequence_completed, index === interrupt_accesses.length - 1);
        assert.deepEqual(cycle.access, expected_access);
    }

    assert.equal(cpu.program_counter, 0x9000);
    assert.equal(cpu.stack_pointer, 0xfa);
});

test("request_reset exposes each of the seven reset bus accesses without eager reads", () => {
    const bus = new FakeCpuBus();
    bus.load(0xfffc, new Uint8Array([0x34, 0x12]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x4567;
    cpu.stack_pointer = 0x80;

    cpu.request_reset();

    assert.deepEqual(bus.accesses, []);
    const expected_addresses = [0x4567, 0x4567, 0x0180, 0x017f, 0x017e, 0xfffc, 0xfffd];

    for (const [index, expected_address] of expected_addresses.entries()) {
        const cycle = cpu.clock_cycle();

        assert.equal(cycle.sequence_kind, "reset");
        assert.equal(cycle.sequence_cycle, index + 1);
        assert.equal(cycle.sequence_completed, index === expected_addresses.length - 1);
        assert.equal(cycle.access.kind, "read");
        assert.equal(cycle.access.address, expected_address);
        assert.equal(bus.accesses.length, index + 1);

        if (index === 2) {
            assert.equal(cpu.stack_pointer, 0x7f);
        }
    }

    assert.equal(expected_addresses.length, CPU_RESET_CYCLES);
    assert.equal(cpu.stack_pointer, 0x7d);
    assert.equal(cpu.program_counter, 0x1234);
    assert.equal(cpu.status & INTERRUPT_DISABLE_FLAG, INTERRUPT_DISABLE_FLAG);
});
