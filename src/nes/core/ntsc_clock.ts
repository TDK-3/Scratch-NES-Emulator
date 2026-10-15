export const NTSC_MASTER_CLOCK_HZ = 21_477_272;
export const NTSC_MASTER_TICKS_PER_PPU_DOT = 4;
export const NTSC_MASTER_TICKS_PER_CPU_CYCLE = 12;

export interface NtscClockTick {
    readonly master_clock_tick: number;
    readonly cpu_cycle_count: number;
    readonly ppu_dot_count: number;
    readonly cpu_cycle_due: boolean;
    readonly ppu_dot_due: boolean;
}

/** Integer NTSC master-clock divider: one CPU/APU cycle per 12 ticks and one PPU dot per 4. */
export class NtscClock {
    #master_clock_ticks = 0;
    #cpu_cycle_count = 0;
    #ppu_dot_count = 0;

    /** Advances exactly one master-clock tick and reports any device edges due on that tick. */
    clock_master_tick(): NtscClockTick {
        if (this.#master_clock_ticks >= Number.MAX_SAFE_INTEGER) {
            throw new RangeError("The NTSC master clock exceeded JavaScript's safe integer range.");
        }

        this.#master_clock_ticks += 1;
        const cpu_cycle_due = this.#master_clock_ticks % NTSC_MASTER_TICKS_PER_CPU_CYCLE === 0;
        const ppu_dot_due = this.#master_clock_ticks % NTSC_MASTER_TICKS_PER_PPU_DOT === 0;

        if (cpu_cycle_due) {
            this.#cpu_cycle_count += 1;
        }

        if (ppu_dot_due) {
            this.#ppu_dot_count += 1;
        }

        return {
            master_clock_tick: this.#master_clock_ticks,
            cpu_cycle_count: this.#cpu_cycle_count,
            ppu_dot_count: this.#ppu_dot_count,
            cpu_cycle_due,
            ppu_dot_due,
        };
    }

    /** Restarts the integer phase and counters at the beginning of a console reset. */
    reset(): void {
        this.#master_clock_ticks = 0;
        this.#cpu_cycle_count = 0;
        this.#ppu_dot_count = 0;
    }

    get_master_clock_ticks(): number {
        return this.#master_clock_ticks;
    }

    get_cpu_cycle_count(): number {
        return this.#cpu_cycle_count;
    }

    get_ppu_dot_count(): number {
        return this.#ppu_dot_count;
    }
}
