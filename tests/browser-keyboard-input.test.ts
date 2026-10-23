import assert from "node:assert/strict";
import test from "node:test";

import type { ControllerButton, ControllerIndex } from "../src/nes/input/controller.js";
import { NesBrowserKeyboardInput } from "../src/nes/browser/keyboard_input.js";

interface ButtonTransition {
    readonly controller: ControllerIndex;
    readonly button: ControllerButton;
    readonly pressed: boolean;
}

const KEY_BINDINGS: readonly (readonly [string, ControllerIndex, ControllerButton])[] = [
    ["ArrowUp", 0, "up"],
    ["ArrowDown", 0, "down"],
    ["ArrowLeft", 0, "left"],
    ["ArrowRight", 0, "right"],
    ["z", 0, "a"],
    ["x", 0, "b"],
    ["Shift", 0, "select"],
    ["Enter", 0, "start"],
    ["i", 1, "up"],
    ["k", 1, "down"],
    ["j", 1, "left"],
    ["l", 1, "right"],
    ["u", 1, "a"],
    ["o", 1, "b"],
    ["h", 1, "select"],
    ["p", 1, "start"],
];

test("maps every documented keyboard binding to the correct button on each pad", () => {
    const transitions: ButtonTransition[] = [];
    const input = new NesBrowserKeyboardInput((controller, button, pressed) => {
        transitions.push({ controller, button, pressed });
    });
    let prevented_events = 0;

    for (const [key, controller, button] of KEY_BINDINGS) {
        input.key_down(key, false, () => {
            prevented_events += 1;
        });
        input.key_up(key);
        assert.deepEqual(transitions.slice(-2), [
            { controller, button, pressed: true },
            { controller, button, pressed: false },
        ]);
    }

    assert.equal(prevented_events, KEY_BINDINGS.length);
    assert.equal(transitions.length, KEY_BINDINGS.length * 2);
});

test("ignores unbound keys and preserves native input behavior in editable targets", () => {
    const transitions: ButtonTransition[] = [];
    const input = new NesBrowserKeyboardInput((controller, button, pressed) => {
        transitions.push({ controller, button, pressed });
    });
    let prevented_events = 0;
    const prevent_default = () => {
        prevented_events += 1;
    };

    input.key_down("ArrowUp", true, prevent_default);
    input.key_down("Escape", false, prevent_default);
    input.key_up("ArrowUp");
    input.key_up("Escape");

    assert.deepEqual(transitions, []);
    assert.equal(prevented_events, 0);
});

test("prevents repeated keydown defaults but emits only one held-button transition", () => {
    const transitions: ButtonTransition[] = [];
    const input = new NesBrowserKeyboardInput((controller, button, pressed) => {
        transitions.push({ controller, button, pressed });
    });
    let prevented_events = 0;
    const prevent_default = () => {
        prevented_events += 1;
    };

    input.key_down("ArrowUp", false, prevent_default);
    input.key_down("ARROWUP", false, prevent_default);
    input.key_up("arrowup");
    input.key_up("ArrowUp");

    assert.equal(prevented_events, 2);
    assert.deepEqual(transitions, [
        { controller: 0, button: "up", pressed: true },
        { controller: 0, button: "up", pressed: false },
    ]);
});

test("releases all held buttons on focus loss and safely handles repeated release", () => {
    const transitions: ButtonTransition[] = [];
    const input = new NesBrowserKeyboardInput((controller, button, pressed) => {
        transitions.push({ controller, button, pressed });
    });

    input.key_down("z", false, () => {});
    input.key_down("p", false, () => {});
    input.key_down("z", false, () => {});
    input.release_all();
    input.release_all();
    input.key_up("p");

    assert.deepEqual(transitions, [
        { controller: 0, button: "a", pressed: true },
        { controller: 1, button: "start", pressed: true },
        { controller: 0, button: "a", pressed: false },
        { controller: 1, button: "start", pressed: false },
    ]);
});
