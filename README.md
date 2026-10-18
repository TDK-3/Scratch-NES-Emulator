# Scratch NES Emulator

A NES emulator project with a testable TypeScript reference implementation and a GoboScript port that
compiles to a Scratch project for TurboWarp (and, where performance allows, Scratch).

The TypeScript implementation is the source of truth for behavior. Emulator logic will be developed and
tested in TypeScript first, then reimplemented in GoboScript against shared test vectors. GoboScript does
not compile TypeScript directly.

## Current status

This is an early emulator implementation, not a complete or broadly compatible NES emulator.
See [`docs/SUPPORTED_FEATURES.md`](docs/SUPPORTED_FEATURES.md) for the current region, mapper, controls, ROM
loading, persistence, and known-limitations statement.

- The iNES 1.0 and NES 2.0 parser is implemented and tested.
- Mapper selection explicitly supports mapper 0/submapper 0 (`NromMapper`) and mapper 4/submapper 0
  (`Mmc3Mapper`); unsupported mapper/submapper routes and layouts return structured errors. MMC3 implements
  PRG/CHR banking, mirroring, PRG-RAM protection, and filtered A12 IRQ counting.
- `NesConsole` composes CPU, PPU, APU, buses, either supported mapper, and two standard pads. `NtscClock`
  uses an integer 21,477,272 Hz master-clock divider (CPU/APU every 12 ticks; PPU every 4). The console
  exposes reset, pause/resume, cycle and sequence stepping, controller state, and bounded frame output; it
  routes PPU NMI edges and APU/MMC3 IRQ levels to the CPU. Synthetic tests cover both mapper routes, controller
  reads through a ROM program, APU samples, NMI/IRQ delivery, and frame advancement. It exports/restores
  mapper-declared PRG and CHR NVRAM snapshots while excluding volatile RAM; the browser shell stores both
  regions per exact ROM image in local storage and accepts earlier PRG-only saves. TurboWarp persistence and
  full console save states are not implemented yet.
- `Apu2A03` implements pulse, triangle, noise, and DMC channels, `$4000-$4013`/`$4015` registers, `$4017`
  frame sequencing, DMC sample-buffer fetch requests/IRQ, and nonlinear pulse+TND mixing. It produces
  deterministic mono `Float32Array` samples at an integer rate from 1 Hz through the NTSC CPU rate (44.1 kHz
  default); the CPU bus performs DMC reads and arbitrates them against OAM DMA. The browser preview includes a
  Web Audio sink and an approximate browser-output filter; hands-on browser/audio-device validation remains open.
- `NesControllerPorts` implements two standard serial pads at `$4016/$4017`, including strobe/latch behavior,
  NES button order, trailing 1 reads, and D0-only drive for CPU open-bus merging. Four Score and Zapper remain
  planned for full NES support but are deferred. Mapper expansion audio will be added alongside each supported
  mapper that requires it; Famicom-only devices are outside the current NES target. Browser keyboard mapping
  is an adapter in `src/nes/browser/`; TurboWarp input remains unimplemented.
- `Cpu2A03.clock_cycle()` exposes one bus transaction per CPU cycle for all 151 official and 105 unofficial
  opcode encodings; the table covers all 256 byte values. Implemented groups include stable NOP/ALU/load-store/
  RMW families, LAS, 12 KIL/JAM forms, configurable XAA/LXA approximations (default magic value `$EE`), and
  all five unstable high-byte stores (AHX, SHX, SHY, TAS). They use deterministic masking and page-cross
  behavior; a DMC stall on the pre-write dummy read drops the data mask but retains address corruption. Other
  chip-dependent behavior remains unverified. The core also sequences reset, IRQ/NMI service,
  OAM DMA, and DMC stalls; `step()` remains a convenience wrapper. IRQ is level-sensitive and NMI is latched.
  Opcode coverage is not a claim of hardware-accurate behavior for analog/DMA-sensitive instructions.
- The supplied `test_rom.nes` is an MMC3 cartridge conversion of the Japanese *Super Mario Bros. 2* (the
  Lost Levels), with 64 KiB PRG, 16 KiB CHR, vertical mirroring, and battery-backed RAM. `NesConsole` reaches
  the title screen in a bounded 43-frame run; a pixel-signature boot test guards the result. Exact dump
  provenance and redistribution rights remain unknown, and a title-screen boot is not a compatibility claim.
  See [`docs/TESTING.md`](docs/TESTING.md) for the binary hash, evidence, and test result.
- The GoboScript project statically embeds one selected ROM as a decimal list (default: `test_rom.nes`),
  checks its iNES signature, and ports the helper layer: bit-free numeric and status helpers, thirteen ALU
  operations, both serial controller ports, a CPU-bus subset with RAM mirroring, the open-bus latch, and a
  cartridge window an attached board drives, iNES/NES 2.0 cartridge header parsing with numeric error codes,
  plus CPU register state, logged bus
  cycles, stack operations, all thirteen addressing modes, the reset, BRK, JSR, RTI, RTS, IRQ, NMI, and
  relative-branch cycle sequences, the generated opcode decode, one whole instruction for all 151 official
  opcodes, the control loop that selects jam, NMI, IRQ, or an instruction, including the jam vector reads
  and the one-instruction IRQ poll mask CLI, SEI, and PLP leave behind, exact mapper and submapper selection,
  the NROM board checks with the memory sizes an accepted board would map, the NROM memory windows with
  the payload copy, the trainer at PRG RAM offset `$1000`, PRG ROM mirroring, and the writable PRG RAM and CHR
  RAM regions, and a boot path that validates a board, copies its payload, and attaches it to the bus. The
  embedded default image is MMC3, and the loader attaches it: its creation checks, banking registers, both
  bank modes, the PRG RAM protect bits, the mirroring control, and the CPU and pattern windows are ported,
  while its IRQ registers, PPU A12 filter, and NVRAM snapshots are not.
  Its Stage runs a self test over the 562 generated parity vectors and reports a summary; the CPU state,
  mapper, PPU, and APU suites are counted as skipped. It does not emulate games, and none of its sources have
  been compiled, because the pinned GoboScript toolchain needs Cargo and rustc. The ported arithmetic is
  validated instead by an integer-only TypeScript mirror compared exhaustively with the reference, plus a
  source lint for grammar shape and reserved names.
- `PpuMemoryBus` routes mapper-backed pattern memory, mirrored nametable RAM, palette aliases and six-bit
  writes, and separate primary OAM storage. `Ppu2C02` implements CPU register behavior and deterministic
  NTSC dot timing: 341 dots across 262 scanlines, three PPU dots per CPU cycle, vblank/status timing, the
  conditional odd-frame dot skip, and a consumable NMI rising-edge latch. Its baseline renderer produces a
  256 by 240 palette-index framebuffer with background, scrolling, sprites, priority, sprite-zero hit,
  greyscale, and a separate emphasis plane. OAMADDR is forced to zero during dots 257-320 of pre-render and
  visible scanlines, and OAMDATA writes during rendering are ignored. A diagonal OAM-byte sprite-overflow
  false-positive path has unit coverage, but cycle timing, evaluation start at dot 65, glitchy OAMADDR
  increments, 2C02G OAM corruption, other render-time register races, and open-bus decay remain approximations
  or documented gaps.
- A browser preview is available with `npm run browser:dev`. It includes a pixel-preserving 256 by 240 canvas,
  file and bundled-ROM loading, pause/reset/step controls, two keyboard-mapped pads, per-ROM PRG/CHR-NVRAM saves,
  and a best-effort Web Audio sink with an approximate filter. The palette is an approximation; browser
  rendering, audio, and storage have not had hands-on validation. The Scratch/TurboWarp scaffold does not yet
  emulate games. Two pinned MIT APU player ROMs
  pass headless pulse/noise controller-to-sample smoke tests; other licensed suites and actual target-runtime
  input/audio tests remain open.
  See [`docs/TESTING.md`](docs/TESTING.md).
- `docs/PROGRESS.md` is the detailed status record; `docs/TODO.md` is the work queue.

## Quick start

Requires Node.js 22 or newer and npm.

```bash
npm install
npm test
npm run build:ts
npm run browser:dev
```

Open the local URL printed by the server (port 4173); Arena exposes it as a live preview. Use the bundled
MIT APU smoke ROM to exercise controller-to-sample output, or choose an iNES ROM with the file picker. After
loading a ROM, click Run; focus moves to the canvas so the documented pad keys control the game.

`npm test` type-checks the strict TypeScript project and runs the Node test suite. Tests cover ROM parsing,
CPU register/ALU behavior, reset and stack state, all 13 addressing modes, all official opcodes, IRQ/NMI
entry, cycle-by-cycle CPU stepping, CPU-bus routing and OAM/DMC DMA, standard controller serial input,
NROM/MMC3 cartridge mapping and IRQ filtering, pulse/triangle/noise/DMC channels, deterministic APU
sample-rate/channel output, register/frame-sequencer/mixer behavior, PPU register/memory, NTSC timing and pixel
output, pinned MIT SquarePlayer and NoisePlayer controller-to-APU smoke tests, browser keyboard mapping,
Web Audio filtering and sink scheduling, canvas conversion/scaling and frame scheduling,
optional instruction-level traces, byte-exact build-time Scratch ROM asset generation with source-overwrite
protection, a 562-record shared TypeScript/GoboScript port-vector set spanning numeric, CPU, bus, mapper, PPU,
APU, controller, ALU, cartridge-header, CPU addressing, CPU cycle-sequence, opcode-decode, instruction,
control-loop, NROM board-validation, NROM memory-window, and cartridge-bus behavior, and 1,026 selected
MIT-licensed NES
2A03 reference vectors
covering all 256 opcode bytes. The respective fixture details are documented in
[`docs/GOBOSCRIPT_PORT_VECTORS.md`](docs/GOBOSCRIPT_PORT_VECTORS.md) and
[`tests/fixtures/nes6502/README.md`](tests/fixtures/nes6502/README.md).

`Cpu2A03.clock_cycle()` exposes one CPU bus access at a time; `step()` runs a full instruction/interrupt as
a convenience. This is cycle-visible execution, not a claim of full timing accuracy. The pinned MIT APU
smoke ROM boots and responds to input in a headless console test; this does not establish general ROM
compatibility, licensed-suite conformance, or device-level interrupt timing.

## Build the Scratch/TurboWarp scaffold

Install GoboScript using its official instructions, then run:

```bash
npm run build:scratch
```

The default command converts `test_rom.nes` into a generated text list at
`scratch/data/test_rom_bytes.txt`, generates the shared port-vector list at
`scratch/data/shared_port_vectors.txt`, then runs `goboscript build` in `scratch/`. For a different ROM,
generate both inputs and build manually:

```bash
npm run scratch:assets -- --rom /path/to/your-rom.nes
npm run scratch:vectors
cd scratch && goboscript build
```

The generated lists and `.sb3` output are ignored by Git. Each compiled project embeds one fixed ROM; standard
Scratch/TurboWarp does not get an arbitrary runtime binary loader in this plan. Review ROM rights before
sharing a generated project. The resulting default project is `scratch/scratch.sb3`.

The current GoboScript project ports the numeric, status, ALU, controller, and CPU-bus helper layer and runs
a shared port-vector self test on the green flag; the display sprite reports the summary. It is an integration
scaffold, not an emulator, and it has never been compiled: no `.sb3` has been produced or opened in TurboWarp.
See [`docs/PORTING_PLAN.md`](docs/PORTING_PLAN.md) for the module-by-module port state.

## Documentation

- [LLM context](docs/LLM_CONTEXT.md) - repository facts and instructions for future coding agents.
- [GoboScript research](docs/GOBOSCRIPT_RESEARCH.md) - researched language, compiler, project, and
  TurboWarp workflow.
- [Shared GoboScript port vectors](docs/GOBOSCRIPT_PORT_VECTORS.md) - portable record format and initial
  parity coverage across emulator subsystems.
- [Architecture](docs/ARCHITECTURE.md) - proposed hardware boundaries and design decisions.
- [Porting plan](docs/PORTING_PLAN.md) - TypeScript-to-GoboScript workflow and semantic differences.
- [Project structure](docs/PROJECT_STRUCTURE.md) - current files and target layout.
- [Testing strategy](docs/TESTING.md) - unit, integration, and ROM-based validation.
- [Progress](docs/PROGRESS.md), [todo](docs/TODO.md), and [completion
criteria](docs/COMPLETION_CRITERIA.md).
- [Contributor and agent rules](AGENTS.md) - relevant coding style and repository rules.
- [Continuation prompt](PROMPT.md) - current project state and guidance for the next work session.

## ROM fixture

`test_rom.nes` is a fixture supplied with this repository, identified from its title screen and ROM markers as
an MMC3 conversion of the Japanese *Super Mario Bros. 2*. Its exact source/version and redistribution terms
have not been established. Do not add other copyrighted game ROMs or redistribute this fixture without
verifying the applicable rights.
