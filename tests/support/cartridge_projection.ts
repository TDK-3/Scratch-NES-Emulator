import { parse_ines_rom } from "../../src/nes/cartridge/ines.js";
import type { MirroringMode, RomFormat, RomParseErrorCode } from "../../src/nes/cartridge/ines.js";

/**
 * Reference-side projection of an iNES/NES 2.0 header parse onto the flat array shared vector
 * suite 9 ("cartridge") records, and that scratch/src/cartridge.gs reports through its eighteen
 * `cartridge_*` globals. Every enumeration is encoded as a small integer because a Scratch list
 * can only hold numbers.
 */

export const CARTRIDGE_HEADER_BYTES = 16;
export const CARTRIDGE_TRAINER_BYTES = 512;

export const CARTRIDGE_FORMAT_IDS: Record<RomFormat, number> = { "ines-1.0": 1, "nes-2.0": 2 };

export const CARTRIDGE_MIRRORING_IDS: Record<MirroringMode, number> = {
    horizontal: 1,
    vertical: 2,
    "four-screen": 3,
};

export const CARTRIDGE_ERROR_IDS: Record<RomParseErrorCode, number> = {
    "truncated-header": 1,
    "invalid-magic": 2,
    "unsupported-version": 3,
    "invalid-rom-size": 4,
    "image-too-large": 5,
    "truncated-payload": 6,
};

/** Number of values a suite-9 record reports; a failed parse zeroes every field but the code. */
export const CARTRIDGE_REPORTED_VALUE_COUNT = 18;

/** Builds a ROM image of the requested length carrying the header at its front. */
export function make_cartridge_image(image_bytes: number, header: readonly number[]): Uint8Array {
    const image = new Uint8Array(image_bytes);
    image.set(header.slice(0, Math.min(CARTRIDGE_HEADER_BYTES, image_bytes)));
    return image;
}

/** Runs the reference parser and returns the eighteen suite-9 values for one header. */
export function project_cartridge_header(image_bytes: number, header: readonly number[]): number[] {
    const parsed = parse_ines_rom(make_cartridge_image(image_bytes, header));

    if (!parsed.ok) {
        return [0, CARTRIDGE_ERROR_IDS[parsed.error.code], ...new Array<number>(CARTRIDGE_HEADER_BYTES).fill(0)];
    }

    const rom = parsed.value;
    const prg_rom_offset = CARTRIDGE_HEADER_BYTES + (rom.trainer === null ? 0 : CARTRIDGE_TRAINER_BYTES);
    const chr_rom_offset = prg_rom_offset + rom.prg_rom.byteLength;

    return [
        1,
        0,
        CARTRIDGE_FORMAT_IDS[rom.format],
        rom.mapper_id,
        rom.submapper,
        CARTRIDGE_MIRRORING_IDS[rom.mirroring],
        rom.battery_backed ? 1 : 0,
        rom.trainer === null ? 0 : 1,
        rom.prg_rom.byteLength,
        rom.chr_rom.byteLength,
        rom.prg_ram_bytes,
        rom.prg_nvram_bytes,
        rom.chr_ram_bytes,
        rom.chr_nvram_bytes,
        CARTRIDGE_HEADER_BYTES,
        prg_rom_offset,
        chr_rom_offset,
        chr_rom_offset + rom.chr_rom.byteLength,
    ];
}
