import assert from "node:assert/strict";
import test from "node:test";

import type { MirroringMode } from "../src/nes/cartridge/ines.js";
import type { CpuBusDeviceRead } from "../src/nes/cpu/cpu_bus.js";
import type { MapperPpuBusAccess, PpuMapperPort } from "../src/nes/ppu/ppu_bus.js";
import { PpuMemoryBus } from "../src/nes/ppu/ppu_bus.js";
import { Ppu2C02 } from "../src/nes/ppu/ppu_2c02.js";

const PPU_DOTS_PER_SCANLINE = 341;
const PPU_FRAME_DOTS = PPU_DOTS_PER_SCANLINE * 262;
const PPU_ODD_FRAME_LAST_DOT = 339;

test("uses the PPU I/O latch for write-only registers and PPUSTATUS open-bus bits", () => {
    const ppu = make_ppu();

    ppu.write_cpu_register(0, 0xa5);
    assert.equal(read_register(ppu, 0, 0x19), 0xa5);

    ppu.write_cpu_register(2, 0x3c);
    ppu.set_vblank_flag(true);
    ppu.set_sprite_zero_hit(true);
    ppu.set_sprite_overflow(true);

    assert.equal(read_register(ppu, 2), 0xfc);
    assert.equal(ppu.get_status_register(), 0x60);
    assert.equal(read_register(ppu, 2), 0x7c);

    ppu.write_cpu_register(2, 0xff);
    assert.equal(ppu.get_status_register(), 0x60);
    assert.equal(read_register(ppu, 2), 0x7f);
});

test("updates temporary scroll address and fine X from both PPUSCROLL writes", () => {
    const ppu = make_ppu();

    ppu.write_cpu_register(0, 0x03);
    ppu.write_cpu_register(5, 0xab);
    assert.equal(ppu.get_fine_x_scroll(), 3);
    assert.equal(ppu.get_temporary_vram_address(), 0x0c15);

    ppu.write_cpu_register(5, 0xd6);
    assert.equal(ppu.get_fine_x_scroll(), 3);
    assert.equal(ppu.get_temporary_vram_address(), 0x6f55);
});

test("shares the scroll/address write toggle and PPUSTATUS resets it", () => {
    const ppu = make_ppu();

    ppu.write_cpu_register(5, 0x41);
    ppu.write_cpu_register(6, 0x34);
    assert.equal(ppu.get_vram_address(), 0x0034);

    ppu.write_cpu_register(6, 0x21);
    assert.equal(ppu.get_temporary_vram_address(), 0x2134);
    read_register(ppu, 2);

    ppu.write_cpu_register(6, 0x24);
    assert.equal(ppu.get_temporary_vram_address(), 0x2434);
    assert.equal(ppu.get_vram_address(), 0x0034);
});

test("buffers non-palette PPUDATA reads and increments the VRAM address", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    memory_bus.write_ppu(0x2000, 0x5a);
    memory_bus.write_ppu(0x2001, 0x6b);
    set_vram_address(ppu, 0x2000);

    assert.equal(read_register(ppu, 7), 0x00);
    assert.equal(ppu.get_vram_address(), 0x2001);
    assert.equal(read_register(ppu, 7), 0x5a);
    assert.equal(ppu.get_vram_address(), 0x2002);
    assert.equal(read_register(ppu, 7), 0x6b);
    assert.equal(ppu.get_vram_address(), 0x2003);
});

test("writes PPUDATA, increments by 32 when selected, and retains the 15-bit address", () => {
    const { ppu, memory_bus } = make_ppu_fixture();

    ppu.write_cpu_register(0, 0x04);
    set_vram_address(ppu, 0x2000);
    ppu.write_cpu_register(7, 0x77);
    assert.equal(memory_bus.read_ppu(0x2000), 0x77);
    assert.equal(ppu.get_vram_address(), 0x2020);

    set_vram_address(ppu, 0x2000);
    read_register(ppu, 7);
    assert.equal(ppu.get_vram_address(), 0x2020);

    ppu.write_cpu_register(0, 0x00);
    set_vram_address(ppu, 0x3fff);
    ppu.write_cpu_register(7, 0x3f);
    assert.equal(ppu.get_vram_address(), 0x4000);

    ppu.write_cpu_register(7, 0x65);
    assert.equal(memory_bus.read_ppu(0x0000), 0x65);
    assert.equal(ppu.get_vram_address(), 0x4001);
});

test("reads palette data immediately, applies greyscale/open bus, and refills the buffer", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    memory_bus.write_ppu(0x3f00, 0x2e);
    memory_bus.write_ppu(0x2f00, 0x77);
    set_vram_address(ppu, 0x3f00);
    ppu.write_cpu_register(0, 0xc0);

    assert.equal(read_register(ppu, 7), 0xee);
    assert.equal(ppu.get_vram_address(), 0x3f01);

    set_vram_address(ppu, 0x3f00);
    ppu.write_cpu_register(1, 0x01);
    assert.equal(read_register(ppu, 7), 0x20);

    set_vram_address(ppu, 0x2000);
    assert.equal(read_register(ppu, 7), 0x77);
});

test("routes OAMDATA through primary OAM and increments OAMADDR on writes only", () => {
    const ppu = make_ppu();

    ppu.write_cpu_register(3, 0xfe);
    ppu.write_cpu_register(4, 0x31);
    ppu.write_cpu_register(4, 0x42);
    ppu.write_cpu_register(4, 0x53);

    assert.equal(ppu.get_oam_address(), 0x01);

    ppu.write_cpu_register(3, 0x00);
    assert.equal(read_register(ppu, 4), 0x53);
    assert.equal(ppu.get_oam_address(), 0x00);
});

test("exposes the PPUCTRL/vblank NMI output level", () => {
    const ppu = make_ppu();

    ppu.write_cpu_register(0, 0x80);
    assert.equal(ppu.get_nmi_output(), false);

    ppu.set_vblank_flag(true);
    assert.equal(ppu.get_nmi_output(), true);

    read_register(ppu, 2);
    assert.equal(ppu.get_nmi_output(), false);

    ppu.set_vblank_flag(true);
    ppu.write_cpu_register(0, 0x00);
    assert.equal(ppu.get_nmi_output(), false);
    ppu.write_cpu_register(0, 0x80);
    assert.equal(ppu.get_nmi_output(), true);
});

test("clocks the mapper once per dot and advances three PPU dots per NTSC CPU cycle", () => {
    const { ppu, mapper_dot_count } = make_ppu_fixture();

    assert.equal(ppu.get_scanline(), 261);
    assert.equal(ppu.get_dot(), 0);

    ppu.clock_cpu_cycle();

    assert.equal(ppu.get_scanline(), 261);
    assert.equal(ppu.get_dot(), 3);
    assert.equal(mapper_dot_count.value, 3);

    ppu.clock_ppu_dot();
    assert.equal(ppu.get_dot(), 4);
    assert.equal(mapper_dot_count.value, 4);
});

test("schedules visible, post-render, vblank, and pre-render scanlines", () => {
    const ppu = make_ppu();

    advance_dots(ppu, PPU_DOTS_PER_SCANLINE);
    assert.deepEqual(get_ppu_position(ppu), { scanline: 0, dot: 0 });

    advance_dots(ppu, 240 * PPU_DOTS_PER_SCANLINE);
    assert.deepEqual(get_ppu_position(ppu), { scanline: 240, dot: 0 });

    advance_dots(ppu, PPU_DOTS_PER_SCANLINE);
    assert.deepEqual(get_ppu_position(ppu), { scanline: 241, dot: 0 });
});

test("uses 89342-dot even frames and skips one odd-frame dot only when rendering", () => {
    const rendered_ppu = make_ppu();
    rendered_ppu.write_cpu_register(1, 0x08);

    advance_dots(rendered_ppu, PPU_FRAME_DOTS);
    assert.deepEqual(get_ppu_position(rendered_ppu), { scanline: 261, dot: 0 });
    assert.equal(rendered_ppu.get_frame_number(), 1);
    assert.equal(rendered_ppu.is_odd_frame(), true);

    advance_dots(rendered_ppu, PPU_ODD_FRAME_LAST_DOT);
    assert.deepEqual(get_ppu_position(rendered_ppu), { scanline: 261, dot: 339 });
    rendered_ppu.clock_ppu_dot();
    assert.deepEqual(get_ppu_position(rendered_ppu), { scanline: 0, dot: 0 });

    advance_dots(rendered_ppu, PPU_FRAME_DOTS - PPU_DOTS_PER_SCANLINE);
    assert.deepEqual(get_ppu_position(rendered_ppu), { scanline: 261, dot: 0 });
    assert.equal(rendered_ppu.get_frame_number(), 2);
    assert.equal(rendered_ppu.is_odd_frame(), false);

    const sprite_only_ppu = make_ppu();
    sprite_only_ppu.write_cpu_register(1, 0x10);
    advance_dots(sprite_only_ppu, PPU_FRAME_DOTS);
    advance_dots(sprite_only_ppu, PPU_ODD_FRAME_LAST_DOT);
    assert.deepEqual(get_ppu_position(sprite_only_ppu), { scanline: 261, dot: 339 });
    sprite_only_ppu.clock_ppu_dot();
    assert.deepEqual(get_ppu_position(sprite_only_ppu), { scanline: 0, dot: 0 });

    const blanked_ppu = make_ppu();
    advance_dots(blanked_ppu, PPU_FRAME_DOTS);
    assert.equal(blanked_ppu.is_odd_frame(), true);
    advance_dots(blanked_ppu, PPU_FRAME_DOTS);
    assert.deepEqual(get_ppu_position(blanked_ppu), { scanline: 261, dot: 0 });
    assert.equal(blanked_ppu.get_frame_number(), 2);
});

test("sets vblank at scanline 241 dot 1 and clears status flags at pre-render dot 1", () => {
    const ppu = make_ppu();

    advance_to_position(ppu, 241, 1);
    ppu.set_sprite_zero_hit(true);
    ppu.set_sprite_overflow(true);
    assert.equal(ppu.get_status_register(), 0x60);
    ppu.clock_ppu_dot();
    assert.equal(ppu.get_status_register(), 0xe0);

    advance_to_position(ppu, 261, 1);
    assert.equal(ppu.get_status_register(), 0xe0);
    ppu.clock_ppu_dot();
    assert.equal(ppu.get_status_register(), 0x00);
});

test("suppresses the vblank flag and NMI when PPUSTATUS is read before the vblank event", () => {
    for (const read_dot of [0, 1]) {
        const ppu = make_ppu();
        ppu.write_cpu_register(0, 0x80);
        advance_to_position(ppu, 241, read_dot);

        assert.equal(read_register(ppu, 2) & 0x80, 0);

        if (read_dot === 0) {
            ppu.clock_ppu_dot();
            assert.deepEqual(get_ppu_position(ppu), { scanline: 241, dot: 1 });
        }

        ppu.clock_ppu_dot();
        assert.equal(ppu.get_status_register() & 0x80, 0);
        assert.equal(ppu.get_nmi_output(), false);
        assert.equal(ppu.take_nmi_edge(), false);
    }

    const unsuppressed = make_ppu();
    unsuppressed.write_cpu_register(0, 0x80);
    advance_to_position(unsuppressed, 241, 0);
    unsuppressed.clock_ppu_dot();
    unsuppressed.clock_ppu_dot();

    assert.equal(unsuppressed.get_status_register() & 0x80, 0x80);
    assert.equal(unsuppressed.get_nmi_output(), true);
    assert.equal(unsuppressed.take_nmi_edge(), true);

    const reset_window = make_ppu();
    advance_to_position(reset_window, 241, 0);
    read_register(reset_window, 2);
    reset_window.reset();
    advance_to_position(reset_window, 241, 0);
    reset_window.clock_ppu_dot();
    reset_window.clock_ppu_dot();
    assert.equal(reset_window.get_status_register() & 0x80, 0x80);
});

test("latches NMI edges at vblank and when NMI is enabled during vblank", () => {
    const enabled_before_vblank = make_ppu();
    enabled_before_vblank.write_cpu_register(0, 0x80);
    advance_to_position(enabled_before_vblank, 241, 1);
    assert.equal(enabled_before_vblank.take_nmi_edge(), false);

    enabled_before_vblank.clock_ppu_dot();
    assert.equal(enabled_before_vblank.get_nmi_output(), true);

    read_register(enabled_before_vblank, 2);
    assert.equal(enabled_before_vblank.get_nmi_output(), false);
    assert.equal(enabled_before_vblank.take_nmi_edge(), true);
    assert.equal(enabled_before_vblank.take_nmi_edge(), false);

    const enabled_during_vblank = make_ppu();
    advance_to_position(enabled_during_vblank, 241, 1);
    enabled_during_vblank.clock_ppu_dot();
    assert.equal(enabled_during_vblank.get_nmi_output(), false);
    assert.equal(enabled_during_vblank.take_nmi_edge(), false);

    enabled_during_vblank.write_cpu_register(0, 0x80);
    assert.equal(enabled_during_vblank.get_nmi_output(), true);
    assert.equal(enabled_during_vblank.take_nmi_edge(), true);
});

test("reset clears PPU register/timing output but preserves VRAM and OAM memory", () => {
    const { ppu, memory_bus } = make_ppu_fixture();
    memory_bus.write_ppu(0x2000, 0x5a);
    memory_bus.write_ppu(0x3f00, 0x2a);
    memory_bus.write_oam(7, 0x6b);
    ppu.write_cpu_register(1, 0x20);
    advance_dots(ppu, PPU_DOTS_PER_SCANLINE + 2);
    assert.equal(ppu.read_framebuffer_pixel(0, 0).color_index, 0x2a);
    ppu.write_cpu_register(0, 0x80);
    ppu.set_vblank_flag(true);
    assert.equal(ppu.get_nmi_output(), true);

    ppu.reset();

    assert.equal(ppu.get_control_register(), 0);
    assert.equal(ppu.get_mask_register(), 0);
    assert.equal(ppu.get_status_register(), 0);
    assert.equal(ppu.get_frame_number(), 0);
    assert.deepEqual(get_ppu_position(ppu), { scanline: 261, dot: 0 });
    assert.equal(ppu.get_nmi_output(), false);
    assert.equal(ppu.take_nmi_edge(), false);
    assert.equal(ppu.read_framebuffer_pixel(0, 0).color_index, 0);
    assert.equal(memory_bus.read_ppu(0x2000), 0x5a);
    assert.equal(memory_bus.read_ppu(0x3f00), 0x2a);
    assert.equal(memory_bus.read_oam(7), 0x6b);
});

test("rejects invalid PPU register indices and values", () => {
    const ppu = make_ppu();

    assert.throws(() => ppu.read_cpu_register(-1, 0), RangeError);
    assert.throws(() => ppu.read_cpu_register(8, 0), RangeError);
    assert.throws(() => ppu.write_cpu_register(1, 0x100), RangeError);
});

interface PpuFixture {
    readonly ppu: Ppu2C02;
    readonly memory_bus: PpuMemoryBus;
    readonly mapper_dot_count: { value: number };
}

function make_ppu(): Ppu2C02 {
    return make_ppu_fixture().ppu;
}

function make_ppu_fixture(): PpuFixture {
    const pattern_memory = new Uint8Array(0x2000);
    const mapper_dot_count = { value: 0 };
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
        clock_ppu_dot(): void {
            mapper_dot_count.value += 1;
        },
        get_nametable_mirroring(): MirroringMode {
            return "vertical";
        },
    };
    const memory_bus = new PpuMemoryBus(mapper);

    return { ppu: new Ppu2C02(memory_bus), memory_bus, mapper_dot_count };
}

function read_register(ppu: Ppu2C02, register_index: number, open_bus = 0): number {
    const result: CpuBusDeviceRead = ppu.read_cpu_register(register_index, open_bus);

    assert.ok(result !== null);

    return result.value;
}

function set_vram_address(ppu: Ppu2C02, address: number): void {
    ppu.write_cpu_register(6, address >>> 8);
    ppu.write_cpu_register(6, address & 0xff);
}

function advance_dots(ppu: Ppu2C02, dots: number): void {
    for (let elapsed_dot = 0; elapsed_dot < dots; elapsed_dot += 1) {
        ppu.clock_ppu_dot();
    }
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

function get_ppu_position(ppu: Ppu2C02): { readonly scanline: number; readonly dot: number } {
    return { scanline: ppu.get_scanline(), dot: ppu.get_dot() };
}
