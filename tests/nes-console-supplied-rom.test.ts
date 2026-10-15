import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NesConsole } from "../src/nes/core/nes_console.js";
import type { NesConsoleFrame } from "../src/nes/core/nes_console.js";

const SUPPLIED_MMC3_ROM = new Uint8Array(readFileSync(new URL("../test_rom.nes", import.meta.url)));
const MAX_TITLE_BOOT_FRAMES = 60;

test("boots the supplied MMC3 ROM to its Super Mario Bros. 2 title screen within a bounded run", () => {
    const creation_result = NesConsole.create(SUPPLIED_MMC3_ROM);

    if (!creation_result.ok) {
        throw new Error(`Failed to compose the supplied ROM: ${creation_result.error.stage}.`);
    }

    const console = creation_result.value;
    assert.deepEqual(console.get_rom_metadata(), {
        format: "ines-1.0",
        mapper_id: 4,
        submapper: 0,
        mirroring: "vertical",
    });

    let title_frame: NesConsoleFrame | undefined;

    for (let frame_index = 0; frame_index < MAX_TITLE_BOOT_FRAMES; frame_index += 1) {
        const frame = console.advance_frame();

        if (shows_smb2j_title_screen(frame.framebuffer)) {
            title_frame = frame;
            break;
        }
    }

    if (title_frame === undefined) {
        throw new Error(`The supplied ROM did not render the SMB2 title signature within ${MAX_TITLE_BOOT_FRAMES} frames.`);
    }

    assert.ok(title_frame.frame_number <= MAX_TITLE_BOOT_FRAMES);
    assert.ok(console.get_cpu_cycle_count() <= MAX_TITLE_BOOT_FRAMES * 30_000);
});

function shows_smb2j_title_screen(framebuffer: Uint8Array): boolean {
    // Pin one sky, title-panel, and logo pixel so the bounded smoke detects actual title rendering.
    return (
        read_pixel(framebuffer, 0, 0) === 34 &&
        read_pixel(framebuffer, 100, 100) === 54 &&
        read_pixel(framebuffer, 128, 100) === 23
    );
}

function read_pixel(framebuffer: Uint8Array, x: number, y: number): number | undefined {
    return framebuffer[y * 256 + x];
}
