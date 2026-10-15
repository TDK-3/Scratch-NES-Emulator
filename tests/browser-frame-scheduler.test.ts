import assert from "node:assert/strict";
import test from "node:test";

import type { NesConsoleFrame } from "../src/nes/core/nes_console.js";
import { NesBrowserFrameScheduler } from "../src/nes/browser/frame_scheduler.js";

interface FakeAnimationFrameQueue {
    readonly callbacks: Map<number, (timestamp: number) => void>;
    readonly cancelled_handles: number[];
    readonly request: (callback: (timestamp: number) => void) => number;
    readonly cancel: (handle: number) => void;
    readonly run_next: (timestamp?: number) => void;
}

test("advances one bounded console frame per browser callback and cancels cleanly", () => {
    const queue = create_animation_frame_queue();
    const advanced_frames: number[] = [];
    const delivered_frames: number[] = [];
    const scheduler = new NesBrowserFrameScheduler(
        () => {
            const frame_number = advanced_frames.length + 1;
            advanced_frames.push(frame_number);
            return create_frame(frame_number);
        },
        (frame) => delivered_frames.push(frame.frame_number),
        (error) => {
            throw new Error(`Unexpected frame scheduler error: ${String(error)}.`);
        },
        queue.request,
        queue.cancel,
    );

    scheduler.start();
    scheduler.start();
    assert.equal(scheduler.is_running(), true);
    assert.equal(advanced_frames.length, 0);
    assert.equal(queue.callbacks.size, 1);

    queue.run_next(16);
    assert.deepEqual(advanced_frames, [1]);
    assert.deepEqual(delivered_frames, [1]);
    assert.equal(queue.callbacks.size, 1);

    queue.run_next(32);
    assert.deepEqual(advanced_frames, [1, 2]);
    assert.deepEqual(delivered_frames, [1, 2]);

    scheduler.stop();
    assert.equal(scheduler.is_running(), false);
    assert.equal(queue.callbacks.size, 0);
    assert.deepEqual(queue.cancelled_handles, [3]);
});

test("stops the animation loop and reports errors when a frame fails", () => {
    const queue = create_animation_frame_queue();
    const expected_error = new Error("frame limit reached");
    let received_error: unknown;
    const scheduler = new NesBrowserFrameScheduler(
        () => {
            throw expected_error;
        },
        () => assert.fail("A failed frame must not be delivered."),
        (error) => {
            received_error = error;
        },
        queue.request,
        queue.cancel,
    );

    scheduler.start();
    queue.run_next();

    assert.equal(received_error, expected_error);
    assert.equal(scheduler.is_running(), false);
    assert.equal(queue.callbacks.size, 0);
});

function create_animation_frame_queue(): FakeAnimationFrameQueue {
    const callbacks = new Map<number, (timestamp: number) => void>();
    const cancelled_handles: number[] = [];
    let next_handle = 1;

    return {
        callbacks,
        cancelled_handles,
        request: (callback) => {
            const handle = next_handle;
            next_handle += 1;
            callbacks.set(handle, callback);
            return handle;
        },
        cancel: (handle) => {
            cancelled_handles.push(handle);
            callbacks.delete(handle);
        },
        run_next: (timestamp = 0) => {
            const entry = callbacks.entries().next().value as [number, (timestamp: number) => void] | undefined;

            if (entry === undefined) {
                throw new Error("No animation-frame callback is queued.");
            }

            const [handle, callback] = entry;
            callbacks.delete(handle);
            callback(timestamp);
        },
    };
}

function create_frame(frame_number: number): NesConsoleFrame {
    return {
        frame_number,
        cpu_cycles_elapsed: 29_781,
        master_clock_ticks_elapsed: 357_372,
        framebuffer: new Uint8Array(256 * 240),
        emphasis: new Uint8Array(256 * 240),
        audio_samples: new Float32Array(734),
    };
}
