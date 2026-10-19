# 2A03 status-flag helpers.
#
# Mirrors src/nes/cpu/registers.ts: the unused bit stays set, the stack-only break bit stays
# clear outside a BRK push, and zero/negative updates come from an eight-bit result.
# tests/support/goboscript_port_algorithms.ts repeats these algorithms in TypeScript and the
# automated suite compares them exhaustively against the bitwise reference.

%include src/numeric

# Keeps the unused bit set and the break bit clear; mirrors normalize_status().
func normalize_status(status) {
    local byte = normalize_byte($status);
    local without_break = byte - (16 * bit_at(byte, 16));

    return without_break + (32 * (1 - bit_at(without_break, 32)));
}

# Returns 1 when one status flag is set; mirrors has_status_flag().
func has_status_flag(status, flag) {
    return bit_at(normalize_status($status), $flag);
}

# Sets or clears one status flag from a 0/1 input; mirrors set_status_flag(). The result is
# renormalized, so asking for the stack-only break bit here is a no-op exactly as it is in the
# TypeScript reference; pack_status_for_stack() is the only place that sets it.
func set_status_flag(status, flag, enabled) {
    local normalized = normalize_status($status);
    local current = bit_at(normalized, $flag);
    local updated = 0;

    if $enabled == 1 {
        updated = normalized + ($flag * (1 - current));
    } else {
        updated = normalized - ($flag * current);
    }

    return normalize_status(updated);
}

# Updates zero and negative from an eight-bit result; mirrors update_zero_negative_flags().
func update_zero_negative_flags(status, value) {
    local byte = normalize_byte($value);
    local zero_enabled = 0;
    local negative_enabled = 0;

    if byte == 0 {
        zero_enabled = 1;
    }

    if byte >= 128 {
        negative_enabled = 1;
    }

    local with_zero = set_status_flag($status, cpu_flag.zero, zero_enabled);

    return set_status_flag(with_zero, cpu_flag.negative, negative_enabled);
}

# Packs the break bit for a software BRK push; mirrors pack_status_for_stack(status, "brk").
func pack_status_for_stack(status, break_enabled) {
    local normalized = normalize_status($status);

    if $break_enabled == 1 {
        return bitwise_or(normalized, cpu_flag.break_flag);
    }

    return normalized;
}

# Restores an internal status value from a stack byte; mirrors unpack_status_from_stack().
func unpack_status_from_stack(status) {
    return normalize_status($status);
}
