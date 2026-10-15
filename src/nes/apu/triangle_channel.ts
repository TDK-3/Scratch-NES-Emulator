import { get_length_counter_value } from "./length_counter.js";

const TRIANGLE_SEQUENCE = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
] as const;
const TRIANGLE_SEQUENCE_LENGTH = 32;
const TRIANGLE_SEQUENCE_MASK = TRIANGLE_SEQUENCE_LENGTH - 1;
const CONTROL_LENGTH_HALT_MASK = 0x80;
const LINEAR_RELOAD_VALUE_MASK = 0x7f;
const TIMER_LOW_MASK = 0xff;
const TIMER_HIGH_MASK = 0x07;
const TIMER_HIGH_SHIFT = 8;
const TIMER_PERIOD_MAX = 0x07ff;
const TIMER_PERIOD_MIN = 2;
const LENGTH_INDEX_SHIFT = 3;
const FULL_BYTE_MASK = 0xff;

/** 2A03 triangle timer, waveform sequencer, length counter, and linear counter. */
export class ApuTriangleChannel {
    #enabled = false;
    #length_halt = false;
    #linear_reload_value = 0;
    #linear_counter = 0;
    #linear_reload_flag = false;
    #timer_period = 0;
    #timer_counter = 0;
    #sequence_step = 0;
    #length_counter = 0;

    /** Restores the triangle channel's register and counter state. */
    reset(): void {
        this.#enabled = false;
        this.#length_halt = false;
        this.#linear_reload_value = 0;
        this.#linear_counter = 0;
        this.#linear_reload_flag = false;
        this.#timer_period = 0;
        this.#timer_counter = 0;
        this.#sequence_step = 0;
        this.#length_counter = 0;
    }

    /** Enables the channel; disabling it immediately clears the length counter. */
    set_enabled(enabled: boolean): void {
        this.#enabled = enabled;

        if (!enabled) {
            this.#length_counter = 0;
        }
    }

    /** Writes $4008: linear-counter reload value and the shared length-halt/control flag. */
    write_linear_control(value: number): void {
        assert_byte_value(value);
        this.#length_halt = (value & CONTROL_LENGTH_HALT_MASK) !== 0;
        this.#linear_reload_value = value & LINEAR_RELOAD_VALUE_MASK;
    }

    /** Writes $400A: the low eight bits of the eleven-bit timer period. */
    write_timer_low(value: number): void {
        assert_byte_value(value);
        this.#timer_period = (this.#timer_period & ~TIMER_LOW_MASK) | value;
    }

    /** Writes $400B: upper timer bits, length load, and linear-counter reload request. */
    write_timer_high(value: number): void {
        assert_byte_value(value);
        this.#timer_period =
            (this.#timer_period & TIMER_LOW_MASK) | ((value & TIMER_HIGH_MASK) << TIMER_HIGH_SHIFT);
        this.#linear_reload_flag = true;

        if (this.#enabled) {
            this.#length_counter = get_length_counter_value(value >>> LENGTH_INDEX_SHIFT);
        }
    }

    /** Clocks the triangle timer once per CPU cycle. The sequencer is gated by both counters. */
    clock_timer(): void {
        if (this.#timer_counter === 0) {
            this.#timer_counter = this.#timer_period;

            if (
                this.#timer_period >= TIMER_PERIOD_MIN &&
                this.#length_counter > 0 &&
                this.#linear_counter > 0
            ) {
                this.#sequence_step = (this.#sequence_step + 1) & TRIANGLE_SEQUENCE_MASK;
            }

            return;
        }

        this.#timer_counter -= 1;
    }

    /** Clocks the linear counter on a quarter-frame event. */
    clock_quarter_frame(): void {
        if (this.#linear_reload_flag) {
            this.#linear_counter = this.#linear_reload_value;
        } else if (this.#linear_counter > 0) {
            this.#linear_counter -= 1;
        }

        if (!this.#length_halt) {
            this.#linear_reload_flag = false;
        }
    }

    /** Clocks the length counter on a half-frame event unless halted by $4008 bit 7. */
    clock_half_frame(): void {
        if (!this.#length_halt && this.#length_counter > 0) {
            this.#length_counter -= 1;
        }
    }

    /** Returns the held four-bit DAC level; timer periods below two are muted to avoid ultrasonic aliasing. */
    get_output(): number {
        if (this.#timer_period < TIMER_PERIOD_MIN) {
            return 0;
        }

        return TRIANGLE_SEQUENCE[this.#sequence_step] ?? 0;
    }

    /** Returns whether the channel's length counter is nonzero for `$4015` status. */
    get_status(): boolean {
        return this.#length_counter > 0;
    }

    get_length_counter(): number {
        return this.#length_counter;
    }

    get_linear_counter(): number {
        return this.#linear_counter;
    }

    get_timer_period(): number {
        return this.#timer_period;
    }

    get_sequence_step(): number {
        return this.#sequence_step;
    }
}

function assert_byte_value(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > FULL_BYTE_MASK) {
        throw new RangeError(`Triangle register value ${value} is outside the byte range.`);
    }
}
