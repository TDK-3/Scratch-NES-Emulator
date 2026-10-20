# Bitwise lookup tables for the GoboScript port.
#
# GoboScript has no bitwise operators, so every mask, shift, and flag test is integer
# arithmetic. Walking one bit at a time is too slow for a bus read, so the bitwise helpers in
# src/numeric.gs look their answer up in the nibble table built here.
#
# The table holds a & b for the two nibbles 0-15 selected by index = high * 16 + low, which
# makes one 256-entry list enough for every AND: an eight-bit operand is split into its high
# and low nibble, each pair is looked up, and the two halves are recombined. OR and XOR are
# then derived from AND with a + b - (a & b) and a + b - 2 * (a & b), so they need no table of
# their own.
#
# The table is a Stage-owned list because the numeric helpers are compiled into the Stage's
# translation unit, and the Stage's green flag runs bitwise_table_init before the self test
# replays its first vector or the console reads its first bus byte.

# AND of the two nibbles 0-15 selected by index = high * 16 + low, filled by
# bitwise_table_init. A built list rather than a literal: 256 hand-written entries would be
# 256 chances for a transcription slip that no test here could catch.
list bitwise_table_and = [0; 256];

# OR and XOR of the two nibbles 0-15, built alongside AND to avoid deriving them via
# a+b-(a&b) arithmetic per byte operation (~12k extra ops/frame).
list bitwise_table_or = [0; 256];
list bitwise_table_xor = [0; 256];

# Full-byte tables: 256x256 = 65,536 entries for direct byte lookup (1 list read vs 2 nibble
# lookups + combine). One-time init cost ~65k iterations, saves ~12k ops/frame on byte paths.
list bitwise_table_byte_and = [0; 65536];
list bitwise_table_byte_or = [0; 65536];
list bitwise_table_byte_xor = [0; 65536];

# Builds the nibble AND table once per run. a & b for two nibbles is the sum of the bit
# weights both operands share, so four tests fill all 256 entries.
proc bitwise_table_init {
    local high = 0;
    local low = 0;
    local index = 1;
    local value = 0;
    local weight = 0;
    local or_value = 0;
    local xor_value = 0;
    local high_bit = 0;
    local low_bit = 0;
    local byte_left = 0;
    local byte_right = 0;
    local byte_index = 1;
    local byte_and = 0;
    local byte_or = 0;
    local byte_xor = 0;
    local bit = 0;
    local left_bit = 0;
    local right_bit = 0;

    until high == 16 {
        low = 0;

        until low == 16 {
            value = 0;
            weight = 1;

            repeat 4 {
                if ((high // weight) % 2 == 1) and ((low // weight) % 2 == 1) {
                    value = value + weight;
                }

                weight = weight * 2;
            }

            bitwise_table_and[index] = value;
            or_value = 0;
            xor_value = 0;
            weight = 1;

            repeat 4 {
                high_bit = (high // weight) % 2;
                low_bit = (low // weight) % 2;

                if high_bit == 1 or low_bit == 1 {
                    or_value = or_value + weight;
                }

                if high_bit != low_bit {
                    xor_value = xor_value + weight;
                }

                weight = weight * 2;
            }

            bitwise_table_or[index] = or_value;
            bitwise_table_xor[index] = xor_value;
            index = index + 1;
            low = low + 1;
        }

        high = high + 1;
    }

    # Build full-byte tables from nibble logic: 65,536 direct lookups for byte AND/OR/XOR.
    byte_left = 0;
    byte_right = 0;
    byte_index = 1;
    byte_and = 0;
    byte_or = 0;
    byte_xor = 0;
    bit = 0;

    until byte_left == 256 {
        byte_right = 0;

        until byte_right == 256 {
            byte_and = 0;
            byte_or = 0;
            byte_xor = 0;
            bit = 1;

            repeat 8 {
                left_bit = (byte_left // bit) % 2;
                right_bit = (byte_right // bit) % 2;

                if left_bit == 1 and right_bit == 1 {
                    byte_and = byte_and + bit;
                }

                if left_bit == 1 or right_bit == 1 {
                    byte_or = byte_or + bit;
                }

                if left_bit != right_bit {
                    byte_xor = byte_xor + bit;
                }

                bit = bit * 2;
            }

            bitwise_table_byte_and[byte_index] = byte_and;
            bitwise_table_byte_or[byte_index] = byte_or;
            bitwise_table_byte_xor[byte_index] = byte_xor;
            byte_index = byte_index + 1;
            byte_right = byte_right + 1;
        }

        byte_left = byte_left + 1;
    }
}
