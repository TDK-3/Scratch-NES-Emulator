# PPU 2C02 CPU-register behavior, deterministic NTSC timing, and the
# color-index rendering pipeline for the GoboScript port.
#
# Ports src/nes/ppu/ppu_2c02.ts register I/O, timing, NMI edge detection,
# and rendering: background fetch/shift, scroll increments and transfers,
# sprite evaluation and fetch, sprite/background priority, palette lookup
# with greyscale masking, and per-pixel emphasis. Rendered pixels land in
# the two framebuffer lists below (six-bit color indices and three-bit
# emphasis values, row-major over 256 by 240), mirroring PpuFramebuffer.
# The display sprite presents those lists with the pen extension; the PPU
# itself never draws, it only raises ppu_frame_ready when vblank starts.
#
# Timing model: 341 dots per scanline, 262 scanlines (0-260 visible,
# 261 pre-render). VBlank sets at scanline 241 dot 1 unless PPUSTATUS is
# read at dots 0-1 of that scanline, and clears at scanline 261 dot 1
# along with the sprite flags. Odd rendered frames skip dot 340 when
# rendering is enabled.
#
# The PPU connects to the PPU memory bus for VRAM, palette, and OAM
# access. The bus handles nametable mirroring and pattern-table routing;
# this module holds only the CPU-visible registers and timing state.

%include src/numeric
%include src/ppu_bus

# ---- constants ----

var PPU_DOTS_PER_SCANLINE = 341;
var PPU_LAST_DOT = 340;
var PPU_DOTS_PER_CPU_CYCLE = 3;
var PPU_LAST_SCANLINE = 261;
var PPU_PRE_RENDER_SCANLINE = 261;
var PPU_LAST_SCANLINE_BEFORE_PRE_RENDER = 260;
var PPU_VBLANK_FIRST_SCANLINE = 241;
var PPU_VBLANK_START_DOT = 1;
var PPU_PRE_RENDER_STATUS_CLEAR_DOT = 1;
var PPU_ODD_FRAME_LAST_DOT = 339;
var PPU_RENDERING_MASK = 24;
var PPU_BACKGROUND_ENABLE = 8;
var PPU_SPRITE_ENABLE = 16;
var PPU_BACKGROUND_LEFT_COLUMN_ENABLE = 2;
var PPU_SPRITE_LEFT_COLUMN_ENABLE = 4;
var PPU_CONTROL_NMI_ENABLE = 128;
var PPU_VBLANK_FLAG = 128;
var PPU_SPRITE_ZERO_HIT_FLAG = 64;
var PPU_SPRITE_OVERFLOW_FLAG = 32;
var PPU_STATUS_FLAGS_MASK = 224;
var PPU_STATUS_READ_LATCH_MASK = 31;
var PPU_CONTROL_NAMETABLE_MASK = 3;
var PPU_CONTROL_VRAM_INCREMENT = 4;
var PPU_MASK_GREYSCALE = 1;
var PPU_PALETTE_GREYSCALE_MASK = 48;
var PPU_PALETTE_VALUE_MASK = 63;
var PPU_PALETTE_OPEN_BUS_MASK = 192;
var PPU_SCROLL_FINE_X_MASK = 7;
var PPU_SCROLL_COARSE_X_MASK = 31;
var PPU_SCROLL_SECOND_WRITE_PRESERVE_MASK = 3103;
var PPU_ADDRESS_HIGH_MASK = 63;
var PPU_ADDRESS_HIGH_PRESERVE_MASK = 255;
var PPU_ADDRESS_LOW_PRESERVE_MASK = 32512;
var PPU_ADDRESS_MASK = 16383;
var PPU_VRAM_ADDRESS_MASK = 32767;
var PPU_OAM_ADDRESS_MASK = 255;
var PPU_PALETTE_ADDRESS_START = 16128;
var PPU_SECONDARY_OAM_CLEAR_VALUE = 255;
var PPU_SECONDARY_OAM_CLEAR_START_DOT = 1;
var PPU_SECONDARY_OAM_CLEAR_END_DOT = 64;
var FULL_BYTE_MASK = 255;

# Rendering pipeline constants, matching the same names in ppu_2c02.ts.
var PPU_FRAME_WIDTH = 256;
var PPU_FRAME_HEIGHT = 240;
var PPU_FRAME_PIXEL_COUNT = 61440;
var PPU_BACKGROUND_PATTERN_TABLE_SELECT = 16;
var PPU_SPRITE_PATTERN_TABLE_SELECT = 8;
var PPU_SPRITE_SIZE_SELECT = 32;
var PPU_SPRITE_COUNT = 64;
var PPU_SECONDARY_SPRITE_LIMIT = 8;
var PPU_BYTES_PER_SPRITE = 4;
var PPU_PATTERN_BYTES_PER_TILE = 16;
var PPU_PATTERN_HIGH_PLANE_OFFSET = 8;
var PPU_BACKGROUND_NAMETABLE_START = 8192;
var PPU_BACKGROUND_ATTRIBUTE_START = 9152;
var PPU_BACKGROUND_LOAD_MASK = 65280;
var PPU_SPRITE_PIXEL_WEIGHT = 128;
var PPU_BACKGROUND_DUMMY_FETCH_DOT_ONE = 338;
var PPU_BACKGROUND_DUMMY_FETCH_DOT_TWO = 340;
var PPU_SPRITE_FETCH_START_DOT = 257;
var PPU_SPRITE_FETCH_END_DOT = 320;
var PPU_SPRITE_FETCH_DOTS_PER_SLOT = 8;
var PPU_SPRITE_FETCH_COUNT = 8;
var PPU_SPRITE_FETCH_ATTRIBUTE_PHASE = 2;
var PPU_SPRITE_FETCH_X_PHASE = 3;
var PPU_SPRITE_FETCH_PATTERN_LOW_PHASE = 5;
var PPU_SPRITE_FETCH_PATTERN_HIGH_PHASE = 7;
var PPU_SPRITE_GARBAGE_FETCH_PHASE_ONE = 1;
var PPU_SPRITE_GARBAGE_FETCH_PHASE_TWO = 3;
var PPU_SPRITE_PRIORITY_MASK = 32;
var PPU_SPRITE_PALETTE_MASK = 3;
var PPU_SPRITE_FLIP_HORIZONTAL_MASK = 64;
var PPU_SPRITE_FLIP_VERTICAL_MASK = 128;
var PPU_SCROLL_HORIZONTAL_MASK = 1055;
var PPU_SCROLL_HORIZONTAL_PRESERVE_MASK = 31712;
var PPU_SCROLL_VERTICAL_MASK = 31712;
var PPU_SCROLL_VERTICAL_PRESERVE_MASK = 1055;
var PPU_NO_OVERFLOW_DOT = 341;
var PPU_NO_OAM_INDEX = -1;

# ---- register state ----

var ppu_control_register = 0;
var ppu_mask_register = 0;
var ppu_status_register = 0;
var ppu_oam_address = 0;
var ppu_vram_address = 0;
var ppu_temporary_vram_address = 0;
var ppu_fine_x_scroll = 0;
var ppu_write_toggle = 0;
var ppu_read_buffer = 0;
var ppu_io_latch = 0;
var ppu_suppress_vblank_start = 0;

# Fields decoded from PPUMASK by ppu_decode_mask_register, refreshed whenever the register
# is written or reset. The pixel path reads these per pixel instead of decoding the register
# 61,440 times a frame, and the dot loop reads ppu_mask_rendering_enable for its pipeline
# gate 89,460 times a frame.
var ppu_mask_rendering_enable = 0;
var ppu_mask_background_enable = 0;
var ppu_mask_background_left_column_enable = 0;
var ppu_mask_sprite_enable = 0;
var ppu_mask_sprite_left_column_enable = 0;
var ppu_mask_greyscale = 0;
var ppu_mask_emphasis = 0;

# ---- timing state ----

var ppu_scanline = 261;
var ppu_dot = 0;
var ppu_frame_number = 0;
var ppu_odd_frame = 0;
var ppu_nmi_output = 0;
var ppu_nmi_edge_pending = 0;

# ---- rendering pipeline state ----

# Background shift registers and the next tile being fetched, mirroring the
# sixteen-bit pattern/attribute shifters in Ppu2C02.
var ppu_background_pattern_low_shift = 0;
var ppu_background_pattern_high_shift = 0;
var ppu_background_attribute_low_shift = 0;
var ppu_background_attribute_high_shift = 0;
var ppu_next_background_tile = 0;
var ppu_next_background_attribute = 0;
var ppu_next_background_pattern_low = 0;
var ppu_next_background_pattern_high = 0;

# Sprites evaluated for the next scanline and the copy kept for scanline
# zero, as parallel per-field lists with eight slots each. The TypeScript
# SpriteCandidate objects have no list form, so each field is its own list
# and the count says how many leading slots are in use.
list ppu_secondary_sprite_y = [0; 8];
list ppu_secondary_sprite_tile = [0; 8];
list ppu_secondary_sprite_attributes = [0; 8];
list ppu_secondary_sprite_x = [0; 8];
list ppu_secondary_sprite_oam_index = [0; 8];
list ppu_secondary_sprite_row = [0; 8];
var ppu_secondary_sprite_count = 0;
list ppu_line_zero_sprite_y = [0; 8];
list ppu_line_zero_sprite_tile = [0; 8];
list ppu_line_zero_sprite_attributes = [0; 8];
list ppu_line_zero_sprite_x = [0; 8];
list ppu_line_zero_sprite_oam_index = [0; 8];
list ppu_line_zero_sprite_row = [0; 8];
var ppu_line_zero_sprite_count = 0;

# The dot on which sprite evaluation schedules the overflow flag, or
# PPU_NO_OVERFLOW_DOT when no ninth sprite was found in range.
var ppu_sprite_overflow_set_dot = 341;

# 2 ^ n for the attribute-bit position the background attribute fetch selects, so the two
# attribute bits of the shared attribute byte are reached without a doubling loop.
list ppu_attribute_shift_divisors = [1, 2, 4, 8, 16, 32, 64];

# The bit weight the sixteen-bit background shifters present to the current pixel, that is
# 32768 >> fine_x. PPUSCROLL and the reset write it, so the per-pixel fine-X bit test is two
# divisions instead of a loop that halves a weight once per fine-X step.
var ppu_fine_x_weight = 32768;

# How many of the eight sprite output units hold a sprite for the line being drawn. It is
# captured when the unit slots are loaded on dots 257-320, so the per-pixel sprite scan and
# the per-dot unit shift stop after the sprites a line actually has instead of walking eight
# empty slots on every one of the 256 pixels. A unit past the count always holds X counter
# $FF and a zero pattern, so it could never contribute a pixel anyway.
var ppu_sprite_unit_active_count = 0;

# The eight sprite output units that count down their X position and then
# shift their pattern bytes out one pixel per dot.
list ppu_sprite_unit_x_counter = [0; 8];
list ppu_sprite_unit_pattern_low = [0; 8];
list ppu_sprite_unit_pattern_high = [0; 8];
list ppu_sprite_unit_attributes = [0; 8];
list ppu_sprite_unit_oam_index = [0; 8];

# The winning sprite pixel for the dot being rendered, left by
# ppu_read_sprite_pixel the way the bus helpers leave their results.
var ppu_sprite_pixel_found = 0;
var ppu_sprite_pixel_value = 0;
var ppu_sprite_pixel_attributes = 0;
var ppu_sprite_pixel_oam_index = -1;

# ---- framebuffer output ----

# Row-major packed palette/emphasis values for the 256 by 240 picture, one 1-based
# list slot per pixel at y * 256 + x + 1. Packed as emphasis*64 + color_index (0-511),
# so the display sprite reads one list instead of two and the PPU writes one list instead
# of two, halving 61k framebuffer accesses per frame. The two-plane lists are removed.
list ppu_framebuffer_packed = [0; 61440];

# The framebuffer index of column zero on the scanline the renderer is drawing, that is
# scanline * 256. ppu_advance_dot moves it one row whenever the scanline changes, so the
# pixel path reaches its slot with one addition instead of a multiply per pixel.
var ppu_framebuffer_row_base = 0;

# Raised at the vblank-start dot, when rows 0-239 are complete and the next
# frame has not started overwriting them. The frame loop clears it and asks
# the display sprite to present the framebuffer.
var ppu_frame_ready = 0;

# ---- register error codes ----

var ppu_register_error = 0;

enum ppu_register_status {
    ok = 0,
    index_out_of_range = 1,
    value_out_of_range = 2
}

# ---- reset ----

# Resets PPU registers, timing, and pipeline state without erasing VRAM,
# OAM, or cartridge RAM. Mirrors Ppu2C02.reset().
proc ppu_reset {
    ppu_control_register = 0;
    ppu_mask_register = 0;
    ppu_decode_mask_register;
    ppu_status_register = 0;
    ppu_oam_address = 0;
    ppu_vram_address = 0;
    ppu_temporary_vram_address = 0;
    ppu_fine_x_scroll = 0;
    ppu_write_toggle = 0;
    ppu_read_buffer = 0;
    ppu_io_latch = 0;
    ppu_suppress_vblank_start = 0;
    ppu_scanline = PPU_PRE_RENDER_SCANLINE;
    ppu_framebuffer_row_base = PPU_PRE_RENDER_SCANLINE * PPU_FRAME_WIDTH;
    ppu_dot = 0;
    ppu_frame_number = 0;
    ppu_odd_frame = 0;
    ppu_nmi_output = 0;
    ppu_nmi_edge_pending = 0;
    ppu_register_error = 0;
    ppu_background_pattern_low_shift = 0;
    ppu_background_pattern_high_shift = 0;
    ppu_background_attribute_low_shift = 0;
    ppu_background_attribute_high_shift = 0;
    ppu_next_background_tile = 0;
    ppu_next_background_attribute = 0;
    ppu_next_background_pattern_low = 0;
    ppu_next_background_pattern_high = 0;
    ppu_fine_x_weight = 32768;
    ppu_sprite_unit_active_count = 0;
    ppu_secondary_sprite_count = 0;
    ppu_line_zero_sprite_count = 0;
    ppu_sprite_overflow_set_dot = PPU_NO_OVERFLOW_DOT;
    ppu_reset_sprite_units;
    ppu_clear_frame_output;
    ppu_bus_reset;
}

# Empties the eight sprite output units the way create_empty_sprite_units
# does: X counters parked at $FF, patterns clear, no OAM owner.
proc ppu_reset_sprite_units {
    local unit_index = 1;

    repeat PPU_SPRITE_FETCH_COUNT {
        ppu_sprite_unit_x_counter[unit_index] = FULL_BYTE_MASK;
        ppu_sprite_unit_pattern_low[unit_index] = 0;
        ppu_sprite_unit_pattern_high[unit_index] = 0;
        ppu_sprite_unit_attributes[unit_index] = 0;
        ppu_sprite_unit_oam_index[unit_index] = PPU_NO_OAM_INDEX;
        unit_index++;
    }
}

# Clears both framebuffer planes to palette color zero with no emphasis,
# mirroring PpuFramebuffer.clear(), and lowers the frame-ready flag.
proc ppu_clear_frame_output {
    local pixel_index = 1;

    repeat PPU_FRAME_PIXEL_COUNT {
        ppu_framebuffer_packed[pixel_index] = 0;
        pixel_index++;
    }

    ppu_frame_ready = 0;
}

# ---- status flag helpers ----

# Sets or clears one PPUSTATUS flag bit, masking to the three high flags.
proc ppu_set_status_flag flag, active {
    if $active != 0 {
        ppu_status_register = ppu_status_register + $flag;
    } else {
        ppu_status_register = ppu_status_register - (ppu_status_register % ($flag * 2) - ppu_status_register % $flag);
    }

    ppu_status_register = ppu_status_register % 256;
    ppu_status_register = bitwise_and(ppu_status_register, PPU_STATUS_FLAGS_MASK);
}

# Reads the level-sensitive NMI output; a rising edge is consumed by
# ppu_take_nmi_edge.
func ppu_get_nmi_output() {
    return ppu_nmi_output;
}

# Consumes one latched NMI rising edge, including an edge caused by
# enabling NMI during vblank.
func ppu_take_nmi_edge() {
    local edge = ppu_nmi_edge_pending;
    ppu_nmi_edge_pending = 0;

    return edge;
}

# Sets or clears the vblank status bit; the PPU timing unit drives this.
proc ppu_set_vblank_flag active {
    local was_set = bitwise_and(ppu_status_register, PPU_VBLANK_FLAG);
    local now_set = 0;

    if $active != 0 {
        now_set = PPU_VBLANK_FLAG;
    }

    if was_set != now_set {
        if $active != 0 {
            ppu_status_register = ppu_status_register + PPU_VBLANK_FLAG;
        } else {
            ppu_status_register = ppu_status_register - PPU_VBLANK_FLAG;
        }
    }

    ppu_status_register = bitwise_and(ppu_status_register, PPU_STATUS_FLAGS_MASK);
    ppu_refresh_nmi_output;
}

# Sets or clears the sprite-zero-hit status bit.
proc ppu_set_sprite_zero_hit active {
    local was_set = bitwise_and(ppu_status_register, PPU_SPRITE_ZERO_HIT_FLAG);
    local now_set = 0;

    if $active != 0 {
        now_set = PPU_SPRITE_ZERO_HIT_FLAG;
    }

    if was_set != now_set {
        if $active != 0 {
            ppu_status_register = ppu_status_register + PPU_SPRITE_ZERO_HIT_FLAG;
        } else {
            ppu_status_register = ppu_status_register - PPU_SPRITE_ZERO_HIT_FLAG;
        }
    }

    ppu_status_register = bitwise_and(ppu_status_register, PPU_STATUS_FLAGS_MASK);
}

# Sets or clears the sprite-overflow status bit.
proc ppu_set_sprite_overflow active {
    local was_set = bitwise_and(ppu_status_register, PPU_SPRITE_OVERFLOW_FLAG);
    local now_set = 0;

    if $active != 0 {
        now_set = PPU_SPRITE_OVERFLOW_FLAG;
    }

    if was_set != now_set {
        if $active != 0 {
            ppu_status_register = ppu_status_register + PPU_SPRITE_OVERFLOW_FLAG;
        } else {
            ppu_status_register = ppu_status_register - PPU_SPRITE_OVERFLOW_FLAG;
        }
    }

    ppu_status_register = bitwise_and(ppu_status_register, PPU_STATUS_FLAGS_MASK);
}

# Recomputes the level-sensitive NMI output from the control register's
# NMI-enable bit and the vblank flag, latching a rising edge.
proc ppu_refresh_nmi_output {
    local nmi_enabled = bitwise_and(ppu_control_register, PPU_CONTROL_NMI_ENABLE);
    local vblank_set = bitwise_and(ppu_status_register, PPU_VBLANK_FLAG);
    local next_output = 0;

    if nmi_enabled != 0 and vblank_set != 0 {
        next_output = 1;
    }

    if next_output == 1 and ppu_nmi_output == 0 {
        ppu_nmi_edge_pending = 1;
    }

    ppu_nmi_output = next_output;
}

# ---- register read ----

# Reads a CPU-visible PPU register; write-only registers return the PPU's
# internal I/O latch. The register index is the $200x offset (0-7).
var ppu_read_result = 0;

proc ppu_read_cpu_register register_index {
    local reg = to_number($register_index);
    ppu_read_result = ppu_io_latch;
    ppu_register_error = ppu_register_status.ok;

    if reg < 0 or reg > 7 or reg != reg // 1 {
        ppu_register_error = ppu_register_status.index_out_of_range;
        ppu_read_result = 0;
    } elif reg == 2 {
        ppu_read_status_register;
    } elif reg == 4 {
        ppu_read_oam_data_register;
        ppu_io_latch = ppu_read_result;
    } elif reg == 7 {
        ppu_read_data_register;
    } else {
        ppu_read_result = ppu_io_latch;
    }
}

# PPUSTATUS: returns the three flags merged with the I/O latch's lower
# bits, clears vblank, resets the write toggle, and refreshes NMI.
proc ppu_read_status_register {
    if ppu_scanline == PPU_VBLANK_FIRST_SCANLINE and ppu_dot <= PPU_VBLANK_START_DOT {
        ppu_suppress_vblank_start = 1;
    }

    local flags = bitwise_and(ppu_status_register, PPU_STATUS_FLAGS_MASK);
    local latch_low = bitwise_and(ppu_io_latch, PPU_STATUS_READ_LATCH_MASK);
    ppu_read_result = flags + latch_low;
    ppu_status_register = bitwise_and(ppu_status_register, 255 - PPU_VBLANK_FLAG);
    ppu_write_toggle = 0;
    ppu_io_latch = ppu_read_result;
    ppu_refresh_nmi_output;
}

# PPUDATA: palette reads are immediate with greyscale masking; other
# addresses return the read buffer and refill it.
proc ppu_read_data_register {
    # The 14-bit address mask is $3FFF; the modulo form divides by 16384.
    local address = ppu_vram_address % 16384;
    local value = 0;

    if address >= PPU_PALETTE_ADDRESS_START {
        ppu_bus_read_ppu address;
        local palette_value = ppu_bus_read_value;
        local greyscale_value = 0;

        if bitwise_and(ppu_mask_register, PPU_MASK_GREYSCALE) == 0 {
            greyscale_value = palette_value;
        } else {
            greyscale_value = bitwise_and(palette_value, PPU_PALETTE_GREYSCALE_MASK);
        }

        value = bitwise_and(greyscale_value, PPU_PALETTE_VALUE_MASK);
        value = bitwise_or(value, bitwise_and(ppu_io_latch, PPU_PALETTE_OPEN_BUS_MASK));

        local buffer_address = (address + 16384 - 4096) % 16384;
        ppu_bus_read_ppu buffer_address;
        ppu_read_buffer = ppu_bus_read_value;
    } else {
        value = ppu_read_buffer;
        ppu_bus_read_ppu address;
        ppu_read_buffer = ppu_bus_read_value;
    }

    ppu_io_latch = value;
    ppu_read_result = value;
    ppu_increment_vram_address;
}

# OAMDATA: during dots 1-64 of a rendered line, returns $FF from the
# secondary OAM clear; otherwise returns primary OAM at OAMADDR.
proc ppu_read_oam_data_register {
    local rendering = ppu_is_rendering_enabled();
    local visible = ppu_is_visible_or_pre_render_scanline();

    if rendering == 1 and visible == 1 {
        if ppu_dot >= PPU_SECONDARY_OAM_CLEAR_START_DOT and ppu_dot <= PPU_SECONDARY_OAM_CLEAR_END_DOT {
            ppu_read_result = PPU_SECONDARY_OAM_CLEAR_VALUE;
        } else {
            ppu_bus_read_oam ppu_oam_address;
            ppu_read_result = ppu_bus_oam_read_value;
        }
    } else {
        ppu_bus_read_oam ppu_oam_address;
        ppu_read_result = ppu_bus_oam_read_value;
    }
}

# ---- register write ----

# Writes one CPU-visible PPU register and refreshes the I/O latch.
proc ppu_write_cpu_register register_index, value {
    local reg = to_number($register_index);
    local byte_value = normalize_byte($value);
    ppu_register_error = ppu_register_status.ok;

    if reg < 0 or reg > 7 or reg != reg // 1 {
        ppu_register_error = ppu_register_status.index_out_of_range;
    } else {
        ppu_io_latch = byte_value;

        if reg == 0 {
            ppu_write_control_register byte_value;
        } elif reg == 1 {
            ppu_mask_register = byte_value;
            ppu_decode_mask_register;
        } elif reg == 2 {
            # PPUSTATUS ignores writes.
        } elif reg == 3 {
            ppu_oam_address = byte_value;
        } elif reg == 4 {
            ppu_write_oam_data_register byte_value;
        } elif reg == 5 {
            ppu_write_scroll_register byte_value;
        } elif reg == 6 {
            ppu_write_address_register byte_value;
        } elif reg == 7 {
            ppu_write_data_register byte_value;
        }
    }
}

# Refreshes the precomputed PPUMASK fields from the register. The renderer reads the fields
# per pixel, so the bit tests run here, once per $2001 write and once at reset, instead of
# 61,440 times a frame. Each field is the same division and modulo the pixel path used to
# compute inline.
proc ppu_decode_mask_register {
    ppu_mask_rendering_enable = 0;
    ppu_mask_background_enable = 0;
    ppu_mask_background_left_column_enable = 0;
    ppu_mask_sprite_enable = 0;
    ppu_mask_sprite_left_column_enable = 0;
    ppu_mask_greyscale = 0;
    ppu_mask_emphasis = (ppu_mask_register // 32) % 8;

    if ppu_mask_register % 32 >= 8 {
        ppu_mask_rendering_enable = 1;
    }

    if (ppu_mask_register // PPU_BACKGROUND_ENABLE) % 2 == 1 {
        ppu_mask_background_enable = 1;
    }

    if (ppu_mask_register // PPU_BACKGROUND_LEFT_COLUMN_ENABLE) % 2 == 1 {
        ppu_mask_background_left_column_enable = 1;
    }

    if (ppu_mask_register // PPU_SPRITE_ENABLE) % 2 == 1 {
        ppu_mask_sprite_enable = 1;
    }

    if (ppu_mask_register // PPU_SPRITE_LEFT_COLUMN_ENABLE) % 2 == 1 {
        ppu_mask_sprite_left_column_enable = 1;
    }

    if ppu_mask_register % 2 == 1 {
        ppu_mask_greyscale = 1;
    }
}

# PPUCTRL: stores the value, updates the nametable bits in the temporary
# VRAM address, and refreshes NMI output.
proc ppu_write_control_register value {
    local temporary = 0;
    local nt_bits = 0;
    local preserved = 0;

    ppu_control_register = $value;
    nt_bits = ($value % 4) * 1024;
    temporary = ppu_temporary_vram_address % 32768;
    preserved = temporary - (((temporary // 1024) % 4) * 1024);
    ppu_temporary_vram_address = preserved + nt_bits;
    ppu_refresh_nmi_output;
}

# PPUSCROLL: two-write toggle sets fine X on the first write and fine Y /
# coarse Y on the second.
proc ppu_write_scroll_register value {
    local fine_x = 0;
    local weight = 0;
    local coarse_x = 0;
    local preserved = 0;
    local fine_y = 0;
    local coarse_y = 0;
    local temporary = 0;

    if ppu_write_toggle == 0 {
        # The fine-X mask is $07; its modulo form divides by 8, not by the mask value.
        fine_x = $value % 8;
        ppu_fine_x_scroll = fine_x;

        # The shift register weight the renderer reads for this fine X, built once here so
        # the pixel loop never has to halve a weight per step.
        weight = 32768;

        repeat fine_x {
            weight = weight // 2;
        }

        ppu_fine_x_weight = weight;
        coarse_x = ($value // 8) % 32;
        temporary = ppu_temporary_vram_address % 32768;
        preserved = temporary - (temporary % 32);
        ppu_temporary_vram_address = preserved + coarse_x;
        ppu_write_toggle = 1;
    } else {
        fine_y = ($value % 8) * 4096;
        coarse_y = (($value // 8) % 32) * 32;
        temporary = ppu_temporary_vram_address % 32768;

        # Preserve coarse X and both nametable bits; fine Y and coarse Y are replaced.
        preserved = (temporary % 32) + (((temporary // 1024) % 4) * 1024);
        ppu_temporary_vram_address = preserved + fine_y + coarse_y;
        ppu_write_toggle = 0;
    }
}

# PPUADDR: two-write toggle sets the high byte on the first write and the
# low byte on the second, then copies temporary to vram and observes.
proc ppu_write_address_register value {
    local temporary = 0;

    if ppu_write_toggle == 0 {
        temporary = ppu_temporary_vram_address % 32768;

        # Keep the low byte; the first write supplies bits 8-13.
        ppu_temporary_vram_address = (temporary % 256) + (($value % 64) * 256);
        ppu_write_toggle = 1;
    } else {
        temporary = ppu_temporary_vram_address % 32768;
        ppu_temporary_vram_address = (temporary - (temporary % 256)) + $value;
        ppu_vram_address = ppu_temporary_vram_address;
        ppu_write_toggle = 0;

        # The 14-bit address mask is $3FFF; its modulo form divides by 16384, and every
        # VRAM-address access site uses that divisor, never the mask value.
        ppu_bus_observe_ppu_address ppu_vram_address % 16384;
    }
}

# PPUDATA: writes through the PPU bus and increments the VRAM address.
proc ppu_write_data_register value {
    ppu_bus_write_ppu ppu_vram_address % 16384, $value;
    ppu_increment_vram_address;
}

# OAMDATA: writes during rendering are silently dropped; otherwise stores
# and auto-increments the OAM address.
proc ppu_write_oam_data_register value {
    if ppu_is_oam_cpu_access_during_rendering() != 1 {
        ppu_bus_write_oam ppu_oam_address, $value;
        ppu_oam_address = (ppu_oam_address + 1) % 256;
    }
}

# ---- VRAM address increment ----

# Increments the VRAM address by 1 or 32 depending on the PPUCTRL
# increment bit, then observes the new address through the bus.
proc ppu_increment_vram_address {
    local increment = 1;

    if (ppu_control_register // PPU_CONTROL_VRAM_INCREMENT) % 2 == 1 {
        increment = 32;
    }

    ppu_vram_address = (ppu_vram_address + increment) % 32768;
    ppu_bus_observe_ppu_address ppu_vram_address % 16384;
}

# ---- timing ----

# Clocks one PPU dot: applies vblank timing, renders the dot's pixel, runs
# the fetch pipeline, then advances dot/scanline, in the reference order.
proc ppu_clock_ppu_dot {
    # ppu_bus_clock_ppu_dot() and the MMC3 low-dot counter it forwards to, written out here:
    # this runs 89,460 times a frame, and two custom-block calls per dot for one comparison
    # and one increment is a cost the frame budget cannot carry. NROM has no observer, so the
    # whole block collapses to one comparison on that board.
    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
        if mmc3_ppu_a12_high == 0 and mmc3_a12_low_dots < mmc3_limit.a12_filter_dots {
            mmc3_a12_low_dots = mmc3_a12_low_dots + 1;
        }
    }

    # Both status events are scheduled at dot 1 (PPU_VBLANK_START_DOT and
    # PPU_PRE_RENDER_STATUS_CLEAR_DOT are both 1), so the shared dot test leads and the two
    # scanline tests run 262 times a frame instead of 89,460.
    if ppu_dot == 1 {
        if ppu_scanline == PPU_VBLANK_FIRST_SCANLINE {
            # Rows 0-239 are complete at this dot even when an early PPUSTATUS
            # read suppresses the vblank flag itself, so the finished frame is
            # offered to the display either way.
            ppu_frame_ready = 1;

            if ppu_suppress_vblank_start == 1 {
                ppu_suppress_vblank_start = 0;
            } else {
                ppu_set_vblank_flag 1;
            }
        } elif ppu_scanline == PPU_PRE_RENDER_SCANLINE {
            ppu_set_vblank_flag 0;
            ppu_set_sprite_zero_hit 0;
            ppu_set_sprite_overflow 0;
        }
    }

    # Both per-dot procs and the dot advance are called only when they have work to do: a
    # blanking dot produces no pixel, a vblank or blanked dot runs no fetch, and every dot but
    # the last two of a line only steps the counter. This call site is the only caller, so the
    # guards live here and each proc body starts at its first real step.
    if ppu_scanline < PPU_FRAME_HEIGHT and ppu_dot >= 1 and ppu_dot <= PPU_FRAME_WIDTH {
        ppu_render_pixel;
    }

    if (ppu_scanline < PPU_FRAME_HEIGHT or ppu_scanline == PPU_PRE_RENDER_SCANLINE)
        and ppu_mask_rendering_enable == 1 {
        ppu_clock_rendering_pipeline;
    }

    # Dots 0 through 338 only step the counter; the two dots at the end of a line go through
    # ppu_advance_dot, which owns the wrap and the odd-frame dot-339 skip.
    if ppu_dot < PPU_ODD_FRAME_LAST_DOT {
        ppu_dot = ppu_dot + 1;
    } else {
        ppu_advance_dot;
    }
}

# Advances three NTSC PPU dots for one CPU cycle.
proc ppu_clock_cpu_cycle {
    ppu_clock_ppu_dot;
    ppu_clock_ppu_dot;
    ppu_clock_ppu_dot;
}

# ---- dot/scanline advancement ----

# Advances one dot, wrapping at the end of scanline 261, skipping dot 340
# on odd rendered frames when rendering is enabled.
proc ppu_advance_dot {
    local odd_skip = 0;

    if ppu_scanline == PPU_PRE_RENDER_SCANLINE {
        if ppu_dot == PPU_ODD_FRAME_LAST_DOT and ppu_odd_frame == 1 {
            # The precomputed PPUMASK field; this runs once per dot.
            if ppu_mask_rendering_enable == 1 {
                odd_skip = 1;
            }
        }
    }

    if odd_skip == 1 {
        ppu_scanline = 0;
        ppu_framebuffer_row_base = 0;
        ppu_dot = 0;
    } elif ppu_dot < PPU_LAST_DOT {
        ppu_dot = ppu_dot + 1;
    } else {
        ppu_dot = 0;

        if ppu_scanline == PPU_LAST_SCANLINE_BEFORE_PRE_RENDER {
            ppu_scanline = PPU_PRE_RENDER_SCANLINE;
            ppu_framebuffer_row_base = ppu_framebuffer_row_base + PPU_FRAME_WIDTH;
            ppu_frame_number = ppu_frame_number + 1;

            if ppu_frame_number % 2 != 0 {
                ppu_odd_frame = 1;
            } else {
                ppu_odd_frame = 0;
            }
        } elif ppu_scanline == PPU_LAST_SCANLINE {
            ppu_scanline = 0;
            ppu_framebuffer_row_base = 0;
        } else {
            ppu_scanline = ppu_scanline + 1;
            ppu_framebuffer_row_base = ppu_framebuffer_row_base + PPU_FRAME_WIDTH;
        }
    }
}

# ---- helpers ----

# Whether rendering is enabled (background or sprite bit set in PPUMASK).
func ppu_is_rendering_enabled() {
    return ppu_mask_rendering_enable;
}

# Whether the current scanline is visible or the pre-render line.
func ppu_is_visible_or_pre_render_scanline() {
    if ppu_scanline < 240 or ppu_scanline == PPU_PRE_RENDER_SCANLINE {
        return 1;
    }

    return 0;
}

# Whether CPU OAM access falls on a rendered line with rendering enabled.
func ppu_is_oam_cpu_access_during_rendering() {
    if ppu_is_visible_or_pre_render_scanline() == 1 and ppu_is_rendering_enabled() == 1 {
        return 1;
    }

    return 0;
}

# ---- rendering pipeline ----

# Extracts the two-bit pixel (or palette) selected by the fine X scroll
# from a pair of sixteen-bit shift registers, mirroring the bit test the
# reference performs with its $8000 >>> fine_x mask.
func ppu_shift_pixel(shift_low, shift_high, fine_x) {
    local bit_weight = 32768;

    repeat $fine_x {
        bit_weight = bit_weight // 2;
    }

    return (($shift_low // bit_weight) % 2) + ((($shift_high // bit_weight) % 2) * 2);
}

# Chooses the palette offset (0-31 from $3F00) for one output pixel. A
# front sprite pixel wins over any background, a behind-background sprite
# pixel wins only over a transparent background, and an empty pixel reads
# the universal backdrop at offset zero.
func ppu_select_palette_offset(bg_pixel, bg_palette, has_sprite, spr_pixel, spr_attributes) {
    if $has_sprite == 1 and ($bg_pixel == 0 or ($spr_attributes // PPU_SPRITE_PRIORITY_MASK) % 2 == 0) {
        return 16 + (($spr_attributes % 4) * 4) + $spr_pixel;
    }

    if $bg_pixel != 0 {
        return ($bg_palette * 4) + $bg_pixel;
    }

    return 0;
}

# Reverses the bits of one byte, for horizontally flipped sprite patterns.
func ppu_reverse_byte_bits(byte_value) {
    local remaining = normalize_byte($byte_value);
    local result = 0;

    repeat 8 {
        result = (result * 2) + (remaining % 2);
        remaining = remaining // 2;
    }

    return result;
}

# The row of a sprite that lands on a scanline, wrapping at 256 exactly the
# way get_sprite_row masks both of its operands to bytes.
func ppu_sprite_row(target_scanline, sprite_y) {
    return normalize_byte($target_scanline - ($sprite_y + 1));
}

# The low-plane pattern address for one sprite row, honoring the vertical
# flip, the 8x16 size with its per-tile pattern bank, and the 8x8 pattern
# table select. The high plane sits eight bytes later.
func ppu_sprite_pattern_address(control_value, tile_value, attributes_value, row_value) {
    local sprite_height = 8;
    local effective_row = $row_value;
    local pattern_table = 0;
    local base_tile = $tile_value % 256;

    if ($control_value // PPU_SPRITE_SIZE_SELECT) % 2 == 1 {
        sprite_height = 16;
    }

    if ($attributes_value // PPU_SPRITE_FLIP_VERTICAL_MASK) % 2 == 1 {
        effective_row = sprite_height - $row_value - 1;
    }

    if sprite_height == 16 {
        pattern_table = (base_tile % 2) * 4096;
        base_tile = base_tile - (base_tile % 2);

        if effective_row >= 8 {
            base_tile = base_tile + 1;
        }

        return pattern_table + (base_tile * PPU_PATTERN_BYTES_PER_TILE) + (effective_row % 8);
    }

    pattern_table = (($control_value // PPU_SPRITE_PATTERN_TABLE_SELECT) % 2) * 4096;

    return pattern_table + (base_tile * PPU_PATTERN_BYTES_PER_TILE) + effective_row;
}

# The VRAM address after the coarse X scroll increment, which wraps into
# the horizontally adjacent nametable at coarse X 31. The bit masks of the
# reference are division and modulo arithmetic here, which is cheaper than a
# bitwise helper call and exactly equivalent on a fifteen-bit address.
func ppu_increment_scroll_x_for(vram_value) {
    local result = $vram_value % 32768;
    local nametable_bit = 0;

    if result % 32 == 31 {
        result = result - 31;
        nametable_bit = (result // 1024) % 2;

        if nametable_bit == 1 {
            result = result - 1024;
        } else {
            result = result + 1024;
        }
    } else {
        result = result + 1;
    }

    return result % 32768;
}

# The VRAM address after the Y scroll increment: fine Y counts first, then
# coarse Y, wrapping into the vertically adjacent nametable at coarse Y 29
# and without the toggle at coarse Y 31.
func ppu_increment_scroll_y_for(vram_value) {
    local result = $vram_value % 32768;
    local coarse_y = 0;
    local nametable_bit = 0;

    if (result // 4096) % 8 != 7 {
        result = result + 4096;
    } else {
        result = result % 4096;
        coarse_y = (result // 32) % 32;

        if coarse_y == 29 {
            coarse_y = 0;
            nametable_bit = (result // 2048) % 2;

            if nametable_bit == 1 {
                result = result - 2048;
            } else {
                result = result + 2048;
            }
        } elif coarse_y == 31 {
            coarse_y = 0;
        } else {
            coarse_y = coarse_y + 1;
        }

        result = (result - (((result // 32) % 32) * 32)) + (coarse_y * 32);
    }

    return result % 32768;
}

# The VRAM address with its horizontal scroll bits taken from the
# temporary address, as copied at dot 257 of each rendered line. The two
# halves of the address are disjoint, so they add.
func ppu_transfer_horizontal_for(current_value, temporary_value) {
    local current = $current_value % 32768;
    local temporary = $temporary_value % 32768;

    return (current - (current % 32) - (((current // 1024) % 2) * 1024))
        + (temporary % 32) + (((temporary // 1024) % 2) * 1024);
}

# The VRAM address with its vertical scroll bits taken from the temporary
# address, as copied on dots 280-304 of the pre-render line.
func ppu_transfer_vertical_for(current_value, temporary_value) {
    local current = $current_value % 32768;
    local temporary = $temporary_value % 32768;

    return (current % 32) + (((current // 1024) % 2) * 1024)
        + (temporary - (temporary % 32) - (((temporary // 1024) % 2) * 1024));
}

# Renders the one visible pixel the current dot produces into the
# framebuffer lists, including the sprite-zero hit, the priority mix, the
# palette read with greyscale masking, and the emphasis capture.
#
# This proc runs once per visible dot, 61,440 times per frame, so it is written for the
# Scratch runtime rather than for shape: the caller has already checked the visible-scanline
# and dot-1-through-256 window, so the proc runs unguarded instead of retesting it per pixel,
# the PPUMASK tests read the fields ppu_decode_mask_register precomputed at each $2001 write
# instead of decoding the register per pixel, the fine-X pixel comes from the weight
# PPUSCROLL precomputed instead of a loop, the framebuffer index comes from the row base
# ppu_advance_dot precomputed instead of a multiply, the palette lookup is one direct list
# read instead of a bus read with its address normalization, region decode and mapper
# observation (a palette access is not observable to the board), and the sprite scan only
# visits the units the line actually loaded.
proc ppu_render_pixel {
    local pixel_x = 0;
    local background_visible = 0;
    local sprite_visible = 0;
    local background_pixel = 0;
    local background_palette = 0;
    local fine_weight = 0;
    local palette_offset = 0;
    local color_index = 0;
    local framebuffer_index = 0;

    pixel_x = ppu_dot - 1;

    if ppu_mask_background_enable == 1 {
        if pixel_x >= 8 or ppu_mask_background_left_column_enable == 1 {
            background_visible = 1;
        }
    }

    if ppu_mask_sprite_enable == 1 {
        if pixel_x >= 8 or ppu_mask_sprite_left_column_enable == 1 {
            sprite_visible = 1;
        }
    }

    if background_visible == 1 {
        fine_weight = ppu_fine_x_weight;
        background_pixel = ((ppu_background_pattern_low_shift // fine_weight) % 2)
            + (((ppu_background_pattern_high_shift // fine_weight) % 2) * 2);
        background_palette = ((ppu_background_attribute_low_shift // fine_weight) % 2)
            + (((ppu_background_attribute_high_shift // fine_weight) % 2) * 2);
    }

    if sprite_visible == 1 {
        ppu_read_sprite_pixel;
    } else {
        ppu_sprite_pixel_found = 0;
    }

    if ppu_sprite_pixel_found == 1 and ppu_sprite_pixel_oam_index == 0 {
        if background_pixel != 0 and pixel_x < PPU_FRAME_WIDTH - 1 {
            # The hit flag latches until the pre-render clear, so the setter only has work
            # to do on the first hit of a frame; the test keeps the call off every later
            # hit, and the set is the plain addition ppu_set_sprite_zero_hit would make.
            if ppu_status_register // PPU_SPRITE_ZERO_HIT_FLAG % 2 == 0 {
                ppu_status_register = ppu_status_register + PPU_SPRITE_ZERO_HIT_FLAG;
            }
        }
    }

    # ppu_select_palette_offset() inlined: a front sprite pixel wins over any background,
    # a behind-background sprite pixel wins only over a transparent background, and an
    # empty pixel reads the universal backdrop at offset zero. The two palette bits of the
    # sprite attributes are the mask $03, so their modulo form divides by 4, exactly as
    # ppu_select_palette_offset spells it.
    if ppu_sprite_pixel_found == 1
        and (background_pixel == 0 or (ppu_sprite_pixel_attributes // PPU_SPRITE_PRIORITY_MASK) % 2 == 0) {
        palette_offset = 16 + ((ppu_sprite_pixel_attributes % 4) * 4)
            + ppu_sprite_pixel_value;
    } elif background_pixel != 0 {
        palette_offset = (background_palette * 4) + background_pixel;
    } else {
        palette_offset = 0;
    }

    # The palette RAM alias rule of ppu_bus_map_palette cannot fire here: the select above
    # produces only the universal slot 0, background slots 1-15, or opaque sprite slots
    # 17-31, and the alias slots 16, 20, 24 and 28 need a transparent sprite pixel to be
    # reached. The bus keeps the rule for the CPU's $2007 palette reads. Palette RAM stores
    # six-bit values (every bus write masks them), and the six-bit color mask is $3F, whose
    # modulo form divides by 64.
    color_index = ppu_palette_ram[palette_offset + 1] % 64;

    if ppu_mask_greyscale == 1 {
        color_index = ((color_index // 16) % 4) * 16;
    }

    framebuffer_index = ppu_framebuffer_row_base + ppu_dot;
    ppu_framebuffer_packed[framebuffer_index] = ppu_mask_emphasis * 64 + color_index;

    if ppu_mask_rendering_enable == 1 {
        ppu_clock_sprite_output_units;
    }
}

# Finds the first sprite output unit whose X counter has expired and whose
# current pattern pixel is opaque, leaving it in the ppu_sprite_pixel_*
# result variables with ppu_sprite_pixel_found at zero when none qualify.
proc ppu_read_sprite_pixel {
    local unit_index = 1;
    local unit_pixel = 0;

    ppu_sprite_pixel_found = 0;
    ppu_sprite_pixel_value = 0;
    ppu_sprite_pixel_attributes = 0;
    ppu_sprite_pixel_oam_index = PPU_NO_OAM_INDEX;

    # The first opaque unit is the visible one; later units could not win, so the scan stops
    # there, and it never visits a slot the line did not load a sprite into.
    until unit_index > ppu_sprite_unit_active_count or ppu_sprite_pixel_found == 1 {
        if ppu_sprite_unit_x_counter[unit_index] == 0 {
            unit_pixel = (ppu_sprite_unit_pattern_low[unit_index] // PPU_SPRITE_PIXEL_WEIGHT) % 2;
            unit_pixel = unit_pixel
                + (((ppu_sprite_unit_pattern_high[unit_index] // PPU_SPRITE_PIXEL_WEIGHT) % 2) * 2);

            if unit_pixel != 0 {
                ppu_sprite_pixel_found = 1;
                ppu_sprite_pixel_value = unit_pixel;
                ppu_sprite_pixel_attributes = ppu_sprite_unit_attributes[unit_index];
                ppu_sprite_pixel_oam_index = ppu_sprite_unit_oam_index[unit_index];
            }
        }

        unit_index++;
    }
}

# Counts every sprite output unit down toward its X position, and shifts
# the patterns of the units already on screen one pixel left. Only the units
# the line loaded are visited; the rest hold X counter $FF and a zero pattern.
proc ppu_clock_sprite_output_units {
    local unit_index = 1;
    local x_counter = 0;
    local pattern_low = 0;
    local pattern_high = 0;

    repeat ppu_sprite_unit_active_count {
        x_counter = ppu_sprite_unit_x_counter[unit_index];

        if x_counter > 0 {
            ppu_sprite_unit_x_counter[unit_index] = x_counter - 1;
        } else {
            pattern_low = ppu_sprite_unit_pattern_low[unit_index];
            pattern_high = ppu_sprite_unit_pattern_high[unit_index];
            ppu_sprite_unit_pattern_low[unit_index] = (pattern_low * 2) % 256;
            ppu_sprite_unit_pattern_high[unit_index] = (pattern_high * 2) % 256;
        }

        unit_index++;
    }
}

# Runs the background fetch cycle, the scroll increments and transfers,
# sprite evaluation, and sprite fetch for the current dot, in the order
# the reference clocks them.
proc ppu_clock_rendering_pipeline {
    local fetch_phase = 0;

    # The caller has already checked the visible-or-pre-render window and the PPUMASK
    # rendering bit, so the body starts at its first real step and runs up to 89,460 times
    # a frame without retesting them.
    if ppu_dot >= PPU_SPRITE_FETCH_START_DOT and ppu_dot <= PPU_SPRITE_FETCH_END_DOT {
        # OAMADDR is forced to $00 on each dot of the sprite tile
        # loading interval.
        ppu_oam_address = 0;
    }

    if ppu_scanline < PPU_FRAME_HEIGHT and ppu_dot == 65 {
        ppu_evaluate_sprites_for_next_scanline;
    }

    if ppu_dot == ppu_sprite_overflow_set_dot {
        # Same latch as the sprite-zero hit: only the first overflow of a frame needs the
        # setter, and the plain add is the change it would make.
        if ppu_status_register // PPU_SPRITE_OVERFLOW_FLAG % 2 == 0 {
            ppu_status_register = ppu_status_register + PPU_SPRITE_OVERFLOW_FLAG;
        }
    }

    if (ppu_dot >= 1 and ppu_dot <= 256) or (ppu_dot >= 321 and ppu_dot <= 336) {
        # ppu_shift_background_registers() inlined: four shifts per fetch dot, and the
        # call was a larger share of the dot than the shifts themselves.
        ppu_background_pattern_low_shift = (ppu_background_pattern_low_shift * 2) % 65536;
        ppu_background_pattern_high_shift = (ppu_background_pattern_high_shift * 2) % 65536;
        ppu_background_attribute_low_shift = (ppu_background_attribute_low_shift * 2) % 65536;
        ppu_background_attribute_high_shift = (ppu_background_attribute_high_shift * 2) % 65536;
        fetch_phase = ppu_dot % 8;

        if fetch_phase == 0 {
            ppu_fetch_background_pattern_high;
            ppu_load_background_registers;
            ppu_vram_address = ppu_increment_scroll_x_for(ppu_vram_address);
        } elif fetch_phase == 2 {
            ppu_bus_read_nametable PPU_BACKGROUND_NAMETABLE_START + (ppu_vram_address % 4096);
            ppu_next_background_tile = ppu_bus_read_value;
        } elif fetch_phase == 4 {
            ppu_fetch_background_attribute;
        } elif fetch_phase == 6 {
            ppu_fetch_background_pattern_low;
        }
    }

    if ppu_dot == 256 {
        ppu_vram_address = ppu_increment_scroll_y_for(ppu_vram_address);
    }

    if ppu_dot == 257 {
        ppu_vram_address = ppu_transfer_horizontal_for(ppu_vram_address, ppu_temporary_vram_address);
    }

    if ppu_scanline == PPU_PRE_RENDER_SCANLINE and ppu_dot >= 280 and ppu_dot <= 304 {
        ppu_vram_address = ppu_transfer_vertical_for(ppu_vram_address, ppu_temporary_vram_address);
    }

    if ppu_dot == PPU_BACKGROUND_DUMMY_FETCH_DOT_ONE or ppu_dot == PPU_BACKGROUND_DUMMY_FETCH_DOT_TWO {
        ppu_bus_read_nametable PPU_BACKGROUND_NAMETABLE_START + (ppu_vram_address % 4096);
    }

    if ppu_dot >= PPU_SPRITE_FETCH_START_DOT and ppu_dot <= PPU_SPRITE_FETCH_END_DOT {
        ppu_clock_sprite_fetch;
    }
}

# Shifts the four background registers one pixel left.
proc ppu_shift_background_registers {
    ppu_background_pattern_low_shift = (ppu_background_pattern_low_shift * 2) % 65536;
    ppu_background_pattern_high_shift = (ppu_background_pattern_high_shift * 2) % 65536;
    ppu_background_attribute_low_shift = (ppu_background_attribute_low_shift * 2) % 65536;
    ppu_background_attribute_high_shift = (ppu_background_attribute_high_shift * 2) % 65536;
}

# Loads the freshly fetched tile into the low halves of the background
# shift registers, expanding the two attribute bits to full bytes.
proc ppu_load_background_registers {
    local attribute_low_fill = 0;
    local attribute_high_fill = 0;

    if ppu_next_background_attribute % 2 == 1 {
        attribute_low_fill = FULL_BYTE_MASK;
    }

    if (ppu_next_background_attribute // 2) % 2 == 1 {
        attribute_high_fill = FULL_BYTE_MASK;
    }

    # Keeping the high byte of each sixteeen-bit shifter, then loading the new tile's low
    # byte; the mask is a subtraction of the low byte instead of a bitwise helper call.
    ppu_background_pattern_low_shift = (ppu_background_pattern_low_shift
        - (ppu_background_pattern_low_shift % 256)) + ppu_next_background_pattern_low;
    ppu_background_pattern_high_shift = (ppu_background_pattern_high_shift
        - (ppu_background_pattern_high_shift % 256)) + ppu_next_background_pattern_high;
    ppu_background_attribute_low_shift = (ppu_background_attribute_low_shift
        - (ppu_background_attribute_low_shift % 256)) + attribute_low_fill;
    ppu_background_attribute_high_shift = (ppu_background_attribute_high_shift
        - (ppu_background_attribute_high_shift % 256)) + attribute_high_fill;
}

# Fetches the two attribute bits for the next background tile from the
# attribute byte its 32 by 32 block shares.
proc ppu_fetch_background_attribute {
    local attribute_address = 0;
    local attribute_byte = 0;
    local attribute_shift = 0;

    # The three masks of the reference expression, spelled as division and modulo: the
    # nametable bits, the eight attribute rows, and the eight attribute columns.
    attribute_address = PPU_BACKGROUND_ATTRIBUTE_START
        + (((ppu_vram_address // 1024) % 4) * 1024)
        + (((ppu_vram_address // 128) % 8) * 8)
        + ((ppu_vram_address // 4) % 8);
    ppu_bus_read_nametable attribute_address;
    attribute_byte = ppu_bus_read_value;
    attribute_shift = (((ppu_vram_address // 64) % 2) * 4) + (((ppu_vram_address // 2) % 2) * 2);

    # 2 ^ attribute_shift from a seven-entry table instead of a doubling loop: the shift is
    # always 0-6, and this fetch runs once per tile per line.
    ppu_next_background_attribute = (attribute_byte // ppu_attribute_shift_divisors[attribute_shift + 1]) % 4;
}

# Fetches the low pattern plane byte for the next background tile.
proc ppu_fetch_background_pattern_low {
    local pattern_table = ((ppu_control_register // PPU_BACKGROUND_PATTERN_TABLE_SELECT) % 2) * 4096;
    local fine_y = (ppu_vram_address // 4096) % 8;

    ppu_bus_read_pattern_window pattern_table + (ppu_next_background_tile * PPU_PATTERN_BYTES_PER_TILE) + fine_y;
    ppu_next_background_pattern_low = ppu_bus_read_value;
}

# Fetches the high pattern plane byte for the next background tile.
proc ppu_fetch_background_pattern_high {
    local pattern_table = ((ppu_control_register // PPU_BACKGROUND_PATTERN_TABLE_SELECT) % 2) * 4096;
    local fine_y = (ppu_vram_address // 4096) % 8;

    ppu_bus_read_pattern_window pattern_table
        + (ppu_next_background_tile * PPU_PATTERN_BYTES_PER_TILE)
        + fine_y
        + PPU_PATTERN_HIGH_PLANE_OFFSET;
    ppu_next_background_pattern_high = ppu_bus_read_value;
}

# Evaluates primary OAM for the next scanline exactly as the reference's
# aggregated model does at dot 65: eight sprites fill secondary OAM, the
# ninth in-range value schedules the overflow flag, and the 2C02 diagonal
# bug advances the byte offset while checking for that ninth sprite.
proc ppu_evaluate_sprites_for_next_scanline {
    local target_scanline = 0;
    local visible_scanline_for_eval = 1;
    local sprite_height = 8;
    local found_count = 0;
    local elapsed_dots = 0;
    local overflow_offset = 0;
    local overflow_dot = 0;
    local oam_index = 0;
    local evaluation_done = 0;
    local checking_overflow = 0;
    local candidate_address = 0;
    local candidate_row = 0;
    local slot_index = 0;
    local copy_index = 1;

    if ppu_scanline == PPU_FRAME_HEIGHT - 1 {
        target_scanline = 0;
    } else {
        target_scanline = ppu_scanline + 1;
    }

    if target_scanline >= 240 {
        visible_scanline_for_eval = 0;
    }

    if visible_scanline_for_eval == 0 {
        ppu_secondary_sprite_count = 0;
        ppu_sprite_overflow_set_dot = PPU_NO_OVERFLOW_DOT;
    } else {

    if (ppu_control_register // PPU_SPRITE_SIZE_SELECT) % 2 == 1 {
        sprite_height = 16;
    }

    ppu_sprite_overflow_set_dot = PPU_NO_OVERFLOW_DOT;

    until oam_index >= PPU_SPRITE_COUNT or evaluation_done == 1 {
        checking_overflow = 0;

        if found_count == PPU_SECONDARY_SPRITE_LIMIT {
            checking_overflow = 1;
        }

        candidate_address = (oam_index * PPU_BYTES_PER_SPRITE);

        if checking_overflow == 1 {
            candidate_address = candidate_address + overflow_offset;
        }

        # The OAM read and ppu_sprite_row() inlined: the address is always inside 0-255 for
        # this loop, and the row is one floored modulo. Sprite evaluation walks up to 64 OAM
        # entries per line, so the two saved calls per entry matter.
        candidate_row = (target_scanline - (ppu_oam[candidate_address + 1] + 1)) % 256;

        if checking_overflow == 1 {
            if candidate_row < sprite_height {
                overflow_dot = 65 + elapsed_dots + 1;

                if overflow_dot <= 256 {
                    ppu_sprite_overflow_set_dot = overflow_dot;
                }

                evaluation_done = 1;
            } else {
                overflow_offset = (overflow_offset + 1) % PPU_BYTES_PER_SPRITE;
                elapsed_dots = elapsed_dots + 2;
            }
        } elif candidate_row >= sprite_height {
            elapsed_dots = elapsed_dots + 2;
        } else {
            slot_index = found_count + 1;
            ppu_secondary_sprite_y[slot_index] = ppu_oam[candidate_address + 1];
            ppu_secondary_sprite_row[slot_index] = candidate_row;
            ppu_secondary_sprite_oam_index[slot_index] = oam_index;
            ppu_secondary_sprite_tile[slot_index] = ppu_oam[candidate_address + 2];
            ppu_secondary_sprite_attributes[slot_index] = ppu_oam[candidate_address + 3];
            ppu_secondary_sprite_x[slot_index] = ppu_oam[candidate_address + 4];
            found_count = found_count + 1;
            elapsed_dots = elapsed_dots + 8;
        }

        oam_index = oam_index + 1;
    }

        ppu_secondary_sprite_count = found_count;
    }

    if target_scanline == 0 {
        ppu_line_zero_sprite_count = found_count;

        repeat PPU_SECONDARY_SPRITE_LIMIT {
            ppu_line_zero_sprite_y[copy_index] = to_number(ppu_secondary_sprite_y[copy_index]);
            ppu_line_zero_sprite_tile[copy_index] = to_number(ppu_secondary_sprite_tile[copy_index]);
            ppu_line_zero_sprite_attributes[copy_index] = to_number(ppu_secondary_sprite_attributes[copy_index]);
            ppu_line_zero_sprite_x[copy_index] = to_number(ppu_secondary_sprite_x[copy_index]);
            ppu_line_zero_sprite_oam_index[copy_index] = to_number(ppu_secondary_sprite_oam_index[copy_index]);
            ppu_line_zero_sprite_row[copy_index] = to_number(ppu_secondary_sprite_row[copy_index]);
            copy_index = copy_index + 1;
        }
    }
}

# Runs one dot of the eight-dot-per-slot sprite fetch from dot 257: two
# garbage nametable fetches, the attribute and X latches, and the two
# pattern fetches, which read a dummy all-$FF sprite for empty slots so
# the cartridge still observes the same pattern addresses.
proc ppu_clock_sprite_fetch {
    local elapsed_dots = ppu_dot - PPU_SPRITE_FETCH_START_DOT;
    local sprite_slot = elapsed_dots // PPU_SPRITE_FETCH_DOTS_PER_SLOT;
    local fetch_phase = elapsed_dots % PPU_SPRITE_FETCH_DOTS_PER_SLOT;
    local slot_index = sprite_slot + 1;
    local candidate_count = ppu_secondary_sprite_count;
    local candidate_found = 0;
    local candidate_tile = FULL_BYTE_MASK;
    local candidate_attributes = FULL_BYTE_MASK;
    local candidate_x = FULL_BYTE_MASK;
    local candidate_oam_index = PPU_NO_OAM_INDEX;
    local candidate_row = 0;
    local pattern_address = 0;
    local pattern_byte = 0;

    if ppu_scanline == PPU_PRE_RENDER_SCANLINE {
        candidate_count = ppu_line_zero_sprite_count;
    }

    if sprite_slot < candidate_count {
        candidate_found = 1;

        # The fields are bytes and OAM indexes; the lists hold them as text, and every use
        # below is arithmetic or a comparison, so no number cast is needed here.
        if ppu_scanline == PPU_PRE_RENDER_SCANLINE {
            candidate_tile = ppu_line_zero_sprite_tile[slot_index];
            candidate_attributes = ppu_line_zero_sprite_attributes[slot_index];
            candidate_x = ppu_line_zero_sprite_x[slot_index];
            candidate_oam_index = ppu_line_zero_sprite_oam_index[slot_index];
            candidate_row = ppu_line_zero_sprite_row[slot_index];
        } else {
            candidate_tile = ppu_secondary_sprite_tile[slot_index];
            candidate_attributes = ppu_secondary_sprite_attributes[slot_index];
            candidate_x = ppu_secondary_sprite_x[slot_index];
            candidate_oam_index = ppu_secondary_sprite_oam_index[slot_index];
            candidate_row = ppu_secondary_sprite_row[slot_index];
        }
    }

    if sprite_slot < PPU_SPRITE_FETCH_COUNT {
        if fetch_phase == PPU_SPRITE_GARBAGE_FETCH_PHASE_ONE or fetch_phase == PPU_SPRITE_GARBAGE_FETCH_PHASE_TWO {
            ppu_bus_read_nametable PPU_BACKGROUND_NAMETABLE_START + (ppu_vram_address % 4096);
        }

        if fetch_phase == 0 {
            if sprite_slot == 0 {
                # The slots about to be loaded are the ones the next visible line draws, so
                # the renderer's scan bound is captured here, once per line.
                ppu_sprite_unit_active_count = candidate_count;
            }

            ppu_sprite_unit_pattern_low[slot_index] = 0;
            ppu_sprite_unit_pattern_high[slot_index] = 0;
            ppu_sprite_unit_attributes[slot_index] = 0;
            ppu_sprite_unit_x_counter[slot_index] = FULL_BYTE_MASK;
            ppu_sprite_unit_oam_index[slot_index] = PPU_NO_OAM_INDEX;
        }

        if candidate_found == 1 and fetch_phase == PPU_SPRITE_FETCH_ATTRIBUTE_PHASE {
            ppu_sprite_unit_attributes[slot_index] = candidate_attributes;
            ppu_sprite_unit_oam_index[slot_index] = candidate_oam_index;
        }

        if candidate_found == 1 and fetch_phase == PPU_SPRITE_FETCH_X_PHASE {
            ppu_sprite_unit_x_counter[slot_index] = candidate_x;
        }

        if fetch_phase == PPU_SPRITE_FETCH_PATTERN_LOW_PHASE {
            pattern_address = ppu_sprite_pattern_address(
                ppu_control_register,
                candidate_tile,
                candidate_attributes,
                candidate_row
            );
            ppu_bus_read_pattern_window pattern_address;
            pattern_byte = ppu_bus_read_value;

            if candidate_found == 1 {
                if (candidate_attributes // PPU_SPRITE_FLIP_HORIZONTAL_MASK) % 2 == 1 {
                    pattern_byte = ppu_reverse_byte_bits(pattern_byte);
                }

                ppu_sprite_unit_pattern_low[slot_index] = pattern_byte;
            }
        }

        if fetch_phase == PPU_SPRITE_FETCH_PATTERN_HIGH_PHASE {
            pattern_address = ppu_sprite_pattern_address(
                ppu_control_register,
                candidate_tile,
                candidate_attributes,
                candidate_row
            );
            ppu_bus_read_pattern_window pattern_address + PPU_PATTERN_HIGH_PLANE_OFFSET;
            pattern_byte = ppu_bus_read_value;

            if candidate_found == 1 {
                if (candidate_attributes // PPU_SPRITE_FLIP_HORIZONTAL_MASK) % 2 == 1 {
                    pattern_byte = ppu_reverse_byte_bits(pattern_byte);
                }

                ppu_sprite_unit_pattern_high[slot_index] = pattern_byte;
            }
        }
    }
}

# ---- getters ----

func ppu_get_scanline() {
    return ppu_scanline;
}

func ppu_get_dot() {
    return ppu_dot;
}

func ppu_get_frame_number() {
    return ppu_frame_number;
}

func ppu_is_odd_frame() {
    return ppu_odd_frame;
}

func ppu_get_control_register() {
    return ppu_control_register;
}

func ppu_get_mask_register() {
    return ppu_mask_register;
}

func ppu_get_status_register() {
    return bitwise_and(ppu_status_register, PPU_STATUS_FLAGS_MASK);
}

func ppu_get_vram_address() {
    return ppu_vram_address;
}

func ppu_get_temporary_vram_address() {
    return ppu_temporary_vram_address;
}

func ppu_get_fine_x_scroll() {
    return ppu_fine_x_scroll;
}

func ppu_get_oam_address() {
    return ppu_oam_address;
}

func ppu_get_read_buffer() {
    return ppu_read_buffer;
}
