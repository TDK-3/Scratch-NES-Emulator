import assert from "node:assert/strict";
import test from "node:test";

import { Cpu2A03 } from "../src/nes/cpu/cpu_2a03.js";
import { CpuTraceBus, CpuStepTraceRecorder, format_cpu_step_trace } from "../src/nes/cpu/cpu_trace.js";
import { INTERRUPT_DISABLE_FLAG, UNUSED_FLAG } from "../src/nes/cpu/registers.js";
import { FakeCpuBus } from "./support/FakeCpuBus.js";

test("records decoded instruction steps, state snapshots, bytes, cycles, and a cumulative cycle offset", () => {
    const memory = new FakeCpuBus();
    memory.load(0x8000, new Uint8Array([0xa9, 0x42, 0xe8]));
    const bus = new CpuTraceBus(memory);
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.status = UNUSED_FLAG;
    const recorder = new CpuStepTraceRecorder(cpu, bus);

    const load_trace = recorder.step();

    assert.deepEqual(load_trace, {
        kind: "instruction",
        cycle_start: 0,
        cycles: 2,
        registers_before: {
            a: 0,
            x: 0,
            y: 0,
            stack_pointer: 0,
            program_counter: 0x8000,
            status: UNUSED_FLAG,
        },
        registers_after: {
            a: 0x42,
            x: 0,
            y: 0,
            stack_pointer: 0,
            program_counter: 0x8002,
            status: UNUSED_FLAG,
        },
        instruction: {
            opcode: 0xa9,
            bytes: [0xa9, 0x42],
            mnemonic: "LDA",
            addressing_mode: "immediate",
        },
        bus_accesses: [
            { kind: "read", address: 0x8000, value: 0xa9 },
            { kind: "read", address: 0x8001, value: 0x42 },
        ],
    });
    assert.equal(
        format_cpu_step_trace(load_trace),
        "00000000 PC=$8000 A=$00 X=$00 Y=$00 P=$20 SP=$00 | LDA [A9 42] | 2 CPU cycles | " +
            "R:$8000=$A9 R:$8001=$42",
    );

    const increment_trace = recorder.step();

    assert.equal(increment_trace.kind, "instruction");
    assert.equal(increment_trace.cycle_start, 2);
    assert.equal(increment_trace.cycles, 2);
    assert.deepEqual(increment_trace.registers_after, {
        a: 0x42,
        x: 1,
        y: 0,
        stack_pointer: 0,
        program_counter: 0x8003,
        status: UNUSED_FLAG,
    });
    assert.equal(recorder.elapsed_cpu_cycles, 4);
});

test("collects split JSR operand fetches in instruction-byte order", () => {
    const memory = new FakeCpuBus();
    memory.load(0x8000, new Uint8Array([0x20, 0x34, 0x12]));
    const bus = new CpuTraceBus(memory);
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfd;
    const recorder = new CpuStepTraceRecorder(cpu, bus);

    const trace = recorder.step();

    assert.ok(trace.kind === "instruction");
    assert.equal(trace.instruction.mnemonic, "JSR");
    assert.deepEqual(trace.instruction.bytes, [0x20, 0x34, 0x12]);
    assert.deepEqual(
        trace.bus_accesses.map(({ address }) => address),
        [0x8000, 0x8001, 0x01fd, 0x01fd, 0x01fc, 0x8002],
    );
});

test("records writes and preserves the wrapped CPU bus transaction order", () => {
    const memory = new FakeCpuBus();
    memory.load(0x8000, new Uint8Array([0x8d, 0x10, 0x00]));
    const bus = new CpuTraceBus(memory);
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.a = 0x5a;
    const recorder = new CpuStepTraceRecorder(cpu, bus);

    const trace = recorder.step();

    assert.ok(trace.kind === "instruction");
    assert.equal(trace.cycles, 4);
    assert.deepEqual(trace.instruction.bytes, [0x8d, 0x10, 0x00]);
    assert.deepEqual(trace.bus_accesses, [
        { kind: "read", address: 0x8000, value: 0x8d },
        { kind: "read", address: 0x8001, value: 0x10 },
        { kind: "read", address: 0x8002, value: 0x00 },
        { kind: "write", address: 0x0010, value: 0x5a },
    ]);
    assert.equal(memory.peek(0x0010), 0x5a);
});

test("keeps BRK as an instruction even though it uses the IRQ vector", () => {
    const memory = new FakeCpuBus();
    memory.load(0x8000, new Uint8Array([0x00, 0xea]));
    memory.load(0xfffe, new Uint8Array([0x00, 0x90]));
    const bus = new CpuTraceBus(memory);
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfd;
    cpu.status = UNUSED_FLAG;
    const recorder = new CpuStepTraceRecorder(cpu, bus);

    const trace = recorder.step();

    assert.ok(trace.kind === "instruction");
    assert.equal(trace.cycles, 7);
    assert.equal(trace.instruction.mnemonic, "BRK");
    assert.deepEqual(trace.instruction.bytes, [0x00]);
});

test("labels IRQ and NMI entries separately from opcodes", () => {
    const scenarios = [
        { kind: "irq", vector: 0xfffe, mask_irq: false },
        { kind: "nmi", vector: 0xfffa, mask_irq: true },
    ] as const;

    for (const scenario of scenarios) {
        const memory = new FakeCpuBus();
        memory.load(0x8000, new Uint8Array([0xea]));
        memory.load(scenario.vector, new Uint8Array([0x00, 0x90]));
        const bus = new CpuTraceBus(memory);
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.stack_pointer = 0xfd;
        cpu.status = scenario.mask_irq ? UNUSED_FLAG | INTERRUPT_DISABLE_FLAG : UNUSED_FLAG;
        const recorder = new CpuStepTraceRecorder(cpu, bus);

        if (scenario.kind === "irq") {
            cpu.set_irq_line(true);
        } else {
            cpu.request_nmi();
        }

        const trace = recorder.step();

        assert.equal(trace.kind, scenario.kind);
        assert.equal(trace.cycle_start, 0);
        assert.equal(trace.cycles, 7);
        assert.equal("instruction" in trace, false);
        assert.deepEqual(
            trace.bus_accesses.map(({ kind, address }) => [kind, address]),
            [
                ["read", 0x8000],
                ["read", 0x8000],
                ["write", 0x01fd],
                ["write", 0x01fc],
                ["write", 0x01fb],
                ["read", scenario.vector],
                ["read", scenario.vector + 1],
            ],
        );
    }
});
