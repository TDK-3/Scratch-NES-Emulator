import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import type { RomParseResult } from "../src/nes/cartridge/ines.js";
import { parse_ines_rom } from "../src/nes/cartridge/ines.js";
import type { RomTextDecodeResult, RomTextEncoding, RomTextFormat } from "../src/nes/cartridge/rom_text.js";

const PACKAGER_SCRIPT_PATH = fileURLToPath(new URL("../scripts/package_scratch.mjs", import.meta.url));
const SB3_PATH = fileURLToPath(new URL("../scratch/scratch.sb3", import.meta.url));
const TEST_ROM_PATH = fileURLToPath(new URL("../test_rom.nes", import.meta.url));
const BUILD_WORKFLOW_PATH = fileURLToPath(new URL("../.github/workflows/build.yml", import.meta.url));
const DEPLOY_WORKFLOW_PATH = fileURLToPath(new URL("../.github/workflows/deploy-pages.yml", import.meta.url));

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

        const staged_rom_string_path = join(temporary_directory, "rom_string.html");
        const staged_styles_path = join(temporary_directory, "styles.css");
        const staged_entry_js_path = join(temporary_directory, "build", "nes", "browser", "rom_string_page.js");
        const staged_ines_js_path = join(temporary_directory, "build", "nes", "cartridge", "ines.js");
        const staged_rom_text_js_path = join(temporary_directory, "build", "nes", "cartridge", "rom_text.js");

        for (const required_path of [
            staged_rom_string_path,
            staged_styles_path,
            staged_entry_js_path,
            staged_ines_js_path,
            staged_rom_text_js_path,
        ]) {
            assert.equal(existsSync(required_path), true, `expected staged Pages file ${required_path}`);
        }

        const converter_html = readFileSync(staged_rom_string_path, "utf8");
        assert.match(converter_html, /href="\.\/styles\.css"/);
        assert.match(converter_html, /src="\.\/build\/nes\/browser\/rom_string_page\.js"/);
        assert.match(converter_html, /href="\.\/"/);
        assert.doesNotMatch(
            converter_html,
            /\b(?:href|src)="\/(?!\/)/,
            "staged rom_string.html must not contain root-relative URLs that 404 on GitHub Pages project subpaths",
        );
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
});

test("staged Pages bundle serves index.html and rom_string.html cleanly from a GitHub Pages repository subpath", async () => {
    const temporary_directory = mkdtempSync(join(tmpdir(), "scratch-pages-subpath-"));
    const output_path = join(temporary_directory, "index.html");

    try {
        const packager_module = (await import(pathToFileURL(PACKAGER_SCRIPT_PATH).href)) as {
            package_scratch_project: (input_path: string, output_path: string) => Promise<unknown>;
        };
        await packager_module.package_scratch_project(SB3_PATH, output_path);

        const prefix = "/Scratch-NES-Emulator";
        const content_types: Readonly<Record<string, string>> = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
        };

        const server = createServer((req, res) => {
            const url_path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
            if (!url_path.startsWith(`${prefix}/`)) {
                res.writeHead(404).end();
                return;
            }

            const rel_path = url_path.slice(`${prefix}/`.length) || "index.html";
            const file_path = join(temporary_directory, normalize(rel_path));
            if (!file_path.startsWith(temporary_directory) || !existsSync(file_path)) {
                res.writeHead(404).end();
                return;
            }

            res.writeHead(200, { "Content-Type": content_types[extname(file_path)] ?? "application/octet-stream" });
            res.end(readFileSync(file_path));
        });

        await new Promise<void>((resolve_listen) => server.listen(0, "127.0.0.1", () => resolve_listen()));
        const port = (server.address() as AddressInfo).port;
        const subpath_root = `http://127.0.0.1:${port}${prefix}/`;

        try {
            const index_res = await fetch(subpath_root);
            assert.equal(index_res.status, 200);
            assert.match(await index_res.text(), /^<!DOCTYPE html>/);

            const converter_url = new URL("rom_string.html", subpath_root).href;
            const converter_res = await fetch(converter_url);
            assert.equal(converter_res.status, 200);
            const converter_html = await converter_res.text();

            const css_href = /<link rel="stylesheet" href="([^"]+)">/.exec(converter_html)?.[1];
            const script_src = /<script type="module" src="([^"]+)"><\/script>/.exec(converter_html)?.[1];
            const back_href = /<a class="page-link" href="([^"]+)">/.exec(converter_html)?.[1];
            assert.ok(css_href && script_src && back_href);

            const css_res = await fetch(new URL(css_href, converter_url));
            assert.equal(css_res.status, 200);
            assert.match(await css_res.text(), /\.convert-panel/);

            const entry_url = new URL(script_src, converter_url).href;
            const entry_res = await fetch(entry_url);
            assert.equal(entry_res.status, 200);
            const entry_js = await entry_res.text();

            for (const import_match of entry_js.matchAll(/from\s+"([^"]+)"/g)) {
                const dep_res = await fetch(new URL(import_match[1] ?? "", entry_url));
                assert.equal(dep_res.status, 200, `dependency ${import_match[1]} must resolve from ${entry_url}`);
            }

            const back_res = await fetch(new URL(back_href, converter_url));
            assert.equal(back_res.status, 200);

            const staged_ines = (await import(
                pathToFileURL(join(temporary_directory, "build", "nes", "cartridge", "ines.js")).href
            )) as { parse_ines_rom: (bytes: Uint8Array) => RomParseResult };
            const staged_rom_text = (await import(
                pathToFileURL(join(temporary_directory, "build", "nes", "cartridge", "rom_text.js")).href
            )) as {
                encode_rom_text: (bytes: Uint8Array, format: RomTextFormat) => RomTextEncoding;
                decode_rom_text: (text: string) => RomTextDecodeResult;
            };

            const rom_bytes = new Uint8Array(readFileSync(TEST_ROM_PATH));
            const encoded = staged_rom_text.encode_rom_text(rom_bytes, "continuous");
            assert.equal(encoded.text.length, rom_bytes.byteLength * 2);
            const decoded = staged_rom_text.decode_rom_text(encoded.text);
            assert.equal(decoded.ok, true);
            if (decoded.ok) {
                assert.deepEqual(decoded.bytes, rom_bytes);
            }
            const parsed = staged_ines.parse_ines_rom(rom_bytes);
            assert.equal(parsed.ok, true);
            assert.deepEqual(parsed, parse_ines_rom(rom_bytes));
        } finally {
            await new Promise<void>((resolve_close) => server.close(() => resolve_close()));
        }
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
});

test("GitHub Pages build and deploy workflows stage and verify rom_string.html alongside index.html", () => {
    const build_workflow = readFileSync(BUILD_WORKFLOW_PATH, "utf8");
    const deploy_workflow = readFileSync(DEPLOY_WORKFLOW_PATH, "utf8");

    assert.match(build_workflow, /name:\s*packaged-html[\s\S]*?path:\s*dist\/pages\s*\n/);
    assert.doesNotMatch(build_workflow, /path:\s*dist\/pages\/index\.html/);
    assert.match(build_workflow, /test -f dist\/pages\/rom_string\.html/);
    assert.match(deploy_workflow, /test -f dist\/pages\/index\.html/);
    assert.match(deploy_workflow, /test -f dist\/pages\/rom_string\.html/);
    assert.match(deploy_workflow, /uses:\s*actions\/upload-pages-artifact@v3[\s\S]*?path:\s*dist\/pages/);
});
