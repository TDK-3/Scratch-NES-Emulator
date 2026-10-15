import type { CpuBus, CpuBusAccess, CpuBusDeviceRead, CpuOamDmaCycle } from "./cpu_bus.js";

const CPU_ADDRESS_SPACE_BYTES = 0x1_0000;
const MAX_CPU_ADDRESS = CPU_ADDRESS_SPACE_BYTES - 1;
const CPU_RAM_BYTES = 0x0800;
const CPU_RAM_ADDRESS_MASK = CPU_RAM_BYTES - 1;
const PPU_REGISTER_MASK = 0x0007;
const FULL_BYTE_MASK = 0xff;
const APU_FIRST_WRITE_ADDRESS = 0x4000;
const APU_LAST_WRITE_ADDRESS = 0x4013;
const APU_STATUS_ADDRESS = 0x4015;
const OAM_DMA_ADDRESS = 0x4014;
const CONTROLLER_STROBE_ADDRESS = 0x4016;
const APU_FRAME_COUNTER_ADDRESS = 0x4017;
const CARTRIDGE_FIRST_ADDRESS = 0x4020;
const OAM_DATA_ADDRESS = 0x2004;
const OAM_DMA_TRANSFER_BYTES = 0x0100;
const DMC_SAMPLE_ADDRESS_MIN = 0x8000;

type OamDmaPhase = "halt" | "align" | "read" | "write";
type DmcDmaPhase = "halt" | "dummy" | "align" | "get";

interface OamDmaState {
    readonly page: number;
    readonly needs_alignment_cycle: boolean;
    phase: OamDmaPhase;
    index: number;
    data_latch: number;
    sequence_cycle: number;
}

interface DmcDmaState {
    readonly address: number;
    readonly needs_alignment_cycle: boolean;
    phase: DmcDmaPhase;
    sequence_cycle: number;
}

/** CPU-facing PPU register access. The register index is always in the range zero through seven. */
export interface PpuCpuRegisterPort {
    read_cpu_register(register_index: number, open_bus: number): CpuBusDeviceRead;
    write_cpu_register(register_index: number, value: number): void;
}

/** CPU-facing APU registers. Writes are limited to $4000-$4013, $4015, and $4017. */
export interface ApuCpuPort {
    read_status(open_bus: number): CpuBusDeviceRead;
    write_register(address: number, value: number): void;
    /** Supplies a pending DMC sample-fetch address to the CPU bus. */
    get_dmc_dma_request_address?(): number | null;
    /** Completes a DMC sample fetch performed by the CPU bus. */
    complete_dmc_dma_read?(value: number): void;
    /** Level of the APU's combined frame-counter and DMC IRQ output. */
    is_irq_asserted?(): boolean;
}

/** CPU-facing serial controller ports. */
export interface ControllerCpuPort {
    read_controller(controller_index: 0 | 1, open_bus: number): CpuBusDeviceRead;
    write_strobe(value: number): void;
}

/** Cartridge CPU window, beginning at $4020. */
export interface CartridgeCpuPort {
    read_cpu(address: number, open_bus: number): CpuBusDeviceRead;
    write_cpu(address: number, value: number): void;
}

/** Devices connected to the production CPU address map. */
export interface NesCpuBusDevices {
    readonly ppu: PpuCpuRegisterPort;
    readonly apu: ApuCpuPort;
    readonly controllers: ControllerCpuPort;
    readonly cartridge: CartridgeCpuPort;
}

/**
 * NES CPU address decoder for RAM, PPU registers, I/O, and cartridge space.
 *
 * Unimplemented/undriven reads return the CPU data-bus latch, initially zero. Device reads can specify
 * driven data lines so controller/open-bus bits retain the previous latch value. Writes latch their byte
 * even when sent to an unmapped register. A $4014 write starts an OAM DMA transfer exposed one cycle at a time.
 */
export class NesCpuBus implements CpuBus {
    readonly #devices: NesCpuBusDevices;
    readonly #ram = new Uint8Array(CPU_RAM_BYTES);
    #open_bus = 0;
    #cpu_cycle_count = 0;
    #oam_dma: OamDmaState | undefined = undefined;
    #dmc_dma: DmcDmaState | undefined = undefined;

    constructor(devices: NesCpuBusDevices) {
        this.#devices = devices;
    }

    /** Clears bus latches and pending DMA state without erasing CPU RAM or cartridge memory. */
    reset(): void {
        this.#open_bus = 0;
        this.#cpu_cycle_count = 0;
        this.#oam_dma = undefined;
        this.#dmc_dma = undefined;
    }

    /** Returns the APU IRQ level so the console scheduler can drive the CPU's IRQ input. */
    is_apu_irq_asserted(): boolean {
        return this.#devices.apu.is_irq_asserted?.() ?? false;
    }

    read_cpu(address: number): number {
        assert_cpu_address(address);
        this.#cpu_cycle_count += 1;

        if (address < 0x2000) {
            return this.#read_driven_value(this.#read_ram(address));
        }

        if (address < 0x4000) {
            const register_index = address & PPU_REGISTER_MASK;
            return this.#read_device(this.#devices.ppu.read_cpu_register(register_index, this.#open_bus));
        }

        if (address < CARTRIDGE_FIRST_ADDRESS) {
            return this.#read_io(address);
        }

        return this.#read_device(this.#devices.cartridge.read_cpu(address, this.#open_bus));
    }

    write_cpu(address: number, value: number): void {
        assert_cpu_address(address);
        assert_byte_value(value);
        this.#cpu_cycle_count += 1;
        this.#open_bus = value;

        if (address < 0x2000) {
            this.#write_ram(address, value);
            return;
        }

        if (address < 0x4000) {
            const register_index = address & PPU_REGISTER_MASK;
            this.#devices.ppu.write_cpu_register(register_index, value);
            return;
        }

        if (address < CARTRIDGE_FIRST_ADDRESS) {
            this.#write_io(address, value);
            return;
        }

        this.#devices.cartridge.write_cpu(address, value);
    }

    /** Runs one active DMC/OAM DMA cycle, giving a DMC fetch priority over an OAM get. */
    clock_cpu_dma_cycle(held_read_address: number): CpuOamDmaCycle | null {
        assert_cpu_address(held_read_address);

        if (this.#dmc_dma === undefined) {
            const address = this.#devices.apu.get_dmc_dma_request_address?.() ?? null;

            if (address !== null) {
                assert_cpu_address(address);

                if (address < DMC_SAMPLE_ADDRESS_MIN || this.#devices.apu.complete_dmc_dma_read === undefined) {
                    throw new TypeError("The APU exposed an invalid DMC DMA request or no completion callback.");
                }

                this.#dmc_dma = {
                    address,
                    needs_alignment_cycle: this.#cpu_cycle_count % 2 === 0,
                    phase: "halt",
                    sequence_cycle: 0,
                };
            }
        }

        if (this.#oam_dma !== undefined) {
            return this.#clock_oam_dma_with_dmc(held_read_address);
        }

        if (this.#dmc_dma !== undefined) {
            return this.#clock_dmc_only(held_read_address);
        }

        return null;
    }

    /** Compatibility alias for callers that only need OAM DMA stepping. */
    clock_oam_dma_cycle(held_read_address: number): CpuOamDmaCycle | null {
        return this.clock_cpu_dma_cycle(held_read_address);
    }

    #clock_oam_dma_with_dmc(held_read_address: number): CpuOamDmaCycle | null {
        const dmc = this.#dmc_dma;
        const oam = this.#oam_dma;

        if (oam === undefined) {
            return dmc === undefined ? null : this.#clock_dmc_only(held_read_address);
        }

        if (dmc?.phase === "get") {
            const value = this.read_cpu(dmc.address);
            this.#devices.apu.complete_dmc_dma_read?.(value);
            this.#dmc_dma = undefined;

            if (oam.phase === "read" || oam.phase === "halt" || oam.phase === "align") {
                oam.phase = "align";
            }

            oam.sequence_cycle += 1;
            return {
                dma_kind: "dmc",
                sequence_cycle: oam.sequence_cycle,
                sequence_completed: false,
                access: { kind: "read", address: dmc.address, value },
            };
        }

        const oam_cycle = this.#clock_oam_dma_transfer_cycle(held_read_address);

        if (dmc !== undefined) {
            this.#advance_dmc_dma(dmc);
            dmc.sequence_cycle += 1;
        }

        return oam_cycle;
    }

    #clock_dmc_only(held_read_address: number): CpuOamDmaCycle {
        const dmc = this.#dmc_dma;

        if (dmc === undefined) {
            throw new Error("Cannot clock a DMC DMA cycle when no DMC fetch is active.");
        }

        let access: CpuBusAccess;

        if (dmc.phase === "get") {
            const value = this.read_cpu(dmc.address);
            this.#devices.apu.complete_dmc_dma_read?.(value);
            access = { kind: "read", address: dmc.address, value };
            this.#dmc_dma = undefined;
        } else {
            access = read_access(this, held_read_address);
            this.#advance_dmc_dma(dmc);
        }

        dmc.sequence_cycle += 1;
        return {
            dma_kind: "dmc",
            sequence_cycle: dmc.sequence_cycle,
            sequence_completed: this.#dmc_dma === undefined,
            access,
        };
    }

    #advance_dmc_dma(dma: DmcDmaState): void {
        switch (dma.phase) {
            case "halt":
                dma.phase = "dummy";
                return;
            case "dummy":
                dma.phase = dma.needs_alignment_cycle ? "align" : "get";
                return;
            case "align":
                dma.phase = "get";
                return;
            case "get":
                throw new Error("A DMC get cycle must complete the active DMA instead of advancing it.");
        }
    }

    #clock_oam_dma_transfer_cycle(held_read_address: number): CpuOamDmaCycle {
        const dma = this.#oam_dma;

        if (dma === undefined) {
            throw new Error("Cannot clock an OAM DMA cycle when no OAM transfer is active.");
        }

        let access: CpuBusAccess;
        let sequence_completed = false;

        switch (dma.phase) {
            case "halt":
                access = read_access(this, held_read_address);
                dma.phase = dma.needs_alignment_cycle ? "align" : "read";
                break;
            case "align":
                access = read_access(this, held_read_address);
                dma.phase = "read";
                break;
            case "read": {
                const address = (dma.page << 8) | dma.index;
                const value = this.read_cpu(address);
                dma.data_latch = value;
                dma.phase = "write";
                access = { kind: "read", address, value };
                break;
            }
            case "write":
                this.write_cpu(OAM_DATA_ADDRESS, dma.data_latch);
                access = { kind: "write", address: OAM_DATA_ADDRESS, value: dma.data_latch };
                dma.index += 1;

                if (dma.index === OAM_DMA_TRANSFER_BYTES) {
                    sequence_completed = true;
                } else {
                    dma.phase = "read";
                }
                break;
        }

        dma.sequence_cycle += 1;
        const sequence_cycle = dma.sequence_cycle;

        if (sequence_completed) {
            this.#oam_dma = undefined;
        }

        return { dma_kind: "oam", sequence_cycle, sequence_completed, access };
    }

    #read_io(address: number): number {
        if (address === APU_STATUS_ADDRESS) {
            return this.#read_device(this.#devices.apu.read_status(this.#open_bus));
        }

        if (address === CONTROLLER_STROBE_ADDRESS) {
            return this.#read_device(this.#devices.controllers.read_controller(0, this.#open_bus));
        }

        if (address === APU_FRAME_COUNTER_ADDRESS) {
            return this.#read_device(this.#devices.controllers.read_controller(1, this.#open_bus));
        }

        return this.#open_bus;
    }

    #write_io(address: number, value: number): void {
        if (address >= APU_FIRST_WRITE_ADDRESS && address <= APU_LAST_WRITE_ADDRESS) {
            this.#devices.apu.write_register(address, value);
            return;
        }

        if (address === APU_STATUS_ADDRESS || address === APU_FRAME_COUNTER_ADDRESS) {
            this.#devices.apu.write_register(address, value);
            return;
        }

        if (address === CONTROLLER_STROBE_ADDRESS) {
            this.#devices.controllers.write_strobe(value);
            return;
        }

        if (address === OAM_DMA_ADDRESS) {
            this.#oam_dma = {
                page: value,
                needs_alignment_cycle: this.#cpu_cycle_count % 2 === 1,
                phase: "halt",
                index: 0,
                data_latch: 0,
                sequence_cycle: 0,
            };
            return;
        }

        // $4018-$401F are disabled/unmapped here.
    }

    #read_ram(address: number): number {
        const value = this.#ram[address & CPU_RAM_ADDRESS_MASK];

        if (value === undefined) {
            throw new RangeError(`CPU RAM address ${address} is outside the internal RAM window.`);
        }

        return value;
    }

    #write_ram(address: number, value: number): void {
        this.#ram[address & CPU_RAM_ADDRESS_MASK] = value;
    }

    #read_driven_value(value: number): number {
        return this.#read_device({ value, driven_mask: FULL_BYTE_MASK });
    }

    #read_device(read: CpuBusDeviceRead): number {
        if (read === null) {
            return this.#open_bus;
        }

        assert_byte_value(read.value, "Mapped device returned a non-byte value");
        assert_byte_value(read.driven_mask, "Mapped device returned an invalid data-line mask");

        const undriven_mask = FULL_BYTE_MASK ^ read.driven_mask;
        const value = (read.value & read.driven_mask) | (this.#open_bus & undriven_mask);
        this.#open_bus = value;

        return value;
    }
}

function read_access(bus: CpuBus, address: number): CpuBusAccess {
    return { kind: "read", address, value: bus.read_cpu(address) };
}

function assert_cpu_address(address: number): void {
    if (!Number.isInteger(address) || address < 0 || address > MAX_CPU_ADDRESS) {
        throw new RangeError(`CPU address ${address} is outside the 16-bit address space.`);
    }
}

function assert_byte_value(value: number, message = "CPU bus value is outside the byte range"): void {
    if (!Number.isInteger(value) || value < 0 || value > FULL_BYTE_MASK) {
        throw new RangeError(`${message}: ${value}.`);
    }
}
