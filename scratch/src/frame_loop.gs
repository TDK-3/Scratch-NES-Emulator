# Frame loop with bounded yield policy for the GoboScript port.
#
# The NES runs at 60 frames per second, with each frame consisting of approximately 29,780 CPU
# cycles (NTSC timing). In Scratch, running all of these cycles in a single no-refresh block
# would freeze the project and make it unresponsive. Instead, we split each frame into smaller
# chunks and yield between them.
#
# This module implements a chunked frame loop that:
# - Runs a bounded number of CPU cycles per chunk (default: 100)
# - Advances the PPU in sync (3 PPU dots per CPU cycle)
# - Handles OAM DMA stalls
# - Checks for IRQ/NMI at instruction boundaries
# - Bounds the work of one chunk so the caller can update the display between chunks
#
# The chunk size is a tradeoff: larger chunks are more efficient but less responsive; smaller
# chunks are more responsive but slower due to yield overhead. The default of 100 cycles per
# chunk gives ~300 chunks per frame, which keeps a chunk short enough that the project still
# refreshes while the emulator runs.
#
# The Scratch runtime yields once per loop iteration on its own, so the caller does not need to
# wait between the chunks. The caller may still add a wait of its own between chunks: that keeps
# the project responsive, and the heap stays flat as long as the chunk itself stays bounded.
#
# Usage:
#   frame_loop_reset;                    # Initialize at frame start
#   while frame_loop_frame_complete == 0 {
#       frame_loop_run_chunk;            # Run one chunk
#       # ... update the display ...
#   }
#   # Frame is complete, ready for next frame

%include src/numeric
%include src/cpu_core
%include src/cpu_control
%include src/cpu_bus
%include src/ppu_2c02
%include src/apu_2a03
%include src/cartridge_loader

# NTSC timing constants
var FRAME_LOOP_CYCLES_PER_FRAME = 29780;
var FRAME_LOOP_CYCLES_PER_CHUNK = 100;

# Frame loop state
var frame_loop_cycles_run = 0;
var frame_loop_frame_complete = 0;
var frame_loop_chunk_cycles_run = 0;
var frame_loop_dma_cycles = 0;
var frame_loop_cycles_before = 0;
var frame_loop_cycles_after = 0;
var frame_loop_sequence_cycles = 0;
var frame_loop_dma_done = 0;

# Resets the frame loop at the start of a new frame.
proc frame_loop_reset {
    frame_loop_cycles_run = 0;
    frame_loop_frame_complete = 0;
    frame_loop_chunk_cycles_run = 0;
}

# Runs one chunk of CPU cycles, advancing PPU and APU in sync.
# Each chunk runs up to FRAME_LOOP_CYCLES_PER_CHUNK cycles, but stops at instruction
# boundaries to avoid corrupting state.
#
# This is the innermost loop of the whole emulator, so it avoids custom-block calls wherever
# a comparison will do: the DMA state is tested directly instead of through
# frame_loop_check_dma, the PPU's three dots per CPU cycle are issued as three dot clocks
# rather than through ppu_clock_cpu_cycle, the NMI latch is read directly rather than through
# ppu_take_nmi_edge, and the IRQ line is composed from the APU and board state that
# apu_is_irq_asserted and cartridge_board_irq_line would read. The standalone procs and
# funcs stay for the self test and as the documented description of each step.
proc frame_loop_run_chunk {
    frame_loop_chunk_cycles_run = 0;

    until frame_loop_chunk_cycles_run >= FRAME_LOOP_CYCLES_PER_CHUNK or frame_loop_frame_complete == 1 {
        if frame_loop_cycles_run >= FRAME_LOOP_CYCLES_PER_FRAME {
            frame_loop_frame_complete = 1;
        } elif cpu_dma_phase != 0 {
            # An OAM DMA transfer stalls the CPU: the bus runs the whole transfer, and the
            # cycles it spent are clocked on the PPU and APU below like any other cycle.
            frame_loop_check_dma;
            frame_loop_cycles_run = frame_loop_cycles_run + frame_loop_dma_cycles;
            frame_loop_chunk_cycles_run = frame_loop_chunk_cycles_run + frame_loop_dma_cycles;

            repeat frame_loop_dma_cycles {
                ppu_clock_ppu_dot;
                ppu_clock_ppu_dot;
                ppu_clock_ppu_dot;
                apu_clock_cpu_cycle;
            }
        } else {
            # Run one CPU sequence (instruction, IRQ, NMI, or jam)
            frame_loop_cycles_before = cpu_cycles;
            cpu_begin_next_sequence;
            frame_loop_cycles_after = cpu_cycles;
            frame_loop_sequence_cycles = frame_loop_cycles_after - frame_loop_cycles_before;

            frame_loop_cycles_run = frame_loop_cycles_run + frame_loop_sequence_cycles;
            frame_loop_chunk_cycles_run = frame_loop_chunk_cycles_run + frame_loop_sequence_cycles;

            # Advance the PPU by three dots and the APU by one cycle per CPU cycle.
            repeat frame_loop_sequence_cycles {
                ppu_clock_ppu_dot;
                ppu_clock_ppu_dot;
                ppu_clock_ppu_dot;
                apu_clock_cpu_cycle;
            }

            # Check for PPU NMI and forward to CPU
            if ppu_nmi_edge_pending == 1 {
                ppu_nmi_edge_pending = 0;
                cpu_request_nmi;
            }

            # The APU and the cartridge board drive one IRQ line, the way the console
            # composes them: an MMC3 board raises a scanline IRQ and the APU raises a
            # frame IRQ. The composition is written out here instead of through
            # apu_is_irq_asserted and cartridge_board_irq_line.
            if apu_frame_irq != 0 or dmc_irq != 0 {
                cpu_irq_line_asserted = 1;
            } elif cpu_bus_cartridge_kind == mapper_kind.mmc3 and mmc3_irq_line_asserted == 1 {
                cpu_irq_line_asserted = 1;
            } else {
                cpu_irq_line_asserted = 0;
            }
        }
    }

    if frame_loop_cycles_run >= FRAME_LOOP_CYCLES_PER_FRAME {
        frame_loop_frame_complete = 1;
    }
}

# Checks if OAM DMA is active and runs the DMA cycles.
# Sets frame_loop_dma_cycles to the number of DMA cycles run (0 if no DMA).
proc frame_loop_check_dma {
    frame_loop_dma_cycles = 0;
    frame_loop_dma_done = 0;

    # The DMA runs until the bus reports that it is finished, which is one call when no
    # transfer is pending. The bound keeps a stuck transfer from hanging the console.
    until frame_loop_dma_done == 1 {
        if cpu_clock_dma_cycle() == 0 {
            frame_loop_dma_done = 1;
        } else {
            frame_loop_dma_cycles = frame_loop_dma_cycles + 1;

            if frame_loop_dma_cycles >= 520 {
                frame_loop_dma_done = 1;
            }
        }
    }
}

# Returns the total number of CPU cycles run in the current frame.
func frame_loop_get_cycles_run() {
    return frame_loop_cycles_run;
}

# Returns whether the current frame is complete.
func frame_loop_is_frame_complete() {
    return frame_loop_frame_complete;
}
