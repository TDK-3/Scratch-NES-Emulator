import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project_root = fileURLToPath(new URL("../", import.meta.url));
const default_input_path = join(project_root, "test_rom.nes");
const default_output_path = join(project_root, "scratch", "data", "test_rom_bytes.txt");
const script_path = fileURLToPath(import.meta.url);

/** Converts one build-time iNES file into the decimal list included by the Scratch project. */
export function generate_goboscript_rom_data(input_path = default_input_path, output_path = default_output_path) {
    const resolved_input_path = resolve(input_path);
    const resolved_output_path = resolve(output_path);

    if (
        resolved_input_path === resolved_output_path ||
        paths_reference_same_file(resolved_input_path, resolved_output_path)
    ) {
        throw new Error("The output path must not overwrite the source ROM.");
    }

    const rom_bytes = readFileSync(resolved_input_path);

    if (rom_bytes.byteLength < 16 || rom_bytes.toString("ascii", 0, 4) !== "NES\u001a") {
        throw new Error(`${resolved_input_path} is not a valid iNES image.`);
    }

    const lines = Array.from(rom_bytes, (byte) => byte.toString(10)).join("\n") + "\n";
    const reconstructed_bytes = lines
        .slice(0, -1)
        .split("\n")
        .map(Number);

    if (
        reconstructed_bytes.length !== rom_bytes.byteLength ||
        reconstructed_bytes.some((byte, index) => byte !== rom_bytes[index])
    ) {
        throw new Error("Generated GoboScript list data does not reconstruct the source ROM.");
    }

    mkdirSync(dirname(resolved_output_path), { recursive: true });
    writeFileSync(resolved_output_path, lines, "ascii");
    console.log(`Wrote ${rom_bytes.byteLength} decimal byte values to ${resolved_output_path}.`);
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

function run_cli(args) {
    let input_path = default_input_path;
    let output_path = default_output_path;

    for (let argument_index = 0; argument_index < args.length; argument_index += 1) {
        const argument = args[argument_index];

        if (argument === "--help" || argument === "-h") {
            console.log(
                "Usage: node scripts/generate_goboscript_rom_data.mjs [--rom PATH] [--output PATH]\n" +
                    "Defaults: test_rom.nes -> scratch/data/test_rom_bytes.txt",
            );
            return;
        }

        const next_argument = args[argument_index + 1];

        if (argument === "--rom" || argument === "-r") {
            if (next_argument === undefined || next_argument.startsWith("-")) {
                throw new Error(`Missing path after ${argument}.`);
            }

            input_path = next_argument;
            argument_index += 1;
            continue;
        }

        if (argument === "--output" || argument === "-o") {
            if (next_argument === undefined || next_argument.startsWith("-")) {
                throw new Error(`Missing path after ${argument}.`);
            }

            output_path = next_argument;
            argument_index += 1;
            continue;
        }

        throw new Error(`Unknown argument: ${argument}`);
    }

    generate_goboscript_rom_data(input_path, output_path);
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
