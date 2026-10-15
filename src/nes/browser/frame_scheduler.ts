import type { NesConsoleFrame } from "../core/nes_console.js";

export type RequestAnimationFrame = (callback: (timestamp: number) => void) => number;
export type CancelAnimationFrame = (handle: number) => void;

/** One emulated frame is advanced per browser animation callback; no unbounded catch-up loop is used. */
export class NesBrowserFrameScheduler {
    readonly #advance_frame: () => NesConsoleFrame;
    readonly #on_frame: (frame: NesConsoleFrame) => void;
    readonly #on_error: (error: unknown) => void;
    readonly #request_animation_frame: RequestAnimationFrame;
    readonly #cancel_animation_frame: CancelAnimationFrame;
    #request_handle: number | null = null;
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
        this.#request_next_frame();
    }

    stop(): void {
        this.#running = false;

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

    readonly #on_animation_frame = (_timestamp: number): void => {
        this.#request_handle = null;

        if (!this.#running) {
            return;
        }

        try {
            this.#on_frame(this.#advance_frame());
        } catch (error) {
            this.stop();
            this.#on_error(error);
            return;
        }

        if (this.#running) {
            this.#request_next_frame();
        }
    };
}
