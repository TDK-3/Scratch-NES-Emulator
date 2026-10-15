import { get_length_counter_value } from "./length_counter.js";

const NOISE_PERIODS_NTSC = [
    4, 8, 16, 32, 64, 96, 128, 160,
    202, 254, 380, 508, 762, 1016, 2034, 4068,
] as const;
const LENGTH_HALT_ENVELOPE_LOOP_MASK = 0x20;
const CONSTANT_VOLUME_MASK = 0x10;
const VOLUME_MASK = 0x0f;
const NOISE_MODE_MASK = 0x80;
const NOISE_PERIOD_INDEX_MASK = 0x0f;
const LONG_MODE_FEEDBACK_TAP = 1;
const SHORT_MODE_FEEDBACK_TAP = 6;
const LFSR_REGISTER_MASK = 0x7fff;
const LFSR_OUTPUT_MASK = 0x01;
const LFSR_FEEDBACK_BIT = 14;
const LENGTH_INDEX_SHIFT = 3;
const FULL_BYTE_MASK = 0xff;

/** 2A03 noise timer, 15-bit LFSR, length counter, and envelope. */
export class ApuNoiseChannel {
    #enabled = false;
    #control_register = 0;
    #mode = false;
    #timer_period_cycles: number = NOISE_PERIODS_NTSC[0];
    #timer_reload_value: number = NOISE_PERIODS_NTSC[0] - 1;
    #timer_counter = 0;
    #shift_register = 1;
    #length_counter = 0;
    #envelope_start = false;
    #envelope_divider = 0;
    #envelope_decay = 0;

    /** Restores the noise channel's register, timer, LFSR, length, and envelope state. */
    reset(): void {
        this.#enabled = false;
        this.#control_register = 0;
        this.#mode = false;
        this.#timer_period_cycles = NOISE_PERIODS_NTSC[0];
        this.#timer_reload_value = NOISE_PERIODS_NTSC[0] - 1;
        this.#timer_counter = 0;
        this.#shift_register = 1;
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

    /** Writes `$400C`: length halt and constant-volume/envelope control. */
    write_control(value: number): void {
        assert_byte_value(value);
        this.#control_register = value;
    }

    /** Writes `$400E`: mode bit and NTSC noise timer period index. */
    write_period(value: number): void {
        assert_byte_value(value);
        this.#mode = (value & NOISE_MODE_MASK) !== 0;
        const period = NOISE_PERIODS_NTSC[value & NOISE_PERIOD_INDEX_MASK];

        if (period === undefined) {
            throw new RangeError(`Noise period index ${value & NOISE_PERIOD_INDEX_MASK} is outside the table.`);
        }

        this.#timer_period_cycles = period;
        this.#timer_reload_value = period - 1;
    }

    /** Writes `$400F`: length index and envelope restart flag. */
    write_length(value: number): void {
        assert_byte_value(value);
        this.#envelope_start = true;

        if (this.#enabled) {
            this.#length_counter = get_length_counter_value(value >>> LENGTH_INDEX_SHIFT);
        }
    }

    /** Clocks the noise timer once per CPU cycle and shifts its LFSR when the period expires. */
    clock_timer(): void {
        if (this.#timer_counter === 0) {
            this.#timer_counter = this.#timer_reload_value;
            this.#shift_lfsr();
            return;
        }

        this.#timer_counter -= 1;
    }

    /** Clocks the envelope on a quarter-frame event. */
    clock_quarter_frame(): void {
        if (this.#envelope_start) {
            this.#envelope_start = false;
            this.#envelope_decay = VOLUME_MASK;
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
            this.#envelope_decay = VOLUME_MASK;
        }
    }

    /** Clocks the length counter on a half-frame event unless the envelope loop/halt bit is set. */
    clock_half_frame(): void {
        if (this.#length_counter > 0 && !this.#is_envelope_looping()) {
            this.#length_counter -= 1;
        }
    }

    /** Returns the four-bit noise DAC input, gated by the length counter and LFSR output bit. */
    get_output(): number {
        if (this.#length_counter === 0 || (this.#shift_register & LFSR_OUTPUT_MASK) !== 0) {
            return 0;
        }

        if ((this.#control_register & CONSTANT_VOLUME_MASK) !== 0) {
            return this.#control_register & VOLUME_MASK;
        }

        return this.#envelope_decay;
    }

    get_status(): boolean {
        return this.#length_counter > 0;
    }

    get_length_counter(): number {
        return this.#length_counter;
    }

    get_timer_period_cycles(): number {
        return this.#timer_period_cycles;
    }

    get_shift_register(): number {
        return this.#shift_register;
    }

    get_mode(): boolean {
        return this.#mode;
    }

    #shift_lfsr(): void {
        const feedback_tap = this.#mode ? SHORT_MODE_FEEDBACK_TAP : LONG_MODE_FEEDBACK_TAP;
        const low_bit = this.#shift_register & LFSR_OUTPUT_MASK;
        const tap_bit = (this.#shift_register >>> feedback_tap) & LFSR_OUTPUT_MASK;
        const feedback = low_bit ^ tap_bit;
        this.#shift_register =
            ((this.#shift_register >>> 1) | (feedback << LFSR_FEEDBACK_BIT)) & LFSR_REGISTER_MASK;
    }

    #envelope_period(): number {
        return this.#control_register & VOLUME_MASK;
    }

    #is_envelope_looping(): boolean {
        return (this.#control_register & LENGTH_HALT_ENVELOPE_LOOP_MASK) !== 0;
    }
}

function assert_byte_value(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > FULL_BYTE_MASK) {
        throw new RangeError(`Noise register value ${value} is outside the byte range.`);
    }
}
