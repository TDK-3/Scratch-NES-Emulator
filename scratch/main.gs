# Display sprite for the GoboScript port.
#
# All shared state, enums, and procs are declared in stage.gs through the src headers. A
# sprite resolves Stage variable, list, and enum names without redeclaring them, while
# including a header here would duplicate its procs and shadow its state with sprite-local
# copies. This sprite reports what the Stage computed and draws each finished frame.
#
# The Stage cannot move or use the pen, so drawing lives here. The PPU writes its 256 by
# 240 picture into the Stage-owned framebuffer lists as six-bit palette indices with
# three emphasis bits per pixel. When a frame completes, the Stage broadcasts "draw frame"
# and waits, so the framebuffer cannot change while this sprite reads it. Each scanline
# is drawn left to right as maximal runs of one color: a run sets the pen color once (the
# Stage-cached "#rrggbb" value for that palette index and emphasis), moves to its first
# pixel, puts the pen down, and slides to its last pixel, which draws the whole run as a
# single stroke. A one-pixel run is the dot the pen stamps when it touches down. Drawing
# runs instead of pixels keeps a frame to one pen stroke per color change rather than one
# per pixel, and the pen color is only reset when it actually changes.
#
# The picture is centered on (0, 0), the middle of the stage, at the scale the Stage
# computed in src/pen_display.gs, with the pen size set to that same scale: NES x 0-255
# maps to pixel centers pen_display_first_x + x * pen_display_scale, and NES y 0-239
# (top first) to pen_display_first_y - y * pen_display_scale. A stroke between the
# first and last centers of a run covers exactly the run's band because pen strokes
# end in round caps of radius half the pen size. The scale starts at 1.5, the largest
# uniform scale at which the 256 by 240 picture fits the default 480 by 360 stage;
# setting the global pen_fit_to_screen variable to 0 returns it to 1, one stage unit
# per NES pixel. Every frame starts by erasing the pen layer, so no pixel of a previous
# frame can survive into the next one, including across a scale change.
costumes "assets/blank.svg";

# The emphasis * 64 + palette index key the pen is currently set to, or 512 when no run
# has set a color yet in this frame. Sprite-local display state, not emulator state.
var pen_current_color_key = 512;

onflag {
    pen_up;
    erase_all;
    say "Running the shared port vectors...";
}

on "port self test done" {
    say port_self_test_summary;
}

on "rom run started" {
    say rom_run_state_text;
}

# The Stage loads a pasted image at the run loop's request, so it reports the outcome the
# same way: the sprite says the state text the boot or the failed load left behind.
on "rom image changed" {
    say rom_run_state_text;
}

on "draw frame" {
    pen_draw_frame;
}

# Draws the completed framebuffer with the pen extension, one run-length
# stroke at a time. The proc runs without screen refresh, so the whole
# frame lands on the pen layer before the Stage resumes the console.
proc pen_draw_frame {
    local row = 0;
    local row_base = 0;
    local stage_y = 0;
    local pixel_x = 0;
    local run_start = 0;
    local run_key = 0;
    local current_key = 0;
    local framebuffer_index = 0;

    say "";
    pen_up;
    erase_all;
    set_pen_size pen_display_scale;
    set_pen_transparency 0;
    pen_current_color_key = 512;

    repeat 240 {
        stage_y = pen_display_first_y - (row * pen_display_scale);
        row_base = row * 256;
        pixel_x = 0;
        run_start = 0;
        framebuffer_index = row_base + 1;
        run_key = ppu_framebuffer_packed[framebuffer_index];

        # The remaining 255 pixels of the row, with the framebuffer index carried forward
        # instead of being recomputed from the pixel number: a repeat loop and one addition
        # per pixel, over 61,440 pixels a frame.
        repeat 255 {
            pixel_x = pixel_x + 1;
            framebuffer_index = framebuffer_index + 1;
            current_key = ppu_framebuffer_packed[framebuffer_index];

            if current_key != run_key {
                pen_draw_run run_start, pixel_x - 1, stage_y, run_key;
                run_start = pixel_x;
                run_key = current_key;
            }
        }

        pen_draw_run run_start, 255, stage_y, run_key;
        row = row + 1;
    }

    pen_up;
}

# Draws one horizontal run of NES pixels from left_x to right_x (0-255) on
# one stage row, in the cached pen color for the run's palette/emphasis
# key. The pen color block only runs when the key changes, so adjacent
# runs and rows that share a color cost no extra color change.
proc pen_draw_run left_x, right_x, stage_y, color_key {
    if $color_key != pen_current_color_key {
        pen_current_color_key = $color_key;
        set_pen_color nes_pen_colors[$color_key + 1];
    }

    goto pen_display_first_x + ($left_x * pen_display_scale), $stage_y;
    pen_down;
    set_x pen_display_first_x + ($right_x * pen_display_scale);
    pen_up;
}
