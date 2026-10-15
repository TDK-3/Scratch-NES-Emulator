import type { CpuBus, CpuBusAccess } from "../../src/nes/cpu/cpu_bus.js";

const ADDRESS_SPACE_BYTES = 65_536;
const MAX_CPU_ADDRESS = ADDRESS_SPACE_BYTES - 1;

/** In-memory CPU bus with deterministic zero-fill and an ordered access trace. */
export class FakeCpuBus implements CpuBus {
    readonly accesses: CpuBusAccess[] = [];
    readonly #memory = new Uint8Array(ADDRESS_SPACE_BYTES);

    read_cpu(address: number): number {
        assert_cpu_address(address);

        const value = this.#memory[address];

        if (value === undefined) {
            throw new RangeError(`CPU address ${address} is outside the fake bus.`);
        }

        this.accesses.push({ kind: "read", address, value });
        return value;
    }

    write_cpu(address: number, value: number): void {
        assert_cpu_address(address);
        assert_byte_value(value);

        this.#memory[address] = value;
        this.accesses.push({ kind: "write", address, value });
    }

    load(start_address: number, data: Uint8Array): void {
        assert_cpu_address(start_address);

        if (start_address + data.byteLength > ADDRESS_SPACE_BYTES) {
            throw new RangeError("Loaded bytes extend beyond the fake bus address space.");
        }

        this.#memory.set(data, start_address);
    }

    peek(address: number): number {
        assert_cpu_address(address);

        const value = this.#memory[address];

        if (value === undefined) {
            throw new RangeError(`CPU address ${address} is outside the fake bus.`);
        }

        return value;
    }

    clear_trace(): void {
        this.accesses.length = 0;
    }
}

function assert_cpu_address(address: number): void {
    if (!Number.isInteger(address) || address < 0 || address > MAX_CPU_ADDRESS) {
        throw new RangeError(`CPU address ${address} is outside the 16-bit address space.`);
    }
}

function assert_byte_value(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
        throw new RangeError(`CPU bus value ${value} is outside the byte range.`);
    }
}
