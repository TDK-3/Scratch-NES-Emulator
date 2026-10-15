import assert from "node:assert/strict";
import test from "node:test";

import { add_with_carry, subtract_with_carry } from "../src/nes/cpu/alu.js";
import {
    CARRY_FLAG,
    DECIMAL_FLAG,
    INTERRUPT_DISABLE_FLAG,
    NEGATIVE_FLAG,
    OVERFLOW_FLAG,
    UNUSED_FLAG,
    ZERO_FLAG,
} from "../src/nes/cpu/registers.js";

test("ADC matches binary 2A03 arithmetic for every byte pair and carry input", () => {
    for (let accumulator = 0; accumulator <= 0xff; accumulator += 1) {
        for (let operand = 0; operand <= 0xff; operand += 1) {
            for (const carry_in of [0, 1]) {
                const input_status = DECIMAL_FLAG | INTERRUPT_DISABLE_FLAG | carry_in * CARRY_FLAG;
                const result = add_with_carry(accumulator, operand, input_status);
                const sum = accumulator + operand + carry_in;
                const expected_value = sum % 0x100;
                const expected_overflow =
                    ((accumulator ^ operand) & 0x80) === 0 &&
                    ((accumulator ^ expected_value) & 0x80) !== 0;

                assert.equal(result.value, expected_value);
                assert.equal(result.status & CARRY_FLAG, sum > 0xff ? CARRY_FLAG : 0);
                assert.equal(result.status & ZERO_FLAG, expected_value === 0 ? ZERO_FLAG : 0);
                assert.equal(
                    result.status & NEGATIVE_FLAG,
                    (expected_value & 0x80) !== 0 ? NEGATIVE_FLAG : 0,
                );
                assert.equal(
                    result.status & OVERFLOW_FLAG,
                    expected_overflow ? OVERFLOW_FLAG : 0,
                );
                assert.notEqual(result.status & UNUSED_FLAG, 0);
                assert.equal(result.status & DECIMAL_FLAG, DECIMAL_FLAG);
                assert.equal(result.status & INTERRUPT_DISABLE_FLAG, INTERRUPT_DISABLE_FLAG);
            }
        }
    }
});

test("SBC matches binary 2A03 arithmetic for every byte pair and carry input", () => {
    for (let accumulator = 0; accumulator <= 0xff; accumulator += 1) {
        for (let operand = 0; operand <= 0xff; operand += 1) {
            for (const carry_in of [0, 1]) {
                const input_status = DECIMAL_FLAG | INTERRUPT_DISABLE_FLAG | carry_in * CARRY_FLAG;
                const result = subtract_with_carry(accumulator, operand, input_status);
                const difference = accumulator - operand - (1 - carry_in);
                const expected_value = ((difference % 0x100) + 0x100) % 0x100;
                const expected_overflow =
                    ((accumulator ^ operand) & 0x80) !== 0 &&
                    ((accumulator ^ expected_value) & 0x80) !== 0;

                assert.equal(result.value, expected_value);
                assert.equal(result.status & CARRY_FLAG, difference >= 0 ? CARRY_FLAG : 0);
                assert.equal(result.status & ZERO_FLAG, expected_value === 0 ? ZERO_FLAG : 0);
                assert.equal(
                    result.status & NEGATIVE_FLAG,
                    (expected_value & 0x80) !== 0 ? NEGATIVE_FLAG : 0,
                );
                assert.equal(
                    result.status & OVERFLOW_FLAG,
                    expected_overflow ? OVERFLOW_FLAG : 0,
                );
                assert.notEqual(result.status & UNUSED_FLAG, 0);
                assert.equal(result.status & DECIMAL_FLAG, DECIMAL_FLAG);
                assert.equal(result.status & INTERRUPT_DISABLE_FLAG, INTERRUPT_DISABLE_FLAG);
            }
        }
    }
});
