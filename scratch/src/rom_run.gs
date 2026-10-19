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
# The port has no PPU renderer yet, so the run produces no picture: the game still writes to
# VRAM, still receives vblank interrupts, and still advances the frame counter, and the report
# shows the frames, the CPU cycles, and the program counter the console reached.

%include src/numeric
%include src/cpu_core
%include src/cpu_control
%include src/cpu_bus
%include src/controller
%include src/cartridge_loader
%include src/frame_loop

# Whether the console booted and the image is running.
var rom_run_started = 0;

# The frames the console has run since the boot.
var rom_run_frame_count = 0;

# The CPU cycles the console has run since the boot.
var rom_run_cycles = 0;

# One summary line for the display sprite.
var rom_run_state_text = "";

# Boots the console with the embedded image. A board that does not validate leaves the console
# stopped and says why in the state text.
proc rom_run_start {
    rom_run_started = 0;
    rom_run_frame_count = 0;
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
# cycles, counts the frame the chunk finished, refreshes the report, and yields. The block is
# declared nowarp so the loop hands the project back after every chunk instead of holding the
# screen refresh for a whole warp window.
nowarp proc rom_run_loop {
    forever {
        frame_loop_run_chunk;
        rom_run_cycles = rom_run_cycles + frame_loop_chunk_cycles_run;

        if frame_loop_frame_complete == 1 {
            frame_loop_reset;
            rom_run_frame_count = rom_run_frame_count + 1;
        }

        rom_run_update_status;
        wait 0;
    }
}

# Rebuilds the summary line the display sprite shows.
proc rom_run_update_status {
    if rom_run_started == 1 {
        rom_run_state_text = "test_rom.nes frame " & rom_run_frame_count
            & " cycles " & rom_run_cycles
            & " pc " & cpu_program_counter
            & " " & cartridge_board_state_text;
    }
}
