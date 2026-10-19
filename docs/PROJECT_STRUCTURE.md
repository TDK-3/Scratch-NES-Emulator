# Project structure

## Current tree

```text
.
    .editorconfig
    .gitignore
    .github/
        workflows/
            test.yml
    AGENTS.md
    PROMPT.md  continuation prompt and standing project rules
    README.md
    package.json
    package-lock.json
    tsconfig.json
    test_rom.nes  supplied mapper 4 fixture; do not modify or redistribute
    src/
        nes/
            apu/
                apu_2a03.ts
                audio_sampler.ts
                dmc_channel.ts
                length_counter.ts
                mixer.ts
                noise_channel.ts
                pulse_channel.ts
                triangle_channel.ts
            browser/
                audio_filter.ts
                audio_output.ts
                battery_ram_store.ts
                canvas_renderer.ts
                frame_scheduler.ts
                keyboard_input.ts
                main.ts
            cartridge/
                ines.ts
                mapper.ts
                mapper_000.ts
                mapper_004.ts
            core/
                console_trace.ts
                nes_console.ts
                ntsc_clock.ts
            cpu/
                addressing_modes.ts
                alu.ts
                cpu_2a03.ts
                cpu_bus.ts
                cpu_trace.ts
                nes_cpu_bus.ts
                opcode_table.ts
                registers.ts
            input/
                controller.ts
            ppu/
                framebuffer.ts
                ppu_2c02.ts
                ppu_bus.ts
    web/
        index.html
        styles.css
    tests/
        apu-2a03.test.ts
        apu-audio-sampler.test.ts
        apu-audio.test.ts
        apu-mixer.test.ts
        apu-noise-channel.test.ts
        apu-pulse-channel.test.ts
        apu-triangle-channel.test.ts
        browser-audio-filter.test.ts
        browser-audio-output.test.ts
        browser-battery-ram-store.test.ts
        browser-frame-scheduler.test.ts
        browser-keyboard-input.test.ts
        browser-renderer.test.ts
        browser-server.test.ts
        controller.test.ts
        cpu-2a03.test.ts
        cpu-addressing.test.ts
        cpu-alu.test.ts
        cpu-bus.test.ts
        cpu-cycle-stepping.test.ts
        cpu-interrupts.test.ts
        cpu-opcodes.test.ts
        cpu-registers.test.ts
        cpu-rom-runner.test.ts
        cpu-single-step-vectors.test.ts  offline runner for the pinned corpus subset
        cpu-tracing.test.ts
        dmc-channel.test.ts
        dmc-dma.test.ts
        fixtures/
            goboscript/
                opcode_table.json  canonical opcode decode table for the port
                shared_port_vectors.json  canonical cross-language parity cases
            nes-apu/
                LICENSE
                NES_APUTest_NoisePlayer.nes  pinned MIT noise APU smoke ROM
                NES_APUTest_SquarePlayer.nes  pinned MIT pulse APU smoke ROM
                README.md
            nes6502/
                LICENSE
                README.md  provenance, selection, and results
                SOURCE_MANIFEST.sha256  hashes of the upstream corpus files
                vectors.json  1,026 selected MIT CPU reference vectors
        goboscript-opcode-table.test.ts  opcode table fixture parity and generator protections
        goboscript-port-algorithms.test.ts  exhaustive mirror-versus-reference comparison
        goboscript-source.test.ts  GoboScript source lint and contract checks
        ines.test.ts
        mapper-000.test.ts
        mapper-004.test.ts
        mapper.test.ts
        nes-console-rom.test.ts
        nes-console-supplied-rom.test.ts
        nes-console.test.ts
        nes-cpu-bus.test.ts
        ntsc-clock.test.ts
        oam-dma.test.ts
        ppu-2c02.test.ts
        ppu-bus.test.ts
        ppu-rendering.test.ts
        scratch-rom-assets.test.ts
        shared-port-vectors.test.ts
        support/
            FakeCpuBus.ts
            NromTestBus.ts
            cartridge_projection.ts  reference projection of a header parse onto suite 9
            cpu_addressing_projection.ts  reference projection of one addressing-mode resolution
            cpu_control_projection.ts  reference projection of a control-loop record
            cpu_instruction_projection.ts  reference projection of one whole instruction
            cpu_opcode_projection.ts  reference projection of one opcode decode
            cpu_sequence_projection.ts  reference projection of one CPU cycle sequence
            mapper_projection.ts  reference projection of mapper selection and NROM validation
            goboscript_port_algorithms.ts  integer-only mirror of the ported helpers
            nestest_runner.ts
            recording_cpu_bus.ts  bus recorder and absent-device factory shared by the CPU projections
            shared_port_vectors.ts  fixture loader shared by both vector tests
    scripts/
        generate_goboscript_opcode_table.mjs
        generate_goboscript_rom_data.mjs
        generate_goboscript_shared_port_vectors.mjs
        run_cpu_vector_corpus.mjs  opt-in full-corpus runner (not part of npm test)
        run_nestest_trace.mjs
        select_cpu_vectors.mjs  deterministic fixture selection from a local corpus clone
        serve_browser.mjs
    scratch/
        NOTES.md  embedded in the compiled project as its notes
        assets/
            blank.svg
        goboscript.toml
        main.gs  display sprite: reports status and draws each frame with the pen extension
        src/
            bitwise_tables.gs  the 256-entry nibble AND table the bit-free helpers index
            cartridge.gs  iNES and NES 2.0 header parsing with numeric error codes
            cartridge_loader.gs  boot path: signature, header, board validation, payload, attachment
            controller.gs  two serial controller ports
            cpu_addressing.gs  all thirteen addressing modes with dummy reads and page-cross cycles
            cpu_alu.gs  ADC, SBC, logic, shift, compare, BIT, INC, DEC
            cpu_bus.gs  RAM mirroring, open bus, controller window, attached-board cartridge window
            cpu_control.gs  sequence selection, interrupt acceptance, jam vector reads, IRQ poll mask
            cpu_core.gs  registers, one logged bus transaction per cycle, fetch and stack operations
            cpu_instruction.gs  one whole instruction: dispatch, operands, ALU, branches, jumps, stack
            cpu_opcode.gs  mnemonic enum plus the generated opcode table decode
            cpu_sequence.gs  reset, BRK, JSR, RTI, RTS, interrupt, and branch cycle sequences
            cpu_status.gs  status normalization and flag updates
            keyboard_input.gs  host keyboard sampling into both controller button masks
            mapper.gs  exact mapper and submapper routing with numeric error codes
            mapper_000.gs  NROM validation, payload copy, and the CPU and pattern windows
            mapper_004.gs  MMC3 validation, banking registers, both modes, and the windows
            nes_palette.gs  the 64-color palette cached as 512 pen colors with emphasis dimming
            pen_display.gs  pen drawing geometry and the pen_fit_to_screen fit-to-stage setting
            numeric.gs  bit-free byte, word, and bitwise helpers
            ppu_2c02.gs  PPU registers, timing, and the framebuffer rendering pipeline
            ppu_bus.gs  pattern, nametable, palette, and OAM routing with mapper observation
            rom_loader.gs  generated ROM list, header load, and signature check
            shared_vectors.gs  generated port-vector list
            vector_selftest.gs  walks the vector list, replays it, and reports a summary
        stage.gs  Stage: owns shared state and runs the self test
    docs/
        ARCHITECTURE.md
        COMPLETION_CRITERIA.md
        GOBOSCRIPT_PORT_VECTORS.md
        GOBOSCRIPT_RESEARCH.md
        LLM_CONTEXT.md
        PORTING_PLAN.md
        PROGRESS.md
        PROJECT_STRUCTURE.md
        SUPPORTED_FEATURES.md
        TESTING.md
        TODO.md
```

`scratch/data/test_rom_bytes.txt`, `scratch/data/shared_port_vectors.txt`, and
`scratch/data/opcode_table.txt` are generated by their build steps and ignored by Git. `scratch/scratch.sb3` and TypeScript's `dist/` output are generated and ignored as well.

## TypeScript source

`src/nes/` contains portable emulator logic, organized by hardware domain. It must not depend on Scratch,
TurboWarp, DOM APIs, or UI state. `tests/` contains behavior tests; test files may use Node APIs for
fixtures but emulator modules should stay host-independent.

The TypeScript implementation includes the iNES parser, explicit mapper selection, NROM, and MMC3. NROM
supports 16/32 KiB PRG ROM, optional PRG RAM/trainer initialization, fixed CHR ROM or writable CHR RAM, and
header-selected nametable mirroring. MMC3 supports mapper 4/submapper 0 PRG/CHR bank modes, mirroring, PRG-RAM
protection, and filtered A12 IRQ counting. `PpuMemoryBus` provides pattern/nametable/palette/OAM routing and
forwards per-dot timing to the mapper. `Ppu2C02` implements CPU-facing register and memory side effects
(PPUSTATUS, scroll/address latches, PPUDATA buffering/increments, OAMDATA), deterministic NTSC scanline/dot
progression, vblank timing, odd-frame shortening, three PPU dots per CPU cycle, and a consumable NMI rising-
edge latch. Its baseline renderer draws background and sprites into `PpuFramebuffer`, including scrolling,
attributes, OAM priority, sprite-zero hit, first-eight sprite selection, grayscale, and emphasis metadata.
The 2C02 overflow diagonal bug and exact pixel timing remain known limitations. The CPU implementation includes register/ALU helpers,
addressing modes, the official opcode table, cycle-visible CPU bus sequencing for reset and all official
opcodes, IRQ/NMI handling, CPU address decoding, OAM DMA, and an optional trace adapter. `NesConsole` now
composes the CPU, PPU, APU, mapper, and standard pads behind a deterministic NTSC clock and control API.
`src/nes/core/console_trace.ts` supplies an opt-in bounded recorder for scheduler, interrupt, PPU-dot, and frame
events. The core remains headless; `src/nes/browser/` supplies a separate canvas, keyboard, and Web Audio shell, but its
interactive browser behavior and performance have not been manually validated. Exact hardware phase validation
and the independent TurboWarp output/input/audio path remain integration work. The target hardware module tree is described in
[Architecture](ARCHITECTURE.md). Add modules when implementing real behavior rather than creating empty files
solely to match a diagram.

`src/nes/apu/` contains tested pulse, triangle, noise, and DMC units, their shared length lookup, a nonlinear
pulse+TND mixer, and `Apu2A03` register/frame integration for `$4000-$4015` and `$4017`. `NesCpuBus` services
DMC sample-fetch requests and arbitrates DMC gets against OAM DMA. `ApuAudioSampler` generates deterministic
mono `Float32Array` blocks from the 1,789,773 Hz NTSC clock, defaulting to 44.1 kHz, and remains independent of
browser/runtime audio APIs. `src/nes/input/controller.ts` provides two standard serial controller ports with
button-state setters, strobe/latch behavior, NES button order, and D0-only reads. `NesConsole` supplies CPU/APU
clocks and connects APU IRQs to the CPU. `src/nes/browser/` adapts those inputs and APU samples to browser
keyboard, filtered audio blocks, and Web Audio APIs. ROM-level timing validation, calibrated analog behavior,
live browser playback, and the separate TurboWarp adapters remain future work. Four Score and Zapper are deferred
but planned for full NES support; mapper
expansion audio will be added with each compatible mapper. Famicom-only expansion-port devices are outside the
NES target.

## GoboScript source

`scratch/` is the root passed to `goboscript build`. None of these sources has been compiled: the pinned
toolchain needs Cargo and rustc, which are unavailable here.

- `stage.gs` defines the Scratch Stage. It includes every header, so the Stage owns all shared variables,
  lists, and enums, and its green-flag handler runs the port-vector self test and broadcasts completion.
- `main.gs` defines the `main` display sprite. It includes no header and only reads Stage-owned state,
  because a sprite resolves Stage variable, list, and enum names while a proc or func is compiled separately
  into each target that includes it. It owns all pen and motion blocks, since the Stage can neither move nor
  draw: on the waited "draw frame" broadcast it erases the pen layer and draws the PPU framebuffer lists as
  run-length strokes in the cached `nes_pen_colors`.
- `src/ppu_2c02.gs` holds the PPU registers, timing, and rendering pipeline into the
  `ppu_framebuffer_colors` and `ppu_framebuffer_emphasis` lists; `src/ppu_bus.gs` routes its memory and
  reports pattern/nametable accesses to an attached MMC3 board.
- `src/nes_palette.gs` holds the canvas renderer's 64-color RGB table and the 512 cached pen colors built
  from it with emphasis dimming.
- `src/pen_display.gs` holds the pen geometry: the global `pen_fit_to_screen` setting (1, the default,
  scales pixels to the largest uniform size that fits the 480 by 360 stage, centered on (0, 0); anything
  else is native 1x) and the derived scale/first-pixel variables the Stage refreshes before each presented
  frame.
- `src/keyboard_input.gs` holds the host keyboard table: the sixteen Scratch key names the two pads are
  driven from, and the sampler that turns the keys held down into the two button masks `controller.gs`
  reports. The run loop calls it once per chunk of emulated cycles.
- `src/numeric.gs` holds the bit-free byte, word, and bitwise helpers, plus the `cpu_flag` enum. GoboScript
  has no bitwise operators, so masks and shifts are floor division and modulo, and `src/bitwise_tables.gs`
  fills the 256-entry nibble AND table the helpers read instead of walking a bit loop.
- `src/cpu_status.gs` holds status normalization, flag get/set, zero/negative updates, and the stack forms.
- `src/cpu_alu.gs` holds the thirteen ALU operations; each proc leaves its result in `alu_value` and its
  status in `alu_status`.
- `src/controller.gs` holds both serial controller ports.
- `src/cpu_bus.gs` holds the CPU decoder subset: RAM and mirroring, the open-bus latch with driven masks, the
  `$4016`/`$4017` window, and the cartridge window an attached NROM or MMC3 board drives. PPU, APU, and OAM
  DMA behave as absent devices, and the cartridge window stays undriven until a board validates, so its reads
  return the latch and its writes are dropped.
- `src/mapper_004.gs` holds the MMC3 board: the creation checks, the eight banking registers with the masks
  bank data applies to each of them, PRG and CHR bank selection in both modes, the PRG RAM enable and
  write-protect bits, the mirroring register with its four-screen override, the payload and trainer copies,
  the CPU and pattern windows, the four IRQ registers, the PPU A12 observation whose ten-dot low filter
  decides which rising edges clock the scanline counter, and the nonvolatile memory snapshot procs that copy
  the declared NVRAM tail out of each mapped window and restore it back when the buffer holds exactly the
  declared size. The observation itself has no caller yet: the ported PPU that would report addresses and
  dots is not written.
- `src/cartridge_loader.gs` composes the boot path: check the embedded image's signature, copy and parse its
  header, route the mapper selection, then validate, copy, and attach whichever ported board that selection
  names, recording one summary line for the report and reporting the IRQ line the attached cartridge drives.
  The embedded default image is an MMC3 cartridge, so it attaches through the MMC3 path.
- `src/cpu_core.gs` holds the six CPU registers, one logged bus transaction per cycle in `cpu_access_log`,
  fetch byte/word, and push/pop byte/word with status push and restore.
- `src/cpu_addressing.gs` resolves all thirteen addressing modes, including the zero-page and indexed dummy
  reads, the extra cycle when an indexed access crosses a page or writes, and the JMP indirect pointer wrap
  inside one page. An illegal mode and access pair records an error code instead of stopping the project,
  where the TypeScript reference throws.
- `src/cpu_sequence.gs` holds the cycle sequences that do not need opcode decoding: reset, BRK, JSR, RTI,
  RTS, the NMI and IRQ/BRK hardware interrupts, and a relative branch. Opcode fetch stays with the caller,
  because the reference reaches the four instruction sequences through `execute_instruction_cycles`.
- `src/cpu_instruction.gs` executes one instruction: fetch and decode the opcode, then run the sequence for
  the mnemonic. Every official mnemonic is dispatched, including the loads and stores across all twelve memory
  addressing modes, the ALU group, the shifts, rotates, and counters on the accumulator and in memory, the
  transfers, the flag instructions, the stack instructions, the branches, both JMP forms, BRK, JSR, RTI, RTS,
  NOP, and the KIL jam flag. It reports `cpu_instruction_error` for an undecodable opcode, an unofficial
  opcode, an unresolved operand, or an operand kind a mnemonic cannot use. Unofficial opcodes other than KIL
  and the unstable high-byte stores are not ported.
- `src/cpu_control.gs` picks the next sequence: a jam, a latched NMI, an asserted IRQ line the
  interrupt-disable flag does not mask, or one instruction. It holds the NMI latch, the level-sensitive IRQ
  input, the jam vector reads (three the first time the CPU jams, one afterwards), the reset-shaped state
  clear, and the one-instruction IRQ poll mask that CLI, SEI, and PLP leave behind, which is what delays an
  IRQ after CLI and lets an already pending IRQ through after SEI. DMA stalls and the yield policy a frame
  loop needs are not ported.
- `src/mapper.gs` routes a cartridge by an exact mapper and submapper pair, never by a default, and reports
  whether the mapper or the submapper is the unsupported half. It also sums two declared memory sizes and
  reports -1 when either one is unusable, which stands in for the reference's null sum.
- `src/mapper_000.gs` validates a parsed header as an NROM board in the reference's check order: board
  family, 16 KiB or 32 KiB of PRG ROM, at most 8 KiB of summed PRG RAM and NVRAM, a trainer that needs PRG
  RAM, and either exactly 8 KiB of CHR ROM with no CHR RAM or up to 8 KiB of CHR RAM with no CHR ROM. It
  reports the two memory sizes an accepted board would map. The reference's 512-byte trainer length check is
  not ported, because the parser only ever reports a 512-byte trainer. The same header holds the board's
  memory: both ROM lists are sized to the declared payload and zero-filled, both RAM regions are allocated at
  their full window and alias modulo the mapped size, `nrom_load_payload` copies PRG ROM, CHR ROM, and the
  trainer into PRG RAM at offset `$1000`, and the CPU and pattern windows report a mapped flag, a byte, and
  the driven bits instead of returning a null read. The NVRAM snapshots and the `cpu_bus.gs` hookup are not
  ported.
- `src/cpu_opcode.gs` decodes one opcode byte through the generated `data/opcode_table.txt`: the 76-name
  mnemonic enum whose ids come from the canonical fixture, the record offset `3 + opcode * 6`, a length and
  header check that reports a table which failed to load, and the six decoded fields. Dispatch and
  per-instruction execution are not ported.
- `src/cartridge.gs` parses both header versions into the `cartridge_*` result globals: signature, version,
  mapper and submapper, mirroring, battery, trainer, PRG/CHR ROM sizes including the NES 2.0 exponent form,
  the four RAM/NVRAM sizes, and the trainer/PRG/CHR offsets. Failures set one numeric error code and leave
  every field at zero. Payload copying, RAM backing storage, and mapper dispatch are not ported.
- `src/rom_loader.gs` loads the generated ROM list, checks the iNES signature, copies the embedded header into
  the parser, and writes the summary text the self test reports.
- `src/shared_vectors.gs` loads the generated port-vector list.
- `src/vector_selftest.gs` walks that list, executes every ported suite, counts suites 2 (CPU state) and 4
  (mapper selection) as skipped, and writes the summary variables the sprite reports.
- `assets/` holds costume and other compiler-packaged assets.
- `data/test_rom_bytes.txt` is generated from the default fixture or an explicitly selected build-time ROM
  before a build.
- `data/shared_port_vectors.txt` is generated from the canonical JSON fixture and executed by the self test
  once the project can be compiled.
- `data/opcode_table.txt` is generated from `tests/fixtures/goboscript/opcode_table.json`, the integer form of
  `CPU_OPCODE_TABLE`, and is not read by any `.gs` source yet.
- `goboscript.toml` pins the standard library and requests TurboWarp settings.
- `NOTES.md` is embedded in the compiled project as its notes and records the current port scope.

Keep helper `.gs` files in subdirectories. A new `.gs` file in the project root becomes a new sprite unless
it is the special `stage.gs` file. `tests/goboscript-source.test.ts` enforces the layout rules above, the
upstream grammar shape, proc and func call shapes and argument counts, the rules that a cycle-spending helper is
never nested inside another call's arguments and that an argument is only read through `$`, and name/arity
parity with
`tests/support/goboscript_port_algorithms.ts`.

## Build products and ownership

| Path | Source of truth | Checked in |
| --- | --- | --- |
| `src/**/*.ts` | TypeScript emulator implementation | Yes |
| `tests/**/*.ts` | TypeScript behavior tests | Yes |
| `scratch/**/*.gs` | GoboScript port | Yes |
| `scratch/assets/` | source art/assets | Yes |
| `test_rom.nes` | supplied fixture | Yes, pre-existing |
| `scratch/data/test_rom_bytes.txt` | selected ROM plus generator script (default: `test_rom.nes`) | No |
| `scratch/data/shared_port_vectors.txt` | canonical JSON fixture plus generator script | No |
| `scratch/data/opcode_table.txt` | canonical JSON fixture plus generator script | No |
| `tests/fixtures/goboscript/opcode_table.json` | `src/nes/cpu/opcode_table.ts`, checked by a parity test | Yes |
| `scratch/*.sb3` | GoboScript compiler output | No |
| `dist/` | TypeScript compiler output | No |
| `node_modules/` | npm dependencies | No |

Do not edit generated ROM or vector text by hand. Recreate them with `npm run scratch:assets` and
`npm run scratch:vectors`.
