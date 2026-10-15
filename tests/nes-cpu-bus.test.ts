import assert from "node:assert/strict";
import test from "node:test";

import type { CpuBusDeviceRead } from "../src/nes/cpu/cpu_bus.js";
import { NesCpuBus } from "../src/nes/cpu/nes_cpu_bus.js";

test("mirrors 2 KiB internal RAM throughout $0000-$1FFF", () => {
    const { bus } = make_bus_probe();

    bus.write_cpu(0x0005, 0xa5);
    bus.write_cpu(0x07ff, 0x5a);

    assert.equal(bus.read_cpu(0x0005), 0xa5);
    assert.equal(bus.read_cpu(0x0805), 0xa5);
    assert.equal(bus.read_cpu(0x1005), 0xa5);
    assert.equal(bus.read_cpu(0x1805), 0xa5);
    assert.equal(bus.read_cpu(0x07ff), 0x5a);
    assert.equal(bus.read_cpu(0x0fff), 0x5a);
    assert.equal(bus.read_cpu(0x17ff), 0x5a);
    assert.equal(bus.read_cpu(0x1fff), 0x5a);
});

test("mirrors the eight PPU registers across $2000-$3FFF", () => {
    const { bus, calls, responses } = make_bus_probe();
    responses.ppu = { value: 0xe3, driven_mask: 0xff };

    bus.write_cpu(0x2008, 0x44);

    assert.equal(bus.read_cpu(0x3ffa), 0xe3);
    assert.deepEqual(calls.ppu_writes, [{ register_index: 0, value: 0x44 }]);
    assert.deepEqual(calls.ppu_reads, [{ register_index: 2, open_bus: 0x44 }]);
});

test("routes APU registers and the two controller reads to their ports", () => {
    const { bus, calls, responses } = make_bus_probe();
    responses.apu = { value: 0x40, driven_mask: 0xff };
    responses.controller = { value: 0x01, driven_mask: 0x01 };

    bus.write_cpu(0x4000, 0x10);
    bus.write_cpu(0x4015, 0x15);
    bus.write_cpu(0x4017, 0x17);
    bus.write_cpu(0x4016, 0x01);

    assert.equal(bus.read_cpu(0x4015), 0x40);
    assert.equal(bus.read_cpu(0x4016), 0x41);
    assert.equal(bus.read_cpu(0x4017), 0x41);
    assert.deepEqual(calls.apu_reads, [0x01]);
    assert.deepEqual(calls.apu_writes, [
        { address: 0x4000, value: 0x10 },
        { address: 0x4015, value: 0x15 },
        { address: 0x4017, value: 0x17 },
    ]);
    assert.deepEqual(calls.controller_writes, [0x01]);
    assert.deepEqual(calls.controller_reads, [
        { controller_index: 0, open_bus: 0x40 },
        { controller_index: 1, open_bus: 0x41 },
    ]);
});

test("keeps OAM DMA and disabled I/O registers out of the APU and controller ports", () => {
    const { bus, calls } = make_bus_probe();

    bus.write_cpu(0x4014, 0xa7);
    bus.write_cpu(0x4018, 0x18);

    assert.equal(bus.read_cpu(0x4014), 0x18);
    assert.equal(bus.read_cpu(0x401f), 0x18);
    assert.deepEqual(calls.apu_writes, []);
    assert.deepEqual(calls.controller_writes, []);
    assert.deepEqual(calls.controller_reads, []);
});

test("routes expansion, cartridge RAM, and PRG windows to the cartridge port", () => {
    const { bus, calls, responses } = make_bus_probe();
    responses.cartridge = { value: 0x5e, driven_mask: 0xff };

    assert.equal(bus.read_cpu(0x4020), 0x5e);
    assert.equal(bus.read_cpu(0x6000), 0x5e);
    assert.equal(bus.read_cpu(0x8000), 0x5e);
    assert.equal(bus.read_cpu(0xffff), 0x5e);
    bus.write_cpu(0x6000, 0x6a);
    bus.write_cpu(0x8000, 0x8b);

    assert.deepEqual(calls.cartridge_reads, [0x4020, 0x6000, 0x8000, 0xffff]);
    assert.deepEqual(calls.cartridge_writes, [
        { address: 0x6000, value: 0x6a },
        { address: 0x8000, value: 0x8b },
    ]);
});

test("maintains open bus across unmapped reads and merges partially driven controller bits", () => {
    const { bus, calls, responses } = make_bus_probe();
    responses.controller = { value: 0x01, driven_mask: 0x01 };

    bus.write_cpu(0x4014, 0xa0);

    assert.equal(bus.read_cpu(0x4015), 0xa0);
    assert.deepEqual(calls.apu_reads, [0xa0]);
    assert.equal(bus.read_cpu(0x4016), 0xa1);
    assert.equal(bus.read_cpu(0x4018), 0xa1);

    bus.write_cpu(0x0008, 0x36);

    assert.equal(bus.read_cpu(0x0008), 0x36);
    assert.equal(bus.read_cpu(0x401f), 0x36);
});

test("reset cancels pending DMA and clears open bus while preserving CPU RAM", () => {
    const { bus } = make_bus_probe();
    bus.write_cpu(0x0005, 0xa5);
    bus.write_cpu(0x4014, 0x00);
    assert.notEqual(bus.clock_cpu_dma_cycle(0x8000), null);

    bus.reset();

    assert.equal(bus.clock_cpu_dma_cycle(0x8000), null);
    assert.equal(bus.read_cpu(0x4018), 0x00);
    assert.equal(bus.read_cpu(0x0005), 0xa5);
});

test("rejects invalid device read values and data-line masks", () => {
    const invalid_value = make_bus_probe();
    invalid_value.responses.controller = { value: 0x100, driven_mask: 0xff };
    assert.throws(() => invalid_value.bus.read_cpu(0x4016), RangeError);

    const invalid_mask = make_bus_probe();
    invalid_mask.responses.controller = { value: 0x00, driven_mask: 0x100 };
    assert.throws(() => invalid_mask.bus.read_cpu(0x4016), RangeError);
});

test("rejects CPU addresses and write values outside the bus contract", () => {
    const { bus } = make_bus_probe();

    assert.throws(() => bus.read_cpu(-1), RangeError);
    assert.throws(() => bus.read_cpu(0x1_0000), RangeError);
    assert.throws(() => bus.write_cpu(0x10000, 0), RangeError);
    assert.throws(() => bus.write_cpu(0, 0x100), RangeError);
});

interface BusProbe {
    readonly bus: NesCpuBus;
    readonly calls: {
        readonly ppu_reads: Array<{ readonly register_index: number; readonly open_bus: number }>;
        readonly ppu_writes: Array<{ readonly register_index: number; readonly value: number }>;
        readonly apu_reads: number[];
        readonly apu_writes: Array<{ readonly address: number; readonly value: number }>;
        readonly controller_reads: Array<{ readonly controller_index: 0 | 1; readonly open_bus: number }>;
        readonly controller_writes: number[];
        readonly cartridge_reads: number[];
        readonly cartridge_writes: Array<{ readonly address: number; readonly value: number }>;
    };
    readonly responses: {
        ppu: CpuBusDeviceRead;
        apu: CpuBusDeviceRead;
        controller: CpuBusDeviceRead;
        cartridge: CpuBusDeviceRead;
    };
}

function make_bus_probe(): BusProbe {
    const calls: BusProbe["calls"] = {
        ppu_reads: [],
        ppu_writes: [],
        apu_reads: [],
        apu_writes: [],
        controller_reads: [],
        controller_writes: [],
        cartridge_reads: [],
        cartridge_writes: [],
    };
    const responses: BusProbe["responses"] = {
        ppu: null,
        apu: null,
        controller: null,
        cartridge: null,
    };
    const bus = new NesCpuBus({
        ppu: {
            read_cpu_register(register_index, open_bus) {
                calls.ppu_reads.push({ register_index, open_bus });

                return responses.ppu;
            },
            write_cpu_register(register_index, value) {
                calls.ppu_writes.push({ register_index, value });
            },
        },
        apu: {
            read_status(open_bus) {
                calls.apu_reads.push(open_bus);

                return responses.apu;
            },
            write_register(address, value) {
                calls.apu_writes.push({ address, value });
            },
        },
        controllers: {
            read_controller(controller_index, open_bus) {
                calls.controller_reads.push({ controller_index, open_bus });

                return responses.controller;
            },
            write_strobe(value) {
                calls.controller_writes.push(value);
            },
        },
        cartridge: {
            read_cpu(address) {
                calls.cartridge_reads.push(address);

                return responses.cartridge;
            },
            write_cpu(address, value) {
                calls.cartridge_writes.push({ address, value });
            },
        },
    });

    return { bus, calls, responses };
}
