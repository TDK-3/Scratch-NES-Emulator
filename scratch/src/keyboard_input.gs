# Host keyboard input for the GoboScript port.
#
# Mirrors src/nes/browser/keyboard_input.ts: the arrow keys, Z, X, Shift, and Enter drive the
# first pad, and IJKL, U, O, Y, and P drive the second one, in the same A/B/Select/Start and
# Up/Down/Left/Right order as the reference adapter.
#
# The host state is read with the built-in "key () pressed?" reporter instead of a key-press
# hat, because a pad button is a level and not an event. The port asks what is held down
# rather than tracking press and release edges, so a key whose release the project never sees
# (the browser window losing focus mid-press, for example) cannot leave a button stuck down,
# and stopping the project leaves nothing to undo.
#
# The run loop samples the keyboard once per chunk of emulated cycles, so a press reaches the
# console one chunk later, and the masks stay live until the next sample. The console still
# decides when to look at them, the way a game strobes $4016 when it wants the pad. Scratch
# key names are the ones the runtime's keyboard device reports: single characters, "up arrow",
# "down arrow", "left arrow", "right arrow", "enter", and "space", plus "shift". Shift is a
# TurboWarp extension: the Scratch website's keyboard device drops modifier keys, so Select
# simply stays up there while every other binding works on plain Scratch too.
#
# Each binding contributes one distinct button bit and the mask starts at zero, so a held
# button is added to its pad's mask rather than combined with a bitwise_or() call: the bit is
# never already set, which makes the addition the same mask for a fraction of the cost. This
# proc runs once per chunk of emulated cycles, so the sixteen sensors and additions it makes
# are paid about three hundred times per frame. The finished masks are handed to
# controller.gs, whose serial report the console reads through $4016 and $4017.

%include src/numeric
%include src/controller

# A/B/Select/Start/Up/Down/Left/Right bit weights; matches CONTROLLER_BUTTON_MASKS in
# src/nes/input/controller.ts, which the shared-vector replay covers.
enum keyboard_button {
    a = 1,
    b = 2,
    select = 4,
    start = 8,
    up = 16,
    down = 32,
    left = 64,
    right = 128
}

# Samples the host keyboard once and replaces the live button mask of both pads with what it
# found. A key that is not held contributes nothing, so the masks follow the keyboard in both
# directions without any per-key state to keep in step.
proc keyboard_poll_controllers {
    local player_one_mask = 0;
    local player_two_mask = 0;

    if key_pressed("up arrow") {
        player_one_mask = player_one_mask + keyboard_button.up;
    }

    if key_pressed("down arrow") {
        player_one_mask = player_one_mask + keyboard_button.down;
    }

    if key_pressed("left arrow") {
        player_one_mask = player_one_mask + keyboard_button.left;
    }

    if key_pressed("right arrow") {
        player_one_mask = player_one_mask + keyboard_button.right;
    }

    if key_pressed("z") {
        player_one_mask = player_one_mask + keyboard_button.a;
    }

    if key_pressed("x") {
        player_one_mask = player_one_mask + keyboard_button.b;
    }

    if key_pressed("shift") {
        player_one_mask = player_one_mask + keyboard_button.select;
    }

    if key_pressed("enter") {
        player_one_mask = player_one_mask + keyboard_button.start;
    }

    if key_pressed("i") {
        player_two_mask = player_two_mask + keyboard_button.up;
    }

    if key_pressed("k") {
        player_two_mask = player_two_mask + keyboard_button.down;
    }

    if key_pressed("j") {
        player_two_mask = player_two_mask + keyboard_button.left;
    }

    if key_pressed("l") {
        player_two_mask = player_two_mask + keyboard_button.right;
    }

    if key_pressed("u") {
        player_two_mask = player_two_mask + keyboard_button.a;
    }

    if key_pressed("o") {
        player_two_mask = player_two_mask + keyboard_button.b;
    }

    if key_pressed("y") {
        player_two_mask = player_two_mask + keyboard_button.select;
    }

    if key_pressed("p") {
        player_two_mask = player_two_mask + keyboard_button.start;
    }

    controller_set_button_mask 0, player_one_mask;
    controller_set_button_mask 1, player_two_mask;
}
