import type { ControllerButton, ControllerIndex } from "../input/controller.js";

interface ButtonBinding {
    readonly controller: ControllerIndex;
    readonly button: ControllerButton;
}

export type BrowserControllerButtonSink = (
    controller_index: ControllerIndex,
    button: ControllerButton,
    pressed: boolean,
) => void;

const KEY_BINDINGS: Readonly<Record<string, ButtonBinding>> = Object.freeze({
    arrowup: { controller: 0, button: "up" },
    arrowdown: { controller: 0, button: "down" },
    arrowleft: { controller: 0, button: "left" },
    arrowright: { controller: 0, button: "right" },
    z: { controller: 0, button: "a" },
    x: { controller: 0, button: "b" },
    shift: { controller: 0, button: "select" },
    enter: { controller: 0, button: "start" },
    i: { controller: 1, button: "up" },
    k: { controller: 1, button: "down" },
    j: { controller: 1, button: "left" },
    l: { controller: 1, button: "right" },
    u: { controller: 1, button: "a" },
    o: { controller: 1, button: "b" },
    h: { controller: 1, button: "select" },
    p: { controller: 1, button: "start" },
});

/** Maps browser keyboard events to two standard NES pads and releases stuck keys on focus loss. */
export class NesBrowserKeyboardInput {
    readonly #set_button_state: BrowserControllerButtonSink;
    readonly #held_keys = new Set<string>();

    constructor(set_button_state: BrowserControllerButtonSink) {
        this.#set_button_state = set_button_state;
    }

    /** Handles one key-down event; editable fields retain their native keyboard behavior. */
    key_down(key: string, target_is_editable: boolean, prevent_default: () => void): void {
        if (target_is_editable) {
            return;
        }

        const normalized_key = key.toLowerCase();
        const binding = KEY_BINDINGS[normalized_key];

        if (binding === undefined) {
            return;
        }

        prevent_default();

        if (this.#held_keys.has(normalized_key)) {
            return;
        }

        this.#held_keys.add(normalized_key);
        this.#set_button_state(binding.controller, binding.button, true);
    }

    /** Releases the NES button associated with one key, if that key was held. */
    key_up(key: string): void {
        this.#release_key(key.toLowerCase());
    }

    /** Releases every held key, for example when the browser window loses focus. */
    release_all(): void {
        for (const key of this.#held_keys) {
            this.#release_key(key);
        }
    }

    #release_key(key: string): void {
        if (!this.#held_keys.delete(key)) {
            return;
        }

        const binding = KEY_BINDINGS[key];

        if (binding !== undefined) {
            this.#set_button_state(binding.controller, binding.button, false);
        }
    }
}
