# 2A03 status-flag helpers.
#
# Mirrors src/nes/cpu/registers.ts: the unused bit stays set, the stack-only break bit stays
# clear outside a BRK push, and zero/negative updates come from an eight-bit result.
# tests/support/goboscript_port_algorithms.ts repeats these algorithms in TypeScript and the
# automated suite compares them exhaustively against the bitwise reference.
#
# Every one of these funcs used to call bit_at(), which itself called normalize_word(), so a
# single flag write cost several nested custom-block calls and a full 16-bit normalization.
# The status byte is eight bits wide, so the helpers now read their bits with "//" and "%"
# directly and only normalize when the input may be unnormalized. update_zero_negative_flags
# writes the two result bits straight into one normalized byte instead of calling
# set_status_flag twice and renormalizing after each call.

%include src/numeric

# Keeps the unused bit set and the break bit clear; mirrors normalize_status(). Scratch's
# modulo is floored, so a single "%" gives the low byte.
func normalize_status(status) {
    local byte = $status % 256;

    # Bits 0-3 stay, the break bit clears, the unused bit sets, and bits 6-7 stay: three
    # operators instead of reading the break and unused bits one modulo at a time.
    return (byte % 16) + 32 + ((byte // 64) * 64);
}

# Returns 1 when one status flag is set; mirrors has_status_flag().
func has_status_flag(status, flag) {
    local normalized = normalize_status($status);

    return (normalized // $flag) % 2;
}

# Sets or clears one status flag from a 0/1 input; mirrors set_status_flag(). The result is
# renormalized, so asking for the stack-only break bit here is a no-op exactly as it is in the
# TypeScript reference; pack_status_for_stack() is the only place that sets it.
func set_status_flag(status, flag, enabled) {
    local normalized = normalize_status($status);
    local updated = 0;

    if $enabled == 1 {
        updated = normalized + ($flag * (1 - ((normalized // $flag) % 2)));
    } else {
        updated = normalized - ($flag * ((normalized // $flag) % 2));
    }

    return normalize_status(updated);
}

# Updates zero and negative from an eight-bit result; mirrors update_zero_negative_flags().
# Only the zero and negative bits change, so the byte is normalized once and the two bits are
# written in place: both set_status_flag calls this replaces would have renormalized a value
# that already satisfies the invariant.
func update_zero_negative_flags(status, value) {
    local byte = $value % 256;
    local normalized = normalize_status($status);
    local without_zero = normalized - (2 * ((normalized // 2) % 2));
    local without_negative = without_zero - (128 * (without_zero // 128));
    local zero_bit = 0;
    local negative_bit = 0;

    if byte == 0 {
        zero_bit = cpu_flag.zero;
    }

    if byte >= 128 {
        negative_bit = cpu_flag.negative;
    }

    return without_negative + zero_bit + negative_bit;
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
