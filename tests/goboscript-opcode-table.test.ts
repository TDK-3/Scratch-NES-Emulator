import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    CPU_OPCODE_TABLE,
    OFFICIAL_OPCODE_DEFINITIONS,
    UNOFFICIAL_OPCODE_DEFINITIONS,
} from "../src/nes/cpu/opcode_table.js";
import { CPU_ADDRESSING_MODES, CPU_OPERAND_ACCESSES } from "./support/cpu_addressing_projection.js";

/**
 * The opcode decode table the GoboScript port loads at build time.
 *
 * `tests/fixtures/goboscript/opcode_table.json` is the canonical, checked-in form of
 * `CPU_OPCODE_TABLE`, encoded as small integers because a Scratch list can only hold numbers.
 * `scripts/generate_goboscript_opcode_table.mjs` flattens it into the ignored decimal list
 * `scratch/data/opcode_table.txt`, which `scratch/src/cpu_opcode.gs` reads. These tests keep
 * the fixture equal to the production table, keep the generated list equal to the fixture, and
 * keep the generator from overwriting its own input.
 */

const FIXTURE_PATH = new URL("./fixtures/goboscript/opcode_table.json", import.meta.url);
const GENERATOR_PATH = fileURLToPath(new URL("../scripts/generate_goboscript_opcode_table.mjs", import.meta.url));

const FIELDS = [
    "mnemonic_id",
    "addressing_mode_id",
    "base_cycles",
    "operand_access_id",
    "page_cross_cycle",
    "official",
] as const;

interface OpcodeTableMnemonic {
    readonly id: number;
    readonly name: string;
}

interface OpcodeTableEntry {
    readonly opcode: number;
    readonly mnemonic_id: number;
    readonly addressing_mode_id: number;
    readonly base_cycles: number;
    readonly operand_access_id: number;
    readonly page_cross_cycle: number;
    readonly official: number;
}

interface OpcodeTableFixture {
    readonly schema_version: number;
    readonly source: string;
    readonly license: string;
    readonly mnemonic_count: number;
    readonly mnemonics: readonly OpcodeTableMnemonic[];
    readonly field_count: number;
    readonly fields: readonly string[];
    readonly opcode_count: number;
    readonly opcodes: readonly OpcodeTableEntry[];
}

const fixture_text = readFileSync(FIXTURE_PATH, "utf8");
const fixture = JSON.parse(fixture_text) as OpcodeTableFixture;

/** Runs the generator and returns its exit status, stdout, and stderr. */
function run_generator(args: readonly string[]): { status: number | null; stderr: string } {
    const result = spawnSync(process.execPath, [GENERATOR_PATH, ...args], { encoding: "utf8", timeout: 5_000 });
    assert.equal(result.error, undefined, result.error?.message);
    return { status: result.status, stderr: result.stderr };
}

test("the opcode table fixture matches the production table for all 256 opcodes", () => {
    assert.equal(fixture.schema_version, 1);
    assert.equal(fixture.source, "src/nes/cpu/opcode_table.ts");
    assert.deepEqual([...fixture.fields], [...FIELDS]);
    assert.equal(fixture.field_count, FIELDS.length);
    assert.equal(fixture.opcode_count, 256);
    assert.equal(fixture.opcodes.length, 256);

    const official = new Set(OFFICIAL_OPCODE_DEFINITIONS.map((definition) => definition.opcode));
    assert.equal(OFFICIAL_OPCODE_DEFINITIONS.length + UNOFFICIAL_OPCODE_DEFINITIONS.length, 256);

    const mnemonic_names = new Map(fixture.mnemonics.map((entry) => [entry.id, entry.name]));
    assert.equal(fixture.mnemonic_count, fixture.mnemonics.length);
    assert.deepEqual(
        fixture.mnemonics.map((entry) => entry.id),
        fixture.mnemonics.map((_entry, index) => index + 1),
        "mnemonic ids are contiguous from one",
    );
    assert.equal(new Set(fixture.mnemonics.map((entry) => entry.name)).size, fixture.mnemonics.length);

    for (const entry of fixture.opcodes) {
        const definition = CPU_OPCODE_TABLE.get(entry.opcode);
        assert.ok(definition, `opcode $${entry.opcode.toString(16)} is missing from the production table`);
        assert.equal(entry.opcode, definition?.opcode);
        assert.equal(mnemonic_names.get(entry.mnemonic_id), definition?.mnemonic, `opcode ${entry.opcode} mnemonic`);
        assert.equal(
            CPU_ADDRESSING_MODES.find((mode) => mode.id === entry.addressing_mode_id)?.name,
            definition?.addressing_mode,
            `opcode ${entry.opcode} addressing mode`,
        );
        assert.equal(
            CPU_OPERAND_ACCESSES.find((access) => access.id === entry.operand_access_id)?.name,
            definition?.operand_access,
            `opcode ${entry.opcode} operand access`,
        );
        assert.equal(entry.base_cycles, definition?.base_cycles, `opcode ${entry.opcode} base cycles`);
        assert.equal(entry.page_cross_cycle, definition?.page_cross_cycle ? 1 : 0, `opcode ${entry.opcode} page cross`);
        assert.equal(entry.official, official.has(entry.opcode) ? 1 : 0, `opcode ${entry.opcode} official flag`);
    }

    // Every mnemonic the production table uses is named in the fixture, so a dispatch switch
    // written against these ids cannot miss an instruction.
    const used = new Set([...CPU_OPCODE_TABLE.values()].map((definition) => definition.mnemonic));
    assert.deepEqual([...used].sort(), fixture.mnemonics.map((entry) => entry.name).sort());
});

test("generates the canonical opcode table as a numeric GoboScript list", () => {
    const temporary_directory = mkdtempSync(join(tmpdir(), "goboscript-opcode-"));
    const output_path = join(temporary_directory, "opcode_table.txt");

    try {
        const generated = run_generator(["--output", output_path]);
        assert.equal(generated.status, 0, generated.stderr);

        const actual = readFileSync(output_path, "ascii").trimEnd().split("\n").map(Number);
        const expected = [fixture.schema_version, fixture.opcode_count];

        for (const entry of fixture.opcodes) {
            for (const field of FIELDS) {
                expected.push(entry[field]);
            }
        }

        assert.deepEqual(actual, expected);
        assert.equal(actual.length, 2 + 256 * FIELDS.length);

        // The ported decoder indexes the list as opcode * field_count + field + 3, so the flat
        // positions have to carry the same values the production table does.
        for (const opcode of [0x00, 0x4c, 0x69, 0x9d, 0xff]) {
            const base = 2 + opcode * FIELDS.length;
            const definition = CPU_OPCODE_TABLE.get(opcode);
            assert.equal(actual[base + 2], definition?.base_cycles, `opcode ${opcode} cycles in the flat list`);
            assert.equal(actual[base + 5], official_flag(opcode) ? 1 : 0, `opcode ${opcode} official flag`);
        }
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
});

function official_flag(opcode: number): boolean {
    return OFFICIAL_OPCODE_DEFINITIONS.some((definition) => definition.opcode === opcode);
}

test("the generator refuses to overwrite the canonical fixture, even through an alias", () => {
    const temporary_directory = mkdtempSync(join(tmpdir(), "goboscript-opcode-guard-"));

    try {
        const direct = run_generator(["--output", fileURLToPath(FIXTURE_PATH)]);
        assert.equal(direct.status, 1);
        assert.match(direct.stderr, /must not overwrite the canonical opcode table fixture/);
        assert.equal(readFileSync(FIXTURE_PATH, "utf8"), fixture_text);

        const fixture_alias_path = join(temporary_directory, "fixture-alias.json");
        symlinkSync(fileURLToPath(FIXTURE_PATH), fixture_alias_path);
        const alias = run_generator(["--output", fixture_alias_path]);
        assert.equal(alias.status, 1);
        assert.match(alias.stderr, /must not overwrite the canonical opcode table fixture/);
        assert.equal(readFileSync(FIXTURE_PATH, "utf8"), fixture_text);

        const fixture_hardlink_path = join(temporary_directory, "fixture-hardlink.json");
        linkSync(fileURLToPath(FIXTURE_PATH), fixture_hardlink_path);
        const hardlink = run_generator(["--output", fixture_hardlink_path]);
        assert.equal(hardlink.status, 1);
        assert.match(hardlink.stderr, /must not overwrite the canonical opcode table fixture/);
        assert.equal(readFileSync(FIXTURE_PATH, "utf8"), fixture_text);
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
});

test("the generator rejects a malformed fixture", () => {
    const temporary_directory = mkdtempSync(join(tmpdir(), "goboscript-opcode-malformed-"));

    const rejections: readonly {
        readonly label: string;
        readonly mutate: (copy: OpcodeTableFixture) => OpcodeTableFixture;
        readonly message: RegExp;
    }[] = [
            {
                label: "reordered fields",
                mutate: (copy) => ({ ...copy, fields: [...FIELDS].reverse() }),
                message: /does not list the generated fields in order/,
            },
            {
                label: "out-of-order opcode",
                mutate: (copy) => ({
                    ...copy,
                    opcodes: [copy.opcodes[1]!, copy.opcodes[0]!, ...copy.opcodes.slice(2)],
                }),
                message: /out of order/,
            },
            {
                label: "negative base cycles",
                mutate: (copy) => ({
                    ...copy,
                    opcodes: copy.opcodes.map((entry) => (entry.opcode === 5 ? { ...entry, base_cycles: -1 } : entry)),
                }),
                message: /non-integer or negative base_cycles/,
            },
            {
                label: "unknown mnemonic id",
                mutate: (copy) => ({
                    ...copy,
                    opcodes: copy.opcodes.map((entry) => (entry.opcode === 6 ? { ...entry, mnemonic_id: 999 } : entry)),
                }),
                message: /unknown mnemonic id/,
            },
            {
                label: "truncated table",
                mutate: (copy) => ({ ...copy, opcode_count: 255, opcodes: copy.opcodes.slice(0, 255) }),
                message: /exactly 256 opcodes/,
            },
            {
                label: "flag above one",
                mutate: (copy) => ({
                    ...copy,
                    opcodes: copy.opcodes.map((entry) => (entry.opcode === 7 ? { ...entry, official: 2 } : entry)),
                }),
                message: /not zero or one/,
            },
        ];

    try {
        for (const rejection of rejections) {
            const mutated = rejection.mutate(structuredClone(fixture) as OpcodeTableFixture);
            const fixture_path = join(temporary_directory, `${rejection.label.replace(/\W+/g, "-")}.json`);
            writeFileSync(fixture_path, JSON.stringify(mutated), "ascii");

            const output_path = join(temporary_directory, `${rejection.label.replace(/\W+/g, "-")}.txt`);
            const result = run_generator(["--fixture", fixture_path, "--output", output_path]);
            assert.equal(result.status, 1, `${rejection.label} should be rejected`);
            assert.match(result.stderr, rejection.message, rejection.label);
        }
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
});
