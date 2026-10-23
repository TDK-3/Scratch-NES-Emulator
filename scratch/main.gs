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

# The pen attributes the extension was last set to, so a frame that does not change the fit
# scale does not repeat two extension calls per frame. -1 means "never set".
var pen_applied_size = -1;
var pen_applied_transparency = -1;

# Tracks whether this sprite is currently shown so pen_draw_frame hides it before drawing pen
# strokes and only shows a bottom-right say bubble while booting or while debug mode is on.
var pen_sprite_visible = 1;

onflag {
    pen_up;
    erase_all;
    goto PEN_DEBUG_X, PEN_DEBUG_Y;
    say "Starting the console...";
    show;
    pen_sprite_visible = 1;
}

on "port self test done" {
    if rom_run_debug_enabled == 1 or rom_run_booting == 1 {
        goto PEN_DEBUG_X, PEN_DEBUG_Y;
        say port_self_test_summary;
        show;
        pen_sprite_visible = 1;
    }
}

on "rom run started" {
    if rom_run_debug_enabled == 1 or rom_run_started == 0 {
        goto PEN_DEBUG_X, PEN_DEBUG_Y;
        say rom_run_state_text;
        show;
        pen_sprite_visible = 1;
    }
}

# The E key halts the console and broadcasts the state dump, which the sprite shows when debug
# mode is enabled.
on "rom run dump" {
    if rom_run_debug_enabled == 1 {
        goto PEN_DEBUG_X, PEN_DEBUG_Y;
        say rom_run_dump_text;
        show;
        pen_sprite_visible = 1;
    }
}

# The Stage loads a pasted image at the run loop's request, so the sprite reports boot failures
# or debug-mode load outcomes without calling say during normal non-debug play.
on "rom image changed" {
    if rom_run_debug_enabled == 1 or rom_run_started == 0 {
        goto PEN_DEBUG_X, PEN_DEBUG_Y;
        say rom_run_state_text;
        show;
        pen_sprite_visible = 1;
    }
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
    local cached_scale = 0;
    local cached_first_x = 0;
    local bg_key = 0;
    local bg_min_x = -1;
    local bg_max_x = -1;
    local run_count = 0;
    local active_color_count = 0;
    local slot = 0;
    local head = 0;
    local color_idx = 0;
    local r_idx = 0;
    local x0 = 0;
    local x1 = 0;

    if pen_sprite_visible == 1 {
        hide;
        pen_sprite_visible = 0;
    }

    pen_up;
    erase_all;

    # The pen size and transparency only change when the fit setting does, so they are set on
    # the frame that changes them instead of on all sixty frames a second.
    if pen_applied_size != pen_display_scale {
        pen_applied_size = pen_display_scale;
        set_pen_size pen_display_scale;
    }

    if pen_applied_transparency != 0 {
        pen_applied_transparency = 0;
        set_pen_transparency 0;
    }

    cached_scale = pen_display_scale + "";
    cached_first_x = pen_display_first_x + "";
    bg_key = ppu_backdrop_packed + "";
    pen_current_color_key = bg_key;
    set_pen_color nes_pen_rgb[bg_key + 1] + "";

    repeat 240 {
        stage_y = pen_display_first_y - (row * pen_display_scale);
        row_base = row * 256;
        pixel_x = 0;
        run_start = 0;
        bg_min_x = -1;
        bg_max_x = -1;
        framebuffer_index = row_base + 1;
        run_key = ppu_framebuffer_packed[framebuffer_index] + "";

        # Scan the 256 pixels of the row using native numeric comparisons, coalescing all
        # backdrop pixels on this row into a single base span [bg_min_x .. bg_max_x] while
        # bucketing non-backdrop runs by palette/emphasis key so set_pen_color runs once per
        # distinct color in the frame instead of once per run.
        repeat 255 {
            pixel_x = pixel_x + 1;
            framebuffer_index = framebuffer_index + 1;
            current_key = ppu_framebuffer_packed[framebuffer_index] + "";

            if current_key != run_key {
                if run_key == bg_key {
                    if bg_min_x < 0 {
                        bg_min_x = run_start;
                    }
                    bg_max_x = pixel_x - 1;
                } else {
                    run_count = run_count + 1;
                    slot = run_key + 1;
                    head = pen_color_bucket_head[slot] + "";

                    if head == 0 {
                        active_color_count = active_color_count + 1;
                        pen_active_colors[active_color_count] = run_key;
                    }

                    pen_run_next[run_count] = head;
                    pen_color_bucket_head[slot] = run_count;
                    pen_run_y[run_count] = stage_y;
                    pen_run_x0[run_count] = cached_first_x + (run_start * cached_scale);
                    pen_run_x1[run_count] = cached_first_x + ((pixel_x - 1) * cached_scale);
                }

                run_start = pixel_x;
                run_key = current_key;
            }
        }

        if run_key == bg_key {
            if bg_min_x < 0 {
                bg_min_x = run_start;
            }
            bg_max_x = 255;
        } else {
            run_count = run_count + 1;
            slot = run_key + 1;
            head = pen_color_bucket_head[slot] + "";

            if head == 0 {
                active_color_count = active_color_count + 1;
                pen_active_colors[active_color_count] = run_key;
            }

            pen_run_next[run_count] = head;
            pen_color_bucket_head[slot] = run_count;
            pen_run_y[run_count] = stage_y;
            pen_run_x0[run_count] = cached_first_x + (run_start * cached_scale);
            pen_run_x1[run_count] = cached_first_x + (255 * cached_scale);
        }

        if bg_min_x >= 0 {
            goto cached_first_x + (bg_min_x * cached_scale), stage_y;
            pen_down;

            if bg_max_x > bg_min_x {
                set_x cached_first_x + (bg_max_x * cached_scale);
            }

            pen_up;
        }

        row = row + 1;
    }

    color_idx = 1;

    repeat active_color_count {
        run_key = pen_active_colors[color_idx] + "";
        slot = run_key + 1;
        pen_current_color_key = run_key;
        set_pen_color nes_pen_rgb[slot] + "";
        r_idx = pen_color_bucket_head[slot] + "";
        pen_color_bucket_head[slot] = 0;

        until r_idx == 0 {
            x0 = pen_run_x0[r_idx] + "";
            x1 = pen_run_x1[r_idx] + "";
            goto x0, pen_run_y[r_idx] + "";
            pen_down;

            if x1 != x0 {
                set_x x1;
            }

            pen_up;
            r_idx = pen_run_next[r_idx] + "";
        }

        color_idx = color_idx + 1;
    }

    pen_up;

    if rom_run_debug_enabled == 1 {
        goto PEN_DEBUG_X, PEN_DEBUG_Y;
        say rom_run_debug_text;
        show;
        pen_sprite_visible = 1;
    }
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
