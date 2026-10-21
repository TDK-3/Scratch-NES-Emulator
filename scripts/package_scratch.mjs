import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "@turbowarp/jszip";
import Packager from "@turbowarp/packager";

const project_root = fileURLToPath(new URL("../", import.meta.url));
const default_input_path = join(project_root, "scratch", "scratch.sb3");
const default_output_path = join(project_root, "dist", "pages", "index.html");
const script_path = fileURLToPath(import.meta.url);

/**
 * Removes embedded `// _twconfig_` comments from an in-memory .sb3 archive so that
 * `vm.runtime.parseProjectOptions()` does not override the explicit packager options at runtime.
 */
async function strip_stored_turbowarp_config(project_bytes) {
    const zip = await JSZip.loadAsync(project_bytes);
    const project_json_file = zip.file("project.json");

    if (project_json_file === null) {
        return project_bytes;
    }

    const project = JSON.parse(await project_json_file.async("string"));

    if (Array.isArray(project.targets)) {
        for (const target of project.targets) {
            if (target.comments && typeof target.comments === "object") {
                for (const [comment_id, comment] of Object.entries(target.comments)) {
                    if (comment && typeof comment.text === "string" && comment.text.includes(" // _twconfig_")) {
                        delete target.comments[comment_id];
                    }
                }
            }
        }
    }

    zip.file("project.json", JSON.stringify(project));
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Packages a compiled Scratch .sb3 file into a standalone HTML file using @turbowarp/packager.
 * Uses turbo mode, 60 FPS, and only the green flag, stop, pause, and fullscreen control buttons.
 */
export async function package_scratch_project(input_path = default_input_path, output_path = default_output_path) {
    const resolved_input_path = resolve(input_path);
    const resolved_output_path = resolve(output_path);

    const raw_project_bytes = readFileSync(resolved_input_path);
    const project_bytes = await strip_stored_turbowarp_config(raw_project_bytes);
    const loaded_project = await Packager.loadProject(project_bytes);

    const packager = new Packager.Packager();
    packager.project = loaded_project;
    packager.options.target = "html";
    packager.options.turbo = true;
    packager.options.framerate = 60;
    packager.options.controls.greenFlag.enabled = true;
    packager.options.controls.stopAll.enabled = true;
    packager.options.controls.pause.enabled = true;
    packager.options.controls.fullscreen.enabled = true;

    const result = await packager.package();
    const output_bytes =
        typeof result.data === "string"
            ? Buffer.from(result.data, "utf8")
            : result.data instanceof ArrayBuffer
              ? new Uint8Array(result.data)
              : result.data;

    mkdirSync(dirname(resolved_output_path), { recursive: true });
    writeFileSync(resolved_output_path, output_bytes);
    console.log(`Packaged ${resolved_input_path} to ${resolved_output_path} (${output_bytes.byteLength} bytes).`);

    return result;
}

async function run_cli(args) {
    let input_path = default_input_path;
    let output_path = default_output_path;

    for (let argument_index = 0; argument_index < args.length; argument_index += 1) {
        const argument = args[argument_index];

        if (argument === "--help" || argument === "-h") {
            console.log(
                "Usage: node scripts/package_scratch.mjs [--input PATH] [--output PATH]\n" +
                    "Defaults: scratch/scratch.sb3 -> dist/pages/index.html",
            );
            return;
        }

        const next_argument = args[argument_index + 1];

        if (argument === "--input" || argument === "-i") {
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

    await package_scratch_project(input_path, output_path);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === script_path) {
    run_cli(process.argv.slice(2)).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    });
}
