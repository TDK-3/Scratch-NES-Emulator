#!/usr/bin/env node
/**
 * Regenerates the pinned NES 2A03 single-step reference fixture from an external MIT-licensed corpus.
 *
 * The corpus is not vendored. Point `--corpus` at a local checkout of
 * https://github.com/SingleStepTests/65x02 (directory `nes6502/v1`, files `00.json` through `ff.json`).
 * Selection is deterministic: the first `--per-opcode` scenarios of every opcode file in file order, plus
 * any curated `--extra opcode:index` cases. Each selected vector is copied unchanged and annotated with its
 * source file, zero-based source index, and the SHA-256 of the complete source file.
 *
 * Canonical regeneration command (see tests/fixtures/nes6502/README.md):
 *   node scripts/select_cpu_vectors.mjs --corpus /path/to/nes6502/v1 --per-opcode 4 \
 *       --extra 6c:225 --extra bd:2 --extra d0:29
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const OPCODE_FILE_PATTERN = /^[0-9a-f]{2}\.json$/;
const DEFAULT_OUTPUT = "tests/fixtures/nes6502/vectors.json";
const DEFAULT_MANIFEST = "tests/fixtures/nes6502/SOURCE_MANIFEST.sha256";
const EXTRA_PATTERN = /^([0-9a-fA-F]{2}):(\d+)$/;

function print_usage() {
    process.stdout.write(
        [
            "Usage: node scripts/select_cpu_vectors.mjs --corpus <dir> [options]",
            "",
            "  --corpus <dir>          Directory with SingleStepTests nes6502/v1 opcode JSON files.",
            `  --per-opcode <n>        Scenarios to take from each opcode file, in order (default: 4).`,
            "  --extra <opcode:index>  Curated zero-based scenario index; repeatable.",
            `  --output <path>         Fixture path (default: ${DEFAULT_OUTPUT}).`,
            `  --manifest <path>       Source-hash manifest path (default: ${DEFAULT_MANIFEST}).`,
            "  --revision <sha>        Corpus revision to record; defaults to the corpus git HEAD.",
            "",
        ].join("\n"),
    );
}

function fail(message) {
    process.stderr.write(`select-cpu-vectors: ${message}\n`);
    process.exit(2);
}

function parse_arguments(argv) {
    const options = {
        corpus: undefined,
        per_opcode: 4,
        extras: [],
        output: DEFAULT_OUTPUT,
        manifest: DEFAULT_MANIFEST,
        revision: undefined,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = argv[index + 1];

        switch (argument) {
            case "--corpus":
                options.corpus = value;
                index += 1;
                break;
            case "--per-opcode":
                options.per_opcode = Number.parseInt(value ?? "", 10);
                index += 1;
                break;
            case "--extra": {
                const match = EXTRA_PATTERN.exec(value ?? "");
                if (match === null) {
                    fail(`--extra expects opcode:index, received ${String(value)}`);
                }
                options.extras.push({ opcode: match[1].toLowerCase(), index: Number.parseInt(match[2], 10) });
                index += 1;
                break;
            }
            case "--output":
                options.output = value;
                index += 1;
                break;
            case "--manifest":
                options.manifest = value;
                index += 1;
                break;
            case "--revision":
                options.revision = value;
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
        fail("--corpus <dir> is required");
    }

    if (!Number.isInteger(options.per_opcode) || options.per_opcode < 1) {
        fail("--per-opcode must be a positive integer");
    }

    for (const path_option of ["output", "manifest"]) {
        const path = options[path_option];
        if (typeof path !== "string" || path.length === 0) {
            fail(`--${path_option.replace("_", "-")} must be a non-empty path`);
        }
    }

    return options;
}

function sha256_of(data) {
    return createHash("sha256").update(data).digest("hex");
}

function assert_not_inside_corpus(path, corpus_directory, label) {
    const resolved = resolve(path);
    const relative = resolved.startsWith(corpus_directory + sep) ? resolved.slice(corpus_directory.length + 1) : null;

    if (relative !== null || resolved === corpus_directory) {
        fail(`refusing to write ${label} inside the corpus directory: ${resolved}`);
    }
}

function detect_revision(corpus_directory) {
    // The corpus is a plain checkout; walk up for a .git directory and read HEAD without spawning git.
    let directory = corpus_directory;

    for (let depth = 0; depth < 8; depth += 1) {
        const git_directory = join(directory, ".git");

        if (existsSync(git_directory)) {
            const head_path = statSync(git_directory).isDirectory() ? join(git_directory, "HEAD") : undefined;

            if (head_path !== undefined && existsSync(head_path)) {
                const head = readFileSync(head_path, "utf8").trim();
                const match = /^ref: (.+)$/.exec(head);

                if (match === null) {
                    return /^[0-9a-f]{40}$/.test(head) ? head : undefined;
                }

                const ref_path = join(git_directory, match[1]);

                if (existsSync(ref_path)) {
                    const revision = readFileSync(ref_path, "utf8").trim();
                    return /^[0-9a-f]{40}$/.test(revision) ? revision : undefined;
                }

                const packed = join(git_directory, "packed-refs");

                if (existsSync(packed)) {
                    const entry = readFileSync(packed, "utf8")
                        .split("\n")
                        .find((line) => line.endsWith(` ${match[1]}`));

                    if (entry !== undefined) {
                        const revision = entry.split(" ")[0];
                        return /^[0-9a-f]{40}$/.test(revision) ? revision : undefined;
                    }
                }
            }

            return undefined;
        }

        const parent = dirname(directory);

        if (parent === directory) {
            return undefined;
        }

        directory = parent;
    }

    return undefined;
}

function compare_keys(left, right) {
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return left[index] - right[index];
        }
    }

    return 0;
}

function main() {
    const options = parse_arguments(process.argv.slice(2));
    const corpus_directory = resolve(options.corpus);

    if (!existsSync(corpus_directory) || !statSync(corpus_directory).isDirectory()) {
        fail(`corpus directory not found: ${corpus_directory}`);
    }

    const real_corpus = realpathSync(corpus_directory);
    const output_path = resolve(options.output);
    const manifest_path = resolve(options.manifest);

    assert_not_inside_corpus(output_path, real_corpus, "the fixture");
    assert_not_inside_corpus(manifest_path, real_corpus, "the manifest");

    const opcode_files = readdirSync(real_corpus)
        .filter((name) => OPCODE_FILE_PATTERN.test(name))
        .sort();

    if (opcode_files.length !== 0x100) {
        fail(`expected 256 opcode files in ${real_corpus}, found ${opcode_files.length}`);
    }

    const extras_by_file = new Map();

    for (const [cli_order, { opcode, index }] of options.extras.entries()) {
        const file = `${opcode}.json`;
        const existing = extras_by_file.get(file) ?? [];
        existing.push({ cli_order, index });
        extras_by_file.set(file, existing);
    }

    const ordered_entries = [];
    const manifest_lines = [];

    // One corpus file is parsed at a time; the full 1.2 GB corpus does not fit in memory at once.
    for (const [file_ordinal, file] of opcode_files.entries()) {
        const path = join(real_corpus, file);
        const raw = readFileSync(path);
        const source_sha256 = sha256_of(raw);
        manifest_lines.push(`${source_sha256}  nes6502/v1/${file}`);

        const wanted = new Map();

        for (const { cli_order, index } of extras_by_file.get(file) ?? []) {
            wanted.set(index, [0, cli_order, 0]);
        }

        for (let index = 0; index < options.per_opcode; index += 1) {
            if (!wanted.has(index)) {
                wanted.set(index, [1, file_ordinal, index]);
            }
        }

        const vectors = JSON.parse(raw.toString("utf8"));

        for (const [index, order_key] of [...wanted.entries()].sort((left, right) => compare_keys(left[1], right[1]))) {
            const vector = vectors[index];

            if (vector === undefined) {
                fail(`${file} has no scenario at index ${index}`);
            }

            ordered_entries.push({
                order_key,
                entry: {
                    source_file: `nes6502/v1/${file}`,
                    source_index: index,
                    source_sha256,
                    vector,
                },
            });
        }
    }

    const entries = ordered_entries
        .sort((left, right) => compare_keys(left.order_key, right.order_key))
        .map(({ entry }) => entry);

    const revision = options.revision ?? detect_revision(real_corpus);

    if (revision !== undefined && !/^[0-9a-f]{40}$/.test(revision)) {
        fail(`--revision must be a 40-character git commit hash`);
    }

    const fixture_text = `${JSON.stringify(entries, null, 2)}\n`;
    const manifest_text = manifest_lines.join("\n") + "\n";

    writeFileSync(output_path, fixture_text, "utf8");
    writeFileSync(manifest_path, manifest_text, "utf8");

    const opcode_coverage = new Set(entries.map((entry) => entry.source_file.slice(-7, -5))).size;

    process.stdout.write(
        [
            `select-cpu-vectors: wrote ${entries.length} vectors to ${output_path}`,
            `select-cpu-vectors: opcode files covered: ${opcode_coverage}/256`,
            `select-cpu-vectors: selection rule: extras [${options.extras.map(({ opcode, index }) => `${opcode}:${index}`).join(", ")}] `
            + `then the first ${options.per_opcode} scenarios of each opcode file in file order`,
            `select-cpu-vectors: corpus revision: ${revision ?? "unknown (pass --revision)"}`,
            `select-cpu-vectors: manifest: ${manifest_path}`,
            `select-cpu-vectors: fixture SHA-256: ${sha256_of(fixture_text)}`,
            "",
        ].join("\n"),
    );

    if (opcode_coverage !== 0x100) {
        fail("the selection does not cover all 256 opcode bytes");
    }
}

main();
