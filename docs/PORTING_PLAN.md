# TypeScript to GoboScript port plan

## Principle

GoboScript is not a source-to-source compiler for the TypeScript emulator. It compiles its own language to
Scratch blocks. Each subsystem therefore has a TypeScript reference implementation and a separately written
GoboScript implementation. The two implementations stay aligned through shared contracts, small test
vectors, and recorded TurboWarp results.

## ROM deployment decision

The initial deployment is build-time bundling, not a runtime ROM picker. This works for standard Scratch and
TurboWarp without assuming access to arbitrary local binary files, network fetch permissions, or a custom
extension. The generator converts a selected iNES image into `scratch/data/test_rom_bytes.txt`, which the
GoboScript project includes as a static list; each compiled `.sb3` is therefore tied to one ROM.

`test_rom.nes` remains the default input. A different local image can be selected with
`npm run scratch:assets -- --rom /path/to/rom.nes`; run `cd scratch && goboscript build` afterward to embed it.
The generator byte-checks its output and supports `--output` for isolated validation. Generated lists and
`.sb3` files remain untracked. The build-time path is implemented and tested, but the GoboScript compiler is
not installed in this environment, so `.sb3` output has not been validated. Review ROM rights before sharing
an embedded project. A TurboWarp-only runtime loader is deferred and would require a separately documented
host adapter and capability/permission validation.

## Port order

1. **Compiler and project smoke test.** Install the official GoboScript compiler, build `scratch/`, and
   confirm that the generated `.sb3` opens in TurboWarp. Blocked: the pinned toolchain needs Cargo and
   rustc, which are not obtainable here, so no `.gs` source in this repository has been compiled.
2. **Numeric primitives.** Port byte normalization, 16-bit wrap, signed-byte conversion, bit tests, flag
   helpers, and address arithmetic. Compare exhaustive byte inputs where practical. Sources written in
   `scratch/src/numeric.gs`; algorithms validated exhaustively through the TypeScript mirror, compile and
   runtime validation still blocked by step 1.
3. **Cartridge metadata.** Port supported header parsing, sizes, trainer offsets, mapper selection, and
   error reporting. Keep TypeScript as the source-of-truth parser until the port handles every shared
   vector. Only the iNES signature check is ported today.
4. **CPU scaffolding.** Port register reset, stack operations, status flags, addressing modes, official
   instructions, cycle counts, and interrupts in separately testable groups. Status flags
   (`scratch/src/cpu_status.gs`) and the thirteen ALU operations (`scratch/src/cpu_alu.gs`) are written;
   fetch, decode, addressing modes, cycle accounting, stack operations, and interrupts are not.
5. **CPU bus and NROM.** Exercise RAM mirroring, PPU register dispatch, and a minimal mapper. Use a fake
   bus for CPU unit tests and real bus tests for integration. `scratch/src/cpu_bus.gs` ports RAM
   mirroring, the open-bus latch with driven masks, and the `$4016`/`$4017` window; PPU, APU, OAM DMA,
   and cartridge windows are stubbed as absent devices. No mapper is ported.
6. **Mapper 4.** Port the tested TypeScript MMC3 reference behavior needed by the supplied fixture:
   PRG/CHR bank switching, mirroring/PRG-RAM controls, and IRQ counting on PPU A12 rising edges after the
   required low-dot filter. A mapper 0 smoke test cannot substitute for this step.
7. **PPU, controllers, and APU.** Port state and timing in small slices. Keep graphics/audio runtime glue
   outside the hardware state machines. Both serial controller ports are written in
   `scratch/src/controller.gs`; PPU and APU are not started.
8. **Frame output and performance.** Compare candidate rendering strategies in TurboWarp. Do not freeze
   an expensive pixel-by-pixel design before measuring it.
9. **Compatibility and release.** Run the same deterministic vectors and selected hardware test ROMs
   against both implementations. Record unsupported mappers and any accuracy/performance limits.

## Current port state

`scratch/stage.gs` includes the ported headers and runs `run_port_self_test` on the green flag, which walks
the generated vector list, executes every record for the ported suites, counts the unported suites as
skipped, and broadcasts a summary that `scratch/main.gs` reports. Shared variables, lists, and enums are
declared only in Stage-included headers, because a sprite resolves those names from the Stage while a proc or
func is compiled separately into each target that includes it.

| Module | Ported | Not ported |
| --- | --- | --- |
| `src/numeric.gs` | byte/word wrap, signed byte, high/low byte, join, `bit_at`, AND/OR/XOR loops | byte-wide AND/OR/XOR variants pending benchmarking |
| `src/cpu_status.gs` | normalize, get/set flag, Z/N update, BRK and stack forms | nothing |
| `src/cpu_alu.gs` | ADC, SBC, AND, ORA, EOR, ASL, LSR, ROL, ROR, CMP, CPX, CPY, BIT, INC, DEC | unofficial ALU combinations |
| `src/controller.gs` | strobe, falling-edge latch, serial reads with trailing 1s, both ports | four-score, Zapper, Power Pad, microphone |
| `src/cpu_bus.gs` | RAM and mirroring, open-bus latch, driven-mask merge, `$4016`/`$4017` | PPU, APU, `$4014` OAM DMA, cartridge, cycle counting |
| `src/rom_loader.gs` | iNES signature check, header state text | header parsing, mapper selection, trainers |
| `src/vector_selftest.gs` | suites 1, 3, 7, 8 | suites 2 (CPU), 4 (MMC3), 5 (PPU), 6 (APU) are counted as skipped |

Overflow for ADC/SBC is derived from signed arithmetic rather than bit masks, and every mask or shift is
floor division and modulo, because GoboScript exposes no bitwise operators and its `%` and `//` are Scratch's
floored forms. `tests/support/goboscript_port_algorithms.ts` mirrors all of it in integer-only TypeScript and
`tests/goboscript-port-algorithms.test.ts` compares the mirror exhaustively with the bitwise reference, so a
divergence in the ported arithmetic fails in Node even though the `.gs` sources cannot be compiled here.

## Semantic mapping

| TypeScript | GoboScript / Scratch | Porting rule |
| --- | --- | --- |
| Typed arrays | Scratch lists/scalars | Wrap bytes explicitly; lists are 1-indexed. |
| `array[index]` | `list[index + 1]` | Convert at one helper boundary and test the edges. |
| Bitwise operations | Arithmetic or lookup helpers | GoboScript `&` joins strings; reimplement and test masks. |
| Booleans | Scratch values; `true` / `false` become 1 / 0 | Compare numeric flags explicitly. |
| `switch` / enum | `if` / `elif` or enum value | Benchmark large dispatch chains. |
| Returning function | GoboScript `func` | Always no-refresh; call only from no-refresh code and end with `return`. |
| Stateful routine | `proc` and shared state | Choose yield points deliberately. |
| TypeScript module | `.gs` include header | `%include` is compile-time, not a runtime module system. |
| Binary ROM input | Generated text list | Preserve the `.nes` file and regenerate decimal data. |
| Expected input error | Result field / status code | Report unsupported data instead of stopping the project. |
| Browser graphics/audio | Scratch / TurboWarp adapter | Separate from hardware; validate the runtime. |

## Shared vectors

The parity contract is in [`GOBOSCRIPT_PORT_VECTORS.md`](GOBOSCRIPT_PORT_VECTORS.md), with canonical cases at
`tests/fixtures/goboscript/shared_port_vectors.json`: eight suites and 274 records covering byte/word/status
and bit helpers, instruction results and cycles, CPU-bus mirroring, open bus, and driven-mask controller
reads, MMC3 PRG banks and filtered IRQ edges, scheduled PPU vblank/NMI, pulse APU status, serial controller
reads, and per-instruction ALU value/status results. Node tests run those vectors against the production
TypeScript modules, the TypeScript mirror of the ported algorithms replays them as well, and
`npm run scratch:vectors` generates the ignored one-value-per-line list loaded by
`scratch/src/shared_vectors.gs`.

This is a small initial anchor, not exhaustive coverage. Grow the suites with additional bank boundaries,
write protection, interrupt state, PPU event ordering, APU/DMC output, and controller/open-bus cases before
claiming subsystem parity. Keep inputs, expected results, side effects, and cycle counts numeric and define
field order in the schema note. Do not make tests depend on wall-clock time, random runtime state, project
frame rate, or visual inspection alone.

## Scratch-specific implementation rules

- Use one-based list positions deliberately. Names such as `cpu_ram`, `ppu_vram`, `oam`, and
  `pattern_data` should identify hardware storage.
- Preallocate fixed-size storage and overwrite it. Avoid list insertions in hot emulation loops.
- Avoid recursion and high-allocation patterns.
- Split large loops into scheduled chunks only at documented emulator boundaries. Yielding every cycle can
  make the emulator too slow; never-yielding forever can make it unresponsive.
- Treat GoboScript compile-time macros as source generation. They cannot replace runtime state
  transitions.
- Hide internal lists from users and expose only status/debug output in development builds.
- Check actual compiled block structure and TurboWarp performance. A concise `.gs` loop can still compile
  into many Scratch blocks.

## Port completion gate

A subsystem is not ported when the source merely compiles. It is ported only after:

1. TypeScript tests pass.
2. The GoboScript implementation compiles with the pinned toolchain.
3. Shared vectors produce the same results in both implementations.
4. The compiled project runs in the target TurboWarp version without hangs or corrupt state.
5. Performance measurements meet the subsystem budget or a known limit is documented.
6. The progress and compatibility docs reflect what was actually tested.

No subsystem has passed this gate yet. Gate 1 passes for the ported helpers, and gate 3 is partially
substituted by running the vectors through the TypeScript mirror of the ported algorithms; gates 2, 4, and 5
remain blocked on the unavailable compiler and runtime, so nothing in `scratch/` may be described as working
in Scratch or TurboWarp.
