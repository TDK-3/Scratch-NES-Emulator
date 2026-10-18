# Numeric helpers for the GoboScript port of the NES emulator.
#
# GoboScript has no bitwise operators: "&" joins strings, and Scratch numbers are doubles.
# Every mask, shift, and flag test in this header is therefore integer arithmetic. Each
# helper is mirrored statement for statement in tests/support/goboscript_port_algorithms.ts,
# which the automated suite compares exhaustively against the bitwise TypeScript reference
# in src/nes/cpu/registers.ts and src/nes/cpu/alu.ts. Mirroring the algorithms is not the
# same as compiling this file; the pinned GoboScript compiler is still unavailable.

# 2A03 status flags. Values match the CARRY_FLAG..NEGATIVE_FLAG constants in registers.ts.
enum cpu_flag {
    carry = 1,
    zero = 2,
    interrupt_disable = 4,
    decimal = 8,
    break_flag = 16,
    unused = 32,
    overflow = 64,
    negative = 128
}

# Forces a list item or other string to a number. GoboScript optimizes "+ 0" away, so the
# empty-string form from the upstream workarounds guide is used instead.
func to_number(value) {
    return $value + "";
}

# Wraps an integer into the unsigned byte range; mirrors normalize_byte().
func normalize_byte(value) {
    local numeric = $value + "";

    return ((numeric % 256) + 256) % 256;
}

# Wraps an integer into the unsigned 16-bit address range; mirrors normalize_word().
func normalize_word(value) {
    local numeric = $value + "";

    return ((numeric % 65536) + 65536) % 65536;
}

# Converts a byte to its signed two's-complement value; mirrors to_signed_byte().
func to_signed_byte(value) {
    local byte = normalize_byte($value);

    if byte >= 128 {
        return byte - 256;
    }

    return byte;
}

# High byte of a 16-bit word.
func byte_high(word) {
    return normalize_word($word) // 256;
}

# Low byte of a 16-bit word.
func byte_low(word) {
    return normalize_word($word) % 256;
}

# Builds a 16-bit word from two bytes; the inverse of byte_high/byte_low.
func join_bytes(high, low) {
    return (normalize_byte($high) * 256) + normalize_byte($low);
}

# Returns 1 when the bit with the given power-of-two weight is set, otherwise 0.
func bit_at(value, weight) {
    return (normalize_word($value) // $weight) % 2;
}

# Bitwise AND over 16 bits. One iteration per bit is measurable overhead in hot CPU paths;
# a byte-wide variant is a benchmarking follow-up, not a silent optimization.
func bitwise_and(left, right) {
    local remaining_left = normalize_word($left);
    local remaining_right = normalize_word($right);
    local result = 0;
    local weight = 1;

    repeat 16 {
        if ((remaining_left % 2) == 1) and ((remaining_right % 2) == 1) {
            result += weight;
        }

        remaining_left = remaining_left // 2;
        remaining_right = remaining_right // 2;
        weight = weight * 2;
    }

    return result;
}

# Bitwise OR over 16 bits.
func bitwise_or(left, right) {
    local remaining_left = normalize_word($left);
    local remaining_right = normalize_word($right);
    local result = 0;
    local weight = 1;

    repeat 16 {
        if ((remaining_left % 2) == 1) or ((remaining_right % 2) == 1) {
            result += weight;
        }

        remaining_left = remaining_left // 2;
        remaining_right = remaining_right // 2;
        weight = weight * 2;
    }

    return result;
}

# Bitwise XOR over 16 bits.
func bitwise_xor(left, right) {
    local remaining_left = normalize_word($left);
    local remaining_right = normalize_word($right);
    local result = 0;
    local weight = 1;

    repeat 16 {
        if (remaining_left % 2) != (remaining_right % 2) {
            result += weight;
        }

        remaining_left = remaining_left // 2;
        remaining_right = remaining_right // 2;
        weight = weight * 2;
    }

    return result;
}
