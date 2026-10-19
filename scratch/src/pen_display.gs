# Pen display geometry and the fit-to-screen setting for the port.
#
# pen_fit_to_screen is the one user-facing setting of the display: leave it
# at 0 for the native picture (one stage unit per NES pixel, pen size 1),
# or set it to 1, for example from its variable monitor in the editor, to
# scale the picture up to the largest size that fits the default 480 by
# 360 Scratch stage without distorting it. The stage coordinates have
# (0, 0) in the center, with x from -240 to 240 and y from -180 to 180,
# so a centered picture of scaled size W by H has its first pixel center
# at (-(W / 2) + scale / 2, (H / 2) - scale / 2), and every other pixel
# center one scale step right or down from there. At the fit scale of 1.5
# (the smaller of 480 / 256 and 360 / 240) the picture is 384 by 360: it
# fills the stage height exactly and leaves 48 units of backdrop on each
# side, with pixel centers running from -191.25 to 191.25 horizontally
# and 179.25 down to -179.25 vertically, symmetric about (0, 0).
#
# The derived values are recomputed by the Stage before each presented
# frame, so flipping the setting while the game runs takes effect on the
# next frame, and they cannot change underneath the sprite mid-draw
# because the Stage waits for the draw to finish. The display sprite only
# reads them; all Stage-owned state lives here like everywhere else.
#
# One renderer quirk is compensated here: scratch-render (and the
# TurboWarp fork of it) offsets pen lines by (+0.5, +0.5) when the pen
# diameter is exactly 1, a Scratch 2 pixel-alignment compatibility rule in
# PenSkin.drawLine. The stored first-pixel coordinates are therefore the
# positions the sprite must go to, with that offset already subtracted at
# scale 1, so the drawn centers land symmetric about (0, 0) either way:
# goto (-128, 119) at scale 1, and (-191.25, 179.25) at the fit scale.
# Pen strokes have round caps of radius scale / 2 around their endpoints,
# so a stroke between the first and last centers of a run covers exactly
# the run's pixel band when the pen size equals the scale, at both sizes.

# The default Scratch stage size the fit scale is computed against.
var PEN_STAGE_WIDTH = 480;
var PEN_STAGE_HEIGHT = 360;

# The NES picture size, matching PPU_FRAME_WIDTH and PPU_FRAME_HEIGHT.
var PEN_FRAME_WIDTH = 256;
var PEN_FRAME_HEIGHT = 240;

# The user setting: 1 scales the picture to fit the stage, anything else
# keeps the native 1x picture. Global (Stage-owned) so it can be changed
# from any sprite or its monitor while the project runs.
var pen_fit_to_screen = 0;

# Stage units per NES pixel for the frame being presented; also the pen
# size, so each stroke covers exactly its row band.
var pen_display_scale = 1;

# The sprite goto position of the first pixel center (NES x 0, row 0),
# pre-compensated for the size-1 renderer offset described above.
var pen_display_first_x = -128;
var pen_display_first_y = 119;

# The largest uniform scale at which a frame fits inside a stage of the
# given size: the smaller of the horizontal and vertical ratios.
func pen_display_fit_scale(stage_width, stage_height, frame_width, frame_height) {
    local scale_x = $stage_width / $frame_width;
    local scale_y = $stage_height / $frame_height;

    if scale_x < scale_y {
        return scale_x;
    }

    return scale_y;
}

# The drawing scale for one pen_fit_to_screen value: the fit scale for
# exactly 1, the native scale for everything else.
func pen_display_scale_for(fit_enabled) {
    if $fit_enabled == 1 {
        return pen_display_fit_scale(PEN_STAGE_WIDTH, PEN_STAGE_HEIGHT, PEN_FRAME_WIDTH, PEN_FRAME_HEIGHT);
    }

    return 1;
}

# The (+0.5, +0.5) the renderer adds to pen lines of diameter exactly 1,
# and no offset at the fit scale. Diameter 3 has the same rule upstream
# but no scale this header produces reaches it.
func pen_display_renderer_offset(scale_value) {
    if $scale_value == 1 {
        return 0.5;
    }

    return 0;
}

# The sprite goto x of pixel column zero at one scale: the centered first
# center, minus the renderer offset the pen layer will add back.
func pen_display_first_x_for(scale_value) {
    local picture_width = PEN_FRAME_WIDTH * $scale_value;

    return (0 - (picture_width / 2)) + ($scale_value / 2) - pen_display_renderer_offset($scale_value);
}

# The sprite goto y of the top row at one scale, the vertical mirror of
# pen_display_first_x_for: rows then step down by the scale from here.
func pen_display_first_y_for(scale_value) {
    local picture_height = PEN_FRAME_HEIGHT * $scale_value;

    return (picture_height / 2) - ($scale_value / 2) - pen_display_renderer_offset($scale_value);
}

# Recomputes the derived geometry from the current setting. Called by the
# run loop right before it hands a finished frame to the display sprite.
proc pen_display_update_geometry {
    pen_display_scale = pen_display_scale_for(pen_fit_to_screen);
    pen_display_first_x = pen_display_first_x_for(pen_display_scale);
    pen_display_first_y = pen_display_first_y_for(pen_display_scale);
}
