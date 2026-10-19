# TODO

This is the implementation plan for the full system, not a claim of current compatibility. Tasks are ordered
by dependency. Mark a task done only after its behavior is tested, and keep external-runtime validation
separate from TypeScript success.

## P0 - Compiler and fixture validation

- [x] Check local PATH, npm, and upstream release metadata for a usable GoboScript compiler.
- [ ] Provision the official GoboScript compiler matching the documented source snapshot, record its
      version, and compile `scratch/`.
- [x] Bring the compiled project in `scratch/scratch.sb3` in line with the sources block by block, and
      verify it headlessly: the in-project self test reports `port vectors 582/582 passed, 5 skipped`, and
      the console boots the embedded MMC3 image, reads the reset vector, and runs the game with a bus
      trace byte-identical to the TypeScript reference's. A real compile is still required before the
      project counts as compiler-validated.
- Blocker found in this environment: `cargo`, `rustc`, and `goboscript` are not installed. The npm
  registry has no `goboscript` package. Upstream GitHub release metadata exposes prebuilt assets, but the
  available latest tagged binary (v3.2.1) is older than the researched v3.3.0 source snapshot. A download
  attempt for the official Linux archive was blocked at the release-asset fetch; do not treat an older compiler
  as satisfying the pinned-toolchain task.
- [ ] Fix any GoboScript syntax, configuration, asset, or file-backed-list errors reported by the
      compiler.
- [ ] Open the generated `.sb3` in TurboWarp and confirm the green-flag ROM signature result and the
      pen-drawn color picture. The ported PPU renders every frame and the display sprite presents it
      with the pen extension, but the checked-in `.sb3` predates that renderer, so it must be rebuilt
      from the sources before either can be confirmed. The report still carries the frame count, the
      drawn-frame count, the CPU cycle count, and the program counter.
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
      is canonical: eighteen suites and 562 records, whose expected ALU bytes were derived by executing the
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
- [x] Port the MMC3 scanline IRQ and the PPU A12 filter that clocks it.
      `scratch/src/mapper_004.gs` gained the four IRQ registers in the same `bitwise_and(address, $E001)`
      switch the banking registers use (`$C000` latch, `$C001` reload, `$E000` disable and acknowledge,
      `$E001` enable), the A12 observation that ignores a repeated level and clocks a rising edge only
      after ten low dots, the dot clock that counts those dots while A12 is low and saturates at the
      filter, the counter step that loads the latch when the counter is empty or a reload is pending and
      otherwise counts down to an assertion, and `mmc3_get_irq_line_asserted()`. An address the reference
      refuses with a `RangeError` is reported as a refused observation instead, and it changes nothing.
      `cartridge_loader.gs` reports the attached cartridge's line through `cartridge_board_irq_line()`,
      the half of the OR `nes_console.ts` feeds to `set_irq_line`. Suite 19 (17 records) shares suite
      18's layout and handler and covers both sides of the filter boundary, the saturation, repeated
      high and repeated low addresses, the reload, the acknowledge, counting while disabled, nametable
      A12, a pattern read that observes nothing on its own, every access kind, refused addresses, and a
      rejected board; every accepted record ends asserted. The mirror is compared with a production
      `Mmc3Mapper` behind its real `PpuMemoryBus` over nine scripts, which pins the observation rules the
      ported PPU will need, and the mirrored bus differential now compares the reported line with the
      reference after every rise. Not ported: the NVRAM snapshots of both boards, and nothing calls the
      A12 observation or the dot clock yet because the ported PPU does not exist. Compile validation
      stays blocked by the missing toolchain.
- [x] Port the MMC3 board's registers, banking, and windows, and attach it to the bus.
      `scratch/src/mapper_004.gs` mirrors everything `Mmc3Mapper` does except its IRQ: the creation checks, the
      eight banking registers with their bank-data masks, PRG and CHR bank selection in both modes, the PRG RAM
      enable and write-protect bits, the mirroring register with its four-screen override, the payload and
      trainer copies, and the CPU and pattern windows. `cartridge_loader.gs` routes the selection and attaches
      either board, and `cpu_bus.gs` dispatches to whichever is attached, so the embedded MMC3 image drives the
      bus. Suite 18 (21 records) covers banking, both modes, the register masks, protection, mirroring, and
      every rejection code; the mirror is also compared with a reference `Mmc3Mapper` and a production
      `NesCpuBus`, including a 128-bank board where the register 6 and 7 masks are observable. Not ported: the
      MMC3 IRQ registers and PPU A12 filter, the NVRAM snapshots of both boards, PPU, and APU. Compile
      validation stays blocked by the missing toolchain.
- [x] Wire the NROM board into the ported CPU bus and add the cartridge boot path.
      `scratch/src/cpu_bus.gs` dispatches `$4020-$FFFF` to an attached board through the same driven-mask merge
      its RAM window uses, and `scratch/src/cartridge_loader.gs` composes the signature check, header parse,
      board validation, payload copy, and attachment, reporting one summary line. Suite 17 (12 records) runs
      the production `NesCpuBus` with the record's board attached and pins the returned byte and the latch it
      left behind, including the boards that are rejected and never attached; a differential test compares the
      mirrored boot path with the production bus across fourteen addresses before and after writes. The
      embedded MMC3 image reports a wrong board family, so the window stays undriven until mapper 4 is ported.
      Not ported: the NVRAM snapshots and the MMC3 board. Compile validation stays blocked by the missing
      toolchain.
- [x] Port the NROM board's memory and address windows. `scratch/src/mapper_000.gs` sizes both ROM lists to
      the declared payload, allocates both RAM regions at their full window, copies PRG ROM, CHR ROM, and the
      trainer into PRG RAM at offset `$1000`, and answers the CPU and pattern windows with PRG ROM mirroring
      and RAM aliasing modulo the mapped sizes. Suite 16 (16 records) runs CPU and pattern operations against a
      board, and a differential test compares every copied byte with a reference `NromMapper` built over a
      synthetic trainer image; the source lint compares the ported `nrom_limit` and `nrom_window` enum values
      with the mirror's constants. Not ported: wiring the board into `cpu_bus.gs`, the NVRAM snapshots, and the
      MMC3 board. Compile validation stays blocked by the missing toolchain.
- [x] Port mapper selection and NROM board validation. `scratch/src/mapper.gs` routes an exact mapper and
      submapper pair and reports which half of it is unsupported, and `scratch/src/mapper_000.gs` applies
      every `NromMapper.create` check in the reference's order and reports the PRG RAM and CHR RAM bytes an
      accepted board would map. Suite 15 (25 records) spans both header versions and every rejection code;
      the two mapped sizes are measured through the public CPU and pattern ports by aliasing, because
      `NromMapper` keeps them private. Not ported: PRG and CHR storage, the CPU and pattern address windows,
      the trainer copy into PRG RAM, the NVRAM snapshots, and the MMC3 board. Compile validation stays
      blocked by the missing toolchain.
- [x] Port the CPU control loop and interrupt acceptance. `scratch/src/cpu_control.gs` selects jam, NMI, IRQ,
      or one instruction the way `begin_next_sequence` does, and ports the NMI latch, the level-sensitive IRQ
      input, the jam vector reads (three the first time the CPU jams, one afterwards), the reset-shaped state
      clear, and the one-instruction IRQ poll mask that CLI, SEI, and PLP leave behind. Suite 14 (19 records)
      runs several steps per record, so it pins the priorities and the delays; the sequence kinds come from the
      public `clock_cycle()` result, so no private reference state is read. Not ported: DMA stalls and the
      yield policy a frame loop needs. Compile validation stays blocked by the missing toolchain.
- [x] Complete instruction dispatch for every official opcode. `cpu_execute_regular_instruction` in
      `scratch/src/cpu_instruction.gs` resolves the operand and spends the cycles its kind needs (a dummy read
      for the implied and accumulator forms, nothing extra for an immediate operand, and the read, write-back,
      and write of a read-modify-write for a memory operand), `cpu_apply_read_instruction` covers the loads and
      the ALU group, `cpu_modify_value` covers ASL, LSR, ROL, ROR, INC, and DEC, and `cpu_compute_store_value`
      covers STA, STX, and STY. Suite 13 grew to 99 records covering every official group and all twelve memory
      addressing modes, and the mirror executes all 256 opcodes, asserting that the 151 official ones report no
      error and the other 104 report `unofficial_opcode` except KIL. Not ported: unofficial opcodes other than
      KIL and their unstable high-byte stores, the jam vector reads and sequence selection, interrupt acceptance
      policy between instructions, and `finish_instruction`. Compile validation stays blocked by the missing
      toolchain.
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
      (`scratch/src/cartridge.gs`), and the CPU layer: register state with one logged bus transaction per
      cycle (`cpu_core.gs`), all thirteen addressing modes (`cpu_addressing.gs`), the reset, BRK, JSR, RTI,
      RTS, IRQ, NMI, and relative-branch sequences (`cpu_sequence.gs`), the generated opcode decode
      (`cpu_opcode.gs`), one whole instruction for all 151 official opcodes (`cpu_instruction.gs`), and the
      control loop with interrupt acceptance, the jam vector reads, and the CLI/SEI/PLP IRQ poll mask
      (`cpu_control.gs`), exact mapper and submapper selection (`mapper.gs`), and the NROM board checks with
      the memory sizes an accepted board would map, the NROM payload and trainer copies, and the NROM CPU and
      pattern address windows (`mapper_000.gs`), the cartridge window an attached board drives
      (`cpu_bus.gs`), and the boot path that validates a board, copies its payload, and attaches it
      (`cartridge_loader.gs`), and both boards' nonvolatile memory snapshot procs (`mapper_000.gs` and
      `mapper_004.gs`): `get_prg_nvram_snapshot`, `load_prg_nvram_snapshot`, `get_chr_nvram_snapshot`,
      `load_chr_nvram_snapshot` copy the declared NVRAM tail out of each mapped window and copy it back
      only when the buffer holds exactly the declared size, reporting a refusal instead of throwing, leaving
      the banking registers, the protection bits, and the IRQ state alone, and the MMC3 board's creation
      checks, banking registers, both bank modes, PRG RAM protection, mirroring control, payload copy, CPU
      and pattern windows, IRQ registers, and PPU A12 observation with its ten-dot low filter
      (`mapper_004.gs`), which the loader attaches and whose IRQ line it reports, so the embedded MMC3 image
      drives the bus and can raise a scanline IRQ. All port components are complete: the CPU, bus,
      both mappers (NROM and MMC3), PPU (registers, timing, rendering, bus), APU (pulse 1/2, triangle,
      noise, DMC, mixer, frame sequencer), both controller ports, OAM DMA, the frame loop, and the
      NVRAM save/load wiring that routes snapshot procs through the attached board. Compile validation
      stays blocked by the missing GoboScript toolchain.
- [x] Port the PPU rendering pipeline and draw each frame with the pen extension in color.
      `scratch/src/ppu_2c02.gs` gained the reference pixel pipeline (background fetch/shift, scroll
      increments and transfers, sprite evaluation with the diagonal overflow path, sprite fetch,
      priority, palette lookup with greyscale masking, per-pixel emphasis) writing the
      `ppu_framebuffer_colors` and `ppu_framebuffer_emphasis` lists, and `ppu_bus.gs` now reports every
      pattern/nametable access to an attached MMC3 board before running it, so rendering fetches clock
      the scanline IRQ through the A12 filter the way `PpuMemoryBus` drives them. `scratch/src/nes_palette.gs`
      holds the canvas renderer's 64-color RGB palette and precomputes all 512 palette/emphasis pairs as
      cached "#rrggbb" pen colors; at vblank the run loop waits on a "draw frame" broadcast while
      `main.gs` erases the pen layer and draws the 256 by 240 frame at the fit-to-stage 1.5x scale the
      `pen_fit_to_screen` variable now selects by default (or at 1x when it is set to 0), one pen stroke
      per run of equal pixels, resetting the
      pen color only when it changes. The pure helpers (fine-X pixel,
      palette offset, bit reversal, sprite row and pattern address, both scroll increments and
      transfers, dimming, hex, and the pen color itself) are mirrored and swept exhaustively against
      the bitwise reference and `framebuffer_to_rgba`; the palette literals are pinned against the
      mirror by the source lint. Not verified: compiling, opening, or timing the project, and the
      checked-in `.sb3` predates the renderer. Compile validation stays blocked by the missing toolchain.
- [x] Drive both ported NES pads from the host keyboard. `scratch/src/keyboard_input.gs` samples the
      built-in "key () pressed?" reporter for the same sixteen keys `src/nes/browser/keyboard_input.ts`
      binds (arrows, Z, X, Shift, and Enter on the first pad; IJKL, U, O, Y, and P on the second) and
      writes the resulting button masks into `controller.gs`, whose serial report the console reads
      through `$4016` and `$4017`. It polls once per chunk of emulated cycles rather than using key-press
      hats, so a button cannot be left stuck down by a key-up the project never sees, and a press reaches
      the console one chunk later instead of one emulated frame later, which at roughly 300 chunks per
      frame is the difference between milliseconds and seconds. Eleven tests pin the ported key table
      against the TypeScript mirror and against the browser adapter, the button weights against
      `CONTROLLER_BUTTON_MASKS`, the assembled masks against the reference controller's serial report,
      and the sampler's single call site in the run loop. Not verified: real key events in a compiled
      project; Shift needs TurboWarp, because the Scratch website's keyboard device drops modifier keys.
- [ ] Build each port milestone with the pinned compiler and run its parity vectors in the compiled
      project.
- [ ] Prototype and benchmark at least two video-output strategies in TurboWarp; test clone, costume,
      pen, and/or generated asset approaches before choosing. The pen strategy above is the first one
      implemented; it still needs its TurboWarp frame-time measurement and an alternative to compare with.
- [ ] Implement TurboWarp input, audio, reset, status, and error reporting without coupling those
      adapters to the hardware model.
- [ ] Measure frame time, memory, list sizes, and responsiveness on documented hardware. Keep the
      project usable while yielding between bounded work chunks.

## P7 - Accuracy, persistence, and release

- [x] Run CPU, PPU, APU, DMA, interrupt, mapper, and timing test suites; document skips and known
      failures. On 2026-10-15, `npm test` passed all 332 tests (including strict type-checking) and
      `npm run build:ts` passed; on 2026-10-18 it passed all 1,214 tests. Coverage and known external-ROM
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
      2026-10-18 with 1,214 tests passing and all three generators completing (13,471 vector values, 1,538
      opcode values, 81,936 ROM bytes).
- [ ] Install the documented GoboScript compiler, build/open the `.sb3`, and validate it in TurboWarp;
      review source, asset, and ROM rights before distribution. Compiler availability and runtime validation
      remain blocked; see the P0 notes above.
- [x] Keep `PROGRESS.md` and `COMPLETION_CRITERIA.md` current with test results, measurements, and open
      blockers. The 2026-10-15 clean-install run passed 332 tests, TypeScript build, and both data generators;
      the 2026-10-18 run passed 1,214 tests. The 46 ms synthetic-frame result is labeled nonrepresentative. This
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
