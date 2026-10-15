# NES APU and controller smoke-test ROMs

`NES_APUTest_SquarePlayer.nes` and `NES_APUTest_NoisePlayer.nes` are copied without modification from the
`players/` directory in [`xram64/nes-tests`](https://github.com/xram64/nes-tests/tree/c871f6fe06b5f00b305e977c50f0d16e1bd444dd),
pinned to commit `c871f6fe06b5f00b305e977c50f0d16e1bd444dd`. The repository's MIT `LICENSE` from that commit
is included here (copyright 2018 tragicmuffin). The upstream README says the players were modified from the
Nerdy Nights Sound: Part 3 tutorial code; that provenance is retained here, and no upstream source code is
vendored.

- `NES_APUTest_SquarePlayer.nes`: SHA-256 `a9193cf7ffa0d0efbaab298cf618f3f506c8e3c4b46b2b81a2e1cf19391819a6`,
  24,592 bytes. Up plays the selected square-wave note; Down silences it.
- `NES_APUTest_NoisePlayer.nes`: SHA-256 `8dadfd29f0b2a90b82ef346ac0c52f1a32630b462297c7b7a3ab7ee60019a66e`,
  24,592 bytes. Up plays noise; Down silences it. Left/Right select noise frequency; A/B toggle length-counter
  and envelope settings, which the automated test does not exercise.
- These are interactive smoke ROMs, not automated conformance suites. The tests check a limited headless
  TypeScript console path: initial silence, controller-triggered non-silent APU samples, and silence after the
  stop input. They do not validate audible host playback or hardware-accurate pitch/timing.

Run the automated tests with `npm test`; all tests have a 10-second timeout. See `docs/TESTING.md` for the
recorded run and the remaining runtime-validation gaps.
