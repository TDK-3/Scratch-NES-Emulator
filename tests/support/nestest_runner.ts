import { parse_ines_rom } from "../../src/nes/cartridge/ines.js";
import type { CpuStepTrace } from "../../src/nes/cpu/cpu_trace.js";
import { CpuTraceBus, CpuStepTraceRecorder } from "../../src/nes/cpu/cpu_trace.js";
import { Cpu2A03 } from "../../src/nes/cpu/cpu_2a03.js";
import { INTERRUPT_DISABLE_FLAG, UNUSED_FLAG } from "../../src/nes/cpu/registers.js";
import { NromTestBus } from "./NromTestBus.js";

const NESTEST_START_PC = 0xc000;
const NESTEST_START_SP = 0xfd;
const NESTEST_START_STATUS = UNUSED_FLAG | INTERRUPT_DISABLE_FLAG;
const NESTEST_INITIAL_CYCLES = 7; // The reference log starts after the seven-cycle reset sequence.

export interface NestestLogEntry {
    readonly line_number: number;
    readonly program_counter: number;
    readonly bytes: readonly number[];
    readonly a: number;
    readonly x: number;
    readonly y: number;
    readonly status: number;
    readonly stack_pointer: number;
    readonly cycles: number;
}

export type NestestComparisonResult =
    | {
          readonly ok: true;
          readonly matched_entries: number;
          readonly total_entries: number;
          readonly step_limit: number;
      }
    | {
          readonly ok: false;
          readonly matched_entries: number;
          readonly total_entries: number;
          readonly step_limit: number;
          readonly line_number: number;
          readonly message: string;
      };

/** Builds a headless NROM CPU runner initialized at nestest's documented automation entry point. */
export function create_nestest_trace_recorder(rom_bytes: Uint8Array): CpuStepTraceRecorder {
    const result = parse_ines_rom(rom_bytes);

    if (!result.ok) {
        throw new Error(`Invalid nestest ROM: ${result.error.message}`);
    }

    if (result.value.mapper_id !== 0) {
        throw new Error(`nestest trace comparison requires mapper 0, not mapper ${result.value.mapper_id}.`);
    }

    const bus = new CpuTraceBus(new NromTestBus(result.value.prg_rom));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = NESTEST_START_PC;
    cpu.stack_pointer = NESTEST_START_SP;
    cpu.status = NESTEST_START_STATUS;

    return new CpuStepTraceRecorder(cpu, bus);
}

/** Parses one line from the Nintendulator nestest execution log. */
export function parse_nestest_log_line(line: string, line_number: number): NestestLogEntry {
    const program_counter_field = line.slice(0, 4);
    const raw_bytes: string[] = [];

    for (const field of line.slice(6).trim().split(/\s+/)) {
        if (!/^[0-9A-Fa-f]{2}$/.test(field)) {
            break;
        }

        raw_bytes.push(field);
    }

    const registers = line.match(
        /\bA:([0-9A-Fa-f]{2})\s+X:([0-9A-Fa-f]{2})\s+Y:([0-9A-Fa-f]{2})\s+P:([0-9A-Fa-f]{2})\s+SP:([0-9A-Fa-f]{2})/,
    );
    const cycles = line.match(/\bCYC:(\d+)\b/);

    if (!/^[0-9A-Fa-f]{4}$/.test(program_counter_field)) {
        throw new SyntaxError(`Invalid program counter in nestest log line ${line_number}.`);
    }

    if (raw_bytes.length < 1 || raw_bytes.length > 3 || raw_bytes.some((value) => !/^[0-9A-Fa-f]{2}$/.test(value))) {
        throw new SyntaxError(`Invalid instruction bytes in nestest log line ${line_number}.`);
    }

    if (registers === null || cycles === null) {
        throw new SyntaxError(`Missing CPU state or cycle count in nestest log line ${line_number}.`);
    }

    const [a, x, y, status, stack_pointer] = registers.slice(1).map((value) => Number.parseInt(value, 16));

    if (
        a === undefined ||
        x === undefined ||
        y === undefined ||
        status === undefined ||
        stack_pointer === undefined
    ) {
        throw new SyntaxError(`Incomplete CPU state in nestest log line ${line_number}.`);
    }

    return {
        line_number,
        program_counter: Number.parseInt(program_counter_field, 16),
        bytes: raw_bytes.map((value) => Number.parseInt(value, 16)),
        a,
        x,
        y,
        status,
        stack_pointer,
        cycles: Number.parseInt(cycles[1] ?? "", 10),
    };
}

/** Compares CPU steps with log entries, optionally limiting the number of entries to check. */
export function compare_nestest_trace(
    recorder: CpuStepTraceRecorder,
    log_lines: readonly string[],
    requested_step_limit = Number.MAX_SAFE_INTEGER,
): NestestComparisonResult {
    if (!Number.isSafeInteger(requested_step_limit) || requested_step_limit < 1) {
        throw new RangeError("The nestest step limit must be a positive safe integer.");
    }

    const entries = log_lines
        .map((line, index) => ({ line: line.trim(), line_number: index + 1 }))
        .filter(({ line }) => line.length > 0)
        .map(({ line, line_number }) => parse_nestest_log_line(line, line_number));
    if (entries.length === 0) {
        throw new SyntaxError("The nestest log does not contain any instruction entries.");
    }

    const step_limit = Math.min(requested_step_limit, entries.length);

    for (let index = 0; index < step_limit; index += 1) {
        const expected = entries[index];

        if (expected === undefined) {
            throw new Error(`Nestest log entry ${index + 1} disappeared during comparison.`);
        }

        let actual: CpuStepTrace;

        try {
            actual = recorder.step();
        } catch (error) {
            const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

            return {
                ok: false,
                matched_entries: index,
                total_entries: entries.length,
                step_limit,
                line_number: expected.line_number,
                message: `CPU execution failed: ${message}`,
            };
        }

        const mismatch = compare_nestest_entry(expected, actual);

        if (mismatch !== undefined) {
            return {
                ok: false,
                matched_entries: index,
                total_entries: entries.length,
                step_limit,
                line_number: expected.line_number,
                message: mismatch,
            };
        }
    }

    return {
        ok: true,
        matched_entries: step_limit,
        total_entries: entries.length,
        step_limit,
    };
}

function compare_nestest_entry(expected: NestestLogEntry, actual: CpuStepTrace): string | undefined {
    if (actual.kind !== "instruction") {
        return `Expected an instruction, received ${actual.kind} entry.`;
    }

    const actual_registers = actual.registers_before;
    const actual_cycles = NESTEST_INITIAL_CYCLES + actual.cycle_start;
    const fields: Array<[string, number, number]> = [
        ["PC", expected.program_counter, actual_registers.program_counter],
        ["A", expected.a, actual_registers.a],
        ["X", expected.x, actual_registers.x],
        ["Y", expected.y, actual_registers.y],
        ["P", expected.status, actual_registers.status],
        ["SP", expected.stack_pointer, actual_registers.stack_pointer],
        ["CYC", expected.cycles, actual_cycles],
    ];

    for (const [name, expected_value, actual_value] of fields) {
        if (expected_value !== actual_value) {
            const expected_text = format_comparison_value(name, expected_value);
            const actual_text = format_comparison_value(name, actual_value);

            return `${name} mismatch: expected ${expected_text}, got ${actual_text}.`;
        }
    }

    if (expected.bytes.length !== actual.instruction.bytes.length) {
        return `Instruction length mismatch: expected ${format_bytes(expected.bytes)}, ` +
            `got ${format_bytes(actual.instruction.bytes)}.`;
    }

    for (let index = 0; index < expected.bytes.length; index += 1) {
        const expected_byte = expected.bytes[index];
        const actual_byte = actual.instruction.bytes[index];

        if (expected_byte !== actual_byte) {
            return `Instruction byte ${index + 1} mismatch: expected $${format_value(expected_byte ?? 0)}, ` +
                `got $${format_value(actual_byte ?? 0)}.`;
        }
    }

    return undefined;
}

function format_comparison_value(name: string, value: number): string {
    return name === "CYC" ? value.toString(10) : `$${format_value(value)}`;
}

function format_bytes(bytes: readonly number[]): string {
    return bytes.map(format_value).join(" ");
}

function format_value(value: number): string {
    return value.toString(16).toUpperCase().padStart(2, "0");
}
