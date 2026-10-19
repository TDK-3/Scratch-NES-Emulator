/**
 * Decimal byte text, the string form of a cartridge image.
 *
 * The GoboScript port cannot read a file, so `scratch/src/rom_input.gs` rebuilds its byte
 * list from a pasted string: decimal byte values, separated by any run of characters that is
 * not a decimal digit. Spaces, commas, and newlines are all separators, which makes the text
 * that `scripts/generate_goboscript_rom_data.mjs` writes paste-ready without editing.
 *
 * This module is the reference definition of that format. The browser converter page in
 * `src/nes/browser/rom_string_page.ts` encodes with it, and `tests/rom-text.test.ts` compares
 * the GoboScript decode mirror against it so the two sides cannot drift.
 *
 * The decode walks one character at a time because Scratch offers no split: it folds digits
 * into the byte under construction and treats every other character as the separator that
 * finishes it. One step past the end of the text reads the empty string, which is the
 * separator that flushes a final value, so a text with no trailing separator still decodes.
 */

/** The separator the encoder puts between two byte values. */
export type RomTextSeparator = "space" | "newline" | "comma";

/** The separator text for each encoding choice. */
export const ROM_TEXT_SEPARATORS: Readonly<Record<RomTextSeparator, string>> = {
    space: " ",
    newline: "\n",
    comma: ",",
};

/**
 * The longest image the port accepts. Scratch caps a list at 200,000 items and silently
 * drops the adds past it, so an image beyond this point would load truncated.
 */
export const MAX_ROM_TEXT_BYTES = 200_000;

/**
 * The longest pasted text the decode accepts. A 200,000-byte image written as three-digit
 * values with one separator each is 800,000 characters, so this bound only rejects input
 * that could not describe an acceptable image.
 */
export const MAX_ROM_TEXT_CHARACTERS = 1_000_000;

/** Why a decode stopped, as a result value rather than an exception. */
export type RomTextErrorCode = "empty" | "invalid-byte" | "too-many-bytes" | "too-long";

export interface RomTextError {
    readonly code: RomTextErrorCode;
    readonly message: string;
    /** The byte count decoded before the failure, so a report can say how far it got. */
    readonly byte_count: number;
}

export interface RomTextEncoding {
    readonly text: string;
    readonly byte_count: number;
    readonly separator: RomTextSeparator;
}

export type RomTextDecodeResult =
    | { readonly ok: true; readonly bytes: Uint8Array; readonly byte_count: number }
    | { readonly ok: false; readonly error: RomTextError };

/**
 * Writes an image as decimal byte values.
 *
 * @param rom_bytes The image to encode; it is not validated here, because the loader that
 *   reads the text back reports header and payload problems.
 * @param separator The text placed between two byte values.
 */
export function encode_rom_text(rom_bytes: Uint8Array, separator: RomTextSeparator = "space"): RomTextEncoding {
    const separator_text = ROM_TEXT_SEPARATORS[separator];
    const text = Array.from(rom_bytes, (byte) => byte.toString(10)).join(separator_text);

    return { text, byte_count: rom_bytes.byteLength, separator };
}

/**
 * Reads decimal byte text back into an image.
 *
 * @param text The pasted byte values. Any character that is not a decimal digit separates
 *   two values, so whitespace, commas, and stray punctuation are all accepted.
 */
export function decode_rom_text(text: string): RomTextDecodeResult {
    if (text.length === 0) {
        return decode_failure("empty", "The ROM text is empty.", 0);
    }

    if (text.length > MAX_ROM_TEXT_CHARACTERS) {
        return decode_failure(
            "too-long",
            `The ROM text is ${text.length} characters, over the ${MAX_ROM_TEXT_CHARACTERS}-character limit.`,
            0,
        );
    }

    const bytes: number[] = [];
    let byte_value = 0;
    let has_digits = false;

    for (let cursor = 0; cursor <= text.length; cursor += 1) {
        const character = text[cursor] ?? "";
        const digit_value = digit_value_of_character(character);

        if (digit_value > 0) {
            byte_value = byte_value * 10 + digit_value;
            has_digits = true;
        } else if (character === "0") {
            byte_value *= 10;
            has_digits = true;
        } else if (has_digits) {
            has_digits = false;

            if (byte_value > 255) {
                return decode_failure(
                    "invalid-byte",
                    `Byte value ${byte_value} at value ${bytes.length + 1} is outside 0-255.`,
                    bytes.length,
                );
            }

            if (bytes.length >= MAX_ROM_TEXT_BYTES) {
                return decode_failure(
                    "too-many-bytes",
                    `The ROM text describes more than the ${MAX_ROM_TEXT_BYTES} bytes a Scratch list holds.`,
                    bytes.length,
                );
            }

            bytes.push(byte_value);
            byte_value = 0;
        }
    }

    if (bytes.length === 0) {
        return decode_failure("empty", "The ROM text holds no byte values.", 0);
    }

    return { ok: true, bytes: Uint8Array.from(bytes), byte_count: bytes.length };
}

/**
 * Scratch's string-to-number cast for one character: a decimal digit keeps its value, and
 * every other character reads as zero. The port casts a single character the same way,
 * which is what lets the decode test one character instead of a table of ten.
 */
export function digit_value_of_character(character: string): number {
    if (character.length !== 1) {
        return 0;
    }

    const numeric = Number(character);

    return Number.isNaN(numeric) ? 0 : numeric;
}

function decode_failure(code: RomTextErrorCode, message: string, byte_count: number): RomTextDecodeResult {
    return { ok: false, error: { code, message, byte_count } };
}
