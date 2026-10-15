import assert from "node:assert/strict";
import { test } from "node:test";
import { mix_apu_channels } from "../src/nes/apu/mixer.js";

test("is silent at zero DAC levels and stays below full scale for implemented channels", () => {
    assert.equal(mix_apu_channels(0, 0, 0, 0), 0);

    const output = mix_apu_channels(15, 15, 15, 15);
    const pulse_output = 95.88 / (8128 / 30 + 100);
    const tnd_input = 15 / 8227 + 15 / 12241;
    const tnd_output = 159.79 / (1 / tnd_input + 100);

    assert.ok(Math.abs(output - pulse_output - tnd_output) < 1e-12);
    assert.ok(output > 0 && output < 1);
});

test("mixes pulse channels nonlinearly instead of summing their amplitudes", () => {
    const one_pulse = mix_apu_channels(15, 0, 0, 0);
    const two_pulses = mix_apu_channels(15, 15, 0, 0);

    assert.equal(mix_apu_channels(0, 15, 0, 0), one_pulse);
    assert.ok(two_pulses > one_pulse);
    assert.ok(two_pulses < one_pulse * 2);
});

test("includes the seven-bit DMC DAC in the nonlinear TND input", () => {
    const dmc_level = 64;
    const tnd_input = dmc_level / 22638;
    const expected = 159.79 / (1 / tnd_input + 100);

    assert.ok(Math.abs(mix_apu_channels(0, 0, 0, 0, dmc_level) - expected) < 1e-12);
    assert.throws(() => mix_apu_channels(0, 0, 0, 0, 128), RangeError);
});

test("rejects DAC input levels outside their channel ranges", () => {
    assert.throws(() => mix_apu_channels(-1, 0, 0, 0), RangeError);
    assert.throws(() => mix_apu_channels(0, 0, 16, 0), RangeError);
    assert.throws(() => mix_apu_channels(0, 0, 0, 1.5), RangeError);
});
