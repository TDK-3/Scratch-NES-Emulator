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

/**
 * Mirror of `normalize_byte(value)`. Scratch's modulo is floored, so the modulo alone
 * reproduces `((n % 256) + 256) % 256` for every input; the port and this mirror both use
 * the single modulo.
 */
export function normalize_byte(value: number): number {
    return scratch_mod(value, 256);
}

/** Mirror of `normalize_word(value)`; a single floored modulo, like normalize_byte. */
export function normalize_word(value: number): number {
    return scratch_mod(value, 65536);
}

/** Mirror of `to_signed_byte(value)`. */
export function to_signed_byte(value: number): number {
    const byte = scratch_mod(value, 256);

    if (byte >= 128) {
        return byte - 256;
    }

    return byte;
}

/** Mirror of `byte_high(word)`. */
export function byte_high(word: number): number {
    return scratch_floor_divide(scratch_mod(word, 65536), 256);
}

/** Mirror of `byte_low(word)`. */
export function byte_low(word: number): number {
    return scratch_mod(word, 256);
}

/** Mirror of `join_bytes(high, low)`. */
export function join_bytes(high: number, low: number): number {
    return scratch_mod(high, 256) * 256 + scratch_mod(low, 256);
}

/** Mirror of `bit_at(value, weight)`; the weight must be a power of two. */
export function bit_at(value: number, weight: number): number {
    return scratch_mod(scratch_floor_divide(scratch_mod(value, 65536), weight), 2);
}

/**
 * Mirror of the `bitwise_table_and` list and `bitwise_table_init` proc: the AND of the two
 * nibbles selected by index = high * 16 + low. The TypeScript side can build it with
 * bitwise operators because only the GoboScript port is bit-free; the port fills the same
 * entries at run time from four per-bit tests, and this construction is checked against
 * those by the same exhaustive comparison that exercises bitwise_and below.
 */
export const BITWISE_TABLE_AND: readonly number[] = (() => {
    const table: number[] = [];

    for (let high = 0; high < 16; high += 1) {
        for (let low = 0; low < 16; low += 1) {
            let value = 0;

            for (let bit = 0; bit < 4; bit += 1) {
                const weight = 2 ** bit;
                const high_bit = scratch_floor_divide(high, weight) % 2;
                const low_bit = scratch_floor_divide(low, weight) % 2;

                if (high_bit === 1 && low_bit === 1) {
                    value += weight;
                }
            }

            table.push(value);
        }
    }

    return table;
})();

/**
 * Mirror of `bitwise_and(left, right)`: a pair of nibble-table reads for a byte-wide pair
 * and four for a wider one, so the ported helper costs a fixed handful of blocks per call.
 * The port keeps the table in a 1-based list and this mirror in a 0-based array; both index
 * it with high nibble * 16 + low nibble, which is the same entry either way.
 */
export function bitwise_and(left: number, right: number): number {
    const left_word = scratch_mod(left, 65536);
    const right_word = scratch_mod(right, 65536);

    if (left_word < 256 && right_word < 256) {
        const low_nibbles = BITWISE_TABLE_AND[(scratch_floor_divide(left_word, 16) * 16) + scratch_floor_divide(right_word, 16)] ?? 0;
        const low_bits = BITWISE_TABLE_AND[(scratch_mod(left_word, 16) * 16) + scratch_mod(right_word, 16)] ?? 0;

        return low_nibbles * 16 + low_bits;
    }

    const left_high = scratch_floor_divide(left_word, 256);
    const right_high = scratch_floor_divide(right_word, 256);
    const left_low = scratch_mod(left_word, 256);
    const right_low = scratch_mod(right_word, 256);
    const high_nibbles = BITWISE_TABLE_AND[(scratch_floor_divide(left_high, 16) * 16) + scratch_floor_divide(right_high, 16)] ?? 0;
    const high_bits = BITWISE_TABLE_AND[(scratch_mod(left_high, 16) * 16) + scratch_mod(right_high, 16)] ?? 0;
    const low_nibbles = BITWISE_TABLE_AND[(scratch_floor_divide(left_low, 16) * 16) + scratch_floor_divide(right_low, 16)] ?? 0;
    const low_bits = BITWISE_TABLE_AND[(scratch_mod(left_low, 16) * 16) + scratch_mod(right_low, 16)] ?? 0;

    return (high_nibbles * 16 + high_bits) * 256 + (low_nibbles * 16 + low_bits);
}

/**
 * Mirror of `bitwise_and_byte(left, right)`: the same two nibble-table reads as the byte case
 * of `bitwise_and`, without the width test, over operands the caller promises are bytes.
 */
export function bitwise_and_byte(left: number, right: number): number {
    const left_byte = scratch_mod(left, 256);
    const right_byte = scratch_mod(right, 256);

    return bitwise_and(left_byte, right_byte);
}

/** Mirror of `bitwise_or_byte(left, right)`. */
export function bitwise_or_byte(left: number, right: number): number {
    const left_byte = scratch_mod(left, 256);
    const right_byte = scratch_mod(right, 256);

    return bitwise_or(left_byte, right_byte);
}

/** Mirror of `bitwise_xor_byte(left, right)`. */
export function bitwise_xor_byte(left: number, right: number): number {
    const left_byte = scratch_mod(left, 256);
    const right_byte = scratch_mod(right, 256);

    return bitwise_xor(left_byte, right_byte);
}

/** Mirror of `bitwise_or(left, right)`: a + b - (a & b) for non-negative operands. */
export function bitwise_or(left: number, right: number): number {
    const left_word = scratch_mod(left, 65536);
    const right_word = scratch_mod(right, 65536);

    return left_word + right_word - bitwise_and(left_word, right_word);
}

/** Mirror of `bitwise_xor(left, right)`: a + b - 2 * (a & b) for non-negative operands. */
export function bitwise_xor(left: number, right: number): number {
    const left_word = scratch_mod(left, 65536);
    const right_word = scratch_mod(right, 65536);

    return left_word + right_word - 2 * bitwise_and(left_word, right_word);
}

/**
 * Mirror of `normalize_status(status)`. The status byte is eight bits wide, so the two
 * bits the invariant owns are read with floored modulo and division; the port no longer
 * goes through bit_at for them.
 */
export function normalize_status(status: number): number {
    const byte = scratch_mod(status, 256);

    return scratch_mod(byte, 16) + 32 + scratch_floor_divide(byte, 64) * 64;
}

/** Mirror of `has_status_flag(status, flag)`. */
export function has_status_flag(status: number, flag: number): number {
    return scratch_mod(scratch_floor_divide(normalize_status(status), flag), 2);
}

/** Mirror of `set_status_flag(status, flag, enabled)`; `enabled` is the ported 0/1 form. */
export function set_status_flag(status: number, flag: number, enabled: number): number {
    const normalized = normalize_status(status);
    const current = scratch_mod(scratch_floor_divide(normalized, flag), 2);
    const updated = enabled === 1 ? normalized + flag * (1 - current) : normalized - flag * current;

    return normalize_status(updated);
}

/** Mirror of `update_zero_negative_flags(status, value)`: one normalize, two bits in place. */
/**
 * Mirror of the `cpu_zero_negative_bits` table and `cpu_status_table_init` proc: the zero and
 * negative bits one result byte contributes, at slot value + 1. The port builds it once at the
 * green flag; the mirror can build it at load because it has no green flag.
 */
export const CPU_ZERO_NEGATIVE_BITS: readonly number[] = Array.from({ length: 256 }, (_unused, value) => {
    const zero_bit = value === 0 ? CPU_FLAG.ZERO : 0;
    const negative_bit = value >= 128 ? CPU_FLAG.NEGATIVE : 0;

    return zero_bit + negative_bit;
});

/** Mirror of `update_zero_negative_flags(status, value)`. */
export function update_zero_negative_flags(status: number, value: number): number {
    const byte = scratch_mod(value, 256);
    const normalized = normalize_status(status);
    const without_negative = scratch_mod(normalized, 128);
    const without_zero = without_negative - 2 * scratch_mod(scratch_floor_divide(normalized, 2), 2);

    return without_zero + (CPU_ZERO_NEGATIVE_BITS[byte] ?? 0);
}

/** Mirror of the `cpu_status_table_init` proc; the mirror's table is built at load. */
export function cpu_status_table_init(): void {
    // The TypeScript table above is a const array built at module load, so there is nothing to
    // fill in here. The function exists so the declaration inventory stays one-to-one.
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

/**
 * The zero/negative tail the byte entry points inline: drop bit 7, drop bit 1, and add the
 * packed answer for the result byte. Only valid for a normalized status.
 */
function alu_zero_negative_byte(status: number, value: number): number {
    const without_negative = scratch_mod(status, 128);
    const without_zero = without_negative - 2 * scratch_mod(scratch_floor_divide(status, 2), 2);

    return without_zero + (CPU_ZERO_NEGATIVE_BITS[value] ?? 0);
}

/** Mirror of `alu_add_with_carry accumulator, operand, status`: normalize, then byte form. */
export function alu_add_with_carry(accumulator: number, operand: number, status: number): AluResult {
    return alu_add_with_carry_byte(
        scratch_mod(accumulator, 256),
        scratch_mod(operand, 256),
        normalize_status(status),
    );
}

/** Mirror of `alu_add_with_carry_byte accumulator, operand, status`. Branch-free flags. */
export function alu_add_with_carry_byte(accumulator: number, operand: number, status: number): AluResult {
    const left = accumulator;
    const right = operand;
    const normalized = status;
    const carry_in = scratch_mod(normalized, 2);
    const total = left + right + carry_in;
    const value = scratch_mod(total, 256);
    const sign = scratch_floor_divide(value, 128);
    const updated =
        normalized -
        scratch_mod(normalized, 2) -
        64 * scratch_mod(scratch_floor_divide(normalized, 64), 2) +
        scratch_floor_divide(total, 256) +
        64 *
            (scratch_mod(scratch_floor_divide(left, 128) + sign, 2) *
                scratch_mod(scratch_floor_divide(right, 128) + sign, 2));

    return { value, status: alu_zero_negative_byte(updated, value) };
}

/** Mirror of `alu_subtract_with_carry accumulator, operand, status`: normalize, then byte form. */
export function alu_subtract_with_carry(accumulator: number, operand: number, status: number): AluResult {
    return alu_subtract_with_carry_byte(
        scratch_mod(accumulator, 256),
        scratch_mod(operand, 256),
        normalize_status(status),
    );
}

/** Mirror of `alu_subtract_with_carry_byte accumulator, operand, status`. */
export function alu_subtract_with_carry_byte(accumulator: number, operand: number, status: number): AluResult {
    const left = accumulator;
    const complement = 255 - operand;
    const normalized = status;
    const carry_in = scratch_mod(normalized, 2);
    const total = left + complement + carry_in;
    const value = scratch_mod(total, 256);
    const sign = scratch_floor_divide(value, 128);
    const updated =
        normalized -
        scratch_mod(normalized, 2) -
        64 * scratch_mod(scratch_floor_divide(normalized, 64), 2) +
        scratch_floor_divide(total, 256) +
        64 *
            (scratch_mod(scratch_floor_divide(left, 128) + sign, 2) *
                scratch_mod(scratch_floor_divide(complement, 128) + sign, 2));

    return { value, status: alu_zero_negative_byte(updated, value) };
}

/** Mirror of `alu_and accumulator, operand, status`. */
export function alu_and(accumulator: number, operand: number, status: number): AluResult {
    return alu_and_byte(scratch_mod(accumulator, 256), scratch_mod(operand, 256), normalize_status(status));
}

/** Mirror of `alu_and_byte accumulator, operand, status`. */
export function alu_and_byte(accumulator: number, operand: number, status: number): AluResult {
    const value = bitwise_and_byte(accumulator, operand);

    return { value, status: alu_zero_negative_byte(status, value) };
}

/** Mirror of `alu_ora accumulator, operand, status`. */
export function alu_ora(accumulator: number, operand: number, status: number): AluResult {
    return alu_ora_byte(scratch_mod(accumulator, 256), scratch_mod(operand, 256), normalize_status(status));
}

/** Mirror of `alu_ora_byte accumulator, operand, status`. */
export function alu_ora_byte(accumulator: number, operand: number, status: number): AluResult {
    const value = bitwise_or_byte(accumulator, operand);

    return { value, status: alu_zero_negative_byte(status, value) };
}

/** Mirror of `alu_eor accumulator, operand, status`. */
export function alu_eor(accumulator: number, operand: number, status: number): AluResult {
    return alu_eor_byte(scratch_mod(accumulator, 256), scratch_mod(operand, 256), normalize_status(status));
}

/** Mirror of `alu_eor_byte accumulator, operand, status`. */
export function alu_eor_byte(accumulator: number, operand: number, status: number): AluResult {
    const value = bitwise_xor_byte(accumulator, operand);

    return { value, status: alu_zero_negative_byte(status, value) };
}

/** Mirror of `alu_shift_left value, status`. */
export function alu_shift_left(value: number, status: number): AluResult {
    return alu_shift_left_byte(scratch_mod(value, 256), normalize_status(status));
}

/** Mirror of `alu_shift_left_byte value, status`. */
export function alu_shift_left_byte(value: number, status: number): AluResult {
    const shifted = value * 2;
    const result = scratch_mod(shifted, 256);
    const updated = status - scratch_mod(status, 2) + scratch_floor_divide(shifted, 256);

    return { value: result, status: alu_zero_negative_byte(updated, result) };
}

/** Mirror of `alu_shift_right value, status`. */
export function alu_shift_right(value: number, status: number): AluResult {
    return alu_shift_right_byte(scratch_mod(value, 256), normalize_status(status));
}

/** Mirror of `alu_shift_right_byte value, status`. */
export function alu_shift_right_byte(value: number, status: number): AluResult {
    const result = scratch_floor_divide(value, 2);
    const updated = status - scratch_mod(status, 2) + scratch_mod(value, 2);

    return { value: result, status: alu_zero_negative_byte(updated, result) };
}

/** Mirror of `alu_rotate_left value, status`. */
export function alu_rotate_left(value: number, status: number): AluResult {
    return alu_rotate_left_byte(scratch_mod(value, 256), normalize_status(status));
}

/** Mirror of `alu_rotate_left_byte value, status`. */
export function alu_rotate_left_byte(value: number, status: number): AluResult {
    const shifted = value * 2 + scratch_mod(status, 2);
    const result = scratch_mod(shifted, 256);
    const updated = status - scratch_mod(status, 2) + scratch_floor_divide(shifted, 256);

    return { value: result, status: alu_zero_negative_byte(updated, result) };
}

/** Mirror of `alu_rotate_right value, status`. */
export function alu_rotate_right(value: number, status: number): AluResult {
    return alu_rotate_right_byte(scratch_mod(value, 256), normalize_status(status));
}

/** Mirror of `alu_rotate_right_byte value, status`. */
export function alu_rotate_right_byte(value: number, status: number): AluResult {
    const shifted = value + scratch_mod(status, 2) * 256;
    const result = scratch_floor_divide(shifted, 2);
    const updated = status - scratch_mod(status, 2) + scratch_mod(shifted, 2);

    return { value: result, status: alu_zero_negative_byte(updated, result) };
}

/** Mirror of `alu_compare register_value, operand, status`. */
export function alu_compare(register_value: number, operand: number, status: number): AluResult {
    return alu_compare_byte(scratch_mod(register_value, 256), scratch_mod(operand, 256), normalize_status(status));
}

/** Mirror of `alu_compare_byte register_value, operand, status`. */
export function alu_compare_byte(register_value: number, operand: number, status: number): AluResult {
    const difference = register_value - operand;
    const updated = status - scratch_mod(status, 2) + (1 - scratch_mod(scratch_floor_divide(difference, 256), 2));

    return { value: register_value, status: alu_zero_negative_byte(updated, scratch_mod(difference, 256)) };
}

/** Mirror of `alu_bit_test accumulator, operand, status`. */
export function alu_bit_test(accumulator: number, operand: number, status: number): AluResult {
    return alu_bit_test_byte(scratch_mod(accumulator, 256), scratch_mod(operand, 256), normalize_status(status));
}

/** Mirror of `alu_bit_test_byte accumulator, operand, status`. */
export function alu_bit_test_byte(accumulator: number, operand: number, status: number): AluResult {
    const memory = operand;
    const tested = bitwise_and_byte(accumulator, memory);
    const zero_flag = tested === 0 ? 1 : 0;
    const updated =
        status -
        2 * scratch_mod(scratch_floor_divide(status, 2), 2) -
        128 * scratch_mod(scratch_floor_divide(status, 128), 2) -
        64 * scratch_mod(scratch_floor_divide(status, 64), 2) +
        2 * zero_flag +
        128 * scratch_mod(scratch_floor_divide(memory, 128), 2) +
        64 * scratch_mod(scratch_floor_divide(memory, 64), 2);

    return { value: accumulator, status: updated };
}

/** Mirror of `alu_increment value, status`. */
export function alu_increment(value: number, status: number): AluResult {
    return alu_increment_byte(scratch_mod(value, 256), normalize_status(status));
}

/** Mirror of `alu_increment_byte value, status`. */
export function alu_increment_byte(value: number, status: number): AluResult {
    const result = scratch_mod(value + 1, 256);

    return { value: result, status: alu_zero_negative_byte(status, result) };
}

/** Mirror of `alu_decrement value, status`. */
export function alu_decrement(value: number, status: number): AluResult {
    return alu_decrement_byte(scratch_mod(value, 256), normalize_status(status));
}

/** Mirror of `alu_decrement_byte value, status`. */
export function alu_decrement_byte(value: number, status: number): AluResult {
    const result = scratch_mod(value - 1, 256);

    return { value: result, status: alu_zero_negative_byte(status, result) };
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
        this.button_masks[controller_index] = scratch_mod(button_mask, 256);
    }

    button_mask(controller_index: 0 | 1): number {
        return this.button_masks[controller_index] ?? 0;
    }

    serial_read(controller_index: 0 | 1): number {
        // The port spells both single-line masks as modulos: a shift register is a byte, so
        // ">> 1 | 128" is the disjoint-bit sum of a division and 128.
        if (this.strobe_high === 1) {
            return scratch_mod(this.button_masks[controller_index] ?? 0, 2);
        }

        const shift_register = scratch_mod(this.shift_registers[controller_index] ?? 0, 256);
        this.shift_registers[controller_index] = scratch_floor_divide(shift_register, 2) + 128;

        return scratch_mod(shift_register, 2);
    }

    write_strobe(value: number): void {
        const next_strobe = scratch_mod(scratch_mod(value, 256), 2);

        if (this.strobe_high === 1 && next_strobe === 0) {
            // set_button_mask stores bytes, so the latch is a copy.
            this.shift_registers[0] = this.button_masks[0] ?? 0;
            this.shift_registers[1] = this.button_masks[1] ?? 0;
        }

        this.strobe_high = next_strobe;
    }
}

/**
 * Mirror of the `keyboard_button` enum in scratch/src/keyboard_input.gs: the A/B/Select/Start
 * and Up/Down/Left/Right bit weights of one NES pad, which the reference spells
 * CONTROLLER_BUTTON_MASKS in src/nes/input/controller.ts.
 */
export const KEYBOARD_BUTTON = {
    A: 0x01,
    B: 0x02,
    SELECT: 0x04,
    START: 0x08,
    UP: 0x10,
    DOWN: 0x20,
    LEFT: 0x40,
    RIGHT: 0x80,
} as const;

/** One row of the ported key table: a Scratch key name and the pad button it holds down. */
export interface KeyboardBinding {
    readonly key: string;
    readonly controller: 0 | 1;
    readonly button: keyof typeof KEYBOARD_BUTTON;
}

/**
 * Mirror of the key table in scratch/src/keyboard_input.gs, in the order the ported proc tests
 * it. The names are Scratch key-option values, so "up arrow" is the up arrow key and "z" is
 * the letter key; the browser adapter spells the same two bindings "arrowup" and "z".
 */
export const KEYBOARD_BINDINGS: readonly KeyboardBinding[] = [
    { key: "up arrow", controller: 0, button: "UP" },
    { key: "down arrow", controller: 0, button: "DOWN" },
    { key: "left arrow", controller: 0, button: "LEFT" },
    { key: "right arrow", controller: 0, button: "RIGHT" },
    { key: "z", controller: 0, button: "A" },
    { key: "x", controller: 0, button: "B" },
    { key: "shift", controller: 0, button: "SELECT" },
    { key: "enter", controller: 0, button: "START" },
    { key: "i", controller: 1, button: "UP" },
    { key: "k", controller: 1, button: "DOWN" },
    { key: "j", controller: 1, button: "LEFT" },
    { key: "l", controller: 1, button: "RIGHT" },
    { key: "u", controller: 1, button: "A" },
    { key: "o", controller: 1, button: "B" },
    { key: "y", controller: 1, button: "SELECT" },
    { key: "p", controller: 1, button: "START" },
];

/**
 * Mirror of `keyboard_poll_controllers`, with the built-in key sensors replaced by the set of
 * keys the caller reports as held down. Returns the two live button masks the ported proc
 * hands to `controller_set_button_mask`, in pad order. A key outside the table is ignored the
 * way an unbound key is, and a key the table listed twice would still set one bit, because the
 * port combines held buttons with bitwise_or.
 */
export function keyboard_poll_masks(held_keys: ReadonlySet<string>): readonly [number, number] {
    let first_pad = 0;
    let second_pad = 0;

    for (const binding of KEYBOARD_BINDINGS) {
        if (!held_keys.has(binding.key)) {
            continue;
        }

        if (binding.controller === 0) {
            first_pad = bitwise_or(first_pad, KEYBOARD_BUTTON[binding.button]);
        } else {
            second_pad = bitwise_or(second_pad, KEYBOARD_BUTTON[binding.button]);
        }
    }

    return [first_pad, second_pad];
}

/** Mirror of the `rom_input_error` enum in scratch/src/rom_input.gs. */
export const ROM_INPUT_ERROR = {
    NONE: 0,
    EMPTY: 1,
    ODD_DIGITS: 2,
    TOO_MANY_BYTES: 3,
    TOO_LONG: 4,
    SIGNATURE: 5,
    TRUNCATED: 6,
} as const;

/** Mirror of the `rom_input_limit` enum in scratch/src/rom_input.gs. */
export const ROM_INPUT_LIMIT = {
    MAX_BYTES: 200_000,
    MAX_TEXT_CHARS: 1_000_000,
} as const;

/**
 * Mirror of scratch/src/rom_input.gs: the decode that rebuilds a cartridge image from a
 * pasted string of hexadecimal byte values, the header pre-check that decides whether the
 * staged bytes may replace the running image, and the copy that installs them.
 *
 * The ported decode is the runtime half of the format src/nes/cartridge/rom_text.ts defines,
 * and the converter page encodes with the other half, so tests/rom-text.test.ts compares this
 * class against that reference over encoded images and corrupted text.
 *
 * Scratch lists and strings are both 1-indexed, so the port reads `rom_input_text[cursor]`
 * and `rom_input_bytes[index]`; this mirror keeps zero-based arrays and converts at the two
 * places the port indexes, the way GoboscriptControllerPorts does. Two hexadecimal digits make
 * one byte; any other character is ignored, and a leftover digit at the end is reported as
 * odd-digits, exactly as the port does.
 */
export class GoboscriptRomInput {
    /** Mirror of the `rom_input_text` variable, the pasted answer. */
    rom_input_text = "";

    /** Mirror of the `rom_input_bytes` staging list. */
    rom_input_bytes: number[] = [];

    /** Mirror of `cartridge_bytes`, the embedded image list the install replaces. */
    cartridge_bytes: number[] = [];

    /** Mirror of the `rom_input_byte_count`, `rom_input_error_code`, and declared-size globals. */
    rom_input_byte_count = 0;
    rom_input_error_code = 0;
    rom_input_declared_bytes = 0;

    /** Mirror of `proc rom_input_parse_text`. */
    parse_text(): void {
        this.rom_input_error_code = ROM_INPUT_ERROR.NONE;
        this.rom_input_byte_count = 0;
        this.rom_input_declared_bytes = 0;
        this.rom_input_bytes = [];

        const text_length = this.rom_input_text.length;

        if (text_length > ROM_INPUT_LIMIT.MAX_TEXT_CHARS) {
            this.rom_input_error_code = ROM_INPUT_ERROR.TOO_LONG;
            return;
        }

        let cursor = 1;
        let nibble_value = 0;
        let pending_nibble = 0;
        let has_pending_nibble = 0;

        while (cursor <= text_length && this.rom_input_error_code === ROM_INPUT_ERROR.NONE) {
            const character = this.rom_input_text.slice(cursor - 1, cursor);

            if (character === "0") {
                nibble_value = 0;
            } else {
                nibble_value = to_number(`0x${character}`);
            }

            if (nibble_value > 0 || character === "0") {
                if (has_pending_nibble === 0) {
                    pending_nibble = nibble_value;
                    has_pending_nibble = 1;
                } else if (this.rom_input_bytes.length >= ROM_INPUT_LIMIT.MAX_BYTES) {
                    this.rom_input_error_code = ROM_INPUT_ERROR.TOO_MANY_BYTES;
                } else {
                    this.rom_input_bytes.push(pending_nibble * 16 + nibble_value);
                    this.rom_input_byte_count += 1;
                    pending_nibble = 0;
                    has_pending_nibble = 0;
                }
            }

            cursor += 1;
        }

        if (this.rom_input_error_code === ROM_INPUT_ERROR.NONE) {
            if (has_pending_nibble === 1) {
                this.rom_input_error_code = ROM_INPUT_ERROR.ODD_DIGITS;
            } else if (this.rom_input_byte_count === 0) {
                this.rom_input_error_code = ROM_INPUT_ERROR.EMPTY;
            }
        }
    }

    /** Mirror of `func rom_input_has_signature()`. */
    has_signature(): number {
        return this.staged_byte(1) === 78
            && this.staged_byte(2) === 69
            && this.staged_byte(3) === 83
            && this.staged_byte(4) === 26
            ? 1
            : 0;
    }

    /** Mirror of `proc rom_input_validate_image`. */
    validate_image(): void {
        if (this.rom_input_error_code !== ROM_INPUT_ERROR.NONE) {
            return;
        }

        if (this.rom_input_byte_count < CARTRIDGE_LIMIT.HEADER_BYTES) {
            this.rom_input_error_code = ROM_INPUT_ERROR.TRUNCATED;
            return;
        }

        if (this.has_signature() === 0) {
            this.rom_input_error_code = ROM_INPUT_ERROR.SIGNATURE;
            return;
        }

        const prg_banks = this.staged_byte(5);
        const chr_banks = this.staged_byte(6);
        const flags6 = this.staged_byte(7);
        const flags7 = this.staged_byte(8);
        const trainer_bytes = bit_at(flags6, 4) === 1 ? CARTRIDGE_LIMIT.TRAINER_BYTES : 0;
        const declared_bytes =
            CARTRIDGE_LIMIT.HEADER_BYTES
            + prg_banks * CARTRIDGE_LIMIT.PRG_BANK_BYTES
            + chr_banks * CARTRIDGE_LIMIT.CHR_BANK_BYTES
            + trainer_bytes;

        this.rom_input_declared_bytes = declared_bytes;

        // A NES 2.0 header encodes its sizes differently; the port leaves those to the
        // loader's own header parse instead of guessing here.
        if (bitwise_and(flags7, 12) !== 8) {
            if (declared_bytes > ROM_INPUT_LIMIT.MAX_BYTES) {
                this.rom_input_error_code = ROM_INPUT_ERROR.TOO_MANY_BYTES;
            } else if (this.rom_input_byte_count < declared_bytes) {
                this.rom_input_error_code = ROM_INPUT_ERROR.TRUNCATED;
            }
        }
    }

    /** Mirror of `proc rom_input_install_image`. */
    install_image(): void {
        const staged_bytes = this.rom_input_bytes.length;
        this.cartridge_bytes = [];

        for (let index = 1; index <= staged_bytes; index += 1) {
            this.cartridge_bytes.push(this.staged_byte(index));
        }

        this.rom_input_bytes = [];
    }

    /** Reads the staged list at the port's 1-based position. */
    private staged_byte(position: number): number {
        return this.rom_input_bytes[position - 1] ?? 0;
    }
}

/**
 * Mirror of scratch/src/cpu_bus.gs: RAM with mirroring, the open-bus latch with driven
 * masks, the controller window, and the OAM DMA state machine. The ported PPU and APU have
 * no mirror here, so their windows stay undriven, which is what an absent device does in
 * the TypeScript decoder: reads return the retained latch and writes are dropped.
 *
 * The attachment flags mirror the port's `cpu_bus_ppu_attached`, `cpu_bus_apu_attached`,
 * and `cpu_bus_controllers_attached`. The shared-vector replay detaches the devices the
 * TypeScript reference replays without, so both sides see the same open-bus behavior.
 */
export class GoboscriptCpuBus {
    readonly controllers = new GoboscriptControllerPorts();
    private readonly ram = new Array<number>(2048).fill(0);
    private open_bus = 0;

    /** Mirror of `cpu_bus_cartridge_kind`: the board the loader attached, if any. */
    cartridge_kind: number = MAPPER_KIND.NONE;

    /** Mirror of `cpu_bus_controllers_attached`. */
    controllers_attached: boolean = true;

    /** Mirror of `cpu_bus_ppu_attached`. The ported PPU has no mirror, so the window stays undriven. */
    ppu_attached: boolean = false;

    /** Mirror of `cpu_bus_apu_attached`. The ported APU has no mirror, so the window stays undriven. */
    apu_attached: boolean = false;

    /** The attached NROM board, or null while the cartridge window has no device. */
    board: GoboscriptNromMapper | null = null;

    /** The attached MMC3 board, or null. Only one of the two boards is attached at a time. */
    mmc3_board: GoboscriptMmc3Mapper | null = null;

    reset(): void {
        this.open_bus = 0;
        this.bus_cycle_count = 0;

        // `NesCpuBus.reset()` drops a pending OAM DMA transfer, so the mirror does too.
        this.dma_phase = 0;
        this.dma_index = 0;
        this.dma_data_latch = 0;
        this.dma_sequence_cycle = 0;
        this.dma_alignment_cycle_needed = 0;
    }

    /**
     * Mirror of `cartridge_board_irq_line()`. The loader composes it, and the bus is what holds the
     * attached board, so the mirror lives here: an MMC3 board drives its scanline counter and any
     * other cartridge window drives nothing.
     */
    board_irq_line(): number {
        if (this.cartridge_kind === MAPPER_KIND.MMC3 && this.mmc3_board !== null) {
            return this.mmc3_board.get_irq_line_asserted();
        }

        return 0;
    }

    /** Mirror of `cpu_bus_clear_ram`. */
    clear_ram(): void {
        this.ram.fill(0);
    }

    /**
     * Mirror of `port_detach_bus_devices`: every device window goes undriven, so reads
     * return the retained latch and writes are dropped.
     */
    detach_devices(): void {
        this.ppu_attached = false;
        this.apu_attached = false;
        this.controllers_attached = false;
        this.cartridge_kind = MAPPER_KIND.NONE;
    }

    get_open_bus(): number {
        return this.open_bus;
    }

    read(address: number): number {
        const numeric_address = normalize_word(address);
        this.bus_cycle_count = this.bus_cycle_count + 1;

        if (numeric_address < 8192) {
            const ram_value = this.ram[scratch_mod(numeric_address, 2048)] ?? 0;
            this.open_bus = ram_value;

            return ram_value;
        }

        if (numeric_address < 16384) {
            return this.open_bus;
        }

        if (numeric_address < 16416) {
            return this.read_io(numeric_address);
        }

        if (this.cartridge_kind === MAPPER_KIND.NROM && this.board !== null) {
            this.board.read_cpu(numeric_address);

            if (this.board.cpu_mapped === 1) {
                return this.apply_driven_value(this.board.cpu_value, this.board.cpu_driven_mask);
            }
        } else if (this.cartridge_kind === MAPPER_KIND.MMC3 && this.mmc3_board !== null) {
            this.mmc3_board.read_cpu(numeric_address);

            if (this.mmc3_board.cpu_mapped === 1) {
                return this.apply_driven_value(this.mmc3_board.cpu_value, this.mmc3_board.cpu_driven_mask);
            }
        }

        return this.open_bus;
    }

    write(address: number, value: number): void {
        const numeric_address = normalize_word(address);
        const numeric_value = normalize_byte(value);
        this.open_bus = numeric_value;
        this.bus_cycle_count = this.bus_cycle_count + 1;

        if (numeric_address < 8192) {
            this.ram[scratch_mod(numeric_address, 2048)] = numeric_value;
        }

        if (numeric_address === 16406 && this.controllers_attached) {
            this.controllers.write_strobe(numeric_value);
        }

        // $4014 OAM DMA: set up the DMA state machine
        if (numeric_address === 16404) {
            this.dma_phase = 1; // halt
            this.dma_page = numeric_value;
            this.dma_index = 0;
            this.dma_data_latch = 0;
            this.dma_sequence_cycle = 0;
            this.dma_alignment_cycle_needed = this.bus_cycle_count % 2;
        }

        if (this.cartridge_kind === MAPPER_KIND.NROM && this.board !== null) {
            this.board.write_cpu(numeric_address, numeric_value);
        } else if (this.cartridge_kind === MAPPER_KIND.MMC3 && this.mmc3_board !== null) {
            this.mmc3_board.write_cpu(numeric_address, numeric_value);
        }
    }

    private read_io(address: number): number {
        if (address === 16406 && this.controllers_attached) {
            return this.apply_driven_value(this.controllers.serial_read(0), 1);
        }

        if (address === 16407 && this.controllers_attached) {
            return this.apply_driven_value(this.controllers.serial_read(1), 1);
        }

        return this.open_bus;
    }

    private apply_driven_value(value: number, driven_mask: number): number {
        // The full-byte test comes first, before either normalization, exactly as the port's
        // cpu_apply_driven_value does: both masks a device here drives are literal 255 or 1.
        if (driven_mask === 255) {
            this.open_bus = scratch_mod(value, 256);

            return this.open_bus;
        }

        const driven = scratch_mod(driven_mask, 256);

        if (driven === 0) {
            return this.open_bus;
        }

        const numeric_value = scratch_mod(value, 256);
        this.open_bus = bitwise_and_byte(numeric_value, driven) + bitwise_and_byte(this.open_bus, 255 - driven);

        return this.open_bus;
    }

    // OAM DMA state machine
    private dma_phase: number = 0; // 0=idle, 1=halt, 2=align, 3=read, 4=write
    private dma_page: number = 0;
    private dma_index: number = 0;
    private dma_data_latch: number = 0;
    private dma_sequence_cycle: number = 0;
    private dma_alignment_cycle_needed: number = 0;
    private bus_cycle_count: number = 0;

    /**
     * Mirror of `cpu_bus_run_dma`: runs a pending transfer to completion and returns the cycles
     * it spent. The port inlines the whole state machine in one proc; this mirror drives the
     * one-cycle form, which is the same sequence.
     */
    run_dma(): number {
        let cycles = 0;

        while (this.dma_phase !== 0 && cycles < 520) {
            if (this.clock_dma_cycle() === 0) {
                break;
            }

            cycles += 1;
        }

        return cycles;
    }

    /** Mirror of `cpu_clock_dma_cycle`. Returns 1 if a DMA cycle was executed, 0 otherwise. */
    clock_dma_cycle(): number {
        if (this.dma_phase === 0) {
            return 0;
        }

        this.dma_sequence_cycle = this.dma_sequence_cycle + 1;
        this.bus_cycle_count = this.bus_cycle_count + 1;

        if (this.dma_phase === 1) {
            // Halt phase
            if (this.dma_alignment_cycle_needed === 1) {
                this.dma_phase = 2;
            } else {
                this.dma_phase = 3;
            }
            return 1;
        }

        if (this.dma_phase === 2) {
            // Align phase
            this.dma_phase = 3;
            return 1;
        }

        if (this.dma_phase === 3) {
            // Read phase
            const source_address = this.dma_page * 256 + this.dma_index;
            this.dma_data_latch = this.read(source_address);
            this.dma_phase = 4;
            return 1;
        }

        if (this.dma_phase === 4) {
            // Write phase
            // Write to $2004 (PPU OAMDATA register)
            this.write(0x2004, this.dma_data_latch);
            this.dma_index = this.dma_index + 1;

            if (this.dma_index >= 256) {
                // Transfer complete
                this.dma_phase = 0;
            } else {
                // Continue with next read
                this.dma_phase = 3;
            }
            return 1;
        }

        return 0;
    }
}

/** Mirror of the `cartridge_limit` enum in scratch/src/cartridge.gs. */
export const CARTRIDGE_LIMIT = {
    MAX_IMAGE_BYTES: 33_554_432,
    HEADER_BYTES: 16,
    TRAINER_BYTES: 512,
    PRG_BANK_BYTES: 16_384,
    CHR_BANK_BYTES: 8_192,
    LEGACY_PRG_RAM_BANK_BYTES: 8_192,
    RAM_SHIFT_BASE_BYTES: 64,
    MAX_SAFE_INTEGER: 9_007_199_254_740_991,
} as const;

/** Mirror of the `cartridge_error` enum in scratch/src/cartridge.gs. */
export const CARTRIDGE_ERROR = {
    NONE: 0,
    TRUNCATED_HEADER: 1,
    INVALID_MAGIC: 2,
    UNSUPPORTED_VERSION: 3,
    INVALID_ROM_SIZE: 4,
    IMAGE_TOO_LARGE: 5,
    TRUNCATED_PAYLOAD: 6,
} as const;

/**
 * Mirror of scratch/src/cartridge.gs. The ported proc reads a 16-item header list plus an
 * image length and writes eighteen `cartridge_*` globals, because a Scratch custom block can
 * take no list argument and return no tuple; this class keeps the same shape so the arity
 * parity check in tests/goboscript-source.test.ts stays meaningful.
 */
export class GoboscriptCartridgeParser {
    readonly header: number[] = new Array<number>(CARTRIDGE_LIMIT.HEADER_BYTES).fill(0);
    image_bytes = 0;
    ok = 0;
    error_code = 0;
    format = 0;
    mapper_id = 0;
    submapper = 0;
    mirroring = 0;
    battery_backed = 0;
    has_trainer = 0;
    prg_rom_bytes = 0;
    chr_rom_bytes = 0;
    prg_ram_bytes = 0;
    prg_nvram_bytes = 0;
    chr_ram_bytes = 0;
    chr_nvram_bytes = 0;
    trainer_offset = 0;
    prg_rom_offset = 0;
    chr_rom_offset = 0;
    payload_end = 0;

    /** Mirror of `header_byte(index)`; the argument is a 0-based header index. */
    header_byte(index: number): number {
        // The ported func reads cartridge_header[index + 1] from a 1-indexed Scratch list.
        return normalize_byte(this.header[index] ?? 0);
    }

    /** Mirror of `cartridge_has_magic()`. */
    cartridge_has_magic(): number {
        if (this.header_byte(0) !== 78) {
            return 0;
        }

        if (this.header_byte(1) !== 69) {
            return 0;
        }

        if (this.header_byte(2) !== 83) {
            return 0;
        }

        if (this.header_byte(3) !== 26) {
            return 0;
        }

        return 1;
    }

    /** Mirror of `cartridge_reset_results`. */
    reset(): void {
        this.ok = 0;
        this.error_code = 0;
        this.format = 0;
        this.mapper_id = 0;
        this.submapper = 0;
        this.mirroring = 0;
        this.battery_backed = 0;
        this.has_trainer = 0;
        this.prg_rom_bytes = 0;
        this.chr_rom_bytes = 0;
        this.prg_ram_bytes = 0;
        this.prg_nvram_bytes = 0;
        this.chr_ram_bytes = 0;
        this.chr_nvram_bytes = 0;
        this.trainer_offset = 0;
        this.prg_rom_offset = 0;
        this.chr_rom_offset = 0;
        this.payload_end = 0;
    }

    /** Mirror of `cartridge_fail error_code`. */
    fail(error_code: number): void {
        this.reset();
        this.error_code = error_code;
    }

    /** Mirror of `cartridge_parse_header`, including the TypeScript reference's check order. */
    parse(): void {
        const image_bytes = to_number(this.image_bytes);
        const flags6 = this.header_byte(6);
        const flags7 = this.header_byte(7);
        const version_bits = bitwise_and(flags7, 12);
        const prg_banks = this.header_byte(4);
        const chr_banks = this.header_byte(5);
        const prg_ram_banks = this.header_byte(8);
        const size_high = this.header_byte(9);
        const ram_sizes = this.header_byte(10);
        const chr_ram_sizes = this.header_byte(11);
        let is_nes2 = 0;
        let prg_rom_bytes = 0;
        let chr_rom_bytes = 0;
        let prg_ram_bytes = 0;
        let prg_nvram_bytes = 0;
        let chr_ram_bytes = 0;
        let chr_nvram_bytes = 0;
        this.reset();

        if (image_bytes > CARTRIDGE_LIMIT.MAX_IMAGE_BYTES) {
            this.fail(CARTRIDGE_ERROR.IMAGE_TOO_LARGE);
            return;
        }

        if (image_bytes < CARTRIDGE_LIMIT.HEADER_BYTES) {
            this.fail(CARTRIDGE_ERROR.TRUNCATED_HEADER);
            return;
        }

        if (this.cartridge_has_magic() === 0) {
            this.fail(CARTRIDGE_ERROR.INVALID_MAGIC);
            return;
        }

        if (version_bits !== 0 && version_bits !== 8) {
            this.fail(CARTRIDGE_ERROR.UNSUPPORTED_VERSION);
            return;
        }

        if (version_bits === 8) {
            is_nes2 = 1;
            this.format = 2;
        } else {
            this.format = 1;
        }

        const low_mapper_nibble = bitwise_and(scratch_floor_divide(flags6, 16), 15);
        const high_mapper_bits = bitwise_and(flags7, 240);
        this.mapper_id = bitwise_or(low_mapper_nibble, high_mapper_bits);
        this.has_trainer = bit_at(flags6, 4);
        this.battery_backed = bit_at(flags6, 2);

        if (bit_at(flags6, 8) === 1) {
            this.mirroring = 3;
        } else if (bit_at(flags6, 1) === 1) {
            this.mirroring = 2;
        } else {
            this.mirroring = 1;
        }

        if (is_nes2 === 1) {
            const nes2_mapper_bits = bitwise_and(prg_ram_banks, 15) * 256;
            this.mapper_id = bitwise_or(this.mapper_id, nes2_mapper_bits);
            this.submapper = scratch_floor_divide(prg_ram_banks, 16);
            prg_rom_bytes = decode_nes2_rom_size(
                prg_banks,
                bitwise_and(size_high, 15),
                CARTRIDGE_LIMIT.PRG_BANK_BYTES,
            );
            chr_rom_bytes = decode_nes2_rom_size(
                chr_banks,
                scratch_floor_divide(size_high, 16),
                CARTRIDGE_LIMIT.CHR_BANK_BYTES,
            );
            prg_ram_bytes = decode_nes2_ram_size(bitwise_and(ram_sizes, 15));
            prg_nvram_bytes = decode_nes2_ram_size(scratch_floor_divide(ram_sizes, 16));
            chr_ram_bytes = decode_nes2_ram_size(bitwise_and(chr_ram_sizes, 15));
            chr_nvram_bytes = decode_nes2_ram_size(scratch_floor_divide(chr_ram_sizes, 16));
        } else {
            prg_rom_bytes = prg_banks * CARTRIDGE_LIMIT.PRG_BANK_BYTES;
            chr_rom_bytes = chr_banks * CARTRIDGE_LIMIT.CHR_BANK_BYTES;

            const legacy_banks = prg_ram_banks === 0 ? 1 : prg_ram_banks;
            const legacy_prg_ram_bytes = legacy_banks * CARTRIDGE_LIMIT.LEGACY_PRG_RAM_BANK_BYTES;

            if (this.battery_backed === 1) {
                prg_nvram_bytes = legacy_prg_ram_bytes;
            } else {
                prg_ram_bytes = legacy_prg_ram_bytes;
            }

            if (chr_rom_bytes === 0) {
                chr_ram_bytes = CARTRIDGE_LIMIT.CHR_BANK_BYTES;
            }
        }

        if (prg_rom_bytes <= 0 || chr_rom_bytes < 0) {
            this.fail(CARTRIDGE_ERROR.INVALID_ROM_SIZE);
            return;
        }

        if (is_safe_size(prg_rom_bytes) === 0 || is_safe_size(chr_rom_bytes) === 0) {
            this.fail(CARTRIDGE_ERROR.INVALID_ROM_SIZE);
            return;
        }

        const trainer_offset = CARTRIDGE_LIMIT.HEADER_BYTES;
        const prg_rom_offset = trainer_offset + this.has_trainer * CARTRIDGE_LIMIT.TRAINER_BYTES;
        const chr_rom_offset = prg_rom_offset + prg_rom_bytes;
        const payload_end = chr_rom_offset + chr_rom_bytes;

        if (is_safe_size(payload_end) === 0) {
            this.fail(CARTRIDGE_ERROR.INVALID_ROM_SIZE);
            return;
        }

        if (payload_end > CARTRIDGE_LIMIT.MAX_IMAGE_BYTES) {
            this.fail(CARTRIDGE_ERROR.IMAGE_TOO_LARGE);
            return;
        }

        if (payload_end > image_bytes) {
            this.fail(CARTRIDGE_ERROR.TRUNCATED_PAYLOAD);
            return;
        }

        this.prg_rom_bytes = prg_rom_bytes;
        this.chr_rom_bytes = chr_rom_bytes;
        this.prg_ram_bytes = prg_ram_bytes;
        this.prg_nvram_bytes = prg_nvram_bytes;
        this.chr_ram_bytes = chr_ram_bytes;
        this.chr_nvram_bytes = chr_nvram_bytes;
        this.trainer_offset = trainer_offset;
        this.prg_rom_offset = prg_rom_offset;
        this.chr_rom_offset = chr_rom_offset;
        this.payload_end = payload_end;
        this.error_code = CARTRIDGE_ERROR.NONE;
        this.ok = 1;
    }

    /** The eighteen reported values, in shared vector suite 9 field order. */
    reported_values(): number[] {
        return [
            this.ok,
            this.error_code,
            this.format,
            this.mapper_id,
            this.submapper,
            this.mirroring,
            this.battery_backed,
            this.has_trainer,
            this.prg_rom_bytes,
            this.chr_rom_bytes,
            this.prg_ram_bytes,
            this.prg_nvram_bytes,
            this.chr_ram_bytes,
            this.chr_nvram_bytes,
            this.trainer_offset,
            this.prg_rom_offset,
            this.chr_rom_offset,
            this.payload_end,
        ];
    }
}

/** Mirror of `power_of_two(exponent)`. */
export function power_of_two(exponent: number): number {
    let result = 1;

    for (let iteration = 0; iteration < exponent; iteration += 1) {
        result = result * 2;
    }

    return result;
}

/** Mirror of `is_safe_size(value)`. */
export function is_safe_size(value: number): number {
    const numeric = to_number(value);

    if (numeric > CARTRIDGE_LIMIT.MAX_SAFE_INTEGER) {
        return 0;
    }

    if (numeric < 0 - CARTRIDGE_LIMIT.MAX_SAFE_INTEGER) {
        return 0;
    }

    return 1;
}

/** Mirror of `decode_nes2_rom_size(low_byte, high_nibble, bank_bytes)`; -1 means undefined. */
export function decode_nes2_rom_size(low_byte: number, high_nibble: number, bank_bytes: number): number {
    if (high_nibble !== 15) {
        return (high_nibble * 256 + low_byte) * bank_bytes;
    }

    const exponent = scratch_floor_divide(low_byte, 4);
    const multiplier = scratch_mod(low_byte, 4) * 2 + 1;
    const size_bytes = power_of_two(exponent) * multiplier;

    if (is_safe_size(size_bytes) === 0) {
        return -1;
    }

    return size_bytes;
}

/** Mirror of `decode_nes2_ram_size(shift)`. */
export function decode_nes2_ram_size(shift: number): number {
    if (shift === 0) {
        return 0;
    }

    return CARTRIDGE_LIMIT.RAM_SHIFT_BASE_BYTES * power_of_two(shift);
}

/** Mirror of the `cpu_addressing_mode` enum in scratch/src/cpu_addressing.gs. */
export const CPU_ADDRESSING_MODE = {
    IMPLIED: 1,
    ACCUMULATOR: 2,
    IMMEDIATE: 3,
    RELATIVE: 4,
    ZERO_PAGE: 5,
    ZERO_PAGE_X: 6,
    ZERO_PAGE_Y: 7,
    ABSOLUTE: 8,
    ABSOLUTE_X: 9,
    ABSOLUTE_Y: 10,
    INDIRECT: 11,
    INDEXED_INDIRECT: 12,
    INDIRECT_INDEXED: 13,
} as const;

/** Mirror of the `cpu_operand_access` enum in scratch/src/cpu_addressing.gs. */
export const CPU_OPERAND_ACCESS = { READ: 1, WRITE: 2, READ_MODIFY_WRITE: 3 } as const;

/** Mirror of the `cpu_operand_kind` enum in scratch/src/cpu_addressing.gs. */
export const CPU_OPERAND_KIND = {
    NONE: 0,
    IMPLIED: 1,
    ACCUMULATOR: 2,
    IMMEDIATE: 3,
    RELATIVE: 4,
    MEMORY: 5,
    JUMP_TARGET: 6,
} as const;

/** Mirror of the `cpu_operand_error_code` enum in scratch/src/cpu_addressing.gs. */
export const CPU_OPERAND_ERROR_CODE = { NONE: 0, UNSUPPORTED_ACCESS: 1, UNKNOWN_MODE: 2 } as const;

/** Mirror of the `cpu_access_kind` enum in scratch/src/cpu_core.gs. */
export const CPU_ACCESS_KIND = { READ: 0, WRITE: 1 } as const;

/** Mirror of the `cpu_sequence_op` enum in scratch/src/cpu_sequence.gs. */
export const CPU_SEQUENCE_OP = {
    RESET: 1,
    BRK: 2,
    JSR: 3,
    RTI: 4,
    RTS: 5,
    IRQ: 6,
    NMI: 7,
    RELATIVE_BRANCH: 8,
} as const;

/** Mirror of the `cpu_interrupt_source` enum in scratch/src/cpu_sequence.gs. */
export const CPU_INTERRUPT_SOURCE = { NMI: 1, IRQ: 2 } as const;

/** Mirror of the `cpu_sequence_error_code` enum in scratch/src/cpu_sequence.gs. */
export const CPU_SEQUENCE_ERROR_CODE = { NONE: 0, NOT_RELATIVE_OPERAND: 1 } as const;

/** Mirror of the `mapper_kind` enum in scratch/src/mapper.gs. */
export const MAPPER_KIND = { NONE: 0, NROM: 1, MMC3: 2 } as const;

/** Mirror of the `mapper_selection_error` enum in scratch/src/mapper.gs. */
export const MAPPER_SELECTION_ERROR = { NONE: 0, UNSUPPORTED_MAPPER: 1, UNSUPPORTED_SUBMAPPER: 2 } as const;

/** Mirror of the `mapper_error` enum in scratch/src/mapper.gs. */
export const MAPPER_ERROR = {
    NONE: 0,
    UNSUPPORTED_MAPPER: 1,
    UNSUPPORTED_SUBMAPPER: 2,
    WRONG_MAPPER_FAMILY: 3,
    UNSUPPORTED_PRG_ROM_SIZE: 4,
    UNSUPPORTED_PRG_RAM_SIZE: 5,
    UNSUPPORTED_TRAINER: 6,
    UNSUPPORTED_CHR_MEMORY: 7,
} as const;

/** Mirror of the `nrom_limit` enum in scratch/src/mapper_000.gs. */
export const NROM_LIMIT = {
    PRG_RAM_BYTES: 8192,
    PRG_ROM_16K_BYTES: 16384,
    PRG_ROM_32K_BYTES: 32768,
    PATTERN_BYTES: 8192,
} as const;

/** Mirror of `mapper_sum_memory_sizes(first, second)`. */
export function mapper_sum_memory_sizes(first: number, second: number): number {
    if (first < 0) {
        return -1;
    }

    if (second < 0) {
        return -1;
    }

    return first + second;
}

/** Mirror of the `nrom_memory_op` enum in scratch/src/mapper_000.gs. */
export const NROM_MEMORY_OP = {
    CPU_READ: 1,
    CPU_WRITE: 2,
    PATTERN_READ: 3,
    PATTERN_WRITE: 4,
    GET_PRG_NVRAM: 5,
    LOAD_PRG_NVRAM: 6,
    GET_CHR_NVRAM: 7,
    LOAD_CHR_NVRAM: 8,
    READ_PRG_NVRAM_BYTE: 9,
    READ_CHR_NVRAM_BYTE: 10,
} as const;

/** Mirror of the `nrom_window` enum in scratch/src/mapper_000.gs. */
export const NROM_WINDOW = {
    PRG_RAM_START: 0x6000,
    PRG_ROM_START: 0x8000,
    TRAINER_BYTES: 512,
    TRAINER_PRG_RAM_OFFSET: 0x1000,
    FULL_BYTE_MASK: 255,
} as const;

/**
 * Mirror of reading one Scratch list position through `to_number`: a position past the end of the
 * list is empty, and `to_number` turns that into the zero the reference's copied image holds there.
 */
function list_byte(list: readonly number[], index: number): number {
    const value = list[index];
    return value === undefined ? 0 : to_number(value);
}

/**
 * Mirror of scratch/src/mapper.gs. Selection routes an exact mapper and submapper pair, so a known
 * mapper with an unregistered submapper reports a different code than an unknown mapper.
 */
export class GoboscriptMapperSelection {
    kind: number = MAPPER_KIND.NONE;
    error_code: number = MAPPER_SELECTION_ERROR.NONE;
    mapper_id = 0;
    submapper = 0;

    /** Mirror of `mapper_resolve mapper_id, submapper`. */
    resolve(mapper_id: number, submapper: number): void {
        this.mapper_id = mapper_id;
        this.submapper = submapper;
        this.kind = MAPPER_KIND.NONE;
        this.error_code = MAPPER_SELECTION_ERROR.NONE;

        if (mapper_id === 0 && submapper === 0) {
            this.kind = MAPPER_KIND.NROM;
        } else if (mapper_id === 4 && submapper === 0) {
            this.kind = MAPPER_KIND.MMC3;
        } else if (mapper_id === 0 || mapper_id === 4) {
            this.error_code = MAPPER_SELECTION_ERROR.UNSUPPORTED_SUBMAPPER;
        } else {
            this.error_code = MAPPER_SELECTION_ERROR.UNSUPPORTED_MAPPER;
        }
    }
}

/**
 * Mirror of scratch/src/mapper_000.gs. The fields named after the parsed header stand for the
 * `cartridge_*` globals the ported validation reads, and the rest stand for the `nrom_*` globals it
 * writes. Storage, the CPU and pattern windows, and the trainer copy are not ported yet, so this
 * mirror only decides whether a board is acceptable and which sizes it would map.
 */
export class GoboscriptNromMapper {
    mapper_id = 0;
    submapper = 0;
    prg_rom_bytes = 0;
    chr_rom_bytes = 0;
    prg_ram_bytes = 0;
    prg_nvram_bytes = 0;
    chr_ram_bytes = 0;
    chr_nvram_bytes = 0;
    has_trainer = 0;

    prg_rom_offset = 0;
    chr_rom_offset = 0;
    trainer_offset = 0;

    ok = 0;
    error_code: number = MAPPER_ERROR.NONE;
    kind: number = MAPPER_KIND.NONE;
    mapped_prg_ram_bytes = 0;
    mapped_chr_ram_bytes = 0;

    /**
     * Mirror of the Stage-owned `cartridge_bytes` list that `nrom_load_payload` copies from. Tests
     * load the image a record describes; the project loads the generated ROM list.
     */
    cartridge_bytes: readonly number[] = [];

    /** Mirrors of the board's four memory lists, each sized to the bytes the board declares. */
    readonly prg_rom: number[] = [];
    readonly chr_rom: number[] = [];
    readonly prg_ram: number[] = new Array<number>(NROM_LIMIT.PRG_RAM_BYTES).fill(0);
    readonly chr_ram: number[] = new Array<number>(NROM_LIMIT.PATTERN_BYTES).fill(0);

    cpu_mapped = 0;
    cpu_value = 0;
    cpu_driven_mask = 0;
    cpu_write_accepted = 0;
    pattern_value = 0;
    pattern_write_accepted = 0;
    nvram_loaded = 0;

    /** Mirrors the cartridge_mirroring global the PPU bus reads for NROM nametable routing. */
    mirroring = 1;

    /** Mirrors of the two snapshot buffers the ported board copies its nonvolatile tails through. */
    readonly prg_nvram_snapshot: number[] = [];
    readonly chr_nvram_snapshot: number[] = [];

    readonly selection = new GoboscriptMapperSelection();

    /** Mirror of `nrom_reset_results`. */
    reset_results(): void {
        this.ok = 0;
        this.error_code = MAPPER_ERROR.NONE;
        this.kind = MAPPER_KIND.NONE;
        this.mapped_prg_ram_bytes = 0;
        this.mapped_chr_ram_bytes = 0;
    }

    /** Mirror of `nrom_validate`. */
    validate(): void {
        this.reset_results();
        this.selection.resolve(this.mapper_id, this.submapper);

        if (this.selection.error_code !== MAPPER_SELECTION_ERROR.NONE) {
            this.error_code = this.selection.error_code;
        } else if (this.selection.kind !== MAPPER_KIND.NROM) {
            this.error_code = MAPPER_ERROR.WRONG_MAPPER_FAMILY;
        } else {
            this.check_prg_rom();
        }
    }

    /** Mirror of `nrom_check_prg_rom`. */
    check_prg_rom(): void {
        let prg_rom_ok = 0;

        if (this.prg_rom_bytes === NROM_LIMIT.PRG_ROM_16K_BYTES) {
            prg_rom_ok = 1;
        } else if (this.prg_rom_bytes === NROM_LIMIT.PRG_ROM_32K_BYTES) {
            prg_rom_ok = 1;
        }

        if (prg_rom_ok === 0) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_PRG_ROM_SIZE;
        } else {
            this.accept_prg_rom();
        }
    }

    /** Mirror of `nrom_accept_prg_rom`. */
    accept_prg_rom(): void {
        this.apply_memory_limits(
            mapper_sum_memory_sizes(this.prg_ram_bytes, this.prg_nvram_bytes),
            mapper_sum_memory_sizes(this.chr_ram_bytes, this.chr_nvram_bytes),
        );
    }

    /** Mirror of `nrom_apply_memory_limits prg_ram_bytes, chr_ram_bytes`. */
    apply_memory_limits(prg_ram_bytes: number, chr_ram_bytes: number): void {
        let has_chr_rom = 0;
        let chr_ok = 0;

        if (this.chr_rom_bytes !== 0) {
            has_chr_rom = 1;
        }

        if (has_chr_rom === 1 && this.chr_rom_bytes === NROM_LIMIT.PATTERN_BYTES && chr_ram_bytes === 0) {
            chr_ok = 1;
        } else if (has_chr_rom === 0 && chr_ram_bytes > 0 && chr_ram_bytes <= NROM_LIMIT.PATTERN_BYTES) {
            chr_ok = 1;
        }

        if (prg_ram_bytes < 0 || prg_ram_bytes > NROM_LIMIT.PRG_RAM_BYTES) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_PRG_RAM_SIZE;
        } else if (this.has_trainer === 1 && prg_ram_bytes === 0) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_TRAINER;
        } else if (chr_ok === 0) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_CHR_MEMORY;
        } else {
            this.ok = 1;
            this.kind = MAPPER_KIND.NROM;
            this.mapped_prg_ram_bytes = prg_ram_bytes;

            if (has_chr_rom === 0) {
                this.mapped_chr_ram_bytes = chr_ram_bytes;
            }
        }
    }

    /** Mirror of `nrom_reset_memory`. */
    reset_memory(): void {
        this.prg_rom.length = 0;
        this.chr_rom.length = 0;

        for (let index = 0; index < this.prg_rom_bytes; index += 1) {
            this.prg_rom.push(0);
        }

        for (let index = 0; index < this.chr_rom_bytes; index += 1) {
            this.chr_rom.push(0);
        }

        this.prg_ram.fill(0);
        this.chr_ram.fill(0);
    }

    /** Mirror of `nrom_copy_prg_rom`. */
    copy_prg_rom(): void {
        for (let index = 0; index < this.prg_rom_bytes; index += 1) {
            this.prg_rom[index] = list_byte(this.cartridge_bytes, this.prg_rom_offset + index);
        }
    }

    /** Mirror of `nrom_copy_chr_rom`. */
    copy_chr_rom(): void {
        for (let index = 0; index < this.chr_rom_bytes; index += 1) {
            this.chr_rom[index] = list_byte(this.cartridge_bytes, this.chr_rom_offset + index);
        }
    }

    /** Mirror of `nrom_copy_trainer`. */
    copy_trainer(): void {
        if (this.has_trainer !== 1 || this.mapped_prg_ram_bytes <= 0) {
            return;
        }

        for (let index = 0; index < NROM_WINDOW.TRAINER_BYTES; index += 1) {
            const ram_index = (NROM_WINDOW.TRAINER_PRG_RAM_OFFSET + index) % this.mapped_prg_ram_bytes;
            this.prg_ram[ram_index] = list_byte(this.cartridge_bytes, this.trainer_offset + index);
        }
    }

    /** Mirror of `nrom_load_payload`. */
    load_payload(): void {
        this.reset_memory();
        this.copy_prg_rom();
        this.copy_chr_rom();
        this.copy_trainer();
    }

    /** Mirror of `nrom_read_cpu address`. */
    read_cpu(address: number): void {
        this.cpu_mapped = 0;
        this.cpu_value = 0;
        this.cpu_driven_mask = 0;

        if (address >= NROM_WINDOW.PRG_ROM_START) {
            this.cpu_mapped = 1;
            this.cpu_value = list_byte(this.prg_rom, (address - NROM_WINDOW.PRG_ROM_START) % this.prg_rom_bytes);
            this.cpu_driven_mask = NROM_WINDOW.FULL_BYTE_MASK;
        } else if (address >= NROM_WINDOW.PRG_RAM_START && this.mapped_prg_ram_bytes > 0) {
            this.cpu_mapped = 1;
            this.cpu_value = list_byte(this.prg_ram, (address - NROM_WINDOW.PRG_RAM_START) % this.mapped_prg_ram_bytes);
            this.cpu_driven_mask = NROM_WINDOW.FULL_BYTE_MASK;
        }
    }

    /** Mirror of `nrom_write_cpu address, value`. */
    write_cpu(address: number, value: number): void {
        this.cpu_write_accepted = 0;

        if (address >= NROM_WINDOW.PRG_RAM_START && address < NROM_WINDOW.PRG_ROM_START) {
            if (this.mapped_prg_ram_bytes > 0) {
                const index = (address - NROM_WINDOW.PRG_RAM_START) % this.mapped_prg_ram_bytes;
                this.prg_ram[index] = normalize_byte(value);
                this.cpu_write_accepted = 1;
            }
        }
    }

    /** Mirror of `nrom_read_pattern address`. */
    read_pattern(address: number): void {
        this.pattern_value = 0;

        if (this.chr_rom_bytes > 0) {
            this.pattern_value = list_byte(this.chr_rom, address);
        } else if (this.mapped_chr_ram_bytes > 0) {
            this.pattern_value = list_byte(this.chr_ram, address % this.mapped_chr_ram_bytes);
        }
    }

    /** Mirror of `nrom_write_pattern address, value`. */
    write_pattern(address: number, value: number): void {
        this.pattern_write_accepted = 0;

        if (this.chr_rom_bytes === 0 && this.mapped_chr_ram_bytes > 0) {
            this.chr_ram[address % this.mapped_chr_ram_bytes] = normalize_byte(value);
            this.pattern_write_accepted = 1;
        }
    }

    /**
     * Mirror of the suite-16 handler's operation loop: runs each (kind, address, value) triple
     * against the board and returns the four board values followed by three values per operation.
     */
    /** Mirror of `nrom_get_prg_nvram_snapshot`. */
    get_prg_nvram_snapshot(): void {
        const start = this.mapped_prg_ram_bytes - this.prg_nvram_bytes;
        this.prg_nvram_snapshot.length = 0;

        for (let index = 0; index < this.prg_nvram_bytes; index += 1) {
            this.prg_nvram_snapshot.push(to_number(this.prg_ram[start + index] ?? 0));
        }
    }

    /** Mirror of `nrom_load_prg_nvram_snapshot`. */
    load_prg_nvram_snapshot(): void {
        const start = this.mapped_prg_ram_bytes - this.prg_nvram_bytes;
        this.nvram_loaded = 0;

        if (this.prg_nvram_snapshot.length !== this.prg_nvram_bytes) {
            return;
        }

        this.nvram_loaded = 1;

        for (let index = 0; index < this.prg_nvram_bytes; index += 1) {
            this.prg_ram[start + index] = to_number(this.prg_nvram_snapshot[index] ?? 0);
        }
    }

    /** Mirror of `nrom_get_chr_nvram_snapshot`. */
    get_chr_nvram_snapshot(): void {
        const start = this.mapped_chr_ram_bytes - this.chr_nvram_bytes;
        this.chr_nvram_snapshot.length = 0;

        for (let index = 0; index < this.chr_nvram_bytes; index += 1) {
            this.chr_nvram_snapshot.push(to_number(this.chr_ram[start + index] ?? 0));
        }
    }

    /** Mirror of `nrom_load_chr_nvram_snapshot`. */
    load_chr_nvram_snapshot(): void {
        const start = this.mapped_chr_ram_bytes - this.chr_nvram_bytes;
        this.nvram_loaded = 0;

        if (this.chr_nvram_snapshot.length !== this.chr_nvram_bytes) {
            return;
        }

        this.nvram_loaded = 1;

        for (let index = 0; index < this.chr_nvram_bytes; index += 1) {
            this.chr_ram[start + index] = to_number(this.chr_nvram_snapshot[index] ?? 0);
        }
    }

    run_memory_operations(ops: readonly (readonly [number, number, number])[]): number[] {
        const values = [this.ok, this.error_code, this.mapped_prg_ram_bytes, this.mapped_chr_ram_bytes];

        for (const [kind, address, value] of ops) {
            if (kind === NROM_MEMORY_OP.CPU_READ) {
                this.read_cpu(address);
                values.push(this.cpu_mapped, this.cpu_value, this.cpu_driven_mask);
            } else if (kind === NROM_MEMORY_OP.CPU_WRITE) {
                this.write_cpu(address, value);
                values.push(this.cpu_write_accepted, 0, 0);
            } else if (kind === NROM_MEMORY_OP.PATTERN_READ) {
                this.read_pattern(address);
                values.push(1, this.pattern_value, 0);
            } else if (kind === NROM_MEMORY_OP.PATTERN_WRITE) {
                this.write_pattern(address, value);
                values.push(this.pattern_write_accepted, 0, 0);
            } else if (kind === NROM_MEMORY_OP.GET_PRG_NVRAM) {
                this.get_prg_nvram_snapshot();
                values.push(1, this.prg_nvram_snapshot.length, 0);
            } else if (kind === NROM_MEMORY_OP.LOAD_PRG_NVRAM) {
                this.load_prg_nvram_snapshot();
                values.push(this.nvram_loaded, 0, 0);
            } else if (kind === NROM_MEMORY_OP.GET_CHR_NVRAM) {
                this.get_chr_nvram_snapshot();
                values.push(1, this.chr_nvram_snapshot.length, 0);
            } else if (kind === NROM_MEMORY_OP.LOAD_CHR_NVRAM) {
                this.load_chr_nvram_snapshot();
                values.push(this.nvram_loaded, 0, 0);
            } else if (kind === NROM_MEMORY_OP.READ_PRG_NVRAM_BYTE) {
                values.push(1, to_number(this.prg_nvram_snapshot[address] ?? 0), 0);
            } else if (kind === NROM_MEMORY_OP.READ_CHR_NVRAM_BYTE) {
                values.push(1, to_number(this.chr_nvram_snapshot[address] ?? 0), 0);
            } else {
                values.push(0, 0, 0);
            }
        }

        return values;
    }

    /** The seven values suite 15 reports for one board validation. */
    reported_values(): number[] {
        return [
            this.ok,
            this.error_code,
            this.kind,
            this.mapped_prg_ram_bytes,
            this.mapped_chr_ram_bytes,
            this.selection.kind,
            this.selection.error_code,
        ];
    }
}

/** Mirror of the `cpu_sequence_kind` enum in scratch/src/cpu_control.gs. */
export const CPU_SEQUENCE_KIND = { INSTRUCTION: 1, IRQ: 2, JAM: 3, NMI: 4, RESET: 5 } as const;

/** Mirror of the `cpu_instruction_error_code` enum in scratch/src/cpu_instruction.gs. */
export const CPU_INSTRUCTION_ERROR_CODE = {
    NONE: 0,
    UNDECODABLE_OPCODE: 1,
    UNOFFICIAL_OPCODE: 2,
    UNRESOLVED_OPERAND: 3,
    UNSUPPORTED_MNEMONIC: 4,
    UNSUPPORTED_OPERAND: 5,
} as const;

/**
 * The mnemonic ids scratch/src/cpu_instruction.gs dispatches on today, mirroring the
 * `cpu_mnemonic` enum in scratch/src/cpu_opcode.gs. The enum holds all 76 mnemonics; this mirror
 * lists the ones the ported dispatch reaches, and a test compares every id listed here with the
 * canonical opcode table fixture so the two cannot drift.
 */
export const CPU_MNEMONIC = {
    ADC: 1,
    AND: 5,
    ASL: 7,
    BCC: 9,
    BCS: 10,
    BEQ: 11,
    BIT: 12,
    BMI: 13,
    BNE: 14,
    BPL: 15,
    BRK: 16,
    BVC: 17,
    BVS: 18,
    CLC: 19,
    CLD: 20,
    CLI: 21,
    CLV: 22,
    CMP: 23,
    CPX: 24,
    CPY: 25,
    DEC: 27,
    DEX: 28,
    DEY: 29,
    EOR: 30,
    INC: 31,
    INX: 32,
    INY: 33,
    JMP: 35,
    JSR: 36,
    KIL: 37,
    LDA: 40,
    LDX: 41,
    LDY: 42,
    LSR: 43,
    NOP: 45,
    ORA: 46,
    PHA: 47,
    PHP: 48,
    PLA: 49,
    PLP: 50,
    ROL: 52,
    ROR: 53,
    RTI: 55,
    RTS: 56,
    SBC: 58,
    SEC: 59,
    SED: 60,
    SEI: 61,
    STA: 66,
    STX: 67,
    STY: 68,
    TAX: 70,
    TAY: 71,
    TSX: 72,
    TXA: 73,
    TXS: 74,
    TYA: 75,
} as const;

/** Mirror of the `cpu_vector_address` enum in scratch/src/cpu_core.gs. */
export const CPU_VECTOR_ADDRESS = {
    NMI_LOW: 0xfffa,
    NMI_HIGH: 0xfffb,
    RESET_LOW: 0xfffc,
    RESET_HIGH: 0xfffd,
    IRQ_BRK_LOW: 0xfffe,
    IRQ_BRK_HIGH: 0xffff,
} as const;

/** Mirror of the `mmc3_limit` enum in scratch/src/mapper_004.gs. */
export const MMC3_LIMIT = {
    PRG_BANK_BYTES: 8192,
    MIN_PRG_ROM_BYTES: 32768,
    CHR_BANK_BYTES: 1024,
    MIN_CHR_MEMORY_BYTES: 8192,
    PRG_RAM_BYTES: 8192,
    PATTERN_BYTES: 8192,
    PATTERN_SPACE_BYTES: 16384,
    TRAINER_BYTES: 512,
    TRAINER_PRG_RAM_OFFSET: 4096,
    PRG_RAM_START: 0x6000,
    PRG_ROM_START: 0x8000,
    PRG_ROM_OFFSET_MASK: 8191,
    CHR_OFFSET_MASK: 1023,
    FULL_BYTE_MASK: 255,
    PPU_ADDRESS_SPACE_BYTES: 0x4000,
    A12_WEIGHT: 0x1000,
    A12_FILTER_DOTS: 10,
} as const;

/** Mirror of the `mmc3_register` enum in scratch/src/mapper_004.gs. */
export const MMC3_REGISTER = {
    BANK_SELECT: 0x8000,
    BANK_DATA: 0x8001,
    MIRRORING: 0xa000,
    PRG_RAM_PROTECT: 0xa001,
    IRQ_LATCH: 0xc000,
    IRQ_RELOAD: 0xc001,
    IRQ_DISABLE: 0xe000,
    IRQ_ENABLE: 0xe001,
} as const;

/** Mirror of the `mmc3_op` enum in scratch/src/mapper_004.gs. */
export const MMC3_OP = {
    CPU_READ: 1,
    CPU_WRITE: 2,
    PATTERN_READ: 3,
    PATTERN_WRITE: 4,
    REPORT_MIRRORING: 5,
    OBSERVE_PPU_ACCESS: 6,
    CLOCK_PPU_DOT: 7,
    REPORT_IRQ: 8,
    GET_PRG_NVRAM: 9,
    LOAD_PRG_NVRAM: 10,
    GET_CHR_NVRAM: 11,
    LOAD_CHR_NVRAM: 12,
    READ_PRG_NVRAM_BYTE: 13,
    READ_CHR_NVRAM_BYTE: 14,
} as const;

/** Mirror of the `mmc3_ppu_access` enum in scratch/src/mapper_004.gs. */
export const MMC3_PPU_ACCESS = {
    READ_PATTERN: 1,
    WRITE_PATTERN: 2,
    READ_NAMETABLE: 3,
    WRITE_NAMETABLE: 4,
} as const;

/**
 * Mirror of scratch/src/mapper_004.gs: the MMC3 creation checks, the eight banking registers with the
 * masks bank execute applies to them, PRG and CHR bank selection in both modes, the PRG RAM enable
 * and write-protect bits, the mirroring register with its four-screen override, and the CPU and
 * pattern windows, the four IRQ registers, and the PPU A12 observation with the ten-dot low filter
 * that decides when a rising edge clocks the IRQ counter. The fields named after the parsed header
 * stand for the `cartridge_*` globals the ported validation reads, including the mirroring the header
 * declared. The NVRAM snapshots are not ported yet, so this mirror does not carry them either.
 */
export class GoboscriptMmc3Mapper {
    mapper_id = 0;
    submapper = 0;
    prg_rom_bytes = 0;
    chr_rom_bytes = 0;
    prg_ram_bytes = 0;
    prg_nvram_bytes = 0;
    chr_ram_bytes = 0;
    chr_nvram_bytes = 0;
    has_trainer = 0;
    header_mirroring = 1;

    prg_rom_offset = 0;
    chr_rom_offset = 0;
    trainer_offset = 0;

    ok = 0;
    error_code: number = MAPPER_ERROR.NONE;
    kind: number = MAPPER_KIND.NONE;
    mapped_prg_ram_bytes = 0;
    mapped_chr_ram_bytes = 0;
    prg_bank_count = 0;
    chr_bank_count = 0;
    four_screen = 0;
    mirroring = 1;
    bank_select = 0;
    prg_mode = 0;
    chr_mode = 0;
    prg_ram_enabled = 1;
    prg_ram_write_protected = 0;
    irq_latch = 0;
    irq_counter = 0;
    irq_reload_pending = 0;
    irq_enabled = 0;
    irq_line_asserted = 0;
    ppu_a12_high = 0;
    a12_low_dots = 0;

    readonly selection = new GoboscriptMapperSelection();

    /** Mirror of the Stage-owned `cartridge_bytes` list that `mmc3_load_payload` copies from. */
    cartridge_bytes: readonly number[] = [];

    /** Mirrors of the board's memory lists and its eight bank registers. */
    readonly prg_rom: number[] = [];
    readonly chr_rom: number[] = [];
    readonly prg_ram: number[] = new Array<number>(MMC3_LIMIT.PRG_RAM_BYTES).fill(0);
    readonly chr_ram: number[] = new Array<number>(MMC3_LIMIT.PATTERN_BYTES).fill(0);
    readonly bank_registers: number[] = new Array<number>(8).fill(0);

    cpu_mapped = 0;
    cpu_value = 0;
    cpu_driven_mask = 0;
    cpu_write_accepted = 0;
    pattern_value = 0;
    pattern_write_accepted = 0;
    ppu_observed = 0;
    nvram_loaded = 0;

    /** Mirrors of the two snapshot buffers the ported board copies its nonvolatile tails through. */
    readonly prg_nvram_snapshot: number[] = [];
    readonly chr_nvram_snapshot: number[] = [];

    /** Mirror of `mmc3_reset`. */
    reset(): void {
        this.mirroring = this.header_mirroring;
        this.bank_select = 0;
        this.prg_mode = 0;
        this.chr_mode = 0;
        this.prg_ram_enabled = 1;
        this.prg_ram_write_protected = 0;
        this.irq_latch = 0;
        this.irq_counter = 0;
        this.irq_reload_pending = 0;
        this.irq_enabled = 0;
        this.irq_line_asserted = 0;
        this.ppu_a12_high = 0;
        this.a12_low_dots = 0;
        this.bank_registers.fill(0);
    }

    /** Mirror of `mmc3_validate`. */
    validate(): void {
        this.ok = 0;
        this.error_code = MAPPER_ERROR.NONE;
        this.kind = MAPPER_KIND.NONE;
        this.mapped_prg_ram_bytes = 0;
        this.mapped_chr_ram_bytes = 0;
        this.prg_bank_count = 0;
        this.chr_bank_count = 0;
        this.four_screen = 0;
        this.mirroring = this.header_mirroring;
        this.selection.resolve(this.mapper_id, this.submapper);

        if (this.selection.error_code !== MAPPER_SELECTION_ERROR.NONE) {
            this.error_code = this.selection.error_code;
            return;
        }

        if (this.selection.kind !== MAPPER_KIND.MMC3) {
            this.error_code = MAPPER_ERROR.WRONG_MAPPER_FAMILY;
            return;
        }

        const prg_ram_total = mapper_sum_memory_sizes(this.prg_ram_bytes, this.prg_nvram_bytes);
        const chr_ram_total = mapper_sum_memory_sizes(this.chr_ram_bytes, this.chr_nvram_bytes);

        if (this.prg_rom_bytes < MMC3_LIMIT.MIN_PRG_ROM_BYTES) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_PRG_ROM_SIZE;
            return;
        }

        if (scratch_mod(this.prg_rom_bytes, MMC3_LIMIT.PRG_BANK_BYTES) !== 0) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_PRG_ROM_SIZE;
            return;
        }

        if (prg_ram_total < 0 || prg_ram_total > MMC3_LIMIT.PRG_RAM_BYTES) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_PRG_RAM_SIZE;
            return;
        }

        if (this.has_trainer === 1 && prg_ram_total === 0) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_TRAINER;
            return;
        }

        if (chr_ram_total < 0) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_CHR_MEMORY;
            return;
        }

        const chr_memory_bytes = this.chr_rom_bytes > 0 ? this.chr_rom_bytes : chr_ram_total;

        if (chr_memory_bytes < MMC3_LIMIT.MIN_CHR_MEMORY_BYTES) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_CHR_MEMORY;
            return;
        }

        if (scratch_mod(chr_memory_bytes, MMC3_LIMIT.CHR_BANK_BYTES) !== 0) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_CHR_MEMORY;
            return;
        }

        if (this.chr_rom_bytes > 0 && chr_ram_total !== 0) {
            this.error_code = MAPPER_ERROR.UNSUPPORTED_CHR_MEMORY;
            return;
        }

        this.ok = 1;
        this.kind = MAPPER_KIND.MMC3;
        this.mapped_prg_ram_bytes = prg_ram_total;
        this.mapped_chr_ram_bytes = this.chr_rom_bytes === 0 ? chr_ram_total : 0;
        this.prg_bank_count = scratch_floor_divide(this.prg_rom_bytes, MMC3_LIMIT.PRG_BANK_BYTES);
        this.chr_bank_count = scratch_floor_divide(
            this.chr_rom_bytes + this.mapped_chr_ram_bytes,
            MMC3_LIMIT.CHR_BANK_BYTES,
        );
        this.four_screen = this.header_mirroring === 3 ? 1 : 0;
        this.reset();
    }

    /** Mirror of `mmc3_reset_memory`. */
    reset_memory(): void {
        this.prg_rom.length = 0;
        this.chr_rom.length = 0;

        for (let index = 0; index < this.prg_rom_bytes; index += 1) {
            this.prg_rom.push(0);
        }

        for (let index = 0; index < this.chr_rom_bytes; index += 1) {
            this.chr_rom.push(0);
        }

        this.prg_ram.fill(0);
        this.chr_ram.fill(0);
    }

    /** Mirror of `mmc3_copy_prg_rom`. */
    copy_prg_rom(): void {
        for (let index = 0; index < this.prg_rom_bytes; index += 1) {
            this.prg_rom[index] = list_byte(this.cartridge_bytes, this.prg_rom_offset + index);
        }
    }

    /** Mirror of `mmc3_copy_chr_rom`. */
    copy_chr_rom(): void {
        for (let index = 0; index < this.chr_rom_bytes; index += 1) {
            this.chr_rom[index] = list_byte(this.cartridge_bytes, this.chr_rom_offset + index);
        }
    }

    /** Mirror of `mmc3_copy_trainer`. */
    copy_trainer(): void {
        if (this.has_trainer !== 1 || this.mapped_prg_ram_bytes <= 0) {
            return;
        }

        for (let index = 0; index < MMC3_LIMIT.TRAINER_BYTES; index += 1) {
            const ram_index = (MMC3_LIMIT.TRAINER_PRG_RAM_OFFSET + index) % this.mapped_prg_ram_bytes;
            this.prg_ram[ram_index] = list_byte(this.cartridge_bytes, this.trainer_offset + index);
        }
    }

    /** Mirror of `mmc3_load_payload`. */
    load_payload(): void {
        this.reset_memory();
        this.copy_prg_rom();
        this.copy_chr_rom();
        this.copy_trainer();
        this.reset();
    }

    /** Mirror of `mmc3_prg_bank(slot)`. */
    prg_bank(slot: number): number {
        const last_bank = this.prg_bank_count - 1;
        const second_last_bank = this.prg_bank_count - 2;
        const bank6 = this.bank_registers[6] ?? 0;
        const bank7 = this.bank_registers[7] ?? 0;
        let bank = 0;

        if (this.prg_mode === 0) {
            bank = slot === 0 ? bank6 : slot === 1 ? bank7 : slot === 2 ? second_last_bank : last_bank;
        } else {
            bank = slot === 0 ? second_last_bank : slot === 1 ? bank7 : slot === 2 ? bank6 : last_bank;
        }

        return scratch_mod(bank, this.prg_bank_count);
    }

    /** Mirror of `mmc3_chr_bank(slot)`. */
    chr_bank(slot: number): number {
        const register0 = this.bank_registers[0] ?? 0;
        const register1 = this.bank_registers[1] ?? 0;
        let bank = 0;

        if (this.chr_mode === 0) {
            if (slot === 0) {
                bank = register0;
            } else if (slot === 1) {
                bank = register0 + 1;
            } else if (slot === 2) {
                bank = register1;
            } else if (slot === 3) {
                bank = register1 + 1;
            } else {
                bank = this.bank_registers[slot - 2] ?? 0;
            }
        } else if (slot < 4) {
            bank = this.bank_registers[slot + 2] ?? 0;
        } else if (slot === 4) {
            bank = register0;
        } else if (slot === 5) {
            bank = register0 + 1;
        } else if (slot === 6) {
            bank = register1;
        } else {
            bank = register1 + 1;
        }

        return scratch_mod(bank, this.chr_bank_count);
    }

    /** Mirror of `mmc3_write_register address, value`. */
    write_register(address: number, value: number): void {
        const register_id = bitwise_and(normalize_word(address), 0xe001);
        let bank_value = normalize_byte(value);

        if (register_id === MMC3_REGISTER.BANK_SELECT) {
            this.bank_select = bitwise_and(bank_value, 7);
            this.prg_mode = bit_at(bank_value, 64);
            this.chr_mode = bit_at(bank_value, 128);
        } else if (register_id === MMC3_REGISTER.BANK_DATA) {
            if (this.bank_select === 0 || this.bank_select === 1) {
                bank_value = bitwise_and(bank_value, 254);
            } else if (this.bank_select === 6) {
                bank_value = bitwise_and(bank_value, 63);
            } else if (this.bank_select === 7) {
                bank_value = bitwise_and(bank_value, 127);
            }

            this.bank_registers[this.bank_select] = bank_value;
        } else if (register_id === MMC3_REGISTER.MIRRORING) {
            if (this.four_screen === 0) {
                this.mirroring = bitwise_and(bank_value, 1) === 0 ? 2 : 1;
            }
        } else if (register_id === MMC3_REGISTER.PRG_RAM_PROTECT) {
            this.prg_ram_enabled = bit_at(bank_value, 128);
            this.prg_ram_write_protected = bit_at(bank_value, 64);
        } else if (register_id === MMC3_REGISTER.IRQ_LATCH) {
            this.irq_latch = bank_value;
        } else if (register_id === MMC3_REGISTER.IRQ_RELOAD) {
            this.irq_counter = 0;
            this.irq_reload_pending = 1;
        } else if (register_id === MMC3_REGISTER.IRQ_DISABLE) {
            this.irq_enabled = 0;
            this.irq_line_asserted = 0;
        } else if (register_id === MMC3_REGISTER.IRQ_ENABLE) {
            this.irq_enabled = 1;
        }
    }

    /** Mirror of `mmc3_read_cpu address`. */
    read_cpu(address: number): void {
        const numeric_address = normalize_word(address);
        this.cpu_mapped = 0;
        this.cpu_value = 0;
        this.cpu_driven_mask = 0;

        if (numeric_address >= MMC3_LIMIT.PRG_ROM_START) {
            const slot = scratch_floor_divide(numeric_address - MMC3_LIMIT.PRG_ROM_START, MMC3_LIMIT.PRG_BANK_BYTES);
            const offset = this.prg_bank(slot) * MMC3_LIMIT.PRG_BANK_BYTES +
                bitwise_and(numeric_address, MMC3_LIMIT.PRG_ROM_OFFSET_MASK);
            this.cpu_mapped = 1;
            this.cpu_value = list_byte(this.prg_rom, offset);
            this.cpu_driven_mask = MMC3_LIMIT.FULL_BYTE_MASK;
        } else if (numeric_address >= MMC3_LIMIT.PRG_RAM_START && this.prg_ram_enabled === 1) {
            if (this.mapped_prg_ram_bytes > 0) {
                const offset = scratch_mod(numeric_address - MMC3_LIMIT.PRG_RAM_START, this.mapped_prg_ram_bytes);
                this.cpu_mapped = 1;
                this.cpu_value = list_byte(this.prg_ram, offset);
                this.cpu_driven_mask = MMC3_LIMIT.FULL_BYTE_MASK;
            }
        }
    }

    /** Mirror of `mmc3_write_cpu address, value`. */
    write_cpu(address: number, value: number): void {
        const numeric_address = normalize_word(address);
        this.cpu_write_accepted = 0;

        if (numeric_address >= MMC3_LIMIT.PRG_RAM_START && numeric_address < MMC3_LIMIT.PRG_ROM_START) {
            const writable = this.prg_ram_enabled === 1 && this.prg_ram_write_protected === 0;

            if (writable && this.mapped_prg_ram_bytes > 0) {
                const offset = scratch_mod(numeric_address - MMC3_LIMIT.PRG_RAM_START, this.mapped_prg_ram_bytes);
                this.prg_ram[offset] = normalize_byte(value);
                this.cpu_write_accepted = 1;
            }
        } else if (numeric_address >= MMC3_LIMIT.PRG_ROM_START) {
            this.write_register(numeric_address, value);
        }
    }

    /** Mirror of `mmc3_read_pattern address`. */
    read_pattern(address: number): void {
        const numeric_address = scratch_mod(normalize_word(address), MMC3_LIMIT.PATTERN_SPACE_BYTES);
        const slot = scratch_floor_divide(numeric_address, MMC3_LIMIT.CHR_BANK_BYTES);
        const offset = this.chr_bank(slot) * MMC3_LIMIT.CHR_BANK_BYTES +
            bitwise_and(numeric_address, MMC3_LIMIT.CHR_OFFSET_MASK);
        this.pattern_value = 0;

        if (this.chr_rom_bytes > 0) {
            this.pattern_value = list_byte(this.chr_rom, offset);
        } else if (this.mapped_chr_ram_bytes > 0) {
            this.pattern_value = list_byte(this.chr_ram, offset);
        }
    }

    /** Mirror of `mmc3_write_pattern address, value`. */
    write_pattern(address: number, value: number): void {
        const numeric_address = scratch_mod(normalize_word(address), MMC3_LIMIT.PATTERN_SPACE_BYTES);
        const slot = scratch_floor_divide(numeric_address, MMC3_LIMIT.CHR_BANK_BYTES);
        const offset = this.chr_bank(slot) * MMC3_LIMIT.CHR_BANK_BYTES +
            bitwise_and(numeric_address, MMC3_LIMIT.CHR_OFFSET_MASK);
        this.pattern_write_accepted = 0;

        if (this.mapped_chr_ram_bytes > 0) {
            this.chr_ram[offset] = normalize_byte(value);
            this.pattern_write_accepted = 1;
        }
    }

    /**
     * Mirror of `mmc3_observe_ppu_access access_kind, address`. The reference reads the address out
     * of its access struct and ignores the kind and region, so this mirror ignores the kind too.
     */
    observe_ppu_access(_access_kind: number, address: number): void {
        this.observe_ppu_a12(address);
    }

    /** Mirror of `mmc3_observe_ppu_address address`. */
    observe_ppu_address(address: number): void {
        this.observe_ppu_a12(address);
    }

    /** Mirror of `mmc3_clock_ppu_dot`. */
    clock_ppu_dot(): void {
        if (this.ppu_a12_high === 0 && this.a12_low_dots < MMC3_LIMIT.A12_FILTER_DOTS) {
            this.a12_low_dots += 1;
        }
    }

    /** Mirror of `mmc3_get_irq_line_asserted()`. */
    get_irq_line_asserted(): number {
        return this.irq_line_asserted;
    }

    /** Mirror of `mmc3_observe_ppu_a12 address`. */
    observe_ppu_a12(address: number): void {
        // A12 is the 4096s bit of the address. The reference refuses a non-integer address, so
        // the floor comparison is the integer test the port uses too.
        this.ppu_observed = 0;

        if (address < 0 || address >= MMC3_LIMIT.PPU_ADDRESS_SPACE_BYTES) {
            return;
        }

        if (address !== scratch_floor_divide(address, 1)) {
            return;
        }

        this.ppu_observed = 1;
        const next_high = scratch_mod(scratch_floor_divide(address, MMC3_LIMIT.A12_WEIGHT), 2);

        if (next_high === this.ppu_a12_high) {
            return;
        }

        if (next_high === 1 && this.a12_low_dots >= MMC3_LIMIT.A12_FILTER_DOTS) {
            this.clock_irq_counter();
        }

        this.ppu_a12_high = next_high;
        this.a12_low_dots = 0;
    }

    /** Mirror of `mmc3_clock_irq_counter`. */
    clock_irq_counter(): void {
        if (this.irq_counter === 0 || this.irq_reload_pending === 1) {
            this.irq_counter = this.irq_latch;
        } else {
            this.irq_counter -= 1;
        }

        this.irq_reload_pending = 0;

        if (this.irq_counter === 0 && this.irq_enabled === 1) {
            this.irq_line_asserted = 1;
        }
    }

    /** Mirror of `mmc3_get_prg_nvram_snapshot`. */
    get_prg_nvram_snapshot(): void {
        const start = this.mapped_prg_ram_bytes - this.prg_nvram_bytes;
        this.prg_nvram_snapshot.length = 0;

        for (let index = 0; index < this.prg_nvram_bytes; index += 1) {
            this.prg_nvram_snapshot.push(to_number(this.prg_ram[start + index] ?? 0));
        }
    }

    /** Mirror of `mmc3_load_prg_nvram_snapshot`. */
    load_prg_nvram_snapshot(): void {
        const start = this.mapped_prg_ram_bytes - this.prg_nvram_bytes;
        this.nvram_loaded = 0;

        if (this.prg_nvram_snapshot.length !== this.prg_nvram_bytes) {
            return;
        }

        this.nvram_loaded = 1;

        for (let index = 0; index < this.prg_nvram_bytes; index += 1) {
            this.prg_ram[start + index] = to_number(this.prg_nvram_snapshot[index] ?? 0);
        }
    }

    /** Mirror of `mmc3_get_chr_nvram_snapshot`. */
    get_chr_nvram_snapshot(): void {
        const start = this.mapped_chr_ram_bytes - this.chr_nvram_bytes;
        this.chr_nvram_snapshot.length = 0;

        for (let index = 0; index < this.chr_nvram_bytes; index += 1) {
            this.chr_nvram_snapshot.push(to_number(this.chr_ram[start + index] ?? 0));
        }
    }

    /** Mirror of `mmc3_load_chr_nvram_snapshot`. */
    load_chr_nvram_snapshot(): void {
        const start = this.mapped_chr_ram_bytes - this.chr_nvram_bytes;
        this.nvram_loaded = 0;

        if (this.chr_nvram_snapshot.length !== this.chr_nvram_bytes) {
            return;
        }

        this.nvram_loaded = 1;

        for (let index = 0; index < this.chr_nvram_bytes; index += 1) {
            this.chr_ram[start + index] = to_number(this.chr_nvram_snapshot[index] ?? 0);
        }
    }

    /**
     * Mirror of the suite-18 and suite-19 handler's operation loop: runs each (kind, address, value)
     * triple and returns the board values followed by three values per operation.
     */
    run_memory_operations(ops: readonly (readonly [number, number, number])[]): number[] {
        const values = [this.ok, this.error_code, this.mapped_prg_ram_bytes];

        for (const [kind, address, value] of ops) {
            if (kind === MMC3_OP.CPU_READ) {
                this.read_cpu(address);
                values.push(this.cpu_mapped, this.cpu_value, this.cpu_driven_mask);
            } else if (kind === MMC3_OP.CPU_WRITE) {
                this.write_cpu(address, value);
                values.push(this.cpu_write_accepted, 0, 0);
            } else if (kind === MMC3_OP.PATTERN_READ) {
                this.read_pattern(address);
                values.push(1, this.pattern_value, 0);
            } else if (kind === MMC3_OP.PATTERN_WRITE) {
                this.write_pattern(address, value);
                values.push(this.pattern_write_accepted, 0, 0);
            } else if (kind === MMC3_OP.REPORT_MIRRORING) {
                values.push(1, this.mirroring, 0);
            } else if (kind === MMC3_OP.OBSERVE_PPU_ACCESS) {
                this.observe_ppu_access(value, address);
                values.push(this.ppu_observed, 0, 0);
            } else if (kind === MMC3_OP.CLOCK_PPU_DOT) {
                this.clock_ppu_dot();
                values.push(1, 0, 0);
            } else if (kind === MMC3_OP.REPORT_IRQ) {
                values.push(1, this.get_irq_line_asserted(), 0);
            } else if (kind === MMC3_OP.GET_PRG_NVRAM) {
                this.get_prg_nvram_snapshot();
                values.push(1, this.prg_nvram_snapshot.length, 0);
            } else if (kind === MMC3_OP.LOAD_PRG_NVRAM) {
                this.load_prg_nvram_snapshot();
                values.push(this.nvram_loaded, 0, 0);
            } else if (kind === MMC3_OP.GET_CHR_NVRAM) {
                this.get_chr_nvram_snapshot();
                values.push(1, this.chr_nvram_snapshot.length, 0);
            } else if (kind === MMC3_OP.LOAD_CHR_NVRAM) {
                this.load_chr_nvram_snapshot();
                values.push(this.nvram_loaded, 0, 0);
            } else if (kind === MMC3_OP.READ_PRG_NVRAM_BYTE) {
                values.push(1, to_number(this.prg_nvram_snapshot[address] ?? 0), 0);
            } else if (kind === MMC3_OP.READ_CHR_NVRAM_BYTE) {
                values.push(1, to_number(this.chr_nvram_snapshot[address] ?? 0), 0);
            } else {
                values.push(0, 0, 0);
            }
        }

        return values;
    }
}

/**
 * Mirror of scratch/src/cpu_core.gs and scratch/src/cpu_addressing.gs: register state, one
 * logged bus transaction per cycle, program-counter fetches, stack operations, and the
 * thirteen addressing modes. The reference suspends each instruction with a generator; this
 * mirror performs the same accesses in the same order and counts one cycle per access without
 * suspending, which is the execution model the port documents.
 */
export class GoboscriptCpuCore {
    readonly bus = new GoboscriptCpuBus();
    readonly access_log: number[] = [];
    /** Mirror of `cpu_access_log_enabled`: the reference takes an optional trace sink. */
    access_log_enabled = true;
    program_counter = 0;
    a = 0;
    x = 0;
    y = 0;
    stack_pointer = 0;
    status: number = CPU_FLAG.UNUSED;
    cycles = 0;
    cycle_value = 0;
    fetched_byte = 0;
    fetched_word = 0;
    popped_byte = 0;
    popped_word = 0;
    resolved_kind = 0;
    resolved_mode = 0;
    resolved_access = 0;
    resolved_base_address = 0;
    resolved_address = 0;
    resolved_value = 0;
    resolved_page_crossed = 0;
    resolved_error = 0;
    sequence_error = 0;
    instruction_error = 0;
    jammed = 0;
    store_value = 0;
    selected_sequence = 0;
    nmi_pending = 0;
    irq_line_asserted = 0;
    irq_poll_mask_override_active = 0;
    irq_poll_mask_override_value = 0;
    jam_vector_reads_issued = 0;
    alu_value = 0;
    alu_status = 0;

    /**
     * Decoder this core fetches through, mirroring the Stage-owned `cpu_opcode_table` list that
     * `cpu_decode_opcode` reads. Tests inject the canonical generated table; a core without one
     * reports an undecodable opcode, exactly as a project whose data file failed to load would.
     */
    decoder: GoboscriptCpuOpcodeDecoder | null = null;

    /** Mirror of `cpu_reset_cycle_accounting`. */
    reset_cycle_accounting(): void {
        this.cycles = 0;
        this.access_log.length = 0;
    }

    /** Mirror of `cpu_reset_registers`. */
    reset_registers(): void {
        this.a = 0;
        this.x = 0;
        this.y = 0;
        this.stack_pointer = 0;
        this.program_counter = 0;
        this.status = CPU_FLAG.UNUSED;
        this.reset_cycle_accounting();
    }

    /** Mirror of `cpu_read_cycle address`. */
    read_cycle(address: number): void {
        const numeric_address = normalize_word(address);
        this.cycle_value = this.bus.read(numeric_address);

        if (this.access_log_enabled) {
            this.access_log.push(CPU_ACCESS_KIND.READ, numeric_address, this.cycle_value);
        }

        this.cycles += 1;
    }

    /** Mirror of `cpu_write_cycle address, value`. */
    write_cycle(address: number, value: number): void {
        const numeric_address = normalize_word(address);
        const numeric_value = normalize_byte(value);
        this.bus.write(numeric_address, numeric_value);

        if (this.access_log_enabled) {
            this.access_log.push(CPU_ACCESS_KIND.WRITE, numeric_address, numeric_value);
        }

        this.cycles += 1;
    }

    /** Mirror of `cpu_dummy_read_cycle address`. */
    dummy_read_cycle(address: number): void {
        this.read_cycle(address);
    }

    /** Mirror of `cpu_fetch_byte`. */
    fetch_byte(): void {
        const address = this.program_counter;
        this.read_cycle(address);
        this.fetched_byte = this.cycle_value;
        this.program_counter = scratch_mod(address + 1, 65536);
    }

    /** Mirror of `cpu_fetch_word`. */
    fetch_word(): void {
        this.fetch_byte();
        const low_byte = scratch_mod(this.fetched_byte, 256);
        this.fetch_byte();
        this.fetched_word = scratch_mod(this.fetched_byte, 256) * 256 + low_byte;
    }

    /** Mirror of `cpu_push_byte value`. */
    push_byte(value: number): void {
        this.write_cycle(256 + this.stack_pointer, value);
        this.stack_pointer = scratch_mod(this.stack_pointer - 1, 256);
    }

    /** Mirror of `cpu_pop_byte`. */
    pop_byte(): void {
        const next_stack_pointer = scratch_mod(this.stack_pointer + 1, 256);
        this.read_cycle(256 + next_stack_pointer);
        this.stack_pointer = next_stack_pointer;
        this.popped_byte = this.cycle_value;
    }

    /** Mirror of `cpu_push_word value`. */
    push_word(value: number): void {
        const word = scratch_mod(value, 65536);
        this.push_byte(scratch_floor_divide(word, 256));
        this.push_byte(scratch_mod(word, 256));
    }

    /** Mirror of `cpu_pop_word`. */
    pop_word(): void {
        this.pop_byte();
        const low_byte = scratch_mod(this.popped_byte, 256);
        this.pop_byte();
        this.popped_word = scratch_mod(this.popped_byte, 256) * 256 + low_byte;
    }

    /** Mirror of `cpu_push_status break_enabled`. */
    push_status(break_enabled: number): void {
        this.status = normalize_status(this.status);
        this.push_byte(pack_status_for_stack(this.status, break_enabled));
    }

    /** Mirror of `cpu_restore_status_from_stack value`. */
    restore_status_from_stack(value: number): void {
        this.status = unpack_status_from_stack(normalize_byte(value));
    }

    /** Mirror of `cpu_page_crossed(base_address, address)`. */
    page_crossed(base_address: number, address: number): number {
        if (byte_high(base_address) === byte_high(address)) {
            return 0;
        }

        return 1;
    }

    /** Mirror of `cpu_indexed_dummy_address(base_address, address)`. */
    indexed_dummy_address(base_address: number, address: number): number {
        return join_bytes(byte_high(base_address), byte_low(address));
    }

    /** Mirror of `cpu_reset_operand`. */
    reset_operand(): void {
        this.resolved_kind = CPU_OPERAND_KIND.NONE;
        this.resolved_mode = 0;
        this.resolved_access = 0;
        this.resolved_base_address = 0;
        this.resolved_address = 0;
        this.resolved_value = 0;
        this.resolved_page_crossed = 0;
        this.resolved_error = CPU_OPERAND_ERROR_CODE.NONE;
    }

    /** Mirror of `cpu_set_memory_operand base_address, address, page_crossed`. */
    set_memory_operand(base_address: number, address: number, page_crossed: number): void {
        this.resolved_kind = CPU_OPERAND_KIND.MEMORY;
        this.resolved_base_address = normalize_word(base_address);
        this.resolved_address = normalize_word(address);
        this.resolved_page_crossed = to_number(page_crossed);
    }

    /** Mirror of `cpu_resolve_operand mode, access`. */
    resolve_operand(mode: number, access: number): void {
        const numeric_mode = to_number(mode);
        const numeric_access = to_number(access);
        this.reset_operand();
        this.resolved_mode = numeric_mode;
        this.resolved_access = numeric_access;

        if (numeric_mode === CPU_ADDRESSING_MODE.IMPLIED) {
            if (numeric_access !== CPU_OPERAND_ACCESS.READ) {
                this.resolved_error = CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS;
            } else {
                this.resolved_kind = CPU_OPERAND_KIND.IMPLIED;
            }
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.ACCUMULATOR) {
            if (numeric_access === CPU_OPERAND_ACCESS.WRITE) {
                this.resolved_error = CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS;
            } else {
                this.resolved_kind = CPU_OPERAND_KIND.ACCUMULATOR;
            }
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.IMMEDIATE) {
            if (numeric_access !== CPU_OPERAND_ACCESS.READ) {
                this.resolved_error = CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS;
            } else {
                this.resolved_kind = CPU_OPERAND_KIND.IMMEDIATE;
                this.fetch_byte();
                this.resolved_value = this.fetched_byte;
            }
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.RELATIVE) {
            if (numeric_access !== CPU_OPERAND_ACCESS.READ) {
                this.resolved_error = CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS;
                return;
            }

            this.fetch_byte();
            const offset = to_signed_byte(this.fetched_byte);
            const origin_address = this.program_counter;
            const target_address = normalize_word(origin_address + offset);
            this.resolved_kind = CPU_OPERAND_KIND.RELATIVE;
            this.resolved_value = offset;
            this.resolved_base_address = origin_address;
            this.resolved_address = target_address;
            this.resolved_page_crossed = this.page_crossed(origin_address, target_address);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.ZERO_PAGE) {
            this.fetch_byte();
            const base_address = this.fetched_byte;
            this.set_memory_operand(base_address, base_address, 0);
            return;
        }

        if (
            numeric_mode === CPU_ADDRESSING_MODE.ZERO_PAGE_X ||
            numeric_mode === CPU_ADDRESSING_MODE.ZERO_PAGE_Y
        ) {
            this.fetch_byte();
            const base_address = this.fetched_byte;
            const index_register =
                numeric_mode === CPU_ADDRESSING_MODE.ZERO_PAGE_X ? normalize_byte(this.x) : normalize_byte(this.y);
            this.dummy_read_cycle(base_address);
            this.set_memory_operand(base_address, normalize_byte(base_address + index_register), 0);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.ABSOLUTE) {
            this.fetch_word();
            const address = this.fetched_word;
            this.set_memory_operand(address, address, 0);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.ABSOLUTE_X || numeric_mode === CPU_ADDRESSING_MODE.ABSOLUTE_Y) {
            this.fetch_word();
            const base_address = this.fetched_word;
            const index_register =
                numeric_mode === CPU_ADDRESSING_MODE.ABSOLUTE_X ? normalize_byte(this.x) : normalize_byte(this.y);
            const address = normalize_word(base_address + index_register);
            const crossed = this.page_crossed(base_address, address);

            if (numeric_access !== CPU_OPERAND_ACCESS.READ || crossed === 1) {
                this.dummy_read_cycle(this.indexed_dummy_address(base_address, address));
            }

            this.set_memory_operand(base_address, address, crossed);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.INDIRECT) {
            if (numeric_access !== CPU_OPERAND_ACCESS.READ) {
                this.resolved_error = CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS;
                return;
            }

            this.fetch_word();
            const pointer_address = this.fetched_word;
            const pointer_high_address = join_bytes(byte_high(pointer_address), normalize_byte(pointer_address + 1));
            this.read_cycle(pointer_address);
            const target_low = this.cycle_value;
            this.read_cycle(pointer_high_address);
            const target_high = this.cycle_value;
            this.resolved_kind = CPU_OPERAND_KIND.JUMP_TARGET;
            this.resolved_base_address = pointer_address;
            this.resolved_address = join_bytes(target_high, target_low);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.INDEXED_INDIRECT) {
            this.fetch_byte();
            const base_address = this.fetched_byte;
            this.dummy_read_cycle(base_address);
            const pointer_address = normalize_byte(base_address + normalize_byte(this.x));
            this.read_cycle(pointer_address);
            const target_low = this.cycle_value;
            this.read_cycle(normalize_byte(pointer_address + 1));
            const target_high = this.cycle_value;
            this.set_memory_operand(base_address, join_bytes(target_high, target_low), 0);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.INDIRECT_INDEXED) {
            this.fetch_byte();
            const pointer_address = this.fetched_byte;
            this.read_cycle(pointer_address);
            const target_low = this.cycle_value;
            this.read_cycle(normalize_byte(pointer_address + 1));
            const target_high = this.cycle_value;
            const base_address = join_bytes(target_high, target_low);
            const address = normalize_word(base_address + normalize_byte(this.y));
            const crossed = this.page_crossed(base_address, address);

            if (numeric_access !== CPU_OPERAND_ACCESS.READ || crossed === 1) {
                this.dummy_read_cycle(this.indexed_dummy_address(base_address, address));
            }

            this.set_memory_operand(base_address, address, crossed);
            return;
        }

        this.resolved_error = CPU_OPERAND_ERROR_CODE.UNKNOWN_MODE;
    }

    /** The resolved operand plus the access trace, in shared vector suite 10 field order. */
    /** Mirror of `cpu_reset_sequence_error`. */
    reset_sequence_error(): void {
        this.sequence_error = CPU_SEQUENCE_ERROR_CODE.NONE;
    }

    /** Mirror of `cpu_execute_reset_cycles`. */
    execute_reset_cycles(): void {
        this.read_cycle(this.program_counter);
        this.read_cycle(this.program_counter);

        for (let index = 0; index < 3; index += 1) {
            this.read_cycle(256 + this.stack_pointer);
            this.stack_pointer = normalize_byte(this.stack_pointer - 1);
        }

        this.read_cycle(CPU_VECTOR_ADDRESS.RESET_LOW);
        const vector_low = this.cycle_value;
        this.read_cycle(CPU_VECTOR_ADDRESS.RESET_HIGH);
        this.program_counter = join_bytes(this.cycle_value, vector_low);
        this.status = set_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE, 1);
    }

    /** Mirror of `cpu_execute_brk_cycles`. */
    execute_brk_cycles(): void {
        this.fetch_byte();
        this.push_word(this.program_counter);
        this.push_status(1);
        this.status = set_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE, 1);
        this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_LOW);
        const vector_low = this.cycle_value;
        this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_HIGH);
        this.program_counter = join_bytes(this.cycle_value, vector_low);
    }

    /** Mirror of `cpu_execute_jsr_cycles`. */
    execute_jsr_cycles(): void {
        this.fetch_byte();
        const target_low = this.fetched_byte;
        this.read_cycle(256 + this.stack_pointer);
        this.push_word(this.program_counter);
        this.fetch_byte();
        this.program_counter = join_bytes(this.fetched_byte, target_low);
    }

    /** Mirror of `cpu_execute_rti_cycles`. */
    execute_rti_cycles(): void {
        this.read_cycle(this.program_counter);
        this.read_cycle(256 + this.stack_pointer);
        this.pop_byte();
        this.restore_status_from_stack(this.popped_byte);
        this.pop_word();
        this.program_counter = this.popped_word;
    }

    /** Mirror of `cpu_execute_rts_cycles`. */
    execute_rts_cycles(): void {
        this.read_cycle(this.program_counter);
        this.read_cycle(256 + this.stack_pointer);
        this.pop_word();
        const return_address = this.popped_word;
        this.read_cycle(return_address);
        this.program_counter = normalize_word(return_address + 1);
    }

    /** Mirror of `cpu_execute_hardware_interrupt_cycles source`. */
    execute_hardware_interrupt_cycles(source: number): void {
        let vector_low_address: number = CPU_VECTOR_ADDRESS.IRQ_BRK_LOW;
        let vector_high_address: number = CPU_VECTOR_ADDRESS.IRQ_BRK_HIGH;

        if (source === CPU_INTERRUPT_SOURCE.NMI) {
            vector_low_address = CPU_VECTOR_ADDRESS.NMI_LOW;
            vector_high_address = CPU_VECTOR_ADDRESS.NMI_HIGH;
        }

        this.read_cycle(this.program_counter);
        this.read_cycle(this.program_counter);
        this.push_word(this.program_counter);
        this.push_status(0);
        this.status = set_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE, 1);
        this.read_cycle(vector_low_address);
        const vector_low = this.cycle_value;
        this.read_cycle(vector_high_address);
        this.program_counter = join_bytes(this.cycle_value, vector_low);
    }

    /** Mirror of `cpu_apply_relative_branch_cycles taken`. */
    apply_relative_branch_cycles(taken: number): void {
        this.sequence_error = CPU_SEQUENCE_ERROR_CODE.NONE;

        if (this.resolved_kind !== CPU_OPERAND_KIND.RELATIVE) {
            this.sequence_error = CPU_SEQUENCE_ERROR_CODE.NOT_RELATIVE_OPERAND;
        } else if (taken === 1) {
            this.read_cycle(this.resolved_base_address);

            if (this.resolved_page_crossed === 1) {
                this.read_cycle(this.indexed_dummy_address(this.resolved_base_address, this.resolved_address));
            }

            this.program_counter = this.resolved_address;
        }
    }

    /** Mirror of `cpu_clear_interrupt_state`. */
    clear_interrupt_state(): void {
        this.jammed = 0;
        this.jam_vector_reads_issued = 0;
        this.nmi_pending = 0;
        this.irq_poll_mask_override_active = 0;
        this.irq_poll_mask_override_value = 0;
    }

    /** Mirror of `cpu_request_nmi`. */
    request_nmi(): void {
        this.nmi_pending = 1;
    }

    /** Mirror of `cpu_set_irq_line asserted`. */
    set_irq_line(asserted: number): void {
        this.irq_line_asserted = asserted === 0 ? 0 : 1;
    }

    /** Mirror of `cpu_execute_jammed_cycles`. */
    execute_jammed_cycles(): void {
        this.selected_sequence = CPU_SEQUENCE_KIND.JAM;

        if (this.jam_vector_reads_issued === 0) {
            this.jam_vector_reads_issued = 1;
            this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_HIGH);
            this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_LOW);
            this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_LOW);
            return;
        }

        this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_HIGH);
    }

    /** Mirror of `cpu_finish_instruction interrupt_disabled_before`. */
    finish_instruction(interrupt_disabled_before: number): void {
        const mnemonic = this.decoder?.mnemonic ?? 0;
        let delays_irq_poll = 0;

        if (mnemonic === CPU_MNEMONIC.CLI) {
            delays_irq_poll = 1;
        } else if (mnemonic === CPU_MNEMONIC.SEI) {
            delays_irq_poll = 1;
        } else if (mnemonic === CPU_MNEMONIC.PLP) {
            delays_irq_poll = 1;
        }

        if (delays_irq_poll === 1) {
            this.irq_poll_mask_override_active = 1;
            this.irq_poll_mask_override_value = interrupt_disabled_before;
        }
    }

    /** Mirror of `cpu_begin_next_sequence`. */
    begin_next_sequence(): void {
        const interrupt_disabled_before = has_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE);
        let interrupt_disabled_for_poll = interrupt_disabled_before;

        if (this.irq_poll_mask_override_active === 1) {
            interrupt_disabled_for_poll = this.irq_poll_mask_override_value;
        }

        if (this.jammed === 1) {
            this.execute_jammed_cycles();
        } else if (this.nmi_pending === 1) {
            this.nmi_pending = 0;
            this.irq_poll_mask_override_active = 0;
            this.selected_sequence = CPU_SEQUENCE_KIND.NMI;
            this.execute_hardware_interrupt_cycles(CPU_INTERRUPT_SOURCE.NMI);
        } else if (this.irq_line_asserted === 1 && interrupt_disabled_for_poll === 0) {
            this.irq_poll_mask_override_active = 0;
            this.selected_sequence = CPU_SEQUENCE_KIND.IRQ;
            this.execute_hardware_interrupt_cycles(CPU_INTERRUPT_SOURCE.IRQ);
        } else {
            this.irq_poll_mask_override_active = 0;
            this.selected_sequence = CPU_SEQUENCE_KIND.INSTRUCTION;
            this.execute_instruction();
            this.finish_instruction(interrupt_disabled_before);
        }
    }

    /**
     * Mirror of the suite-14 handler: runs `step_count` control-loop steps, requesting an NMI and
     * asserting the IRQ line before the steps the record names, and returns the eight fixed
     * values, one sequence kind per step, and the access trace.
     */
    run_control_steps(step_count: number, nmi_request_step: number, irq_assert_step: number): number[] {
        const kinds: number[] = [];

        this.reset_cycle_accounting();
        this.reset_instruction_error();

        for (let step = 1; step <= step_count; step += 1) {
            if (step === nmi_request_step) {
                this.request_nmi();
            }

            if (step === irq_assert_step) {
                this.set_irq_line(1);
            }

            this.begin_next_sequence();
            kinds.push(this.selected_sequence);
        }

        return [
            this.cycles,
            this.program_counter,
            this.stack_pointer,
            this.status,
            this.a,
            this.x,
            this.y,
            this.instruction_error,
            ...kinds,
            ...this.access_log,
        ];
    }

    /** Mirror of `cpu_reset_instruction_error`. */
    reset_instruction_error(): void {
        this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.NONE;
    }

    /** Mirror of `cpu_fetch_and_decode_opcode`. */
    fetch_and_decode_opcode(): void {
        this.fetch_byte();

        if (this.decoder === null) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNDECODABLE_OPCODE;
            return;
        }

        this.decoder.decode(this.fetched_byte);
    }

    /** Mirror of `cpu_execute_branch`. */
    execute_branch(): void {
        let taken = 0;
        this.resolve_operand(CPU_ADDRESSING_MODE.RELATIVE, CPU_OPERAND_ACCESS.READ);
        const mnemonic = this.decoder?.mnemonic ?? 0;

        if (this.resolved_error !== CPU_OPERAND_ERROR_CODE.NONE) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNRESOLVED_OPERAND;
        } else if (mnemonic === CPU_MNEMONIC.BCC) {
            taken = 1 - has_status_flag(this.status, CPU_FLAG.CARRY);
        } else if (mnemonic === CPU_MNEMONIC.BCS) {
            taken = has_status_flag(this.status, CPU_FLAG.CARRY);
        } else if (mnemonic === CPU_MNEMONIC.BEQ) {
            taken = has_status_flag(this.status, CPU_FLAG.ZERO);
        } else if (mnemonic === CPU_MNEMONIC.BMI) {
            taken = has_status_flag(this.status, CPU_FLAG.NEGATIVE);
        } else if (mnemonic === CPU_MNEMONIC.BNE) {
            taken = 1 - has_status_flag(this.status, CPU_FLAG.ZERO);
        } else if (mnemonic === CPU_MNEMONIC.BPL) {
            taken = 1 - has_status_flag(this.status, CPU_FLAG.NEGATIVE);
        } else if (mnemonic === CPU_MNEMONIC.BVC) {
            taken = 1 - has_status_flag(this.status, CPU_FLAG.OVERFLOW);
        } else if (mnemonic === CPU_MNEMONIC.BVS) {
            taken = has_status_flag(this.status, CPU_FLAG.OVERFLOW);
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC;
        }

        if (this.instruction_error === CPU_INSTRUCTION_ERROR_CODE.NONE) {
            this.apply_relative_branch_cycles(taken);
        }
    }

    /** Mirror of `cpu_execute_jump`. */
    execute_jump(): void {
        this.resolve_operand(this.decoder?.mode ?? 0, CPU_OPERAND_ACCESS.READ);

        if (this.resolved_error !== CPU_OPERAND_ERROR_CODE.NONE) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNRESOLVED_OPERAND;
        } else if (
            this.resolved_kind === CPU_OPERAND_KIND.JUMP_TARGET ||
            this.resolved_kind === CPU_OPERAND_KIND.MEMORY
        ) {
            this.program_counter = this.resolved_address;
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_OPERAND;
        }
    }

    /** Mirror of `cpu_execute_regular_instruction`. */
    execute_regular_instruction(): void {
        this.resolve_operand(this.decoder?.mode ?? 0, this.decoder?.access ?? 0);

        if (this.resolved_error !== CPU_OPERAND_ERROR_CODE.NONE) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNRESOLVED_OPERAND;
        } else if (this.resolved_kind === CPU_OPERAND_KIND.IMPLIED) {
            this.read_cycle(this.program_counter);
            this.apply_implied_instruction();
        } else if (this.resolved_kind === CPU_OPERAND_KIND.ACCUMULATOR) {
            this.read_cycle(this.program_counter);
            this.modify_value(this.decoder?.mnemonic ?? 0, this.a);

            if (this.instruction_error === CPU_INSTRUCTION_ERROR_CODE.NONE) {
                this.a = this.alu_value;
                this.status = this.alu_status;
            }
        } else if (this.resolved_kind === CPU_OPERAND_KIND.IMMEDIATE) {
            this.apply_read_instruction(this.decoder?.mnemonic ?? 0, this.resolved_value);
        } else if (this.resolved_kind === CPU_OPERAND_KIND.MEMORY) {
            this.execute_memory_instruction();
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_OPERAND;
        }
    }

    /** Mirror of `cpu_apply_read_instruction mnemonic, value`. */
    apply_read_instruction(mnemonic: number, value: number): void {
        if (mnemonic === CPU_MNEMONIC.LDA) {
            this.a = normalize_byte(value);
            this.status = update_zero_negative_flags(this.status, this.a);
        } else if (mnemonic === CPU_MNEMONIC.LDX) {
            this.x = normalize_byte(value);
            this.status = update_zero_negative_flags(this.status, this.x);
        } else if (mnemonic === CPU_MNEMONIC.LDY) {
            this.y = normalize_byte(value);
            this.status = update_zero_negative_flags(this.status, this.y);
        } else if (mnemonic === CPU_MNEMONIC.ADC) {
            const result = alu_add_with_carry(this.a, value, this.status);
            this.alu_value = result.value;
            this.alu_status = result.status;
            this.a = result.value;
            this.status = result.status;
        } else if (mnemonic === CPU_MNEMONIC.SBC) {
            const result = alu_subtract_with_carry(this.a, value, this.status);
            this.alu_value = result.value;
            this.alu_status = result.status;
            this.a = result.value;
            this.status = result.status;
        } else if (mnemonic === CPU_MNEMONIC.AND) {
            const result = alu_and(this.a, value, this.status);
            this.alu_value = result.value;
            this.alu_status = result.status;
            this.a = result.value;
            this.status = result.status;
        } else if (mnemonic === CPU_MNEMONIC.ORA) {
            const result = alu_ora(this.a, value, this.status);
            this.alu_value = result.value;
            this.alu_status = result.status;
            this.a = result.value;
            this.status = result.status;
        } else if (mnemonic === CPU_MNEMONIC.EOR) {
            const result = alu_eor(this.a, value, this.status);
            this.alu_value = result.value;
            this.alu_status = result.status;
            this.a = result.value;
            this.status = result.status;
        } else if (mnemonic === CPU_MNEMONIC.CMP) {
            this.alu_status = alu_compare(this.a, value, this.status).status;
            this.status = this.alu_status;
        } else if (mnemonic === CPU_MNEMONIC.CPX) {
            this.alu_status = alu_compare(this.x, value, this.status).status;
            this.status = this.alu_status;
        } else if (mnemonic === CPU_MNEMONIC.CPY) {
            this.alu_status = alu_compare(this.y, value, this.status).status;
            this.status = this.alu_status;
        } else if (mnemonic === CPU_MNEMONIC.BIT) {
            this.alu_status = alu_bit_test(this.a, value, this.status).status;
            this.status = this.alu_status;
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC;
        }
    }

    /** Mirror of `cpu_execute_memory_instruction`. */
    execute_memory_instruction(): void {
        if (this.resolved_access === CPU_OPERAND_ACCESS.READ) {
            this.read_cycle(this.resolved_address);
            this.apply_read_instruction(this.decoder?.mnemonic ?? 0, this.cycle_value);
        } else if (this.resolved_access === CPU_OPERAND_ACCESS.WRITE) {
            this.compute_store_value();

            if (this.instruction_error === CPU_INSTRUCTION_ERROR_CODE.NONE) {
                this.write_cycle(this.resolved_address, this.store_value);
            }
        } else if (this.resolved_access === CPU_OPERAND_ACCESS.READ_MODIFY_WRITE) {
            this.read_cycle(this.resolved_address);
            this.write_cycle(this.resolved_address, this.cycle_value);
            this.modify_value(this.decoder?.mnemonic ?? 0, this.cycle_value);

            if (this.instruction_error === CPU_INSTRUCTION_ERROR_CODE.NONE) {
                this.write_cycle(this.resolved_address, this.alu_value);
                this.status = this.alu_status;
            }
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_OPERAND;
        }
    }

    /** Mirror of `cpu_compute_store_value`. */
    compute_store_value(): void {
        const mnemonic = this.decoder?.mnemonic ?? 0;

        if (mnemonic === CPU_MNEMONIC.STA) {
            this.store_value = this.a;
        } else if (mnemonic === CPU_MNEMONIC.STX) {
            this.store_value = this.x;
        } else if (mnemonic === CPU_MNEMONIC.STY) {
            this.store_value = this.y;
        } else {
            this.store_value = 0;
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC;
        }
    }

    /** Mirror of `cpu_modify_value mnemonic, value`. */
    modify_value(mnemonic: number, value: number): void {
        let result: AluResult | null = null;

        if (mnemonic === CPU_MNEMONIC.ASL) {
            result = alu_shift_left(value, this.status);
        } else if (mnemonic === CPU_MNEMONIC.LSR) {
            result = alu_shift_right(value, this.status);
        } else if (mnemonic === CPU_MNEMONIC.ROL) {
            result = alu_rotate_left(value, this.status);
        } else if (mnemonic === CPU_MNEMONIC.ROR) {
            result = alu_rotate_right(value, this.status);
        } else if (mnemonic === CPU_MNEMONIC.INC) {
            result = alu_increment(value, this.status);
        } else if (mnemonic === CPU_MNEMONIC.DEC) {
            result = alu_decrement(value, this.status);
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC;
        }

        if (result !== null) {
            this.alu_value = result.value;
            this.alu_status = result.status;
        }
    }

    /** Mirror of `cpu_apply_implied_instruction`. */
    apply_implied_instruction(): void {
        const mnemonic = this.decoder?.mnemonic ?? 0;

        if (mnemonic === CPU_MNEMONIC.INX) {
            this.x = normalize_byte(this.x + 1);
            this.status = update_zero_negative_flags(this.status, this.x);
        } else if (mnemonic === CPU_MNEMONIC.INY) {
            this.y = normalize_byte(this.y + 1);
            this.status = update_zero_negative_flags(this.status, this.y);
        } else if (mnemonic === CPU_MNEMONIC.DEX) {
            this.x = normalize_byte(this.x - 1);
            this.status = update_zero_negative_flags(this.status, this.x);
        } else if (mnemonic === CPU_MNEMONIC.DEY) {
            this.y = normalize_byte(this.y - 1);
            this.status = update_zero_negative_flags(this.status, this.y);
        } else if (mnemonic === CPU_MNEMONIC.TAX) {
            this.x = normalize_byte(this.a);
            this.status = update_zero_negative_flags(this.status, this.x);
        } else if (mnemonic === CPU_MNEMONIC.TAY) {
            this.y = normalize_byte(this.a);
            this.status = update_zero_negative_flags(this.status, this.y);
        } else if (mnemonic === CPU_MNEMONIC.TSX) {
            this.x = normalize_byte(this.stack_pointer);
            this.status = update_zero_negative_flags(this.status, this.x);
        } else if (mnemonic === CPU_MNEMONIC.TXA) {
            this.a = normalize_byte(this.x);
            this.status = update_zero_negative_flags(this.status, this.a);
        } else if (mnemonic === CPU_MNEMONIC.TXS) {
            this.stack_pointer = normalize_byte(this.x);
        } else if (mnemonic === CPU_MNEMONIC.TYA) {
            this.a = normalize_byte(this.y);
            this.status = update_zero_negative_flags(this.status, this.a);
        } else if (mnemonic === CPU_MNEMONIC.CLC) {
            this.status = set_status_flag(this.status, CPU_FLAG.CARRY, 0);
        } else if (mnemonic === CPU_MNEMONIC.CLD) {
            this.status = set_status_flag(this.status, CPU_FLAG.DECIMAL, 0);
        } else if (mnemonic === CPU_MNEMONIC.CLI) {
            this.status = set_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE, 0);
        } else if (mnemonic === CPU_MNEMONIC.CLV) {
            this.status = set_status_flag(this.status, CPU_FLAG.OVERFLOW, 0);
        } else if (mnemonic === CPU_MNEMONIC.SEC) {
            this.status = set_status_flag(this.status, CPU_FLAG.CARRY, 1);
        } else if (mnemonic === CPU_MNEMONIC.SED) {
            this.status = set_status_flag(this.status, CPU_FLAG.DECIMAL, 1);
        } else if (mnemonic === CPU_MNEMONIC.SEI) {
            this.status = set_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE, 1);
        } else if (mnemonic === CPU_MNEMONIC.NOP) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.NONE;
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC;
        }
    }

    /** Mirror of `cpu_execute_instruction`. */
    execute_instruction(): void {
        this.reset_instruction_error();
        this.fetch_and_decode_opcode();
        const decoder = this.decoder;
        const mnemonic = decoder?.mnemonic ?? 0;
        const mode = decoder?.mode ?? 0;

        if (this.instruction_error !== CPU_INSTRUCTION_ERROR_CODE.NONE) {
            return;
        }

        if (decoder === null || decoder.error !== CPU_OPCODE_ERROR_CODE.NONE) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNDECODABLE_OPCODE;
        } else if (mnemonic === CPU_MNEMONIC.KIL) {
            this.read_cycle(this.program_counter);
            this.jammed = 1;
        } else if (decoder.official === 0) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNOFFICIAL_OPCODE;
        } else if (mnemonic === CPU_MNEMONIC.BRK) {
            this.execute_brk_cycles();
        } else if (mnemonic === CPU_MNEMONIC.JSR) {
            this.execute_jsr_cycles();
        } else if (mnemonic === CPU_MNEMONIC.RTI) {
            this.execute_rti_cycles();
        } else if (mnemonic === CPU_MNEMONIC.RTS) {
            this.execute_rts_cycles();
        } else if (mnemonic === CPU_MNEMONIC.PHA) {
            this.read_cycle(this.program_counter);
            this.push_byte(this.a);
        } else if (mnemonic === CPU_MNEMONIC.PHP) {
            this.read_cycle(this.program_counter);
            this.push_status(1);
        } else if (mnemonic === CPU_MNEMONIC.PLA) {
            this.read_cycle(this.program_counter);
            this.read_cycle(256 + this.stack_pointer);
            this.pop_byte();
            this.a = this.popped_byte;
            this.status = update_zero_negative_flags(this.status, this.a);
        } else if (mnemonic === CPU_MNEMONIC.PLP) {
            this.read_cycle(this.program_counter);
            this.read_cycle(256 + this.stack_pointer);
            this.pop_byte();
            this.restore_status_from_stack(this.popped_byte);
        } else if (mnemonic === CPU_MNEMONIC.JMP) {
            this.execute_jump();
        } else if (mode === CPU_ADDRESSING_MODE.RELATIVE) {
            this.execute_branch();
        } else {
            this.execute_regular_instruction();
        }
    }

    /** The eight fixed values suite 13 reports before its access trace. */
    instruction_values(): number[] {
        return [
            this.cycles,
            this.program_counter,
            this.stack_pointer,
            this.status,
            this.a,
            this.x,
            this.y,
            this.instruction_error,
            ...this.access_log,
        ];
    }

    reported_values(): number[] {
        return [
            this.resolved_kind,
            this.resolved_mode,
            this.resolved_access,
            this.resolved_base_address,
            this.resolved_address,
            this.resolved_value,
            this.resolved_page_crossed,
            this.resolved_error,
            this.cycles,
            this.program_counter,
            this.stack_pointer,
            ...this.access_log,
        ];
    }
}

/** Mirror of the `cpu_opcode_error_code` enum in scratch/src/cpu_opcode.gs. */
export const CPU_OPCODE_ERROR_CODE = { NONE: 0, UNKNOWN_OPCODE: 1, BAD_TABLE: 2 } as const;

/** Mirror of the `cpu_opcode_layout` enum in scratch/src/cpu_opcode.gs. */
export const CPU_OPCODE_LAYOUT = {
    HEADER_VALUES: 2,
    FIELDS_PER_OPCODE: 6,
    OPCODE_COUNT: 256,
    SCHEMA_VERSION: 1,
} as const;

/** Mirror of the `cpu_opcode_field` enum in scratch/src/cpu_opcode.gs. */
export const CPU_OPCODE_FIELD = {
    MNEMONIC: 0,
    ADDRESSING_MODE: 1,
    BASE_CYCLES: 2,
    OPERAND_ACCESS: 3,
    PAGE_CROSS_CYCLE: 4,
    OFFICIAL: 5,
} as const;

/**
 * Mirror of scratch/src/cpu_opcode.gs: the decoded fields of one opcode byte read out of the
 * generated table list. The list is a constructor argument because the GoboScript side loads it
 * from data/opcode_table.txt at project start, and the mirror has no file to load.
 */
export class GoboscriptCpuOpcodeDecoder {
    table: number[];
    mnemonic = 0;
    mode = 0;
    base_cycles = 0;
    access = 0;
    page_cross_cycle = 0;
    official = 0;
    error = 0;

    constructor(table: readonly number[]) {
        this.table = [...table];
    }

    /** Mirror of `cpu_reset_opcode_decode`. */
    reset_decode(): void {
        this.mnemonic = 0;
        this.mode = 0;
        this.base_cycles = 0;
        this.access = 0;
        this.page_cross_cycle = 0;
        this.official = 0;
        this.error = CPU_OPCODE_ERROR_CODE.NONE;
    }

    /** Mirror of `cpu_check_opcode_table`. */
    check_table(): void {
        const expected_length =
            CPU_OPCODE_LAYOUT.HEADER_VALUES + CPU_OPCODE_LAYOUT.OPCODE_COUNT * CPU_OPCODE_LAYOUT.FIELDS_PER_OPCODE;
        this.error = CPU_OPCODE_ERROR_CODE.NONE;

        if (this.table.length !== expected_length) {
            this.error = CPU_OPCODE_ERROR_CODE.BAD_TABLE;
        } else if ((this.table[0] ?? 0) !== CPU_OPCODE_LAYOUT.SCHEMA_VERSION) {
            this.error = CPU_OPCODE_ERROR_CODE.BAD_TABLE;
        } else if ((this.table[1] ?? 0) !== CPU_OPCODE_LAYOUT.OPCODE_COUNT) {
            this.error = CPU_OPCODE_ERROR_CODE.BAD_TABLE;
        }
    }

    /**
     * Mirror of `cpu_opcode_table_normalize`: the port's file-backed list loads as strings and
     * is coerced once at boot. The mirror's table is already numeric, so this is the identity.
     */
    normalize_table(): void {
        const numeric: number[] = [];

        for (const entry of this.table) {
            numeric.push(to_number(entry));
        }

        this.table = numeric;
    }

    /** Mirror of `cpu_decode_opcode opcode`. */
    decode(opcode: number): void {
        const numeric_opcode = normalize_byte(opcode);
        const record_start = CPU_OPCODE_LAYOUT.HEADER_VALUES + numeric_opcode * CPU_OPCODE_LAYOUT.FIELDS_PER_OPCODE;
        this.reset_decode();
        this.mnemonic = this.table[record_start + CPU_OPCODE_FIELD.MNEMONIC] ?? 0;
        this.mode = this.table[record_start + CPU_OPCODE_FIELD.ADDRESSING_MODE] ?? 0;
        this.base_cycles = this.table[record_start + CPU_OPCODE_FIELD.BASE_CYCLES] ?? 0;
        this.access = this.table[record_start + CPU_OPCODE_FIELD.OPERAND_ACCESS] ?? 0;
        this.page_cross_cycle = this.table[record_start + CPU_OPCODE_FIELD.PAGE_CROSS_CYCLE] ?? 0;
        this.official = this.table[record_start + CPU_OPCODE_FIELD.OFFICIAL] ?? 0;

        if (this.mnemonic === 0) {
            this.error = CPU_OPCODE_ERROR_CODE.UNKNOWN_OPCODE;
        }
    }

    /**
     * Mirror of `cpu_decode_opcode_hot opcode`: the four fields an executing instruction reads.
     * The mirror's table is numeric from load, which is what the port's
     * cpu_opcode_table_normalize makes of its file-backed list at boot.
     */
    decode_hot(opcode: number): void {
        const numeric_opcode = normalize_byte(opcode);
        const record_start = CPU_OPCODE_LAYOUT.HEADER_VALUES + numeric_opcode * CPU_OPCODE_LAYOUT.FIELDS_PER_OPCODE;
        this.mnemonic = this.table[record_start + CPU_OPCODE_FIELD.MNEMONIC] ?? 0;
        this.mode = this.table[record_start + CPU_OPCODE_FIELD.ADDRESSING_MODE] ?? 0;
        this.access = this.table[record_start + CPU_OPCODE_FIELD.OPERAND_ACCESS] ?? 0;
        this.official = this.table[record_start + CPU_OPCODE_FIELD.OFFICIAL] ?? 0;
        this.error = CPU_OPCODE_ERROR_CODE.NONE;

        if (this.mnemonic === 0) {
            this.error = CPU_OPCODE_ERROR_CODE.UNKNOWN_OPCODE;
        }
    }

    /** The seven values `run_cpu_opcode_vector` appends to the actual list. */
    reported_values(): number[] {
        return [
            this.mnemonic,
            this.mode,
            this.base_cycles,
            this.access,
            this.page_cross_cycle,
            this.official,
            this.error,
        ];
    }
}

// ---- PPU bus mirror ----

const PPU_ADDRESS_SPACE = 0x4000;
const PPU_PATTERN_END = 0x2000;
const PPU_PALETTE_START = 0x3f00;
const PPU_NAMETABLE_MIRROR_START = 0x3000;
const PPU_NAMETABLE_PAGE = 0x400;
const PPU_PALETTE_MASK = 0x1f;
const PPU_PALETTE_COLOR_MASK = 0x3f;

/**
 * Mirror of `scratch/src/ppu_bus.gs` in integer-only TypeScript. Uses arithmetic instead of
 * bitwise operators, matching GoboScript's floored modulo and floor-division semantics.
 */
export class GoboscriptPpuBus {
    readonly nametable_ram = new Uint8Array(4096);
    readonly palette_ram = new Uint8Array(32);
    readonly oam = new Uint8Array(256);
    mapper_kind = 0;
    nrom_mirror: GoboscriptNromMapper | null = null;
    mmc3_mirror: GoboscriptMmc3Mapper | null = null;
    read_value = 0;
    oam_read_value = 0;

    attach_nrom(mirror: GoboscriptNromMapper): void {
        this.mapper_kind = 1;
        this.nrom_mirror = mirror;
        this.mmc3_mirror = null;
    }

    attach_mmc3(mirror: GoboscriptMmc3Mapper): void {
        this.mapper_kind = 2;
        this.mmc3_mirror = mirror;
        this.nrom_mirror = null;
    }

    detach(): void {
        this.mapper_kind = 0;
        this.nrom_mirror = null;
        this.mmc3_mirror = null;
    }

    get_mirroring(): number {
        if (this.mapper_kind === 1 && this.nrom_mirror) {
            return this.nrom_mirror.mirroring;
        }

        if (this.mapper_kind === 2 && this.mmc3_mirror) {
            return this.mmc3_mirror.mirroring;
        }

        return 1;
    }

    normalize_address(address: number): number {
        return ((address % PPU_ADDRESS_SPACE) + PPU_ADDRESS_SPACE) % PPU_ADDRESS_SPACE;
    }

    map_nametable(address: number): number {
        let base = address;

        if (base >= PPU_NAMETABLE_MIRROR_START) {
            base -= 0x1000;
        }

        const logical_table = Math.floor((base - PPU_PATTERN_END) / PPU_NAMETABLE_PAGE);
        const page_offset = (base - PPU_PATTERN_END) % PPU_NAMETABLE_PAGE;
        const mirroring = this.get_mirroring();
        let physical_table: number;

        if (mirroring === 2) {
            physical_table = ((logical_table % 2) + 2) % 2;
        } else if (mirroring === 1) {
            physical_table = Math.floor(logical_table / 2);
        } else if (mirroring === 3) {
            physical_table = logical_table;
        } else {
            physical_table = Math.floor(logical_table / 2);
        }

        return physical_table * PPU_NAMETABLE_PAGE + page_offset;
    }

    map_palette(address: number): number {
        let index = address & PPU_PALETTE_MASK;

        if (index >= 0x10 && index % 4 === 0) {
            index -= 0x10;
        }

        return index;
    }

    read_ppu(address: number): number {
        const ppu_address = this.normalize_address(address);
        this.read_value = 0;

        if (ppu_address < PPU_PATTERN_END) {
            if (this.mapper_kind === 1 && this.nrom_mirror) {
                this.nrom_mirror.read_pattern(ppu_address);
                this.read_value = this.nrom_mirror.pattern_value;
            } else if (this.mapper_kind === 2 && this.mmc3_mirror) {
                this.mmc3_mirror.read_pattern(ppu_address);
                this.read_value = this.mmc3_mirror.pattern_value;
            }

            return this.read_value;
        }

        if (ppu_address < PPU_PALETTE_START) {
            const nt_index = this.map_nametable(ppu_address);
            this.read_value = this.nametable_ram[nt_index] ?? 0;

            return this.read_value;
        }

        const pal_index = this.map_palette(ppu_address);
        this.read_value = this.palette_ram[pal_index] ?? 0;

        return this.read_value;
    }

    write_ppu(address: number, value: number): void {
        const ppu_address = this.normalize_address(address);
        const byte_value = normalize_byte(value);

        if (ppu_address < PPU_PATTERN_END) {
            if (this.mapper_kind === 1 && this.nrom_mirror) {
                this.nrom_mirror.write_pattern(ppu_address, byte_value);
            } else if (this.mapper_kind === 2 && this.mmc3_mirror) {
                this.mmc3_mirror.write_pattern(ppu_address, byte_value);
            }

            return;
        }

        if (ppu_address < PPU_PALETTE_START) {
            const nt_index = this.map_nametable(ppu_address);
            this.nametable_ram[nt_index] = byte_value;

            return;
        }

        const pal_index = this.map_palette(ppu_address);
        this.palette_ram[pal_index] = byte_value & PPU_PALETTE_COLOR_MASK;
    }

    read_oam(address: number): number {
        const numeric = normalize_byte(address);
        this.oam_read_value = this.oam[numeric] ?? 0;

        return this.oam_read_value;
    }

    write_oam(address: number, value: number): void {
        const numeric = normalize_byte(address);
        this.oam[numeric] = normalize_byte(value);
    }

    observe_ppu_address(address: number): void {
        const ppu_address = this.normalize_address(address);

        if (this.mapper_kind === 2 && this.mmc3_mirror) {
            this.mmc3_mirror.observe_ppu_address(ppu_address);
        }
    }

    clock_ppu_dot(): void {
        if (this.mapper_kind === 2 && this.mmc3_mirror) {
            this.mmc3_mirror.clock_ppu_dot();
        }
    }
}

// ---- PPU 2C02 mirror ----

const PPU_DOTS_PER_SCANLINE = 341;
const PPU_PRE_RENDER_SCANLINE = 261;
const PPU_VBLANK_FIRST_SCANLINE = 241;
const PPU_VBLANK_START_DOT = 1;
const PPU_STATUS_FLAGS_MASK = 0xe0;
const PPU_VBLANK_FLAG = 0x80;
const PPU_CONTROL_NMI_ENABLE = 0x80;

/**
 * Mirror of `scratch/src/ppu_2c02.gs` timing and register I/O in integer-only TypeScript.
 * Covers the subset that the shared suite-5 vectors exercise: PPUCTRL, PPUSTATUS, timing,
 * and NMI edge detection.
 */
export class GoboscriptPpu2C02 {
    readonly bus: GoboscriptPpuBus;
    control_register = 0;
    mask_register = 0;
    status_register = 0;
    oam_address = 0;
    vram_address = 0;
    temporary_vram_address = 0;
    fine_x_scroll = 0;
    write_toggle = 0;
    read_buffer = 0;
    io_latch = 0;
    suppress_vblank_start = 0;
    scanline = PPU_PRE_RENDER_SCANLINE;
    dot = 0;
    frame_number = 0;
    odd_frame = 0;
    nmi_output = 0;
    nmi_edge_pending = 0;

    constructor(bus: GoboscriptPpuBus) {
        this.bus = bus;
    }

    reset(): void {
        this.control_register = 0;
        this.mask_register = 0;
        this.status_register = 0;
        this.oam_address = 0;
        this.vram_address = 0;
        this.temporary_vram_address = 0;
        this.fine_x_scroll = 0;
        this.write_toggle = 0;
        this.read_buffer = 0;
        this.io_latch = 0;
        this.suppress_vblank_start = 0;
        this.scanline = PPU_PRE_RENDER_SCANLINE;
        this.dot = 0;
        this.frame_number = 0;
        this.odd_frame = 0;
        this.nmi_output = 0;
        this.nmi_edge_pending = 0;
    }

    set_vblank_flag(active: boolean): void {
        if (active) {
            this.status_register |= PPU_VBLANK_FLAG;
        } else {
            this.status_register &= ~PPU_VBLANK_FLAG;
        }

        this.status_register &= PPU_STATUS_FLAGS_MASK;
        this.refresh_nmi_output();
    }

    refresh_nmi_output(): void {
        const next =
            (this.control_register & PPU_CONTROL_NMI_ENABLE) !== 0 &&
            (this.status_register & PPU_VBLANK_FLAG) !== 0;

        if (next && !this.nmi_output) {
            this.nmi_edge_pending = 1;
        }

        this.nmi_output = next ? 1 : 0;
    }

    write_cpu_register(register_index: number, value: number): void {
        const byte_value = normalize_byte(value);
        this.io_latch = byte_value;

        if (register_index === 0) {
            this.control_register = byte_value;
            const nt_bits = (byte_value & 0x03) << 10;
            this.temporary_vram_address = (this.temporary_vram_address & 0x73ff) | nt_bits;
            this.refresh_nmi_output();
        } else if (register_index === 1) {
            this.mask_register = byte_value;
        } else if (register_index === 3) {
            this.oam_address = byte_value;
        } else if (register_index === 5) {
            if (this.write_toggle === 0) {
                this.fine_x_scroll = byte_value & 0x07;
                this.temporary_vram_address = (this.temporary_vram_address & ~0x1f) | ((byte_value >>> 3) & 0x1f);
                this.write_toggle = 1;
            } else {
                const fine_y = (byte_value & 0x07) << 12;
                const coarse_y = ((byte_value & 0xf8) >>> 3) << 5;
                this.temporary_vram_address = (this.temporary_vram_address & 0x0c1f) | fine_y | coarse_y;
                this.write_toggle = 0;
            }
        } else if (register_index === 6) {
            if (this.write_toggle === 0) {
                this.temporary_vram_address = (this.temporary_vram_address & 0x00ff) | ((byte_value & 0x3f) << 8);
                this.write_toggle = 1;
            } else {
                this.temporary_vram_address = (this.temporary_vram_address & 0x7f00) | byte_value;
                this.vram_address = this.temporary_vram_address;
                this.write_toggle = 0;
                this.bus.observe_ppu_address(this.vram_address & 0x3fff);
            }
        } else if (register_index === 7) {
            this.bus.write_ppu(this.vram_address & 0x3fff, byte_value);
            const increment = (this.control_register & 0x04) === 0 ? 1 : 32;
            this.vram_address = (this.vram_address + increment) & 0x7fff;
            this.bus.observe_ppu_address(this.vram_address & 0x3fff);
        }
    }

    read_status_register(): number {
        if (this.scanline === PPU_VBLANK_FIRST_SCANLINE && this.dot <= PPU_VBLANK_START_DOT) {
            this.suppress_vblank_start = 1;
        }

        const value = (this.status_register & PPU_STATUS_FLAGS_MASK) | (this.io_latch & 0x1f);
        this.status_register &= ~PPU_VBLANK_FLAG;
        this.write_toggle = 0;
        this.io_latch = value;
        this.refresh_nmi_output();

        return value;
    }

    get_status_register(): number {
        return this.status_register & PPU_STATUS_FLAGS_MASK;
    }

    take_nmi_edge(): number {
        const edge = this.nmi_edge_pending;
        this.nmi_edge_pending = 0;

        return edge;
    }

    is_rendering_enabled(): boolean {
        return (this.mask_register & 0x18) !== 0;
    }

    clock_ppu_dot(): void {
        this.bus.clock_ppu_dot();

        if (this.scanline === PPU_VBLANK_FIRST_SCANLINE && this.dot === PPU_VBLANK_START_DOT) {
            if (this.suppress_vblank_start) {
                this.suppress_vblank_start = 0;
            } else {
                this.set_vblank_flag(true);
            }
        }

        if (this.scanline === PPU_PRE_RENDER_SCANLINE && this.dot === 1) {
            this.set_vblank_flag(false);
        }

        this.advance_dot();
    }

    private advance_dot(): void {
        const rendering = this.is_rendering_enabled();

        if (
            this.scanline === PPU_PRE_RENDER_SCANLINE &&
            this.dot === 339 &&
            this.odd_frame === 1 &&
            rendering
        ) {
            this.scanline = 0;
            this.dot = 0;

            return;
        }

        if (this.dot < PPU_DOTS_PER_SCANLINE - 1) {
            this.dot += 1;

            return;
        }

        this.dot = 0;

        if (this.scanline === 260) {
            this.scanline = PPU_PRE_RENDER_SCANLINE;
            this.frame_number += 1;
            this.odd_frame = this.frame_number & 1;

            return;
        }

        if (this.scanline === PPU_PRE_RENDER_SCANLINE) {
            this.scanline = 0;

            return;
        }

        this.scanline += 1;
    }
}

/** Red plane of the `nes_palette_red` list filled by `nes_palette_init` in nes_palette.gs. */
export const NES_PALETTE_RED: readonly number[] = [
    84, 0, 8, 48, 68, 92, 84, 60, 32, 8, 0, 0, 0, 0, 0, 0,
    152, 8, 48, 92, 136, 160, 152, 120, 84, 40, 8, 0, 0, 0, 0, 0,
    236, 76, 120, 176, 228, 236, 236, 212, 160, 116, 76, 56, 56, 60, 0, 0,
    236, 168, 188, 212, 236, 236, 236, 228, 204, 180, 168, 152, 160, 160, 0, 0,
];

/** Green plane of the `nes_palette_green` list in nes_palette.gs. */
export const NES_PALETTE_GREEN: readonly number[] = [
    84, 30, 16, 0, 0, 0, 4, 24, 42, 58, 64, 60, 50, 0, 0, 0,
    150, 76, 50, 30, 20, 20, 34, 60, 90, 114, 124, 118, 102, 0, 0, 0,
    238, 154, 124, 98, 84, 88, 106, 136, 170, 196, 208, 204, 180, 60, 0, 0,
    238, 204, 188, 178, 174, 174, 180, 196, 210, 222, 226, 226, 214, 162, 0, 0,
];

/** Blue plane of the `nes_palette_blue` list in nes_palette.gs. */
export const NES_PALETTE_BLUE: readonly number[] = [
    84, 116, 144, 136, 100, 48, 0, 0, 0, 0, 0, 0, 60, 0, 0, 0,
    152, 196, 236, 228, 176, 100, 32, 0, 0, 0, 0, 40, 120, 0, 0, 0,
    236, 236, 236, 236, 236, 180, 100, 32, 0, 0, 32, 108, 204, 60, 0, 0,
    236, 236, 236, 236, 236, 212, 176, 144, 120, 120, 144, 180, 228, 160, 0, 0,
];

/** The `nes_hex_digits` list in nes_palette.gs, held as one string for `charAt` reads. */
const NES_HEX_DIGITS = "0123456789abcdef";

/** Mirror of `nes_palette_dim_channel(channel)`: three quarters, rounded half up. */
export function nes_palette_dim_channel(channel: number): number {
    return scratch_floor_divide(scratch_mod(channel, 256) * 3 + 2, 4);
}

/** Mirror of `nes_palette_hex_byte(channel)`: the two hex digits of one channel byte. */
export function nes_palette_hex_byte(channel: number): string {
    const byte_value = scratch_mod(channel, 256);

    return (
        NES_HEX_DIGITS.charAt(scratch_floor_divide(byte_value, 16)) +
        NES_HEX_DIGITS.charAt(scratch_mod(byte_value, 16))
    );
}

/** Mirror of `nes_pen_color(color_index, emphasis)`: the "#rrggbb" pen color. */
export function nes_pen_color(color_index: number, emphasis: number): string {
    const palette_offset = scratch_mod(color_index, 64);
    const emphasis_bits = scratch_mod(emphasis, 8);
    let red = NES_PALETTE_RED[palette_offset];
    let green = NES_PALETTE_GREEN[palette_offset];
    let blue = NES_PALETTE_BLUE[palette_offset];

    if (red === undefined || green === undefined || blue === undefined) {
        throw new RangeError(`NES palette offset ${palette_offset} is outside its storage.`);
    }

    if (scratch_mod(emphasis_bits, 2) === 1) {
        green = nes_palette_dim_channel(green);
        blue = nes_palette_dim_channel(blue);
    }

    if (scratch_mod(scratch_floor_divide(emphasis_bits, 2), 2) === 1) {
        red = nes_palette_dim_channel(red);
        blue = nes_palette_dim_channel(blue);
    }

    if (scratch_mod(scratch_floor_divide(emphasis_bits, 4), 2) === 1) {
        red = nes_palette_dim_channel(red);
        green = nes_palette_dim_channel(green);
    }

    return "#" + nes_palette_hex_byte(red) + nes_palette_hex_byte(green) + nes_palette_hex_byte(blue);
}

/** Mirror of `ppu_shift_pixel(shift_low, shift_high, fine_x)` in ppu_2c02.gs. */
export function ppu_shift_pixel(shift_low: number, shift_high: number, fine_x: number): number {
    let bit_weight = 32768;

    for (let step = 0; step < fine_x; step += 1) {
        bit_weight = scratch_floor_divide(bit_weight, 2);
    }

    return (
        scratch_mod(scratch_floor_divide(shift_low, bit_weight), 2) +
        scratch_mod(scratch_floor_divide(shift_high, bit_weight), 2) * 2
    );
}

/** Mirror of `ppu_select_palette_offset` in ppu_2c02.gs. */
export function ppu_select_palette_offset(
    bg_pixel: number,
    bg_palette: number,
    has_sprite: number,
    spr_pixel: number,
    spr_attributes: number,
): number {
    if (has_sprite === 1 && (bg_pixel === 0 || scratch_mod(scratch_floor_divide(spr_attributes, 32), 2) === 0)) {
        return 16 + scratch_mod(spr_attributes, 4) * 4 + spr_pixel;
    }

    if (bg_pixel !== 0) {
        return bg_palette * 4 + bg_pixel;
    }

    return 0;
}

/** The reversal the port's table is built from; the mirror builds it at load. */
export const PPU_REVERSE_BYTE_TABLE: readonly number[] = Array.from({ length: 256 }, (_unused, value) => {
    let remaining = value;
    let result = 0;

    for (let bit = 0; bit < 8; bit += 1) {
        result = result * 2 + scratch_mod(remaining, 2);
        remaining = scratch_floor_divide(remaining, 2);
    }

    return result;
});

/** Mirror of `ppu_reverse_table_init`; the mirror's table is built at load. */
export function ppu_reverse_table_init(): void {
    // The table above is a const array built at module load, so there is nothing to fill here.
    // The function exists so the declaration inventory stays one-to-one.
}

/** Mirror of `ppu_reverse_byte_bits(byte_value)` in ppu_2c02.gs: one table read. */
export function ppu_reverse_byte_bits(byte_value: number): number {
    return PPU_REVERSE_BYTE_TABLE[scratch_mod(byte_value, 256)] ?? 0;
}

/** Mirror of `ppu_reverse_byte_bits_slow(byte_value)`: the loop the table is built from. */
export function ppu_reverse_byte_bits_slow(byte_value: number): number {
    return PPU_REVERSE_BYTE_TABLE[scratch_mod(byte_value, 256)] ?? 0;
}

/** Mirror of `ppu_sprite_row(target_scanline, sprite_y)` in ppu_2c02.gs. */
export function ppu_sprite_row(target_scanline: number, sprite_y: number): number {
    return normalize_byte(target_scanline - (sprite_y + 1));
}

/** Mirror of `ppu_sprite_pattern_address` in ppu_2c02.gs. */
export function ppu_sprite_pattern_address(
    control_value: number,
    tile_value: number,
    attributes_value: number,
    row_value: number,
): number {
    let sprite_height = 8;
    let effective_row = row_value;
    let pattern_table = 0;
    let base_tile = scratch_mod(tile_value, 256);

    if (scratch_mod(scratch_floor_divide(control_value, 32), 2) === 1) {
        sprite_height = 16;
    }

    if (scratch_mod(scratch_floor_divide(attributes_value, 128), 2) === 1) {
        effective_row = sprite_height - row_value - 1;
    }

    if (sprite_height === 16) {
        pattern_table = scratch_mod(base_tile, 2) * 4096;
        base_tile = base_tile - scratch_mod(base_tile, 2);

        if (effective_row >= 8) {
            base_tile = base_tile + 1;
        }

        return pattern_table + base_tile * 16 + scratch_mod(effective_row, 8);
    }

    pattern_table = scratch_mod(scratch_floor_divide(control_value, 8), 2) * 4096;

    return pattern_table + base_tile * 16 + effective_row;
}

/**
 * Mirror of `ppu_increment_scroll_x_for(vram_value)` in ppu_2c02.gs. The reference masks
 * and toggles bits; the port spells the same operations as division, modulo and addition.
 */
export function ppu_increment_scroll_x_for(vram_value: number): number {
    let result = scratch_mod(vram_value, 32768);

    if (scratch_mod(result, 32) === 31) {
        result = result - 31;

        const nametable_bit = scratch_mod(scratch_floor_divide(result, 1024), 2);
        result = nametable_bit === 1 ? result - 1024 : result + 1024;
    } else {
        result = result + 1;
    }

    return scratch_mod(result, 32768);
}

/** Mirror of `ppu_increment_scroll_y_for(vram_value)` in ppu_2c02.gs. */
export function ppu_increment_scroll_y_for(vram_value: number): number {
    let result = scratch_mod(vram_value, 32768);
    let coarse_y = 0;

    if (scratch_mod(scratch_floor_divide(result, 4096), 8) !== 7) {
        result = result + 4096;
    } else {
        result = scratch_mod(result, 4096);
        coarse_y = scratch_mod(scratch_floor_divide(result, 32), 32);

        if (coarse_y === 29) {
            coarse_y = 0;

            const nametable_bit = scratch_mod(scratch_floor_divide(result, 2048), 2);
            result = nametable_bit === 1 ? result - 2048 : result + 2048;
        } else if (coarse_y === 31) {
            coarse_y = 0;
        } else {
            coarse_y = coarse_y + 1;
        }

        result = result - scratch_mod(scratch_floor_divide(result, 32), 32) * 32 + coarse_y * 32;
    }

    return scratch_mod(result, 32768);
}

/** Mirror of `ppu_transfer_horizontal_for` in ppu_2c02.gs. */
export function ppu_transfer_horizontal_for(current_value: number, temporary_value: number): number {
    const current = scratch_mod(current_value, 32768);
    const temporary = scratch_mod(temporary_value, 32768);

    return (
        current -
        scratch_mod(current, 32) -
        scratch_mod(scratch_floor_divide(current, 1024), 2) * 1024 +
        scratch_mod(temporary, 32) +
        scratch_mod(scratch_floor_divide(temporary, 1024), 2) * 1024
    );
}

/** Mirror of `ppu_transfer_vertical_for` in ppu_2c02.gs. */
export function ppu_transfer_vertical_for(current_value: number, temporary_value: number): number {
    const current = scratch_mod(current_value, 32768);
    const temporary = scratch_mod(temporary_value, 32768);

    return (
        scratch_mod(current, 32) +
        scratch_mod(scratch_floor_divide(current, 1024), 2) * 1024 +
        temporary -
        scratch_mod(temporary, 32) -
        scratch_mod(scratch_floor_divide(temporary, 1024), 2) * 1024
    );
}

/** Mirror of `pen_display_fit_scale` in pen_display.gs. */
export function pen_display_fit_scale(
    stage_width: number,
    stage_height: number,
    frame_width: number,
    frame_height: number,
): number {
    const scale_x = stage_width / frame_width;
    const scale_y = stage_height / frame_height;

    if (scale_x < scale_y) {
        return scale_x;
    }

    return scale_y;
}

/** Mirror of `pen_display_scale_for` in pen_display.gs (480x360 stage, 256x240 frame). */
export function pen_display_scale_for(fit_enabled: number): number {
    if (fit_enabled === 1) {
        return pen_display_fit_scale(480, 360, 256, 240);
    }

    return 1;
}

/** Mirror of `pen_display_renderer_offset` in pen_display.gs. */
export function pen_display_renderer_offset(scale_value: number): number {
    if (scale_value === 1) {
        return 0.5;
    }

    return 0;
}

/** Mirror of `pen_display_first_x_for` in pen_display.gs. */
export function pen_display_first_x_for(scale_value: number): number {
    const picture_width = 256 * scale_value;

    return (0 - (picture_width / 2)) + (scale_value / 2) - pen_display_renderer_offset(scale_value);
}

/** Mirror of `pen_display_first_y_for` in pen_display.gs. */
export function pen_display_first_y_for(scale_value: number): number {
    const picture_height = 240 * scale_value;

    return (picture_height / 2) - (scale_value / 2) - pen_display_renderer_offset(scale_value);
}
