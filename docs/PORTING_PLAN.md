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
   vector. `scratch/src/cartridge.gs` now parses both header versions: signature, version bits, mapper and
   submapper, mirroring, battery, trainer, PRG/CHR sizes including the NES 2.0 exponent form, the four
   RAM/NVRAM sizes, and the trainer/PRG/CHR offsets, reporting failures as numeric codes in TypeScript
   check order. It replays all 25 suite-9 vectors. `scratch/src/mapper.gs` routes an exact mapper and
   submapper pair and reports which half of it is unsupported, and `scratch/src/mapper_000.gs` applies the
   NROM board checks in the reference's order and reports the PRG RAM and CHR RAM bytes the board would map;
   together they replay all 25 suite-15 vectors. `scratch/src/mapper_000.gs` also holds the board's memory:
   `nrom_load_payload` copies PRG ROM, CHR ROM, and the trainer into PRG RAM at offset `$1000` out of the
   generated cartridge list, and the CPU and pattern windows answer reads and writes with PRG ROM mirroring
   modulo its size and the writable RAM regions aliasing modulo the mapped size, which the 16 suite-16 vectors
   replay. `scratch/src/cpu_bus.gs` now dispatches its cartridge window to an attached board, and
   `scratch/src/cartridge_loader.gs` composes the boot path (signature, header, validation, payload copy, and
   attachment), which the 12 suite-17 vectors replay against the production bus. `scratch/src/mapper_004.gs`
   adds the MMC3 board: the creation checks, the eight banking registers with the masks bank data applies to
   each of them, PRG and CHR bank selection in both modes, the PRG RAM enable and write-protect bits, the
   mirroring register with its four-screen override, the payload and trainer copies, and the CPU and pattern
   windows, which the 21 suite-18 vectors replay; the loader attaches it, so the embedded MMC3 image now drives
   the bus. Still not ported: the MMC3 IRQ registers and the PPU A12 filter with its ten-dot low window, and
   the NVRAM snapshots of both boards.
4. **CPU scaffolding.** Port register reset, stack operations, status flags, addressing modes, official
   instructions, cycle counts, and interrupts in separately testable groups. Status flags
   (`scratch/src/cpu_status.gs`), the thirteen ALU operations (`scratch/src/cpu_alu.gs`), register state with
   one logged bus transaction per cycle plus fetches and the four stack operations
   (`scratch/src/cpu_core.gs`), and all thirteen addressing modes including dummy reads, the page-crossing
   cycle, and the JMP indirect pointer wrap (`scratch/src/cpu_addressing.gs`) are written and replay all 39
   suite-10 vectors, and the reset, BRK, JSR, RTI, RTS, IRQ, NMI, and relative-branch sequences
   (`scratch/src/cpu_sequence.gs`) replay all 12 suite-11 vectors, and the opcode decode step
   (`scratch/src/cpu_opcode.gs`, reading the generated `data/opcode_table.txt`) replays all 20 suite-12
   vectors. Instruction dispatch (`scratch/src/cpu_instruction.gs`) executes one whole instruction and replays
   all 99 suite-13 vectors, covering every official mnemonic: the transfers, flag instructions, stack
   instructions, branches, jumps, BRK, JSR, RTI, RTS, NOP, the KIL jam flag, the loads and stores across all
   twelve memory addressing modes, the ALU group, and the shifts, rotates, and counters on the accumulator and
   in memory. The control loop (`scratch/src/cpu_control.gs`) picks jam, NMI, IRQ, or one instruction and
   replays all 19 suite-14 vectors, covering the NMI latch, the level-sensitive IRQ line, the jam vector reads,
   the reset-shaped state clear, and the one-instruction IRQ poll mask that CLI, SEI, and PLP leave behind.
   Not ported: unofficial opcodes other than KIL and their unstable high-byte stores, DMA stalls, and the
   yield policy a frame loop needs.
5. **CPU bus and NROM.** Exercise RAM mirroring, PPU register dispatch, and a minimal mapper. Use a fake
   bus for CPU unit tests and real bus tests for integration. `scratch/src/cpu_bus.gs` ports RAM
   mirroring, the open-bus latch with driven masks, the `$4016`/`$4017` window, and a cartridge window an
   attached NROM board drives; PPU, APU, and OAM DMA are stubbed as absent devices.
6. **Mapper 4.** Port the tested TypeScript MMC3 reference behavior needed by the supplied fixture:
   PRG/CHR bank switching, mirroring/PRG-RAM controls, and IRQ counting on PPU A12 rising edges after the
   required low-dot filter. Selection already routes mapper 4 submapper 0 to this family and NROM validation
   reports it as the wrong board, but the board itself is not ported. A mapper 0 smoke test cannot substitute
   for this step.
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
| `src/cpu_bus.gs` | RAM and mirroring, open-bus latch, driven-mask merge, `$4016`/`$4017`, and the cartridge window an attached board drives | PPU, APU, `$4014` OAM DMA, cycle counting |
| `src/cartridge_loader.gs` | the boot path: signature check, header copy and parse, mapper selection, validation and attachment of either ported board, payload copy, and one summary line | runtime ROM selection, and any board the validation rejects |
| `src/cartridge.gs` | iNES 1.0 and NES 2.0 header decode, mapper/submapper, mirroring, battery, trainer flag, ROM and RAM sizes, payload offsets, six numeric error codes | payload copying, RAM/NVRAM storage, mapper dispatch |
| `src/rom_loader.gs` | iNES signature check, header load into the parser, header state text | ROM selection at runtime |
| `src/cpu_core.gs` | register state, one logged bus access per cycle, fetch byte/word, push/pop byte/word, status push and restore | reset sequencing, interrupts, opcode fetch and decode |
| `src/cpu_addressing.gs` | all thirteen addressing modes with dummy reads, page-cross detection, and the JMP indirect pointer wrap | operand read/write/modify helpers, unstable high-byte stores |
| `src/cpu_sequence.gs` | reset, BRK, JSR, RTI, RTS, IRQ, NMI, and relative-branch cycle sequences | opcode fetch and dispatch, and the sequence selection that picks one (`src/cpu_control.gs`) |
| `src/cpu_opcode.gs` | the 76-mnemonic enum, the generated table load with its length and header check, and the six-field decode of one opcode byte | opcode dispatch, per-instruction execution, operand access by mnemonic |
| `src/cpu_instruction.gs` | one whole instruction for all 151 official opcodes: fetch and decode, the KIL jam flag, BRK, JSR, RTI, RTS, the eight branches, both JMP forms, the four stack instructions, the transfers, the flag instructions, INX, DEX, INY, DEY, NOP, the loads and stores, the ALU group, the read-modify-write group, and five numeric refusal codes | unofficial opcodes other than KIL and the unstable high-byte stores |
| `src/cpu_control.gs` | sequence selection (jam, NMI, IRQ, instruction), the NMI latch, the level-sensitive IRQ line, the jam vector reads, the reset-shaped state clear, and the one-instruction IRQ poll mask that CLI, SEI, and PLP leave behind | DMA stalls and the yield policy a frame loop needs |
| `src/mapper.gs` | exact mapper and submapper routing for the two registered boards, the two selection error codes, and the declared-memory size sum | the MMC3 board itself, and any mapper the reference does not register |
| `src/mapper_000.gs` | every NROM creation check in the reference's order, the PRG RAM and CHR RAM bytes the board would map, the payload and trainer copies, and the CPU and pattern address windows with PRG ROM mirroring and aliasing RAM | the NVRAM snapshots and the PPU-side nametable consumer |
| `src/mapper_004.gs` | the MMC3 creation checks, the eight banking registers with their bank-data masks, PRG and CHR bank selection in both modes, the PRG RAM enable and write-protect bits, the mirroring register with its four-screen override, the payload and trainer copies, and the CPU and pattern windows | the IRQ latch, counter, reload, enable, and acknowledge registers, the PPU A12 filter, and the NVRAM snapshots |
| `src/vector_selftest.gs` | suites 1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18 | suites 2 (CPU state), 4 (mapper), 5 (PPU), 6 (APU) are counted as skipped |

Overflow for ADC/SBC is derived from signed arithmetic rather than bit masks, and every mask or shift is
floor division and modulo, because GoboScript exposes no bitwise operators and its `%` and `//` are Scratch's
floored forms. The ported CPU spends one cycle per bus transaction and logs each one to `cpu_access_log`, so a vector pins
access order as well as results. The reference suspends each instruction with a generator so `clock_cycle()`
can expose one transaction at a time; Scratch has no coroutines, so the port performs the same accesses in the
same order without suspending between them. That is exact for CPU state and access order and is an
approximation only for a device that would interleave mid-instruction (today DMC DMA, which is not ported).
The ported PPU will advance by each instruction's cycle count at instruction boundaries, and this note should
be revisited with measurements before any cycle-interleaving claim.

`scratch/src/cartridge.gs` raises powers of two by doubling in a `repeat` loop instead of the
float-based `std/math` helper, and reports `Number.isSafeInteger` loss of precision as a `-1` size that the
caller turns into the invalid-ROM-size code. Procs are called as `name arg1, arg2;` and funcs as
`name(arg1, arg2)`; `tests/goboscript-source.test.ts` enforces both shapes and their argument counts, because
a parenthesized multi-argument proc call does not parse and no compiler is available to report it. `tests/support/goboscript_port_algorithms.ts` mirrors all of it in integer-only TypeScript and
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
`tests/fixtures/goboscript/shared_port_vectors.json`: eighteen suites and 562 records covering byte/word/status
and bit helpers, instruction results and cycles, CPU-bus mirroring, open bus, and driven-mask controller
reads, MMC3 PRG banks and filtered IRQ edges, scheduled PPU vblank/NMI, pulse APU status, serial controller
reads, per-instruction ALU value/status results, iNES/NES 2.0 header decode with its error codes, and
addressing-mode resolution with its bus access trace, and the CPU cycle sequences with theirs. Node tests run those vectors against the production
TypeScript modules, the TypeScript mirror of the ported algorithms replays them as well, and
`npm run scratch:opcode` generates the ignored one-value-per-line opcode decode table loaded by the ported
decoder: `tests/fixtures/goboscript/opcode_table.json` is the canonical integer form of `CPU_OPCODE_TABLE`
(mnemonic id, addressing mode id, base cycles, operand access id, page-cross flag, and official flag for all
256 opcodes), a parity test keeps it equal to the production table, and the generator refuses to overwrite its
own input. The table is reference data, not ported logic: dispatch, flag updates, and cycle accounting stay
hand-written in the `.gs` sources.

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
