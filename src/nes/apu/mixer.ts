const MAX_CHANNEL_DAC_LEVEL = 0x0f;
const PULSE_MIXER_GAIN = 95.88;
const PULSE_MIXER_SCALE = 8128;
const PULSE_MIXER_OFFSET = 100;
const TND_MIXER_GAIN = 159.79;
const TND_MIXER_OFFSET = 100;
const TRIANGLE_MIXER_DIVISOR = 8227;
const NOISE_MIXER_DIVISOR = 12241;
const DMC_MIXER_DIVISOR = 22638;
const DMC_DAC_MAX_LEVEL = 0x7f;

/** Returns the standard nonlinear 2A03 pulse+TND mix, normalized to approximately 0..1. */
export function mix_apu_channels(
    pulse_one: number,
    pulse_two: number,
    triangle: number,
    noise: number,
    dmc = 0,
): number {
    assert_dac_level(pulse_one);
    assert_dac_level(pulse_two);
    assert_dac_level(triangle);
    assert_dac_level(noise);
    assert_dmc_dac_level(dmc);

    const pulse_sum = pulse_one + pulse_two;
    const pulse_output =
        pulse_sum === 0
            ? 0
            : PULSE_MIXER_GAIN / (PULSE_MIXER_SCALE / pulse_sum + PULSE_MIXER_OFFSET);
    const tnd_input = triangle / TRIANGLE_MIXER_DIVISOR + noise / NOISE_MIXER_DIVISOR + dmc / DMC_MIXER_DIVISOR;
    const tnd_output = tnd_input === 0 ? 0 : TND_MIXER_GAIN / (1 / tnd_input + TND_MIXER_OFFSET);

    return pulse_output + tnd_output;
}

function assert_dac_level(level: number): void {
    if (!Number.isInteger(level) || level < 0 || level > MAX_CHANNEL_DAC_LEVEL) {
        throw new RangeError(`APU DAC level ${level} is outside the four-bit range.`);
    }
}

function assert_dmc_dac_level(level: number): void {
    if (!Number.isInteger(level) || level < 0 || level > DMC_DAC_MAX_LEVEL) {
        throw new RangeError(`DMC DAC level ${level} is outside the seven-bit range.`);
    }
}
