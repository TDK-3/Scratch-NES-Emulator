# Numeric helpers for the GoboScript port of the NES emulator.
#
# GoboScript has no bitwise operators: "&" joins strings, and Scratch numbers are doubles.
# Every mask, shift, and flag test in this header is therefore integer arithmetic. Each
# helper is mirrored statement for statement in tests/support/goboscript_port_algorithms.ts,
# which the automated suite compares exhaustively against the bitwise TypeScript reference
# in src/nes/cpu/registers.ts and src/nes/cpu/alu.ts. Mirroring the algorithms is not the
# same as compiling this file; the pinned GoboScript compiler is still unavailable.
#
# Performance notes for the Scratch runtime:
#
# - Scratch's "%" block is already a floored modulo, so it always lands in [0, divisor)
#   even for negative inputs. The old double-modulo form "(n % 256 + 256) % 256" was
#   therefore two blocks of pure overhead and is now a single "%".
# - Every func call compiles to a Scratch custom block, which costs far more than the
#   handful of operators it wraps. The helpers below therefore avoid calling each other
#   and inline the arithmetic they need.
# - A bitwise AND used to walk one bit per iteration (16 iterations of modulus, division,
#   comparison and addition) for every masked bus read. It now looks up the low and high
#   nibble pair in 256-entry tables. The AND table answers AND, the OR table answers OR,
#   and the XOR table answers XOR, each via two lookups for a byte and four for a word,
#   without deriving OR/XOR from AND arithmetic. src/bitwise_tables.gs fills them from the
#   Stage's green flag before anything reads a bus byte.

%include src/bitwise_tables

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

# Wraps an integer into the unsigned byte range; mirrors normalize_byte(). Scratch's modulo
# is floored, so this is the whole conversion.
func normalize_byte(value) {
    return $value % 256;
}

# Wraps an integer into the unsigned 16-bit address range; mirrors normalize_word().
func normalize_word(value) {
    return $value % 65536;
}

# Converts a byte to its signed two's-complement value; mirrors to_signed_byte().
func to_signed_byte(value) {
    local byte = $value % 256;

    if byte >= 128 {
        return byte - 256;
    }

    return byte;
}

# High byte of a 16-bit word.
func byte_high(word) {
    return ($word % 65536) // 256;
}

# Low byte of a 16-bit word.
func byte_low(word) {
    return $word % 256;
}

# Builds a 16-bit word from two bytes; the inverse of byte_high/byte_low.
func join_bytes(high, low) {
    return (($high % 256) * 256) + ($low % 256);
}

# Returns 1 when the bit with the given power-of-two weight is set, otherwise 0.
func bit_at(value, weight) {
    return (($value % 65536) // $weight) % 2;
}

# Bitwise AND over 16 bits, through the nibble table. Both operands are bytes for nearly every
# caller in the console, so the byte case takes a two-lookup path and only a wider pair pays
# for the full 16-bit split.
func bitwise_and(left, right) {
    local left_word = $left % 65536;
    local right_word = $right % 65536;

    if left_word < 256 and right_word < 256 {
        return (bitwise_table_and[((left_word // 16) * 16) + (right_word // 16) + 1] * 16)
            + bitwise_table_and[((left_word % 16) * 16) + (right_word % 16) + 1];
    }

    local left_high = left_word // 256;
    local right_high = right_word // 256;
    local left_low = left_word % 256;
    local right_low = right_word % 256;
    local high_nibbles = bitwise_table_and[((left_high // 16) * 16) + (right_high // 16) + 1];
    local high_bits = bitwise_table_and[((left_high % 16) * 16) + (right_high % 16) + 1];
    local low_nibbles = bitwise_table_and[((left_low // 16) * 16) + (right_low // 16) + 1];
    local low_bits = bitwise_table_and[((left_low % 16) * 16) + (right_low % 16) + 1];

    return (((high_nibbles * 16) + high_bits) * 256) + ((low_nibbles * 16) + low_bits);
}

# Bitwise OR over 16 bits, through the nibble OR table.
func bitwise_or(left, right) {
    local left_word = $left % 65536;
    local right_word = $right % 65536;

    if left_word < 256 and right_word < 256 {
        return (bitwise_table_or[((left_word // 16) * 16) + (right_word // 16) + 1] * 16)
            + bitwise_table_or[((left_word % 16) * 16) + (right_word % 16) + 1];
    }

    local left_high = left_word // 256;
    local right_high = right_word // 256;
    local left_low = left_word % 256;
    local right_low = right_word % 256;
    local high_nibbles = bitwise_table_or[((left_high // 16) * 16) + (right_high // 16) + 1];
    local high_bits = bitwise_table_or[((left_high % 16) * 16) + (right_high % 16) + 1];
    local low_nibbles = bitwise_table_or[((left_low // 16) * 16) + (right_low // 16) + 1];
    local low_bits = bitwise_table_or[((left_low % 16) * 16) + (right_low % 16) + 1];

    return (((high_nibbles * 16) + high_bits) * 256) + ((low_nibbles * 16) + low_bits);
}

# Bitwise XOR over 16 bits, through the nibble XOR table.
func bitwise_xor(left, right) {
    local left_word = $left % 65536;
    local right_word = $right % 65536;

    if left_word < 256 and right_word < 256 {
        return (bitwise_table_xor[((left_word // 16) * 16) + (right_word // 16) + 1] * 16)
            + bitwise_table_xor[((left_word % 16) * 16) + (right_word % 16) + 1];
    }

    local left_high = left_word // 256;
    local right_high = right_word // 256;
    local left_low = left_word % 256;
    local right_low = right_word % 256;
    local high_nibbles = bitwise_table_xor[((left_high // 16) * 16) + (right_high // 16) + 1];
    local high_bits = bitwise_table_xor[((left_high % 16) * 16) + (right_high % 16) + 1];
    local low_nibbles = bitwise_table_xor[((left_low // 16) * 16) + (right_low // 16) + 1];
    local low_bits = bitwise_table_xor[((left_low % 16) * 16) + (right_low % 16) + 1];

    return (((high_nibbles * 16) + high_bits) * 256) + ((low_nibbles * 16) + low_bits);
}
