import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const GENERATOR_PATH = fileURLToPath(new URL("../scripts/generate_goboscript_rom_data.mjs", import.meta.url));

test("bundles a selected ROM byte-exactly and refuses to overwrite its source", () => {
    const temporary_directory = mkdtempSync(join(tmpdir(), "scratch-rom-assets-"));
    const input_path = join(temporary_directory, "selected.nes");
    const output_path = join(temporary_directory, "selected_bytes.txt");
    const rom_bytes = Uint8Array.from([
        0x4e, 0x45, 0x53, 0x1a, 1, 1, 0x41, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0xff, 0x00, 0x80, 0x40, 0x20, 0x10, 0x08, 0x04,
    ]);

    try {
        writeFileSync(input_path, rom_bytes);

        const result = spawnSync(
            process.execPath,
            [GENERATOR_PATH, "--rom", input_path, "--output", output_path],
            { encoding: "utf8", timeout: 5_000 },
        );

        assert.equal(result.error, undefined, result.error?.message);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(
            readFileSync(output_path, "ascii").trimEnd().split("\n").map(Number),
            Array.from(rom_bytes),
        );

        const overwrite_result = spawnSync(
            process.execPath,
            [GENERATOR_PATH, "--rom", input_path, "--output", input_path],
            { encoding: "utf8", timeout: 5_000 },
        );

        assert.equal(overwrite_result.status, 1);
        assert.match(overwrite_result.stderr, /must not overwrite the source ROM/);
        assert.deepEqual(readFileSync(input_path), Buffer.from(rom_bytes));

        const source_alias_path = join(temporary_directory, "source-alias.nes");
        symlinkSync(input_path, source_alias_path);

        const alias_result = spawnSync(
            process.execPath,
            [GENERATOR_PATH, "--rom", input_path, "--output", source_alias_path],
            { encoding: "utf8", timeout: 5_000 },
        );

        assert.equal(alias_result.status, 1);
        assert.match(alias_result.stderr, /must not overwrite the source ROM/);
        assert.deepEqual(readFileSync(input_path), Buffer.from(rom_bytes));

        const source_hardlink_path = join(temporary_directory, "source-hardlink.nes");
        linkSync(input_path, source_hardlink_path);
        const hardlink_result = spawnSync(
            process.execPath,
            [GENERATOR_PATH, "--rom", input_path, "--output", source_hardlink_path],
            { encoding: "utf8", timeout: 5_000 },
        );

        assert.equal(hardlink_result.status, 1);
        assert.match(hardlink_result.stderr, /must not overwrite the source ROM/);
        assert.deepEqual(readFileSync(input_path), Buffer.from(rom_bytes));

        assert.equal(result.stderr.trim(), "", "a licensed selection must not emit a rights notice");
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
});

test("warns that the supplied fixture cannot be redistributed inside a compiled project", () => {
    const temporary_directory = mkdtempSync(join(tmpdir(), "scratch-rom-rights-"));
    const output_path = join(temporary_directory, "supplied_bytes.txt");

    try {
        const result = spawnSync(
            process.execPath,
            [GENERATOR_PATH, "--output", output_path],
            { encoding: "utf8", timeout: 8_000, cwd: fileURLToPath(new URL("..", import.meta.url)) },
        );

        assert.equal(result.error, undefined, result.error?.message);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /rom-rights: this image is a Nintendo-derived Super Mario Bros\. 2/);
        assert.match(result.stderr, /Do not distribute a compiled project/);
        assert.ok(readFileSync(output_path, "ascii").length > 0, "the list is still generated");
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
});
