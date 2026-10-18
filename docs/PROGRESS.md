# Project progress

Status snapshot: 2026-10-18

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
The CPU cycle sequencer now matches all 2,560,000 scenarios of the pinned MIT single-step corpus, and a
1,026-vector subset of it is checked in. The GoboScript project has moved past scaffolding: bit-free numeric,
status, ALU, controller, and CPU-bus-subset modules are written, the Stage runs a shared port-vector self test
on the green flag, and the ported arithmetic is validated through an integer-only TypeScript mirror plus a
source lint. None of it has been compiled, because the pinned GoboScript toolchain is still unobtainable here.

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
      `tests/fixtures/nes6502/`. Superseded on 2026-10-18 by the 1,026-vector selection below.
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
- [x] Fixed the KIL/JAM bus pattern to match the upstream corpus (read PC, read PC+1, then `$FFFF`/`$FFFE`
      forever, with `final.pc = initial.pc + 1`) and validated the cycle sequencer against the complete
      MIT `nes6502/v1` corpus: 2,560,000 of 2,560,000 scenarios across all 256 opcode files in about 20
      seconds through the opt-in `npm run test:cpu-corpus` runner. The runner was mutation-checked by
      corrupting corpus copies and confirming failures.
- [x] Replaced the twenty-vector fixture with 1,026 deterministically selected vectors covering all 256
      opcode bytes (225 unstable high-byte-store cases and 29 KIL cases), recorded the selection command and
      upstream revision in `tests/fixtures/nes6502/README.md`, and added `SOURCE_MANIFEST.sha256` for the
      upstream source files. `tests/cpu-single-step-vectors.test.ts` reports them as 257 grouped tests.
- [x] Modeled two documented PPU render-time register quirks: OAMADDR is forced to zero during dots 257-320
      of pre-render and visible scanlines, and OAMDATA writes during rendering are ignored. Two focused tests
      cover both, and the remaining unmodeled quirks (evaluation start at dot 65, glitchy OAMADDR high-bit
      increments, 2C02G OAM corruption on OAMADDR writes, and I/O latch decay) are listed in the source and
      `docs/SUPPORTED_FEATURES.md` rather than approximated without timing evidence.
- [x] Added an explicit ROM-rights notice to `scripts/generate_goboscript_rom_data.mjs` output and a matching
      assertion in `tests/scratch-rom-assets.test.ts`: the supplied image is Nintendo-derived with unknown
      dump provenance and must not be modified or redistributed.
- [x] Wrote the first executable GoboScript port modules: `scratch/src/numeric.gs` (bit-free byte/word
      helpers, `bit_at`, and weight-loop AND/OR/XOR), `cpu_status.gs` (status normalization, flag get/set,
      Z/N updates, BRK and stack forms), `cpu_alu.gs` (ADC, SBC, AND, ORA, EOR, ASL, LSR, ROL, ROR, CMP,
      CPX, CPY, BIT, INC, DEC), `controller.gs` (both serial ports), and `cpu_bus.gs` (RAM mirroring,
      open-bus latch with driven masks, `$4016`/`$4017`, absent-device stubs elsewhere). `stage.gs` runs
      `scratch/src/vector_selftest.gs` on the green flag and broadcasts a summary that `main.gs` reports.
- [x] Grew the shared vector fixture from 15 to 274 records in eight suites: numeric operations 7-13 for the
      arithmetic bit helpers, bus operation 2 with live controller ports pinning the driven-mask open-bus
      merge and dropped writes to unported windows, and a new ALU suite whose expected value/status pairs were
      derived by executing the production CPU rather than by hand.
- [x] Added `tests/support/goboscript_port_algorithms.ts`, an integer-only TypeScript mirror of every ported
      helper that uses Scratch's floored modulo and floor division and no bitwise operators, plus
      `tests/goboscript-port-algorithms.test.ts` (32 tests): exhaustive sweeps against the bitwise reference
      for ADC/SBC/AND/ORA/EOR/CMP/BIT/INC/DEC and all 256 status bytes for the shift/rotate steps, fixture
      replay for the numeric/ALU/bus/controller suites, and differential checks of the mirrored bus and
      controller ports against `NesCpuBus` and `NesControllerPorts`.
- [x] Added `tests/goboscript-source.test.ts` (13 tests) as the compile substitute: ASCII, indentation,
      line length, directive placement, resolvable `%include` paths, no `return` inside a `proc`, every `func`
      ending in a `return`, no `local` inside a loop body, reserved keyword/block-name collisions, per-target
      name resolution, mirror name/arity parity, and self-test enum IDs matched against the fixture. Each rule
      was mutation-checked against deliberately broken sources.
- [x] Added `tests/support/shared_port_vectors.ts` so both the reference test and the mirror test load the
      canonical fixture through one loader.
- [x] Recorded the docs sweep for that milestone: port state, corpus results, test totals, the mirror
      validation layer, and the GoboScript research findings, with `docs/PROJECT_STRUCTURE.md` regenerated
      from `git ls-files`.
- [x] Ported the cartridge header parser to `scratch/src/cartridge.gs`: iNES 1.0 and NES 2.0 signature,
      version bits, mapper and submapper, mirroring, battery, trainer flag, PRG/CHR ROM sizes including the
      NES 2.0 exponent/multiplier form, the four RAM/NVRAM sizes, and the trainer/PRG/CHR payload offsets,
      with the six `RomParseErrorCode` values reported as integers in TypeScript check order. Powers of two
      are built by doubling in a `repeat` loop and unsafe sizes become `-1`, because GoboScript has no
      exponent operator and no bitwise operators. `scratch/src/rom_loader.gs` now copies the embedded header
      into the parser and writes `rom_header_state_text` before the vector replay overwrites the parser
      state. Payload copying, RAM backing storage, and mapper dispatch are still TypeScript-only.
- [x] Grew the shared fixture from 274 to 299 records by adding suite 9 (`cartridge`, 25 records) whose
      eighteen expected values were derived by executing `parse_ines_rom` on synthesized images, never by
      hand. The suite covers the supplied mapper 4 ROM's real header, NROM sizes, CHR RAM, trainers,
      four-screen, legacy PRG RAM banks with and without a battery, mapper bits above 255, NES 2.0
      submappers, exponent sizes, RAM shifts, and every error code including the 32 MiB image limit reached
      with a 64-byte image.
- [x] Added `tests/support/cartridge_projection.ts`, the reference-side projection of a header parse onto
      the flat suite-9 array, shared by `tests/shared-port-vectors.test.ts` and the mirror test so both
      compare the same eighteen fields. `GoboscriptCartridgeParser` in the mirror is now compared against
      `parse_ines_rom` for every `flags6` byte, every `flags7` byte, every legacy PRG RAM bank count, every
      NES 2.0 mapper and RAM byte, all 4,096 encoded NES 2.0 ROM sizes, every RAM shift nibble, and image
      lengths 0 through 16 (nine new tests, 41 in that file).
- [x] Ported the CPU scaffolding that does not need opcode decoding: `scratch/src/cpu_core.gs` holds the six
      registers, one logged bus transaction per cycle, program-counter fetch byte/word, the four stack
      operations, and status push/restore; `scratch/src/cpu_addressing.gs` resolves all thirteen official
      addressing modes with the dummy reads, the page-crossing extra cycle, and the JMP indirect pointer wrap
      inside one page. The port documents its execution model: the reference suspends each instruction with a
      generator so `clock_cycle()` exposes one transaction at a time, while the port performs the same
      accesses in the same order and counts one cycle each without suspending, which is exact for CPU state
      and access order and an approximation only for a device that would interleave mid-instruction (DMC DMA,
      not ported). Opcode fetch/decode/dispatch, interrupts, reset sequencing, and the unstable high-byte
      stores are not ported.
- [x] Grew the shared fixture from 299 to 338 records with suite 10 (`cpu_addressing`, 39 records) derived by
      executing `Cpu2A03.resolve_addressing_mode()` behind a fresh `NesCpuBus` with no devices attached. Each
      record pins the resolved operand, the cycle count, the final PC and SP, and the ordered
      `(kind, address, value)` bus trace, so dummy-read addresses are checked as well as results. Added
      `tests/support/cpu_addressing_projection.ts` for the shared projection, six mirror tests (47 in
      `tests/goboscript-port-algorithms.test.ts`) covering the mode/access sweeps, the illegal combinations the
      reference rejects with a `TypeError`, the page-crossing and dummy-address formulas, the fetch helpers,
      and the stack transactions of real PHA, PLA, JSR, RTS, BRK, and RTI instructions, plus the matching
      `run_cpu_addressing_vector` replay in the self test.
- [x] Wired the NROM board into the ported CPU bus and added the cartridge boot path.
      `scratch/src/cpu_bus.gs` dispatches its `$4020-$FFFF` window to an attached board: a mapped address
      drives its byte through the same driven-mask merge the RAM window uses, an unmapped one returns the
      retained latch, and a write reaches the board only when one is attached. `scratch/src/cartridge_loader.gs`
      composes the boot path (signature check, header copy and parse, board validation, payload copy, and
      attachment) and records one summary line, so a report says why the window is undriven; the self test runs
      it before the vector replay and appends the board state to its summary. Because the embedded default
      image is an MMC3 cartridge, that path reports board error 3, a wrong board family, and leaves the window
      undriven until mapper 4 is ported, which is the honest result rather than a half-mapped bus. Suite 17
      (`cartridge_bus`, 12 records) runs the production `NesCpuBus` with the record's `NromMapper` attached as
      its cartridge port and every other device absent, and reports the byte the bus returned plus the latch it
      left behind, read back through `$2000`: PRG ROM at both banks of a 32 KiB board, mirroring on a 16 KiB
      board, PRG RAM writes and aliasing, a board with no PRG RAM whose dropped write still latches, a valid
      header nobody attached, a board rejected for its PRG ROM size, an MMC3 header rejected as the wrong
      family, a dropped PRG ROM write, RAM mirroring with a board attached, and a board that does not leak into
      the PPU window. A differential test walks the same boot path in the mirror and compares fourteen
      addresses with the production bus before and after writes to RAM, PRG RAM, and PRG ROM. Mutations that
      returned zero instead of the latch for an unmapped cartridge read, looked for an MMC3 board, drove no
      bits on a mapped read, or never forwarded a bus write were all caught. The fixture is now seventeen
      suites and 541 records, and the generated list is 12,357 values. Not ported: the NVRAM snapshots and the
      MMC3 board; compile validation stays blocked by the missing toolchain.
- [x] Ported the NROM board's memory and address windows. `scratch/src/mapper_000.gs` now holds the board's
      four regions: both ROM lists are sized to the declared payload and zero-filled, both RAM regions are
      allocated at their full window and alias modulo the mapped size the validation computed, and
      `nrom_load_payload` copies PRG ROM, CHR ROM, and the trainer into PRG RAM at offset `$1000` out of the
      generated cartridge list. `nrom_read_cpu` answers `$8000-$FFFF` from PRG ROM modulo its size, so a 16 KiB
      board mirrors twice, and `$6000-$7FFF` from PRG RAM when the board has any, reporting a mapped flag, the
      byte, and the driven bits where the reference returns a null read; `nrom_write_cpu` only lands in PRG
      RAM. `nrom_read_pattern` and `nrom_write_pattern` serve CHR ROM when the board has it and CHR RAM
      otherwise, and a CHR ROM board drops pattern writes. Suite 16 (`nrom_memory`, 16 records) prepares the
      payload bytes a record names and then runs CPU and pattern operations against the board, pinning PRG ROM
      mirroring at both the ends and the middle of a 16 KiB image, PRG RAM writes and overwrites at both ends
      of the window, aliasing inside 2 KiB and 4 KiB of PRG RAM, a board with no PRG RAM, the address below the
      window, CHR ROM reads with a dropped write, CHR RAM writes at both ends, 2 KiB CHR RAM aliasing, and a
      byte nobody prepared reading as zero. The mapped sizes come from a second board built over the same
      image, because measuring them writes probe bytes. A differential test loads a synthetic trainer image
      into the mirror and compares every PRG ROM, PRG RAM, trainer, and pattern byte with a reference
      `NromMapper`, which is what pins the copies; the source lint now also compares the ported `nrom_limit`
      and `nrom_window` enum values with the mirror's constants, and that check caught a trainer offset written
      as 1024 instead of `$1000` before it reached a fixture. Mutations that dropped the PRG ROM mirroring
      modulo, drove no bits on a mapped read, let CPU writes reach PRG ROM, ignored CHR ROM on a pattern read,
      let pattern writes land on a CHR ROM board, or copied the trainer to the start of PRG RAM were all
      caught. The fixture is now sixteen suites and 529 records, and the generated list is 11,826 values. Not
      ported: wiring the board into `cpu_bus.gs`, whose cartridge window still behaves as an absent device, the
      NVRAM snapshots, and the MMC3 board; compile validation stays blocked by the missing toolchain.
- [x] Ported mapper selection and NROM board validation. `scratch/src/mapper.gs` routes a cartridge by an
      exact mapper and submapper pair the way `resolve_mapper` does, so a registered mapper with an
      unregistered submapper reports a different code than an unregistered mapper, and it sums two declared
      memory sizes, reporting -1 where the reference returns null. `scratch/src/mapper_000.gs` then applies
      every `NromMapper.create` check in the reference's order: board family, 16 KiB or 32 KiB of PRG ROM, at
      most 8 KiB of summed PRG RAM and NVRAM, a trainer that needs PRG RAM at `$7000-$71FF`, and either
      exactly 8 KiB of CHR ROM with no CHR RAM or up to 8 KiB of CHR RAM with no CHR ROM, and it reports the
      two memory sizes an accepted board would map. The reference's 512-byte trainer length check is not
      ported, because the parser only ever reports a 512-byte trainer; suite 9 covers a header that lies about
      its payload. Suite 15 (`nrom`, 25 records) carries the declared image length and the sixteen header
      bytes like suite 9, and spans both header versions: NROM-128 and NROM-256, battery-backed NVRAM,
      four-screen mirroring, a trainer with and without PRG RAM, CHR ROM with the iNES 1.0 CHR RAM default,
      NES 2.0 CHR RAM at 8 KiB and 2 KiB, split PRG RAM and NVRAM, the 8 KiB limit, and every rejection code.
      The two mapped sizes are private to `NromMapper`, so the projection measures them through the public CPU
      and pattern ports by aliasing: the first write offset that wraps onto the start of a region is that
      region's size, and a pattern write that does not stick means CHR ROM is present. The mirror gained
      `GoboscriptMapperSelection` and `GoboscriptNromMapper`, a replay test over all 25 records, a sweep of
      all 4,096 mapper and submapper pairs against `resolve_mapper`, and rejection tests for the unusable
      sizes a parsed header can report. Mutation checks caught routing MMC3 to the NROM family, blaming the
      mapper for a bad submapper, accepting any PRG ROM of at least 16 KiB, ignoring a trainer with no PRG
      RAM, letting CHR ROM coexist with declared CHR RAM, and letting CHR RAM exceed one pattern table. The
      fixture is now fifteen suites and 513 records, and the generated list is 11,040 values. Not ported: PRG
      and CHR storage, the CPU and pattern address windows, the trainer copy, the NVRAM snapshots, and the
      MMC3 board; compile validation stays blocked by the missing toolchain.
- [x] Ported the CPU control loop and interrupt acceptance. `scratch/src/cpu_control.gs` picks the next
      sequence the way `begin_next_sequence` does in `src/nes/cpu/cpu_2a03.ts`: a jammed CPU keeps reading its
      vector, a latched NMI wins over IRQ, an asserted IRQ line is accepted unless the interrupt-disable flag
      masks it, and otherwise one instruction runs. It ports the NMI latch (`cpu_request_nmi`), the
      level-sensitive IRQ input (`cpu_set_irq_line`), the jam vector reads (`cpu_execute_jammed_cycles`:
      `$FFFF`, `$FFFE`, `$FFFE` the first time the CPU jams and `$FFFF` on every later jam), the reset-shaped
      state clear (`cpu_clear_interrupt_state`), and the one-instruction IRQ poll mask that CLI, SEI, and PLP
      leave behind through `cpu_finish_instruction`, which is what delays an IRQ after a CLI and lets an
      already pending IRQ through after an SEI. Suite 14 (`cpu_control`, 19 records) runs several steps per
      record over a program, so it pins the policy rather than one instruction: jam over NMI and over IRQ, NMI
      over IRQ, IRQ masked by the flag, the CLI and PLP delays, SEI and BRK at a boundary where the line is
      asserted late, RTI needing no delay, the latch clearing after one acceptance, and the later jam reading
      once. The sequence kinds come from the public `clock_cycle()` result, so no private reference state is
      read, and the record inputs name the steps at which an NMI is requested or the IRQ line is asserted. The
      mirror gained the same six procedures plus a replay test and a state test; mutations that dropped the
      poll mask, made every jam read three times, let an NMI outrank a jam, or left the latch set were all
      caught. The fixture is now fourteen suites and 488 records, and the generated list is 10,315 values. Not
      ported: DMA stalls and the yield policy a frame loop needs, cartridge payload copying and mapper
      dispatch, PPU, and APU; compile validation stays blocked by the missing toolchain.
- [x] Completed instruction dispatch for every official opcode. `scratch/src/cpu_instruction.gs` now routes
      the operand instructions through `cpu_execute_regular_instruction`, which resolves the operand and spends
      the cycles its kind needs: a dummy read of the opcode byte for the implied and accumulator forms, nothing
      extra for an immediate operand, and one read, one write, or the read, write-back, and write of a
      read-modify-write for a memory operand. `cpu_apply_read_instruction` covers LDA, LDX, LDY, ADC, SBC, AND,
      ORA, EOR, CMP, CPX, CPY, and BIT through the ported ALU and status helpers, `cpu_modify_value` covers
      ASL, LSR, ROL, ROR, INC, and DEC, and `cpu_compute_store_value` covers STA, STX, and STY. All 151
      official opcodes are now dispatched; unofficial opcodes other than KIL report `unofficial_opcode` after
      the opcode fetch, and the unstable high-byte stores stay with them. Suite 13 grew from 44 to 99 records,
      adding every load and store across the twelve memory addressing modes with and without page crossings,
      the ALU group with its carry, borrow, overflow, and zero boundaries, and the read-modify-write group on
      the accumulator and in memory; the LDA immediate record that documented a refusal in the previous entry
      now records the executed instruction. The mirror gained the same five procedures plus a totality test
      that executes all 256 opcodes and asserts the 151 official ones report no error while the other 104
      report `unofficial_opcode` except KIL. Mutation-checked by dropping the read-modify-write write-back,
      storing the wrong register for STX, losing the BIT overflow copy, and zeroing an immediate operand.
      Not ported: the jam vector reads and sequence selection, interrupt acceptance, and `finish_instruction`;
      compile validation stays blocked by the missing toolchain.
- [x] Ported instruction dispatch for the instructions that need no memory operand.
      `scratch/src/cpu_instruction.gs` fetches and decodes the opcode byte, then executes the KIL jam flag,
      BRK, JSR, RTI, RTS, the eight relative branches (dispatched on the decoded relative mode with the
      condition taken from the mnemonic), JMP absolute and JMP indirect, PHA, PHP, PLA, PLP, the six register
      transfers, TXS, the seven flag instructions, INX, DEX, INY, DEY, and NOP. Implied instructions spend the
      dummy read the reference spends, and everything the port does not execute yet sets one of five
      `cpu_instruction_error` codes after the opcode fetch instead of guessing. Suite 13 of the shared fixture
      (44 records, derived by executing `Cpu2A03.step()` behind a fresh decoder) pins the cycles, the final
      registers, and the ordered trace, including two refusal records whose error code the reference test
      derives from the production table and the ported mnemonic set rather than from the expected values. The
      mirror `GoboscriptCpuCore.execute_instruction()` replays all 44 records, and the source lint now compares
      the dispatched mnemonic names three ways: the `.gs` chains, the mirror ids, and the projection's ported
      set. Mutation-checked by dropping a PLA dummy read, inverting the BNE condition, retargeting TAX,
      drifting a mirror mnemonic id, and adding an undispatched mnemonic to the `.gs`. Not ported: loads,
      stores, the ALU and read-modify-write groups, the jam vector reads, interrupt acceptance, and
      `finish_instruction`; compile validation stays blocked by the missing toolchain.
- [x] Ported the opcode decode step. `scratch/src/cpu_opcode.gs` holds the 76-name `cpu_mnemonic` enum whose
      ids come from the canonical fixture, the `data/opcode_table.txt` list, a length and header check that
      reports a table which failed to load instead of decoding zeros, and `cpu_decode_opcode`, which turns one
      opcode byte into the mnemonic, addressing mode, base cycles, operand access, page-cross flag, and
      official flag at the record offset `3 + opcode * 6`. Suite 12 of the shared fixture (20 records: one per
      addressing mode plus the page-cross, official, KIL, ISC, SHY, JMP, RTS, and NOP boundaries) pins the same
      values, the mirror `GoboscriptCpuOpcodeDecoder` is compared with `CPU_OPCODE_TABLE` for all 256 opcodes,
      and the source lint now checks that the mnemonic enum carries exactly the fixture's ids and that the
      field enum holds the record offsets. Mutation-checked by renumbering `op_lda` and by shifting a field
      offset. Dispatch and per-instruction execution are not ported; compile validation stays blocked by the
      missing toolchain.
- [x] Extracted the opcode decode table into a canonical, generated form for the port:
      `tests/fixtures/goboscript/opcode_table.json` holds all 256 encodings as integers (mnemonic id,
      addressing mode id, base cycles, operand access id, page-cross flag, official flag) plus the 76 mnemonic
      names, `scripts/generate_goboscript_opcode_table.mjs` flattens it into the ignored
      `scratch/data/opcode_table.txt` (1,538 values) with the same overwrite and reconstruction protections as
      the vector generator, and `npm run scratch:opcode` runs it as part of `npm run build:scratch`.
      `tests/goboscript-opcode-table.test.ts` (4 tests) keeps the fixture equal to `CPU_OPCODE_TABLE` for every
      opcode, checks the flat list positions the ported decoder will index, mutation-checked by editing one
      `base_cycles` value, and rejects six malformed fixtures. The table is reference data; no `.gs` decoder
      reads it yet.
- [x] Ported the CPU cycle sequences that do not need opcode decoding to `scratch/src/cpu_sequence.gs`:
      reset, BRK, JSR, RTI, RTS, the NMI and IRQ/BRK hardware interrupts, and a relative branch, each spending
      one logged cycle per bus access. Opcode fetch stays with the caller, matching the reference, which
      reaches BRK, JSR, RTI, and RTS through `execute_instruction_cycles`. Interrupt acceptance policy (the NMI
      latch, the IRQ line, and the interrupt-disable mask between sequences) is deliberately not ported; the
      caller picks the sequence, and a branch applied to a non-relative operand records a sequence error code
      where the reference throws from a private method.
- [x] Grew the shared fixture from 338 to 350 records with suite 11 (`cpu_sequence`, 12 records) derived by
      executing `Cpu2A03.reset()` and `step()` behind a fresh decoder with no devices. The records cover the
      reset stack-pointer decrement and its wrap through page one, BRK with and without the break flag already
      set, the JSR push of the high operand address, RTI restoring a popped status that had break set, the RTS
      read of the return address, IRQ accepted with interrupt disable clear, NMI accepted with it set, and a
      branch taken inside one page, taken across a page, and not taken. Their vector reads of `$FFFA`-`$FFFF`
      return open bus on both sides, which also pins the latch that the pushes drive. Extracted the shared bus
      recorder into `tests/support/recording_cpu_bus.ts`, added
      `tests/support/cpu_sequence_projection.ts`, and added three mirror tests (50 in
      `tests/goboscript-port-algorithms.test.ts`) that replay every suite-11 record, check that the fixture
      covers all eight sequence ids, and exercise the branch error path.
- [x] Added two source-lint rules read out of the compiler's lowering, each mutation-checked: an argument may
      only be read as `$name`, because a bare name resolves to an unrelated variable, list, enum, proc, or func
      (this found two real call sites, in `cpu_core.gs` and `vector_selftest.gs`), and no cycle-spending helper
      may be nested inside another call's arguments, because `src/visitor/pass1.rs` hoists an
      expression-position func call in front of the enclosing statement (this found
      `to_signed_byte(cpu_fetch_byte())` in `cpu_addressing.gs`). The lint now has 16 tests.
- [x] Read the func lowering out of the compiler snapshot and reshaped the CPU helpers to match it.
      `src/visitor/pass1.rs` turns an expression-position func call into a hoisted `Stmt::FuncCall` plus a
      callsite variable, so a bus access nested inside another call would be ordered by that lowering rather
      than by the source; `Codegen::func` also emits a warp custom block (`Mutation::prototype(..., warp =
      true, ...)`) whose `return` is a `data_setvariableto`, not a Scratch reporter. `cpu_read_cycle`,
      `cpu_fetch_byte`, `cpu_fetch_word`, `cpu_pop_byte`, and `cpu_pop_word` are therefore procs that leave
      their results in `cpu_cycle_value`, `cpu_fetched_byte`, `cpu_fetched_word`, `cpu_popped_byte`, and
      `cpu_popped_word`, the mirror and its tests were converted with them, and a source-lint test rejects any
      cycle-spending helper nested inside another call's arguments. Findings are recorded in
      `docs/GOBOSCRIPT_RESEARCH.md`.
- [x] Fixed a systematic port syntax error and locked it down: every parenthesized multi-argument `proc`
      call in the `.gs` sources (39 call sites across `cartridge.gs`, `cpu_bus.gs`, and
      `vector_selftest.gs`) would not parse, because GoboScript calls a proc as `name arg1, arg2;` and only
      a `func` takes parentheses. `tests/goboscript-source.test.ts` gained a call-shape and argument-count
      lint (14 tests), mutation-checked for a parenthesized proc call, a func used as a statement, and a
      wrong argument count on each kind.

## Verified in this environment

- `npm ci`: passed from the lockfile on 2026-10-15 and reported zero audit vulnerabilities.
- `npm test` on 2026-10-18: passed all 1,188 tests in about 15 seconds, including 257 grouped single-step
  corpus tests (1,026 vectors), 542 shared port-vector tests (541 records), 69 GoboScript port-algorithm
  tests, 17 GoboScript source-lint tests, and 18 PPU register/timing tests. `npx tsc --noEmit` is clean.
- `npm run test:cpu-corpus -- --corpus /tmp/sst/nes6502/v1` on 2026-10-18: 2,560,000 of 2,560,000 upstream
  scenarios passed across 256 opcode files in about 20 seconds. The corpus is a local MIT clone and is not
  checked in.
- `npm run scratch:vectors` on 2026-10-18: generated 12,357 decimal values for 541 vectors.
- `npm test` on 2026-10-15: passed all 332 tests, including ROM/vector generator regressions, one browser-server HTTP smoke test,
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
  ROM-list values. `npm run scratch:vectors`: passed and generated 202 decimal values for 15 vectors
  (2026-10-15 figures; the fixture has since grown to 541 records and 12,357 values).
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
- No `.gs` source in `scratch/` has ever been compiled, so the in-project vector self test has never run and
  its result is unknown. The TypeScript mirror and source lint validate the ported algorithms and the source
  shape; they are not a compiler, a runtime, or a performance measurement.
- The supplied ROM's exact dump provenance/revision and redistribution rights remain unknown despite its
  high-confidence identification as the MMC3 Japanese SMB2 conversion. Its first 1,000,000-cycle smoke reached
  PC `$7108` after 33 PPU frames with a uniform palette-index-1 framebuffer and silent audio; it ended before
  the title-screen initialization that the later 43-frame test confirms.
- No third-party CPU test ROM is bundled. The automated CPU reference fixture is a small, MIT-licensed
  subset of single-instruction vectors; it is not full-suite conformance and does not establish ROM boot
  compatibility.
- The cycle sequencer now matches the full 2.56-million-vector upstream corpus, which validates this
  implementation against a recorded reference, not against silicon; hardware-level interrupt edge traces
  remain unavailable. `NesConsole` now composes the CPU/PPU/APU and routes PPU NMI plus
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

**Milestone 2: GoboScript port of the tested helper layer.** The TypeScript foundation from milestone 1 is
unchanged and now carries a 1,026-vector CPU corpus fixture. The GoboScript project has executable source for
numeric/status/ALU helpers, both controller ports, a CPU-bus subset, and a vector self test that the Stage runs
on the green flag. Every ported algorithm is mirrored in integer-only TypeScript and compared exhaustively with
the bitwise reference, and the sources are lint-checked against the upstream grammar and codegen constraints,
but nothing has been compiled or run in Scratch/TurboWarp. The next port steps are cartridge metadata and CPU
fetch/decode/addressing/cycles, each blocked on the same missing toolchain for validation.

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
