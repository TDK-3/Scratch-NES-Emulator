import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { MAX_ROM_TEXT_BYTES, encode_rom_text } from "../src/nes/cartridge/rom_text.js";

/**
 * The converter page wires DOM elements to the reference encoder, so this drives the real
 * module against a fake DOM the way tests/browser-renderer.test.ts fakes a canvas: install
 * the globals the page reads, import it, and fire the events a browser would.
 */

interface FakeElement {
    id: string;
    textContent: string;
    value: string;
    disabled: boolean;
    href: string;
    download: string;
    dataset: Record<string, string>;
    files: { item(index: number): File | null } | null;
    selected_count: number;
    clicked: number;
    readonly listeners: Map<string, (() => void)[]>;
    addEventListener(type: string, handler: () => void): void;
    focus(): void;
    select(): void;
    click(): void;
    preventDefault(): void;
}

const elements = new Map<string, FakeElement>();
const created_anchors: FakeElement[] = [];

function make_element(id: string): FakeElement {
    const listeners = new Map<string, (() => void)[]>();

    return {
        id,
        textContent: "",
        value: "",
        disabled: false,
        href: "",
        download: "",
        dataset: {},
        files: null,
        selected_count: 0,
        clicked: 0,
        listeners,
        addEventListener(type, handler) {
            const existing = listeners.get(type) ?? [];
            existing.push(handler);
            listeners.set(type, existing);
        },
        focus() {},
        select() {
            this.selected_count += 1;
        },
        click() {
            this.clicked += 1;
        },
        preventDefault() {},
    };
}

function element(id: string): FakeElement {
    const existing = elements.get(id);

    if (existing !== undefined) {
        return existing;
    }

    const created = make_element(id);
    elements.set(id, created);

    return created;
}

function dispatch(id: string, type: string): void {
    for (const handler of element(id).listeners.get(type) ?? []) {
        handler();
    }
}

/** Lets the page's async file read finish before the test asserts on the elements. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
}

function ines_image(prg_banks: number, chr_banks: number, fill = 0xa5): Uint8Array<ArrayBuffer> {
    const header = Uint8Array.from([
        0x4e, 0x45, 0x53, 0x1a, prg_banks, chr_banks, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const payload = new Uint8Array(prg_banks * 16_384 + chr_banks * 8_192).fill(fill);
    const image = new Uint8Array(header.byteLength + payload.byteLength);
    image.set(header, 0);
    image.set(payload, header.byteLength);

    return image;
}

function install_globals(): void {
    const fake_document = {
        getElementById: (id: string): FakeElement => element(id),
        createElement: (): FakeElement => {
            const anchor = make_element("created-anchor");
            created_anchors.push(anchor);

            return anchor;
        },
        addEventListener: (): void => {},
    };

    Object.defineProperty(globalThis, "document", { value: fake_document, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", {
        value: { clipboard: undefined },
        configurable: true,
        writable: true,
    });
    Object.defineProperty(URL, "createObjectURL", {
        value: (): string => "blob:fake",
        configurable: true,
        writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
        value: (): void => {},
        configurable: true,
        writable: true,
    });
}

test("the converter page encodes a dropped ROM file into the byte text the port loads", async () => {
    install_globals();
    await import("../src/nes/browser/rom_string_page.js");

    const output = element("rom-text-output");
    const status = element("convert-status");
    const format_select = element("format-select");

    assert.equal(status.textContent, "No ROM file loaded.");
    assert.equal(element("copy-rom-text").disabled, true, "the copy button starts disabled");

    // A file chosen with the picker.
    const image = ines_image(1, 1);
    const expected_text = encode_rom_text(image, "continuous");
    element("rom-file").files = { item: () => new File([image], "chosen.nes", { type: "application/octet-stream" }) };
    format_select.value = "continuous";
    dispatch("rom-file", "change");
    await settle();

    assert.equal(output.value, expected_text.text);
    assert.equal(element("rom-name").textContent, "chosen.nes");
    assert.equal(element("rom-bytes").textContent, image.byteLength.toLocaleString("en-US"));
    assert.equal(element("rom-list-items").textContent, image.byteLength.toLocaleString("en-US"));
    assert.equal(element("header-mapper").textContent, "0");
    assert.equal(element("header-prg").textContent, `${(16_384).toLocaleString("en-US")} bytes`);
    assert.equal(element("header-chr").textContent, `${(8_192).toLocaleString("en-US")} bytes`);
    assert.ok(
        status.textContent.includes(
            `chosen.nes: ${image.byteLength.toLocaleString("en-US")} bytes became ` +
                `${expected_text.text.length.toLocaleString("en-US")} hexadecimal characters ` +
                "(2.00 per byte)",
        ),
        status.textContent,
    );
    assert.equal(status.dataset.state, "ready");
    assert.equal(element("copy-rom-text").disabled, false);
    assert.equal(element("download-rom-text").disabled, false);

    // The layout choice re-encodes the loaded image without another file pick.
    format_select.value = "spaced";
    dispatch("format-select", "change");
    await settle();

    assert.equal(output.value, encode_rom_text(image, "spaced").text);
    assert.match(element("format-note").textContent, /Putting one space between two byte values\./);

    // A dropped file takes the same path.
    const supplied = Uint8Array.from(readFileSync(fileURLToPath(new URL("../test_rom.nes", import.meta.url))));
    const drop_event = {
        dataTransfer: { files: { item: () => new File([supplied], "test_rom.nes") } },
        preventDefault: () => {},
    };

    for (const handler of element("rom-drop-zone").listeners.get("drop") ?? []) {
        (handler as unknown as (event: typeof drop_event) => void)(drop_event);
    }

    await settle();

    assert.equal(output.value, encode_rom_text(supplied, "spaced").text);
    assert.equal(element("rom-name").textContent, "test_rom.nes");
    assert.equal(element("header-mapper").textContent, "0");
    assert.match(element("header-note").textContent, /routes this mapper/);

    // The clipboard is unavailable here, so the page selects the text and says so.
    dispatch("copy-rom-text", "click");
    await settle();

    assert.equal(output.selected_count, 1);
    assert.match(status.textContent, /the text is selected/);

    // A saved file is named after the image.
    dispatch("download-rom-text", "click");
    await settle();

    assert.equal(created_anchors.length, 1);
    assert.equal(created_anchors[0]?.download, "test_rom_hex.txt");
    assert.equal(created_anchors[0]?.clicked, 1);

    // Clearing empties the output and disables the buttons again.
    dispatch("clear-rom", "click");
    await settle();

    assert.equal(output.value, "");
    assert.equal(element("rom-name").textContent, "No ROM loaded");
    assert.equal(status.textContent, "No ROM file loaded.");
    assert.equal(element("copy-rom-text").disabled, true);
});

test("the converter page reports an image the Scratch port cannot use", async () => {
    install_globals();
    await import("../src/nes/browser/rom_string_page.js");

    const output = element("rom-text-output");
    const status = element("convert-status");

    // A header the iNES parser rejects still converts; the report says the header is unread.
    const not_ines = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    element("rom-file").files = { item: () => new File([not_ines], "odd.bin") };
    element("format-select").value = "spaced";
    dispatch("rom-file", "change");
    await settle();

    assert.equal(output.value, encode_rom_text(not_ines, "spaced").text);
    assert.match(element("header-note").textContent, /The header does not parse/);
    assert.equal(element("header-mapper").textContent, "-");
    assert.match(status.textContent, /decoded back unchanged/);

    // An image past the Scratch list cap converts, but the page says the port cannot load it.
    const oversized = new Uint8Array(MAX_ROM_TEXT_BYTES + 1).fill(0x40);
    element("rom-file").files = { item: () => new File([oversized], "huge.nes") };
    dispatch("rom-file", "change");
    await settle();

    assert.match(status.textContent, /the Scratch port cannot use it/);
    assert.match(status.textContent, /over the 200,000 a Scratch list holds/);
    assert.equal(status.dataset.state, "error");
    assert.match(element("header-note").textContent, /The header does not parse/);

    // A NES 2.0 header with a submapper the port has no board for converts, but the report
    // says the port will reject it rather than implying every mapper 4 image loads.
    const submapper_header = Uint8Array.from([
        0x4e, 0x45, 0x53, 0x1a, 2, 1, 0x40, 0x08, 0x30, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const submapper_image = new Uint8Array(16 + 32_768 + 8_192);
    submapper_image.set(submapper_header, 0);
    element("rom-file").files = { item: () => new File([submapper_image], "submapper.nes") };
    dispatch("rom-file", "change");
    await settle();

    assert.equal(element("header-format").textContent, "NES 2.0");
    assert.equal(element("header-mapper").textContent, "4 submapper 3");
    assert.match(element("header-note").textContent, /rejects this mapper or submapper/);
    assert.match(status.textContent, /decoded back unchanged/);
});
