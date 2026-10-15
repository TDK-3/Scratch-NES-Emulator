import assert from "node:assert/strict";
import { test } from "node:test";
import { ApuNoiseChannel } from "../src/nes/apu/noise_channel.js";

const NOISE_PERIODS_NTSC = [
    4, 8, 16, 32, 64, 96, 128, 160,
    202, 254, 380, 508, 762, 1016, 2034, 4068,
] as const;
const LENGTH_COUNTER_VALUES = [
    10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
    12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
] as const;
const LONG_LFSR_PERIOD = 32_767;
const SHORT_LFSR_PERIOD = 93;

test("uses all sixteen NTSC noise periods as exact CPU-cycle shift intervals", () => {
    const channel = new ApuNoiseChannel();

    for (let index = 0; index < NOISE_PERIODS_NTSC.length; index += 1) {
        const period = NOISE_PERIODS_NTSC[index] ?? 0;
        assert.notEqual(period, 0);
        channel.reset();
        channel.write_period(index);
        const initial_state = channel.get_shift_register();
        channel.clock_timer();
        const first_shift_state = channel.get_shift_register();

        assert.notEqual(first_shift_state, initial_state);
        clock_timer_ticks(channel, period - 1);
        assert.equal(channel.get_shift_register(), first_shift_state);

        channel.clock_timer();
        assert.notEqual(channel.get_shift_register(), first_shift_state);
    }
});

test("uses maximal-length and short-mode LFSR feedback sequences without entering zero", () => {
    assert.equal(count_lfsr_shifts_to_seed(0), LONG_LFSR_PERIOD);
    assert.equal(count_lfsr_shifts_to_seed(0x80), SHORT_LFSR_PERIOD);
});

test("restarts and decays the envelope, loops when halted, and supports constant volume", () => {
    const envelope = new ApuNoiseChannel();
    envelope.set_enabled(true);
    envelope.write_control(0x00);
    envelope.write_period(0);
    envelope.write_length(0);
    envelope.clock_timer();
    envelope.clock_quarter_frame();
    assert.equal(envelope.get_output(), 15);
    envelope.clock_quarter_frame();
    assert.equal(envelope.get_output(), 14);

    for (let frame = 0; frame < 14; frame += 1) {
        envelope.clock_quarter_frame();
    }

    assert.equal(envelope.get_output(), 0);

    const looping = new ApuNoiseChannel();
    looping.set_enabled(true);
    looping.write_control(0x20);
    looping.write_period(0);
    looping.write_length(0);
    looping.clock_timer();
    looping.clock_quarter_frame();

    for (let frame = 0; frame < 15; frame += 1) {
        looping.clock_quarter_frame();
    }

    assert.equal(looping.get_output(), 0);
    looping.clock_quarter_frame();
    assert.equal(looping.get_output(), 15);
    looping.clock_half_frame();
    assert.equal(looping.get_length_counter(), 10);

    const constant_volume = new ApuNoiseChannel();
    constant_volume.set_enabled(true);
    constant_volume.write_control(0x1b);
    constant_volume.write_period(0);
    constant_volume.write_length(0);
    constant_volume.clock_timer();
    assert.equal(constant_volume.get_output(), 11);
});

test("loads the length table and clears disabled lengths while honoring the halt bit", () => {
    const channel = new ApuNoiseChannel();
    channel.set_enabled(true);

    for (let index = 0; index < LENGTH_COUNTER_VALUES.length; index += 1) {
        channel.write_length(index << 3);
        assert.equal(channel.get_length_counter(), LENGTH_COUNTER_VALUES[index]);
    }

    channel.write_control(0x20);
    channel.write_length(0);
    channel.clock_half_frame();
    assert.equal(channel.get_length_counter(), 10);

    channel.write_control(0);
    channel.clock_half_frame();
    assert.equal(channel.get_length_counter(), 9);

    channel.set_enabled(false);
    assert.equal(channel.get_status(), false);
    channel.write_length(0);
    assert.equal(channel.get_length_counter(), 0);
});

test("uses mode-specific taps and resets the LFSR and timer state", () => {
    const channel = new ApuNoiseChannel();
    channel.write_period(0x80);
    assert.equal(channel.get_mode(), true);
    channel.clock_timer();
    assert.notEqual(channel.get_shift_register(), 1);

    channel.reset();
    assert.equal(channel.get_mode(), false);
    assert.equal(channel.get_shift_register(), 1);
    assert.equal(channel.get_timer_period_cycles(), NOISE_PERIODS_NTSC[0]);
    assert.equal(channel.get_length_counter(), 0);
    assert.equal(channel.get_output(), 0);

    assert.throws(() => channel.write_control(256), RangeError);
    assert.throws(() => channel.write_period(-1), RangeError);
    assert.throws(() => channel.write_length(1.5), RangeError);
});

function count_lfsr_shifts_to_seed(mode_register: number): number {
    const channel = new ApuNoiseChannel();
    channel.write_period(mode_register);
    const initial_state = channel.get_shift_register();
    let shifts = 0;
    let cycles = 0;
    const cycle_limit = (mode_register === 0 ? LONG_LFSR_PERIOD : SHORT_LFSR_PERIOD) * NOISE_PERIODS_NTSC[0] + 1;

    while (cycles < cycle_limit) {
        const previous_state = channel.get_shift_register();
        channel.clock_timer();
        cycles += 1;
        const state = channel.get_shift_register();

        if (state !== previous_state) {
            shifts += 1;
        }

        assert.notEqual(state, 0);

        if (shifts > 0 && state === initial_state) {
            return shifts;
        }
    }

    throw new Error(`Noise LFSR did not return to its seed within ${cycle_limit} CPU cycles.`);
}

function clock_timer_ticks(channel: ApuNoiseChannel, ticks: number): void {
    for (let tick = 0; tick < ticks; tick += 1) {
        channel.clock_timer();
    }
}
