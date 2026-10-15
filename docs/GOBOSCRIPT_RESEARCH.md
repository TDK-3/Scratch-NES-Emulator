# GoboScript research and Scratch workflow

This guide records the upstream GoboScript behavior used by this project. GoboScript changes quickly, so the
compiler, language, standard library, and examples must be checked again when upgrading.

## Executive summary

GoboScript is a text-based language and compiler for authoring Scratch projects. Its `.gs` source compiles
to a normal Scratch `.sb3` project that can be opened in Scratch, TurboWarp, or TurboWarp Desktop. It adds
source-level abstractions such as functions, structs, enums, local variables, macros, and convenient control
flow, then lowers them to Scratch blocks.

GoboScript is not a JavaScript or TypeScript runtime, and it does not compile this repository's TypeScript
into Scratch blocks. The plan is therefore two implementations:

1. Specify and thoroughly test emulator behavior in TypeScript.
2. Port one tested behavior at a time to GoboScript, using shared vectors and Scratch/TurboWarp checks.

The Scratch project is not complete simply because `goboscript build` succeeds. It also needs correct
emulator behavior, a viable renderer, input/audio integration, and acceptable frame time in its target
runtime.

## Upstream snapshot and sources

Research was checked against the upstream `main` branch at commit `90da47297c4fa201606c7df209a7716c283bd203`
(October 2026). The project should use the current official docs when installing a newer compiler.

- [GoboScript repository at the pinned commit](https://github.com/aspizu/goboscript/tree/90da472)

The source paths below are relative to that pinned tree:

- Overview and project creation: `README.md`, `docs/getting-started/index.md`.
- Install, CLI, and examples: `docs/install.md`, `docs/getting-started/basic-examples.md`.
- Language basics: `docs/language/syntax.md`, `docs/language/variables.md`, `docs/language/lists.md`,
  `docs/language/operators.md`.
- Procedures and data types: `docs/language/functions.md`, `docs/language/custom-blocks.md`,
  `docs/language/structs.md`, `docs/language/enums.md`.
- Macros, costumes, and library: `docs/language/macros.md`, `docs/language/costumes.md`,
  `docs/standard-library.md`.
- Configuration and TurboWarp Desktop: `docs/configuration.md`,
  `docs/editor-integration/turbowarp-desktop.md`.

## Install and build

The upstream installation guide documents Cargo/Rust installation. Its latest-source command is:

```bash
cargo install --git https://github.com/aspizu/goboscript --locked
```

`--locked` uses the upstream dependency lockfile, but the default branch can change. To reproduce the
researched compiler snapshot, pin its source revision:

```bash
cargo install --git https://github.com/aspizu/goboscript \
    --rev 90da47297c4fa201606c7df209a7716c283bd203 --locked
```

The pinned source declares GoboScript version 3.3.0. The Rust toolchain must be installed first. The
upstream update command uses `--force`; follow the official guide for other installation methods and
platform-specific details.

Useful CLI discovery commands are:

```bash
goboscript --help
goboscript new --help
goboscript build --help
```

The documented project flow is:

```bash
mkdir my-project
cd my-project
goboscript new
goboscript build
```

`goboscript new` creates starter source and asset files. Its CLI also accepts a project directory and
options for the standard library version, bitmap resolution, TurboWarp frame rate/clone/limit settings,
stage dimensions, and a Makefile. `-G` skips initializing a Git repository. `goboscript build` accepts an
optional project directory and output path; with no path, it uses the current directory and names the `.sb3`
after that directory. `goboscript fmt` formats a project or source file. Check `--help` against the
installed compiler before scripting around less common flags.

The compiler reports diagnostics and emitted block counts. Treat a build with compiler errors as failed; do
not open or distribute a broken `.sb3`. The upstream README describes optimization, unused-code removal, and
error detection. The compiler is a build step; the `.gs` files, assets, config, and data files are the
editable sources.

For this repository, `scratch/` is the GoboScript project root. `npm run build:scratch` generates the
file-backed ROM list and invokes `goboscript build` from that directory. The generated list and `.sb3` are
ignored build products.

## Project layout rules

A standard generated project contains `goboscript.toml`, `main.gs`, `stage.gs`, and an `assets/` directory.
The important naming rule is:

- A root-level `.gs` file is a sprite. Its filename is the sprite name.
- `stage.gs` is special and contains the Stage source. A sprite cannot be named `stage` or `Stage`.
- A `.gs` file below a subdirectory is an included header, not a sprite.
- Costume paths are relative to the GoboScript project root.

This project uses that layout:

```text
scratch/
    goboscript.toml
    main.gs
    stage.gs
    NOTES.md
    assets/blank.svg
    src/rom_loader.gs
    data/test_rom_bytes.txt       generated before build
```

Keep sprite source files at the root. Keep reusable routines in subdirectories and include them explicitly.

## Language essentials

### Statements, values, and conditions

GoboScript uses C-, Rust-, and Python-inspired syntax. Indentation is not significant. Statements end with
semicolons. `#` begins a single-line comment. Strings use double quotes. It supports decimal, binary,
hexadecimal, octal, and floating-point literals. `true` and `false` compile to `1` and `0`.

```goboscript
var start_address = 0x8000;

onflag {
    pc = start_address;
    if pc >= 0x8000 {
        say "Program ROM address";
    }
}
```

Scratch boolean inputs are not arbitrary values. GoboScript coerces a non-boolean condition by comparing it
with `1`, so make predicates explicit when a numeric truth value could be unclear.

### Variables and scopes

Variables are sprite-local by default. A variable assigned in `stage.gs` is shared by all sprites. A
top-level `var` declaration provides an initial project value; first assignment also declares a variable.
`local` creates a procedure-local variable and shadows a global of the same name.

Local variables are documented as undefined when the procedure is recursive or is not a
run-without-screen-refresh procedure. Emulator code should use an explicit, small set of shared state
variables where state must persist across procedures. Do not assume TypeScript stack locals, objects, or
closures exist at runtime.

### Lists

Lists are Scratch lists and use **1-based** indices. Supported operations include declaration, append,
indexed read/write, insert, delete, membership, length, and fixed-size initialization.

```goboscript
list ram = [0; 2048];

proc write_ram address, value {
    ram[$address + 1] = $value;
}
```

A fixed list literal can use `[value; length]`; the compiler documents a 200,000-item ceiling for that
initialization form. A file-backed list loads one item per text-file line:

```goboscript
list cartridge_bytes "data/test_rom_bytes.txt";
```

The list in this project contains decimal text lines, one for each binary ROM byte. Scratch lists are not
typed arrays: explicit numeric conversion, wrapping, bounds checks, and the `+ 1` index conversion must be
tested. Avoid repeated list insert/delete in hot loops; preallocate and overwrite where possible.

### Procedures and functions

A `proc` defines a Scratch custom block and does not return a value. Procedure arguments use `$name` inside
the body. Custom blocks are run without screen refresh by default; `nowarp proc` marks a procedure so its
Scratch block does not have that option checked.

A `func` returns a value and always runs without screen refresh. The upstream docs require functions to be
called only from other no-refresh procedures or functions, require an explicit final `return`, and warn that
`stop_this_script` inside a function is undefined.

```goboscript
func sum_bytes(left, right) {
    return $left + $right;
}

proc report_sum left, right {
    local result = sum_bytes($left, $right);
    say result;
}
```

Use functions for pure calculations that fit the no-refresh rules. Use procedures for hardware steps and
state transitions. Choose where to yield deliberately; a long no-refresh loop can freeze the visible
project, while yielding for every tiny operation costs performance.

Procedures and functions support default and keyword arguments in current upstream docs. The codebase should
still prefer explicit, positional arguments in hot emulator paths until the compiler output and performance
have been checked.

### Control flow, operators, and abstractions

The language provides `if` / `elif` / `else`, `repeat`, `until`, and `forever`. Operators include
arithmetic, floor division, modulo, string concatenation (`&`), comparisons, boolean `and` / `or` / `not`,
membership, list/string indexing, and common numeric reporters. See the upstream operator table for the
complete list.

The documented operator set does not provide JavaScript typed arrays or general-purpose native bitwise
operators. For an NES port, isolate and test byte/bit helpers and choose an implementation suited to
GoboScript, such as arithmetic decomposition or a measured lookup table. Do not transliterate TypeScript
`&`, `|`, `^`, and `>>` expressions blindly; in GoboScript, `&` means string joining, not bitwise AND.

Structs group related scalar values or lists, and enums provide named numeric or string values. They are
compiler-level abstractions that lower to ordinary Scratch project data. They can improve organization, but
must not be treated as runtime JavaScript objects. Upstream documents sequential field assignment for
structs, which can make self-referential assignments order-sensitive.

### Macros, includes, and standard library

GoboScript has a C-like preprocessor. Directives such as `%include`, `%define`, `%undef`, and conditional
compilation begin at column 1 with no indentation. Include paths are project-root-relative by default; use
`./` or `../` for paths relative to the current header. The `.gs` extension can be omitted.

```goboscript
%include src/rom_loader
```

Macros are compile-time token substitutions, not runtime functions. Use them to remove repetitive source,
not to hide complex runtime semantics. The standard library can be included with `%include std/math` and
other available headers. The upstream docs say an unset `std` selects the latest version and caches it for
seven days; pin a version in `goboscript.toml` when a project depends on it. This scaffold pins `std =
"2.1.0"` and currently has no standard-library include.

### Costumes and assets

A sprite or Stage declares costumes with a top-level `costumes` statement. Paths are project-root-relative.
Multiple costumes can be listed; wildcards are sorted alphabetically. Costume names come from filenames
unless renamed. The `@ascii/` naming feature can generate costumes for printable ASCII characters, which may
help a text renderer but should not be mistaken for a fast pixel renderer.

The compiler packages referenced costumes into the `.sb3`. Keep generated assets reproducible and small. The
current blank SVG is only a valid scaffold costume.

## Configuration and TurboWarp

`goboscript.toml` stores project settings, including the standard library version, sprite layer order,
bitmap resolution, and a Stage notes file. It can also emit TurboWarp project configuration such as:

- `frame_rate` (documented default 30; this project requests 60)
- `max_clones` or `max_clones = inf`
- `no_miscellaneous_limits`
- `no_sprite_fencing`
- `frame_interpolation`
- `high_quality_pen`
- custom stage width and height

These are TurboWarp settings, not proof of compatibility with the Scratch website. Keep the intended runtime
explicit. Test the compiled `.sb3` in the actual target runtime and document which settings are required.
The configuration in this repository requests 60 FPS and disables miscellaneous limits for the TurboWarp
target; the renderer and frame budget still need measurement.

## Editor and preview loop

GoboScript source is plain text, so any editor can be used. The compiler CLI is the dependable build path;
`goboscript fmt` is available for formatting, and build diagnostics should be fixed before opening the
output. Upstream docs contain editor integration pages, but integrations can change independently of the
compiler. In the pinned snapshot the VS Code extension had recently been removed from the repository even
though an editor guide remained, so do not make this project depend on that extension.

The optional TurboWarp Desktop guide describes a userscript shortcut for reloading a built `.sb3`. It is a
preview convenience, not a compiler or live source runtime. The reliable project loop remains: regenerate
assets, run `goboscript build`, open or reload the emitted `.sb3`, and test it in the declared runtime.

## Porting guidance for this emulator

1. Implement the behavior in TypeScript and cover normal, boundary, and error cases.
2. Keep the TypeScript interface hardware-oriented and avoid application-specific abstractions that
   cannot be represented in Scratch.
3. Write vectors using small integers and explicit byte order. Convert zero-based TS array positions to
   one-based Scratch list positions at one narrow boundary.
4. Port pure helpers first: byte normalization, address decoding, status flags, bank selection, and
   controller shift behavior.
5. Port state transitions next. Define precisely when each routine may yield and which state persists
   between frame slices.
6. Add a GoboScript self-test sprite or result list that runs the same vectors. Compare every result with
   TypeScript.
7. Benchmark the compiler output and TurboWarp runtime. If a direct port is too slow, optimize the
   algorithm and keep the optimized result checked against the TypeScript reference.
8. Treat graphics and audio as separate integration projects. A correct CPU core alone does not make a
   playable emulator.

The main technical risk is throughput, not syntax. A NES frame spans tens of thousands of CPU cycles and
over 61,000 visible pixels. TurboWarp settings can help, but the project needs measured frame-time budgets
and a renderer design that does not execute one expensive Scratch path per pixel.

## Reference implementations and test suites

These repositories are useful for studying architecture and behavior. They are not dependencies of this
project, and their code must not be copied without reviewing the applicable license.

- [jsnes](https://github.com/bfirsh/jsnes) is a JavaScript NES emulator. Its source and existing tests can
  inform CPU, mapper, and test-harness design.
- [TsNES](https://github.com/qpalzmqaz123/tsnes) is a TypeScript NES emulator with a browser-facing
  frame/sample API.
- [fogleman/nes](https://github.com/fogleman/nes) is a Go emulator that documents support for NROM, MMC1,
  UNROM, CNROM, MMC3, and AOROM.
- [nes-test-roms](https://github.com/christopherpow/nes-test-roms) is a collection of hardware test ROMs.

Use upstream emulator sources as cross-checks, not specifications. Confirm tricky behavior against reliable
NES documentation and test ROMs. Track ROM licensing separately from source-code licensing.
