import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NesBrowserKeyboardInput } from "../src/nes/browser/keyboard_input.js";
import { NesConsole } from "../src/nes/core/nes_console.js";

const NOISE_PLAYER_ROM = new Uint8Array(
    readFileSync(new URL("./fixtures/nes-apu/NES_APUTest_NoisePlayer.nes", import.meta.url)),
);
const SQUARE_PLAYER_ROM = new Uint8Array(
    readFileSync(new URL("./fixtures/nes-apu/NES_APUTest_SquarePlayer.nes", import.meta.url)),
);

test("runs the pinned MIT square-player ROM: Up plays APU output and Down silences it", () => {
    const creation_result = NesConsole.create(SQUARE_PLAYER_ROM);

    if (!creation_result.ok) {
        throw new Error(`Failed to compose the licensed ROM: ${creation_result.error.stage}.`);
    }

    const console = creation_result.value;
    const keyboard = new NesBrowserKeyboardInput((controller_index, button, pressed) => {
        console.set_button_state(controller_index, button, pressed);
    });
    assert.deepEqual(console.get_rom_metadata(), {
        format: "ines-1.0",
        mapper_id: 0,
        submapper: 0,
        mirroring: "vertical",
    });

    const initial_silence_one = console.advance_frame();
    const initial_silence_two = console.advance_frame();
    assert_audio_silent(initial_silence_one.audio_samples);
    assert_audio_silent(initial_silence_two.audio_samples);

    keyboard.key_down("ArrowUp", false, () => {});
    const up_transition_frame = console.advance_frame();
    assert_audio_silent(up_transition_frame.audio_samples);

    const playing_frame = console.advance_frame();
    assert_audio_non_silent(playing_frame.audio_samples);

    keyboard.key_up("ArrowUp");
    keyboard.key_down("ArrowDown", false, () => {});
    const down_transition_frame = console.advance_frame();
    assert_audio_non_silent(down_transition_frame.audio_samples);

    const stopped_frame = console.advance_frame();
    assert_audio_silent(stopped_frame.audio_samples);
    keyboard.key_up("ArrowDown");
});

test("runs the pinned MIT noise-player ROM: Up plays noise and Down silences it", () => {
    const creation_result = NesConsole.create(NOISE_PLAYER_ROM);

    if (!creation_result.ok) {
        throw new Error(`Failed to compose the licensed ROM: ${creation_result.error.stage}.`);
    }

    const console = creation_result.value;
    assert.deepEqual(console.get_rom_metadata(), {
        format: "ines-1.0",
        mapper_id: 0,
        submapper: 0,
        mirroring: "vertical",
    });

    const initial_silence_one = console.advance_frame();
    const initial_silence_two = console.advance_frame();
    assert_audio_silent(initial_silence_one.audio_samples);
    assert_audio_silent(initial_silence_two.audio_samples);

    console.set_button_state(0, "up", true);
    const up_transition_frame = console.advance_frame();
    assert_audio_non_silent(up_transition_frame.audio_samples);

    const playing_frame = console.advance_frame();
    assert_audio_non_silent(playing_frame.audio_samples);

    console.set_button_state(0, "up", false);
    console.set_button_state(0, "down", true);
    const stopping_transition_frame = console.advance_frame();
    assert_audio_non_silent(stopping_transition_frame.audio_samples);

    const stopped_frame = console.advance_frame();
    assert_audio_silent(stopped_frame.audio_samples);
});

function assert_audio_silent(samples: Float32Array): void {
    assert.ok(samples.length > 700, `Expected one frame of audio samples; got ${samples.length}.`);

    for (const sample of samples) {
        assert.equal(sample, 0, "Expected the licensed square-player ROM to emit silence.");
    }
}

function assert_audio_non_silent(samples: Float32Array): void {
    assert.ok(samples.length > 700, `Expected one frame of audio samples; got ${samples.length}.`);
    assert.ok(samples.every(Number.isFinite), "Expected finite APU samples.");
    assert.ok(samples.some((sample) => sample !== 0), "Expected non-silent APU output after pressing Up.");
}
