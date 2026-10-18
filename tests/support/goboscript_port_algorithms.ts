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

    /** Mirror of `cpu_bus_clear_ram`. */
    clear_ram(): void {
        this.ram.fill(0);
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

/** Mirror of the `cpu_addressing_mode` enum in scratch/src/cpu_addressing.gs. */
export const CPU_ADDRESSING_MODE = {
    IMPLIED: 1,
    ACCUMULATOR: 2,
    IMMEDIATE: 3,
    RELATIVE: 4,
    ZERO_PAGE: 5,
    ZERO_PAGE_X: 6,
    ZERO_PAGE_Y: 7,
    ABSOLUTE: 8,
    ABSOLUTE_X: 9,
    ABSOLUTE_Y: 10,
    INDIRECT: 11,
    INDEXED_INDIRECT: 12,
    INDIRECT_INDEXED: 13,
} as const;

/** Mirror of the `cpu_operand_access` enum in scratch/src/cpu_addressing.gs. */
export const CPU_OPERAND_ACCESS = { READ: 1, WRITE: 2, READ_MODIFY_WRITE: 3 } as const;

/** Mirror of the `cpu_operand_kind` enum in scratch/src/cpu_addressing.gs. */
export const CPU_OPERAND_KIND = {
    NONE: 0,
    IMPLIED: 1,
    ACCUMULATOR: 2,
    IMMEDIATE: 3,
    RELATIVE: 4,
    MEMORY: 5,
    JUMP_TARGET: 6,
} as const;

/** Mirror of the `cpu_operand_error_code` enum in scratch/src/cpu_addressing.gs. */
export const CPU_OPERAND_ERROR_CODE = { NONE: 0, UNSUPPORTED_ACCESS: 1, UNKNOWN_MODE: 2 } as const;

/** Mirror of the `cpu_access_kind` enum in scratch/src/cpu_core.gs. */
export const CPU_ACCESS_KIND = { READ: 0, WRITE: 1 } as const;

/** Mirror of the `cpu_sequence_op` enum in scratch/src/cpu_sequence.gs. */
export const CPU_SEQUENCE_OP = {
    RESET: 1,
    BRK: 2,
    JSR: 3,
    RTI: 4,
    RTS: 5,
    IRQ: 6,
    NMI: 7,
    RELATIVE_BRANCH: 8,
} as const;

/** Mirror of the `cpu_interrupt_source` enum in scratch/src/cpu_sequence.gs. */
export const CPU_INTERRUPT_SOURCE = { NMI: 1, IRQ: 2 } as const;

/** Mirror of the `cpu_sequence_error_code` enum in scratch/src/cpu_sequence.gs. */
export const CPU_SEQUENCE_ERROR_CODE = { NONE: 0, NOT_RELATIVE_OPERAND: 1 } as const;

/** Mirror of the `cpu_sequence_kind` enum in scratch/src/cpu_control.gs. */
export const CPU_SEQUENCE_KIND = { INSTRUCTION: 1, IRQ: 2, JAM: 3, NMI: 4, RESET: 5 } as const;

/** Mirror of the `cpu_instruction_error_code` enum in scratch/src/cpu_instruction.gs. */
export const CPU_INSTRUCTION_ERROR_CODE = {
    NONE: 0,
    UNDECODABLE_OPCODE: 1,
    UNOFFICIAL_OPCODE: 2,
    UNRESOLVED_OPERAND: 3,
    UNSUPPORTED_MNEMONIC: 4,
    UNSUPPORTED_OPERAND: 5,
} as const;

/**
 * The mnemonic ids scratch/src/cpu_instruction.gs dispatches on today, mirroring the
 * `cpu_mnemonic` enum in scratch/src/cpu_opcode.gs. The enum holds all 76 mnemonics; this mirror
 * lists the ones the ported dispatch reaches, and a test compares every id listed here with the
 * canonical opcode table fixture so the two cannot drift.
 */
export const CPU_MNEMONIC = {
    ADC: 1,
    AND: 5,
    ASL: 7,
    BCC: 9,
    BCS: 10,
    BEQ: 11,
    BIT: 12,
    BMI: 13,
    BNE: 14,
    BPL: 15,
    BRK: 16,
    BVC: 17,
    BVS: 18,
    CLC: 19,
    CLD: 20,
    CLI: 21,
    CLV: 22,
    CMP: 23,
    CPX: 24,
    CPY: 25,
    DEC: 27,
    DEX: 28,
    DEY: 29,
    EOR: 30,
    INC: 31,
    INX: 32,
    INY: 33,
    JMP: 35,
    JSR: 36,
    KIL: 37,
    LDA: 40,
    LDX: 41,
    LDY: 42,
    LSR: 43,
    NOP: 45,
    ORA: 46,
    PHA: 47,
    PHP: 48,
    PLA: 49,
    PLP: 50,
    ROL: 52,
    ROR: 53,
    RTI: 55,
    RTS: 56,
    SBC: 58,
    SEC: 59,
    SED: 60,
    SEI: 61,
    STA: 66,
    STX: 67,
    STY: 68,
    TAX: 70,
    TAY: 71,
    TSX: 72,
    TXA: 73,
    TXS: 74,
    TYA: 75,
} as const;

/** Mirror of the `cpu_vector_address` enum in scratch/src/cpu_core.gs. */
const CPU_VECTOR_ADDRESS = {
    NMI_LOW: 0xfffa,
    NMI_HIGH: 0xfffb,
    RESET_LOW: 0xfffc,
    RESET_HIGH: 0xfffd,
    IRQ_BRK_LOW: 0xfffe,
    IRQ_BRK_HIGH: 0xffff,
} as const;

/**
 * Mirror of scratch/src/cpu_core.gs and scratch/src/cpu_addressing.gs: register state, one
 * logged bus transaction per cycle, program-counter fetches, stack operations, and the
 * thirteen addressing modes. The reference suspends each instruction with a generator; this
 * mirror performs the same accesses in the same order and counts one cycle per access without
 * suspending, which is the execution model the port documents.
 */
export class GoboscriptCpuCore {
    readonly bus = new GoboscriptCpuBus();
    readonly access_log: number[] = [];
    program_counter = 0;
    a = 0;
    x = 0;
    y = 0;
    stack_pointer = 0;
    status: number = CPU_FLAG.UNUSED;
    cycles = 0;
    cycle_value = 0;
    fetched_byte = 0;
    fetched_word = 0;
    popped_byte = 0;
    popped_word = 0;
    resolved_kind = 0;
    resolved_mode = 0;
    resolved_access = 0;
    resolved_base_address = 0;
    resolved_address = 0;
    resolved_value = 0;
    resolved_page_crossed = 0;
    resolved_error = 0;
    sequence_error = 0;
    instruction_error = 0;
    jammed = 0;
    store_value = 0;
    selected_sequence = 0;
    nmi_pending = 0;
    irq_line_asserted = 0;
    irq_poll_mask_override_active = 0;
    irq_poll_mask_override_value = 0;
    jam_vector_reads_issued = 0;
    alu_value = 0;
    alu_status = 0;

    /**
     * Decoder this core fetches through, mirroring the Stage-owned `cpu_opcode_table` list that
     * `cpu_decode_opcode` reads. Tests inject the canonical generated table; a core without one
     * reports an undecodable opcode, exactly as a project whose data file failed to load would.
     */
    decoder: GoboscriptCpuOpcodeDecoder | null = null;

    /** Mirror of `cpu_reset_cycle_accounting`. */
    reset_cycle_accounting(): void {
        this.cycles = 0;
        this.access_log.length = 0;
    }

    /** Mirror of `cpu_reset_registers`. */
    reset_registers(): void {
        this.a = 0;
        this.x = 0;
        this.y = 0;
        this.stack_pointer = 0;
        this.program_counter = 0;
        this.status = CPU_FLAG.UNUSED;
        this.reset_cycle_accounting();
    }

    /** Mirror of `cpu_read_cycle address`. */
    read_cycle(address: number): void {
        const numeric_address = normalize_word(address);
        this.cycle_value = this.bus.read(numeric_address);
        this.access_log.push(CPU_ACCESS_KIND.READ, numeric_address, this.cycle_value);
        this.cycles += 1;
    }

    /** Mirror of `cpu_write_cycle address, value`. */
    write_cycle(address: number, value: number): void {
        const numeric_address = normalize_word(address);
        const numeric_value = normalize_byte(value);
        this.bus.write(numeric_address, numeric_value);
        this.access_log.push(CPU_ACCESS_KIND.WRITE, numeric_address, numeric_value);
        this.cycles += 1;
    }

    /** Mirror of `cpu_dummy_read_cycle address`. */
    dummy_read_cycle(address: number): void {
        this.read_cycle(address);
    }

    /** Mirror of `cpu_fetch_byte`. */
    fetch_byte(): void {
        const address = normalize_word(this.program_counter);
        this.read_cycle(address);
        this.fetched_byte = this.cycle_value;
        this.program_counter = normalize_word(address + 1);
    }

    /** Mirror of `cpu_fetch_word`. */
    fetch_word(): void {
        this.fetch_byte();
        const low_byte = this.fetched_byte;
        this.fetch_byte();
        this.fetched_word = join_bytes(this.fetched_byte, low_byte);
    }

    /** Mirror of `cpu_push_byte value`. */
    push_byte(value: number): void {
        this.write_cycle(256 + this.stack_pointer, value);
        this.stack_pointer = normalize_byte(this.stack_pointer - 1);
    }

    /** Mirror of `cpu_pop_byte`. */
    pop_byte(): void {
        const next_stack_pointer = normalize_byte(this.stack_pointer + 1);
        this.read_cycle(256 + next_stack_pointer);
        this.stack_pointer = next_stack_pointer;
        this.popped_byte = this.cycle_value;
    }

    /** Mirror of `cpu_push_word value`. */
    push_word(value: number): void {
        const word = normalize_word(value);
        this.push_byte(byte_high(word));
        this.push_byte(byte_low(word));
    }

    /** Mirror of `cpu_pop_word`. */
    pop_word(): void {
        this.pop_byte();
        const low_byte = this.popped_byte;
        this.pop_byte();
        this.popped_word = join_bytes(this.popped_byte, low_byte);
    }

    /** Mirror of `cpu_push_status break_enabled`. */
    push_status(break_enabled: number): void {
        this.status = normalize_status(this.status);
        this.push_byte(pack_status_for_stack(this.status, break_enabled));
    }

    /** Mirror of `cpu_restore_status_from_stack value`. */
    restore_status_from_stack(value: number): void {
        this.status = unpack_status_from_stack(normalize_byte(value));
    }

    /** Mirror of `cpu_page_crossed(base_address, address)`. */
    page_crossed(base_address: number, address: number): number {
        if (byte_high(base_address) === byte_high(address)) {
            return 0;
        }

        return 1;
    }

    /** Mirror of `cpu_indexed_dummy_address(base_address, address)`. */
    indexed_dummy_address(base_address: number, address: number): number {
        return join_bytes(byte_high(base_address), byte_low(address));
    }

    /** Mirror of `cpu_reset_operand`. */
    reset_operand(): void {
        this.resolved_kind = CPU_OPERAND_KIND.NONE;
        this.resolved_mode = 0;
        this.resolved_access = 0;
        this.resolved_base_address = 0;
        this.resolved_address = 0;
        this.resolved_value = 0;
        this.resolved_page_crossed = 0;
        this.resolved_error = CPU_OPERAND_ERROR_CODE.NONE;
    }

    /** Mirror of `cpu_set_memory_operand base_address, address, page_crossed`. */
    set_memory_operand(base_address: number, address: number, page_crossed: number): void {
        this.resolved_kind = CPU_OPERAND_KIND.MEMORY;
        this.resolved_base_address = normalize_word(base_address);
        this.resolved_address = normalize_word(address);
        this.resolved_page_crossed = to_number(page_crossed);
    }

    /** Mirror of `cpu_resolve_operand mode, access`. */
    resolve_operand(mode: number, access: number): void {
        const numeric_mode = to_number(mode);
        const numeric_access = to_number(access);
        this.reset_operand();
        this.resolved_mode = numeric_mode;
        this.resolved_access = numeric_access;

        if (numeric_mode === CPU_ADDRESSING_MODE.IMPLIED) {
            if (numeric_access !== CPU_OPERAND_ACCESS.READ) {
                this.resolved_error = CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS;
            } else {
                this.resolved_kind = CPU_OPERAND_KIND.IMPLIED;
            }
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.ACCUMULATOR) {
            if (numeric_access === CPU_OPERAND_ACCESS.WRITE) {
                this.resolved_error = CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS;
            } else {
                this.resolved_kind = CPU_OPERAND_KIND.ACCUMULATOR;
            }
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.IMMEDIATE) {
            if (numeric_access !== CPU_OPERAND_ACCESS.READ) {
                this.resolved_error = CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS;
            } else {
                this.resolved_kind = CPU_OPERAND_KIND.IMMEDIATE;
                this.fetch_byte();
                this.resolved_value = this.fetched_byte;
            }
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.RELATIVE) {
            if (numeric_access !== CPU_OPERAND_ACCESS.READ) {
                this.resolved_error = CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS;
                return;
            }

            this.fetch_byte();
            const offset = to_signed_byte(this.fetched_byte);
            const origin_address = this.program_counter;
            const target_address = normalize_word(origin_address + offset);
            this.resolved_kind = CPU_OPERAND_KIND.RELATIVE;
            this.resolved_value = offset;
            this.resolved_base_address = origin_address;
            this.resolved_address = target_address;
            this.resolved_page_crossed = this.page_crossed(origin_address, target_address);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.ZERO_PAGE) {
            this.fetch_byte();
            const base_address = this.fetched_byte;
            this.set_memory_operand(base_address, base_address, 0);
            return;
        }

        if (
            numeric_mode === CPU_ADDRESSING_MODE.ZERO_PAGE_X ||
            numeric_mode === CPU_ADDRESSING_MODE.ZERO_PAGE_Y
        ) {
            this.fetch_byte();
            const base_address = this.fetched_byte;
            const index_register =
                numeric_mode === CPU_ADDRESSING_MODE.ZERO_PAGE_X ? normalize_byte(this.x) : normalize_byte(this.y);
            this.dummy_read_cycle(base_address);
            this.set_memory_operand(base_address, normalize_byte(base_address + index_register), 0);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.ABSOLUTE) {
            this.fetch_word();
            const address = this.fetched_word;
            this.set_memory_operand(address, address, 0);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.ABSOLUTE_X || numeric_mode === CPU_ADDRESSING_MODE.ABSOLUTE_Y) {
            this.fetch_word();
            const base_address = this.fetched_word;
            const index_register =
                numeric_mode === CPU_ADDRESSING_MODE.ABSOLUTE_X ? normalize_byte(this.x) : normalize_byte(this.y);
            const address = normalize_word(base_address + index_register);
            const crossed = this.page_crossed(base_address, address);

            if (numeric_access !== CPU_OPERAND_ACCESS.READ || crossed === 1) {
                this.dummy_read_cycle(this.indexed_dummy_address(base_address, address));
            }

            this.set_memory_operand(base_address, address, crossed);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.INDIRECT) {
            if (numeric_access !== CPU_OPERAND_ACCESS.READ) {
                this.resolved_error = CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS;
                return;
            }

            this.fetch_word();
            const pointer_address = this.fetched_word;
            const pointer_high_address = join_bytes(byte_high(pointer_address), normalize_byte(pointer_address + 1));
            this.read_cycle(pointer_address);
            const target_low = this.cycle_value;
            this.read_cycle(pointer_high_address);
            const target_high = this.cycle_value;
            this.resolved_kind = CPU_OPERAND_KIND.JUMP_TARGET;
            this.resolved_base_address = pointer_address;
            this.resolved_address = join_bytes(target_high, target_low);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.INDEXED_INDIRECT) {
            this.fetch_byte();
            const base_address = this.fetched_byte;
            this.dummy_read_cycle(base_address);
            const pointer_address = normalize_byte(base_address + normalize_byte(this.x));
            this.read_cycle(pointer_address);
            const target_low = this.cycle_value;
            this.read_cycle(normalize_byte(pointer_address + 1));
            const target_high = this.cycle_value;
            this.set_memory_operand(base_address, join_bytes(target_high, target_low), 0);
            return;
        }

        if (numeric_mode === CPU_ADDRESSING_MODE.INDIRECT_INDEXED) {
            this.fetch_byte();
            const pointer_address = this.fetched_byte;
            this.read_cycle(pointer_address);
            const target_low = this.cycle_value;
            this.read_cycle(normalize_byte(pointer_address + 1));
            const target_high = this.cycle_value;
            const base_address = join_bytes(target_high, target_low);
            const address = normalize_word(base_address + normalize_byte(this.y));
            const crossed = this.page_crossed(base_address, address);

            if (numeric_access !== CPU_OPERAND_ACCESS.READ || crossed === 1) {
                this.dummy_read_cycle(this.indexed_dummy_address(base_address, address));
            }

            this.set_memory_operand(base_address, address, crossed);
            return;
        }

        this.resolved_error = CPU_OPERAND_ERROR_CODE.UNKNOWN_MODE;
    }

    /** The resolved operand plus the access trace, in shared vector suite 10 field order. */
    /** Mirror of `cpu_reset_sequence_error`. */
    reset_sequence_error(): void {
        this.sequence_error = CPU_SEQUENCE_ERROR_CODE.NONE;
    }

    /** Mirror of `cpu_execute_reset_cycles`. */
    execute_reset_cycles(): void {
        this.read_cycle(this.program_counter);
        this.read_cycle(this.program_counter);

        for (let index = 0; index < 3; index += 1) {
            this.read_cycle(256 + this.stack_pointer);
            this.stack_pointer = normalize_byte(this.stack_pointer - 1);
        }

        this.read_cycle(CPU_VECTOR_ADDRESS.RESET_LOW);
        const vector_low = this.cycle_value;
        this.read_cycle(CPU_VECTOR_ADDRESS.RESET_HIGH);
        this.program_counter = join_bytes(this.cycle_value, vector_low);
        this.status = set_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE, 1);
    }

    /** Mirror of `cpu_execute_brk_cycles`. */
    execute_brk_cycles(): void {
        this.fetch_byte();
        this.push_word(this.program_counter);
        this.push_status(1);
        this.status = set_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE, 1);
        this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_LOW);
        const vector_low = this.cycle_value;
        this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_HIGH);
        this.program_counter = join_bytes(this.cycle_value, vector_low);
    }

    /** Mirror of `cpu_execute_jsr_cycles`. */
    execute_jsr_cycles(): void {
        this.fetch_byte();
        const target_low = this.fetched_byte;
        this.read_cycle(256 + this.stack_pointer);
        this.push_word(this.program_counter);
        this.fetch_byte();
        this.program_counter = join_bytes(this.fetched_byte, target_low);
    }

    /** Mirror of `cpu_execute_rti_cycles`. */
    execute_rti_cycles(): void {
        this.read_cycle(this.program_counter);
        this.read_cycle(256 + this.stack_pointer);
        this.pop_byte();
        this.restore_status_from_stack(this.popped_byte);
        this.pop_word();
        this.program_counter = this.popped_word;
    }

    /** Mirror of `cpu_execute_rts_cycles`. */
    execute_rts_cycles(): void {
        this.read_cycle(this.program_counter);
        this.read_cycle(256 + this.stack_pointer);
        this.pop_word();
        const return_address = this.popped_word;
        this.read_cycle(return_address);
        this.program_counter = normalize_word(return_address + 1);
    }

    /** Mirror of `cpu_execute_hardware_interrupt_cycles source`. */
    execute_hardware_interrupt_cycles(source: number): void {
        let vector_low_address: number = CPU_VECTOR_ADDRESS.IRQ_BRK_LOW;
        let vector_high_address: number = CPU_VECTOR_ADDRESS.IRQ_BRK_HIGH;

        if (source === CPU_INTERRUPT_SOURCE.NMI) {
            vector_low_address = CPU_VECTOR_ADDRESS.NMI_LOW;
            vector_high_address = CPU_VECTOR_ADDRESS.NMI_HIGH;
        }

        this.read_cycle(this.program_counter);
        this.read_cycle(this.program_counter);
        this.push_word(this.program_counter);
        this.push_status(0);
        this.status = set_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE, 1);
        this.read_cycle(vector_low_address);
        const vector_low = this.cycle_value;
        this.read_cycle(vector_high_address);
        this.program_counter = join_bytes(this.cycle_value, vector_low);
    }

    /** Mirror of `cpu_apply_relative_branch_cycles taken`. */
    apply_relative_branch_cycles(taken: number): void {
        this.sequence_error = CPU_SEQUENCE_ERROR_CODE.NONE;

        if (this.resolved_kind !== CPU_OPERAND_KIND.RELATIVE) {
            this.sequence_error = CPU_SEQUENCE_ERROR_CODE.NOT_RELATIVE_OPERAND;
        } else if (taken === 1) {
            this.read_cycle(this.resolved_base_address);

            if (this.resolved_page_crossed === 1) {
                this.read_cycle(this.indexed_dummy_address(this.resolved_base_address, this.resolved_address));
            }

            this.program_counter = this.resolved_address;
        }
    }

    /** Mirror of `cpu_clear_interrupt_state`. */
    clear_interrupt_state(): void {
        this.jammed = 0;
        this.jam_vector_reads_issued = 0;
        this.nmi_pending = 0;
        this.irq_poll_mask_override_active = 0;
        this.irq_poll_mask_override_value = 0;
    }

    /** Mirror of `cpu_request_nmi`. */
    request_nmi(): void {
        this.nmi_pending = 1;
    }

    /** Mirror of `cpu_set_irq_line asserted`. */
    set_irq_line(asserted: number): void {
        this.irq_line_asserted = asserted === 0 ? 0 : 1;
    }

    /** Mirror of `cpu_execute_jammed_cycles`. */
    execute_jammed_cycles(): void {
        this.selected_sequence = CPU_SEQUENCE_KIND.JAM;

        if (this.jam_vector_reads_issued === 0) {
            this.jam_vector_reads_issued = 1;
            this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_HIGH);
            this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_LOW);
            this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_LOW);
            return;
        }

        this.read_cycle(CPU_VECTOR_ADDRESS.IRQ_BRK_HIGH);
    }

    /** Mirror of `cpu_finish_instruction interrupt_disabled_before`. */
    finish_instruction(interrupt_disabled_before: number): void {
        const mnemonic = this.decoder?.mnemonic ?? 0;
        let delays_irq_poll = 0;

        if (mnemonic === CPU_MNEMONIC.CLI) {
            delays_irq_poll = 1;
        } else if (mnemonic === CPU_MNEMONIC.SEI) {
            delays_irq_poll = 1;
        } else if (mnemonic === CPU_MNEMONIC.PLP) {
            delays_irq_poll = 1;
        }

        if (delays_irq_poll === 1) {
            this.irq_poll_mask_override_active = 1;
            this.irq_poll_mask_override_value = interrupt_disabled_before;
        }
    }

    /** Mirror of `cpu_begin_next_sequence`. */
    begin_next_sequence(): void {
        const interrupt_disabled_before = has_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE);
        let interrupt_disabled_for_poll = interrupt_disabled_before;

        if (this.irq_poll_mask_override_active === 1) {
            interrupt_disabled_for_poll = this.irq_poll_mask_override_value;
        }

        if (this.jammed === 1) {
            this.execute_jammed_cycles();
        } else if (this.nmi_pending === 1) {
            this.nmi_pending = 0;
            this.irq_poll_mask_override_active = 0;
            this.selected_sequence = CPU_SEQUENCE_KIND.NMI;
            this.execute_hardware_interrupt_cycles(CPU_INTERRUPT_SOURCE.NMI);
        } else if (this.irq_line_asserted === 1 && interrupt_disabled_for_poll === 0) {
            this.irq_poll_mask_override_active = 0;
            this.selected_sequence = CPU_SEQUENCE_KIND.IRQ;
            this.execute_hardware_interrupt_cycles(CPU_INTERRUPT_SOURCE.IRQ);
        } else {
            this.irq_poll_mask_override_active = 0;
            this.selected_sequence = CPU_SEQUENCE_KIND.INSTRUCTION;
            this.execute_instruction();
            this.finish_instruction(interrupt_disabled_before);
        }
    }

    /**
     * Mirror of the suite-14 handler: runs `step_count` control-loop steps, requesting an NMI and
     * asserting the IRQ line before the steps the record names, and returns the eight fixed
     * values, one sequence kind per step, and the access trace.
     */
    run_control_steps(step_count: number, nmi_request_step: number, irq_assert_step: number): number[] {
        const kinds: number[] = [];

        this.reset_cycle_accounting();
        this.reset_instruction_error();

        for (let step = 1; step <= step_count; step += 1) {
            if (step === nmi_request_step) {
                this.request_nmi();
            }

            if (step === irq_assert_step) {
                this.set_irq_line(1);
            }

            this.begin_next_sequence();
            kinds.push(this.selected_sequence);
        }

        return [
            this.cycles,
            this.program_counter,
            this.stack_pointer,
            this.status,
            this.a,
            this.x,
            this.y,
            this.instruction_error,
            ...kinds,
            ...this.access_log,
        ];
    }

    /** Mirror of `cpu_reset_instruction_error`. */
    reset_instruction_error(): void {
        this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.NONE;
    }

    /** Mirror of `cpu_fetch_and_decode_opcode`. */
    fetch_and_decode_opcode(): void {
        this.fetch_byte();

        if (this.decoder === null) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNDECODABLE_OPCODE;
            return;
        }

        this.decoder.decode(this.fetched_byte);
    }

    /** Mirror of `cpu_execute_branch`. */
    execute_branch(): void {
        let taken = 0;
        this.resolve_operand(CPU_ADDRESSING_MODE.RELATIVE, CPU_OPERAND_ACCESS.READ);
        const mnemonic = this.decoder?.mnemonic ?? 0;

        if (this.resolved_error !== CPU_OPERAND_ERROR_CODE.NONE) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNRESOLVED_OPERAND;
        } else if (mnemonic === CPU_MNEMONIC.BCC) {
            taken = 1 - has_status_flag(this.status, CPU_FLAG.CARRY);
        } else if (mnemonic === CPU_MNEMONIC.BCS) {
            taken = has_status_flag(this.status, CPU_FLAG.CARRY);
        } else if (mnemonic === CPU_MNEMONIC.BEQ) {
            taken = has_status_flag(this.status, CPU_FLAG.ZERO);
        } else if (mnemonic === CPU_MNEMONIC.BMI) {
            taken = has_status_flag(this.status, CPU_FLAG.NEGATIVE);
        } else if (mnemonic === CPU_MNEMONIC.BNE) {
            taken = 1 - has_status_flag(this.status, CPU_FLAG.ZERO);
        } else if (mnemonic === CPU_MNEMONIC.BPL) {
            taken = 1 - has_status_flag(this.status, CPU_FLAG.NEGATIVE);
        } else if (mnemonic === CPU_MNEMONIC.BVC) {
            taken = 1 - has_status_flag(this.status, CPU_FLAG.OVERFLOW);
        } else if (mnemonic === CPU_MNEMONIC.BVS) {
            taken = has_status_flag(this.status, CPU_FLAG.OVERFLOW);
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC;
        }

        if (this.instruction_error === CPU_INSTRUCTION_ERROR_CODE.NONE) {
            this.apply_relative_branch_cycles(taken);
        }
    }

    /** Mirror of `cpu_execute_jump`. */
    execute_jump(): void {
        this.resolve_operand(this.decoder?.mode ?? 0, CPU_OPERAND_ACCESS.READ);

        if (this.resolved_error !== CPU_OPERAND_ERROR_CODE.NONE) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNRESOLVED_OPERAND;
        } else if (
            this.resolved_kind === CPU_OPERAND_KIND.JUMP_TARGET ||
            this.resolved_kind === CPU_OPERAND_KIND.MEMORY
        ) {
            this.program_counter = this.resolved_address;
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_OPERAND;
        }
    }

    /** Mirror of `cpu_execute_regular_instruction`. */
    execute_regular_instruction(): void {
        this.resolve_operand(this.decoder?.mode ?? 0, this.decoder?.access ?? 0);

        if (this.resolved_error !== CPU_OPERAND_ERROR_CODE.NONE) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNRESOLVED_OPERAND;
        } else if (this.resolved_kind === CPU_OPERAND_KIND.IMPLIED) {
            this.read_cycle(this.program_counter);
            this.apply_implied_instruction();
        } else if (this.resolved_kind === CPU_OPERAND_KIND.ACCUMULATOR) {
            this.read_cycle(this.program_counter);
            this.modify_value(this.decoder?.mnemonic ?? 0, this.a);

            if (this.instruction_error === CPU_INSTRUCTION_ERROR_CODE.NONE) {
                this.a = this.alu_value;
                this.status = this.alu_status;
            }
        } else if (this.resolved_kind === CPU_OPERAND_KIND.IMMEDIATE) {
            this.apply_read_instruction(this.decoder?.mnemonic ?? 0, this.resolved_value);
        } else if (this.resolved_kind === CPU_OPERAND_KIND.MEMORY) {
            this.execute_memory_instruction();
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_OPERAND;
        }
    }

    /** Mirror of `cpu_apply_read_instruction mnemonic, value`. */
    apply_read_instruction(mnemonic: number, value: number): void {
        if (mnemonic === CPU_MNEMONIC.LDA) {
            this.a = normalize_byte(value);
            this.status = update_zero_negative_flags(this.status, this.a);
        } else if (mnemonic === CPU_MNEMONIC.LDX) {
            this.x = normalize_byte(value);
            this.status = update_zero_negative_flags(this.status, this.x);
        } else if (mnemonic === CPU_MNEMONIC.LDY) {
            this.y = normalize_byte(value);
            this.status = update_zero_negative_flags(this.status, this.y);
        } else if (mnemonic === CPU_MNEMONIC.ADC) {
            const result = alu_add_with_carry(this.a, value, this.status);
            this.alu_value = result.value;
            this.alu_status = result.status;
            this.a = result.value;
            this.status = result.status;
        } else if (mnemonic === CPU_MNEMONIC.SBC) {
            const result = alu_subtract_with_carry(this.a, value, this.status);
            this.alu_value = result.value;
            this.alu_status = result.status;
            this.a = result.value;
            this.status = result.status;
        } else if (mnemonic === CPU_MNEMONIC.AND) {
            const result = alu_and(this.a, value, this.status);
            this.alu_value = result.value;
            this.alu_status = result.status;
            this.a = result.value;
            this.status = result.status;
        } else if (mnemonic === CPU_MNEMONIC.ORA) {
            const result = alu_ora(this.a, value, this.status);
            this.alu_value = result.value;
            this.alu_status = result.status;
            this.a = result.value;
            this.status = result.status;
        } else if (mnemonic === CPU_MNEMONIC.EOR) {
            const result = alu_eor(this.a, value, this.status);
            this.alu_value = result.value;
            this.alu_status = result.status;
            this.a = result.value;
            this.status = result.status;
        } else if (mnemonic === CPU_MNEMONIC.CMP) {
            this.alu_status = alu_compare(this.a, value, this.status).status;
            this.status = this.alu_status;
        } else if (mnemonic === CPU_MNEMONIC.CPX) {
            this.alu_status = alu_compare(this.x, value, this.status).status;
            this.status = this.alu_status;
        } else if (mnemonic === CPU_MNEMONIC.CPY) {
            this.alu_status = alu_compare(this.y, value, this.status).status;
            this.status = this.alu_status;
        } else if (mnemonic === CPU_MNEMONIC.BIT) {
            this.alu_status = alu_bit_test(this.a, value, this.status).status;
            this.status = this.alu_status;
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC;
        }
    }

    /** Mirror of `cpu_execute_memory_instruction`. */
    execute_memory_instruction(): void {
        if (this.resolved_access === CPU_OPERAND_ACCESS.READ) {
            this.read_cycle(this.resolved_address);
            this.apply_read_instruction(this.decoder?.mnemonic ?? 0, this.cycle_value);
        } else if (this.resolved_access === CPU_OPERAND_ACCESS.WRITE) {
            this.compute_store_value();

            if (this.instruction_error === CPU_INSTRUCTION_ERROR_CODE.NONE) {
                this.write_cycle(this.resolved_address, this.store_value);
            }
        } else if (this.resolved_access === CPU_OPERAND_ACCESS.READ_MODIFY_WRITE) {
            this.read_cycle(this.resolved_address);
            this.write_cycle(this.resolved_address, this.cycle_value);
            this.modify_value(this.decoder?.mnemonic ?? 0, this.cycle_value);

            if (this.instruction_error === CPU_INSTRUCTION_ERROR_CODE.NONE) {
                this.write_cycle(this.resolved_address, this.alu_value);
                this.status = this.alu_status;
            }
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_OPERAND;
        }
    }

    /** Mirror of `cpu_compute_store_value`. */
    compute_store_value(): void {
        const mnemonic = this.decoder?.mnemonic ?? 0;

        if (mnemonic === CPU_MNEMONIC.STA) {
            this.store_value = this.a;
        } else if (mnemonic === CPU_MNEMONIC.STX) {
            this.store_value = this.x;
        } else if (mnemonic === CPU_MNEMONIC.STY) {
            this.store_value = this.y;
        } else {
            this.store_value = 0;
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC;
        }
    }

    /** Mirror of `cpu_modify_value mnemonic, value`. */
    modify_value(mnemonic: number, value: number): void {
        let result: AluResult | null = null;

        if (mnemonic === CPU_MNEMONIC.ASL) {
            result = alu_shift_left(value, this.status);
        } else if (mnemonic === CPU_MNEMONIC.LSR) {
            result = alu_shift_right(value, this.status);
        } else if (mnemonic === CPU_MNEMONIC.ROL) {
            result = alu_rotate_left(value, this.status);
        } else if (mnemonic === CPU_MNEMONIC.ROR) {
            result = alu_rotate_right(value, this.status);
        } else if (mnemonic === CPU_MNEMONIC.INC) {
            result = alu_increment(value, this.status);
        } else if (mnemonic === CPU_MNEMONIC.DEC) {
            result = alu_decrement(value, this.status);
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC;
        }

        if (result !== null) {
            this.alu_value = result.value;
            this.alu_status = result.status;
        }
    }

    /** Mirror of `cpu_apply_implied_instruction`. */
    apply_implied_instruction(): void {
        const mnemonic = this.decoder?.mnemonic ?? 0;

        if (mnemonic === CPU_MNEMONIC.INX) {
            this.x = normalize_byte(this.x + 1);
            this.status = update_zero_negative_flags(this.status, this.x);
        } else if (mnemonic === CPU_MNEMONIC.INY) {
            this.y = normalize_byte(this.y + 1);
            this.status = update_zero_negative_flags(this.status, this.y);
        } else if (mnemonic === CPU_MNEMONIC.DEX) {
            this.x = normalize_byte(this.x - 1);
            this.status = update_zero_negative_flags(this.status, this.x);
        } else if (mnemonic === CPU_MNEMONIC.DEY) {
            this.y = normalize_byte(this.y - 1);
            this.status = update_zero_negative_flags(this.status, this.y);
        } else if (mnemonic === CPU_MNEMONIC.TAX) {
            this.x = normalize_byte(this.a);
            this.status = update_zero_negative_flags(this.status, this.x);
        } else if (mnemonic === CPU_MNEMONIC.TAY) {
            this.y = normalize_byte(this.a);
            this.status = update_zero_negative_flags(this.status, this.y);
        } else if (mnemonic === CPU_MNEMONIC.TSX) {
            this.x = normalize_byte(this.stack_pointer);
            this.status = update_zero_negative_flags(this.status, this.x);
        } else if (mnemonic === CPU_MNEMONIC.TXA) {
            this.a = normalize_byte(this.x);
            this.status = update_zero_negative_flags(this.status, this.a);
        } else if (mnemonic === CPU_MNEMONIC.TXS) {
            this.stack_pointer = normalize_byte(this.x);
        } else if (mnemonic === CPU_MNEMONIC.TYA) {
            this.a = normalize_byte(this.y);
            this.status = update_zero_negative_flags(this.status, this.a);
        } else if (mnemonic === CPU_MNEMONIC.CLC) {
            this.status = set_status_flag(this.status, CPU_FLAG.CARRY, 0);
        } else if (mnemonic === CPU_MNEMONIC.CLD) {
            this.status = set_status_flag(this.status, CPU_FLAG.DECIMAL, 0);
        } else if (mnemonic === CPU_MNEMONIC.CLI) {
            this.status = set_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE, 0);
        } else if (mnemonic === CPU_MNEMONIC.CLV) {
            this.status = set_status_flag(this.status, CPU_FLAG.OVERFLOW, 0);
        } else if (mnemonic === CPU_MNEMONIC.SEC) {
            this.status = set_status_flag(this.status, CPU_FLAG.CARRY, 1);
        } else if (mnemonic === CPU_MNEMONIC.SED) {
            this.status = set_status_flag(this.status, CPU_FLAG.DECIMAL, 1);
        } else if (mnemonic === CPU_MNEMONIC.SEI) {
            this.status = set_status_flag(this.status, CPU_FLAG.INTERRUPT_DISABLE, 1);
        } else if (mnemonic === CPU_MNEMONIC.NOP) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.NONE;
        } else {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC;
        }
    }

    /** Mirror of `cpu_execute_instruction`. */
    execute_instruction(): void {
        this.reset_instruction_error();
        this.fetch_and_decode_opcode();
        const decoder = this.decoder;
        const mnemonic = decoder?.mnemonic ?? 0;
        const mode = decoder?.mode ?? 0;

        if (this.instruction_error !== CPU_INSTRUCTION_ERROR_CODE.NONE) {
            return;
        }

        if (decoder === null || decoder.error !== CPU_OPCODE_ERROR_CODE.NONE) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNDECODABLE_OPCODE;
        } else if (mnemonic === CPU_MNEMONIC.KIL) {
            this.read_cycle(this.program_counter);
            this.jammed = 1;
        } else if (decoder.official === 0) {
            this.instruction_error = CPU_INSTRUCTION_ERROR_CODE.UNOFFICIAL_OPCODE;
        } else if (mnemonic === CPU_MNEMONIC.BRK) {
            this.execute_brk_cycles();
        } else if (mnemonic === CPU_MNEMONIC.JSR) {
            this.execute_jsr_cycles();
        } else if (mnemonic === CPU_MNEMONIC.RTI) {
            this.execute_rti_cycles();
        } else if (mnemonic === CPU_MNEMONIC.RTS) {
            this.execute_rts_cycles();
        } else if (mnemonic === CPU_MNEMONIC.PHA) {
            this.read_cycle(this.program_counter);
            this.push_byte(this.a);
        } else if (mnemonic === CPU_MNEMONIC.PHP) {
            this.read_cycle(this.program_counter);
            this.push_status(1);
        } else if (mnemonic === CPU_MNEMONIC.PLA) {
            this.read_cycle(this.program_counter);
            this.read_cycle(256 + this.stack_pointer);
            this.pop_byte();
            this.a = this.popped_byte;
            this.status = update_zero_negative_flags(this.status, this.a);
        } else if (mnemonic === CPU_MNEMONIC.PLP) {
            this.read_cycle(this.program_counter);
            this.read_cycle(256 + this.stack_pointer);
            this.pop_byte();
            this.restore_status_from_stack(this.popped_byte);
        } else if (mnemonic === CPU_MNEMONIC.JMP) {
            this.execute_jump();
        } else if (mode === CPU_ADDRESSING_MODE.RELATIVE) {
            this.execute_branch();
        } else {
            this.execute_regular_instruction();
        }
    }

    /** The eight fixed values suite 13 reports before its access trace. */
    instruction_values(): number[] {
        return [
            this.cycles,
            this.program_counter,
            this.stack_pointer,
            this.status,
            this.a,
            this.x,
            this.y,
            this.instruction_error,
            ...this.access_log,
        ];
    }

    reported_values(): number[] {
        return [
            this.resolved_kind,
            this.resolved_mode,
            this.resolved_access,
            this.resolved_base_address,
            this.resolved_address,
            this.resolved_value,
            this.resolved_page_crossed,
            this.resolved_error,
            this.cycles,
            this.program_counter,
            this.stack_pointer,
            ...this.access_log,
        ];
    }
}

/** Mirror of the `cpu_opcode_error_code` enum in scratch/src/cpu_opcode.gs. */
export const CPU_OPCODE_ERROR_CODE = { NONE: 0, UNKNOWN_OPCODE: 1, BAD_TABLE: 2 } as const;

/** Mirror of the `cpu_opcode_layout` enum in scratch/src/cpu_opcode.gs. */
export const CPU_OPCODE_LAYOUT = {
    HEADER_VALUES: 2,
    FIELDS_PER_OPCODE: 6,
    OPCODE_COUNT: 256,
    SCHEMA_VERSION: 1,
} as const;

/** Mirror of the `cpu_opcode_field` enum in scratch/src/cpu_opcode.gs. */
export const CPU_OPCODE_FIELD = {
    MNEMONIC: 0,
    ADDRESSING_MODE: 1,
    BASE_CYCLES: 2,
    OPERAND_ACCESS: 3,
    PAGE_CROSS_CYCLE: 4,
    OFFICIAL: 5,
} as const;

/**
 * Mirror of scratch/src/cpu_opcode.gs: the decoded fields of one opcode byte read out of the
 * generated table list. The list is a constructor argument because the GoboScript side loads it
 * from data/opcode_table.txt at project start, and the mirror has no file to load.
 */
export class GoboscriptCpuOpcodeDecoder {
    readonly table: number[];
    mnemonic = 0;
    mode = 0;
    base_cycles = 0;
    access = 0;
    page_cross_cycle = 0;
    official = 0;
    error = 0;

    constructor(table: readonly number[]) {
        this.table = [...table];
    }

    /** Mirror of `cpu_reset_opcode_decode`. */
    reset_decode(): void {
        this.mnemonic = 0;
        this.mode = 0;
        this.base_cycles = 0;
        this.access = 0;
        this.page_cross_cycle = 0;
        this.official = 0;
        this.error = CPU_OPCODE_ERROR_CODE.NONE;
    }

    /** Mirror of `cpu_check_opcode_table`. */
    check_table(): void {
        const expected_length =
            CPU_OPCODE_LAYOUT.HEADER_VALUES + CPU_OPCODE_LAYOUT.OPCODE_COUNT * CPU_OPCODE_LAYOUT.FIELDS_PER_OPCODE;
        this.error = CPU_OPCODE_ERROR_CODE.NONE;

        if (this.table.length !== expected_length) {
            this.error = CPU_OPCODE_ERROR_CODE.BAD_TABLE;
        } else if ((this.table[0] ?? 0) !== CPU_OPCODE_LAYOUT.SCHEMA_VERSION) {
            this.error = CPU_OPCODE_ERROR_CODE.BAD_TABLE;
        } else if ((this.table[1] ?? 0) !== CPU_OPCODE_LAYOUT.OPCODE_COUNT) {
            this.error = CPU_OPCODE_ERROR_CODE.BAD_TABLE;
        }
    }

    /** Mirror of `cpu_decode_opcode opcode`. */
    decode(opcode: number): void {
        const numeric_opcode = normalize_byte(opcode);
        const record_start = CPU_OPCODE_LAYOUT.HEADER_VALUES + numeric_opcode * CPU_OPCODE_LAYOUT.FIELDS_PER_OPCODE;
        this.reset_decode();
        this.mnemonic = this.table[record_start + CPU_OPCODE_FIELD.MNEMONIC] ?? 0;
        this.mode = this.table[record_start + CPU_OPCODE_FIELD.ADDRESSING_MODE] ?? 0;
        this.base_cycles = this.table[record_start + CPU_OPCODE_FIELD.BASE_CYCLES] ?? 0;
        this.access = this.table[record_start + CPU_OPCODE_FIELD.OPERAND_ACCESS] ?? 0;
        this.page_cross_cycle = this.table[record_start + CPU_OPCODE_FIELD.PAGE_CROSS_CYCLE] ?? 0;
        this.official = this.table[record_start + CPU_OPCODE_FIELD.OFFICIAL] ?? 0;

        if (this.mnemonic === 0) {
            this.error = CPU_OPCODE_ERROR_CODE.UNKNOWN_OPCODE;
        }
    }

    /** The seven values `run_cpu_opcode_vector` appends to the actual list. */
    reported_values(): number[] {
        return [
            this.mnemonic,
            this.mode,
            this.base_cycles,
            this.access,
            this.page_cross_cycle,
            this.official,
            this.error,
        ];
    }
}
