import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SERVER_SCRIPT = fileURLToPath(new URL("../scripts/serve_browser.mjs", import.meta.url));
const BUILD_SOURCE_ROOT = fileURLToPath(new URL("../dist/src/", import.meta.url));
const TEST_ROM_PATH = new URL("../test_rom.nes", import.meta.url);
const APU_ROM_PATH = new URL("./fixtures/nes-apu/NES_APUTest_SquarePlayer.nes", import.meta.url);

test("browser preview serves its shell and ROMs, supports HEAD, and rejects unsafe routes", async (context) => {
    const escape_directory = mkdtempSync(join(tmpdir(), "browser-route-escape-"));
    const escape_file = join(escape_directory, "secret.js");
    const escape_name = `symlink-escape-${process.pid}-${Date.now()}.js`;
    const escape_link = join(BUILD_SOURCE_ROOT, escape_name);
    mkdirSync(BUILD_SOURCE_ROOT, { recursive: true });
    writeFileSync(escape_file, "globalThis.secret = true;");
    symlinkSync(escape_file, escape_link);
    context.after(() => {
        rmSync(escape_link, { force: true });
        rmSync(escape_directory, { recursive: true, force: true });
    });

    const port = await find_available_port();
    const server = spawn(process.execPath, [SERVER_SCRIPT], {
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
    });
    context.after(async () => stop_server(server));

    await wait_for_server(server);
    const base_url = `http://127.0.0.1:${port}`;

    const page_response = await fetch(base_url);
    assert.equal(page_response.status, 200);
    assert.match(page_response.headers.get("content-type") ?? "", /^text\/html/);
    const page = await page_response.text();
    assert.match(page, /<canvas id="nes-screen"/);
    assert.match(page, /src="\/build\/nes\/browser\/main\.js"/);

    const stylesheet_response = await fetch(`${base_url}/styles.css`);
    assert.equal(stylesheet_response.status, 200);
    assert.match(stylesheet_response.headers.get("content-type") ?? "", /^text\/css/);
    assert.match(await stylesheet_response.text(), /\.screen-container/);

    const converter_response = await fetch(`${base_url}/rom_string.html`);
    assert.equal(converter_response.status, 200);
    assert.match(converter_response.headers.get("content-type") ?? "", /^text\/html/);
    const converter_page = await converter_response.text();
    assert.match(converter_page, /<textarea\s+id="rom-text-output"/);
    assert.match(converter_page, /src="\/build\/nes\/browser\/rom_string_page\.js"/);

    const supplied_rom = await readFile(TEST_ROM_PATH);
    const supplied_rom_response = await fetch(`${base_url}/roms/test_rom.nes`);
    assert.equal(supplied_rom_response.status, 200);
    assert.equal(supplied_rom_response.headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(Buffer.from(await supplied_rom_response.arrayBuffer()), supplied_rom);

    const apu_rom = await readFile(APU_ROM_PATH);
    const apu_rom_response = await fetch(`${base_url}/roms/NES_APUTest_SquarePlayer.nes`);
    assert.equal(apu_rom_response.status, 200);
    assert.deepEqual(Buffer.from(await apu_rom_response.arrayBuffer()), apu_rom);

    const head_response = await fetch(`${base_url}/styles.css`, { method: "HEAD" });
    assert.equal(head_response.status, 200);
    assert.equal(await head_response.text(), "");
    assert.equal(head_response.headers.get("content-length"), stylesheet_response.headers.get("content-length"));

    const post_response = await fetch(base_url, { method: "POST" });
    assert.equal(post_response.status, 405);
    assert.equal(post_response.headers.get("allow"), "GET, HEAD");

    const traversal_response = await fetch(`${base_url}/build/%2e%2e%2fpackage.json`);
    assert.equal(traversal_response.status, 404);

    const symlink_response = await fetch(`${base_url}/build/${escape_name}`);
    assert.equal(symlink_response.status, 404, "Build routes must not follow symlinks outside the project.");
});

async function find_available_port(): Promise<number> {
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();

    if (address === null || typeof address === "string") {
        throw new Error("Could not obtain an ephemeral port for the browser preview test.");
    }

    await new Promise<void>((resolve, reject) => {
        probe.close((error) => (error === undefined ? resolve() : reject(error)));
    });

    return address.port;
}

async function wait_for_server(server: ReturnType<typeof spawn>): Promise<void> {
    let stdout = "";
    let stderr = "";

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error(`Browser preview did not start. ${stdout} ${stderr}`)), 3_000);

        const finish = (error?: Error): void => {
            clearTimeout(timeout);
            server.stdout?.off("data", on_stdout);
            server.stderr?.off("data", on_stderr);
            server.off("error", on_error);
            server.off("exit", on_exit);

            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        };
        const on_stdout = (chunk: Buffer): void => {
            stdout += chunk.toString();

            if (stdout.includes("listening on 0.0.0.0:")) {
                finish();
            }
        };
        const on_stderr = (chunk: Buffer): void => {
            stderr += chunk.toString();
        };
        const on_error = (error: Error): void => finish(error);
        const on_exit = (code: number | null, signal: NodeJS.Signals | null): void => {
            finish(new Error(`Browser preview exited before startup (code ${String(code)}, signal ${String(signal)}). ${stderr}`));
        };

        server.stdout?.on("data", on_stdout);
        server.stderr?.on("data", on_stderr);
        server.once("error", on_error);
        server.once("exit", on_exit);
    });
}

async function stop_server(server: ReturnType<typeof spawn>): Promise<void> {
    if (server.exitCode !== null || server.signalCode !== null) {
        return;
    }

    const exit_event = once(server, "exit");
    server.kill("SIGTERM");
    const stopped = await Promise.race([
        exit_event.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);

    if (!stopped) {
        server.kill("SIGKILL");
        await exit_event;
    }
}
