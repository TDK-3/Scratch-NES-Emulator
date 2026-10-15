import assert from "node:assert/strict";
import { test } from "node:test";
import { Apu2A03 } from "../src/nes/apu/apu_2a03.js";
import { Cpu2A03 } from "../src/nes/cpu/cpu_2a03.js";
import type { CpuBusDeviceRead } from "../src/nes/cpu/cpu_bus.js";
import { NesCpuBus } from "../src/nes/cpu/nes_cpu_bus.js";

const DMC_SAMPLE_ADDRESS = 0xc000;
const OAM_DMA_ADDRESS = 0x4014;
const SOURCE_PAGE = 0x02;
const SOURCE_PAGE_ADDRESS = SOURCE_PAGE << 8;
const OAM_DATA_ADDRESS = 0x2004;

interface DmcDmaHarness {
    readonly bus: NesCpuBus;
    readonly apu: {
        request_address: number | null;
        readonly completed_bytes: number[];
    };
    readonly controller_reads: number[];
    readonly cartridge_reads: number[];
    readonly cartridge_writes: Array<{ readonly address: number; readonly value: number }>;
    readonly ppu_writes: Array<{ readonly register_index: number; readonly value: number }>;
}

test("stalls a CPU controller read for four cycles, repeats held reads, and supplies the DMC byte", () => {
    const harness = make_harness([0xad, 0x16, 0x40]);
    const cpu = new Cpu2A03(harness.bus);
    cpu.program_counter = 0;

    for (let cycle = 0; cycle < 3; cycle += 1) {
        assert.equal(cpu.clock_cycle().sequence_kind, "instruction");
    }

    harness.apu.request_address = DMC_SAMPLE_ADDRESS;
    const dma_cycles = [];
    let cycle = cpu.clock_cycle();

    while (true) {
        assert.equal(cycle.sequence_kind, "dma");
        dma_cycles.push(cycle);

        if (cycle.sequence_completed) {
            break;
        }

        cycle = cpu.clock_cycle();
    }

    assert.equal(dma_cycles.length, 4);
    assert.deepEqual(dma_cycles.map((dma_cycle) => dma_cycle.sequence_cycle), [1, 2, 3, 4]);
    assert.deepEqual(dma_cycles.slice(0, 3).map((dma_cycle) => dma_cycle.access.address), [0x4016, 0x4016, 0x4016]);
    assert.deepEqual(dma_cycles[3]?.access, { kind: "read", address: DMC_SAMPLE_ADDRESS, value: 0xa5 });
    assert.equal(harness.controller_reads.length, 3);
    assert.deepEqual(harness.apu.completed_bytes, [0xa5]);
    assert.equal(cpu.program_counter, 3);

    const resumed_cycle = cpu.clock_cycle();
    assert.equal(resumed_cycle.sequence_kind, "instruction");
    assert.equal(resumed_cycle.sequence_completed, true);
    assert.deepEqual(resumed_cycle.access, { kind: "read", address: 0x4016, value: 0xa5 });
    assert.equal(harness.controller_reads.length, 4);
    assert.equal(cpu.a, 0xa5);
});

test("production CPU-bus DMC stalls drop unstable-store masks on the tagged dummy reads", () => {
    const cases = [
        {
            opcode: 0x93,
            operands: [0x20],
            pointer_address: 0x0020,
            pointer_bytes: [0xff, 0x12],
            a: 0xff,
            x: 0x0f,
            y: 0x01,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x80,
            dummy_address: 0x1200,
            target: 0x0300,
            unmasked_value: 0x0f,
            cycles_before_dummy_read: 4,
        },
        {
            opcode: 0x9b,
            operands: [0xff, 0x56],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0x7f,
            x: 0x0f,
            y: 0x01,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x0f,
            dummy_address: 0x5600,
            target: 0x0700,
            unmasked_value: 0x0f,
            cycles_before_dummy_read: 3,
        },
        {
            opcode: 0x9c,
            operands: [0xff, 0x56],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0x00,
            x: 0x01,
            y: 0x27,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x80,
            dummy_address: 0x5600,
            target: 0x0700,
            unmasked_value: 0x27,
            cycles_before_dummy_read: 3,
        },
        {
            opcode: 0x9e,
            operands: [0xff, 0x12],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0x00,
            x: 0x0f,
            y: 0x01,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x80,
            dummy_address: 0x1200,
            target: 0x0300,
            unmasked_value: 0x0f,
            cycles_before_dummy_read: 3,
        },
        {
            opcode: 0x9f,
            operands: [0xff, 0x12],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0xff,
            x: 0x0f,
            y: 0x01,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x80,
            dummy_address: 0x1200,
            target: 0x0300,
            unmasked_value: 0x0f,
            cycles_before_dummy_read: 3,
        },
    ];

    for (const example of cases) {
        const harness = make_harness([example.opcode, ...example.operands]);

        if (example.pointer_address !== undefined && example.pointer_bytes !== undefined) {
            for (const [index, value] of example.pointer_bytes.entries()) {
                harness.bus.write_cpu(example.pointer_address + index, value);
            }
        }

        // Setup writes are not emulated CPU cycles; reset parity while retaining the program and pointer data.
        harness.bus.reset();
        const cpu = new Cpu2A03(harness.bus);
        cpu.program_counter = 0;
        cpu.a = example.a;
        cpu.x = example.x;
        cpu.y = example.y;
        cpu.stack_pointer = example.initial_stack_pointer;

        for (let cycle = 0; cycle < example.cycles_before_dummy_read; cycle += 1) {
            assert.equal(cpu.clock_cycle().sequence_kind, "instruction");
        }

        harness.apu.request_address = DMC_SAMPLE_ADDRESS;
        const tail_cycles = [];

        for (let cycle = 0; cycle < 8; cycle += 1) {
            const result = cpu.clock_cycle();
            tail_cycles.push(result);

            if (result.sequence_kind === "instruction" && result.sequence_completed) {
                break;
            }
        }

        const dma_cycles = tail_cycles.filter(({ sequence_kind }) => sequence_kind === "dma");
        const resumed_instruction_cycles = tail_cycles.filter(({ sequence_kind }) => sequence_kind === "instruction");

        const expected_dma_cycles = example.cycles_before_dummy_read % 2 === 0 ? 4 : 3;
        const held_reads = Array.from({ length: expected_dma_cycles - 1 }, () => ({
            kind: "read" as const,
            address: example.dummy_address,
            value: 0,
        }));

        assert.equal(
            dma_cycles.length,
            expected_dma_cycles,
            `DMC halt parity for opcode $${example.opcode.toString(16)}`,
        );
        assert.deepEqual(
            dma_cycles.map(({ access }) => access),
            [...held_reads, { kind: "read", address: DMC_SAMPLE_ADDRESS, value: 0xa5 }],
        );
        assert.deepEqual(
            resumed_instruction_cycles.map(({ access }) => access),
            [
                { kind: "read", address: example.dummy_address, value: 0 },
                { kind: "write", address: example.target, value: example.unmasked_value },
            ],
        );
        assert.equal(tail_cycles.at(-1)?.sequence_completed, true);
        assert.equal(harness.apu.completed_bytes.length, 1);
        assert.equal(cpu.stack_pointer, example.expected_stack_pointer);
    }
});

test("an Apu2A03 fetch request stalls the production bus on an unstable-store dummy read", () => {
    const apu = new Apu2A03(1);
    apu.write_register(0x4012, 0x00);
    apu.write_register(0x4013, 0x00);
    apu.write_register(0x4015, 0x10);

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
            read_cpu: (address) => ({
                value: address === DMC_SAMPLE_ADDRESS ? 0xa5 : 0,
                driven_mask: 0xff,
            }),
            write_cpu: () => {},
        },
    });

    for (const [address, value] of [0x9e, 0xff, 0x12].entries()) {
        bus.write_cpu(address, value);
    }

    // Test-program setup is outside emulated time; preserve RAM while resetting DMA alignment parity.
    bus.reset();
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0;
    cpu.x = 0x0f;
    cpu.y = 0x01;

    for (let cycle = 0; cycle < 3; cycle += 1) {
        assert.equal(cpu.clock_cycle().sequence_kind, "instruction");
        apu.clock_cpu_cycle();
    }

    assert.equal(apu.get_dmc_dma_request_address(), DMC_SAMPLE_ADDRESS);

    const tail_cycles = [];

    for (let cycle = 0; cycle < 8; cycle += 1) {
        const result = cpu.clock_cycle();
        tail_cycles.push(result);
        apu.clock_cpu_cycle();

        if (result.sequence_kind === "instruction" && result.sequence_completed) {
            break;
        }
    }

    const dma_cycles = tail_cycles.filter(({ sequence_kind }) => sequence_kind === "dma");
    assert.deepEqual(
        dma_cycles.map(({ access }) => access),
        [
            { kind: "read", address: 0x1200, value: 0 },
            { kind: "read", address: 0x1200, value: 0 },
            { kind: "read", address: DMC_SAMPLE_ADDRESS, value: 0xa5 },
        ],
    );
    assert.deepEqual(
        tail_cycles.filter(({ sequence_kind }) => sequence_kind === "instruction").map(({ access }) => access),
        [
            { kind: "read", address: 0x1200, value: 0 },
            { kind: "write", address: 0x0300, value: 0x0f },
        ],
    );
    assert.equal(apu.get_dmc_dma_request_address(), null);
    assert.deepEqual(apu.read_status(0), { value: 0, driven_mask: 0xdf });
    assert.equal(tail_cycles.at(-1)?.sequence_completed, true);
});

test("fetches wrapped DMC addresses from the full $8000-$FFFF PRG window", () => {
    const harness = make_harness([]);
    harness.apu.request_address = 0x8000;
    const cycles = [];
    let cycle = harness.bus.clock_cpu_dma_cycle(0x9000);

    while (cycle !== null) {
        cycles.push(cycle);

        if (cycle.sequence_completed) {
            break;
        }

        cycle = harness.bus.clock_cpu_dma_cycle(0x9000);
    }

    assert.equal(cycles.length, 4);
    assert.ok(cycles.every(({ dma_kind }) => dma_kind === "dmc"));
    assert.deepEqual(cycles.at(-1)?.access, { kind: "read", address: 0x8000, value: 0x5c });
    assert.deepEqual(harness.apu.completed_bytes, [0x5c]);
});

test("does not halt a CPU write; the pending DMC fetch starts on the following read", () => {
    const harness = make_harness([0x8d, 0x00, 0x60, 0xea]);
    const cpu = new Cpu2A03(harness.bus);
    cpu.program_counter = 0;

    for (let cycle = 0; cycle < 3; cycle += 1) {
        cpu.clock_cycle();
    }

    harness.apu.request_address = DMC_SAMPLE_ADDRESS;
    const write_cycle = cpu.clock_cycle();
    assert.equal(write_cycle.sequence_kind, "instruction");
    assert.equal(write_cycle.sequence_completed, true);
    assert.deepEqual(write_cycle.access, { kind: "write", address: 0x6000, value: 0 });
    assert.equal(harness.apu.completed_bytes.length, 0);

    const first_dma_cycle = cpu.clock_cycle();
    assert.equal(first_dma_cycle.sequence_kind, "dma");
    assert.deepEqual(first_dma_cycle.access, { kind: "read", address: 3, value: 0xea });
    assert.equal(first_dma_cycle.sequence_cycle, 1);
});

test("arbitrates DMC fetches during OAM DMA without losing source bytes", () => {
    const harness = make_harness([]);

    for (let index = 0; index < 0x100; index += 1) {
        harness.bus.write_cpu(SOURCE_PAGE_ADDRESS + index, (index * 13) & 0xff);
    }

    harness.bus.write_cpu(OAM_DMA_ADDRESS, SOURCE_PAGE);
    const first_oam_cycle = harness.bus.clock_cpu_dma_cycle(0x8000);
    assert.notEqual(first_oam_cycle, null);
    assert.equal(first_oam_cycle?.sequence_cycle, 1);

    harness.apu.request_address = DMC_SAMPLE_ADDRESS;
    const dma_cycles = first_oam_cycle === null ? [] : [first_oam_cycle];

    while (true) {
        const dma_cycle = harness.bus.clock_cpu_dma_cycle(0x8000);

        if (dma_cycle === null) {
            break;
        }

        dma_cycles.push(dma_cycle);

        if (dma_cycles.length > 520) {
            assert.fail("OAM and DMC DMA arbitration did not complete.");
        }
    }

    assert.equal(dma_cycles.length, 516);
    assert.equal(dma_cycles.filter(({ dma_kind }) => dma_kind === "dmc").length, 1);
    assert.equal(dma_cycles.filter(({ dma_kind }) => dma_kind === "oam").length, 515);
    assert.equal(harness.ppu_writes.length, 0x100);
    assert.deepEqual(harness.apu.completed_bytes, [0xa5]);
    assert.equal(dma_cycles.filter((dma_cycle) => dma_cycle.access.address === DMC_SAMPLE_ADDRESS).length, 1);

    for (let index = 0; index < 0x100; index += 1) {
        assert.deepEqual(harness.ppu_writes[index], {
            register_index: 4,
            value: (index * 13) & 0xff,
        });
    }

    assert.deepEqual(dma_cycles.at(-1)?.access, { kind: "write", address: OAM_DATA_ADDRESS, value: (0xff * 13) & 0xff });
});

function make_harness(program: readonly number[]): DmcDmaHarness {
    const cartridge_memory = new Map<number, number>([
        [DMC_SAMPLE_ADDRESS, 0xa5],
        [0x8000, 0x5c],
    ]);
    const completed_bytes: number[] = [];
    const controller_reads: number[] = [];
    const cartridge_reads: number[] = [];
    const cartridge_writes: Array<{ address: number; value: number }> = [];
    const ppu_writes: Array<{ register_index: number; value: number }> = [];
    const apu = {
        request_address: null as number | null,
        completed_bytes,
    };
    const bus = new NesCpuBus({
        ppu: {
            read_cpu_register: () => null,
            write_cpu_register(register_index, value) {
                ppu_writes.push({ register_index, value });
            },
        },
        apu: {
            read_status: () => null,
            write_register: () => {},
            get_dmc_dma_request_address: () => apu.request_address,
            complete_dmc_dma_read(value) {
                completed_bytes.push(value);
                apu.request_address = null;
            },
            is_irq_asserted: () => false,
        },
        controllers: {
            read_controller(_controller_index, _open_bus): CpuBusDeviceRead {
                controller_reads.push(1);
                return { value: 1, driven_mask: 1 };
            },
            write_strobe: () => {},
        },
        cartridge: {
            read_cpu(address) {
                cartridge_reads.push(address);
                return { value: cartridge_memory.get(address) ?? 0, driven_mask: 0xff };
            },
            write_cpu(address, value) {
                cartridge_writes.push({ address, value });
                cartridge_memory.set(address, value);
            },
        },
    });

    for (const [address, value] of program.entries()) {
        bus.write_cpu(address, value);
    }

    return { bus, apu, controller_reads, cartridge_reads, cartridge_writes, ppu_writes };
}
