import assert from "node:assert/strict";
import test from "node:test";

import { BrowserAudioOutput } from "../src/nes/browser/audio_output.js";

interface CopiedAudioBlock {
    readonly channel: number;
    readonly samples: Float32Array;
}

class FakeAudioBuffer {
    readonly duration: number;
    readonly copied_blocks: CopiedAudioBlock[] = [];

    constructor(
        readonly channel_count: number,
        readonly sample_count: number,
        readonly sample_rate_hz: number,
    ) {
        this.duration = sample_count / sample_rate_hz;
    }

    copyToChannel(samples: Float32Array, channel: number): void {
        this.copied_blocks.push({ channel, samples: new Float32Array(samples) });
    }
}

class FakeAudioBufferSource {
    buffer: FakeAudioBuffer | null = null;
    onended: (() => void) | null = null;
    readonly start_times: number[] = [];
    stop_calls = 0;
    disconnect_calls = 0;
    throw_on_stop = false;

    connect(_destination: unknown): void {}

    start(start_time = 0): void {
        this.start_times.push(start_time);
    }

    stop(): void {
        this.stop_calls += 1;

        if (this.throw_on_stop) {
            throw new Error("source has already ended");
        }
    }

    disconnect(): void {
        this.disconnect_calls += 1;
    }
}

class FakeAudioContext {
    state: AudioContextState = "suspended";
    currentTime = 0;
    readonly destination = {};
    readonly buffers: FakeAudioBuffer[] = [];
    readonly sources: FakeAudioBufferSource[] = [];
    resume_calls = 0;

    async resume(): Promise<void> {
        this.resume_calls += 1;
        this.state = "running";
    }

    createBuffer(channel_count: number, sample_count: number, sample_rate_hz: number): FakeAudioBuffer {
        const buffer = new FakeAudioBuffer(channel_count, sample_count, sample_rate_hz);
        this.buffers.push(buffer);
        return buffer;
    }

    createBufferSource(): FakeAudioBufferSource {
        const source = new FakeAudioBufferSource();
        this.sources.push(source);
        return source;
    }

    as_audio_context(): AudioContext {
        return this as unknown as AudioContext;
    }
}

test("reports unavailable Web Audio without assuming a browser global exists", async () => {
    await assert.rejects(new BrowserAudioOutput().resume(), /This browser does not provide Web Audio/);
});

test("creates one context on first resume and ignores audio until it is running", async () => {
    const context = new FakeAudioContext();
    let factory_calls = 0;
    const output = new BrowserAudioOutput(() => {
        factory_calls += 1;
        return context.as_audio_context();
    });

    output.enqueue(Float32Array.of(0.25));
    await output.resume();
    context.state = "suspended";
    output.enqueue(Float32Array.of(-0.5));
    context.state = "running";
    output.enqueue(new Float32Array(0));
    await output.resume();

    assert.equal(factory_calls, 1);
    assert.equal(context.resume_calls, 1);
    assert.equal(context.buffers.length, 0);
    assert.equal(context.sources.length, 0);
});

test("copies mono samples and schedules consecutive blocks at the configured sample rate", async () => {
    const context = new FakeAudioContext();
    context.currentTime = 10;
    const output = new BrowserAudioOutput(() => context.as_audio_context());
    output.set_sample_rate(22_050);
    await output.resume();

    const first_samples = Float32Array.of(0.25, -0.5);
    output.enqueue(first_samples);
    first_samples[0] = 0;
    output.enqueue(Float32Array.of(0.75, -1));

    assert.deepEqual(
        context.buffers.map((buffer) => [buffer.channel_count, buffer.sample_count, buffer.sample_rate_hz]),
        [
            [1, 2, 22_050],
            [1, 2, 22_050],
        ],
    );
    assert.deepEqual(context.buffers[0]?.copied_blocks[0]?.samples, Float32Array.of(0.25, -0.5));
    assert.deepEqual(context.buffers[1]?.copied_blocks[0]?.samples, Float32Array.of(0.75, -1));
    assert.deepEqual(context.sources[0]?.start_times, [10.01]);

    const second_start_time = context.sources[1]?.start_times[0];
    assert.ok(second_start_time !== undefined);
    assert.ok(Math.abs(second_start_time - (10.01 + 2 / 22_050)) < 1e-9);
});

test("bounds queued audio after clock drift or an excessive scheduled lead", async () => {
    const context = new FakeAudioContext();
    context.currentTime = 5;
    const output = new BrowserAudioOutput(() => context.as_audio_context());
    await output.resume();

    output.enqueue(new Float32Array(22_050));
    output.enqueue(Float32Array.of(0.5));

    assert.deepEqual(context.sources[0]?.start_times, [5.01]);
    assert.deepEqual(context.sources[1]?.start_times, [5.01]);

    context.currentTime = 9;
    output.reset_schedule();
    output.enqueue(Float32Array.of(0.25));
    assert.deepEqual(context.sources[2]?.start_times, [9.01]);
});

test("stops and disconnects queued sources while safely retiring ended sources", async () => {
    const context = new FakeAudioContext();
    const output = new BrowserAudioOutput(() => context.as_audio_context());
    await output.resume();
    output.enqueue(Float32Array.of(0.25));
    output.enqueue(Float32Array.of(-0.25));

    const [ended_source, active_source] = context.sources;
    assert.ok(ended_source);
    assert.ok(active_source);
    ended_source.onended?.();
    active_source.throw_on_stop = true;

    output.stop();
    output.stop();

    assert.equal(ended_source.stop_calls, 0);
    assert.equal(ended_source.disconnect_calls, 1);
    assert.equal(active_source.stop_calls, 1);
    assert.equal(active_source.disconnect_calls, 1);
});
