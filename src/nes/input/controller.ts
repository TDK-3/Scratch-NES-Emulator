import type { CpuBusDeviceRead } from "../cpu/cpu_bus.js";
import type { ControllerCpuPort } from "../cpu/nes_cpu_bus.js";

const CONTROLLER_COUNT = 2;
const FIRST_CONTROLLER = 0;
const SECOND_CONTROLLER = 1;
const STROBE_MASK = 0x01;
const SERIAL_DATA_MASK = 0x01;
const SERIAL_FILL_MASK = 0x80;
const FULL_BYTE_MASK = 0xff;

export type ControllerIndex = 0 | 1;
export type ControllerButton = "a" | "b" | "select" | "start" | "up" | "down" | "left" | "right";

export const CONTROLLER_BUTTON_MASKS: Readonly<Record<ControllerButton, number>> = Object.freeze({
    a: 0x01,
    b: 0x02,
    select: 0x04,
    start: 0x08,
    up: 0x10,
    down: 0x20,
    left: 0x40,
    right: 0x80,
});

/** Two standard NES serial controller ports connected to `$4016` and `$4017`. */
export class NesControllerPorts implements ControllerCpuPort {
    readonly #button_masks = new Uint8Array(CONTROLLER_COUNT);
    readonly #shift_registers = new Uint8Array(CONTROLLER_COUNT);
    #strobe_high = false;

    /** Clears serial latches/strobe while preserving the live physical button states. */
    reset(): void {
        this.#shift_registers.fill(0);
        this.#strobe_high = false;
    }

    /** Updates one live host button state without changing an already-latched serial report. */
    set_button_state(controller_index: ControllerIndex, button: ControllerButton, pressed: boolean): void {
        assert_controller_index(controller_index);

        if (typeof pressed !== "boolean") {
            throw new TypeError(`Controller button state must be boolean; received ${pressed}.`);
        }

        if (!Object.hasOwn(CONTROLLER_BUTTON_MASKS, button)) {
            throw new RangeError(`Unknown NES controller button: ${String(button)}.`);
        }

        const button_mask = CONTROLLER_BUTTON_MASKS[button];

        const current_mask = this.#button_masks[controller_index];

        if (current_mask === undefined) {
            throw new RangeError(`NES controller index ${controller_index} is outside the available ports.`);
        }

        this.#button_masks[controller_index] = pressed ? current_mask | button_mask : current_mask & ~button_mask;
    }

    /** Replaces one live button state using A/B/Select/Start/Up/Down/Left/Right bit order. */
    set_button_mask(controller_index: ControllerIndex, button_mask: number): void {
        assert_controller_index(controller_index);
        assert_byte_value(button_mask, "NES controller button mask");
        this.#button_masks[controller_index] = button_mask;
    }

    /** Reads the next serial button bit; the bus merges all undriven data lines from open bus. */
    read_controller(controller_index: ControllerIndex, _open_bus: number): CpuBusDeviceRead {
        assert_controller_index(controller_index);

        const button_mask = this.#button_masks[controller_index];

        if (button_mask === undefined) {
            throw new RangeError(`NES controller index ${controller_index} is outside the available ports.`);
        }

        const bit = this.#strobe_high ? button_mask & SERIAL_DATA_MASK : this.#shift_and_read(controller_index);

        return { value: bit, driven_mask: SERIAL_DATA_MASK };
    }

    /** While bit 0 is high, A is polled live; the falling edge latches all eight buttons for serial reads. */
    write_strobe(value: number): void {
        assert_byte_value(value, "NES controller strobe value");

        const next_strobe_high = (value & STROBE_MASK) !== 0;

        if (this.#strobe_high && !next_strobe_high) {
            this.#latch_button_states();
        }

        this.#strobe_high = next_strobe_high;
    }

    #shift_and_read(controller_index: ControllerIndex): number {
        const shift_register = this.#shift_registers[controller_index];

        if (shift_register === undefined) {
            throw new RangeError(`NES controller index ${controller_index} is outside the available ports.`);
        }

        this.#shift_registers[controller_index] = (shift_register >>> 1) | SERIAL_FILL_MASK;

        return shift_register & SERIAL_DATA_MASK;
    }

    #latch_button_states(): void {
        for (let controller_index = FIRST_CONTROLLER; controller_index <= SECOND_CONTROLLER; controller_index += 1) {
            const button_mask = this.#button_masks[controller_index];

            if (button_mask === undefined) {
                throw new RangeError(`NES controller index ${controller_index} is outside the available ports.`);
            }

            this.#shift_registers[controller_index] = button_mask;
        }
    }
}

function assert_controller_index(controller_index: number): asserts controller_index is ControllerIndex {
    if (controller_index !== FIRST_CONTROLLER && controller_index !== SECOND_CONTROLLER) {
        throw new RangeError(`NES controller index ${controller_index} must be 0 or 1.`);
    }
}

function assert_byte_value(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0 || value > FULL_BYTE_MASK) {
        throw new RangeError(`${label} ${value} is outside the byte range.`);
    }
}
