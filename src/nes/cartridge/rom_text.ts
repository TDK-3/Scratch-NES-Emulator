/**
 * Hexadecimal byte text, the string form of a cartridge image.
 *
 * The GoboScript port cannot read a file, so `scratch/src/rom_input.gs` rebuilds its byte
 * list from a pasted string: every byte is exactly two hexadecimal digits, most significant
 * nibble first. The continuous form puts nothing between pairs, so a 40 KiB image is 80,000
 * characters instead of the 135,000 or so the old decimal format needed.
 *
 * Any character that is not a hexadecimal digit is a separator, so spaces, commas, and
 * newlines pasted in from an editor do not change the decoded bytes. That rule keeps the
 * format paste-tolerant without asking the Scratch side to recognize whitespace, which has no
 * direct block. A separator may fall between the two digits of a value; the digits still pair
 * in order.
 *
 * This module is the reference definition of that format. The browser converter page in
 * `src/nes/browser/rom_string_page.ts` encodes with it, and `tests/rom-text.test.ts` compares
 * the GoboScript decode mirror against it so the two sides cannot drift.
 *
 * Scratch has no split block, so the decode walks one character at a time. It reads a
 * character as a nibble with the Scratch number cast: "0x" joined with one hexadecimal digit
 * is a number in every Scratch runtime that casts with JavaScript's Number(), and every other
 * character casts to zero. Zero is also the value of the digit "0", so the decode tests that
 * character separately before trusting the cast. Two nibbles then make one byte.
 */

/**
 * How the encoder lays the hexadecimal pairs out. Every format decodes to the same bytes.
 *
 * - `continuous` writes the pairs back to back.
 * - `spaced` puts one space between two pairs.
 * - `lines` starts a new line every `ROM_TEXT_BYTES_PER_LINE` bytes.
 */
export type RomTextFormat = "continuous" | "spaced" | "lines";

/** The formats the converter page offers, shortest first. */
export const ROM_TEXT_FORMATS: readonly RomTextFormat[] = ["continuous", "spaced", "lines"];

/** The byte count a `lines` encoding puts on one line. */
export const ROM_TEXT_BYTES_PER_LINE = 16;

/**
 * The longest image the port accepts. Scratch caps a list at 200,000 items and silently
 * drops the adds past it, so an image beyond this point would load truncated.
 */
export const MAX_ROM_TEXT_BYTES = 200_000;

/**
 * The longest pasted text the decode accepts. A 200,000-byte image written in the
 * continuous form is 400,000 characters; the spaced form is 600,000 and the lined form adds
 * only one character per 16 bytes. This bound leaves room for extra separators while still
 * rejecting input that could not describe an acceptable image.
 */
export const MAX_ROM_TEXT_CHARACTERS = 1_000_000;

/** Why a decode stopped, as a result value rather than an exception. */
export type RomTextErrorCode = "empty" | "odd-digits" | "too-many-bytes" | "too-long";

export interface RomTextError {
    readonly code: RomTextErrorCode;
    readonly message: string;
    /** The byte count decoded before the failure, so a report can say how far it got. */
    readonly byte_count: number;
}

export interface RomTextEncoding {
    readonly text: string;
    readonly byte_count: number;
    readonly format: RomTextFormat;
}

export type RomTextDecodeResult =
    | { readonly ok: true; readonly bytes: Uint8Array; readonly byte_count: number }
    | { readonly ok: false; readonly error: RomTextError };

/**
 * Writes an image as hexadecimal byte values.
 *
 * @param rom_bytes The image to encode; it is not validated here, because the loader that
 *   reads the text back reports header and payload problems.
 * @param format How to lay the pairs out; `continuous` is the shortest.
 */
export function encode_rom_text(rom_bytes: Uint8Array, format: RomTextFormat = "continuous"): RomTextEncoding {
    const pairs = Array.from(rom_bytes, (byte) => byte.toString(16).padStart(2, "0"));
    let text: string;

    if (format === "spaced") {
        text = pairs.join(" ");
    } else if (format === "lines") {
        const lines: string[] = [];

        for (let start = 0; start < pairs.length; start += ROM_TEXT_BYTES_PER_LINE) {
            lines.push(pairs.slice(start, start + ROM_TEXT_BYTES_PER_LINE).join(""));
        }

        text = lines.join("\n");
    } else {
        text = pairs.join("");
    }

    return { text, byte_count: rom_bytes.byteLength, format };
}

/**
 * Reads hexadecimal byte text back into an image.
 *
 * @param text The pasted hexadecimal digits. Any character that is not a hexadecimal digit
 *   separates two digits, so whitespace, commas, and stray punctuation are all accepted.
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
    // Negative means no first nibble is waiting; the port mirrors this with a 0/1 flag.
    let pending_nibble = -1;

    for (const character of text) {
        const nibble_value = hex_nibble_of_character(character);

        if (nibble_value < 0) {
            continue;
        }

        if (pending_nibble < 0) {
            pending_nibble = nibble_value;
            continue;
        }

        if (bytes.length >= MAX_ROM_TEXT_BYTES) {
            return decode_failure(
                "too-many-bytes",
                `The ROM text describes more than the ${MAX_ROM_TEXT_BYTES} bytes a Scratch list holds.`,
                bytes.length,
            );
        }

        bytes.push(pending_nibble * 16 + nibble_value);
        pending_nibble = -1;
    }

    if (pending_nibble >= 0) {
        return decode_failure(
            "odd-digits",
            "The ROM text ends with a hexadecimal digit that has no partner.",
            bytes.length,
        );
    }

    if (bytes.length === 0) {
        return decode_failure("empty", "The ROM text holds no byte values.", 0);
    }

    return { ok: true, bytes: Uint8Array.from(bytes), byte_count: bytes.length };
}

/**
 * Reads one character as a hexadecimal nibble, or returns -1 when it is a separator.
 *
 * Scratch's string-to-number cast follows JavaScript's Number(): "0x" followed by one
 * hexadecimal digit reads as that nibble, while every other character reads as zero. The
 * digit "0" therefore needs its own test, because zero is also what a separator casts to.
 * The port's decode performs the same two steps inline.
 */
export function hex_nibble_of_character(character: string): number {
    if (character.length !== 1) {
        return -1;
    }

    if (character === "0") {
        return 0;
    }

    const numeric = Number(`0x${character}`);

    return Number.isNaN(numeric) ? -1 : numeric;
}

function decode_failure(code: RomTextErrorCode, message: string, byte_count: number): RomTextDecodeResult {
    return { ok: false, error: { code, message, byte_count } };
}
