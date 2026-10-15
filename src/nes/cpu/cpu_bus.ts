/** A value and data-line mask returned by a mapped device read. */
export interface CpuBusReadValue {
    readonly value: number;
    /** Set bits identify data lines driven by the device; unset lines retain CPU open bus. */
    readonly driven_mask: number;
}

/** `null` means that the mapped device drives no data lines. */
export type CpuBusDeviceRead = CpuBusReadValue | null;

/** One CPU cycle consumed by an active OAM or DMC DMA sequence. */
export interface CpuDmaCycle {
    /** Identifies the DMA unit consuming this CPU cycle when the bus can distinguish it. */
    readonly dma_kind?: "dmc" | "oam";
    /** 1-based cycle index within the active OAM transfer or standalone DMC fetch. */
    readonly sequence_cycle: number;
    readonly sequence_completed: boolean;
    readonly access: CpuBusAccess;
}

/** @deprecated Use `CpuDmaCycle`, which also covers DMC fetches. */
export type CpuOamDmaCycle = CpuDmaCycle;

export interface CpuBus {
    /** Reads one byte from a valid 16-bit CPU address. */
    read_cpu(address: number): number;

    /** Writes one byte to a valid 16-bit CPU address. */
    write_cpu(address: number, value: number): void;

    /** Performs one pending CPU DMA cycle (DMC has priority over OAM), if any. */
    clock_cpu_dma_cycle?(held_read_address: number): CpuDmaCycle | null;

    /** Performs one pending OAM DMA cycle; retained for existing bus adapters. */
    clock_oam_dma_cycle?(held_read_address: number): CpuOamDmaCycle | null;
}

/** A successful CPU bus transaction recorded by a debug/test adapter. */
export type CpuBusAccess =
    | { readonly kind: "read"; readonly address: number; readonly value: number }
    | { readonly kind: "write"; readonly address: number; readonly value: number };
