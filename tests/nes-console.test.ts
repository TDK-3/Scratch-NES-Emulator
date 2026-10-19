import assert from "node:assert/strict";
import test from "node:test";

import { NesConsole } from "../src/nes/core/nes_console.js";
import { NesConsoleTraceRecorder } from "../src/nes/core/console_trace.js";
import { NesBrowserKeyboardInput } from "../src/nes/browser/keyboard_input.js";

const PRG_ROM_BYTES = 0x4000;
const CHR_ROM_BYTES = 0x2000;
const RESET_VECTOR_OFFSET = PRG_ROM_BYTES - 4;
const NMI_VECTOR_OFFSET = PRG_ROM_BYTES - 6;
const IRQ_VECTOR_OFFSET = PRG_ROM_BYTES - 2;

const CONTROLLER_READ_PROGRAM = new Uint8Array([
    0xa9, 0x01,             // LDA #$01
    0x8d, 0x16, 0x40,       // STA $4016 (strobe high)
    0xa9, 0x00,             // LDA #$00
    0x8d, 0x16, 0x40,       // STA $4016 (falling edge latches)
    0xad, 0x16, 0x40,       // LDA $4016 (read A)
    0x4c, 0x0d, 0x80,       // JMP $800D
]);

const APU_OUTPUT_PROGRAM = new Uint8Array([
    0xa9, 0x40,             // LDA #$40
    0x8d, 0x11, 0x40,       // STA $4011 (set DMC DAC)
    0x4c, 0x05, 0x80,       // JMP $8005
]);

const NMI_ENABLE_PROGRAM = new Uint8Array([
    0xa9, 0x80,             // LDA #$80
    0x8d, 0x00, 0x20,       // STA $2000 (enable vblank NMI)
    0x4c, 0x05, 0x80,       // JMP $8005
]);

const IRQ_ENABLE_PROGRAM = new Uint8Array([
    0x58,                   // CLI
    0x4c, 0x01, 0x80,       // JMP $8001
]);

const MMC3_IRQ_SETUP_PROGRAM = new Uint8Array([
    0xa9, 0x00,             // LDA #$00
    0x8d, 0x00, 0xc0,       // STA $C000 (IRQ latch = 0)
    0x8d, 0x01, 0xc0,       // STA $C001 (reload counter)
    0x8d, 0x01, 0xe0,       // STA $E001 (enable mapper IRQ)
    0x58,                   // CLI
    0xa9, 0x10,             // LDA #$10 (background pattern table $1000)
    0x8d, 0x00, 0x20,       // STA $2000
    0xa9, 0x08,             // LDA #$08 (enable background rendering)
    0x8d, 0x01, 0x20,       // STA $2001
    0x4c, 0x16, 0x80,       // JMP $8016
]);

const LOOP_PROGRAM = new Uint8Array([0x4c, 0x00, 0x80]); // JMP $8000

test("returns structured parser and unsupported-mapper failures", () => {
    const invalid_rom = NesConsole.create(new Uint8Array(0));
    assert.equal(invalid_rom.ok, false);

    if (!invalid_rom.ok) {
        assert.equal(invalid_rom.error.stage, "rom");
        assert.equal(invalid_rom.error.detail.code, "truncated-header");
    }

    const unsupported_mapper = NesConsole.create(make_nrom_rom(LOOP_PROGRAM, 1));
    assert.equal(unsupported_mapper.ok, false);

    if (!unsupported_mapper.ok) {
        assert.equal(unsupported_mapper.error.stage, "mapper");
        assert.equal(unsupported_mapper.error.detail.code, "unsupported-mapper");
    }
});

test("composes the implemented MMC3 mapper route with the same NTSC CPU/PPU/APU scheduler", () => {
    const result = NesConsole.create(make_mmc3_rom(LOOP_PROGRAM));

    if (!result.ok) {
        throw new Error(`Failed to create an MMC3 console: ${result.error.stage}.`);
    }

    assert.deepEqual(result.value.get_rom_metadata(), {
        format: "ines-1.0",
        mapper_id: 4,
        submapper: 0,
        mirroring: "vertical",
    });
    assert.deepEqual(result.value.step(), { cpu_cycles: 7, sequence_kind: "reset" });
    assert.deepEqual(result.value.step(), { cpu_cycles: 3, sequence_kind: "instruction" });
    assert.equal(result.value.get_cpu_state().program_counter, 0x8000);
});

test("console configuration passes the XAA/LXA magic approximation to its CPU", () => {
    const program = new Uint8Array([0xa9, 0x12, 0xa2, 0xff, 0x8b, 0xff]);
    const result = NesConsole.create(make_nrom_rom(program), { unstable_opcode_magic_value: 0x00 });

    if (!result.ok) {
        throw new Error(`Failed to create a console: ${result.error.stage}.`);
    }

    assert.equal(result.value.step().sequence_kind, "reset");
    result.value.step();
    result.value.step();
    result.value.step();

    const cpu_state = result.value.get_cpu_state();
    assert.equal(cpu_state.a, 0x12);
    assert.equal(cpu_state.x, 0xff);
});

test("KIL keeps CPU bus cycles running while the console PPU advances until reset", () => {
    const console = create_console(new Uint8Array([0x02]));

    assert.equal(console.step().sequence_kind, "reset");
    assert.deepEqual(console.step(), { cpu_cycles: 2, sequence_kind: "instruction" });
    assert.equal(console.get_cpu_state().program_counter, 0x8001);

    const starting_frame = console.get_frame_number();
    const frame = console.advance_frame();

    assert.ok(frame.cpu_cycles_elapsed > 0);
    assert.ok(frame.frame_number > starting_frame);
    assert.equal(console.get_cpu_state().program_counter, 0x8001);

    console.reset();
    assert.deepEqual(console.step(), { cpu_cycles: 7, sequence_kind: "reset" });
    assert.deepEqual(console.step(), { cpu_cycles: 2, sequence_kind: "instruction" });
});

test("composes NROM devices and advances only on explicit cycle/frame calls", () => {
    const console = create_console(LOOP_PROGRAM);
    assert.equal(console.is_paused(), true);
    assert.equal(console.get_cpu_cycle_count(), 0);
    assert.equal(console.get_master_clock_ticks(), 0);
    assert.equal(console.clock_cpu_cycle(), null);

    const first_cycle = console.step_cpu_cycle();
    assert.equal(first_cycle.sequence_kind, "reset");
    assert.equal(first_cycle.sequence_cycle, 1);
    assert.equal(console.get_cpu_cycle_count(), 1);
    assert.equal(console.get_master_clock_ticks(), 12);
    assert.equal(console.get_ppu_dot_count(), 3);
    assert.deepEqual(console.get_ppu_position(), { scanline: 261, dot: 3 });

    console.resume();
    assert.notEqual(console.clock_cpu_cycle(), null);
    assert.equal(console.get_cpu_cycle_count(), 2);
    console.pause();
    assert.equal(console.clock_cpu_cycle(), null);
    assert.equal(console.get_cpu_cycle_count(), 2);

    const reset_step = console.step();
    assert.equal(reset_step.sequence_kind, "reset");
    assert.equal(reset_step.cpu_cycles, 5);
    assert.equal(console.get_cpu_state().program_counter, 0x8000);

    const loop_step = console.step();
    assert.equal(loop_step.sequence_kind, "instruction");
    assert.equal(loop_step.cpu_cycles, 3);
    assert.equal(console.get_cpu_state().program_counter, 0x8000);
});

test("routes runtime button state through a real ROM controller read", () => {
    const console = create_console(CONTROLLER_READ_PROGRAM);
    console.set_button_state(0, "a", true);

    assert.equal(console.step().sequence_kind, "reset");
    for (let instruction = 0; instruction < 5; instruction += 1) {
        assert.equal(console.step().sequence_kind, "instruction");
    }

    assert.equal(console.get_cpu_state().a & 0x01, 1);
});

test("routes a browser keyboard event through the live console pad serial read", () => {
    const console = create_console(CONTROLLER_READ_PROGRAM);
    let prevented_events = 0;
    const keyboard = new NesBrowserKeyboardInput((controller_index, button, pressed) => {
        console.set_button_state(controller_index, button, pressed);
    });

    keyboard.key_down("Z", false, () => {
        prevented_events += 1;
    });

    assert.equal(console.step().sequence_kind, "reset");
    for (let instruction = 0; instruction < 5; instruction += 1) {
        assert.equal(console.step().sequence_kind, "instruction");
    }

    assert.equal(console.get_cpu_state().a & 0x01, 1);
    assert.equal(prevented_events, 1);
    keyboard.release_all();
});

test("delivers a PPU vblank NMI edge to the CPU at the next instruction boundary", () => {
    const console = create_console(NMI_ENABLE_PROGRAM);
    assert.equal(console.step().sequence_kind, "reset");
    assert.equal(console.step().sequence_kind, "instruction");
    assert.equal(console.step().sequence_kind, "instruction");

    let nmi_cycle_seen = false;
    for (let cycle = 0; cycle < 30_000; cycle += 1) {
        const result = console.step_cpu_cycle();

        if (result.sequence_kind === "nmi") {
            nmi_cycle_seen = true;
            break;
        }
    }

    assert.equal(nmi_cycle_seen, true);
});

test("delivers the APU frame IRQ level to the CPU after CLI", () => {
    const console = create_console(IRQ_ENABLE_PROGRAM);
    assert.equal(console.step().sequence_kind, "reset");
    assert.equal(console.step().sequence_kind, "instruction");
    assert.equal(console.step().sequence_kind, "instruction");

    let irq_cycle_seen = false;
    for (let cycle = 0; cycle < 30_000; cycle += 1) {
        const result = console.step_cpu_cycle();

        if (result.sequence_kind === "irq") {
            irq_cycle_seen = true;
            break;
        }
    }

    assert.equal(irq_cycle_seen, true);
});

test("delivers an MMC3 A12 IRQ through the NTSC PPU clock into the CPU interrupt sequence", () => {
    const program = new Uint8Array(0x101);
    program.fill(0xea);
    program.set(MMC3_IRQ_SETUP_PROGRAM);
    program[0x100] = 0x40; // RTI at CPU address $8100

    const result = NesConsole.create(make_mmc3_rom(program, 0x8100));

    if (!result.ok) {
        throw new Error(`Failed to create an MMC3 IRQ console: ${result.error.stage}.`);
    }

    const console = result.value;
    assert.equal(console.step().sequence_kind, "reset");

    for (let instruction = 0; instruction < 9; instruction += 1) {
        assert.equal(console.step().sequence_kind, "instruction");
    }

    let irq_cycles = 0;
    let irq_entry_completed = false;

    for (let cycle = 0; cycle < 30_000 && !irq_entry_completed; cycle += 1) {
        const result = console.step_cpu_cycle();

        if (result.sequence_kind === "irq") {
            irq_cycles += 1;
            irq_entry_completed = result.sequence_completed;
        }
    }

    assert.equal(irq_cycles, 7);
    assert.equal(irq_entry_completed, true);
    assert.equal(console.get_cpu_state().program_counter, 0x8100);
});

test("records bounded console, CPU/APU/PPU order, and frame boundaries when tracing is enabled", () => {
    const trace = new NesConsoleTraceRecorder(128);
    const result = NesConsole.create(make_nrom_rom(LOOP_PROGRAM), { trace_sink: trace.record_trace });

    if (!result.ok) {
        throw new Error(`Failed to create a traced NROM console: ${result.error.stage}.`);
    }

    const console = result.value;
    assert.equal(console.step_cpu_cycle().sequence_kind, "reset");

    const coincident_edge_events = trace.get_events().filter((event) => event.master_clock_tick === 12);
    assert.deepEqual(coincident_edge_events.map((event) => event.kind), [
        "interrupt_lines",
        "cpu_cycle",
        "apu_cycle",
        "ppu_dot",
    ]);

    const frame = console.advance_frame();
    const frame_boundaries = trace.get_events().filter((event) => event.kind === "frame_boundary");
    assert.equal(frame_boundaries.length, 1);

    const frame_boundary = frame_boundaries[0];

    if (frame_boundary === undefined) {
        throw new Error("The console trace did not record its frame boundary.");
    }

    assert.equal(frame_boundary.frame_number, frame.frame_number);
    assert.ok(frame_boundary.master_clock_tick <= console.get_master_clock_ticks());
    assert.ok(trace.get_dropped_event_count() > 0);

    trace.clear();
    assert.deepEqual(trace.get_events(), []);
    assert.equal(trace.get_dropped_event_count(), 0);
});

test("exports and restores battery-backed PRG RAM through the console API", () => {
    const program = Uint8Array.of(
        0xa9, 0x5a,
        0x8d, 0x00, 0x60,
        0xa9, 0xa5,
        0x8d, 0xff, 0x7f,
        0x4c, 0x0a, 0x80,
    );
    const rom_bytes = make_nrom_rom(program, 0, true);
    const console = create_console_from_rom(rom_bytes);

    assert.equal(console.step().sequence_kind, "reset");
    for (let instruction = 0; instruction < 4; instruction += 1) {
        assert.equal(console.step().sequence_kind, "instruction");
    }

    const snapshot = console.get_battery_ram_snapshot();
    assert.equal(snapshot.prg_nvram.byteLength, 0x2000);
    assert.equal(snapshot.prg_nvram[0], 0x5a);
    assert.equal(snapshot.prg_nvram[0x1fff], 0xa5);
    assert.equal(snapshot.chr_nvram.byteLength, 0);

    const restored_console = create_console_from_rom(rom_bytes);
    restored_console.load_battery_ram_snapshot(snapshot);
    assert.deepEqual(restored_console.get_battery_ram_snapshot(), snapshot);
    assert.throws(
        () => restored_console.load_battery_ram_snapshot({
            prg_nvram: new Uint8Array(1),
            chr_nvram: new Uint8Array(0),
        }),
        RangeError,
    );
});

test("exports and atomically restores NES 2.0 PRG and CHR NVRAM through the console API", () => {
    const rom_bytes = make_nes2_chr_nvram_rom();
    const console = create_console_from_rom(rom_bytes);
    const initial_snapshot = console.get_battery_ram_snapshot();
    assert.equal(initial_snapshot.prg_nvram.byteLength, 0x2000);
    assert.equal(initial_snapshot.chr_nvram.byteLength, 0x2000);

    const restored = {
        prg_nvram: new Uint8Array(0x2000),
        chr_nvram: new Uint8Array(0x2000),
    };
    restored.prg_nvram[0] = 0x3c;
    restored.chr_nvram[0] = 0x5a;
    console.load_battery_ram_snapshot(restored);
    restored.prg_nvram[0] = 0xff;
    restored.chr_nvram[0] = 0xff;

    const snapshot = console.get_battery_ram_snapshot();
    assert.equal(snapshot.prg_nvram[0], 0x3c);
    assert.equal(snapshot.chr_nvram[0], 0x5a);

    const attempted_prg_restore = new Uint8Array(0x2000);
    attempted_prg_restore[0] = 0xa5;
    assert.throws(
        () => console.load_battery_ram_snapshot({
            prg_nvram: attempted_prg_restore,
            chr_nvram: new Uint8Array(1),
        }),
        RangeError,
    );
    assert.deepEqual(console.get_battery_ram_snapshot(), snapshot);

    const attempted_chr_restore = new Uint8Array(0x2000);
    attempted_chr_restore[0] = 0x66;
    assert.throws(
        () => console.load_battery_ram_snapshot({
            prg_nvram: new Uint8Array(1),
            chr_nvram: attempted_chr_restore,
        }),
        RangeError,
    );
    assert.deepEqual(console.get_battery_ram_snapshot(), snapshot);
});

test("advances one bounded NTSC frame and returns framebuffer and sampled audio", () => {
    const console = create_console(APU_OUTPUT_PROGRAM);
    const frame = console.advance_frame();

    assert.equal(frame.frame_number, 1);
    assert.ok(frame.cpu_cycles_elapsed >= 29_780 && frame.cpu_cycles_elapsed <= 29_782);
    assert.equal(frame.master_clock_ticks_elapsed, frame.cpu_cycles_elapsed * 12);
    assert.equal(console.get_master_clock_ticks(), frame.master_clock_ticks_elapsed);
    assert.equal(console.get_cpu_cycle_count(), frame.cpu_cycles_elapsed);
    assert.equal(console.get_ppu_dot_count(), frame.cpu_cycles_elapsed * 3);
    assert.deepEqual(console.get_ppu_position(), { scanline: 261, dot: 1 });
    assert.equal(frame.framebuffer.length, 256 * 240);
    assert.equal(frame.emphasis.length, 256 * 240);
    assert.ok(frame.audio_samples.length >= 700 && frame.audio_samples.length <= 800);
    assert.ok(frame.audio_samples.some((sample) => sample > 0));
    assert.ok(frame.audio_samples.every(Number.isFinite));
    assert.equal(console.is_paused(), true);

    console.reset();
    assert.equal(console.get_frame_number(), 0);
    assert.equal(console.get_cpu_cycle_count(), 0);
    assert.equal(console.get_ppu_dot_count(), 0);
    assert.equal(console.get_master_clock_ticks(), 0);
    assert.deepEqual(console.get_ppu_position(), { scanline: 261, dot: 0 });
    assert.equal(console.drain_audio_samples().length, 0);
    assert.equal(console.step().sequence_kind, "reset");
});

function create_console(program: Uint8Array): NesConsole {
    return create_console_from_rom(make_nrom_rom(program));
}

function create_console_from_rom(rom_bytes: Uint8Array): NesConsole {
    const result = NesConsole.create(rom_bytes);

    if (!result.ok) {
        throw new Error(`Failed to create a synthetic console: ${result.error.stage}.`);
    }

    return result.value;
}

function make_nrom_rom(program: Uint8Array, mapper_id = 0, battery_backed = false): Uint8Array {
    const header = new Uint8Array(16);
    const battery_flag = battery_backed ? 0x02 : 0;
    header.set([
        0x4e,
        0x45,
        0x53,
        0x1a,
        1,
        1,
        ((mapper_id & 0x0f) << 4) | battery_flag,
        mapper_id & 0xf0,
    ]);

    const prg_rom = new Uint8Array(PRG_ROM_BYTES);
    prg_rom.fill(0xea);
    prg_rom.set(program);
    write_vector(prg_rom, NMI_VECTOR_OFFSET);
    write_vector(prg_rom, RESET_VECTOR_OFFSET);
    write_vector(prg_rom, IRQ_VECTOR_OFFSET);

    const rom = new Uint8Array(header.byteLength + prg_rom.byteLength + CHR_ROM_BYTES);
    rom.set(header);
    rom.set(prg_rom, header.byteLength);

    return rom;
}

function make_nes2_chr_nvram_rom(): Uint8Array {
    const header = new Uint8Array(16);
    header.set([0x4e, 0x45, 0x53, 0x1a, 1, 0, 0x02, 0x08]);
    header[10] = 0x70;
    header[11] = 0x70;

    const prg_rom = new Uint8Array(PRG_ROM_BYTES);
    prg_rom.fill(0xea);
    write_vector(prg_rom, NMI_VECTOR_OFFSET);
    write_vector(prg_rom, RESET_VECTOR_OFFSET);
    write_vector(prg_rom, IRQ_VECTOR_OFFSET);

    const rom_bytes = new Uint8Array(header.byteLength + prg_rom.byteLength);
    rom_bytes.set(header);
    rom_bytes.set(prg_rom, header.byteLength);
    return rom_bytes;
}

function make_mmc3_rom(program: Uint8Array, irq_vector_address = 0x8000): Uint8Array {
    const prg_rom_bytes = 0x8000;
    const header = new Uint8Array(16);
    header.set([0x4e, 0x45, 0x53, 0x1a, 2, 1, 0x41, 0]);

    const prg_rom = new Uint8Array(prg_rom_bytes);
    prg_rom.fill(0xea);
    prg_rom.set(program);
    write_vector(prg_rom, prg_rom_bytes - 6);
    write_vector(prg_rom, prg_rom_bytes - 4);
    write_vector(prg_rom, prg_rom_bytes - 2, irq_vector_address);

    const rom = new Uint8Array(header.byteLength + prg_rom.byteLength + CHR_ROM_BYTES);
    rom.set(header);
    rom.set(prg_rom, header.byteLength);

    return rom;
}

function write_vector(prg_rom: Uint8Array, offset: number, address = 0x8000): void {
    prg_rom[offset] = address & 0xff;
    prg_rom[offset + 1] = address >>> 8;
}
