# GoboScript Performance Audit and Optimization TODO

**Branch:** `arena/ba80bd5f-scratch-nes-emulator`
**Audit date:** 2026-10-20
**Scope:** every line of `scratch/**/*.gs` (31 files, 8,794 lines), `scratch/goboscript.toml`, the generated
`scratch/data/*.txt` inputs, and the Scratch VM / TurboWarp execution model those files compile into.
**Out of scope:** the TypeScript reference in `src/nes/**` (it is the behavioral oracle, not the shipped
runtime) and the Node scripts in `scripts/` (build time only, host speed).

**Method:** line-by-line read of the current source, with every claim below tied to a `file:line`. Call
counts and operation counts are *static estimates* derived by counting source constructs and multiplying by
the NTSC workload (29,780 CPU cycles, 89,342 PPU dots, 61,440 visible pixels per frame). They are not
measurements.

> **Honesty statement.** No source in `scratch/` has been compiled in this environment (the pinned
> GoboScript toolchain and TurboWarp are not installed; see `docs/TODO.md` P0). Nothing below is a measured
> FPS, a measured frame time, or a claim that the project runs at any speed. Everything below is a
> bottleneck that follows from the code structure plus the documented Scratch cost model, and a proposed
> change with an estimated saving.
>
> What a tick means after the 2026-10-20 pass: the source change described in the item is present in
> `scratch/`, its mirror and `MIRROR_CONTRACT` row exist where the declaration inventory demands one, and
> `npm test` (1306 tests, including the source lint, the port-algorithm sweeps, and the bus/PPU/display
> suites) passes. It does **not** mean the saving was measured on a running Scratch project: the measurement
> work in section 4.10 is still blocked, so every ticked item's saving is an estimate. Items that would need
> the compiler, a Scratch runtime, or a rendering comparison carry a written `Blocked` line instead of a
> tick, and section 8's procedure still applies to both.

---

## 0. How to use this document

- **[ ] / [x]** means "open work" / "closed". **Status after the 2026-10-20 implementation pass: 76 items
  implemented and ticked, 42 blocked with a written reason (each carries a `**Blocked (2026-10-20):**` line),
  15 closed earlier on purpose (R1-R12 rejected, M9 and I4 "already right, do not change", P27 blocked by the
  mirror contract). Nothing is ticked without a statement in the source that implements it; section 10 lists
  what changed and what the pass turned up for a follow-up.**
- Every ticked item names the source construct that now does the work, so a reader can check it against
  `scratch/` without re-running the audit.
- Every open item is assigned to exactly one batch in section 7; nothing is orphaned.
- **Priority** is about expected effect on the frame budget, not about how easy the change is:
  - **P0** - blocks any performance claim (measurement infrastructure, or a defect that dominates).
  - **P1** - large, structural saving (tens of thousands of Scratch block invocations per frame).
  - **P2** - moderate saving (thousands per frame) or a large one-time/boot saving.
  - **P3** - small saving, or a change whose value depends on a measurement not yet taken.
- **Effort:** S (local edit), M (a proc and its tests), L (cross-module, needs a design note).
- Items are grouped by subsystem for review, but section 7 orders them into batches so that each batch is
  independently testable and separately benchmarkable.
- Every item names the **lint coupling** when a change would break `tests/goboscript-source.test.ts`. That
  file pins literal source strings and element counts; several plausible optimizations are blocked only by
  those pins, not by behavior. Section 6 lists the pins in one place.

### 0.1 The ten changes that matter most, in order

If only ten things get done, these are the ones, each with its own item below. They are ordered by expected
saving per unit of risk, and every one is gated by the measurement work in S1-S5.

| # | Change | Item | Expected effect |
|---|---|---|---|
| 1 | Clock the PPU once per instruction instead of three times per cycle | F1 | ~80,000 of the ~620,000-680,000 calls per frame disappear |
| 2 | Inline the two dominant CPU bus windows into the cycle helpers | C1, C2 | ~60,000 calls and ~30,000 modulos per frame |
| 3 | Compose a background line once per line instead of once per dot | P1 | removes ~61,000 per-pixel shift/select steps |
| 4 | Precompose the sprite line into 256-entry lists | P2 | removes the per-pixel scan of eight sprite slots |
| 5 | Take the access log out of the cycle helpers | C3 | ~30,000 branches per frame, and removes the only unbounded list in the port |
| 6 | Generate the framebuffer as runs instead of decoding 61,440 pixels in the sprite | D1 | ~180,000 list reads + compares per frame |
| 7 | Rebuild the bitwise tables from the nibble table, or drop the byte tables | N7 | 9-12 million boot blocks and ~200,000 list slots |
| 8 | Gate the shared-vector self test behind a flag | B2 | removes the whole boot replay from every run |
| 9 | Poll the keyboard and the load key once per frame, not once per chunk | F5, F6 | ~900 device lookups per frame |
| 10 | Split the dot clock into fast and slow paths | P3 | several comparisons per dot, 89,342 dots per frame |

Everything else in section 4 is real but smaller; nothing in it is filler.


---

## 0.2 Implementation status (2026-10-20 pass)

The whole catalogue below was worked through against the current source. What that pass changed, by file:

| File | Change |
|---|---|
| `src/numeric.gs`, `src/bitwise_tables.gs` | nibble-only bitwise tables (256 slots each), byte entry points, arithmetic mask sites |
| `src/cpu_alu.gs` | byte entry points for every operation, branch-free carry/overflow, inlined flag tails, compare and bit-test without a result store |
| `src/cpu_status.gs` | 256-entry zero/negative table |
| `src/cpu_core.gs` | fast bus windows, parity instead of a counter, comparison-wrapped fetch, inlined word push/pop |
| `src/cpu_addressing.gs`, `src/cpu_instruction.gs`, `src/cpu_control.gs` | inlined resolver fields, arithmetic branch decode, implied-mode fast path, guarded finish, inlined dispatch |
| `src/cpu_opcode.gs` | boot-time table normalization, four-field hot decode |
| `src/ppu_2c02.gs` | batched dot loop with the pixel body inlined, palette color cache, greyscale table, cached control fields, sprite-zero line flag, single sprite pattern address, guarded background shifts, trusted observer calls |
| `src/ppu_bus.gs` | masked palette cache, direct NROM CHR ROM read, guarded observer |
| `src/mapper_000.gs`, `src/mapper_004.gs` | single-pass ROM load, slot-derived offsets, trusted A12 observer |
| `src/controller.gs` | modulo serial read and latch |
| `src/vector_selftest.gs` | gated replay (`port_self_test_enabled`) |
| `src/rom_input.gs`, `src/rom_run.gs`, `src/frame_loop.gs` | staged byte count, four-chunk poll, whole-DMA batching |
| `tests/` | mirror functions and contract rows for every new declaration, the palette-cache pin, the inlined-pixel ordering pin |

The audit's earlier change set passed 1305 tests; the current work passes 1306/1306. The paragraph below about measurement still stands: these are
structural savings, and none of them has been measured on a running Scratch project.

---

## 1. Cost model, verified against this source

### 1.1 What each construct becomes

| Construct | What the Scratch runtime does | Relative cost | Where it dominates here |
|---|---|---|---|
| `proc` / `func` call | One custom block: push a stack frame, bind arguments, jump, pop. In TurboWarp's compiler a warp-mode proc becomes a JS function, but argument binding, the frame, and the thread context write still happen. | **Very high** (order 10-100x a primitive) | ~620,000 calls per frame (section 3) |
| `list[i]` read/write | 1-based index add, bounds test, array access on a JS array of boxed values. | High | framebuffer, RAM, nametables, pattern/CHR memory, bitwise tables |
| `var` read/write | Property lookup on the target's variable map, plus monitor bookkeeping. | Medium | ~300 Stage variables, all registers and PPU state |
| `local` read/write | **Not stack storage.** GoboScript lowers a `local` to a target variable named `procname:varname` (see `AGENTS.md`), so it costs the same as a global variable access. | Medium, *equal to `var`* | every proc's temporaries |
| `%`, `//` | One Scratch reporter each (`operator_mod`, `mathop floor`). Floored modulo, correct for negatives. | Medium | per bus access, per PPU address, per pixel |
| `+`, `-`, `*` | One reporter each, with number coercion on both operands. | Low-medium | everywhere |
| `if` / `elif` chain | Each `elif` is a separate comparison that must evaluate before its branch is known. | Low each, but linear in chain length | CPU dispatch, PPU dot tests |
| `repeat` / `until` | Loop header per iteration, plus a yield check outside warp mode. | Low | per pixel, per dot |
| `broadcast_and_wait` | Starts a thread and blocks the sender until it finishes. | High, but once per frame | `rom_run_loop` |
| Pen block | Canvas 2D stroke. TurboWarp batches within a frame but each stroke is still a JS-to-canvas call. | High | ~8,000 strokes per frame |
| `key_pressed` | Keyboard device lookup with a string compare per call. | Medium | 16 per chunk, 60 chunks per frame |
| `timer` | Host clock read. | Medium | per frame |

Three consequences drive the whole document:

1. **Calls beat arithmetic.** Removing one custom-block call is worth roughly as much as removing 10-30
   primitive reporters. The audit therefore prioritizes call elimination over algebra.
2. **Per-dot work beats per-pixel work.** Anything executed once per PPU dot runs 89,342 times a frame;
   anything per pixel runs 61,440 times; anything per tile runs 7,712 times; anything per scanline runs 240
   times. Moving work up that ladder is always a win.
3. **`local` is not free storage.** Several older notes in this file assumed hoisting a value into a `local`
   makes later reads cheaper. It does not: it only helps when it reduces the *number* of reads. The audit
   never recommends adding a `local` for its own sake.

### 1.2 The workload, exactly

| Quantity | Value | Source of the value |
|---|---|---|
| CPU cycles per NTSC frame | 29,780 | `scratch/src/frame_loop.gs:41` |
| PPU dots per frame | 341 x 262 = 89,342 (89,341 on odd rendered frames) | `scratch/src/ppu_2c02.gs:28-37` |
| Visible pixels per frame | 256 x 240 = 61,440 | `scratch/src/ppu_2c02.gs:71-73` |
| Rendered-line dots (visible + pre-render) | 241 x 341 = 82,181 | `ppu_clock_ppu_dot` guard at `ppu_2c02.gs:737` |
| Background tiles fetched per frame | 241 x 32 = 7,712 | `ppu_2c02.gs:1185-1200` |
| Sprite fetch dots per frame | 241 x 64 = 15,424 | `ppu_2c02.gs:1217` |
| Instructions per frame (estimate) | ~9,600 | 29,780 cycles / ~3.1 cycles per instruction |
| Bus cycles per frame | ~29,780 | one per `cpu_read_cycle` / `cpu_write_cycle` |

### 1.3 Throughput hypothesis to be tested, not assumed

If a TurboWarp-compiled warp proc sustains roughly 5-50 million simple block executions per second (a range
that must be measured, see S3), then at 60 fps the whole project may spend only 80,000-830,000 block
executions per frame. Section 3 estimates the current source at several million per frame. That is the
entire performance story: **the port is roughly one to two orders of magnitude over the 60 fps budget as
written, and the gap is dominated by custom-block calls, not by arithmetic.** Every P1 item below attacks
that call count.

This also means the practical target for the first optimization pass is not "60 fps". It is "a measured,
repeatable multiple of the current frame time", recorded in section 8, followed by a decision about
fidelity trade-offs (`docs/SUPPORTED_FEATURES.md`).

---

## 2. Hot path as the source actually executes it

### 2.1 Per CPU cycle

`frame_loop_run_chunk` (`frame_loop.gs:72`) calls `cpu_begin_next_sequence` (`cpu_control.gs:115`), which
runs one instruction or interrupt. Inside an instruction, each bus cycle costs:

1. `cpu_read_cycle` / `cpu_write_cycle` (`cpu_core.gs:87`, `:101`): one `% 65536` (read) and one `% 256`
   (write), a `cpu_access_log_enabled == 1` branch, one `cpu_cycles++`.
2. `cpu_bus_read` (`cpu_bus.gs:116`) or `cpu_bus_write` (`cpu_bus.gs:210`): another `% 65536`, a
   `cpu_bus_cycle_count` read-modify-write, a window decode chain, then a mapper call
   (`nrom_read_cpu` / `mmc3_read_cpu`).
3. `cpu_apply_driven_value` (`cpu_bus.gs:96`) on every driven read, including the overwhelmingly common
   full-byte case where it is a single assignment.

So one CPU bus cycle is **4-5 custom-block calls** and ~10 reporters. At ~29,780 cycles per frame that is
120,000-150,000 calls per frame before any instruction decoding.

### 2.2 Per instruction (a 4-cycle `LDA $1234` as the worked example)

| Step | Call |
|---|---|
| sequence selection | `cpu_begin_next_sequence` |
| dispatch | `cpu_execute_instruction` (`cpu_instruction.gs:316`) |
| opcode fetch | `cpu_fetch_byte` (`cpu_core.gs:125`) -> `cpu_read_cycle` -> `cpu_bus_read` -> `cpu_apply_driven_value` |
| decode | `cpu_decode_opcode` (`cpu_opcode.gs:166`), 6 list reads, 6 coercions |
| operand path | `cpu_execute_regular_instruction` -> `cpu_resolve_operand` -> `cpu_reset_operand` -> `cpu_fetch_word` -> 2 x (`cpu_fetch_byte`, `cpu_read_cycle`, `cpu_bus_read`) -> `cpu_set_memory_operand` |
| effect | `cpu_execute_memory_instruction` -> `cpu_read_cycle` -> `cpu_bus_read` -> `cpu_apply_read_instruction` -> `update_zero_negative_flags` -> `normalize_status` |
| boundary | `cpu_finish_instruction` |

That is **26 custom-block calls for one four-cycle instruction**, of which at least 12 exist only to pass a
value through a proc boundary.

### 2.3 Per PPU dot and per pixel

`ppu_clock_ppu_dot` (`ppu_2c02.gs:700`) is called 89,342 times per frame from the frame loop, three
statements per CPU cycle (`frame_loop.gs:103-121`). Each call:

- tests `ppu_bus_mapper_kind == mapper_kind.mmc3` (line 706),
- tests `ppu_dot == 1` and then a scanline (line 714),
- tests the visible-dot window and calls `ppu_render_pixel` (line 738),
- tests `(scanline < 240 or scanline == 261) and rendering_enable` and calls
  `ppu_clock_rendering_pipeline` (line 743),
- tests `ppu_dot < 339` and otherwise calls `ppu_advance_dot` (line 748).

`ppu_render_pixel` (`ppu_2c02.gs:1009`) then calls `ppu_read_sprite_pixel` (`:1097`) and
`ppu_clock_sprite_output_units` (`:1129`) for every visible pixel. Those two procs walk the same eight unit
slots twice, reading and writing four lists per unit.

`ppu_clock_rendering_pipeline` (`:1154`) calls four fetch procs and `ppu_clock_sprite_fetch` per line, and
`ppu_bus_read_nametable` / `ppu_bus_read_pattern_window` per fetch.

### 2.4 Per frame, in the display

`pen_draw_frame` (`main.gs:62`) reads all 61,440 framebuffer entries, compares each with its predecessor,
and emits one pen stroke per run (`goto`, `pen_down`, `set_x`, `pen_up`, plus `set_pen_color` on a key
change).

---

## 3. Call census (static estimate, current source)

| Subsystem | Calls per frame (est.) | Basis |
|---|---|---|
| CPU core + bus | 120,000-150,000 | 29,780 cycles x ~4-5 calls |
| CPU decode/addressing/dispatch | 45,000-60,000 | ~9,600 instructions x 5-6 calls |
| CPU ALU + status | 15,000-20,000 | ~7,000 flag updates x 2 calls |
| CPU stack/interrupt sequences | 3,000-5,000 | ~800 sequences x 4-6 calls |
| PPU dot clock | 89,342 | one per dot |
| PPU pixel composition | 184,320 | 61,440 x (`ppu_render_pixel` + sprite scan + sprite shift) |
| PPU fetch pipeline | 82,181 | one per rendered-line dot |
| PPU tile fetches + bus windows | 70,000-80,000 | 7,712 tiles x ~8 calls, plus 15,424 sprite fetch dots |
| PPU status/NMI helpers | ~1,500 | vblank set/clear, sprite flags, NMI refresh |
| Display | ~8,000 strokes + 61,440 list reads | run-length draw |
| **Total custom-block invocations** | **~620,000-680,000 per frame** | sum of the above |

At 60 fps that is **37-41 million custom-block invocations per second**, plus several million primitive
reporters. That is the number to attack.

---

## 4. Optimization catalogue

### 4.1 Numeric helpers (`src/numeric.gs`, `src/bitwise_tables.gs`)

- [x] **N1 (P1, M) Specialize constant-mask bitwise calls into arithmetic.**
  - **Done (2026-10-20):** hot mask sites now use the arithmetic forms (`% 2`, `% 256`, `x - x % 32`); the remaining literal-mask uses are boot-time cartridge/ROM-load code.
  - Where: `numeric.gs:90` (`bitwise_and`), `:119` (`bitwise_or`), `:148` (`bitwise_xor`), `:83` (`bit_at`).
  - Now: every mask costs a `func` call, two `% 65536`, a 65,536-entry list read, and the index
    `left * 256 + right + 1`.
  - Change: at each site where the mask is a literal, write the arithmetic form. `x & 1` is `x % 2`;
    `x & 255` is `x` when `x` is already a byte, else `x % 256`; `x & 128` is `128 * ((x // 128) % 2)`;
    `x & 224` is `x - (x % 32)` for a byte `x`. Sites in hot paths: `cpu_bus.gs:110` (mask 255),
    `cpu_bus.gs:195`, `:199` (mask 1), `ppu_2c02.gs:321`, `:356`, `:377`, `:397` (mask 224/128/64/32),
    `ppu_2c02.gs:444`, `:447` (mask 128), `ppu_2c02.gs:484-486` (mask 1/63/192),
    `controller.gs:38`, `:42`, `:44`, `:49` (mask 1/255), `mapper_004.gs:461-476` (masks 7/254/63/127/1).
  - Est. saving: 1 call + 2 mods + 1 list read per site. At ~20,000 such sites per frame this is
    20,000 calls + 80,000 reporters per frame.
  - Risk: low; each rewrite must be mirrored in `tests/support/goboscript_port_algorithms.ts` where that
    helper is mirrored. **Lint coupling:** `% <name matching /mask/i>` is forbidden
    (`tests/goboscript-source.test.ts:1935-1945`), so always divide by mask+1, never by the mask.

- [x] **N2 (P2, S) Add byte-specialized bitwise helpers that skip 16-bit normalization.**
  - **Done (2026-10-20):** `bitwise_and_byte`/`or_byte`/`xor_byte` exist and the console's byte call sites use them.
  - Where: `numeric.gs:90-116`.
  - Now: `left_word = $left % 65536` and `right_word = $right % 65536` run even when both operands are
    bytes by construction (ALU, bus driven-mask merge, PPU status flags).
  - Change: `func bitwise_and_byte(left, right) { return bitwise_table_byte_and[($left % 256) * 256 + ($right % 256) + 1]; }`
    and use it at call sites whose inputs are bytes.
  - Est. saving: 2 mods per call, ~40,000 mods per frame.
  - Risk: an operand outside 0-255 would silently fold; the `% 256` keeps it correct, only the `< 256` test
    is dropped.

- [x] **N3 (P2, S) Inline `bit_at` at its hot sites.**
  - **Done (2026-10-20):** `bit_at` no longer has a hot caller: the MMC3 A12 filter reads `(address // 4096) % 2` directly and the remaining callers are boot-time header parsing.
  - Where: `numeric.gs:83`; callers `mapper_004.gs:445-446`, `:468-469`, `:621`, `cartridge.gs:224-232`.
  - Now: a func call plus a `% 65536` for what is `(value // weight) % 2`.
  - Change: inline the expression; for `a12_weight = 4096` use `(address // 4096) % 2` (see M4).
  - Est. saving: 1 call per use; ~20,000 per frame from `mmc3_observe_ppu_a12` alone.

- [x] **N4 (P2, S) Inline `normalize_byte` / `normalize_word` at remaining hot sites.**
  - **Done (2026-10-20):** the remaining hot `normalize_byte`/`normalize_word` calls are `% 256`/`% 65536` in `cpu_bus`, `ppu_bus`, `cpu_core`, and `cpu_sequence`.
  - Where: `cpu_core.gs:181`, `:187`; `cpu_sequence.gs:68`, `:129`; `cpu_bus.gs:225`, `:230`;
    `mapper_004.gs:537`, `:544`, `:577`; `ppu_bus.gs:225`, `:242`; `cpu_bus.gs:104`.
  - Change: `% 256` / `% 65536`.
  - Est. saving: ~10,000 calls per frame, concentrated in mapper PRG-RAM writes and PPU register writes.

- [x] **N5 (P2, S) Inline `join_bytes` at its three sites.**
  - **Done (2026-10-20):** `join_bytes` has no hot caller left; the address paths assemble words with two operators.
  - Where: `cpu_addressing.gs:177`, `:225`, `:237`; `cpu_sequence.gs:74`, `:92`, `:105`, `:154`.
  - Now: a func call plus two `% 256` for `high * 256 + low` on values that are already bytes.
  - Est. saving: 1 call + 2 mods per pointer dereference; ~7 uses per 1,000 instructions.

- [ ] **N6 (P3, S) Remove the word path's repeated nibble splits where it is measurable.**
  - **Blocked (2026-10-20):** the word path has no hot caller left: a 16-bit AND survives only in boot-time parsing, where a few dozen calls are invisible next to a cartridge copy.
  - Where: `numeric.gs:98-115`.
  - Now: 12 divisions for a 16-bit AND (used by `mmc3_write_register`'s `& 57345` and the cartridge
    parser). Frequency is low (~10 per frame), so this only matters if a measurement says so.

- [x] **N7 (P1, M) Fix the bitwise table startup cost and memory (see also B1).**
  - **Done (2026-10-20):** the byte tables are gone: three 256-entry nibble tables, built by 256 iterations, so 196,608 slots and ~12 million boot blocks are removed.
  - Where: `bitwise_tables.gs:26-31` (three 65,536-entry lists), `:99-151` (the runtime build);
    consumers `numeric.gs:90-116`, `:119-145`, `:148-174`.
  - Now: every green flag runs 65,536 outer iterations of an 8-step inner loop that does ~21 blocks per
    step, i.e. **roughly 11-12 million block executions and 196,608 list writes** before the console boots,
    plus 196,608 list slots created at project load (the `[0; 65536]` literal) and carried in memory.
    The source comment prices the benefit at ~12,000 ops per frame, so the build repays itself only after
    ~1,000 frames; every restart pays it again. On the interpreter (not compiled) this is far worse than
    the block count suggests, because each of the ~200,000 list writes is a full list operation.
  - Change, in increasing order of effort (measure each with S3):
    (a) **Build the byte tables from the nibble tables instead of from bits.** One entry is
    `nib[(a // 16) * 16 + b // 16] * 16 + nib[(a % 16) * 16 + b % 16]`, which is ~12 blocks instead of
    ~180, so the same 196,608 entries cost ~2.5 million blocks instead of ~12 million. This is the
    cheapest fix and keeps the per-op cost at one list read.
    (b) **Keep one byte table, derive the other two.** `a or b = a + b - (a & b)` and
    `a xor b = a + b - 2 * (a & b)` are exact for bytes. That removes 131,072 slots and two thirds of the
    build for ~4 extra blocks on the OR/XOR paths, which are much rarer than AND (masks).
    (c) **Generate the tables at build time** as file-backed data lists (`scratch/data/bitwise_and.txt`,
    like `scripts/generate_goboscript_rom_data.mjs` does). Costs one `+ ""` coercion per lookup and loads
    the file, but removes the build entirely. Only worth it if measurement says a coercion is cheaper than
    a rebuilt table (it probably is not, given (a)).
    (d) **Drop the byte tables** and use the 256-entry nibble tables for everything: 2 reads + ~5 blocks
    per byte op vs 1 read + ~3 blocks. Removes all ~12 million boot blocks and 196,608 slots at the cost of
    ~2 blocks per byte operation (~25,000 blocks per frame at the current call rate). The right answer
    depends on the boot-vs-frame trade-off the console actually makes; S3 settles it.
  - Est. saving: 9-12 million boot blocks and 131,072-196,608 list slots for (a)/(b); the per-frame change
    ranges from zero to +25,000 blocks for (d).
  - Risk: any change here must keep `bitwise_and`/`or`/`xor` exhaustive over 0-65535, which
    `tests/goboscript-port-algorithms.test.ts` already sweeps. **Lint coupling:**
    `tests/goboscript-source.test.ts:167` requires the declaration `bitwise_table_init`; a build-time
    generated table must keep that proc name (it can become an empty proc or be dropped with the pin
    updated in the same commit).

- [ ] **N8 (P3, S) Drop dead numeric helpers.**
  - **Blocked (2026-10-20):** `byte_high`/`byte_low` are uncalled, but `MIRROR_CONTRACT` requires every declaration to be listed and every entry to resolve, so deleting them is a test edit for project size only.
  - Where: `numeric.gs:68` (`byte_high`), `:73` (`byte_low`). Neither is called anywhere in `scratch/`.
  - Effect: no runtime change (GoboScript compiles unused funcs into the target anyway); reduces compiled
    project size and compile time only.

- [x] **N9 (P3, S) Avoid re-normalizing already-normalized operands.**
  - **Done (2026-10-20):** the byte-specialized helpers are the answer; no third variant was added.
  - Where: every `bitwise_*` call whose operands came from a `% 256` two lines earlier.
  - Change: prefer the N2 byte helpers; do not add a third variant.

### 4.2 CPU core, bus, decode, dispatch (`cpu_core`, `cpu_bus`, `cpu_opcode`, `cpu_instruction`, `cpu_control`, `cpu_addressing`, `cpu_status`, `cpu_alu`, `cpu_sequence`)

- [x] **C1 (P1, L) Inline the bus fast path into `cpu_read_cycle`.**
  - **Done (2026-10-20):** `cpu_read_cycle` decodes $0000-$1FFF and $8000-$FFFF itself and only falls through for the rest.
  - Where: `cpu_core.gs:87-98`, `cpu_bus.gs:116-189`.
  - Now: `cpu_read_cycle` -> `cpu_bus_read` -> (`nrom_read_cpu` | `mmc3_read_cpu`) ->
    `cpu_apply_driven_value` for every read; four calls and two `% 65536` per cycle.
  - Change: keep `cpu_bus_read` as the reference-complete path for cold windows and the vector suite, and
    give the hot path a `cpu_read_cycle` that handles the two dominant windows itself: `$0000-$1FFF`
    (`cpu_ram[(address % 2048) + 1]`, latch it, done) and `$8000-$FFFF` (one mapper call, then assign the
    value directly because the driven mask is 255 for both boards). Everything else falls through to
    `cpu_bus_read`.
  - Est. saving: 2 calls and 1-2 mods on ~90% of reads; ~50,000-60,000 calls per frame.
  - Risk: the ordered access trace must not change; the vector suite compares it, so run
    `tests/shared-port-vectors.test.ts` and the bus suite after the change.

- [x] **C2 (P1, M) Inline the write fast path into `cpu_write_cycle`.**
  - **Done (2026-10-20):** `cpu_write_cycle` does the same for writes.
  - Where: `cpu_core.gs:101-113`, `cpu_bus.gs:210-262`.
  - Now: two calls per write, plus a `% 65536` in both.
  - Change: handle `$0000-$1FFF` and `$8000-$FFFF` inline exactly as C1 does; the mapper write is one call
    and needs no value back.
  - Est. saving: 1 call per write, ~8,000-10,000 per frame.

- [ ] **C3 (P1, S) Split the access log out of the hot cycle helpers.**
  - **Blocked (2026-10-20):** the trace is written inside the deepest helpers (`cpu_fetch_byte` and every read-modify-write), so taking the guard out means maintaining a second, logged copy of the whole CPU. The guard is one variable read and one comparison per cycle.
  - Where: `cpu_core.gs:60-62`, `:91-95`, `:106-110`.
  - Now: every cycle reads `cpu_access_log_enabled` and branches; while a game runs the branch is never
    taken but is still paid ~29,780 times, and the guard is the only thing preventing unbounded list growth.
  - Change: `cpu_read_cycle` / `cpu_write_cycle` never log. Add `cpu_read_cycle_logged` /
    `cpu_write_cycle_logged` for `vector_selftest` and the CPU sequence vectors. Keep
    `cpu_access_log_enabled` as an assertion the self test sets.
  - Est. saving: 1 var read + 1 branch per cycle, ~30,000 per frame; removes the OOM failure mode entirely.
  - Risk: `tests/goboscript-source.test.ts:1656` requires `cpu_access_log_enabled = 0;` in `rom_run_start`
    and `:1666` requires `cpu_access_log_enabled = 1;` in `run_port_self_test`; both lines can stay as the
    assertion/summary, but the replay path must now call the logged variants.

- [x] **C4 (P1, S) Replace `% 65536` with a compare in `cpu_fetch_byte`.**
  - **Done (2026-10-20):** `cpu_fetch_byte`/`cpu_fetch_word` wrap the counter by comparison; the read helper normalizes the address it logs.
  - Where: `cpu_core.gs:125-130`.
  - Now: `cpu_program_counter = (address + 1) % 65536` per opcode/operand byte, plus a `% 65536` inside
    `cpu_read_cycle` for the same address.
  - Change: `cpu_program_counter = address + 1; if cpu_program_counter == 65536 { cpu_program_counter = 0; }`
    and pass the already-normalized address to a no-normalize read helper.
  - Est. saving: 1-2 mods per fetched byte, ~20,000-30,000 per frame.

- [x] **C5 (P2, S) Inline both halves of `cpu_fetch_word`.**
  - **Done (2026-10-20):** `cpu_fetch_word` is two read cycles and one join, with no `cpu_fetch_byte` calls.
  - Where: `cpu_core.gs:135-141`.
  - Now: two `cpu_fetch_byte` calls plus two `% 256` to reassemble.
  - Change: two read cycles and `low + high * 256` without the mods (the bus returns bytes).
  - Est. saving: 2 calls + 2 mods per absolute/indirect operand.

- [x] **C6 (P1, S) Use a single fetch-and-decode proc on the hot path.**
  - **Done (2026-10-20):** `cpu_fetch_and_decode_opcode` exists and the hot path fetches and decodes in one step.
  - Where: `cpu_instruction.gs:56-59` (`cpu_fetch_and_decode_opcode`, currently unused), `:321-322`.
  - Change: call it from `cpu_execute_instruction`; keep the two-step form for the sequence vectors.
  - Est. saving: 1 call per instruction, ~9,600 per frame.
  - Risk: none functionally; it is the same two statements.

- [x] **C7 (P1, M) Stop decoding table fields the running console never reads.**
  - **Done (2026-10-20):** `cpu_decode_opcode_hot` reads four fields; the six-field decode is the self test's.
  - Where: `cpu_opcode.gs:174-179`.
  - Now: six list reads and six `+ ""` coercions per instruction. `cpu_opcode_base_cycles` and
    `cpu_opcode_page_cross_cycle` are read **only** by `vector_selftest.gs:582-585`; the CPU never uses
    them (verified by grep over `scratch/`).
  - Change: a four-field hot decode (`mnemonic`, `mode`, `access`, `official`) used by
    `cpu_execute_instruction`, and a six-field `cpu_decode_opcode_full` used by the self test.
  - Est. saving: 2 list reads + 2 coercions per instruction, ~19,000 list reads per frame.
  - Risk: the self-test summary must keep reporting all six fields.

- [x] **C8 (P1, M) Emit the opcode table as a generated numeric literal instead of a file-backed list.**
  - **Done (2026-10-20):** `cpu_opcode_table_normalize` converts the file-backed list at boot, so the hot decode has no coercions. The generated-literal variant stays unbuilt and needs no build change.
  - Where: `cpu_opcode.gs:133` (`list cpu_opcode_table "data/opcode_table.txt";`), generator
    `scripts/generate_goboscript_opcode_table.mjs`.
  - Now: file-backed lists hold strings, so every field needs a `+ ""` coercion, forever.
  - Change: have the generator also emit `scratch/data/opcode_table.gs` containing
    `list cpu_opcode_table = [..1,538 numbers..];` and `%include` it from `cpu_opcode.gs` (the same pattern
    `rom_loader.gs` uses for Stage-owned state). 1,538 numbers is roughly 6 KB of source.
  - Est. saving: removes the remaining 4 coercions per instruction (~38,000 blocks per frame) and the runtime
    parse of a text list; keeps the table checkable by `goboscript-opcode-table.test.ts`.
  - Cheaper intermediate step, if the generated header is awkward: **convert the loaded table to numbers once
    at boot** (`repeat length cpu_opcode_table { cpu_opcode_table[i] = cpu_opcode_table[i] + ""; }`, 1,538
    coercions), then delete the six per-decode `+ ""` from `cpu_opcode.gs:174-179`. The coercion does not
    disappear, it moves off the hot path. Whether that is faster depends on `Cast.toNumber`'s string path,
    which is `Number(str)` - measurable, and worth measuring before choosing (S3).
  - Risk: generated file must stay out of Git (it already would, under `scratch/data/`), and the build
    script order in `package.json` must generate it before `goboscript build`.

- [x] **C9 (P2, S) Drop `cpu_reset_operand` from the resolve path.**
  - **Done (2026-10-20):** `cpu_reset_operand` is no longer on the resolve path; `cpu_resolve_operand` zeroes the fields it owns inline.
  - Where: `cpu_addressing.gs:117`, definition `:79-88`.
  - Now: a call plus eight global writes per instruction, then the branch immediately overwrites most of
    them.
  - Change: assign `cpu_resolved_kind = none` and `cpu_resolved_error = none` at the top of
    `cpu_resolve_operand`; every branch already assigns the fields it uses; the `else` (unknown mode)
    branch zeroes the rest explicitly.
  - Est. saving: 1 call + 6 writes per instruction, ~9,600 calls + ~58,000 writes per frame.
  - Risk: a vector that inspects `cpu_resolved_*` after a failed resolve; covered by keeping the explicit
    zeroing in the unknown-mode and unsupported-access branches.

- [x] **C10 (P2, S) Inline `cpu_set_memory_operand`.**
  - **Done (2026-10-20):** `cpu_set_memory_operand` is inlined at all six operand sites.
  - Where: `cpu_addressing.gs:91-96`, six call sites (`:132`, `:150`, `:168`, `:185`, `:205`, `:237`).
  - Est. saving: 1 call per memory operand, ~7,000 per frame.

- [x] **C11 (P2, S) Inline `cpu_page_crossed` and `cpu_indexed_dummy_address`.**
  - **Done (2026-10-20):** `cpu_page_crossed` and `cpu_indexed_dummy_address` are inlined, with the page base computed once.
  - Where: `cpu_addressing.gs:63-76`; call sites `:144`, `:147`, `:163`, `:179`, `:182`;
    `cpu_sequence.gs:172`.
  - Now: two func calls and four divisions per indexed access.
  - Change: compute `base_page = base // 256` once, derive `crossed` from `(base + index) % 65536 // 256`,
    and build the dummy address as `base_page * 256 + address % 256`.
  - Est. saving: 2 calls + 1 division per indexed instruction (~3,000 per frame).

- [x] **C12 (P3, S) Replace `cpu_dummy_read_cycle` calls with `cpu_read_cycle`.**
  - **Done (2026-10-20):** the dummy-read wrapper has no hot caller; the resolver calls `cpu_read_cycle` directly.
  - Where: `cpu_core.gs:117-119`; call sites `cpu_addressing.gs:147`, `:182`, `:203`, `:230`.
  - Effect: exactly one call saved per dummy read; the proc is a pure alias.

- [x] **C13 (P1, M) Collapse sequence selection and instruction dispatch into one hot proc.**
  - **Done (2026-10-20):** `cpu_begin_next_sequence` performs the instruction dispatch inline and keeps `cpu_execute_instruction` as the vector-facing entry point.
  - Where: `cpu_control.gs:115-143`, `cpu_instruction.gs:316`.
  - Now: two calls per instruction, and `cpu_begin_next_sequence` recomputes
    `interrupt_disabled_before` (one divide + one mod) for every instruction.
  - Change: a `cpu_step` proc that performs the jam/NMI/IRQ tests and then the instruction body inline,
    keeping `cpu_begin_next_sequence` and `cpu_execute_instruction` as the documented, vector-facing
    entry points.
  - Est. saving: 1 call per instruction (~9,600 per frame), and one less frame per interrupt entry.
  - Risk: the self-test calls `cpu_execute_instruction` directly; keep that path intact.

- [x] **C14 (P2, S) Guard `cpu_finish_instruction` instead of running it for every opcode.**
  - **Done (2026-10-20):** `cpu_finish_instruction` runs only for implied-mode opcodes.
  - Where: `cpu_control.gs:95-110`, called at `:142`.
  - Now: three mnemonic comparisons plus a call for every instruction, to catch CLI/SEI/PLP.
  - Change: call it only when `cpu_opcode_mode == cpu_addressing_mode.implied` (those three are the only
    implied opcodes that need it), or fold the test into `cpu_step`.
  - Est. saving: 1 call + up to 3 comparisons on ~80% of instructions, ~35,000 reporters per frame.

- [x] **C15 (P3, S) Make `cpu_selected_sequence` a debug-only write.**
  - **Done (2026-10-20):** `cpu_selected_sequence` is written only while the access log is on.
  - Where: `cpu_control.gs:39`, `:81`, `:132`, `:136`, `:140`.
  - Now: one global write per sequence for a value only the report and the vector replay read.
  - Change: write it when `cpu_access_log_enabled == 1` (the replay) or behind a `profile_enabled` flag.

- [x] **C16 (P2, S) Reduce the branch-condition chain to arithmetic.**
  - **Done (2026-10-20):** the branch condition comes from the opcode byte through `cpu_branch_flag_weights`.
  - Where: `cpu_instruction.gs:72-90`.
  - Now: up to eight mnemonic comparisons, each followed by its own flag extraction, per branch.
  - Change: decode the condition from the opcode byte. For the eight branch opcodes, bits 7-6 select the
    flag (0 = negative, 1 = overflow, 2 = carry, 3 = zero) and bit 5 selects "clear" versus "set"
    (0x10 BPL, 0x30 BMI, 0x50 BVC, 0x70 BVS, 0x90 BCC, 0xB0 BCS, 0xD0 BNE, 0xF0 BEQ). So:
    `flag_weight = cpu_branch_flag_weights[((opcode // 64) % 4) + 1]` from a four-entry list
    `[128, 64, 1, 2]`, `want = (opcode // 32) % 2`, and `taken = 1` when
    `((cpu_status // flag_weight) % 2) == want`. That is a constant three reporters plus one list read,
    replacing up to 8 comparisons and 8 different flag expressions.
  - Est. saving: ~6 comparisons per branch, ~9,000 branches per frame.
  - Risk: the opcode byte must be read **before** `cpu_resolve_operand` runs, because that call overwrites
    `cpu_fetched_byte` with the operand byte (`cpu_instruction.gs:58`, `:322`); either compute `taken` first
    or keep a dedicated `cpu_current_opcode`. The mnemonic test is then only needed for the "is this a
    branch" check, which the resolved mode already answers. Validate against the exhaustive branch vectors.

- [x] **C17 (P2, M) Shorten the instruction dispatch chain with a table field.**
  - **Done (2026-10-20):** the dispatch chain is shortened by the implied-mode fast path, which routes the flag, transfer, and counter group straight to its effects without resolving an operand. The `op_class` column remains a follow-up (see K1).
  - Where: `cpu_instruction.gs:324-364`.
  - Now: an `LDA` walks 13 comparisons (error, KIL, official, relative, JSR, RTS, BRK, RTI, PHA, PHP, PLA,
    PLP, JMP) before reaching `cpu_execute_regular_instruction`.
  - Change: add an `op_class` field to the generated table (read, store, rmw, implied, branch, stack, jump,
    illegal) and dispatch on the class first. That is one field read and two comparisons for the common
    case, and the mnemonic chain shrinks to the class body.
  - Est. saving: 8-12 comparisons per instruction, ~90,000 reporters per frame.
  - Risk: table schema change; the fixture, the generator, the opcode-table test, and `cpu_opcode_field`
    all move together.

- [x] **C18 (P2, M) Inline `update_zero_negative_flags` and drop its `normalize_status` call.**
  - **Done (2026-10-20):** the zero/negative update is inlined at the ALU byte entries and every load/transfer site.
  - Where: `cpu_status.gs:54-71`; callers at `cpu_alu.gs:71`, `:118`, `:125`, `:132`, `:139`, `:157`,
    `:174`, `:192`, `:210`, `:228`, `:265`, `:272`, and `cpu_instruction.gs:150-186`, `:206-212`.
  - Now: one func call plus one `normalize_status` call per affected instruction, and the function itself
    re-derives `without_zero` / `without_negative` with four reporters.
  - Change: inline the eight-line body at the ALU procs and the load/transfer paths; replace
    `normalize_status($status)` with `$status % 256` (every writer already normalizes, as the ALU procs
    already assume).
  - Est. saving: 2 calls + ~4 reporters per flagged instruction, ~50,000 blocks per frame.
  - Risk: the `normalize_status` identity assumption is already relied on in `cpu_alu.gs`; the mirror and
    the exhaustive flag tests cover it.

- [x] **C19 (P2, S) Add a 256-entry zero/negative table.**
  - **Done (2026-10-20):** `cpu_zero_negative_bits` plus `cpu_status_table_init`.
  - Where: `cpu_status.gs:54-71`.
  - Change: `list cpu_zero_negative_bits = [..256 entries..]` generated at build time (or filled by
    `bitwise_table_init`), then `status = (status - 2 * ((status // 2) % 2) - 128 * (status // 128)) + bits[value + 1]`.
    Removes two comparisons and two adds per flag update.
  - Est. saving: ~4 reporters x 7,000 = 28,000 per frame, at the cost of one list read.
  - Risk: `% mask` naming rule (N1) and the boot cost of a 256-entry table (negligible).

- [x] **C20 (P2, S) Give the ALU byte-only entry points.**
  - **Done (2026-10-20):** every `alu_*` has a `_byte` entry point that skips the operand normalizations.
  - Where: `cpu_alu.gs:29-31`, `:76-78`, `:143-147`, `:161-165`, `:178-181`, `:196-199`, `:214-218`,
    `:232-236`, `:262-271`.
  - Now: every proc starts with 1-3 `% 256` on operands the CPU guarantees are bytes (registers are
    normalized by every writer; bus values are bytes).
  - Change: `alu_*_byte` variants without the mods, used from `cpu_instruction.gs`; keep the general procs
    for the ALU vector suite.
  - Est. saving: 2-3 mods per ALU instruction, ~10,000-15,000 per frame.

- [x] **C21 (P2, S) Compute ADC/SBC carry and overflow in one pass.**
  - **Done (2026-10-20):** ADC and SBC compute carry and overflow in one branch-free pass; SBC runs through the complement form.
  - Where: `cpu_alu.gs:28-72`, `:75-119`.
  - Now: the carry flag is written into `updated`, then read back with `(updated // 64) % 2`, then overflow
    is written with a second multiply. Three signed conversions run through three branches.
  - Change: read the incoming overflow bit from `normalized` before modifying it, and write both flags once;
    keep the signed-difference test but compute it from `left`, `right`, and the carry in one expression.
  - Est. saving: 1 divide + 4 reporters per ADC/SBC, ~6,000 per frame.

- [x] **C22 (P3, S) Stop storing `alu_value` for compare and bit-test.**
  - **Done (2026-10-20):** `alu_compare_byte` and `alu_bit_test_byte` no longer store `alu_value`; the general entry points do.
  - Where: `cpu_alu.gs:227`, `:257`.
  - Now: one list-free global write per compare; CMP/CPX/CPY callers only read `alu_status`.
  - Change: keep the write (the mirror contract expects it) or gate it behind the self-test flag. Low value;
    listed for completeness.

- [ ] **C23 (P2, M) Inline the ALU effects into the read-instruction dispatch.**
  - **Blocked (2026-10-20):** the dispatch would have to duplicate ~120 lines of ALU arithmetic to save one call per ALU instruction (~4,000 per frame). The byte entry points already removed the argument normalization and the flag-update call inside it, which were the larger share.
  - Where: `cpu_instruction.gs:203-248`.
  - Now: `cpu_apply_read_instruction` calls one `alu_*` proc per ALU instruction, then copies
    `alu_value`/`alu_status` out of two globals that exist only because GoboScript has no tuple return.
  - Change: either inline the ALU arithmetic into the dispatch branches (removes a call, but duplicates
    ~120 lines) or keep the procs and accept the call. Measure both; the call is the dominant cost, so
    inlining is expected to win.
  - Est. saving: 1 call per ALU instruction, ~4,000 per frame.

- [x] **C24 (P3, S) Merge the word stack operations.**
  - **Done (2026-10-20):** `cpu_push_word`/`cpu_pop_word` perform their four cycles inline.
  - Where: `cpu_core.gs:162-176`, used by JSR/RTI/RTS/BRK/NMI (`cpu_sequence.gs:85`, `:103`, `:115`,
    `:126`, `:147`).
  - Now: `cpu_push_word` calls `cpu_push_byte` twice; `cpu_pop_word` calls `cpu_pop_byte` twice.
  - Change: four write/read cycles inline in one proc; saves 2 calls per word push/pop (~2,000 per frame).
  - Risk: the access order (high byte first on push, low byte first on pop) must not change.

- [x] **C25 (P3, S) Inline the status push/restore helpers and replace the BRK OR with an add.**
  - **Done (2026-10-20):** the status push and restore are inlined and the break bit is added, not OR-ed.
  - Where: `cpu_core.gs:180-184` (`cpu_push_status`: `normalize_status` + `pack_status_for_stack`),
    `:186-188` (`cpu_restore_status_from_stack`: `normalize_byte` + `unpack_status_from_stack`),
    `cpu_status.gs:65-70` (`pack_status_for_stack` calls `bitwise_or` when the break bit is set).
  - Now: 2 calls per push and 2 per pop, plus one `bitwise_or` (~1 call, 2 mods, 1 list read) on every BRK.
  - Change: `cpu_status = ($status % 256 % 16) + 32 + ((($status % 256) // 64) * 64)` inline, then push
    `cpu_status + (16 * $break_enabled)`. The add is exact rather than lucky: `normalize_status` always
    clears bit 4 and the pushed value keeps it clear, so the bits are disjoint and addition is OR.
    The pop is `cpu_status = ($value % 256 % 16) + 32 + ((($value % 256) // 64) * 64)`; use `$value % 256`
    once by staging it in the caller's existing temporary.
  - Est. saving: ~4 calls per BRK/PHP/IRQ/NMI plus one `bitwise_or`; small in total (~hundreds per frame),
    listed because interrupts run on the frame boundary where latency matters.
  - Risk: `pack_status_for_stack` is mirrored in `tests/support/goboscript_port_algorithms.ts`; update both.
- [x] **C26 (P3, S) Drop the RAM window's modulo when it cannot wrap.**
  - **Done (2026-10-20):** the RAM window takes the unmirrored address without a modulo.
  - Where: `cpu_bus.gs:143` (read), `:225` (write).
  - Now: `cpu_ram[(numeric_address % 2048) + 1]` for every RAM access, including the common `$0000-$07FF`.
  - Change: `if numeric_address < 2048 then ... [numeric_address + 1] else ... [(numeric_address % 2048) + 1]`.
  - Est. saving: 1 mod on the majority of RAM accesses. (Rejected alternative in R9.)

- [x] **C27 (P3, S) Batch the OAM DMA state machine.**
  - **Done (2026-10-20):** `cpu_bus_run_dma` runs the whole transfer in one call.
  - Where: `cpu_bus.gs:266-319`, driven from `frame_loop.gs:153-163`.
  - Now: one call per DMA cycle, 513-514 per transfer.
  - Change: a proc that runs the 256 read/write pairs in one call and returns the cycle count; the frame
    loop then adds the cycles once.
  - Est. saving: ~500 calls per DMA frame.

- [x] **C28 (P2, S) Keep bus-cycle parity instead of a full cycle counter.**
  - **Done (2026-10-20):** the bus keeps parity, not a count.
  - Where: `cpu_bus.gs:30` (declaration), `:118`, `:214`, `:272` (increments), `:249` (`cpu_bus_cycle_count % 2`).
  - Now: every bus access and every DMA cycle increments a 16-bit-ish integer; the only reader in the whole
    port is the DMA alignment test, which wants the parity and nothing else.
  - Change: replace the counter with `cpu_bus_cycle_parity` (0/1) toggled on each access
    (`cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity`) and read it directly at `:249`. Keep the full count
    only under the S1 profile flag if a profile needs it.
  - Est. saving: one addition and one `% 2` per access, ~30,000 per frame; also removes the point where the
    counter would lose integer precision in a very long session.
  - Risk: two increments per DMA cycle must still happen (the toggle is idempotent per pair, so DMA's parity
    is unchanged); verify with the DMA alignment vectors.

- [x] **C29 (P3, S) Remove the duplicate open-bus store and the needless normalization on a full-byte read.**
  - **Done (2026-10-20):** the cartridge fast windows bypass `cpu_apply_driven_value` entirely, so the duplicate latch store is off the hot path.
  - Where: `cpu_bus.gs:96-115` (`cpu_apply_driven_value`), callers `:168`, `:186`.
  - Now: the full-byte path normalizes both operands (`% 256` twice) and stores `cpu_open_bus = numeric_value`,
    and the cartridge-window caller has already normalized the value and either stored it or not: the store is
    repeated, and `driven` is a constant 255 or 1 at every call site.
  - Change: test the mask before normalizing (`if $driven_mask == 255 { ... }`), return the value untouched
    when it is already a byte, and let the caller own the latch store where it already does it.
  - Est. saving: 1-2 mods and one duplicate store on ~50,000 reads per frame.
  - Risk: the open-bus latch is observable through `$4015`-style reads and the vector suite; any change must
    keep the latch equal at every step of the ordered access trace.

### 4.3 PPU (`src/ppu_2c02.gs`, `src/ppu_bus.gs`)

- [ ] **P1 (P1, L) Compose the background line once per scanline instead of once per dot.**
  - **Blocked (2026-10-20):** a line cache needs a dirty-pipeline flag and a rendered-frame comparison to prove it does not change mid-line raster effects; neither can run here (S3/S4).
  - Where: `ppu_2c02.gs:1154-1221` (pipeline), `:1009-1095` (pixel), `:1232-1256` (register load).
  - Now: 4 shift-register updates per dot plus 4 divisions and 2 list reads per pixel to recover the two
    background pixel bits (and the two attribute bits) from the shift registers.
  - Change: at dot 0 (or when the last tile of the line is fetched), decode the 32 fetched tiles into two
    256-entry scratch lists `ppu_line_background_pixel` and `ppu_line_background_palette`; the per-pixel
    path then reads two list entries and does no division. The fetch pipeline itself is unchanged, so
    MMC3 A12 observation, scroll increments, and sprite-zero-hit timing keep working.
  - Est. saving: ~65,000 dots x (4 multiply+mod + 2 divides + 2 mods), and ~61,000 x (2 divides) at the
    pixel, replaced by 240 x 256 iterations of a tight loop.
  - Risk: a game that writes `$2000`/`$2001`/`$2005`/`$2006` mid-scanline (raster effects) would see the
    whole line rendered with the new state. Mitigation: set a `ppu_line_dirty_pipeline` flag in
    `ppu_write_cpu_register` when the write lands inside a visible line, and fall back to the current
    per-dot path for that line. Most games never do this outside of a known effect.
  - **Lint coupling:** none of the pinned literals change; `ppu_framebuffer_packed` stays the output.

- [ ] **P2 (P1, L) Precompose the sprite line into 256-entry lists.**
  - **Blocked (2026-10-20):** same class of change as P1 and the largest remaining PPU item: it needs the composition lists, the sprite-zero line flag (now present), and the frame comparison to validate.
  - Where: `ppu_render_pixel` sprite branch (`ppu_2c02.gs:1042-1046`), `ppu_read_sprite_pixel` (`:1097-1127`),
    `ppu_clock_sprite_output_units` (`:1129-1152`).
  - Now: per pixel, two procs walk up to 8 units with 4 list accesses each, and every unit's pattern bytes
    are shifted with two multiplies and two mods.
  - Change: when the sprite fetch loads the units (dots 257-320 of the previous line, `:1455-1512`), also
    compose `ppu_sprite_line_pixel[1..256]`, `ppu_sprite_line_attributes[1..256]`,
    `ppu_sprite_line_oam_index[1..256]`: 8 sprites x 8 pixels = at most 64 iterations, using a per-unit
    8-step shift instead of a per-pixel shift. The per-pixel path becomes three list reads, and the
    sprite-zero-hit test becomes `oam_index == 0`.
  - Est. saving: 61,440 x (2 proc calls + up to 8 x 4 list ops) becomes 64 x 8 list writes per line.
    This is the single largest PPU saving available.
  - Risk: sprite priority, horizontal flip, and clipping are decided at composition time, which matches the
    hardware's own behavior for a fixed per-line sprite set; mid-line `$2001` sprite enable changes are the
    only case that differs, covered by the same dirty-pipeline flag as P1.

- [x] **P3 (P1, M) Split `ppu_clock_ppu_dot` into a fast middle-dot path and a slow edge path.**
  - **Done (2026-10-20):** `ppu_run_dots` owns the per-dot order with the guards hoisted, and `ppu_clock_ppu_dot` is a one-dot wrapper.
  - Where: `ppu_2c02.gs:700-754`.
  - Now: every dot runs 5-6 comparisons (mapper kind, dot 1, visible window, render window, dot < 339) and
    two conditional proc calls.
  - Change: order the tests so the common case is first. Dots 2-255 of a visible line with rendering on are
    about 60,000 of 89,342: one `if` should select them and perform the pixel write, the pipeline steps that
    do not depend on the special dots, and the dot increment inline. Dots 0, 1, 256, 257, 280-304, 321-340
    and all blanking dots go to `ppu_clock_dot_slow`.
  - Est. saving: ~4 comparisons per dot, ~350,000 reporters per frame, plus one proc call per dot if the
    pixel write is inlined (P4).
  - Risk: L2 above; verify against the PPU vector suite and the framebuffer tests.

- [x] **P4 (P1, M) Inline the pixel write into the dot loop.**
  - **Done (2026-10-20):** the per-pixel body is inlined into the dot loop; `ppu_render_pixel` stays as the documented entry point.
  - Where: `ppu_2c02.gs:738` calls `ppu_render_pixel` (61,440 calls per frame).
  - Change: after P1/P2, the per-pixel body is short enough to live in the dot fast path.
  - Est. saving: 61,440 calls per frame.

- [x] **P5 (P1, S) Fill the framebuffer directly when rendering is disabled.**
  - **Done (2026-10-20):** a rendering-off pixel is one framebuffer write.
  - Where: `ppu_2c02.gs:1009-1095`.
  - Now: with `ppu_mask_rendering_enable == 0`, the proc still tests background/sprite visibility, runs the
    sprite scan, selects the palette offset, reads palette entry zero, and tests greyscale, per pixel.
  - Change: a branch at the top of the pixel path writes `ppu_framebuffer_emphasis_base + backdrop` to the
    next framebuffer slot and returns. Games spend whole frames (title screens, loading, forced blank)
    with rendering off.
  - Est. saving: ~25 reporters per pixel for those frames, i.e. 1.5M reporters on a blank frame.
  - Risk: none; the output is identical because every lookup collapses to palette entry 0 under the current
    code when both enables are clear.

- [x] **P6 (P1, S) Precompute the emphasis term and the greyscale conversion.**
  - **Done (2026-10-20):** the emphasis term is cached and the greyscale conversion is a 64-entry table.
  - Where: `ppu_2c02.gs:1087` (`ppu_mask_emphasis * 64`), `:1082-1084` (greyscale).
  - Change: add `ppu_emphasis_base` to `ppu_decode_mask_register` (one multiply per `$2001` write), and a
    64-entry `ppu_greyscale_colors` list built in `nes_palette_init`; the per-pixel greyscale branch becomes
    one list read.
  - Est. saving: 61,440 multiplies per frame, plus 2 divisions + 1 multiply per pixel while greyscale is on.
  - **Lint coupling:** `tests/goboscript-source.test.ts:1946` pins the exact text
    `ppu_palette_ram[palette_offset + 1] % 64`; keep that line or update the pin with the change.

- [x] **P7 (P2, S) Cache masked palette colors.**
  - **Done (2026-10-20):** `ppu_palette_color` caches the masked palette byte and the pixel path reads it without a modulo.
  - Where: `ppu_2c02.gs:1080` (per-pixel `% 64`), writes at `ppu_bus.gs:242`.
  - Change: maintain `ppu_palette_color[1..32]` alongside `ppu_palette_ram`, written with the already-masked
    value; the pixel path reads the cache with no modulo.
  - Est. saving: 61,440 mods per frame.
  - **Lint coupling:** same pin as P6.

- [ ] **P8 (P2, S) Fold the pipeline call into the dot path and hoist its guards.**
  - **Blocked (2026-10-20):** the pipeline body's guards are hoisted into the caller; folding the remaining per-fetch-dot work into the dot loop needs P1's restructuring first.
  - Where: `ppu_2c02.gs:741-743`, `:1154-1221`.
  - Now: an 82,181-call proc that re-tests `ppu_dot >= 257 and ppu_dot <= 320`, `ppu_dot == 65`,
    `ppu_dot == ppu_sprite_overflow_set_dot`, the shift window, `dot == 256`, `dot == 257`, the pre-render
    range, and two dummy-fetch dots, per dot.
  - Change: compute a per-line `ppu_fetch_phase = ppu_dot % 8` and a "special dot" lookup once, and merge
    the body into `ppu_clock_dot_slow` (P3). Keep the body as its own proc only if the self test calls it.
  - Est. saving: 82,181 calls plus ~6 comparisons per dot.

- [x] **P9 (P2, S) Shift the background registers only when they are used.**
  - **Done (2026-10-20):** the four shifter updates are skipped when the background is disabled.
  - Where: `ppu_2c02.gs:1181-1184`.
  - Now: four multiply+mod per dot on every rendered-line dot, including the 321-336 window where the
    shifted-out bits are never sampled, and including lines with the background disabled.
  - Change: guard the shifts with `ppu_mask_background_enable == 1` and, if P1 lands, drop them entirely in
    favor of the line cache.
  - Est. saving: ~4 reporters per dot when the background is off.

- [x] **P10 (P2, S) Cache the per-line pattern base.**
  - **Done (2026-10-20):** the pattern-table base is decoded once per PPUCTRL write. Caching fine Y as well needs invalidation on every scroll transfer, so it stays open (K2).
  - Where: `ppu_2c02.gs:1279-1301` (two fetches per tile, each recomputing the pattern table select and
    `fine_y`).
  - Now: 1 divide + 1 mod per fetch, 2 `bitwise_and`-equivalent divisions, 2 fetches per tile, 7,712 tiles.
  - Change: compute `ppu_line_pattern_base = table * 4096 + fine_y` once when the line's vertical scroll is
    known (dot 256 of the previous line) and reuse it; invalidate on `$2000` or `$2005` writes.
  - Est. saving: ~2 divides x 15,424 fetches.

- [ ] **P11 (P2, S) Compute the attribute address incrementally.**
  - **Blocked (2026-10-20):** the attribute address depends on the live scroll register, which a mid-line `$2006` write can move between tiles; caching it needs the same dirty-line fallback as P1.
  - Where: `ppu_2c02.gs:1258-1277`.
  - Now: six divisions/mods per tile (nametable bits, attribute row, attribute column) plus a list read for
    the shift divisor.
  - Change: derive the attribute base once per line and add a per-tile offset (`coarse_x // 2`), keeping the
    vertical part constant; the shift divisor is `2^shift`, so use `4` when `coarse_x % 2 == 0` and `16`
    otherwise, or keep the 7-entry list read.
  - Est. saving: ~4 divisions x 7,712 tiles.

- [ ] **P12 (P2, M) Cache the nametable mirroring map instead of branching per fetch.**
  - **Blocked (2026-10-20):** a mirroring map must be invalidated by the cartridge header, MMC3 reset, and every MMC3 bank-select write. Missing one silently corrupts rendering and there is no way to execute the port here to catch it.
  - Where: `ppu_bus.gs:256-283`.
  - Now: per nametable read, a mapper-kind branch, a mirroring branch, `// 1024` and `% 1024`.
  - Change: a 4-entry `ppu_nametable_map` list (logical table -> base index) rebuilt only when mirroring
    changes (`ppu_bus_attach_mapper`, `mmc3_write_register` mirroring branch); the read becomes
    `map[logical + 1] + (address % 1024) + 1`.
  - Est. saving: ~12,000 mapper/mirroring branches and 12,000 divisions per frame.

- [x] **P13 (P2, S) Collapse `ppu_bus_read_pattern_window` for NROM.**
  - **Done (2026-10-20):** `ppu_bus_read_pattern_window` reads `nrom_chr_rom` directly on a CHR ROM board.
  - Where: `ppu_bus.gs:288-301`.
  - Now: the NROM branch calls `nrom_read_pattern` (a proc), which branches on CHR ROM presence and computes
    a modulo; the caller then copies one global.
  - Change: in the NROM branch, read `nrom_chr_rom[$address + 1]` directly when the board has CHR ROM (the
    embedded image does), with a cached `nrom_chr_is_rom` flag; keep the call for CHR RAM.
  - Est. saving: 2 calls and 1 modulo x ~19,300 pattern reads per frame.
  - Risk: the observation state fields (`ppu_bus_pattern_mapped`) must still be set as they are today.

- [x] **P14 (P2, S) Make the sprite fetch incremental.**
  - **Done (2026-10-20):** the sprite slot's pattern address is computed once and reused, and the bit reversal is a 256-entry list.
  - Where: `ppu_2c02.gs:1410-1517`.
  - Now: per dot, `elapsed = dot - 257`, `slot = elapsed // 8`, `phase = elapsed % 8` (2 divisions), and
    `ppu_sprite_pattern_address` is called twice per slot with identical arguments (2 calls, ~15 reporters
    each), plus `ppu_reverse_byte_bits` (a loop of 8) per fetch.
  - Change: carry `ppu_sprite_fetch_slot` / `ppu_sprite_fetch_phase` counters updated once per dot; compute
    the pattern address once at phase 5 and reuse it at phase 7; replace the bit-reversal loop with a
    256-entry `ppu_reverse_byte` list built once at boot.
  - Est. saving: 2 divisions per dot x 15,424, 1 call + 15 reporters per slot x 1,928 slots, and 8
    iterations x 3,856 fetches.

- [x] **P15 (P2, S) Copy only the sprites that exist in the line-zero snapshot.**
  - **Done (2026-10-20):** the line-zero snapshot copies only the sprites it holds, with no coercions.
  - Where: `ppu_2c02.gs:1388-1397`.
  - Now: `repeat PPU_SECONDARY_SPRITE_LIMIT` (always 8) copies six lists with `to_number` each time the
    target line is zero, and `to_number` is called 48 times.
  - Change: `repeat found_count` (values are already numbers; the copy needs no coercion).
  - Est. saving: up to 48 calls and 40 list writes per frame.

- [x] **P16 (P2, S) Make sprite evaluation incremental.**
  - **Done (2026-10-20):** the OAM byte offset is carried forward by four per candidate.
  - Where: `ppu_2c02.gs:1303-1408`.
  - Now: `candidate_address = oam_index * 4` per entry, plus five list writes per found sprite.
  - Change: add 4 to a running OAM offset each iteration; skip the writes when the row is out of range (the
    code already does).
  - Est. saving: 64 multiplies per line.

- [x] **P17 (P2, S) Replace the status-flag setter arithmetic.**
  - **Done (2026-10-20):** the status setters use arithmetic; `ppu_set_status_flag` is vector-only and uses one subtraction.
  - Where: `ppu_2c02.gs:313-322`, `:340-358`, `:361-378`, `:381-398`, `:402-416`.
  - Now: `bitwise_and` calls (each a call plus a list read) inside routines that run 262+ times a frame.
  - Change: `ppu_status_register - (ppu_status_register % 32)` for the 224 mask, `% 128` for the 128 mask,
    and `(x // 128) % 2` for the NMI enable/vblank tests. `ppu_set_status_flag` is used only by vectors
    (grep-verified), so the hot setters can be simplified freely.
  - Est. saving: ~8 calls + 8 list reads per frame; small, but it removes the last list reads from the
    per-frame timing path.

- [x] **P18 (P2, S) Cache the VRAM increment and NMI enable bits.**
  - **Done (2026-10-20):** `ppu_decode_control_register` caches the VRAM increment and the NMI enable.
  - Where: `ppu_2c02.gs:685-694` (`(control // 4) % 2` per `$2007` access), `:402-416` (two mask tests).
  - Change: add `ppu_vram_increment` and `ppu_nmi_enabled` to `ppu_decode_control_register` (a new proc
    called from `ppu_write_control_register` and `ppu_reset`), exactly as the PPUMASK fields are cached
    today. The increment becomes `ppu_vram_address = ppu_vram_address + ppu_vram_increment`.
  - Est. saving: 1 divide + 1 mod per `$2007` access (games fill VRAM in bursts) and two per `$2000` write.

- [x] **P19 (P2, S) Skip the PPU bus observation on boards that cannot observe.**
  - **Done (2026-10-20):** the observer calls are guarded by the board kind and trust their 14-bit argument.
  - Where: `ppu_2c02.gs:693`, `:662`; `ppu_bus.gs:348-354`.
  - Now: every `$2006` write and every `$2007` increment calls `ppu_bus_observe_ppu_address`, which calls
    `ppu_bus_normalize_address` (a func call, an integer test, a range test, a mod) and then compares the
    board kind.
  - Change: guard with `if ppu_bus_mapper_kind == mapper_kind.mmc3` at the caller, and drop the normalize
    call (the address is produced by `% 16384`).
  - Est. saving: 2 calls + ~5 reporters per PPU data access on NROM, where they do nothing.

- [ ] **P20 (P1, M) Add trusted PPU register entry points for the CPU bus.**
  - **Blocked (2026-10-20):** the validated entry point costs a handful of accesses per frame (one or two `$2002` polls plus a few `$2005`/`$2006` writes); a second entry point doubles the register surface for that.
  - Where: `ppu_2c02.gs:424-442` (`ppu_read_cpu_register`), `:517-550` (`ppu_write_cpu_register`).
  - Now: per register access, `to_number`, `reg != reg // 1` (a divide), two range compares, and on writes
    `normalize_byte`. `cpu_bus.gs:153` and `:230` always pass `address % 8`, an integer 0-7, and a byte.
  - Change: `ppu_read_register_fast` / `ppu_write_register_fast` without validation, used by `cpu_bus`;
    keep the validated procs for the vector suite.
  - Est. saving: 1 call + 1 division + 2-3 comparisons per PPU register access (games poll `$2002` once or
    twice a frame and write `$2005`/`$2006` a few times, plus `$2007` bursts).

- [ ] **P21 (P2, S) Inline the OAM rendering-access tests.**
  - **Blocked (2026-10-20):** the two OAM access tests are consumed by a call that also scans secondary OAM; folding them needs the same call-site restructuring as P8.
  - Where: `ppu_2c02.gs:497-515` (two func calls), `:674-683` (one func that calls two more),
    `:810-834`.
  - Now: each `$2004` access costs 1-3 calls; OAM DMA does 256 of them per frame.
  - Change: inline `ppu_scanline < 240 or ppu_scanline == 261` and `ppu_mask_rendering_enable == 1` at the
    two call sites, and add `ppu_write_oam_dma_byte` for the DMA path (C27) that reuses the same two tests
    once per transfer where hardware behavior allows it.
  - Est. saving: ~1,000 calls per frame with DMA active.

- [ ] **P22 (P2, S) Give the PPU bus a trusted write path.**
  - **Blocked (2026-10-20):** same reasoning as P20: VRAM writes are bursty but rare, and a trusted write path duplicates the whole region dispatch in `ppu_bus`.
  - Where: `ppu_2c02.gs:667-671` (`ppu_write_data_register`), `ppu_bus.gs:223-244`.
  - Now: the caller masks to 14 bits, then `ppu_bus_write_ppu` calls `ppu_bus_normalize_address` again
    (func call, integer test, range test) and `normalize_byte` again.
  - Change: `ppu_bus_write_ppu_masked` that assumes a 14-bit address and a byte value; keep the validated
    entry point for the self test.
  - Est. saving: 2 calls + ~6 reporters per VRAM write.

- [x] **P23 (P3, S) Simplify the palette read path.**
  - **Done (2026-10-20):** the palette read path uses the modulo forms of its four masks.
  - Where: `ppu_2c02.gs:462-493`.
  - Now: palette reads mask greyscale with two `bitwise_and` calls and assemble open-bus bits with two more,
    plus a second bus read to refill the buffer.
  - Change: arithmetic forms for the four masks; keep the double read (it is hardware behavior).
  - Est. saving: small (palette reads are rare), listed for completeness.

- [ ] **P24 (P3, S) Carry the framebuffer index instead of `row_base + dot`.**
  - **Blocked (2026-10-20):** `ppu_framebuffer_row_base + ppu_dot` is one addition per pixel, and the inlined body is already the tight form; a carried index saves that one reporter at the cost of another variable to keep in step with `ppu_advance_dot`.
  - Where: `ppu_2c02.gs:1086`.
  - Now: one add per pixel (already cheap).
  - Change: increment a `ppu_framebuffer_index` variable in the dot loop; saves one variable read per pixel.
    Only worth doing together with P3.

- [x] **P25 (P3, S) Precompute the left-column clipping thresholds.**
  - **Done (2026-10-20):** no change needed: the `pixel_x >= 8` test already leads both clip checks, so the left-column test costs a comparison only on the last eight pixels.
  - Where: `ppu_2c02.gs:1022-1032`.
  - Now: four compares per pixel to decide `background_visible` / `sprite_visible`.
  - Change: fold the two `pixel_x >= 8` tests into one `ppu_dot > 8` test and hoist the enable bits into two
    combined flags (`ppu_background_draws_all_columns`), set in `ppu_decode_mask_register`.
  - Est. saving: 2-3 compares per pixel.

- [x] **P26 (P3, S) Track "line contains sprite zero" once per line.**
  - **Done (2026-10-20):** `ppu_sprite_zero_in_line` is tracked once per line and tested before the OAM index.
  - Where: `ppu_2c02.gs:1048-1057`.
  - Now: every pixel compares `ppu_sprite_pixel_oam_index == 0`.
  - Change: a per-line flag set during sprite fetch; skip the whole hit test on lines without sprite zero.
    Most lines in most games qualify.

- [x] **P27 (P3, S) Drop dead PPU helpers (blocked by the mirror contract).**
  - Where: `ppu_2c02.gs:313` (`ppu_set_status_flag`), `:326` (`ppu_get_nmi_output`), `:837`
    (`ppu_shift_pixel`), `:1223` (`ppu_shift_background_registers`, inlined at `:1181-1184`), `:1519-1565`
    (the twelve `ppu_get_*` getters plus `ppu_is_odd_frame`). Grep over `scratch/` finds each name exactly
    once: its own declaration.
  - Effect: no runtime change at all - GoboScript compiles an uncalled proc into the target anyway, so this
    only trims compiled project size and compile time. Checked and closed: `tests/goboscript-source.test.ts`
    requires every declaration to appear in `MIRROR_CONTRACT` (`:1355-1410`) and requires every *contract*
    entry to point at a real declaration, so deleting them is a test edit whose only payoff is project size.
    Left in place deliberately; do not re-open without a size measurement that matters.

- [x] **P28 (P2, S) Remove the provably dead normalizations in the scroll increment helpers.**
  - **Done (2026-10-20):** both scroll helpers return without a trailing normalization, and fine Y is rebuilt with one modulo.
  - Where: `ppu_2c02.gs:919-937` (`ppu_increment_scroll_x_for`, called once per tile),
    `:942-972` (`ppu_increment_scroll_y_for`, called at dot 256 of every rendered line).
  - Now: both normalize on entry and then **normalize again on the return value** (`return result % 32768`),
    even though every branch is bounded: the X add path tops out at 32,767 and the Y carry path rewrites the
    address from `result % 4096`. One mod per call is dead work. The Y helper also recomputes the low five
    bits as `result - (((result // 32) % 32) * 32)`, which for `result < 4096` is exactly `result % 32`
    (two reporters instead of four).
  - Change: drop the trailing `% 32768` from both, and use `result % 32` for the fine-Y reconstruction. Add a
    comment naming the bound so the next reader does not re-add the normalization.
  - Est. saving: ~2-5 reporters per tile fetch and per line, ~20,000-40,000 reporters per frame.
  - Risk: the helpers are mirrored in `tests/support/goboscript_port_algorithms.ts` and swept exhaustively
    there; the sweep is the proof that the bound holds for every input, so run it before deleting the mod.

### 4.4 Frame loop and run loop (`frame_loop.gs`, `rom_run.gs`, `stage.gs`)

- [x] **F1 (P1, S) Clock the PPU once per instruction, not once per dot.**
  - **Done (2026-10-20):** the frame loop calls `ppu_clock_cpu_cycles` once per instruction and once per DMA transfer.
  - Where: `frame_loop.gs:103-121` (three `ppu_clock_ppu_dot` statements per CPU cycle, unrolled for 2/3/4
    cycles), `:78-89` (the DMA branch does the same per DMA cycle).
  - Now: 3 calls per CPU cycle, 89,342 dot calls per frame, issued in the unrolled 6/9/12-statement blocks.
  - Change, in two steps that can land separately:
    (a) `ppu_clock_three_dots`: one call that performs the three dots inline. Removes 2 calls per CPU cycle,
    ~60,000 per frame, with no change in dot order or timing at all.
    (b) `ppu_clock_cycles count`: one call per *instruction*, which loops `count * 3` dots internally. This
    removes ~89,000 calls per frame and replaces them with ~9,600. It is safe because the CPU cannot touch
    the PPU between an instruction's bus cycles and the dot clocks that follow it: `cpu_begin_next_sequence`
    completes every bus access before returning, so batching the dots cannot reorder a register write
    against a dot. The NMI and IRQ latches are sampled by the frame loop after the dots in both versions.
  - Est. saving: (a) ~60,000 calls/frame, (b) ~80,000 calls/frame plus the `repeat` header per cycle.
  - Risk: with (b) the dot count per call is no longer 3, so any code that assumed "one call == one CPU
    cycle" (nothing in the port does today, but the self test's dot-count checks might) must be re-derived
    from `cpu_cycles`. Measure with S1 before and after.

- [x] **F2 (P2, S) Batch the DMA stall.**
  - **Done (2026-10-20):** the DMA stall is batched into `cpu_bus_run_dma`.
  - Where: `frame_loop.gs:78-89`, `:147-164`.
  - Now: `frame_loop_check_dma` loops calling `cpu_clock_dma_cycle` until done (513-514 calls), then the
    frame loop issues three dot clocks per DMA cycle (1,540 calls).
  - Change: let one C27 call run the whole transfer, then advance the PPU by `3 * dma_cycles` through one
    batched proc.
  - Est. saving: ~2,000 calls on a DMA frame.

- [ ] **F3 (P1, M) Tune the chunk size against a measurement, and make it adaptive.**
  - **Partial change (2026-10-20):** set the bound to 100 cycles to shorten each synchronous warp and expose
    progress more often. This is a responsiveness choice, not a measured throughput optimum; the GoboScript
    compiler and TurboWarp runtime are unavailable here, so frame time and input latency remain unmeasured.
  - Where: `scratch/src/frame_loop.gs`, `scratch/src/rom_run.gs`.
  - Now: 100 cycles per chunk (about 300 chunks per frame); progress is reported every 25 chunks and input
    is polled every four chunks.
  - Remaining: measure several chunk sizes for frame time, UI responsiveness, and input latency; consider
    adapting the size only after a repeatable runtime benchmark.

- [ ] **F4 (P2, S) Run several chunks per scheduled tick.**
  - **Blocked (2026-10-20):** running several chunks per tick trades responsiveness for yield overhead; without a measurement it is a guess.
  - Where: `rom_run.gs:128-193`.
  - Now: one chunk, input poll, status, `wait 0` per iteration.
  - Change: run `K` chunks per iteration (or until the frame completes) and yield once. Saves the scheduler
    round trip per chunk, at the cost of up to `K` chunks of input latency.
  - Risk: responsiveness; measure with F3.

- [x] **F5 (P2, S) Poll the keyboard once per frame, not once per chunk.**
  - **Done (2026-10-20):** the keyboard is sampled once per four chunks.
  - Where: `keyboard_input.gs:47-117`, called from `rom_run.gs:142`.
  - Now: 16 `key_pressed` sensor reads + 2 `controller_set_button_mask` calls per poll; polling once per
    four 100-cycle chunks gives about 75 polls/frame, or ~1,200 sensor reads and 150 calls per frame.
  - Change: poll every `N` chunks (N = 4 is four scheduler iterations; at 60 updates per second this is about
    67 ms, before accounting for time spent emulating) or once per frame (16 ms only if frames keep pace). Keep
    the "level, not edge" property.
  - Est. saving: up to ~900 device lookups per frame.

- [x] **F6 (P2, S) Fold the ROM-load key into the same poll.**
  - **Done (2026-10-20):** the load key is sampled in the same poll.
  - Where: `rom_input.gs:82-92`, called from `rom_run.gs:131` every chunk.
  - Now: one extra sensor read and a proc call per chunk (~60 per frame) for a key that is pressed maybe
    once per session.
  - Change: sample it inside `keyboard_poll_controllers` on the same schedule as F5.
  - **Lint coupling:** `tests/goboscript-source.test.ts:1680` requires `if rom_input_requested == 1 {` and
    `:1676` requires `rom_input_poll_key;` in the run loop; keep the statement as a call into the shared
    sampler.

- [x] **F7 (P3, S) Rebuild the status line less often.**
  - **Done (2026-10-20):** the status line is rebuilt once per emulated frame.
  - Where: `rom_run.gs:235-256`, called once per frame at `:163`.
  - Now: up to 8 string joins and 6 number-to-string casts per frame.
  - Change: rebuild every 10 frames, or only when a monitor is visible. Trivial saving, listed because it
    runs in the scheduling loop.

- [ ] **F8 (P3, S) Drive the frame-skip decision from wall time.**
  - **Blocked (2026-10-20):** the skip decision already reads the frame counter and the measured FPS; a wall-clock rule needs S2's harness to compare.
  - Where: `rom_run.gs:166-190`.
  - Now: the loop caps emulation at 60 frames per second on a schedule (`rom_run_pace_frame`): frame n is
    due at `rom_run_pace_origin + n / ROM_RUN_FRAME_RATE_CAP`, an early frame waits until it is due, and a
    late frame sets `rom_run_skip_active`. A schedule more than 1 s behind is re-anchored instead of
    catching up. The FPS estimate no longer drives skipping, so the earlier hysteresis
    (`rom_run_next_skip_state`) is removed. Never skips two frames in a row (`rom_run_should_skip`).
  - Remaining: the cap is unmeasured on the real Scratch pen path, and the draw cost per frame is unknown.
    Confirm the cap and skip rate in a live run before tuning.
  - Effect: avoids both wasted draws and visible stutter when the console is slower than the display.

- [ ] **F9 (P3, S) Avoid re-broadcasting an unchanged frame.**
  - **Blocked (2026-10-20):** detecting an unchanged frame means hashing 61,440 slots in the display thread, which costs more than the redraw it would skip unless D1 lands.
  - Where: `rom_run.gs:184-189`.
  - Change: have the PPU set a `ppu_frame_changed` flag when any framebuffer slot is written with a
    different value, and skip the draw when it is clean. Costs one compare per pixel; only worthwhile with
    P5, where a blank frame is a constant fill. Evaluate after P5.

- [ ] **F10 (P3, S) Read the chunk constants into literals.**
  - **Blocked (2026-10-20):** the chunk constants are read twice per chunk; the compiler folds a constant comparison, and the variables are what the report and the tests read.
  - Where: `frame_loop.gs:41-42`, `:75`, `:76`.
  - Now: two Stage-variable reads per chunk iteration (the loop condition and the frame test).
  - Change: use the literal in the comparison and keep the variable for the report, or accept the read.
    Micro; listed for completeness.

### 4.5 Display (`main.gs`, `src/pen_display.gs`)

- [ ] **D1 (P1, L) Emit run-length runs from the PPU instead of decoding 61,440 pixels in the sprite.**
  - **Blocked (2026-10-20):** the run-length output is a display-thread redesign that needs the frame comparison and a measurement
  - Where: `main.gs:83-124` (decode loop), `ppu_2c02.gs:1087` (write site).
  - Now: the PPU writes 61,440 packed keys, then the sprite reads all 61,440 back and compares each with
    its predecessor to find runs.
  - Change: in the pixel path, compare the new key with `ppu_run_key` (already in a variable) and, on a
    change, append the previous run (`row`, `start`, `end`, `key`) to a `ppu_frame_runs` list. The sprite
    then walks ~8,000 runs with no per-pixel work. Keep writing `ppu_framebuffer_packed` as well if the
    frame tests read it, or make it conditional on `pen_run_output_enabled`.
  - Est. saving: 61,440 list reads, 61,440 compares, and 61,440 index increments in the display thread,
    replaced by ~8,000 four-item appends in the PPU thread.
  - Risk: the two writes per run plus the compare are paid in the PPU, so the net is roughly
    half the display decode; the real win is that the display thread (which runs while the console waits in
    `broadcast_and_wait`) becomes ~7x shorter.
  - **Lint coupling:** `tests/goboscript-source.test.ts:1802` requires `ppu_framebuffer_packed[` in the
    sprite source; keep a (cold) read or update the pin.

- [ ] **D2 (P1, L) Redraw only rows that changed.**
  - **Blocked (2026-10-20):** row-dirty tracking needs a per-row clear strategy that changes the visual contract at the stage edges; design and measurement first
  - Where: `main.gs:76` (`erase_all`), `:83` (all 240 rows).
  - Change: maintain `ppu_framebuffer_row_dirty[241]`, set by the pixel path when a row's output differs
    from the previous frame; the sprite erases and redraws only those rows. For a menu or a status-only
    update this can cut the frame's pen work to a handful of rows.
  - Risk: `erase_all` is pinned by `:1793`; a per-row clear needs an alternative erase strategy (draw the
    row's backdrop-colored rectangle before its runs), which changes the visual behavior subtly at the
    stage edges. Design first, and keep `erase_all` as the fallback path.

- [x] **D3 (P2, S) Carry the framebuffer index and row position across rows.**
  - **Done (2026-10-20):** the framebuffer index is carried forward and the stage Y multiplier stays because a lint pin names it.
  - Where: `main.gs:84-88`.
  - Now: `stage_y` is a multiply per row, `row_base = row * 256` is a multiply per row, then
    `framebuffer_index = row_base + 1`.
  - Change: initialize `framebuffer_index = 1` before the row loop and add 256 per row; decrement a
    `stage_y` accumulator by `cached_scale`.
  - Est. saving: 2 multiplies and 2 global reads per row (480 per frame).
  - **Lint coupling:** `:1808` pins
    `stage_y = pen_display_first_y - (row * pen_display_scale);` exactly. Either keep the expression (and
    lose the saving) or update the pin.

- [x] **D4 (P2, S) Use one increment per pixel instead of two.**
  - **Done (2026-10-20):** the row loop carries both the index and the pixel number with one addition each.
  - Where: `main.gs:94-98`.
  - Now: `pixel_x` and `framebuffer_index` both increment per pixel.
  - Change: drop `pixel_x` and derive run bounds from `framebuffer_index` (`pixel_x = framebuffer_index - row_start - 1`),
    or keep `pixel_x` and index the list with `row_start + pixel_x`. One add per pixel saved.
  - Est. saving: 61,440 adds per frame.

- [x] **D5 (P2, S) Set the pen size and transparency only when they change.**
  - **Done (2026-10-20):** the pen size and transparency are set only when they change.
  - Where: `main.gs:77-78` (every frame).
  - Change: remember the last applied size; re-apply only when `pen_display_scale` changed.
  - Est. saving: 2 pen-device calls per frame (small, but they are canvas operations).

- [x] **D6 (P3, S) Stop clearing the say bubble every frame.**
  - **Done (2026-10-20):** the say bubble is cleared at the green flag and on state changes, not per frame.
  - Where: `main.gs:74`.
  - Now: `say ""` each frame forces a text-bubble update even when it is already empty.
  - Change: clear it once when the run starts and after an error is shown.

- [ ] **D7 (P3, S) Remove the dead `pen_draw_run`.**
  - **Blocked (2026-10-20):** `pen_draw_run` is pinned by the lint as a documented helper; removing it is a test edit with no runtime effect.
  - Where: `main.gs:133-143`; not called since the draw loop was inlined.
  - Effect: project size only. **Lint coupling:** `:1803-1807` pins its `goto` literal, so this cannot be
    deleted without moving that pin.

- [ ] **D8 (P3, M) Evaluate a non-pen presentation path.**
  - **Blocked (2026-10-20):** choosing between pen strategies is a measurement (S2/S3) and a visual decision, not a source edit.
  - Where: `main.gs` and `goboscript.toml:3-5`.
  - Now: every frame is a pen clear plus ~8,000 strokes.
  - Change: measure the pen against (a) a costume whose bitmap is regenerated, (b) a 240-line set of
    horizontal sprite-scaled bars, (c) TurboWarp's `pen` with `high_quality_pen = false`. Pick the fastest
    that still meets the visual requirement. This is the only item that may overturn the whole display
    design, so it must be measured before D2 is invested in.
  - **Lint coupling:** `tests/goboscript-source.test.ts:2077` pins `high_quality_pen = false`;
    `:1796` pins `set_pen_size pen_display_scale;`.

- [ ] **D9 (P3, S) Skip the draw when the emulator is paused or the frame is identical.**
  - **Blocked (2026-10-20):** see F9.
  - See F9. Same cost/benefit.

- [ ] **D10 (P3, S) Flatten the geometry chain the Stage runs before each presented frame.**
  - **Blocked (2026-10-20):** the geometry chain runs three times per presented frame and must stay bit-identical; the saving is ~12 calls per frame.
  - Where: `pen_display.gs:114-118` -> `:98-102`, `:106-110` -> `:88-94`, `:64-73`, `:77-83`.
  - Now: three assignments per presented frame, each through a func that calls one or two more (~12 calls and
    several divisions per frame, plus the `pen_display_scale_for` branch).
  - Change: compute the scale and both origins in `pen_display_update_geometry` directly, and recompute only
    when `pen_fit_to_screen` changed since the last frame (one compare per frame in the normal case).
  - Est. saving: ~12 calls and ~6 divisions per presented frame; negligible, listed for completeness because
    this chain runs on the Stage thread that gates the frame handoff.
  - Risk: `tests/goboscript-source.test.ts:1808-1815` pins `stage_y = pen_display_first_y - (row * pen_display_scale);`
    and `high_quality_pen = false`; the geometry values themselves must stay bit-identical (same divisions) or
    the drawn frame shifts by fractions of a pixel.

### 4.6 Cartridge and mappers (`cartridge.gs`, `cartridge_loader.gs`, `mapper_000.gs`, `mapper_004.gs`)

- [x] **M1 (P1, S) Derive the PRG offset from one division instead of two.**
  - **Done (2026-10-20):** the PRG offset reuses the slot instead of a second modulo.
  - Where: `mapper_004.gs:520` (`(prg_bank % count) * 8192 + (address % 8192)`), `:497` (slot division).
  - Change: `slot = (address - 32768) // 8192` (already computed at `:497`), then
    `offset_in_bank = address - 32768 - slot * 8192`. One multiply and one subtract replace one modulo.
  - Est. saving: 1 mod x ~23,000 PRG reads per frame.

- [x] **M2 (P2, S) Same for the pattern path.**
  - **Done (2026-10-20):** the pattern path drops the double mask and the second modulo.
  - Where: `mapper_004.gs:554-566`, `:569-580`.
  - Now: `% 65536`, `% 16384`, `// 1024`, `% 1024`.
  - Change: `slot = address // 1024`; `offset_in_bank = address - slot * 1024`; the address is already inside
    the 16 KiB window from `ppu_bus`.
  - Est. saving: 2 mods x ~19,300 pattern reads.

- [ ] **M3 (P2, S) Cache the NROM board's shape.**
  - **Blocked (2026-10-20):** the NROM modulo only matters on an NROM board, and the shipped fixture is MMC3; it needs the measurement first.
  - Where: `mapper_000.gs:269-287` (`% cartridge_prg_rom_bytes` per read), `:302-311` (CHR ROM/RAM branch
    per pattern read), `:313-321`.
  - Change: compute `nrom_prg_rom_mask` (or keep the byte count but branch on "size is the full window" so
    the modulo can be skipped), and `nrom_chr_is_rom` once at load. The embedded image is a 16 KiB-mirrored
    32 KiB NROM-style board only for `test_rom.nes`-class images; the shipped fixture is MMC3, so measure
    both boards.
  - Est. saving: 1 mod per PRG read and 1 branch per pattern read on NROM.

- [x] **M4 (P2, S) Simplify the MMC3 A12 observer.**
  - **Done (2026-10-20):** the A12 observer takes a trusted 14-bit address and reads the bit arithmetically.
  - Where: `mapper_004.gs:611-633`.
  - Now: per observed pattern access (up to ~19,300 per frame): `to_number`, an integer test
    (`x == x // 1`, a division), a two-sided range test, and `bit_at` (a func call plus `% 65536`).
  - Change: the only caller passes a 14-bit address from `ppu_bus`, so drop the coercion and the range test
    (or assert once at attach time), and compute `next_high = (address // 4096) % 2`.
  - Est. saving: ~4 reporters per pattern read, ~80,000 per frame.

- [x] **M5 (P3, S) Dispatch MMC3 register writes on the address, not a masked word AND.**
  - **Done (2026-10-20):** the MMC3 register id comes from the address by division.
  - Where: `mapper_004.gs:433` (`bitwise_and(normalize_word($address), 57345)`, a 16-bit AND with 12
    divisions).
  - Change: `address - 8192` (since all eight registers live at `$8000 + 8192k` and `$8001 + 8192k`), then a
    compare chain, or an 8-entry lookup by `(address - 32768) // 8192` plus the low bit.
  - Est. saving: small (register writes are ~10 per frame), listed for completeness.

- [ ] **M6 (P2, M) Merge the three payload copy loops into one pass.**
  - **Blocked (2026-10-20):** the three payload loops now append in one pass each; merging them further would add a branch per byte.
  - Where: `mapper_004.gs:312-346`, `mapper_000.gs:225-259`.
  - Now: three separate `repeat` loops over `cartridge_bytes` (PRG, CHR, trainer), each with `to_number` per
    byte, plus `mmc3_reset_memory`'s `repeat add 0` loops.
  - Change: one loop copying PRG, CHR, and trainer with an inner branch, or better, a single `repeat` that
    copies the contiguous payload region and then maps the trainer separately. See B5/B6 for the reset
    loops.
  - Est. saving: 2 loop headers per byte is already 1; the real win is B5/B6. Measure the boot cost first.

- [x] **M7 (P2, S) Skip the duplicate cartridge load at boot.**
  - **Done (2026-10-20):** with the self test gated, boot loads the board once.
  - Where: `vector_selftest.gs:126-131` (`run_port_self_test` calls `cartridge_load_board`), then
    `rom_run.gs:88` calls it again.
  - Change: with B2 (self-test gating), the self-test no longer loads the board, so the boot copies the
    81,936-byte payload once instead of twice.
  - Est. saving: ~82,000 list writes and ~82,000 coercions at every boot.

- [ ] **M8 (P3, S) Drop the dead MMC3 dot clock.**
  - **Blocked (2026-10-20):** the MMC3 dot clock is dead but pinned by the mirror contract; project size only.
  - Where: `mapper_004.gs:595-599`; the body is already inlined at `ppu_2c02.gs:706-712` and
    `ppu_bus.gs:360-366`.
  - Effect: project size only.

- [x] **M9 (P3, S) Keep `mmc3_refresh_chr_cache` as is, but verify the write path.**
  - Where: `mapper_004.gs:163-170`, called from `:437`, `:457`.
  - Now: 8 `mmc3_chr_bank` calls per register write (each with up to 6 comparisons and a modulo).
  - Effect: ~10 writes per frame, so ~80 calls; fine. Listed so a future reader does not "optimize" it into
    the pattern read path again.

### 4.7 Input (`keyboard_input.gs`, `controller.gs`, `rom_input.gs`)

- [x] **I1 (P2, S) Replace the controller bitwise calls with arithmetic.**
  - **Done (2026-10-20):** the controller uses modulo arithmetic throughout.
  - Where: `controller.gs:38`, `:42`, `:44`, `:49`.
  - Change: `x % 2` for `& 1`, and `shift // 2 + 128` for `or(shift // 2, 128)` (the top bit of `shift // 2`
    is always clear for a byte, so addition is OR). `normalize_byte` at `:41`, `:49` becomes `% 256`.
  - Est. saving: 4 calls per controller read (games strobe and read 8 bits per frame per port).

- [x] **I2 (P2, S) Avoid re-normalizing the live button mask on every latch.**
  - **Done (2026-10-20):** the latch no longer re-normalizes a byte-normalized mask.
  - Where: `controller.gs:52-53`, `controller_set_button_mask` at `:29-31`.
  - Change: normalize once at set time (already done) and drop the two `normalize_byte` calls at latch time.

- [x] **I3 (P2, S) Fold the load-key sample into the controller poll.** See F6.
  - **Done (2026-10-20):** the load key rides the same poll as the pads.

- [x] **I4 (P3, S) Keep `key_pressed` literals constant.** Already constant (`keyboard_input.gs:51-113`), so
  each is one block with a compile-time menu value; no change needed. Recorded so it is not "optimized" into
  a variable key name, which would be slower.

- [ ] **I5 (P2, S) Make the ROM text decode cheaper per character.**
  - **Blocked (2026-10-20):** the hex decode is a user-initiated load path; a fast path needs the separator-tolerant general form kept beside it, and the cost is a few seconds once per paste.
  - Where: `rom_input.gs:105-160`.
  - Now: one loop iteration per character of an 80,000-character image, with a string compare, a join, a
    cast, and up to three list operations.
  - Change: handle two hex digits per iteration where the text is continuous (the format allows separators
    anywhere, so keep the general path and add a fast path when both characters are digits); or pre-scan
    for the first non-hex character to choose the path.
  - Effect: user-initiated, once per load. Listed because a paste currently freezes the project for
    seconds.

### 4.8 Boot, self test, and generated data

- [x] **B1 (P1, M) Cut the bitwise table startup cost.** See N7 for the options and the numbers.
  - **Done (2026-10-20):** see N7: the nibble tables replaced the byte tables.

- [x] **B2 (P1, S) Gate the shared-vector self test behind a flag.**
  - **Done (2026-10-20):** `port_self_test_enabled` (declared once, in `src/vector_selftest.gs`) gates the replay
    and the duplicate board load, and it ships at 0, so a normal green flag boots straight into the game. The
    opcode-table length check stays on every boot: it is two coercions and a comparison, and a table that
    failed to load has to surface. Flip the flag to 1 for a test build; `stage.gs` still calls
    `run_port_self_test` either way.
  - Where: `stage.gs:41`, `vector_selftest.gs:114-150`.
  - Now: every green flag replays 582 vectors (18,363 list values with coercions, plus CPU sequences with
    logging on), loads and validates the cartridge, and parses the header, before the game boots.
  - Change: `var port_self_test_enabled = 0;` at the top of `run_port_self_test`, with the body wrapped in
    `if port_self_test_enabled == 1 { ... } else { port_self_test_summary = "skipped"; }`. The lint's
    ordering requirement (`stage.gs` still calls `run_port_self_test` before `rom_run_start`) is satisfied.
  - Est. saving: the entire self-test and one duplicate cartridge load from every normal boot. This is
    probably several seconds of green-flag freeze today.
  - Risk: the self-test must still run for CI; expose the flag as a documented switch and keep it on in a
    test build. Do not remove the test.

- [x] **B3 (P2, S) Stop clearing the framebuffer at reset.**
  - **Done (2026-10-20):** the framebuffer clear loop is gone; `ppu_clear_frame_output` only clears the ready flag.
  - Where: `ppu_2c02.gs:299-308`, called from `ppu_reset` `:278`.
  - Now: 61,440 list writes on every `cpu_bus_reset`, which `rom_run_start` calls at every boot and every
    ROM swap.
  - Change: the list is already `[0; 61440]` at project load and every visible pixel is written before the
    first `ppu_frame_ready`, so the clear loop can be dropped; keep `ppu_frame_ready = 0`.
  - Est. saving: 61,440 list writes per boot.
  - Risk: `tests/goboscript-source.test.ts:781` lists `ppu_clear_frame_output` in the mirror table; the proc
    must keep its name and the `ppu_frame_ready = 0` statement.

- [x] **B4 (P2, S) Preallocate the board memory instead of `delete` plus `repeat add 0`.**
  - **Done (2026-10-20):** the ROM copies append the payload (`add ... to <list>` after a `delete`), so
    `reset_memory` no longer zero-fills the two ROM lists: every byte is written once instead of twice.
    The shared-vector handlers prepare bytes sparsely and so size the lists themselves; that is the one
    caller that depended on the old zero fill.
  - Where: `mapper_004.gs:285-310`, `mapper_000.gs:198-223`.
  - Now: `delete` then `repeat N { add 0 }` for PRG ROM (up to 512 KiB on some MMC3 boards), CHR ROM
    (up to 256 KiB), and two RAM regions. The fixture alone is 32,768 + 8,192 adds.
  - Change: declare the lists with a literal repeat size when the size is fixed (RAM: `[0; 8192]` already),
    and for ROM use `delete` plus a copy that assigns by index rather than `add` (assigning past the end is
    not allowed in Scratch, so grow once with the exact `repeat add 0`, then assign; measure which is
    cheaper). At minimum, skip the zero fill entirely when the copy that follows overwrites every slot.
  - Est. saving: 41,000 list writes per boot for the fixture.

- [ ] **B5 (P3, S) Generate the palette pen colors as data.**
  - **Blocked (2026-10-20):** generating the pen colors as data needs a build script and moves two lint pins; the value is ~4,000 boot reporters.
  - Where: `nes_palette.gs:31-249` (`nes_palette_init`), `:250-282` (hex/dim helpers).
  - Now: 192 palette writes plus 512 pen color strings built with 4 joins and a list read each.
  - Change: emit `scratch/data/pen_colors.gs` with a 512-entry literal list from a build script; the
    runtime init becomes an `[..]` literal. Saves ~4,000 reporters at boot and ~250 source lines.
  - Risk: the lint pins the palette literals (`tests/goboscript-source.test.ts:1740-1755`) and the mirror
    function; keep the generator's output identical to the current arithmetic and keep the arithmetic in
    the mirror.

- [x] **B6 (P3, S) Cache the ROM string length checks.**
  - **Done (2026-10-20):** the decode loop bounds itself with `rom_input_byte_count`.
  - Where: `rom_input.gs:118-123`.
  - Change: `length rom_input_text` is read once (already) and `length rom_input_bytes` is read inside the
    loop (`:140`); track the staged count in `rom_input_byte_count` instead, which is already maintained.
  - Est. saving: one list-length call per character.

- [x] **B7 (P3, S) Reduce project load weight.**
  - **Done (2026-10-20):** N7 removed 196,608 list slots; the remaining lists are the data the console needs.
  - Where: `bitwise_tables.gs:20-31` (196,608 slots), `ppu_2c02.gs:217` (61,440),
    `cpu_bus.gs:28` (2,048), `ppu_bus.gs:27-33` (4,384), `rom_loader.gs:14` (81,936 from file),
    `shared_vectors.gs:1` (18,363 from file).
  - Change: after N7, the tables drop to 768 slots (option b), taking the project from ~360,000 list
    entries to ~165,000. Measure project load time and memory before and after.
  - Effect: load time, memory, and `.sb3` size; no per-frame change.

- [ ] **B8 (P3, S) Drop the dead APU stub.**
  - **Blocked (2026-10-20):** the APU stub is uncalled but listed by the mirror contract and pinned by the lint; project size only.
  - Where: `apu_2a03.gs` (200 lines, 20+ procs). Nothing includes it and nothing calls it (grep-verified);
    it costs Stage compile time and project size only.
  - Effect: project size. **Lint coupling:** the mirror table lists each stub proc by name
    (`tests/goboscript-source.test.ts:651-680`) and `:1951` pins the file header, so removal is a
    deliberate test change, not a drive-by deletion.

- [x] **B9 (P3, S) Re-check the boot sequence for duplicate work.**
  - **Done (2026-10-20):** with B2 and M7 the boot parses the header and loads the board once.
  - Where: `stage.gs:36-46`.
  - Now: `bitwise_table_init`, `nes_palette_init`, `run_port_self_test` (which loads the board and parses
    the header), `rom_run_start` (which loads the board and parses the header again), then the loop.
  - Change: with B2 and M7, the second load is the only one; the header parse is cheap and can stay.

### 4.9 Project configuration, compiler, packaging (`goboscript.toml`, build scripts)

- [ ] **X1 (P2, S) Measure `high_quality_pen` on and off.**
  - **Blocked (2026-10-20):** needs a built project and a frame-time measurement (S2/S3).
  - Where: `scratch/goboscript.toml:5`.
  - Now: pinned to `false` by the lint (`tests/goboscript-source.test.ts:2077`), so the pen layer renders at
    stage resolution.
  - Change: build both and measure a frame's pen time. `false` renders the pen layer at stage resolution,
    which changes appearance; if it is materially faster, offer it as the default for slower machines and
    document the trade-off. Update the pin with the decision.

- [ ] **X2 (P2, S) Decide the frame-rate target explicitly.**
  - **Blocked (2026-10-20):** a product decision backed by S1/S2 measurements.
  - Where: `scratch/goboscript.toml:2` (`frame_rate = 60`).
  - Now: the project asks TurboWarp for 60 fps. If the console cannot sustain it, every frame is late and
    the display schedule fights the emulation schedule.
  - Change: measure at 60 and at 30. A 30 fps target doubles the per-frame cycle budget and can make the
    project feel *smoother* than a struggling 60. Record the decision in `docs/SUPPORTED_FEATURES.md`.

- [ ] **X3 (P0, S) Verify every hot proc compiles warp.**
  - **Blocked (2026-10-20):** needs the GoboScript compiler, which is not installed here.
  - Where: all of `scratch/src/*.gs`; `rom_run.gs:125` is the only `nowarp` proc.
  - Change: after the first real compile, inspect the `.sb3` `project.json` for `warp: false` on any proc
    except `rom_run_loop`, and add a checked-in script that fails the build if one appears. A non-warp hot
    proc would yield on every loop back-edge and destroy the frame budget.

- [ ] **X4 (P2, S) Measure the compiler's handling of `local`.**
  - **Blocked (2026-10-20):** needs the compiler and a disassembly of the generated project.
  - Where: every proc.
  - Change: compile a micro-benchmark that reads a `local` 1,000,000 times and a Stage `var` the same number
    of times. If `local` is not cheaper, stop treating locals as a cache (see 1.1) and prefer fewer
    variables overall.

- [ ] **X5 (P3, S) Keep the hot path free of `say`, `ask`, `timer`, and monitor-visible writes.**
  - **Blocked (2026-10-20):** verified by reading the source; there is no `say`, `ask`, `timer`, or monitor-visible write in any hot proc. No change needed beyond the note.
  - Where: `rom_run.gs:111-112` (`timer` twice at boot), `:150-157` (twice per 60 frames); `main.gs:74`
    (`say`).
  - Effect: already close to ideal; recorded so it stays that way.

- [ ] **X6 (P3, S) Keep the generated data out of the project where possible.**
  - **Blocked (2026-10-20):** needs S3 to measure project load with and without the generated data.
  - Where: `rom_loader.gs:14`, `shared_vectors.gs:1`, `cpu_opcode.gs:133` (after C8).
  - Change: file-backed lists keep the `.sb3` small but must ship beside it (or be inlined by the packager);
    literal lists load faster but bloat the file. Decide once, per list, with the measured load time.

- [ ] **X7 (P3, S) Confirm `no_miscellaneous_limits` and `max_clones` are still required.**
  - **Blocked (2026-10-20):** the `no_miscellaneous_limits` and `max_clones` settings can only be validated in TurboWarp.
  - Where: `scratch/goboscript.toml:4`, `:6`.
  - Effect: correctness of list sizes and clone limits, not speed; keep and re-document after each
    TurboWarp release.

### 4.10 Measurement infrastructure (do this first)

- [ ] **S1 (P0, S) Add a `profile_enabled` switch and per-subsystem counters.**
  - **Blocked (2026-10-20):** profile counters need the Scratch runtime to be observable; the source has no monitor-free counter path yet.
  - Where: new counters in `stage.gs`; increments at `frame_loop.gs:72`, `ppu_2c02.gs:700`, `:1009`,
    `main.gs:62`, and `rom_run.gs:188`.
  - Change: counters for CPU cycles, instructions, PPU dots, pixels written, pen strokes, chunks, and
    broadcast waits, each incremented only when `profile_enabled == 1` (one branch when off). Report them in
    `rom_run_state_text` or a `profile_report` list.
  - Why: every estimate in this document is a hypothesis; this is the instrument that replaces it.

- [ ] **S2 (P0, S) Add a benchmark mode.**
  - **Blocked (2026-10-20):** a benchmark mode needs a build and a runtime.
  - Where: `rom_run.gs:76-117`.
  - Change: `bench_mode == 1` skips the self test and the pen draw, runs a fixed number of emulated frames,
    and writes `timer()` deltas into a list: total, CPU-only, PPU-only (by disabling the pixel write), and
    draw-only. This separates the three budgets without a profiler.

- [ ] **S3 (P0, M) Build a Scratch-side micro-benchmark project.**
  - **Blocked (2026-10-20):** a Scratch-side micro-benchmark project cannot be built or run here.
  - Content: cost of a custom-block call with 0/1/3 arguments, a `local` read, a Stage `var` read, a
    65,536-entry list read, a string list read with `+ ""`, `% 256`, `// 256`, an `if` chain of length 1/4/8,
    one `key_pressed`, one pen stroke, one `set_pen_color`, and one `broadcast_and_wait`. Run it in the same
    TurboWarp build used for the project and record the table in this file.
  - Why: items N7, X1, X2, D8, and the whole cost model depend on numbers that only this project can supply.

- [ ] **S4 (P0, S) Define the A/B procedure and the acceptance gate.**
  - **Blocked (2026-10-20):** the A/B procedure depends on S1-S3.
  - Procedure: baseline build; change exactly one batch; rebuild; run `npm test` (including
    `goboscript-source`, `shared-port-vectors`, and the port-algorithm mirrors); run the compiled project;
    record frame time over 600 frames, the self-test result, and a screenshot of frame 43 (or the boot frame
    the tests document); record the result next to the item in this file.
  - Gate: an item is checked only when both correctness and the measurement are recorded. An item that
    regresses frame time is unchecked and annotated.

- [ ] **S5 (P1, S) Keep the numbers in this file.**
  - **Blocked (2026-10-20):** the measurement table stays empty until S1-S3 exist; this file records only static estimates and says so.
  - Change: add a `## 9. Measurements` table (build id, TurboWarp version, machine, frame time, FPS, self-test
    summary, notes) and fill it at every batch boundary. Estimates stay in the item text; measurements live
    in that table only.

---

### 4.11 Files read end to end with no hot-path work

These were read line by line for this audit and produced no item beyond the ones already listed. They are
recorded so the next audit can skip them instead of re-deriving that they are cold:

| File | Why there is nothing to do |
|---|---|
| `src/mapper.gs` | `mapper_resolve` and `mapper_sum_memory_sizes` run once per cartridge mount. The five static assignments in `mapper_resolve` are not worth a rewrite. |
| `src/shared_vectors.gs` | One include line. |
| `src/stage.gs` | Declarations plus the green-flag boot order (`:36-46`); its cost is B2's subject, not a per-frame cost. |
| `src/rom_loader.gs` | Boot only: clears a list and copies `cartridge_bytes`. Covered by B4/B6. |
| `src/cartridge_loader.gs` | Header parse and payload shape at mount; per-instruction cost zero. M6 covers its copy loops. |
| `src/nes_palette.gs` | `nes_palette_init` builds 64 pen colors once at boot (B5); the hot lookups are P6/P7/D3. |
| `src/vector_selftest.gs` | Runs only from the green flag and is the subject of B2; its own speed is irrelevant once gated. |
| `src/apu_2a03.gs` | Not included by any header and carries no state the console reads (B8). |
| `src/bitwise_tables.gs` | The table *build* is N7/B1; the lookup functions themselves are N1/N2. |
| `src/pen_display.gs` | Geometry only (D10). |
| `src/ppu_2c02.gs` `ppu_set_status_flag` | Already bypassed at the three hot sites; P17 covers the remaining setters, P27 the dead helpers. |

Two files that look cold but are not: `main.gs` (it owns the largest single per-frame loop, section 4.5) and
`rom_input.gs` (its text decode walks the whole ROM image at load, I5).

---

## 5. Rejected optimizations (do not spend time on these)

These are closed decisions, not work: the boxes are ticked because each one was considered and turned down for
the reason given. Re-open one only if a measurement in section 9 contradicts the reason.

- [x] **R1 Replace `broadcast_and_wait "draw frame"` with a shared flag and a busy wait.** A sprite spinning
  on an `until` loop starves the Stage in Scratch's cooperative scheduler (documented in
  `docs/GOBOSCRIPT_RESEARCH.md`). The broadcast is the correct primitive; the cost is one thread handoff per
  drawn frame.

- [x] **R2 Run the whole frame in one warp block.** It removes every yield and freezes the project: input,
  the stop sign, and the pen draw all stop until the block returns. The chunked loop exists for this reason.

- [x] **R3 Precompute ADC/SBC in a 131,072-entry table.** Two 65,536-entry lists plus a carry dimension is
  ~130,000 entries and a boot cost larger than N7's, to save ~10 reporters per add.

- [x] **R4 Compute AND one bit at a time.** Already replaced; it was 16 iterations per mask.

- [x] **R5 Draw one pen stroke per pixel.** Already replaced by run-length; 61,440 strokes per frame is not
  drawable.

- [x] **R6 Split the PPU across sprites or clones for "parallelism".** Scratch threads are cooperative. Two
  targets interleave; they do not run in parallel, and the handoff costs more than the work.

- [x] **R7 Draw directly from the PPU into the pen layer.** The pen calls would land inside the 89,342-dot
  loop, and the frame would no longer be a stable snapshot (the PPU would overwrite rows the pen has not
  drawn). The framebuffer is the correct boundary.

- [x] **R8 Read `cartridge_bytes` (strings) directly from the CPU read path.** It would put a string-to-number
  coercion inside the hottest loop; the board's numeric copy exists to prevent exactly that.

- [x] **R9 Replace `% 2048` with a compare chain in the RAM window.** A modulo is one reporter; a
  three-compare chain is not cheaper on average. C26 only removes the modulo when the address cannot wrap,
  which is a different (and free) case.

- [x] **R10 Adopt scanline-batched rendering unconditionally.** It changes behavior for mid-scanline register
  writes and for the MMC3 A12 edge sequence. P1/P2 are gated by the dirty-pipeline flag for that reason.

- [x] **R11 Emit one pen stroke per tile instead of per run.** Tiles repeat colors but adjacent tiles share
  them; per-run already merges across tile boundaries, so per-tile would create more strokes.

- [x] **R12 Rename or re-order GoboScript declarations to speed up name lookup.** TurboWarp resolves
  variables by id, not by name; there is nothing to gain.

---

## 6. Constraints: lint pins that any change must update

`tests/goboscript-source.test.ts` asserts on source text, so several optimizations above are blocked by a
literal rather than by behavior. Update the pin in the same commit, or satisfy the pin without giving up the
optimization.

| Pin | Location | Blocks |
|---|---|---|
| **Every `proc`/`func` needs a `MIRROR_CONTRACT` entry, and a mirrored header's entry must point at a TypeScript mirror of the same arity** | `:1355-1410`, table `:148-928` | every item that adds, removes, renames, or re-argues a proc or func (C1-C29, P1-P28, F1-F10, D10, M1-M9, I1-I5, N7) |
| **No `local` declared inside a loop body** | `:1128-1146` | any hoisting that would put a temporary in a loop (P1, P2, D1) |
| `% include` at column 1, ASCII only, 4 spaces, no tabs/CR, `< 122` columns | `:1010-1054` | any edit |
| `func` ends with `return`; no `return` inside `proc` | `:1117` | refactors |
| Stage-only state declarations | `:1325-1343` | moving state into sprites |
| `cpu_bus_ppu_attached == 1` after `if numeric_address < 16384 {` | `:1532-1546` | C1, C2 |
| `cartridge window may follow PPU window` | `:1546` | C1 window order |
| `ppu_bus_read_ppu`/`write_ppu` observe exactly 2 windows, palette starts `elif ppu_address < 16128` | `:1830-1840` | P12, P19, P22 |
| `mmc3_observe_ppu_access $access_kind, $address;` | `:1843` | M4 |
| PPU `var` constants must equal the TypeScript reference by name | `:1860-1885` | P6, P18 |
| `pen_display` literals `256`, `240`, `1`, `1.5`, `-191.25`, `179.25` | `:1888-1906` | D3, D8 |
| `% <name matching /mask/i>` forbidden | `:1935` | N1, P6, P7 |
| exactly 4 `ppu_vram_address % 16384` in `ppu_2c02.gs` | `:1937` | P19, P22 |
| `ppu_palette_ram[palette_offset + 1] % 64` | `:1946` | P6, P7 |
| `cpu_access_log_enabled = 0;` in `rom_run_start`, `= 1;` in `run_port_self_test` | `:1656-1666` | C3 |
| run loop load wiring: `rom_input_poll_key;`, `if rom_input_requested == 1 {` | `:1676-1680` | F6 |
| `erase_all;`, `pen_down;`, `pen_up;`, `set_pen_size pen_display_scale;`, `set_pen_color nes_pen_colors[`, `ppu_framebuffer_packed[` | `:1792-1802` | D1, D2, D4, D7 |
| `goto pen_display_first_x + ($left_x * pen_display_scale), $stage_y;` | `:1803` | D7 |
| `stage_y = pen_display_first_y - (row * pen_display_scale);` | `:1808` | D3 |
| `high_quality_pen = false` | `:2077` | X1 |
| `ppu_frame_ready = 1;` at vblank start; `if ppu_frame_ready == 1 {` in the run loop | `:1766-1783` | F8, F9 |
| `bitwise_table_init`, `nes_palette_init` declarations and green-flag calls | `:167`, `:1775` | N7, B5 |
| `ppu_clear_frame_output`, `cpu_bus_clear_ram` declarations and `cpu_bus_clear_ram;` in boot | `:216`, `:781`, `:1610` | B3 |

A change that must break a pin is a two-file change (source and test), and both must land together with the
reason in the commit message. Do not weaken a pin to make an optimization easier unless the pin's comment
still describes a real invariant.

---

## 7. Execution plan

Each batch is independently testable and separately benchmarkable. Do not start a batch before S1-S3 exist,
because otherwise the next batch has no baseline.

> **Status (2026-10-20):** batches A, B, C, D, and E have been implemented as far as the source allows
> without a running Scratch project. What remains in this plan is the measurement work (batch 0), the items
> each batch lists that carry a `Blocked` line, and the new batch G below. The batch lists are left as
> written so the original plan stays readable; the per-item status lines in section 4 are authoritative.

**Batch 0 - instrument first (S1, S2, S3, S4, S5, X3, X4).** No emulator change. Produces the cost table and
the A/B harness. Everything after this is measured.

**Batch A - pure call elimination, no behavior change.**
C1, C2, C3, C4, C5, C6, C10, C11, C12, C13, C14, C19, C22, C25, C26, C28, C29, F1, F2, F10, P12, P13, P17,
P19, P20, P21, P22, P23, P28, M1, M2, M4, M5, N1, N2, N3, N4, N5, N6, N9, I1, I2, I3, C27. These are local rewrites with existing vectors as the gate. Expect the largest single improvement
here; measure each sub-batch (CPU, PPU, bus) separately because they are separable.

**Batch B - data and decode layout.**
C7, C8, C9, C15, C16, C17, C18, C20, C21, C23, C24, P6, P7, P10, P11, P14, P18, B1, B2, B3, B4, B5, B8, M3,
M6. The generated
numeric opcode table (C8) and the bitwise-table decision (B1/N7) are the two items that most change the cost
model; measure them before and after with S3's table.

**Batch C - structural PPU (the big one).**
P1, P2, P3, P4, P5, P8, P9, P15, P16, P24, P25, P26. Design note first: the dirty-pipeline flag, the line
scratch lists, and the interaction with MMC3 A12 observation and sprite-zero-hit timing. Full PPU vector
suite plus a rendered-frame comparison against the TypeScript reference (the existing framebuffer tests) is
the gate.

**Batch D - display and scheduling.**
D1, D2, D3, D4, D5, D6, D8, D9, D10, F3, F4, F5, F6, F7, F8, F9.

**Batch E - boot and packaging.**
B6, B7, B9, I5, N8, D7, M7, M8, X1, X2, X5, X6, X7.

**Batch G - follow-up queue from this pass.** K1 (op-class dispatch), K3 (sprite calls into the dot loop),
K4 (unmasked internal bus entry points), K7 (read-instruction dispatch), K2 (pattern base reuse, with P1).
K5, K6, K8, K9, K10, and K11 are micro items that can ride along with the file they touch.

**Batch F - re-audit.**
Re-read every file after A-E and re-run the census in section 3. Any subsystem still above its share of the
budget is the next audit's subject. Update Appendix A.

---

## 8. Verification checklist per item

For every item, in this order:

1. `npm run typecheck` and `npm test` (all suites, including `goboscript-source`, `shared-port-vectors`,
   `goboscript-opcode-table`, and `goboscript-port-algorithms`).
2. `npm run scratch:assets`, `npm run scratch:vectors`, `npm run scratch:opcode` if any generated data or
   table layout changed, then re-run the tests that compare the generated data to the fixtures.
3. Any board or bus change: the ordered access trace must be identical. `tests/shared-port-vectors.test.ts`
   and `tests/goboscript-port-algorithms.test.ts` are the oracle.
4. Any PPU rendering change: the framebuffer tests (`tests/ppu-rendering.test.ts`, `tests/ppu-2c02.test.ts`)
   plus a comparison of the first rendered frame against the TypeScript reference.
5. Compile and measure (S4). Record in section 9. An item without a measurement is not checked.
6. Update `docs/PERFORMANCE_AUDIT_TODO.md` (this file) and, if the scope changed, `docs/TODO.md` and
   `docs/PROGRESS.md`.

## 9. Measurements

No measurements exist yet. This table is filled at every batch boundary.

| Build | TurboWarp | Machine | Self test | Frame time (ms) | FPS | Notes |
|---|---|---|---|---|---|---|
| (none) | - | - | - | - | - | Toolchain unavailable in this environment |

---

## 10. New findings from the 2026-10-20 implementation pass

Working through section 4 turned up optimizations that were not in the original audit, plus a few items
whose shape changed because the code around them did. These are the follow-up queue; none of them is
implemented yet. Line references are deliberately absent: every `file:line` in section 4 is from the audit
snapshot and no longer matches the post-implementation source.

- [ ] **K1 (P2, M) Add an `op_class` column to the generated opcode table.**
  - Where: the dispatch in `src/cpu_instruction.gs` and `src/cpu_control.gs`, `scripts/generate_goboscript_opcode_table.mjs`.
  - Now: the implied-mode fast path (C17) removed the resolver and the dispatch walk for the flag, transfer,
    and counter group, but a load, store, or read-modify-write still walks the error, KIL, official,
    relative, JSR, RTS, BRK, RTI, implied tests before reaching `cpu_execute_regular_instruction`.
  - Change: emit a class id (read, store, rmw, implied, branch, stack, jump) beside the six existing fields
    and test it first. The fixture, the generator, `cpu_opcode_field`, the opcode-table test, and the shared
    vector schema all move together, which is why this needs its own design note.
  - Est. saving: 6-8 comparisons per instruction, ~60,000 reporters per frame.

- [ ] **K2 (P2, S) Reuse the background pattern base across a tile's two plane fetches.**
  - Where: `ppu_fetch_background_pattern_low` and `ppu_fetch_background_pattern_high`.
  - Now: each computes `(ppu_vram_address // 4096) % 8`; the two run two dots apart in the same tile, and the
    only scroll change between them is the coarse-X increment, which cannot touch fine Y.
  - Change: store the base in a `ppu_next_background_pattern_base` variable at the low fetch and read it at
    the high fetch. The hazard is a CPU `$2006` write landing between the two dots; the dirty-line flag that
    P1 needs would cover it, so land this with P1.
  - Est. saving: 1 divide and 1 modulo per tile, ~15,000 per frame.

- [ ] **K3 (P1, S) Fold the sprite unit shift and the sprite pixel scan into the dot loop.**
  - Where: the inlined pixel body in `ppu_run_dots`, `ppu_read_sprite_pixel`, `ppu_clock_sprite_output_units`.
  - Now: with a line that has sprites, the pixel path still pays two custom-block calls per pixel — the scan
    and the shifter. That is 2 x 61,440 calls on a sprite-heavy line.
  - Change: P2 removes both by precomposing the line; without P2, inline both bodies into the dot loop the way
    the pixel body now is, which saves the two calls and leaves the work.
  - Est. saving: up to ~120,000 calls per frame on a busy line.

- [ ] **K4 (P2, S) Normalize the bus address once per internal caller instead of per cycle.**
  - Where: `cpu_read_cycle`/`cpu_write_cycle` in `src/cpu_core.gs`.
  - Now: every access pays `$address % 65536`, but the program counter, the stack address, and every resolved
    operand are already words. Only the exported/vector-facing entry point needs the mask.
  - Change: `cpu_read_word` / `cpu_write_word` without the normalization, used by `cpu_fetch_byte`,
    `cpu_fetch_word`, `cpu_push_byte`, `cpu_pop_byte`, and the memory-operand paths; keep the masked forms as
    the documented entry points.
  - Est. saving: one modulo per bus cycle, ~30,000 per frame.

- [ ] **K5 (P3, S) Share one boot-time table pass.**
  - Where: `bitwise_table_init`, `cpu_status_table_init`, `ppu_greyscale_table_init`.
  - Now: three procs each run their own 64-256 iteration loop from the green flag.
  - Change: one pass that fills the nibble tables and the zero/negative table together, and let the greyscale
    table build from that loop's index as well.
  - Est. saving: ~300 loop iterations per boot; small, listed because the boot is now the only un-profiled
    phase left after B2 and M7.

- [ ] **K6 (P2, S) Skip `ppu_refresh_output_terms` when the write cannot change it.**
  - Where: `ppu_write_data_register` (palette window) and `ppu_decode_mask_register`.
  - Now: every palette write recomputes both cached terms, including the thousands of writes a VRAM fill makes
    to slots other than the universal backdrop, and every PPUMASK write recomputes both even when only the
    greyscale bit moved.
  - Change: compare the new backdrop slot and the new emphasis field against the old, and refresh only on a
    difference.
  - Est. saving: one mandatory-call plus four reporters per skipped write.

- [ ] **K7 (P2, S) Dispatch the read-instruction effects without a call per instruction.**
  - Where: `cpu_apply_read_instruction` (C23 in section 4).
  - Now: one call and a mnemonic chain per ALU instruction (~4,000 per frame). C20 removed the argument
    normalization inside it; the call is what is left.
  - Change: either inline the ten short bodies at the call site (duplication, but each is 3-6 lines now that
    the byte entry points exist) or add a decoded `effect` field the resolver sets, so the dispatch is a
    small compare chain over an id instead of mnemonics.
  - Est. saving: 1 call per ALU instruction plus a shorter chain.

- [ ] **K8 (P3, S) Test the frame boundary once per chunk.**
  - Where: `frame_loop_run_chunk`.
  - Now: `frame_loop_cycles_run >= FRAME_LOOP_CYCLES_PER_FRAME` is evaluated in the loop header and again after
    the loop, and the body evaluates it a third time to set the flag.
  - Change: set the flag in the body's test and let the post-loop test read the flag.
  - Est. saving: two comparisons and two variable reads per chunk (~60 per frame).

- [ ] **K9 (P3, S) Drop the duplicate status-flag paths in `cpu_status`.**
  - Where: `pack_status_for_stack` (still calls `bitwise_or` for the BRK push) and `ppu_set_status_flag`
    (vector-only).
  - Change: the break bit is disjoint from every bit `normalize_status` keeps, so the pack is one addition;
    `pack_status_for_stack` can then delegate to that expression. The PPU setter and the twelve PPU getters
    could move to the self-test header, which stops the Stage's translation unit compiling them.
  - Est. saving: project size and one call/list read on every BRK, IRQ, and NMI push.

- [ ] **K10 (P3, S) Check for drift between the two inlined bodies.**
  - Where: the instruction dispatch in `src/cpu_control.gs` versus `cpu_execute_instruction`, and the pixel
    body in `ppu_run_dots` versus `ppu_render_pixel`.
  - Now: both pairs are deliberate duplicates, kept in step by a comment. A silent divergence would show up
    only as a vector failure.
  - Change: a source-lint check that the two case bodies contain the same statement sequence (the lint parser
    already builds per-proc statement lists), or move the bodies into a `%include`-able fragment.
  - Effect: no runtime change; removes the largest maintenance risk the pass introduced.

- [ ] **K11 (P3, S) Carry the framebuffer index through the dot loop.**
  - Where: the inlined pixel body (P24 in section 4).
  - Now: `ppu_framebuffer_row_base + ppu_dot` is one addition per pixel, and after the inlining it is a
    larger share of the pixel than it was.
  - Change: keep a `ppu_framebuffer_index` variable that `ppu_advance_dot` sets from the row base and the dot
    loop increments, with the scanline advance resetting it.
  - Est. saving: one addition per pixel, 61,440 per frame.

## 11. Where the earlier audit's line numbers went

Section 4's `file:line` references are from the pre-implementation snapshot. Several items had already been
implemented when this pass started (the fast bus windows, the four-field decode, the resolver inlining, the
nibble-only bitwise tables), which is why their descriptions read like proposals while the source already
contains the change. The ticked items above are the authoritative status; treat the line numbers in section 4
as historical.

---

## 12. Review pass over the implementation (2026-10-20, after the catalogue)

Every commit between the pre-pass baseline and the end of the implementation pass was re-read against the
reference algorithms, the mirror functions, and the source lint. What the review changed:

| Finding | Fix |
|---|---|
| `src/vector_selftest.gs` declared `var port_self_test_enabled` twice in one translation unit (the second copy arrived with the gate in B2) | the duplicate is gone; the surviving declaration carries the explanation |
| A name declared twice in one translation unit used to pass the lint (`tests/goboscript-source.test.ts` resolved names but never counted them) | new lint: "no translation unit declares the same name twice", one failure message per colliding name. It also confirms that the `cpu_dma_phase` enum-variable pairing is the only same-name declaration in the project |
| Removing the ROM zero fill in B4 made `nrom_reset_memory`/`mmc3_reset_memory` leave the lists empty, and the shared-vector handlers write prepared bytes by index into what used to be a sized list | the three vector handlers size the two lists themselves before preparing bytes, so an unprepared byte still reads as 0 |
| The body of `ppu_evaluate_sprites_for_next_scanline`'s `if visible_scanline == 1` block sat at its opener's indent (pre-existing), so a nested block read as a sibling | the proc was re-indented to its brace depth, whitespace only; a new lint ("a closing brace is indented with the line that opened its block") fails on the shape that shipped and passes on the fix |
| The greyscale table's comment sat above `ppu_reverse_table_init` | moved to `ppu_greyscale_table_init` |
| `frame_loop.gs`, `mapper_000.gs`, and `mapper_004.gs` described the per-dot dot clock and the zero fill they no longer do | comments rewritten to match the code |
| The inlined dispatch in `cpu_control.gs` and the standalone `cpu_execute_instruction` are two copies of one body (K10) | compared statement by statement; they are identical apart from the caller's inline comment, and both were re-verified by the branch/ALU sweeps |

Not changed by the review, and why:

- `frame_loop_check_dma` is now a one-line wrapper with no caller in the running path. It stays as the
  documented, mirrored entry point the checklist can call (`MIRROR_CONTRACT` pins it).
- `ppu_clock_ppu_dot`, `ppu_clock_cpu_cycle`, and `cpu_clock_dma_cycle` are the same kind of kept entry: the
  frame loop uses the batched forms, and the tick-counter mirrors use these.
- The four `ppu_vram_address % 16384` sites stay separate statements, because the lint counts them (section 6).

Checked by hand and left alone (the identity, not just the test, is the reason):

- `alu_add_with_carry_byte`/`alu_subtract_with_carry_byte`: carry is `total // 256`, overflow is the
  product of the two sign disagreements with the result. For SBC the complement `255 - operand` makes
  `sign(complement) = not sign(operand)`, so the same product is the reference's `sign(A) != sign(M)`
  test, and the modulo-256 result matches `left + (255 - right) + carry`.
- `ppu_increment_scroll_x_for`/`ppu_increment_scroll_y_for`: every branch keeps the result inside 0-32767
  (the fine-Y path only runs when fine Y is not 7, the coarse-Y path rebuilds from a value below 4096),
  and the coarse-Y rebuild `(result % 32) + coarse_y * 32` is the old
  `result - ((result // 32) % 32) * 32 + coarse_y * 32` for a value below 4096.
- `ppu_sprite_fetch_pattern_address`: the high-plane phase is two dots after the low-plane phase of the
  same eight-dot slot, and the slot's tile, attributes, and row cannot be rewritten between them, so the
  saved address is the address the func would return.
- `controller_serial_read`: `(shift_register // 2) + 128` is `or(shift_register >> 1, 128)` because the
  shifted value's bit 7 is always clear.
- `mmc3_write_register`: `(address // 8192) * 8192 + address % 2` is `address & $E001` for an address in
  $8000-$FFFF, and `mmc3_read_cpu`/`mmc3_read_pattern`'s slot-derived offsets subtract the slot's own span
  from an address that is already inside the 8 KiB (or 1 KiB) window.
- `cpu_apply_driven_value`'s full-byte branch returns the value it latched, which is what the merge would
  produce with a 255 mask.

## Appendix A - optimizations already in the source (verified by reading it)

These are done; do not re-propose them. Each is present in the current source and matches its description.

| Optimization | Where |
|---|---|
| PPUMASK decoded into fields at each `$2001` write instead of per pixel | `ppu_2c02.gs:552-586` |
| Packed single framebuffer list (emphasis x 64 + color) | `ppu_2c02.gs:217`, write `:1087` |
| `ppu_framebuffer_row_base` maintained per scanline instead of `y * 256` per pixel | `ppu_2c02.gs:222`, `:766-806` |
| Fine-X shift weight precomputed at the `$2005` write | `ppu_2c02.gs:187`, `:603-643` |
| Sprite output units limited to the sprites a line actually loaded | `ppu_2c02.gs:194`, `:1458` |
| Attribute shift divisor table instead of a doubling loop | `ppu_2c02.gs:182`, `:1275` |
| Palette read inlined in the pixel path (no bus call) | `ppu_2c02.gs:1080` |
| `ppu_select_palette_offset` and the sprite-zero setter inlined into the pixel path | `ppu_2c02.gs:1059-1074` |
| Background shift registers shifted inline (no proc call) | `ppu_2c02.gs:1181-1184` |
| Sprite evaluation guarded to visible lines | `ppu_2c02.gs:1305-1317` |
| MMC3 PPU-dot A12 counter inlined into the dot clock and the bus | `ppu_2c02.gs:705-710`, `ppu_bus.gs:360-366` |
| Nametable reads skip the mapper observation (A12 is 0 there) | `ppu_bus.gs:256-283` |
| NROM pattern-window fast path (2 calls) | `ppu_bus.gs:288-301` |
| MMC3 CHR bank cache refreshed on register writes | `mapper_004.gs:127-170` |
| MMC3 PRG bank selection inlined into the read path | `mapper_004.gs:483-532` |
| MMC3 last/second-last PRG bank cached | `mapper_004.gs:100-101`, `:279-280` |
| CPU PRG-ROM window decoded before the PPU window | `cpu_bus.gs:120-137` |
| RAM read returns the byte without the merge helper | `cpu_bus.gs:139-147` |
| CPU opcode fields coerced inline instead of through `to_number` | `cpu_opcode.gs:174-179` |
| CPU operand fields coerced inline (`$mode + ""`) | `cpu_addressing.gs:106-107` |
| ALU status byte normalized once per proc with `% 256` | `cpu_alu.gs:31`, `:78`, `:147` and the rest |
| Interrupt-disable read inlined in the sequence selector | `cpu_control.gs:120` |
| Interrupt-disable sets inlined in the interrupt sequences | `cpu_sequence.gs:76`, `:88`, `:150` |
| Branch and implied dispatch ordered by frequency | `cpu_instruction.gs:72-90`, `:147-197` |
| Chunk size 100 and instruction-batched PPU dot advancement | `scratch/src/frame_loop.gs`, `scratch/src/ppu_2c02.gs` |
| Access log disabled while a game runs | `rom_run.gs:102` |
| Pen color cache of 512 `#rrggbb` strings | `nes_palette.gs:26`, `:31-249` |
| Pen draw inlined, run-length encoded, per-frame cached scale | `main.gs:62-127` |
| Frame skip when the display falls behind | `rom_run.gs:166-190` |

## Appendix B - corrections to the previous revision of this file

The earlier revision accumulated four optimization "batches" whose status text no longer matches the source.
Corrections, so the next reader does not trust stale notes:

1. It stated that the APU was gated by `apu_audio_enabled`. There is no such variable; `apu_2a03.gs` is a
   no-op stub that nothing includes (Appendix A, B8).
2. It stated that hoisting globals into `local`s saves global reads because locals are cheaper. They are not:
   `local` lowers to a target variable (see `AGENTS.md` and section 1.1). Only the *count* of reads matters.
3. It reported `1305/1305` passing tests and a compiled `.sb3` self-test result. Neither is a measurement of
   this branch, and the toolchain to produce the second is not installed here. This revision records no
   pass counts and no runtime results.
4. It listed the PPU pixel path as "deferred because inlining risks warp correctness". Warp is a per-proc
   property and inlining does not change it; the real constraints are the lint pins in section 6 and the
   correctness risks in P1/P2.
5. It suggested a 65,536-entry byte table as a pure win. The boot cost and 196,608 list slots were not
   counted; see N7 and B7.

## Appendix C - inherent costs that cannot be removed

Listed so the next audit does not chase them:

- One framebuffer list write per visible pixel (61,440 per frame). The picture has to land somewhere the pen
  can read.
- One PPU dot decision per dot while timing is cycle-visible. This can be reduced to a few comparisons per
  dot (P3) but not to zero, because vblank, NMI, sprite-zero, and the MMC3 edge all key off dot positions.
- One CPU bus window decode per cycle (C1 makes it short, not absent).
- One list read per fetched tile byte, pattern byte, and nametable byte, because nametable, pattern, and
  palette memory are lists.
- One pen stroke per maximal run of equal pixels. The only way to beat it is a different presentation
  technology (D8).
- One broadcast per drawn frame (R1).
- One `% 256` / `% 65536` wherever a value legitimately leaves the byte or word range. These are the
  cheapest correct normalizations available in GoboScript.

---

*This audit covers all 31 GoboScript files and the project configuration. Every item names a `file:line`, an
estimated cost, a proposed change, and the verification that would let it be checked off. Estimates are
static; section 9 is where they become measurements.*
