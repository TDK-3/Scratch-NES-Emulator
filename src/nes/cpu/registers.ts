export interface CpuRegisters {
    a: number;
    x: number;
    y: number;
    stack_pointer: number;
    program_counter: number;
    status: number;
}

export const CARRY_FLAG = 0x01;
export const ZERO_FLAG = 0x02;
export const INTERRUPT_DISABLE_FLAG = 0x04;
export const DECIMAL_FLAG = 0x08;
export const BREAK_FLAG = 0x10;
export const UNUSED_FLAG = 0x20;
export const OVERFLOW_FLAG = 0x40;
export const NEGATIVE_FLAG = 0x80;

export type CpuStatusFlag =
    | typeof CARRY_FLAG
    | typeof ZERO_FLAG
    | typeof INTERRUPT_DISABLE_FLAG
    | typeof DECIMAL_FLAG
    | typeof OVERFLOW_FLAG
    | typeof NEGATIVE_FLAG;

export type StatusStackSource = "brk" | "irq" | "nmi";

const BYTE_MODULUS = 256;
const WORD_MODULUS = 65_536;

/** Wraps an integer into the unsigned byte range. */
export function normalize_byte(value: number): number {
    if (!Number.isSafeInteger(value)) {
        throw new RangeError("CPU byte values must be safe integers.");
    }

    return ((value % BYTE_MODULUS) + BYTE_MODULUS) % BYTE_MODULUS;
}

/** Wraps an integer into the unsigned 16-bit address range. */
export function normalize_word(value: number): number {
    if (!Number.isSafeInteger(value)) {
        throw new RangeError("CPU addresses must be safe integers.");
    }

    return ((value % WORD_MODULUS) + WORD_MODULUS) % WORD_MODULUS;
}

/** Converts an 8-bit value to its signed two's-complement value. */
export function to_signed_byte(value: number): number {
    const byte = normalize_byte(value);
    return byte >= 0x80 ? byte - BYTE_MODULUS : byte;
}

/** Keeps the unused status bit set and the stack-only break bit clear. */
export function normalize_status(status: number): number {
    return (normalize_byte(status) | UNUSED_FLAG) & ~BREAK_FLAG;
}

/** Packs the break bit only for a software BRK stack push. */
export function pack_status_for_stack(status: number, source: StatusStackSource): number {
    const normalized_status = normalize_status(status);

    return source === "brk" ? normalized_status | BREAK_FLAG : normalized_status;
}

/** Restores an internal status value from a stack byte. */
export function unpack_status_from_stack(status: number): number {
    return normalize_status(status);
}

/** Reads an internal CPU status flag. */
export function has_status_flag(status: number, flag: CpuStatusFlag): boolean {
    return (normalize_status(status) & flag) !== 0;
}

/** Sets or clears an internal CPU status flag. */
export function set_status_flag(status: number, flag: CpuStatusFlag, enabled: boolean): number {
    const normalized_status = normalize_status(status);
    const updated_status = enabled ? normalized_status | flag : normalized_status & ~flag;

    return normalize_status(updated_status);
}

/** Updates the zero and negative flags from an 8-bit result. */
export function update_zero_negative_flags(status: number, value: number): number {
    const byte = normalize_byte(value);
    let updated_status = normalize_status(status);

    updated_status = set_status_flag(updated_status, ZERO_FLAG, byte === 0);
    updated_status = set_status_flag(updated_status, NEGATIVE_FLAG, (byte & NEGATIVE_FLAG) !== 0);

    return updated_status;
}
