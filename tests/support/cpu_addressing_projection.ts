import type { CpuAddressingMode, CpuOperandAccess } from "../../src/nes/cpu/addressing_modes.js";
import { Cpu2A03 } from "../../src/nes/cpu/cpu_2a03.js";
import { NesCpuBus } from "../../src/nes/cpu/nes_cpu_bus.js";
import { flatten_access_trace, make_absent_bus_devices, RecordingCpuBus } from "./recording_cpu_bus.js";

/**
 * Reference-side projection of one addressing-mode resolution onto the flat array shared
 * vector suite 10 ("cpu_addressing") records, and that scratch/src/cpu_addressing.gs reports
 * through its `cpu_resolved_*` globals plus the `cpu_access_log` trace. Enumerations are
 * encoded as small integers because a Scratch list can only hold numbers.
 */

/** Mode ids in `cpu_addressing_mode`, matching the ported enum in scratch/src/cpu_addressing.gs. */
export const CPU_ADDRESSING_MODES: readonly { readonly id: number; readonly name: CpuAddressingMode }[] = [
    { id: 1, name: "implied" },
    { id: 2, name: "accumulator" },
    { id: 3, name: "immediate" },
    { id: 4, name: "relative" },
    { id: 5, name: "zero_page" },
    { id: 6, name: "zero_page_x" },
    { id: 7, name: "zero_page_y" },
    { id: 8, name: "absolute" },
    { id: 9, name: "absolute_x" },
    { id: 10, name: "absolute_y" },
    { id: 11, name: "indirect" },
    { id: 12, name: "indexed_indirect" },
    { id: 13, name: "indirect_indexed" },
];

/** Access ids in `cpu_operand_access`. */
export const CPU_OPERAND_ACCESSES: readonly { readonly id: number; readonly name: CpuOperandAccess }[] = [
    { id: 1, name: "read" },
    { id: 2, name: "write" },
    { id: 3, name: "read_modify_write" },
];

/** Operand kind ids in `cpu_operand_kind`. */
export const CPU_OPERAND_KIND_IDS = {
    none: 0,
    implied: 1,
    accumulator: 2,
    immediate: 3,
    relative: 4,
    memory: 5,
    jump_target: 6,
} as const;

/** Access trace kind ids in `cpu_access_kind`: one logged transaction is kind, address, value. */
export const CPU_ACCESS_KIND_IDS = { read: 0, write: 1 } as const;

/** Number of fixed values a suite-10 record reports before its access trace. */
export const CPU_ADDRESSING_FIXED_VALUE_COUNT = 11;

/**
 * Number of fixed inputs a suite-10 record carries before its memory setup pairs: access, PC,
 * A, X, Y, SP, status, and the setup count. The record's operation id is the mode id, so the
 * mode is not repeated in the inputs.
 */
export const CPU_ADDRESSING_FIXED_INPUT_COUNT = 8;

export interface CpuAddressingSetup {
    readonly address: number;
    readonly value: number;
}

/** Returns the reference mode name for a suite-10 operation id. */
export function cpu_addressing_mode_name(mode_id: number): CpuAddressingMode {
    const entry = CPU_ADDRESSING_MODES.find((candidate) => candidate.id === mode_id);

    if (entry === undefined) {
        throw new RangeError(`Unknown CPU addressing mode id ${mode_id}.`);
    }

    return entry.name;
}

/** Returns the reference access name for a suite-10 access id. */
export function cpu_operand_access_name(access_id: number): CpuOperandAccess {
    const entry = CPU_OPERAND_ACCESSES.find((candidate) => candidate.id === access_id);

    if (entry === undefined) {
        throw new RangeError(`Unknown CPU operand access id ${access_id}.`);
    }

    return entry.name;
}

/**
 * Resolves one addressing mode on the production CPU behind a fresh decoder with no devices
 * attached, and returns the flat suite-10 values: kind, mode, access, base address, address,
 * value, page crossed, error, cycles, final PC, final SP, then one triple per bus access.
 * Cycles equal the access count, because the reference spends exactly one cycle per
 * transaction; the port counts them the same way.
 */
export function project_cpu_addressing(
    mode_id: number,
    access_id: number,
    program_counter: number,
    accumulator: number,
    x: number,
    y: number,
    stack_pointer: number,
    status: number,
    setup: readonly CpuAddressingSetup[],
): number[] {
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

    const operand = cpu.resolve_addressing_mode(cpu_addressing_mode_name(mode_id), cpu_operand_access_name(access_id));
    let kind: number = CPU_OPERAND_KIND_IDS.none;
    let base_address = 0;
    let address = 0;
    let value = 0;
    let page_crossed = 0;

    switch (operand.kind) {
        case "implied":
            kind = CPU_OPERAND_KIND_IDS.implied;
            break;
        case "accumulator":
            kind = CPU_OPERAND_KIND_IDS.accumulator;
            break;
        case "immediate":
            kind = CPU_OPERAND_KIND_IDS.immediate;
            value = operand.value;
            break;
        case "relative":
            kind = CPU_OPERAND_KIND_IDS.relative;
            value = operand.offset;
            base_address = operand.origin_address;
            address = operand.target_address;
            page_crossed = operand.page_crossed ? 1 : 0;
            break;
        case "memory":
            kind = CPU_OPERAND_KIND_IDS.memory;
            base_address = operand.base_address;
            address = operand.address;
            page_crossed = operand.page_crossed ? 1 : 0;
            break;
        case "jump_target":
            kind = CPU_OPERAND_KIND_IDS.jump_target;
            base_address = operand.pointer_address;
            address = operand.address;
            break;
    }

    const trace = flatten_access_trace(bus.accesses);

    return [
        kind,
        mode_id,
        access_id,
        base_address,
        address,
        value,
        page_crossed,
        0,
        bus.accesses.length,
        cpu.program_counter,
        cpu.stack_pointer,
        ...trace,
    ];
}
