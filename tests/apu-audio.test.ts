import assert from "node:assert/strict";
import { test } from "node:test";
import { Apu2A03 } from "../src/nes/apu/apu_2a03.js";
import { NTSC_CPU_CLOCK_HZ } from "../src/nes/apu/audio_sampler.js";
import { mix_apu_channels } from "../src/nes/apu/mixer.js";

const DEFAULT_SAMPLE_RATE_HZ = 44_100;

test("Apu2A03 uses the default sample rate and emits after the exact accumulated emulated time", () => {
    const apu = new Apu2A03();
    assert.equal(apu.get_audio_sample_rate_hz(), DEFAULT_SAMPLE_RATE_HZ);

    clock_cpu_cycles(apu, 40);
    assert.equal(apu.drain_audio_samples().length, 0);

    apu.clock_cpu_cycle();
    assert.deepEqual(Array.from(apu.drain_audio_samples()), [Math.fround(apu.get_mixed_output())]);
});

test("samples the live pulse, triangle, noise, and DMC mix after each emulated CPU cycle", () => {
    const apu = new Apu2A03(NTSC_CPU_CLOCK_HZ);
    apu.write_register(0x4015, 0x0f);
    apu.write_register(0x4011, 0x40);
    apu.write_register(0x4000, 0xdf);
    apu.write_register(0x4002, 8);
    apu.write_register(0x4003, 0);
    apu.write_register(0x4004, 0xdf);
    apu.write_register(0x4006, 8);
    apu.write_register(0x4007, 0);
    apu.write_register(0x4008, 0x81);
    apu.write_register(0x400a, 2);
    apu.write_register(0x400b, 0);
    apu.write_register(0x400c, 0x3f);
    apu.write_register(0x400e, 0);
    apu.write_register(0x400f, 0);
    apu.write_register(0x4017, 0x80);

    clock_cpu_cycles(apu, 4);

    const samples = apu.drain_audio_samples();
    assert.equal(samples.length, 4);
    assert.equal(apu.get_pulse_output(1), 15);
    assert.equal(apu.get_pulse_output(2), 15);
    assert.equal(apu.get_triangle_output(), 1);
    assert.equal(apu.get_noise_output(), 15);
    assert.equal(apu.get_dmc_output(), 0x40);
    assert.equal(samples[3], Math.fround(mix_apu_channels(15, 15, 1, 15, 0x40)));
    assert.equal(apu.drain_audio_samples().length, 0);
});

test("reset discards undrained samples and restarts the sample-clock phase", () => {
    const apu = new Apu2A03(NTSC_CPU_CLOCK_HZ);
    apu.write_register(0x4011, 0x40);
    apu.clock_cpu_cycle();
    assert.equal(apu.drain_audio_samples().length, 1);
    apu.clock_cpu_cycle();

    apu.reset();
    assert.equal(apu.drain_audio_samples().length, 0);
    apu.clock_cpu_cycle();

    assert.deepEqual(Array.from(apu.drain_audio_samples()), [0]);
});

function clock_cpu_cycles(apu: Apu2A03, cycles: number): void {
    for (let cycle = 0; cycle < cycles; cycle += 1) {
        apu.clock_cpu_cycle();
    }
}
