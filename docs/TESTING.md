# Testing strategy

## Current automated checks

Run from the repository root:

```bash
npm install
npm test
npm run build:ts
npm run scratch:assets
npm run scratch:vectors
```

- `npm test` runs strict TypeScript type-checking followed by Node's built-in test runner through `tsx`; each test has a 10-second timeout (`--test-timeout=10000`).
- `npm run build:ts` emits JavaScript into ignored `dist/`.
- `npm run scratch:assets` regenerates the decimal byte list from `test_rom.nes`; pass
  `-- --rom /path/to/rom.nes` to select a different build-time ROM without altering that fixture.
- `npm run scratch:vectors` generates the numeric GoboScript list (12,357 decimal values for the current
  541-record fixture) from the shared JSON vector fixture. `tests/shared-port-vectors.test.ts` executes all
  current vectors against the TypeScript reference modules, and `scratch/src/vector_selftest.gs` replays the
  same records inside the GoboScript project.
- `npm run build:scratch` generates both static data lists and requires the GoboScript CLI; this environment
  did not have Rust/Cargo or GoboScript installed when the scaffold was created.

The 1,188 tests include byte-exact generator regressions that reject direct, symlink, and hard-link aliases
to source fixtures, 542 cross-domain shared-vector checks (541 records plus the generator regression), 257 pinned
MIT single-step corpus checks covering all 256 opcode bytes, 69 GoboScript port-algorithm comparisons, 17
GoboScript source-lint checks, six standard-controller tests, forty-two focused
APU tests, six DMC DMA integration tests, one browser-server HTTP test including lexical-traversal and
symlink-escape rejection, twenty parser tests, fourteen synthetic console tests, two licensed-ROM console
tests, one supplied mapper 4 title-boot test, two NTSC clock tests, four canvas-renderer tests, four browser
keyboard-input tests, five Web Audio sink tests, five browser audio-filter tests, six battery-store tests, and
two browser frame-scheduler tests. Console tracing is opt-in and has a bounded ring-buffer test for
interrupt-sample, CPU, APU, PPU-dot ordering, and frame-boundary recording. The parser tests cover
the supplied mapper 4 ROM; iNES mapper, mirroring, battery, PRG RAM defaults, and zero-CHR CHR RAM; NES 2.0
mapper/submapper, mirroring, battery, extended and
exponent/multiplier PRG/CHR ROM sizes, and RAM/NVRAM shifts; trainer offsets and copied slices; truncated
header, trainer, PRG, and CHR inputs; unsupported versions; safe-integer and combined-payload overflow, 32 MiB image-size limits; and zero-PRG rejection. Four mapper-selection tests route mapper 0/submapper 0 to NROM and the supplied mapper
4/submapper 0 ROM to MMC3, and assert structured rejection of unlisted submappers and an unregistered mapper
ID. Ten NROM tests cover 16/32 KiB PRG mapping, PRG RAM/open bus and trainer loading, copy/restore of
separate PRG NVRAM and CHR NVRAM without altering volatile RAM, immutable CHR ROM, writable CHR RAM,
header-selected nametable mirroring, and structured rejection of unsupported layouts. Thirteen MMC3 tests
cover the supplied ROM, PRG/CHR banking modes, CHR RAM/ROM behavior and CHR NVRAM snapshots across banking,
mirroring, RAM protection, PRG NVRAM snapshots, A12 IRQ filtering/reload/enable/acknowledge,
`$2006`/`$2007` address observation, reset preservation, and structured layout errors.
Nine CPU-bus tests cover all address regions, RAM/PPU mirrors, APU/controller routing, cartridge windows,
DMA/unmapped register isolation, masked open-bus reads, reset preservation/cancellation, and invalid addresses/device responses. Five OAM DMA
tests cover 513/514-cycle parity, 256 alternating source/OAM writes, CPU stalls and resume, NMI deferral, and
DMA-aware step traces. Eight PPU-bus tests cover mapper read/write ordering, all three nametable mirroring
modes, `$3000-$3EFF` aliases, palette mirroring and six-bit writes, separate OAM storage, dynamic mirroring,
per-dot mapper-clock forwarding, and input/mapper-value validation. Sixteen PPU-register/timing tests cover
internal open bus, PPUSTATUS flags/write-toggle effects including vblank-start suppression, scroll/address latches,
PPUDATA buffering/increments,
greyscale palette reads, OAMDATA, 3:1 PPU/CPU timing, scanlines and frame lengths, odd-frame skip behavior,
vblank/status timing, NMI edges, reset preservation, and invalid inputs. Seventeen PPU rendering tests cover deterministic full-
frame output, background/shifter pixels, attributes, fine/coarse scroll and wrap, background table selection,
grayscale/emphasis, 8x8/8x16 sprites, flips, left-edge clipping, OAM priority, sprite-zero hit, ninth-sprite
overflow, and diagonal OAM-byte overflow false positives. Nine CPU-register tests cover byte/word wrap, signed
conversion, status invariants, flag
mutation, and stack status packing. Two ALU tests exhaust all 256 by 256 operand pairs and both carry
inputs for ADC and SBC. They check result, carry, zero, negative, overflow, and ignored decimal arithmetic.
Four fake-bus tests cover zero-filled reads, ordered traces, setup loads, address/value rejection, and trace
clearing. Six CPU-state tests cover
reset-vector reads, stack-pointer updates, word ordering, and BRK versus hardware-interrupt status pushes.
Seventeen addressing tests cover all thirteen modes, zero-page and pointer wrapping, indexed dummy reads and
page crossings, relative branch offsets and cycle additions, indirect-JMP wrap behavior, and memory/accumulator
read-modify-write ordering. Thirty-four opcode tests cover all 151 official opcodes, all 105 unofficial
encodings, and the 56 official mnemonics: 27 stable unofficial NOPs, six immediate ALU forms, ten LAX/SAX
forms, LAS, configurable XAA/LXA, 12 KIL/JAM opcodes, 42 composite RMW forms, and five unstable high-byte
stores (AHX, SHX, SHY, TAS). They check official execution, flags/control flow, NOP no-state-change behavior,
unofficial ALU/load/store/RMW effects, jam-until-reset and bounded bus activity, indexed page-cross cycles,
ordered bus effects, and cycles matching bus accesses. Six cycle-stepping tests verify one transaction per call
for every official opcode, state updates during a load, branch page-cross reads, reset sequencing, delayed IRQ
entry after CLI, and deferred NMI priority at an instruction
boundary. Six interrupt tests cover IRQ masking/level
behavior, NMI latching/priority, vectors, stack status, seven-cycle entry, delayed IRQ polling after
CLI/SEI/PLP, and RTI's restored I flag at the next boundary. Twenty pinned SingleStepTests vectors compare
reference registers, listed RAM, cycle totals, and ordered bus accesses, one CPU cycle per call. Five trace
tests cover decoded instruction steps, state snapshots, formatted output, split JSR operand fetches, writes,
ordered bus effects, BRK versus hardware-interrupt classification, and separate IRQ/NMI records. Four runner
tests cover a synthetic NROM trace pass, mismatch reporting, empty-log rejection, and nestest log parsing.
All 105 unofficial encodings now have tested deterministic behavior. The five unstable high-byte stores
(`$93/$9F` AHX, `$9B` TAS, `$9C` SHY, and `$9E` SHX) AND the source register (A AND X for AHX/TAS, X for SHX,
Y for SHY; TAS first copies A AND X to SP) with the unindexed base address's high byte plus one. On page
crossing, that masked value also supplies the destination high byte. A DMC stall on the indexed dummy read
before the write drops the store-data mask, while page-cross address corruption remains. Synthetic tests cover
all five encodings, an earlier-cycle control, and production `NesCpuBus` arbitration for the dummy-read stalls.
Other RDY/chip-dependent effects and hardware validation remain open. XAA/LXA default to configurable magic input `$EE` and do not
model chip-dependent analog or DMA variability. KIL locks until reset; its repeated two-read bus pattern is an
emulator convention, not hardware-verified. The XAA approximation follows the NESdev
[XAA analysis](https://www.nesdev.org/wiki/Visual6502wiki/6502_Opcode_8B_(XAA,_ANE)); `$EE` is a deterministic
choice. The encoding/timing list follows the NESdev
[CPU unofficial-opcode matrix](https://www.nesdev.org/wiki/CPU_unofficial_opcodes) and
[programming guide](https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes).
High-byte-store page-cross details follow the
[NESdev discussion](https://forums.nesdev.org/viewtopic.php?p=297765). The RDY/DMC data-mask dropout rule
also follows the notes and validation summary in [dotnet-6502 PR #350](https://github.com/highbyte/dotnet-6502/pull/350);
this project independently tests the cycle boundary but has no hardware validation. No third-party CPU test ROM
is bundled, and no test proves that a game boots.

## PPU memory bus

`PpuMemoryBus` is a memory-routing layer, not a PPU register or timing implementation. Addresses are
validated as 16-bit inputs and normalized to the PPU's 14-bit address space. Pattern reads and writes in
`$0000-$1FFF` are delegated to `PpuMapperPort`; mapper notifications are emitted before the memory operation.
Nametable accesses in `$2000-$3EFF` are reported with their normalized address before physical mirroring.
`$3000-$3EFF` aliases `$2000-$2EFF`. The mapper supplies the mirroring mode on each access, allowing a
mapper to change horizontal, vertical, or four-screen routing at runtime. `PpuMemoryBus.clock_ppu_dot()`
forwards one dot to the mapper, including idle dots; `Ppu2C02.clock_ppu_dot()` invokes it once per processed
PPU dot for MMC3 A12 filtering. Tests verify both callback forwarding and the PPU clock's use of the hook.
`NesConsole` couples that PPU clock to CPU/APU cycles using the integer NTSC master divider; synthetic
integration tests cover event ordering and interrupt delivery, not hardware phase accuracy.

The bus owns 4 KiB of zero-initialized nametable RAM, 32 bytes of palette RAM, and 256 bytes of primary OAM.
Palette addresses repeat every 32 bytes; `$3F10`, `$3F14`, `$3F18`, and `$3F1C` alias the universal
background entries `$3F00`, `$3F04`, `$3F08`, and `$3F0C`. Palette writes keep only six color bits. OAM is
a separate 8-bit address space and does not notify the mapper. The PPU timing tests are documented below. Uncovered behavior includes rendering-time register restrictions,
PPU reset write suppression, hardware-level timing races, and exact per-dot rendering effects.

## PPU 2C02 CPU registers

`Ppu2C02` implements `PpuCpuRegisterPort` and delegates PPUDATA/OAMDATA operations to `PpuMemoryBus`.
The PPU I/O latch is independent of the CPU data-bus latch; writes and readable-register reads refresh it,
write-only register reads return it, and PPUSTATUS combines the three status flags with the latch's low five
bits. Reading PPUSTATUS clears vblank and the shared PPUSCROLL/PPUADDR write toggle. The PPU clock sets
vblank at scanline 241 dot 1 unless PPUSTATUS is read at dot 0 or 1 before the event is processed; that read
suppresses the vblank flag and its NMI edge. The pre-render scanline clears vblank, sprite-zero-hit, and
sprite-overflow at dot 1 of scanline 261. PPUCTRL/vblank state drives the level-sensitive NMI output; each rising edge is latched for one
`take_nmi_edge()` call, including when NMI is enabled during vblank. `NesConsole` forwards consumed edges to
`Cpu2A03.request_nmi()`; a synthetic integration test covers vblank-NMI delivery, while hardware phase still
needs licensed-ROM validation.

PPUSCROLL and PPUADDR use the shared `v`, `t`, fine-X, and `w` state. PPUDATA non-palette reads are delayed
by one read-buffer access; palette reads are immediate, apply PPUMASK greyscale masking, preserve the PPU
I/O latch in the upper two bits, and refill the buffer from the mirrored nametable address. Reads and writes increment the 15-bit VRAM address
by 1 or 32 according to PPUCTRL. OAMDATA reads and writes use `PpuMemoryBus` primary OAM; writes increment
OAMADDR and reads do not. `clock_ppu_dot()` starts at pre-render (261,0), traverses 341 dots on 262
scanlines, and calls the mapper timing hook once per dot. `clock_cpu_cycle()` advances exactly three PPU dots.
An even frame is 89,342 dots; an odd frame with either rendering bit enabled skips dot 340 after processing
dot 339, while rendering-disabled odd frames retain dot 340. Open-bus decay, ignored writes during initial
reset warmup, rendering-time access restrictions, and hardware-level timing races remain untested; the
baseline pixel pipeline is covered separately.

## PPU rendering and framebuffer

`Ppu2C02` renders into a 256 by 240 `PpuFramebuffer` with separate row-major planes: palette color indices
(0-63) and PPUMASK emphasis bits (0-7). Background nametable, attribute, pattern-low, and pattern-high
fetches feed pattern/attribute shift registers; coarse/fine scrolling uses the PPU's `v`, `t`, and `x` state,
with horizontal/vertical transfers and wrap behavior. The pixel path resolves background palette output,
left-edge clipping, PPUMASK grayscale, and emphasis metadata. Sprite evaluation examines primary OAM,
retains the first eight in-range sprites for the next scanline, fetches 8x8/8x16 patterns with flips, clips
sprite-left pixels, and composites the lowest OAM-index opaque sprite against the background priority bit.
Sprite-zero hit respects overlap, clipping, and the right-edge limit. After eight in-range sprites, overflow
scanning models the diagonal OAM-byte bug: an out-of-range comparison advances both the sprite and byte
indices, so a tile, attribute, or X byte can trigger overflow. This behavior is informed by the optional
sprite-evaluation-bug path in pinned [Mesen2 `NesPpu.cpp`](https://github.com/SourMesen/Mesen2/blob/b9fa69ddc6d0a331fb103fdb5eef6904305703c2/Core/NES/NesPpu.cpp#L1091-L1122),
but our evaluation remains aggregated rather than a dot-by-dot secondary-OAM copy.

Tests exercise background/attribute/fine-X pixels, pattern-table choice, horizontal and vertical scroll
wrap, grayscale/emphasis, sprites and OAM priority, sprite-zero-hit boundaries, ordinary ninth-sprite overflow,
a false positive from a non-Y OAM byte, and two complete framebuffers from identical initial PPU/memory states.
These tests establish deterministic baseline behavior, not cycle-accurate PPU output: address-bus phases, exact
pixel pipeline delay, sprite evaluation races and OAMADDR-dependent behavior, and other hardware overflow
false positives/negatives still require validation against licensed PPU test ROMs. `get_framebuffer()` and
`get_framebuffer_emphasis()` return copies so callers cannot mutate internal output storage.

## NROM mapper

`NromMapper.create(rom)` checks the exact mapper/submapper route and returns a structured error for unsupported
routes or memory layouts. NROM-128 maps 16 KiB of PRG ROM into both `$8000-$BFFF` and `$C000-$FFFF`; NROM-256
maps 32 KiB linearly. PRG ROM writes are ignored. Declared PRG RAM is available in `$6000-$7FFF`, with
smaller memories mirrored through that window; a cartridge with no PRG RAM leaves those reads undriven. A
validated 512-byte trainer is copied into PRG RAM at `$7000-$71FF` during mapper creation. NROM exposes
copy-in/copy-out snapshots of its declared PRG NVRAM separately from volatile PRG RAM; restoring a snapshot
requires an exact byte-length match. Declared CHR NVRAM is likewise copied independently from volatile CHR RAM,
with exact-size restore validation.

NROM maps one fixed 8 KiB CHR-ROM bank read-only, or up to 8 KiB of declared CHR RAM as writable pattern
memory. Volatile CHR RAM and NVRAM share pattern memory, but only the NVRAM portion is included in battery
snapshots. Smaller RAM mirrors across the pattern window. The mapper preserves the header's nametable mirroring
mode and has no PPU address side effects. The NROM tests use synthetic mapper 0 images.

## MMC3 mapper

`Mmc3Mapper.create(rom)` accepts mapper 4/submapper 0 and validates PRG ROM (at least four 8 KiB banks),
one CHR ROM or CHR RAM region (at least eight 1 KiB banks), up to 8 KiB of PRG RAM, and trainer placement.
It implements both PRG layouts (R6/R7 plus the fixed final banks) and CHR layouts (two 2 KiB register pairs
plus four 1 KiB registers, switched as two 4 KiB halves), including MMC3 register masks. `$A000` selects
vertical/horizontal mirroring unless the cartridge is wired for four-screen; `$A001` controls PRG-RAM enable
and write protection. IRQ latch/reload/enable/acknowledge behavior is clocked on qualified PPU A12 rising
edges after at least ten low dots. Thirteen focused tests exercise the supplied ROM's mapper creation, bank
modes, CHR RAM/ROM writes and CHR NVRAM copy/restore across banking, mirroring, RAM protection, reset
preservation, structured errors, PRG NVRAM copy/restore while write-protected, and IRQ filter/counter behavior.
Mapper-specific tests cover A12 transitions
committed through `$2006` and `$2007`; `Ppu2C02`
reports those address changes and drives the mapper's dot hook during clocked execution. `NesConsole` now
samples the MMC3 IRQ line for CPU integration, but licensed mapper-IRQ traces and exact phase validation remain
open. External ROM observations and their license limitations are recorded below; they do not complete P3
validation.

## Exploratory PPU and mapper ROM runs

The exploratory binaries came from [`christopherpow/nes-test-roms`](https://github.com/christopherpow/nes-test-roms),
commit [`95d8f621ae55cee0d09b91519a8989ae0e64753b`](https://github.com/christopherpow/nes-test-roms/tree/95d8f621ae55cee0d09b91519a8989ae0e64753b).
GitHub reports no repository license, and the inspected MMC3, sprite-hit, and sprite-overflow readmes do not
supply redistribution terms. The binaries were kept only under `/tmp/nes-ppu-roms/`; none is checked in or
included in a release. These results are diagnostic observations, not a licensed conformance run. An
MIT-licensed alternative, [`calcwatch/nestests`](https://github.com/calcwatch/nestests/tree/8182e4e6583ecb290bea8e7fca474e7f2b3ebefc),
was also checked; its README lists only Family BASIC keyboard and MMC5 multiplier tests. A targeted GitHub
repository-metadata search for MIT-licensed NES PPU, sprite-hit, and MMC3 IRQ test ROMs found no relevant
suite. The MIT-labeled [`xram64/nes-tests`](https://github.com/xram64/nes-tests) collection contains APU
channel demo ROMs, not PPU 2C02, sprite, timing, or MMC3 A12 tests.

The ad-hoc runner couples each CPU cycle to three PPU dots in CPU-then-PPU order, forwards NMI/IRQ lines, and
reads the ROMs' status/text output where available. It is not a console scheduler and does not model master-
clock event ordering or all interrupt sampling races.

| Upstream MMC3 ROM | SHA-256 | Observed result |
| --- | --- | --- |
| `mmc3_test/1-clocking.nes` | `57c77c66edde8c45e17bda02691dd3c7fd0b270c1ec024dff4e11a7778dfaa37` | Status `$00`, "Passed" after 1,000,000 CPU cycles. |
| `mmc3_test/2-details.nes` | `89e1f16514aafeee90b5ab849dd73dbf1456dbd363ec2e3b798461125a33068a` | Status `$00`, "Passed" after 1,000,000 cycles with the 10-dot low filter. Before the filter was raised from 3 dots, this ROM failed test 7 ("Counter should be clocked 241 times in PPU frame"); the rendering path exposed repeated short A12 lows during sprite fetches. |
| `mmc3_test/3-A12_clocking.nes` | `dc6779b3d64e27b8d3b2b6dee7a1b528b9b6401ac0e6a9a1d5ab928dcd8ad6bb` | Status `$00`, "Passed" after 1,000,000 cycles. |
| `mmc3_test/4-scanline_timing.nes` | `0474550dbf811bf1acda2178bf355edd5c100088479a09d881f84994c1690b82` | Still running at 1,000,000 cycles; CPU-then-PPU order reports test 2 by 2,000,000 cycles and retains it at 5,000,000: "Scanline 0 IRQ should occur later when `$2000=$08`." PPU-first and one-/two-dot-before-CPU variants also fail test 2. This sub-scanline timing mismatch is not isolated. |

A tracing rerun in CPU-then-PPU order observed the failing test's first mapper IRQ assertion at frame 36,
pre-render scanline 261 dot 262, during a pattern read at `$1FF7` (PPUCTRL `$08`, PPUMASK `$18`); the runner's
CPU-cycle counter was 1,072,191. This confirms which event asserted the IRQ but does not establish whether
the mismatch is in PPU fetch phase, CPU polling, or the test runner's incomplete console scheduling.

The 10-dot choice was made after comparing reference implementations. At Mesen2 commit
[`b9fa69ddc6d0a331fb103fdb5eef6904305703c2`](https://github.com/SourMesen/Mesen2/tree/b9fa69ddc6d0a331fb103fdb5eef6904305703c2),
[`A12Watcher.h`](https://github.com/SourMesen/Mesen2/blob/b9fa69ddc6d0a331fb103fdb5eef6904305703c2/Core/NES/Mappers/A12Watcher.h)
accepts when `_cyclesDown > 10` after accumulating frame-cycle deltas (the low counter starts at one);
[`MMC3.h`](https://github.com/SourMesen/Mesen2/blob/b9fa69ddc6d0a331fb103fdb5eef6904305703c2/Core/NES/Mappers/Nintendo/MMC3.h)
separately measures a low interval of at least three CPU cycles. The mapper implementation uses a 10-PPU-dot
threshold, consistent with the watcher's elapsed-cycle scale and conservative across the CPU/PPU phase
relationship. The comparison informed the threshold but is not proof of exact hardware timing. FCEUX commit
[`da89a8ed72fd1226ef933265ec04d3da133ee15e`](https://github.com/TASEmulators/fceux/tree/da89a8ed72fd1226ef933265ec04d3da133ee15e)
was also inspected: its [`mmc3.cpp`](https://github.com/TASEmulators/fceux/blob/da89a8ed72fd1226ef933265ec04d3da133ee15e/src/boards/mmc3.cpp)
clocks the generic MMC3 counter from a horizontal-blank callback, so that implementation is not a like-for-like
A12 low-dot filter reference.

Other ROM observations from the same unlicensed collection, using one million CPU cycles in the same
ad-hoc runner:

- Selected sprite-hit cases `01.basics`, `05.left_clip`, `06.right_edge`, and `08.double_height` displayed
  "PASSED". `09.timing_basics` had no visible result at the sampled point, so it is not counted as a pass.
- All five `sprite_overflow_tests` ROMs displayed failures: Basics `#5`, Details `#6`, Timing `#4`, Obscure
  `#7`, and Emulator `#3`. The PPU's simplified first-eight-sprite evaluator and missing diagonal overflow
  bug are known gaps, but these ad-hoc outcomes are not a precise hardware diagnosis.
- `blargg_ppu_tests_2005.09.15b/palette_ram.nes`, `sprite_ram.nes`, and `vram_access.nes` each displayed
  `$01`; `ppu_vbl_nmi/rom_singles/03-vbl_clear_time.nes` displayed `$03`. The reported code for these was not
  independently validated against the ROM authors' result protocol. Vblank-clear output also changed with
  CPU/PPU scheduling order. Do not treat these as passes.

An earlier ad-hoc 1,000,000-cycle smoke of the supplied `test_rom.nes` reached PC `$7108` at frame 33 with
PPUMASK/status `$00` and only backdrop pixels. It stopped before title initialization and did not establish boot
compatibility. The later bounded `NesConsole` title-screen test and high-confidence ROM identification are
recorded in the dedicated section below.

P3 validation remains open: there is no licensed PPU/timing/sprite/mapper IRQ ROM suite in the project,
the available external ROM collection has no declared license, the MMC3 scanline timing case fails, and
sprite evaluation remains an approximation despite the synthetic diagonal-overflow test. Do not vendor these
ROMs or mark validation complete based on exploratory runs.

## APU channels, registers, frame sequencer, and mixer

`ApuPulseChannel` implements duty/timer, length, envelope, sweep (including pulse 1's extra negate
subtraction), reset, and mute behavior. `ApuTriangleChannel` implements its 32-step DAC, CPU-rate timer,
linear/length counters, held output while gated, and the documented period-below-two mute policy.
`ApuNoiseChannel` implements the NTSC CPU-cycle period table, long/short 15-bit LFSR taps, length counter, and
envelope. `ApuDmcChannel` implements NTSC rate selection, the sample reader and one-byte buffer, output shift
unit/DAC, loop/IRQ behavior, address wrap, and load-delay request state. `Apu2A03` routes `$4000-$4015` and
`$4017`, clocks channels at their distinct rates, and runs quarter-/half-frame events. The CPU bus services DMC
requests through the cartridge CPU port, stalls only on CPU reads, repeats held reads during no-operation
cycles, and lets DMC gets preempt OAM source reads. `mix_apu_channels()` applies the common nonlinear pulse and
TND equations to all five DAC inputs. `ApuAudioSampler` uses an integer phase accumulator at the NTSC CPU rate
(1,789,773 Hz) to produce zero-order mono samples at integer rates from 1 Hz through the CPU rate, defaulting
to 44.1 kHz; `Apu2A03` samples the post-clock mix
and exposes queued `Float32Array` blocks through `drain_audio_samples()`. `NesConsole` calls
`Apu2A03.clock_cpu_cycle()` once per CPU cycle and propagates `is_apu_irq_asserted()` to the CPU. Drain samples
periodically to bound memory. This deterministic core sample path is unfiltered and does not connect to a host
playback API; the browser shell applies a separate approximate filter before Web Audio scheduling.

Seven pulse tests cover duty, timers, all length values, envelope, sweep, mute, reset, and validation. Five
triangle tests cover waveform/timer progression, linear-counter gating and held output, length behavior,
`$400B` phase behavior, mute policy, reset, and validation. Five noise tests cover all sixteen timer periods,
maximal-length/short LFSR cycles, envelope/loop/constant volume, length behavior, reset, and validation. Thirteen APU integration tests cover all implemented channel register/status routes, DMC load delay and IRQ,
direct `NesCpuBus` integration/open bus, live mixing, frame events, sample cadence, live mixed-channel output,
reset, and input validation. Four DMC-channel tests cover periods, output buffering, sample address/length and
wrapping, loop/disable/IRQ, and validation. Four audio-sampler tests cover exact one-second sample counts,
fractional phase across drains, reset behavior, max-rate cadence, and invalid inputs. Four mixer tests cover
nonlinear pulse/TND behavior and input ranges. Six DMC DMA tests cover CPU read stalls and held-register reads,
wrapped PRG addresses, deferral across CPU writes, DMC arbitration during OAM DMA, production-bus stalls on
all five unstable-store dummy reads, and an end-to-end `Apu2A03` request through the production bus and CPU.
This is focused unit/integration coverage, not licensed ROM-based APU validation; exact load/reload phase edges
and OAM-collision offsets remain
unverified. Timing references are the NESdev Wiki [APU DMC](https://www.nesdev.org/wiki/APU_DMC) and
[DMA](https://www.nesdev.org/wiki/DMA) pages. Core audio samples remain unfiltered. `NesBrowserAudioFilter`
applies first-order 90 Hz and 440 Hz high-pass stages plus a 14 kHz low-pass stage to host-bound copies;
this is an approximate output shaping filter, not a calibrated 2A03 analog circuit model.

## Standard serial controllers

`NesControllerPorts` implements two standard eight-button pads and the existing `ControllerCpuPort` interface.
Writing bit 0 high to `$4016` keeps the current A-button state available without advancing either report; the
high-to-low transition snapshots both pads. Reads from `$4016` and `$4017` independently return A, B, Select,
Start, Up, Down, Left, and Right, one bit per read. Subsequent reads return 1. The device drives only D0, so
`NesCpuBus` retains the other bits from its open-bus latch; writes to `$4017` remain routed to the APU frame
counter. Six tests cover all buttons and both ports, live-A strobe behavior, falling-edge and repeated-strobe
semantics, post-report reads, bus routing/open bus, reset behavior, and invalid inputs. The initial NTSC NES slice uses two
standard pads. Four Score and Zapper are deferred but planned for full NES support; mapper expansion audio will
be implemented with each compatible mapper, while Famicom-only expansion-port devices are outside the NES
target. Host key mapping is a separate runtime adapter. Behavior follows NESdev's [standard controller](https://www.nesdev.org/wiki/Standard_controller)
and [controller reading](https://www.nesdev.org/wiki/Controller_reading) references.

## Console scheduler and synthetic integration tests

`src/nes/core/ntsc_clock.ts` counts integer NTSC master ticks at 21,477,272 Hz, with one PPU dot per four
ticks and one CPU/APU cycle per twelve. At coincident edges, `NesConsole` runs one CPU bus transaction,
clocks the APU, then advances the PPU dot; the other two PPU dots occur on their intervening master edges.
PPU NMI edges are latched into the CPU after the dot, and APU/MMC3 IRQ levels are sampled before the next
CPU cycle. This defines deterministic ordering, not cycle-perfect hardware phase.

`NesConsole.create()` validates the image and composes supported NROM/MMC3 cartridges, CPU/PPU buses, PPU,
APU, and two standard pads. It starts paused with the CPU reset sequence queued. `clock_cpu_cycle()` respects
pause; `step_cpu_cycle()` and `step()` explicitly advance while paused; `advance_frame()` advances even while
paused and has a 30,000-CPU-cycle guard. Frame output contains copied 256 by 240 color/emphasis planes and
samples drained since the prior audio drain. Reset restarts device/timing state and cancels DMA while preserving
CPU RAM, PPU RAM/OAM, and cartridge RAM; held controller buttons are retained while their serial latch resets.
`get_battery_ram_snapshot()` and `load_battery_ram_snapshot()` copy only mapper-declared PRG and CHR NVRAM,
excluding volatile RAM. Restore checks both exact lengths before writing either region and leaves mapper
protection state unchanged. The browser adapter keys local-storage records by the exact ROM's SHA-256 and saves
both regions on pause, stepping, ROM replacement, and page hide; it accepts legacy PRG-only records by
zero-initializing CHR NVRAM. TurboWarp storage and full-console save states remain open.

Synthetic integration tests exercise both mapper routes, reset and pause/step behavior, controller input read
by a real CPU instruction sequence, vblank NMI, APU frame IRQ, and an MMC3 A12 IRQ delivered to the CPU. An
opt-in bounded `NesConsoleTraceRecorder` test checks coincident interrupt-sample/CPU/APU/PPU event ordering and
frame-boundary recording. Tests also advance one complete bounded NTSC frame and verify sampled non-silent APU
output. Clock tests verify the 12:4 master-divider ratio; device reset tests verify RAM preservation. These are
TypeScript integration tests, not external conformance results or host playback. `advance_frame()` measured about
46 ms for a single synthetic
frame in this sandbox; that is a smoke timing, not a performance guarantee or a 60 fps claim. MMC3 IRQ edge
traces and exact PPU/APU/DMC phase behavior remain unvalidated against licensed ROMs.

## Supplied mapper 4 ROM identity and title-screen boot

The supplied `test_rom.nes` is 81,936 bytes, SHA-256
`cdfc23e83dbbc0f11592446d1bdcc496101390ac5c3f8ac91a0596c7b2b1485f`, CRC32 `05685C08`. Its iNES 1.0 header
selects mapper 4/submapper 0 (MMC3), 64 KiB PRG-ROM, 16 KiB CHR-ROM, vertical mirroring, battery-backed RAM,
and no trainer. The title screen reads "SUPER MARIO BROS. 2" and "(c)1986 NINTENDO"; the PRG also contains the
ASCII marker `SM2SAVE` at PRG offset `$8749`. Taken together, these fingerprints identify it with high
confidence as an MMC3 cartridge conversion of the Japanese *Super Mario Bros. 2* (The Lost Levels), in Loopy's
MMC3-port family; the exact dump revision remains unknown. NESdev discussions document Loopy's SMB2J MMC3 ROM
at the same 81,936-byte size and describe SMB2J's FDS-to-cartridge conversions ([thread 1](https://forums.nesdev.org/viewtopic.php?t=7376),
[thread 2](https://forums.nesdev.org/viewtopic.php?t=7391), [thread 3](https://forums.nesdev.org/viewtopic.php?t=17108)).
A TASVideos discussion independently notes that `SM2SAVE` occurs in an SMB2J `.nes` image
([thread](https://tasvideos.org/Forum/Topics/3087)). These sources support identification but do not establish
this exact dump's author, revision, or redistribution rights.

`tests/nes-console-supplied-rom.test.ts` runs the ROM through `NesConsole` and searches up to 60 bounded frames
for a title-screen pixel signature (palette indices at backdrop `(0,0)`, title-panel fill `(100,100)`, and logo
lettering `(128,100)`). The current deterministic run finds it on frame 43 after 1,280,569 CPU cycles; the
frame shows the expected title screen rather than merely reaching a valid PC. A temporary [jsnes 2.1.0](https://www.npmjs.com/package/jsnes)
(Apache-2.0) reference run, not added as a project dependency, rendered the same title layout after 43 frames.
This establishes a title-screen boot for this fixture, not gameplay, general mapper-4 compatibility, or
cycle-accurate hardware behavior.

### Exploratory JSNES APU/frame comparison

A temporary headless reference pass used [`jsnes` 2.1.0](https://www.npmjs.com/package/jsnes) (Apache-2.0;
not a project dependency) with the bundled ROMs. The reference and TypeScript runs both show the supplied
fixture's title layout by their 43rd frame, but no cycle-aligned, per-pixel framebuffer equality was
established; the host palette is intentionally approximate and frame/pixel phase may differ.

For the pinned SquarePlayer and NoisePlayer ROMs, both emulators were run at a 44.1 kHz output rate with two
initial frames, one Up transition frame, one continued-Up frame, one Down transition frame, and one released
frame. JSNES's raw audio callback has a large startup/DC component and a nonzero tail after the stop input, so
raw samples are not directly comparable to the TypeScript core's unfiltered zero-centered stream. As a
coarse AC-RMS observation after removing each frame's mean, JSNES measured 0.060789 for square playback and
0.025560 for noise playback, with residual stopped-frame values of 0.006246 and 0.006457. The TypeScript
frames measured 0.074367 during square playback and 0.087161 during noise playback, then exact zero after
stop. JSNES produced output during the square ROM's Up-transition frame, while TypeScript's first non-silent
square frame followed it. These smoke results confirm control-to-audio activity in both implementations,
not matching amplitude, phase, output filtering, or APU conformance; the frame-onset difference remains open.

A prior one-million-cycle execution smoke in Node.js v22.22.3 on Linux x86_64 reached 33 PPU frames and PC
`$7108` (A=`$16`, X=`$0D`, Y=`$02`, SP=`$C4`, P=`$20`), with 312,733 instructions, 21 NMIs, one IRQ, and 20
DMA sequences. It stopped before title-screen initialization: the framebuffer then contained palette index 1
in all 61,440 pixels (color+emphasis SHA-256
`5c37cca4037c29df596d2a68ee9a32cc8a573d7051289fe34301087826a06b62`), and 24,639 APU samples at 44.1 kHz
were silent. That earlier blank frame was a bounded pre-boot smoke, not the result of the later title-screen run.

## TypeScript browser preview

Run `npm run browser:dev` to build the TypeScript modules and start the static preview on `0.0.0.0:4173`.
The shell loads a user-selected iNES file or either bundled ROM using same-origin relative paths. `NesCanvasRenderer`
converts the PPU's 6-bit palette-index/emphasis planes to an RGBA `ImageData`, fixes the backing resolution at
256 by 240, disables canvas smoothing, and fits the image with integer CSS scaling. The 64-color RGB palette
and emphasis dimming are approximations, not calibrated 2C02 output. An automated HTTP integration test checks
both bundled ROM routes byte for byte, verifies the page, stylesheet, `HEAD` and unsupported-method handling,
and confirms path traversal is rejected. A prior smoke check also
verified the compiled entry module. No headless browser automation is installed in this environment.

`NesBrowserFrameScheduler` uses `requestAnimationFrame` and advances at most one bounded console frame per
callback; it intentionally does not run a catch-up loop when emulation falls behind. The page includes pause,
reset, frame/instruction stepping, two keyboard-mapped standard pads, and a Web Audio sink that schedules
sample blocks after a user gesture. Host-bound audio is passed through two first-order high-pass stages
(90 Hz and 440 Hz) and one first-order 14 kHz low-pass; the core sample buffer is unchanged. Four renderer tests
cover color/emphasis conversion, malformed data,
integer scaling, and `ImageData` writes. Four keyboard adapter tests cover all 16 mappings across two pads,
editable/unbound key filtering, repeated keydown suppression, and releasing held buttons. A synthetic-console
integration test routes the mapped Z key through the controller serial port to a ROM read. Five injected-context
Web Audio tests cover graceful unsupported-browser handling, sample copying/rates, schedule continuity and drift,
and stopping/retiring sources. Five filter tests cover DC rejection, mid/high-frequency response, chunk-state
continuity, reset/sample-rate changes, and invalid input. Six battery-store tests cover SHA-256 ROM identity,
PRG/CHR per-ROM round trips including CHR NVRAM above 8 KiB, legacy PRG-only migration, malformed/version/size
rejection, empty snapshots, and unavailable storage. Two injected-callback tests cover one-frame scheduling,
cancellation, and stopping/reporting a failed frame. These automated tests do
not execute a real browser or device audio stack; use the live preview for manual visual/input/audio checks. The
current console frame smoke timing is about 46 ms, so the shell is not a 60 fps or TurboWarp performance claim.

## P4 licensed APU/controller ROM and runtime validation

On 2026-10-15, `npm test` passed all 332 tests (including type-checking), and `npm run build:ts` passed.
On 2026-10-18, `npm test` passed all 1,188 tests in about 15 seconds, including the 1,026-vector CPU corpus
subset, the two new PPU OAMADDR/OAMDATA quirk tests, the 25 shared cartridge-header vectors, the 39 shared
CPU addressing vectors, the 12 shared CPU sequence vectors, the 20 shared opcode-decode vectors, the 99 shared
instruction vectors, the 19 shared control-loop vectors, the 25 shared NROM board vectors, the 16 shared NROM
memory vectors, the 12 shared cartridge-bus vectors, and the 86 GoboScript port-algorithm and
source-lint tests.
The suite includes two pinned MIT APU-player smoke tests, covering pulse and noise channels through headless
controller-to-sample paths. The SquarePlayer case now injects ArrowUp/ArrowDown through the browser keyboard
adapter into the console; this does not exercise DOM events. These tests do not validate host playback or hardware
conformance. The standard-pad screen and relative APU-level tests below remain candidates, not passing results.

- **Passed headless APU plus input smoke test:** [`xram64/nes-tests`](https://github.com/xram64/nes-tests/tree/c871f6fe06b5f00b305e977c50f0d16e1bd444dd)
  is MIT-licensed in its repository `LICENSE` (copyright 2018 tragicmuffin). The unmodified
  `players/NES_APUTest_SquarePlayer.nes` binary is included with its MIT license and provenance in
  [`tests/fixtures/nes-apu/`](../tests/fixtures/nes-apu/); SHA-256 is
  `a9193cf7ffa0d0efbaab298cf618f3f506c8e3c4b46b2b81a2e1cf19391819a6`. The upstream README says the player
  was modified from the Nerdy Nights Sound: Part 3 tutorial; that attribution is retained in the fixture
  README, and no tutorial source is bundled. The documented Up/Down actions were sent as ArrowUp/ArrowDown
  events through `NesBrowserKeyboardInput`, whose callback updates `NesConsole.set_button_state()`, while
  `advance_frame()` ran at the default 44.1 kHz sample rate: the first
  two frames were silent; after Up, the first transition frame stayed silent and the following frame had
  401/734 nonzero samples (peak 0.14938); after Down, one transition frame still contained the current note,
  and the next full frame was silent. The automated `tests/nes-console-rom.test.ts` checks silence, non-silent
  output, and stop behavior with a 10-second test timeout. This is a headless smoke result, not audible host
  playback, pitch accuracy, or an automated conformance ROM.
- **Passed headless noise-channel smoke test:** The same MIT-licensed `xram64/nes-tests` revision includes
  `players/NES_APUTest_NoisePlayer.nes` (SHA-256
  `8dadfd29f0b2a90b82ef346ac0c52f1a32630b462297c7b7a3ab7ee60019a66e`), now preserved with its provenance in
  [`tests/fixtures/nes-apu/README.md`](../tests/fixtures/nes-apu/README.md). Initial audio was silent; Up
  produced nonzero samples on the transition frame and continued on the next frame; Down produced one final
  transition frame and then silence. This tests the noise channel through controller, CPU, APU, and sample
  integration in `NesConsole`, not accurate noise pitch, audible playback, or full APU conformance.
- **Standard-pad screen test:** [`pinobatch/allpads-nes`](https://github.com/pinobatch/allpads-nes/tree/e70cc84369b326300e4dc11077597565dd715e6a)
  explicitly licenses its test program and manual under the zlib license in `README.md` and `LICENSE.txt`
  (Copyright 2016 Damian Yerrick). It detects standard NES controllers and displays an interactive input
  test, alongside accessories outside this project's initial target. Use only its standard-pad path for this
  slice; verify both ports and the eight-button mapping. It is a manual visual test, not an automated result
  protocol.
- **Relative APU level check:** [`bbbradsmith/nes-audio-tests`](https://github.com/bbbradsmith/nes-audio-tests/tree/99ef107f3f3ffe19f72937507ca0820a4f5c34cd)
  states in `readme.md` that its files may be freely redistributed and modified for any purpose, with credit
  appreciated. Its `db_apu` test compares full-volume APU square and triangle output at about 440 Hz. This
  can provide a manual relative-volume/audio check, not channel-timing conformance; confirm the built asset's
  format before integrating it with a future runner.

The commonly used [`christopherpow/nes-test-roms` APU tests](https://github.com/christopherpow/nes-test-roms/tree/95d8f621ae55cee0d09b91519a8989ae0e64753b/apu_test)
were also reviewed, but no license was found in the repository root or the inspected per-suite material. Do
not vendor or describe those ROMs as appropriately licensed without separate permission/provenance.

The TypeScript console scheduler can step supported iNES ROMs headlessly through the production
CPU/PPU/APU/controller composition; the CPU-only `NromTestBus` remains limited to CPU-only trace checks. The
pinned SquarePlayer and NoisePlayer ROMs now have passing headless input/audio smoke tests, and a TypeScript
browser shell provides keyboard, Web Audio, and per-ROM local-storage PRG/CHR-NVRAM adapters (with legacy
PRG-only read support). No interactive browser/audio-device run has been recorded, and the Scratch/TurboWarp
target still lacks its own input/audio/save adapters. `ApuAudioSampler` itself returns only unfiltered sample
blocks. Keep P4 open until additional licensed ROM results are recorded and controller input plus audible
playback are exercised in the intended browser and TurboWarp runtimes. Record each ROM's pinned source, license,
SHA-256, input/reset procedure, expected/observed result, runtime, and timeout with the results.

## CPU cycle stepping

Call `Cpu2A03.clock_cycle()` once per CPU tick. Each call performs exactly one bus read or write and returns
a `CpuCycleResult` with its access, sequence kind (`instruction`, `irq`, `nmi`, `reset`, or `dma`), a 1-based
cycle index within the sequence, and a completion flag. DMA cycles hold the pending CPU read without advancing
its instruction generator. OAM and DMC DMA cycles hold the pending CPU read without advancing the
generator; DMC DMA performs the sample read through the CPU bus and can preempt an OAM source get. After a
completed sequence, the next call begins polling for interrupts and then starts the next instruction if no
interrupt is accepted. `request_reset()` starts a reset sequence without eager reads; `reset()` and `step()`
remain synchronous convenience wrappers.

The tests verify all official opcodes, page-crossing branch reads, reset cycles, CLI-delayed IRQ acceptance,
NMI priority at an instruction boundary, and DMC/OAM CPU bus stalls. This models CPU bus ordering at individual
cycles but does not establish full hardware timing. Hardware interrupt edge sampling, OAM DMA interaction with
coupled CPU/PPU clocks, exact DMC load/reload phase edges, and other system-level timing still need separate
validation.

## Licensed CPU reference vectors

`tests/fixtures/nes6502/` contains 1,026 selected instruction vectors from the MIT-licensed
[SingleStepTests/65x02](https://github.com/SingleStepTests/65x02) `nes6502/v1` corpus, pinned to commit
`2f6980a2d95757486c7bee24355c360e40e2a224`, with every one of the 256 opcode bytes represented. The copied
license, selection procedure, SHA-256 hashes for the complete upstream source files, the checked-in subset
hash, setup, and expected results are documented in
[`tests/fixtures/nes6502/README.md`](../tests/fixtures/nes6502/README.md).

The offline `tests/cpu-single-step-vectors.test.ts` runner seeds a fake 64 KiB bus, calls
`clock_cycle()` once for each reference bus operation, and checks the returned access, completion boundary,
final registers, and listed RAM. All 1,026 vectors pass as part of `npm test`, reported as 257 grouped tests;
225 of them cover both crossing and non-crossing cases for the five unstable high-byte-store opcodes, and the
KIL/JAM family is checked against the upstream jam bus pattern. `npm run test:cpu-corpus -- --corpus
<path/to/nes6502/v1>` optionally replays the complete upstream corpus (2,560,000 scenarios in about 20
seconds) from a local clone that is not checked in. The fixture is not a ROM. Passing it validates this
implementation against the recorded reference, not against silicon.

## Instruction-level CPU traces

Wrap the CPU bus before constructing `Cpu2A03` to capture one structured record per CPU step:

```ts
const trace_bus = new CpuTraceBus(cpu_bus);
const cpu = new Cpu2A03(trace_bus);
const trace_recorder = new CpuStepTraceRecorder(cpu, trace_bus);
const trace = trace_recorder.step();
const line = format_cpu_step_trace(trace);
```

Each record includes before/after registers, decoded instruction bytes or IRQ/NMI entry, the step's cycle
count, a trace-relative CPU-cycle offset, and ordered bus transactions. When a step includes DMA, its DMA
accesses are kept in `dma_accesses` separately from the instruction's `bus_accesses`, so the halt read is not
mistaken for an opcode fetch. The offset begins at the first recorded step; reset cycles and calls to
`cpu.step()` outside the recorder are excluded. The adapter aggregates bus calls produced by `clock_cycle()`
and does not add reads or writes. It remains an instruction-level trace view; use `clock_cycle()` directly
to schedule or inspect each transaction. Neither API proves full timing accuracy.

The opt-in `test:nestest` command accepts an externally provided NROM image and Nintendulator log:

```bash
npm run test:nestest -- --rom /path/to/nestest.nes --log /path/to/nestest.log --limit 5003
```

The runner starts at `$C000` with the documented nestest register state, maps NROM PRG and CPU RAM, and
compares PC, instruction bytes, registers, and CPU-cycle offsets. Its bus returns zero for PPU/APU address
space; it is a CPU test harness, not a production console bus. ROM and log files are not bundled, and users
must verify their redistribution terms. The historical unbounded run stopped at opcode `$04`; that NOP is now
implemented, but the external trace has not been rerun after this change. Do not treat the old stopping point as
current emulator behavior.

## Test layers to add

### Unit tests

Test pure behavior at the smallest practical boundary:

- ROM header and payload validation;
- address decoding and mirroring;
- byte/word wrap and status flags;
- CPU addressing modes and instructions;
- mapper bank windows, write rules, mirroring, and IRQ state;
- PPU registers, memory buffering, timing, NMI, sprite evaluation, and pixel selection;
- controller serial reads;
- APU channel timers, frame counter, DMC, and sample values.

### Deterministic integration tests

Build the console with fake or real buses as appropriate. Record CPU traces, ordered bus transactions, PPU
dots/scanlines, interrupt events, mapper state, and framebuffer hashes. Avoid hiding timing bugs behind a
single final screenshot.

### ROM-based tests

The supplied fixture is identified with high confidence as an MMC3 conversion of Japanese *Super Mario Bros. 2*
and reaches a title-screen signature at frame 43; exact dump provenance and rights remain unknown. This bounded
boot does not establish gameplay or general MMC3 compatibility. Add appropriately licensed CPU, PPU, APU, DMA,
and mapper test ROM suites as separate fixtures. Record each ROM's source, license, hash, reset/input procedure,
expected result, timeout, and known exceptions. Do not assume a ROM is redistributable just because it is
published in a public repository.

Use known test suites and independent emulators as cross-checks. Do not copy copyrighted game ROMs into the
repository. Test ROM execution should report explicit pass/fail text and include timeout protection.

### TypeScript/GoboScript parity

Every ported pure helper or state transition should have shared vectors. Run the vectors in TypeScript and
in a GoboScript development sprite/list, then compare results. Keep vector field order and integer ranges
documented. Favor exhaustive byte-input checks for numeric primitives and boundary cases for memory.

Current parity coverage, in three layers:

1. `tests/shared-port-vectors.test.ts` executes all 469 fixture records against the production TypeScript
   modules (470 tests including the generator regression).
2. `tests/goboscript-port-algorithms.test.ts` runs 58 comparisons against
   `tests/support/goboscript_port_algorithms.ts`, an integer-only TypeScript mirror of every ported GoboScript
   helper. It sweeps all 256 by 256 operand pairs for ADC/SBC/AND/ORA/EOR/CMP/BIT/INC/DEC and all 256 by 256
   status combinations for the shift and rotate steps, sweeps every status byte against every flag for the
   status helpers, replays the numeric, ALU, bus, controller, cartridge, CPU addressing, cycle sequence, and
   opcode decode vectors through the mirror, and differentially compares the mirrored bus and controller ports
   with `NesCpuBus` and
   `NesControllerPorts`. The CPU mirror reproduces every cycle sequence against `Cpu2A03.reset()` and `step()`
   for reset, BRK, JSR, RTI, RTS, IRQ, NMI, and relative branches, and reproduces every addressing mode against
   `Cpu2A03.resolve_addressing_mode()` including access order and cycle counts, reports the error code the
   port uses where the reference throws for an illegal mode and access pair, and compares its fetch and stack
   transactions with the traces of real PHA, PLA, JSR, RTS, BRK, RTI, and immediate-operand instructions. For
   the cartridge mirror it compares all eighteen reported header fields against `parse_ines_rom` for every
   `flags6` byte, every `flags7` byte, every legacy PRG RAM bank count with and without a battery, every
   NES 2.0 mapper and RAM byte, all 4,096 encoded NES 2.0 ROM sizes, every RAM shift nibble, and every image
   length from 0 to 16 bytes, projecting the reference through
   `tests/support/cartridge_projection.ts`. The opcode mirror `GoboscriptCpuOpcodeDecoder` reads the same flat
   list the generator writes and is compared with `CPU_OPCODE_TABLE` for all 256 opcodes, plus the table checks
   that report a truncated, reversioned, or missing data file and the byte normalization of its argument.
   Instruction dispatch is mirrored by `GoboscriptCpuCore.execute_instruction()` and its helpers, which replay
   all 99 suite-13 records against the fixture, execute all 151 official opcodes while refusing the 104
   unofficial ones other than KIL, report a core with no decode table, and pin the KIL jam flag and its two
   accesses.
3. `tests/goboscript-opcode-table.test.ts` (4 tests) compares every entry of
   `tests/fixtures/goboscript/opcode_table.json` with `CPU_OPCODE_TABLE`, including the mnemonic, addressing
   mode, base cycles, operand access, page-cross flag, and official flag for all 256 opcodes, checks that the
   generator's flat list carries the same values at the positions the ported decoder will index, and checks
   that the generator refuses to overwrite its canonical fixture directly, through a symlink, or through a
   hardlink and rejects six malformed fixtures.
4. `tests/goboscript-source.test.ts` lints the `.gs` sources for the grammar shape the upstream parser accepts,
   the constructs that panic upstream codegen (`return` inside a `proc`), reserved Scratch block and keyword
   names, indentation, ASCII, line length, directive placement, resolvable `%include` paths, per-target name
   resolution, mirror name/arity parity, call shapes (a `proc` is called without parentheses, a `func` with
   them, each with its declared argument count), self-test enum IDs that match the fixture, and the ported
   `cpu_mnemonic` and `cpu_opcode_field` enum IDs that match the generated opcode table, and the mnemonics the
   instruction dispatcher names, which must equal both the mirror's `CPU_MNEMONIC` IDs and the projection's
   ported set.

A valid `.sb3` compile is only a syntax/package check. Also open it in TurboWarp, click the green flag,
verify expected output, and check that the project remains responsive. If Scratch website compatibility is
claimed, test it separately from TurboWarp. None of that is possible in this environment yet: the pinned
compiler needs Cargo and rustc, so the in-project self test has never executed and its result is unknown.

### Performance tests

No TurboWarp game-performance result is available: the GoboScript project is still a vector-self-test
scaffold and does not emulate frames. Even the self test has not been measured, because the project has never
been compiled. The TypeScript shell's single synthetic-frame timing of about 46 ms in
this sandbox is a smoke measurement, not representative of a supported game, target hardware, or TurboWarp.
There is no verified 60 fps claim or target-device benchmark yet.

For future measurements, use a reproducible browser/runtime version, ROM, stage settings, input trace, warmup,
and duration. Record average and worst frame time, skipped frames, memory/list sizes, and whether audio/video
are enabled. Keep renderer experiments independent so an output bottleneck does not distort CPU timing
measurements.

## Error-case expectations

Malformed ROM data, unsupported mapper IDs, and unsupported console regions are expected external inputs.
Tests should assert structured errors and ensure the application remains usable. Programmer invariant
violations can throw in TypeScript tests, but exceptions must not be the routine mechanism for invalid ROM
or runtime input.
Programmer invariant
violations can throw in TypeScript tests, but exceptions must not be the routine mechanism for invalid ROM
or runtime input.
