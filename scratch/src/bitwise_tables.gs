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

# Builds the nibble AND table once per run. a & b for two nibbles is the sum of the bit
# weights both operands share, so four tests fill all 256 entries.
proc bitwise_table_init {
    local high = 0;
    local low = 0;
    local index = 1;
    local value = 0;
    local weight = 0;

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
            index = index + 1;
            low = low + 1;
        }

        high = high + 1;
    }
}
