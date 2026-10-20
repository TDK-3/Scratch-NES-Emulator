# Bitwise lookup tables for the GoboScript port.
#
# GoboScript has no bitwise operators, so every mask, shift, and flag test is integer
# arithmetic. Walking one bit at a time is too slow for a bus read, so the bitwise helpers in
# src/numeric.gs look their answer up in the nibble tables declared here.
#
# A table holds a & b (or a | b, or a xor b) for the two nibbles 0-15 selected by
# index = high * 16 + low, which makes one 256-entry list enough for any width: an operand is
# split into nibbles, each pair is looked up, and the results are recombined by shifting.
#
# The lists are Stage-owned because the numeric helpers are compiled into the Stage's
# translation unit, and the Stage's green flag runs bitwise_table_init before anything reads a
# bus byte.
#
# Cost, and why there are no 65,536-entry byte tables here. A byte pair needs two nibble reads
# plus a shift and an add. A full 256x256 byte table would answer the same query with one read,
# but it costs 65,536 list slots per table and, if it is built at run time, 65,536 loop
# iterations per table at every green flag. The audit measured that trade the wrong way round
# (docs/PERFORMANCE_AUDIT_TODO.md, N7): the boot cost is paid in full on every restart while
# the per-frame saving is a few tens of thousands of blocks, and reaching a byte table requires
# the operand bytes to have been normalized first, which is itself two modulos. The nibble
# tables are 256 entries each and the whole build is 256 iterations.

# AND, OR, and XOR of the two nibbles 0-15, selected by index = high * 16 + low, filled by
# bitwise_table_init. Built lists rather than literals: 768 hand-written entries would be 768
# chances for a transcription slip that no test here could catch.
list bitwise_table_and = [0; 256];
list bitwise_table_or = [0; 256];
list bitwise_table_xor = [0; 256];

# Builds the three nibble tables once per run. Every entry is the sum of the bit weights a
# rule selects, so four tests fill each entry and 256 iterations fill all 768.
#
# The OR and XOR entries are built here rather than derived from AND with
# a + b - (a & b) and a + b - 2 * (a & b) at use time: one list read is cheaper than two
# reads plus two subtractions, and the build is 256 iterations either way.
proc bitwise_table_init {
    local high = 0;
    local low = 0;
    local index = 1;
    local weight = 0;
    local and_value = 0;
    local or_value = 0;
    local xor_value = 0;
    local high_bit = 0;
    local low_bit = 0;

    until high == 16 {
        low = 0;

        until low == 16 {
            and_value = 0;
            or_value = 0;
            xor_value = 0;
            weight = 1;

            repeat 4 {
                high_bit = (high // weight) % 2;
                low_bit = (low // weight) % 2;

                if high_bit == 1 and low_bit == 1 {
                    and_value = and_value + weight;
                }

                if high_bit == 1 or low_bit == 1 {
                    or_value = or_value + weight;
                }

                if high_bit != low_bit {
                    xor_value = xor_value + weight;
                }

                weight = weight * 2;
            }

            bitwise_table_and[index] = and_value;
            bitwise_table_or[index] = or_value;
            bitwise_table_xor[index] = xor_value;
            index = index + 1;
            low = low + 1;
        }

        high = high + 1;
    }
}
