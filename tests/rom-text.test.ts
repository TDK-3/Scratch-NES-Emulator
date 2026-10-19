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
    ROM_TEXT_SEPARATORS,
    decode_rom_text,
    digit_value_of_character,
    encode_rom_text,
} from "../src/nes/cartridge/rom_text.js";
import type { RomTextSeparator } from "../src/nes/cartridge/rom_text.js";

const GENERATOR_PATH = fileURLToPath(new URL("../scripts/generate_goboscript_rom_data.mjs", import.meta.url));
const SUPPLIED_ROM_PATH = fileURLToPath(new URL("../test_rom.nes", import.meta.url));
const SEPARATORS: readonly RomTextSeparator[] = ["space", "newline", "comma"];

test("every separator round-trips an image byte for byte", () => {
    const rom_bytes = readFileSync(SUPPLIED_ROM_PATH);
    const expected = Uint8Array.from(rom_bytes);

    for (const separator of SEPARATORS) {
        const encoding = encode_rom_text(expected, separator);
        assert.equal(encoding.separator, separator);
        assert.equal(encoding.byte_count, expected.byteLength);
        assert.equal(encoding.text.split(ROM_TEXT_SEPARATORS[separator]).length, expected.byteLength);

        const decoded = decode_rom_text(encoding.text);
        assert.equal(decoded.ok, true, `decoding ${separator}-separated text failed`);

        if (decoded.ok) {
            assert.equal(decoded.byte_count, expected.byteLength);
            assert.deepEqual(decoded.bytes, expected);
        }
    }
});

test("the newline encoding is the text the ROM data generator writes", () => {
    // scratch/data/test_rom_bytes.txt is what the build embeds, so a paste of that file has
    // to be the same text this encoder produces; otherwise the two paths disagree about the
    // format the port reads.
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
        assert.equal(encode_rom_text(rom_bytes, "newline").text + "\n", generated);

        const decoded = decode_rom_text(generated);
        assert.equal(decoded.ok, true, "the generated list data must decode as ROM text");

        if (decoded.ok) {
            assert.deepEqual(decoded.bytes, rom_bytes);
        }
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
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

test("any run of non-digit characters separates two values", () => {
    const image = Uint8Array.from([0x4e, 0x45, 0x53, 0x1a, 0, 255, 7, 8, 9, 10, 0, 1]);
    const mixed = "78,69 83\n26 0 255;7..8 9|10 0,1";
    const decoded = decode_rom_text(mixed);

    assert.equal(decoded.ok, true);

    if (decoded.ok) {
        assert.deepEqual(decoded.bytes, image);
    }

    // Leading, trailing, and repeated separators describe the same image.
    const padded_texts = [
        "  78 69 83 26 0 255 7 8 9 10 0 1  ",
        "78 69 83 26 0 255 7 8 9 10 0 1",
        ",,78,69,83,26,0,255,7,8,9,10,0,1,,,",
        "NES 78\n69\n83\n26\n0\n255\n7\n8\n9\n10\n0\n1\n",
    ];

    for (const padded of padded_texts) {
        const padded_decode = decode_rom_text(padded);
        assert.equal(padded_decode.ok, true, `decoding ${JSON.stringify(padded)} failed`);

        if (padded_decode.ok) {
            assert.deepEqual(padded_decode.bytes, image);
        }
    }
});

test("zero bytes keep their leading zeros", () => {
    const decoded = decode_rom_text("0 00 000 007 010 0255");
    assert.equal(decoded.ok, true);

    if (decoded.ok) {
        assert.deepEqual(decoded.bytes, Uint8Array.from([0, 0, 0, 7, 10, 255]));
    }
});

test("text that describes no image is an expected error, not an exception", () => {
    const empty = decode_rom_text("");
    assert.equal(empty.ok, false);

    if (!empty.ok) {
        assert.equal(empty.error.code, "empty");
        assert.equal(empty.error.byte_count, 0);
    }

    const separators_only = decode_rom_text(" \n,;");
    assert.equal(separators_only.ok, false);

    if (!separators_only.ok) {
        assert.equal(separators_only.error.code, "empty");
    }

    const out_of_range = decode_rom_text("78 69 256 26");
    assert.equal(out_of_range.ok, false);

    if (!out_of_range.ok) {
        assert.equal(out_of_range.error.code, "invalid-byte");
        assert.equal(out_of_range.error.byte_count, 2, "two values decoded before the failure");
    }

    const too_many = decode_rom_text(`0 ${"0 ".repeat(MAX_ROM_TEXT_BYTES)}`.trim());
    assert.equal(too_many.ok, false);

    if (!too_many.ok) {
        assert.equal(too_many.error.code, "too-many-bytes");
        assert.equal(too_many.error.byte_count, MAX_ROM_TEXT_BYTES);
    }

    const too_long = decode_rom_text("x".repeat(MAX_ROM_TEXT_CHARACTERS + 1));
    assert.equal(too_long.ok, false);

    if (!too_long.ok) {
        assert.equal(too_long.error.code, "too-long");
        assert.equal(too_long.error.byte_count, 0);
    }
});

test("one character casts to its digit value the way Scratch casts it", () => {
    for (let digit = 0; digit <= 9; digit += 1) {
        assert.equal(digit_value_of_character(String(digit)), digit);
    }

    for (const character of ["", "a", "Z", " ", "\n", ",", ".", "-", "+", "e", "\u001a", "0x1"]) {
        assert.equal(digit_value_of_character(character), 0, `expected ${JSON.stringify(character)} to read as zero`);
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

        for (const separator of SEPARATORS) {
            const decoded = decode_rom_text(encode_rom_text(image, separator).text);
            assert.equal(decoded.ok, true, `a ${byte_count}-byte image failed with ${separator} separators`);

            if (decoded.ok) {
                assert.deepEqual(decoded.bytes, image);
            }
        }
    }
});

test("a single-byte image encodes to its decimal value", () => {
    assert.equal(encode_rom_text(Uint8Array.from([0])).text, "0");
    assert.equal(encode_rom_text(Uint8Array.from([255]), "comma").text, "255");
    assert.equal(encode_rom_text(Uint8Array.of()).text, "");
    assert.equal(decode_rom_text(encode_rom_text(Uint8Array.of()).text).ok, false);
});
