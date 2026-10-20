# Boots the embedded cartridge image and runs the game it holds.
#
# The shared-vector self test replays its records against a bus whose devices are detached and
# whose cartridge window is empty, so the boot re-attaches them, loads the embedded image, and
# resets the console the way NesConsole.reset() does: the bus latch, the PPU, the APU, the
# controllers, the CPU registers, and the interrupt state. The board keeps the image it
# validated, and the CPU then spends the seven reset accesses, including the vector read the
# board answers from its last PRG bank.
#
# The frame loop runs the console afterwards: one bounded chunk of CPU cycles at a time, with a
# yield between chunks so the display sprite can report the progress and the project stays
# responsive. A chunk never runs past the end of a frame, and the frame counter advances when a
# frame completes. The bus-access log stays off while the game runs, the way the reference runs
# the CPU without a trace sink, so the log cannot grow without bound.
#
# Every time the PPU finishes a visible frame it raises ppu_frame_ready at the vblank-start
# dot. The loop then hands the framebuffer to the display sprite with a broadcast it waits on,
# so the sprite draws one stable frame with the pen extension while the console is paused, and
# no scanline of the next frame can overwrite a row the sprite has not drawn yet. The report
# still shows the frames, the drawn frames, the CPU cycles, and the program counter reached.
#
# The host keyboard is sampled once per chunk, not once per emulated frame. A frame is about
# 29,780 cycles, so this loop spends roughly 300 chunks, and 300 yields, finishing one: a
# per-frame sample would hand the console a key press seconds after it happened and would miss
# a short tap altogether. src/keyboard_input.gs turns the keys that are held down into the live
# button masks controller.gs reports, and the console still decides when to look at them, the
# way a game strobes $4016 when it wants the pad. Sampling here also keeps the masks from
# changing while a chunk runs, so a chunk never sees half of one sample.
#
# The same sample point watches the ROM load key, and a press is serviced at the top of the
# next iteration instead of from a key-press hat: src/rom_input.gs asks the host for a string
# of hexadecimal byte values, replaces the embedded image with what it describes, and this loop
# then boots that image through the same path the embedded one took. Servicing the request
# here, with the console stopped, is what keeps the byte list from being replaced in the
# middle of a frame, and it leaves the counters and the report starting over from the new
# image instead of continuing the old one.

%include src/numeric
%include src/cpu_core
%include src/cpu_control
%include src/cpu_bus
%include src/controller
%include src/keyboard_input
%include src/rom_input
%include src/cartridge_loader
%include src/frame_loop
%include src/pen_display

# Whether the console booted and the image is running.
var rom_run_started = 0;

# The image the report names: the embedded one until a runtime load replaces it.
var rom_run_image_name = "test_rom.nes";

# The frames the console has run since the boot.
var rom_run_frame_count = 0;

# The finished frames the display sprite has drawn since the boot.
var rom_run_frames_drawn = 0;

# The CPU cycles the console has run since the boot.
var rom_run_cycles = 0;

# FPS tracking via Scratch timer (seconds since green flag).
var rom_run_fps = 0;
var rom_run_last_fps_update_frame = 0;
var rom_run_last_fps_update_timer = 0;
var rom_run_start_timer = 0;
var rom_run_frames_skipped = 0;

# One summary line for the display sprite.
var rom_run_state_text = "";

# Boots the console with the embedded image. A board that does not validate leaves the console
# stopped and says why in the state text.
proc rom_run_start {
    rom_run_started = 0;
    rom_run_frame_count = 0;
    rom_run_frames_drawn = 0;
    rom_run_cycles = 0;
    rom_run_state_text = "not started";

    # The self test detached every device and emptied the cartridge window
    # (APU is stubbed and always undriven).
    cpu_bus_ppu_attached = 1;
    cpu_bus_controllers_attached = 1;

    cartridge_load_board;

    if cartridge_board_attached == 1 {
        cpu_bus_reset;

        # A fresh console starts with cleared RAM, and the self test left values in it.
        cpu_bus_clear_ram;
        cpu_reset_registers;
        cpu_clear_interrupt_state;
        controller_reset;
        frame_loop_reset;

        # The game runs without a bus-access log, the way the reference runs the CPU without
        # a trace sink.
        cpu_access_log_enabled = 0;

        # The seven reset accesses, ending in the vector read the board answers.
        cpu_execute_reset_cycles;

        rom_run_started = 1;
        rom_run_state_text = "running " & cartridge_board_state_text;
        rom_run_fps = 0;
        rom_run_last_fps_update_frame = 0;
        rom_run_last_fps_update_timer = timer();
        rom_run_start_timer = timer();
        rom_run_frames_skipped = 0;
    } else {
        rom_run_state_text = "boot failed " & cartridge_board_state_text;
    }
}

# Runs the console until the project stops. Every iteration runs one bounded chunk of CPU
# cycles, samples the host keyboard, counts the frame the chunk finished, presents a frame the
# PPU completed, refreshes the report, and yields. The block is declared nowarp so the loop
# hands the project back after every chunk instead of holding the screen refresh for a whole
# warp window, and so the presentation broadcast can wait for the display sprite to finish
# drawing.
nowarp proc rom_run_loop {
    local elapsed = 0;
    local should_skip = 0;
    forever {
        # A pending ROM load is serviced before the console runs any more cycles, so the
        # image cannot be replaced under a frame that is already half run.
        rom_input_poll_key;

        if rom_input_requested == 1 {
            rom_run_load_input_image;
        }

        frame_loop_run_chunk;
        rom_run_cycles = rom_run_cycles + frame_loop_chunk_cycles_run;

        # The pads follow the host keyboard between chunks, so a press reaches the
        # console one chunk later instead of one emulated frame later.
        keyboard_poll_controllers;

        if frame_loop_frame_complete == 1 {
            frame_loop_reset;
            rom_run_frame_count = rom_run_frame_count + 1;

            # FPS counter: update every 60 emulated frames (~1 sec at 60 fps).
            if rom_run_frame_count - rom_run_last_fps_update_frame >= 60 {
                elapsed = timer() - rom_run_last_fps_update_timer;

                if elapsed > 0 {
                    rom_run_fps = 60 / elapsed;
                }

                rom_run_last_fps_update_frame = rom_run_frame_count;
                rom_run_last_fps_update_timer = timer();
            }

            # The summary line is rebuilt once per emulated frame instead of once per chunk:
            # the report cannot change faster than the counters it shows, and a chunk is only
            # a hundred cycles of one frame.
            rom_run_update_status;
        }

        if ppu_frame_ready == 1 {
            # Frame-skip when lagging: if emulated frames are >2 ahead of drawn
            # or FPS is known to be <30, drop every other frame to keep CPU
            # at 60Hz even when pen drawing is slow. Skipped frames still
            # advance PPU/CPU but do not block on the sprite.
            should_skip = 0;

            if rom_run_fps > 0 and rom_run_fps < 30 {
                if rom_run_frame_count % 2 == 0 {
                    should_skip = 1;
                }
            } elif rom_run_frame_count > rom_run_frames_drawn + 2 {
                should_skip = 1;
            }

            if should_skip == 1 {
                ppu_frame_ready = 0;
                rom_run_frames_skipped = rom_run_frames_skipped + 1;
            } else {
                ppu_frame_ready = 0;
                rom_run_frames_drawn = rom_run_frames_drawn + 1;
                pen_display_update_geometry;
                broadcast_and_wait "draw frame";
            }
        }

        wait 0;
    }
}

# Asks the host for a new image, installs it, and boots it. The console is stopped for the
# whole exchange: the ask block waits, the decode runs, and only an image that validates
# reaches cartridge_bytes, so a rejected paste leaves the running game exactly as it was. The
# display sprite reports the outcome from the state text this leaves behind.
proc rom_run_load_input_image {
    rom_input_requested = 0;

    # The press that opened the prompt is still down while the host types, so the key stays
    # marked as held until a sample sees it up again.
    rom_input_key_held = 1;

    rom_input_ask_for_text;

    if length rom_input_text == 0 {
        rom_run_state_text = "load cancelled, still running " & rom_run_image_name;
        broadcast "rom image changed";
    } else {
        rom_input_parse_text;
        rom_input_validate_image;

        if rom_input_error_code == rom_input_error.none {
            rom_input_install_image;

            # The staged bytes are in cartridge_bytes now; dropping the text frees the copy
            # the host pasted, which is the largest string this project ever holds. A refused
            # paste keeps it, so its variable monitor still shows what was rejected.
            rom_input_text = "";
            rom_run_image_name = "pasted image";
            rom_run_start;
            broadcast "rom image changed";
        } else {
            rom_run_state_text = "load failed, " & rom_input_error_text()
                & " after " & rom_input_byte_count & " bytes";
            broadcast "rom image changed";
        }
    }
}

# Rebuilds the summary line the display sprite shows.
proc rom_run_update_status {
    if rom_run_started == 1 {
        local fps_text = "";
        local skip_text = "";

        if rom_run_fps > 0 {
            fps_text = " fps " & (rom_run_fps // 1);
        }

        if rom_run_frames_skipped > 0 {
            skip_text = " skipped " & rom_run_frames_skipped;
        }

        rom_run_state_text = rom_run_image_name & " frame " & rom_run_frame_count
            & " drawn " & rom_run_frames_drawn
            & skip_text
            & fps_text
            & " cycles " & rom_run_cycles
            & " pc " & cpu_program_counter
            & " " & cartridge_board_state_text;
    }
}
