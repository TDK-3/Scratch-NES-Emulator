/**
 * The ROM string converter page.
 *
 * The GoboScript port loads a cartridge from a pasted string of hexadecimal byte values, and
 * nobody types 80,000 pairs by hand. This page turns a .nes file into that string with the
 * reference encoder in src/nes/cartridge/rom_text.ts, reports what the iNES header says about
 * the image, and decodes its own output again so a conversion that would not load is caught
 * here instead of in the Scratch project.
 *
 * The page never uploads anything: the file is read in the browser and the text stays local.
 */

import { parse_ines_rom } from "../cartridge/ines.js";
import {
    MAX_ROM_TEXT_BYTES,
    MAX_ROM_TEXT_CHARACTERS,
    ROM_TEXT_BYTES_PER_LINE,
    ROM_TEXT_FORMATS,
    decode_rom_text,
    encode_rom_text,
} from "../cartridge/rom_text.js";
import type { RomTextFormat } from "../cartridge/rom_text.js";

const rom_file_input = get_required_element<HTMLInputElement>("rom-file");
const drop_zone = get_required_element<HTMLDivElement>("rom-drop-zone");
const format_select = get_required_element<HTMLSelectElement>("format-select");
const output_area = get_required_element<HTMLTextAreaElement>("rom-text-output");
const copy_button = get_required_element<HTMLButtonElement>("copy-rom-text");
const download_button = get_required_element<HTMLButtonElement>("download-rom-text");
const clear_button = get_required_element<HTMLButtonElement>("clear-rom");
const convert_status = get_required_element<HTMLParagraphElement>("convert-status");
const rom_name = get_required_element<HTMLElement>("rom-name");
const rom_bytes = get_required_element<HTMLElement>("rom-bytes");
const rom_text_chars = get_required_element<HTMLElement>("rom-text-chars");
const rom_list_items = get_required_element<HTMLElement>("rom-list-items");
const header_format = get_required_element<HTMLElement>("header-format");
const header_mapper = get_required_element<HTMLElement>("header-mapper");
const header_prg = get_required_element<HTMLElement>("header-prg");
const header_chr = get_required_element<HTMLElement>("header-chr");
const header_mirroring = get_required_element<HTMLElement>("header-mirroring");
const header_battery = get_required_element<HTMLElement>("header-battery");
const format_note = get_required_element<HTMLParagraphElement>("format-note");

let loaded_rom_name = "";
let loaded_rom_image: Uint8Array | null = null;

rom_file_input.addEventListener("change", () => {
    const file = rom_file_input.files?.item(0);

    if (file !== undefined && file !== null) {
        void convert_file(file);
    }
});

drop_zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop_zone.dataset.state = "active";
});

drop_zone.addEventListener("dragleave", () => {
    drop_zone.dataset.state = "idle";
});

drop_zone.addEventListener("drop", (event) => {
    event.preventDefault();
    drop_zone.dataset.state = "idle";
    const file = event.dataTransfer?.files.item(0);

    if (file !== undefined && file !== null) {
        void convert_file(file);
    }
});

format_select.addEventListener("change", () => {
    format_note.textContent = format_description(selected_format());

    // Re-encode the image that is already loaded, so the layout choice takes effect on the
    // text the page is showing instead of only on the next file load.
    if (loaded_rom_image !== null) {
        convert_bytes(loaded_rom_image, loaded_rom_name);
    }
});

copy_button.addEventListener("click", () => {
    void copy_output();
});

download_button.addEventListener("click", download_output);
clear_button.addEventListener("click", clear_output);

format_note.textContent = format_description(selected_format());
set_status("No ROM file loaded.", false);
update_buttons();

async function convert_file(file: File): Promise<void> {
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        convert_bytes(bytes, file.name);
    } catch (error) {
        set_status(`Could not read ${file.name}: ${format_error(error)}`, true);
    }
}

/** Encodes an image, reports its header, and decodes the text back as a check. */
function convert_bytes(rom_image: Uint8Array, name: string): void {
    if (rom_image.byteLength === 0) {
        // Drop whatever the previous conversion left behind, so the output cannot be copied
        // as if it described this file.
        output_area.value = "";
        loaded_rom_name = "";
        loaded_rom_image = null;
        set_status(`${name} is empty, so there is nothing to convert.`, true);
        update_buttons();
        return;
    }

    const encoding = encode_rom_text(rom_image, selected_format());

    loaded_rom_name = name;
    loaded_rom_image = rom_image;
    output_area.value = encoding.text;

    rom_name.textContent = name;
    rom_bytes.textContent = format_count(rom_image.byteLength);
    rom_text_chars.textContent = format_count(encoding.text.length);
    rom_list_items.textContent = format_count(rom_image.byteLength);
    report_header(rom_image);

    const problems: string[] = [];

    if (rom_image.byteLength > MAX_ROM_TEXT_BYTES) {
        problems.push(
            `the image is ${format_count(rom_image.byteLength)} bytes, over the ` +
                `${format_count(MAX_ROM_TEXT_BYTES)} a Scratch list holds`,
        );
    }

    if (encoding.text.length > MAX_ROM_TEXT_CHARACTERS) {
        problems.push(
            `the text is ${format_count(encoding.text.length)} characters, over the ` +
                `${format_count(MAX_ROM_TEXT_CHARACTERS)} the port decodes`,
        );
    }

    const round_trip = decode_rom_text(encoding.text);

    if (!round_trip.ok) {
        problems.push(`the text does not decode again: ${round_trip.error.message}`);
    } else if (!same_bytes(round_trip.bytes, rom_image)) {
        problems.push("the text decodes to different bytes than the file holds");
    }

    if (problems.length > 0) {
        set_status(`${name}: converted, but the Scratch port cannot use it; ${problems.join(", and ")}.`, true);
    } else {
        set_status(
            `${name}: ${format_count(rom_image.byteLength)} bytes became ` +
                `${format_count(encoding.text.length)} hexadecimal characters ` +
                `(${format_ratio(encoding.text.length, rom_image.byteLength)} per byte), ` +
                "and the text decoded back unchanged.",
        );
    }

    update_buttons();
}

/** Reports what the iNES header says, or why it does not parse. */
function report_header(rom_image: Uint8Array): void {
    const parsed = parse_ines_rom(rom_image);

    if (!parsed.ok) {
        header_format.textContent = "-";
        header_mapper.textContent = "-";
        header_prg.textContent = "-";
        header_chr.textContent = "-";
        header_mirroring.textContent = "-";
        header_battery.textContent = "-";
        set_header_note(`The header does not parse: ${parsed.error.message}`);
        return;
    }

    const rom = parsed.value;
    header_format.textContent = rom.format === "nes-2.0" ? "NES 2.0" : "iNES 1.0";
    header_mapper.textContent = `${rom.mapper_id}${rom.submapper === 0 ? "" : ` submapper ${rom.submapper}`}`;
    header_prg.textContent = `${format_count(rom.prg_rom.byteLength)} bytes`;
    header_chr.textContent = rom.chr_rom.byteLength === 0
        ? `CHR RAM (${format_count(rom.chr_ram_bytes)} bytes)`
        : `${format_count(rom.chr_rom.byteLength)} bytes`;
    header_mirroring.textContent = rom.mirroring;
    header_battery.textContent = rom.battery_backed ? "yes" : "no";
    set_header_note(
        (rom.mapper_id === 0 || rom.mapper_id === 4) && rom.submapper === 0
            ? "The Scratch port routes this mapper and submapper to a board."
            : "The Scratch port rejects this mapper or submapper; the TypeScript emulator may still run it.",
    );
}

function set_header_note(message: string): void {
    const note = document.getElementById("header-note");

    if (note !== null) {
        note.textContent = message;
    }
}

async function copy_output(): Promise<void> {
    const text = output_area.value;

    if (text.length === 0) {
        set_status("Load a ROM file first.", true);
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
        set_status(`Copied ${format_count(text.length)} characters to the clipboard.`);
    } catch {
        output_area.focus();
        output_area.select();
        set_status("The clipboard is unavailable here; the text is selected, so copy it from the keyboard.", true);
    }
}

function download_output(): void {
    const text = output_area.value;

    if (text.length === 0) {
        set_status("Load a ROM file first.", true);
        return;
    }

    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${strip_extension(loaded_rom_name) || "rom"}_hex.txt`;
    link.click();
    URL.revokeObjectURL(url);
    set_status(`Saved ${link.download}.`);
}

function clear_output(): void {
    output_area.value = "";
    loaded_rom_name = "";
    loaded_rom_image = null;
    rom_file_input.value = "";

    for (const target of [
        rom_name,
        rom_bytes,
        rom_text_chars,
        rom_list_items,
        header_format,
        header_mapper,
        header_prg,
        header_chr,
        header_mirroring,
        header_battery,
    ]) {
        target.textContent = target === rom_name ? "No ROM loaded" : "-";
    }

    set_header_note("Load a .nes file to read its header.");
    set_status("No ROM file loaded.", false);
    update_buttons();
}

function update_buttons(): void {
    const has_text = output_area.value.length > 0;
    copy_button.disabled = !has_text;
    download_button.disabled = !has_text;
    clear_button.disabled = !has_text;
}

function selected_format(): RomTextFormat {
    const value = format_select.value;

    return ROM_TEXT_FORMATS.find((option) => option === value) ?? "continuous";
}

function format_description(format: RomTextFormat): string {
    if (format === "spaced") {
        return "Putting one space between two byte values. The port ignores any character " +
            "that is not a hexadecimal digit, so this only changes how the text reads on screen.";
    }

    if (format === "lines") {
        return `Starting a new line every ${ROM_TEXT_BYTES_PER_LINE} bytes (${
            ROM_TEXT_BYTES_PER_LINE * 2
        } hexadecimal digits). ` +
            "The port ignores newlines, so this only changes how the text reads on screen.";
    }

    return "Writing every byte as two hexadecimal digits with nothing between them. This is " +
        "the shortest form; the port ignores separators, so whitespace is optional.";
}

function same_bytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) {
        return false;
    }

    for (let index = 0; index < left.byteLength; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
}

function strip_extension(name: string): string {
    const dot = name.lastIndexOf(".");

    return dot > 0 ? name.slice(0, dot) : name;
}

function format_count(value: number): string {
    return value.toLocaleString("en-US");
}

function format_ratio(characters: number, bytes: number): string {
    return (characters / bytes).toFixed(2);
}

function set_status(message: string, is_error = false): void {
    convert_status.textContent = message;
    convert_status.dataset.state = is_error ? "error" : "ready";
}

function format_error(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function get_required_element<ElementType extends HTMLElement>(id: string): ElementType {
    const element = document.getElementById(id);

    if (element === null) {
        throw new Error(`Missing required browser element #${id}.`);
    }

    return element as ElementType;
}
