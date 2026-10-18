# TODO

This is the implementation plan for the full system, not a claim of current compatibility. Tasks are ordered
by dependency. Mark a task done only after its behavior is tested, and keep external-runtime validation
separate from TypeScript success.

## P0 - Compiler and fixture validation

- [x] Check local PATH, npm, and upstream release metadata for a usable GoboScript compiler.
- [ ] Provision the official GoboScript compiler matching the documented source snapshot, record its
      version, and compile `scratch/`.
- Blocker found in this environment: `cargo`, `rustc`, and `goboscript` are not installed. The npm
  registry has no `goboscript` package. Upstream GitHub release metadata exposes prebuilt assets, but the
  available latest tagged binary (v3.2.1) is older than the researched v3.3.0 source snapshot. A download
  attempt for the official Linux archive was blocked at the release-asset fetch; do not treat an older compiler
  as satisfying the pinned-toolchain task.
- [ ] Fix any GoboScript syntax, configuration, asset, or file-backed-list errors reported by the
      compiler.
- [ ] Open the generated `.sb3` in TurboWarp and confirm the green-flag ROM signature result.
- [ ] Record which embedded TurboWarp options work and separately test any claim of Scratch website
      compatibility.
- [x] Identify the supplied fixture as an MMC3 conversion of Japanese *Super Mario Bros. 2* and establish
      a reproducible title-screen boot result without replacing the file. Its SHA-256, title-marker evidence,
      and bounded boot test are in `docs/TESTING.md`.
- [ ] Establish the fixture's exact source/version and redistribution license before distributing or adding
      it to generated release artifacts.
- [x] Verify that the generated decimal list exactly reconstructs the source ROM byte-for-byte.

## P1 - CPU 2A03

- [x] Define the CPU register shape, status flag masks, byte/word normalization, signed-byte
      conversion, and zero/negative flag helpers; exhaustively test byte and flag behavior.
- [x] Define the CPU bus contract and a deterministic fake bus with ordered access traces for tests.
- [x] Implement reset-vector handling, deterministic initial registers, stack push/pop, and status
      packing for BRK versus IRQ/NMI.
- [x] Implement all 13 official addressing modes, including zero-page wrapping, indexed page crossings,
      relative branches, the indirect JMP page-wrap behavior, and read-modify-write bus ordering.
- [x] Implement all 151 official 2A03 opcodes (56 instruction mnemonics) and verify results, flags,
      cycle counts, and ordered bus side effects.
- [x] Implement instruction-boundary IRQ/NMI entry, NMI priority/latching, level-sensitive IRQ masking,
      and delayed IRQ polling after CLI/SEI/PLP; test seven-cycle stack/vector effects. PPU/APU/mapper line
      integration and cycle-edge corner cases remain for console integration.
- [x] Implement binary ADC/SBC helpers and exhaustively test byte pairs, carry input, result flags, and
      decimal-flag behavior for the 2A03.
- [x] Give every opcode byte an explicit table entry instead of silently skipping or mis-decoding it. All
      256 byte values are now classified as official or unofficial; unstable behavior caveats and validation
      work are tracked in the unofficial-coverage section below.
- [x] Add an optional instruction-level trace adapter for register snapshots, instruction bytes, step
      cycles, and ordered CPU bus accesses. Trace output does not imply cycle-accurate execution.
- [x] Add an opt-in headless NROM runner for `nestest` trace comparison; ROM and log files are supplied
      externally, not bundled with the project.
- [x] Select appropriately licensed CPU test fixtures for automated project tests: 1,026 pinned MIT-licensed
      SingleStepTests NES 2A03 vectors covering all 256 opcode bytes are checked in and compared automatically,
      including crossing and non-crossing tests for the five unstable high-byte stores and the KIL/JAM bus
      pattern. Source, license, upstream hashes, fixture hash, setup, and expected result are recorded in
      `tests/fixtures/nes6502/README.md`. `npm run test:cpu-corpus` optionally replays the full upstream corpus
      (2,560,000 scenarios, about 20 seconds) from a local clone. No third-party CPU test ROM is bundled; the
      supplied SMB2J game fixture is not a substitute for CPU conformance vectors.
- [x] Replace whole-instruction execution with `Cpu2A03.clock_cycle()` micro-operations: each official
      opcode, reset, and IRQ/NMI sequence issues one bus transaction per call. Branch dummy cycles and
      delayed IRQ polling after CLI/SEI/PLP are modeled. Device-edge timing remains integration work; this
      is cycle-visible execution, not a claim of cycle accuracy.

## P2 - CPU bus, PPU bus, and cartridge

- [x] Complete parser tests for the exposed iNES/NES 2.0 metadata, trainer offsets, zero CHR ROM,
      RAM/NVRAM defaults and shifts, unsupported versions, truncated header/trainer/ROM payloads, and
      oversized declarations. Verify returned trainer/PRG/CHR slices are independent copies, including
      when the input is a Node Buffer.
- [x] Define explicit mapper routes: mapper 0/submapper 0 selects NROM and mapper 4/submapper 0 selects
      MMC3; unsupported mapper IDs and unlisted submappers return structured errors instead of falling back
      to NROM. Each route is backed by a separate, validated implementation below.
- [x] Implement the production CPU address decoder: mirrored 2 KiB RAM, mirrored PPU registers,
      APU/controller ports, cartridge windows, and latched/partially-driven open bus. Device internals
      remain separate; cycle-visible $4014 DMA is implemented below.
- [x] Implement $4014 OAM DMA with CPU stall/alignment behavior and ordered bus effects. The transfer is
      cycle-visible through `Cpu2A03.clock_cycle()` and copies through the PPU OAMDATA port; DMC priority/
      OAM arbitration and NTSC console clock coupling are implemented. Exact DMA/PPU edge timing still needs ROM
      validation.
- [x] Implement PPU pattern/nametable/palette/OAM address routing, nametable mirroring, palette
      aliases, and PPU bus access visible to mappers. `PpuMemoryBus` delegates pattern memory to a mapper,
      reports pattern/nametable activity, forwards one dot tick to the mapper even without a bus access,
      routes `$2000-$3EFF` through vertical/horizontal/four-screen nametable RAM, applies palette mirrors
      and universal-background aliases with six-bit writes, and exposes primary OAM separately. PPU registers
      and rendering are separate devices; `NesConsole` owns their coupled NTSC scheduling.
- [x] Implement mapper 0 (NROM) as a baseline and test PRG/CHR ROM and CHR-RAM behavior.
      `NromMapper.create` returns structured errors for unsupported routes/layouts; the mapper supports
      mirrored 16 KiB or linear 32 KiB PRG ROM, declared PRG RAM up to 8 KiB, fixed 8 KiB CHR ROM or
      declared CHR RAM up to 8 KiB, trainer initialization at `$7000`, and header-selected nametable
      mirroring. MMC3 remains separate.
- [x] Implement mapper 4/submapper 0 (MMC3) for the supplied fixture: PRG/CHR bank modes and register
      decode, mirroring with four-screen protection, PRG-RAM enable/write protection, IRQ counter/reload/
      enable, and A12 rising-edge filtering after at least ten low PPU dots. The mapper observes ordinary
      PPU accesses plus committed `$2006` addresses and `$2007` increments; `Ppu2C02.clock_ppu_dot()` drives
      its filter. External MMC3 cases 1-3 pass in an exploratory runner, while scanline timing case 4 fails;
      details and the Mesen2/FCEUX comparison are recorded in `docs/TESTING.md`. Console scheduling and
      CPU IRQ-line integration remain unimplemented.
- [x] Add mapper-specific creation, reset, read/write, bank-boundary, RAM-protection, mirroring, and IRQ
      tests. The implemented/tested mapper list is mapper 0/submapper 0 NROM and mapper 4/submapper 0 MMC3;
      other mapper/submapper combinations remain explicitly unsupported.

## P3 - PPU 2C02 and video

- [x] Implement CPU-facing PPU registers, PPU I/O open bus, PPUSTATUS read side effects, shared
      scroll/address latches, PPUDATA buffering/palette reads (including greyscale masking), VRAM increment
      rules, and OAMDATA through the PPU memory bus. `Ppu2C02` exposes status setters and its level-sensitive
      NMI output; open-bus decay, reset-time write suppression, and rendering-time register quirks remain.
- [x] Implement deterministic NTSC scanline/dot scheduling, odd-frame behavior, vblank timing, NMI
      edge behavior, and CPU/PPU synchronization. `Ppu2C02.clock_ppu_dot()` processes 341-dot scanlines
      across 262 lines, clocks the mapper once per elapsed dot, and sets vblank at (241,1) unless PPUSTATUS
      is read at dots 0-1 before the event; status flags clear at (261,1). Odd rendered frames skip dot 340
      (advancing after dot 339), and `clock_cpu_cycle()` advances three PPU dots. NMI rising edges, including
      PPUCTRL enable during vblank, are consumed through
      `take_nmi_edge()`. Console-level CPU ordering and forwarding those edges to `Cpu2A03` remain in P5.
- [x] Implement a deterministic background fetch/shift pipeline, coarse/fine scrolling, attribute selection,
      sprite evaluation/fetch, OAM priority, sprite-zero hit, sprite overflow, and color/emphasis output.
      `Ppu2C02` renders background/sprite pixels into a 256 by 240 framebuffer; PPUMASK grayscale is applied
      to six-bit palette indices and its three emphasis bits are retained in a parallel plane. Sprite
      evaluation keeps the first eight in-range sprites, sets overflow on a ninth, and models diagonal OAM-byte
      overflow false positives; fast tests cover both normal overflow and a non-Y-byte match. The evaluation is
      still aggregated rather than dot-by-dot, so exact secondary-OAM timing, OAMADDR-dependent behavior, the
      exact pixel/output pipeline delay, OAM rendering-time quirks, and register races remain deviations;
      test-ROM validation is still required.
- [x] Produce a deterministic 256 by 240 color-index framebuffer and add unit tests for register and
      pixel behavior. `get_framebuffer()` and `get_framebuffer_emphasis()` return row-major copies suitable
      for host rendering without exposing mutable PPU storage.
- [ ] Validate with appropriately licensed PPU, timing, sprite, and mapper IRQ test ROMs; record every
      known deviation. The unlicensed exploratory runs in `docs/TESTING.md` show four selected sprite-hit
      cases passing, all five selected sprite-overflow ROMs failing, MMC3 cases 1-3 passing, and MMC3
      scanline-timing case 4 failing. The binaries were not retained because the upstream collection has no
      declared license. Licensed validation and ROM-confirmed hardware interrupt/scheduler phase behavior
      remain outstanding.

## P4 - APU 2A03 and controller input

- [x] Implement the standalone `ApuPulseChannel`: duty sequences, period-plus-one timer ticks, all 32
      length-counter values, length halt/disable rules, constant and decaying/looping envelopes, sweep
      divider/target behavior, channel-1 negate adjustment, reset, and pulse mute rules. Explicit timer,
      quarter-frame, and half-frame methods are unit-tested and driven by the `Apu2A03` frame sequencer below.
- [x] Integrate both pulse channels into `Apu2A03` as an `ApuCpuPort`: decode `$4000-$4007`, `$4015`, and
      `$4017`; expose pulse length status and open-bus-aware status reads; clock pulse timers and the NTSC
      four-/five-step frame sequence, including frame IRQ and IRQ inhibit. `NesConsole` calls
      `clock_cpu_cycle()` once for every CPU cycle; exact frame-counter edge behavior needs ROM validation.
- [x] Implement triangle and noise channels: triangle linear/length counters and held 32-step DAC, NTSC
      noise periods and long/short 15-bit LFSR modes, envelope/length behavior, `$4008-$400F` register
      routing, `$4015` status, and CPU-rate timer clocks. Add the nonlinear pulse+TND output equation; the
      deterministic core sample path remains unfiltered, while a separate approximate browser-output filter is
      applied only before Web Audio playback.
- [x] Implement DMC fetch timing, sample buffer, IRQ behavior, and its interaction with CPU stalls and
      DMA. `ApuDmcChannel` implements NTSC rates, 3/4-cycle load timing, sample address/length, looping,
      buffer/output shifting, DAC updates, and completion IRQ. `NesCpuBus` services reads through cartridge
      space, stalls only on CPU reads, repeats held reads on DMC no-operation cycles, and gives DMC gets
      priority over OAM source reads with OAM realignment. Focused channel/APU/DMA and console IRQ tests pass;
      licensed-ROM validation of load/reload edges and OAM-collision offsets remains open.
- [x] Produce deterministic audio samples from emulated time; test sample rate and channel behavior
      independently of the runtime. `ApuAudioSampler` uses an integer phase accumulator at the NTSC CPU rate
      (1,789,773 Hz) and produces mono `Float32Array` output at an integer rate from 1 Hz through the CPU
      rate (44.1 kHz default). `Apu2A03.clock_cpu_cycle()` clocks channels first and then samples their nonlinear
      mix; `drain_audio_samples()` returns queued samples without resetting fractional phase. Tests verify
      exact one-second sample counts, draining/reset, validation, and live all-channel output. This remains an
      unfiltered zero-order core sample path; the browser host adapter filters copied blocks without changing
      emulated APU state, while TurboWarp output and device validation remain separate.
- [x] Implement two standard serial controllers as `NesControllerPorts`: `$4016` strobe input, live A reads
      while strobing, falling-edge state latch, A/B/Select/Start/Up/Down/Left/Right serial order, and trailing
      1 bits after the eight-button report. The controller drives only D0 so `NesCpuBus` preserves the other
      open-bus bits. Six tests cover both ports, every button, strobe/re-latch behavior, post-eight reads,
      bus routing/open bus, and input validation. The TypeScript browser adapter maps 16 keys across both pads
      and has four tests for key transitions. Starting emulation focuses the canvas so game keys work after
      clicking Run; target-runtime input validation and nonstandard accessories remain separate.
- [x] Define expansion-hardware scope: the initial NTSC NES slice supports the native APU and two standard
      pads. Four Score and Zapper are deferred but remain planned for the full NES target; Zapper support waits
      for PPU sensor/timing integration. Implement mapper expansion audio alongside each supported mapper that
      requires it. Famicom-only expansion-port devices are outside the NES target; evaluate other peripherals
      individually when compatibility requires them.
- [ ] Validate APU/controller behavior with licensed test suites and runtime input/audio tests. Two pinned
      MIT APU player ROMs now pass automated headless controller-to-sample smoke tests for pulse and noise
      channels; the SquarePlayer path includes the browser keyboard adapter. Their source, license, hashes, and
      results are in `docs/TESTING.md`. These are not conformance
      results or audible host playback. Four keyboard-adapter, five injected-Web-Audio, and five host audio-
      filter tests cover TypeScript adapters but do not exercise a real browser or audio device. Other ROM
      suites and target-runtime checks remain open. The browser shell is available for hands-on checks; P6
      TurboWarp input/audio adapters and validation remain.

## P5 - Console scheduler and integration

- [x] Compose the CPU, PPU, APU, buses, supported mapper, and standard controllers into `NesConsole` with
      reset, pause/resume, CPU-cycle/sequence step, controller state, and bounded frame advancement. Synthetic
      NROM/MMC3 composition and reset/pause/frame tests pass, as do the pinned licensed NROM
      SquarePlayer and NoisePlayer smoke tests. The supplied MMC3 fixture reaches a bounded title-screen
      signature; broader gameplay behavior remains unverified.
- [x] Build a TypeScript browser shell with an HTML canvas and keep DOM/canvas/audio code under
      `src/nes/browser/`, outside the hardware core. The renderer converts the 256 by 240 palette/emphasis planes
      to RGBA, disables smoothing, and uses integer CSS scaling; the `requestAnimationFrame` adapter advances at
      most one bounded console frame per callback. Unit tests cover color conversion, scaling, canvas writes,
      scheduling, cancellation, and error shutdown. An HTTP integration test covers the page, stylesheet, bundled
      ROM bytes, method handling, lexical traversal rejection, and symlink-escape rejection. `npm run browser:dev`
      builds and serves the preview; actual interactive browser performance and audible playback still need
      hands-on validation.
- [x] Use an explicit NTSC master-clock model: `NtscClock` tracks 21,477,272 Hz master ticks, three PPU
      dots per CPU cycle, and the CPU/APU divider. PAL/Dendy timing is not included; ROM phase validation
      remains open.
- [x] Order CPU, PPU, APU, DMA, mapper IRQ, and interrupt events deterministically; add trace fixtures
      for sensitive boundaries. `NesConsole` defines the coincident CPU/APU-before-PPU order and has synthetic
      vblank-NMI/APU-frame-IRQ tests, an MMC3 A12-to-CPU IRQ test, and a trace assertion for interrupt-sample,
      CPU, APU, and PPU ordering. Licensed-ROM validation of exact hardware phase remains outstanding.
- [x] Add optional console/PPU/frame trace and debug adapters that do not change core behavior or
      introduce browser dependencies. `NesConsoleTraceRecorder` is an opt-in bounded ring buffer for ordered
      interrupt, CPU bus-cycle, APU-cycle, PPU-dot, NMI-edge, and frame-boundary events; ordinary consoles
      allocate no trace buffer and CPU instruction traces remain available in `cpu_trace.ts`.
- [x] Identify and boot the supplied mapper 4 ROM in TypeScript. Its title screen and `SM2SAVE` marker
      identify it with high confidence as an MMC3 conversion of the Japanese *Super Mario Bros. 2* (Lost
      Levels), likely Loopy's port; the exact dump revision remains unknown. A bounded TypeScript integration
      test reaches the title-screen pixel signature within 60 frames (the current deterministic run reaches it
      at frame 43). A temporary `jsnes` 2.1.0 reference run showed the same screen. The earlier 1,000,000-cycle
      smoke ended before title-screen initialization; rights and broader gameplay compatibility remain open.

## P6 - TurboWarp output and GoboScript port

- [x] Define the initial ROM deployment path as build-time bundling for both Scratch and TurboWarp.
      `scripts/generate_goboscript_rom_data.mjs --rom <path>` writes a byte-checked decimal list consumed
      by the GoboScript project; one ROM is fixed into each compiled `.sb3`, with no runtime binary loader.
      `test_rom.nes` remains the default input, other ROMs are passed without replacing it, and license review
      is required before distributing a project that embeds a game ROM. The generator path is tested; a
      GoboScript build remains blocked by the missing compiler.
- [x] Create an initial shared, generated vector set for numeric helpers, CPU instruction state/cycles,
      CPU-bus mirroring/open bus, MMC3 PRG banks/filtered IRQs, scheduled PPU vblank/NMI, pulse APU state,
      controller serialization, and per-instruction ALU results. `tests/fixtures/goboscript/shared_port_vectors.json`
      is canonical: thirteen suites and 414 records, whose expected ALU bytes were derived by executing the
      production CPU, whose expected cartridge header fields were derived by executing `parse_ines_rom`, and
      whose expected addressing operands and bus traces were derived by executing
      `Cpu2A03.resolve_addressing_mode()` behind a fresh decoder. TypeScript tests run each case and `npm run scratch:vectors` emits the numeric
      GoboScript list. The schema and deliberately bounded coverage are documented in
      `docs/GOBOSCRIPT_PORT_VECTORS.md`.
- [x] Port byte/word helpers and tested CPU status/ALU logic to GoboScript; compare against TypeScript
      vectors. `scratch/src/numeric.gs`, `cpu_status.gs`, and `cpu_alu.gs` implement bit-free byte/word/status
      helpers, AND/OR/XOR by weight loop, and ADC, SBC, AND, ORA, EOR, ASL, LSR, ROL, ROR, CMP, CPX, CPY,
      BIT, INC, and DEC; at that milestone `scratch/src/vector_selftest.gs` replayed suites 1, 3, 7, and 8.
      Because the compiler is unavailable, comparison happens through
      `tests/support/goboscript_port_algorithms.ts`, an integer-only mirror of every helper that
      `tests/goboscript-port-algorithms.test.ts` sweeps exhaustively against the bitwise reference and replays
      through the fixture; `tests/goboscript-source.test.ts` lints the sources and enforces mirror parity.
      The `.gs` files remain compile-unvalidated, so the in-project self test has never run.
- [x] Port cartridge header parsing to GoboScript and pin it with vectors. `scratch/src/cartridge.gs` decodes
      iNES 1.0 and NES 2.0 headers into the `cartridge_*` globals: signature, version bits, mapper and
      submapper, mirroring, battery, trainer flag, PRG/CHR ROM sizes including the NES 2.0 exponent form, the
      four RAM/NVRAM sizes, and the trainer/PRG/CHR offsets, reporting the six reference error codes as
      integers in TypeScript check order. Suite 9 of the shared fixture holds 25 records derived by executing
      `parse_ines_rom`, `tests/support/cartridge_projection.ts` projects a reference parse onto those eighteen
      fields for both tests, and the mirror `GoboscriptCartridgeParser` is compared against the reference for
      every `flags6`/`flags7` byte, every legacy PRG RAM bank count, every NES 2.0 mapper and RAM byte, all
      4,096 encoded NES 2.0 ROM sizes, every RAM shift nibble, and image lengths 0 through 16. Not ported:
      payload copying into bank lists, RAM/NVRAM storage, and mapper dispatch. Compile validation stays
      blocked by the missing toolchain.
- [x] Port the CPU register state, bus cycles, stack operations, and all thirteen addressing modes.
      `scratch/src/cpu_core.gs` holds the registers, one logged bus transaction per cycle, fetch byte/word,
      push/pop byte/word, and status push/restore; `scratch/src/cpu_addressing.gs` resolves every official
      mode with its dummy reads, page-crossing cycle, and the JMP indirect pointer wrap. Suite 10 of the
      shared fixture (39 records, derived by executing `Cpu2A03.resolve_addressing_mode()` behind a fresh
      decoder) pins the operand, cycle count, final PC/SP, and the ordered bus trace; the mirror
      `GoboscriptCpuCore` is also compared against the traces of real PHA, PLA, JSR, RTS, BRK, and RTI
      instructions and reports an error code where the reference throws for an illegal mode/access pair. The
      sequences, interrupts, and reset items listed as not ported here were ported in the next entry. Compile
      validation stays blocked by the missing toolchain.
- [x] Port the CPU cycle sequences that do not need opcode decoding. `scratch/src/cpu_sequence.gs` holds
      reset, BRK, JSR, RTI, RTS, the NMI and IRQ/BRK hardware interrupts, and a relative branch, with opcode
      fetch left to the caller exactly as the reference does it. Suite 11 of the shared fixture (12 records,
      derived by executing `Cpu2A03.reset()` and `step()` behind a fresh decoder) pins the cycle count, the
      final registers, and the ordered bus trace, including the reset stack-pointer wrap, the BRK status byte,
      the JSR push of the high operand address, RTI status restore, the RTS read of the return address, IRQ
      and NMI acceptance, and taken, page-crossing, and not-taken branches. Not ported: opcode fetch/decode
      and dispatch, the per-instruction sequences of the remaining official opcodes, interrupt acceptance
      policy between instructions, and the unstable high-byte stores. Compile validation stays blocked by the
      missing toolchain.
- [x] Put the opcode decode table in generated form for the port. `tests/fixtures/goboscript/opcode_table.json`
      is the canonical integer encoding of all 256 opcodes (mnemonic id, addressing mode id, base cycles,
      operand access id, page-cross flag, official flag) plus the 76 mnemonic names, kept equal to
      `CPU_OPCODE_TABLE` by `tests/goboscript-opcode-table.test.ts`, and
      `scripts/generate_goboscript_opcode_table.mjs` flattens it to the ignored
      `scratch/data/opcode_table.txt` (1,538 values) through `npm run scratch:opcode`. The `.gs` mnemonic enum,
      the list loader, and the decode proc that reads it landed in the next entry.
- [x] Port instruction dispatch for the instructions that need no memory operand.
      `scratch/src/cpu_instruction.gs` executes one whole instruction: fetch and decode, then the KIL jam
      flag, BRK, JSR, RTI, RTS, the eight branches, both JMP forms, the four stack instructions, the
      transfers, TXS, the flag instructions, INX, DEX, INY, DEY, and NOP, with five numeric refusal codes for
      anything else. Suite 13 (44 records) pins the cycles, registers, and ordered bus trace, including two
      records that document the refusals for an unofficial SLO and an official LDA immediate. Not ported: the
      load, store, ALU, and read-modify-write instructions, the jam vector reads and sequence selection,
      interrupt acceptance policy between instructions, `finish_instruction`, and the unstable high-byte
      stores. Compile validation stays blocked by the missing toolchain.
- [x] Port the opcode decode step. `scratch/src/cpu_opcode.gs` holds the 76-name `cpu_mnemonic` enum with the
      fixture's ids, the `data/opcode_table.txt` list, a length and header check that reports a table which
      failed to load instead of decoding zeros, and `cpu_decode_opcode`, which reads the six fields at the
      record offset `3 + opcode * 6` into the `cpu_opcode_*` globals that `cpu_resolve_operand` can consume
      directly. Suite 12 (20 records) pins one opcode per addressing mode plus the page-cross, official, KIL,
      ISC, SHY, JMP, RTS, and NOP boundaries; the mirror `GoboscriptCpuOpcodeDecoder` is compared with
      `CPU_OPCODE_TABLE` for all 256 opcodes; and the source lint checks the mnemonic and field enum ids
      against the generated table. Not ported: opcode dispatch, the per-instruction sequences of the remaining
      official opcodes, interrupt acceptance policy between instructions, and the unstable high-byte stores.
      Compile validation stays blocked by the missing toolchain.
- [ ] Port the CPU, bus, mapper, PPU, APU, and controller incrementally. Keep GoboScript list indices
      1-based and bound every long no-refresh loop. Done so far: both serial controller ports
      (`scratch/src/controller.gs`), a documented CPU-bus subset (`scratch/src/cpu_bus.gs`) covering RAM
      mirroring, the open-bus latch with driven masks, and `$4016`/`$4017`, and cartridge header parsing
      (`scratch/src/cartridge.gs`); PPU, APU, OAM DMA, and cartridge windows still behave as absent devices on
      the bus. Not started: CPU fetch/decode/addressing/cycles/interrupts, cartridge payload copying, MMC3,
      PPU rendering, and APU channels.
- [ ] Build each port milestone with the pinned compiler and run its parity vectors in the compiled
      project.
- [ ] Prototype and benchmark at least two video-output strategies in TurboWarp; test clone, costume,
      pen, and/or generated asset approaches before choosing.
- [ ] Implement TurboWarp input, audio, reset, status, and error reporting without coupling those
      adapters to the hardware model.
- [ ] Measure frame time, memory, list sizes, and responsiveness on documented hardware. Keep the
      project usable while yielding between bounded work chunks.

## P7 - Accuracy, persistence, and release

- [x] Run CPU, PPU, APU, DMA, interrupt, mapper, and timing test suites; document skips and known
      failures. On 2026-10-15, `npm test` passed all 332 tests (including strict type-checking) and
      `npm run build:ts` passed; on 2026-10-18 it passed all 1,048 tests. Coverage and known external-ROM
      failures/skips are recorded in `docs/TESTING.md`.
- [ ] Differentially compare CPU traces and framebuffer/audio outputs against trusted reference
      behavior. The first 5,003 external `nestest` trace entries match; TypeScript and a temporary JSNES 2.1.0
      run reach the supplied ROM's title layout by frame 43. The licensed APU-player comparison shows
      control-driven sound in both implementations but a one-frame square-channel onset difference and
      nonmatching sample levels/tails. Exact cycle-aligned framebuffer/audio parity remains open; results are
      recorded in `docs/TESTING.md`.
- [x] Persist mapper-declared PRG and CHR NVRAM in NROM/MMC3 snapshots and the TypeScript browser adapter.
      Volatile RAM is excluded, restore validates both sizes before writing either region, and SHA-256-keyed
      browser records accept legacy PRG-only saves. TurboWarp persistence and complete console save states are
      explicitly not supported or advertised; see `docs/SUPPORTED_FEATURES.md`.
- [x] Publish supported regions, mappers/submappers, expansion hardware, unofficial opcode behavior,
      controls, ROM deployment, persistence, and known inaccuracies in `docs/SUPPORTED_FEATURES.md`. The
      TypeScript/browser path caps ROM images at 32 MiB total; oversized user files are rejected before reading.
- [x] Explicitly label performance limits instead of claiming TurboWarp throughput. The Scratch/TurboWarp
      scaffold does not execute game frames; the only available timing is one 46 ms synthetic TypeScript frame
      in this sandbox, which is not a representative benchmark. Target-device/TurboWarp measurements remain
      open under P6 and `docs/COMPLETION_CRITERIA.md`.
- [x] From a clean npm install (`npm ci`), run TypeScript tests/build and regenerate the selected-ROM and
      shared-vector assets. On 2026-10-15 all 332 tests passed; both data generators completed. Rechecked on
      2026-10-18 with 1,048 tests passing and all three generators completing (7,303 vector values, 1,538
      opcode values, 81,936 ROM bytes).
- [ ] Install the documented GoboScript compiler, build/open the `.sb3`, and validate it in TurboWarp;
      review source, asset, and ROM rights before distribution. Compiler availability and runtime validation
      remain blocked; see the P0 notes above.
- [x] Keep `PROGRESS.md` and `COMPLETION_CRITERIA.md` current with test results, measurements, and open
      blockers. The 2026-10-15 clean-install run passed 332 tests, TypeScript build, and both data generators;
      the 2026-10-18 run passed 1,048 tests. The 46 ms synthetic-frame result is labeled nonrepresentative. This
      is a progress record, not a claim that emulator, licensed-ROM, GoboScript, TurboWarp, or release criteria
      are complete.

## Unofficial CPU opcode coverage

- [x] Implement all 105 unofficial 2A03 opcode bytes without changing the 151 official opcodes: 27 stable
      NOPs, six immediate ALU forms, ten LAX/SAX forms, LAS, 12 KIL/JAM opcodes, 42 composite memory RMW
      encodings, XAA/LXA, and all five AHX/SHX/SHY/TAS high-byte-store encodings. Tests confirm all 256 opcode
      bytes are classified and exercise all official opcodes, bus cycles, and the implemented unofficial groups.
      XAA/LXA use configurable magic input (default `$EE`). The high-byte stores use deterministic masking
      and page-cross behavior; a DMC stall on their tagged dummy read drops the data mask but preserves address
      corruption. Other RDY/chip effects and XAA/LXA analog variation remain unmodeled. KIL/JAM's repeated bus
      reads are an emulator convention, not hardware-verified.
- [ ] Compare unstable-opcode behavior with suitable reference tests/hardware and model additional chip- or
      RDY/DMC-dependent effects before claiming hardware-accurate unofficial-opcode behavior. Full
      opcode-byte coverage is not the same as verified behavior.
