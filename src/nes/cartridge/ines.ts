export type RomFormat = "ines-1.0" | "nes-2.0";

export type MirroringMode = "horizontal" | "vertical" | "four-screen";

export type RomParseErrorCode =
    | "truncated-header"
    | "invalid-magic"
    | "unsupported-version"
    | "invalid-rom-size"
    | "image-too-large"
    | "truncated-payload";

export interface RomParseError {
    readonly code: RomParseErrorCode;
    readonly message: string;
}

export interface InesRom {
    readonly format: RomFormat;
    readonly mapper_id: number;
    readonly submapper: number;
    readonly mirroring: MirroringMode;
    readonly battery_backed: boolean;
    readonly trainer: Uint8Array | null;
    readonly prg_rom: Uint8Array;
    readonly chr_rom: Uint8Array;
    readonly prg_ram_bytes: number;
    readonly prg_nvram_bytes: number;
    readonly chr_ram_bytes: number;
    readonly chr_nvram_bytes: number;
}

export type RomParseResult =
    | { readonly ok: true; readonly value: InesRom }
    | { readonly ok: false; readonly error: RomParseError };

export const MAX_ROM_IMAGE_BYTES = 32 * 1024 * 1024;

const HEADER_BYTES = 16;
const TRAINER_BYTES = 512;
const PRG_BANK_BYTES = 16_384;
const CHR_BANK_BYTES = 8_192;
const LEGACY_PRG_RAM_BANK_BYTES = 8_192;
const RAM_SHIFT_BASE_BYTES = 64;
const INES_MAGIC = [0x4e, 0x45, 0x53, 0x1a] as const;

/** Returns malformed ROM input as data so loading remains an expected control path. */
export function parse_ines_rom(data: Uint8Array): RomParseResult {
    if (data.byteLength > MAX_ROM_IMAGE_BYTES) {
        return oversized_image(data.byteLength);
    }

    if (data.byteLength < HEADER_BYTES) {
        return failure("truncated-header", "The ROM is shorter than the 16-byte iNES header.");
    }

    for (let index = 0; index < INES_MAGIC.length; index += 1) {
        if (read_byte(data, index) !== INES_MAGIC[index]) {
            return failure("invalid-magic", "The ROM does not start with the iNES signature.");
        }
    }

    const flags6 = read_byte(data, 6);
    const flags7 = read_byte(data, 7);
    const version_bits = flags7 & 0x0c;

    if (version_bits !== 0x00 && version_bits !== 0x08) {
        return failure("unsupported-version", "The ROM uses an archaic or unsupported iNES header version.");
    }

    const format: RomFormat = version_bits === 0x08 ? "nes-2.0" : "ines-1.0";
    const has_trainer = (flags6 & 0x04) !== 0;
    const battery_backed = (flags6 & 0x02) !== 0;
    const is_four_screen = (flags6 & 0x08) !== 0;
    const mirroring: MirroringMode = is_four_screen
        ? "four-screen"
        : (flags6 & 0x01) !== 0
          ? "vertical"
          : "horizontal";

    let mapper_id = (flags6 >> 4) | (flags7 & 0xf0);
    let submapper = 0;
    let prg_rom_bytes: number | undefined;
    let chr_rom_bytes: number | undefined;
    let prg_ram_bytes = 0;
    let prg_nvram_bytes = 0;
    let chr_ram_bytes = 0;
    let chr_nvram_bytes = 0;

    if (format === "nes-2.0") {
        const mapper_and_submapper = read_byte(data, 8);
        const size_msb = read_byte(data, 9);
        const ram_sizes = read_byte(data, 10);
        const chr_ram_sizes = read_byte(data, 11);

        mapper_id |= (mapper_and_submapper & 0x0f) << 8;
        submapper = mapper_and_submapper >> 4;
        prg_rom_bytes = decode_nes2_rom_size(
            read_byte(data, 4),
            size_msb & 0x0f,
            PRG_BANK_BYTES,
        );
        chr_rom_bytes = decode_nes2_rom_size(
            read_byte(data, 5),
            size_msb >> 4,
            CHR_BANK_BYTES,
        );
        prg_ram_bytes = decode_nes2_ram_size(ram_sizes & 0x0f);
        prg_nvram_bytes = decode_nes2_ram_size(ram_sizes >> 4);
        chr_ram_bytes = decode_nes2_ram_size(chr_ram_sizes & 0x0f);
        chr_nvram_bytes = decode_nes2_ram_size(chr_ram_sizes >> 4);
    } else {
        prg_rom_bytes = read_byte(data, 4) * PRG_BANK_BYTES;
        chr_rom_bytes = read_byte(data, 5) * CHR_BANK_BYTES;

        const prg_ram_banks = read_byte(data, 8) || 1;
        const legacy_prg_ram_bytes = prg_ram_banks * LEGACY_PRG_RAM_BANK_BYTES;

        if (battery_backed) {
            prg_nvram_bytes = legacy_prg_ram_bytes;
        } else {
            prg_ram_bytes = legacy_prg_ram_bytes;
        }

        if (chr_rom_bytes === 0) {
            chr_ram_bytes = CHR_BANK_BYTES;
        }
    }

    if (
        prg_rom_bytes === undefined ||
        chr_rom_bytes === undefined ||
        prg_rom_bytes <= 0 ||
        !Number.isSafeInteger(prg_rom_bytes) ||
        !Number.isSafeInteger(chr_rom_bytes)
    ) {
        return failure("invalid-rom-size", "The header declares an invalid or unsupported ROM size.");
    }

    const trainer_offset = HEADER_BYTES;
    const prg_rom_offset = trainer_offset + (has_trainer ? TRAINER_BYTES : 0);
    const chr_rom_offset = prg_rom_offset + prg_rom_bytes;
    const payload_end = chr_rom_offset + chr_rom_bytes;

    if (!Number.isSafeInteger(payload_end)) {
        return failure("invalid-rom-size", "The combined ROM payload size exceeds safe integer precision.");
    }

    if (payload_end > MAX_ROM_IMAGE_BYTES) {
        return oversized_image(payload_end);
    }

    if (payload_end > data.byteLength) {
        return failure("truncated-payload", "The ROM file ends before its declared PRG or CHR data.");
    }

    const trainer = has_trainer ? copy_bytes(data, trainer_offset, prg_rom_offset) : null;

    return {
        ok: true,
        value: {
            format,
            mapper_id,
            submapper,
            mirroring,
            battery_backed,
            trainer,
            prg_rom: copy_bytes(data, prg_rom_offset, chr_rom_offset),
            chr_rom: copy_bytes(data, chr_rom_offset, payload_end),
            prg_ram_bytes,
            prg_nvram_bytes,
            chr_ram_bytes,
            chr_nvram_bytes,
        },
    };
}

function failure(code: RomParseErrorCode, message: string): RomParseResult {
    return { ok: false, error: { code, message } };
}

function oversized_image(byte_length: number): RomParseResult {
    return failure(
        "image-too-large",
        `ROM image size ${byte_length} bytes exceeds the ${MAX_ROM_IMAGE_BYTES}-byte limit.`,
    );
}

function read_byte(data: Uint8Array, index: number): number {
    const value = data[index];

    if (value === undefined) {
        throw new RangeError(`Header byte ${index} is outside the validated input.`);
    }

    return value;
}

function copy_bytes(data: Uint8Array, start: number, end: number): Uint8Array {
    return Uint8Array.from(data.subarray(start, end));
}

function decode_nes2_rom_size(lsb: number, msb_nibble: number, bank_bytes: number): number | undefined {
    if (msb_nibble !== 0x0f) {
        return ((msb_nibble << 8) | lsb) * bank_bytes;
    }

    const exponent = lsb >> 2;
    const multiplier = ((lsb & 0x03) << 1) | 0x01;
    const size_bytes = 2 ** exponent * multiplier;

    return Number.isSafeInteger(size_bytes) ? size_bytes : undefined;
}

function decode_nes2_ram_size(shift: number): number {
    return shift === 0 ? 0 : RAM_SHIFT_BASE_BYTES * 2 ** shift;
}
