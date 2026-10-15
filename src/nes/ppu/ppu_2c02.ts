import type { PpuCpuRegisterPort } from "../cpu/nes_cpu_bus.js";
import type { CpuBusDeviceRead } from "../cpu/cpu_bus.js";
import type { PpuFramebufferPixel } from "./framebuffer.js";
import { PpuFramebuffer, PPU_FRAME_HEIGHT, PPU_FRAME_WIDTH } from "./framebuffer.js";
import { PpuMemoryBus } from "./ppu_bus.js";

const PPU_REGISTER_COUNT = 8;
const PPU_REGISTER_INDEX_MAX = PPU_REGISTER_COUNT - 1;
const PPU_DOTS_PER_SCANLINE = 341;
const PPU_LAST_DOT = PPU_DOTS_PER_SCANLINE - 1;
const PPU_DOTS_PER_CPU_CYCLE = 3;
const PPU_LAST_SCANLINE = 261;
const PPU_PRE_RENDER_SCANLINE = 261;
const PPU_LAST_SCANLINE_BEFORE_PRE_RENDER = 260;
const PPU_VBLANK_FIRST_SCANLINE = 241;
const PPU_VBLANK_START_DOT = 1;
const PPU_PRE_RENDER_STATUS_CLEAR_DOT = 1;
const PPU_ODD_FRAME_LAST_DOT = 339;
const PPU_RENDERING_MASK = 0x18;
const PPU_BACKGROUND_ENABLE = 0x08;
const PPU_SPRITE_ENABLE = 0x10;
const PPU_BACKGROUND_LEFT_COLUMN_ENABLE = 0x02;
const PPU_SPRITE_LEFT_COLUMN_ENABLE = 0x04;
const PPU_BACKGROUND_PATTERN_TABLE_SELECT = 0x10;
const PPU_SPRITE_PATTERN_TABLE_SELECT = 0x08;
const PPU_SPRITE_SIZE_SELECT = 0x20;
const PPU_SPRITE_COUNT = 64;
const PPU_SECONDARY_SPRITE_LIMIT = 8;
const PPU_BYTES_PER_SPRITE = 4;
const PPU_PATTERN_BYTES_PER_TILE = 16;
const PPU_PATTERN_HIGH_PLANE_OFFSET = 8;
const PPU_BACKGROUND_NAMETABLE_START = 0x2000;
const PPU_BACKGROUND_ATTRIBUTE_START = 0x23c0;
const PPU_BACKGROUND_FINE_X_MASK = 0x8000;
const PPU_BACKGROUND_LOAD_MASK = 0xff00;
const PPU_PATTERN_SHIFT_MASK = 0xffff;
const PPU_SPRITE_PIXEL_MASK = 0x80;
const PPU_BACKGROUND_DUMMY_FETCH_DOT_ONE = 338;
const PPU_BACKGROUND_DUMMY_FETCH_DOT_TWO = 340;
const PPU_SPRITE_FETCH_START_DOT = 257;
const PPU_SPRITE_FETCH_END_DOT = 320;
const PPU_SPRITE_FETCH_DOTS_PER_SLOT = 8;
const PPU_SPRITE_FETCH_COUNT = 8;
const PPU_SPRITE_FETCH_ATTRIBUTE_PHASE = 2;
const PPU_SPRITE_FETCH_X_PHASE = 3;
const PPU_SPRITE_FETCH_PATTERN_LOW_PHASE = 5;
const PPU_SPRITE_FETCH_PATTERN_HIGH_PHASE = 7;
const PPU_SPRITE_GARBAGE_FETCH_PHASE_ONE = 1;
const PPU_SPRITE_GARBAGE_FETCH_PHASE_TWO = 3;
const PPU_COLOR_GREYSCALE_MASK = 0x30;
const PPU_COLOR_INDEX_MASK = 0x3f;
const FULL_BYTE_MASK = 0xff;
const PPU_STATUS_FLAGS_MASK = 0xe0;
const PPU_VBLANK_FLAG = 0x80;
const PPU_CONTROL_NMI_ENABLE = 0x80;
const PPU_SPRITE_ZERO_HIT_FLAG = 0x40;
const PPU_SPRITE_OVERFLOW_FLAG = 0x20;
const PPU_STATUS_READ_LATCH_MASK = 0x1f;
const PPU_PALETTE_ADDRESS_START = 0x3f00;
const PPU_ADDRESS_MASK = 0x3fff;
const PPU_VRAM_ADDRESS_MASK = 0x7fff;
const PPU_CONTROL_NAMETABLE_MASK = 0x03;
const PPU_CONTROL_VRAM_INCREMENT = 0x04;
const PPU_MASK_GREYSCALE = 0x01;
const PPU_PALETTE_GREYSCALE_MASK = 0x30;
const PPU_SCROLL_FINE_X_MASK = 0x07;
const PPU_SCROLL_COARSE_X_MASK = 0x1f;
const PPU_SCROLL_SECOND_WRITE_PRESERVE_MASK = 0x0c1f;
const PPU_ADDRESS_HIGH_MASK = 0x3f;
const PPU_ADDRESS_HIGH_PRESERVE_MASK = 0x00ff;
const PPU_ADDRESS_LOW_PRESERVE_MASK = 0x7f00;
const PPU_PALETTE_VALUE_MASK = 0x3f;
const PPU_PALETTE_OPEN_BUS_MASK = 0xc0;
const PPU_PALETTE_BUFFER_ADDRESS_OFFSET = 0x1000;
const PPU_OAM_ADDRESS_MASK = 0xff;

interface SpriteCandidate {
    readonly y: number;
    readonly tile: number;
    readonly attributes: number;
    readonly x: number;
    readonly oam_index: number;
    readonly row: number;
}

interface SpriteOutputUnit {
    x_counter: number;
    pattern_low_shift: number;
    pattern_high_shift: number;
    attributes: number;
    oam_index: number;
}

interface SpritePixel {
    readonly pixel: number;
    readonly attributes: number;
    readonly oam_index: number;
}

/** PPU CPU-register behavior, deterministic NTSC timing, and a color-index rendering pipeline. */
export class Ppu2C02 implements PpuCpuRegisterPort {
    readonly #memory_bus: PpuMemoryBus;

    #control_register = 0;
    #mask_register = 0;
    #status_register = 0;
    #oam_address = 0;
    #vram_address = 0;
    #temporary_vram_address = 0;
    #fine_x_scroll = 0;
    #write_toggle = false;
    #read_buffer = 0;
    #ppu_io_latch = 0;
    #suppress_vblank_start = false;
    #scanline = PPU_PRE_RENDER_SCANLINE;
    #dot = 0;
    #frame_number = 0;
    #odd_frame = false;
    #nmi_output = false;
    #nmi_edge_pending = false;
    #background_pattern_low_shift = 0;
    #background_pattern_high_shift = 0;
    #background_attribute_low_shift = 0;
    #background_attribute_high_shift = 0;
    #next_background_tile = 0;
    #next_background_attribute = 0;
    #next_background_pattern_low = 0;
    #next_background_pattern_high = 0;
    #secondary_sprites: SpriteCandidate[] = [];
    #line_zero_sprites: SpriteCandidate[] = [];
    #sprite_overflow_set_dot: number | undefined = undefined;
    #sprite_output_units = create_empty_sprite_units();
    readonly #framebuffer = new PpuFramebuffer();

    /** Connects the CPU register device to the shared PPU memory/OAM bus. */
    constructor(memory_bus: PpuMemoryBus) {
        this.#memory_bus = memory_bus;
    }

    /** Resets PPU registers, timing, and pipeline state without erasing VRAM, OAM, or cartridge RAM. */
    reset(): void {
        this.#control_register = 0;
        this.#mask_register = 0;
        this.#status_register = 0;
        this.#oam_address = 0;
        this.#vram_address = 0;
        this.#temporary_vram_address = 0;
        this.#fine_x_scroll = 0;
        this.#write_toggle = false;
        this.#read_buffer = 0;
        this.#ppu_io_latch = 0;
        this.#suppress_vblank_start = false;
        this.#scanline = PPU_PRE_RENDER_SCANLINE;
        this.#dot = 0;
        this.#frame_number = 0;
        this.#odd_frame = false;
        this.#nmi_output = false;
        this.#nmi_edge_pending = false;
        this.#background_pattern_low_shift = 0;
        this.#background_pattern_high_shift = 0;
        this.#background_attribute_low_shift = 0;
        this.#background_attribute_high_shift = 0;
        this.#next_background_tile = 0;
        this.#next_background_attribute = 0;
        this.#next_background_pattern_low = 0;
        this.#next_background_pattern_high = 0;
        this.#secondary_sprites = [];
        this.#line_zero_sprites = [];
        this.#sprite_overflow_set_dot = undefined;
        this.#sprite_output_units = create_empty_sprite_units();
        this.#framebuffer.clear();
    }

    /** Reads a CPU-visible PPU register. Write-only registers return the PPU's internal I/O latch. */
    read_cpu_register(register_index: number, _cpu_open_bus: number): CpuBusDeviceRead {
        assert_register_index(register_index);

        let value: number;

        switch (register_index) {
            case 2:
                value = this.#read_status_register();
                break;
            case 4:
                value = this.#memory_bus.read_oam(this.#oam_address);
                this.#ppu_io_latch = value;
                break;
            case 7:
                value = this.#read_data_register();
                break;
            default:
                value = this.#ppu_io_latch;
                break;
        }

        return { value, driven_mask: FULL_BYTE_MASK };
    }

    /** Writes one CPU-visible PPU register and refreshes the PPU's internal I/O latch. */
    write_cpu_register(register_index: number, value: number): void {
        assert_register_index(register_index);
        assert_byte_value(value);
        this.#ppu_io_latch = value;

        switch (register_index) {
            case 0:
                this.#write_control_register(value);
                break;
            case 1:
                this.#mask_register = value;
                break;
            case 2:
                // PPUSTATUS ignores writes, but every CPU write still refreshes the PPU I/O latch.
                break;
            case 3:
                this.#oam_address = value;
                break;
            case 4:
                this.#memory_bus.write_oam(this.#oam_address, value);
                this.#oam_address = (this.#oam_address + 1) & PPU_OAM_ADDRESS_MASK;
                break;
            case 5:
                this.#write_scroll_register(value);
                break;
            case 6:
                this.#write_address_register(value);
                break;
            case 7:
                this.#memory_bus.write_ppu(this.#vram_address & PPU_ADDRESS_MASK, value);
                this.#increment_vram_address();
                break;
        }
    }

    /**
     * Clocks the current PPU scanline/dot, forwards one mapper tick, applies timing flags, then advances.
     * Position getters report the next dot to be clocked.
     */
    clock_ppu_dot(): void {
        this.#memory_bus.clock_ppu_dot();

        if (this.#scanline === PPU_VBLANK_FIRST_SCANLINE && this.#dot === PPU_VBLANK_START_DOT) {
            if (this.#suppress_vblank_start) {
                this.#suppress_vblank_start = false;
            } else {
                this.set_vblank_flag(true);
            }
        }

        if (this.#scanline === PPU_PRE_RENDER_SCANLINE && this.#dot === PPU_PRE_RENDER_STATUS_CLEAR_DOT) {
            this.set_vblank_flag(false);
            this.set_sprite_zero_hit(false);
            this.set_sprite_overflow(false);
        }

        this.#render_pixel();
        this.#clock_rendering_pipeline();
        this.#advance_dot();
    }

    /** Advances three NTSC PPU dots for one caller-scheduled CPU cycle; it does not execute the CPU. */
    clock_cpu_cycle(): void {
        for (let dot = 0; dot < PPU_DOTS_PER_CPU_CYCLE; dot += 1) {
            this.clock_ppu_dot();
        }
    }

    /** Returns the next scanline to be clocked, using scanlines 0 through 261. */
    get_scanline(): number {
        return this.#scanline;
    }

    /** Returns the next dot to be clocked, using dots 0 through 340 when not skipped. */
    get_dot(): number {
        return this.#dot;
    }

    /** Returns the current frame index, starting with the initial even pre-render frame at zero. */
    get_frame_number(): number {
        return this.#frame_number;
    }

    /** Returns whether the current pre-render/visible frame has odd parity. */
    is_odd_frame(): boolean {
        return this.#odd_frame;
    }

    /** Returns the fixed framebuffer width in pixels. */
    get_framebuffer_width(): number {
        return PPU_FRAME_WIDTH;
    }

    /** Returns the fixed framebuffer height in pixels. */
    get_framebuffer_height(): number {
        return PPU_FRAME_HEIGHT;
    }

    /** Returns a copy of the row-major six-bit palette-index framebuffer. */
    get_framebuffer(): Uint8Array {
        return this.#framebuffer.get_color_indices();
    }

    /** Returns a copy of the row-major PPUMASK emphasis-bit framebuffer. */
    get_framebuffer_emphasis(): Uint8Array {
        return this.#framebuffer.get_emphasis_values();
    }

    /** Reads one rendered pixel as a palette index plus its three emphasis bits. */
    read_framebuffer_pixel(x: number, y: number): PpuFramebufferPixel {
        return this.#framebuffer.read_pixel(x, y);
    }

    /** Consumes one latched NMI rising edge, including an edge caused by enabling NMI during vblank. */
    take_nmi_edge(): boolean {
        const edge_pending = this.#nmi_edge_pending;
        this.#nmi_edge_pending = false;

        return edge_pending;
    }

    /** Sets or clears the vblank status bit; the PPU timing unit will drive this event. */
    set_vblank_flag(active: boolean): void {
        this.#set_status_flag(PPU_VBLANK_FLAG, active);
        this.#refresh_nmi_output();
    }

    /** Sets or clears the sprite-zero-hit status bit. */
    set_sprite_zero_hit(active: boolean): void {
        this.#set_status_flag(PPU_SPRITE_ZERO_HIT_FLAG, active);
    }

    /** Sets or clears the sprite-overflow status bit. */
    set_sprite_overflow(active: boolean): void {
        this.#set_status_flag(PPU_SPRITE_OVERFLOW_FLAG, active);
    }

    /** Returns the stored PPUCTRL value. */
    get_control_register(): number {
        return this.#control_register;
    }

    /** Returns the stored PPUMASK value. */
    get_mask_register(): number {
        return this.#mask_register;
    }

    /** Returns the three PPUSTATUS flags, without the lower open-bus bits. */
    get_status_register(): number {
        return this.#status_register & PPU_STATUS_FLAGS_MASK;
    }

    /** Returns the 15-bit current VRAM address used by PPUDATA and rendering. */
    get_vram_address(): number {
        return this.#vram_address;
    }

    /** Returns the 15-bit temporary VRAM address used by scroll/address writes. */
    get_temporary_vram_address(): number {
        return this.#temporary_vram_address;
    }

    /** Returns the three fine-X scroll bits used with the current VRAM address. */
    get_fine_x_scroll(): number {
        return this.#fine_x_scroll;
    }

    /** Returns the next OAM byte address used by OAMDATA. */
    get_oam_address(): number {
        return this.#oam_address;
    }

    /** Returns the PPU's level-sensitive NMI output; consume its rising edge with take_nmi_edge(). */
    get_nmi_output(): boolean {
        return this.#nmi_output;
    }

    #read_status_register(): number {
        // A read before the dot-1 vblank event can suppress the flag and its NMI edge.
        if (
            this.#scanline === PPU_VBLANK_FIRST_SCANLINE &&
            this.#dot <= PPU_VBLANK_START_DOT
        ) {
            this.#suppress_vblank_start = true;
        }

        const value =
            (this.#status_register & PPU_STATUS_FLAGS_MASK) |
            (this.#ppu_io_latch & PPU_STATUS_READ_LATCH_MASK);

        this.#status_register &= ~PPU_VBLANK_FLAG;
        this.#write_toggle = false;
        this.#ppu_io_latch = value;
        this.#refresh_nmi_output();

        return value;
    }

    #read_data_register(): number {
        const address = this.#vram_address & PPU_ADDRESS_MASK;
        let value: number;

        if (address >= PPU_PALETTE_ADDRESS_START) {
            const palette_value = this.#memory_bus.read_ppu(address);
            const greyscale_palette_value =
                (this.#mask_register & PPU_MASK_GREYSCALE) === 0
                    ? palette_value
                    : palette_value & PPU_PALETTE_GREYSCALE_MASK;
            value =
                (greyscale_palette_value & PPU_PALETTE_VALUE_MASK) |
                (this.#ppu_io_latch & PPU_PALETTE_OPEN_BUS_MASK);
            const buffer_address = (address - PPU_PALETTE_BUFFER_ADDRESS_OFFSET) & PPU_ADDRESS_MASK;
            this.#read_buffer = this.#memory_bus.read_ppu(buffer_address);
        } else {
            value = this.#read_buffer;
            this.#read_buffer = this.#memory_bus.read_ppu(address);
        }

        this.#increment_vram_address();
        this.#ppu_io_latch = value;

        return value;
    }

    #write_control_register(value: number): void {
        this.#control_register = value;
        this.#temporary_vram_address =
            (this.#temporary_vram_address & 0x73ff) |
            ((value & PPU_CONTROL_NAMETABLE_MASK) << 10);
        this.#refresh_nmi_output();
    }

    #write_scroll_register(value: number): void {
        if (!this.#write_toggle) {
            this.#fine_x_scroll = value & PPU_SCROLL_FINE_X_MASK;
            this.#temporary_vram_address =
                (this.#temporary_vram_address & ~PPU_SCROLL_COARSE_X_MASK) |
                ((value >>> 3) & PPU_SCROLL_COARSE_X_MASK);
            this.#write_toggle = true;
            return;
        }

        const fine_y = (value & PPU_SCROLL_FINE_X_MASK) << 12;
        const coarse_y = (value & 0xf8) << 2;
        this.#temporary_vram_address =
            (this.#temporary_vram_address & PPU_SCROLL_SECOND_WRITE_PRESERVE_MASK) | fine_y | coarse_y;
        this.#write_toggle = false;
    }

    #write_address_register(value: number): void {
        if (!this.#write_toggle) {
            const address_high = (value & PPU_ADDRESS_HIGH_MASK) << 8;
            this.#temporary_vram_address =
                (this.#temporary_vram_address & PPU_ADDRESS_HIGH_PRESERVE_MASK) | address_high;
            this.#write_toggle = true;
            return;
        }

        this.#temporary_vram_address =
            (this.#temporary_vram_address & PPU_ADDRESS_LOW_PRESERVE_MASK) | value;
        this.#vram_address = this.#temporary_vram_address;
        this.#write_toggle = false;
        this.#memory_bus.observe_ppu_address(this.#vram_address & PPU_ADDRESS_MASK);
    }

    #increment_vram_address(): void {
        const increment = (this.#control_register & PPU_CONTROL_VRAM_INCREMENT) === 0 ? 1 : 32;
        this.#vram_address = (this.#vram_address + increment) & PPU_VRAM_ADDRESS_MASK;
        this.#memory_bus.observe_ppu_address(this.#vram_address & PPU_ADDRESS_MASK);
    }

    #render_pixel(): void {
        if (this.#scanline >= PPU_FRAME_HEIGHT || this.#dot < 1 || this.#dot > PPU_FRAME_WIDTH) {
            return;
        }

        const x = this.#dot - 1;
        const background_visible =
            (this.#mask_register & PPU_BACKGROUND_ENABLE) !== 0 &&
            (x >= 8 || (this.#mask_register & PPU_BACKGROUND_LEFT_COLUMN_ENABLE) !== 0);
        const sprite_visible =
            (this.#mask_register & PPU_SPRITE_ENABLE) !== 0 &&
            (x >= 8 || (this.#mask_register & PPU_SPRITE_LEFT_COLUMN_ENABLE) !== 0);
        const background_pixel = background_visible ? this.#read_background_pixel() : 0;
        const background_palette = background_visible ? this.#read_background_palette() : 0;
        const sprite_pixel = sprite_visible ? this.#read_sprite_pixel() : undefined;

        if (
            sprite_pixel?.oam_index === 0 &&
            background_pixel !== 0 &&
            x < PPU_FRAME_WIDTH - 1
        ) {
            this.set_sprite_zero_hit(true);
        }

        let palette_address = PPU_PALETTE_ADDRESS_START;

        if (sprite_pixel !== undefined && (background_pixel === 0 || (sprite_pixel.attributes & 0x20) === 0)) {
            palette_address += 0x10 + ((sprite_pixel.attributes & 0x03) << 2) + sprite_pixel.pixel;
        } else if (background_pixel !== 0) {
            palette_address += (background_palette << 2) + background_pixel;
        }

        let color_index = this.#memory_bus.read_ppu(palette_address) & PPU_COLOR_INDEX_MASK;

        if ((this.#mask_register & PPU_MASK_GREYSCALE) !== 0) {
            color_index &= PPU_COLOR_GREYSCALE_MASK;
        }

        const emphasis = (this.#mask_register >>> 5) & 0x07;
        this.#framebuffer.set_pixel(x, this.#scanline, color_index, emphasis);

        if (this.#is_rendering_enabled()) {
            this.#clock_sprite_output_units();
        }
    }

    #clock_rendering_pipeline(): void {
        const visible_or_pre_render_scanline =
            this.#scanline < PPU_FRAME_HEIGHT || this.#scanline === PPU_PRE_RENDER_SCANLINE;

        if (!visible_or_pre_render_scanline || !this.#is_rendering_enabled()) {
            return;
        }

        if (this.#scanline < PPU_FRAME_HEIGHT && this.#dot === 65) {
            this.#evaluate_sprites_for_next_scanline();
        }

        if (this.#dot === this.#sprite_overflow_set_dot) {
            this.set_sprite_overflow(true);
        }

        const background_fetch_dot =
            (this.#dot >= 1 && this.#dot <= 256) ||
            (this.#dot >= 321 && this.#dot <= 336);

        if (background_fetch_dot) {
            this.#shift_background_registers();

            switch (this.#dot & 0x07) {
                case 0:
                    this.#fetch_background_pattern_high();
                    this.#load_background_registers();
                    this.#increment_scroll_x();
                    break;
                case 2:
                    this.#next_background_tile = this.#memory_bus.read_ppu(
                        PPU_BACKGROUND_NAMETABLE_START | (this.#vram_address & 0x0fff),
                    );
                    break;
                case 4:
                    this.#fetch_background_attribute();
                    break;
                case 6:
                    this.#fetch_background_pattern_low();
                    break;
            }
        }

        if (this.#dot === 256) {
            this.#increment_scroll_y();
        }

        if (this.#dot === 257) {
            this.#transfer_horizontal_scroll();
        }

        if (
            this.#scanline === PPU_PRE_RENDER_SCANLINE &&
            this.#dot >= 280 &&
            this.#dot <= 304
        ) {
            this.#transfer_vertical_scroll();
        }

        if (
            this.#dot === PPU_BACKGROUND_DUMMY_FETCH_DOT_ONE ||
            this.#dot === PPU_BACKGROUND_DUMMY_FETCH_DOT_TWO
        ) {
            this.#memory_bus.read_ppu(PPU_BACKGROUND_NAMETABLE_START | (this.#vram_address & 0x0fff));
        }

        if (this.#dot >= PPU_SPRITE_FETCH_START_DOT && this.#dot <= PPU_SPRITE_FETCH_END_DOT) {
            this.#clock_sprite_fetch();
        }
    }

    #is_rendering_enabled(): boolean {
        return (this.#mask_register & PPU_RENDERING_MASK) !== 0;
    }

    #read_background_pixel(): number {
        const bit_mask = PPU_BACKGROUND_FINE_X_MASK >>> this.#fine_x_scroll;
        const low_bit = (this.#background_pattern_low_shift & bit_mask) === 0 ? 0 : 1;
        const high_bit = (this.#background_pattern_high_shift & bit_mask) === 0 ? 0 : 2;

        return low_bit | high_bit;
    }

    #read_background_palette(): number {
        const bit_mask = PPU_BACKGROUND_FINE_X_MASK >>> this.#fine_x_scroll;
        const low_bit = (this.#background_attribute_low_shift & bit_mask) === 0 ? 0 : 1;
        const high_bit = (this.#background_attribute_high_shift & bit_mask) === 0 ? 0 : 2;

        return low_bit | high_bit;
    }

    #shift_background_registers(): void {
        this.#background_pattern_low_shift =
            (this.#background_pattern_low_shift << 1) & PPU_PATTERN_SHIFT_MASK;
        this.#background_pattern_high_shift =
            (this.#background_pattern_high_shift << 1) & PPU_PATTERN_SHIFT_MASK;
        this.#background_attribute_low_shift =
            (this.#background_attribute_low_shift << 1) & PPU_PATTERN_SHIFT_MASK;
        this.#background_attribute_high_shift =
            (this.#background_attribute_high_shift << 1) & PPU_PATTERN_SHIFT_MASK;
    }

    #load_background_registers(): void {
        this.#background_pattern_low_shift =
            (this.#background_pattern_low_shift & PPU_BACKGROUND_LOAD_MASK) |
            this.#next_background_pattern_low;
        this.#background_pattern_high_shift =
            (this.#background_pattern_high_shift & PPU_BACKGROUND_LOAD_MASK) |
            this.#next_background_pattern_high;
        this.#background_attribute_low_shift =
            (this.#background_attribute_low_shift & PPU_BACKGROUND_LOAD_MASK) |
            ((this.#next_background_attribute & 0x01) !== 0 ? FULL_BYTE_MASK : 0);
        this.#background_attribute_high_shift =
            (this.#background_attribute_high_shift & PPU_BACKGROUND_LOAD_MASK) |
            ((this.#next_background_attribute & 0x02) !== 0 ? FULL_BYTE_MASK : 0);
    }

    #fetch_background_attribute(): void {
        const address =
            PPU_BACKGROUND_ATTRIBUTE_START |
            (this.#vram_address & 0x0c00) |
            ((this.#vram_address >>> 4) & 0x38) |
            ((this.#vram_address >>> 2) & 0x07);
        const attribute_byte = this.#memory_bus.read_ppu(address);
        const attribute_shift = ((this.#vram_address >>> 4) & 0x04) | (this.#vram_address & 0x02);

        this.#next_background_attribute = (attribute_byte >>> attribute_shift) & 0x03;
    }

    #fetch_background_pattern_low(): void {
        const pattern_table =
            (this.#control_register & PPU_BACKGROUND_PATTERN_TABLE_SELECT) === 0 ? 0 : 0x1000;
        const fine_y = (this.#vram_address >>> 12) & 0x07;
        const address = pattern_table + this.#next_background_tile * PPU_PATTERN_BYTES_PER_TILE + fine_y;

        this.#next_background_pattern_low = this.#memory_bus.read_ppu(address);
    }

    #fetch_background_pattern_high(): void {
        const pattern_table =
            (this.#control_register & PPU_BACKGROUND_PATTERN_TABLE_SELECT) === 0 ? 0 : 0x1000;
        const fine_y = (this.#vram_address >>> 12) & 0x07;
        const address =
            pattern_table +
            this.#next_background_tile * PPU_PATTERN_BYTES_PER_TILE +
            fine_y +
            PPU_PATTERN_HIGH_PLANE_OFFSET;

        this.#next_background_pattern_high = this.#memory_bus.read_ppu(address);
    }

    #increment_scroll_x(): void {
        if ((this.#vram_address & PPU_SCROLL_COARSE_X_MASK) === PPU_SCROLL_COARSE_X_MASK) {
            this.#vram_address &= ~PPU_SCROLL_COARSE_X_MASK;
            this.#vram_address ^= 0x0400;
        } else {
            this.#vram_address += 1;
        }

        this.#vram_address &= PPU_VRAM_ADDRESS_MASK;
    }

    #increment_scroll_y(): void {
        if ((this.#vram_address & 0x7000) !== 0x7000) {
            this.#vram_address += 0x1000;
            return;
        }

        this.#vram_address &= ~0x7000;
        let coarse_y = (this.#vram_address & 0x03e0) >>> 5;

        if (coarse_y === 29) {
            coarse_y = 0;
            this.#vram_address ^= 0x0800;
        } else if (coarse_y === 31) {
            coarse_y = 0;
        } else {
            coarse_y += 1;
        }

        this.#vram_address = (this.#vram_address & ~0x03e0) | (coarse_y << 5);
        this.#vram_address &= PPU_VRAM_ADDRESS_MASK;
    }

    #transfer_horizontal_scroll(): void {
        this.#vram_address =
            (this.#vram_address & ~0x041f) | (this.#temporary_vram_address & 0x041f);
    }

    #transfer_vertical_scroll(): void {
        this.#vram_address =
            (this.#vram_address & ~0x7be0) | (this.#temporary_vram_address & 0x7be0);
    }

    #evaluate_sprites_for_next_scanline(): void {
        const target_scanline = this.#scanline === PPU_FRAME_HEIGHT - 1 ? 0 : this.#scanline + 1;
        const sprite_height = (this.#control_register & PPU_SPRITE_SIZE_SELECT) === 0 ? 8 : 16;
        const sprites: SpriteCandidate[] = [];
        let elapsed_evaluation_dots = 0;
        let overflow_byte_offset = 0;
        this.#sprite_overflow_set_dot = undefined;

        for (let oam_index = 0; oam_index < PPU_SPRITE_COUNT; oam_index += 1) {
            const checking_overflow = sprites.length === PPU_SECONDARY_SPRITE_LIMIT;
            const oam_address =
                oam_index * PPU_BYTES_PER_SPRITE + (checking_overflow ? overflow_byte_offset : 0);
            const y = this.#memory_bus.read_oam(oam_address);
            const row = get_sprite_row(target_scanline, y);

            if (checking_overflow) {
                if (row < sprite_height) {
                    const overflow_dot = 65 + elapsed_evaluation_dots + 1;

                    if (overflow_dot <= 256) {
                        this.#sprite_overflow_set_dot = overflow_dot;
                    }

                    break;
                }

                // The 2C02 diagonal overflow bug advances the byte offset when a value is out of range.
                overflow_byte_offset = (overflow_byte_offset + 1) % PPU_BYTES_PER_SPRITE;
                elapsed_evaluation_dots += 2;
                continue;
            }

            if (row >= sprite_height) {
                elapsed_evaluation_dots += 2;
                continue;
            }

            const tile = this.#memory_bus.read_oam(oam_address + 1);
            const attributes = this.#memory_bus.read_oam(oam_address + 2);
            const x = this.#memory_bus.read_oam(oam_address + 3);

            sprites.push({ y, tile, attributes, x, oam_index, row });
            elapsed_evaluation_dots += 8;
        }

        this.#secondary_sprites = sprites;

        if (target_scanline === 0) {
            this.#line_zero_sprites = sprites.slice();
        }
    }

    #clock_sprite_fetch(): void {
        const elapsed_dots = this.#dot - PPU_SPRITE_FETCH_START_DOT;
        const sprite_slot = Math.floor(elapsed_dots / PPU_SPRITE_FETCH_DOTS_PER_SLOT);
        const fetch_phase = elapsed_dots % PPU_SPRITE_FETCH_DOTS_PER_SLOT;
        const candidates =
            this.#scanline === PPU_PRE_RENDER_SCANLINE ? this.#line_zero_sprites : this.#secondary_sprites;
        const sprite = candidates[sprite_slot];
        const unit = this.#sprite_output_units[sprite_slot];

        if (sprite_slot >= PPU_SPRITE_FETCH_COUNT || unit === undefined) {
            return;
        }

        if (
            fetch_phase === PPU_SPRITE_GARBAGE_FETCH_PHASE_ONE ||
            fetch_phase === PPU_SPRITE_GARBAGE_FETCH_PHASE_TWO
        ) {
            this.#memory_bus.read_ppu(PPU_BACKGROUND_NAMETABLE_START | (this.#vram_address & 0x0fff));
        }

        if (fetch_phase === 0) {
            unit.pattern_low_shift = 0;
            unit.pattern_high_shift = 0;
            unit.attributes = 0;
            unit.x_counter = 0xff;
            unit.oam_index = -1;
        }

        if (sprite !== undefined && fetch_phase === PPU_SPRITE_FETCH_ATTRIBUTE_PHASE) {
            unit.attributes = sprite.attributes;
            unit.oam_index = sprite.oam_index;
        }

        if (sprite !== undefined && fetch_phase === PPU_SPRITE_FETCH_X_PHASE) {
            unit.x_counter = sprite.x;
        }

        if (fetch_phase === PPU_SPRITE_FETCH_PATTERN_LOW_PHASE) {
            const pattern_address = this.#get_sprite_pattern_address(sprite);
            const pattern_low = this.#memory_bus.read_ppu(pattern_address);

            if (sprite !== undefined) {
                unit.pattern_low_shift =
                    (sprite.attributes & 0x40) === 0 ? pattern_low : reverse_byte_bits(pattern_low);
            }
        }

        if (fetch_phase === PPU_SPRITE_FETCH_PATTERN_HIGH_PHASE) {
            const pattern_address = this.#get_sprite_pattern_address(sprite);
            const pattern_high = this.#memory_bus.read_ppu(pattern_address + PPU_PATTERN_HIGH_PLANE_OFFSET);

            if (sprite !== undefined) {
                unit.pattern_high_shift =
                    (sprite.attributes & 0x40) === 0 ? pattern_high : reverse_byte_bits(pattern_high);
            }
        }
    }

    #get_sprite_pattern_address(sprite: SpriteCandidate | undefined): number {
        const fetch_sprite = sprite ?? create_dummy_sprite_candidate();
        let row = fetch_sprite.row;
        const sprite_height = (this.#control_register & PPU_SPRITE_SIZE_SELECT) === 0 ? 8 : 16;

        if ((fetch_sprite.attributes & 0x80) !== 0) {
            row = sprite_height - row - 1;
        }

        if (sprite_height === 16) {
            const pattern_table = (fetch_sprite.tile & 0x01) << 12;
            const tile = (fetch_sprite.tile & 0xfe) + (row >= 8 ? 1 : 0);
            return pattern_table + tile * PPU_PATTERN_BYTES_PER_TILE + (row & 0x07);
        }

        const pattern_table =
            (this.#control_register & PPU_SPRITE_PATTERN_TABLE_SELECT) === 0 ? 0 : 0x1000;

        return pattern_table + fetch_sprite.tile * PPU_PATTERN_BYTES_PER_TILE + row;
    }

    #read_sprite_pixel(): SpritePixel | undefined {
        for (const unit of this.#sprite_output_units) {
            if (unit.x_counter !== 0) {
                continue;
            }

            const low_bit = (unit.pattern_low_shift & PPU_SPRITE_PIXEL_MASK) === 0 ? 0 : 1;
            const high_bit = (unit.pattern_high_shift & PPU_SPRITE_PIXEL_MASK) === 0 ? 0 : 2;
            const pixel = low_bit | high_bit;

            if (pixel !== 0) {
                return { pixel, attributes: unit.attributes, oam_index: unit.oam_index };
            }
        }

        return undefined;
    }

    #clock_sprite_output_units(): void {
        for (const unit of this.#sprite_output_units) {
            if (unit.x_counter > 0) {
                unit.x_counter -= 1;
                continue;
            }

            unit.pattern_low_shift = (unit.pattern_low_shift << 1) & FULL_BYTE_MASK;
            unit.pattern_high_shift = (unit.pattern_high_shift << 1) & FULL_BYTE_MASK;
        }
    }

    #advance_dot(): void {
        const rendering_enabled = (this.#mask_register & PPU_RENDERING_MASK) !== 0;

        if (
            this.#scanline === PPU_PRE_RENDER_SCANLINE &&
            this.#dot === PPU_ODD_FRAME_LAST_DOT &&
            this.#odd_frame &&
            rendering_enabled
        ) {
            this.#scanline = 0;
            this.#dot = 0;
            return;
        }

        if (this.#dot < PPU_LAST_DOT) {
            this.#dot += 1;
            return;
        }

        this.#dot = 0;

        if (this.#scanline === PPU_LAST_SCANLINE_BEFORE_PRE_RENDER) {
            this.#scanline = PPU_PRE_RENDER_SCANLINE;
            this.#frame_number += 1;
            this.#odd_frame = (this.#frame_number & 0x01) !== 0;
            return;
        }

        if (this.#scanline === PPU_LAST_SCANLINE) {
            this.#scanline = 0;
            return;
        }

        this.#scanline += 1;
    }

    #refresh_nmi_output(): void {
        const next_output =
            (this.#control_register & PPU_CONTROL_NMI_ENABLE) !== 0 &&
            (this.#status_register & PPU_VBLANK_FLAG) !== 0;

        if (next_output && !this.#nmi_output) {
            this.#nmi_edge_pending = true;
        }

        this.#nmi_output = next_output;
    }

    #set_status_flag(flag: number, active: boolean): void {
        if (active) {
            this.#status_register |= flag;
        } else {
            this.#status_register &= ~flag;
        }

        this.#status_register &= PPU_STATUS_FLAGS_MASK;
    }
}

function assert_register_index(register_index: number): void {
    if (
        !Number.isInteger(register_index) ||
        register_index < 0 ||
        register_index > PPU_REGISTER_INDEX_MAX
    ) {
        throw new RangeError(`PPU register index ${register_index} is outside the range zero through seven.`);
    }
}

function assert_byte_value(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > FULL_BYTE_MASK) {
        throw new RangeError(`PPU register value ${value} is outside the byte range.`);
    }
}

function get_sprite_row(target_scanline: number, sprite_y: number): number {
    return (target_scanline - ((sprite_y + 1) & PPU_OAM_ADDRESS_MASK)) & PPU_OAM_ADDRESS_MASK;
}

function create_empty_sprite_units(): SpriteOutputUnit[] {
    return Array.from({ length: PPU_SPRITE_FETCH_COUNT }, () => ({
        x_counter: FULL_BYTE_MASK,
        pattern_low_shift: 0,
        pattern_high_shift: 0,
        attributes: 0,
        oam_index: -1,
    }));
}

function create_dummy_sprite_candidate(): SpriteCandidate {
    return {
        y: FULL_BYTE_MASK,
        tile: FULL_BYTE_MASK,
        attributes: FULL_BYTE_MASK,
        x: FULL_BYTE_MASK,
        oam_index: -1,
        row: 0,
    };
}

function reverse_byte_bits(value: number): number {
    return (
        ((value & 0x01) << 7) |
        ((value & 0x02) << 5) |
        ((value & 0x04) << 3) |
        ((value & 0x08) << 1) |
        ((value & 0x10) >>> 1) |
        ((value & 0x20) >>> 3) |
        ((value & 0x40) >>> 5) |
        ((value & 0x80) >>> 7)
    );
}
