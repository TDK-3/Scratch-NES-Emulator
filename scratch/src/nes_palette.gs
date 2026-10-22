# NES master palette as pen colors for the GoboScript port.
#
# The PPU framebuffer holds six-bit palette indices plus three emphasis
# bits per pixel, which is not a color the pen extension can use. This
# header holds the same 64-color NTSC RGB approximation the TypeScript
# canvas renderer uses (NES_PALETTE_RGB in canvas_renderer.ts), applies
# the same emphasis dimming, and precomputes the result of all 512
# index/emphasis pairs as "#rrggbb" pen color strings. The display
# sprite then sets the pen with one list read per run of equal pixels
# instead of converting colors inside its draw loop.

%include src/numeric

# The three channel planes of the 64-color master palette, filled by
# nes_palette_init. Untouched slots read as zero, which is why slot one
# holding its red value doubles as the filled marker the APU tables use.
list nes_palette_red = [0; 64];
list nes_palette_green = [0; 64];
list nes_palette_blue = [0; 64];

# One-character hex digits for building pen color strings.
list nes_hex_digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];

# The 512 pen colors, at emphasis * 64 + color index + 1. Filled once by
# nes_palette_init from the channel planes and the dimming rule, both as "#rrggbb" strings
# (nes_pen_colors) and as 24-bit R*65536 + G*256 + B integers (nes_pen_rgb) so the pen
# extension can take Scratch's fast integer RGB path without regex hex parsing.
list nes_pen_colors = [0; 512];
list nes_pen_rgb = [0; 512];

# Fills the channel planes from the literal master palette and builds the
# pen color cache. Safe to call more than once: the values are constants,
# so rebuilding them changes nothing.
proc nes_palette_init {
    local emphasis = 0;
    local color_index = 0;

    nes_palette_red[1] = 84;
    nes_palette_red[2] = 0;
    nes_palette_red[3] = 8;
    nes_palette_red[4] = 48;
    nes_palette_red[5] = 68;
    nes_palette_red[6] = 92;
    nes_palette_red[7] = 84;
    nes_palette_red[8] = 60;
    nes_palette_red[9] = 32;
    nes_palette_red[10] = 8;
    nes_palette_red[11] = 0;
    nes_palette_red[12] = 0;
    nes_palette_red[13] = 0;
    nes_palette_red[14] = 0;
    nes_palette_red[15] = 0;
    nes_palette_red[16] = 0;
    nes_palette_red[17] = 152;
    nes_palette_red[18] = 8;
    nes_palette_red[19] = 48;
    nes_palette_red[20] = 92;
    nes_palette_red[21] = 136;
    nes_palette_red[22] = 160;
    nes_palette_red[23] = 152;
    nes_palette_red[24] = 120;
    nes_palette_red[25] = 84;
    nes_palette_red[26] = 40;
    nes_palette_red[27] = 8;
    nes_palette_red[28] = 0;
    nes_palette_red[29] = 0;
    nes_palette_red[30] = 0;
    nes_palette_red[31] = 0;
    nes_palette_red[32] = 0;
    nes_palette_red[33] = 236;
    nes_palette_red[34] = 76;
    nes_palette_red[35] = 120;
    nes_palette_red[36] = 176;
    nes_palette_red[37] = 228;
    nes_palette_red[38] = 236;
    nes_palette_red[39] = 236;
    nes_palette_red[40] = 212;
    nes_palette_red[41] = 160;
    nes_palette_red[42] = 116;
    nes_palette_red[43] = 76;
    nes_palette_red[44] = 56;
    nes_palette_red[45] = 56;
    nes_palette_red[46] = 60;
    nes_palette_red[47] = 0;
    nes_palette_red[48] = 0;
    nes_palette_red[49] = 236;
    nes_palette_red[50] = 168;
    nes_palette_red[51] = 188;
    nes_palette_red[52] = 212;
    nes_palette_red[53] = 236;
    nes_palette_red[54] = 236;
    nes_palette_red[55] = 236;
    nes_palette_red[56] = 228;
    nes_palette_red[57] = 204;
    nes_palette_red[58] = 180;
    nes_palette_red[59] = 168;
    nes_palette_red[60] = 152;
    nes_palette_red[61] = 160;
    nes_palette_red[62] = 160;
    nes_palette_red[63] = 0;
    nes_palette_red[64] = 0;

    nes_palette_green[1] = 84;
    nes_palette_green[2] = 30;
    nes_palette_green[3] = 16;
    nes_palette_green[4] = 0;
    nes_palette_green[5] = 0;
    nes_palette_green[6] = 0;
    nes_palette_green[7] = 4;
    nes_palette_green[8] = 24;
    nes_palette_green[9] = 42;
    nes_palette_green[10] = 58;
    nes_palette_green[11] = 64;
    nes_palette_green[12] = 60;
    nes_palette_green[13] = 50;
    nes_palette_green[14] = 0;
    nes_palette_green[15] = 0;
    nes_palette_green[16] = 0;
    nes_palette_green[17] = 150;
    nes_palette_green[18] = 76;
    nes_palette_green[19] = 50;
    nes_palette_green[20] = 30;
    nes_palette_green[21] = 20;
    nes_palette_green[22] = 20;
    nes_palette_green[23] = 34;
    nes_palette_green[24] = 60;
    nes_palette_green[25] = 90;
    nes_palette_green[26] = 114;
    nes_palette_green[27] = 124;
    nes_palette_green[28] = 118;
    nes_palette_green[29] = 102;
    nes_palette_green[30] = 0;
    nes_palette_green[31] = 0;
    nes_palette_green[32] = 0;
    nes_palette_green[33] = 238;
    nes_palette_green[34] = 154;
    nes_palette_green[35] = 124;
    nes_palette_green[36] = 98;
    nes_palette_green[37] = 84;
    nes_palette_green[38] = 88;
    nes_palette_green[39] = 106;
    nes_palette_green[40] = 136;
    nes_palette_green[41] = 170;
    nes_palette_green[42] = 196;
    nes_palette_green[43] = 208;
    nes_palette_green[44] = 204;
    nes_palette_green[45] = 180;
    nes_palette_green[46] = 60;
    nes_palette_green[47] = 0;
    nes_palette_green[48] = 0;
    nes_palette_green[49] = 238;
    nes_palette_green[50] = 204;
    nes_palette_green[51] = 188;
    nes_palette_green[52] = 178;
    nes_palette_green[53] = 174;
    nes_palette_green[54] = 174;
    nes_palette_green[55] = 180;
    nes_palette_green[56] = 196;
    nes_palette_green[57] = 210;
    nes_palette_green[58] = 222;
    nes_palette_green[59] = 226;
    nes_palette_green[60] = 226;
    nes_palette_green[61] = 214;
    nes_palette_green[62] = 162;
    nes_palette_green[63] = 0;
    nes_palette_green[64] = 0;

    nes_palette_blue[1] = 84;
    nes_palette_blue[2] = 116;
    nes_palette_blue[3] = 144;
    nes_palette_blue[4] = 136;
    nes_palette_blue[5] = 100;
    nes_palette_blue[6] = 48;
    nes_palette_blue[7] = 0;
    nes_palette_blue[8] = 0;
    nes_palette_blue[9] = 0;
    nes_palette_blue[10] = 0;
    nes_palette_blue[11] = 0;
    nes_palette_blue[12] = 0;
    nes_palette_blue[13] = 60;
    nes_palette_blue[14] = 0;
    nes_palette_blue[15] = 0;
    nes_palette_blue[16] = 0;
    nes_palette_blue[17] = 152;
    nes_palette_blue[18] = 196;
    nes_palette_blue[19] = 236;
    nes_palette_blue[20] = 228;
    nes_palette_blue[21] = 176;
    nes_palette_blue[22] = 100;
    nes_palette_blue[23] = 32;
    nes_palette_blue[24] = 0;
    nes_palette_blue[25] = 0;
    nes_palette_blue[26] = 0;
    nes_palette_blue[27] = 0;
    nes_palette_blue[28] = 40;
    nes_palette_blue[29] = 120;
    nes_palette_blue[30] = 0;
    nes_palette_blue[31] = 0;
    nes_palette_blue[32] = 0;
    nes_palette_blue[33] = 236;
    nes_palette_blue[34] = 236;
    nes_palette_blue[35] = 236;
    nes_palette_blue[36] = 236;
    nes_palette_blue[37] = 236;
    nes_palette_blue[38] = 180;
    nes_palette_blue[39] = 100;
    nes_palette_blue[40] = 32;
    nes_palette_blue[41] = 0;
    nes_palette_blue[42] = 0;
    nes_palette_blue[43] = 32;
    nes_palette_blue[44] = 108;
    nes_palette_blue[45] = 204;
    nes_palette_blue[46] = 60;
    nes_palette_blue[47] = 0;
    nes_palette_blue[48] = 0;
    nes_palette_blue[49] = 236;
    nes_palette_blue[50] = 236;
    nes_palette_blue[51] = 236;
    nes_palette_blue[52] = 236;
    nes_palette_blue[53] = 236;
    nes_palette_blue[54] = 212;
    nes_palette_blue[55] = 176;
    nes_palette_blue[56] = 144;
    nes_palette_blue[57] = 120;
    nes_palette_blue[58] = 120;
    nes_palette_blue[59] = 144;
    nes_palette_blue[60] = 180;
    nes_palette_blue[61] = 228;
    nes_palette_blue[62] = 160;
    nes_palette_blue[63] = 0;
    nes_palette_blue[64] = 0;

    repeat 8 {
        color_index = 0;

        repeat 64 {
            nes_pen_colors[(emphasis * 64) + color_index + 1] = nes_pen_color(color_index, emphasis);
            nes_pen_rgb[(emphasis * 64) + color_index + 1] = nes_pen_rgb_value(color_index, emphasis);
            color_index = color_index + 1;
        }

        emphasis = emphasis + 1;
    }
}

# The emphasis dimming of one channel: three quarters of its value,
# rounded half up, matching the EMPHASIS_DIMMING factor in the canvas
# renderer with integer arithmetic only.
func nes_palette_dim_channel(channel) {
    return ((($channel % 256) * 3) + 2) // 4;
}

# The two hex digits of one channel byte.
func nes_palette_hex_byte(channel) {
    local byte_value = $channel % 256;

    return nes_hex_digits[(byte_value // 16) + 1] & nes_hex_digits[(byte_value % 16) + 1];
}

# The "#rrggbb" pen color for one palette index under one emphasis value.
# Each emphasis bit dims the two channels it does not name, so a channel
# can be dimmed twice, in the same order the canvas renderer dims them.
func nes_pen_color(color_index, emphasis) {
    local palette_index = ($color_index % 64) + 1;
    local emphasis_bits = $emphasis % 8;
    local red = to_number(nes_palette_red[palette_index]);
    local green = to_number(nes_palette_green[palette_index]);
    local blue = to_number(nes_palette_blue[palette_index]);

    if emphasis_bits % 2 == 1 {
        green = nes_palette_dim_channel(green);
        blue = nes_palette_dim_channel(blue);
    }

    if (emphasis_bits // 2) % 2 == 1 {
        red = nes_palette_dim_channel(red);
        blue = nes_palette_dim_channel(blue);
    }

    if (emphasis_bits // 4) % 2 == 1 {
        red = nes_palette_dim_channel(red);
        green = nes_palette_dim_channel(green);
    }

    return "#" & nes_palette_hex_byte(red) & nes_palette_hex_byte(green) & nes_palette_hex_byte(blue);
}

# The 24-bit integer RGB pen color (R * 65536 + G * 256 + B) for one palette index under one
# emphasis value, matching nes_pen_color byte for byte.
func nes_pen_rgb_value(color_index, emphasis) {
    local palette_index = ($color_index % 64) + 1;
    local emphasis_bits = $emphasis % 8;
    local red = to_number(nes_palette_red[palette_index]);
    local green = to_number(nes_palette_green[palette_index]);
    local blue = to_number(nes_palette_blue[palette_index]);

    if emphasis_bits % 2 == 1 {
        green = nes_palette_dim_channel(green);
        blue = nes_palette_dim_channel(blue);
    }

    if (emphasis_bits // 2) % 2 == 1 {
        red = nes_palette_dim_channel(red);
        blue = nes_palette_dim_channel(blue);
    }

    if (emphasis_bits // 4) % 2 == 1 {
        red = nes_palette_dim_channel(red);
        green = nes_palette_dim_channel(green);
    }

    return (red * 65536) + (green * 256) + blue;
}
