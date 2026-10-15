import assert from "node:assert/strict";
import test from "node:test";

import { NesBrowserAudioFilter } from "../src/nes/browser/audio_filter.js";

const SAMPLE_RATE_HZ = 44_100;

function make_sine_wave(frequency_hz: number, sample_count: number): Float32Array {
    const samples = new Float32Array(sample_count);

    for (let sample_index = 0; sample_index < samples.length; sample_index += 1) {
        samples[sample_index] = Math.sin((2 * Math.PI * frequency_hz * sample_index) / SAMPLE_RATE_HZ);
    }

    return samples;
}

function root_mean_square(samples: Float32Array, start_index = 0): number {
    let sum_of_squares = 0;

    for (let sample_index = start_index; sample_index < samples.length; sample_index += 1) {
        const sample = samples[sample_index]!;
        sum_of_squares += sample * sample;
    }

    return Math.sqrt(sum_of_squares / (samples.length - start_index));
}

test("removes steady DC from the host audio output", () => {
    const filter = new NesBrowserAudioFilter(SAMPLE_RATE_HZ);
    const filtered = filter.process(new Float32Array(SAMPLE_RATE_HZ).fill(0.25));

    assert.ok(Math.abs(filtered[filtered.length - 1]!) < 1e-7);
});

test("preserves a mid-band tone while applying gentle high-pass shaping", () => {
    const input = make_sine_wave(1_000, SAMPLE_RATE_HZ);
    const original_input = new Float32Array(input);
    const filtered = new NesBrowserAudioFilter(SAMPLE_RATE_HZ).process(input);
    const input_rms = root_mean_square(input, 4_410);
    const filtered_rms = root_mean_square(filtered, 4_410);
    const gain = filtered_rms / input_rms;

    assert.deepEqual(input, original_input);
    assert.ok(gain > 0.85 && gain < 0.98, `expected mid-band gain below unity, received ${gain}`);
});

test("attenuates frequencies above the host low-pass cutoff", () => {
    const input = make_sine_wave(20_000, SAMPLE_RATE_HZ);
    const filtered = new NesBrowserAudioFilter(SAMPLE_RATE_HZ).process(input);
    const input_rms = root_mean_square(input, 4_410);
    const filtered_rms = root_mean_square(filtered, 4_410);
    const gain = filtered_rms / input_rms;

    assert.ok(gain > 0.65 && gain < 0.8, `expected high-frequency attenuation, received ${gain}`);
});

test("keeps filter state across blocks and reset reproduces the initial response", () => {
    const input = make_sine_wave(2_000, 5_000);
    const whole_block_filter = new NesBrowserAudioFilter(SAMPLE_RATE_HZ);
    const whole_block_output = whole_block_filter.process(input);
    const chunked_filter = new NesBrowserAudioFilter(SAMPLE_RATE_HZ);
    const first_chunk = chunked_filter.process(input.slice(0, 1_237));
    const second_chunk = chunked_filter.process(input.slice(1_237));
    const chunked_output = new Float32Array(input.length);
    chunked_output.set(first_chunk);
    chunked_output.set(second_chunk, first_chunk.length);

    assert.deepEqual(chunked_output, whole_block_output);

    chunked_filter.reset();
    assert.deepEqual(chunked_filter.process(input), whole_block_output);
});

test("rebuilds coefficients at a new valid sample rate and rejects invalid rates or samples", () => {
    const filter = new NesBrowserAudioFilter(SAMPLE_RATE_HZ);
    filter.process(Float32Array.of(0.25, -0.5));
    filter.set_sample_rate(22_050);

    assert.equal(filter.get_sample_rate_hz(), 22_050);
    assert.deepEqual(filter.process(Float32Array.of(0.25, -0.5)), new NesBrowserAudioFilter(22_050).process(Float32Array.of(0.25, -0.5)));
    assert.throws(() => new NesBrowserAudioFilter(0), RangeError);
    assert.throws(() => new NesBrowserAudioFilter(1_789_774), RangeError);
    assert.throws(() => new NesBrowserAudioFilter(Number.NaN), RangeError);
    assert.throws(() => filter.process(Float32Array.of(Number.NaN)), RangeError);
});
