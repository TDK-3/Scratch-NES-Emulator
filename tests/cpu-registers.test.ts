import assert from "node:assert/strict";
import test from "node:test";

import {
    BREAK_FLAG,
    CARRY_FLAG,
    DECIMAL_FLAG,
    INTERRUPT_DISABLE_FLAG,
    NEGATIVE_FLAG,
    OVERFLOW_FLAG,
    UNUSED_FLAG,
    ZERO_FLAG,
    has_status_flag,
    normalize_byte,
    normalize_status,
    normalize_word,
    pack_status_for_stack,
    set_status_flag,
    unpack_status_from_stack,
    to_signed_byte,
    update_zero_negative_flags,
} from "../src/nes/cpu/registers.js";
import type { CpuStatusFlag } from "../src/nes/cpu/registers.js";

test("normalizes every byte value and wraps negative or oversized integers", () => {
    for (let value = 0; value <= 0xff; value += 1) {
        assert.equal(normalize_byte(value), value);
    }

    assert.equal(normalize_byte(-1), 0xff);
    assert.equal(normalize_byte(0x100), 0);
    assert.equal(normalize_byte(0x1ff), 0xff);
});

test("wraps CPU addresses into the 16-bit range", () => {
    assert.equal(normalize_word(-1), 0xffff);
    assert.equal(normalize_word(0x1_0000), 0);
    assert.equal(normalize_word(0x2_ffff), 0xffff);
});

test("converts byte boundaries to signed two's-complement values", () => {
    assert.equal(to_signed_byte(0), 0);
    assert.equal(to_signed_byte(0x7f), 127);
    assert.equal(to_signed_byte(0x80), -128);
    assert.equal(to_signed_byte(0xff), -1);
    assert.equal(to_signed_byte(-1), -1);
});

test("keeps the unused status bit set and break bit clear", () => {
    for (let status = 0; status <= 0xff; status += 1) {
        const normalized = normalize_status(status);

        assert.notEqual(normalized & UNUSED_FLAG, 0);
        assert.equal(normalized & BREAK_FLAG, 0);
    }
});

test("sets and clears each mutable status flag without changing other flags", () => {
    const flags: CpuStatusFlag[] = [
        CARRY_FLAG,
        ZERO_FLAG,
        INTERRUPT_DISABLE_FLAG,
        DECIMAL_FLAG,
        OVERFLOW_FLAG,
        NEGATIVE_FLAG,
    ];

    for (const flag of flags) {
        const set_status = set_status_flag(UNUSED_FLAG, flag, true);
        const cleared_status = set_status_flag(set_status, flag, false);

        assert.equal(has_status_flag(set_status, flag), true);
        assert.equal(has_status_flag(cleared_status, flag), false);
        assert.notEqual(cleared_status & UNUSED_FLAG, 0);
        assert.equal(cleared_status & BREAK_FLAG, 0);
    }
});

test("updates zero and negative flags while preserving unrelated flags", () => {
    const initial_status = CARRY_FLAG | DECIMAL_FLAG | INTERRUPT_DISABLE_FLAG;

    for (let value = 0; value <= 0xff; value += 1) {
        const status = update_zero_negative_flags(initial_status, value);

        assert.equal(has_status_flag(status, ZERO_FLAG), value === 0);
        assert.equal(has_status_flag(status, NEGATIVE_FLAG), (value & 0x80) !== 0);
        assert.equal(has_status_flag(status, CARRY_FLAG), true);
        assert.equal(has_status_flag(status, DECIMAL_FLAG), true);
        assert.equal(has_status_flag(status, INTERRUPT_DISABLE_FLAG), true);
    }
});

test("sets the stacked break bit for BRK but not for hardware interrupts", () => {
    const status = CARRY_FLAG | OVERFLOW_FLAG;

    assert.equal(pack_status_for_stack(status, "brk"), status | UNUSED_FLAG | BREAK_FLAG);
    assert.equal(pack_status_for_stack(status, "irq"), status | UNUSED_FLAG);
    assert.equal(pack_status_for_stack(status, "nmi"), status | UNUSED_FLAG);
});

test("restores stack status with the internal break and unused-bit convention", () => {
    assert.equal(unpack_status_from_stack(0xff), 0xef);
    assert.equal(unpack_status_from_stack(0x00), UNUSED_FLAG);
});

test("rejects values that cannot be represented as exact CPU integers", () => {
    assert.throws(() => normalize_byte(1.5), RangeError);
    assert.throws(() => normalize_byte(Number.NaN), RangeError);
    assert.throws(() => normalize_word(Number.MAX_SAFE_INTEGER + 1), RangeError);
});
