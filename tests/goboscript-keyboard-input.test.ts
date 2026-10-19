import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { ControllerButton, ControllerIndex } from "../src/nes/input/controller.js";
import { CONTROLLER_BUTTON_MASKS, NesControllerPorts } from "../src/nes/input/controller.js";
import { NesBrowserKeyboardInput } from "../src/nes/browser/keyboard_input.js";
import type { KeyboardBinding } from "./support/goboscript_port_algorithms.js";
import { KEYBOARD_BINDINGS, KEYBOARD_BUTTON, keyboard_poll_masks } from "./support/goboscript_port_algorithms.js";

/**
 * Host keyboard input for the GoboScript port.
 *
 * The ported header cannot be compiled here, so nothing executes it. These tests pin the two
 * things that could otherwise only be seen in a running project: that scratch/src/keyboard_input.gs
 * asks about the same sixteen keys the TypeScript browser adapter binds, in the same
 * A/B/Select/Start and Up/Down/Left/Right bit order, and that the masks those keys assemble
 * are the ones the reference controller reports serially. The key table itself is mirrored in
 * tests/support/goboscript_port_algorithms.ts, so a change on either side fails here rather
 * than silently moving a button in the compiled project.
 */

const SCRATCH_DIRECTORY = new URL("../scratch/", import.meta.url);
const KEYBOARD_SOURCE = readFileSync(new URL("src/keyboard_input.gs", SCRATCH_DIRECTORY), "utf8");
const ROM_RUN_SOURCE = readFileSync(new URL("src/rom_run.gs", SCRATCH_DIRECTORY), "utf8");

/** Scratch key-option names that are not single characters, and the DOM key they come from. */
const SCRATCH_KEY_TO_DOM_KEY: Readonly<Record<string, string>> = {
    "up arrow": "ArrowUp",
    "down arrow": "ArrowDown",
    "left arrow": "ArrowLeft",
    "right arrow": "ArrowRight",
    enter: "Enter",
    shift: "Shift",
    space: " ",
};

/** The key names the Scratch and TurboWarp keyboard devices recognise. */
const SPECIAL_SCRATCH_KEYS: readonly string[] = [
    "space",
    "up arrow",
    "down arrow",
    "left arrow",
    "right arrow",
    "enter",
    "shift",
];

/**
 * The `if key_pressed("...")` rows of keyboard_poll_controllers, in source order. The
 * backreference keeps a row from claiming the other pad's mask as the value it extends.
 */
const BINDING_PATTERN = new RegExp(
    String.raw`if key_pressed\("([^"]+)"\) \{\s*\n\s*(player_one_mask|player_two_mask) = ` +
        String.raw`bitwise_or\(\2, keyboard_button\.(\w+)\);`,
    "g",
);

function ported_bindings(): KeyboardBinding[] {
    const bindings: KeyboardBinding[] = [];

    for (const match of KEYBOARD_SOURCE.matchAll(BINDING_PATTERN)) {
        const key = match[1];
        const mask_variable = match[2];
        const button = (match[3] ?? "").toUpperCase();
        assert.ok(key !== undefined && mask_variable !== undefined);
        assert.ok(button in KEYBOARD_BUTTON, `keyboard_button.${match[3] ?? ""} is not a ported button`);

        bindings.push({
            key,
            controller: mask_variable === "player_one_mask" ? 0 : 1,
            button: button as keyof typeof KEYBOARD_BUTTON,
        });
    }

    return bindings;
}

/** The serial bits one pad reports on successive reads; a connected pad always drives its line. */
function serial_report(controllers: NesControllerPorts, controller_index: 0 | 1, bits: number): number[] {
    const report: number[] = [];

    for (let index = 0; index < bits; index += 1) {
        const read = controllers.read_controller(controller_index, 0);
        assert.ok(read !== null, "an attached controller drives its serial data line");
        report.push(read?.value ?? 0);
    }

    return report;
}

/** The (controller, button) pair the reference browser adapter binds one DOM key to. */
function reference_binding(dom_key: string): { controller: ControllerIndex; button: ControllerButton } {
    const transitions: { controller: ControllerIndex; button: ControllerButton }[] = [];
    const input = new NesBrowserKeyboardInput((controller, button, pressed) => {
        if (pressed) {
            transitions.push({ controller, button });
        }
    });

    input.key_down(dom_key, false, () => {});
    assert.equal(transitions.length, 1, `the reference adapter binds ${dom_key} exactly once`);

    return transitions[0] as { controller: ControllerIndex; button: ControllerButton };
}

test("the ported key table is the mirrored key table", () => {
    // The .gs literals are the only copy the compiled project sees, so a transposed bit or a
    // renamed key has to fail here rather than in a running project nobody can compile.
    assert.deepEqual(ported_bindings(), [...KEYBOARD_BINDINGS]);
});

test("the ported header asks about every key it binds and nothing else", () => {
    // A key polled but not combined into a mask would read the keyboard for nothing, and a
    // binding without a poll would leave its button permanently up.
    const polled = [...KEYBOARD_SOURCE.matchAll(/key_pressed\("([^"]+)"\)/g)].map((match) => match[1]);
    assert.equal(polled.length, KEYBOARD_BINDINGS.length, "every key_pressed call is one binding");
    assert.deepEqual(polled, KEYBOARD_BINDINGS.map((binding) => binding.key));
});

test("every ported key is a name the runtime's keyboard device reports", () => {
    // The key option is a dropdown field, not a free string: a name outside the set the
    // keyboard device knows is a key that can never be pressed.
    for (const binding of KEYBOARD_BINDINGS) {
        const is_single_character = binding.key.length === 1;
        assert.ok(
            is_single_character || SPECIAL_SCRATCH_KEYS.includes(binding.key),
            `"${binding.key}" is not a Scratch key name`,
        );
    }

    assert.equal(new Set(KEYBOARD_BINDINGS.map((binding) => binding.key)).size, KEYBOARD_BINDINGS.length);
});

test("the ported bindings are the reference adapter's bindings", () => {
    // src/nes/browser/keyboard_input.ts is the tested host-input reference. The port has to
    // agree pad for pad and button for button, so the two implementations of the same pad
    // cannot drift apart.
    for (const binding of KEYBOARD_BINDINGS) {
        const dom_key = SCRATCH_KEY_TO_DOM_KEY[binding.key] ?? binding.key;
        const reference = reference_binding(dom_key);

        assert.equal(reference.controller, binding.controller, `"${binding.key}" is on the wrong pad`);
        assert.equal(
            reference.button,
            binding.button.toLowerCase(),
            `"${binding.key}" holds the wrong NES button`,
        );
    }
});

test("the ported button bits are the reference controller's button masks", () => {
    for (const [name, mask] of Object.entries(KEYBOARD_BUTTON)) {
        const reference_mask = CONTROLLER_BUTTON_MASKS[name.toLowerCase() as ControllerButton];
        assert.ok(reference_mask !== undefined, `${name} is not a reference controller button`);
        assert.equal(mask, reference_mask, `${name} must weigh the same bit as the reference`);
    }
});

test("each pad binds all eight buttons exactly once", () => {
    for (const controller of [0, 1] as const) {
        const buttons = KEYBOARD_BINDINGS.filter((binding) => binding.controller === controller).map(
            (binding) => binding.button,
        );
        assert.equal(buttons.length, 8, `pad ${controller} binds eight keys`);
        assert.deepEqual([...buttons].sort(), Object.keys(KEYBOARD_BUTTON).sort());
    }
});

test("polling assembles one mask per pad from the keys that are held down", () => {
    assert.deepEqual(keyboard_poll_masks(new Set()), [0, 0], "no key held leaves both pads idle");

    for (const binding of KEYBOARD_BINDINGS) {
        const masks = keyboard_poll_masks(new Set([binding.key]));
        const expected = KEYBOARD_BUTTON[binding.button];
        assert.deepEqual(
            masks,
            binding.controller === 0 ? [expected, 0] : [0, expected],
            `"${binding.key}" sets only its own pad's own bit`,
        );
    }

    const all_keys = new Set(KEYBOARD_BINDINGS.map((binding) => binding.key));
    assert.deepEqual(keyboard_poll_masks(all_keys), [255, 255], "every button held is a full mask");
});

test("keys the table does not bind are ignored and cannot leak between pads", () => {
    assert.deepEqual(keyboard_poll_masks(new Set(["escape", "q", "up arrow "])), [0, 0]);
    assert.deepEqual(keyboard_poll_masks(new Set(["z", "u"])), [KEYBOARD_BUTTON.A, KEYBOARD_BUTTON.A]);
    assert.deepEqual(
        keyboard_poll_masks(new Set(["up arrow", "down arrow"])),
        [KEYBOARD_BUTTON.UP | KEYBOARD_BUTTON.DOWN, 0],
    );
});

test("a polled mask reaches the console through the reference controller's serial report", () => {
    // The port writes the mask into the same live button state the reference's
    // set_button_mask() fills, so the serial report of a polled mask has to read back the
    // A/B/Select/Start/Up/Down/Left/Right order the hardware uses.
    const controllers = new NesControllerPorts();
    const [first_pad, second_pad] = keyboard_poll_masks(new Set(["z", "right arrow"]));

    controllers.set_button_mask(0, first_pad);
    controllers.set_button_mask(1, second_pad);
    controllers.write_strobe(1);
    controllers.write_strobe(0);

    assert.deepEqual(serial_report(controllers, 0, 8), [1, 0, 0, 0, 0, 0, 0, 1], "A reads back first, Right last");
    assert.deepEqual(serial_report(controllers, 1, 8), [0, 0, 0, 0, 0, 0, 0, 0], "the other pad stays idle");
    assert.deepEqual(serial_report(controllers, 0, 1), [1], "reads past the eighth button report the fill bit");
});

test("the run loop samples the keyboard once per chunk, from one place", () => {
    // A frame costs about 29,780 cycles, so the loop needs roughly 300 chunks of 100 cycles to
    // finish one. Sampling only when a frame completed would hand the console a press seconds
    // after it happened and would drop a tap shorter than an emulated frame, so the sampler
    // runs on every pass of the loop instead.
    assert.match(ROM_RUN_SOURCE, /%include src\/keyboard_input/, "the run loop can call the sampler");
    assert.equal(
        (ROM_RUN_SOURCE.match(/keyboard_poll_controllers;/g) ?? []).length,
        1,
        "the sampler is called from exactly one place",
    );

    const loop = /nowarp proc rom_run_loop \{([\s\S]*?)\n\}/.exec(ROM_RUN_SOURCE);
    assert.ok(loop, "rom_run_loop is missing");
    const body = loop?.[1] ?? "";

    const chunk_at = body.indexOf("frame_loop_run_chunk;");
    const frame_at = body.indexOf("if frame_loop_frame_complete == 1 {");
    const sample_at = body.indexOf("keyboard_poll_controllers;");
    assert.ok(chunk_at >= 0 && sample_at > chunk_at, "the sampler runs after a chunk of cycles");
    assert.ok(frame_at > sample_at, "the sampler runs every chunk, not only at the frame boundary");
});

test("the sampler writes both pads and nothing else", () => {
    // A sampler that left one pad's mask alone would strand the second player's input, and one
    // that wrote the latched serial report instead of the live mask would fight the strobe.
    const body = /proc keyboard_poll_controllers \{([\s\S]*?)\n\}/.exec(KEYBOARD_SOURCE);
    assert.ok(body, "keyboard_poll_controllers is missing");
    const text = body?.[1] ?? "";

    assert.match(text, /controller_set_button_mask 0, player_one_mask;/);
    assert.match(text, /controller_set_button_mask 1, player_two_mask;/);
    assert.equal((text.match(/controller_set_button_mask/g) ?? []).length, 2);
    assert.ok(!text.includes("controller_shift_registers"), "the sampler must not touch the serial latch");
    assert.ok(!text.includes("controller_strobe_high"), "the sampler must not touch the strobe");
});
