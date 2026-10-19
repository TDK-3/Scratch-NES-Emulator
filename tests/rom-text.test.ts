import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse_ines_rom } from "../src/nes/cartridge/ines.js";
import {
    MAX_ROM_TEXT_BYTES,
    MAX_ROM_TEXT_CHARACTERS,
    ROM_TEXT_BYTES_PER_LINE,
    decode_rom_text,
    encode_rom_text,
    hex_nibble_of_character,
} from "../src/nes/cartridge/rom_text.js";
import type { RomTextFormat } from "../src/nes/cartridge/rom_text.js";

const GENERATOR_PATH = fileURLToPath(new URL("../scripts/generate_goboscript_rom_data.mjs", import.meta.url));
const SUPPLIED_ROM_PATH = fileURLToPath(new URL("../test_rom.nes", import.meta.url));
const FORMATS: readonly RomTextFormat[] = ["continuous", "spaced", "lines"];

test("the continuous encoding is two lowercase hexadecimal digits per byte", () => {
    // The example the format promises: 0a 0b 0e 01 3b packs into one run of characters.
    const example = Uint8Array.from([0x0a, 0x0b, 0x0e, 0x01, 0x3b]);

    assert.equal(encode_rom_text(example).text, "0a0b0e013b");
    assert.equal(encode_rom_text(Uint8Array.from([0, 1, 15, 16, 255])).text, "00010f10ff");
    assert.equal(encode_rom_text(Uint8Array.of()).text, "");

    // The layouts only change where the separators fall.
    assert.equal(encode_rom_text(example, "spaced").text, "0a 0b 0e 01 3b");

    const seventeen_bytes = Uint8Array.from({ length: ROM_TEXT_BYTES_PER_LINE + 1 }, (_, index) => index);

    assert.equal(
        encode_rom_text(seventeen_bytes, "lines").text,
        "000102030405060708090a0b0c0d0e0f\n10",
    );
});

test("every format round-trips an image byte for byte", () => {
    const rom_bytes = Uint8Array.from(readFileSync(SUPPLIED_ROM_PATH));

    for (const format of FORMATS) {
        const encoding = encode_rom_text(rom_bytes, format);
        assert.equal(encoding.format, format);
        assert.equal(encoding.byte_count, rom_bytes.byteLength);

        if (format === "continuous") {
            assert.equal(encoding.text.length, rom_bytes.byteLength * 2, "two characters per byte");
        } else if (format === "spaced") {
            assert.equal(encoding.text.length, rom_bytes.byteLength * 3 - 1, "two digits and a space per byte");
        } else {
            const lines = encoding.text.split("\n");
            assert.equal(lines.length, Math.ceil(rom_bytes.byteLength / ROM_TEXT_BYTES_PER_LINE));
            assert.ok(lines.every((line) => line.length <= ROM_TEXT_BYTES_PER_LINE * 2));
        }

        const decoded = decode_rom_text(encoding.text);
        assert.equal(decoded.ok, true, `decoding the ${format} text failed`);

        if (decoded.ok) {
            assert.equal(decoded.byte_count, rom_bytes.byteLength);
            assert.deepEqual(decoded.bytes, rom_bytes);
        }
    }
});

test("the continuous text is shorter than the old decimal form", () => {
    const rom_bytes = Uint8Array.from(readFileSync(SUPPLIED_ROM_PATH));
    const decimal_text = Array.from(rom_bytes, (byte) => byte.toString(10)).join(" ");
    const hex_text = encode_rom_text(rom_bytes).text;

    assert.equal(hex_text.length, rom_bytes.byteLength * 2);
    assert.ok(hex_text.length < decimal_text.length, "the packed hex form must be the shorter one");
});

test("a decoded image is the image the header parser accepts", () => {
    const rom_bytes = Uint8Array.from(readFileSync(SUPPLIED_ROM_PATH));
    const decoded = decode_rom_text(encode_rom_text(rom_bytes).text);
    assert.equal(decoded.ok, true);

    const parsed = decoded.ok ? parse_ines_rom(decoded.bytes) : null;
    assert.equal(parsed?.ok, true);

    if (parsed?.ok) {
        assert.equal(parsed.value.mapper_id, 4);
        assert.equal(parsed.value.prg_rom.byteLength, 65_536);
        assert.equal(parsed.value.chr_rom.byteLength, 16_384);
    }
});

test("any character that is not a hexadecimal digit separates two digits", () => {
    const image = Uint8Array.from([0x4e, 0x45, 0x53, 0x1a, 0, 255, 7, 8, 9, 10, 0, 1]);
    const mixed = "4e,45 53\n1a 00 ff;07..08 09|0a 00,01";
    const decoded = decode_rom_text(mixed);

    assert.equal(decoded.ok, true);

    if (decoded.ok) {
        assert.deepEqual(decoded.bytes, image);
    }

    // Uppercase digits decode the same, and separators may fall between the two digits of
    // one byte because the digits pair in order.
    for (const padded of [
        "  4E 45 53 1A 00 FF 07 08 09 0A 00 01  ",
        "4E4553 1A00FF0708 090A0001",
        "4 e 4 5 5 3 1 a 0 0 f f 0 7 0 8 0 9 0 a 0 0 0 1",
        ",,4e,45,53,1a,00,ff,07,08,09,0a,00,01,,,",
    ]) {
        const padded_decode = decode_rom_text(padded);
        assert.equal(padded_decode.ok, true, `decoding ${JSON.stringify(padded)} failed`);

        if (padded_decode.ok) {
            assert.deepEqual(padded_decode.bytes, image);
        }
    }
});

test("an odd number of hexadecimal digits is an expected error", () => {
    for (const text of ["0a0", "0a 0", "f", "4e45531a0"]) {
        const decoded = decode_rom_text(text);
        assert.equal(decoded.ok, false, `${text} must not decode`);

        if (!decoded.ok) {
            assert.equal(decoded.error.code, "odd-digits", text);
            assert.equal(decoded.error.byte_count, Math.floor(text.replace(/[^0-9a-f]/gi, "").length / 2));
        }
    }
});

test("text that describes no image is an expected error, not an exception", () => {
    const empty = decode_rom_text("");
    assert.equal(empty.ok, false);

    if (!empty.ok) {
        assert.equal(empty.error.code, "empty");
        assert.equal(empty.error.byte_count, 0);
    }

    const separators_only = decode_rom_text(" \n,;.-+");
    assert.equal(separators_only.ok, false);

    if (!separators_only.ok) {
        assert.equal(separators_only.error.code, "empty");
    }

    const too_many = decode_rom_text("0a".repeat(MAX_ROM_TEXT_BYTES + 1));
    assert.equal(too_many.ok, false);

    if (!too_many.ok) {
        assert.equal(too_many.error.code, "too-many-bytes");
        assert.equal(too_many.error.byte_count, MAX_ROM_TEXT_BYTES);
    }

    const too_long = decode_rom_text("0".repeat(MAX_ROM_TEXT_CHARACTERS + 1));
    assert.equal(too_long.ok, false);

    if (!too_long.ok) {
        assert.equal(too_long.error.code, "too-long");
        assert.equal(too_long.error.byte_count, 0);
    }
});

test("one character casts to its hex value the way Scratch casts it", () => {
    for (let digit = 0; digit <= 9; digit += 1) {
        assert.equal(hex_nibble_of_character(String(digit)), digit);
    }

    for (const [index, character] of Array.from("abcdef").entries()) {
        assert.equal(hex_nibble_of_character(character), 10 + index);
        assert.equal(hex_nibble_of_character(character.toUpperCase()), 10 + index);
    }

    for (const character of ["", "g", "G", "z", " ", "\n", ",", ".", "-", "+", "x", "\u001a"]) {
        assert.equal(hex_nibble_of_character(character), -1, `expected ${JSON.stringify(character)} to be a separator`);
    }
});

test("a deterministic corpus of images survives the round trip", () => {
    let state = 0x2f6e2b1;

    const next_value = (limit: number): number => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;

        return state % limit;
    };

    for (const byte_count of [1, 2, 16, 17, 255, 256, 1_023, 4_096]) {
        const image = Uint8Array.from({ length: byte_count }, () => next_value(256));

        for (const format of FORMATS) {
            const decoded = decode_rom_text(encode_rom_text(image, format).text);
            assert.equal(decoded.ok, true, `a ${byte_count}-byte image failed with the ${format} format`);

            if (decoded.ok) {
                assert.deepEqual(decoded.bytes, image);
            }
        }
    }
});

test("the build-time decimal list and the paste format describe the same image", () => {
    // The embedded Scratch list is still one decimal value per line, because a file-backed
    // list loads one item per line and the port reads those items as bytes. The paste format
    // is separate: the converter page writes the hexadecimal string this test decodes.
    const temporary_directory = mkdtempSync(join(tmpdir(), "rom-text-generator-"));
    const output_path = join(temporary_directory, "generated_bytes.txt");

    try {
        const result = spawnSync(process.execPath, [GENERATOR_PATH, "--output", output_path], {
            encoding: "utf8",
            timeout: 8_000,
            cwd: fileURLToPath(new URL("..", import.meta.url)),
        });

        assert.equal(result.status, 0, result.stderr);

        const generated = readFileSync(output_path, "ascii");
        const rom_bytes = Uint8Array.from(readFileSync(SUPPLIED_ROM_PATH));
        assert.deepEqual(
            generated.trimEnd().split("\n").map(Number),
            Array.from(rom_bytes),
            "the build-time list still reconstructs the image",
        );

        const decoded = decode_rom_text(encode_rom_text(rom_bytes).text);
        assert.equal(decoded.ok, true, "the hex text the converter page writes must decode as ROM text");

        if (decoded.ok) {
            assert.deepEqual(decoded.bytes, rom_bytes);
        }
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
});
