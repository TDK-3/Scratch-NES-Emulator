import { Apu2A03 } from "../apu/apu_2a03.js";
import { parse_ines_rom } from "../cartridge/ines.js";
import type { InesRom, RomParseError } from "../cartridge/ines.js";
import { NromMapper } from "../cartridge/mapper_000.js";
import type { NromMapperCreationError } from "../cartridge/mapper_000.js";
import { Mmc3Mapper } from "../cartridge/mapper_004.js";
import type { Mmc3MapperCreationError } from "../cartridge/mapper_004.js";
import { resolve_mapper } from "../cartridge/mapper.js";
import type { MapperSelectionError } from "../cartridge/mapper.js";
import { Cpu2A03 } from "../cpu/cpu_2a03.js";
import type { CpuCycleResult, CpuCycleSequenceKind } from "../cpu/cpu_2a03.js";
import { NesCpuBus } from "../cpu/nes_cpu_bus.js";
import { NesControllerPorts } from "../input/controller.js";
import type { ControllerButton, ControllerIndex } from "../input/controller.js";
import { Ppu2C02 } from "../ppu/ppu_2c02.js";
import { PpuMemoryBus } from "../ppu/ppu_bus.js";
import type { NesConsoleTraceEvent, NesConsoleTraceSink } from "./console_trace.js";
import { NtscClock, NTSC_MASTER_TICKS_PER_CPU_CYCLE } from "./ntsc_clock.js";

const MAX_CPU_CYCLES_PER_FRAME = 30_000;
const MAX_CPU_CYCLES_PER_STEP = 1_024;

export type NesConsoleCreationError =
    | { readonly stage: "rom"; readonly detail: RomParseError }
    | {
          readonly stage: "mapper";
          readonly detail: MapperSelectionError | NromMapperCreationError | Mmc3MapperCreationError;
      };

export type NesConsoleCreationResult =
    | { readonly ok: true; readonly value: NesConsole }
    | { readonly ok: false; readonly error: NesConsoleCreationError };

export interface NesConsoleOptions {
    /** Optional deterministic CPU/APU/PPU/interrupt observer; omitted tracing has no event-allocation cost. */
    readonly trace_sink?: NesConsoleTraceSink;
    /** Deterministic approximation for XAA/LXA's chip-dependent magic input; defaults to `$EE`. */
    readonly unstable_opcode_magic_value?: number;
}

export interface NesConsoleStepResult {
    readonly cpu_cycles: number;
    readonly sequence_kind: Exclude<CpuCycleSequenceKind, "dma">;
}

export interface NesConsoleFrame {
    readonly frame_number: number;
    readonly cpu_cycles_elapsed: number;
    readonly master_clock_ticks_elapsed: number;
    readonly framebuffer: Uint8Array;
    readonly emphasis: Uint8Array;
    /** Samples generated since the previous drain, not necessarily only during this frame. */
    readonly audio_samples: Float32Array;
}

export interface NesConsoleBatteryRamSnapshot {
    readonly prg_nvram: Uint8Array;
    readonly chr_nvram: Uint8Array;
}

type ConsoleMapper = NromMapper | Mmc3Mapper;

interface NesConsoleComponents {
    readonly rom: InesRom;
    readonly mapper: ConsoleMapper;
    readonly ppu: Ppu2C02;
    readonly apu: Apu2A03;
    readonly controllers: NesControllerPorts;
    readonly cpu_bus: NesCpuBus;
    readonly cpu: Cpu2A03;
    readonly clock: NtscClock;
    readonly trace_sink: NesConsoleTraceSink | null;
}

/** Deterministic NTSC console composition with explicit stepping and bounded frame advancement. */
export class NesConsole {
    readonly #rom: InesRom;
    readonly #mapper: ConsoleMapper;
    readonly #ppu: Ppu2C02;
    readonly #apu: Apu2A03;
    readonly #controllers: NesControllerPorts;
    readonly #cpu_bus: NesCpuBus;
    readonly #cpu: Cpu2A03;
    readonly #clock: NtscClock;
    readonly #trace_sink: NesConsoleTraceSink | null;
    #paused = true;

    private constructor(components: NesConsoleComponents) {
        this.#rom = components.rom;
        this.#mapper = components.mapper;
        this.#ppu = components.ppu;
        this.#apu = components.apu;
        this.#controllers = components.controllers;
        this.#cpu_bus = components.cpu_bus;
        this.#cpu = components.cpu;
        this.#clock = components.clock;
        this.#trace_sink = components.trace_sink;
        this.reset();
    }

    /** Parses and composes one supported cartridge without throwing expected ROM/mapper errors. */
    static create(rom_bytes: Uint8Array, options: NesConsoleOptions = {}): NesConsoleCreationResult {
        const parsed = parse_ines_rom(rom_bytes);

        if (!parsed.ok) {
            return { ok: false, error: { stage: "rom", detail: parsed.error } };
        }

        const route = resolve_mapper(parsed.value);

        if (!route.ok) {
            return { ok: false, error: { stage: "mapper", detail: route.error } };
        }

        const mapper_result = route.value.kind === "nrom"
            ? NromMapper.create(parsed.value)
            : Mmc3Mapper.create(parsed.value);

        if (!mapper_result.ok) {
            return { ok: false, error: { stage: "mapper", detail: mapper_result.error } };
        }

        const mapper = mapper_result.value;
        const ppu = new Ppu2C02(new PpuMemoryBus(mapper));
        const apu = new Apu2A03();
        const controllers = new NesControllerPorts();
        const cpu_bus = new NesCpuBus({ ppu, apu, controllers, cartridge: mapper });
        const cpu = new Cpu2A03(
            cpu_bus,
            options.unstable_opcode_magic_value === undefined
                ? {}
                : { unstable_opcode_magic_value: options.unstable_opcode_magic_value },
        );

        return {
            ok: true,
            value: new NesConsole({
                rom: parsed.value,
                mapper,
                ppu,
                apu,
                controllers,
                cpu_bus,
                cpu,
                clock: new NtscClock(),
                trace_sink: options.trace_sink ?? null,
            }),
        };
    }

    /** Requests the seven-cycle CPU reset and resets device control state while preserving RAM contents. */
    reset(): void {
        this.#clock.reset();
        this.#cpu_bus.reset();
        this.#mapper_reset();
        this.#ppu.reset();
        this.#apu.reset();
        this.#controllers.reset();
        this.#cpu.request_reset();
    }

    pause(): void {
        this.#paused = true;
    }

    resume(): void {
        this.#paused = false;
    }

    is_paused(): boolean {
        return this.#paused;
    }

    /** Clocks one CPU cycle only while resumed; a paused console returns null without changing state. */
    clock_cpu_cycle(): CpuCycleResult | null {
        return this.#paused ? null : this.#clock_one_cpu_cycle();
    }

    /** Advances one CPU cycle regardless of pause state, for deterministic debugging and tests. */
    step_cpu_cycle(): CpuCycleResult {
        return this.#clock_one_cpu_cycle();
    }

    /** Runs through a reset/instruction/interrupt/jam sequence and any preceding DMA stalls. */
    step(): NesConsoleStepResult {
        let cpu_cycles = 0;
        let cycle_result: CpuCycleResult;

        do {
            if (cpu_cycles >= MAX_CPU_CYCLES_PER_STEP) {
                throw new Error(`CPU step exceeded its ${MAX_CPU_CYCLES_PER_STEP}-cycle safety limit.`);
            }

            cycle_result = this.#clock_one_cpu_cycle();
            cpu_cycles += 1;
        } while (cycle_result.sequence_kind === "dma" || !cycle_result.sequence_completed);

        return { cpu_cycles, sequence_kind: cycle_result.sequence_kind };
    }

    /** Advances exactly one PPU frame, even while paused, with a hard CPU-cycle limit against stalled cores. */
    advance_frame(): NesConsoleFrame {
        const start_frame_number = this.#ppu.get_frame_number();
        const start_cpu_cycle = this.#clock.get_cpu_cycle_count();
        const start_master_tick = this.#clock.get_master_clock_ticks();
        let cpu_cycles_elapsed = 0;

        while (this.#ppu.get_frame_number() === start_frame_number && cpu_cycles_elapsed < MAX_CPU_CYCLES_PER_FRAME) {
            this.#clock_one_cpu_cycle();
            cpu_cycles_elapsed += 1;
        }

        const frame_number = this.#ppu.get_frame_number();

        if (frame_number === start_frame_number) {
            throw new Error(`PPU frame did not advance within ${MAX_CPU_CYCLES_PER_FRAME} CPU cycles.`);
        }

        if (this.#clock.get_cpu_cycle_count() - start_cpu_cycle !== cpu_cycles_elapsed) {
            throw new Error("NTSC scheduler CPU-cycle accounting diverged during frame advancement.");
        }

        return {
            frame_number,
            cpu_cycles_elapsed,
            master_clock_ticks_elapsed: this.#clock.get_master_clock_ticks() - start_master_tick,
            framebuffer: this.#ppu.get_framebuffer(),
            emphasis: this.#ppu.get_framebuffer_emphasis(),
            audio_samples: this.#apu.drain_audio_samples(),
        };
    }

    set_button_state(controller_index: ControllerIndex, button: ControllerButton, pressed: boolean): void {
        this.#controllers.set_button_state(controller_index, button, pressed);
    }

    set_button_mask(controller_index: ControllerIndex, button_mask: number): void {
        this.#controllers.set_button_mask(controller_index, button_mask);
    }

    drain_audio_samples(): Float32Array {
        return this.#apu.drain_audio_samples();
    }

    get_framebuffer(): Uint8Array {
        return this.#ppu.get_framebuffer();
    }

    get_framebuffer_emphasis(): Uint8Array {
        return this.#ppu.get_framebuffer_emphasis();
    }

    get_cpu_state(): Readonly<{
        a: number;
        x: number;
        y: number;
        stack_pointer: number;
        program_counter: number;
        status: number;
    }> {
        return {
            a: this.#cpu.a,
            x: this.#cpu.x,
            y: this.#cpu.y,
            stack_pointer: this.#cpu.stack_pointer,
            program_counter: this.#cpu.program_counter,
            status: this.#cpu.status,
        };
    }

    get_frame_number(): number {
        return this.#ppu.get_frame_number();
    }

    get_cpu_cycle_count(): number {
        return this.#clock.get_cpu_cycle_count();
    }

    get_ppu_dot_count(): number {
        return this.#clock.get_ppu_dot_count();
    }

    get_ppu_position(): { readonly scanline: number; readonly dot: number } {
        return { scanline: this.#ppu.get_scanline(), dot: this.#ppu.get_dot() };
    }

    get_master_clock_ticks(): number {
        return this.#clock.get_master_clock_ticks();
    }

    get_audio_sample_rate_hz(): number {
        return this.#apu.get_audio_sample_rate_hz();
    }

    /** Returns copies of the cartridge's declared nonvolatile PRG and CHR RAM. */
    get_battery_ram_snapshot(): NesConsoleBatteryRamSnapshot {
        return {
            prg_nvram: this.#mapper.get_prg_nvram_snapshot(),
            chr_nvram: this.#mapper.get_chr_nvram_snapshot(),
        };
    }

    /** Restores an exactly sized battery-RAM snapshot without resetting other console state. */
    load_battery_ram_snapshot(snapshot: NesConsoleBatteryRamSnapshot): void {
        const current_snapshot = this.get_battery_ram_snapshot();

        if (
            snapshot.prg_nvram.byteLength !== current_snapshot.prg_nvram.byteLength ||
            snapshot.chr_nvram.byteLength !== current_snapshot.chr_nvram.byteLength
        ) {
            throw new RangeError(
                "Battery RAM snapshot PRG/CHR lengths do not match this cartridge's declared NVRAM sizes.",
            );
        }

        this.#mapper.load_prg_nvram_snapshot(snapshot.prg_nvram);
        this.#mapper.load_chr_nvram_snapshot(snapshot.chr_nvram);
    }

    get_rom_metadata(): Readonly<Pick<InesRom, "format" | "mapper_id" | "submapper" | "mirroring">> {
        return {
            format: this.#rom.format,
            mapper_id: this.#rom.mapper_id,
            submapper: this.#rom.submapper,
            mirroring: this.#rom.mirroring,
        };
    }

    #clock_one_cpu_cycle(): CpuCycleResult {
        let cpu_cycle_result: CpuCycleResult | undefined;
        const trace_sink = this.#trace_sink;

        for (let tick_index = 0; tick_index < NTSC_MASTER_TICKS_PER_CPU_CYCLE; tick_index += 1) {
            const tick = this.#clock.clock_master_tick();

            if (tick.cpu_cycle_due) {
                const apu_irq_asserted = this.#apu.is_irq_asserted();
                const mapper_irq_asserted = this.#mapper instanceof Mmc3Mapper && this.#mapper.get_irq_line_asserted();
                const cpu_irq_asserted = apu_irq_asserted || mapper_irq_asserted;
                this.#cpu.set_irq_line(cpu_irq_asserted);

                if (trace_sink !== null) {
                    trace_sink({
                        kind: "interrupt_lines",
                        master_clock_tick: tick.master_clock_tick,
                        cpu_cycle_count: tick.cpu_cycle_count,
                        apu_irq_asserted,
                        mapper_irq_asserted,
                        cpu_irq_asserted,
                    });
                }

                cpu_cycle_result = this.#cpu.clock_cycle();

                if (trace_sink !== null) {
                    trace_sink({
                        kind: "cpu_cycle",
                        master_clock_tick: tick.master_clock_tick,
                        cpu_cycle_count: tick.cpu_cycle_count,
                        sequence_kind: cpu_cycle_result.sequence_kind,
                        sequence_cycle: cpu_cycle_result.sequence_cycle,
                        sequence_completed: cpu_cycle_result.sequence_completed,
                        program_counter: this.#cpu.program_counter,
                        access: { ...cpu_cycle_result.access },
                    });
                }

                this.#apu.clock_cpu_cycle();

                if (trace_sink !== null) {
                    trace_sink({
                        kind: "apu_cycle",
                        master_clock_tick: tick.master_clock_tick,
                        cpu_cycle_count: tick.cpu_cycle_count,
                    });
                }
            }

            if (tick.ppu_dot_due) {
                const previous_frame_number = trace_sink === null ? 0 : this.#ppu.get_frame_number();
                this.#ppu.clock_ppu_dot();

                if (trace_sink !== null) {
                    const frame_number = this.#ppu.get_frame_number();
                    trace_sink({
                        kind: "ppu_dot",
                        master_clock_tick: tick.master_clock_tick,
                        ppu_dot_count: tick.ppu_dot_count,
                        frame_number,
                        scanline: this.#ppu.get_scanline(),
                        dot: this.#ppu.get_dot(),
                    });

                    if (frame_number !== previous_frame_number) {
                        trace_sink({
                            kind: "frame_boundary",
                            master_clock_tick: tick.master_clock_tick,
                            cpu_cycle_count: tick.cpu_cycle_count,
                            ppu_dot_count: tick.ppu_dot_count,
                            frame_number,
                        });
                    }
                }

                if (this.#ppu.take_nmi_edge()) {
                    this.#cpu.request_nmi();

                    if (trace_sink !== null) {
                        trace_sink({
                            kind: "nmi_edge",
                            master_clock_tick: tick.master_clock_tick,
                            ppu_dot_count: tick.ppu_dot_count,
                        });
                    }
                }
            }
        }

        if (cpu_cycle_result === undefined) {
            throw new Error("NTSC master-clock divider did not produce a CPU cycle.");
        }

        return cpu_cycle_result;
    }

    #mapper_reset(): void {
        if (this.#mapper instanceof Mmc3Mapper) {
            this.#mapper.reset();
        }
    }
}
