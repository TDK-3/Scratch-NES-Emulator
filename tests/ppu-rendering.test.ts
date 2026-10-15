import assert from "node:assert/strict";
import test from "node:test";

import type { MirroringMode } from "../src/nes/cartridge/ines.js";
import type { MapperPpuBusAccess, PpuMapperPort } from "../src/nes/ppu/ppu_bus.js";
import { PpuMemoryBus } from "../src/nes/ppu/ppu_bus.js";
import { Ppu2C02 } from "../src/nes/ppu/ppu_2c02.js";

const PPU_DOTS_PER_SCANLINE = 341;
const PPU_FRAME_DOTS = PPU_DOTS_PER_SCANLINE * 262;
const PPU_BACKGROUND_ENABLE = 0x08;
const PPU_SPRITE_ENABLE = 0x10;
const PPU_BACKGROUND_LEFT_COLUMN_ENABLE = 0x02;
const PPU_SPRITE_LEFT_COLUMN_ENABLE = 0x04;
const PPU_SPRITE_ZERO_HIT = 0x40;
const PPU_SPRITE_OVERFLOW = 0x20;

test("renders the backdrop with rendering disabled and still records color emphasis", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    memory_bus.write_ppu(0x3f00, 0x2a);
    ppu.write_cpu_register(1, 0x20);

    advance_dots(ppu, PPU_DOTS_PER_SCANLINE + 2);

    assert.deepEqual(ppu.read_framebuffer_pixel(0, 0), { color_index: 0x2a, emphasis: 1 });
});

test("renders background pattern pixels and the universal backdrop into a 256 by 240 framebuffer", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    memory_bus.write_ppu(0x2000, 1);
    memory_bus.write_ppu(0x0010, 0xff);
    memory_bus.write_ppu(0x3f00, 0x0f);
    memory_bus.write_ppu(0x3f01, 0x21);
    ppu.write_cpu_register(1, PPU_BACKGROUND_ENABLE | PPU_BACKGROUND_LEFT_COLUMN_ENABLE);

    advance_dots(ppu, PPU_DOTS_PER_SCANLINE);
    advance_dots(ppu, 10);

    assert.equal(ppu.get_framebuffer_width(), 256);
    assert.equal(ppu.get_framebuffer_height(), 240);
    assert.deepEqual(ppu.read_framebuffer_pixel(0, 0), { color_index: 0x21, emphasis: 0 });
    assert.deepEqual(ppu.read_framebuffer_pixel(7, 0), { color_index: 0x21, emphasis: 0 });
    assert.deepEqual(ppu.read_framebuffer_pixel(8, 0), { color_index: 0x0f, emphasis: 0 });

    const pixels = ppu.get_framebuffer();
    assert.equal(pixels.length, 256 * 240);
    pixels[0] = 0;
    assert.equal(ppu.read_framebuffer_pixel(0, 0).color_index, 0x21);
});

test("clips the first eight background pixels when PPUMASK left-column rendering is disabled", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    memory_bus.write_ppu(0x2000, 1);
    memory_bus.write_ppu(0x0010, 0xff);
    memory_bus.write_ppu(0x0000, 0xff);
    memory_bus.write_ppu(0x3f00, 0x0f);
    memory_bus.write_ppu(0x3f01, 0x21);
    ppu.write_cpu_register(1, PPU_BACKGROUND_ENABLE);

    advance_dots(ppu, PPU_DOTS_PER_SCANLINE + 10);

    assert.equal(ppu.read_framebuffer_pixel(0, 0).color_index, 0x0f);
    assert.equal(ppu.read_framebuffer_pixel(7, 0).color_index, 0x0f);
    assert.equal(ppu.read_framebuffer_pixel(8, 0).color_index, 0x21);
});

test("produces identical complete framebuffers from identical PPU and memory state", () => {
    const first = make_ppu_fixture();
    const second = make_ppu_fixture();

    for (const fixture of [first, second]) {
        fixture.memory_bus.write_ppu(0x0000, 0xaa);
        fixture.memory_bus.write_ppu(0x3f00, 0x0f);
        fixture.memory_bus.write_ppu(0x3f01, 0x21);
        fixture.ppu.write_cpu_register(1, PPU_BACKGROUND_ENABLE | PPU_BACKGROUND_LEFT_COLUMN_ENABLE);
        advance_dots(fixture.ppu, PPU_FRAME_DOTS);
    }

    assert.deepEqual(first.ppu.get_framebuffer(), second.ppu.get_framebuffer());
    assert.deepEqual(
        first.ppu.get_framebuffer_emphasis(),
        second.ppu.get_framebuffer_emphasis(),
    );
});

test("selects the background attribute quadrant and applies fine X scrolling", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    memory_bus.write_ppu(0x2000, 1);
    memory_bus.write_ppu(0x23c0, 0x02);
    memory_bus.write_ppu(0x0010, 0x80);
    memory_bus.write_ppu(0x0000, 0x80);
    memory_bus.write_ppu(0x3f00, 0x0f);
    memory_bus.write_ppu(0x3f09, 0x2a);
    ppu.write_cpu_register(5, 0x01);
    ppu.write_cpu_register(1, PPU_BACKGROUND_ENABLE | PPU_BACKGROUND_LEFT_COLUMN_ENABLE);

    advance_dots(ppu, PPU_DOTS_PER_SCANLINE);
    advance_dots(ppu, 10);

    assert.equal(ppu.read_framebuffer_pixel(0, 0).color_index, 0x0f);
    assert.equal(ppu.read_framebuffer_pixel(7, 0).color_index, 0x2a);
});

test("selects the PPUCTRL background pattern table", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    memory_bus.write_ppu(0x2000, 1);
    memory_bus.write_ppu(0x1010, 0x80);
    memory_bus.write_ppu(0x3f01, 0x25);
    ppu.write_cpu_register(0, 0x10);
    ppu.write_cpu_register(1, PPU_BACKGROUND_ENABLE | PPU_BACKGROUND_LEFT_COLUMN_ENABLE);

    advance_dots(ppu, PPU_DOTS_PER_SCANLINE + 2);

    assert.equal(ppu.read_framebuffer_pixel(0, 0).color_index, 0x25);
});

test("wraps coarse X into the adjacent nametable and coarse Y through its vertical nametable", () => {
    const { ppu } = make_ppu_fixture();
    ppu.write_cpu_register(5, 0xf8);
    ppu.write_cpu_register(5, 0xef);
    ppu.write_cpu_register(1, PPU_BACKGROUND_ENABLE);

    advance_dots(ppu, PPU_DOTS_PER_SCANLINE);
    assert.equal(ppu.get_vram_address() & 0x041f, 0x0401);

    advance_to_position(ppu, 0, 257);
    assert.equal(ppu.get_vram_address() & 0x7be0, 0x0800);
});

test("wraps coarse Y row 31 without toggling the vertical nametable", () => {
    const { ppu } = make_ppu_fixture();
    ppu.write_cpu_register(5, 0x00);
    ppu.write_cpu_register(5, 0xff);
    ppu.write_cpu_register(1, PPU_BACKGROUND_ENABLE);

    advance_to_position(ppu, 0, 257);

    assert.equal(ppu.get_vram_address() & 0x7be0, 0x0000);
});

test("applies grayscale masking and preserves PPUMASK emphasis as per-pixel metadata", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    memory_bus.write_ppu(0x2000, 1);
    memory_bus.write_ppu(0x0010, 0xff);
    memory_bus.write_ppu(0x3f01, 0x2b);
    ppu.write_cpu_register(
        1,
        PPU_BACKGROUND_ENABLE | PPU_BACKGROUND_LEFT_COLUMN_ENABLE | 0x01 | 0x60,
    );

    advance_dots(ppu, PPU_DOTS_PER_SCANLINE + 2);

    assert.deepEqual(ppu.read_framebuffer_pixel(0, 0), { color_index: 0x20, emphasis: 3 });
    assert.equal(ppu.get_framebuffer_emphasis()[0], 3);
});

test("renders sprites at their OAM X position and supports horizontal flip", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    initialize_oam(ppu);
    set_sprite(ppu, 0, { y: 0, tile: 2, attributes: 0, x: 10 });
    memory_bus.write_ppu(0x0020, 0x80);
    memory_bus.write_ppu(0x3f11, 0x16);
    ppu.write_cpu_register(1, PPU_SPRITE_ENABLE | PPU_SPRITE_LEFT_COLUMN_ENABLE);

    advance_to_position(ppu, 1, 12);

    assert.equal(ppu.read_framebuffer_pixel(10, 1).color_index, 0x16);
    assert.equal(ppu.read_framebuffer_pixel(11, 1).color_index, 0x00);

    const flipped = make_ppu_fixture();
    initialize_oam(flipped.ppu);
    set_sprite(flipped.ppu, 0, { y: 0, tile: 2, attributes: 0x40, x: 10 });
    flipped.memory_bus.write_ppu(0x0020, 0x80);
    flipped.memory_bus.write_ppu(0x3f11, 0x16);
    flipped.ppu.write_cpu_register(1, PPU_SPRITE_ENABLE | PPU_SPRITE_LEFT_COLUMN_ENABLE);

    advance_to_position(flipped.ppu, 1, 19);

    assert.equal(flipped.ppu.read_framebuffer_pixel(17, 1).color_index, 0x16);
});

test("clips sprite pixels in the first eight columns unless sprite-left rendering is enabled", () => {
    const clipped = make_ppu_fixture();
    initialize_oam(clipped.ppu);
    set_sprite(clipped.ppu, 0, { y: 0, tile: 2, attributes: 0, x: 0 });
    clipped.memory_bus.write_ppu(0x0020, 0x80);
    clipped.memory_bus.write_ppu(0x3f11, 0x19);
    clipped.ppu.write_cpu_register(1, PPU_SPRITE_ENABLE);
    advance_to_position(clipped.ppu, 1, 2);

    assert.equal(clipped.ppu.read_framebuffer_pixel(0, 1).color_index, 0x00);

    const visible = make_ppu_fixture();
    initialize_oam(visible.ppu);
    set_sprite(visible.ppu, 0, { y: 0, tile: 2, attributes: 0, x: 0 });
    visible.memory_bus.write_ppu(0x0020, 0x80);
    visible.memory_bus.write_ppu(0x3f11, 0x19);
    visible.ppu.write_cpu_register(1, PPU_SPRITE_ENABLE | PPU_SPRITE_LEFT_COLUMN_ENABLE);
    advance_to_position(visible.ppu, 1, 2);

    assert.equal(visible.ppu.read_framebuffer_pixel(0, 1).color_index, 0x19);
});

test("uses the PPUCTRL-selected 8x16 sprite pattern table and tile pair", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    initialize_oam(ppu);
    set_sprite(ppu, 0, { y: 0, tile: 3, attributes: 0, x: 0 });
    memory_bus.write_ppu(0x1020, 0x80);
    memory_bus.write_ppu(0x3f11, 0x19);
    ppu.write_cpu_register(0, 0x20);
    ppu.write_cpu_register(1, PPU_SPRITE_ENABLE | PPU_SPRITE_LEFT_COLUMN_ENABLE);

    advance_to_position(ppu, 1, 2);

    assert.equal(ppu.read_framebuffer_pixel(0, 1).color_index, 0x19);
});

test("applies sprite priority, background overlap, and sprite-zero hit limits", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    initialize_oam(ppu);
    set_sprite(ppu, 0, { y: 0, tile: 2, attributes: 0x20, x: 10 });
    memory_bus.write_ppu(0x2000, 1);
    memory_bus.write_ppu(0x0010, 0xff);
    memory_bus.write_ppu(0x0001, 0xff);
    memory_bus.write_ppu(0x0020, 0x80);
    memory_bus.write_ppu(0x3f01, 0x21);
    memory_bus.write_ppu(0x3f11, 0x16);
    ppu.write_cpu_register(
        1,
        PPU_BACKGROUND_ENABLE |
            PPU_SPRITE_ENABLE |
            PPU_BACKGROUND_LEFT_COLUMN_ENABLE |
            PPU_SPRITE_LEFT_COLUMN_ENABLE,
    );

    advance_to_position(ppu, 1, 12);

    assert.equal(ppu.read_framebuffer_pixel(10, 1).color_index, 0x21);
    assert.equal(ppu.get_status_register() & PPU_SPRITE_ZERO_HIT, PPU_SPRITE_ZERO_HIT);

    const right_edge = make_ppu_fixture();
    initialize_oam(right_edge.ppu);
    set_sprite(right_edge.ppu, 0, { y: 0, tile: 2, attributes: 0, x: 255 });
    right_edge.memory_bus.write_ppu(0x0020, 0x80);
    right_edge.memory_bus.write_ppu(0x2000, 1);
    right_edge.memory_bus.write_ppu(0x0010, 0xff);
    right_edge.memory_bus.write_ppu(0x0001, 0xff);
    right_edge.ppu.write_cpu_register(
        1,
        PPU_BACKGROUND_ENABLE |
            PPU_SPRITE_ENABLE |
            PPU_BACKGROUND_LEFT_COLUMN_ENABLE |
            PPU_SPRITE_LEFT_COLUMN_ENABLE,
    );

    advance_to_position(right_edge.ppu, 1, 257);

    assert.equal(right_edge.ppu.get_status_register() & PPU_SPRITE_ZERO_HIT, 0);
});

test("selects the lowest OAM index opaque sprite before applying its background priority", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    initialize_oam(ppu);
    set_sprite(ppu, 0, { y: 0, tile: 2, attributes: 0x20, x: 10 });
    set_sprite(ppu, 1, { y: 0, tile: 3, attributes: 0x01, x: 10 });
    memory_bus.write_ppu(0x0020, 0x80);
    memory_bus.write_ppu(0x0030, 0x80);
    memory_bus.write_ppu(0x3f11, 0x16);
    memory_bus.write_ppu(0x3f15, 0x2c);
    ppu.write_cpu_register(1, PPU_SPRITE_ENABLE | PPU_SPRITE_LEFT_COLUMN_ENABLE);

    advance_to_position(ppu, 1, 12);

    assert.equal(ppu.read_framebuffer_pixel(10, 1).color_index, 0x16);
});

test("keeps overflow clear when only eight sprites are in range and trailing OAM bytes miss", () => {
    const { ppu } = make_ppu_fixture();
    fill_oam_bytes(ppu, 0x80);

    for (let sprite_index = 0; sprite_index < 8; sprite_index += 1) {
        set_sprite(ppu, sprite_index, { y: 0, tile: 0x80, attributes: 0x80, x: 0x80 });
    }

    ppu.write_cpu_register(1, PPU_SPRITE_ENABLE);
    advance_to_position(ppu, 0, 256);

    assert.equal(ppu.get_status_register() & PPU_SPRITE_OVERFLOW, 0);
});

test("models diagonal sprite-overflow scanning of non-Y OAM bytes", () => {
    const { ppu } = make_ppu_fixture();
    fill_oam_bytes(ppu, 0x80);

    for (let sprite_index = 0; sprite_index < 8; sprite_index += 1) {
        set_sprite(ppu, sprite_index, { y: 0, tile: 0x80, attributes: 0x80, x: 0x80 });
    }

    // Sprite 9 is out of range, but the diagonal scan later treats sprite 10's tile byte as Y.
    set_sprite(ppu, 9, { y: 0x80, tile: 0, attributes: 0x80, x: 0x80 });
    ppu.write_cpu_register(1, PPU_SPRITE_ENABLE);
    advance_to_position(ppu, 0, 131);

    assert.equal(ppu.get_status_register() & PPU_SPRITE_OVERFLOW, 0);
    ppu.clock_ppu_dot();
    assert.equal(ppu.get_status_register() & PPU_SPRITE_OVERFLOW, 0);
    ppu.clock_ppu_dot();
    assert.equal(ppu.get_status_register() & PPU_SPRITE_OVERFLOW, PPU_SPRITE_OVERFLOW);
});

test("sets sprite overflow when a ninth in-range sprite is found and keeps the first eight", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    initialize_oam(ppu);

    for (let sprite_index = 0; sprite_index < 9; sprite_index += 1) {
        set_sprite(ppu, sprite_index, {
            y: 0,
            tile: 0,
            attributes: 0,
            x: sprite_index * 8,
        });
    }

    memory_bus.write_ppu(0x0000, 0xff);
    memory_bus.write_ppu(0x3f00, 0x0f);
    memory_bus.write_ppu(0x3f11, 0x06);
    ppu.write_cpu_register(1, PPU_SPRITE_ENABLE);

    advance_to_position(ppu, 0, 130);
    assert.equal(ppu.get_status_register() & PPU_SPRITE_OVERFLOW, 0);

    ppu.clock_ppu_dot();
    assert.equal(ppu.get_status_register() & PPU_SPRITE_OVERFLOW, PPU_SPRITE_OVERFLOW);

    advance_to_position(ppu, 1, 73);
    assert.equal(ppu.read_framebuffer_pixel(64, 1).color_index, 0x0f);
});

function make_ppu_fixture(): { readonly ppu: Ppu2C02; readonly memory_bus: PpuMemoryBus } {
    const pattern_memory = new Uint8Array(0x2000);
    const mapper: PpuMapperPort = {
        read_pattern(address: number): number {
            const value = pattern_memory[address];

            if (value === undefined) {
                throw new RangeError(`Pattern-memory address ${address} is invalid.`);
            }

            return value;
        },
        write_pattern(address: number, value: number): void {
            pattern_memory[address] = value;
        },
        observe_ppu_access(_access: MapperPpuBusAccess): void {},
        clock_ppu_dot(): void {},
        get_nametable_mirroring(): MirroringMode {
            return "vertical";
        },
    };
    const memory_bus = new PpuMemoryBus(mapper);

    return { ppu: new Ppu2C02(memory_bus), memory_bus };
}

function fill_oam_bytes(ppu: Ppu2C02, value: number): void {
    ppu.write_cpu_register(3, 0);

    for (let byte_index = 0; byte_index < 64 * 4; byte_index += 1) {
        ppu.write_cpu_register(4, value);
    }
}

function initialize_oam(ppu: Ppu2C02): void {
    ppu.write_cpu_register(3, 0);

    for (let sprite_index = 0; sprite_index < 64; sprite_index += 1) {
        ppu.write_cpu_register(4, 0x80);
        ppu.write_cpu_register(4, 0);
        ppu.write_cpu_register(4, 0);
        ppu.write_cpu_register(4, 0);
    }
}

function set_sprite(
    ppu: Ppu2C02,
    sprite_index: number,
    sprite: { readonly y: number; readonly tile: number; readonly attributes: number; readonly x: number },
): void {
    ppu.write_cpu_register(3, sprite_index * 4);
    ppu.write_cpu_register(4, sprite.y);
    ppu.write_cpu_register(4, sprite.tile);
    ppu.write_cpu_register(4, sprite.attributes);
    ppu.write_cpu_register(4, sprite.x);
}

function advance_to_position(ppu: Ppu2C02, target_scanline: number, target_dot: number): void {
    for (let elapsed_dot = 0; elapsed_dot <= PPU_FRAME_DOTS; elapsed_dot += 1) {
        if (ppu.get_scanline() === target_scanline && ppu.get_dot() === target_dot) {
            return;
        }

        ppu.clock_ppu_dot();
    }

    assert.fail(`Could not reach PPU position (${target_scanline}, ${target_dot}) within one frame.`);
}

function advance_dots(ppu: Ppu2C02, dots: number): void {
    for (let elapsed_dot = 0; elapsed_dot < dots; elapsed_dot += 1) {
        ppu.clock_ppu_dot();
    }
}
