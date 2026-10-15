import assert from "node:assert/strict";
import { test } from "node:test";
import { Apu2A03 } from "../src/nes/apu/apu_2a03.js";
import { mix_apu_channels } from "../src/nes/apu/mixer.js";
import { NesCpuBus } from "../src/nes/cpu/nes_cpu_bus.js";

test("routes both pulse register groups and reflects enable and length status", () => {
    const apu = new Apu2A03();
    apu.write_register(0x4015, 0x03);
    apu.write_register(0x4000, 0xdf);
    apu.write_register(0x4002, 8);
    apu.write_register(0x4003, 0);
    apu.write_register(0x4004, 0xdf);
    apu.write_register(0x4006, 8);
    apu.write_register(0x4007, 0);

    assert.equal(apu.get_pulse_output(1), 15);
    assert.equal(apu.get_pulse_output(2), 15);
    assert.equal(apu.get_pulse_length_counter(1), 10);
    assert.equal(apu.get_pulse_length_counter(2), 10);
    assert.deepEqual(apu.read_status(0x20), { value: 0x03, driven_mask: 0xdf });

    apu.write_register(0x4015, 0x02);
    assert.equal(apu.get_pulse_output(1), 0);
    assert.equal(apu.get_pulse_length_counter(1), 0);
    assert.equal(apu.get_pulse_output(2), 15);
    assert.deepEqual(apu.read_status(0), { value: 0x02, driven_mask: 0xdf });
});

test("routes triangle/noise register writes and reports their length status bits", () => {
    const apu = new Apu2A03();
    apu.write_register(0x4015, 0x0c);
    apu.write_register(0x4008, 0x01);
    apu.write_register(0x400a, 2);
    apu.write_register(0x400b, 0);
    apu.write_register(0x400c, 0x1f);
    apu.write_register(0x400e, 0);
    apu.write_register(0x400f, 0);

    assert.deepEqual(apu.read_status(0), { value: 0x0c, driven_mask: 0xdf });

    apu.write_register(0x4015, 0x04);
    assert.deepEqual(apu.read_status(0), { value: 0x04, driven_mask: 0xdf });

    apu.write_register(0x4015, 0);
    assert.deepEqual(apu.read_status(0), { value: 0, driven_mask: 0xdf });
});

test("mixes the live pulse, triangle, and noise DAC levels", () => {
    const apu = new Apu2A03();
    apu.write_register(0x4015, 0x0f);
    apu.write_register(0x4000, 0xdf);
    apu.write_register(0x4002, 8);
    apu.write_register(0x4003, 0);
    apu.write_register(0x4004, 0xdf);
    apu.write_register(0x4006, 8);
    apu.write_register(0x4007, 0);
    apu.write_register(0x4008, 0x81);
    apu.write_register(0x400a, 2);
    apu.write_register(0x400b, 0);
    apu.write_register(0x400c, 0x3f);
    apu.write_register(0x400e, 0);
    apu.write_register(0x400f, 0);
    apu.write_register(0x4017, 0x80);

    clock_cpu_cycles(apu, 4);
    assert.equal(apu.get_pulse_output(1), 15);
    assert.equal(apu.get_pulse_output(2), 15);
    assert.equal(apu.get_triangle_output(), 1);
    assert.equal(apu.get_noise_output(), 15);
    assert.equal(apu.get_mixed_output(), mix_apu_channels(15, 15, 1, 15));
});

test("plugs into NesCpuBus and preserves open-bus bit 5 on $4015 reads", () => {
    const apu = new Apu2A03();
    const bus = new NesCpuBus({
        ppu: {
            read_cpu_register: () => null,
            write_cpu_register: () => {},
        },
        apu,
        controllers: {
            read_controller: () => null,
            write_strobe: () => {},
        },
        cartridge: {
            read_cpu: () => null,
            write_cpu: () => {},
        },
    });

    bus.write_cpu(0x4015, 1);
    bus.write_cpu(0x4000, 0xdf);
    bus.write_cpu(0x4002, 8);
    bus.write_cpu(0x4003, 0);
    bus.write_cpu(0x4018, 0x20);

    assert.equal(bus.read_cpu(0x4015), 0x21);
});

test("routes DMC registers, delays the load fetch, reports status, and latches completion IRQ", () => {
    const apu = new Apu2A03();
    apu.write_register(0x4010, 0x80);
    apu.write_register(0x4011, 0x45);
    apu.write_register(0x4012, 0x02);
    apu.write_register(0x4013, 0x00);
    apu.write_register(0x4015, 0x10);
    const bus = make_apu_bus(apu);

    assert.equal(apu.get_dmc_output(), 0x45);
    assert.equal(bus.is_apu_irq_asserted(), false);
    assert.equal(apu.get_dmc_dma_request_address(), null);
    assert.deepEqual(apu.read_status(0), { value: 0x10, driven_mask: 0xdf });
    clock_cpu_cycles(apu, 2);
    assert.equal(apu.get_dmc_dma_request_address(), null);
    apu.clock_cpu_cycle();
    assert.equal(apu.get_dmc_dma_request_address(), 0xc080);

    apu.complete_dmc_dma_read(0xff);
    assert.equal(apu.get_dmc_dma_request_address(), null);
    assert.equal(apu.is_dmc_irq_asserted(), true);
    assert.equal(apu.is_irq_asserted(), true);
    assert.equal(bus.is_apu_irq_asserted(), true);
    assert.deepEqual(apu.read_status(0), { value: 0x80, driven_mask: 0xdf });
    assert.equal(apu.is_dmc_irq_asserted(), true);

    apu.write_register(0x4015, 0);
    assert.equal(apu.is_irq_asserted(), false);
    assert.equal(bus.is_apu_irq_asserted(), false);
    assert.deepEqual(apu.read_status(0), { value: 0, driven_mask: 0xdf });
});

test("schedules the DMC load DMA after three or four APU cycles by clock parity", () => {
    const even_cycle_write = new Apu2A03();
    even_cycle_write.write_register(0x4015, 0x10);
    clock_cpu_cycles(even_cycle_write, 2);
    assert.equal(even_cycle_write.get_dmc_dma_request_address(), null);
    even_cycle_write.clock_cpu_cycle();
    assert.equal(even_cycle_write.get_dmc_dma_request_address(), 0xc000);

    const odd_cycle_write = new Apu2A03();
    odd_cycle_write.clock_cpu_cycle();
    odd_cycle_write.write_register(0x4015, 0x10);
    clock_cpu_cycles(odd_cycle_write, 3);
    assert.equal(odd_cycle_write.get_dmc_dma_request_address(), null);
    odd_cycle_write.clock_cpu_cycle();
    assert.equal(odd_cycle_write.get_dmc_dma_request_address(), 0xc000);
});

test("mixes pulse, triangle, noise, and the live DMC DAC level", () => {
    const apu = new Apu2A03();
    apu.write_register(0x4011, 0x40);

    assert.equal(apu.get_mixed_output(), mix_apu_channels(0, 0, 0, 0, 0x40));
});

test("clocks pulse envelopes, length counters, and four-step frame IRQ at NTSC events", () => {
    const apu = new Apu2A03();
    apu.write_register(0x4015, 1);
    apu.write_register(0x4000, 0xc0);
    apu.write_register(0x4002, 8);
    apu.write_register(0x4003, 0);

    clock_cpu_cycles(apu, 7_456);
    assert.equal(apu.get_pulse_output(1), 0);
    apu.clock_cpu_cycle();
    assert.equal(apu.get_pulse_output(1), 15);
    assert.equal(apu.is_frame_irq_asserted(), false);

    clock_cpu_cycles(apu, 14_913 - 7_457);
    assert.ok(apu.get_pulse_output(1) > 0);
    assert.equal(apu.get_pulse_length_counter(1), 9);
    assert.equal(apu.is_frame_irq_asserted(), false);

    clock_cpu_cycles(apu, 29_829 - 14_913);
    assert.equal(apu.get_pulse_length_counter(1), 8);
    assert.equal(apu.is_frame_irq_asserted(), true);
    assert.deepEqual(apu.read_status(0), { value: 0x41, driven_mask: 0xdf });
    assert.equal(apu.is_frame_irq_asserted(), false);
    assert.deepEqual(apu.read_status(0), { value: 0x01, driven_mask: 0xdf });
});

test("uses five-step quarter/half clocks and suppresses frame IRQ", () => {
    const apu = new Apu2A03();
    apu.write_register(0x4015, 1);
    apu.write_register(0x4000, 0xdf);
    apu.write_register(0x4002, 8);
    apu.write_register(0x4003, 0);
    apu.write_register(0x4017, 0xc0);

    clock_cpu_cycles(apu, 3);
    assert.equal(apu.get_pulse_output(1), 15);
    assert.equal(apu.get_pulse_length_counter(1), 9);

    clock_cpu_cycles(apu, 37_281);
    assert.equal(apu.is_frame_irq_asserted(), false);
    assert.deepEqual(apu.read_status(0), { value: 0x01, driven_mask: 0xdf });

    const odd_parity_write = new Apu2A03();
    odd_parity_write.write_register(0x4015, 1);
    odd_parity_write.write_register(0x4000, 0xc0);
    odd_parity_write.write_register(0x4002, 8);
    odd_parity_write.write_register(0x4003, 0);
    odd_parity_write.clock_cpu_cycle();
    odd_parity_write.write_register(0x4017, 0xc0);

    clock_cpu_cycles(odd_parity_write, 3);
    assert.equal(odd_parity_write.get_pulse_output(1), 0);
    assert.equal(odd_parity_write.get_pulse_length_counter(1), 10);
    odd_parity_write.clock_cpu_cycle();
    assert.equal(odd_parity_write.get_pulse_output(1), 15);
    assert.equal(odd_parity_write.get_pulse_length_counter(1), 9);
});

test("clears frame IRQ when inhibited, resets state, and validates register writes", () => {
    const apu = new Apu2A03();
    apu.write_register(0x4015, 1);
    apu.write_register(0x4000, 0xdf);
    apu.write_register(0x4002, 8);
    apu.write_register(0x4003, 0);
    clock_cpu_cycles(apu, 29_829);
    assert.equal(apu.is_frame_irq_asserted(), true);

    apu.write_register(0x4017, 0x40);
    assert.equal(apu.is_frame_irq_asserted(), false);
    clock_cpu_cycles(apu, 29_833);
    assert.equal(apu.is_frame_irq_asserted(), false);

    apu.reset();
    assert.equal(apu.get_pulse_output(1), 0);
    assert.equal(apu.get_pulse_length_counter(1), 0);
    assert.equal(apu.is_frame_irq_asserted(), false);

    assert.throws(() => apu.write_register(0x4016, 0), RangeError);
    assert.throws(() => apu.write_register(0x4000, 256), RangeError);
    assert.throws(() => apu.write_register(0x4000, 1.5), RangeError);
});

function make_apu_bus(apu: Apu2A03): NesCpuBus {
    return new NesCpuBus({
        ppu: {
            read_cpu_register: () => null,
            write_cpu_register: () => {},
        },
        apu,
        controllers: {
            read_controller: () => null,
            write_strobe: () => {},
        },
        cartridge: {
            read_cpu: () => null,
            write_cpu: () => {},
        },
    });
}

function clock_cpu_cycles(apu: Apu2A03, cycles: number): void {
    for (let cycle = 0; cycle < cycles; cycle += 1) {
        apu.clock_cpu_cycle();
    }
}
