# Completion criteria

This document defines the evidence required before calling the project a full NES emulator on
TurboWarp/Scratch. A successful TypeScript build, a valid `.sb3`, or one booting ROM is not sufficient on
its own.

## 1. Declared compatibility target

- [x] State the supported console regions and timing modes. NTSC is the initial target; PAL/Dendy
      support is not implied. See `docs/SUPPORTED_FEATURES.md`.
- [x] Publish the current mapper/submapper and expansion-hardware scope in the project docs: mapper
      0/submapper 0 and mapper 4/submapper 0 are implemented; future expansion-audio support is required
      alongside every supported mapper board that uses it. Four Score/Zapper are deferred for the full NES
      target, and Famicom-only devices are outside the current NES target.
- [x] State the supported iNES 1.0/NES 2.0 formats, 32 MiB total-image limit, and browser/build-time ROM
      selection in `docs/SUPPORTED_FEATURES.md`.
- [x] Never silently treat an unsupported mapper as NROM or claim that every commercial ROM works.
      Unsupported mapper/submapper routes return explicit errors; compatibility scope is published in
      `docs/SUPPORTED_FEATURES.md`.

## 2. Cartridge and CPU

- [ ] Parse the declared iNES/NES 2.0 subset with explicit validation for malformed headers, trainer
      offsets, and image lengths.
- [ ] Implement all official Ricoh 2A03 instructions, address modes, reset behavior, stack semantics,
      interrupts, DMA interaction, and tested cycle behavior.
- [x] Document unofficial-opcode policy and all 105 unofficial encodings: stable NOP/ALU/load-store/RMW
      groups, KIL/JAM, XAA/LXA approximations, and the five high-byte stores. A DMC stall on the indexed
      dummy read drops the store-data mask but preserves page-cross address corruption; other RDY/chip effects
      and hardware validation remain open. XAA/LXA analog variation and KIL/JAM bus cycles are also
      unverified. Opcode coverage does not claim hardware-accurate behavior.
- [ ] Pass the selected CPU instruction, interrupt, addressing, and DMA test suites, with every
      exception documented. Evidence so far: 1,026 pinned MIT single-step vectors covering all 256 opcode
      bytes pass as 257 grouped tests, the complete upstream corpus (2,560,000 scenarios) passes through the
      opt-in runner, the first 5,003 `nestest` trace entries match, and the interrupt/addressing/DMA unit
      suites pass. Still missing: a licensed CPU test-ROM suite, so the box stays unchecked.
- [ ] Run supported cartridges through tested mapper code, including mapper 4 for the supplied
      fixture.

## 3. PPU and graphics

- [ ] Implement the PPU register and memory side effects required by the accuracy target.
- [ ] Implement frame/scanline/dot timing, vblank/NMI, background and sprite rendering, priority,
      scrolling, sprite limits/overflow behavior, and palette output to the documented target.
- [ ] Produce a deterministic 256 by 240 frame and pass selected PPU/timing tests.
- [ ] Document any visual or timing deviations and ensure they do not break the advertised
      compatibility set.

## 4. APU, controllers, and persistence

- [ ] Implement pulse, triangle, noise, frame counter, and DMC behavior required by the target. Add
      expansion audio with each supported mapper board that requires it; publish the per-mapper capabilities.
- [ ] Produce stable audio output in the target runtime and pass selected APU tests.
- [x] Implement standard controller serial behavior and test every button, strobe, and repeated read
      behavior. `NesControllerPorts` passes two-port order/latch/open-bus tests, and pinned MIT SquarePlayer
      and NoisePlayer ROMs pass headless Up/Down-to-APU-samples smoke tests. TypeScript browser keyboard mapping
      covers both pads with unit tests; hands-on browser/TurboWarp input and audible playback validation remain
      outstanding.
- [ ] Implement and validate Four Score and Zapper support before claiming full NES compatibility. Zapper
      behavior depends on integrated PPU sensor/timing output.
- [x] Define Famicom-only expansion-port devices as outside the NES compatibility target unless project
      scope is explicitly broadened.
- [x] Define reset and save behavior. Browser battery persistence stores declared PRG/CHR NVRAM per exact
      ROM SHA-256; restore checks both sizes before mutation and excludes volatile RAM. TurboWarp storage and
      complete console save states are explicitly unimplemented and not advertised. See `docs/SUPPORTED_FEATURES.md`.

## 5. TypeScript reference quality

- [ ] Keep emulator hardware logic host-independent and deterministic.
- [x] Run strict type-checking and automated unit/integration tests from a clean npm install: `npm ci`,
      `npm test` (332 passing tests), and `npm run build:ts` passed on 2026-10-15.
- [ ] Validate subsystem behavior with independent, appropriately licensed test ROMs and/or reference
      traces.
- [x] Identify the supplied `test_rom.nes` with high confidence as an MMC3 conversion of Japanese
      *Super Mario Bros. 2*, record its hash/environment, and document its bounded frame-43 title-screen boot.
      Exact dump provenance and redistribution rights remain unknown; see `docs/TESTING.md`.

## 6. GoboScript and runtime quality

Every item below is blocked by the same cause: the pinned GoboScript compiler needs Cargo and rustc, no
official binary or npm package is obtainable in this environment, so `scratch/` has never been built and no
`.sb3` exists. The ported sources are written and validated indirectly, which is recorded here so the block is
not mistaken for missing work.

- [ ] Pin and record the GoboScript compiler and standard library versions used for the release.
      `scratch/goboscript.toml` pins `std = "2.1.0"`; the researched upstream source snapshot is 3.3.0 and the
      latest tagged release found was v3.2.1. The version actually used for a release cannot be recorded until
      a toolchain is installed.
- [ ] Build the Scratch project from source using documented commands, including generated ROM
      data/assets. Both generators run and are byte-checked (`npm run scratch:assets`,
      `npm run scratch:vectors`); `goboscript build` itself has never run.
- [ ] Run the same shared vectors through TypeScript and GoboScript for every ported subsystem.
      The TypeScript side runs all 350 records. The GoboScript side is written
      (`scratch/src/vector_selftest.gs` replays suites 1, 3, 7, 8, 9, 10, and 11 and counts the rest as skipped) but has
      never executed. Substitute evidence: an integer-only TypeScript mirror of every ported helper is
      compared exhaustively with the bitwise reference and replayed through the same fixture
      (`tests/goboscript-port-algorithms.test.ts`), and the sources are lint-checked against the upstream
      grammar and codegen constraints (`tests/goboscript-source.test.ts`).
- [ ] Open the `.sb3` in the declared runtime and verify boot/reset, input, rendering, and audio.
- [ ] Confirm that no required code depends on an undocumented Scratch extension. Test Scratch website
      compatibility separately if it is claimed. The ported sources use only core blocks, no pen/music/sensing
      extensions, but that has not been confirmed against compiled output.
- [ ] Demonstrate that the application remains responsive under normal play and malformed/unsupported
      inputs. The current project does not emulate frames, and the self test is one run-without-screen-refresh
      walk whose duration is unmeasured.

## 7. Performance, usability, and release evidence

- [ ] Record runtime/browser version, hardware, ROM, scene, duration, frame time, skipped frames, and
      audio/video settings for performance results.
- [ ] Meet the documented performance target for representative supported games. Targeting 60 frames
      per second in TurboWarp is the initial goal; any lower result must be explicit and cannot be
      described as full-speed emulation. TurboWarp/target-device performance is currently unmeasured; the
      no-speed-claim limitation is documented in `SUPPORTED_FEATURES.md` and `TESTING.md`.
- [x] Document controls, ROM deployment, current audio setting, saves, mapper coverage, known inaccuracies,
      and runtime/build status in `docs/SUPPORTED_FEATURES.md`.
- [ ] Review code licenses, asset licenses, ROM rights, and required attribution before distributing
      the `.sb3` or test fixtures.

## Completion reporting

As of 2026-10-18, the evidence is recorded in `docs/PROGRESS.md` and `docs/TESTING.md`: 973 tests passed
(including 1,026 pinned CPU corpus vectors as 257 grouped tests, 350 shared port-vector records, 50
GoboScript port-algorithm comparisons, and 16 GoboScript source-lint checks), `npm run build:ts` and both data
generators passed, the opt-in runner matched all 2,560,000 upstream corpus scenarios, and the 46 ms
synthetic-frame smoke measurement from 2026-10-15 (332 tests then) is still explicitly labeled
nonrepresentative. This is an interim status report, not a completion claim; the unchecked compatibility,
licensed-ROM, GoboScript, TurboWarp, performance, and release criteria remain open.

When all applicable criteria are met, update this checklist with links to test logs, test ROM results,
runtime measurements, supported hardware, and known limitations. If an item is out of scope, say so plainly
and narrow the advertised compatibility statement rather than leaving an ambiguous claim of full support.
