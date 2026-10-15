import { add_with_carry, subtract_with_carry } from "./alu.js";
import type { CpuAddressingMode, CpuOperandAccess, ResolvedCpuOperand } from "./addressing_modes.js";
import { CPU_OPCODE_TABLE } from "./opcode_table.js";
import type { CpuInstructionMnemonic } from "./opcode_table.js";
import {
    CARRY_FLAG,
    DECIMAL_FLAG,
    INTERRUPT_DISABLE_FLAG,
    NEGATIVE_FLAG,
    OVERFLOW_FLAG,
    UNUSED_FLAG,
    ZERO_FLAG,
    has_status_flag,
    normalize_byte,
    normalize_status,
    normalize_word,
    pack_status_for_stack,
    set_status_flag,
    to_signed_byte,
    unpack_status_from_stack,
    update_zero_negative_flags,
} from "./registers.js";
import type { CpuBus, CpuBusAccess } from "./cpu_bus.js";
import type { CpuRegisters, StatusStackSource } from "./registers.js";

export const CPU_RESET_CYCLES = 7;
export const CPU_INTERRUPT_CYCLES = 7;

const STACK_PAGE = 0x0100;
const RESET_VECTOR_LOW = 0xfffc;
const RESET_VECTOR_HIGH = 0xfffd;
const NMI_VECTOR_LOW = 0xfffa;
const NMI_VECTOR_HIGH = 0xfffb;
const IRQ_BRK_VECTOR_LOW = 0xfffe;
const IRQ_BRK_VECTOR_HIGH = 0xffff;
const BYTE_MASK = 0x00ff;
const PAGE_MASK = 0xff00;

type CpuCycleRequest =
    | {
          readonly kind: "read";
          readonly address: number;
          readonly unstable_store_dummy_read: boolean;
      }
    | { readonly kind: "write"; readonly address: number; readonly value: number };

type CpuCycleGenerator<Result = void> = Generator<CpuCycleRequest, Result, number | undefined>;

export type CpuCycleSequenceKind = "instruction" | "irq" | "jam" | "nmi" | "reset" | "dma";

/** Default deterministic approximation for the analog magic input of XAA/LXA. */
export const DEFAULT_UNSTABLE_OPCODE_MAGIC_VALUE = 0xee;

export interface Cpu2A03Options {
    /** Chip-dependent magic input used by the highly unstable XAA/LXA opcodes; defaults to `$EE`. */
    readonly unstable_opcode_magic_value?: number;
}

/** Result of one CPU cycle; sequence_cycle is 1-based within its instruction, interrupt, reset, jam, or DMA. */
export interface CpuCycleResult {
    readonly sequence_kind: CpuCycleSequenceKind;
    readonly sequence_cycle: number;
    readonly sequence_completed: boolean;
    readonly access: CpuBusAccess;
}

/** Cycle-visible 2A03 core for all opcode bytes, reset, and interrupts; unstable opcode behavior is approximated. */
export class Cpu2A03 implements CpuRegisters {
    a = 0;
    x = 0;
    y = 0;
    stack_pointer = 0;
    program_counter = 0;
    status = UNUSED_FLAG;
    private irq_line_asserted = false;
    private nmi_pending = false;
    private jammed = false;
    private irq_poll_mask_override: boolean | undefined = undefined;
    private cycle_generator: CpuCycleGenerator | undefined = undefined;
    private next_cycle_request: CpuCycleRequest | undefined = undefined;
    private sequence_kind: CpuCycleSequenceKind | undefined = undefined;
    private sequence_cycle = 0;
    private unstable_store_data_mask_dropped = false;
    private readonly unstable_opcode_magic_value: number;

    constructor(readonly bus: CpuBus, options: Cpu2A03Options = {}) {
        const magic_value = options.unstable_opcode_magic_value ?? DEFAULT_UNSTABLE_OPCODE_MAGIC_VALUE;

        if (!Number.isInteger(magic_value) || magic_value < 0 || magic_value > 0xff) {
            throw new RangeError("The unstable opcode magic value must be an integer from 0 through 255.");
        }

        this.unstable_opcode_magic_value = magic_value;
    }

    /** Starts reset without consuming CPU cycles; use clock_cycle() to expose all seven bus accesses. */
    request_reset(): void {
        this.jammed = false;
        this.nmi_pending = false;
        this.irq_poll_mask_override = undefined;
        this.program_counter = normalize_word(this.program_counter);
        this.stack_pointer = normalize_byte(this.stack_pointer);
        this.status = normalize_status(this.status);
        this.cancel_cycle_sequence();
        this.begin_sequence("reset", this.execute_reset_cycles());
    }

    /** Runs reset synchronously and returns the number of CPU cycles consumed. */
    reset(): number {
        this.request_reset();
        return this.run_current_sequence();
    }

    /** Sets the level-sensitive external IRQ input. */
    set_irq_line(asserted: boolean): void {
        this.irq_line_asserted = asserted;
    }

    /** Latches an external NMI rising edge until the CPU accepts it. */
    request_nmi(): void {
        this.nmi_pending = true;
    }

    /** Executes exactly one CPU cycle and one CPU-bus transaction, including an active DMA stall cycle. */
    clock_cycle(): CpuCycleResult {
        const held_read_address = this.next_cycle_request?.kind === "read"
            ? this.next_cycle_request.address
            : this.cycle_generator === undefined
              ? this.program_counter
              : undefined;

        if (held_read_address !== undefined) {
            const dma_cycle =
                this.bus.clock_cpu_dma_cycle !== undefined
                    ? this.bus.clock_cpu_dma_cycle(held_read_address)
                    : this.bus.clock_oam_dma_cycle?.(held_read_address);

            if (dma_cycle !== null && dma_cycle !== undefined) {
                if (
                    dma_cycle.dma_kind === "dmc" &&
                    this.next_cycle_request?.kind === "read" &&
                    this.next_cycle_request.unstable_store_dummy_read
                ) {
                    this.unstable_store_data_mask_dropped = true;
                }

                return {
                    sequence_kind: "dma",
                    sequence_cycle: dma_cycle.sequence_cycle,
                    sequence_completed: dma_cycle.sequence_completed,
                    access: dma_cycle.access,
                };
            }
        }

        if (this.cycle_generator === undefined) {
            this.begin_next_sequence();
        }

        const request = this.next_cycle_request;
        const sequence_kind = this.sequence_kind;

        if (request === undefined || sequence_kind === undefined) {
            throw new Error("The CPU cycle sequencer did not produce a bus request.");
        }

        let access: CpuBusAccess;
        let read_value: number | undefined;

        if (request.kind === "read") {
            read_value = this.bus.read_cpu(request.address);
            access = { kind: "read", address: request.address, value: read_value };
        } else {
            this.bus.write_cpu(request.address, request.value);
            access = { kind: "write", address: request.address, value: request.value };
        }

        const cycle_number = this.sequence_cycle + 1;
        const sequence_completed = this.resume_cycle_generator(read_value);

        if (sequence_completed) {
            this.sequence_kind = undefined;
            this.sequence_cycle = 0;
        } else {
            this.sequence_cycle = cycle_number;
        }

        return {
            sequence_kind,
            sequence_cycle: cycle_number,
            sequence_completed,
            access,
        };
    }

    /** Executes the next instruction/interrupt/reset/jam sequence, including any pending DMA stalls. */
    step(): number {
        return this.run_current_sequence();
    }

    private run_current_sequence(): number {
        let cycles = 0;
        let result: CpuCycleResult;

        do {
            result = this.clock_cycle();
            cycles += 1;
        } while (result.sequence_kind === "dma" || !result.sequence_completed);

        return cycles;
    }

    private begin_next_sequence(): void {
        if (this.jammed) {
            this.begin_sequence("jam", this.execute_jammed_cycles());
            return;
        }

        const interrupt_disabled_before = has_status_flag(this.status, INTERRUPT_DISABLE_FLAG);
        const interrupt_disabled_for_poll = this.irq_poll_mask_override ?? interrupt_disabled_before;

        if (this.nmi_pending) {
            this.nmi_pending = false;
            this.irq_poll_mask_override = undefined;
            this.begin_sequence("nmi", this.execute_hardware_interrupt_cycles("nmi"));
            return;
        }

        if (this.irq_line_asserted && !interrupt_disabled_for_poll) {
            this.irq_poll_mask_override = undefined;
            this.begin_sequence("irq", this.execute_hardware_interrupt_cycles("irq"));
            return;
        }

        this.irq_poll_mask_override = undefined;
        this.begin_sequence("instruction", this.execute_instruction_cycles(interrupt_disabled_before));
    }

    private begin_sequence(kind: CpuCycleSequenceKind, generator: CpuCycleGenerator): void {
        this.cycle_generator = generator;
        this.sequence_kind = kind;
        this.sequence_cycle = 0;

        try {
            const first_request = generator.next();

            if (first_request.done) {
                throw new Error("A CPU execution sequence finished without a bus cycle.");
            }

            this.next_cycle_request = first_request.value;
        } catch (error) {
            this.cancel_cycle_sequence();
            throw error;
        }
    }

    private resume_cycle_generator(value: number | undefined): boolean {
        const generator = this.cycle_generator;

        if (generator === undefined) {
            throw new Error("Cannot resume an inactive CPU cycle sequence.");
        }

        try {
            const next_request = generator.next(value);

            if (next_request.done) {
                this.cycle_generator = undefined;
                this.next_cycle_request = undefined;
                return true;
            }

            this.next_cycle_request = next_request.value;
            return false;
        } catch (error) {
            this.cancel_cycle_sequence();
            throw error;
        }
    }

    private cancel_cycle_sequence(): void {
        this.cycle_generator = undefined;
        this.next_cycle_request = undefined;
        this.sequence_kind = undefined;
        this.sequence_cycle = 0;
    }

    /**
     * Emulator convention for a jammed 2A03: keep the PC at the KIL byte and repeat its two reads.
     * The lock-until-reset behavior is documented; the exact external bus pattern is not hardware-verified.
     */
    private *execute_jammed_cycles(): CpuCycleGenerator {
        const jam_address = this.program_counter;
        yield* this.read_cycle(jam_address);
        yield* this.read_cycle(normalize_word(jam_address + 1));
    }

    private *execute_reset_cycles(): CpuCycleGenerator {
        yield* this.read_cycle(this.program_counter);
        yield* this.read_cycle(this.program_counter);

        for (let index = 0; index < 3; index += 1) {
            yield* this.read_cycle(STACK_PAGE | this.stack_pointer);
            this.stack_pointer = normalize_byte(this.stack_pointer - 1);
        }

        const vector_low = yield* this.read_cycle(RESET_VECTOR_LOW);
        const vector_high = yield* this.read_cycle(RESET_VECTOR_HIGH);
        this.program_counter = normalize_word(vector_low | (vector_high << 8));
        this.status = set_status_flag(this.status, INTERRUPT_DISABLE_FLAG, true);
    }

    private *execute_instruction_cycles(interrupt_disabled_before: boolean): CpuCycleGenerator {
        this.unstable_store_data_mask_dropped = false;
        const opcode = yield* this.fetch_byte_cycle();
        const definition = CPU_OPCODE_TABLE.get(opcode);

        if (definition === undefined) {
            throw new RangeError(`Unsupported 2A03 opcode $${opcode.toString(16).padStart(2, "0")}.`);
        }

        switch (definition.mnemonic) {
            case "KIL":
                yield* this.read_cycle(this.program_counter);
                this.program_counter = normalize_word(this.program_counter - 1);
                this.jammed = true;
                break;
            case "BRK":
                yield* this.execute_brk_cycles();
                break;
            case "JSR":
                yield* this.execute_jsr_cycles();
                break;
            case "RTI":
                yield* this.execute_rti_cycles();
                break;
            case "RTS":
                yield* this.execute_rts_cycles();
                break;
            case "PHA":
                yield* this.read_cycle(this.program_counter);
                yield* this.push_byte_cycle(this.a);
                break;
            case "PHP":
                yield* this.read_cycle(this.program_counter);
                yield* this.push_status_cycle("brk");
                break;
            case "PLA": {
                yield* this.read_cycle(this.program_counter);
                yield* this.read_cycle(STACK_PAGE | this.stack_pointer);
                this.a = yield* this.pop_byte_cycle();
                this.status = update_zero_negative_flags(this.status, this.a);
                break;
            }
            case "PLP":
                yield* this.read_cycle(this.program_counter);
                yield* this.read_cycle(STACK_PAGE | this.stack_pointer);
                this.restore_status_from_stack(yield* this.pop_byte_cycle());
                break;
            case "JMP": {
                const operand = yield* this.resolve_addressing_mode_cycles(definition.addressing_mode);

                if (operand.kind !== "memory" && operand.kind !== "jump_target") {
                    throw new Error("JMP must resolve to an address.");
                }

                this.program_counter = operand.address;
                break;
            }
            case "BCC":
            case "BCS":
            case "BEQ":
            case "BMI":
            case "BNE":
            case "BPL":
            case "BVC":
            case "BVS": {
                const operand = yield* this.resolve_addressing_mode_cycles("relative");
                const taken = this.branch_condition(definition.mnemonic);
                yield* this.apply_relative_branch_cycles(operand, taken);
                break;
            }
            default: {
                const is_unstable_high_byte_store =
                    definition.mnemonic === "AHX" ||
                    definition.mnemonic === "SHX" ||
                    definition.mnemonic === "SHY" ||
                    definition.mnemonic === "TAS";
                const operand = yield* this.resolve_addressing_mode_cycles(
                    definition.addressing_mode,
                    definition.operand_access,
                    is_unstable_high_byte_store,
                );

                if (definition.addressing_mode === "implied" || definition.addressing_mode === "accumulator") {
                    yield* this.read_cycle(this.program_counter);
                }

                yield* this.execute_regular_instruction_cycles(definition.mnemonic, operand);
                break;
            }
        }

        this.finish_instruction(definition.mnemonic, interrupt_disabled_before);
    }

    private *resolve_addressing_mode_cycles(
        mode: CpuAddressingMode,
        access: CpuOperandAccess = "read",
        unstable_store = false,
    ): CpuCycleGenerator<ResolvedCpuOperand> {
        assert_allowed_access(mode, access);

        switch (mode) {
            case "implied":
                return { kind: "implied", mode };
            case "accumulator":
                if (access === "write") {
                    throw new TypeError("Accumulator addressing only supports reads and read-modify-write operations.");
                }

                return { kind: "accumulator", mode, access };
            case "immediate":
                return { kind: "immediate", mode, value: yield* this.fetch_byte_cycle() };
            case "relative": {
                const offset = to_signed_byte(yield* this.fetch_byte_cycle());
                const origin_address = this.program_counter;
                const target_address = normalize_word(origin_address + offset);

                return {
                    kind: "relative",
                    mode,
                    offset,
                    origin_address,
                    target_address,
                    page_crossed: page_crossed(origin_address, target_address),
                };
            }
            case "zero_page": {
                const address = yield* this.fetch_byte_cycle();
                return memory_operand(mode, access, address, address, false);
            }
            case "zero_page_x":
            case "zero_page_y": {
                const base_address = yield* this.fetch_byte_cycle();
                const index = mode === "zero_page_x" ? normalize_byte(this.x) : normalize_byte(this.y);
                yield* this.read_cycle(base_address);
                const address = normalize_byte(base_address + index);

                return memory_operand(mode, access, base_address, address, false);
            }
            case "absolute": {
                const address = yield* this.fetch_word_cycle();
                return memory_operand(mode, access, address, address, false);
            }
            case "absolute_x":
            case "absolute_y": {
                const base_address = yield* this.fetch_word_cycle();
                const index = mode === "absolute_x" ? normalize_byte(this.x) : normalize_byte(this.y);
                const address = normalize_word(base_address + index);
                const crossed = page_crossed(base_address, address);

                if (access !== "read" || crossed) {
                    yield* this.read_cycle(
                        indexed_dummy_address(base_address, address),
                        unstable_store,
                    );
                }

                return memory_operand(mode, access, base_address, address, crossed);
            }
            case "indirect": {
                const pointer_address = yield* this.fetch_word_cycle();
                const target_low = yield* this.read_cycle(pointer_address);
                const pointer_high_address =
                    (pointer_address & PAGE_MASK) | ((pointer_address + 1) & BYTE_MASK);
                const target_high = yield* this.read_cycle(pointer_high_address);

                return {
                    kind: "jump_target",
                    mode,
                    address: normalize_word(target_low | (target_high << 8)),
                    pointer_address,
                };
            }
            case "indexed_indirect": {
                const base_address = yield* this.fetch_byte_cycle();
                yield* this.read_cycle(base_address);
                const pointer_address = normalize_byte(base_address + normalize_byte(this.x));
                const target_low = yield* this.read_cycle(pointer_address);
                const target_high = yield* this.read_cycle(normalize_byte(pointer_address + 1));
                const address = normalize_word(target_low | (target_high << 8));

                return memory_operand(mode, access, base_address, address, false);
            }
            case "indirect_indexed": {
                const pointer_address = yield* this.fetch_byte_cycle();
                const base_low = yield* this.read_cycle(pointer_address);
                const base_high = yield* this.read_cycle(normalize_byte(pointer_address + 1));
                const base_address = normalize_word(base_low | (base_high << 8));
                const address = normalize_word(base_address + normalize_byte(this.y));
                const crossed = page_crossed(base_address, address);

                if (access !== "read" || crossed) {
                    yield* this.read_cycle(
                        indexed_dummy_address(base_address, address),
                        unstable_store,
                    );
                }

                return memory_operand(mode, access, base_address, address, crossed);
            }
        }
    }

    private *execute_regular_instruction_cycles(
        mnemonic: CpuInstructionMnemonic,
        operand: ResolvedCpuOperand,
    ): CpuCycleGenerator {
        switch (operand.kind) {
            case "implied":
                this.execute_implied_instruction(mnemonic);
                return;
            case "accumulator":
                this.a = this.modify_value(mnemonic, this.a);
                return;
            case "immediate":
                this.apply_read_instruction(mnemonic, operand.value);
                return;
            case "jump_target":
                throw new Error(`${mnemonic} cannot execute with an indirect jump target.`);
            case "memory":
                switch (operand.access) {
                    case "read":
                        this.apply_read_instruction(mnemonic, yield* this.read_cycle(operand.address));
                        return;
                    case "write": {
                        const store = this.store_target_and_value(mnemonic, operand);
                        yield* this.write_cycle(store.address, store.value);
                        return;
                    }
                    case "read_modify_write": {
                        const original_value = yield* this.read_cycle(operand.address);
                        yield* this.write_cycle(operand.address, original_value);
                        const modified_value = this.modify_value(mnemonic, original_value);
                        yield* this.write_cycle(operand.address, modified_value);
                        return;
                    }
                }
        }
    }

    private apply_read_instruction(mnemonic: CpuInstructionMnemonic, value: number): void {
        switch (mnemonic) {
            case "ORA":
                this.a = normalize_byte(this.a | value);
                this.status = update_zero_negative_flags(this.status, this.a);
                return;
            case "AND":
                this.a = normalize_byte(this.a & value);
                this.status = update_zero_negative_flags(this.status, this.a);
                return;
            case "EOR":
                this.a = normalize_byte(this.a ^ value);
                this.status = update_zero_negative_flags(this.status, this.a);
                return;
            case "ADC": {
                const result = add_with_carry(this.a, value, this.status);
                this.a = result.value;
                this.status = result.status;
                return;
            }
            case "SBC": {
                const result = subtract_with_carry(this.a, value, this.status);
                this.a = result.value;
                this.status = result.status;
                return;
            }
            case "ANC":
                this.a = normalize_byte(this.a & value);
                this.status = update_zero_negative_flags(this.status, this.a);
                this.status = set_status_flag(this.status, CARRY_FLAG, (this.a & NEGATIVE_FLAG) !== 0);
                return;
            case "ALR": {
                const and_result = normalize_byte(this.a & value);
                this.status = set_status_flag(this.status, CARRY_FLAG, (and_result & 0x01) !== 0);
                this.a = and_result >>> 1;
                this.status = update_zero_negative_flags(this.status, this.a);
                return;
            }
            case "ARR": {
                const and_result = normalize_byte(this.a & value);
                const carry_in = has_status_flag(this.status, CARRY_FLAG) ? NEGATIVE_FLAG : 0;
                this.a = normalize_byte((and_result >>> 1) | carry_in);
                this.status = update_zero_negative_flags(this.status, this.a);
                this.status = set_status_flag(this.status, CARRY_FLAG, (this.a & 0x40) !== 0);
                this.status = set_status_flag(
                    this.status,
                    OVERFLOW_FLAG,
                    (((this.a >>> 6) ^ (this.a >>> 5)) & 0x01) !== 0,
                );
                return;
            }
            case "AXS": {
                const and_result = normalize_byte(this.a & this.x);
                this.x = normalize_byte(and_result - value);
                this.status = set_status_flag(this.status, CARRY_FLAG, and_result >= value);
                this.status = update_zero_negative_flags(this.status, this.x);
                return;
            }
            case "LDA":
                this.a = normalize_byte(value);
                this.status = update_zero_negative_flags(this.status, this.a);
                return;
            case "LAX":
                this.a = normalize_byte(value);
                this.x = this.a;
                this.status = update_zero_negative_flags(this.status, this.a);
                return;
            case "XAA":
                this.a = normalize_byte((this.a | this.unstable_opcode_magic_value) & this.x & value);
                this.status = update_zero_negative_flags(this.status, this.a);
                return;
            case "LXA": {
                const result = normalize_byte((this.a | this.unstable_opcode_magic_value) & value);
                this.a = result;
                this.x = result;
                this.status = update_zero_negative_flags(this.status, result);
                return;
            }
            case "LAS": {
                const result = normalize_byte(value & this.stack_pointer);
                this.a = result;
                this.x = result;
                this.stack_pointer = result;
                this.status = update_zero_negative_flags(this.status, result);
                return;
            }
            case "LDX":
                this.x = normalize_byte(value);
                this.status = update_zero_negative_flags(this.status, this.x);
                return;
            case "LDY":
                this.y = normalize_byte(value);
                this.status = update_zero_negative_flags(this.status, this.y);
                return;
            case "CMP":
                this.compare_register(this.a, value);
                return;
            case "CPX":
                this.compare_register(this.x, value);
                return;
            case "CPY":
                this.compare_register(this.y, value);
                return;
            case "BIT":
                this.status = set_status_flag(this.status, ZERO_FLAG, (this.a & value) === 0);
                this.status = set_status_flag(this.status, OVERFLOW_FLAG, (value & OVERFLOW_FLAG) !== 0);
                this.status = set_status_flag(this.status, NEGATIVE_FLAG, (value & NEGATIVE_FLAG) !== 0);
                return;
            case "NOP":
                return;
            default:
                throw new Error(`${mnemonic} does not read an operand.`);
        }
    }

    private execute_implied_instruction(mnemonic: CpuInstructionMnemonic): void {
        switch (mnemonic) {
            case "INX":
                this.x = normalize_byte(this.x + 1);
                this.status = update_zero_negative_flags(this.status, this.x);
                return;
            case "INY":
                this.y = normalize_byte(this.y + 1);
                this.status = update_zero_negative_flags(this.status, this.y);
                return;
            case "DEX":
                this.x = normalize_byte(this.x - 1);
                this.status = update_zero_negative_flags(this.status, this.x);
                return;
            case "DEY":
                this.y = normalize_byte(this.y - 1);
                this.status = update_zero_negative_flags(this.status, this.y);
                return;
            case "TAX":
                this.x = normalize_byte(this.a);
                this.status = update_zero_negative_flags(this.status, this.x);
                return;
            case "TAY":
                this.y = normalize_byte(this.a);
                this.status = update_zero_negative_flags(this.status, this.y);
                return;
            case "TSX":
                this.x = normalize_byte(this.stack_pointer);
                this.status = update_zero_negative_flags(this.status, this.x);
                return;
            case "TXA":
                this.a = normalize_byte(this.x);
                this.status = update_zero_negative_flags(this.status, this.a);
                return;
            case "TXS":
                this.stack_pointer = normalize_byte(this.x);
                return;
            case "TYA":
                this.a = normalize_byte(this.y);
                this.status = update_zero_negative_flags(this.status, this.a);
                return;
            case "CLC":
                this.status = set_status_flag(this.status, CARRY_FLAG, false);
                return;
            case "CLD":
                this.status = set_status_flag(this.status, DECIMAL_FLAG, false);
                return;
            case "CLI":
                this.status = set_status_flag(this.status, INTERRUPT_DISABLE_FLAG, false);
                return;
            case "CLV":
                this.status = set_status_flag(this.status, OVERFLOW_FLAG, false);
                return;
            case "SEC":
                this.status = set_status_flag(this.status, CARRY_FLAG, true);
                return;
            case "SED":
                this.status = set_status_flag(this.status, DECIMAL_FLAG, true);
                return;
            case "SEI":
                this.status = set_status_flag(this.status, INTERRUPT_DISABLE_FLAG, true);
                return;
            case "NOP":
                return;
            default:
                throw new Error(`${mnemonic} is not an implied instruction.`);
        }
    }

    private store_target_and_value(
        mnemonic: CpuInstructionMnemonic,
        operand: Extract<ResolvedCpuOperand, { readonly kind: "memory" }>,
    ): { readonly address: number; readonly value: number } {
        switch (mnemonic) {
            case "SHX":
                return this.high_byte_store(operand, this.x);
            case "SHY":
                return this.high_byte_store(operand, this.y);
            case "AHX":
                return this.high_byte_store(operand, this.a & this.x);
            case "TAS":
                this.stack_pointer = normalize_byte(this.a & this.x);
                return this.high_byte_store(operand, this.stack_pointer);
            case "STA":
                return { address: operand.address, value: this.a };
            case "STX":
                return { address: operand.address, value: this.x };
            case "STY":
                return { address: operand.address, value: this.y };
            case "SAX":
                return { address: operand.address, value: normalize_byte(this.a & this.x) };
            default:
                throw new Error(`${mnemonic} does not store a register.`);
        }
    }

    /** Models unstable-store masking, including DMC mask dropout on the marked dummy-read cycle. */
    private high_byte_store(
        operand: Extract<ResolvedCpuOperand, { readonly kind: "memory" }>,
        source_register: number,
    ): { readonly address: number; readonly value: number } {
        const high_byte_mask = normalize_byte((operand.base_address >>> 8) + 1);
        const address_high_byte = normalize_byte(source_register & high_byte_mask);
        const value = this.unstable_store_data_mask_dropped
            ? normalize_byte(source_register)
            : address_high_byte;
        const address = operand.page_crossed
            ? normalize_word((address_high_byte << 8) | (operand.address & BYTE_MASK))
            : operand.address;

        return { address, value };
    }

    private modify_value(mnemonic: CpuInstructionMnemonic, value: number): number {
        switch (mnemonic) {
            case "ASL":
            case "LSR":
            case "ROL":
            case "ROR":
                return this.shift_rotate(mnemonic, value);
            case "SLO": {
                const result = this.shift_rotate("ASL", value);
                this.a = normalize_byte(this.a | result);
                this.status = update_zero_negative_flags(this.status, this.a);
                return result;
            }
            case "RLA": {
                const result = this.shift_rotate("ROL", value);
                this.a = normalize_byte(this.a & result);
                this.status = update_zero_negative_flags(this.status, this.a);
                return result;
            }
            case "SRE": {
                const result = this.shift_rotate("LSR", value);
                this.a = normalize_byte(this.a ^ result);
                this.status = update_zero_negative_flags(this.status, this.a);
                return result;
            }
            case "RRA": {
                const result = this.shift_rotate("ROR", value);
                const arithmetic = add_with_carry(this.a, result, this.status);
                this.a = arithmetic.value;
                this.status = arithmetic.status;
                return result;
            }
            case "DCP": {
                const result = normalize_byte(value - 1);
                this.compare_register(this.a, result);
                return result;
            }
            case "ISC": {
                const result = normalize_byte(value + 1);
                const arithmetic = subtract_with_carry(this.a, result, this.status);
                this.a = arithmetic.value;
                this.status = arithmetic.status;
                return result;
            }
            case "INC":
            case "DEC": {
                const amount = mnemonic === "INC" ? 1 : -1;
                const result = normalize_byte(value + amount);
                this.status = update_zero_negative_flags(this.status, result);
                return result;
            }
            default:
                throw new Error(`${mnemonic} is not a read-modify-write instruction.`);
        }
    }

    private *apply_relative_branch_cycles(operand: ResolvedCpuOperand, taken: boolean): CpuCycleGenerator {
        if (operand.kind !== "relative") {
            throw new TypeError(`${operand.mode} is not a relative branch operand.`);
        }

        if (!taken) {
            return;
        }

        yield* this.read_cycle(operand.origin_address);

        if (operand.page_crossed) {
            yield* this.read_cycle(indexed_dummy_address(operand.origin_address, operand.target_address));
        }

        this.program_counter = operand.target_address;
    }

    private *execute_brk_cycles(): CpuCycleGenerator {
        yield* this.fetch_byte_cycle();
        yield* this.push_word_cycle(this.program_counter);
        yield* this.push_status_cycle("brk");
        this.status = set_status_flag(this.status, INTERRUPT_DISABLE_FLAG, true);

        const vector_low = yield* this.read_cycle(IRQ_BRK_VECTOR_LOW);
        const vector_high = yield* this.read_cycle(IRQ_BRK_VECTOR_HIGH);
        this.program_counter = normalize_word(vector_low | (vector_high << 8));
    }

    private *execute_jsr_cycles(): CpuCycleGenerator {
        const target_low = yield* this.fetch_byte_cycle();
        yield* this.read_cycle(STACK_PAGE | this.stack_pointer);
        yield* this.push_word_cycle(this.program_counter);
        const target_high = yield* this.fetch_byte_cycle();
        this.program_counter = normalize_word(target_low | (target_high << 8));
    }

    private *execute_rti_cycles(): CpuCycleGenerator {
        yield* this.read_cycle(this.program_counter);
        yield* this.read_cycle(STACK_PAGE | this.stack_pointer);
        this.restore_status_from_stack(yield* this.pop_byte_cycle());
        this.program_counter = yield* this.pop_word_cycle();
    }

    private *execute_rts_cycles(): CpuCycleGenerator {
        yield* this.read_cycle(this.program_counter);
        yield* this.read_cycle(STACK_PAGE | this.stack_pointer);
        const return_address = yield* this.pop_word_cycle();
        yield* this.read_cycle(return_address);
        this.program_counter = normalize_word(return_address + 1);
    }

    private *execute_hardware_interrupt_cycles(source: "irq" | "nmi"): CpuCycleGenerator {
        yield* this.read_cycle(this.program_counter);
        yield* this.read_cycle(this.program_counter);
        yield* this.push_word_cycle(this.program_counter);
        yield* this.push_status_cycle(source);
        this.status = set_status_flag(this.status, INTERRUPT_DISABLE_FLAG, true);

        const vector_low_address = source === "nmi" ? NMI_VECTOR_LOW : IRQ_BRK_VECTOR_LOW;
        const vector_high_address = source === "nmi" ? NMI_VECTOR_HIGH : IRQ_BRK_VECTOR_HIGH;
        const vector_low = yield* this.read_cycle(vector_low_address);
        const vector_high = yield* this.read_cycle(vector_high_address);
        this.program_counter = normalize_word(vector_low | (vector_high << 8));
    }

    private *push_byte_cycle(value: number): CpuCycleGenerator {
        yield* this.write_cycle(STACK_PAGE | this.stack_pointer, value);
        this.stack_pointer = normalize_byte(this.stack_pointer - 1);
    }

    private *pop_byte_cycle(): CpuCycleGenerator<number> {
        const next_stack_pointer = normalize_byte(this.stack_pointer + 1);
        const value = yield* this.read_cycle(STACK_PAGE | next_stack_pointer);
        this.stack_pointer = next_stack_pointer;
        return value;
    }

    private *push_word_cycle(value: number): CpuCycleGenerator {
        const word = normalize_word(value);
        yield* this.push_byte_cycle(word >> 8);
        yield* this.push_byte_cycle(word & BYTE_MASK);
    }

    private *pop_word_cycle(): CpuCycleGenerator<number> {
        const low_byte = yield* this.pop_byte_cycle();
        const high_byte = yield* this.pop_byte_cycle();
        return normalize_word(low_byte | (high_byte << 8));
    }

    private *push_status_cycle(source: StatusStackSource): CpuCycleGenerator {
        this.status = normalize_status(this.status);
        yield* this.push_byte_cycle(pack_status_for_stack(this.status, source));
    }

    private *fetch_byte_cycle(): CpuCycleGenerator<number> {
        const address = normalize_word(this.program_counter);
        const value = yield* this.read_cycle(address);
        this.program_counter = normalize_word(address + 1);
        return value;
    }

    private *fetch_word_cycle(): CpuCycleGenerator<number> {
        const low_byte = yield* this.fetch_byte_cycle();
        const high_byte = yield* this.fetch_byte_cycle();
        return normalize_word(low_byte | (high_byte << 8));
    }

    private *read_cycle(
        address: number,
        unstable_store_dummy_read = false,
    ): CpuCycleGenerator<number> {
        const value = yield {
            kind: "read",
            address: normalize_word(address),
            unstable_store_dummy_read,
        };

        if (value === undefined) {
            throw new Error("A CPU read cycle completed without a byte value.");
        }

        return normalize_byte(value);
    }

    private *write_cycle(address: number, value: number): CpuCycleGenerator {
        yield {
            kind: "write",
            address: normalize_word(address),
            value: normalize_byte(value),
        };
    }

    /** Synchronously resolves one mode for focused tests; instruction execution uses clock_cycle(). */
    resolve_addressing_mode(
        mode: CpuAddressingMode,
        access: CpuOperandAccess = "read",
    ): ResolvedCpuOperand {
        assert_allowed_access(mode, access);

        switch (mode) {
            case "implied":
                return { kind: "implied", mode };
            case "accumulator":
                if (access === "write") {
                    throw new TypeError("Accumulator addressing only supports reads and read-modify-write operations.");
                }

                return { kind: "accumulator", mode, access };
            case "immediate":
                return { kind: "immediate", mode, value: this.fetch_byte() };
            case "relative": {
                const offset = to_signed_byte(this.fetch_byte());
                const origin_address = this.program_counter;
                const target_address = normalize_word(origin_address + offset);

                return {
                    kind: "relative",
                    mode,
                    offset,
                    origin_address,
                    target_address,
                    page_crossed: page_crossed(origin_address, target_address),
                };
            }
            case "zero_page": {
                const address = this.fetch_byte();

                return memory_operand(mode, access, address, address, false);
            }
            case "zero_page_x":
            case "zero_page_y": {
                const base_address = this.fetch_byte();
                const index = mode === "zero_page_x" ? normalize_byte(this.x) : normalize_byte(this.y);
                this.bus.read_cpu(base_address);
                const address = normalize_byte(base_address + index);

                return memory_operand(mode, access, base_address, address, false);
            }
            case "absolute": {
                const address = this.fetch_word();

                return memory_operand(mode, access, address, address, false);
            }
            case "absolute_x":
            case "absolute_y": {
                const base_address = this.fetch_word();
                const index = mode === "absolute_x" ? normalize_byte(this.x) : normalize_byte(this.y);
                const address = normalize_word(base_address + index);
                const crossed = page_crossed(base_address, address);

                if (access !== "read" || crossed) {
                    this.bus.read_cpu(indexed_dummy_address(base_address, address));
                }

                return memory_operand(mode, access, base_address, address, crossed);
            }
            case "indirect": {
                const pointer_address = this.fetch_word();
                const target_low = this.bus.read_cpu(pointer_address);
                const pointer_high_address =
                    (pointer_address & PAGE_MASK) | ((pointer_address + 1) & BYTE_MASK);
                const target_high = this.bus.read_cpu(pointer_high_address);

                return {
                    kind: "jump_target",
                    mode,
                    address: normalize_word(target_low | (target_high << 8)),
                    pointer_address,
                };
            }
            case "indexed_indirect": {
                const base_address = this.fetch_byte();
                this.bus.read_cpu(base_address);
                const pointer_address = normalize_byte(base_address + normalize_byte(this.x));
                const target_low = this.bus.read_cpu(pointer_address);
                const target_high = this.bus.read_cpu(normalize_byte(pointer_address + 1));
                const address = normalize_word(target_low | (target_high << 8));

                return memory_operand(mode, access, base_address, address, false);
            }
            case "indirect_indexed": {
                const pointer_address = this.fetch_byte();
                const base_low = this.bus.read_cpu(pointer_address);
                const base_high = this.bus.read_cpu(normalize_byte(pointer_address + 1));
                const base_address = normalize_word(base_low | (base_high << 8));
                const address = normalize_word(base_address + normalize_byte(this.y));
                const crossed = page_crossed(base_address, address);

                if (access !== "read" || crossed) {
                    this.bus.read_cpu(indexed_dummy_address(base_address, address));
                }

                return memory_operand(mode, access, base_address, address, crossed);
            }
        }
    }

    /** Reads an already-resolved accumulator, immediate, or memory operand. */
    read_operand(operand: ResolvedCpuOperand): number {
        if (operand.kind === "accumulator" && operand.access === "read") {
            return normalize_byte(this.a);
        }

        if (operand.kind === "immediate") {
            return operand.value;
        }

        if (operand.kind === "memory" && operand.access === "read") {
            return this.bus.read_cpu(operand.address);
        }

        throw new TypeError(`${operand.mode} does not provide a readable operand for this access.`);
    }

    /** Writes a resolved memory operand. The caller chooses the instruction's register value. */
    write_operand(operand: ResolvedCpuOperand, value: number): void {
        if (operand.kind !== "memory" || operand.access !== "write") {
            throw new TypeError(`${operand.mode} is not a writable memory operand.`);
        }

        this.bus.write_cpu(operand.address, normalize_byte(value));
    }

    /** Applies an 8-bit read-modify-write operation using NMOS 6502 bus ordering. */
    modify_operand(operand: ResolvedCpuOperand, modify: (value: number) => number): number {
        if (operand.kind === "accumulator" && operand.access === "read_modify_write") {
            this.a = normalize_byte(modify(normalize_byte(this.a)));
            return this.a;
        }

        if (operand.kind !== "memory" || operand.access !== "read_modify_write") {
            throw new TypeError(`${operand.mode} is not a read-modify-write operand.`);
        }

        const original_value = this.bus.read_cpu(operand.address);
        const modified_value = normalize_byte(modify(original_value));
        this.bus.write_cpu(operand.address, original_value);
        this.bus.write_cpu(operand.address, modified_value);

        return modified_value;
    }

    /** Applies a resolved branch and returns its additional cycles (zero, one, or two). */
    apply_relative_branch(operand: ResolvedCpuOperand, taken: boolean): number {
        if (operand.kind !== "relative") {
            throw new TypeError(`${operand.mode} is not a relative branch operand.`);
        }

        if (!taken) {
            return 0;
        }

        this.bus.read_cpu(operand.origin_address);

        if (operand.page_crossed) {
            this.bus.read_cpu(indexed_dummy_address(operand.origin_address, operand.target_address));
        }

        this.program_counter = operand.target_address;
        return operand.page_crossed ? 2 : 1;
    }

    push_byte(value: number): void {
        const byte = normalize_byte(value);

        this.bus.write_cpu(STACK_PAGE | this.stack_pointer, byte);
        this.stack_pointer = normalize_byte(this.stack_pointer - 1);
    }

    pop_byte(): number {
        this.stack_pointer = normalize_byte(this.stack_pointer + 1);

        return this.bus.read_cpu(STACK_PAGE | this.stack_pointer);
    }

    push_word(value: number): void {
        const word = normalize_word(value);

        this.push_byte(word >> 8);
        this.push_byte(word & BYTE_MASK);
    }

    pop_word(): number {
        const low_byte = this.pop_byte();
        const high_byte = this.pop_byte();

        return normalize_word(low_byte | (high_byte << 8));
    }

    push_status(source: StatusStackSource): void {
        this.status = normalize_status(this.status);
        this.push_byte(pack_status_for_stack(this.status, source));
    }

    restore_status_from_stack(value: number): void {
        this.status = unpack_status_from_stack(value);
    }

    private finish_instruction(
        mnemonic: CpuInstructionMnemonic,
        interrupt_disabled_before: boolean,
    ): void {
        // These instructions poll IRQ before their I-flag change is visible; RTI restores I early enough
        // for the restored value to be used at the next instruction boundary.
        if (mnemonic === "CLI" || mnemonic === "SEI" || mnemonic === "PLP") {
            this.irq_poll_mask_override = interrupt_disabled_before;
        }
    }

    private branch_condition(mnemonic: CpuInstructionMnemonic): boolean {
        switch (mnemonic) {
            case "BCC":
                return !has_status_flag(this.status, CARRY_FLAG);
            case "BCS":
                return has_status_flag(this.status, CARRY_FLAG);
            case "BEQ":
                return has_status_flag(this.status, ZERO_FLAG);
            case "BMI":
                return has_status_flag(this.status, NEGATIVE_FLAG);
            case "BNE":
                return !has_status_flag(this.status, ZERO_FLAG);
            case "BPL":
                return !has_status_flag(this.status, NEGATIVE_FLAG);
            case "BVC":
                return !has_status_flag(this.status, OVERFLOW_FLAG);
            case "BVS":
                return has_status_flag(this.status, OVERFLOW_FLAG);
            default:
                throw new Error(`${mnemonic} is not a branch instruction.`);
        }
    }

    private compare_register(register: number, operand: number): void {
        const left = normalize_byte(register);
        const right = normalize_byte(operand);
        const result = normalize_byte(left - right);

        this.status = set_status_flag(this.status, CARRY_FLAG, left >= right);
        this.status = update_zero_negative_flags(this.status, result);
    }

    private shift_rotate(mnemonic: "ASL" | "LSR" | "ROL" | "ROR", value: number): number {
        const byte = normalize_byte(value);
        const carry_in = has_status_flag(this.status, CARRY_FLAG) ? 1 : 0;
        let result = 0;
        let carry_out = false;

        switch (mnemonic) {
            case "ASL":
                result = normalize_byte(byte << 1);
                carry_out = (byte & NEGATIVE_FLAG) !== 0;
                break;
            case "LSR":
                result = byte >> 1;
                carry_out = (byte & CARRY_FLAG) !== 0;
                break;
            case "ROL":
                result = normalize_byte((byte << 1) | carry_in);
                carry_out = (byte & NEGATIVE_FLAG) !== 0;
                break;
            case "ROR":
                result = (byte >> 1) | (carry_in << 7);
                carry_out = (byte & CARRY_FLAG) !== 0;
                break;
        }

        this.status = set_status_flag(this.status, CARRY_FLAG, carry_out);
        this.status = update_zero_negative_flags(this.status, result);

        return result;
    }

    private fetch_byte(): number {
        const address = normalize_word(this.program_counter);
        const value = this.bus.read_cpu(address);
        this.program_counter = normalize_word(address + 1);

        return value;
    }

    private fetch_word(): number {
        const low_byte = this.fetch_byte();
        const high_byte = this.fetch_byte();

        return normalize_word(low_byte | (high_byte << 8));
    }
}

function assert_allowed_access(mode: CpuAddressingMode, access: CpuOperandAccess): void {
    if (
        (mode === "implied" || mode === "relative" || mode === "immediate" || mode === "indirect") &&
        access !== "read"
    ) {
        throw new TypeError(`${mode} does not support ${access} access.`);
    }
}

function memory_operand(
    mode: Exclude<CpuAddressingMode, "implied" | "accumulator" | "immediate" | "relative" | "indirect">,
    access: CpuOperandAccess,
    base_address: number,
    address: number,
    crossed: boolean,
): ResolvedCpuOperand {
    return { kind: "memory", mode, access, base_address, address, page_crossed: crossed };
}

function page_crossed(base_address: number, address: number): boolean {
    return (base_address & PAGE_MASK) !== (address & PAGE_MASK);
}

function indexed_dummy_address(base_address: number, address: number): number {
    return (base_address & PAGE_MASK) | (address & BYTE_MASK);
}
