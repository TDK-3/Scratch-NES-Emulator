import assert from "node:assert/strict";
import { test } from "node:test";
import type { ControllerButton, ControllerIndex } from "../src/nes/input/controller.js";
import { NesControllerPorts } from "../src/nes/input/controller.js";
import { NesCpuBus } from "../src/nes/cpu/nes_cpu_bus.js";

test("serializes all eight buttons in NES order on two independent controller ports", () => {
    const controllers = new NesControllerPorts();
    controllers.set_button_state(0, "a", true);
    controllers.set_button_state(0, "select", true);
    controllers.set_button_state(0, "up", true);
    controllers.set_button_state(0, "left", true);
    controllers.set_button_state(1, "b", true);
    controllers.set_button_state(1, "start", true);
    controllers.set_button_state(1, "down", true);
    controllers.set_button_state(1, "right", true);

    latch_controllers(controllers);

    const first_port_bits = [1, 0, 1, 0, 1, 0, 1, 0];
    const second_port_bits = [0, 1, 0, 1, 0, 1, 0, 1];

    for (let bit_index = 0; bit_index < 8; bit_index += 1) {
        assert.deepEqual(controllers.read_controller(0, 0), {
            value: first_port_bits[bit_index],
            driven_mask: 0x01,
        });
        assert.deepEqual(controllers.read_controller(1, 0), {
            value: second_port_bits[bit_index],
            driven_mask: 0x01,
        });
    }

    assert.deepEqual(controllers.read_controller(0, 0), { value: 1, driven_mask: 0x01 });
    assert.deepEqual(controllers.read_controller(1, 0), { value: 1, driven_mask: 0x01 });
    assert.deepEqual(controllers.read_controller(0, 0), { value: 1, driven_mask: 0x01 });
});

test("reads live A while strobe is high and freezes the button report on its falling edge", () => {
    const controllers = new NesControllerPorts();
    controllers.set_button_state(0, "a", true);
    controllers.set_button_state(0, "b", true);
    controllers.write_strobe(0x01);

    assert.equal(read_bit(controllers, 0), 1);
    assert.equal(read_bit(controllers, 0), 1);

    controllers.set_button_state(0, "a", false);
    controllers.set_button_state(0, "start", true);
    assert.equal(read_bit(controllers, 0), 0);

    controllers.write_strobe(0);
    controllers.set_button_state(0, "a", true);
    controllers.set_button_state(0, "b", false);

    assert.equal(read_bit(controllers, 0), 0);
    controllers.write_strobe(0);
    assert.equal(read_bit(controllers, 0), 1);
    assert.equal(read_bit(controllers, 0), 0);
    assert.equal(read_bit(controllers, 0), 1);
});

test("a new strobe pulse restarts serial reads from the current button state", () => {
    const controllers = new NesControllerPorts();
    controllers.set_button_mask(0, 0x01);
    latch_controllers(controllers);

    assert.equal(read_bit(controllers, 0), 1);
    assert.equal(read_bit(controllers, 0), 0);

    controllers.set_button_state(0, "b", true);
    controllers.write_strobe(1);
    assert.equal(read_bit(controllers, 0), 1);
    controllers.set_button_state(0, "a", false);
    assert.equal(read_bit(controllers, 0), 0);

    controllers.write_strobe(0);
    assert.equal(read_bit(controllers, 0), 0);
    assert.equal(read_bit(controllers, 0), 1);
});

test("routes both controller ports through NesCpuBus and preserves undriven open-bus bits", () => {
    const controllers = new NesControllerPorts();
    controllers.set_button_state(0, "a", true);
    controllers.set_button_state(0, "b", true);
    controllers.set_button_state(1, "b", true);
    const bus = make_bus(controllers);

    bus.write_cpu(0x4016, 1);
    bus.write_cpu(0x4016, 0);
    bus.write_cpu(0x4018, 0xa6);

    assert.equal(bus.read_cpu(0x4016), 0xa7);
    assert.equal(bus.read_cpu(0x4016), 0xa7);
    assert.equal(bus.read_cpu(0x4017), 0xa6);
    assert.equal(bus.read_cpu(0x4017), 0xa7);
});

test("reset clears the serial report and strobe while preserving held button inputs", () => {
    const controllers = new NesControllerPorts();
    controllers.set_button_mask(0, 0x03);
    controllers.write_strobe(1);
    controllers.write_strobe(0);
    assert.equal(read_bit(controllers, 0), 1);

    controllers.reset();
    controllers.write_strobe(1);
    controllers.write_strobe(0);

    assert.deepEqual(
        Array.from({ length: 8 }, () => read_bit(controllers, 0)),
        [1, 1, 0, 0, 0, 0, 0, 0],
    );
});

test("rejects invalid controller indices, buttons, button masks, strobe values, and button states", () => {
    const controllers = new NesControllerPorts();

    assert.throws(() => controllers.set_button_state(2 as ControllerIndex, "a", true), RangeError);
    assert.throws(() => controllers.set_button_state(0, "turbo" as ControllerButton, true), RangeError);
    assert.throws(() => controllers.set_button_state(0, "toString" as ControllerButton, true), RangeError);
    assert.throws(() => controllers.set_button_state(0, "a", 1 as unknown as boolean), TypeError);
    assert.throws(() => controllers.set_button_mask(0, 0x100), RangeError);
    assert.throws(() => controllers.write_strobe(-1), RangeError);
    assert.throws(() => controllers.read_controller(2 as ControllerIndex, 0), RangeError);
});

function latch_controllers(controllers: NesControllerPorts): void {
    controllers.write_strobe(1);
    controllers.write_strobe(0);
}

function read_bit(controllers: NesControllerPorts, controller_index: ControllerIndex): number {
    const read = controllers.read_controller(controller_index, 0);

    if (read === null) {
        throw new Error("Standard controller reads must drive serial data bit 0.");
    }

    return read.value & 0x01;
}

function make_bus(controllers: NesControllerPorts): NesCpuBus {
    return new NesCpuBus({
        ppu: {
            read_cpu_register: () => null,
            write_cpu_register: () => {},
        },
        apu: {
            read_status: () => null,
            write_register: () => {},
        },
        controllers,
        cartridge: {
            read_cpu: () => null,
            write_cpu: () => {},
        },
    });
}
