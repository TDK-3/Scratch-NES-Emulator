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
#
# These are the hottest procedures in the emulator: one runs for most instructions a game
# executes. They therefore touch the status byte once instead of six times. A carry or
# overflow flag used to cost a has_status_flag call and two set_status_flag calls, and each of
# those normalized the status and walked a bit; here the status is normalized once, the carry
# input is a single modulo, the two stored flags are written with arithmetic on their own
# weights, and update_zero_negative_flags finishes the result bits in one pass. The byte
# operands are reduced with "%" instead of a normalize_byte call, and the signed conversions
# are inlined.

%include src/cpu_status

var alu_value = 0;
var alu_status = 0;

# ADC; mirrors add_with_carry(accumulator, operand, status).
proc alu_add_with_carry accumulator, operand, status {
    local left = $accumulator % 256;
    local right = $operand % 256;
    local normalized = normalize_status($status);
    local carry_in = normalized % 2;
    local sum = (left + right) + carry_in;
    local value = sum % 256;
    local signed_left = left;
    local signed_right = right;
    local signed_value = value;
    local signed_sum = 0;
    local updated = 0;
    local overflow_bit = 0;

    if signed_left >= 128 {
        signed_left = signed_left - 256;
    }

    if signed_right >= 128 {
        signed_right = signed_right - 256;
    }

    if signed_value >= 128 {
        signed_value = signed_value - 256;
    }

    signed_sum = (signed_left + signed_right) + carry_in;

    if sum > 255 {
        updated = normalized + (1 - (normalized % 2));
    } else {
        updated = normalized - (normalized % 2);
    }

    overflow_bit = (updated // 64) % 2;

    if signed_sum != signed_value {
        updated = updated + (64 * (1 - overflow_bit));
    } else {
        updated = updated - (64 * overflow_bit);
    }

    alu_value = value;
    alu_status = update_zero_negative_flags(updated, value);
}

# SBC; mirrors subtract_with_carry(accumulator, operand, status).
proc alu_subtract_with_carry accumulator, operand, status {
    local left = $accumulator % 256;
    local right = $operand % 256;
    local normalized = normalize_status($status);
    local borrow = 1 - (normalized % 2);
    local difference = (left - right) - borrow;
    local value = difference % 256;
    local signed_left = left;
    local signed_right = right;
    local signed_value = value;
    local signed_difference = 0;
    local updated = 0;
    local overflow_bit = 0;

    if signed_left >= 128 {
        signed_left = signed_left - 256;
    }

    if signed_right >= 128 {
        signed_right = signed_right - 256;
    }

    if signed_value >= 128 {
        signed_value = signed_value - 256;
    }

    signed_difference = (signed_left - signed_right) - borrow;

    if difference >= 0 {
        updated = normalized + (1 - (normalized % 2));
    } else {
        updated = normalized - (normalized % 2);
    }

    overflow_bit = (updated // 64) % 2;

    if signed_difference != signed_value {
        updated = updated + (64 * (1 - overflow_bit));
    } else {
        updated = updated - (64 * overflow_bit);
    }

    alu_value = value;
    alu_status = update_zero_negative_flags(updated, value);
}

# AND against the accumulator; mirrors the CPU's AND step.
proc alu_and accumulator, operand, status {
    local value = bitwise_and($accumulator % 256, $operand % 256);
    alu_value = value;
    alu_status = update_zero_negative_flags($status, value);
}

# ORA against the accumulator; mirrors the CPU's ORA step.
proc alu_ora accumulator, operand, status {
    local value = bitwise_or($accumulator % 256, $operand % 256);
    alu_value = value;
    alu_status = update_zero_negative_flags($status, value);
}

# EOR against the accumulator; mirrors the CPU's EOR step.
proc alu_eor accumulator, operand, status {
    local value = bitwise_xor($accumulator % 256, $operand % 256);
    alu_value = value;
    alu_status = update_zero_negative_flags($status, value);
}

# ASL; mirrors the CPU's accumulator shift-left step.
proc alu_shift_left value, status {
    local byte = $value % 256;
    local shifted = byte * 2;
    local result = shifted % 256;
    local normalized = normalize_status($status);
    local updated = 0;

    if shifted > 255 {
        updated = normalized + (1 - (normalized % 2));
    } else {
        updated = normalized - (normalized % 2);
    }

    alu_value = result;
    alu_status = update_zero_negative_flags(updated, result);
}

# LSR; mirrors the CPU's accumulator shift-right step.
proc alu_shift_right value, status {
    local byte = $value % 256;
    local result = byte // 2;
    local normalized = normalize_status($status);
    local updated = 0;

    if byte % 2 == 1 {
        updated = normalized + (1 - (normalized % 2));
    } else {
        updated = normalized - (normalized % 2);
    }

    alu_value = result;
    alu_status = update_zero_negative_flags(updated, result);
}

# ROL; mirrors the CPU's accumulator rotate-left step.
proc alu_rotate_left value, status {
    local byte = $value % 256;
    local normalized = normalize_status($status);
    local shifted = (byte * 2) + (normalized % 2);
    local result = shifted % 256;
    local updated = 0;

    if shifted > 255 {
        updated = normalized + (1 - (normalized % 2));
    } else {
        updated = normalized - (normalized % 2);
    }

    alu_value = result;
    alu_status = update_zero_negative_flags(updated, result);
}

# ROR; mirrors the CPU's accumulator rotate-right step.
proc alu_rotate_right value, status {
    local byte = $value % 256;
    local normalized = normalize_status($status);
    local shifted = byte + ((normalized % 2) * 256);
    local result = shifted // 2;
    local updated = 0;

    if shifted % 2 == 1 {
        updated = normalized + (1 - (normalized % 2));
    } else {
        updated = normalized - (normalized % 2);
    }

    alu_value = result;
    alu_status = update_zero_negative_flags(updated, result);
}

# CMP/CPX/CPY; mirrors the CPU's compare step, which leaves the source register unchanged.
proc alu_compare register_value, operand, status {
    local left = $register_value % 256;
    local right = $operand % 256;
    local difference = left - right;
    local normalized = normalize_status($status);
    local updated = 0;

    if difference >= 0 {
        updated = normalized + (1 - (normalized % 2));
    } else {
        updated = normalized - (normalized % 2);
    }

    alu_value = left;
    alu_status = update_zero_negative_flags(updated, difference % 256);
}

# BIT; mirrors the CPU's bit-test step: zero comes from A AND M, negative and overflow from M.
proc alu_bit_test accumulator, operand, status {
    local left = $accumulator % 256;
    local memory = $operand % 256;
    local tested = bitwise_and(left, memory);
    local normalized = normalize_status($status);
    local updated = 0;

    if tested == 0 {
        updated = normalized + (2 * (1 - ((normalized // 2) % 2)));
    } else {
        updated = normalized - (2 * ((normalized // 2) % 2));
    }

    if (memory // 128) % 2 == 1 {
        updated = updated + (128 * (1 - (updated // 128)));
    } else {
        updated = updated - (128 * (updated // 128));
    }

    if (memory // 64) % 2 == 1 {
        updated = updated + (64 * (1 - ((updated // 64) % 2)));
    } else {
        updated = updated - (64 * ((updated // 64) % 2));
    }

    alu_value = left;
    alu_status = updated;
}

# INC; mirrors the CPU's memory increment step.
proc alu_increment value, status {
    local result = (($value % 256) + 1) % 256;
    alu_value = result;
    alu_status = update_zero_negative_flags($status, result);
}

# DEC; mirrors the CPU's memory decrement step.
proc alu_decrement value, status {
    local result = (($value % 256) - 1) % 256;
    alu_value = result;
    alu_status = update_zero_negative_flags($status, result);
}
