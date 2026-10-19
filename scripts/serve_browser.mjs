import { readFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CANONICAL_PROJECT_ROOT = realpath(PROJECT_ROOT);
const BUILD_SOURCE_ROOT = resolve(PROJECT_ROOT, "dist/src");
const PORT = read_port(process.env.PORT);

const STATIC_FILES = new Map([
    ["/", resolve(PROJECT_ROOT, "web/index.html")],
    ["/index.html", resolve(PROJECT_ROOT, "web/index.html")],
    ["/styles.css", resolve(PROJECT_ROOT, "web/styles.css")],
    ["/rom_string.html", resolve(PROJECT_ROOT, "web/rom_string.html")],
    ["/roms/test_rom.nes", resolve(PROJECT_ROOT, "test_rom.nes")],
    [
        "/roms/NES_APUTest_SquarePlayer.nes",
        resolve(PROJECT_ROOT, "tests/fixtures/nes-apu/NES_APUTest_SquarePlayer.nes"),
    ],
]);

const CONTENT_TYPES = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".nes", "application/octet-stream"],
]);

const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end("Method not allowed.");
        return;
    }

    let path_name;

    try {
        path_name = new URL(request.url ?? "/", "http://arena.invalid").pathname;
    } catch {
        response.writeHead(400);
        response.end("Invalid request path.");
        return;
    }

    const requested_file = resolve_requested_file(path_name);

    if (requested_file === null) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found.");
        return;
    }

    let contents;
    let content_type;

    try {
        const project_root = await CANONICAL_PROJECT_ROOT;
        const allowed_root = await realpath(requested_file.allowed_root);
        const file_path = await realpath(requested_file.file_path);

        if (!is_same_or_child(project_root, allowed_root) || !is_same_or_child(allowed_root, file_path)) {
            response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("Not found.");
            return;
        }

        contents = await readFile(file_path);
        content_type = CONTENT_TYPES.get(extname(requested_file.file_path)) ?? "application/octet-stream";
    } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found.");
        return;
    }
    response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": contents.byteLength,
        "Content-Type": content_type,
        "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : contents);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`TypeScript NES browser preview at http://localhost:${PORT} (listening on 0.0.0.0:${PORT})`);
});

function resolve_requested_file(path_name) {
    const static_path = STATIC_FILES.get(path_name);

    if (static_path !== undefined) {
        return { file_path: static_path, allowed_root: PROJECT_ROOT };
    }

    if (!path_name.startsWith("/build/")) {
        return null;
    }

    let relative_path;

    try {
        relative_path = decodeURIComponent(path_name.slice("/build/".length));
    } catch {
        return null;
    }

    if (relative_path.length === 0 || relative_path.includes("\0")) {
        return null;
    }

    const build_path = resolve(BUILD_SOURCE_ROOT, relative_path);

    if (!build_path.startsWith(`${BUILD_SOURCE_ROOT}${sep}`)) {
        return null;
    }

    return { file_path: build_path, allowed_root: BUILD_SOURCE_ROOT };
}

function is_same_or_child(root_path, candidate_path) {
    const relative_path = relative(root_path, candidate_path);

    return (
        relative_path.length === 0 ||
        (relative_path !== ".." && !relative_path.startsWith(`..${sep}`) && !isAbsolute(relative_path))
    );
}

function read_port(value) {
    if (value === undefined || value.length === 0) {
        return 4173;
    }

    const port = Number(value);

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new RangeError(`PORT must be an integer from 1 through 65535; received ${value}.`);
    }

    return port;
}
