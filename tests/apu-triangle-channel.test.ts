import assert from "node:assert/strict";
import { test } from "node:test";
import { ApuTriangleChannel } from "../src/nes/apu/triangle_channel.js";

const LENGTH_COUNTER_VALUES = [
    10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
    12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
] as const;
const TRIANGLE_SEQUENCE = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
] as const;

test("advances the 32-step waveform every timer period plus one CPU cycles", () => {
    const channel = create_active_triangle();
    channel.clock_quarter_frame();
    const observed = [channel.get_output()];

    for (let step = 0; step < 32; step += 1) {
        clock_timer_ticks(channel, 3);
        observed.push(channel.get_output());
    }

    assert.deepEqual(observed, [...TRIANGLE_SEQUENCE, TRIANGLE_SEQUENCE[0]]);
    assert.equal(channel.get_sequence_step(), 0);
});

test("linear counter gates sequencer stepping while the DAC holds its last value", () => {
    const channel = create_active_triangle(1);
    channel.clock_quarter_frame();
    clock_timer_ticks(channel, 3 * 5);

    assert.equal(channel.get_linear_counter(), 1);
    const held_output = channel.get_output();
    const held_step = channel.get_sequence_step();

    channel.clock_quarter_frame();
    assert.equal(channel.get_linear_counter(), 0);
    clock_timer_ticks(channel, 3 * 16);
    assert.equal(channel.get_sequence_step(), held_step);
    assert.equal(channel.get_output(), held_output);
});

test("loads length values and applies the triangle halt and disable rules", () => {
    const channel = create_active_triangle();

    for (let index = 0; index < LENGTH_COUNTER_VALUES.length; index += 1) {
        channel.write_timer_high(index << 3);
        assert.equal(channel.get_length_counter(), LENGTH_COUNTER_VALUES[index]);
    }

    channel.write_linear_control(0x81);
    channel.write_timer_high(0);
    channel.clock_half_frame();
    assert.equal(channel.get_length_counter(), 10);

    channel.write_linear_control(0x01);
    channel.clock_half_frame();
    assert.equal(channel.get_length_counter(), 9);

    channel.set_enabled(false);
    assert.equal(channel.get_status(), false);
    assert.equal(channel.get_length_counter(), 0);
    channel.write_timer_high(0);
    assert.equal(channel.get_length_counter(), 0);
});

test("does not reset the waveform phase on $400B and mutes periods below two", () => {
    const channel = create_active_triangle();
    channel.clock_quarter_frame();
    clock_timer_ticks(channel, 3 * 6);
    const sequence_step = channel.get_sequence_step();

    channel.write_timer_high(0);
    assert.equal(channel.get_sequence_step(), sequence_step);

    channel.write_timer_low(1);
    assert.equal(channel.get_output(), 0);
    channel.write_timer_low(2);
    assert.equal(channel.get_sequence_step(), sequence_step);
});

test("resets triangle state and rejects non-byte register values", () => {
    const channel = create_active_triangle();
    channel.clock_quarter_frame();
    clock_timer_ticks(channel, 12);
    assert.notEqual(channel.get_sequence_step(), 0);

    channel.reset();
    assert.equal(channel.get_output(), 0);
    assert.equal(channel.get_status(), false);
    assert.equal(channel.get_length_counter(), 0);
    assert.equal(channel.get_linear_counter(), 0);
    assert.equal(channel.get_timer_period(), 0);
    assert.equal(channel.get_sequence_step(), 0);

    assert.throws(() => channel.write_linear_control(-1), RangeError);
    assert.throws(() => channel.write_timer_low(256), RangeError);
    assert.throws(() => channel.write_timer_high(1.5), RangeError);
});

function create_active_triangle(linear_reload_value = 1): ApuTriangleChannel {
    const channel = new ApuTriangleChannel();
    channel.set_enabled(true);
    channel.write_linear_control(linear_reload_value);
    channel.write_timer_low(2);
    channel.write_timer_high(0);
    return channel;
}

function clock_timer_ticks(channel: ApuTriangleChannel, ticks: number): void {
    for (let tick = 0; tick < ticks; tick += 1) {
        channel.clock_timer();
    }
}
