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
%include src/cartridge_loader

# NTSC timing constants. Chunk size tuned to 500: ~60 chunks/frame vs 300 before, cutting yields
# 5x while keeping input poll (once/chunk) at ~500Hz (2ms granularity) well below human perception.
var FRAME_LOOP_CYCLES_PER_FRAME = 29780;
var FRAME_LOOP_CYCLES_PER_CHUNK = 500;

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

# Runs one chunk of CPU cycles, advancing the PPU in sync.
# Each chunk runs up to FRAME_LOOP_CYCLES_PER_CHUNK cycles, but stops at instruction
# boundaries to avoid corrupting state. Audio is not ported; the APU clock and
# frame-IRQ contribution are omitted (see apu_2a03.gs stub).
#
# This is the innermost loop of the whole emulator, so it avoids custom-block calls wherever
# a comparison will do: the DMA state is tested directly and the transfer runs in one call
# (cpu_bus_run_dma), the PPU advances by a whole sequence's worth of dots in one call
# (ppu_clock_cpu_cycles), and the NMI latch is read directly rather than through
# ppu_take_nmi_edge. The standalone procs and funcs stay for the self test
# and as the documented description of each step.
proc frame_loop_run_chunk {
    frame_loop_chunk_cycles_run = 0;

    until frame_loop_chunk_cycles_run >= FRAME_LOOP_CYCLES_PER_CHUNK or frame_loop_frame_complete == 1 {
        if frame_loop_cycles_run >= FRAME_LOOP_CYCLES_PER_FRAME {
            frame_loop_frame_complete = 1;
        } elif cpu_dma_phase != 0 {
            # An OAM DMA transfer stalls the CPU: the bus runs the whole transfer in one call
            # and reports the cycles it spent, and the PPU advances by three dots per cycle in
            # another one. This used to be one call per DMA cycle plus three dot clocks each.
            cpu_bus_run_dma;
            frame_loop_dma_cycles = cpu_dma_cycles_run;
            frame_loop_cycles_run = frame_loop_cycles_run + frame_loop_dma_cycles;
            frame_loop_chunk_cycles_run = frame_loop_chunk_cycles_run + frame_loop_dma_cycles;
            ppu_clock_cpu_cycles frame_loop_dma_cycles;
        } else {
            # Run one CPU sequence (instruction, IRQ, NMI, or jam)
            frame_loop_cycles_before = cpu_cycles;
            cpu_begin_next_sequence;
            frame_loop_cycles_after = cpu_cycles;
            frame_loop_sequence_cycles = frame_loop_cycles_after - frame_loop_cycles_before;

            frame_loop_cycles_run = frame_loop_cycles_run + frame_loop_sequence_cycles;
            frame_loop_chunk_cycles_run = frame_loop_chunk_cycles_run + frame_loop_sequence_cycles;

            # Advance the PPU by three dots per CPU cycle in one call. The instruction has
            # already spent all of its bus cycles inside cpu_begin_next_sequence, so the PPU
            # cannot be touched in between: batching the dots cannot reorder a register write
            # against a dot. The cycle-count fast paths that used to unroll 2, 3, and 4 cycles
            # into literal dot-clock statements are gone; they existed to avoid a loop header
            # that is now amortized over a whole instruction.
            ppu_clock_cpu_cycles frame_loop_sequence_cycles;

            # Check for PPU NMI and forward to CPU
            if ppu_nmi_edge_pending == 1 {
                ppu_nmi_edge_pending = 0;
                cpu_request_nmi;
            }

            # IRQ line: only the cartridge board drives it in the no-audio port
            # (APU frame/DMC IRQs are stubbed to zero). MMC3 scanline IRQ is the
            # only live source.
            if cpu_bus_cartridge_kind == mapper_kind.mmc3 and mmc3_irq_line_asserted == 1 {
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
    cpu_bus_run_dma;
    frame_loop_dma_cycles = cpu_dma_cycles_run;
}

# Returns the total number of CPU cycles run in the current frame.
func frame_loop_get_cycles_run() {
    return frame_loop_cycles_run;
}

# Returns whether the current frame is complete.
func frame_loop_is_frame_complete() {
    return frame_loop_frame_complete;
}
