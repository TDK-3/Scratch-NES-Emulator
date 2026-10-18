# PPU 2C02 CPU-register behavior and deterministic NTSC timing for the
# GoboScript port.
#
# Ports src/nes/ppu/ppu_2c02.ts register I/O, timing, and NMI edge
# detection. The rendering pipeline (background fetch/shift, sprite
# evaluation, framebuffer output) is not ported in this slice.
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
var PPU_SCROLL_SECOND_WRITE_PRESERVE_MASK = 3099;
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

# ---- timing state ----

var ppu_scanline = 261;
var ppu_dot = 0;
var ppu_frame_number = 0;
var ppu_odd_frame = 0;
var ppu_nmi_output = 0;
var ppu_nmi_edge_pending = 0;

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
    ppu_dot = 0;
    ppu_frame_number = 0;
    ppu_odd_frame = 0;
    ppu_nmi_output = 0;
    ppu_nmi_edge_pending = 0;
    ppu_register_error = 0;
    ppu_bus_reset;
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
    local address = bitwise_and(ppu_vram_address, PPU_ADDRESS_MASK);
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

# PPUCTRL: stores the value, updates the nametable bits in the temporary
# VRAM address, and refreshes NMI output.
proc ppu_write_control_register value {
    ppu_control_register = $value;
    local nt_bits = ($value % 4) * 1024;
    local preserved = bitwise_and(ppu_temporary_vram_address, 32767 - 1024 * 3);
    ppu_temporary_vram_address = bitwise_or(preserved, nt_bits);
    ppu_refresh_nmi_output;
}

# PPUSCROLL: two-write toggle sets fine X on the first write and fine Y /
# coarse Y on the second.
proc ppu_write_scroll_register value {
    if ppu_write_toggle == 0 {
        ppu_fine_x_scroll = bitwise_and($value, PPU_SCROLL_FINE_X_MASK);
        local coarse_x = ($value // 8) % 32;
        local preserved = bitwise_and(ppu_temporary_vram_address, 32767 - PPU_SCROLL_COARSE_X_MASK);
        ppu_temporary_vram_address = bitwise_or(preserved, coarse_x);
        ppu_write_toggle = 1;
    } else {
        local fine_y = ($value % 8) * 4096;
        local coarse_y = (($value // 8) % 32) * 32;
        local preserved = bitwise_and(ppu_temporary_vram_address, PPU_SCROLL_SECOND_WRITE_PRESERVE_MASK);
        ppu_temporary_vram_address = bitwise_or(preserved, bitwise_or(fine_y, coarse_y));
        ppu_write_toggle = 0;
    }
}

# PPUADDR: two-write toggle sets the high byte on the first write and the
# low byte on the second, then copies temporary to vram and observes.
proc ppu_write_address_register value {
    if ppu_write_toggle == 0 {
        local address_high = ($value % 64) * 256;
        local preserved = bitwise_and(ppu_temporary_vram_address, PPU_ADDRESS_HIGH_PRESERVE_MASK);
        ppu_temporary_vram_address = bitwise_or(preserved, address_high);
        ppu_write_toggle = 1;
    } else {
        local preserved = bitwise_and(ppu_temporary_vram_address, PPU_ADDRESS_LOW_PRESERVE_MASK);
        ppu_temporary_vram_address = bitwise_or(preserved, $value);
        ppu_vram_address = ppu_temporary_vram_address;
        ppu_write_toggle = 0;
        ppu_bus_observe_ppu_address bitwise_and(ppu_vram_address, PPU_ADDRESS_MASK);
    }
}

# PPUDATA: writes through the PPU bus and increments the VRAM address.
proc ppu_write_data_register value {
    ppu_bus_write_ppu bitwise_and(ppu_vram_address, PPU_ADDRESS_MASK), $value;
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

    if bitwise_and(ppu_control_register, PPU_CONTROL_VRAM_INCREMENT) != 0 {
        increment = 32;
    }

    ppu_vram_address = (ppu_vram_address + increment) % 32768;
    ppu_bus_observe_ppu_address bitwise_and(ppu_vram_address, PPU_ADDRESS_MASK);
}

# ---- timing ----

# Clocks one PPU dot: applies vblank timing, then advances dot/scanline.
proc ppu_clock_ppu_dot {
    ppu_bus_clock_ppu_dot;

    if ppu_scanline == PPU_VBLANK_FIRST_SCANLINE and ppu_dot == PPU_VBLANK_START_DOT {
        if ppu_suppress_vblank_start == 1 {
            ppu_suppress_vblank_start = 0;
        } else {
            ppu_set_vblank_flag 1;
        }
    }

    if ppu_scanline == PPU_PRE_RENDER_SCANLINE and ppu_dot == PPU_PRE_RENDER_STATUS_CLEAR_DOT {
        ppu_set_vblank_flag 0;
        ppu_set_sprite_zero_hit 0;
        ppu_set_sprite_overflow 0;
    }

    ppu_advance_dot;
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
    local rendering_enabled = ppu_is_rendering_enabled();
    local odd_skip = 0;

    if ppu_scanline == PPU_PRE_RENDER_SCANLINE {
        if ppu_dot == PPU_ODD_FRAME_LAST_DOT and ppu_odd_frame == 1 {
            if rendering_enabled == 1 {
                odd_skip = 1;
            }
        }
    }

    if odd_skip == 1 {
        ppu_scanline = 0;
        ppu_dot = 0;
    } elif ppu_dot < PPU_LAST_DOT {
        ppu_dot = ppu_dot + 1;
    } else {
        ppu_dot = 0;

        if ppu_scanline == PPU_LAST_SCANLINE_BEFORE_PRE_RENDER {
            ppu_scanline = PPU_PRE_RENDER_SCANLINE;
            ppu_frame_number = ppu_frame_number + 1;

            if ppu_frame_number % 2 != 0 {
                ppu_odd_frame = 1;
            } else {
                ppu_odd_frame = 0;
            }
        } elif ppu_scanline == PPU_LAST_SCANLINE {
            ppu_scanline = 0;
        } else {
            ppu_scanline = ppu_scanline + 1;
        }
    }
}

# ---- helpers ----

# Whether rendering is enabled (background or sprite bit set in PPUMASK).
func ppu_is_rendering_enabled() {
    if bitwise_and(ppu_mask_register, PPU_RENDERING_MASK) != 0 {
        return 1;
    }

    return 0;
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
