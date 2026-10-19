# Architecture

## Design goals

1. Keep the TypeScript implementation deterministic, inspectable, and testable without a browser.
2. Make the hardware contracts small enough to port to GoboScript without inventing Scratch-specific CPU
   or PPU behavior.
3. Validate CPU, PPU, mapper, controller, and timing behavior independently before relying on whole-game
   screenshots.
4. Keep the TypeScript browser/canvas host and TurboWarp renderer/audio at the edge of the emulator. Do
   not let DOM APIs or Scratch UI blocks become the hardware model.

The TypeScript implementation is authoritative for this project. GoboScript is a separately compiled target
implementation; it is not generated from TypeScript.

## Scope and known fixture

Target NTSC NES behavior first, while keeping region timing explicit so PAL and Dendy can be added later.
The NES CPU is the Ricoh 2A03, a 6502-family processor whose decimal arithmetic mode is disabled. The PPU is
the 2C02 family. Emulator behavior has important timing and bus-side-effect requirements, so a CPU
instruction that looks correct in isolation may still be wrong when DMA, interrupts, PPU registers, or
mapper writes are involved.

The supplied 81,936-byte fixture has an iNES 1.0 header and mapper 4 (MMC3): four 16 KiB PRG banks, two 8
KiB CHR banks, vertical mirroring, battery-backed RAM, and no trainer. Its title screen and `SM2SAVE` marker
identify it with high confidence as an MMC3 conversion of Japanese *Super Mario Bros. 2* (Lost Levels), likely
Loopy's port; exact revision and rights remain unknown. A bounded integration test reaches its title screen at
frame 43, also confirmed visually in a temporary JSNES 2.1.0 run. An earlier 1,000,000-cycle smoke stopped at
frame 33 with a uniform palette-index-1 framebuffer and silent audio, before title initialization. This is one
ROM's title-screen boot, not a game-compatibility or cycle-accuracy claim; a mapper 0-only build cannot boot it.

## Intended module boundaries

The names below describe the target architecture. The cartridge parser, explicit mapper selector, NROM,
MMC3, CPU state helpers, reset/stack and addressing behavior, cycle-visible execution of all official
opcodes, instruction-boundary IRQ/NMI service, production CPU address decoder, cycle-visible OAM DMA
sequencer, PPU memory bus, CPU-facing PPU registers, deterministic PPU timing, and a baseline pixel pipeline
exist today. `Ppu2C02` drives MMC3's per-dot hook and exposes an NMI edge latch. `Apu2A03` implements the
pulse, triangle, noise, and DMC channels, CPU register port, NTSC frame events/IRQ, DMC sample-fetch handshake,
and nonlinear pulse+TND mixer. `ApuAudioSampler` produces deterministic mono samples from NTSC CPU time;
the CPU bus handles standalone DMC stalls and DMC/OAM DMA arbitration. `NesControllerPorts` implements two
standard serial controllers. `NesConsole` composes both implemented mapper routes with CPU, PPU, APU, and
controllers; `NtscClock` tracks integer NTSC master ticks, and the console provides reset, pause, cycle/sequence
step, and bounded frame advancement. The optional `NesConsoleTraceRecorder` stores ordered interrupt, CPU bus,
APU, PPU-dot, NMI-edge, and frame-boundary events in a bounded ring buffer; it adds no browser dependencies or
trace-event allocations when omitted. `src/nes/browser/` is a separate TypeScript host adapter with a canvas
renderer, pixel-preserving scaling, requestAnimationFrame scheduler, standard-pad keyboard mapping, an
approximate stateful audio-output filter, and a Web Audio sample sink. The RGB palette is an approximation;
host browser playback/performance and the separate TurboWarp output path still need validation. Audio filtering
is not a calibrated 2A03 circuit model. The scheduler has explicit event
ordering and connects PPU NMI plus APU/MMC3 IRQ levels, but hardware edge phase still needs licensed-ROM
validation; exact PPU quirks and DMC phase validation remain open.

```text
src/nes/
    cartridge/
        ines.ts             iNES / NES 2.0 parsing and validated ROM metadata
        mapper.ts           explicit mapper/submapper routing and unsupported-board results
        mapper_000.ts       NROM CPU/PPU mapping with PRG RAM and CHR ROM/RAM
        mapper_004.ts       MMC3, required by the supplied fixture
    core/
        nes_console.ts      supported-ROM composition, control API, reset, and frame output
        ntsc_clock.ts       integer 21,477,272 Hz master-clock dividers
        console_trace.ts    optional bounded CPU/APU/PPU/interrupt/frame trace recorder
    cpu/
        registers.ts        register types, status flags, and width normalization
        alu.ts              binary ADC/SBC and flag results
        addressing_modes.ts official addressing-mode and resolved-operand types
        cpu_2a03.ts         cycle-visible official opcodes, reset, stack, branches, and IRQ/NMI service
        cpu_trace.ts        optional instruction-level CPU trace adapter
        opcode_table.ts     metadata for the official opcode set
        cpu_bus.ts          CPU read/write contract and masked device-read result
        nes_cpu_bus.ts      address decode, RAM mirrors, I/O routing, open bus, and OAM/DMC DMA arbitration
    ppu/
        ppu_2c02.ts         CPU registers, NTSC scanline/dot progression, vblank, odd-frame timing, NMI edges
        ppu_bus.ts          pattern/nametable/palette/OAM routing, mirroring, and mapper-visible accesses
        framebuffer.ts      256 by 240 palette-index and emphasis planes
    apu/
        pulse_channel.ts    pulse duty/timer/length/envelope/sweep unit
        apu_2a03.ts         pulse/triangle/noise/DMC CPU port, frame sequence, nonlinear mixer
        dmc_channel.ts      DMC reader, sample/output buffers, timer, DMA request, and IRQ state
        audio_sampler.ts    integer phase accumulator and runtime-independent mono sample buffering
    input/
        controller.ts       serial controller register behavior
    browser/
        audio_filter.ts      stateful host-output high/low-pass approximation
        audio_output.ts      Web Audio sink for deterministic sample blocks
        battery_ram_store.ts ROM-SHA-keyed PRG/CHR-NVRAM local-storage adapter
        canvas_renderer.ts palette/emphasis conversion and pixel-preserving canvas output
        frame_scheduler.ts  bounded one-frame-per-animation-callback runner
        main.ts             browser UI, ROM loading, and keyboard adapters
    diagnostics/
        trace.ts            optional deterministic traces outside core logic
web/
    index.html              browser preview shell
    styles.css              responsive UI and integer-scaled canvas styling
```

File names are illustrative; follow the source naming rules in `AGENTS.md`. Avoid placeholder modules with
no behavior. Add a file when there is a concrete contract to implement.

## Dependency direction

```text
InesRom -> Mapper -> NesConsole -> CPU, PPU, APU, controllers, clock
                                      |
                                      +-> frame/audio output adapters
```

- The parser turns bytes into validated metadata and ROM slices. It does not select or execute a mapper.
- The mapper receives cartridge CPU/PPU address activity and owns bank selection, cartridge RAM, mirroring
  overrides, and IRQ behavior where applicable.
- The CPU bus routes reads and writes to CPU RAM, PPU registers, APU/controller registers, DMA, and the
  cartridge.
- `PpuMemoryBus` delegates pattern reads/writes through `PpuMapperPort` and reports pattern and nametable
  accesses before handling them, preserving the normalized 14-bit address for mapper IRQ logic. Its
  `clock_ppu_dot()` method forwards one elapsed PPU dot to the mapper, including dots without bus activity;
  `Ppu2C02.clock_ppu_dot()` calls it once for every PPU dot it processes. The bus routes `$2000-$3EFF` through four KiB of
  nametable RAM using the mapper's current vertical, horizontal, or four-screen mirroring mode;
  `$3000-$3EFF` mirrors `$2000-$2EFF`. Palette RAM is internal, repeats every 32 bytes, aliases the four
  universal-background entries, and masks writes to six bits. Primary OAM is a separate 256-byte address
  space and does not generate mapper notifications. PPU registers, PPUDATA side effects, and scheduler
  timing are outside this memory-bus module.
- The scheduler owns the relationship between CPU and PPU time. Device code must not invent its own
  wall-clock timer.
- The output adapter receives frames and audio samples. Core hardware state must not import browser,
  Scratch, TurboWarp, DOM, or Node UI code.

## Timing and stepping

NES NTSC PPU timing has 341 dots on each of 262 scanlines. `Ppu2C02` starts at pre-render scanline 261,
dot 0; even frames are 89,342 dots. When either background or sprite rendering is enabled, odd frames
advance from (261,339) directly to (0,0), omitting dot 340 for an 89,341-dot frame. Vblank begins at
(241,1), and the vblank, sprite-zero-hit, and sprite-overflow status flags clear at (261,1).
`Ppu2C02.clock_ppu_dot()` advances one PPU dot and forwards one mapper timing tick;
`Ppu2C02.clock_cpu_cycle()` advances three PPU dots. `NtscClock` counts the 21,477,272 Hz master clock with
one PPU edge every four ticks and one CPU/APU edge every twelve. `NesConsole` samples APU/MMC3 IRQ levels,
then processes a CPU bus cycle and APU clock before the PPU dot on coincident edges; it clocks PPU dots on
intervening edges and forwards latched NMI edges. Synthetic integration tests assert the order. An optional
`NesConsoleTraceRecorder` captures these events plus every PPU dot and frame boundary in a bounded ring buffer;
its absence allocates no trace-event objects. The event order is deterministic, but exact hardware phase remains
unvalidated against licensed ROMs. Use deterministic emulated time, never `setInterval` inside the hardware core.

`Cpu2A03.clock_cycle()` executes one CPU-bus transaction and returns the sequence kind (`instruction`,
`irq`, `nmi`, `reset`, or `dma`), 1-based cycle index, and sequence-completion flag. The generator-based
micro-operation engine covers the official opcodes, reset, branches, and seven-cycle IRQ/NMI entry; `step()`
includes pending DMA stalls before the next CPU instruction/interrupt boundary. `request_reset()` exposes reset reads individually, while `reset()` remains a synchronous wrapper. `NesConsole`
couples CPU bus execution, APU clocks, and PPU dots through the NTSC master divider; synthetic tests exercise
the ordering and device interrupt connections, while edge-phase accuracy and interrupt corner cases still need
licensed-ROM validation. The console exposes copy/restore APIs for declared PRG and CHR NVRAM through each
mapper, excluding volatile RAM; restore validates both region lengths before writing either region. The browser
stores both regions per ROM SHA-256 on pause, stepping, ROM replacement, and page hide, and accepts legacy
PRG-only records. TurboWarp storage and full save-state support remain open. OAM DMA halt/alignment cycles and
DMC's 3/4-cycle halt/dummy/optional-align/get
sequence are modeled by the CPU bus. A DMC get takes priority over an OAM source get, with OAM realignment
afterward; phase-boundary validation remains outstanding.

## CPU and memory model

Represent 8-bit and 16-bit wraps explicitly. Keep the CPU status flags named and isolate status
packing/unpacking. The TypeScript CPU executes all 151 official opcodes and resolves all 13 addressing
modes through per-cycle bus operations. It exposes branch and indexed dummy reads, read-modify-write bus
ordering, and seven-cycle reset/IRQ/NMI sequences. IRQ remains level-sensitive; NMI is latched and
prioritized. Delayed IRQ polling after CLI/SEI/PLP is modeled at sequence boundaries. `NesConsole` now clocks CPU, APU,
and PPU from the NTSC master divider and connects the PPU NMI edge plus APU/MMC3 IRQ levels to the CPU;
synthetic tests cover vblank NMI, APU frame IRQ, MMC3 IRQ delivery, and CPU/APU/PPU trace ordering. Exact
interrupt phase boundaries and licensed mapper-IRQ trace comparison, PPU hardware quirks, calibration of the
approximate host-output audio filter, and hands-on browser playback/performance remain open. The browser host
adapters exist separately from the core;
the TurboWarp output/input path is not implemented. OAM and DMC DMA stalls are modeled by the CPU bus, with
exact edge timing still requiring external validation. Continue validating interrupt priority, reset-vector reads,
2A03 decimal-mode behavior, and synchronization with the PPU.

`NesCpuBus` now decodes mirrored 2 KiB internal RAM, mirrored PPU registers, APU/controller ports, and
cartridge windows. Device reads return a driven-bit mask so the bus can preserve open-bus bits; unmapped
reads return the latched CPU data byte, and writes latch their value. OAM DMA uses the CPU bus for source
reads and routes each destination byte through PPU register $2004. DMC sample requests also fetch through the
cartridge CPU port, repeat halted CPU reads on DMC no-operation cycles, and arbitrate against OAM gets. The bus
exposes the APU IRQ level to `NesConsole`. `Ppu2C02` implements CPU-facing register behavior,
NTSC scanline/dot scheduling, vblank/NMI timing, and baseline background/sprite pixel output. `Apu2A03`
contains pulse, triangle, noise, and DMC units plus the frame sequencer/mixer; `NesConsole` clocks it alongside
the CPU bus and PPU. Standard serial controller ports are implemented and directly controllable through the
console API; keyboard, canvas, and Web Audio adapters live separately in `src/nes/browser/`. `NromMapper` and
`Mmc3Mapper` provide CPU and PPU cartridge ports; console interrupt sampling includes PPU NMI edges and both
APU and MMC3 IRQ levels, with
phase-accurate integration still requiring ROM validation.

## PPU and video output

`PpuMemoryBus` implements mapper-delegated pattern access, mapper-visible pattern and nametable addresses,
vertical/horizontal/four-screen nametable mirroring, palette aliases and six-bit writes, separate primary
OAM storage, and a per-dot timing forwarder for mapper IRQ filters. `Ppu2C02` handles CPU register latches,
PPUSTATUS side effects, scroll/address writes, buffered PPUDATA access, VRAM increments, OAMDATA, 341-dot
scanlines, vblank/status timing, conditional odd-frame shortening, and NMI rising-edge latching. Its CPU-cycle
helper advances three PPU dots; `NesConsole` now supplies the master-clock ordering and CPU interrupt delivery.
Exact device-edge phase remains unvalidated against licensed ROMs.
The pixel pipeline fetches background tiles/attributes into shift registers, applies coarse/fine scrolling,
evaluates up to eight 8x8 or 8x16 sprites, composites OAM/background priority, and sets sprite-zero hit and
a ninth-sprite overflow. `PpuFramebuffer` exposes separate row-major six-bit palette-index and three-bit
emphasis planes. The post-eight-sprite scan models the 2C02's diagonal OAM-byte overflow behavior, but
sprite evaluation is aggregated rather than a dot-by-dot secondary-OAM copy. Exact overflow timing and
OAMADDR-dependent behavior, output timing, OAM/render-time register quirks, reset-time write suppression, and
hardware timing races remain deviations. Pixel output is a tested baseline, not a claim of cycle-perfect PPU
emulation.

The TypeScript browser renderer is an RGBA canvas baseline; its emphasis dimming and 64-color palette are
approximations, and performance has not been benchmarked in a real browser. The GoboScript port's renderer
is the batched pen path: the ported PPU fills palette-index and emphasis framebuffer lists, and the display
sprite draws each finished frame as horizontal runs of equal pixels with the pen extension, so the stroke
count follows color changes rather than the 61,440-pixel count, although it still reads every pixel once.
The picture is centered on the stage origin; the global `pen_fit_to_screen` variable selects a uniform 1.5x
scale that fits the default 480 by 360 stage by default, or at 0 native 1x pixels.
That is a first strategy, not a measured winner: costume/clone composition and generated assets remain
candidates, and no frame time, memory use, or runtime compatibility has been recorded for any of them yet,
because the project has neither been compiled nor timed on a target device.

## APU and input

`src/nes/apu/pulse_channel.ts`, `triangle_channel.ts`, `noise_channel.ts`, and `dmc_channel.ts` implement the
four waveform units and their counters/buffers. `src/nes/apu/apu_2a03.ts` connects them to `$4000-$4015` and
`$4017`, clocks timers at their CPU/APU rates, sequences quarter-/half-frame events, and exposes frame/DMC
IRQ status through the `ApuCpuPort` boundary. DMC register writes configure sample address/length, rate, loop,
IRQ, and DAC output; the reader requests bus-owned sample fetches and supplies bytes to its output unit. The
CPU bus fetches from cartridge memory, stalls the CPU on reads, repeats held reads on no-operation cycles,
and gives DMC gets priority during OAM DMA. `src/nes/apu/mixer.ts` applies the nonlinear pulse and TND equations,
including DMC's seven-bit DAC. `ApuAudioSampler` accumulates the configured sample rate against the NTSC CPU
clock (1,789,773 Hz); `Apu2A03.clock_cpu_cycle()` samples the post-clock mixed output and queues zero-order mono
samples. The default rate is 44.1 kHz, with integer rates from 1 Hz through the CPU rate supported.
`drain_audio_samples()`
returns a `Float32Array` and preserves fractional clock phase; reset clears both pending samples and phase.
`NesConsole` calls `clock_cpu_cycle()` every CPU cycle and samples the APU IRQ line for `Cpu2A03`.

The 42 focused APU tests cover channel state, register/status routing, frame sequencing, sample-buffer/IRQ
behavior, timer rates, DMA requests, mixing, sample cadence, and live channel output; four additional DMA tests
cover CPU read stalls, PRG address wrapping, write deferral, and an OAM/DMC collision. These unit tests do not
establish licensed-ROM conformance or exact load/reload and DMA phase-edge timing. The core sample path is
runtime-independent and unfiltered; `NesBrowserAudioFilter` shapes copied blocks with first-order 90 Hz and
440 Hz high-pass stages plus a 14 kHz low-pass before the Web Audio sink. This is an approximate host-output
filter, not a calibrated analog model; hands-on browser playback and the TurboWarp output path remain open.

`src/nes/input/controller.ts` implements two `NesControllerPorts` for standard eight-button NES pads. A
write with bit 0 set keeps A available as a live read; the high-to-low transition snapshots each pad, after
which reads shift A, B, Select, Start, Up, Down, Left, and Right independently on `$4016` and `$4017`. Reads
after the eighth bit return 1. The device drives only D0, leaving `NesCpuBus` to merge the other data lines
from open bus. The initial NTSC NES slice uses two standard pads. Four Score and Zapper are deferred but
remain planned for the full NES target; Zapper support waits for PPU sensor/timing integration. Add mapper
expansion audio alongside each supported mapper that requires it. Famicom-only expansion-port devices are
outside the NES target; evaluate other peripherals individually when compatibility requires them. Host key
mapping remains a runtime adapter.

The GoboScript port reads its host keyboard in `scratch/src/keyboard_input.gs`, which samples the built-in
"key () pressed?" reporter for the same sixteen keys the TypeScript adapter binds and writes the resulting
button masks into the live pad state of `scratch/src/controller.gs`. It polls instead of using key-press
hats, so a pad button follows the key that is held down rather than a press/release edge pair that a missed
key-up could leave stuck, and the run loop calls it once per chunk of emulated cycles, because a frame takes
roughly 300 chunks. The Scratch website's keyboard device drops modifier keys, so the Shift-to-Select
binding is a TurboWarp extension; every other binding is plain Scratch.

## Cartridge parsing and mapping

`parse_ines_rom` returns either `{ ok: true, value }` or `{ ok: false, error }`. Malformed input is normal
user data and must not crash the emulator. The parser currently handles iNES 1.0 and NES 2.0 image lengths,
optional 512-byte trainer data, mapper/submapper numbers, mirroring flags, and RAM size metadata. It copies
PRG/CHR/trainer slices so they do not alias the caller's input buffer.

Mapper selection is a separate, explicit capability list in `cartridge/mapper.ts`. It routes mapper
0/submapper 0 to `NromMapper` and mapper 4/submapper 0 to `Mmc3Mapper`; an unknown mapper ID or an unlisted
submapper returns a structured error rather than falling back to NROM. `mapper_000.ts` maps 16 KiB PRG ROM
with mirroring or 32 KiB linearly, optional PRG RAM in `$6000-$7FFF` (including trainer initialization at
`$7000-$71FF`), and a fixed 8 KiB CHR-ROM or writable CHR-RAM window. `mapper_004.ts` maps MMC3 PRG in 8 KiB
banks and CHR in 1 KiB banks, with both PRG/CHR mode bits, bank-register decoding, horizontal/vertical
mirroring (while honoring four-screen wiring), PRG-RAM enable/write protection, and an IRQ counter/reload/
enable path clocked by A12 rising edges after a ten-dot low filter. Mapper creation validates the ROM layout
and returns structured errors for unsupported sizes or board families. `Ppu2C02.clock_ppu_dot()` drives
mapper dot ticks; `NesConsole` samples the mapper's IRQ line for CPU integration and can record ordered CPU/APU/PPU
trace events. Synthetic traces test scheduler order, while exact IRQ event phase still requires licensed-ROM
validation.

## Portability to GoboScript

- Use small integer contracts for addresses, bytes, flags, and bank numbers.
- Keep TS byte arrays behind APIs. Scratch has list values and 1-based indices, not typed arrays.
- Keep bit-mask operations behind named helpers so they can be ported using measured arithmetic or tables.
In GoboScript, `&` joins strings.
- Avoid recursion, dynamic object graphs, callbacks, and per-cycle allocation in hot paths.
- Document which procedures run without screen refresh and how long the longest uninterrupted chunk may
be.
- Use shared test vectors for the TypeScript and GoboScript implementations.
- While the compiler is unavailable, keep every ported helper mirrored in
  `tests/support/goboscript_port_algorithms.ts` using integer-only arithmetic, compare that mirror
  exhaustively with the bitwise reference, and lint the `.gs` sources for grammar shape, reserved names, and
  proc/func call shapes and argument counts. The mirror is a substitute for compilation, not a claim that the
  project builds.
- Use generated decimal ROM list data only as a build-time bridge. Do not change the canonical ROM file
into a hand-edited text format.

## Open decisions

- Exact CPU accuracy target and unofficial opcode policy.
- Full mapper/submapper execution support list (the implemented and tested routes are mapper 0/submapper 0
  NROM and mapper 4/submapper 0 MMC3; unsupported combinations remain explicit errors).
- Frame output strategy and best attainable TurboWarp frame rate.
- Audio generation/output strategy in TurboWarp and standard Scratch.
- Save-state format and persistence of battery-backed memory.
- Whether standard Scratch compatibility is a release requirement or TurboWarp is the only required
runtime.
