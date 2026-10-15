import assert from "node:assert/strict";
import { test } from "node:test";
import { ApuPulseChannel } from "../src/nes/apu/pulse_channel.js";

const LENGTH_COUNTER_VALUES = [
    10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
    12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
] as const;
const DUTY_PATTERNS = [
    [0, 1, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0, 0, 0],
    [1, 0, 0, 1, 1, 1, 1, 1],
] as const;

test("produces the four pulse duty patterns from the initial sequencer step", () => {
    for (let duty = 0; duty < DUTY_PATTERNS.length; duty += 1) {
        const channel = create_constant_pulse(duty);
        const observed: number[] = [];

        for (let step = 0; step < 8; step += 1) {
            observed.push(channel.get_output() > 0 ? 1 : 0);

            for (let timer_tick = 0; timer_tick < 9; timer_tick += 1) {
                channel.clock_timer();
            }
        }

        assert.deepEqual(observed, DUTY_PATTERNS[duty]);
    }
});

test("advances the duty sequencer once per period-plus-one pulse-timer ticks", () => {
    const channel = create_constant_pulse(0);
    channel.write_timer_low(8);
    channel.write_timer_high(0);

    assert.equal(channel.get_output(), 0);
    for (let timer_tick = 0; timer_tick < 8; timer_tick += 1) {
        channel.clock_timer();
    }
    assert.equal(channel.get_output(), 0);

    channel.clock_timer();
    assert.equal(channel.get_output(), 15);

    for (let timer_tick = 0; timer_tick < 8; timer_tick += 1) {
        channel.clock_timer();
    }
    assert.equal(channel.get_output(), 15);

    channel.clock_timer();
    assert.equal(channel.get_output(), 0);
});

test("loads all length-counter table entries and applies halt and disable behavior", () => {
    const channel = create_constant_pulse(3);

    for (let index = 0; index < LENGTH_COUNTER_VALUES.length; index += 1) {
        channel.write_timer_high(index << 3);
        assert.equal(channel.get_length_counter(), LENGTH_COUNTER_VALUES[index]);
    }

    channel.write_control(0x30);
    channel.write_timer_high(0xf8);
    const halted_length = channel.get_length_counter();
    channel.clock_half_frame();
    assert.equal(channel.get_length_counter(), halted_length);

    channel.write_control(0x10);
    channel.clock_half_frame();
    assert.equal(channel.get_length_counter(), halted_length - 1);

    channel.set_enabled(false);
    assert.equal(channel.get_status(), false);
    assert.equal(channel.get_length_counter(), 0);
    channel.write_timer_high(0xf8);
    assert.equal(channel.get_length_counter(), 0);

    channel.set_enabled(true);
    assert.equal(channel.get_status(), false);
});

test("restarts, decays, loops, and holds the pulse envelope as programmed", () => {
    const envelope = new ApuPulseChannel(1);
    envelope.set_enabled(true);
    envelope.write_control(0xc0);
    envelope.write_timer_low(8);
    envelope.write_timer_high(0);

    assert.equal(envelope.get_output(), 0);
    envelope.clock_quarter_frame();
    assert.equal(envelope.get_output(), 15);
    envelope.clock_quarter_frame();
    assert.equal(envelope.get_output(), 14);

    for (let clock = 0; clock < 14; clock += 1) {
        envelope.clock_quarter_frame();
    }

    assert.equal(envelope.get_output(), 0);
    envelope.clock_quarter_frame();
    assert.equal(envelope.get_output(), 0);

    const looping = new ApuPulseChannel(2);
    looping.set_enabled(true);
    looping.write_control(0xe0);
    looping.write_timer_low(8);
    looping.write_timer_high(0);
    looping.clock_quarter_frame();

    for (let clock = 0; clock < 15; clock += 1) {
        looping.clock_quarter_frame();
    }

    assert.equal(looping.get_output(), 0);
    looping.clock_quarter_frame();
    assert.equal(looping.get_output(), 15);
    looping.clock_half_frame();
    assert.equal(looping.get_status(), true);

    const constant_volume = new ApuPulseChannel(1);
    constant_volume.set_enabled(true);
    constant_volume.write_control(0xd5);
    constant_volume.write_timer_low(8);
    constant_volume.write_timer_high(0);
    assert.equal(constant_volume.get_output(), 5);

    for (let clock = 0; clock < 20; clock += 1) {
        constant_volume.clock_quarter_frame();
    }

    assert.equal(constant_volume.get_output(), 5);
});

test("sweeps pulse periods with channel-specific negate behavior", () => {
    const pulse_one = create_constant_pulse(3, 1);
    pulse_one.write_timer_low(100);
    pulse_one.write_timer_high(0);
    pulse_one.write_sweep(0x81);
    pulse_one.clock_half_frame();
    assert.equal(pulse_one.get_timer_period(), 100);
    pulse_one.clock_half_frame();
    assert.equal(pulse_one.get_timer_period(), 150);

    const negative_pulse_one = create_constant_pulse(3, 1);
    negative_pulse_one.write_timer_low(100);
    negative_pulse_one.write_timer_high(0);
    negative_pulse_one.write_sweep(0x89);
    negative_pulse_one.clock_half_frame();
    negative_pulse_one.clock_half_frame();
    assert.equal(negative_pulse_one.get_timer_period(), 49);

    const negative_pulse_two = create_constant_pulse(3, 2);
    negative_pulse_two.write_timer_low(100);
    negative_pulse_two.write_timer_high(0);
    negative_pulse_two.write_sweep(0x89);
    negative_pulse_two.clock_half_frame();
    negative_pulse_two.clock_half_frame();
    assert.equal(negative_pulse_two.get_timer_period(), 50);
});

test("mutes pulse output for short periods and positive sweep overflow", () => {
    const short_period = create_constant_pulse(3);
    short_period.write_timer_low(7);
    short_period.write_timer_high(0);
    assert.equal(short_period.get_output(), 0);

    const overflow = create_constant_pulse(3);
    overflow.write_timer_low(0x40);
    overflow.write_timer_high(0x06);
    overflow.write_sweep(0x81);
    assert.equal(overflow.get_timer_period(), 0x640);
    assert.equal(overflow.get_output(), 0);
});

test("resets all pulse-channel state and rejects non-byte register values", () => {
    const channel = create_constant_pulse(3);
    channel.write_timer_low(100);
    channel.write_timer_high(0);
    channel.write_sweep(0x81);
    channel.clock_half_frame();
    channel.clock_half_frame();
    assert.equal(channel.get_status(), true);

    channel.reset();
    assert.equal(channel.get_status(), false);
    assert.equal(channel.get_length_counter(), 0);
    assert.equal(channel.get_timer_period(), 0);
    assert.equal(channel.get_output(), 0);

    assert.throws(() => channel.write_control(-1), RangeError);
    assert.throws(() => channel.write_sweep(256), RangeError);
    assert.throws(() => channel.write_timer_low(1.5), RangeError);
    assert.throws(() => channel.write_timer_high(Number.NaN), RangeError);
});

function create_constant_pulse(duty: number, channel_number: 1 | 2 = 1): ApuPulseChannel {
    const channel = new ApuPulseChannel(channel_number);
    channel.set_enabled(true);
    channel.write_control((duty << 6) | 0x1f);
    channel.write_timer_low(8);
    channel.write_timer_high(0);
    return channel;
}
