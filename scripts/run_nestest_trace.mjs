import { readFileSync } from "node:fs";
import {
    compare_nestest_trace,
    create_nestest_trace_recorder,
} from "../tests/support/nestest_runner.ts";

const options = parse_arguments(process.argv.slice(2));

if (options.help) {
    print_usage();
} else if (options.error !== undefined) {
    console.error(options.error);
    print_usage();
    process.exitCode = 2;
} else {
    try {
        const rom_bytes = new Uint8Array(readFileSync(options.rom_path));
        const log_text = readFileSync(options.log_path, "utf8");
        const recorder = create_nestest_trace_recorder(rom_bytes);
        const result = compare_nestest_trace(recorder, log_text.split(/\r?\n/), options.limit);

        if (result.ok) {
            console.log(
                `PASS: matched ${result.matched_entries} of ${result.total_entries} ` +
                    `nestest log entries (limit ${result.step_limit}).`,
            );
        } else {
            console.error(
                `FAIL: matched ${result.matched_entries} of ${result.total_entries} entries; ` +
                    `line ${result.line_number}: ${result.message}`,
            );
            process.exitCode = 1;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Nestest runner error: ${message}`);
        process.exitCode = 2;
    }
}

function parse_arguments(arguments_list) {
    const options = { rom_path: undefined, log_path: undefined, limit: Number.MAX_SAFE_INTEGER, help: false };

    for (let index = 0; index < arguments_list.length; index += 1) {
        const argument = arguments_list[index];

        if (argument === "--help" || argument === "-h") {
            options.help = true;
            continue;
        }

        if (argument !== "--rom" && argument !== "--log" && argument !== "--limit") {
            return { ...options, error: `Unknown argument: ${argument}` };
        }

        const value = arguments_list[index + 1];

        if (value === undefined || value.startsWith("--")) {
            return { ...options, error: `Missing value for ${argument}.` };
        }

        index += 1;

        if (argument === "--rom") {
            options.rom_path = value;
        } else if (argument === "--log") {
            options.log_path = value;
        } else {
            const limit = Number(value);

            if (!Number.isSafeInteger(limit) || limit < 1) {
                return { ...options, error: "The instruction limit must be a positive safe integer." };
            }

            options.limit = limit;
        }
    }

    if (options.help) {
        return options;
    }

    if (options.rom_path === undefined || options.log_path === undefined) {
        return { ...options, error: "Both --rom and --log are required." };
    }

    return options;
}

function print_usage() {
    console.log(
        "Usage: npm run test:nestest -- --rom <path> --log <path> [--limit <instructions>]\n" +
            "ROM and log files are external inputs; verify their terms before redistribution.",
    );
}
