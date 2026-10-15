const DMC_PERIODS_NTSC = [
    428, 380, 340, 320, 286, 254, 226, 214,
    190, 160, 142, 128, 106, 85, 72, 54,
] as const;
const IRQ_ENABLE_MASK = 0x80;
const LOOP_MASK = 0x40;
const RATE_INDEX_MASK = 0x0f;
const OUTPUT_LEVEL_MASK = 0x7f;
const OUTPUT_BIT_MASK = 0x01;
const OUTPUT_DELTA = 2;
const OUTPUT_LEVEL_MAX = 0x7f;
const SAMPLE_ADDRESS_BASE = 0xc000;
const SAMPLE_ADDRESS_SHIFT = 6;
const SAMPLE_LENGTH_SHIFT = 4;
const SAMPLE_LENGTH_BASE = 1;
const SAMPLE_ADDRESS_WRAP = 0x8000;
const SAMPLE_ADDRESS_MAX = 0xffff;
const SAMPLE_BITS_PER_BYTE = 8;
const FULL_BYTE_MASK = 0xff;

/** 2A03 DMC sample reader, output unit, IRQ state, and DMA request handshake. */
export class ApuDmcChannel {
    #irq_enabled = false;
    #loop = false;
    #irq = false;
    #timer_period_cycles: number = DMC_PERIODS_NTSC[0];
    #timer_reload_value: number = DMC_PERIODS_NTSC[0] - 1;
    #timer_counter = 0;
    #output_level = 0;
    #sample_address_register = 0;
    #sample_length_register = 0;
    #current_address = SAMPLE_ADDRESS_BASE;
    #bytes_remaining = 0;
    #sample_buffer: number | undefined = undefined;
    #shift_register = 0;
    #bits_remaining = 0;
    #silence = true;
    #load_dma_delay: number | undefined = undefined;

    /** Restores the DMC reader, output unit, timer, and interrupt state. */
    reset(): void {
        this.#irq_enabled = false;
        this.#loop = false;
        this.#irq = false;
        this.#timer_period_cycles = DMC_PERIODS_NTSC[0];
        this.#timer_reload_value = DMC_PERIODS_NTSC[0] - 1;
        this.#timer_counter = 0;
        this.#output_level = 0;
        this.#sample_address_register = 0;
        this.#sample_length_register = 0;
        this.#current_address = SAMPLE_ADDRESS_BASE;
        this.#bytes_remaining = 0;
        this.#sample_buffer = undefined;
        this.#shift_register = 0;
        this.#bits_remaining = 0;
        this.#silence = true;
        this.#load_dma_delay = undefined;
    }

    /** Writes `$4010`: IRQ enable, loop mode, and NTSC output-bit rate. */
    write_control(value: number): void {
        assert_byte_value(value);
        this.#irq_enabled = (value & IRQ_ENABLE_MASK) !== 0;
        this.#loop = (value & LOOP_MASK) !== 0;
        const period = DMC_PERIODS_NTSC[value & RATE_INDEX_MASK];

        if (period === undefined) {
            throw new RangeError(`DMC rate index ${value & RATE_INDEX_MASK} is outside the period table.`);
        }

        this.#timer_period_cycles = period;
        this.#timer_reload_value = period - 1;

        if (!this.#irq_enabled) {
            this.#irq = false;
        }
    }

    /** Writes `$4011`: directly sets the seven-bit DAC output level. */
    write_output_level(value: number): void {
        assert_byte_value(value);
        this.#output_level = value & OUTPUT_LEVEL_MASK;
    }

    /** Writes `$4012`: selects the sample start address in 64-byte steps from `$C000`. */
    write_sample_address(value: number): void {
        assert_byte_value(value);
        this.#sample_address_register = value;
    }

    /** Writes `$4013`: selects a sample length in 16-byte steps, plus one byte. */
    write_sample_length(value: number): void {
        assert_byte_value(value);
        this.#sample_length_register = value;
    }

    /** Applies `$4015` bit 4 and schedules a load DMA three or four cycles after a restart. */
    write_status_enable(enabled: boolean, load_delay_cycles: number): void {
        if (!Number.isInteger(load_delay_cycles) || load_delay_cycles < 0) {
            throw new RangeError(`DMC load delay ${load_delay_cycles} must be a non-negative integer.`);
        }

        if (!enabled) {
            this.#bytes_remaining = 0;
            this.#load_dma_delay = undefined;
        } else if (this.#bytes_remaining === 0) {
            this.#restart_sample();
            this.#load_dma_delay = load_delay_cycles === 0 ? undefined : load_delay_cycles;
        }

        this.#irq = false;
    }

    /** Clocks the DMC bit timer once per CPU cycle. */
    clock_cpu_cycle(): void {
        if (this.#load_dma_delay !== undefined) {
            this.#load_dma_delay -= 1;

            if (this.#load_dma_delay === 0) {
                this.#load_dma_delay = undefined;
            }
        }

        if (this.#timer_counter === 0) {
            this.#timer_counter = this.#timer_reload_value;
            this.#clock_output_unit();
            return;
        }

        this.#timer_counter -= 1;
    }

    /** Returns the address for a pending sample-buffer fetch, or `null` when none is needed. */
    get_dma_request_address(): number | null {
        if (this.#load_dma_delay !== undefined || this.#sample_buffer !== undefined || this.#bytes_remaining === 0) {
            return null;
        }

        return this.#current_address;
    }

    /** Supplies a byte fetched by DMC DMA and advances or restarts the sample reader. */
    complete_dma_read(value: number): void {
        assert_byte_value(value);

        if (this.#bytes_remaining === 0 || this.#sample_buffer !== undefined) {
            return;
        }

        this.#sample_buffer = value;
        this.#current_address =
            this.#current_address === SAMPLE_ADDRESS_MAX ? SAMPLE_ADDRESS_WRAP : this.#current_address + 1;
        this.#bytes_remaining -= 1;

        if (this.#bytes_remaining === 0) {
            if (this.#loop) {
                this.#restart_sample();
            } else if (this.#irq_enabled) {
                this.#irq = true;
            }
        }
    }

    get_output(): number {
        return this.#output_level;
    }

    get_status(): boolean {
        return this.#bytes_remaining > 0;
    }

    is_irq_asserted(): boolean {
        return this.#irq;
    }

    get_bytes_remaining(): number {
        return this.#bytes_remaining;
    }

    get_current_address(): number {
        return this.#current_address;
    }

    get_sample_buffer(): number | undefined {
        return this.#sample_buffer;
    }

    get_bits_remaining(): number {
        return this.#bits_remaining;
    }

    get_timer_period_cycles(): number {
        return this.#timer_period_cycles;
    }

    #restart_sample(): void {
        this.#current_address = SAMPLE_ADDRESS_BASE + (this.#sample_address_register << SAMPLE_ADDRESS_SHIFT);
        this.#bytes_remaining = (this.#sample_length_register << SAMPLE_LENGTH_SHIFT) + SAMPLE_LENGTH_BASE;
    }

    #clock_output_unit(): void {
        if (this.#bits_remaining === 0) {
            this.#bits_remaining = SAMPLE_BITS_PER_BYTE;

            if (this.#sample_buffer === undefined) {
                this.#silence = true;
            } else {
                this.#shift_register = this.#sample_buffer;
                this.#sample_buffer = undefined;
                this.#silence = false;
            }
        }

        if (!this.#silence) {
            if ((this.#shift_register & OUTPUT_BIT_MASK) !== 0) {
                if (this.#output_level <= OUTPUT_LEVEL_MAX - OUTPUT_DELTA) {
                    this.#output_level += OUTPUT_DELTA;
                }
            } else if (this.#output_level >= OUTPUT_DELTA) {
                this.#output_level -= OUTPUT_DELTA;
            }

            this.#shift_register >>>= 1;
        }

        this.#bits_remaining -= 1;
    }
}

function assert_byte_value(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > FULL_BYTE_MASK) {
        throw new RangeError(`DMC register/data value ${value} is outside the byte range.`);
    }
}
