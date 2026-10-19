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

%include src/numeric
%include src/cpu_core
%include src/cpu_control
%include src/cpu_bus
%include src/controller
%include src/keyboard_input
%include src/cartridge_loader
%include src/frame_loop
%include src/pen_display

# Whether the console booted and the image is running.
var rom_run_started = 0;

# The frames the console has run since the boot.
var rom_run_frame_count = 0;

# The finished frames the display sprite has drawn since the boot.
var rom_run_frames_drawn = 0;

# The CPU cycles the console has run since the boot.
var rom_run_cycles = 0;

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

    # The self test detached every device and emptied the cartridge window.
    cpu_bus_ppu_attached = 1;
    cpu_bus_apu_attached = 1;
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
    forever {
        frame_loop_run_chunk;
        rom_run_cycles = rom_run_cycles + frame_loop_chunk_cycles_run;

        # The pads follow the host keyboard between chunks, so a press reaches the
        # console one chunk later instead of one emulated frame later.
        keyboard_poll_controllers;

        if frame_loop_frame_complete == 1 {
            frame_loop_reset;
            rom_run_frame_count = rom_run_frame_count + 1;
        }

        if ppu_frame_ready == 1 {
            ppu_frame_ready = 0;
            rom_run_frames_drawn = rom_run_frames_drawn + 1;

            # Recompute the pen geometry from the current pen_fit_to_screen
            # setting before handing the frame over, so a toggle takes
            # effect on this frame and stays fixed while the sprite draws.
            pen_display_update_geometry;
            broadcast_and_wait "draw frame";
        }

        rom_run_update_status;
        wait 0;
    }
}

# Rebuilds the summary line the display sprite shows.
proc rom_run_update_status {
    if rom_run_started == 1 {
        rom_run_state_text = "test_rom.nes frame " & rom_run_frame_count
            & " drawn " & rom_run_frames_drawn
            & " cycles " & rom_run_cycles
            & " pc " & cpu_program_counter
            & " " & cartridge_board_state_text;
    }
}
