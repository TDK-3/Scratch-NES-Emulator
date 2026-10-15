# Project progress

Status snapshot: 2026-10-15

## Summary

The repository has a TypeScript-first foundation, an iNES/NES 2.0 parser, CPU register/ALU helpers, and a
cycle-visible CPU bus sequencer for reset, IRQ/NMI entry, all 151 official opcodes, and all 105 unofficial
encodings (all 256 byte values). Unofficial coverage includes stable NOP/ALU/load-store/RMW groups, XAA/LXA
approximations, KIL/JAM, and the five unstable high-byte stores. A DMC stall on the tagged dummy read drops
only the store-data mask; other RDY/chip effects and hardware validation remain open. Each
`Cpu2A03.clock_cycle()` call performs one bus transaction; `step()` remains a convenience wrapper that runs to
the next sequence boundary. Branch dummy cycles and delayed IRQ polling after CLI/SEI/PLP are modeled.
The production CPU address decoder, PPU memory bus, cycle-visible OAM/DMC DMA arbiter, and mapper 0 (NROM)
and mapper 4 (MMC3) are in place. MMC3 banking, mirroring, PRG-RAM protection, and A12 IRQ counting with a
ten-dot low filter are tested at the mapper boundary. CPU-facing PPU registers, NTSC scanline/dot timing,
odd-frame shortening, vblank/status timing with PPUSTATUS vblank-start suppression, PPU-side NMI edge latching,
and a deterministic 256 by 240
color-index renderer are implemented. The renderer includes background fetch/shift, scroll/attribute selection, basic
sprite evaluation/composition, sprite-zero hit, first-eight overflow, grayscale, and emphasis metadata.
`Apu2A03` connects pulse, triangle, noise, and DMC channels to the CPU APU-port interface, handles
`$4000-$4015`, `$4017`, NTSC four-/five-step frame events, DMC sample buffering/IRQ, and the five-input
nonlinear pulse+TND approximation. `ApuAudioSampler` emits deterministic mono `Float32Array` samples from an
integer accumulator at the 1,789,773 Hz NTSC CPU rate (44.1 kHz default). The CPU bus services DMC reads,
stalls on CPU reads, repeats held reads on no-operation cycles, and arbitrates DMC gets against OAM DMA.
`NesControllerPorts` implements two standard serial controllers with strobe/latch and open-bus behavior.
The initial NTSC slice uses standard pads; Four Score and Zapper are deferred but planned for full NES support,
while Famicom-only expansion devices are outside the target. Mapper expansion audio will be implemented with
each supported mapper that requires it. `NesConsole` now composes CPU, PPU, APU, mapper, and controllers with
an integer NTSC master-clock scheduler, reset/pause/step/frame APIs, and PPU NMI plus APU/MMC3 IRQ routing.
Its optional `NesConsoleTraceRecorder` captures ordered interrupt, CPU bus-cycle, APU-cycle, PPU-dot, NMI-edge,
and frame-boundary events in a bounded ring buffer; without tracing, no trace events are allocated. Synthetic
tests cover NROM/MMC3 composition, controller reads, APU output samples, NMI/IRQ delivery, reset, trace order,
and a bounded frame. A pinned MIT-licensed interactive square-player ROM now passes a headless controller-to-APU
smoke test; exact frame/DMC/mapper phase behavior remains unverified. The TypeScript browser preview now
provides canvas output, keyboard mapping, an approximate audio filter, Web Audio, and per-ROM local-storage
PRG/CHR-NVRAM saves with legacy PRG-only record support, but interactive browser playback, storage, and
performance have not been validated.
Hardware-calibrated audio behavior, gameplay, and P6's TurboWarp input/audio/save adapters remain open, as do PPU
hardware quirks/races. The supplied mapper 4 fixture is identified with high confidence as a battery-backed
MMC3 conversion of Japanese *Super Mario Bros. 2* (Lost Levels), likely Loopy's port; its exact dump revision
remains unknown. `NesConsole` and a bounded integration test reach its title screen at frame 43, with an
independent `jsnes` run showing the same screen. This demonstrates this ROM's title boot, not game compatibility
or cycle-accurate emulation; the earlier one-million-cycle blank-screen smoke stopped before initialization.

## Completed

- [x] Added a strict TypeScript project with Node test tooling and a lockfile.
- [x] Added GitHub Actions checks for TypeScript tests and build output.
- [x] Added TypeScript compiler checks with `strict`, `isolatedModules`, `noUncheckedIndexedAccess`,
      and `exactOptionalPropertyTypes` enabled.
- [x] Implemented iNES 1.0 and NES 2.0 header and payload parsing with explicit error results.
- [x] Added an explicit mapper route registry: mapper 0/submapper 0 selects NROM and mapper 4/submapper 0
      selects MMC3; other mapper IDs and unlisted submappers return structured errors, with no fallback.
- [x] Implemented `NesCpuBus` with mirrored internal RAM and PPU registers, APU/controller routing,
      cartridge windows, latched open bus, and masked device reads.
- [x] Added cycle-visible `$4014` OAM DMA and DMC sample-fetch DMA: OAM halt/alignment plus 256 ordered
      source reads/OAMDATA writes; DMC 3/4-cycle halt/dummy/optional-align/get, held-read repetition, CPU
      write deferral, sample-buffer completion, and DMC priority over OAM source gets. Standalone OAM
      transfers remain 513/514 cycles. DMC/OAM phase-edge ROM validation is still outstanding.
- [x] Added `PpuMemoryBus` for mapper-delegated pattern memory, mapper-visible pattern/nametable accesses,
      vertical/horizontal/four-screen nametable mirroring, `$3000-$3EFF` aliases, six-bit palette RAM and
      universal-background aliases, separate primary OAM storage, and a per-dot mapper timing forwarder.
- [x] Added `Ppu2C02` CPU registers, deterministic NTSC timing, and a baseline pixel renderer: PPU I/O
      latch, PPUSTATUS/scroll/address side effects, PPUDATA buffering and greyscale palette reads, OAMDATA,
      341-dot scanlines across 262 lines, three PPU dots per CPU cycle, conditional odd-frame shortening,
      vblank at (241,1), PPUSTATUS suppression at dots 0-1 before that event, pre-render status clear at
      (261,1), and consumable NMI edges. Background nametable,
      attribute, and pattern fetches feed pattern/attribute shifters; coarse/fine scroll increments/transfers
      are implemented. The renderer handles the first eight 8x8/8x16 sprites, flips, palettes, clipping,
      OAM priority, sprite-zero hit, ninth-sprite overflow, grayscale color indices, and per-pixel emphasis.
      `PpuFramebuffer` stores separate row-major color and emphasis planes. Overflow scanning models the
      diagonal OAM-byte bug, with fast coverage for a non-Y-byte false positive; exact dot-level secondary-OAM
      evaluation, output delay, OAM/render-time register quirks, and licensed ROM validation of integrated
      CPU/PPU/IRQ phase behavior remain limitations.
- [x] Implemented mapper 0 as `NromMapper`: 16/32 KiB PRG mapping, optional PRG RAM and trainer loading,
      fixed CHR ROM or writable CHR RAM, and header-selected nametable mirroring. Unsupported NROM layouts
      return structured errors. The mapper implements both CPU and PPU cartridge ports; synthetic console
      tests cover its composition. The supplied game ROM uses mapper 4, not NROM.
- [x] Implemented mapper 4/submapper 0 as `Mmc3Mapper`: PRG/CHR bank modes and decoding, horizontal/
      vertical mirroring with four-screen protection, PRG-RAM enable/write protection, and IRQ
      counter/reload/enable/acknowledge behavior on A12 rising edges after a ten-dot low filter. The mapper
      observes normal PPU accesses, committed `$2006` addresses, and `$2007` address increments. Supported
      memory layouts/routes are validated with structured errors. `Ppu2C02` clocks the mapper hook per dot;
      `NesConsole` samples the mapper IRQ line for CPU integration, but edge-phase ROM validation remains.
- [x] Implemented pulse, triangle, noise, and DMC APU channels, including DMC rate/timer, sample reader and
      buffer, output shift unit/DAC, loop/address wrap, and completion IRQ. `Apu2A03` routes `$4000-$4015` and
      `$4017`, clocks channels at CPU/APU rates, runs NTSC four-/five-step frame events, exposes frame/DMC IRQ,
      and mixes all five DAC inputs. `ApuAudioSampler` produces runtime-independent mono samples from emulated
      NTSC CPU time via an integer phase accumulator (44.1 kHz default). Forty-two focused APU tests cover
      channel, register/status, DMA request, frame, IRQ, mixing, exact sample counts, and live channel output;
      six DMC DMA tests cover CPU/OAM arbitration, production-bus unstable-store stalls, and an end-to-end
      `Apu2A03` request. `NesConsole`
      supplies APU clock/IRQ wiring and synthetic frame-IRQ delivery tests; exact frame/DMC phase-edge ROM
      validation remains outstanding.
      The deterministic core stream remains unfiltered; a separate approximate browser output filter and Web
      Audio sink now exist but have not been validated with a real browser or audio device.
- [x] Implemented `NesControllerPorts` for two standard serial pads: live A reads while strobing, snapshots
      on the falling edge, independent A/B/Select/Start/Up/Down/Left/Right shifts, trailing 1s, and D0-only
      reads merged with CPU open bus. Six tests cover both ports, every button, strobe/re-latch behavior,
      post-eight reads, bus routing/open bus, reset preservation, and invalid inputs. The TypeScript browser
      keyboard adapter maps all 16 documented keys to both pads; four tests cover mapping, repeats, editable
      targets, and release on focus loss. A synthetic-console test verifies the Z-key-to-`$4016` path. TurboWarp
      input remains a separate adapter.
- [x] Defined expansion-hardware scope: two standard pads and the native APU are the initial NTSC slice;
      Four Score/Zapper are deferred but planned for full NES support, and expansion audio will accompany
      each supported mapper that requires it. Famicom-only devices are outside the NES target.
- [x] Audited license provenance for candidate APU/controller ROMs and recorded pinned MIT SquarePlayer
      and NoisePlayer results in `docs/TESTING.md`; headless pulse/noise input/audio smoke tests pass. The
      SquarePlayer now exercises the keyboard adapter through its APU output path; broader suites and
      target-runtime results remain open.
- [x] Added `NtscClock` and `NesConsole` to compose NROM/MMC3, CPU, PPU, APU, and two standard pads. The
      console exposes reset, pause/resume, cycle/sequence stepping, controller input, and bounded frame output;
      it routes PPU NMI and APU/MMC3 IRQ levels to the CPU. Synthetic tests cover mapper composition, reset
      preservation, controller reads, PPU NMI, APU and MMC3 IRQ delivery, audio sample output, deterministic
      CPU/APU/PPU trace ordering, frame-boundary traces, and one complete NTSC frame. Exact hardware event phases
      and licensed-ROM results remain open.
- [x] Identified and booted the supplied mapper 4 ROM to its Japanese *Super Mario Bros. 2* title screen.
      The ROM's title screen, `SM2SAVE` marker, 64 KiB PRG/16 KiB CHR layout, and MMC3+battery header point to
      Loopy's SMB2J conversion family; an automated bounded console test detects a title-screen pixel signature
      by frame 43. A temporary JSNES v2.1.0 run rendered the same screen. Exact dump revision/rights and
      gameplay compatibility remain unknown.
- [x] Added a TypeScript browser shell with a 256 by 240 canvas renderer, 6-bit palette/emphasis conversion,
      integer CSS scaling, bounded one-frame-per-requestAnimationFrame scheduling, standard-pad keyboard input,
      and a Web Audio sample sink with an approximate stateful output filter. Starting emulation focuses the
      canvas for pad input after clicking Run. Four renderer, four keyboard, five filter, five sink, and two
      scheduler tests pass; live browser playback and performance remain unvalidated.
- [x] Added mapper and console snapshots for declared PRG and CHR NVRAM, with volatile RAM excluded and
      both lengths validated before restore. The browser stores both regions per exact ROM SHA-256 in v2
      local-storage records and accepts legacy PRG-only records. Six battery-store tests pass; storage quotas
      and interactive browser persistence remain unvalidated.
- [x] Published the current region, mapper, ROM, CPU, PPU, APU, controller, browser, Scratch/TurboWarp, save,
      and known-limitations scope in `docs/SUPPORTED_FEATURES.md`. The browser and parser enforce a 32 MiB
      total-image limit before user-selected files are read into memory.
- [x] Added comprehensive parser tests for iNES/NES 2.0 metadata, extended and exponent/multiplier ROM
      sizes, RAM/NVRAM defaults and shifts, zero CHR ROM, trainer offsets, copied payload slices, truncated
      headers/trainers/ROMs, unsupported versions, and oversized declarations.
- [x] Added CPU register/status and binary ADC/SBC helpers with exhaustive byte-pair and flag tests.
- [x] Defined the CPU bus interface and deterministic fake bus with ordered read/write traces.
- [x] Added 2A03 reset-vector loading, initial registers, stack push/pop, and BRK/IRQ/NMI status packing.
- [x] Implemented all 13 official addressing modes with indexed/page-cross dummy reads, branch targets,
      indirect-JMP wrap behavior, and read-modify-write bus ordering.
- [x] Added a 151-opcode/56-mnemonic official opcode table and a micro-operation engine: each
      `Cpu2A03.clock_cycle()` executes one bus transaction, while `step()` drains a sequence for compatibility.
- [x] Added all 105 unofficial opcode encodings without changing the 151 official opcodes: 27 stable NOPs,
      six immediate ALU forms, ten LAX/SAX forms, LAS, 12 KIL/JAM opcodes, 42 composite RMW forms, configurable
      XAA/LXA approximations, and the five AHX/SHX/SHY/TAS high-byte-store encodings. A DMC stall on an
      unstable-store dummy read drops the data mask but preserves crossing-address corruption; other RDY/chip
      effects and hardware validation remain open.
- [x] Added cycle-visible reset and IRQ/NMI sequences, branch page-cross dummy reads, and per-instruction
      polling with delayed IRQ recognition after CLI/SEI/PLP. Hardware edge sampling and device line
      integration remain unverified.
- [x] Added an optional instruction-level trace adapter for state snapshots, instruction bytes, step cycles,
      formatted output, and ordered bus transactions without changing CPU execution.
- [x] Added an opt-in headless NROM runner that compares `nestest` CPU state, bytes, and cycle counts with
      an external log; the test ROM and log are not bundled.
- [x] Selected twenty MIT-licensed `nes6502/v1` SingleStepTests vectors at a pinned upstream commit; added an
      offline runner checking registers, listed RAM, cycles, and ordered bus accesses. Ten additional cases
      cover page-crossing and non-crossing cases for all five unstable high-byte-store encodings. Provenance,
      license, full-source and selected-fixture hashes, setup, and expected result are in
      `tests/fixtures/nes6502/`.
- [x] Inspected the supplied ROM header: 81,936 bytes, mapper 4, 4 PRG banks, 2 CHR banks, vertical
      mirroring, battery flag set, no trainer.
- [x] Recorded its SHA-256 as `cdfc23e83dbbc0f11592446d1bdcc496101390ac5c3f8ac91a0596c7b2b1485f`;
      the title and game family are identified, while exact dump provenance and redistribution terms remain unknown.
- [x] Added a reproducible ROM-list generator with default `test_rom.nes` input and `--rom`/`--output`
      options, byte-exact reconstruction validation, and protection against overwriting the source ROM.
      A fast subprocess regression test covers selecting a non-default iNES image.
- [x] Added a GoboScript Stage/sprite scaffold that checks the generated ROM list's iNES signature.
- [x] Added an initial shared numeric vector fixture and generated GoboScript list spanning numeric, CPU,
      CPU-bus, MMC3, PPU, APU, and controller behavior. All 15 vectors run against the TypeScript modules;
      list format, IDs, and bounded coverage are documented in `docs/GOBOSCRIPT_PORT_VECTORS.md`.
- [x] Checked PATH/npm/upstream release metadata for the compiler; the missing-toolchain blocker is
      recorded in `docs/TODO.md`.
- [x] Researched current GoboScript documentation and recorded the upstream snapshot, language
      behavior, build workflow, and Scratch/TurboWarp constraints.
- [x] Added project architecture, structure, LLM handoff, porting, testing, todo, and completion docs.

## Verified in this environment

- `npm ci`: passed from the lockfile on 2026-10-15 and reported zero audit vulnerabilities.
- `npm test`: passed all 332 tests, including ROM/vector generator regressions, one browser-server HTTP smoke test,
  15 shared cross-domain vectors,
  six controller tests, forty-two APU tests, six DMC DMA tests, thirty-four opcode tests covering all 151 official
  opcodes and all 105 unofficial encodings, 27 unofficial NOPs, six immediate ALU variants, ten LAX/SAX forms,
  LAS, XAA/LXA models, 12 KIL/JAM opcodes, 42 composite RMW forms, and five high-byte stores; twenty parser
  tests, four mapper-selection tests, ten NROM tests,
  thirteen MMC3 tests,
  nine CPU-bus tests, five OAM DMA tests, eight PPU-bus tests, sixteen PPU register/timing tests, seventeen PPU
  rendering/framebuffer tests, fourteen synthetic console tests, two licensed-ROM console tests, one supplied
  mapper 4 title-boot test, two NTSC clock tests, four canvas-renderer tests, four browser-keyboard tests,
  five Web Audio sink tests, five browser audio-filter tests, six battery-store tests, two frame-scheduler tests,
  one browser-server HTTP integration test, and twenty MIT reference vectors, including ten unstable-store cases.
  Every test has a 10-second timeout.
- `npm run build:ts`: passed.
- `npm run scratch:assets`: passed, verified byte-for-byte reconstruction, and generated 81,936 decimal
  ROM-list values. `npm run scratch:vectors`: passed and generated 202 decimal values for 15 vectors.
- The earlier `test_rom.nes` one-million-cycle smoke completed 1,000,000 CPU cycles in Node.js v22.22.3
  (33 PPU frames, 21 NMI sequences, one IRQ, and 20 DMA sequences) but ended before title initialization.
  The later bounded title-screen test reaches its expected pixel signature at frame 43; this confirms only
  the supplied ROM's title-screen boot, not gameplay or general compatibility (see `docs/TESTING.md`).

## Exploratory external CPU trace check

The opt-in command
`npm run test:nestest -- --rom /path/nestest.nes --log /path/nestest.log --limit 5003` was run with files from
[the nes-test-roms repository](https://github.com/christopherpow/nes-test-roms), commit
`95d8f621ae55cee0d09b91519a8989ae0e64753b` (ROM SHA-256
`f67d55fd6b3cf0bad1cc85f1df0d739c65b53e79cecb7fea8f77ec0eadab0004`, log SHA-256
`442c4dd5539c7e88b3fd73c7b732a7eadbd22b47c2cd9e58397ef147f64f6f8f`). The trace matched the first 5,003
log entries for PC, instruction bytes, A/X/Y/P/SP, and CPU cycle count. The documented unbounded run predates
stable unofficial NOP support and stopped at line 5,004 on `$04`, which is now implemented as a NOP; no updated
unbounded trace result is claimed. The ROM and log are not checked in; the inspected files did not state an
explicit redistribution license, so this is not a license
determination or a fixture in the automated project test suite.

## Exploratory PPU and mapper ROM validation

Selected ROMs from `christopherpow/nes-test-roms` commit `95d8f621ae55cee0d09b91519a8989ae0e64753b` were
run through an ad-hoc CPU-then-PPU harness. GitHub reports no repository license and the inspected test
readmes do not provide redistribution terms; the binaries remain outside the repository and these results
do not satisfy the licensed-validation gate. The 10-dot A12 filter is supported by Mesen2's A12 watcher
and by the MMC3 frame-count test: MMC3 tests 1, 2, and 3 display "Passed" at 1,000,000 CPU cycles. Test 4
remains a known failure: it is still running at 1,000,000 cycles and, by 2,000,000 CPU-then-PPU cycles,
reports test 2, "Scanline 0 IRQ should occur later when `$2000=$08`." PPU-first and one-/two-dot-before-CPU
variants fail the same case. A trace sees the first IRQ at pre-render scanline 261 dot 262 on pattern address
`$1FF7`, but the sub-scanline mismatch is not isolated from CPU polling and incomplete console scheduling.

Four selected sprite-hit ROMs (`01.basics`, `05.left_clip`, `06.right_edge`, `08.double_height`) display
"PASSED"; `09.timing_basics` has no result at the sampled point. All five selected sprite-overflow ROMs
fail (Basics `#5`, Details `#6`, Timing `#4`, Obscure `#7`, Emulator `#3`), consistent with known simplified
evaluation/diagonal-overflow gaps but not a precise diagnosis. Palette RAM, sprite RAM, and VRAM access
ROMs display `$01`; the vblank-clear-time ROM displays `$03` and varies with CPU/PPU scheduling order, so
those values are not counted as passes. The supplied `test_rom.nes` is identified as a Japanese SMB2 MMC3
conversion and now passes a bounded title-screen boot test; its earlier one-million-cycle pre-boot result and
its exact dump provenance/rights are recorded in [`docs/TESTING.md`](TESTING.md). Full third-party PPU/mapper
hardware validation remains open.

## Not verified

- The official `goboscript build` command has not been run. This environment has no Rust/Cargo or
  GoboScript binary, and the npm registry has no package by that name. The latest tagged upstream binary
  found was v3.2.1 while the researched `main` snapshot declares v3.3.0, so the pinned source was not
  compiled here. Downloading the older official Linux archive was blocked in this environment; its version
  would not satisfy the pinned-toolchain task anyway.
- The `.sb3` has not been opened in Scratch or TurboWarp.
- The supplied ROM's exact dump provenance/revision and redistribution rights remain unknown despite its
  high-confidence identification as the MMC3 Japanese SMB2 conversion. Its first 1,000,000-cycle smoke reached
  PC `$7108` after 33 PPU frames with a uniform palette-index-1 framebuffer and silent audio; it ended before
  the title-screen initialization that the later 43-frame test confirms.
- No third-party CPU test ROM is bundled. The automated CPU reference fixture is a small, MIT-licensed
  subset of single-instruction vectors; it is not full-suite conformance and does not establish ROM boot
  compatibility.
- The cycle sequencer has not been validated against the full 2.56-million-vector upstream corpus or
  hardware-level interrupt edge traces. `NesConsole` now composes the CPU/PPU/APU and routes PPU NMI plus
  APU/MMC3 IRQ levels; synthetic tests cover vblank NMI and APU frame IRQ, but exact interrupt/mapper phase
  remains unvalidated. Sprite-overflow false positives/negatives from the 2C02 diagonal bug, exact output
  pipeline timing, PPU bus races, OAM/DMC phase timing, exact frame-counter edges (only unit-tested), hardware-
  calibrated analog audio, interactive browser/audio-device validation, TurboWarp input/audio/rendering, and save data
  remain unimplemented or unverified. DMC registers, buffering, IRQ, CPU stalls, and basic OAM collision arbitration
  have focused tests, but no DMC ROM validation has been performed.
- The only timing is one synthetic TypeScript frame at about 46 ms in this sandbox; it is not a benchmark.
  The Scratch/TurboWarp scaffold does not run game frames, so TurboWarp/target-device performance and any
  60 fps claim are unmeasured. Do not infer playable frame rates from the synthetic timing.

## Current milestone

**Milestone 1: CPU instruction and interrupt foundation.** Register/status helpers, reset/stack behavior,
all addressing modes, all 151 official opcodes, one-bus-transaction-per-cycle execution, branch cycles,
instruction-boundary IRQ/NMI polling, instruction traces, the external `nestest` runner, and a small pinned
MIT CPU-vector fixture are in place. Parser coverage, explicit mapper routing, the production CPU address
decoder, cycle-visible `$4014` DMA, PPU memory-bus routing, and mapper 0/4 reference implementations are
complete. CPU-facing PPU registers, deterministic NTSC timing, and baseline background/sprite rendering are
now implemented and unit-tested. `NesConsole` composes the supported mapper/device paths, connects CPU,
PPU, APU, and controllers, and exposes optional bounded scheduler tracing. The supplied mapper 4 ROM reaches
its title-screen signature at frame 43; that is not gameplay or general compatibility. Initial numeric shared
vectors now connect TypeScript reference behavior to the generated GoboScript data list. Interactive browser
playback/performance, TurboWarp input/audio adapters, ROM-based hardware-accuracy validation, and GoboScript
compilation remain separate work. The cycle sequencer and PPU pixel pipeline are not claims of full timing
accuracy.
