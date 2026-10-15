import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project_root = fileURLToPath(new URL("../", import.meta.url));
const fixture_path = join(project_root, "tests", "fixtures", "goboscript", "shared_port_vectors.json");
const default_output_path = join(project_root, "scratch", "data", "shared_port_vectors.txt");
const script_path = fileURLToPath(import.meta.url);

export function generate_goboscript_shared_port_vectors(output_path = default_output_path) {
    const resolved_output_path = resolve(output_path);
    const resolved_fixture_path = resolve(fixture_path);

    if (
        resolved_output_path === resolved_fixture_path ||
        paths_reference_same_file(resolved_fixture_path, resolved_output_path)
    ) {
        throw new Error("The generated output path must not overwrite the canonical vector fixture.");
    }

    const fixture = JSON.parse(readFileSync(resolved_fixture_path, "utf8"));
    const values = flatten_shared_port_vectors(fixture);
    const lines = `${values.join("\n")}\n`;
    const reconstructed_values = lines.slice(0, -1).split("\n").map(Number);

    if (
        reconstructed_values.length !== values.length ||
        reconstructed_values.some((value, index) => value !== values[index])
    ) {
        throw new Error("Generated GoboScript vector data does not reconstruct the canonical fixture.");
    }

    mkdirSync(dirname(resolved_output_path), { recursive: true });
    writeFileSync(resolved_output_path, lines, "ascii");
    console.log(`Wrote ${values.length} numeric values for ${count_vectors(fixture)} shared vectors to ${resolved_output_path}.`);
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

export function flatten_shared_port_vectors(fixture) {
    if (fixture === null || typeof fixture !== "object" || fixture.schema_version !== 1 || !Array.isArray(fixture.suites)) {
        throw new TypeError("The shared port-vector fixture has an unsupported schema.");
    }

    const suite_ids = new Set();
    const records = [];
    let vector_count = 0;

    for (const suite of fixture.suites) {
        if (
            suite === null ||
            typeof suite !== "object" ||
            !Number.isSafeInteger(suite.id) ||
            suite.id < 1 ||
            typeof suite.name !== "string" ||
            suite.name.length === 0 ||
            !Array.isArray(suite.vectors)
        ) {
            throw new TypeError("A shared port-vector suite has invalid metadata.");
        }

        if (suite_ids.has(suite.id)) {
            throw new TypeError(`Duplicate shared port-vector suite id ${suite.id}.`);
        }
        suite_ids.add(suite.id);

        const vector_ids = new Set();

        for (const vector of suite.vectors) {
            if (
                vector === null ||
                typeof vector !== "object" ||
                !Number.isSafeInteger(vector.id) ||
                vector.id < 1 ||
                !Number.isSafeInteger(vector.operation) ||
                vector.operation < 1 ||
                !Array.isArray(vector.input) ||
                !Array.isArray(vector.expected) ||
                !vector.input.every(Number.isSafeInteger) ||
                !vector.expected.every(Number.isSafeInteger)
            ) {
                throw new TypeError(`Suite ${suite.name} contains an invalid vector.`);
            }

            if (vector_ids.has(vector.id)) {
                throw new TypeError(`Suite ${suite.name} contains duplicate vector id ${vector.id}.`);
            }
            vector_ids.add(vector.id);

            records.push(
                suite.id,
                vector.id,
                vector.operation,
                vector.input.length,
                vector.expected.length,
                ...vector.input,
                ...vector.expected,
            );
            vector_count += 1;
        }
    }

    return [fixture.schema_version, vector_count, ...records];
}

function count_vectors(fixture) {
    return fixture.suites.reduce((count, suite) => count + suite.vectors.length, 0);
}

function run_cli(args) {
    let output_path = default_output_path;

    for (let argument_index = 0; argument_index < args.length; argument_index += 1) {
        const argument = args[argument_index];

        if (argument === "--help" || argument === "-h") {
            console.log(
                "Usage: node scripts/generate_goboscript_shared_port_vectors.mjs [--output PATH]\n" +
                    "Default output: scratch/data/shared_port_vectors.txt",
            );
            return;
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

    generate_goboscript_shared_port_vectors(output_path);
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
