# NES 2A03 single-step CPU vectors

## Provenance and license

This project pins selected test cases from the `nes6502/v1` suite in
[SingleStepTests/65x02](https://github.com/SingleStepTests/65x02) at commit
`2f6980a2d95757486c7bee24355c360e40e2a224`. The suite identifies itself as test data for the 6502-derived
RP2A03 CPU used by the NES, with decimal mode disabled. The upstream MIT license at that revision is
reproduced in [`LICENSE`](./LICENSE) (copyright 2024 Thomas Harte et al). The test vectors are data, not ROMs.

The full upstream corpus has 10,000 scenarios per opcode byte, or 2,560,000 scenarios in total. This folder
vendors only the deterministic subset described below; the corpus itself is never committed. Each selected
vector is unchanged from its upstream JSON object; the fixture adds its source path, zero-based array index,
and the SHA-256 of the complete upstream opcode file.

[`SOURCE_MANIFEST.sha256`](./SOURCE_MANIFEST.sha256) records the SHA-256 of all 256 upstream opcode files at
the pinned revision in `sha256sum` format, so any regenerated fixture can be checked against the same source
content.

## Selection rule

Selection is reproducible and not hand-filtered for passing results:

1. Three curated scenarios that target specific documented behavior:
   - `nes6502/v1/6c.json` index 225: JMP indirect page-wrap behavior.
   - `nes6502/v1/bd.json` index 2: LDA absolute,X page crossing.
   - `nes6502/v1/d0.json` index 29: BNE taken across a page.
2. The first four scenarios, in file order, of every one of the 256 opcode files.

That produces 1,026 vectors covering all 256 opcode bytes: 151 official encodings plus all 105 unofficial
encodings, including the unstable `$93`/`$9B`/`$9C`/`$9E`/`$9F` high-byte stores, XAA/LXA, and the twelve
KIL/JAM bytes.

Regenerate with a local corpus checkout (no network access is needed at test time):

```bash
git clone --depth 1 https://github.com/SingleStepTests/65x02.git /tmp/65x02
node scripts/select_cpu_vectors.mjs --corpus /tmp/65x02/nes6502/v1 --per-opcode 4 \
    --extra 6c:225 --extra bd:2 --extra d0:29
```

Recorded hashes for the checked-in fixture:

- `vectors.json` SHA-256: `e1852307fa91c1dd88af080fba11e41b230e5ccee611e268fc235875297cef30`
- `SOURCE_MANIFEST.sha256` SHA-256: `5ca75bdd514b851567ff556d678e1b30495645506aa9f637bf16ea49b01da7c4`
- Corpus revision: `2f6980a2d95757486c7bee24355c360e40e2a224`

## Automated setup and expected result

No network access, ROM download, or external runtime is required. Run:

```bash
npm test
```

`tests/cpu-single-step-vectors.test.ts` seeds a fake 64 KiB CPU bus from each vector's `initial` RAM and
register state, then calls `clock_cycle()` once per upstream bus operation. It compares every returned access
and sequence boundary, the final registers, and the listed final RAM against the upstream `cycles` and
`final` fields, and asserts that the fixture's recorded source hashes agree with the manifest. The expected
result is **1,026 of 1,026 pinned vectors pass**, reported as 257 grouped tests (one per opcode file plus one
coverage test).

This subset is a committed regression fixture, not full conformance: it does not exercise interrupts, `$4014`
OAM DMA, DMC stalls, PPU/APU interaction, or console scheduling. Passing it does not establish hardware
timing accuracy or prove that a complete NES boots.

## Optional full-corpus check

`scripts/run_cpu_vector_corpus.mjs` runs the complete upstream corpus against the same cycle-visible CPU
core. It is opt-in because the corpus is 1.2 GB and is not vendored:

```bash
npm run test:cpu-corpus -- --corpus /tmp/65x02/nes6502/v1
npm run test:cpu-corpus -- --corpus /tmp/65x02/nes6502/v1 --per-opcode 25 --opcodes 69,93
```

Recorded run on 2026-10-18 in the project sandbox (Node.js v22.22.3, two available CPUs):
**2,560,000 of 2,560,000 vectors passed** across all 256 opcode files in about 20 seconds, comparing ordered
bus accesses, final registers, and final RAM. The runner exits non-zero on any mismatch, and its detection
path was checked by deliberately mutating register, bus-value, and cycle-count fields in a scratch copy of
three corpus files.

Two implementation notes follow from that comparison:

- The KIL/JAM bus pattern now matches the corpus convention: after fetching the KIL byte and the next byte,
  the chip reads `$FFFF`, `$FFFE`, `$FFFE`, and then `$FFFF` repeatedly, with the program counter left past
  the KIL byte, until reset. A jammed chip's external bus activity is not hardware-verified; this is a
  reference-matched convention, and each jam sequence stays bounded so `step()` cannot loop forever.
- The default XAA/LXA magic input of `$EE` agrees with all 20,000 pinned upstream `$8B`/`$AB` scenarios. The
  analog variation of those opcodes on real silicon is still unmodeled.

The corpus is generated from a reference emulator, not from silicon, so agreement is cross-implementation
evidence rather than a hardware measurement.
