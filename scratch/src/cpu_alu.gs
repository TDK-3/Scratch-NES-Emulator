# 2A03 ALU operations for the GoboScript port.
#
# Every procedure leaves its eight-bit result in `alu_value` and the updated status byte in
# `alu_status`, which keeps the multi-value contracts of src/nes/cpu/alu.ts and the inline
# ALU steps of src/nes/cpu/cpu_2a03.ts expressible without tuple returns. Procs are
# run-without-screen-refresh by default, so they may call the numeric functions freely.
#
# Overflow uses signed arithmetic instead of bitwise masks: a 2A03 addition overflows exactly
# when the signed sum differs from the signed result. tests/support/goboscript_port_algorithms.ts
# repeats these algorithms and the automated suite compares them exhaustively with
# add_with_carry()/subtract_with_carry() and with the production CPU instructions.

%include src/cpu_status

var alu_value = 0;
var alu_status = 0;

# ADC; mirrors add_with_carry(accumulator, operand, status).
proc alu_add_with_carry accumulator, operand, status {
    local left = normalize_byte($accumulator);
    local right = normalize_byte($operand);
    local carry_in = has_status_flag($status, cpu_flag.carry);
    local sum = (left + right) + carry_in;
    local value = normalize_byte(sum);
    local signed_sum = (to_signed_byte(left) + to_signed_byte(right)) + carry_in;
    local carry_enabled = 0;
    local overflow_enabled = 0;

    if sum > 255 {
        carry_enabled = 1;
    }

    if signed_sum != to_signed_byte(value) {
        overflow_enabled = 1;
    }

    local updated = set_status_flag($status, cpu_flag.carry, carry_enabled);
    updated = set_status_flag(updated, cpu_flag.overflow, overflow_enabled);
    alu_value = value;
    alu_status = update_zero_negative_flags(updated, value);
}

# SBC; mirrors subtract_with_carry(accumulator, operand, status).
proc alu_subtract_with_carry accumulator, operand, status {
    local left = normalize_byte($accumulator);
    local right = normalize_byte($operand);
    local carry_in = has_status_flag($status, cpu_flag.carry);
    local borrow = 1 - carry_in;
    local difference = (left - right) - borrow;
    local value = normalize_byte(difference);
    local signed_difference = (to_signed_byte(left) - to_signed_byte(right)) - borrow;
    local carry_enabled = 0;
    local overflow_enabled = 0;

    if difference >= 0 {
        carry_enabled = 1;
    }

    if signed_difference != to_signed_byte(value) {
        overflow_enabled = 1;
    }

    local updated = set_status_flag($status, cpu_flag.carry, carry_enabled);
    updated = set_status_flag(updated, cpu_flag.overflow, overflow_enabled);
    alu_value = value;
    alu_status = update_zero_negative_flags(updated, value);
}

# AND against the accumulator; mirrors the CPU's AND step.
proc alu_and accumulator, operand, status {
    local value = bitwise_and(normalize_byte($accumulator), normalize_byte($operand));
    alu_value = value;
    alu_status = update_zero_negative_flags($status, value);
}

# ORA against the accumulator; mirrors the CPU's ORA step.
proc alu_ora accumulator, operand, status {
    local value = bitwise_or(normalize_byte($accumulator), normalize_byte($operand));
    alu_value = value;
    alu_status = update_zero_negative_flags($status, value);
}

# EOR against the accumulator; mirrors the CPU's EOR step.
proc alu_eor accumulator, operand, status {
    local value = bitwise_xor(normalize_byte($accumulator), normalize_byte($operand));
    alu_value = value;
    alu_status = update_zero_negative_flags($status, value);
}

# ASL; mirrors the CPU's accumulator shift-left step.
proc alu_shift_left value, status {
    local byte = normalize_byte($value);
    local shifted = byte * 2;
    local result = normalize_byte(shifted);
    local carry_enabled = 0;

    if shifted > 255 {
        carry_enabled = 1;
    }

    local updated = set_status_flag($status, cpu_flag.carry, carry_enabled);
    alu_value = result;
    alu_status = update_zero_negative_flags(updated, result);
}

# LSR; mirrors the CPU's accumulator shift-right step.
proc alu_shift_right value, status {
    local byte = normalize_byte($value);
    local result = byte // 2;
    local updated = set_status_flag($status, cpu_flag.carry, byte % 2);
    alu_value = result;
    alu_status = update_zero_negative_flags(updated, result);
}

# ROL; mirrors the CPU's accumulator rotate-left step.
proc alu_rotate_left value, status {
    local byte = normalize_byte($value);
    local carry_in = has_status_flag($status, cpu_flag.carry);
    local shifted = (byte * 2) + carry_in;
    local result = normalize_byte(shifted);
    local carry_enabled = 0;

    if shifted > 255 {
        carry_enabled = 1;
    }

    local updated = set_status_flag($status, cpu_flag.carry, carry_enabled);
    alu_value = result;
    alu_status = update_zero_negative_flags(updated, result);
}

# ROR; mirrors the CPU's accumulator rotate-right step.
proc alu_rotate_right value, status {
    local byte = normalize_byte($value);
    local carry_in = has_status_flag($status, cpu_flag.carry);
    local shifted = byte + (carry_in * 256);
    local result = shifted // 2;
    local updated = set_status_flag($status, cpu_flag.carry, shifted % 2);
    alu_value = result;
    alu_status = update_zero_negative_flags(updated, result);
}

# CMP/CPX/CPY; mirrors the CPU's compare step, which leaves the source register unchanged.
proc alu_compare register_value, operand, status {
    local left = normalize_byte($register_value);
    local right = normalize_byte($operand);
    local difference = left - right;
    local carry_enabled = 0;

    if difference >= 0 {
        carry_enabled = 1;
    }

    local updated = set_status_flag($status, cpu_flag.carry, carry_enabled);
    alu_value = left;
    alu_status = update_zero_negative_flags(updated, normalize_byte(difference));
}

# BIT; mirrors the CPU's bit-test step: zero comes from A AND M, negative and overflow from M.
proc alu_bit_test accumulator, operand, status {
    local left = normalize_byte($accumulator);
    local memory = normalize_byte($operand);
    local tested = bitwise_and(left, memory);
    local zero_enabled = 0;

    if tested == 0 {
        zero_enabled = 1;
    }

    local updated = set_status_flag($status, cpu_flag.zero, zero_enabled);
    updated = set_status_flag(updated, cpu_flag.negative, bit_at(memory, 128));
    updated = set_status_flag(updated, cpu_flag.overflow, bit_at(memory, 64));
    alu_value = left;
    alu_status = updated;
}

# INC; mirrors the CPU's memory increment step.
proc alu_increment value, status {
    local result = normalize_byte(normalize_byte($value) + 1);
    alu_value = result;
    alu_status = update_zero_negative_flags($status, result);
}

# DEC; mirrors the CPU's memory decrement step.
proc alu_decrement value, status {
    local result = normalize_byte(normalize_byte($value) - 1);
    alu_value = result;
    alu_status = update_zero_negative_flags($status, result);
}
