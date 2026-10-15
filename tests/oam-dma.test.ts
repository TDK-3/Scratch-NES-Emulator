import assert from "node:assert/strict";
import test from "node:test";

import { Cpu2A03 } from "../src/nes/cpu/cpu_2a03.js";
import { CpuTraceBus, CpuStepTraceRecorder, format_cpu_step_trace } from "../src/nes/cpu/cpu_trace.js";
import { NesCpuBus } from "../src/nes/cpu/nes_cpu_bus.js";

const OAM_DMA_ADDRESS = 0x4014;
const OAM_DATA_ADDRESS = 0x2004;
const SOURCE_PAGE = 0x02;
const SOURCE_PAGE_ADDRESS = SOURCE_PAGE << 8;
const OAM_BYTES = 0x100;
type OamDmaCycle = NonNullable<ReturnType<NesCpuBus["clock_oam_dma_cycle"]>>;

test("aligns OAM DMA to even-cycle source reads for 513- and 514-cycle transfers", () => {
    const odd_write = make_dma_harness();
    odd_write.bus.write_cpu(OAM_DMA_ADDRESS, SOURCE_PAGE);
    const odd_cycles = run_dma(odd_write.bus, 0x8000);

    assert.equal(odd_cycles.length, 514);
    assert.deepEqual(odd_cycles.slice(0, 2).map((cycle) => cycle.access), [
        { kind: "read", address: 0x8000, value: SOURCE_PAGE },
        { kind: "read", address: 0x8000, value: SOURCE_PAGE },
    ]);
    assert.deepEqual(odd_cycles[2]?.access, {
        kind: "read",
        address: SOURCE_PAGE_ADDRESS,
        value: 0,
    });

    const even_write = make_dma_harness();
    even_write.bus.read_cpu(0x4018);
    even_write.bus.write_cpu(OAM_DMA_ADDRESS, SOURCE_PAGE);
    const even_cycles = run_dma(even_write.bus, 0x8000);

    assert.equal(even_cycles.length, 513);
    assert.deepEqual(even_cycles[0]?.access, {
        kind: "read",
        address: 0x8000,
        value: SOURCE_PAGE,
    });
    assert.deepEqual(even_cycles[1]?.access, {
        kind: "read",
        address: SOURCE_PAGE_ADDRESS,
        value: 0,
    });
    assert.equal(odd_cycles.at(-1)?.sequence_cycle, 514);
    assert.equal(even_cycles.at(-1)?.sequence_cycle, 513);
});

test("copies 256 source bytes to OAM in ordered alternating read/write cycles", () => {
    const { bus, ppu_writes } = make_dma_harness();
    const source_bytes = Array.from({ length: OAM_BYTES }, (_, index) => (index * 37) & 0xff);

    for (const [index, value] of source_bytes.entries()) {
        bus.write_cpu(SOURCE_PAGE_ADDRESS + index, value);
    }

    bus.write_cpu(OAM_DMA_ADDRESS, SOURCE_PAGE);
    const cycles = run_dma(bus, 0x8000);

    assert.equal(cycles.length, 514);
    assert.equal(ppu_writes.length, OAM_BYTES);

    for (let index = 0; index < OAM_BYTES; index += 1) {
        const source_read = cycles[2 + index * 2];
        const oam_write = cycles[3 + index * 2];
        const value = source_bytes[index];

        assert.deepEqual(source_read?.access, {
            kind: "read",
            address: SOURCE_PAGE_ADDRESS + index,
            value,
        });
        assert.deepEqual(oam_write?.access, {
            kind: "write",
            address: OAM_DATA_ADDRESS,
            value,
        });
        assert.deepEqual(ppu_writes[index], { register_index: 4, value });
    }
});

test("CPU clock cycles stall on the held read address and resume after DMA", () => {
    const { bus, ppu_writes } = make_dma_harness();
    load_program(bus, [0x8d, 0x14, 0x40, 0xa9, 0x42]);
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0;
    cpu.a = SOURCE_PAGE;

    assert.equal(cpu.step(), 4);
    assert.equal(cpu.program_counter, 3);
    assert.equal(ppu_writes.length, 0);

    let dma_cycle = cpu.clock_cycle();
    let dma_cycles = 0;

    while (true) {
        dma_cycles += 1;
        assert.equal(dma_cycle.sequence_kind, "dma");
        assert.equal(dma_cycle.sequence_cycle, dma_cycles);
        assert.equal(cpu.program_counter, 3);

        if (dma_cycles === 1) {
            assert.deepEqual(dma_cycle.access, { kind: "read", address: 3, value: 0xa9 });
        }

        if (dma_cycle.sequence_completed) {
            break;
        }

        dma_cycle = cpu.clock_cycle();
    }

    assert.equal(dma_cycles, 514);
    assert.equal(ppu_writes.length, OAM_BYTES);
    assert.equal(cpu.program_counter, 3);

    const opcode_cycle = cpu.clock_cycle();
    assert.equal(opcode_cycle.sequence_kind, "instruction");
    assert.deepEqual(opcode_cycle.access, { kind: "read", address: 3, value: 0xa9 });
    assert.equal(opcode_cycle.sequence_completed, false);

    const operand_cycle = cpu.clock_cycle();
    assert.equal(operand_cycle.sequence_kind, "instruction");
    assert.deepEqual(operand_cycle.access, { kind: "read", address: 4, value: 0x42 });
    assert.equal(operand_cycle.sequence_completed, true);
    assert.equal(cpu.a, 0x42);
});

test("defers a pending NMI until the OAM DMA stall finishes", () => {
    const { bus } = make_dma_harness();
    load_program(bus, [0x8d, 0x14, 0x40, 0xea]);
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0;
    cpu.a = SOURCE_PAGE;

    assert.equal(cpu.step(), 4);
    cpu.request_nmi();

    let cycle = cpu.clock_cycle();
    let dma_cycles = 0;

    while (cycle.sequence_kind === "dma") {
        dma_cycles += 1;

        if (cycle.sequence_completed) {
            break;
        }

        cycle = cpu.clock_cycle();
    }

    assert.equal(dma_cycles, 513);

    const nmi_cycle = cpu.clock_cycle();
    assert.equal(nmi_cycle.sequence_kind, "nmi");
    assert.equal(nmi_cycle.sequence_cycle, 1);
    assert.deepEqual(nmi_cycle.access, { kind: "read", address: 3, value: 0xea });
});

test("step and instruction traces include a preceding DMA without confusing its dummy read for an opcode", () => {
    const { bus, ppu_writes } = make_dma_harness();
    load_program(bus, [0x8d, 0x14, 0x40, 0xea]);
    const trace_bus = new CpuTraceBus(bus);
    const cpu = new Cpu2A03(trace_bus);
    cpu.program_counter = 0;
    cpu.a = SOURCE_PAGE;
    const recorder = new CpuStepTraceRecorder(cpu, trace_bus);

    const store_trace = recorder.step();
    assert.equal(store_trace.cycles, 4);
    assert.equal(store_trace.kind, "instruction");

    const nop_trace = recorder.step();

    assert.equal(nop_trace.kind, "instruction");
    assert.equal(nop_trace.instruction.mnemonic, "NOP");
    assert.equal(nop_trace.cycles, 515);
    assert.equal(nop_trace.bus_accesses.length, 2);
    assert.equal(nop_trace.dma_accesses?.length, 513);
    assert.equal(ppu_writes.length, OAM_BYTES);
    assert.match(format_cpu_step_trace(nop_trace), /DMA \(513 cycles\)/);
});

function run_dma(bus: NesCpuBus, held_read_address: number): OamDmaCycle[] {
    const cycles: OamDmaCycle[] = [];

    while (true) {
        const cycle = bus.clock_oam_dma_cycle(held_read_address);

        if (cycle === null) {
            assert.fail("Expected an active OAM DMA transfer.");
        }

        cycles.push(cycle);

        if (cycle.sequence_completed) {
            return cycles;
        }

        if (cycles.length > 514) {
            assert.fail("OAM DMA did not finish within 514 CPU cycles.");
        }
    }
}

function load_program(bus: NesCpuBus, bytes: readonly number[]): void {
    for (const [address, value] of bytes.entries()) {
        bus.write_cpu(address, value);
    }
}

interface DmaHarness {
    readonly bus: NesCpuBus;
    readonly ppu_writes: Array<{ readonly register_index: number; readonly value: number }>;
}

function make_dma_harness(): DmaHarness {
    const ppu_writes: Array<{ register_index: number; value: number }> = [];
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
        },
        controllers: {
            read_controller: () => null,
            write_strobe: () => {},
        },
        cartridge: {
            read_cpu: () => null,
            write_cpu: () => {},
        },
    });

    return { bus, ppu_writes };
}
