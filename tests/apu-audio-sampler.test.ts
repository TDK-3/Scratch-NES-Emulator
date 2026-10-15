import assert from "node:assert/strict";
import { test } from "node:test";
import {
    ApuAudioSampler,
    DEFAULT_APU_SAMPLE_RATE_HZ,
    NTSC_CPU_CLOCK_HZ,
} from "../src/nes/apu/audio_sampler.js";

test("produces exactly the configured sample count from one second of NTSC emulated time", () => {
    const sampler = new ApuAudioSampler(DEFAULT_APU_SAMPLE_RATE_HZ);

    for (let cycle = 0; cycle < NTSC_CPU_CLOCK_HZ; cycle += 1) {
        sampler.clock_cpu_cycle(0.375);
    }

    const samples = sampler.drain_samples();
    assert.equal(samples.length, DEFAULT_APU_SAMPLE_RATE_HZ);
    assert.ok(samples.every((sample) => sample === 0.375));
});

test("preserves fractional sample phase when buffers are drained and resets it explicitly", () => {
    const sampler = new ApuAudioSampler(DEFAULT_APU_SAMPLE_RATE_HZ);

    clock_cpu_cycles(sampler, 40, 0.125);
    assert.equal(sampler.drain_samples().length, 0);

    sampler.clock_cpu_cycle(0.25);
    assert.deepEqual(Array.from(sampler.drain_samples()), [0.25]);

    clock_cpu_cycles(sampler, NTSC_CPU_CLOCK_HZ - 41, 0.5);
    assert.equal(sampler.drain_samples().length, DEFAULT_APU_SAMPLE_RATE_HZ - 1);

    sampler.clock_cpu_cycle(0.75);
    assert.equal(sampler.drain_samples().length, 0);

    sampler.clock_cpu_cycle(0.25);
    sampler.reset();
    assert.equal(sampler.drain_samples().length, 0);
    clock_cpu_cycles(sampler, 40, 0.5);
    assert.equal(sampler.drain_samples().length, 0);
    sampler.clock_cpu_cycle(0.875);
    assert.deepEqual(Array.from(sampler.drain_samples()), [0.875]);
});

test("captures one post-clock sample per CPU cycle at the maximum supported rate", () => {
    const sampler = new ApuAudioSampler(NTSC_CPU_CLOCK_HZ);

    sampler.clock_cpu_cycle(0.1);
    sampler.clock_cpu_cycle(0.2);
    sampler.clock_cpu_cycle(-0.3);

    assert.deepEqual(Array.from(sampler.drain_samples()), [Math.fround(0.1), Math.fround(0.2), Math.fround(-0.3)]);
});

test("rejects invalid sample rates and non-finite mixer values", () => {
    assert.throws(() => new ApuAudioSampler(0), RangeError);
    assert.throws(() => new ApuAudioSampler(NTSC_CPU_CLOCK_HZ + 1), RangeError);
    assert.throws(() => new ApuAudioSampler(44_100.5), RangeError);
    assert.throws(() => new ApuAudioSampler(Number.NaN), RangeError);

    const sampler = new ApuAudioSampler();
    assert.throws(() => sampler.clock_cpu_cycle(Number.NaN), RangeError);
    assert.throws(() => sampler.clock_cpu_cycle(Number.POSITIVE_INFINITY), RangeError);
});

function clock_cpu_cycles(sampler: ApuAudioSampler, cycles: number, mixed_output: number): void {
    for (let cycle = 0; cycle < cycles; cycle += 1) {
        sampler.clock_cpu_cycle(mixed_output);
    }
}
