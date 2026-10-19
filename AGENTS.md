# Instructions for coding agents

## Project intent

Build a full NES emulator for TurboWarp, with a TypeScript implementation that is easy to test and a
GoboScript port that produces a Scratch `.sb3` project. The TypeScript code is the behavioral reference. Do
not port an untested subsystem just to make the Scratch project appear complete.

Read `docs/LLM_CONTEXT.md`, `docs/ARCHITECTURE.md`, and `docs/GOBOSCRIPT_RESEARCH.md` before making
architectural or GoboScript changes. Keep `docs/PROGRESS.md` and `docs/TODO.md` accurate when scope changes.

## Source and tests

- Keep emulator logic deterministic and independent of the browser, Scratch, and TurboWarp.
- Use small hardware-domain modules with explicit inputs, outputs, and clocking boundaries.
- Add tests with each behavior change. Prefer direct unit tests, deterministic test vectors, and known ROM
  suites over manual-only checks.
- Treat invalid ROM data and unsupported hardware as expected input errors. Return explicit result/error
  values from core APIs; reserve exceptions for programmer errors and test failures.
- Do not log from core emulation logic. Put logging and UI messaging at the application boundary.
- Do not modify `test_rom.nes` unless the user explicitly requests it.
- Do not claim that the test ROM boots or plays until CPU, mapper, PPU, and runtime integration tests
  demonstrate it.

## TypeScript style

- Use 4-space indentation, no tabs, double-quoted strings, semicolons, and trailing commas in multi-line
  literals.
- Keep source lines near 120 characters. Separate logical blocks in functions with blank lines.
- Keep the ES2022 target and `isolatedModules` enabled. Use `strict: true` and
  `noUncheckedIndexedAccess: true`; narrow array and typed-array reads before using them.
- Use `import type { ... } from "..."` for type-only imports.
- Use `snake_case` for functions and variables, `PascalCase` for classes and exported types, and
  `SCREAMING_SNAKE_CASE` for module constants.
- Use descriptive domain names; do not add abbreviations that hide hardware meaning.
- Use short ASCII comments that explain why. Add concise JSDoc for public APIs. A TODO must name a
  concrete task.
- Keep expected input failures in typed result values rather than using `throw` as control flow.

## GoboScript style and project rules

- Use 4 spaces, `#` comments, double-quoted strings, and semicolons for statements.
- Use `snake_case` for variables, functions, and procedures. Keep all preprocessor directives such as
  `%include` at column 1.
- In GoboScript, `stage.gs` is the Stage and root-level `.gs` files are sprites. Put included helper files
  in subdirectories; they are headers, not sprites.
- Keep the raw ROM out of GoboScript source. Generate `scratch/data/test_rom_bytes.txt` with `npm run
  scratch:assets`.
- Pin external compiler/library versions when the project depends on them. Document TurboWarp-only
  settings and do not silently imply they work on the Scratch website.
- Keep GoboScript algorithms simple and independently testable. Lists are 1-indexed; write and test index
  conversions explicitly.
- Never write `return` inside a `proc`: upstream codegen panics on it. Structure procs as `if` / `elif` /
  `else` chains. Only a `func` returns, and its last statement must be a `return`.
- Declare shared `var`, `list`, and `enum` state only in headers that the Stage includes. Sprites resolve
  Stage-owned names, but each target compiles its own copies of included procs and funcs, so a header included
  by a sprite must not declare state.
- GoboScript has no bitwise operators: `&` joins strings, `%` is floored modulo, and `//` is floor division.
  Express masks, shifts, and flag tests through the tested helpers in `scratch/src/numeric.gs`.
- Do not name a proc, func, var, list, or enum after a GoboScript keyword or a Scratch block shape; a matching
  name and arity compiles into the builtin block instead of a custom block.
- Declare `local` values before loop bodies, not inside them.
- Keep `tests/support/goboscript_port_algorithms.ts` in lockstep with any changed helper. It mirrors the
  ported arithmetic in integer-only TypeScript, and `tests/goboscript-source.test.ts` enforces name and arity
  parity plus the source rules above.
- Never describe the `.gs` project as compiling, running, or meeting a performance target. No source in
  `scratch/` has been compiled, so the in-project self test has never executed.

## Text and generated files

- Use ASCII only in code, comments, docs, and user-facing strings. Do not add emoji, typographic arrows,
  em dashes, or decorative Unicode.
- Keep generated build products, `node_modules`, `dist`, GoboScript ROM text data, and `.sb3` files out of
  Git unless the user asks to version them.
- Do not copy code from reference emulators without checking their license and preserving required
  attribution.
