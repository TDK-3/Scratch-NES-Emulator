# Shared TypeScript/GoboScript port vectors

## Source and generation

`tests/fixtures/goboscript/shared_port_vectors.json` is the canonical, reviewable contract. It contains numeric
inputs and expected outputs for seven suites. TypeScript regression tests execute each vector against the
production reference modules in `tests/shared-port-vectors.test.ts`.

Generate the file-backed GoboScript list with:

```bash
npm run scratch:vectors
```

This writes the ignored file `scratch/data/shared_port_vectors.txt`. The generator accepts `--output PATH` for
isolated validation, verifies the fixture schema and integer values, and checks that its decimal output exactly
reconstructs the flattened data. `scratch/src/shared_vectors.gs` loads the generated list into the project.
`npm run build:scratch` generates both the ROM list and this vector list before invoking GoboScript.

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
kept signed in the fixture and decimal list. Suite and operation IDs are stable within schema version 1.

## Suites and initial coverage

| Suite ID | Suite | Operation ID / input contract | Expected values |
| --- | --- | --- | --- |
| 1 | Numeric helpers | 1: normalize byte; 2: normalize word; 3: signed byte; 4: normalize status; 5: BRK stack status; 6: update Z/N flags. Inputs are the helper arguments. | One result value. |
| 2 | CPU state | 1: execute one instruction. Inputs: initial PC, A, X, Y, SP, status, program byte count, program bytes, probe address. | Cycle count, PC, A, X, Y, SP, status, probed byte. Includes immediate load, zero-page store, and a page-crossing branch. |
| 3 | CPU bus | 1: replay operations. Inputs: operation count followed by triples `(kind, address, value)`, where kind 0 reads and kind 1 writes; read value is ignored. | Read count followed by read results. Covers RAM mirroring and retained open bus. |
| 4 | Mapper 4 | 1: apply `(bank register, value)` pairs. 2: input is IRQ latch and minimum low-dot count for each of two A12 rises. | Operation 1 returns the four PRG-window bytes; operation 2 returns IRQ level after each rise. |
| 5 | PPU | 1: inputs are PPUCTRL and number of dots to clock from reset. | Vblank status, first NMI-edge read, and second NMI-edge read. Covers the scheduled vblank edge. |
| 6 | APU | 1: input is register-write count followed by `(address, value)` pairs. | `$4015` status, pulse 1 DAC, and pulse 1 length counter. |
| 7 | Controller | 1: inputs are controller index, button bit mask, and number of serial reads. | Serial D0 values, including trailing 1s. |

These are small parity anchors, not conformance suites. They exercise one important boundary per domain and
are expected to grow as GoboScript implementations are ported. Passing the vectors does not establish full
CPU/PPU/APU/mapper compatibility or cycle accuracy. Keep expected values reviewed and deterministic; update
the fixture intentionally when a behavior contract changes, then rerun `npm test` and the list generator.
