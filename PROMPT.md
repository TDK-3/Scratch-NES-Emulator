# Continuation prompt: Scratch NES Emulator

Updated 2026-10-15.

You are continuing `TDK-3/Scratch-NES-Emulator`, whose goal is a full NTSC NES emulator that runs in Scratch/TurboWarp. TypeScript under `src/` is the tested behavioral reference; `scratch/` is a separate GoboScript implementation target, not a TypeScript transpilation. Keep working continuously, one bounded task at a time; do not ask the user what to do next. Prefer feasible, high-value tasks and skip work that is blocked or too large to complete safely.

## Non-negotiable project rules

- Read `AGENTS.md`, `docs/LLM_CONTEXT.md`, `docs/TODO.md`, `docs/PROGRESS.md`, and the relevant subsystem/testing docs before making architectural changes.
- Implement and test behavior in TypeScript before porting it to GoboScript. Do not claim the GoboScript project compiles or runs until the pinned compiler and TurboWarp/Scratch runtime have actually been tested.
- Use the supplied `test_rom.nes` as requested, but do not modify it. Its exact dump provenance and redistribution rights remain unknown; do not redistribute or embed it in a release without a rights review.
- Do not vendor test ROMs with unclear licenses. Current PPU/mapper exploratory ROM results are documented but are not conformance evidence.
- Keep any additional comprehensive unofficial-opcode work deferred to the final TODO task; preserve official-opcode behavior. Full hardware parity, cycle accuracy, and broad game compatibility are not established.
- For GoboScript upstream research, inspect the clone and docs under `/tmp/goboscript-research`, not the project root.
- Keep tests deterministic, fast, and bounded. `npm test` gives every test a 10-second timeout. Test helpers that spawn processes must clean them up.
- Keep generated `dist/`, `node_modules/`, `scratch/data/*.txt`, `.sb3` files, and temporary datasets out of Git.
- Update documentation and the test totals when behavior or test coverage changes.

## Current implementation snapshot

The TypeScript path includes an iNES/NES 2.0 parser; explicit mapper routes for NROM (mapper 0/submapper 0) and MMC3 (mapper 4/submapper 0); a cycle-visible Ricoh 2A03 CPU with all official and unofficial opcode bytes classified; CPU-bus OAM/DMC DMA; CPU/PPU/APU/controller integration; NTSC scheduling; baseline PPU rendering; deterministic APU sampling; a headless console; and a TypeScript browser shell with canvas, keyboard, Web Audio, and battery-RAM adapters.

The five unstable high-byte stores (`$93/$9F` AHX, `$9B` TAS, `$9C` SHY, `$9E` SHX) use masked page-cross destination behavior. Synthetic and production-bus tests cover a DMC stall on their indexed dummy read: the store-data mask drops while page-cross address corruption remains. A real `Apu2A03` request is also tested through `NesCpuBus` and `Cpu2A03`. Other RDY/chip effects and hardware validation remain open.

Twenty MIT SingleStepTests vectors are pinned at commit `2f6980a2d95757486c7bee24355c360e40e2a224`; ten include crossing and non-crossing cases for the five unstable stores. The fixture README records source indices, source hashes, license, and selected-fixture hash.

The PPU models dot-1 vblank start and, in the current deterministic model, suppresses that event if PPUSTATUS is read at scanline 241, dot 0 or 1 before dot 1 is processed. Unit tests cover both window endpoints, the normal vblank/NMI path, and reset during the suppression window. This rule has not been validated on hardware or with a licensed timing ROM.

A pinned MIT SquarePlayer APU ROM is exercised through the browser keyboard adapter and console into APU samples; the pinned MIT NoisePlayer test still uses direct controller state. This is headless testing, not actual browser DOM input, audible Web Audio, or APU conformance. The HTTP server test checks shell/assets, exact bundled ROM bytes, HEAD/unsupported methods, lexical traversal and symlink-escape rejection; it is not a headless browser test.

## Known limits and blocked work

- GoboScript has only an initial scaffold/data loader. At the last investigation, Rust, Cargo, and `goboscript` were absent; npm has no `goboscript` package. The researched source snapshot is v3.3.0, while the reachable older prebuilt release was v3.2.1 and its release-asset download was blocked. Do not treat the older binary as validation of the pinned source. Revisit compiler provisioning only if the environment or official release access changes.
- No compiled `.sb3` has been opened in TurboWarp or Scratch. TurboWarp-specific input/audio/rendering and target-device performance are unvalidated.
- PPU sprite evaluation is aggregated, not dot-by-dot. Open issues include sprite-overflow accuracy, rendering-time register behavior, PPU I/O bus decay, reset write suppression, exact pixel timing, and CPU/PPU phase races. Exploratory unlicensed PPU ROMs show sprite-hit cases passing, all selected sprite-overflow cases failing, MMC3 scanline IRQ case 4 failing, and a vblank-clear timing case varying with scheduling; see `docs/TESTING.md`.
- The supported mapper set is only NROM and MMC3. Mapper expansion audio is required alongside any future mapper that needs it. Four Score and Zapper are deferred but planned; Famicom-only expansion-port devices are outside the current NES target.
- `test_rom.nes` reaches a bounded Japanese SMB2 title-screen signature in TypeScript, but exact dump rights remain unknown and gameplay/general compatibility are not established.
- No hardware-level DMC, CPU interrupt-edge, PPU timing, or real-audio-device validation is established.

## How to validate changes

Last clean validation on 2026-10-15: `npm ci` reported zero vulnerabilities; `npm test` passed 332/332; the
TypeScript build and both GoboScript data generators passed. The browser server test includes a symlink-escape
regression, and the ROM/vector generators reject direct, symlink, and hard-link aliases to their source files.

From the repository root, run:

```sh
npm ci
npm test
npm run build:ts
npm run scratch:assets
npm run scratch:vectors
```

`npm test` runs strict TypeScript checking and Node's built-in runner with per-test timeouts. The ROM asset generator must reconstruct `test_rom.nes` byte-for-byte. The shared-vector generator emits numeric GoboScript data from `tests/fixtures/goboscript/shared_port_vectors.json`. `npm run browser:dev` builds TypeScript and serves the preview on `0.0.0.0:4173`; use relative browser URLs, and do not claim real-browser/audio validation from Node tests alone.

## Suggested task order

1. Choose one scoped PPU or CPU/APU accuracy improvement from `docs/TODO.md`, using an independent, properly licensed reference where possible. Do not expand the PPUSTATUS race model without stronger timing evidence; its current deterministic rule is not hardware-validated. Avoid broad per-dot sprite-evaluation work unless it can be split into small, test-backed milestones.
2. Improve trusted reference coverage with pinned, licensed vectors or ROMs; record provenance and hashes and do not overstate subset results.
3. Revisit implementation blockers only when a bounded validation path is available; do not repeat investigations already recorded in the docs.
4. Revisit official GoboScript compiler provisioning only when the matching official toolchain is obtainable; otherwise keep porting/runtime work clearly blocked rather than adding unvalidated GoboScript.
5. Keep `docs/TODO.md`, `docs/PROGRESS.md`, `docs/TESTING.md`, `docs/SUPPORTED_FEATURES.md`, and this prompt aligned with verified behavior and results.
