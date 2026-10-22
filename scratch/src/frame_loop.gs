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

# NTSC timing constants. Keep each warp chunk bounded so Scratch can refresh and service stop/input
# events while the PPU advances. At 100 cycles this is about 300 yields per emulated frame.
# When the PPU is attached, a frame ends on the exact PPU frame transition at scanline 241 dot 1
# (matching NesConsole.advance_frame() in src/nes/core/nes_console.ts), with a hard safety bound
# of 29,830 CPU cycles; when the PPU is detached, 29,780 CPU cycles bounds a standalone frame.
var FRAME_LOOP_CYCLES_PER_FRAME = 29780;
var FRAME_LOOP_CYCLES_PER_CHUNK = 100;

# Frame loop state
var frame_loop_cycles_run = 0;
var frame_loop_frame_complete = 0;
var frame_loop_chunk_cycles_run = 0;
var frame_loop_start_ppu_frame = 0;
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
    frame_loop_start_ppu_frame = ppu_frames_ready_count + "";
}

# Runs one chunk of CPU cycles, advancing the PPU in sync.
# Each chunk runs up to FRAME_LOOP_CYCLES_PER_CHUNK cycles, stopping cleanly at instruction
# boundaries and at the exact PPU vblank-start frame transition so the caller can present the
# finished picture and pace before the new frame's NMI handler reads controller input.
proc frame_loop_run_chunk {
    local chunk_cycles = 0;
    local cycles_run = frame_loop_cycles_run + "";
    local start_ppu_frame = frame_loop_start_ppu_frame + "";
    local ppu_attached = cpu_bus_ppu_attached + "";
    local frame_done = frame_loop_frame_complete + "";
    local cycles_before = 0;
    local seq_cycles = 0;
    local cart_kind = cpu_bus_cartridge_kind + "";

    until chunk_cycles >= 100 or frame_done == 1 {
        if ppu_attached == 1 {
            if (ppu_frames_ready_count + "") != start_ppu_frame or cycles_run >= 29830 {
                frame_done = 1;
            }
        } elif cycles_run >= 29780 {
            frame_done = 1;
        }

        if frame_done == 0 {
            if (cpu_dma_phase + "") != 0 {
                # An OAM DMA transfer stalls the CPU: the bus runs the whole transfer in one call
                # and reports the cycles it spent, syncing the PPU to each OAM write cycle.
                cpu_bus_run_dma cpu_cycles;
                seq_cycles = cpu_dma_cycles_run + "";
                cpu_cycles = (cpu_cycles + "") + seq_cycles;
                cycles_run = cycles_run + seq_cycles;
                chunk_cycles = chunk_cycles + seq_cycles;
                ppu_sync_to_cycle cpu_cycles;

                if ppu_attached == 1 and (ppu_frames_ready_count + "") != start_ppu_frame {
                    frame_done = 1;
                }
            } else {
                # Run one CPU sequence (instruction, IRQ, NMI, or jam)
                cycles_before = cpu_cycles + "";
                cpu_begin_next_sequence;
                seq_cycles = (cpu_cycles + "") - cycles_before;
                cycles_run = cycles_run + seq_cycles;
                chunk_cycles = chunk_cycles + seq_cycles;

                # Advance the PPU when reaching the next unsolicited PPU/mapper event boundary
                # (vblank/frame-ready, pre-render wrap, or MMC3 IRQ window). Direct PPU, OAM DMA,
                # and mapper register accesses already call ppu_sync_to_cycle on their exact cycle.
                if ((cpu_cycles + "") * 3) + 2 >= (ppu_next_cpu_event_dots + "") {
                    ppu_sync_to_cycle cpu_cycles;
                } elif cart_kind == mapper_kind.mmc3 and (mmc3_irq_enabled + "") == 1 {
                    if (mmc3_irq_counter + "") <= 1
                        or (mmc3_irq_reload_pending + "") == 1
                        or ((cpu_cycles + "") * 3) + 2 >= (ppu_dots_clocked + "") + 250 {
                        ppu_sync_to_cycle cpu_cycles;
                    }
                }

                if ppu_attached == 1 {
                    if (ppu_frames_ready_count + "") != start_ppu_frame or cycles_run >= 29830 {
                        frame_done = 1;
                    }
                } elif cycles_run >= 29780 {
                    frame_done = 1;
                }
            }

            # Check for PPU NMI and forward to CPU
            if (ppu_nmi_edge_pending + "") == 1 {
                ppu_nmi_edge_pending = 0;
                cpu_request_nmi;
            }

            # IRQ line: only the cartridge board drives it in the no-audio port
            # (APU frame/DMC IRQs are stubbed to zero). MMC3 scanline IRQ is the
            # only live source.
            if cart_kind == mapper_kind.mmc3 and (mmc3_irq_line_asserted + "") == 1 {
                cpu_irq_line_asserted = 1;
            } else {
                cpu_irq_line_asserted = 0;
            }
        }
    }

    frame_loop_cycles_run = cycles_run;
    frame_loop_chunk_cycles_run = chunk_cycles;
    frame_loop_frame_complete = frame_done;
}

# Checks if OAM DMA is active and runs the DMA cycles.
# Sets frame_loop_dma_cycles to the number of DMA cycles run (0 if no DMA).
proc frame_loop_check_dma {
    cpu_bus_run_dma cpu_cycles;
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
