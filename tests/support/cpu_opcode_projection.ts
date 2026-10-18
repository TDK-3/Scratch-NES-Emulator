import { readFileSync } from "node:fs";

import { CPU_OPCODE_TABLE, OFFICIAL_OPCODE_DEFINITIONS } from "../../src/nes/cpu/opcode_table.js";
import { CPU_ADDRESSING_MODES, CPU_OPERAND_ACCESSES } from "./cpu_addressing_projection.js";

/**
 * Reference-side projection of the opcode decode table onto the integers the GoboScript port
 * uses.
 *
 * `tests/fixtures/goboscript/opcode_table.json` is the canonical integer encoding of
 * `CPU_OPCODE_TABLE` and the input of `scripts/generate_goboscript_opcode_table.mjs`, which
 * writes the decimal list `scratch/src/cpu_opcode.gs` loads. This module turns a production
 * opcode definition into the flat values a shared vector records, builds the same flat list the
 * generator writes so the mirror can consume it, and exposes the mnemonic ids so the source
 * lint can compare them with the ported `cpu_mnemonic` enum.
 */

/** Fields per opcode, in the order the generated list stores them. */
export const OPCODE_TABLE_FIELDS = [
    "mnemonic_id",
    "addressing_mode_id",
    "base_cycles",
    "operand_access_id",
    "page_cross_cycle",
    "official",
] as const;

/** Values the generated list carries before the first opcode record. */
export const OPCODE_TABLE_HEADER_COUNT = 2;

/** Error codes in `cpu_opcode_error_code`. */
export const CPU_OPCODE_ERROR_IDS = { none: 0, unknown_opcode: 1, bad_table: 2 } as const;

export interface OpcodeTableMnemonic {
    readonly id: number;
    readonly name: string;
}

export interface OpcodeTableEntry {
    readonly opcode: number;
    readonly mnemonic_id: number;
    readonly addressing_mode_id: number;
    readonly base_cycles: number;
    readonly operand_access_id: number;
    readonly page_cross_cycle: number;
    readonly official: number;
}

export interface OpcodeTableFixture {
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

const fixture_url = new URL("../fixtures/goboscript/opcode_table.json", import.meta.url);
const fixture_text = readFileSync(fixture_url, "utf8");

/** The canonical opcode table fixture. */
export function opcode_table_fixture(): OpcodeTableFixture {
    return JSON.parse(fixture_text) as OpcodeTableFixture;
}

/** Maps every mnemonic the production table uses to its ported id. */
export function cpu_mnemonic_ids(): ReadonlyMap<string, number> {
    return new Map(opcode_table_fixture().mnemonics.map((entry) => [entry.name, entry.id]));
}

/**
 * The flat list `scripts/generate_goboscript_opcode_table.mjs` writes: the schema version and
 * opcode count, then six values per opcode in opcode order. The generator has its own copy of
 * this layout, and `tests/goboscript-opcode-table.test.ts` pins both to the fixture.
 */
export function flat_opcode_table(): number[] {
    const fixture = opcode_table_fixture();
    const values: number[] = [fixture.schema_version, fixture.opcode_count];

    for (const entry of fixture.opcodes) {
        for (const field of OPCODE_TABLE_FIELDS) {
            values.push(entry[field]);
        }
    }

    return values;
}

/**
 * Decodes one opcode from the production table into the flat values suite 12 records: mnemonic
 * id, addressing mode id, base cycles, operand access id, page-cross flag, official flag, and
 * the error code the port reports. Every byte from 0 through 255 is defined, so the error code
 * is always none; the port keeps it because a data file that failed to load has to be reported
 * rather than decoded as zeros.
 */
export function project_opcode_decode(opcode: number): number[] {
    const definition = CPU_OPCODE_TABLE.get(opcode);

    if (definition === undefined) {
        throw new RangeError(`Opcode $${opcode.toString(16)} is missing from the production table.`);
    }

    const mnemonic_id = cpu_mnemonic_ids().get(definition.mnemonic);
    const mode = CPU_ADDRESSING_MODES.find((entry) => entry.name === definition.addressing_mode);
    const access = CPU_OPERAND_ACCESSES.find((entry) => entry.name === definition.operand_access);

    if (mnemonic_id === undefined || mode === undefined || access === undefined) {
        throw new RangeError(`Opcode $${opcode.toString(16)} has a name the port does not encode.`);
    }

    return [
        mnemonic_id,
        mode.id,
        definition.base_cycles,
        access.id,
        definition.page_cross_cycle ? 1 : 0,
        is_official_opcode(opcode) ? 1 : 0,
        CPU_OPCODE_ERROR_IDS.none,
    ];
}

const official_opcodes = new Set(OFFICIAL_OPCODE_DEFINITIONS.map((definition) => definition.opcode));

/** True when the production table lists the opcode among the 151 official encodings. */
export function is_official_opcode(opcode: number): boolean {
    return official_opcodes.has(opcode);
}
