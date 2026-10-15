import type { CpuBusAccess } from "../cpu/cpu_bus.js";
import type { CpuCycleSequenceKind } from "../cpu/cpu_2a03.js";

const DEFAULT_TRACE_CAPACITY = 100_000;
const MAX_TRACE_CAPACITY = 1_000_000;

/** One ordered device or interrupt event from the deterministic NTSC console scheduler. */
export type NesConsoleTraceEvent =
    | {
          readonly kind: "interrupt_lines";
          readonly master_clock_tick: number;
          readonly cpu_cycle_count: number;
          readonly apu_irq_asserted: boolean;
          readonly mapper_irq_asserted: boolean;
          readonly cpu_irq_asserted: boolean;
      }
    | {
          readonly kind: "cpu_cycle";
          readonly master_clock_tick: number;
          readonly cpu_cycle_count: number;
          readonly sequence_kind: CpuCycleSequenceKind;
          readonly sequence_cycle: number;
          readonly sequence_completed: boolean;
          readonly program_counter: number;
          readonly access: CpuBusAccess;
      }
    | {
          readonly kind: "apu_cycle";
          readonly master_clock_tick: number;
          readonly cpu_cycle_count: number;
      }
    | {
          readonly kind: "ppu_dot";
          readonly master_clock_tick: number;
          readonly ppu_dot_count: number;
          readonly frame_number: number;
          readonly scanline: number;
          readonly dot: number;
      }
    | {
          readonly kind: "nmi_edge";
          readonly master_clock_tick: number;
          readonly ppu_dot_count: number;
      }
    | {
          readonly kind: "frame_boundary";
          readonly master_clock_tick: number;
          readonly cpu_cycle_count: number;
          readonly ppu_dot_count: number;
          readonly frame_number: number;
      };

/** Optional observer used by `NesConsole`; it has no browser or runtime dependencies. */
export type NesConsoleTraceSink = (event: NesConsoleTraceEvent) => void;

/**
 * Bounded ring-buffer adapter for console traces. When full, it retains the newest events and counts
 * overwritten entries; tracing is opt-in and does not allocate this buffer in the emulator by default.
 */
export class NesConsoleTraceRecorder {
    readonly #capacity: number;
    readonly #events: (NesConsoleTraceEvent | undefined)[];
    #next_event_index = 0;
    #stored_event_count = 0;
    #dropped_event_count = 0;

    constructor(max_events = DEFAULT_TRACE_CAPACITY) {
        if (!Number.isSafeInteger(max_events) || max_events < 1 || max_events > MAX_TRACE_CAPACITY) {
            throw new RangeError(`Trace capacity must be an integer from 1 through ${MAX_TRACE_CAPACITY}.`);
        }

        this.#capacity = max_events;
        this.#events = new Array<NesConsoleTraceEvent | undefined>(max_events);
    }

    /** Bound method suitable for passing as a console trace sink. */
    readonly record_trace: NesConsoleTraceSink = (event) => {
        this.#events[this.#next_event_index] = copy_trace_event(event);
        this.#next_event_index = (this.#next_event_index + 1) % this.#capacity;

        if (this.#stored_event_count < this.#capacity) {
            this.#stored_event_count += 1;
        } else {
            this.#dropped_event_count += 1;
        }
    };

    /** Returns a chronological snapshot, oldest retained event first. */
    get_events(): readonly NesConsoleTraceEvent[] {
        const events: NesConsoleTraceEvent[] = [];
        const first_event_index = (this.#next_event_index - this.#stored_event_count + this.#capacity) % this.#capacity;

        for (let event_offset = 0; event_offset < this.#stored_event_count; event_offset += 1) {
            const event_index = (first_event_index + event_offset) % this.#capacity;
            const event = this.#events[event_index];

            if (event === undefined) {
                throw new Error("Console trace ring buffer lost an event within its recorded range.");
            }

            events.push(copy_trace_event(event));
        }

        return events;
    }

    get_dropped_event_count(): number {
        return this.#dropped_event_count;
    }

    clear(): void {
        this.#events.fill(undefined);
        this.#next_event_index = 0;
        this.#stored_event_count = 0;
        this.#dropped_event_count = 0;
    }
}

function copy_trace_event(event: NesConsoleTraceEvent): NesConsoleTraceEvent {
    if (event.kind === "cpu_cycle") {
        return { ...event, access: { ...event.access } };
    }

    return { ...event };
}
