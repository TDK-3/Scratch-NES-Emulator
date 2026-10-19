#!/usr/bin/env node
/**
 * Opt-in full-corpus check for the cycle-visible 2A03 core.
 *
 * Runs vectors from an external checkout of the MIT-licensed SingleStepTests `nes6502/v1` corpus and
 * compares every ordered CPU bus access, the final registers, and the final listed RAM bytes. The corpus is
 * not vendored: point `--corpus` at a local directory holding `00.json` through `ff.json`.
 *
 * Usage:
 *   npm run test:cpu-corpus -- --corpus /path/to/nes6502/v1
 *   npm run test:cpu-corpus -- --corpus /path/to/nes6502/v1 --per-opcode 25 --opcodes 69,93
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Cpu2A03 } from "../src/nes/cpu/cpu_2a03.js";
import { normalize_status } from "../src/nes/cpu/registers.js";
import { FakeCpuBus } from "../tests/support/FakeCpuBus.js";

const OPCODE_FILE_PATTERN = /^[0-9a-f]{2}\.json$/;

function parse_arguments(argv) {
    const options = {
        corpus: undefined,
        per_opcode: Infinity,
        opcodes: undefined,
        max_reported_mismatches: 12,
        summary_json: undefined,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        switch (argument) {
            case "--corpus":
                options.corpus = argv[index + 1];
                index += 1;
                break;
            case "--per-opcode":
                options.per_opcode = Number.parseInt(argv[index + 1] ?? "", 10);
                index += 1;
                break;
            case "--opcodes":
                options.opcodes = (argv[index + 1] ?? "")
                    .split(",")
                    .map((entry) => entry.trim().toLowerCase())
                    .filter((entry) => entry.length > 0)
                    .map((entry) => `${entry.padStart(2, "0")}.json`);
                index += 1;
                break;
            case "--max-reported-mismatches":
                options.max_reported_mismatches = Number.parseInt(argv[index + 1] ?? "", 10);
                index += 1;
                break;
            case "--summary-json":
                options.summary_json = argv[index + 1];
                index += 1;
                break;
            case "--help":
                print_usage();
                process.exit(0);
                break;
            default:
                fail(`Unknown argument: ${String(argument)}`);
        }
    }

    if (options.corpus === undefined) {
        print_usage();
        fail("--corpus <directory> is required");
    }

    if (!(Number.isInteger(options.per_opcode) && options.per_opcode >= 1) && options.per_opcode !== Infinity) {
        fail("--per-opcode must be a positive integer");
    }

    if (!Number.isInteger(options.max_reported_mismatches) || options.max_reported_mismatches < 0) {
        fail("--max-reported-mismatches must be zero or a positive integer");
    }

    return options;
}

function print_usage() {
    process.stdout.write(
        [
            "Usage: npm run test:cpu-corpus -- --corpus <dir> [options]",
            "",
            "  --corpus <dir>                 Directory with SingleStepTests nes6502/v1 opcode JSON files.",
            "  --per-opcode <n>               Maximum vectors to run per opcode file (default: all).",
            "  --opcodes <aa,bb>              Restrict the run to selected opcode files.",
            "  --max-reported-mismatches <n>  Printed mismatch details per run (default: 12).",
            "  --summary-json <path>          Optional JSON summary output path.",
            "",
        ].join("\n"),
    );
}

function fail(message) {
    process.stderr.write(`cpu-corpus: ${message}\n`);
    process.exit(2);
}

/**
 * Runs one corpus vector against a reused fake bus.
 *
 * Every byte the vector can leave behind is tracked and zeroed afterwards, so reuse cannot leak state
 * between vectors while still avoiding one 64 KiB allocation per vector.
 */
function run_vector(bus, vector, touched_addresses) {
    touched_addresses.clear();

    for (const [address, value] of vector.initial.ram) {
        bus.load(address, Uint8Array.of(value));
        touched_addresses.add(address);
    }

    const cpu = new Cpu2A03(bus);
    cpu.program_counter = vector.initial.pc;
    cpu.stack_pointer = vector.initial.s;
    cpu.a = vector.initial.a;
    cpu.x = vector.initial.x;
    cpu.y = vector.initial.y;
    cpu.status = normalize_status(vector.initial.p);
    bus.clear_trace();

    const expected_cycles = vector.cycles;

    for (let index = 0; index < expected_cycles.length; index += 1) {
        cpu.clock_cycle();

        if (bus.accesses.length !== index + 1) {
            return { ok: false, reason: `cycle ${index}: expected one bus access, saw ${bus.accesses.length}` };
        }
    }

    for (const [index, [address, value, kind]] of expected_cycles.entries()) {
        const access = bus.accesses[index];

        if (!access || access.kind !== kind || access.address !== address || access.value !== value) {
            const actual = access === undefined
                ? "no access"
                : `${access.kind} $${access.address.toString(16).padStart(4, "0")}=${access.value}`;
            return {
                ok: false,
                reason: `cycle ${index}: expected ${kind} $${address.toString(16).padStart(4, "0")}=${value}, got ${actual}`,
            };
        }

        touched_addresses.add(address);
    }

    const actual_registers = {
        pc: cpu.program_counter,
        s: cpu.stack_pointer,
        a: cpu.a,
        x: cpu.x,
        y: cpu.y,
        p: cpu.status,
    };
    const expected_registers = {
        pc: vector.final.pc,
        s: vector.final.s,
        a: vector.final.a,
        x: vector.final.x,
        y: vector.final.y,
        p: normalize_status(vector.final.p),
    };

    for (const name of Object.keys(expected_registers)) {
        if (actual_registers[name] !== expected_registers[name]) {
            return {
                ok: false,
                reason: `register ${name}: expected ${expected_registers[name]}, got ${actual_registers[name]}`,
            };
        }
    }

    for (const [address, value] of vector.final.ram) {
        touched_addresses.add(address);

        if (bus.peek(address) !== value) {
            return {
                ok: false,
                reason: `RAM $${address.toString(16).padStart(4, "0")}: expected ${value}, got ${bus.peek(address)}`,
            };
        }
    }

    return { ok: true };
}

function main() {
    const options = parse_arguments(process.argv.slice(2));
    const corpus_directory = resolve(options.corpus);

    let entries;
    try {
        if (!statSync(corpus_directory).isDirectory()) {
            fail(`${corpus_directory} is not a directory`);
        }
        entries = readdirSync(corpus_directory);
    } catch {
        fail(`cannot read corpus directory ${corpus_directory}`);
    }

    const files = (options.opcodes ?? entries.filter((name) => OPCODE_FILE_PATTERN.test(name)).sort())
        .filter((name) => OPCODE_FILE_PATTERN.test(name))
        .sort();

    if (files.length === 0) {
        fail(`no opcode JSON files found in ${corpus_directory}`);
    }

    const bus = new FakeCpuBus();
    const touched_addresses = new Set();
    const mismatches = [];
    const per_opcode = [];
    let total_vectors = 0;
    let total_pass = 0;
    const started_at = process.hrtime.bigint();

    for (const file of files) {
        const vectors = JSON.parse(readFileSync(resolve(corpus_directory, file), "utf8"));
        const selected = vectors.slice(0, options.per_opcode);
        let pass = 0;
        let mismatch_count = 0;

        for (const [index, vector] of selected.entries()) {
            const result = run_vector(bus, vector, touched_addresses);

            for (const address of touched_addresses) {
                bus.load(address, Uint8Array.of(0));
            }

            if (result.ok) {
                pass += 1;
            } else {
                mismatch_count += 1;

                if (mismatches.length < options.max_reported_mismatches) {
                    mismatches.push({ file, index, name: vector.name, reason: result.reason });
                }
            }
        }

        total_vectors += selected.length;
        total_pass += pass;
        per_opcode.push({ file, vectors: selected.length, pass, mismatch: mismatch_count });
        process.stdout.write(`${file}: ${pass}/${selected.length}${mismatch_count > 0 ? " MISMATCH" : ""}\n`);
    }

    const elapsed_ms = Number(process.hrtime.bigint() - started_at) / 1e6;
    const summary = {
        corpus: corpus_directory,
        per_opcode_limit: Number.isFinite(options.per_opcode) ? options.per_opcode : "all",
        files: per_opcode.length,
        vectors: total_vectors,
        pass: total_pass,
        mismatch: total_vectors - total_pass,
        elapsed_ms: Math.round(elapsed_ms),
        mismatches,
    };

    process.stdout.write(
        `\ncpu-corpus: ${total_pass}/${total_vectors} vectors passed across ${per_opcode.length} opcode files `
        + `in ${Math.round(elapsed_ms)} ms\n`,
    );

    if (mismatches.length > 0) {
        process.stdout.write(`\nfirst mismatches:\n${JSON.stringify(mismatches, null, 2)}\n`);
    }

    if (options.summary_json !== undefined) {
        writeFileSync(resolve(options.summary_json), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
        process.stdout.write(`\nsummary written to ${options.summary_json}\n`);
    }

    process.exit(summary.mismatch === 0 ? 0 : 1);
}

main();
