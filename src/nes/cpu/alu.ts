import {
    CARRY_FLAG,
    NEGATIVE_FLAG,
    OVERFLOW_FLAG,
    ZERO_FLAG,
    normalize_byte,
    normalize_status,
    set_status_flag,
    update_zero_negative_flags,
} from "./registers.js";

export interface AluResult {
    readonly value: number;
    readonly status: number;
}

/** Adds two bytes and carry using the 2A03's binary arithmetic. */
export function add_with_carry(accumulator: number, operand: number, status: number): AluResult {
    const left = normalize_byte(accumulator);
    const right = normalize_byte(operand);
    const carry_in = (normalize_status(status) & CARRY_FLAG) === 0 ? 0 : 1;
    const sum = left + right + carry_in;
    const value = normalize_byte(sum);
    const overflow = (~(left ^ right) & (left ^ value) & NEGATIVE_FLAG) !== 0;
    let updated_status = normalize_status(status);

    updated_status = set_status_flag(updated_status, CARRY_FLAG, sum > 0xff);
    updated_status = set_status_flag(updated_status, OVERFLOW_FLAG, overflow);
    updated_status = update_zero_negative_flags(updated_status, value);

    return { value, status: updated_status };
}

/** Applies SBC's borrow-in convention using the 2A03's binary arithmetic. */
export function subtract_with_carry(accumulator: number, operand: number, status: number): AluResult {
    const left = normalize_byte(accumulator);
    const right = normalize_byte(operand);
    const carry_in = (normalize_status(status) & CARRY_FLAG) === 0 ? 0 : 1;
    const difference = left - right - (1 - carry_in);
    const value = normalize_byte(difference);
    const overflow = ((left ^ right) & (left ^ value) & NEGATIVE_FLAG) !== 0;
    let updated_status = normalize_status(status);

    updated_status = set_status_flag(updated_status, CARRY_FLAG, difference >= 0);
    updated_status = set_status_flag(updated_status, OVERFLOW_FLAG, overflow);
    updated_status = update_zero_negative_flags(updated_status, value);

    return { value, status: updated_status };
}
