import { Cpu2A03 } from "../../src/nes/cpu/cpu_2a03.js";
import { NesCpuBus } from "../../src/nes/cpu/nes_cpu_bus.js";
import { flatten_access_trace, make_absent_bus_devices, RecordingCpuBus } from "./recording_cpu_bus.js";

/**
 * Reference-side projection of the CPU control loop onto the flat array shared vector suite 14
 * ("cpu_control") records, and that scratch/src/cpu_control.gs reports through its register
 * globals, `cpu_sequence_kind`, `cpu_instruction_error`, and the `cpu_access_log` trace.
 *
 * A record runs several `begin_next_sequence` steps over a program, so it can pin the acceptance
 * policy rather than a single instruction: which sequence wins when a jam, a pending NMI, and an
 * asserted IRQ line compete, when the interrupt-disable flag masks IRQ, and how CLI, SEI, and PLP
 * delay or allow one IRQ at the next instruction boundary. The sequence kinds come from the
 * public `clock_cycle()` result, so no private reference state is read.
 */

/** Sequence ids in `cpu_sequence_kind`, matching the ported enum in scratch/src/cpu_control.gs. */
export const CPU_CONTROL_SEQUENCE_KINDS: readonly { readonly id: number; readonly name: string }[] = [
    { id: 1, name: "instruction" },
    { id: 2, name: "irq" },
    { id: 3, name: "jam" },
    { id: 4, name: "nmi" },
    { id: 5, name: "reset" },
];

/**
 * Number of fixed inputs a suite-14 record carries before its program bytes and memory setup
 * pairs: PC, A, X, Y, SP, status, the pending-NMI flag, the IRQ line level, the step count, the
 * step before which an NMI is requested, the step before which the IRQ line is asserted (both 0
 * for never), the program byte count, and the setup count. The two step indexes let a record
 * change an interrupt input between boundaries, which is the only way to observe what CLI, SEI,
 * PLP, and BRK leave in the IRQ poll mask.
 */
export const CPU_CONTROL_FIXED_INPUT_COUNT = 13;

/**
 * Number of fixed values a suite-14 record reports before its per-step sequence kinds and its
 * access trace: cycles, program counter, stack pointer, status, A, X, Y, and the instruction
 * error code.
 */
export const CPU_CONTROL_FIXED_VALUE_COUNT = 8;

export interface CpuControlSetup {
    readonly address: number;
    readonly value: number;
}

/** Returns the ported id for a reference sequence kind. */
export function cpu_control_sequence_kind_id(name: string): number {
    const entry = CPU_CONTROL_SEQUENCE_KINDS.find((candidate) => candidate.name === name);

    if (entry === undefined) {
        throw new RangeError(`Sequence kind ${name} has no ported id.`);
    }

    return entry.id;
}

/**
 * Runs `step_count` control-loop steps on the production CPU behind a recording bus with no
 * devices attached, and returns the eight fixed values, one sequence kind per step, and one
 * `(kind, address, value)` triple per bus access.
 */
export function project_cpu_control(
    program_counter: number,
    accumulator: number,
    x: number,
    y: number,
    stack_pointer: number,
    status: number,
    nmi_pending: number,
    irq_line: number,
    step_count: number,
    nmi_request_step: number,
    irq_assert_step: number,
    program: readonly number[],
    setup: readonly CpuControlSetup[],
): number[] {
    if (step_count < 1) {
        throw new RangeError("A control record runs at least one step.");
    }

    const bus = new RecordingCpuBus(new NesCpuBus(make_absent_bus_devices()));

    for (const entry of setup) {
        bus.prepare(entry.address, entry.value);
    }

    for (const [offset, byte] of program.entries()) {
        bus.prepare(program_counter + offset, byte);
    }

    const cpu = new Cpu2A03(bus);
    cpu.program_counter = program_counter;
    cpu.a = accumulator;
    cpu.x = x;
    cpu.y = y;
    cpu.stack_pointer = stack_pointer;
    cpu.status = status;

    if (nmi_pending === 1) {
        cpu.request_nmi();
    }

    if (irq_line === 1) {
        cpu.set_irq_line(true);
    }

    bus.clear();

    const kinds: number[] = [];
    let cycles = 0;

    for (let step = 1; step <= step_count; step += 1) {
        if (step === nmi_request_step) {
            cpu.request_nmi();
        }

        if (step === irq_assert_step) {
            cpu.set_irq_line(true);
        }

        let result = cpu.clock_cycle();

        if (result.sequence_kind === "dma") {
            throw new RangeError("No DMA device is attached, so a control record cannot spend a DMA cycle.");
        }

        kinds.push(cpu_control_sequence_kind_id(result.sequence_kind));
        cycles += 1;

        while (!result.sequence_completed) {
            result = cpu.clock_cycle();
            cycles += 1;
        }
    }

    if (cycles !== bus.accesses.length) {
        throw new RangeError(`The control loop spent ${cycles} cycles for ${bus.accesses.length} accesses.`);
    }

    return [
        cycles,
        cpu.program_counter,
        cpu.stack_pointer,
        cpu.status,
        cpu.a,
        cpu.x,
        cpu.y,
        // Every instruction a control record runs is official, so the port reports no error.
        0,
        ...kinds,
        ...flatten_access_trace(bus.accesses),
    ];
}
