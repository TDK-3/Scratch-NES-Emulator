import { Cpu2A03 } from "../../src/nes/cpu/cpu_2a03.js";
import { NesCpuBus } from "../../src/nes/cpu/nes_cpu_bus.js";
import { CPU_OPCODE_TABLE } from "../../src/nes/cpu/opcode_table.js";
import { is_official_opcode } from "./cpu_opcode_projection.js";
import { flatten_access_trace, make_absent_bus_devices, RecordingCpuBus } from "./recording_cpu_bus.js";

/**
 * Reference-side projection of one executed instruction onto the flat array shared vector suite
 * 13 ("cpu_instruction") records, and that scratch/src/cpu_instruction.gs reports through its
 * register globals, `cpu_instruction_error`, and the `cpu_access_log` trace.
 *
 * A record carries the program bytes at the program counter, so the opcode fetch is part of the
 * recorded trace and the cycle count includes it, exactly as `Cpu2A03.step()` accounts for it.
 */

/**
 * Mnemonics the ported dispatcher executes today. Anything official outside this set is refused
 * with `unsupported_mnemonic` rather than executed, and the refusal is recorded as a vector so
 * an unported instruction cannot pass silently. Growing the port means growing this list, the
 * `.gs` dispatch chain, the mirror, and the fixture records together.
 */
export const CPU_INSTRUCTION_PORTED_MNEMONICS: readonly string[] = [
    "ADC",
    "AND",
    "ASL",
    "BCC",
    "BCS",
    "BEQ",
    "BIT",
    "BMI",
    "BNE",
    "BPL",
    "BRK",
    "BVC",
    "BVS",
    "CLC",
    "CLD",
    "CLI",
    "CLV",
    "CMP",
    "CPX",
    "CPY",
    "DEC",
    "DEX",
    "DEY",
    "EOR",
    "INC",
    "INX",
    "INY",
    "JMP",
    "JSR",
    "KIL",
    "LDA",
    "LDX",
    "LDY",
    "LSR",
    "NOP",
    "ORA",
    "PHA",
    "PHP",
    "PLA",
    "PLP",
    "ROL",
    "ROR",
    "RTI",
    "RTS",
    "SBC",
    "SEC",
    "SED",
    "SEI",
    "STA",
    "STX",
    "STY",
    "TAX",
    "TAY",
    "TSX",
    "TXA",
    "TXS",
    "TYA",
];

/** Instruction error ids in `cpu_instruction_error_code`. */
export const CPU_INSTRUCTION_ERROR_IDS = {
    none: 0,
    undecodable_opcode: 1,
    unofficial_opcode: 2,
    unresolved_operand: 3,
    unsupported_mnemonic: 4,
    unsupported_operand: 5,
} as const;

/**
 * Number of fixed inputs a suite-13 record carries before its program bytes and memory setup
 * pairs: PC, A, X, Y, SP, status, the program byte count, and the setup count.
 */
export const CPU_INSTRUCTION_FIXED_INPUT_COUNT = 8;

/**
 * Number of fixed values a suite-13 record reports before its access trace: cycles, program
 * counter, stack pointer, status, A, X, Y, and the instruction error code.
 */
export const CPU_INSTRUCTION_FIXED_VALUE_COUNT = 8;

export interface CpuInstructionSetup {
    readonly address: number;
    readonly value: number;
}

/** The mnemonic the reference table gives an opcode, for records that document a refusal. */
function mnemonic_at(program: readonly number[]): string {
    const opcode = program[0];

    if (opcode === undefined) {
        throw new RangeError("An instruction record needs at least the opcode byte.");
    }

    const definition = CPU_OPCODE_TABLE.get(opcode);

    if (definition === undefined) {
        throw new RangeError(`Opcode $${opcode.toString(16)} is missing from the production table.`);
    }

    return definition.mnemonic;
}

/**
 * Executes one instruction on the production CPU behind a recording bus with no devices
 * attached, and returns the eight fixed values plus one `(kind, address, value)` triple per bus
 * access.
 *
 * `expected_error` records the port's refusal for an instruction it does not execute yet. A
 * refusal spends only the opcode fetch, so the reference is not asked to run the instruction;
 * the projection instead checks that the refusal is justified by the production table, either
 * because the opcode is unofficial or because its mnemonic is outside the ported set, and
 * reports the fetch the port does perform.
 */
export function project_cpu_instruction(
    program_counter: number,
    accumulator: number,
    x: number,
    y: number,
    stack_pointer: number,
    status: number,
    program: readonly number[],
    setup: readonly CpuInstructionSetup[],
    expected_error: number = CPU_INSTRUCTION_ERROR_IDS.none,
): number[] {
    const opcode = program[0];

    if (opcode === undefined) {
        throw new RangeError("An instruction record needs at least the opcode byte.");
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
    bus.clear();

    if (expected_error !== CPU_INSTRUCTION_ERROR_IDS.none) {
        const mnemonic = mnemonic_at(program);

        if (expected_error === CPU_INSTRUCTION_ERROR_IDS.unofficial_opcode) {
            if (is_official_opcode(opcode)) {
                throw new RangeError(`Opcode $${opcode.toString(16)} is official, so it is not refused as unofficial.`);
            }
        } else if (expected_error !== CPU_INSTRUCTION_ERROR_IDS.unsupported_mnemonic) {
            throw new RangeError(`Only the unofficial and unsupported refusals are derivable, got ${expected_error}.`);
        } else if (!is_official_opcode(opcode)) {
            throw new RangeError(`Opcode $${opcode.toString(16)} is unofficial, so it is refused as unofficial.`);
        } else if (CPU_INSTRUCTION_PORTED_MNEMONICS.includes(mnemonic)) {
            throw new RangeError(`${mnemonic} is ported, so it must not be recorded as unsupported.`);
        }

        // The port fetches and decodes the opcode, then reports instead of executing.
        return [
            1,
            (program_counter + 1) % 65536,
            stack_pointer,
            status,
            accumulator,
            x,
            y,
            expected_error,
            0,
            program_counter,
            opcode,
        ];
    }

    const mnemonic = mnemonic_at(program);

    if (!CPU_INSTRUCTION_PORTED_MNEMONICS.includes(mnemonic)) {
        throw new RangeError(`${mnemonic} is not ported yet, so record it with its refusal error code.`);
    }

    const cycles = cpu.step();

    if (cycles !== bus.accesses.length) {
        throw new RangeError(`${mnemonic} spent ${cycles} cycles for ${bus.accesses.length} accesses.`);
    }

    return [
        cycles,
        cpu.program_counter,
        cpu.stack_pointer,
        cpu.status,
        cpu.a,
        cpu.x,
        cpu.y,
        CPU_INSTRUCTION_ERROR_IDS.none,
        ...flatten_access_trace(bus.accesses),
    ];
}
