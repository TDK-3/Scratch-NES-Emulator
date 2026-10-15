export const NTSC_CPU_CLOCK_HZ = 1_789_773;
export const DEFAULT_APU_SAMPLE_RATE_HZ = 44_100;

/** Deterministic zero-order sampler driven once per emulated NTSC CPU cycle. */
export class ApuAudioSampler {
    readonly #sample_rate_hz: number;
    readonly #samples: number[] = [];
    #phase = 0;

    constructor(sample_rate_hz = DEFAULT_APU_SAMPLE_RATE_HZ) {
        if (
            !Number.isSafeInteger(sample_rate_hz) ||
            sample_rate_hz <= 0 ||
            sample_rate_hz > NTSC_CPU_CLOCK_HZ
        ) {
            throw new RangeError(
                `APU sample rate ${sample_rate_hz} must be an integer from 1 through ${NTSC_CPU_CLOCK_HZ} Hz.`,
            );
        }

        this.#sample_rate_hz = sample_rate_hz;
    }

    get_sample_rate_hz(): number {
        return this.#sample_rate_hz;
    }

    /** Advances emulated time by one CPU cycle and captures the supplied post-clock mixer value if due. */
    clock_cpu_cycle(mixed_output: number): void {
        if (!Number.isFinite(mixed_output)) {
            throw new RangeError(`APU mixed output ${mixed_output} must be a finite number.`);
        }

        this.#phase += this.#sample_rate_hz;

        if (this.#phase >= NTSC_CPU_CLOCK_HZ) {
            this.#phase -= NTSC_CPU_CLOCK_HZ;
            this.#samples.push(mixed_output);
        }
    }

    /** Returns and clears queued mono samples without changing the emulated sample-clock phase. */
    drain_samples(): Float32Array {
        const drained_samples = Float32Array.from(this.#samples);
        this.#samples.length = 0;
        return drained_samples;
    }

    /** Resets sample phase and discards any samples not yet drained. */
    reset(): void {
        this.#phase = 0;
        this.#samples.length = 0;
    }
}
