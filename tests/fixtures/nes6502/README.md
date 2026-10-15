# NES 2A03 single-step CPU vectors

## Provenance and license

This project includes twenty selected test cases from the `nes6502/v1` suite in
[SingleStepTests/65x02](https://github.com/SingleStepTests/65x02), pinned to commit
`2f6980a2d95757486c7bee24355c360e40e2a224`. The suite identifies itself as test data for the 6502-derived
RP2A03 CPU used by the NES, with decimal mode disabled. The upstream repository's MIT license at that
revision is reproduced in [`LICENSE`](./LICENSE). The test vectors are not ROMs.

The full upstream corpus has 10,000 scenarios per opcode. This repository vendors only the twenty vectors
listed below, not the full corpus. Each selected vector is unchanged from its upstream JSON object; the
fixture adds source path, zero-based array index, and SHA-256 metadata. Hashes below are for the complete
upstream opcode JSON files at the pinned revision, before selecting a case.

- `$00` (`00 35 26`), index 0: BRK stack/vector effects.
  - File `nes6502/v1/00.json`; full-file SHA-256 `992496ca570c8a47c69abcec84c36b7c71e6c1f1129a42afd9129e596840f7b3`.
- `$20` (`20 ab 9d`), index 0: JSR operand fetch and stack ordering.
  - File `nes6502/v1/20.json`; full-file SHA-256 `c012080ae8e7874f10eb039429640ab951fc08a0de5a83fe394abc4312953c46`.
- `$40` (`40 6b a8`), index 0: RTI stack/status restore.
  - File `nes6502/v1/40.json`; full-file SHA-256 `19d59c74ec21d763472fc17d5b2e74fa86f919444dbf6c2bc8babcd7df84b060`.
- `$69` (`69 4a c2`), index 0: ADC immediate flags and binary arithmetic.
  - File `nes6502/v1/69.json`; full-file SHA-256 `8eb25776eb073dfce637c50d3adc5055d5fee7f687d4cafbcad6ae1eab810def`.
- `$6C` (`6c ff f5`), index 225: JMP indirect page-wrap behavior.
  - File `nes6502/v1/6c.json`; full-file SHA-256 `17b88745c723e72cbd2d1d89527845b42509dbe849323bae791e206178fb125c`.
- `$8D` (`8d aa 66`), index 0: STA absolute bus write.
  - File `nes6502/v1/8d.json`; full-file SHA-256 `23c7c683fb39ed05373c04d1d7b62d00529d478796b2765d1089b98f900cb33d`.
- `$A9` (`a9 c3 7a`), index 0: LDA immediate result and flags.
  - File `nes6502/v1/a9.json`; full-file SHA-256 `443c6fb0c69bb164827cb364ffca6ebc0592e3fbe125628448944dd458162257`.
- `$BD` (`bd f5 ba`), index 2: LDA absolute,X page crossing.
  - File `nes6502/v1/bd.json`; full-file SHA-256 `52c2c6697c403b95b548d294ee4d989187833863aac6ba09e9550881e798fbb8`.
- `$D0` (`d0 c6 5d`), index 29: BNE taken across a page.
  - File `nes6502/v1/d0.json`; full-file SHA-256 `87d080ad2d8e49a100d1e78dd56d5da7cc230fbffbde71a080d783b7f239034e`.
- `$E6` (`e6 5f 04`), index 0: INC zero-page read-modify-write sequence.
  - File `nes6502/v1/e6.json`; full-file SHA-256 `e05ea9f6b60d852c0ef075695919d5babffd482a92cdfc5c7494438b5ed7f680`.
- `$93` (`93 2`), index 1: AHX (indirect),Y without a page crossing.
  - File `nes6502/v1/93.json`; full-file SHA-256 `17b5735e981bcd73163acaa7733b1dd6fced3673ebec4562ddeedaf05167862b`.
- `$93` (`93 1`), index 0: AHX (indirect),Y with a page crossing.
  - File `nes6502/v1/93.json`; full-file SHA-256 `17b5735e981bcd73163acaa7733b1dd6fced3673ebec4562ddeedaf05167862b`.
- `$9B` (`9b 1`), index 0: TAS absolute,Y without a page crossing; also checks SP.
  - File `nes6502/v1/9b.json`; full-file SHA-256 `a9892b940da12aa14c08d3c4c062fb804ca6ae568c4416c3408d00467ed05d14`.
- `$9B` (`9b 2`), index 1: TAS absolute,Y with a page crossing; also checks SP.
  - File `nes6502/v1/9b.json`; full-file SHA-256 `a9892b940da12aa14c08d3c4c062fb804ca6ae568c4416c3408d00467ed05d14`.
- `$9C` (`9c 1`), index 0: SHY absolute,X without a page crossing.
  - File `nes6502/v1/9c.json`; full-file SHA-256 `7f86ddc3c8cc4dc4a78763a6fc0a73d473192f273c9be934a94f1beafb73afdd`.
- `$9C` (`9c 2`), index 1: SHY absolute,X with a page crossing.
  - File `nes6502/v1/9c.json`; full-file SHA-256 `7f86ddc3c8cc4dc4a78763a6fc0a73d473192f273c9be934a94f1beafb73afdd`.
- `$9E` (`9e 1`), index 0: SHX absolute,Y without a page crossing.
  - File `nes6502/v1/9e.json`; full-file SHA-256 `7399fe1afcd91c5abb584096101fc5ce526198717a8855c6f983f8fdb81dbf23`.
- `$9E` (`9e 2`), index 1: SHX absolute,Y with a page crossing.
  - File `nes6502/v1/9e.json`; full-file SHA-256 `7399fe1afcd91c5abb584096101fc5ce526198717a8855c6f983f8fdb81dbf23`.
- `$9F` (`9f 2`), index 1: AHX absolute,Y without a page crossing.
  - File `nes6502/v1/9f.json`; full-file SHA-256 `1648cce9c71df7d92040dfdeb5e6a27ca2373d7051c45e728d8e350f9b9232e8`.
- `$9F` (`9f 1`), index 0: AHX absolute,Y with a page crossing.
  - File `nes6502/v1/9f.json`; full-file SHA-256 `1648cce9c71df7d92040dfdeb5e6a27ca2373d7051c45e728d8e350f9b9232e8`.

The SHA-256 of the checked-in selected fixture, `vectors.json`, is
`ab42d3bcdfebae3db6fd528cc493c131986a96ca84de83563ef7176143eed59d`. `LICENSE` is the only other
upstream file copied into this folder.

## Automated setup and expected result

No network access, ROM download, or external runtime is required. Run:

```bash
npm test
```

`tests/cpu-single-step-vectors.test.ts` seeds the existing fake 64 KiB CPU bus from each vector's `initial`
RAM and register state, then calls `clock_cycle()` once per upstream bus operation. It compares every returned
access and sequence boundary, final registers, and listed RAM against the upstream `cycles` and `final`
fields. The expected result is **20 of 20 selected vectors pass**. This subset is a regression fixture, not
full conformance: it does not test every opcode or state. Passing it does not establish full timing accuracy
or prove that a complete NES boots.
