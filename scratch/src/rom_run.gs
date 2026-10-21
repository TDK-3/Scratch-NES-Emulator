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
# yield between chunks so the project stays responsive. A chunk never runs past the end of a frame,
# and the frame counter advances when a frame completes. The bus-access log stays off while the game
# runs, the way the reference runs the CPU without a trace sink, so the log cannot grow without
# bound.
#
# Every time the PPU finishes a visible frame it raises ppu_frame_ready at the vblank-start
# dot. The loop then hands the framebuffer to the display sprite with a broadcast it waits on,
# so the sprite draws one stable frame with the pen extension while the console is paused, and
# no scanline of the next frame can overwrite a row the sprite has not drawn yet. Nothing is
# reported per frame. Pressing E halts the console and dumps its state once (rom_run_halt_and_dump).
#
# The host keyboard is sampled once every four chunks, not once per emulated frame. A frame is
# about 29,780 cycles, so this loop spends roughly 300 bounded chunks finishing one. Polling every
# four chunks keeps input responsive without repeating sixteen key-device lookups each time.
# src/keyboard_input.gs turns the held keys into the live button masks controller.gs reports,
# and the console still decides when to look at them, the
# way a game strobes $4016 when it wants the pad. Sampling here also keeps the masks from
# changing while a chunk runs, so a chunk never sees half of one sample.
#
# The same sample point watches the ROM load key, and a press is serviced at the top of the
# next iteration instead of from a key-press hat: src/rom_input.gs asks the host for a string
# of hexadecimal byte values, replaces the embedded image with what it describes, and this loop
# then boots that image through the same path the embedded one took. Servicing the request
# here, with the console stopped, is what keeps the byte list from being replaced in the
# middle of a frame, and it leaves the counters starting over from the new
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

# The image the dump names: the embedded one until a runtime load replaces it.
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

# Frame-rate cap. The console runs at most ROM_RUN_FRAME_RATE_CAP emulated frames per second of
# Scratch time: frame n is due at rom_run_pace_origin + n / cap, and the loop waits for it. Once
# the schedule is more than ROM_RUN_LAG_RESET_SECONDS behind, it restarts from now so the console
# does not burst to catch up on frames it never ran.
var ROM_RUN_FRAME_RATE_CAP = 60;
var ROM_RUN_LAG_RESET_SECONDS = 1;
var rom_run_pace_origin = 0;

# rom_run_skip_active is 1 while the console is behind its schedule, so a completed frame may be
# skipped. rom_run_last_frame_skipped records whether the previous completed frame was skipped,
# so no two frames in a row are skipped.
var rom_run_skip_active = 0;
var rom_run_last_frame_skipped = 0;

# Chunks between host-input samples. Four 100-cycle chunks are 400 emulated CPU cycles; actual
# wall-time input latency depends on how quickly the runtime completes and schedules each chunk.
var rom_run_poll_interval_chunks = 4;
var rom_run_poll_countdown = 0;

# One summary line for the display sprite: the boot and ROM-load messages.
var rom_run_state_text = "";

# The state dump the E key writes, shown by the display sprite.
var rom_run_dump_text = "";

# Decides whether a completed frame is skipped instead of drawn. While skipping is active, every
# other frame is drawn, so the picture still refreshes at half the emulated rate when the pen
# cannot keep up. A lead test (frames run ahead of frames drawn) was used before; it never
# recovered, because each skipped frame widened the lead and nothing narrowed it.
func rom_run_should_skip(skip_active, last_frame_skipped) {
    if $skip_active == 1 and $last_frame_skipped == 0 {
        return 1;
    }

    return 0;
}

# The Scratch time at which frame frame_count is due, counted from origin. Mirrors the schedule
# in rom_run_pace_frame.
func rom_run_frame_due(origin, frame_count) {
    return $origin + $frame_count / ROM_RUN_FRAME_RATE_CAP;
}

# Returns 1 when the console is past its due time, 0 when it is on time or early. Mirrors the
# comparison in rom_run_pace_frame.
func rom_run_is_behind(now, due) {
    if $now > $due {
        return 1;
    }

    return 0;
}

# Holds the console to the frame-rate cap. Called once per completed frame. A frame that finished
# late marks the console behind, so the next completed frame may be skipped and the draw cost can
# be recovered; a frame that finished early waits until it is due. Declared nowarp because the
# wait must yield to the project.
nowarp proc rom_run_pace_frame {
    local due = 0;
    local now = 0;

    due = rom_run_frame_due(rom_run_pace_origin, rom_run_frame_count);
    now = timer();

    if now - due > ROM_RUN_LAG_RESET_SECONDS {
        rom_run_pace_origin = now - rom_run_frame_count / ROM_RUN_FRAME_RATE_CAP;
        rom_run_skip_active = 1;
    } elif rom_run_is_behind(now, due) == 1 {
        rom_run_skip_active = 1;
    } else {
        rom_run_skip_active = 0;

        until timer() >= due {
            wait 0;
        }
    }
}

# Boots the console with the embedded image. A board that does not validate leaves the console
# stopped and says why in the state text.
proc rom_run_start {
    rom_run_started = 0;
    rom_run_frame_count = 0;
    rom_run_frames_drawn = 0;
    rom_run_cycles = 0;
    rom_run_poll_countdown = 0;
    rom_run_skip_active = 0;
    rom_run_last_frame_skipped = 0;
    rom_run_pace_origin = 0;
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
        rom_run_pace_origin = timer();
        rom_run_frames_skipped = 0;
        hide;
    } else {
        rom_run_state_text = "boot failed " & cartridge_board_state_text;
    }
}

# Runs the console until the project stops. Every iteration runs one bounded chunk of CPU
# cycles, samples the host keyboard, counts the frame the chunk finished, presents a frame the
# PPU completed, and yields. The block is declared nowarp so the loop
# hands the project back after every chunk instead of holding the screen refresh for a whole
# warp window, and so the presentation broadcast can wait for the display sprite to finish
# drawing.
nowarp proc rom_run_loop {
    local elapsed = 0;
    local should_skip = 0;
    forever {
        # The host keyboard and the ROM load key are sampled once every few chunks instead of
        # once per chunk. A pending ROM load is still serviced before the console runs any more
        # cycles in the iteration that sampled it, so the image cannot be replaced under a frame
        # that is already half run.
        rom_run_poll_countdown = rom_run_poll_countdown - 1;

        if rom_run_poll_countdown <= 0 {
            rom_run_poll_countdown = rom_run_poll_interval_chunks;
            rom_input_poll_key;

            if rom_input_requested == 1 {
                rom_run_load_input_image;
            }

            # The pads follow the host keyboard between chunks, so a press reaches the
            # console within one poll interval instead of one emulated frame later.
            keyboard_poll_controllers;

            # E halts the console and dumps its state. It is sampled with the pads, and the halt
            # does not return, so one press is enough.
            if key_pressed("e") {
                rom_run_halt_and_dump;
            }
        }

        frame_loop_run_chunk;
        rom_run_cycles = rom_run_cycles + frame_loop_chunk_cycles_run;

        if frame_loop_frame_complete == 1 {
            frame_loop_reset;
            rom_run_frame_count = rom_run_frame_count + 1;
            rom_run_pace_frame;

            # FPS counter: update every 60 emulated frames (~1 sec at 60 fps).
            if rom_run_frame_count - rom_run_last_fps_update_frame >= 60 {
                elapsed = timer() - rom_run_last_fps_update_timer;

                if elapsed > 0 {
                    rom_run_fps = 60 / elapsed;
                }

                rom_run_last_fps_update_frame = rom_run_frame_count;
                rom_run_last_fps_update_timer = timer();
            }
        }

        if ppu_frame_ready == 1 {
            # Skipped frames still advance the PPU and CPU, but they skip the pen draw and the
            # broadcast wait. The decision is made by rom_run_should_skip.
            should_skip = rom_run_should_skip(rom_run_skip_active, rom_run_last_frame_skipped);
            ppu_frame_ready = 0;

            if should_skip == 1 {
                rom_run_last_frame_skipped = 1;
                rom_run_frames_skipped = rom_run_frames_skipped + 1;
            } else {
                rom_run_last_frame_skipped = 0;
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

# Writes the state dump into rom_run_dump_text: the run counters, the CPU registers, the PPU
# registers, the MMC3 registers and IRQ state, the pad masks, and the board. Pure reporting; it
# reads the state and changes nothing the console uses.
proc rom_run_build_dump {
    rom_run_dump_text = "frame " & rom_run_frame_count & " drawn " & rom_run_frames_drawn
        & " skipped " & rom_run_frames_skipped & " fps " & (rom_run_fps // 1)
        & " cycles " & rom_run_cycles & " image " & rom_run_image_name;

    rom_run_dump_text = rom_run_dump_text & " | CPU pc " & cpu_program_counter
        & " a " & cpu_a & " x " & cpu_x & " y " & cpu_y & " sp " & cpu_stack_pointer
        & " p " & cpu_status & " cycles " & cpu_cycles & " nmi_pending " & cpu_nmi_pending
        & " irq " & cpu_irq_line_asserted & " jammed " & cpu_jammed & " dma " & cpu_dma_phase;

    rom_run_dump_text = rom_run_dump_text & " | PPU scanline " & ppu_scanline & " dot " & ppu_dot
        & " frame " & ppu_frame_number & " ctrl " & ppu_control_register
        & " mask " & ppu_mask_register & " status " & ppu_status_register
        & " vram " & ppu_vram_address & " nmi_out " & ppu_nmi_output & " dots " & ppu_dots_clocked;

    rom_run_dump_text = rom_run_dump_text & " | MMC3 select " & mmc3_bank_select
        & " prg_mode " & mmc3_prg_mode & " chr_mode " & mmc3_chr_mode
        & " regs " & mmc3_bank_registers[1] & "," & mmc3_bank_registers[2]
        & "," & mmc3_bank_registers[3] & "," & mmc3_bank_registers[4]
        & "," & mmc3_bank_registers[5] & "," & mmc3_bank_registers[6]
        & "," & mmc3_bank_registers[7] & "," & mmc3_bank_registers[8]
        & " irq latch " & mmc3_irq_latch & " counter " & mmc3_irq_counter
        & " enabled " & mmc3_irq_enabled & " line " & mmc3_irq_line_asserted;

    rom_run_dump_text = rom_run_dump_text & " | pads " & controller_button_masks[1]
        & "," & controller_button_masks[2] & " | " & cartridge_board_state_text;
}

# Halts the console for good and hands the dump to the display sprite. The loop never resumes:
# only a new green flag, which restarts the boot, runs the console again. Declared nowarp so the
# wait yields to the project instead of freezing it.
nowarp proc rom_run_halt_and_dump {
    rom_run_build_dump;
    rom_run_state_text = "halted by E at frame " & rom_run_frame_count;
    broadcast_and_wait "rom run dump";

    forever {
        wait 0;
    }
}
