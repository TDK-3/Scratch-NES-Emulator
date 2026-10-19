import { Cpu2A03 } from "../../src/nes/cpu/cpu_2a03.js";
import { CARRY_FLAG } from "../../src/nes/cpu/registers.js";
import { NesCpuBus } from "../../src/nes/cpu/nes_cpu_bus.js";
import { flatten_access_trace, make_absent_bus_devices, RecordingCpuBus } from "./recording_cpu_bus.js";

/**
 * Reference-side projection of one CPU cycle sequence onto the flat array shared vector suite
 * 11 ("cpu_sequence") records, and that scratch/src/cpu_sequence.gs reports through its
 * register globals, `cpu_sequence_error`, and the `cpu_access_log` trace. Enumerations are
 * encoded as small integers because a Scratch list can only hold numbers.
 */

/** Sequence ids in `cpu_sequence_op`, matching the ported enum in scratch/src/cpu_sequence.gs. */
export const CPU_SEQUENCE_OPS: readonly { readonly id: number; readonly name: string }[] = [
    { id: 1, name: "reset" },
    { id: 2, name: "brk" },
    { id: 3, name: "jsr" },
    { id: 4, name: "rti" },
    { id: 5, name: "rts" },
    { id: 6, name: "irq" },
    { id: 7, name: "nmi" },
    { id: 8, name: "relative_branch" },
];

/** Sequence error ids in `cpu_sequence_error_code`. */
export const CPU_SEQUENCE_ERROR_IDS = { none: 0, not_relative_operand: 1 } as const;

/**
 * Number of fixed values a suite-11 record reports before its access trace: cycles, program
 * counter, stack pointer, status, A, X, Y, and the sequence error code.
 */
export const CPU_SEQUENCE_FIXED_VALUE_COUNT = 8;

/**
 * Number of fixed inputs a suite-11 record carries before its memory setup pairs: PC, A, X, Y,
 * SP, status, the relative-branch taken flag, and the setup count. The record's operation id
 * is the sequence id, so it is not repeated in the inputs.
 */
export const CPU_SEQUENCE_FIXED_INPUT_COUNT = 8;

/** Opcode byte each sequence needs at the program counter, or null when it fetches none. */
export const CPU_SEQUENCE_OPCODES: readonly (readonly number[] | null)[] = [
    null, // 1 reset: no opcode fetch
    [0x00, 0x00], // 2 brk: opcode plus the padding byte the sequence fetches
    [0x20, 0x00, 0x00], // 3 jsr: opcode plus the two target bytes
    [0x40], // 4 rti
    [0x60], // 5 rts
    null, // 6 irq: the interrupt sequence fetches no opcode
    null, // 7 nmi: the interrupt sequence fetches no opcode
    [0x90, 0x00], // 8 relative_branch: BCC plus its offset
];

export interface CpuSequenceSetup {
    readonly address: number;
    readonly value: number;
}

/** Returns the ported sequence name for a suite-11 operation id. */
export function cpu_sequence_name(operation_id: number): string {
    const entry = CPU_SEQUENCE_OPS.find((candidate) => candidate.id === operation_id);

    if (entry === undefined) {
        throw new RangeError(`Unknown CPU sequence id ${operation_id}.`);
    }

    return entry.name;
}

/**
 * Runs one sequence on the production CPU behind a fresh decoder with no devices attached and
 * returns the flat suite-11 values: cycles, program counter, stack pointer, status, A, X, Y,
 * error, then one (kind, address, value) triple per bus access. Cycles equal the access count,
 * because the reference spends exactly one cycle per transaction and the port counts them the
 * same way.
 *
 * Sequences 2 through 5 and 8 are instruction sequences: the setup bytes must hold the opcode
 * at the program counter, and the recorded trace includes the opcode fetch that
 * `execute_instruction_cycles` performs before the ported sequence starts. Sequence 8 records
 * a BCC, so the branch is taken exactly when the carry flag in the status input is clear; the
 * `taken` input has to agree, because the port applies it directly instead of evaluating the
 * condition.
 */
export function project_cpu_sequence(
    operation_id: number,
    program_counter: number,
    accumulator: number,
    x: number,
    y: number,
    stack_pointer: number,
    status: number,
    taken: number,
    setup: readonly CpuSequenceSetup[],
): number[] {
    cpu_sequence_name(operation_id);

    const bus = new RecordingCpuBus(new NesCpuBus(make_absent_bus_devices()));

    for (const entry of setup) {
        bus.prepare(entry.address, entry.value);
    }

    const cpu = new Cpu2A03(bus);
    cpu.program_counter = program_counter;
    cpu.a = accumulator;
    cpu.x = x;
    cpu.y = y;
    cpu.stack_pointer = stack_pointer;
    cpu.status = status;
    bus.clear();

    if (operation_id === 8 && taken !== ((status & CARRY_FLAG) === 0 ? 1 : 0)) {
        throw new RangeError(`Sequence 8 records BCC, so taken ${taken} contradicts status $${status.toString(16)}.`);
    }

    let cycles: number;

    switch (operation_id) {
        case 1:
            cycles = cpu.reset();
            break;
        case 6:
            cpu.set_irq_line(true);
            cycles = cpu.step();
            break;
        case 7:
            cpu.request_nmi();
            cycles = cpu.step();
            break;
        default:
            cycles = cpu.step();
            break;
    }

    if (cycles !== bus.accesses.length) {
        throw new RangeError(`Sequence ${operation_id} spent ${cycles} cycles for ${bus.accesses.length} accesses.`);
    }

    return [
        cycles,
        cpu.program_counter,
        cpu.stack_pointer,
        cpu.status,
        cpu.a,
        cpu.x,
        cpu.y,
        CPU_SEQUENCE_ERROR_IDS.none,
        ...flatten_access_trace(bus.accesses),
    ];
}
