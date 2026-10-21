import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PACKAGER_SCRIPT_PATH = fileURLToPath(new URL("../scripts/package_scratch.mjs", import.meta.url));
const SB3_PATH = fileURLToPath(new URL("../scratch/scratch.sb3", import.meta.url));

function decode_base85_chunks(html: string): Uint8Array {
    const chunk_matches = Array.from(
        html.matchAll(/<script data="([^"]*)">decodeChunk\((\d+)\)<\/script>/g),
    );
    assert.ok(chunk_matches.length > 0, "expected base85 project chunks in packaged HTML");

    const total_bytes = chunk_matches.reduce((sum, match) => sum + Number(match[2]), 0);
    const out_buffer = new ArrayBuffer(4 * Math.ceil(total_bytes / 4));
    let out_offset = 0;

    const get_base85_decode_value = (code: number): number => {
        let adjusted = code;

        if (adjusted === 0x28) {
            adjusted = 0x3c;
        }

        if (adjusted === 0x29) {
            adjusted = 0x3e;
        }

        return adjusted - 0x2a;
    };

    for (const match of chunk_matches) {
        const data = match[1] ?? "";
        const chunk_size = Number(match[2]);
        const view = new DataView(out_buffer, out_offset, Math.floor((data.length / 5) * 4));

        for (let index = 0, byte_index = 0; index < data.length; index += 5, byte_index += 4) {
            view.setUint32(
                byte_index,
                get_base85_decode_value(data.charCodeAt(index + 4)) * 85 * 85 * 85 * 85 +
                    get_base85_decode_value(data.charCodeAt(index + 3)) * 85 * 85 * 85 +
                    get_base85_decode_value(data.charCodeAt(index + 2)) * 85 * 85 +
                    get_base85_decode_value(data.charCodeAt(index + 1)) * 85 +
                    get_base85_decode_value(data.charCodeAt(index)),
                true,
            );
        }

        out_offset += chunk_size;
    }

    return new Uint8Array(out_buffer, 0, total_bytes);
}

test("packages the Scratch project into plain HTML with turbo mode, 60 FPS, and only the four control buttons", () => {
    const temporary_directory = mkdtempSync(join(tmpdir(), "scratch-packager-"));
    const output_path = join(temporary_directory, "index.html");

    try {
        const result = spawnSync(
            process.execPath,
            [PACKAGER_SCRIPT_PATH, "--input", SB3_PATH, "--output", output_path],
            { encoding: "utf8", timeout: 30_000 },
        );

        assert.equal(result.error, undefined, result.error?.message);
        assert.equal(result.status, 0, result.stderr);

        const html = readFileSync(output_path, "utf8");
        assert.match(html, /^<!DOCTYPE html>/);
        assert.match(html, /vm\.setTurboMode\(true\);/);
        assert.match(html, /if \(vm\.setFramerate\) vm\.setFramerate\(60\);/);
        assert.match(html, /if \(vm\.setInterpolation\) vm\.setInterpolation\(false\);/);
        assert.match(html, /if \(vm\.renderer\.setUseHighQualityRender\) vm\.renderer\.setUseHighQualityRender\(false\);/);
        assert.match(html, /green-flag-button/);
        assert.match(html, /pause-button/);
        assert.match(html, /stop-all-button/);
        assert.match(html, /fullscreen-button/);
        assert.match(
            html,
            /ScaffoldingAddons\.run\(scaffolding, \{"gamepad":false,"pointerlock":false,"specialCloudBehaviors":false,"unsafeCloudBehaviors":false,"pause":true\}\);/,
        );

        const embedded_zip_bytes = decode_base85_chunks(html);
        assert.ok(embedded_zip_bytes.byteLength > 0);
        assert.equal(
            Buffer.from(embedded_zip_bytes).includes(Buffer.from("_twconfig_")),
            false,
            "stored _twconfig_ comment must be stripped so runtime options are not overridden on load",
        );
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
});
