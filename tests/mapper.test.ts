import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parse_ines_rom } from "../src/nes/cartridge/ines.js";
import { resolve_mapper } from "../src/nes/cartridge/mapper.js";
import type { InesRom } from "../src/nes/cartridge/ines.js";

const HEADER_BYTES = 16;
const PRG_BANK_BYTES = 16_384;
const TEST_ROM = readFileSync(new URL("../test_rom.nes", import.meta.url));

test("selects the explicit mapper 0/submapper 0 NROM route", () => {
    assert.deepEqual(resolve_mapper({ mapper_id: 0, submapper: 0 }), {
        ok: true,
        value: { mapper_id: 0, submapper: 0, kind: "nrom" },
    });
});

test("rejects unlisted NES 2.0 submappers for mapper 0 and mapper 4", () => {
    for (const mapper_id of [0, 4]) {
        const result = resolve_mapper(make_nes2_rom(mapper_id, 1));

        assert.equal(result.ok, false);

        if (!result.ok) {
            assert.equal(result.error.code, "unsupported-submapper");
            assert.equal(result.error.mapper_id, mapper_id);
            assert.equal(result.error.submapper, 1);
        }
    }
});

test("selects the supplied mapper 4 ROM for the MMC3 route", () => {
    const rom = parse_rom(TEST_ROM);

    assert.equal(rom.mapper_id, 4);
    assert.equal(rom.submapper, 0);

    assert.deepEqual(resolve_mapper(rom), {
        ok: true,
        value: { mapper_id: 4, submapper: 0, kind: "mmc3" },
    });
});

test("rejects unregistered NES 2.0 mapper IDs and preserves the requested identity", () => {
    const rom = make_nes2_rom(0x123, 0);
    const result = resolve_mapper(rom);

    assert.equal(result.ok, false);

    if (!result.ok) {
        assert.equal(result.error.code, "unsupported-mapper");
        assert.equal(result.error.mapper_id, 0x123);
        assert.equal(result.error.submapper, 0);
    }
});

function make_nes2_rom(mapper_id: number, submapper: number): InesRom {
    const data = new Uint8Array(HEADER_BYTES + PRG_BANK_BYTES);
    data.set([0x4e, 0x45, 0x53, 0x1a], 0);
    data[4] = 1;
    data[6] = (mapper_id & 0x0f) << 4;
    data[7] = 0x08 | (mapper_id & 0xf0);
    data[8] = (submapper << 4) | ((mapper_id >> 8) & 0x0f);

    return parse_rom(data);
}

function parse_rom(data: Uint8Array): InesRom {
    const result = parse_ines_rom(data);

    if (!result.ok) {
        assert.fail(`Expected a valid ROM header, received ${result.error.code}.`);
    }

    return result.value;
}
