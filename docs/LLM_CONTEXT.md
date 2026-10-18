# LLM context

This file is the compact handoff for coding agents and other automated contributors. `AGENTS.md` is the
repository rule set; this page explains the project state and important technical facts.

## Goal

Create a working NES emulator for TurboWarp, with a conventional TypeScript implementation used as the
testable behavioral reference, then port the stable logic to GoboScript and compile it to Scratch `.sb3`.
GoboScript is a separate Scratch-targeting language. It does not transpile or import this project's
TypeScript.

## Source of truth

- TypeScript under `src/` is the reference implementation.
- `tests/` must define expected behavior before a feature is ported.
- GoboScript under `scratch/` is a separate implementation of those behaviors.
- `test_rom.nes` reaches its Japanese *Super Mario Bros. 2* title screen in TypeScript; this is one bounded
  boot smoke, not evidence of broad game compatibility.
- Generated files in `dist/`, `scratch/data/`, and `scratch/*.sb3` are build products.
- `docs/SUPPORTED_FEATURES.md` is the public implementation-scope statement; it records NTSC-only timing,
  mapper/format limits, controls, ROM deployment, battery persistence, and known inaccuracies.
- The parser and browser file picker enforce a 32 MiB total ROM-image cap (`MAX_ROM_IMAGE_BYTES`), with
  tests for oversized buffers and declared NES 2.0 payloads.

## Current implementation

`src/nes/cartridge/ines.ts` parses iNES 1.0 and NES 2.0 headers and payload boundaries. It returns a
discriminated result instead of throwing for malformed images. `src/nes/cartridge/mapper.ts` resolves exact
mapper/submapper routes: mapper 0/submapper 0 selects NROM and mapper 4/submapper 0 selects MMC3; other
combinations return structured unsupported errors. `src/nes/cartridge/mapper_000.ts` implements `NromMapper`
for mirrored 16 KiB or linear 32 KiB PRG ROM, declared PRG RAM and trainer loading, fixed 8 KiB CHR ROM or
writable CHR RAM, and header-selected nametable mirroring. `src/nes/cartridge/mapper_004.ts` implements
`Mmc3Mapper` PRG/CHR modes, register decode, mirroring, PRG-RAM protection, IRQ reload/enable, and a ten-dot
PPU A12 low filter that observes bus accesses plus committed `$2006`/`$2007` address changes; both mapper
factories return structured errors for unsupported routes/layouts.
`src/nes/cpu/registers.ts`
defines the CPU register shape, status flags, byte/word normalization, signed-byte conversion, and
zero/negative flag helpers. `src/nes/cpu/alu.ts` implements binary ADC/SBC and status results.
`src/nes/cpu/cpu_bus.ts` defines CPU byte read/write methods; `src/nes/cpu/nes_cpu_bus.ts` maps RAM and
I/O devices, cartridge windows, and CPU open bus. `src/nes/cpu/cpu_trace.ts` adds an optional bus wrapper and
instruction-level step recorder with before/after state, opcode bytes, cycle counts, and ordered bus accesses;
it aggregates rather than changes the per-cycle bus operations and does not establish cycle accuracy.
`tests/support/FakeCpuBus.ts` provides deterministic zero-filled memory and an ordered access trace.
`src/nes/cpu/addressing_modes.ts` defines all
thirteen official modes and resolved-operand types. `src/nes/cpu/opcode_table.ts` declares all 151 official
opcodes (56 mnemonics) and all 105 unofficial encodings, covering every byte value: 27 stable NOPs, six
immediate ALU forms, ten LAX/SAX forms, LAS, XAA/LXA magic-value approximations, 12 KIL/JAM opcodes, 42
composite memory RMW forms, and five unstable high-byte stores (AHX, SHX, SHY, TAS). The table records cycle
counts, access types, and indexed-read page penalties. `src/nes/cpu/cpu_2a03.ts` uses generator-driven
micro-operations for these instructions, reset, and IRQ/NMI service. `clock_cycle()` performs one CPU-bus
transaction or DMA stall cycle and returns its kind, 1-based sequence cycle, and completion flag; OAM/DMC DMA
holds CPU instruction state while the bus arbitrates cycles. `step()` drains the active or next
instruction/interrupt sequence, including DMA stalls before it; `request_reset()` starts reset for cycle-by-cycle
use, while `reset()` remains synchronous for compatibility. Branches issue their discarded reads on separate
cycles. IRQ polling occurs at instruction boundaries, including the existing one-instruction delay after CLI,
SEI, and PLP; RTI's restored I flag is used at the next boundary. NMI is prioritized and hardware interrupts
push status with B clear. Unstable high-byte stores use an `H+1` source mask and page-cross address rule; if
DMC stalls the tagged dummy read before the write, stored data drops the mask while crossing-address corruption
remains. Other RDY/chip effects are not modeled, and the behavior is not hardware-validated. XAA/LXA omit
chip-dependent analog/DMA variation. OAM and DMC DMA cycles are exposed through the bus, and the bus exposes
APU IRQ state.
`src/nes/core/ntsc_clock.ts` and `nes_console.ts` compose both implemented mapper routes with CPU, PPU, APU,
and standard pads. The integer NTSC master divider clocks CPU/APU every 12 ticks and the PPU every 4; the
console propagates PPU NMI edges and APU/MMC3 IRQ levels. `src/nes/core/console_trace.ts` provides an optional
bounded ring-buffer observer for interrupt lines, CPU bus cycles, APU cycles, each PPU dot, NMI edges, and frame
boundaries. The trace API is off by default and keeps browser dependencies out of the core. Synthetic tests
exercise cycle/sequence stepping, frame advancement, controller reads, sampled audio, NMI/APU/MMC3 IRQ delivery,
and CPU/APU/PPU trace ordering. This defines deterministic ordering, not verified hardware phase or full cycle
accuracy.

`src/nes/ppu/ppu_bus.ts` provides `PpuMemoryBus` and the `PpuMapperPort` boundary. Pattern reads/writes are
mapper-delegated, and pattern/nametable accesses are reported with normalized 14-bit addresses. The bus
forwards one `clock_ppu_dot()` tick to the mapper per elapsed dot, including dots without a bus access;
`Ppu2C02.clock_ppu_dot()` drives this hook. Nametable mirroring is resolved on every access for vertical,
horizontal, or four-screen layouts; `$3000-$3EFF` mirrors `$2000-$2EFF`. The bus owns four KiB of nametable
RAM, 32 bytes of palette RAM with universal-background aliases and six-bit writes, and a separate 256-byte
primary OAM space. NROM and MMC3 implement the mapper port. `src/nes/ppu/ppu_2c02.ts` implements CPU-facing
register behavior, 341-dot scanlines across 262 lines, three-dot CPU-cycle advancement, conditional odd-frame
shortening, vblank/status events, PPUSTATUS suppression of the imminent vblank event at scanline 241 dots 0-1,
and a consumable NMI rising-edge latch. Its baseline renderer fetches
background name/attribute/pattern data, shifts scroll/pixel registers, applies t/v scrolling, evaluates the
first eight sprites, handles 8x8/8x16 patterns/flips/OAM priority/sprite-zero hit and ninth-sprite overflow,
and writes six-bit color plus three emphasis bits per pixel. `src/nes/ppu/framebuffer.ts` exposes the
256 by 240 row-major planes. Overflow scanning models the diagonal OAM-byte bug and has synthetic false-
positive coverage, but evaluation is not dot-by-dot; exact overflow timing and OAMADDR-dependent behavior,
pixel timing, OAM/render-time register quirks, open-bus decay, reset suppression, and integrated interrupt
phase accuracy remain limitations.

`src/nes/apu/` implements pulse, triangle, noise, and DMC channels; a shared length-counter lookup; the
standard nonlinear pulse+TND mixer; and `Apu2A03` register/frame integration. `$4000-$4015`, `$4017`, four-/
five-step NTSC frame events, frame/DMC IRQ state, DMC sample address/length/rate/loop, sample buffering, and
bus-owned DMC fetch requests are implemented. Pulse timers run at half CPU rate; triangle, noise, and DMC timers
run at CPU rate. `NesConsole` calls `clock_cpu_cycle()` once per CPU cycle and feeds the APU IRQ level into
the CPU. `ApuAudioSampler` uses an integer phase accumulator against the 1,789,773 Hz NTSC CPU
clock (44.1 kHz default) and returns drained mono `Float32Array` blocks without runtime audio dependencies.
DMC DMA/IRQ behavior and sample-rate/channel output have focused unit and CPU-bus tests. Two pinned MIT APU
player ROMs (SquarePlayer and NoisePlayer) exercise headless Up/Down input and pulse/noise samples; DMC edge
validation and live playback remain open. The browser adapter applies an approximate stateful audio filter
before `src/nes/browser/audio_output.ts` schedules Web Audio blocks; it is not a calibrated circuit model, and
live audio-device playback has not been validated.
`src/nes/input/controller.ts` implements `NesControllerPorts`, two standard pads with `$4016` strobe,
falling-edge latching, NES button order, trailing 1s, and D0-only reads for open-bus merging. The initial NTSC
NES slice uses standard pads; Four Score and Zapper are deferred but planned for full NES support, and Zapper
waits on PPU sensor/timing integration. Add mapper expansion audio alongside each supported mapper that
requires it. Famicom-only expansion-port devices are outside the NES target; evaluate other peripherals as
compatibility requires. `src/nes/browser/` provides a separate TypeScript keyboard adapter, canvas renderer,
integer-scale sizing, one-frame-per-animation callback scheduler, approximate stateful audio filter, Web Audio
sink, and ROM-SHA-keyed local-storage PRG/CHR-NVRAM persistence with legacy PRG-only record support.
Browser/device behavior remains unvalidated; the
Scratch/TurboWarp runtime still needs its own adapters and validation.

Tests cover parser success/failures, register helpers, all ADC/SBC operand pairs with both carry inputs,
fake-bus ordering/validation, reset/stack sequencing, all addressing modes, every official opcode, per-cycle
CPU stepping, branch and interrupt boundaries, optional CPU step traces, a headless NROM test-ROM runner,
and 1,026 pinned MIT-licensed NES 2A03 single-step vectors covering all 256 opcode bytes. 225 target the five
unstable high-byte stores, with both page-crossing and non-crossing cases, and the KIL/JAM family is checked
against the upstream jam bus pattern. The vector subset compares each bus operation,
sequence boundaries, final registers, and listed RAM; it is not the full upstream corpus, which
`npm run test:cpu-corpus` can replay from a local clone (2,560,000 scenarios in about 20 seconds). The current
suite has 911 tests, including build-time ROM/port-vector generator regressions, a browser-server HTTP smoke
test, 300 cross-domain parity cases, 41 GoboScript port-algorithm comparisons against an integer-only mirror of
the ported helpers, 14 GoboScript source-lint checks, two
licensed APU-player integration tests (SquarePlayer also exercises the keyboard adapter), four browser
keyboard-input tests, five Web Audio sink tests, five browser audio-filter tests, six battery-store tests,
six focused controller tests, and
forty-two APU tests covering pulse, triangle, noise, DMC, register/frame, DMA request, IRQ, mixer, and
deterministic audio sample behavior. Six DMC DMA tests cover CPU stalls/held reads, wrapped PRG addresses,
write-cycle deferral, OAM arbitration, production-bus stalls on all five unstable-store dummy reads, and a real
`Apu2A03` request routed through the production CPU bus and CPU.
The suite also covers expanded iNES/NES 2.0 metadata, size/error,
trainer-offset, and copy-independence cases. Four mapper-selection tests exercise the explicit mapper 0/submapper
0 NROM and mapper 4/submapper 0 MMC3 routes, plus structured rejection of unsupported combinations. Ten NROM
tests cover PRG mapping/RAM and trainers, separate PRG/CHR NVRAM snapshots, volatile CHR RAM preservation,
CHR ROM/RAM, nametable mirroring, and unsupported layouts. Thirteen MMC3 tests cover construction for the
supplied fixture, PRG/CHR banking, CHR RAM/ROM writes and CHR NVRAM snapshots across banking, mirroring,
PRG-RAM protection, PRG NVRAM snapshots, IRQ filter/counter behavior including `$2006`/`$2007` transitions,
reset preservation, and structured creation errors. `NesCpuBus` implements production decode for mirrored internal RAM, PPU registers,
APU/controller ports, cartridge windows, and CPU open bus; nine focused tests cover routing, mirroring, and
reset preservation. Five OAM DMA tests exercise parity, ordered transfers, CPU stalls, NMI deferral, and
instruction tracing. Eight PPU-bus tests cover mapper notifications, nametable mirroring/aliases, palette
aliases and masking, OAM storage, per-dot mapper-clock forwarding, and invalid values. Sixteen PPU
register/timing tests cover PPU I/O latches, PPUSTATUS side effects and vblank-start suppression,
scroll/address latches, PPUDATA buffering/increments, greyscale palette access, OAMDATA,
mapper-dot and CPU-cycle timing, frame lengths/odd skip, vblank/status clearing, NMI edges, and validation.
Seventeen PPU rendering tests cover deterministic full-frame output, background/shifter pixels, attributes,
fine/coarse scrolling and wrap, background table selection, grayscale/emphasis, 8x8/8x16 sprites, flips,
left-edge clipping, OAM priority, sprite-zero hit, ninth-sprite overflow, and diagonal OAM-byte false positives.
Fourteen `NesConsole` tests cover
NROM/MMC3 composition, reset/pause/step, controller serial reads including browser-keyboard integration, PRG/CHR
battery-RAM snapshots, PPU NMI, APU/MMC3 IRQ delivery, and bounded frame output;
two `NtscClock` tests verify the integer master-divider ratio and reset phase. Two licensed-ROM integration
tests run pinned MIT SquarePlayer and NoisePlayer ROMs, confirming Up starts pulse/noise output and Down stops
it. Four renderer tests cover palette/emphasis conversion, validation, integer scaling, and canvas writes; four
keyboard adapter tests cover both-pad mapping and key release behavior; five audio-filter tests cover DC rejection,
frequency response, block continuity, reset, and input validation; six battery-store tests cover ROM SHA-256,
PRG/CHR per-ROM persistence, larger CHR regions, legacy PRG-only migration, malformed records, and unavailable storage; five Web Audio tests cover sample-buffer scheduling
and source retirement; two scheduler tests cover one-frame-per-callback pacing, cancellation, and error shutdown.

P3 ROM validation is still open. At `docs/TESTING.md`, record that the unlicensed MMC3 ROM cases 1-3 pass
with the ten-dot filter, case 4 fails a scanline-timing boundary, four selected sprite-hit cases pass, and
all five selected sprite-overflow cases fail. The PPU now models and unit-tests one diagonal OAM-byte false
positive, but that does not validate the ROM suite. Do not vendor those ROMs or mark the P3 TODO complete: the
upstream collection has no declared license, and the runner is not phase-accurate.

P4 APU/controller and runtime validation remains open. Two pinned MIT APU player ROMs (SquarePlayer and
NoisePlayer) are bundled with license/provenance and pass headless TypeScript tests for Up/Down input and pulse/noise
sample output. A temporary JSNES 2.1.0 reference run showed channel activity but a one-frame square onset offset
and nonmatching raw audio tails/levels; see `docs/TESTING.md`. Other licensed suite candidates remain unrun. The
TypeScript browser shell provides host keyboard, approximate audio filtering, Web Audio, and per-ROM local-storage
PRG/CHR-NVRAM persistence, but no interactive
browser/audio-device/storage test has been recorded. Scratch/TurboWarp still needs separate input/audio/save
adapters; no target-runtime input or audible playback result exists. Keep the P4 TODO unchecked
until additional licensed ROM results and target-runtime checks are recorded.

The fixture is 81,936 bytes, SHA-256 `cdfc23e83dbbc0f11592446d1bdcc496101390ac5c3f8ac91a0596c7b2b1485f`.
Its header is iNES 1.0 mapper 4 (MMC3), submapper 0, four 16 KiB PRG banks, two 8 KiB CHR banks, vertical
mirroring, battery-backed RAM, and no trainer. The visible title (`SUPER MARIO BROS. 2`, `(c)1986`) and `SM2SAVE`
marker identify it with high confidence as an MMC3 conversion of Japanese *Super Mario Bros. 2* (Lost Levels),
likely Loopy's port; exact dump revision and rights remain unknown. A bounded integration test detects the title
screen at frame 43 (cap: 60 frames), also seen in a temporary JSNES 2.1.0 reference run. The earlier
one-million-cycle smoke stopped at frame 33 with a uniform palette-index-1 framebuffer and silent audio, before
title initialization; a title-screen boot is not proof of gameplay compatibility.

The Scratch/TurboWarp project embeds one build-time ROM as a file-backed GoboScript list (default:
`test_rom.nes`), checks its first four bytes for `NES` plus the iNES end marker, and loads generated shared
port vectors. It now also ports the helper layer: `scratch/src/numeric.gs` (bit-free byte/word helpers plus
`bit_at` and weight-loop AND/OR/XOR, because GoboScript has no bitwise operators), `cpu_status.gs`,
`cpu_alu.gs` (ADC, SBC, AND, ORA, EOR, ASL, LSR, ROL, ROR, CMP, CPX, CPY, BIT, INC, DEC), `controller.gs`
(both serial ports), `cpu_bus.gs` (RAM mirroring, open-bus latch with driven masks, `$4016`/`$4017`, and
absent-device behavior for PPU/APU/OAM DMA/cartridge), and `cartridge.gs` (iNES 1.0 and NES 2.0 header decode
with mapper/submapper, mirroring, battery, trainer, ROM and RAM sizes, payload offsets, and six numeric error
codes). `stage.gs` includes every header, so the Stage owns all
shared state, and its green-flag handler runs `src/vector_selftest.gs`, which executes suites 1, 3, 7, 8, and
9 of the fixture, counts suites 2, 4, 5, and 6 as skipped, and broadcasts a summary that `main.gs` reports. CPU
fetch/decode/addressing/cycles/interrupts, cartridge payload copying and mapper dispatch, PPU, APU, rendering,
sound, save states, and game execution remain unimplemented there, and none of the `.gs` sources has been
compiled. The TypeScript NROM/MMC3 mapper and
`NesConsole` APIs copy/restore declared PRG and CHR NVRAM, excluding volatile RAM; restore validates both sizes
before mutating either region. The browser shell stores both regions in per-ROM SHA-256 snapshots in local
storage and accepts legacy PRG-only records. TurboWarp storage and full console save states are not implemented.

## Commands

```bash
npm install
npm test
npm run build:ts
npm run scratch:assets
npm run scratch:vectors
npm run build:scratch
```

`npm run build:scratch` requires the GoboScript CLI to be installed separately. The local environment used
to seed this repository did not have Rust/Cargo or GoboScript, so the `.gs` sources have not yet been
compiled by the official compiler. Do not state that the project builds, runs, or performs until that check
has passed. Until then the port is validated indirectly: `tests/support/goboscript_port_algorithms.ts` mirrors
every ported helper in integer-only TypeScript (Scratch's floored modulo and floor division, no bitwise
operators), `tests/goboscript-port-algorithms.test.ts` compares that mirror exhaustively with the bitwise
reference and replays the numeric/ALU/bus/controller vectors through it, and `tests/goboscript-source.test.ts`
lints the sources for grammar shape, codegen-panic constructs, reserved block names, per-target name
resolution, mirror name/arity parity, and self-test enum IDs that match the fixture. The initial ROM
path is build-time bundling: `npm run scratch:assets -- --rom /path/to/rom.nes` selects a different static
list without replacing the fixture. `npm run scratch:vectors` generates the portable numeric vectors consumed
by `scratch/src/shared_vectors.gs`; `npm run build:scratch` runs both data generators before compiling. No
runtime ROM picker is planned for standard Scratch or TurboWarp in this initial path.

## Design constraints to keep in mind

- Implement and test subsystem behavior in TypeScript before porting it.
- Start with NTSC behavior unless the user changes scope. Preserve room for regional timing differences.
- The supplied fixture requires mapper 4 support for a boot path; a mapper 0-only emulator will not run
  it.
- JavaScript typed arrays are zero-indexed. GoboScript lists are one-indexed and contain Scratch values,
  not typed bytes.
- GoboScript has no direct TypeScript interoperability. Keep a deliberate, tested mapping for integer
  wrap, byte access, bit masks, signed/unsigned conversions, and multi-cycle clocking.
- GoboScript language traps confirmed in the upstream compiler source and enforced by
  `tests/goboscript-source.test.ts`: `return` inside a `proc` panics codegen; `%` and `//` are floored, not
  truncated; `&` joins strings; there are no bitwise operators; `%include` is deduplicated per translation
  unit and resolves relative to the root file; sprites resolve Stage variables, lists, and enums but compile
  their own procs and funcs; `local` becomes a `procname:x` variable; a name matching a builtin block shape
  becomes that block; and the Stage can neither `say` nor show a variable monitor. Details are in
  `docs/GOBOSCRIPT_RESEARCH.md`.
- An NES renders 256 by 240 pixels. Rendering 61,440 pixels with one Scratch block operation per pixel is
  likely too expensive. Benchmark output strategies in TurboWarp before committing to one.
- NES timing, PPU side effects, DMA, interrupt ordering, and mapper writes are correctness-sensitive. Do
  not optimize by removing observable timing before tests exist.
- TurboWarp settings can be stored in `goboscript.toml`, but some are TurboWarp-specific and are not
  portable to the Scratch website.

## Reference hierarchy

1. `docs/GOBOSCRIPT_RESEARCH.md` links to the upstream Goboscript documentation snapshot used to prepare
   this scaffold.
2. `docs/ARCHITECTURE.md` describes the intended emulator boundaries; code and tests remain
   authoritative.
3. Use NES behavior references and test ROM suites as validation aids, not as a replacement for clear
   specifications or local tests.
4. Review and follow the license of any reference implementation before copying code.

## Workflow for new features

1. Read the corresponding TODO and architecture sections.
2. Define a narrow behavior contract and deterministic tests in TypeScript.
3. Implement the TypeScript subsystem and run `npm test`.
4. Add shared test vectors that do not depend on the browser.
5. Port the behavior to GoboScript and add an in-project check or test fixture.
6. Compile the `.sb3`, open it in TurboWarp, and record measured behavior and known limits.
7. Update `PROGRESS.md`, `TODO.md`, and completion criteria when a milestone changes.
