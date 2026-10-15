/** Best-effort Web Audio sink for deterministic mono sample blocks from `ApuAudioSampler`. */
export class BrowserAudioOutput {
    readonly #scheduled_sources = new Set<AudioBufferSourceNode>();
    readonly #create_context: () => AudioContext;
    #context: AudioContext | null = null;
    #sample_rate_hz = 44_100;
    #next_start_time = 0;

    /** Creates the Web Audio context lazily; inject a context factory when testing the sink. */
    constructor(create_context: () => AudioContext = create_browser_audio_context) {
        this.#create_context = create_context;
    }

    set_sample_rate(sample_rate_hz: number): void {
        this.#sample_rate_hz = sample_rate_hz;
    }

    async resume(): Promise<void> {
        if (this.#context === null) {
            this.#context = this.#create_context();
        }

        if (this.#context.state !== "running") {
            await this.#context.resume();
        }
    }

    enqueue(samples: Float32Array): void {
        if (this.#context === null || this.#context.state !== "running" || samples.length === 0) {
            return;
        }

        const buffer = this.#context.createBuffer(1, samples.length, this.#sample_rate_hz);
        buffer.copyToChannel(new Float32Array(samples), 0);

        const source = this.#context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.#context.destination);
        source.onended = () => {
            source.disconnect();
            this.#scheduled_sources.delete(source);
        };

        const earliest_start_time = this.#context.currentTime + 0.01;

        if (this.#next_start_time < earliest_start_time || this.#next_start_time > earliest_start_time + 0.25) {
            this.#next_start_time = earliest_start_time;
        }

        source.start(this.#next_start_time);
        this.#next_start_time += buffer.duration;
        this.#scheduled_sources.add(source);
    }

    stop(): void {
        for (const source of this.#scheduled_sources) {
            try {
                source.stop();
            } catch {
                // An ended source can still be awaiting its onended callback.
            }

            source.disconnect();
        }

        this.#scheduled_sources.clear();
        this.#next_start_time = this.#context?.currentTime ?? 0;
    }

    reset_schedule(): void {
        this.#next_start_time = this.#context?.currentTime ?? 0;
    }
}

function create_browser_audio_context(): AudioContext {
    if (typeof window === "undefined" || typeof window.AudioContext !== "function") {
        throw new Error("This browser does not provide Web Audio.");
    }

    return new window.AudioContext();
}
