/**
 * Bit-free TypeScript mirrors of the GoboScript port helpers in scratch/src.
 *
 * GoboScript has no bitwise operators: "&" joins strings, "%" is Scratch's floored modulo,
 * and "//" is the floor-division block. The ported modules therefore express every mask,
 * shift, and flag test with integer arithmetic. This file repeats those algorithms statement
 * for statement so tests/goboscript-port-algorithms.test.ts can compare them exhaustively
 * against the bitwise TypeScript reference in src/nes/cpu/registers.ts, src/nes/cpu/alu.ts,
 * src/nes/cpu/cpu_2a03.ts, src/nes/cpu/nes_cpu_bus.ts, and src/nes/input/controller.ts.
 *
 * Two rules keep the mirror honest:
 *
 * 1. No bitwise operator may appear in this file. `scratch_mod` and `scratch_floor_divide`
 *    stand in for GoboScript's "%" and "//", whose semantics differ from ECMAScript for
 *    negative operands.
 * 2. Every exported helper must match a GoboScript declaration of the same name and arity.
 *    tests/goboscript-source.test.ts enforces that parity, because editing one side without
 *    the other would silently invalidate the comparison.
 *
 * Mirroring is not compiling: the pinned GoboScript toolchain is still unavailable, so the
 * .gs sources remain compile-unvalidated.
 */

/** Mirror of the `cpu_flag` enum in scratch/src/numeric.gs. */
export const CPU_FLAG = {
    CARRY: 1,
    ZERO: 2,
    INTERRUPT_DISABLE: 4,
    DECIMAL: 8,
    BREAK: 16,
    UNUSED: 32,
    OVERFLOW: 64,
    NEGATIVE: 128,
} as const;

/** Result of an ALU mirror call: the GoboScript procs write `alu_value` and `alu_status`. */
export interface AluResult {
    readonly value: number;
    readonly status: number;
}

/** Scratch's modulo block: the result takes the sign of the divisor, unlike ECMAScript "%". */
export function scratch_mod(left: number, right: number): number {
    const truncated = left % right;

    if (truncated === 0) {
        return 0;
    }

    if ((truncated < 0) === (right < 0)) {
        return truncated;
    }

    return truncated + right;
}

/** GoboScript's "//" operator: floor(a / b), compiled to the plain round-down block. */
export function scratch_floor_divide(left: number, right: number): number {
    return Math.floor(left / right);
}

/** Mirror of `to_number(value)`: forces a list item or other string to a number. */
export function to_number(value: number | string): number {
    const numeric = Number(value);

    if (Number.isNaN(numeric)) {
        return 0;
    }

    return numeric;
}

/** Mirror of `normalize_byte(value)`. */
export function normalize_byte(value: number): number {
    const numeric = to_number(value);

    return scratch_mod(scratch_mod(numeric, 256) + 256, 256);
}

/** Mirror of `normalize_word(value)`. */
export function normalize_word(value: number): number {
    const numeric = to_number(value);

    return scratch_mod(scratch_mod(numeric, 65536) + 65536, 65536);
}

/** Mirror of `to_signed_byte(value)`. */
export function to_signed_byte(value: number): number {
    const byte = normalize_byte(value);

    if (byte >= 128) {
        return byte - 256;
    }

    return byte;
}

/** Mirror of `byte_high(word)`. */
export function byte_high(word: number): number {
    return scratch_floor_divide(normalize_word(word), 256);
}

/** Mirror of `byte_low(word)`. */
export function byte_low(word: number): number {
    return scratch_mod(normalize_word(word), 256);
}

/** Mirror of `join_bytes(high, low)`. */
export function join_bytes(high: number, low: number): number {
    return normalize_byte(high) * 256 + normalize_byte(low);
}

/** Mirror of `bit_at(value, weight)`; the weight must be a power of two. */
export function bit_at(value: number, weight: number): number {
    return scratch_mod(scratch_floor_divide(normalize_word(value), weight), 2);
}

/** Mirror of `bitwise_and(left, right)`; one iteration per bit, as in the ported header. */
export function bitwise_and(left: number, right: number): number {
    let remaining_left = normalize_word(left);
    let remaining_right = normalize_word(right);
    let result = 0;
    let weight = 1;

    for (let iteration = 0; iteration < 16; iteration += 1) {
        if (scratch_mod(remaining_left, 2) === 1 && scratch_mod(remaining_right, 2) === 1) {
            result += weight;
        }

        remaining_left = scratch_floor_divide(remaining_left, 2);
        remaining_right = scratch_floor_divide(remaining_right, 2);
        weight = weight * 2;
    }

    return result;
}

/** Mirror of `bitwise_or(left, right)`. */
export function bitwise_or(left: number, right: number): number {
    let remaining_left = normalize_word(left);
    let remaining_right = normalize_word(right);
    let result = 0;
    let weight = 1;

    for (let iteration = 0; iteration < 16; iteration += 1) {
        if (scratch_mod(remaining_left, 2) === 1 || scratch_mod(remaining_right, 2) === 1) {
            result += weight;
        }

        remaining_left = scratch_floor_divide(remaining_left, 2);
        remaining_right = scratch_floor_divide(remaining_right, 2);
        weight = weight * 2;
    }

    return result;
}

/** Mirror of `bitwise_xor(left, right)`. */
export function bitwise_xor(left: number, right: number): number {
    let remaining_left = normalize_word(left);
    let remaining_right = normalize_word(right);
    let result = 0;
    let weight = 1;

    for (let iteration = 0; iteration < 16; iteration += 1) {
        if (scratch_mod(remaining_left, 2) !== scratch_mod(remaining_right, 2)) {
            result += weight;
        }

        remaining_left = scratch_floor_divide(remaining_left, 2);
        remaining_right = scratch_floor_divide(remaining_right, 2);
        weight = weight * 2;
    }

    return result;
}

/** Mirror of `normalize_status(status)`. */
export function normalize_status(status: number): number {
    const byte = normalize_byte(status);
    const without_break = byte - 16 * bit_at(byte, 16);

    return without_break + 32 * (1 - bit_at(without_break, 32));
}

/** Mirror of `has_status_flag(status, flag)`. */
export function has_status_flag(status: number, flag: number): number {
    return bit_at(normalize_status(status), flag);
}

/** Mirror of `set_status_flag(status, flag, enabled)`; `enabled` is the ported 0/1 form. */
export function set_status_flag(status: number, flag: number, enabled: number): number {
    const normalized = normalize_status(status);
    const current = bit_at(normalized, flag);
    const updated = enabled === 1 ? normalized + flag * (1 - current) : normalized - flag * current;

    return normalize_status(updated);
}

/** Mirror of `update_zero_negative_flags(status, value)`. */
export function update_zero_negative_flags(status: number, value: number): number {
    const byte = normalize_byte(value);
    const zero_enabled = byte === 0 ? 1 : 0;
    const negative_enabled = byte >= 128 ? 1 : 0;
    const with_zero = set_status_flag(status, CPU_FLAG.ZERO, zero_enabled);

    return set_status_flag(with_zero, CPU_FLAG.NEGATIVE, negative_enabled);
}

/** Mirror of `pack_status_for_stack(status, break_enabled)`. */
export function pack_status_for_stack(status: number, break_enabled: number): number {
    const normalized = normalize_status(status);

    if (break_enabled === 1) {
        return bitwise_or(normalized, CPU_FLAG.BREAK);
    }

    return normalized;
}

/** Mirror of `unpack_status_from_stack(status)`. */
export function unpack_status_from_stack(status: number): number {
    return normalize_status(status);
}

/** Mirror of `alu_add_with_carry accumulator, operand, status`. */
export function alu_add_with_carry(accumulator: number, operand: number, status: number): AluResult {
    const left = normalize_byte(accumulator);
    const right = normalize_byte(operand);
    const carry_in = has_status_flag(status, CPU_FLAG.CARRY);
    const sum = left + right + carry_in;
    const value = normalize_byte(sum);
    const signed_sum = to_signed_byte(left) + to_signed_byte(right) + carry_in;
    const carry_enabled = sum > 255 ? 1 : 0;
    const overflow_enabled = signed_sum !== to_signed_byte(value) ? 1 : 0;
    const with_carry = set_status_flag(status, CPU_FLAG.CARRY, carry_enabled);
    const updated = set_status_flag(with_carry, CPU_FLAG.OVERFLOW, overflow_enabled);

    return { value, status: update_zero_negative_flags(updated, value) };
}

/** Mirror of `alu_subtract_with_carry accumulator, operand, status`. */
export function alu_subtract_with_carry(accumulator: number, operand: number, status: number): AluResult {
    const left = normalize_byte(accumulator);
    const right = normalize_byte(operand);
    const carry_in = has_status_flag(status, CPU_FLAG.CARRY);
    const borrow = 1 - carry_in;
    const difference = left - right - borrow;
    const value = normalize_byte(difference);
    const signed_difference = to_signed_byte(left) - to_signed_byte(right) - borrow;
    const carry_enabled = difference >= 0 ? 1 : 0;
    const overflow_enabled = signed_difference !== to_signed_byte(value) ? 1 : 0;
    const with_carry = set_status_flag(status, CPU_FLAG.CARRY, carry_enabled);
    const updated = set_status_flag(with_carry, CPU_FLAG.OVERFLOW, overflow_enabled);

    return { value, status: update_zero_negative_flags(updated, value) };
}

/** Mirror of `alu_and accumulator, operand, status`. */
export function alu_and(accumulator: number, operand: number, status: number): AluResult {
    const value = bitwise_and(normalize_byte(accumulator), normalize_byte(operand));

    return { value, status: update_zero_negative_flags(status, value) };
}

/** Mirror of `alu_ora accumulator, operand, status`. */
export function alu_ora(accumulator: number, operand: number, status: number): AluResult {
    const value = bitwise_or(normalize_byte(accumulator), normalize_byte(operand));

    return { value, status: update_zero_negative_flags(status, value) };
}

/** Mirror of `alu_eor accumulator, operand, status`. */
export function alu_eor(accumulator: number, operand: number, status: number): AluResult {
    const value = bitwise_xor(normalize_byte(accumulator), normalize_byte(operand));

    return { value, status: update_zero_negative_flags(status, value) };
}

/** Mirror of `alu_shift_left value, status`. */
export function alu_shift_left(value: number, status: number): AluResult {
    const byte = normalize_byte(value);
    const shifted = byte * 2;
    const result = normalize_byte(shifted);
    const carry_enabled = shifted > 255 ? 1 : 0;
    const updated = set_status_flag(status, CPU_FLAG.CARRY, carry_enabled);

    return { value: result, status: update_zero_negative_flags(updated, result) };
}

/** Mirror of `alu_shift_right value, status`. */
export function alu_shift_right(value: number, status: number): AluResult {
    const byte = normalize_byte(value);
    const result = scratch_floor_divide(byte, 2);
    const updated = set_status_flag(status, CPU_FLAG.CARRY, scratch_mod(byte, 2));

    return { value: result, status: update_zero_negative_flags(updated, result) };
}

/** Mirror of `alu_rotate_left value, status`. */
export function alu_rotate_left(value: number, status: number): AluResult {
    const byte = normalize_byte(value);
    const carry_in = has_status_flag(status, CPU_FLAG.CARRY);
    const shifted = byte * 2 + carry_in;
    const result = normalize_byte(shifted);
    const carry_enabled = shifted > 255 ? 1 : 0;
    const updated = set_status_flag(status, CPU_FLAG.CARRY, carry_enabled);

    return { value: result, status: update_zero_negative_flags(updated, result) };
}

/** Mirror of `alu_rotate_right value, status`. */
export function alu_rotate_right(value: number, status: number): AluResult {
    const byte = normalize_byte(value);
    const carry_in = has_status_flag(status, CPU_FLAG.CARRY);
    const shifted = byte + carry_in * 256;
    const result = scratch_floor_divide(shifted, 2);
    const updated = set_status_flag(status, CPU_FLAG.CARRY, scratch_mod(shifted, 2));

    return { value: result, status: update_zero_negative_flags(updated, result) };
}

/** Mirror of `alu_compare register_value, operand, status`. */
export function alu_compare(register_value: number, operand: number, status: number): AluResult {
    const left = normalize_byte(register_value);
    const right = normalize_byte(operand);
    const difference = left - right;
    const carry_enabled = difference >= 0 ? 1 : 0;
    const updated = set_status_flag(status, CPU_FLAG.CARRY, carry_enabled);

    return { value: left, status: update_zero_negative_flags(updated, normalize_byte(difference)) };
}

/** Mirror of `alu_bit_test accumulator, operand, status`. */
export function alu_bit_test(accumulator: number, operand: number, status: number): AluResult {
    const left = normalize_byte(accumulator);
    const memory = normalize_byte(operand);
    const tested = bitwise_and(left, memory);
    const zero_enabled = tested === 0 ? 1 : 0;
    const with_zero = set_status_flag(status, CPU_FLAG.ZERO, zero_enabled);
    const with_negative = set_status_flag(with_zero, CPU_FLAG.NEGATIVE, bit_at(memory, 128));
    const updated = set_status_flag(with_negative, CPU_FLAG.OVERFLOW, bit_at(memory, 64));

    return { value: left, status: updated };
}

/** Mirror of `alu_increment value, status`. */
export function alu_increment(value: number, status: number): AluResult {
    const result = normalize_byte(normalize_byte(value) + 1);

    return { value: result, status: update_zero_negative_flags(status, result) };
}

/** Mirror of `alu_decrement value, status`. */
export function alu_decrement(value: number, status: number): AluResult {
    const result = normalize_byte(normalize_byte(value) - 1);

    return { value: result, status: update_zero_negative_flags(status, result) };
}

/**
 * Mirror of scratch/src/controller.gs. Scratch lists are 1-indexed, so the ported header
 * converts a 0/1 controller index to a list position; this mirror keeps zero-based arrays
 * and performs the same conversion implicitly.
 */
export class GoboscriptControllerPorts {
    private readonly button_masks = [0, 0];
    private readonly shift_registers = [0, 0];
    private strobe_high = 0;

    reset(): void {
        this.shift_registers[0] = 0;
        this.shift_registers[1] = 0;
        this.strobe_high = 0;
    }

    set_button_mask(controller_index: 0 | 1, button_mask: number): void {
        this.button_masks[controller_index] = normalize_byte(button_mask);
    }

    button_mask(controller_index: 0 | 1): number {
        return this.button_masks[controller_index] ?? 0;
    }

    serial_read(controller_index: 0 | 1): number {
        if (this.strobe_high === 1) {
            return bitwise_and(this.button_masks[controller_index] ?? 0, 1);
        }

        const shift_register = normalize_byte(this.shift_registers[controller_index] ?? 0);
        this.shift_registers[controller_index] = bitwise_or(scratch_floor_divide(shift_register, 2), 128);

        return bitwise_and(shift_register, 1);
    }

    write_strobe(value: number): void {
        const next_strobe = bitwise_and(normalize_byte(value), 1);

        if (this.strobe_high === 1 && next_strobe === 0) {
            this.shift_registers[0] = normalize_byte(this.button_masks[0] ?? 0);
            this.shift_registers[1] = normalize_byte(this.button_masks[1] ?? 0);
        }

        this.strobe_high = next_strobe;
    }
}

/**
 * Mirror of scratch/src/cpu_bus.gs: RAM with mirroring, the open-bus latch with driven
 * masks, and the controller window. PPU, APU, OAM DMA, and cartridge windows are absent on
 * both sides, so undriven reads return the retained latch and writes are dropped.
 */
export class GoboscriptCpuBus {
    readonly controllers = new GoboscriptControllerPorts();
    private readonly ram = new Array<number>(2048).fill(0);
    private open_bus = 0;

    reset(): void {
        this.open_bus = 0;
    }

    get_open_bus(): number {
        return this.open_bus;
    }

    read(address: number): number {
        const numeric_address = normalize_word(address);

        if (numeric_address < 8192) {
            return this.apply_driven_value(this.ram[scratch_mod(numeric_address, 2048)] ?? 0, 255);
        }

        if (numeric_address < 16384) {
            return this.open_bus;
        }

        if (numeric_address < 16416) {
            return this.read_io(numeric_address);
        }

        return this.open_bus;
    }

    write(address: number, value: number): void {
        const numeric_address = normalize_word(address);
        const numeric_value = normalize_byte(value);
        this.open_bus = numeric_value;

        if (numeric_address < 8192) {
            this.ram[scratch_mod(numeric_address, 2048)] = numeric_value;
        }

        if (numeric_address === 16406) {
            this.controllers.write_strobe(numeric_value);
        }
    }

    private read_io(address: number): number {
        if (address === 16406) {
            return this.apply_driven_value(this.controllers.serial_read(0), 1);
        }

        if (address === 16407) {
            return this.apply_driven_value(this.controllers.serial_read(1), 1);
        }

        return this.open_bus;
    }

    private apply_driven_value(value: number, driven_mask: number): number {
        const driven = normalize_byte(driven_mask);
        const undriven = bitwise_xor(255, driven);
        const driven_bits = bitwise_and(normalize_byte(value), driven);
        const retained_bits = bitwise_and(this.open_bus, undriven);
        const merged = bitwise_or(driven_bits, retained_bits);
        this.open_bus = merged;

        return merged;
    }
}

/** Mirror of the `cartridge_limit` enum in scratch/src/cartridge.gs. */
export const CARTRIDGE_LIMIT = {
    MAX_IMAGE_BYTES: 33_554_432,
    HEADER_BYTES: 16,
    TRAINER_BYTES: 512,
    PRG_BANK_BYTES: 16_384,
    CHR_BANK_BYTES: 8_192,
    LEGACY_PRG_RAM_BANK_BYTES: 8_192,
    RAM_SHIFT_BASE_BYTES: 64,
    MAX_SAFE_INTEGER: 9_007_199_254_740_991,
} as const;

/** Mirror of the `cartridge_error` enum in scratch/src/cartridge.gs. */
export const CARTRIDGE_ERROR = {
    NONE: 0,
    TRUNCATED_HEADER: 1,
    INVALID_MAGIC: 2,
    UNSUPPORTED_VERSION: 3,
    INVALID_ROM_SIZE: 4,
    IMAGE_TOO_LARGE: 5,
    TRUNCATED_PAYLOAD: 6,
} as const;

/**
 * Mirror of scratch/src/cartridge.gs. The ported proc reads a 16-item header list plus an
 * image length and writes eighteen `cartridge_*` globals, because a Scratch custom block can
 * take no list argument and return no tuple; this class keeps the same shape so the arity
 * parity check in tests/goboscript-source.test.ts stays meaningful.
 */
export class GoboscriptCartridgeParser {
    readonly header: number[] = new Array<number>(CARTRIDGE_LIMIT.HEADER_BYTES).fill(0);
    image_bytes = 0;
    ok = 0;
    error_code = 0;
    format = 0;
    mapper_id = 0;
    submapper = 0;
    mirroring = 0;
    battery_backed = 0;
    has_trainer = 0;
    prg_rom_bytes = 0;
    chr_rom_bytes = 0;
    prg_ram_bytes = 0;
    prg_nvram_bytes = 0;
    chr_ram_bytes = 0;
    chr_nvram_bytes = 0;
    trainer_offset = 0;
    prg_rom_offset = 0;
    chr_rom_offset = 0;
    payload_end = 0;

    /** Mirror of `header_byte(index)`; the argument is a 0-based header index. */
    header_byte(index: number): number {
        // The ported func reads cartridge_header[index + 1] from a 1-indexed Scratch list.
        return normalize_byte(this.header[index] ?? 0);
    }

    /** Mirror of `cartridge_has_magic()`. */
    cartridge_has_magic(): number {
        if (this.header_byte(0) !== 78) {
            return 0;
        }

        if (this.header_byte(1) !== 69) {
            return 0;
        }

        if (this.header_byte(2) !== 83) {
            return 0;
        }

        if (this.header_byte(3) !== 26) {
            return 0;
        }

        return 1;
    }

    /** Mirror of `cartridge_reset_results`. */
    reset(): void {
        this.ok = 0;
        this.error_code = 0;
        this.format = 0;
        this.mapper_id = 0;
        this.submapper = 0;
        this.mirroring = 0;
        this.battery_backed = 0;
        this.has_trainer = 0;
        this.prg_rom_bytes = 0;
        this.chr_rom_bytes = 0;
        this.prg_ram_bytes = 0;
        this.prg_nvram_bytes = 0;
        this.chr_ram_bytes = 0;
        this.chr_nvram_bytes = 0;
        this.trainer_offset = 0;
        this.prg_rom_offset = 0;
        this.chr_rom_offset = 0;
        this.payload_end = 0;
    }

    /** Mirror of `cartridge_fail error_code`. */
    fail(error_code: number): void {
        this.reset();
        this.error_code = error_code;
    }

    /** Mirror of `cartridge_parse_header`, including the TypeScript reference's check order. */
    parse(): void {
        const image_bytes = to_number(this.image_bytes);
        const flags6 = this.header_byte(6);
        const flags7 = this.header_byte(7);
        const version_bits = bitwise_and(flags7, 12);
        const prg_banks = this.header_byte(4);
        const chr_banks = this.header_byte(5);
        const prg_ram_banks = this.header_byte(8);
        const size_high = this.header_byte(9);
        const ram_sizes = this.header_byte(10);
        const chr_ram_sizes = this.header_byte(11);
        let is_nes2 = 0;
        let prg_rom_bytes = 0;
        let chr_rom_bytes = 0;
        let prg_ram_bytes = 0;
        let prg_nvram_bytes = 0;
        let chr_ram_bytes = 0;
        let chr_nvram_bytes = 0;
        this.reset();

        if (image_bytes > CARTRIDGE_LIMIT.MAX_IMAGE_BYTES) {
            this.fail(CARTRIDGE_ERROR.IMAGE_TOO_LARGE);
            return;
        }

        if (image_bytes < CARTRIDGE_LIMIT.HEADER_BYTES) {
            this.fail(CARTRIDGE_ERROR.TRUNCATED_HEADER);
            return;
        }

        if (this.cartridge_has_magic() === 0) {
            this.fail(CARTRIDGE_ERROR.INVALID_MAGIC);
            return;
        }

        if (version_bits !== 0 && version_bits !== 8) {
            this.fail(CARTRIDGE_ERROR.UNSUPPORTED_VERSION);
            return;
        }

        if (version_bits === 8) {
            is_nes2 = 1;
            this.format = 2;
        } else {
            this.format = 1;
        }

        const low_mapper_nibble = bitwise_and(scratch_floor_divide(flags6, 16), 15);
        const high_mapper_bits = bitwise_and(flags7, 240);
        this.mapper_id = bitwise_or(low_mapper_nibble, high_mapper_bits);
        this.has_trainer = bit_at(flags6, 4);
        this.battery_backed = bit_at(flags6, 2);

        if (bit_at(flags6, 8) === 1) {
            this.mirroring = 3;
        } else if (bit_at(flags6, 1) === 1) {
            this.mirroring = 2;
        } else {
            this.mirroring = 1;
        }

        if (is_nes2 === 1) {
            const nes2_mapper_bits = bitwise_and(prg_ram_banks, 15) * 256;
            this.mapper_id = bitwise_or(this.mapper_id, nes2_mapper_bits);
            this.submapper = scratch_floor_divide(prg_ram_banks, 16);
            prg_rom_bytes = decode_nes2_rom_size(
                prg_banks,
                bitwise_and(size_high, 15),
                CARTRIDGE_LIMIT.PRG_BANK_BYTES,
            );
            chr_rom_bytes = decode_nes2_rom_size(
                chr_banks,
                scratch_floor_divide(size_high, 16),
                CARTRIDGE_LIMIT.CHR_BANK_BYTES,
            );
            prg_ram_bytes = decode_nes2_ram_size(bitwise_and(ram_sizes, 15));
            prg_nvram_bytes = decode_nes2_ram_size(scratch_floor_divide(ram_sizes, 16));
            chr_ram_bytes = decode_nes2_ram_size(bitwise_and(chr_ram_sizes, 15));
            chr_nvram_bytes = decode_nes2_ram_size(scratch_floor_divide(chr_ram_sizes, 16));
        } else {
            prg_rom_bytes = prg_banks * CARTRIDGE_LIMIT.PRG_BANK_BYTES;
            chr_rom_bytes = chr_banks * CARTRIDGE_LIMIT.CHR_BANK_BYTES;

            const legacy_banks = prg_ram_banks === 0 ? 1 : prg_ram_banks;
            const legacy_prg_ram_bytes = legacy_banks * CARTRIDGE_LIMIT.LEGACY_PRG_RAM_BANK_BYTES;

            if (this.battery_backed === 1) {
                prg_nvram_bytes = legacy_prg_ram_bytes;
            } else {
                prg_ram_bytes = legacy_prg_ram_bytes;
            }

            if (chr_rom_bytes === 0) {
                chr_ram_bytes = CARTRIDGE_LIMIT.CHR_BANK_BYTES;
            }
        }

        if (prg_rom_bytes <= 0 || chr_rom_bytes < 0) {
            this.fail(CARTRIDGE_ERROR.INVALID_ROM_SIZE);
            return;
        }

        if (is_safe_size(prg_rom_bytes) === 0 || is_safe_size(chr_rom_bytes) === 0) {
            this.fail(CARTRIDGE_ERROR.INVALID_ROM_SIZE);
            return;
        }

        const trainer_offset = CARTRIDGE_LIMIT.HEADER_BYTES;
        const prg_rom_offset = trainer_offset + this.has_trainer * CARTRIDGE_LIMIT.TRAINER_BYTES;
        const chr_rom_offset = prg_rom_offset + prg_rom_bytes;
        const payload_end = chr_rom_offset + chr_rom_bytes;

        if (is_safe_size(payload_end) === 0) {
            this.fail(CARTRIDGE_ERROR.INVALID_ROM_SIZE);
            return;
        }

        if (payload_end > CARTRIDGE_LIMIT.MAX_IMAGE_BYTES) {
            this.fail(CARTRIDGE_ERROR.IMAGE_TOO_LARGE);
            return;
        }

        if (payload_end > image_bytes) {
            this.fail(CARTRIDGE_ERROR.TRUNCATED_PAYLOAD);
            return;
        }

        this.prg_rom_bytes = prg_rom_bytes;
        this.chr_rom_bytes = chr_rom_bytes;
        this.prg_ram_bytes = prg_ram_bytes;
        this.prg_nvram_bytes = prg_nvram_bytes;
        this.chr_ram_bytes = chr_ram_bytes;
        this.chr_nvram_bytes = chr_nvram_bytes;
        this.trainer_offset = trainer_offset;
        this.prg_rom_offset = prg_rom_offset;
        this.chr_rom_offset = chr_rom_offset;
        this.payload_end = payload_end;
        this.error_code = CARTRIDGE_ERROR.NONE;
        this.ok = 1;
    }

    /** The eighteen reported values, in shared vector suite 9 field order. */
    reported_values(): number[] {
        return [
            this.ok,
            this.error_code,
            this.format,
            this.mapper_id,
            this.submapper,
            this.mirroring,
            this.battery_backed,
            this.has_trainer,
            this.prg_rom_bytes,
            this.chr_rom_bytes,
            this.prg_ram_bytes,
            this.prg_nvram_bytes,
            this.chr_ram_bytes,
            this.chr_nvram_bytes,
            this.trainer_offset,
            this.prg_rom_offset,
            this.chr_rom_offset,
            this.payload_end,
        ];
    }
}

/** Mirror of `power_of_two(exponent)`. */
export function power_of_two(exponent: number): number {
    let result = 1;

    for (let iteration = 0; iteration < exponent; iteration += 1) {
        result = result * 2;
    }

    return result;
}

/** Mirror of `is_safe_size(value)`. */
export function is_safe_size(value: number): number {
    const numeric = to_number(value);

    if (numeric > CARTRIDGE_LIMIT.MAX_SAFE_INTEGER) {
        return 0;
    }

    if (numeric < 0 - CARTRIDGE_LIMIT.MAX_SAFE_INTEGER) {
        return 0;
    }

    return 1;
}

/** Mirror of `decode_nes2_rom_size(low_byte, high_nibble, bank_bytes)`; -1 means undefined. */
export function decode_nes2_rom_size(low_byte: number, high_nibble: number, bank_bytes: number): number {
    if (high_nibble !== 15) {
        return (high_nibble * 256 + low_byte) * bank_bytes;
    }

    const exponent = scratch_floor_divide(low_byte, 4);
    const multiplier = scratch_mod(low_byte, 4) * 2 + 1;
    const size_bytes = power_of_two(exponent) * multiplier;

    if (is_safe_size(size_bytes) === 0) {
        return -1;
    }

    return size_bytes;
}

/** Mirror of `decode_nes2_ram_size(shift)`. */
export function decode_nes2_ram_size(shift: number): number {
    if (shift === 0) {
        return 0;
    }

    return CARTRIDGE_LIMIT.RAM_SHIFT_BASE_BYTES * power_of_two(shift);
}
