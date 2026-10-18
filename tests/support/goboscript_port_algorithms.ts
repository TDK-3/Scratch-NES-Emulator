/**
 * Bit-free TypeScript mirrors of the GoboScript port helpers in scratch/src.
 *
 * GoboScript has no bitwise operators: "&" joins strings, "%" is Scratch's floored modulo,
 * and "//" is the floor-division block. The ported modules therefore express every mask,
 * shift, and flag test with integer arithmetic. This file repeats those algorithms statement
 * for statement so tests/goboscript-port-algorithms.test.ts can compare them exhaustively
 * against the bitwise TypeScript reference in src/nes/cpu/registers.ts, src/nes/cpu/alu.ts,
 * src/nes/cpu/cpu_2a03.ts, src/nes/cpu/nes_cpu_bus.ts, and src/nes/input/controller.ts.
 *
 * Two rules keep the mirror honest:
 *
 * 1. No bitwise operator may appear in this file. `scratch_mod` and `scratch_floor_divide`
 *    stand in for GoboScript's "%" and "//", whose semantics differ from ECMAScript for
 *    negative operands.
 * 2. Every exported helper must match a GoboScript declaration of the same name and arity.
 *    tests/goboscript-source.test.ts enforces that parity, because editing one side without
 *    the other would silently invalidate the comparison.
 *
 * Mirroring is not compiling: the pinned GoboScript toolchain is still unavailable, so the
 * .gs sources remain compile-unvalidated.
 */

/** Mirror of the `cpu_flag` enum in scratch/src/numeric.gs. */
export const CPU_FLAG = {
    CARRY: 1,
    ZERO: 2,
    INTERRUPT_DISABLE: 4,
    DECIMAL: 8,
    BREAK: 16,
    UNUSED: 32,
    OVERFLOW: 64,
    NEGATIVE: 128,
} as const;

/** Result of an ALU mirror call: the GoboScript procs write `alu_value` and `alu_status`. */
export interface AluResult {
    readonly value: number;
    readonly status: number;
}

/** Scratch's modulo block: the result takes the sign of the divisor, unlike ECMAScript "%". */
export function scratch_mod(left: number, right: number): number {
    const truncated = left % right;

    if (truncated === 0) {
        return 0;
    }

    if ((truncated < 0) === (right < 0)) {
        return truncated;
    }

    return truncated + right;
}

/** GoboScript's "//" operator: floor(a / b), compiled to the plain round-down block. */
export function scratch_floor_divide(left: number, right: number): number {
    return Math.floor(left / right);
}

/** Mirror of `to_number(value)`: forces a list item or other string to a number. */
export function to_number(value: number | string): number {
    const numeric = Number(value);

    if (Number.isNaN(numeric)) {
        return 0;
    }

    return numeric;
}

/** Mirror of `normalize_byte(value)`. */
export function normalize_byte(value: number): number {
    const numeric = to_number(value);

    return scratch_mod(scratch_mod(numeric, 256) + 256, 256);
}

/** Mirror of `normalize_word(value)`. */
export function normalize_word(value: number): number {
    const numeric = to_number(value);

    return scratch_mod(scratch_mod(numeric, 65536) + 65536, 65536);
}

/** Mirror of `to_signed_byte(value)`. */
export function to_signed_byte(value: number): number {
    const byte = normalize_byte(value);

    if (byte >= 128) {
        return byte - 256;
    }

    return byte;
}

/** Mirror of `byte_high(word)`. */
export function byte_high(word: number): number {
    return scratch_floor_divide(normalize_word(word), 256);
}

/** Mirror of `byte_low(word)`. */
export function byte_low(word: number): number {
    return scratch_mod(normalize_word(word), 256);
}

/** Mirror of `join_bytes(high, low)`. */
export function join_bytes(high: number, low: number): number {
    return normalize_byte(high) * 256 + normalize_byte(low);
}

/** Mirror of `bit_at(value, weight)`; the weight must be a power of two. */
export function bit_at(value: number, weight: number): number {
    return scratch_mod(scratch_floor_divide(normalize_word(value), weight), 2);
}

/** Mirror of `bitwise_and(left, right)`; one iteration per bit, as in the ported header. */
export function bitwise_and(left: number, right: number): number {
    let remaining_left = normalize_word(left);
    let remaining_right = normalize_word(right);
    let result = 0;
    let weight = 1;

    for (let iteration = 0; iteration < 16; iteration += 1) {
        if (scratch_mod(remaining_left, 2) === 1 && scratch_mod(remaining_right, 2) === 1) {
            result += weight;
        }

        remaining_left = scratch_floor_divide(remaining_left, 2);
        remaining_right = scratch_floor_divide(remaining_right, 2);
        weight = weight * 2;
    }

    return result;
}

/** Mirror of `bitwise_or(left, right)`. */
export function bitwise_or(left: number, right: number): number {
    let remaining_left = normalize_word(left);
    let remaining_right = normalize_word(right);
    let result = 0;
    let weight = 1;

    for (let iteration = 0; iteration < 16; iteration += 1) {
        if (scratch_mod(remaining_left, 2) === 1 || scratch_mod(remaining_right, 2) === 1) {
            result += weight;
        }

        remaining_left = scratch_floor_divide(remaining_left, 2);
        remaining_right = scratch_floor_divide(remaining_right, 2);
        weight = weight * 2;
    }

    return result;
}

/** Mirror of `bitwise_xor(left, right)`. */
export function bitwise_xor(left: number, right: number): number {
    let remaining_left = normalize_word(left);
    let remaining_right = normalize_word(right);
    let result = 0;
    let weight = 1;

    for (let iteration = 0; iteration < 16; iteration += 1) {
        if (scratch_mod(remaining_left, 2) !== scratch_mod(remaining_right, 2)) {
            result += weight;
        }

        remaining_left = scratch_floor_divide(remaining_left, 2);
        remaining_right = scratch_floor_divide(remaining_right, 2);
        weight = weight * 2;
    }

    return result;
}

/** Mirror of `normalize_status(status)`. */
export function normalize_status(status: number): number {
    const byte = normalize_byte(status);
    const without_break = byte - 16 * bit_at(byte, 16);

    return without_break + 32 * (1 - bit_at(without_break, 32));
}

/** Mirror of `has_status_flag(status, flag)`. */
export function has_status_flag(status: number, flag: number): number {
    return bit_at(normalize_status(status), flag);
}

/** Mirror of `set_status_flag(status, flag, enabled)`; `enabled` is the ported 0/1 form. */
export function set_status_flag(status: number, flag: number, enabled: number): number {
    const normalized = normalize_status(status);
    const current = bit_at(normalized, flag);
    const updated = enabled === 1 ? normalized + flag * (1 - current) : normalized - flag * current;

    return normalize_status(updated);
}

/** Mirror of `update_zero_negative_flags(status, value)`. */
export function update_zero_negative_flags(status: number, value: number): number {
    const byte = normalize_byte(value);
    const zero_enabled = byte === 0 ? 1 : 0;
    const negative_enabled = byte >= 128 ? 1 : 0;
    const with_zero = set_status_flag(status, CPU_FLAG.ZERO, zero_enabled);

    return set_status_flag(with_zero, CPU_FLAG.NEGATIVE, negative_enabled);
}

/** Mirror of `pack_status_for_stack(status, break_enabled)`. */
export function pack_status_for_stack(status: number, break_enabled: number): number {
    const normalized = normalize_status(status);

    if (break_enabled === 1) {
        return bitwise_or(normalized, CPU_FLAG.BREAK);
    }

    return normalized;
}

/** Mirror of `unpack_status_from_stack(status)`. */
export function unpack_status_from_stack(status: number): number {
    return normalize_status(status);
}

/** Mirror of `alu_add_with_carry accumulator, operand, status`. */
export function alu_add_with_carry(accumulator: number, operand: number, status: number): AluResult {
    const left = normalize_byte(accumulator);
    const right = normalize_byte(operand);
    const carry_in = has_status_flag(status, CPU_FLAG.CARRY);
    const sum = left + right + carry_in;
    const value = normalize_byte(sum);
    const signed_sum = to_signed_byte(left) + to_signed_byte(right) + carry_in;
    const carry_enabled = sum > 255 ? 1 : 0;
    const overflow_enabled = signed_sum !== to_signed_byte(value) ? 1 : 0;
    const with_carry = set_status_flag(status, CPU_FLAG.CARRY, carry_enabled);
    const updated = set_status_flag(with_carry, CPU_FLAG.OVERFLOW, overflow_enabled);

    return { value, status: update_zero_negative_flags(updated, value) };
}

/** Mirror of `alu_subtract_with_carry accumulator, operand, status`. */
export function alu_subtract_with_carry(accumulator: number, operand: number, status: number): AluResult {
    const left = normalize_byte(accumulator);
    const right = normalize_byte(operand);
    const carry_in = has_status_flag(status, CPU_FLAG.CARRY);
    const borrow = 1 - carry_in;
    const difference = left - right - borrow;
    const value = normalize_byte(difference);
    const signed_difference = to_signed_byte(left) - to_signed_byte(right) - borrow;
    const carry_enabled = difference >= 0 ? 1 : 0;
    const overflow_enabled = signed_difference !== to_signed_byte(value) ? 1 : 0;
    const with_carry = set_status_flag(status, CPU_FLAG.CARRY, carry_enabled);
    const updated = set_status_flag(with_carry, CPU_FLAG.OVERFLOW, overflow_enabled);

    return { value, status: update_zero_negative_flags(updated, value) };
}

/** Mirror of `alu_and accumulator, operand, status`. */
export function alu_and(accumulator: number, operand: number, status: number): AluResult {
    const value = bitwise_and(normalize_byte(accumulator), normalize_byte(operand));

    return { value, status: update_zero_negative_flags(status, value) };
}

/** Mirror of `alu_ora accumulator, operand, status`. */
export function alu_ora(accumulator: number, operand: number, status: number): AluResult {
    const value = bitwise_or(normalize_byte(accumulator), normalize_byte(operand));

    return { value, status: update_zero_negative_flags(status, value) };
}

/** Mirror of `alu_eor accumulator, operand, status`. */
export function alu_eor(accumulator: number, operand: number, status: number): AluResult {
    const value = bitwise_xor(normalize_byte(accumulator), normalize_byte(operand));

    return { value, status: update_zero_negative_flags(status, value) };
}

/** Mirror of `alu_shift_left value, status`. */
export function alu_shift_left(value: number, status: number): AluResult {
    const byte = normalize_byte(value);
    const shifted = byte * 2;
    const result = normalize_byte(shifted);
    const carry_enabled = shifted > 255 ? 1 : 0;
    const updated = set_status_flag(status, CPU_FLAG.CARRY, carry_enabled);

    return { value: result, status: update_zero_negative_flags(updated, result) };
}

/** Mirror of `alu_shift_right value, status`. */
export function alu_shift_right(value: number, status: number): AluResult {
    const byte = normalize_byte(value);
    const result = scratch_floor_divide(byte, 2);
    const updated = set_status_flag(status, CPU_FLAG.CARRY, scratch_mod(byte, 2));

    return { value: result, status: update_zero_negative_flags(updated, result) };
}

/** Mirror of `alu_rotate_left value, status`. */
export function alu_rotate_left(value: number, status: number): AluResult {
    const byte = normalize_byte(value);
    const carry_in = has_status_flag(status, CPU_FLAG.CARRY);
    const shifted = byte * 2 + carry_in;
    const result = normalize_byte(shifted);
    const carry_enabled = shifted > 255 ? 1 : 0;
    const updated = set_status_flag(status, CPU_FLAG.CARRY, carry_enabled);

    return { value: result, status: update_zero_negative_flags(updated, result) };
}

/** Mirror of `alu_rotate_right value, status`. */
export function alu_rotate_right(value: number, status: number): AluResult {
    const byte = normalize_byte(value);
    const carry_in = has_status_flag(status, CPU_FLAG.CARRY);
    const shifted = byte + carry_in * 256;
    const result = scratch_floor_divide(shifted, 2);
    const updated = set_status_flag(status, CPU_FLAG.CARRY, scratch_mod(shifted, 2));

    return { value: result, status: update_zero_negative_flags(updated, result) };
}

/** Mirror of `alu_compare register_value, operand, status`. */
export function alu_compare(register_value: number, operand: number, status: number): AluResult {
    const left = normalize_byte(register_value);
    const right = normalize_byte(operand);
    const difference = left - right;
    const carry_enabled = difference >= 0 ? 1 : 0;
    const updated = set_status_flag(status, CPU_FLAG.CARRY, carry_enabled);

    return { value: left, status: update_zero_negative_flags(updated, normalize_byte(difference)) };
}

/** Mirror of `alu_bit_test accumulator, operand, status`. */
export function alu_bit_test(accumulator: number, operand: number, status: number): AluResult {
    const left = normalize_byte(accumulator);
    const memory = normalize_byte(operand);
    const tested = bitwise_and(left, memory);
    const zero_enabled = tested === 0 ? 1 : 0;
    const with_zero = set_status_flag(status, CPU_FLAG.ZERO, zero_enabled);
    const with_negative = set_status_flag(with_zero, CPU_FLAG.NEGATIVE, bit_at(memory, 128));
    const updated = set_status_flag(with_negative, CPU_FLAG.OVERFLOW, bit_at(memory, 64));

    return { value: left, status: updated };
}

/** Mirror of `alu_increment value, status`. */
export function alu_increment(value: number, status: number): AluResult {
    const result = normalize_byte(normalize_byte(value) + 1);

    return { value: result, status: update_zero_negative_flags(status, result) };
}

/** Mirror of `alu_decrement value, status`. */
export function alu_decrement(value: number, status: number): AluResult {
    const result = normalize_byte(normalize_byte(value) - 1);

    return { value: result, status: update_zero_negative_flags(status, result) };
}

/**
 * Mirror of scratch/src/controller.gs. Scratch lists are 1-indexed, so the ported header
 * converts a 0/1 controller index to a list position; this mirror keeps zero-based arrays
 * and performs the same conversion implicitly.
 */
export class GoboscriptControllerPorts {
    private readonly button_masks = [0, 0];
    private readonly shift_registers = [0, 0];
    private strobe_high = 0;

    reset(): void {
        this.shift_registers[0] = 0;
        this.shift_registers[1] = 0;
        this.strobe_high = 0;
    }

    set_button_mask(controller_index: 0 | 1, button_mask: number): void {
        this.button_masks[controller_index] = normalize_byte(button_mask);
    }

    button_mask(controller_index: 0 | 1): number {
        return this.button_masks[controller_index] ?? 0;
    }

    serial_read(controller_index: 0 | 1): number {
        if (this.strobe_high === 1) {
            return bitwise_and(this.button_masks[controller_index] ?? 0, 1);
        }

        const shift_register = normalize_byte(this.shift_registers[controller_index] ?? 0);
        this.shift_registers[controller_index] = bitwise_or(scratch_floor_divide(shift_register, 2), 128);

        return bitwise_and(shift_register, 1);
    }

    write_strobe(value: number): void {
        const next_strobe = bitwise_and(normalize_byte(value), 1);

        if (this.strobe_high === 1 && next_strobe === 0) {
            this.shift_registers[0] = normalize_byte(this.button_masks[0] ?? 0);
            this.shift_registers[1] = normalize_byte(this.button_masks[1] ?? 0);
        }

        this.strobe_high = next_strobe;
    }
}

/**
 * Mirror of scratch/src/cpu_bus.gs: RAM with mirroring, the open-bus latch with driven
 * masks, and the controller window. PPU, APU, OAM DMA, and cartridge windows are absent on
 * both sides, so undriven reads return the retained latch and writes are dropped.
 */
export class GoboscriptCpuBus {
    readonly controllers = new GoboscriptControllerPorts();
    private readonly ram = new Array<number>(2048).fill(0);
    private open_bus = 0;

    reset(): void {
        this.open_bus = 0;
    }

    get_open_bus(): number {
        return this.open_bus;
    }

    read(address: number): number {
        const numeric_address = normalize_word(address);

        if (numeric_address < 8192) {
            return this.apply_driven_value(this.ram[scratch_mod(numeric_address, 2048)] ?? 0, 255);
        }

        if (numeric_address < 16384) {
            return this.open_bus;
        }

        if (numeric_address < 16416) {
            return this.read_io(numeric_address);
        }

        return this.open_bus;
    }

    write(address: number, value: number): void {
        const numeric_address = normalize_word(address);
        const numeric_value = normalize_byte(value);
        this.open_bus = numeric_value;

        if (numeric_address < 8192) {
            this.ram[scratch_mod(numeric_address, 2048)] = numeric_value;
        }

        if (numeric_address === 16406) {
            this.controllers.write_strobe(numeric_value);
        }
    }

    private read_io(address: number): number {
        if (address === 16406) {
            return this.apply_driven_value(this.controllers.serial_read(0), 1);
        }

        if (address === 16407) {
            return this.apply_driven_value(this.controllers.serial_read(1), 1);
        }

        return this.open_bus;
    }

    private apply_driven_value(value: number, driven_mask: number): number {
        const driven = normalize_byte(driven_mask);
        const undriven = bitwise_xor(255, driven);
        const driven_bits = bitwise_and(normalize_byte(value), driven);
        const retained_bits = bitwise_and(this.open_bus, undriven);
        const merged = bitwise_or(driven_bits, retained_bits);
        this.open_bus = merged;

        return merged;
    }
}
