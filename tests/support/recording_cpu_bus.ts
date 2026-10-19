import type { CpuBus } from "../../src/nes/cpu/cpu_bus.js";
import type { NesCpuBusDevices } from "../../src/nes/cpu/nes_cpu_bus.js";

/**
 * Shared helpers for projecting a production CPU run onto the flat shared port vectors.
 *
 * The reference modules expose their bus traffic only through a `CpuBus`, so a vector that has
 * to pin access order wraps the decoder in a recorder. Setup bytes are written through
 * `prepare()`, which does not record, so a vector's trace starts at the first cycle the
 * sequence actually spends.
 */

/** One recorded transaction, so a projection can pin bus order as well as results. */
export class RecordingCpuBus implements CpuBus {
    readonly accesses: { readonly kind: "read" | "write"; readonly address: number; readonly value: number }[] = [];

    constructor(private readonly inner: CpuBus) {}

    read_cpu(address: number): number {
        const value = this.inner.read_cpu(address);
        this.accesses.push({ kind: "read", address, value });
        return value;
    }

    write_cpu(address: number, value: number): void {
        this.inner.write_cpu(address, value);
        this.accesses.push({ kind: "write", address, value });
    }

    /** Writes setup bytes without recording them, matching a vector's pre-sequence state. */
    prepare(address: number, value: number): void {
        this.inner.write_cpu(address, value);
    }

    clear(): void {
        this.accesses.length = 0;
    }
}

/**
 * Returns decoder devices that are all absent, so every non-RAM window reads open bus. The
 * ported decoder in scratch/src/cpu_bus.gs behaves the same way for the PPU, APU, and
 * cartridge windows, which is what makes these vectors replayable on both sides.
 */
export function make_absent_bus_devices(): NesCpuBusDevices {
    return {
        ppu: {
            read_cpu_register: () => null,
            write_cpu_register: () => {},
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
    };
}

/** Flattens recorded transactions into the (kind, address, value) triples a vector expects. */
export function flatten_access_trace(
    accesses: readonly { readonly kind: "read" | "write"; readonly address: number; readonly value: number }[],
): number[] {
    const trace: number[] = [];

    for (const access of accesses) {
        trace.push(access.kind === "read" ? 0 : 1, access.address, access.value);
    }

    return trace;
}
