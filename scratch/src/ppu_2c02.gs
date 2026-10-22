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
# Dots clocked since ppu_reset, counted by ppu_run_dots. ppu_sync_to_cycle compares it with the
# CPU cycle count, so the PPU runs exactly as far ahead of the CPU as the reference's per-cycle
# scheduler does. ppu_next_cpu_event_dots bounds how far the CPU can run without an unsolicited
# PPU event (vblank/frame-ready or MMC3 IRQ) when no PPU/mapper/OAM bus access occurs.
var ppu_dots_clocked = 0;
var ppu_next_cpu_event_dots = 0;
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
# 32768 >> fine_x, plus its inverse multiplier 2 ^ fine_x so an eight-dot tile batch can
# pre-shift once and test >= 32768 across all eight pixels without per-pixel division.
var ppu_fine_x_weight = 32768;
var ppu_fine_x_mul = 1;

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

# The PPUCTRL fields the PPU reads outside a control write, cached by
# ppu_decode_control_register: the NMI enable the NMI-output refresher tests, and the VRAM
# increment the $2007 paths add.
var ppu_nmi_enabled = 0;
var ppu_vram_increment = 1;

# The background pattern table's base address, decoded from PPUCTRL. Every tile fetch read the
# same two bits and multiplied them by 4096, twice per tile per line.
var ppu_background_pattern_table = 0;

# The greyscale conversion of each six-bit color index, filled once per reset by
# ppu_greyscale_table_init so a greyscale frame reads a list instead of dividing per pixel.
list ppu_greyscale_colors = [0; 64];

# The bit-reversed form of every byte, at slot value + 1, filled once per reset by
# ppu_reverse_table_init. A horizontally flipped sprite needs its pattern byte reversed, and a
# 256-entry read replaces the eight-step shift loop that ran on every flipped fetch.
list ppu_reverse_byte_table = [0; 256];

# Whether the sprites loaded for the current line include sprite zero. Most lines do not, and
# a line without it can never set the hit flag, so the per-pixel test is two reads instead of
# an OAM index comparison on every sprite pixel.
var ppu_sprite_zero_in_line = 0;

# The pattern address the current sprite slot computed at its low-plane phase, reused at the
# high-plane phase instead of calling ppu_sprite_pattern_address a second time.
var ppu_sprite_fetch_pattern_address = 0;

# ---- framebuffer output ----

# The emphasis and backdrop terms the pixel path would otherwise recompute 61,440 times a
# frame. Both depend only on PPUMASK and palette RAM, so ppu_refresh_output_terms recomputes
# them when either is written: the emphasis term is the top three bits of PPUMASK times 64
# (the framebuffer's packing unit), and the backdrop is the greyscale-masked universal color,
# which is the whole picture whenever rendering is disabled.
var ppu_emphasis_packed = 0;
var ppu_backdrop_packed = 0;

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
# the display sprite to present the framebuffer. ppu_frames_ready_count counts
# completed visible frames at that exact dot for vblank-aligned frame pacing.
var ppu_frame_ready = 0;
var ppu_frames_ready_count = 0;

# ---- register error codes ----

var ppu_register_error = 0;

enum ppu_register_status {
    ok = 0,
    index_out_of_range = 1,
    value_out_of_range = 2
}

# Recomputes the two cached output terms. Mirrors what ppu_render_pixel would otherwise
# compute per pixel: the emphasis packing of the current PPUMASK, and the universal backdrop
# color after the greyscale mask.
proc ppu_refresh_output_terms {
    local backdrop = ppu_palette_color[1] + "";

    ppu_emphasis_packed = ppu_mask_emphasis * 64;

    if ppu_mask_greyscale == 1 {
        backdrop = ((backdrop // 16) % 4) * 16;
    }

    ppu_backdrop_packed = ppu_emphasis_packed + backdrop;
}

# ---- reset ----

# Resets PPU registers, timing, and pipeline state without erasing VRAM,
# OAM, or cartridge RAM. Mirrors Ppu2C02.reset().
proc ppu_reset {
    ppu_control_register = 0;
    ppu_mask_register = 0;
    ppu_decode_mask_register;
    ppu_decode_control_register;
    ppu_greyscale_table_init;
    ppu_reverse_table_init;
    ppu_sprite_zero_in_line = 0;
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
    ppu_dots_clocked = 0;
    ppu_next_cpu_event_dots = 0;
    ppu_frame_number = 0;
    ppu_frames_ready_count = 0;
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
    ppu_fine_x_mul = 1;
    ppu_sprite_unit_active_count = 0;
    ppu_secondary_sprite_count = 0;
    ppu_line_zero_sprite_count = 0;
    ppu_sprite_overflow_set_dot = PPU_NO_OVERFLOW_DOT;
    ppu_reset_sprite_units;
    ppu_clear_frame_output;
    ppu_refresh_output_terms;
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

# Lowers the frame-ready flag at reset.
#
# This used to zero all 61,440 framebuffer slots, mirroring PpuFramebuffer.clear(). The clear
# is dead work in this port: every visible dot writes its slot, whether rendering is on (the
# pixel proc) or off (the backdrop fill in ppu_run_dots), and the display sprite only draws
# when ppu_frame_ready is raised at the vblank-start dot of a frame that has just written every
# row. A reset therefore cannot leave a stale row on screen, and the boot no longer spends
# 61,440 list writes before it reads its first opcode.
proc ppu_clear_frame_output {
    ppu_frame_ready = 0;
}

# Fills the byte-reversal table: eight shifts per entry, 256 entries, once per reset.
proc ppu_reverse_table_init {
    local value = 0;
    local remaining = 0;
    local reversed = 0;

    until value == 256 {
        remaining = value;
        reversed = 0;

        repeat 8 {
            reversed = (reversed * 2) + (remaining % 2);
            remaining = remaining // 2;
        }

        ppu_reverse_byte_table[value + 1] = reversed;
        value = value + 1;
    }
}

# Fills the greyscale table: a six-bit color index with its low four bits cleared by the
# PPUMASK greyscale bit. 64 iterations per reset replace two divisions and a multiply on every
# pixel of a greyscale frame.
proc ppu_greyscale_table_init {
    local index = 0;

    until index == 64 {
        ppu_greyscale_colors[index + 1] = ((index // 16) % 4) * 16;
        index = index + 1;
    }
}

# ---- status flag helpers ----

# Sets or clears one PPUSTATUS flag bit, masking to the three high flags.
proc ppu_set_status_flag flag, active {
    if $active != 0 {
        ppu_status_register = ppu_status_register + $flag;
    } else {
        ppu_status_register = ppu_status_register - (ppu_status_register % ($flag * 2) - ppu_status_register % $flag);
    }

    # The mask is $E0 and the byte is normalized, so clearing the low five bits is one
    # subtraction; the two bitwise_and calls this replaces were a call, two modulos, and two
    # list reads each.
    ppu_status_register = (ppu_status_register % 256) - ((ppu_status_register % 256) % 32);
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
    # The status byte is eight bits and the vblank flag is bit 7, so its state is one
    # division and the flag is set or cleared with one addition or subtraction. The three
    # high bits are the only ones PPUSTATUS exposes, and the byte is normalized by every
    # writer, so the mask this used to apply with bitwise_and is a modulo here.
    local was_set = ppu_status_register // PPU_VBLANK_FLAG;

    if $active != 0 and was_set == 0 {
        ppu_status_register = ppu_status_register + PPU_VBLANK_FLAG;
    } elif $active == 0 and was_set == 1 {
        ppu_status_register = ppu_status_register - PPU_VBLANK_FLAG;
    }

    ppu_refresh_nmi_output;
}

# Sets or clears the sprite-zero-hit status bit.
proc ppu_set_sprite_zero_hit active {
    local was_set = (ppu_status_register // PPU_SPRITE_ZERO_HIT_FLAG) % 2;

    if $active != 0 and was_set == 0 {
        ppu_status_register = ppu_status_register + PPU_SPRITE_ZERO_HIT_FLAG;
    } elif $active == 0 and was_set == 1 {
        ppu_status_register = ppu_status_register - PPU_SPRITE_ZERO_HIT_FLAG;
    }
}

# Sets or clears the sprite-overflow status bit.
proc ppu_set_sprite_overflow active {
    local was_set = (ppu_status_register // PPU_SPRITE_OVERFLOW_FLAG) % 2;

    if $active != 0 and was_set == 0 {
        ppu_status_register = ppu_status_register + PPU_SPRITE_OVERFLOW_FLAG;
    } elif $active == 0 and was_set == 1 {
        ppu_status_register = ppu_status_register - PPU_SPRITE_OVERFLOW_FLAG;
    }
}

# Recomputes the level-sensitive NMI output from the control register's
# NMI-enable bit and the vblank flag, latching a rising edge.
proc ppu_refresh_nmi_output {
    local next_output = 0;

    # Both bits are already decoded: ppu_nmi_enabled is cached by ppu_decode_control_register
    # and the vblank flag is bit 7 of a normalized status byte.
    if ppu_nmi_enabled == 1 and ppu_status_register // PPU_VBLANK_FLAG % 2 == 1 {
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
    local status_byte = (ppu_status_register + "") % 256;
    local flags = status_byte - (status_byte % 32);
    local latch_low = (ppu_io_latch + "") % 32;

    if ppu_scanline == PPU_VBLANK_FIRST_SCANLINE and ppu_dot <= PPU_VBLANK_START_DOT {
        ppu_suppress_vblank_start = 1;
    }

    ppu_read_result = flags + latch_low;
    ppu_write_toggle = 0;
    ppu_io_latch = ppu_read_result;

    if status_byte >= 128 {
        ppu_status_register = status_byte - 128;
        ppu_refresh_nmi_output;
    }
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

        # The four masks of the palette read, written as the modulo forms of their mask-plus-one
        # divisors: $0F keeps the high nibble, $3F keeps six bits, and $C0 keeps the two open-bus
        # bits the I/O latch contributes, which is the latch minus its low six bits.
        if ppu_mask_register % 2 == 0 {
            greyscale_value = palette_value;
        } else {
            greyscale_value = palette_value - (palette_value % 16);
        }

        value = (greyscale_value % 64) + (ppu_io_latch - (ppu_io_latch % 64));

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

    ppu_refresh_output_terms;
    ppu_update_next_cpu_event;
}

# Decodes the two PPUCTRL fields the PPU reads outside a register write: the NMI enable the
# NMI-output refresher tests and the VRAM increment the $2007 paths add. One write per $2000
# access replaces a divide and a modulo inside the vblank start of every field, on every
# $2007 access, and inside every NMI-output refresh.
proc ppu_decode_control_register {
    ppu_nmi_enabled = (ppu_control_register // PPU_CONTROL_NMI_ENABLE) % 2;
    ppu_background_pattern_table = (ppu_control_register // PPU_BACKGROUND_PATTERN_TABLE_SELECT) % 2 * 4096;

    if (ppu_control_register // PPU_CONTROL_VRAM_INCREMENT) % 2 == 1 {
        ppu_vram_increment = 32;
    } else {
        ppu_vram_increment = 1;
    }

    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
        ppu_update_next_cpu_event;
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
    ppu_decode_control_register;
    ppu_refresh_nmi_output;
}

# PPUSCROLL: two-write toggle sets fine X on the first write and fine Y /
# coarse Y on the second.
proc ppu_write_scroll_register value {
    local fine_x = 0;
    local weight = 0;
    local mul = 0;
    local coarse_x = 0;
    local preserved = 0;
    local fine_y = 0;
    local coarse_y = 0;
    local temporary = 0;

    if ppu_write_toggle == 0 {
        # The fine-X mask is $07; its modulo form divides by 8, not by the mask value.
        fine_x = $value % 8;
        ppu_fine_x_scroll = fine_x;

        # The shift register weight and multiplier the renderer reads for this fine X, built
        # once here so the pixel loop never has to halve or double a weight per pixel.
        weight = 32768;
        mul = 1;

        repeat fine_x {
            weight = weight // 2;
            mul = mul * 2;
        }

        ppu_fine_x_weight = weight;
        ppu_fine_x_mul = mul;
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
        if ppu_bus_mapper_kind == mapper_kind.mmc3 {
            ppu_bus_observe_ppu_address ppu_vram_address % 16384;
            ppu_update_next_cpu_event;
        }
    }
}

# PPUDATA: writes through the PPU bus and increments the VRAM address.
proc ppu_write_data_register value {
    local target_address = ppu_vram_address % 16384;

    ppu_bus_write_ppu target_address, $value;

    # A palette write can change the universal backdrop color, which the disabled-rendering
    # fill and the pixel path read from one cached value instead of a palette read per pixel.
    if target_address >= 16128 {
        ppu_refresh_output_terms;
    }

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
    ppu_vram_address = (ppu_vram_address + ppu_vram_increment) % 32768;

    # NROM has no observer, so the call is skipped instead of entering a proc that would only
    # test the board kind. The address is already masked to fourteen bits.
    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
        ppu_bus_observe_ppu_address ppu_vram_address % 16384;
        ppu_update_next_cpu_event;
    }
}

# ---- timing ----

# Clocks one PPU dot: the one-dot entry point kept for the self test and for any caller that
# advances the PPU by a single dot. The frame loop uses ppu_run_dots below, which is the same
# body without a custom-block call per dot.
proc ppu_clock_ppu_dot {
    ppu_run_dots 1;
}

# Reads the winning sprite pixel for the current column and advances all active sprite output
# units one column in a single pass over 1..ppu_sprite_unit_active_count. Kept in lockstep
# with ppu_read_sprite_pixel followed by ppu_clock_sprite_output_units.
proc ppu_step_sprite_pixel {
    local unit_index = 1;
    local x_counter = 0;
    local pattern_low = 0;
    local pattern_high = 0;
    local unit_pixel = 0;

    ppu_sprite_pixel_found = 0;
    ppu_sprite_pixel_value = 0;
    ppu_sprite_pixel_attributes = 0;
    ppu_sprite_pixel_oam_index = -1;

    repeat ppu_sprite_unit_active_count {
        x_counter = ppu_sprite_unit_x_counter[unit_index] + "";

        if x_counter > 0 {
            ppu_sprite_unit_x_counter[unit_index] = x_counter - 1;
        } else {
            pattern_low = ppu_sprite_unit_pattern_low[unit_index] + "";
            pattern_high = ppu_sprite_unit_pattern_high[unit_index] + "";

            if ppu_sprite_pixel_found == 0 {
                unit_pixel = 0;

                if pattern_low >= 128 {
                    unit_pixel = 1;
                }

                if pattern_high >= 128 {
                    unit_pixel = unit_pixel + 2;
                }

                if unit_pixel != 0 {
                    ppu_sprite_pixel_found = 1;
                    ppu_sprite_pixel_value = unit_pixel;
                    ppu_sprite_pixel_attributes = ppu_sprite_unit_attributes[unit_index] + "";
                    ppu_sprite_pixel_oam_index = ppu_sprite_unit_oam_index[unit_index] + "";
                }
            }

            ppu_sprite_unit_pattern_low[unit_index] = (pattern_low % 128) * 2;
            ppu_sprite_unit_pattern_high[unit_index] = (pattern_high % 128) * 2;
        }

        unit_index = unit_index + 1;
    }
}

# Fetches one eight-dot background tile (nametable byte, attribute bits, and low/high pattern
# planes with exact MMC3 A12 low-dot spacing), loads the four background shift registers, and
# advances coarse X. Used by the visible eight-dot tile batch and the two HBlank prefetch tiles.
proc ppu_fetch_tile_into_shifters shift_eight {
    local vram_low12 = ppu_vram_address % 4096;
    local logical_table = vram_low12 // 1024;
    local offset_1024 = vram_low12 - (logical_table * 1024);
    local mirroring = 1;
    local nt_base = 0;
    local coarse_x = offset_1024 % 32;
    local coarse_y = offset_1024 // 32;
    local tile = 0;
    local attr_byte = 0;
    local attr_shift = 0;
    local attr = 0;
    local fine_y = (ppu_vram_address // 4096) % 8;
    local pat_addr = 0;
    local pat_low = 0;
    local pat_high = 0;
    local attr_low_fill = 0;
    local attr_high_fill = 0;
    local v_base = 0;

    if ppu_bus_mapper_kind == mapper_kind.nrom {
        mirroring = cartridge_mirroring;
    } elif ppu_bus_mapper_kind == mapper_kind.mmc3 {
        mirroring = mmc3_mirroring;
    }

    if mirroring == 2 {
        nt_base = (logical_table % 2) * 1024;
    } elif mirroring == 3 {
        nt_base = logical_table * 1024;
    } else {
        nt_base = (logical_table // 2) * 1024;
    }

    tile = ppu_nametable_ram[nt_base + offset_1024 + 1] + "";
    ppu_next_background_tile = tile;

    attr_byte = ppu_nametable_ram[nt_base + 960 + ((coarse_y // 4) * 8) + (coarse_x // 4) + 1] + "";
    attr_shift = (((coarse_y // 2) % 2) * 4) + (((coarse_x // 2) % 2) * 2);
    attr = (attr_byte // ppu_attribute_shift_divisors[attr_shift + 1]) % 4;
    ppu_next_background_attribute = attr;

    pat_addr = ppu_background_pattern_table + (tile * 16) + fine_y;

    if ppu_bus_mapper_kind == mapper_kind.nrom and cartridge_chr_rom_bytes > 0 {
        ppu_bus_pattern_mapped = 1;
        pat_low = nrom_chr_rom[pat_addr + 1] + "";
        pat_high = nrom_chr_rom[pat_addr + 9] + "";
        ppu_bus_read_value = pat_high;
    } else {
        if ppu_bus_mapper_kind == mapper_kind.mmc3 {
            # Across an 8-dot tile (8k+1..8k+8), the nametable fetch at 8k+2 drives A12=0 after
            # two mapper dot ticks, leaving four low-dot ticks (8k+3..8k+6) before pat_low when
            # A12 entered high, or six cumulative ticks when A12 entered low.
            if mmc3_ppu_a12_high == 1 {
                mmc3_ppu_a12_high = 0;
                mmc3_a12_low_dots = 4;
            } else {
                mmc3_a12_low_dots = mmc3_a12_low_dots + 6;
                if mmc3_a12_low_dots > mmc3_limit.a12_filter_dots {
                    mmc3_a12_low_dots = mmc3_limit.a12_filter_dots;
                }
            }
        }

        ppu_bus_read_pattern_window pat_addr;
        pat_low = ppu_bus_read_value + "";

        if ppu_bus_mapper_kind == mapper_kind.mmc3 {
            if mmc3_ppu_a12_high == 0 {
                mmc3_a12_low_dots = mmc3_a12_low_dots + 2;
                if mmc3_a12_low_dots > mmc3_limit.a12_filter_dots {
                    mmc3_a12_low_dots = mmc3_limit.a12_filter_dots;
                }
            }
        }

        ppu_bus_read_pattern_window pat_addr + 8;
        pat_high = ppu_bus_read_value + "";
    }

    ppu_next_background_pattern_low = pat_low;
    ppu_next_background_pattern_high = pat_high;

    attr_low_fill = (attr % 2) * 255;
    attr_high_fill = ((attr // 2) % 2) * 255;

    if ($shift_eight + "") == 1 {
        ppu_background_pattern_low_shift = ((ppu_background_pattern_low_shift % 256) * 256) + pat_low;
        ppu_background_pattern_high_shift = ((ppu_background_pattern_high_shift % 256) * 256) + pat_high;
        ppu_background_attribute_low_shift = ((ppu_background_attribute_low_shift % 256) * 256) + attr_low_fill;
        ppu_background_attribute_high_shift = ((ppu_background_attribute_high_shift % 256) * 256) + attr_high_fill;
    } else {
        ppu_background_pattern_low_shift = (ppu_background_pattern_low_shift
            - (ppu_background_pattern_low_shift % 256)) + pat_low;
        ppu_background_pattern_high_shift = (ppu_background_pattern_high_shift
            - (ppu_background_pattern_high_shift % 256)) + pat_high;
        ppu_background_attribute_low_shift = (ppu_background_attribute_low_shift
            - (ppu_background_attribute_low_shift % 256)) + attr_low_fill;
        ppu_background_attribute_high_shift = (ppu_background_attribute_high_shift
            - (ppu_background_attribute_high_shift % 256)) + attr_high_fill;
    }

    v_base = ppu_vram_address % 32768;

    if coarse_x == 31 {
        if ((v_base // 1024) % 2) == 0 {
            ppu_vram_address = (v_base - 31) + 1024;
        } else {
            ppu_vram_address = (v_base - 31) - 1024;
        }
    } else {
        ppu_vram_address = v_base + 1;
    }
}

# Batches the entire rendered HBlank interval starting at dot 257 through the end of the
# scanline (84 dots normally, or 83 dots when the odd-frame pre-render dot 340 is skipped):
# transfers horizontal/vertical scroll bits, loads the eight sprite output units with exact
# MMC3 A12 observation, prefetches the first two background tiles of the next scanline, and
# wraps to dot 0 of the following scanline.
proc ppu_run_hblank_batch hblank_dots {
    local candidate_count = ppu_secondary_sprite_count;
    local slot_index = 1;
    local candidate_found = 0;
    local candidate_tile = 255;
    local candidate_attributes = 255;
    local candidate_x = 255;
    local candidate_oam_index = -1;
    local candidate_row = 0;
    local pattern_address = 0;
    local pattern_low = 0;
    local pattern_high = 0;
    local trailing_dots = $hblank_dots - 80;

    ppu_oam_address = 0;
    ppu_vram_address = ppu_transfer_horizontal_for(ppu_vram_address, ppu_temporary_vram_address);

    if ppu_scanline == 261 {
        ppu_vram_address = ppu_transfer_vertical_for(ppu_vram_address, ppu_temporary_vram_address);
        candidate_count = ppu_line_zero_sprite_count;
    }

    ppu_sprite_unit_active_count = candidate_count;
    ppu_sprite_zero_in_line = 0;

    if candidate_count > 0 or ppu_bus_mapper_kind == mapper_kind.mmc3 {
        repeat 8 {
            if slot_index <= candidate_count {
                candidate_found = 1;

                if ppu_scanline == 261 {
                    candidate_tile = ppu_line_zero_sprite_tile[slot_index] + "";
                    candidate_attributes = ppu_line_zero_sprite_attributes[slot_index] + "";
                    candidate_x = ppu_line_zero_sprite_x[slot_index] + "";
                    candidate_oam_index = ppu_line_zero_sprite_oam_index[slot_index] + "";
                    candidate_row = ppu_line_zero_sprite_row[slot_index] + "";
                } else {
                    candidate_tile = ppu_secondary_sprite_tile[slot_index] + "";
                    candidate_attributes = ppu_secondary_sprite_attributes[slot_index] + "";
                    candidate_x = ppu_secondary_sprite_x[slot_index] + "";
                    candidate_oam_index = ppu_secondary_sprite_oam_index[slot_index] + "";
                    candidate_row = ppu_secondary_sprite_row[slot_index] + "";
                }
            } else {
                candidate_found = 0;
                candidate_tile = 255;
                candidate_attributes = 255;
                candidate_x = 255;
                candidate_oam_index = -1;
                candidate_row = 0;
            }

            if candidate_found == 1 or ppu_bus_mapper_kind == mapper_kind.mmc3 {
                pattern_address = ppu_sprite_pattern_address(
                    ppu_control_register,
                    candidate_tile,
                    candidate_attributes,
                    candidate_row
                );
                ppu_sprite_fetch_pattern_address = pattern_address;

                if ppu_bus_mapper_kind == mapper_kind.nrom and cartridge_chr_rom_bytes > 0 {
                    ppu_bus_pattern_mapped = 1;
                    pattern_low = nrom_chr_rom[pattern_address + 1] + "";
                    pattern_high = nrom_chr_rom[pattern_address + 9] + "";
                    ppu_bus_read_value = pattern_high;
                } else {
                    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
                        # Garbage nametable fetch #1 at phase 1 (258+8s) drives A12=0 after two
                        # mapper dot ticks, leaving four low-dot ticks (phases 2..5) before
                        # pattern_low when A12 entered high, or six ticks when A12 entered low.
                        if mmc3_ppu_a12_high == 1 {
                            mmc3_ppu_a12_high = 0;
                            mmc3_a12_low_dots = 4;
                        } else {
                            mmc3_a12_low_dots = mmc3_a12_low_dots + 6;
                            if mmc3_a12_low_dots > mmc3_limit.a12_filter_dots {
                                mmc3_a12_low_dots = mmc3_limit.a12_filter_dots;
                            }
                        }
                    }

                    ppu_bus_read_pattern_window pattern_address;
                    pattern_low = ppu_bus_read_value + "";

                    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
                        if mmc3_ppu_a12_high == 0 {
                            mmc3_a12_low_dots = mmc3_a12_low_dots + 2;
                            if mmc3_a12_low_dots > mmc3_limit.a12_filter_dots {
                                mmc3_a12_low_dots = mmc3_limit.a12_filter_dots;
                            }
                        }
                    }

                    ppu_bus_read_pattern_window pattern_address + 8;
                    pattern_high = ppu_bus_read_value + "";
                }

                if candidate_found == 1 {
                    if (candidate_attributes // 64) % 2 == 1 {
                        pattern_low = ppu_reverse_byte_table[pattern_low + 1] + "";
                        pattern_high = ppu_reverse_byte_table[pattern_high + 1] + "";
                    }

                    ppu_sprite_unit_pattern_low[slot_index] = pattern_low;
                    ppu_sprite_unit_pattern_high[slot_index] = pattern_high;
                    ppu_sprite_unit_attributes[slot_index] = candidate_attributes;
                    ppu_sprite_unit_x_counter[slot_index] = candidate_x;
                    ppu_sprite_unit_oam_index[slot_index] = candidate_oam_index;

                    if candidate_oam_index == 0 {
                        ppu_sprite_zero_in_line = 1;
                    }
                } else {
                    ppu_sprite_unit_pattern_low[slot_index] = 0;
                    ppu_sprite_unit_pattern_high[slot_index] = 0;
                    ppu_sprite_unit_attributes[slot_index] = 0;
                    ppu_sprite_unit_x_counter[slot_index] = 255;
                    ppu_sprite_unit_oam_index[slot_index] = -1;
                }
            } else {
                ppu_sprite_unit_pattern_low[slot_index] = 0;
                ppu_sprite_unit_pattern_high[slot_index] = 0;
                ppu_sprite_unit_attributes[slot_index] = 0;
                ppu_sprite_unit_x_counter[slot_index] = 255;
                ppu_sprite_unit_oam_index[slot_index] = -1;
            }

            slot_index = slot_index + 1;
        }
    }

    ppu_fetch_tile_into_shifters ppu_mask_background_enable;
    ppu_fetch_tile_into_shifters ppu_mask_background_enable;

    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
        # Dummy nametable fetch #1 at dot 338 drives A12=0 after dots 337..338, leaving
        # (trailing_dots - 2) low-dot ticks across dot 339 (and dot 340 when not skipped).
        if mmc3_ppu_a12_high == 1 {
            mmc3_ppu_a12_high = 0;
            mmc3_a12_low_dots = trailing_dots - 2;
        } else {
            mmc3_a12_low_dots = mmc3_a12_low_dots + trailing_dots;
            if mmc3_a12_low_dots > mmc3_limit.a12_filter_dots {
                mmc3_a12_low_dots = mmc3_limit.a12_filter_dots;
            }
        }
    }

    ppu_dot = 0;

    if ppu_scanline == 261 {
        ppu_scanline = 0;
        ppu_framebuffer_row_base = 0;
    } else {
        ppu_scanline = ppu_scanline + 1;
        ppu_framebuffer_row_base = ppu_framebuffer_row_base + 256;
    }
}

# Clocks `count` consecutive PPU dots in one call: applies vblank timing, renders each dot's
# pixel, runs the fetch pipeline, then advances dot/scanline, in the reference order.
#
# When `dots_remaining` covers a full idle/blanking span, an eight-dot aligned visible tile, or
# the 83/84-dot HBlank window, dedicated fast paths advance those spans in bulk while keeping
# MMC3 A12 timing, sprite evaluation, sprite-zero hit, and shifter state identical to the
# one-dot body below, which handles all unaligned and single-dot boundaries.
proc ppu_run_dots count {
    local dots_remaining = $count + "";

    # The temporaries of the batched and one-dot pixel bodies, declared once per call.
    local pixel_x = 0;
    local background_pixel = 0;
    local background_palette = 0;
    local fine_weight = 0;
    local palette_offset = 0;
    local color_index = 0;
    local line_rem = 0;
    local hblank_len = 0;
    local fb_idx = 0;
    local lo_shift = 0;
    local hi_shift = 0;
    local alo_shift = 0;
    local ahi_shift = 0;
    local bg_px = 0;
    local bg_pal = 0;
    local tile_start_dot = 0;
    local bg_left_ok = 0;
    local sp_left_ok = 0;
    local sp_tile_overlap = 0;
    local sp_unit = 0;
    local sp_x = 0;

    until dots_remaining <= 0 {
        if ppu_scanline >= 240 and ppu_scanline < 261 and (ppu_scanline != 241 or ppu_dot >= 2) {
            line_rem = 341 - ppu_dot;

            if dots_remaining >= line_rem {
                if ppu_bus_mapper_kind == mapper_kind.mmc3 {
                    if mmc3_ppu_a12_high == 0 {
                        mmc3_a12_low_dots = mmc3_a12_low_dots + line_rem;
                        if mmc3_a12_low_dots > 10 {
                            mmc3_a12_low_dots = 10;
                        }
                    }
                }

                ppu_dot = 0;
                ppu_scanline = ppu_scanline + 1;
                ppu_framebuffer_row_base = ppu_framebuffer_row_base + 256;

                if ppu_scanline == 261 {
                    ppu_frame_number = ppu_frame_number + 1;
                    ppu_odd_frame = ppu_frame_number % 2;
                }

                dots_remaining = dots_remaining - line_rem;
            } else {
                if ppu_bus_mapper_kind == mapper_kind.mmc3 {
                    if mmc3_ppu_a12_high == 0 {
                        mmc3_a12_low_dots = mmc3_a12_low_dots + dots_remaining;
                        if mmc3_a12_low_dots > 10 {
                            mmc3_a12_low_dots = 10;
                        }
                    }
                }

                ppu_dot = ppu_dot + dots_remaining;
                dots_remaining = 0;
            }
        } elif ppu_mask_rendering_enable == 0 and ppu_scanline == 261 and ppu_dot >= 2 {
            line_rem = 341 - ppu_dot;

            if dots_remaining >= line_rem {
                if ppu_bus_mapper_kind == mapper_kind.mmc3 {
                    if mmc3_ppu_a12_high == 0 {
                        mmc3_a12_low_dots = mmc3_a12_low_dots + line_rem;
                        if mmc3_a12_low_dots > 10 {
                            mmc3_a12_low_dots = 10;
                        }
                    }
                }

                ppu_dot = 0;
                ppu_scanline = 0;
                ppu_framebuffer_row_base = 0;
                dots_remaining = dots_remaining - line_rem;
            } else {
                if ppu_bus_mapper_kind == mapper_kind.mmc3 {
                    if mmc3_ppu_a12_high == 0 {
                        mmc3_a12_low_dots = mmc3_a12_low_dots + dots_remaining;
                        if mmc3_a12_low_dots > 10 {
                            mmc3_a12_low_dots = 10;
                        }
                    }
                }

                ppu_dot = ppu_dot + dots_remaining;
                dots_remaining = 0;
            }
        } elif ppu_mask_rendering_enable == 0 and ppu_scanline < 240 and ppu_dot >= 257 {
            line_rem = 341 - ppu_dot;

            if dots_remaining >= line_rem {
                if ppu_bus_mapper_kind == mapper_kind.mmc3 {
                    if mmc3_ppu_a12_high == 0 {
                        mmc3_a12_low_dots = mmc3_a12_low_dots + line_rem;
                        if mmc3_a12_low_dots > 10 {
                            mmc3_a12_low_dots = 10;
                        }
                    }
                }

                ppu_dot = 0;
                ppu_scanline = ppu_scanline + 1;
                ppu_framebuffer_row_base = ppu_framebuffer_row_base + 256;
                dots_remaining = dots_remaining - line_rem;
            } else {
                if ppu_bus_mapper_kind == mapper_kind.mmc3 {
                    if mmc3_ppu_a12_high == 0 {
                        mmc3_a12_low_dots = mmc3_a12_low_dots + dots_remaining;
                        if mmc3_a12_low_dots > 10 {
                            mmc3_a12_low_dots = 10;
                        }
                    }
                }

                ppu_dot = ppu_dot + dots_remaining;
                dots_remaining = 0;
            }
        } elif ppu_mask_rendering_enable == 0
            and ppu_scanline < 240
            and ppu_dot >= 1
            and ppu_dot <= 249
            and dots_remaining >= 8 {
            fb_idx = ppu_framebuffer_row_base + ppu_dot;
            ppu_framebuffer_packed[fb_idx] = ppu_backdrop_packed;
            ppu_framebuffer_packed[fb_idx + 1] = ppu_backdrop_packed;
            ppu_framebuffer_packed[fb_idx + 2] = ppu_backdrop_packed;
            ppu_framebuffer_packed[fb_idx + 3] = ppu_backdrop_packed;
            ppu_framebuffer_packed[fb_idx + 4] = ppu_backdrop_packed;
            ppu_framebuffer_packed[fb_idx + 5] = ppu_backdrop_packed;
            ppu_framebuffer_packed[fb_idx + 6] = ppu_backdrop_packed;
            ppu_framebuffer_packed[fb_idx + 7] = ppu_backdrop_packed;

            if ppu_bus_mapper_kind == mapper_kind.mmc3 {
                if mmc3_ppu_a12_high == 0 {
                    mmc3_a12_low_dots = mmc3_a12_low_dots + 8;
                    if mmc3_a12_low_dots > 10 {
                        mmc3_a12_low_dots = 10;
                    }
                }
            }

            ppu_dot = ppu_dot + 8;
            dots_remaining = dots_remaining - 8;
        } elif ppu_mask_rendering_enable == 1
            and ppu_scanline < 240
            and ppu_dot <= 249
            and (ppu_dot % 8) == 1
            and dots_remaining >= 8 {
            tile_start_dot = ppu_dot + "";
            fb_idx = (ppu_framebuffer_row_base + "") + tile_start_dot;
            sp_tile_overlap = 0;

            if (ppu_sprite_unit_active_count + "") > 0 {
                sp_unit = 1;

                repeat ppu_sprite_unit_active_count + "" {
                    if (ppu_sprite_unit_x_counter[sp_unit] + "") < 8 {
                        if (ppu_sprite_unit_pattern_low[sp_unit] + "") != 0
                            or (ppu_sprite_unit_pattern_high[sp_unit] + "") != 0 {
                            sp_tile_overlap = 1;
                        }
                    }

                    sp_unit = sp_unit + 1;
                }
            }

            if sp_tile_overlap == 0
                and (ppu_mask_greyscale + "") == 0
                and (tile_start_dot >= 9 or (ppu_mask_background_left_column_enable + "") == 1) {
                if (ppu_sprite_unit_active_count + "") > 0 {
                    sp_unit = 1;

                    repeat ppu_sprite_unit_active_count + "" {
                        sp_x = ppu_sprite_unit_x_counter[sp_unit] + "";

                        if sp_x >= 8 {
                            ppu_sprite_unit_x_counter[sp_unit] = sp_x - 8;
                        } else {
                            ppu_sprite_unit_x_counter[sp_unit] = 0;
                        }

                        sp_unit = sp_unit + 1;
                    }

                    ppu_sprite_pixel_found = 0;
                    ppu_sprite_pixel_value = 0;
                    ppu_sprite_pixel_attributes = 0;
                    ppu_sprite_pixel_oam_index = -1;
                }
                if ppu_mask_background_enable == 1 {
                    if ppu_fine_x_mul == 1
                        and (ppu_background_attribute_low_shift < 256 or ppu_background_attribute_low_shift >= 65280)
                        and (ppu_background_attribute_high_shift < 256
                            or ppu_background_attribute_high_shift >= 65280) {
                        lo_shift = ppu_background_pattern_low_shift;
                        hi_shift = ppu_background_pattern_high_shift;
                        bg_pal = 0;

                        if ppu_background_attribute_low_shift >= 32768 {
                            bg_pal = 4;
                        }

                        if ppu_background_attribute_high_shift >= 32768 {
                            bg_pal = bg_pal + 8;
                        }

                        repeat 8 {
                            bg_px = 0;

                            if lo_shift >= 32768 {
                                bg_px = 1;
                                lo_shift = (lo_shift - 32768) * 2;
                            } else {
                                lo_shift = lo_shift * 2;
                            }

                            if hi_shift >= 32768 {
                                bg_px = bg_px + 2;
                                hi_shift = (hi_shift - 32768) * 2;
                            } else {
                                hi_shift = hi_shift * 2;
                            }

                            if bg_px == 0 {
                                ppu_framebuffer_packed[fb_idx] = ppu_backdrop_packed;
                            } else {
                                ppu_framebuffer_packed[fb_idx] = ppu_emphasis_packed
                                    + ppu_palette_color[bg_pal + bg_px + 1];
                            }

                            fb_idx = fb_idx + 1;
                        }
                    } else {
                        lo_shift = (ppu_background_pattern_low_shift * ppu_fine_x_mul) % 65536;
                        hi_shift = (ppu_background_pattern_high_shift * ppu_fine_x_mul) % 65536;
                        alo_shift = (ppu_background_attribute_low_shift * ppu_fine_x_mul) % 65536;
                        ahi_shift = (ppu_background_attribute_high_shift * ppu_fine_x_mul) % 65536;

                        repeat 8 {
                            bg_px = 0;

                            if lo_shift >= 32768 {
                                bg_px = 1;
                                lo_shift = (lo_shift - 32768) * 2;
                            } else {
                                lo_shift = lo_shift * 2;
                            }

                            if hi_shift >= 32768 {
                                bg_px = bg_px + 2;
                                hi_shift = (hi_shift - 32768) * 2;
                            } else {
                                hi_shift = hi_shift * 2;
                            }

                            if bg_px == 0 {
                                if alo_shift >= 32768 {
                                    alo_shift = (alo_shift - 32768) * 2;
                                } else {
                                    alo_shift = alo_shift * 2;
                                }

                                if ahi_shift >= 32768 {
                                    ahi_shift = (ahi_shift - 32768) * 2;
                                } else {
                                    ahi_shift = ahi_shift * 2;
                                }

                                ppu_framebuffer_packed[fb_idx] = ppu_backdrop_packed;
                            } else {
                                palette_offset = bg_px;

                                if alo_shift >= 32768 {
                                    palette_offset = palette_offset + 4;
                                    alo_shift = (alo_shift - 32768) * 2;
                                } else {
                                    alo_shift = alo_shift * 2;
                                }

                                if ahi_shift >= 32768 {
                                    palette_offset = palette_offset + 8;
                                    ahi_shift = (ahi_shift - 32768) * 2;
                                } else {
                                    ahi_shift = ahi_shift * 2;
                                }

                                ppu_framebuffer_packed[fb_idx] = ppu_emphasis_packed
                                    + ppu_palette_color[palette_offset + 1];
                            }

                            fb_idx = fb_idx + 1;
                        }
                    }
                } else {
                    ppu_framebuffer_packed[fb_idx] = ppu_backdrop_packed;
                    ppu_framebuffer_packed[fb_idx + 1] = ppu_backdrop_packed;
                    ppu_framebuffer_packed[fb_idx + 2] = ppu_backdrop_packed;
                    ppu_framebuffer_packed[fb_idx + 3] = ppu_backdrop_packed;
                    ppu_framebuffer_packed[fb_idx + 4] = ppu_backdrop_packed;
                    ppu_framebuffer_packed[fb_idx + 5] = ppu_backdrop_packed;
                    ppu_framebuffer_packed[fb_idx + 6] = ppu_backdrop_packed;
                    ppu_framebuffer_packed[fb_idx + 7] = ppu_backdrop_packed;
                }
            } else {
                lo_shift = (ppu_background_pattern_low_shift * ppu_fine_x_mul) % 65536;
                hi_shift = (ppu_background_pattern_high_shift * ppu_fine_x_mul) % 65536;
                alo_shift = (ppu_background_attribute_low_shift * ppu_fine_x_mul) % 65536;
                ahi_shift = (ppu_background_attribute_high_shift * ppu_fine_x_mul) % 65536;
                pixel_x = tile_start_dot - 1;
                bg_left_ok = 1;
                sp_left_ok = 1;

                if tile_start_dot == 1 {
                    bg_left_ok = ppu_mask_background_left_column_enable;
                    sp_left_ok = ppu_mask_sprite_left_column_enable;
                }

                repeat 8 {
                    if ppu_mask_background_enable == 1 {
                        bg_px = 0;
                        bg_pal = 0;

                        if lo_shift >= 32768 {
                            bg_px = 1;
                            lo_shift = (lo_shift - 32768) * 2;
                        } else {
                            lo_shift = lo_shift * 2;
                        }

                        if hi_shift >= 32768 {
                            bg_px = bg_px + 2;
                            hi_shift = (hi_shift - 32768) * 2;
                        } else {
                            hi_shift = hi_shift * 2;
                        }

                        if alo_shift >= 32768 {
                            bg_pal = 1;
                            alo_shift = (alo_shift - 32768) * 2;
                        } else {
                            alo_shift = alo_shift * 2;
                        }

                        if ahi_shift >= 32768 {
                            bg_pal = bg_pal + 2;
                            ahi_shift = (ahi_shift - 32768) * 2;
                        } else {
                            ahi_shift = ahi_shift * 2;
                        }

                        if bg_left_ok == 0 {
                            bg_px = 0;
                            bg_pal = 0;
                        }
                    } else {
                        bg_px = 0;
                        bg_pal = 0;
                    }

                    if ppu_sprite_unit_active_count > 0 {
                        ppu_step_sprite_pixel;

                        if ppu_mask_sprite_enable == 0 or sp_left_ok == 0 {
                            ppu_sprite_pixel_found = 0;
                        }
                    } else {
                        ppu_sprite_pixel_found = 0;
                    }

                    if ppu_sprite_zero_in_line == 1
                        and ppu_sprite_pixel_found == 1
                        and ppu_sprite_pixel_oam_index == 0 {
                        if bg_px != 0 and pixel_x < 255 {
                            if (ppu_status_register // 64) % 2 == 0 {
                                ppu_status_register = ppu_status_register + 64;
                            }
                        }
                    }

                    if ppu_sprite_pixel_found == 1
                        and (bg_px == 0 or (ppu_sprite_pixel_attributes // 32) % 2 == 0) {
                        palette_offset = 16 + ((ppu_sprite_pixel_attributes % 4) * 4) + ppu_sprite_pixel_value;
                    } elif bg_px != 0 {
                        palette_offset = (bg_pal * 4) + bg_px;
                    } else {
                        palette_offset = 0;
                    }

                    color_index = ppu_palette_color[palette_offset + 1] + "";

                    if ppu_mask_greyscale == 1 {
                        color_index = ppu_greyscale_colors[color_index + 1] + "";
                    }

                    ppu_framebuffer_packed[fb_idx] = ppu_emphasis_packed + color_index;
                    fb_idx = fb_idx + 1;
                    pixel_x = pixel_x + 1;
                }
            }

            if tile_start_dot == 65 {
                ppu_evaluate_sprites_for_next_scanline;
            }

            if ppu_sprite_overflow_set_dot >= tile_start_dot
                and ppu_sprite_overflow_set_dot <= tile_start_dot + 7 {
                if (ppu_status_register // 32) % 2 == 0 {
                    ppu_status_register = ppu_status_register + 32;
                }
            }

            ppu_fetch_tile_into_shifters ppu_mask_background_enable;

            if tile_start_dot == 249 {
                ppu_vram_address = ppu_increment_scroll_y_for(ppu_vram_address);
            }

            ppu_dot = tile_start_dot + 8;
            dots_remaining = dots_remaining - 8;
        } elif ppu_mask_rendering_enable == 1
            and (ppu_scanline < 240 or ppu_scanline == 261)
            and ppu_dot == 257
            and dots_remaining >= 84 {
            hblank_len = 84;

            if ppu_scanline == 261 and ppu_odd_frame == 1 {
                hblank_len = 83;
            }

            ppu_run_hblank_batch hblank_len;
            dots_remaining = dots_remaining - hblank_len;
        } else {
            # One-dot exact fallback for unaligned dots, dot 0, vblank/pre-render status edges,
            # and sub-tile CPU register accesses.
            if ppu_bus_mapper_kind == mapper_kind.mmc3 {
                if mmc3_ppu_a12_high == 0 and mmc3_a12_low_dots < mmc3_limit.a12_filter_dots {
                    mmc3_a12_low_dots = mmc3_a12_low_dots + 1;
                }
            }

            if ppu_dot == 1 {
                if ppu_scanline == 241 {
                    ppu_frame_ready = 1;
                    ppu_frames_ready_count = (ppu_frames_ready_count + "") + 1;

                    if ppu_suppress_vblank_start == 1 {
                        ppu_suppress_vblank_start = 0;
                    } else {
                        ppu_set_vblank_flag 1;
                    }
                } elif ppu_scanline == 261 {
                    ppu_set_vblank_flag 0;
                    ppu_set_sprite_zero_hit 0;
                    ppu_set_sprite_overflow 0;
                }
            }

            if ppu_scanline < 240 and ppu_dot >= 1 and ppu_dot <= 256 {
                if ppu_mask_rendering_enable == 1 {
                    pixel_x = ppu_dot - 1;

                    if ppu_mask_background_enable == 1
                        and (pixel_x >= 8 or ppu_mask_background_left_column_enable == 1) {
                        fine_weight = ppu_fine_x_weight;
                        background_pixel = ((ppu_background_pattern_low_shift // fine_weight) % 2)
                            + (((ppu_background_pattern_high_shift // fine_weight) % 2) * 2);
                        background_palette = ((ppu_background_attribute_low_shift // fine_weight) % 2)
                            + (((ppu_background_attribute_high_shift // fine_weight) % 2) * 2);
                    } else {
                        background_pixel = 0;
                        background_palette = 0;
                    }

                    if ppu_mask_sprite_enable == 1
                        and (pixel_x >= 8 or ppu_mask_sprite_left_column_enable == 1)
                        and ppu_sprite_unit_active_count > 0 {
                        ppu_read_sprite_pixel;
                    } else {
                        ppu_sprite_pixel_found = 0;
                    }

                    if ppu_sprite_zero_in_line == 1
                        and ppu_sprite_pixel_found == 1
                        and ppu_sprite_pixel_oam_index == 0 {
                        if background_pixel != 0 and pixel_x < 255 {
                            if ppu_status_register // 64 % 2 == 0 {
                                ppu_status_register = ppu_status_register + 64;
                            }
                        }
                    }

                    if ppu_sprite_pixel_found == 1
                        and (background_pixel == 0 or (ppu_sprite_pixel_attributes // 32) % 2 == 0) {
                        palette_offset = 16 + ((ppu_sprite_pixel_attributes % 4) * 4) + ppu_sprite_pixel_value;
                    } elif background_pixel != 0 {
                        palette_offset = (background_palette * 4) + background_pixel;
                    } else {
                        palette_offset = 0;
                    }

                    color_index = ppu_palette_color[palette_offset + 1] + "";

                    if ppu_mask_greyscale == 1 {
                        color_index = ppu_greyscale_colors[color_index + 1] + "";
                    }

                    ppu_framebuffer_packed[ppu_framebuffer_row_base + ppu_dot] = ppu_emphasis_packed + color_index;

                    if ppu_sprite_unit_active_count > 0 {
                        ppu_clock_sprite_output_units;
                    }
                } else {
                    ppu_framebuffer_packed[ppu_framebuffer_row_base + ppu_dot] = ppu_backdrop_packed;
                }
            }

            if (ppu_scanline < 240 or ppu_scanline == 261)
                and ppu_mask_rendering_enable == 1 {
                ppu_clock_rendering_pipeline;
            }

            if ppu_dot < 339 {
                ppu_dot = ppu_dot + 1;
            } else {
                ppu_advance_dot;
            }

            dots_remaining = dots_remaining - 1;
        }
    }

    ppu_dots_clocked = ppu_dots_clocked + $count;
    ppu_update_next_cpu_event;
}

# Updates ppu_next_cpu_event_dots to the earliest PPU dot count at which an unsolicited PPU or
# mapper event could become visible to the CPU (scanline 241 dot 1 for frame-ready/vblank NMI,
# scanline 261 dot 339 for pre-render wrap, or an imminent MMC3 scanline IRQ). Direct CPU
# accesses to $2000-$3FFF, $4014, and $8000-$FFFF still call ppu_sync_to_cycle on their exact
# cycle, and register writes that change PPUMASK or MMC3 IRQ state refresh this bound.
proc ppu_update_next_cpu_event {
    local delta_dots = 1;
    local clocks_to_zero = 1;
    local mmc3_bound = 0;

    if ppu_scanline < 241 or (ppu_scanline == 241 and ppu_dot <= 1) {
        delta_dots = ((241 - ppu_scanline) * 341) + (2 - ppu_dot);
    } elif ppu_scanline < 261 or (ppu_scanline == 261 and ppu_dot < 339) {
        delta_dots = ((261 - ppu_scanline) * 341) + (339 - ppu_dot);
    } else {
        delta_dots = 1;
    }

    if ppu_bus_mapper_kind == mapper_kind.mmc3
        and mmc3_irq_enabled == 1
        and mmc3_irq_line_asserted == 0
        and ppu_mask_rendering_enable == 1 {
        if ppu_scanline >= 240 and ppu_scanline < 261 {
            mmc3_bound = ((261 - ppu_scanline) * 341) + (2 - ppu_dot);

            if mmc3_bound < 1 {
                mmc3_bound = 1;
            }

            if mmc3_bound < delta_dots {
                delta_dots = mmc3_bound;
            }
        } else {
            if mmc3_irq_counter == 0 or mmc3_irq_reload_pending == 1 {
                clocks_to_zero = mmc3_irq_latch + 1;
            } else {
                clocks_to_zero = mmc3_irq_counter;
            }

            if clocks_to_zero > 1 {
                if (ppu_control_register // 32) % 2 == 1 {
                    mmc3_bound = (clocks_to_zero - 1) * 12;
                } else {
                    mmc3_bound = (clocks_to_zero - 1) * 250;
                }
            } else {
                mmc3_bound = 1;
            }

            if ppu_background_pattern_table == 0 and ppu_dot < 262 {
                if 262 - ppu_dot > mmc3_bound {
                    mmc3_bound = 262 - ppu_dot;
                }
            }

            if mmc3_bound < delta_dots {
                delta_dots = mmc3_bound;
            }
        }
    }

    ppu_next_cpu_event_dots = ppu_dots_clocked + delta_dots;
}

# Advances three NTSC PPU dots for one CPU cycle.
proc ppu_clock_cpu_cycle {
    ppu_run_dots 3;
}

# Brings the PPU up to the CPU's schedule for a bus action that follows `cycle_count` completed
# CPU cycles. Measured against the reference's per-cycle trace (every instruction boundary and
# every OAM DMA cycle of the first million CPU cycles of the supplied ROM), the PPU has clocked
# 3 * cycle_count + 2 dots when the CPU makes that action. Every $2000-$3FFF access, every
# cartridge write, and every OAM write calls this first, so a register read, a mapper write, or
# a sprite-memory write sees the same PPU state as the reference, even inside one instruction.
# The frame loop also calls it once per sequence, which is the whole PPU cost when nothing
# touches the PPU mid-instruction.
proc ppu_sync_to_cycle cycle_count {
    local target_dots = $cycle_count * 3 + 2;

    if target_dots > ppu_dots_clocked {
        ppu_run_dots target_dots - ppu_dots_clocked;
    }
}

# Advances the PPU by three dots for each of `count` CPU cycles, in one call. The frame loop
# hands this the cycle count of a whole instruction (or a whole OAM DMA transfer), so the
# project pays one custom-block call per instruction instead of one per dot.
proc ppu_clock_cpu_cycles count {
    ppu_run_dots $count * 3;
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
    # One table read instead of the eight-step shift loop: the values are bytes, so the modulo
    # only keeps the list index in range.
    return ppu_reverse_byte_table[($byte_value % 256) + 1];
}

# The reversal the table above was built from, kept as the documented definition the mirror
# and the self test can call.
func ppu_reverse_byte_bits_slow(byte_value) {
    local remaining = $byte_value % 256;
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

    # No trailing normalization: the increment path tops out at 32767 (the entry already
    # masked to fifteen bits and the wrap branch subtracts), and the wrap branch rewrites the
    # address from a value below 4096. The mirror's exhaustive sweep is the proof.
    return result;
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

        # The low five bits of an address below 4096 are exactly address % 32, so the coarse-Y
        # reconstruction is one modulo instead of two divisions and a multiply.
        result = (result % 32) + (coarse_y * 32);
    }

    # No trailing normalization: the fine-Y path adds 4096 to an address below 32768 at most
    # once per call and the coarse-Y path rebuilds from a value below 4096.
    return result;
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

    # A line with no sprite unit loaded can never produce a sprite pixel, so the scan of the
    # eight slots is skipped outright: ppu_read_sprite_pixel would only clear four globals.
    if sprite_visible == 1 and ppu_sprite_unit_active_count > 0 {
        ppu_read_sprite_pixel;
    } else {
        ppu_sprite_pixel_found = 0;
    }

    if ppu_sprite_zero_in_line == 1 and ppu_sprite_pixel_found == 1 and ppu_sprite_pixel_oam_index == 0 {
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
    color_index = ppu_palette_color[palette_offset + 1];

    if ppu_mask_greyscale == 1 {
        color_index = ppu_greyscale_colors[color_index + 1];
    }

    framebuffer_index = ppu_framebuffer_row_base + ppu_dot;
    ppu_framebuffer_packed[framebuffer_index] = ppu_emphasis_packed + color_index;

    # The same guard the sprite scan uses: an empty line has no X counter to count down and
    # no pattern to shift, so the proc call is skipped on every pixel of such a line.
    if ppu_mask_rendering_enable == 1 and ppu_sprite_unit_active_count > 0 {
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
        if (ppu_sprite_unit_x_counter[unit_index] + "") == 0 {
            unit_pixel = (ppu_sprite_unit_pattern_low[unit_index] // 128) % 2;
            unit_pixel = unit_pixel
                + (((ppu_sprite_unit_pattern_high[unit_index] // 128) % 2) * 2);

            if unit_pixel != 0 {
                ppu_sprite_pixel_found = 1;
                ppu_sprite_pixel_value = unit_pixel;
                ppu_sprite_pixel_attributes = ppu_sprite_unit_attributes[unit_index] + "";
                ppu_sprite_pixel_oam_index = ppu_sprite_unit_oam_index[unit_index] + "";
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
        x_counter = ppu_sprite_unit_x_counter[unit_index] + "";

        if x_counter > 0 {
            ppu_sprite_unit_x_counter[unit_index] = x_counter - 1;
        } else {
            pattern_low = ppu_sprite_unit_pattern_low[unit_index] + "";
            pattern_high = ppu_sprite_unit_pattern_high[unit_index] + "";
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
    if ppu_dot >= 257 and ppu_dot <= 320 {
        # OAMADDR is forced to $00 on each dot of the sprite tile
        # loading interval.
        ppu_oam_address = 0;
    }

    if ppu_scanline < 240 and ppu_dot == 65 {
        ppu_evaluate_sprites_for_next_scanline;
    }

    if ppu_dot == ppu_sprite_overflow_set_dot {
        # Same latch as the sprite-zero hit: only the first overflow of a frame needs the
        # setter, and the plain add is the change it would make.
        if ppu_status_register // 32 % 2 == 0 {
            ppu_status_register = ppu_status_register + 32;
        }
    }

    if (ppu_dot >= 1 and ppu_dot <= 256) or (ppu_dot >= 321 and ppu_dot <= 336) {
        if ppu_mask_background_enable == 1 {
            ppu_background_pattern_low_shift = (ppu_background_pattern_low_shift * 2) % 65536;
            ppu_background_pattern_high_shift = (ppu_background_pattern_high_shift * 2) % 65536;
            ppu_background_attribute_low_shift = (ppu_background_attribute_low_shift * 2) % 65536;
            ppu_background_attribute_high_shift = (ppu_background_attribute_high_shift * 2) % 65536;
        }

        fetch_phase = ppu_dot % 8;

        if fetch_phase == 0 {
            ppu_fetch_background_pattern_high;
            ppu_load_background_registers;
            ppu_vram_address = ppu_increment_scroll_x_for(ppu_vram_address);
        } elif fetch_phase == 2 {
            ppu_bus_read_nametable 8192 + (ppu_vram_address % 4096);
            ppu_next_background_tile = ppu_bus_read_value + "";
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

    if ppu_scanline == 261 and ppu_dot >= 280 and ppu_dot <= 304 {
        ppu_vram_address = ppu_transfer_vertical_for(ppu_vram_address, ppu_temporary_vram_address);
    }

    if ppu_dot == 338 or ppu_dot == 340 {
        ppu_bus_read_nametable 8192 + (ppu_vram_address % 4096);
    }

    if ppu_dot >= 257 and ppu_dot <= 320 {
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
    local pattern_base = ppu_background_pattern_table;
    local fine_y = (ppu_vram_address // 4096) % 8;

    ppu_bus_read_pattern_window pattern_base + (ppu_next_background_tile * PPU_PATTERN_BYTES_PER_TILE) + fine_y;
    ppu_next_background_pattern_low = ppu_bus_read_value;
}

# Fetches the high pattern plane byte for the next background tile.
proc ppu_fetch_background_pattern_high {
    local pattern_base = ppu_background_pattern_table;
    local fine_y = (ppu_vram_address // 4096) % 8;

    ppu_bus_read_pattern_window pattern_base
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
    local sprite_height = 8;
    local visible_scanline = 1;

    if ppu_scanline >= PPU_FRAME_HEIGHT and ppu_scanline != PPU_PRE_RENDER_SCANLINE {
        visible_scanline = 0;
    }

    if visible_scanline == 1 {
        local found_count = 0;
        local elapsed_dots = 0;
        local overflow_offset = 0;
        local overflow_dot = 0;
        local oam_index = 0;
        local evaluation_done = 0;
        local checking_overflow = 0;
        local candidate_address = 0;
        local candidate_base = 0;
        local candidate_row = 0;
        local slot_index = 0;
        local copy_index = 1;

        if ppu_scanline == 239 {
            target_scanline = 0;
        } else {
            target_scanline = ppu_scanline + 1;
        }

        if (ppu_control_register // 32) % 2 == 1 {
            sprite_height = 16;
        }

        ppu_sprite_overflow_set_dot = 341;

        until oam_index >= 64 or evaluation_done == 1 {
            checking_overflow = 0;

            if found_count == 8 {
                checking_overflow = 1;
            }

            # The OAM byte offset is carried forward by four per entry instead of multiplied out
            # of the index on all sixty-four candidates of every evaluated line.
            candidate_address = candidate_base;

            if checking_overflow == 1 {
                candidate_address = candidate_address + overflow_offset;
            }

            # The OAM read and ppu_sprite_row() inlined: the address is always inside 0-255 for
            # this loop, and the row is one floored modulo. Sprite evaluation walks up to 64 OAM
            # entries per line, so numeric coercion eliminates polymorphic compare calls.
            candidate_row = (target_scanline - (ppu_oam[candidate_address + 1] + 1)) % 256;

            if checking_overflow == 1 {
                if candidate_row < sprite_height {
                    overflow_dot = 65 + elapsed_dots + 1;

                    if overflow_dot <= 256 {
                        ppu_sprite_overflow_set_dot = overflow_dot;
                    }

                    evaluation_done = 1;
                } else {
                    overflow_offset = (overflow_offset + 1) % 4;
                    elapsed_dots = elapsed_dots + 2;
                }
            } elif candidate_row >= sprite_height {
                elapsed_dots = elapsed_dots + 2;
            } else {
                slot_index = found_count + 1;
                ppu_secondary_sprite_y[slot_index] = ppu_oam[candidate_address + 1] + "";
                ppu_secondary_sprite_row[slot_index] = candidate_row;
                ppu_secondary_sprite_oam_index[slot_index] = oam_index;
                ppu_secondary_sprite_tile[slot_index] = ppu_oam[candidate_address + 2] + "";
                ppu_secondary_sprite_attributes[slot_index] = ppu_oam[candidate_address + 3] + "";
                ppu_secondary_sprite_x[slot_index] = ppu_oam[candidate_address + 4] + "";
                found_count = found_count + 1;
                elapsed_dots = elapsed_dots + 8;
            }

            candidate_base = candidate_base + 4;
            oam_index = oam_index + 1;
        }

        ppu_secondary_sprite_count = found_count;

        if target_scanline == 0 {
            ppu_line_zero_sprite_count = found_count;

            # Only the slots the evaluation filled are copied: a line with two sprites copies
            # two entries instead of eight, and every source value is already a number, so the
            # six coercions per slot are gone as well.
            repeat found_count {
                ppu_line_zero_sprite_y[copy_index] = ppu_secondary_sprite_y[copy_index];
                ppu_line_zero_sprite_tile[copy_index] = ppu_secondary_sprite_tile[copy_index];
                ppu_line_zero_sprite_attributes[copy_index] = ppu_secondary_sprite_attributes[copy_index];
                ppu_line_zero_sprite_x[copy_index] = ppu_secondary_sprite_x[copy_index];
                ppu_line_zero_sprite_oam_index[copy_index] = ppu_secondary_sprite_oam_index[copy_index];
                ppu_line_zero_sprite_row[copy_index] = ppu_secondary_sprite_row[copy_index];
                copy_index = copy_index + 1;
            }
        }
    } else {
        ppu_secondary_sprite_count = 0;
        ppu_sprite_overflow_set_dot = PPU_NO_OVERFLOW_DOT;
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
                # the renderer's scan bound is captured here, once per line, and the
                # sprite-zero flag starts clear for the new line.
                ppu_sprite_unit_active_count = candidate_count;
                ppu_sprite_zero_in_line = 0;
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

            # The renderer's hit test only needs to know whether sprite zero is on this line
            # at all, which is one comparison per loaded sprite instead of one per pixel.
            if candidate_oam_index == 0 {
                ppu_sprite_zero_in_line = 1;
            }
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
            ppu_sprite_fetch_pattern_address = pattern_address;
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
            # The address depends only on the control register, tile, attributes, and row of
            # this slot, all of which are unchanged since the low-plane phase two dots ago, so
            # the value computed there is reused instead of calling the func again.
            pattern_address = ppu_sprite_fetch_pattern_address;
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
