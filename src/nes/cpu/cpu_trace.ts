import type { CpuAddressingMode } from "./addressing_modes.js";
import type { CpuBus, CpuBusAccess, CpuOamDmaCycle } from "./cpu_bus.js";
import type { Cpu2A03 } from "./cpu_2a03.js";
import { CPU_OPCODE_TABLE } from "./opcode_table.js";
import type { CpuInstructionMnemonic } from "./opcode_table.js";
import type { CpuRegisters } from "./registers.js";

const CPU_ADDRESS_MASK = 0xffff;
const STACK_PAGE_START = 0x0100;
const STACK_PAGE_END = 0x01ff;
const NMI_VECTOR_LOW = 0xfffa;
const NMI_VECTOR_HIGH = 0xfffb;
const IRQ_VECTOR_LOW = 0xfffe;
const IRQ_VECTOR_HIGH = 0xffff;

export type CpuTraceState = Readonly<CpuRegisters>;

export interface CpuTraceInstruction {
    readonly opcode: number;
    readonly bytes: readonly number[];
    readonly mnemonic: CpuInstructionMnemonic;
    readonly addressing_mode: CpuAddressingMode;
}

interface CpuStepTraceBase {
    readonly cycle_start: number;
    readonly cycles: number;
    readonly registers_before: CpuTraceState;
    readonly registers_after: CpuTraceState;
    readonly bus_accesses: readonly CpuBusAccess[];
    readonly dma_accesses?: readonly CpuBusAccess[];
}

export type CpuStepTrace =
    | (CpuStepTraceBase & { readonly kind: "instruction"; readonly instruction: CpuTraceInstruction })
    | (CpuStepTraceBase & { readonly kind: "irq" | "nmi" });

/** CPU bus wrapper that records normal and DMA reads/writes separately without changing bus results. */
export class CpuTraceBus implements CpuBus {
    readonly #accesses: CpuBusAccess[] = [];
    readonly #dma_accesses: CpuBusAccess[] = [];

    constructor(readonly inner_bus: CpuBus) {}

    get accesses(): readonly CpuBusAccess[] {
        return this.#accesses;
    }

    get dma_accesses(): readonly CpuBusAccess[] {
        return this.#dma_accesses;
    }

    read_cpu(address: number): number {
        const value = this.inner_bus.read_cpu(address);
        this.#accesses.push({ kind: "read", address, value });

        return value;
    }

    write_cpu(address: number, value: number): void {
        this.inner_bus.write_cpu(address, value);
        this.#accesses.push({ kind: "write", address, value });
    }

    clock_cpu_dma_cycle(held_read_address: number): CpuOamDmaCycle | null {
        const dma_cycle =
            this.inner_bus.clock_cpu_dma_cycle !== undefined
                ? this.inner_bus.clock_cpu_dma_cycle(held_read_address)
                : (this.inner_bus.clock_oam_dma_cycle?.(held_read_address) ?? null);

        if (dma_cycle !== null) {
            this.#dma_accesses.push({ ...dma_cycle.access });
        }

        return dma_cycle;
    }

    clock_oam_dma_cycle(held_read_address: number): CpuOamDmaCycle | null {
        return this.clock_cpu_dma_cycle(held_read_address);
    }

    clear_trace(): void {
        this.#accesses.length = 0;
        this.#dma_accesses.length = 0;
    }
}

/** Captures optional instruction-level CPU state and ordered bus traces. */
export class CpuStepTraceRecorder {
    #elapsed_cpu_cycles = 0;

    constructor(
        readonly cpu: Cpu2A03,
        readonly bus: CpuTraceBus,
    ) {
        if (cpu.bus !== bus) {
            throw new TypeError("The CPU must execute through the trace bus passed to its recorder.");
        }
    }

    get elapsed_cpu_cycles(): number {
        return this.#elapsed_cpu_cycles;
    }

    /** Executes one CPU step and returns its state snapshots, cycle count, and ordered bus accesses. */
    step(): CpuStepTrace {
        this.bus.clear_trace();
        const registers_before = snapshot_registers(this.cpu);
        const cycle_start = this.#elapsed_cpu_cycles;
        const cycles = this.cpu.step();
        const registers_after = snapshot_registers(this.cpu);
        const bus_accesses = this.bus.accesses.map((access) => ({ ...access }));
        const dma_accesses = this.bus.dma_accesses.map((access) => ({ ...access }));
        this.#elapsed_cpu_cycles += cycles;

        const interrupt_kind = identify_hardware_interrupt(registers_before.program_counter, bus_accesses);
        const common_trace = {
            cycle_start,
            cycles,
            registers_before,
            registers_after,
            bus_accesses,
            ...(dma_accesses.length > 0 ? { dma_accesses } : {}),
        };

        if (interrupt_kind !== undefined) {
            return { ...common_trace, kind: interrupt_kind };
        }

        const opcode_access = bus_accesses[0];

        if (
            opcode_access === undefined ||
            opcode_access.kind !== "read" ||
            opcode_access.address !== registers_before.program_counter
        ) {
            throw new Error("The CPU step trace did not begin with an opcode fetch or hardware interrupt.");
        }

        const definition = CPU_OPCODE_TABLE.get(opcode_access.value);

        if (definition === undefined) {
            throw new Error(`No opcode metadata exists for traced opcode $${opcode_access.value.toString(16)}.`);
        }

        const instruction: CpuTraceInstruction = {
            opcode: opcode_access.value,
            bytes: collect_instruction_bytes(
                registers_before.program_counter,
                definition.addressing_mode,
                bus_accesses,
            ),
            mnemonic: definition.mnemonic,
            addressing_mode: definition.addressing_mode,
        };

        return { ...common_trace, kind: "instruction", instruction };
    }
}

/** Formats one trace as an ASCII line suitable for logs and golden-file comparisons. */
export function format_cpu_step_trace(trace: CpuStepTrace): string {
    const registers = trace.registers_before;
    const step_label =
        trace.kind === "instruction"
            ? `${trace.instruction.mnemonic} [${trace.instruction.bytes.map(format_byte).join(" ")}]`
            : trace.kind.toUpperCase();
    const format_access = (access: CpuBusAccess): string => {
        const kind = access.kind === "read" ? "R" : "W";

        return `${kind}:$${format_address(access.address)}=$${format_byte(access.value)}`;
    };
    const bus_accesses = trace.bus_accesses.map(format_access).join(" ");
    const dma_summary =
        trace.dma_accesses === undefined
            ? undefined
            : `| DMA (${trace.dma_accesses.length} cycles): ${trace.dma_accesses.map(format_access).join(" ")}`;

    return [
        trace.cycle_start.toString().padStart(8, "0"),
        `PC=$${format_address(registers.program_counter)}`,
        `A=$${format_byte(registers.a)}`,
        `X=$${format_byte(registers.x)}`,
        `Y=$${format_byte(registers.y)}`,
        `P=$${format_byte(registers.status)}`,
        `SP=$${format_byte(registers.stack_pointer)}`,
        `| ${step_label}`,
        `| ${trace.cycles} CPU cycles`,
        ...(dma_summary === undefined ? [] : [dma_summary]),
        `| ${bus_accesses}`,
    ].join(" ");
}

function snapshot_registers(cpu: Cpu2A03): CpuTraceState {
    return {
        a: cpu.a,
        x: cpu.x,
        y: cpu.y,
        stack_pointer: cpu.stack_pointer,
        program_counter: cpu.program_counter,
        status: cpu.status,
    };
}

function identify_hardware_interrupt(
    program_counter: number,
    accesses: readonly CpuBusAccess[],
): "irq" | "nmi" | undefined {
    const first_access = accesses[0];
    const second_access = accesses[1];

    if (
        first_access?.kind !== "read" ||
        second_access?.kind !== "read" ||
        first_access.address !== program_counter ||
        second_access.address !== program_counter ||
        accesses.length !== 7
    ) {
        return undefined;
    }

    for (const access of accesses.slice(2, 5)) {
        if (access.kind !== "write" || access.address < STACK_PAGE_START || access.address > STACK_PAGE_END) {
            return undefined;
        }
    }

    const vector_low = accesses[5];
    const vector_high = accesses[6];

    if (vector_low?.kind !== "read" || vector_high?.kind !== "read") {
        return undefined;
    }

    if (vector_low.address === NMI_VECTOR_LOW && vector_high.address === NMI_VECTOR_HIGH) {
        return "nmi";
    }

    if (vector_low.address === IRQ_VECTOR_LOW && vector_high.address === IRQ_VECTOR_HIGH) {
        return "irq";
    }

    return undefined;
}

function collect_instruction_bytes(
    program_counter: number,
    addressing_mode: CpuAddressingMode,
    accesses: readonly CpuBusAccess[],
): number[] {
    const length = instruction_length(addressing_mode);
    const opcode_access = accesses[0];
    const bytes = opcode_access?.kind === "read" ? [opcode_access.value] : [];

    for (let offset = 1; offset < length; offset += 1) {
        const address = (program_counter + offset) & CPU_ADDRESS_MASK;
        const operand_access = accesses.find(
            (access, index) => index > 0 && access.kind === "read" && access.address === address,
        );

        if (operand_access === undefined) {
            break;
        }

        bytes.push(operand_access.value);
    }

    return bytes;
}

function instruction_length(addressing_mode: CpuAddressingMode): number {
    switch (addressing_mode) {
        case "implied":
        case "accumulator":
            return 1;
        case "immediate":
        case "relative":
        case "zero_page":
        case "zero_page_x":
        case "zero_page_y":
        case "indexed_indirect":
        case "indirect_indexed":
            return 2;
        case "absolute":
        case "absolute_x":
        case "absolute_y":
        case "indirect":
            return 3;
    }
}

function format_byte(value: number): string {
    return value.toString(16).toUpperCase().padStart(2, "0");
}

function format_address(value: number): string {
    return value.toString(16).toUpperCase().padStart(4, "0");
}
