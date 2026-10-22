import type { NesConsoleFrame } from "../core/nes_console.js";
import {
    NTSC_MASTER_CLOCK_HZ,
    NTSC_MASTER_TICKS_PER_PPU_DOT,
} from "../core/ntsc_clock.js";

export type RequestAnimationFrame = (callback: (timestamp: number) => void) => number;
export type CancelAnimationFrame = (handle: number) => void;

const NTSC_PPU_DOTS_PER_FRAME_AVERAGE = 341 * 262 - 0.5;

/** Nominal NTSC NES frame period (~16.6393 ms, 60.0988 Hz). */
export const NTSC_FRAME_DURATION_MS =
    (NTSC_PPU_DOTS_PER_FRAME_AVERAGE * NTSC_MASTER_TICKS_PER_PPU_DOT * 1_000) /
    NTSC_MASTER_CLOCK_HZ;

/** Allows slightly early 60 Hz VSync callbacks to step without dropping a refresh interval. */
const VSYNC_JITTER_TOLERANCE_MS = 1.5;

/** Caps accumulated schedule debt so tab backgrounding or stalls never fast-forward on resume. */
const MAX_SCHEDULE_LAG_MS = 50;

/**
 * Advances at most one emulated NTSC frame per browser animation callback, gated to the nominal
 * 60.0988 Hz NTSC frame period so 120-240 Hz monitors run at 1x real time without catch-up bursts.
 */
export class NesBrowserFrameScheduler {
    readonly #advance_frame: () => NesConsoleFrame;
    readonly #on_frame: (frame: NesConsoleFrame) => void;
    readonly #on_error: (error: unknown) => void;
    readonly #request_animation_frame: RequestAnimationFrame;
    readonly #cancel_animation_frame: CancelAnimationFrame;
    #request_handle: number | null = null;
    #next_frame_timestamp_ms: number | null = null;
    #running = false;

    constructor(
        advance_frame: () => NesConsoleFrame,
        on_frame: (frame: NesConsoleFrame) => void,
        on_error: (error: unknown) => void,
        request_animation_frame: RequestAnimationFrame,
        cancel_animation_frame: CancelAnimationFrame,
    ) {
        this.#advance_frame = advance_frame;
        this.#on_frame = on_frame;
        this.#on_error = on_error;
        this.#request_animation_frame = request_animation_frame;
        this.#cancel_animation_frame = cancel_animation_frame;
    }

    start(): void {
        if (this.#running) {
            return;
        }

        this.#running = true;
        this.#next_frame_timestamp_ms = null;
        this.#request_next_frame();
    }

    stop(): void {
        this.#running = false;
        this.#next_frame_timestamp_ms = null;

        if (this.#request_handle !== null) {
            this.#cancel_animation_frame(this.#request_handle);
            this.#request_handle = null;
        }
    }

    is_running(): boolean {
        return this.#running;
    }

    #request_next_frame(): void {
        this.#request_handle = this.#request_animation_frame(this.#on_animation_frame);
    }

    readonly #on_animation_frame = (timestamp: number): void => {
        this.#request_handle = null;

        if (!this.#running) {
            return;
        }

        if (
            this.#next_frame_timestamp_ms === null ||
            timestamp + VSYNC_JITTER_TOLERANCE_MS >= this.#next_frame_timestamp_ms
        ) {
            if (this.#next_frame_timestamp_ms === null) {
                this.#next_frame_timestamp_ms = timestamp + NTSC_FRAME_DURATION_MS;
            } else {
                this.#next_frame_timestamp_ms += NTSC_FRAME_DURATION_MS;

                if (timestamp - this.#next_frame_timestamp_ms > MAX_SCHEDULE_LAG_MS) {
                    this.#next_frame_timestamp_ms = timestamp + NTSC_FRAME_DURATION_MS;
                }
            }

            try {
                this.#on_frame(this.#advance_frame());
            } catch (error) {
                this.stop();
                this.#on_error(error);
                return;
            }
        }

        if (this.#running) {
            this.#request_next_frame();
        }
    };
}
