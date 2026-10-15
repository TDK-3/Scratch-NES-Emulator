import assert from "node:assert/strict";
import { test } from "node:test";
import { ApuDmcChannel } from "../src/nes/apu/dmc_channel.js";

const DMC_PERIODS_NTSC = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 85, 72, 54];

test("decodes the NTSC rate table and clocks the output unit at the selected CPU-cycle period", () => {
    for (const [rate_index, period] of DMC_PERIODS_NTSC.entries()) {
        const dmc = new ApuDmcChannel();
        dmc.write_control(rate_index);
        assert.equal(dmc.get_timer_period_cycles(), period);
    }

    const dmc = new ApuDmcChannel();
    dmc.write_control(0x0f);
    dmc.write_output_level(64);
    dmc.write_sample_length(1);
    dmc.write_status_enable(true, 0);
    assert.equal(dmc.get_dma_request_address(), 0xc000);
    dmc.complete_dma_read(0x01);
    dmc.clock_cpu_cycle();

    assert.equal(dmc.get_output(), 66);
    assert.equal(dmc.get_sample_buffer(), undefined);
    assert.equal(dmc.get_bits_remaining(), 7);
    assert.equal(dmc.get_dma_request_address(), 0xc001);

    for (let cycle = 0; cycle < 53; cycle += 1) {
        dmc.clock_cpu_cycle();
    }

    assert.equal(dmc.get_bits_remaining(), 7);
    dmc.clock_cpu_cycle();
    assert.equal(dmc.get_bits_remaining(), 6);
});

test("loads sample address and length registers, advances bytes, and wraps at $FFFF to $8000", () => {
    const dmc = new ApuDmcChannel();
    dmc.write_control(0x0f);
    dmc.write_sample_address(0xff);
    dmc.write_sample_length(0x04);
    dmc.write_status_enable(true, 0);

    assert.equal(dmc.get_bytes_remaining(), 65);

    for (let offset = 0; offset < 64; offset += 1) {
        assert.equal(dmc.get_dma_request_address(), 0xffc0 + offset);
        dmc.complete_dma_read(offset & 0xff);

        while (dmc.get_sample_buffer() !== undefined) {
            dmc.clock_cpu_cycle();
        }
    }

    assert.equal(dmc.get_current_address(), 0x8000);
    assert.equal(dmc.get_bytes_remaining(), 1);
    assert.equal(dmc.get_dma_request_address(), 0x8000);
});

test("raises completion IRQ, honors looping, disable, and IRQ-enable clearing", () => {
    const irq_dmc = new ApuDmcChannel();
    irq_dmc.write_control(0x80);
    irq_dmc.write_sample_length(0);
    irq_dmc.write_status_enable(true, 0);
    irq_dmc.complete_dma_read(0x5a);

    assert.equal(irq_dmc.get_status(), false);
    assert.equal(irq_dmc.is_irq_asserted(), true);
    irq_dmc.write_control(0x00);
    assert.equal(irq_dmc.is_irq_asserted(), false);

    const loop_dmc = new ApuDmcChannel();
    loop_dmc.write_control(0x40);
    loop_dmc.write_sample_address(0xff);
    loop_dmc.write_sample_length(0);
    loop_dmc.write_status_enable(true, 0);
    loop_dmc.complete_dma_read(0xa5);

    assert.equal(loop_dmc.get_current_address(), 0xffc0);
    assert.equal(loop_dmc.get_bytes_remaining(), 1);
    assert.equal(loop_dmc.get_status(), true);
    assert.equal(loop_dmc.is_irq_asserted(), false);

    loop_dmc.write_status_enable(false, 0);
    assert.equal(loop_dmc.get_status(), false);
    assert.equal(loop_dmc.get_sample_buffer(), 0xa5);
});

test("rejects invalid register, delay, and fetched-byte values", () => {
    const dmc = new ApuDmcChannel();

    assert.throws(() => dmc.write_control(0x100), RangeError);
    dmc.write_output_level(0x80);
    assert.equal(dmc.get_output(), 0);
    assert.throws(() => dmc.write_sample_address(-1), RangeError);
    assert.throws(() => dmc.write_sample_length(1.5), RangeError);
    assert.throws(() => dmc.write_status_enable(true, -1), RangeError);
    assert.throws(() => dmc.complete_dma_read(0x100), RangeError);
});
