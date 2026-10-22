import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MAX_ROM_IMAGE_BYTES, parse_ines_rom } from "../src/nes/cartridge/ines.js";
import type { InesRom, RomParseErrorCode } from "../src/nes/cartridge/ines.js";

const HEADER_BYTES = 16;
const PRG_BANK_BYTES = 16_384;
const CHR_BANK_BYTES = 8_192;
const LEGACY_PRG_RAM_BANK_BYTES = 8_192;
const TEST_ROM = readFileSync(new URL("../test_rom.nes", import.meta.url));

test("parses the supplied mapper 0 iNES test ROM", () => {
    const rom = require_rom(TEST_ROM);

    assert.equal(rom.format, "ines-1.0");
    assert.equal(rom.mapper_id, 0);
    assert.equal(rom.submapper, 0);
    assert.equal(rom.mirroring, "vertical");
    assert.equal(rom.battery_backed, false);
    assert.equal(rom.trainer, null);
    assert.equal(rom.prg_rom.byteLength, 2 * PRG_BANK_BYTES);
    assert.equal(rom.chr_rom.byteLength, CHR_BANK_BYTES);
    assert.equal(rom.prg_ram_bytes, LEGACY_PRG_RAM_BANK_BYTES);
    assert.equal(rom.prg_nvram_bytes, 0);
});

test("decodes iNES mapper nibbles, horizontal mirroring, and battery-backed PRG RAM", () => {
    const data = make_ines_image(2, 1);
    data[6] = 0xb2;
    data[7] = 0xa0;
    data[8] = 2;

    const rom = require_rom(data);

    assert.equal(rom.format, "ines-1.0");
    assert.equal(rom.mapper_id, 0xab);
    assert.equal(rom.submapper, 0);
    assert.equal(rom.mirroring, "horizontal");
    assert.equal(rom.battery_backed, true);
    assert.equal(rom.prg_ram_bytes, 0);
    assert.equal(rom.prg_nvram_bytes, 2 * LEGACY_PRG_RAM_BANK_BYTES);
    assert.equal(rom.prg_rom.byteLength, 2 * PRG_BANK_BYTES);
    assert.equal(rom.chr_rom.byteLength, CHR_BANK_BYTES);
    assert.equal(rom.chr_ram_bytes, 0);
    assert.equal(rom.chr_nvram_bytes, 0);
});

test("uses iNES mapper and battery defaults plus default RAM sizes for zero CHR ROM", () => {
    const rom = require_rom(make_ines_image(1, 0));

    assert.equal(rom.format, "ines-1.0");
    assert.equal(rom.mapper_id, 0);
    assert.equal(rom.submapper, 0);
    assert.equal(rom.mirroring, "horizontal");
    assert.equal(rom.battery_backed, false);
    assert.equal(rom.prg_ram_bytes, LEGACY_PRG_RAM_BANK_BYTES);
    assert.equal(rom.prg_nvram_bytes, 0);
    assert.equal(rom.chr_rom.byteLength, 0);
    assert.equal(rom.chr_ram_bytes, CHR_BANK_BYTES);
    assert.equal(rom.chr_nvram_bytes, 0);
});

test("rejects a short header before reading header fields", () => {
    assert_parse_error(new Uint8Array(HEADER_BYTES - 1), "truncated-header");
});

test("rejects an input buffer over the configured ROM image limit before reading its header", () => {
    const oversized_data = new Proxy(new Uint8Array(0), {
        get(target, property) {
            return property === "byteLength"
                ? MAX_ROM_IMAGE_BYTES + 1
                : Reflect.get(target, property, target);
        },
    }) as Uint8Array;

    assert_parse_error(oversized_data, "image-too-large");
});

test("rejects a NES 2.0 image whose declared payload pushes total size over the limit", () => {
    const data = new Uint8Array(HEADER_BYTES);
    set_ines_header(data, 0, 0);
    data[7] = 0x08;
    data[4] = 0x64;
    data[9] = 0x0f;

    assert_parse_error(data, "image-too-large");
});

test("rejects an invalid iNES signature", () => {
    const data = make_ines_image(1, 0);
    data[0] = 0;

    assert_parse_error(data, "invalid-magic");
});

test("rejects truncated trainer, PRG ROM, and CHR ROM payloads", () => {
    const truncated_trainer = new Uint8Array(HEADER_BYTES + 511);
    set_ines_header(truncated_trainer, 1, 0);
    truncated_trainer[6] = 0x04;

    const truncated_prg = new Uint8Array(HEADER_BYTES + PRG_BANK_BYTES - 1);
    set_ines_header(truncated_prg, 1, 0);

    const truncated_chr = new Uint8Array(HEADER_BYTES + PRG_BANK_BYTES + CHR_BANK_BYTES - 1);
    set_ines_header(truncated_chr, 1, 1);

    assert_parse_error(truncated_trainer, "truncated-payload");
    assert_parse_error(truncated_prg, "truncated-payload");
    assert_parse_error(truncated_chr, "truncated-payload");
});

test("decodes NES 2.0 mapper, submapper, and RAM sizes", () => {
    const data = new Uint8Array(HEADER_BYTES + PRG_BANK_BYTES + CHR_BANK_BYTES);
    set_ines_header(data, 1, 1);
    data[6] = 0x43;
    data[7] = 0x28;
    data[8] = 0xa3;
    data[9] = 0x00;
    data[10] = 0x31;
    data[11] = 0xa2;

    const rom = require_rom(data);

    assert.equal(rom.format, "nes-2.0");
    assert.equal(rom.mapper_id, 0x324);
    assert.equal(rom.submapper, 0x0a);
    assert.equal(rom.mirroring, "vertical");
    assert.equal(rom.battery_backed, true);
    assert.equal(rom.prg_ram_bytes, 128);
    assert.equal(rom.prg_nvram_bytes, 512);
    assert.equal(rom.chr_ram_bytes, 256);
    assert.equal(rom.chr_nvram_bytes, 65_536);
});

test("decodes NES 2.0 extended PRG and CHR ROM size fields", () => {
    const prg_banks = 0x101;
    const chr_banks = 0x102;
    const data = new Uint8Array(
        HEADER_BYTES + prg_banks * PRG_BANK_BYTES + chr_banks * CHR_BANK_BYTES,
    );
    set_ines_header(data, 1, 2);
    data[7] = 0x08;
    data[9] = 0x11;

    const rom = require_rom(data);

    assert.equal(rom.format, "nes-2.0");
    assert.equal(rom.prg_rom.byteLength, prg_banks * PRG_BANK_BYTES);
    assert.equal(rom.chr_rom.byteLength, chr_banks * CHR_BANK_BYTES);
});

test("decodes the NES 2.0 exponent and multiplier ROM size form", () => {
    const data = new Uint8Array(HEADER_BYTES + 24);
    set_ines_header(data, 0, 0);
    data[7] = 0x08;
    data[4] = 0x0d;
    data[9] = 0x0f;

    const rom = require_rom(data);

    assert.equal(rom.format, "nes-2.0");
    assert.equal(rom.prg_rom.byteLength, 24);
    assert.equal(rom.chr_rom.byteLength, 0);
});

test("decodes NES 2.0 exponent and multiplier encoding for CHR ROM", () => {
    const data = new Uint8Array(HEADER_BYTES + PRG_BANK_BYTES + 6);
    set_ines_header(data, 1, 0);
    data[7] = 0x08;
    data[5] = 0x05;
    data[9] = 0xf0;

    const rom = require_rom(data);

    assert.equal(rom.prg_rom.byteLength, PRG_BANK_BYTES);
    assert.equal(rom.chr_rom.byteLength, 6);
});

test("uses declared NES 2.0 CHR RAM and NVRAM when CHR ROM is zero", () => {
    const data = make_ines_image(1, 0);
    data[6] = 0x02;
    data[7] = 0x08;
    data[11] = 0x67;

    const rom = require_rom(data);

    assert.equal(rom.chr_rom.byteLength, 0);
    assert.equal(rom.battery_backed, true);
    assert.equal(rom.chr_ram_bytes, CHR_BANK_BYTES);
    assert.equal(rom.chr_nvram_bytes, CHR_BANK_BYTES / 2);
});

test("keeps zero NES 2.0 RAM shifts as zero instead of applying iNES defaults", () => {
    const data = make_ines_image(1, 0);
    data[7] = 0x08;

    const rom = require_rom(data);

    assert.equal(rom.format, "nes-2.0");
    assert.equal(rom.battery_backed, false);
    assert.equal(rom.prg_ram_bytes, 0);
    assert.equal(rom.prg_nvram_bytes, 0);
    assert.equal(rom.chr_ram_bytes, 0);
    assert.equal(rom.chr_nvram_bytes, 0);
});

test("rejects NES 2.0 PRG or CHR ROM sizes that exceed safe integer precision", () => {
    const invalid_prg = new Uint8Array(HEADER_BYTES);
    set_ines_header(invalid_prg, 0, 0);
    invalid_prg[7] = 0x08;
    invalid_prg[4] = 0xfc;
    invalid_prg[9] = 0x0f;

    const invalid_chr = new Uint8Array(HEADER_BYTES);
    set_ines_header(invalid_chr, 1, 0);
    invalid_chr[7] = 0x08;
    invalid_chr[5] = 0xfc;
    invalid_chr[9] = 0xf0;

    assert_parse_error(invalid_prg, "invalid-rom-size");
    assert_parse_error(invalid_chr, "invalid-rom-size");
});

test("rejects NES 2.0 declared PRG and CHR sizes whose combined payload overflows safe integers", () => {
    const data = new Uint8Array(HEADER_BYTES);
    set_ines_header(data, 0, 0);
    data[7] = 0x08;
    data[4] = 0xd0;
    data[5] = 0xd0;
    data[9] = 0xff;

    assert_parse_error(data, "invalid-rom-size");
});

test("uses four-screen mirroring when its flag is set", () => {
    const data = make_ines_image(1, 0);
    data[6] = 0x09;

    assert.equal(require_rom(data).mirroring, "four-screen");
});

test("skips the optional trainer and copies all parsed payload slices", () => {
    const data = Buffer.from(new Uint8Array(HEADER_BYTES + 512 + PRG_BANK_BYTES + CHR_BANK_BYTES));
    set_ines_header(data, 1, 1);
    data[6] = 0x04;
    const prg_offset = HEADER_BYTES + 512;
    const chr_offset = prg_offset + PRG_BANK_BYTES;
    data.fill(0xaa, HEADER_BYTES, prg_offset);
    data.fill(0x5c, prg_offset, chr_offset);
    data.fill(0x31, chr_offset);

    const rom = require_rom(data);

    assert.ok(rom.trainer);
    assert.equal(rom.trainer.byteLength, 512);
    assert.equal(rom.trainer[0], 0xaa);
    assert.equal(rom.trainer[511], 0xaa);
    assert.equal(rom.prg_rom.byteLength, PRG_BANK_BYTES);
    assert.equal(rom.prg_rom[0], 0x5c);
    assert.equal(rom.prg_rom[PRG_BANK_BYTES - 1], 0x5c);
    assert.equal(rom.chr_rom.byteLength, CHR_BANK_BYTES);
    assert.equal(rom.chr_rom[0], 0x31);
    assert.equal(rom.chr_rom[CHR_BANK_BYTES - 1], 0x31);
    assert.equal(rom.chr_ram_bytes, 0);

    data.fill(0);

    assert.equal(rom.trainer[0], 0xaa);
    assert.equal(rom.prg_rom[0], 0x5c);
    assert.equal(rom.chr_rom[0], 0x31);
});

test("rejects archaic and reserved header versions", () => {
    for (const version_bits of [0x04, 0x0c]) {
        const data = make_ines_image(1, 0);
        data[7] = version_bits;

        assert_parse_error(data, "unsupported-version");
    }
});

test("rejects a header with no PRG ROM", () => {
    assert_parse_error(make_ines_image(0, 0), "invalid-rom-size");
});

function assert_parse_error(data: Uint8Array, expected_code: RomParseErrorCode): void {
    const result = parse_ines_rom(data);

    if (result.ok) {
        assert.fail(`Expected parsing to fail with "${expected_code}".`);
    }

    assert.equal(result.error.code, expected_code);
}

function make_ines_image(prg_banks: number, chr_banks: number): Uint8Array {
    const data = new Uint8Array(HEADER_BYTES + prg_banks * PRG_BANK_BYTES + chr_banks * CHR_BANK_BYTES);
    set_ines_header(data, prg_banks, chr_banks);

    return data;
}

function set_ines_header(data: Uint8Array, prg_banks: number, chr_banks: number): void {
    data.set([0x4e, 0x45, 0x53, 0x1a], 0);
    data[4] = prg_banks;
    data[5] = chr_banks;
}

function require_rom(data: Uint8Array): InesRom {
    const result = parse_ines_rom(data);

    if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.message}`);
    }

    return result.value;
}
