import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project_root = fileURLToPath(new URL("../", import.meta.url));
const fixture_path = join(project_root, "tests", "fixtures", "goboscript", "opcode_table.json");
const default_output_path = join(project_root, "scratch", "data", "opcode_table.txt");
const script_path = fileURLToPath(import.meta.url);

/** Fields per opcode, in the order the flat list stores them. */
export const OPCODE_TABLE_FIELDS = [
    "mnemonic_id",
    "addressing_mode_id",
    "base_cycles",
    "operand_access_id",
    "page_cross_cycle",
    "official",
];

/**
 * Writes the opcode decode table as a decimal list for `list cpu_opcode_table "data/opcode_table.txt";`.
 *
 * The layout is `schema_version, opcode_count`, then six values per opcode in opcode order:
 * mnemonic id, addressing mode id, base cycles, operand access id, page-cross cycle flag, and
 * the official flag. The opcode itself is implicit in its position, so the ported decoder
 * indexes the list as `opcode * 6 + field + 3` (GoboScript lists are 1-based and two header
 * values come first).
 */
export function generate_goboscript_opcode_table(output_path = default_output_path, input_path = fixture_path) {
    const resolved_output_path = resolve(output_path);
    const resolved_fixture_path = resolve(input_path);

    if (
        resolved_output_path === resolved_fixture_path ||
        paths_reference_same_file(resolved_fixture_path, resolved_output_path)
    ) {
        throw new Error("The generated output path must not overwrite the canonical opcode table fixture.");
    }

    const fixture = JSON.parse(readFileSync(resolved_fixture_path, "utf8"));
    const values = flatten_opcode_table(fixture);
    const lines = `${values.join("\n")}\n`;
    const reconstructed_values = lines.slice(0, -1).split("\n").map(Number);

    if (
        reconstructed_values.length !== values.length ||
        reconstructed_values.some((value, index) => value !== values[index])
    ) {
        throw new Error("Generated GoboScript opcode data does not reconstruct the canonical fixture.");
    }

    mkdirSync(dirname(resolved_output_path), { recursive: true });
    writeFileSync(resolved_output_path, lines, "ascii");
    console.log(
        `Wrote ${values.length} numeric values for ${fixture.opcode_count} opcodes to ${resolved_output_path}.`,
    );
}

function paths_reference_same_file(first_path, second_path) {
    let first_stat;
    let second_stat;

    try {
        first_stat = statSync(first_path);
        second_stat = statSync(second_path);
    } catch (error) {
        if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return false;
        }

        throw error;
    }

    return first_stat.dev === second_stat.dev && first_stat.ino === second_stat.ino;
}

export function flatten_opcode_table(fixture) {
    if (
        fixture === null ||
        typeof fixture !== "object" ||
        fixture.schema_version !== 1 ||
        !Array.isArray(fixture.mnemonics) ||
        !Array.isArray(fixture.opcodes) ||
        !Array.isArray(fixture.fields)
    ) {
        throw new TypeError("The opcode table fixture has an unsupported schema.");
    }

    if (fixture.fields.join(",") !== OPCODE_TABLE_FIELDS.join(",")) {
        throw new TypeError("The opcode table fixture does not list the generated fields in order.");
    }

    const mnemonic_ids = new Set();

    for (const [index, mnemonic] of fixture.mnemonics.entries()) {
        if (
            mnemonic === null ||
            typeof mnemonic !== "object" ||
            mnemonic.id !== index + 1 ||
            typeof mnemonic.name !== "string" ||
            mnemonic.name.length === 0
        ) {
            throw new TypeError(`Opcode table mnemonic ${index} is invalid or out of order.`);
        }

        mnemonic_ids.add(mnemonic.id);
    }

    if (fixture.mnemonic_count !== fixture.mnemonics.length) {
        throw new TypeError("The opcode table fixture disagrees with itself about the mnemonic count.");
    }

    if (fixture.opcode_count !== fixture.opcodes.length || fixture.opcodes.length !== 256) {
        throw new TypeError("The opcode table fixture must hold exactly 256 opcodes.");
    }

    const records = [];

    for (const [index, entry] of fixture.opcodes.entries()) {
        if (entry === null || typeof entry !== "object" || entry.opcode !== index) {
            throw new TypeError(`Opcode table entry ${index} is missing or out of order.`);
        }

        for (const field of OPCODE_TABLE_FIELDS) {
            if (!Number.isSafeInteger(entry[field]) || entry[field] < 0) {
                throw new TypeError(`Opcode ${index} has a non-integer or negative ${field}.`);
            }
        }

        if (!mnemonic_ids.has(entry.mnemonic_id)) {
            throw new TypeError(`Opcode ${index} names unknown mnemonic id ${entry.mnemonic_id}.`);
        }

        if (entry.page_cross_cycle > 1 || entry.official > 1) {
            throw new TypeError(`Opcode ${index} stores a flag that is not zero or one.`);
        }

        records.push(...OPCODE_TABLE_FIELDS.map((field) => entry[field]));
    }

    return [fixture.schema_version, fixture.opcode_count, ...records];
}

function run_cli(args) {
    let output_path = default_output_path;
    let input_path = fixture_path;

    for (let argument_index = 0; argument_index < args.length; argument_index += 1) {
        const argument = args[argument_index];

        if (argument === "--help" || argument === "-h") {
            console.log(
                "Usage: node scripts/generate_goboscript_opcode_table.mjs [--output PATH] [--fixture PATH]\n" +
                    "Default output: scratch/data/opcode_table.txt\n" +
                    "Default fixture: tests/fixtures/goboscript/opcode_table.json",
            );
            return;
        }

        if (argument === "--fixture" || argument === "-f") {
            const next_argument = args[argument_index + 1];

            if (next_argument === undefined || next_argument.startsWith("-")) {
                throw new Error(`Missing path after ${argument}.`);
            }

            input_path = next_argument;
            argument_index += 1;
            continue;
        }

        if (argument === "--output" || argument === "-o") {
            const next_argument = args[argument_index + 1];

            if (next_argument === undefined || next_argument.startsWith("-")) {
                throw new Error(`Missing path after ${argument}.`);
            }

            output_path = next_argument;
            argument_index += 1;
            continue;
        }

        throw new Error(`Unknown argument: ${argument}`);
    }

    generate_goboscript_opcode_table(output_path, input_path);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === script_path) {
    try {
        run_cli(process.argv.slice(2));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    }
}
