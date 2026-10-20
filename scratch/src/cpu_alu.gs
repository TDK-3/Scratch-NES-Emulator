# 2A03 ALU operations for the GoboScript port.
#
# Every procedure leaves its eight-bit result in `alu_value` and the updated status byte in
# `alu_status`, which keeps the multi-value contracts of src/nes/cpu/alu.ts and the inline
# ALU steps of src/nes/cpu/cpu_2a03.ts expressible without tuple returns. Procs are
# run-without-screen-refresh by default, so they may call the numeric functions freely.
#
# The file has two layers. The general entry points (`alu_add_with_carry`, `alu_and`, ...) are
# the mirrored, exhaustive contracts: they normalize every argument and then hand the work to a
# byte entry point. The `_byte` entry points are what the CPU dispatch calls, because every
# operand the console passes them is a byte by construction: registers are normalized by every
# writer and bus values arrive as bytes. They therefore skip three `% 256` operations each, and
# they inline the zero/negative update (`update_zero_negative_flags`) instead of paying for a
# custom-block call on the hottest path in the emulator.
#
# The flag arithmetic is branch free. A 2A03 addition sets carry exactly when the unsigned sum
# reaches 256 and overflows exactly when the top bit of the result disagrees with the top bit
# of the sum of the operand sign bits; both fall out of one integer sum plus one modulo. SBC
# runs through the same code by complementing its substrahend (`a + (255 - b) + carry` is
# `a - b - borrow + 256`), which is how the hardware itself is built.
#
# status is always a normalized byte: `normalize_status` output from every writer.

%include src/cpu_status

var alu_value = 0;
var alu_status = 0;

# The zero/negative tail the byte entry points share, spelled out at each site because a helper
# func would be the very call this layer exists to avoid: drop bit 7 (modulo 128), drop bit 1
# (subtract its weight), then add the table's packed answer for the result byte.

# ADC; mirrors add_with_carry(accumulator, operand, status).
proc alu_add_with_carry accumulator, operand, status {
    local normalized = normalize_status($status);

    alu_add_with_carry_byte $accumulator % 256, $operand % 256, normalized;
}

# ADC on byte operands and a normalized status: the CPU dispatch entry point.
proc alu_add_with_carry_byte accumulator, operand, status {
    local left = $accumulator;
    local right = $operand;
    local normalized = $status;
    local carry_in = normalized % 2;
    local total = (left + right) + carry_in;
    local value = total % 256;

    # Overflow is the pair of sign disagreements: each operand's sign bit against the
    # result's. Two modulos and a multiply answer it branch free, next to the carry out of
    # `total`.
    local sign = value // 128;
    local updated = normalized - (normalized % 2) - (64 * ((normalized // 64) % 2))
        + (total // 256)
        + (64 * ((((left // 128) + sign) % 2) * (((right // 128) + sign) % 2)));

    alu_value = value;
    alu_status = (updated % 128) - (2 * ((updated // 2) % 2)) + cpu_zero_negative_bits[value + 1];
}

# SBC; mirrors subtract_with_carry(accumulator, operand, status).
proc alu_subtract_with_carry accumulator, operand, status {
    local normalized = normalize_status($status);

    alu_subtract_with_carry_byte $accumulator % 256, $operand % 256, normalized;
}

# SBC on byte operands and a normalized status. `left + (255 - right) + carry_in` is
# `left - right - borrow + 256`, so the addition form above answers the borrow flag, the
# overflow flag, and the result byte at once.
proc alu_subtract_with_carry_byte accumulator, operand, status {
    local left = $accumulator;
    local complement = 255 - $operand;
    local normalized = $status;
    local carry_in = normalized % 2;
    local total = (left + complement) + carry_in;
    local value = total % 256;
    local sign = value // 128;
    local updated = normalized - (normalized % 2) - (64 * ((normalized // 64) % 2))
        + (total // 256)
        + (64 * ((((left // 128) + sign) % 2) * (((complement // 128) + sign) % 2)));

    alu_value = value;
    alu_status = (updated % 128) - (2 * ((updated // 2) % 2)) + cpu_zero_negative_bits[value + 1];
}

# AND against the accumulator; mirrors the CPU's AND step.
proc alu_and accumulator, operand, status {
    local normalized = normalize_status($status);

    alu_and_byte $accumulator % 256, $operand % 256, normalized;
}

proc alu_and_byte accumulator, operand, status {
    local value = bitwise_and_byte($accumulator, $operand);
    local normalized = $status;
    local updated = (normalized % 128) - (2 * ((normalized // 2) % 2));

    alu_value = value;
    alu_status = updated + cpu_zero_negative_bits[value + 1];
}

# ORA against the accumulator; mirrors the CPU's ORA step.
proc alu_ora accumulator, operand, status {
    local normalized = normalize_status($status);

    alu_ora_byte $accumulator % 256, $operand % 256, normalized;
}

proc alu_ora_byte accumulator, operand, status {
    local value = bitwise_or_byte($accumulator, $operand);
    local normalized = $status;
    local updated = (normalized % 128) - (2 * ((normalized // 2) % 2));

    alu_value = value;
    alu_status = updated + cpu_zero_negative_bits[value + 1];
}

# EOR against the accumulator; mirrors the CPU's EOR step.
proc alu_eor accumulator, operand, status {
    local normalized = normalize_status($status);

    alu_eor_byte $accumulator % 256, $operand % 256, normalized;
}

proc alu_eor_byte accumulator, operand, status {
    local value = bitwise_xor_byte($accumulator, $operand);
    local normalized = $status;
    local updated = (normalized % 128) - (2 * ((normalized // 2) % 2));

    alu_value = value;
    alu_status = updated + cpu_zero_negative_bits[value + 1];
}

# ASL; mirrors the CPU's accumulator shift-left step.
proc alu_shift_left value, status {
    local normalized = normalize_status($status);

    alu_shift_left_byte $value % 256, normalized;
}

proc alu_shift_left_byte value, status {
    local byte = $value;
    local shifted = byte * 2;
    local result = shifted % 256;
    local normalized = $status;

    # The bit shifted out of the top is the carry: 0 or 1 from the divide.
    local updated = normalized - (normalized % 2) + (shifted // 256);

    alu_value = result;
    alu_status = (updated % 128) - (2 * ((updated // 2) % 2)) + cpu_zero_negative_bits[result + 1];
}

# LSR; mirrors the CPU's accumulator shift-right step.
proc alu_shift_right value, status {
    local normalized = normalize_status($status);

    alu_shift_right_byte $value % 256, normalized;
}

proc alu_shift_right_byte value, status {
    local byte = $value;
    local result = byte // 2;
    local normalized = $status;
    local updated = normalized - (normalized % 2) + (byte % 2);

    alu_value = result;
    alu_status = (updated % 128) - (2 * ((updated // 2) % 2)) + cpu_zero_negative_bits[result + 1];
}

# ROL; mirrors the CPU's accumulator rotate-left step.
proc alu_rotate_left value, status {
    local normalized = normalize_status($status);

    alu_rotate_left_byte $value % 256, normalized;
}

proc alu_rotate_left_byte value, status {
    local byte = $value;
    local normalized = $status;
    local shifted = (byte * 2) + (normalized % 2);
    local result = shifted % 256;
    local updated = normalized - (normalized % 2) + (shifted // 256);

    alu_value = result;
    alu_status = (updated % 128) - (2 * ((updated // 2) % 2)) + cpu_zero_negative_bits[result + 1];
}

# ROR; mirrors the CPU's accumulator rotate-right step.
proc alu_rotate_right value, status {
    local normalized = normalize_status($status);

    alu_rotate_right_byte $value % 256, normalized;
}

proc alu_rotate_right_byte value, status {
    local byte = $value;
    local normalized = $status;
    local shifted = byte + ((normalized % 2) * 256);
    local result = shifted // 2;
    local updated = normalized - (normalized % 2) + (shifted % 2);

    alu_value = result;
    alu_status = (updated % 128) - (2 * ((updated // 2) % 2)) + cpu_zero_negative_bits[result + 1];
}

# CMP/CPX/CPY; mirrors the CPU's compare step, which leaves the source register unchanged.
proc alu_compare register_value, operand, status {
    local normalized = normalize_status($status);

    alu_compare_byte $register_value % 256, $operand % 256, normalized;
}

proc alu_compare_byte register_value, operand, status {
    local left = $register_value;
    local difference = left - $operand;
    local normalized = $status;

    # Carry is set when no borrow was needed: a floored divide of a negative difference gives
    # -1, whose modulo 2 is 1, so `1 - that` is the flag without a branch.
    local updated = normalized - (normalized % 2) + (1 - ((difference // 256) % 2));
    local result = difference % 256;

    alu_value = left;
    alu_status = (updated % 128) - (2 * ((updated // 2) % 2)) + cpu_zero_negative_bits[result + 1];
}

# BIT; mirrors the CPU's bit-test step: zero comes from A AND M, negative and overflow from M.
proc alu_bit_test accumulator, operand, status {
    local normalized = normalize_status($status);

    alu_bit_test_byte $accumulator % 256, $operand % 256, normalized;
}

proc alu_bit_test_byte accumulator, operand, status {
    local left = $accumulator;
    local memory = $operand;
    local tested = bitwise_and_byte(left, memory);
    local normalized = $status;

    # Zero from A AND M, then negative and overflow copied from the operand's top two bits.
    # Each flag is cleared by subtracting its current weight and set by adding the new one, so
    # one expression replaces three set/clear branch pairs.
    local zero_flag = 0;

    if tested == 0 {
        zero_flag = 1;
    }

    local updated = (normalized - (2 * ((normalized // 2) % 2)) - (128 * ((normalized // 128) % 2))
        - (64 * ((normalized // 64) % 2))) + (2 * zero_flag)
        + (128 * ((memory // 128) % 2)) + (64 * ((memory // 64) % 2));

    alu_value = left;
    alu_status = updated;
}

# INC; mirrors the CPU's memory increment step.
proc alu_increment value, status {
    local normalized = normalize_status($status);

    alu_increment_byte $value, normalized;
}

proc alu_increment_byte value, status {
    local result = ($value + 1) % 256;
    local normalized = $status;
    local updated = (normalized % 128) - (2 * ((normalized // 2) % 2));

    alu_value = result;
    alu_status = updated + cpu_zero_negative_bits[result + 1];
}

# DEC; mirrors the CPU's memory decrement step.
proc alu_decrement value, status {
    local normalized = normalize_status($status);

    alu_decrement_byte $value, normalized;
}

proc alu_decrement_byte value, status {
    local result = ($value - 1) % 256;
    local normalized = $status;
    local updated = (normalized % 128) - (2 * ((normalized // 2) % 2));

    alu_value = result;
    alu_status = updated + cpu_zero_negative_bits[result + 1];
}
