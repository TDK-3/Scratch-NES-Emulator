# Shared TypeScript/GoboScript port vectors

## Source and generation

`tests/fixtures/goboscript/shared_port_vectors.json` is the canonical, reviewable contract. It contains numeric
inputs and expected outputs for eight suites and 274 records. TypeScript regression tests execute each vector
against the production reference modules in `tests/shared-port-vectors.test.ts`, and the GoboScript self test in
`scratch/src/vector_selftest.gs` executes the same records against the ported modules inside the Scratch
project.

Generate the file-backed GoboScript list with:

```bash
npm run scratch:vectors
```

This writes the ignored file `scratch/data/shared_port_vectors.txt` (2,808 decimal values for the current
fixture). The generator accepts `--output PATH` for isolated validation, verifies the fixture schema and integer
values, refuses to overwrite the canonical fixture even through a symlink or hardlink, and checks that its
decimal output exactly reconstructs the flattened data. `scratch/src/shared_vectors.gs` loads the generated list
into the project. `npm run build:scratch` generates both the ROM list and this vector list before invoking
GoboScript.

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
  replays every numeric, ALU, bus, and controller vector through them, and differentially checks the bus and
  controller mirrors against `NesCpuBus` and `NesControllerPorts`.
- `tests/goboscript-source.test.ts` lints the sources: ASCII only, four-space indentation, no tabs or trailing
  whitespace, 120-column limit, preprocessor directives at column one, `%include` paths that resolve, no
  `return` inside a `proc` (upstream codegen panics), every `func` ending in a `return`, no `local` declared
  inside a loop body, no name colliding with a GoboScript keyword or a Scratch block shape, sprite sources that
  reference only Stage-owned state, every identifier resolvable in its translation unit, and mirror
  name/arity parity for each ported helper.

A pass means the ported arithmetic and the source shape are consistent with the reference. It does not mean the
project compiles, loads in TurboWarp, or meets any performance target.
