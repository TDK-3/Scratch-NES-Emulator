# Supported Features and Known Limits

This page describes the current TypeScript/browser implementation, not a claim of full NES compatibility.
The Scratch/TurboWarp project is still a scaffold: it embeds ROM data, ports the numeric, status, ALU,
controller, and CPU-bus helper layer, and runs a shared port-vector self test, but it does not run NES games
and none of its sources have ever been compiled.
The current implementation targets an initial NTSC NES slice.

## Region, ROM formats, and mapper routes

- **Timing region:** NTSC only. PAL and Dendy timing are not implemented.
- **Parsed formats:** iNES 1.0 and NES 2.0 headers and payloads, including trainer offsets, mapper metadata,
  PRG/CHR ROM sizes, and volatile/nonvolatile RAM declarations.
- **TypeScript/browser ROM-image cap:** 32 MiB total, including the iNES header and optional trainer. The
  parser rejects oversized input buffers and NES 2.0 declarations whose required payload exceeds the limit, and it
  verifies that every declared PRG/CHR byte is present. The browser file picker checks `File.size` before
  reading the file into memory. This is a project resource limit, not a format limit; the supported mapper
  layouts below impose additional constraints.
- **Implemented mapper routes:** mapper 0/submapper 0 (NROM) and mapper 4/submapper 0 (MMC3). Every other
  mapper/submapper route, or an unsupported memory layout for these mappers, is rejected explicitly rather
  than treated as NROM.
- **NROM layout:** 16 or 32 KiB PRG ROM; up to 8 KiB total PRG RAM/NVRAM; either one 8 KiB CHR-ROM region or
  up to 8 KiB total CHR RAM/NVRAM. A trainer is accepted only with mapped PRG RAM.
- **MMC3 layout:** at least 32 KiB of PRG ROM in 8 KiB banks; up to 8 KiB total PRG RAM/NVRAM; CHR ROM or
  CHR RAM/NVRAM of at least 8 KiB in 1 KiB banks. A trainer is accepted only with mapped PRG RAM. The
  implementation handles the supported MMC3 banking, mirroring, PRG-RAM protection, and A12 IRQ-counter
  behavior; this is not a claim of compatibility with every MMC3 board or IRQ timing edge.

## CPU, PPU, audio, and controllers

- **CPU:** cycle-visible execution for all 151 official Ricoh 2A03 opcodes and all 105 unofficial byte
  encodings (the opcode table covers all 256 values): 27 stable NOPs, six immediate ALU forms, ten LAX/SAX
  forms, LAS (`$BB`), XAA/LXA approximations, 12 KIL/JAM opcodes, 42 composite memory read-modify-write forms,
  and AHX/SHX/SHY/TAS high-byte stores. Reset, IRQ/NMI, OAM DMA, and DMC stalls are sequenced. The five
  unstable high-byte stores use a deterministic model: their source (`X`, `Y`, or `A AND X`; TAS first
  sets SP to `A AND X`) is ANDed with the unindexed base high byte plus one, and that result supplies the
  destination high byte on page crossing. A DMC stall on the indexed dummy read before the write drops the
  data mask while retaining page-cross address corruption. Other RDY/chip effects are unmodeled, and this
  approximation is not hardware-validated. XAA/LXA use configurable deterministic magic input (default `$EE`);
  chip-dependent analog and DMA effects are not modeled. KIL/JAM halts until reset; repeated two-read jam cycles are an
  emulator convention, not hardware-verified. Opcode coverage is not a claim of full hardware accuracy.
- **PPU:** baseline NTSC register behavior, vblank/NMI (including PPUSTATUS suppression immediately before the
  scanline 241 dot-1 event), 341-dot scanlines, odd-frame shortening while
  rendering, background and sprite output, scrolling, priority, sprite-zero hit, palette indices, and color
  emphasis. The 256 by 240 host palette is an RGB approximation. Sprite evaluation is aggregated rather than
  dot-by-dot; PPU open-bus decay, register races, exact pixel-pipeline delay, sprite-overflow false positives/
  negatives, and some CPU/PPU phase behavior are not fully modeled. Two render-time register quirks are
  modeled: OAMADDR is forced to zero during dots 257-320 of pre-render and visible scanlines, and OAMDATA
  writes during rendering are ignored. Evaluation starting at dot 65, glitchy OAMADDR high-bit increments on
  suppressed OAMDATA writes, 2C02G OAM corruption on OAMADDR writes, and I/O latch decay are deliberately not
  modeled.
- **Audio:** native pulse, triangle, noise, and DMC channels with deterministic mono core samples. The
  TypeScript console uses a 44.1 kHz default. The browser applies a separate approximate output filter before
  Web Audio playback; neither the filter nor device playback is calibrated to an analog NES or validated
  across browsers. The initial supported mapper set does not require mapper expansion audio.
- **Controllers:** two standard serial NES pads. Four Score and Zapper are deferred but remain planned for full
  NES support. Famicom-only expansion-port devices are outside the target; other peripherals may be evaluated
  individually if needed.

## TypeScript browser preview

The browser shell can load a user-selected iNES ROM or either bundled image (`test_rom.nes` and the pinned MIT
APU smoke ROM). It provides Run, Pause, Reset, Step frame, and Step instruction controls, a 256 by 240 canvas,
two keyboard-mapped pads, an audio-output toggle, and status information. Starting emulation moves keyboard focus
to the canvas so pad input works after clicking Run; editable form controls keep their native keyboard behavior.
The scheduler advances at most one bounded console frame per animation callback. The Scratch/TurboWarp GoboScript
scaffold does not yet execute game frames, so no TurboWarp or target-device frame rate is claimed. The TypeScript preview has not been
benchmarked on target hardware. One synthetic frame took about 46 ms in this sandbox; this smoke timing is not
representative of a supported game or a performance guarantee.

| Pad | Directions | A | B | Select | Start |
| --- | --- | --- | --- | --- | --- |
| Player 1 | Arrow keys | Z | X | Shift | Enter |
| Player 2 | I / J / K / L (up / left / down / right) | U | O | Y | P |

Battery persistence is browser-only and stores mapper-declared PRG and CHR NVRAM, not volatile RAM or a full
console state. Records are keyed by SHA-256 of the exact ROM bytes. New records contain separate PRG and CHR
regions; earlier PRG-only records are still read with CHR NVRAM initialized to zero. The browser saves on pause,
stepping, ROM replacement, and page hide. Browser storage quota/availability failures are reported as status
warnings. TurboWarp persistence and full-console save/load states are not implemented or advertised.

## Scratch/TurboWarp ROM deployment

The GoboScript scaffold embeds one selected ROM at build time as a decimal list (`test_rom.nes` by default;
`--rom` selects another file). The project checks the iNES signature, parses the header, validates the board,
and copies and maps the NROM or MMC3 payload the header routes to. It has no ROM file picker, audio output,
NVRAM persistence, or console save states; changing the cartridge at runtime is the pasted-string path below.
A GoboScript compiler and successful `.sb3`/TurboWarp validation are still outstanding.

The image can also be replaced at runtime from a pasted string. Pressing Q while the run loop is running asks
for a string of decimal byte values, and `scratch/src/rom_input.gs` decodes it: any run of characters that is
not a decimal digit separates two values, so the text `scripts/generate_goboscript_rom_data.mjs` writes is
paste-ready. The decoded bytes are staged in their own list, and only an image that carries the iNES
signature and at least the payload its header declares replaces `cartridge_bytes`; the run loop then reboots
the console through the same boot path the embedded image uses, and the display sprite reports the outcome or
the reason the load was refused. An empty answer cancels and keeps the running game. Two limits are enforced
rather than silently truncated: a Scratch list holds 200,000 items, and the decode reads at most 1,000,000
characters. The format is defined by `src/nes/cartridge/rom_text.ts`, and `web/rom_string.html` (served at
`/rom_string.html` by `npm run browser:dev`) converts a .nes file into it, reports the iNES header, decodes
its own output as a check, and refuses to produce text the port could not load. A NES 2.0 header's bank
sizes are left to the loader's own header parse, so a NES 2.0 image is validated when it boots rather than
when it is pasted. Neither the paste path nor the converter has been exercised in a compiled project, because
no compiled project exists yet.

What the project does contain today: bit-free numeric and status helpers, thirteen ALU operations, both serial
controller ports, a CPU-bus subset (RAM mirroring, open-bus latch with driven masks, `$4016`/`$4017`, and a
cartridge window an attached board drives), iNES 1.0
and NES 2.0 cartridge header parsing (mapper and submapper, mirroring, battery, trainer, ROM and RAM sizes,
payload offsets, and six numeric error codes), CPU register state with one logged bus transaction per cycle,
fetch and stack operations, all thirteen addressing modes including dummy reads and the JMP indirect pointer
wrap, the reset, BRK, JSR, RTI, RTS, IRQ, NMI, and relative-branch cycle sequences, the generated opcode
decode, one whole instruction for all 151 official opcodes, the control loop that selects jam, NMI, IRQ, or an
instruction with the jam vector reads and the CLI/SEI/PLP IRQ poll mask, exact mapper and submapper selection,
the NROM board checks with the memory sizes an accepted board would map, the NROM payload and trainer copies,
the NROM CPU and pattern address windows with PRG ROM mirroring and aliasing RAM, and a boot path that
validates a board, copies its payload, and attaches it to the bus, both boards' nonvolatile memory snapshots
with their declared-size restore gate, the MMC3 board checks with both bank modes and the bank-data masks,
the MMC3 CPU and pattern windows, the MMC3 scanline IRQ with its four registers and the ten-dot A12 low
filter, and a Stage-run self test
that replays 587 shared vectors from
`scratch/data/shared_port_vectors.txt`, counting the CPU state and mapper-selection suites as
skipped. The green flag broadcasts a summary that the display sprite reports.
Those sources have never been through the compiler: the pinned toolchain needs Cargo and rustc, which are not
obtainable here. The compiled project was brought in line with the sources block by block instead, and it runs
headlessly: its self test reports `port vectors 582/582 passed, 5 skipped`, and its console boots the embedded
MMC3 image, reads the reset vector, and runs the game with a bus trace byte-identical to the TypeScript
reference's. The ported PPU now includes the rendering pipeline (background fetch/shift, scrolling, sprite
evaluation and fetch, priority, palette lookup with greyscale and emphasis), and the display sprite draws each
finished 256 by 240 frame with the Scratch pen extension in the same 64-color palette the canvas renderer
uses: the picture starts at the uniform 1.5x fit-the-stage scale, and setting the global `pen_fit_to_screen`
variable to 0 returns it to native 1x pixels. The port also reads the host keyboard with the built-in "key ()
pressed?" reporter and drives both pads from it, sampled once per chunk of emulated cycles: arrows, Z, X,
Shift, and Enter on the first pad, and IJKL, U, O, Y, and P on the second, the same bindings the table above
lists for the browser shell. Shift is a TurboWarp extension, because the Scratch website's keyboard device
drops modifier keys, so Select never presses there. That renderer and that sampler are in the `.gs` sources only: the checked-in `.sb3` predates them and still produces no
picture until the project is rebuilt with `npm run build:scratch`. The ported algorithms are also
validated by an integer-only TypeScript mirror compared
exhaustively with the bitwise reference and by a source lint that checks grammar shape, constructs that panic
upstream codegen, reserved block names, and name resolution. See
[`GOBOSCRIPT_PORT_VECTORS.md`](GOBOSCRIPT_PORT_VECTORS.md) and [`PORTING_PLAN.md`](PORTING_PLAN.md).

## Compatibility evidence and caveats

- `test_rom.nes` is an 81,936-byte mapper-4 SMB2J-family image of unknown exact revision and redistribution
  rights. The TypeScript console reaches a title-screen pixel signature at frame 43. This does not establish
  gameplay compatibility, exact dump provenance, permission to redistribute the ROM, or general MMC3 support.
- Two pinned MIT APU-player images pass bounded TypeScript Up/Down-to-sample smoke tests. They are not a
  full APU conformance suite or a test of real browser/device playback.
- The first 5,003 entries of an externally supplied `nestest` trace matched the documented PC, instruction
  bytes, registers, stack pointer, and cycle counts. That external ROM/log is not bundled. The historical trace
  stopped at `$04`, now implemented as an unofficial NOP; this trace has not been rerun since that change.
- The CPU cycle sequencer matches 1,026 pinned MIT single-step vectors covering all 256 opcode bytes, and the
  opt-in `npm run test:cpu-corpus` runner matched all 2,560,000 scenarios of the same upstream corpus. That
  validates this implementation against a recorded reference, not against silicon, and the corpus is not
  checked in.
- The automated TypeScript suite and its known gaps are listed in [`TESTING.md`](TESTING.md). No interactive
  browser/TurboWarp runtime validation or general commercial-ROM compatibility result is claimed.
