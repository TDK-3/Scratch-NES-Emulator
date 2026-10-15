const LENGTH_COUNTER_VALUES = [
    10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
    12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
] as const;

/** Returns the APU length-counter load value for a register's five-bit index. */
export function get_length_counter_value(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= LENGTH_COUNTER_VALUES.length) {
        throw new RangeError(`APU length-counter index ${index} is outside the lookup table.`);
    }

    const value = LENGTH_COUNTER_VALUES[index];

    if (value === undefined) {
        throw new RangeError(`APU length-counter index ${index} is outside the lookup table.`);
    }

    return value;
}
