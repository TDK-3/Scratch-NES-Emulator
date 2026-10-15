import type { CpuBusDeviceRead } from "../cpu/cpu_bus.js";
import type { ApuCpuPort } from "../cpu/nes_cpu_bus.js";
import { mix_apu_channels } from "./mixer.js";
import { ApuAudioSampler, DEFAULT_APU_SAMPLE_RATE_HZ } from "./audio_sampler.js";
import { ApuDmcChannel } from "./dmc_channel.js";
import { ApuNoiseChannel } from "./noise_channel.js";
import { ApuPulseChannel } from "./pulse_channel.js";
import { ApuTriangleChannel } from "./triangle_channel.js";

const PULSE_ONE_BASE_ADDRESS = 0x4000;
const PULSE_TWO_BASE_ADDRESS = 0x4004;
const PULSE_REGISTER_ADDRESS_MASK = 0x03;
const PULSE_REGISTER_WINDOW_BYTES = 4;
const APU_FIRST_REGISTER_ADDRESS = 0x4000;
const APU_LAST_CHANNEL_REGISTER_ADDRESS = 0x4013;
const TRIANGLE_CONTROL_ADDRESS = 0x4008;
const TRIANGLE_TIMER_LOW_ADDRESS = 0x400a;
const TRIANGLE_TIMER_HIGH_ADDRESS = 0x400b;
const NOISE_CONTROL_ADDRESS = 0x400c;
const NOISE_PERIOD_ADDRESS = 0x400e;
const NOISE_LENGTH_ADDRESS = 0x400f;
const DMC_CONTROL_ADDRESS = 0x4010;
const DMC_OUTPUT_LEVEL_ADDRESS = 0x4011;
const DMC_SAMPLE_ADDRESS_ADDRESS = 0x4012;
const DMC_SAMPLE_LENGTH_ADDRESS = 0x4013;
const APU_STATUS_ADDRESS = 0x4015;
const APU_FRAME_COUNTER_ADDRESS = 0x4017;
const PULSE_ONE_ENABLE_MASK = 0x01;
const PULSE_TWO_ENABLE_MASK = 0x02;
const TRIANGLE_ENABLE_MASK = 0x04;
const NOISE_ENABLE_MASK = 0x08;
const DMC_ENABLE_MASK = 0x10;
const DMC_IRQ_STATUS_MASK = 0x80;
const FRAME_IRQ_INHIBIT_MASK = 0x40;
const FIVE_STEP_MODE_MASK = 0x80;
const FRAME_IRQ_STATUS_MASK = 0x40;
const FULL_BYTE_MASK = 0xff;
const APU_STATUS_DRIVEN_MASK = 0xdf;
const CPU_CYCLE_PARITY_MASK = 0x01;
const FOUR_STEP_FRAME_IRQ_CYCLE = 29_829;
const FOUR_STEP_FRAME_CYCLE_LIMIT = 29_830;
const FIVE_STEP_FRAME_CYCLE_LIMIT = 37_282;
const FOUR_STEP_EVENTS = [
    { cycle: 7_457, quarter_frame: true, half_frame: false },
    { cycle: 14_913, quarter_frame: true, half_frame: true },
    { cycle: 22_371, quarter_frame: true, half_frame: false },
    { cycle: FOUR_STEP_FRAME_IRQ_CYCLE, quarter_frame: true, half_frame: true },
] as const;
const FIVE_STEP_EVENTS = [
    { cycle: 7_457, quarter_frame: true, half_frame: false },
    { cycle: 14_913, quarter_frame: true, half_frame: true },
    { cycle: 22_371, quarter_frame: true, half_frame: false },
    { cycle: 29_829, quarter_frame: false, half_frame: false },
    { cycle: 37_281, quarter_frame: true, half_frame: true },
] as const;

/**
 * 2A03 pulse/triangle/noise/DMC register and frame-counter unit with deterministic mono sample production.
 * `NesConsole` calls `clock_cpu_cycle()` once per NTSC CPU cycle; the CPU bus services DMC sample-fetch
 * requests. `drain_audio_samples()` returns queued zero-order mixed samples without host audio APIs.
 */
export class Apu2A03 implements ApuCpuPort {
    readonly #pulse_one = new ApuPulseChannel(1);
    readonly #pulse_two = new ApuPulseChannel(2);
    readonly #triangle = new ApuTriangleChannel();
    readonly #noise = new ApuNoiseChannel();
    readonly #dmc = new ApuDmcChannel();
    readonly #audio_sampler: ApuAudioSampler;

    #cpu_cycle_count = 0;
    #pulse_timer_phase = false;
    #frame_cycle_count = 0;
    #frame_reset_delay: number | undefined = undefined;
    #five_step_mode = false;
    #frame_irq_inhibited = false;
    #frame_irq = false;

    constructor(sample_rate_hz = DEFAULT_APU_SAMPLE_RATE_HZ) {
        this.#audio_sampler = new ApuAudioSampler(sample_rate_hz);
    }

    /** Restores all implemented channel registers, frame sequencing, interrupt, and sample-clock state. */
    reset(): void {
        this.#pulse_one.reset();
        this.#pulse_two.reset();
        this.#triangle.reset();
        this.#noise.reset();
        this.#dmc.reset();
        this.#audio_sampler.reset();
        this.#cpu_cycle_count = 0;
        this.#pulse_timer_phase = false;
        this.#frame_cycle_count = 0;
        this.#frame_reset_delay = undefined;
        this.#five_step_mode = false;
        this.#frame_irq_inhibited = false;
        this.#frame_irq = false;
    }

    /** Routes CPU writes for implemented channel registers, `$4015`, and `$4017`. */
    write_register(address: number, value: number): void {
        assert_byte_value(value);

        if (address >= PULSE_ONE_BASE_ADDRESS && address < PULSE_ONE_BASE_ADDRESS + PULSE_REGISTER_WINDOW_BYTES) {
            this.#write_pulse_register(this.#pulse_one, address - PULSE_ONE_BASE_ADDRESS, value);
            return;
        }

        if (address >= PULSE_TWO_BASE_ADDRESS && address < PULSE_TWO_BASE_ADDRESS + PULSE_REGISTER_WINDOW_BYTES) {
            this.#write_pulse_register(this.#pulse_two, address - PULSE_TWO_BASE_ADDRESS, value);
            return;
        }

        if (address === TRIANGLE_CONTROL_ADDRESS) {
            this.#triangle.write_linear_control(value);
            return;
        }

        if (address === TRIANGLE_TIMER_LOW_ADDRESS) {
            this.#triangle.write_timer_low(value);
            return;
        }

        if (address === TRIANGLE_TIMER_HIGH_ADDRESS) {
            this.#triangle.write_timer_high(value);
            return;
        }

        if (address === NOISE_CONTROL_ADDRESS) {
            this.#noise.write_control(value);
            return;
        }

        if (address === NOISE_PERIOD_ADDRESS) {
            this.#noise.write_period(value);
            return;
        }

        if (address === NOISE_LENGTH_ADDRESS) {
            this.#noise.write_length(value);
            return;
        }

        if (address === DMC_CONTROL_ADDRESS) {
            this.#dmc.write_control(value);
            return;
        }

        if (address === DMC_OUTPUT_LEVEL_ADDRESS) {
            this.#dmc.write_output_level(value);
            return;
        }

        if (address === DMC_SAMPLE_ADDRESS_ADDRESS) {
            this.#dmc.write_sample_address(value);
            return;
        }

        if (address === DMC_SAMPLE_LENGTH_ADDRESS) {
            this.#dmc.write_sample_length(value);
            return;
        }

        if (address >= APU_FIRST_REGISTER_ADDRESS && address <= APU_LAST_CHANNEL_REGISTER_ADDRESS) {
            // Triangle/noise unused registers have no additional behavior here.
            return;
        }

        if (address === APU_STATUS_ADDRESS) {
            this.#pulse_one.set_enabled((value & PULSE_ONE_ENABLE_MASK) !== 0);
            this.#pulse_two.set_enabled((value & PULSE_TWO_ENABLE_MASK) !== 0);
            this.#triangle.set_enabled((value & TRIANGLE_ENABLE_MASK) !== 0);
            this.#noise.set_enabled((value & NOISE_ENABLE_MASK) !== 0);
            const load_delay = (this.#cpu_cycle_count & CPU_CYCLE_PARITY_MASK) === 0 ? 3 : 4;
            this.#dmc.write_status_enable((value & DMC_ENABLE_MASK) !== 0, load_delay);
            return;
        }

        if (address === APU_FRAME_COUNTER_ADDRESS) {
            this.#write_frame_counter(value);
            return;
        }

        throw new RangeError(`CPU address $${address.toString(16)} is not an APU register write.`);
    }

    /** Reads `$4015`; the CPU bus merges undriven open-bus bit 5 from its data latch. */
    read_status(_open_bus: number): CpuBusDeviceRead {
        const value =
            (this.#pulse_one.get_status() ? PULSE_ONE_ENABLE_MASK : 0) |
            (this.#pulse_two.get_status() ? PULSE_TWO_ENABLE_MASK : 0) |
            (this.#triangle.get_status() ? TRIANGLE_ENABLE_MASK : 0) |
            (this.#noise.get_status() ? NOISE_ENABLE_MASK : 0) |
            (this.#dmc.get_status() ? DMC_ENABLE_MASK : 0) |
            (this.#frame_irq ? FRAME_IRQ_STATUS_MASK : 0) |
            (this.#dmc.is_irq_asserted() ? DMC_IRQ_STATUS_MASK : 0);

        this.#frame_irq = false;

        return { value, driven_mask: APU_STATUS_DRIVEN_MASK };
    }

    /** Clocks the channels, NTSC frame sequencer, and deterministic audio sampler for one CPU cycle. */
    clock_cpu_cycle(): void {
        this.#cpu_cycle_count += 1;
        this.#triangle.clock_timer();
        this.#noise.clock_timer();
        this.#dmc.clock_cpu_cycle();
        this.#pulse_timer_phase = !this.#pulse_timer_phase;

        if (this.#pulse_timer_phase) {
            this.#pulse_one.clock_timer();
            this.#pulse_two.clock_timer();
        }

        this.#clock_frame_sequencer();

        if (this.#frame_reset_delay !== undefined) {
            this.#frame_reset_delay -= 1;

            if (this.#frame_reset_delay === 0) {
                this.#frame_cycle_count = 0;
                this.#frame_reset_delay = undefined;

                if (this.#five_step_mode) {
                    this.#clock_quarter_frame();
                    this.#clock_half_frame();
                }
            }
        }

        this.#audio_sampler.clock_cpu_cycle(this.get_mixed_output());
    }

    /** Returns one pulse DAC input for diagnostics and audio mixing. */
    get_pulse_output(channel_number: 1 | 2): number {
        return channel_number === 1 ? this.#pulse_one.get_output() : this.#pulse_two.get_output();
    }

    /** Returns the triangle DAC level, including a held sequence value while its counters gate stepping. */
    get_triangle_output(): number {
        return this.#triangle.get_output();
    }

    /** Returns the current noise DAC level. */
    get_noise_output(): number {
        return this.#noise.get_output();
    }

    /** Returns the current seven-bit DMC DAC level. */
    get_dmc_output(): number {
        return this.#dmc.get_output();
    }

    /** Returns the instantaneous nonlinear pulse+TND output, before analog filtering. */
    get_mixed_output(): number {
        return mix_apu_channels(
            this.#pulse_one.get_output(),
            this.#pulse_two.get_output(),
            this.#triangle.get_output(),
            this.#noise.get_output(),
            this.#dmc.get_output(),
        );
    }

    /** Returns the configured output sample rate in mono samples per second. */
    get_audio_sample_rate_hz(): number {
        return this.#audio_sampler.get_sample_rate_hz();
    }

    /** Drains generated mono samples; call periodically to bound buffered audio memory. */
    drain_audio_samples(): Float32Array {
        return this.#audio_sampler.drain_samples();
    }

    /** Returns the sample address the CPU bus should fetch, or `null` when no DMC DMA is pending. */
    get_dmc_dma_request_address(): number | null {
        return this.#dmc.get_dma_request_address();
    }

    /** Completes a bus-owned DMC sample fetch. */
    complete_dmc_dma_read(value: number): void {
        this.#dmc.complete_dma_read(value);
    }

    /** Returns whether the frame IRQ line is currently asserted. */
    is_frame_irq_asserted(): boolean {
        return this.#frame_irq;
    }

    /** Returns the combined frame-counter and DMC IRQ line level. */
    is_irq_asserted(): boolean {
        return this.#frame_irq || this.#dmc.is_irq_asserted();
    }

    /** Returns whether the DMC IRQ is currently asserted. */
    is_dmc_irq_asserted(): boolean {
        return this.#dmc.is_irq_asserted();
    }

    /** Returns the current length-counter value for one pulse channel. */
    get_pulse_length_counter(channel_number: 1 | 2): number {
        return channel_number === 1 ? this.#pulse_one.get_length_counter() : this.#pulse_two.get_length_counter();
    }

    #write_pulse_register(channel: ApuPulseChannel, register_index: number, value: number): void {
        switch (register_index & PULSE_REGISTER_ADDRESS_MASK) {
            case 0:
                channel.write_control(value);
                return;
            case 1:
                channel.write_sweep(value);
                return;
            case 2:
                channel.write_timer_low(value);
                return;
            case 3:
                channel.write_timer_high(value);
                return;
        }
    }

    #write_frame_counter(value: number): void {
        this.#five_step_mode = (value & FIVE_STEP_MODE_MASK) !== 0;
        this.#frame_irq_inhibited = (value & FRAME_IRQ_INHIBIT_MASK) !== 0;

        if (this.#frame_irq_inhibited) {
            this.#frame_irq = false;
        }

        // Reset occurs three or four CPU cycles later, selected by CPU/APU clock parity.
        this.#frame_reset_delay = (this.#cpu_cycle_count & CPU_CYCLE_PARITY_MASK) === 0 ? 3 : 4;
    }

    #clock_frame_sequencer(): void {
        this.#frame_cycle_count += 1;
        const events = this.#five_step_mode ? FIVE_STEP_EVENTS : FOUR_STEP_EVENTS;
        const event = events.find((candidate) => candidate.cycle === this.#frame_cycle_count);

        if (event?.quarter_frame === true) {
            this.#clock_quarter_frame();
        }

        if (event?.half_frame === true) {
            this.#clock_half_frame();
        }

        if (
            !this.#five_step_mode &&
            this.#frame_cycle_count === FOUR_STEP_FRAME_IRQ_CYCLE &&
            !this.#frame_irq_inhibited
        ) {
            this.#frame_irq = true;
        }

        const frame_cycle_limit = this.#five_step_mode ? FIVE_STEP_FRAME_CYCLE_LIMIT : FOUR_STEP_FRAME_CYCLE_LIMIT;

        if (this.#frame_cycle_count >= frame_cycle_limit) {
            this.#frame_cycle_count = 0;
        }
    }

    #clock_quarter_frame(): void {
        this.#pulse_one.clock_quarter_frame();
        this.#pulse_two.clock_quarter_frame();
        this.#triangle.clock_quarter_frame();
        this.#noise.clock_quarter_frame();
    }

    #clock_half_frame(): void {
        this.#pulse_one.clock_half_frame();
        this.#pulse_two.clock_half_frame();
        this.#triangle.clock_half_frame();
        this.#noise.clock_half_frame();
    }
}

function assert_byte_value(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > FULL_BYTE_MASK) {
        throw new RangeError(`APU register value ${value} is outside the byte range.`);
    }
}
