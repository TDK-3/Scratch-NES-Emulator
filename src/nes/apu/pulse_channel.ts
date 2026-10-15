import { get_length_counter_value } from "./length_counter.js";

const DUTY_SEQUENCE_LENGTH = 8;
const DUTY_SEQUENCE_MASK = DUTY_SEQUENCE_LENGTH - 1;
const DUTY_SEQUENCES = [
    [0, 1, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0, 0, 0],
    [1, 0, 0, 1, 1, 1, 1, 1],
] as const;
const DUTY_REGISTER_SHIFT = 6;
const DUTY_REGISTER_MASK = 0x03;
const ENVELOPE_LOOP_MASK = 0x20;
const ENVELOPE_CONSTANT_VOLUME_MASK = 0x10;
const ENVELOPE_VOLUME_MASK = 0x0f;
const SWEEP_ENABLE_MASK = 0x80;
const SWEEP_PERIOD_SHIFT = 4;
const SWEEP_PERIOD_MASK = 0x07;
const SWEEP_NEGATE_MASK = 0x08;
const SWEEP_SHIFT_MASK = 0x07;
const TIMER_LOW_MASK = 0xff;
const TIMER_HIGH_MASK = 0x07;
const TIMER_HIGH_SHIFT = 8;
const TIMER_PERIOD_MAX = 0x07ff;
const TIMER_PERIOD_MIN = 8;
const LENGTH_INDEX_SHIFT = 3;
const FULL_BYTE_MASK = 0xff;

/** One of the two 2A03 pulse-channel units, before APU frame-sequencer integration. */
export class ApuPulseChannel {
    readonly #channel_number: 1 | 2;

    #enabled = false;
    #control_register = 0;
    #sweep_enabled = false;
    #sweep_period = 1;
    #sweep_negate = false;
    #sweep_shift = 0;
    #sweep_divider = 0;
    #sweep_reload = false;
    #timer_period = 0;
    #timer_counter = 0;
    #duty_step = 0;
    #length_counter = 0;
    #envelope_start = false;
    #envelope_divider = 0;
    #envelope_decay = 0;

    constructor(channel_number: 1 | 2) {
        this.#channel_number = channel_number;
    }

    /** Restores the channel's power-on register, timer, length, envelope, and sweep state. */
    reset(): void {
        this.#enabled = false;
        this.#control_register = 0;
        this.#sweep_enabled = false;
        this.#sweep_period = 1;
        this.#sweep_negate = false;
        this.#sweep_shift = 0;
        this.#sweep_divider = 0;
        this.#sweep_reload = false;
        this.#timer_period = 0;
        this.#timer_counter = 0;
        this.#duty_step = 0;
        this.#length_counter = 0;
        this.#envelope_start = false;
        this.#envelope_divider = 0;
        this.#envelope_decay = 0;
    }

    /** Enables the channel; disabling it immediately clears the length counter. */
    set_enabled(enabled: boolean): void {
        this.#enabled = enabled;

        if (!enabled) {
            this.#length_counter = 0;
        }
    }

    /** Writes $4000/$4004: duty, envelope period/volume, constant volume, and length halt. */
    write_control(value: number): void {
        assert_byte_value(value);
        this.#control_register = value;
    }

    /** Writes $4001/$4005: sweep enable, divider period, negate mode, and shift count. */
    write_sweep(value: number): void {
        assert_byte_value(value);
        this.#sweep_enabled = (value & SWEEP_ENABLE_MASK) !== 0;
        this.#sweep_period = ((value >>> SWEEP_PERIOD_SHIFT) & SWEEP_PERIOD_MASK) + 1;
        this.#sweep_negate = (value & SWEEP_NEGATE_MASK) !== 0;
        this.#sweep_shift = value & SWEEP_SHIFT_MASK;
        this.#sweep_reload = true;
    }

    /** Writes $4002/$4006: the low eight bits of the eleven-bit timer period. */
    write_timer_low(value: number): void {
        assert_byte_value(value);
        this.#timer_period = (this.#timer_period & ~TIMER_LOW_MASK) | value;
    }

    /** Writes $4003/$4007: the upper timer bits, length index, and sequencer/envelope restart. */
    write_timer_high(value: number): void {
        assert_byte_value(value);
        this.#timer_period =
            (this.#timer_period & TIMER_LOW_MASK) | ((value & TIMER_HIGH_MASK) << TIMER_HIGH_SHIFT);
        this.#timer_counter = this.#timer_period;
        this.#duty_step = 0;
        this.#envelope_start = true;

        if (this.#enabled) {
            this.#length_counter = get_length_counter_value(value >>> LENGTH_INDEX_SHIFT);
        }
    }

    /** Advances one pulse-timer tick. The APU calls this at half the CPU clock rate. */
    clock_timer(): void {
        if (this.#timer_counter === 0) {
            this.#timer_counter = this.#timer_period;
            this.#duty_step = (this.#duty_step + 1) & DUTY_SEQUENCE_MASK;
            return;
        }

        this.#timer_counter -= 1;
    }

    /** Clocks the envelope unit on a quarter-frame event. */
    clock_quarter_frame(): void {
        if (this.#envelope_start) {
            this.#envelope_start = false;
            this.#envelope_decay = ENVELOPE_VOLUME_MASK;
            this.#envelope_divider = this.#envelope_period();
            return;
        }

        if (this.#envelope_divider > 0) {
            this.#envelope_divider -= 1;
            return;
        }

        this.#envelope_divider = this.#envelope_period();

        if (this.#envelope_decay > 0) {
            this.#envelope_decay -= 1;
        } else if (this.#is_envelope_looping()) {
            this.#envelope_decay = ENVELOPE_VOLUME_MASK;
        }
    }

    /** Clocks the length counter and sweep unit on a half-frame event. */
    clock_half_frame(): void {
        if (this.#length_counter > 0 && !this.#is_envelope_looping()) {
            this.#length_counter -= 1;
        }

        this.#clock_sweep();
    }

    /** Returns the current four-bit pulse DAC input, or zero while muted. */
    get_output(): number {
        if (this.#length_counter === 0 || this.#is_muted()) {
            return 0;
        }

        const duty = (this.#control_register >>> DUTY_REGISTER_SHIFT) & DUTY_REGISTER_MASK;
        const duty_bit = DUTY_SEQUENCES[duty]?.[this.#duty_step] ?? 0;

        if (duty_bit === 0) {
            return 0;
        }

        if ((this.#control_register & ENVELOPE_CONSTANT_VOLUME_MASK) !== 0) {
            return this.#control_register & ENVELOPE_VOLUME_MASK;
        }

        return this.#envelope_decay;
    }

    /** Returns whether the channel's length counter is nonzero for $4015 status. */
    get_status(): boolean {
        return this.#length_counter > 0;
    }

    /** Returns the current length-counter value for APU status and diagnostics. */
    get_length_counter(): number {
        return this.#length_counter;
    }

    /** Returns the current eleven-bit timer period. */
    get_timer_period(): number {
        return this.#timer_period;
    }

    #clock_sweep(): void {
        if (this.#sweep_reload) {
            this.#sweep_divider = this.#sweep_period;
            this.#sweep_reload = false;
            return;
        }

        if (this.#sweep_divider > 0) {
            this.#sweep_divider -= 1;

            if (this.#sweep_divider > 0) {
                return;
            }
        }

        if (this.#sweep_enabled && this.#sweep_shift > 0 && !this.#is_sweep_target_out_of_range()) {
            this.#timer_period = this.#get_sweep_target();
        }

        this.#sweep_divider = this.#sweep_period;
    }

    #is_muted(): boolean {
        return this.#timer_period < TIMER_PERIOD_MIN || (!this.#sweep_negate && this.#is_sweep_target_out_of_range());
    }

    #is_sweep_target_out_of_range(): boolean {
        const target = this.#get_sweep_target();
        return target < 0 || target > TIMER_PERIOD_MAX;
    }

    #get_sweep_target(): number {
        const change = this.#timer_period >> this.#sweep_shift;

        if (this.#sweep_negate) {
            return this.#timer_period - change - (this.#channel_number === 1 ? 1 : 0);
        }

        return this.#timer_period + change;
    }

    #envelope_period(): number {
        return this.#control_register & ENVELOPE_VOLUME_MASK;
    }

    #is_envelope_looping(): boolean {
        return (this.#control_register & ENVELOPE_LOOP_MASK) !== 0;
    }
}

function assert_byte_value(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > FULL_BYTE_MASK) {
        throw new RangeError(`Pulse register value ${value} is outside the byte range.`);
    }
}
