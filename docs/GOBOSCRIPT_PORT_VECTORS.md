# Shared TypeScript/GoboScript port vectors

## Source and generation

`tests/fixtures/goboscript/shared_port_vectors.json` is the canonical, reviewable contract. It contains numeric
inputs and expected outputs for fifteen suites and 513 records. TypeScript regression tests execute each vector
against the production reference modules in `tests/shared-port-vectors.test.ts`, and the GoboScript self test in
`scratch/src/vector_selftest.gs` executes the same records against the ported modules inside the Scratch
project.

Generate the file-backed GoboScript list with:

```bash
npm run scratch:vectors
```

This writes the ignored file `scratch/data/shared_port_vectors.txt` (11,040 decimal values for the current
fixture). The generator accepts `--output PATH` for isolated validation, verifies the fixture schema and integer
values, refuses to overwrite the canonical fixture even through a symlink or hardlink, and checks that its
decimal output exactly reconstructs the flattened data. `scratch/src/shared_vectors.gs` loads the generated list
into the project. `npm run build:scratch` generates the ROM list, this vector list, and the opcode decode table
before invoking GoboScript.

## Numeric list format

Every generated value occupies one decimal line; there are no labels or blank lines. GoboScript lists are
1-indexed. The first two values are the schema version and record count. Each record then has this layout:

```text
suite_id
case_id
operation_id
input_count
expected_count
input values...
expected values...
```

The count fields allow a port to walk the variable-length records using one cursor. Negative test inputs are
kept signed in the fixture and decimal list. Suite and operation IDs are stable within schema version 1, and
`tests/goboscript-source.test.ts` fails when the enum IDs in `scratch/src/vector_selftest.gs` drift from the
suite and operation IDs present in the fixture.

## Suites and coverage

| Suite ID | Suite | Operation ID / input contract | Expected values |
| --- | --- | --- | --- |
| 1 | Numeric helpers | 1: normalize byte; 2: normalize word; 3: signed byte; 4: normalize status; 5: BRK stack status; 6: update Z/N flags; 7: bit at power-of-two weight; 8: bitwise AND; 9: bitwise OR; 10: bitwise XOR; 11: high byte; 12: low byte; 13: join bytes. Inputs are the helper arguments. | One result value. |
| 2 | CPU state | 1: execute one instruction. Inputs: initial PC, A, X, Y, SP, status, program byte count, program bytes, probe address. | Cycle count, PC, A, X, Y, SP, status, probed byte. Includes immediate load, zero-page store, and a page-crossing branch. |
| 3 | CPU bus | 1: replay operations with no device attached. 2: replay operations with live controller ports. Inputs: operation count followed by triples `(kind, address, value)`, where kind 0 reads and kind 1 writes; read value is ignored. | Read count followed by read results. Covers RAM mirroring, retained open bus, dropped writes to unported windows, and the driven-mask merge on `$4016`/`$4017`. |
| 4 | Mapper 4 | 1: apply `(bank register, value)` pairs. 2: input is IRQ latch and minimum low-dot count for each of two A12 rises. | Operation 1 returns the four PRG-window bytes; operation 2 returns IRQ level after each rise. |
| 5 | PPU | 1: inputs are PPUCTRL and number of dots to clock from reset. | Vblank status, first NMI-edge read, and second NMI-edge read. Covers the scheduled vblank edge. |
| 6 | APU | 1: input is register-write count followed by `(address, value)` pairs. | `$4015` status, pulse 1 DAC, and pulse 1 length counter. |
| 7 | Controller | 1: inputs are controller index, button bit mask, and number of serial reads. | Serial D0 values, including trailing 1s. |
| 8 | ALU | 1: ADC; 2: SBC; 3: AND; 4: ORA; 5: EOR; 10: CMP; 11: CPX; 12: CPY; 13: BIT take `(left, right, status)`. 6: ASL; 7: LSR; 8: ROL; 9: ROR; 14: INC; 15: DEC take `(value, status)`. | Result byte and status byte, recorded by executing the matching production instruction on `Cpu2A03`. |
| 9 | Cartridge header | 1: inputs are the declared image length in bytes followed by all 16 header bytes. | Eighteen values: ok, error code, format, mapper, submapper, mirroring, battery, trainer, PRG ROM bytes, CHR ROM bytes, PRG RAM, PRG NVRAM, CHR RAM, CHR NVRAM, trainer offset, PRG offset, CHR offset, payload end. Recorded by executing `parse_ines_rom` in `src/nes/cartridge/ines.ts`. |
| 10 | CPU addressing | Operation id is the addressing mode (1-13). Inputs: access kind, PC, A, X, Y, SP, status, setup count, then `(address, value)` pairs. | Resolved operand kind, mode, access, base address, address, value, page crossed, error code, cycles, final PC, final SP, then one `(kind, address, value)` triple per bus access. Recorded by executing `Cpu2A03.resolve_addressing_mode()` behind a fresh decoder with no devices. |
| 11 | CPU cycle sequence | Operation id is the sequence (1 reset, 2 BRK, 3 JSR, 4 RTI, 5 RTS, 6 IRQ, 7 NMI, 8 relative branch). Inputs: PC, A, X, Y, SP, status, taken flag, setup count, then `(address, value)` pairs. | Cycles, final PC, SP, status, A, X, Y, sequence error code, then one `(kind, address, value)` triple per bus access. Recorded by executing `Cpu2A03.reset()` or `step()` behind a fresh decoder with no devices. |
| 12 | Opcode decode | 1: input is one opcode byte. | Mnemonic id, addressing mode id, base cycles, operand access id, page-cross cycle flag, official flag, and decoder error code, read from `CPU_OPCODE_TABLE` in `src/nes/cpu/opcode_table.ts` and encoded by `tests/fixtures/goboscript/opcode_table.json`. |
| 13 | Instruction execution | 1: inputs are PC, A, X, Y, SP, status, a program byte count, a setup count, that many program bytes at PC, and that many `(address, value)` setup pairs. | Cycles, final PC, SP, status, A, X, Y, instruction error code, then one `(kind, address, value)` triple per bus access. Recorded by executing `Cpu2A03.step()` behind a fresh decoder with no devices. |
| 14 | Control loop | 1: inputs are PC, A, X, Y, SP, status, the pending-NMI flag, the IRQ line level, a step count, the step before which an NMI is requested, the step before which the IRQ line is asserted, a program byte count, a setup count, that many program bytes at PC, and that many `(address, value)` setup pairs. | Cycles, final PC, SP, status, A, X, Y, instruction error code, one sequence kind per step (1 instruction, 2 IRQ, 3 jam, 4 NMI, 5 reset), then one `(kind, address, value)` triple per bus access. Recorded by driving `Cpu2A03.clock_cycle()` step by step behind a fresh decoder with no devices, so the kinds come from the public cycle result. |
| 15 | NROM board | 1: inputs are the declared image length in bytes followed by all 16 header bytes, as for suite 9. | Seven values: ok, board error code (1 unsupported mapper, 2 unsupported submapper, 3 wrong board family, 4 unsupported PRG ROM size, 5 unsupported PRG RAM size, 6 unsupported trainer, 7 unsupported CHR memory), board kind, mapped PRG RAM bytes, mapped CHR RAM bytes, selection kind, and selection error code. Recorded by running `resolve_mapper` and `NromMapper.create` in `src/nes/cartridge/mapper_000.ts`, with the two mapped sizes measured through the public CPU and pattern ports by aliasing. |

Suite 9 encodes its enumerations as integers because a Scratch list holds only numbers: error codes are
1 truncated header, 2 invalid magic, 3 unsupported version, 4 invalid ROM size, 5 image too large, and
6 truncated payload; formats are 1 iNES 1.0 and 2 NES 2.0; mirroring is 1 horizontal, 2 vertical, and
3 four-screen. A rejected header zeroes every field except the error code, so a failure stays a deterministic
record on both sides. The suite reaches `image-too-large` with a short image plus a NES 2.0 header that
declares a huge PRG size, which keeps the recorded images small.

Suite 10's operation id is the addressing mode (1 implied, 2 accumulator, 3 immediate, 4 relative, 5 zero page,
6 zero page X, 7 zero page Y, 8 absolute, 9 absolute X, 10 absolute Y, 11 indirect, 12 indexed indirect,
13 indirect indexed), and its inputs are the access kind (1 read, 2 write, 3 read-modify-write), PC, A, X, Y,
SP, status, a setup count, and that many `(address, value)` pairs written to the decoder before the
resolution. Setup writes spend no cycles on either side. The expected values are the resolved operand (kind,
mode, access, base address, address, value, page crossed, error code, cycles, final PC, final SP) followed by
one `(kind, address, value)` triple per bus access, so dummy reads, their addresses, and the cycle count are
pinned with the operand. Records were derived by executing `Cpu2A03.resolve_addressing_mode()` behind a fresh
`NesCpuBus` with no devices attached, and none of them may touch `$4000-$401F`, which the reference test
asserts, because the ported decoder always has live controller ports.

Suite 11 records whole cycle sequences rather than single operand resolutions. Sequences 2 through 5 and 8 are
instruction sequences, so their setup bytes hold the opcode at the program counter and the recorded trace
includes the opcode fetch that `execute_instruction_cycles` performs before the ported sequence starts; reset
and the two hardware interrupts fetch no opcode. Sequence 8 records a BCC, so the taken input has to agree with
the carry flag in the status input, which the projection enforces. The records cover the reset stack-pointer
decrement and its wrap through page one, the BRK status byte with and without the break flag already set, the
JSR push of the high operand address, the RTI restore of a popped status that had break set, the RTS read of
the return address, IRQ acceptance with interrupt disable clear, NMI acceptance with it set, and a branch that
is taken inside one page, taken across a page, and not taken. Their vector reads of `$FFFA`-`$FFFF` return open
bus, because no cartridge is attached on either side, which also pins the open-bus latch that the pushes drive.

Suite 12 pins the decode step alone: one opcode byte in, six table fields plus an error code out. Its 20
records cover one official opcode per addressing mode plus the boundaries that matter for dispatch, namely the
page-cross flag set on an indexed read and clear on an indexed read-modify-write and on a write, an unofficial
KIL, the unofficial ISC and SHY encodings, JMP absolute and JMP indirect, RTS, and NOP. The mnemonic, mode, and
access ids are the same integers the ported enums use, so each record also checks that
`scratch/src/cpu_opcode.gs` and `scratch/src/cpu_addressing.gs` agree on numbering. Expected values come from
`CPU_OPCODE_TABLE` through `tests/support/cpu_opcode_projection.ts`, and the mirror decoder compares all 256
opcodes against the generated table rather than only these 20.

Suite 13 executes one whole instruction per record, opcode fetch included, so its trace starts at the fetch
and its cycle count is the instruction's. The 99 records cover every group the ported dispatcher reaches: the
six register transfers with their zero and wrap boundaries, TXS, INX, DEX, INY, DEY, NOP, the seven flag
instructions, the four stack instructions with a prepared stack byte, all eight branches taken plus a
not-taken and a page-crossing BNE, JMP absolute and JMP indirect, BRK, JSR, RTS, RTI, and a KIL jam; every
load and store across immediate, zero page, zero page indexed, absolute, absolute indexed with and without a
page crossing, indexed indirect, and indirect indexed; ADC, SBC, AND, ORA, EOR, CMP, CPX, CPY, and BIT with
their carry, borrow, overflow, and zero boundaries; and ASL, LSR, ROL, ROR, INC, and DEC on the accumulator and
in memory, where the read-modify-write records pin the read, the write-back of the original byte, and the write
of the modified one. One record documents a refusal: an unofficial SLO reports `unofficial_opcode` after
spending only its opcode fetch, so an instruction the port does not execute cannot pass as executed. The
refusal a record documents is derived in the reference test from the production table and
`CPU_INSTRUCTION_PORTED_MNEMONICS`, never copied from the expected values, and the projection rejects a record
whose refusal the table does not justify.

Operation 1 of suite 3 replays against a decoder with no devices attached, while the GoboScript port always has
live controller ports; suite 3 operation 1 records therefore must not read `$4016`/`$4017`, and
`tests/shared-port-vectors.test.ts` asserts that constraint. Use operation 2 for controller-window reads.

These are parity anchors, not conformance suites. They exercise one important boundary per domain and are
expected to grow as GoboScript implementations are ported. Passing the vectors does not establish full
CPU/PPU/APU/mapper compatibility or cycle accuracy. Keep expected values reviewed and deterministic; update the
fixture intentionally when a behavior contract changes, then rerun `npm test` and the list generator. Derive new
expected values by executing the TypeScript reference, never by hand.

## How the port is validated without a compiler

The pinned GoboScript toolchain requires Cargo and rustc, which are not obtainable in this environment, so the
`.gs` sources have never been compiled and the in-project self test has never run. Two TypeScript-side checks
stand in for that until the toolchain is available:

- `tests/support/goboscript_port_algorithms.ts` mirrors every ported helper in integer-only TypeScript, using
  Scratch's floored modulo and floor division instead of ECMAScript operators and no bitwise operators at all.
  `tests/goboscript-port-algorithms.test.ts` compares those mirrors exhaustively against the bitwise reference
  in `src/nes/cpu/registers.ts`, `src/nes/cpu/alu.ts`, and the instruction steps of `src/nes/cpu/cpu_2a03.ts`,
  replays every numeric, ALU, bus, controller, cartridge, addressing, sequence, opcode, instruction, and
  control-loop and board-validation vector through them, and
  differentially checks the bus, controller, cartridge, and CPU mirrors against `NesCpuBus`,
  `NesControllerPorts`, and `Cpu2A03`. The
  CPU mirror is `GoboscriptCpuCore`, which reproduces the register state, one logged bus transaction per
  cycle, program-counter fetches, the four stack operations, all thirteen addressing modes, and the reset,
  BRK, JSR, RTI, RTS, IRQ, NMI, and relative-branch sequences; it is
  compared against `Cpu2A03.resolve_addressing_mode()` through
  `tests/support/cpu_addressing_projection.ts`, against `Cpu2A03.reset()` and `step()` through
  `tests/support/cpu_sequence_projection.ts`, against `Cpu2A03.step()` for one whole instruction through
  `tests/support/cpu_instruction_projection.ts`, against a step-by-step `Cpu2A03.clock_cycle()` drive for the
  control loop through `tests/support/cpu_control_projection.ts`, and its stack transactions are compared
  against the bus
  traces of real PHA, PLA, JSR, RTS, BRK, and RTI instructions. Both CPU projections share the bus recorder
  and absent-device factory in `tests/support/recording_cpu_bus.ts`. The cartridge mirror is
  `GoboscriptCartridgeParser`, which is compared against `parse_ines_rom` for every `flags6` byte, every
  `flags7` byte, every legacy PRG RAM bank count, every NES 2.0 mapper and RAM byte, and all 4,096 encoded
  NES 2.0 ROM sizes, through the shared projection in `tests/support/cartridge_projection.ts`. The opcode
  mirror is `GoboscriptCpuOpcodeDecoder`, which reads the same flat list the generator writes and is compared
  with `CPU_OPCODE_TABLE` for all 256 opcodes through `tests/support/cpu_opcode_projection.ts`, including the
  length and header checks that report a truncated, reversioned, or missing table. Instruction dispatch is
  mirrored inside `GoboscriptCpuCore.execute_instruction()`, which composes the decoder, the operand resolver,
  the sequences, and the status helpers, replays every suite 13 record, and executes all 151 official opcodes
  while refusing the 104 unofficial ones other than KIL; the source lint additionally
  compares the mnemonics named in the `.gs` dispatch chains with the mirror's `CPU_MNEMONIC` ids and with the
  projection's ported set, so the three cannot drift. The control loop is mirrored in
  `GoboscriptCpuCore.begin_next_sequence()`, which composes the jam sequence, the NMI latch, the IRQ line,
  the poll mask CLI, SEI, and PLP leave behind, and the instruction dispatcher, and replays every suite 14
  record; the source lint also compares the ported `cpu_sequence_kind` enum with the projection's ids.
  Mapper selection and NROM board validation are mirrored in `GoboscriptMapperSelection` and
  `GoboscriptNromMapper`, which replay every suite 15 record and are swept against `resolve_mapper` for all
  4,096 mapper and submapper pairs.
- `tests/goboscript-source.test.ts` lints the sources: ASCII only, four-space indentation, no tabs or trailing
  whitespace, 120-column limit, preprocessor directives at column one, `%include` paths that resolve, no
  `return` inside a `proc` (upstream codegen panics), every `func` ending in a `return`, no `local` declared
  inside a loop body, no name colliding with a GoboScript keyword or a Scratch block shape, sprite sources that
  reference only Stage-owned state, every identifier resolvable in its translation unit, mirror name/arity
  parity for each ported helper, and call shapes: a `proc` must be called as `name arg1, arg2;` without
  parentheses and a `func` as `name(arg1, arg2)`, each with its declared argument count. Two more shape rules
  come from how the compiler lowers calls: an argument may only be read as `$name`, because a bare name becomes
  an unrelated variable lookup, and no cycle-spending helper may be nested inside another call's arguments,
  because an expression-position `func` call is hoisted in front of the enclosing statement.

A pass means the ported arithmetic and the source shape are consistent with the reference. It does not mean the
project compiles, loads in TurboWarp, or meets any performance target.
