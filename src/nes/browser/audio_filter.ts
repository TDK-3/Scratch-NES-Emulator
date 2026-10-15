/** Stateful host-output shaping; the deterministic APU sample stream remains unfiltered. */
export class NesBrowserAudioFilter {
    static readonly DEFAULT_SAMPLE_RATE_HZ = 44_100;

    readonly #high_pass_one_cutoff_hz = 90;
    readonly #high_pass_two_cutoff_hz = 440;
    readonly #low_pass_cutoff_hz = 14_000;

    #sample_rate_hz = NesBrowserAudioFilter.DEFAULT_SAMPLE_RATE_HZ;
    #high_pass_one_alpha = 0;
    #high_pass_two_alpha = 0;
    #low_pass_alpha = 0;
    #high_pass_one_previous_input = 0;
    #high_pass_one_previous_output = 0;
    #high_pass_two_previous_input = 0;
    #high_pass_two_previous_output = 0;
    #low_pass_previous_output = 0;

    /** Creates an approximate NTSC audio output filter at the configured sample rate. */
    constructor(sample_rate_hz = NesBrowserAudioFilter.DEFAULT_SAMPLE_RATE_HZ) {
        this.set_sample_rate(sample_rate_hz);
    }

    /** Sets the sample rate and clears history because the filter coefficients have changed. */
    set_sample_rate(sample_rate_hz: number): void {
        if (!Number.isInteger(sample_rate_hz) || sample_rate_hz < 1 || sample_rate_hz > 1_789_773) {
            throw new RangeError("Audio filter sample rate must be an integer from one through 1,789,773 Hz.");
        }

        this.#sample_rate_hz = sample_rate_hz;
        const nyquist_limit_hz = sample_rate_hz * 0.49;
        this.#high_pass_one_alpha = high_pass_alpha(
            Math.min(this.#high_pass_one_cutoff_hz, nyquist_limit_hz),
            sample_rate_hz,
        );
        this.#high_pass_two_alpha = high_pass_alpha(
            Math.min(this.#high_pass_two_cutoff_hz, nyquist_limit_hz),
            sample_rate_hz,
        );
        this.#low_pass_alpha = low_pass_alpha(
            Math.min(this.#low_pass_cutoff_hz, nyquist_limit_hz),
            sample_rate_hz,
        );
        this.reset();
    }

    /** Returns the current sample rate in hertz. */
    get_sample_rate_hz(): number {
        return this.#sample_rate_hz;
    }

    /** Filters a sample block while preserving analog-filter state across consecutive blocks. */
    process(samples: Float32Array): Float32Array {
        const filtered_samples = new Float32Array(samples.length);

        for (let sample_index = 0; sample_index < samples.length; sample_index += 1) {
            const sample = samples[sample_index]!;

            if (!Number.isFinite(sample)) {
                throw new RangeError(`Audio filter sample ${sample_index} must be finite.`);
            }

            const high_pass_one_output = this.#high_pass_one_alpha *
                (this.#high_pass_one_previous_output + sample - this.#high_pass_one_previous_input);
            this.#high_pass_one_previous_input = sample;
            this.#high_pass_one_previous_output = high_pass_one_output;

            const high_pass_two_output = this.#high_pass_two_alpha *
                (this.#high_pass_two_previous_output + high_pass_one_output - this.#high_pass_two_previous_input);
            this.#high_pass_two_previous_input = high_pass_one_output;
            this.#high_pass_two_previous_output = high_pass_two_output;

            const low_pass_output =
                (1 - this.#low_pass_alpha) * high_pass_two_output +
                this.#low_pass_alpha * this.#low_pass_previous_output;
            this.#low_pass_previous_output = low_pass_output;
            filtered_samples[sample_index] = low_pass_output;
        }

        return filtered_samples;
    }

    /** Clears filter memory, useful after pausing or replacing a ROM. */
    reset(): void {
        this.#high_pass_one_previous_input = 0;
        this.#high_pass_one_previous_output = 0;
        this.#high_pass_two_previous_input = 0;
        this.#high_pass_two_previous_output = 0;
        this.#low_pass_previous_output = 0;
    }
}

function high_pass_alpha(cutoff_hz: number, sample_rate_hz: number): number {
    return Math.exp((-2 * Math.PI * cutoff_hz) / sample_rate_hz);
}

function low_pass_alpha(cutoff_hz: number, sample_rate_hz: number): number {
    return Math.exp((-2 * Math.PI * cutoff_hz) / sample_rate_hz);
}
