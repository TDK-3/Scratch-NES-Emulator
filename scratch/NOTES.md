Scratch NES Emulator port scaffold.

The TypeScript implementation in src/nes is the behavioral reference. This GoboScript project
is a separate reimplementation, not a transpile, and it has never been compiled: the pinned
GoboScript toolchain needs Cargo and rustc, which are not available in this environment, so
every .gs file here is compile-unvalidated. Its algorithms are validated on the TypeScript
side instead: tests/support/goboscript_port_algorithms.ts mirrors the arithmetic in
src/numeric.gs, src/cpu_status.gs, src/cpu_alu.gs, src/controller.gs, src/cpu_bus.gs,
src/cartridge.gs, src/cpu_core.gs, src/cpu_addressing.gs, src/cpu_sequence.gs,
src/cpu_opcode.gs, src/cpu_instruction.gs, and src/cpu_control.gs, and the automated suite compares
those mirrors exhaustively against the bitwise reference in src/nes/cpu/registers.ts,
src/nes/cpu/alu.ts, src/nes/cpu/nes_cpu_bus.ts, src/nes/input/controller.ts,
src/nes/cartridge/ines.ts, and src/nes/cpu/cpu_2a03.ts.

What the ported modules cover:

* numeric.gs: bit-free byte and word helpers, including bit_at, bitwise_and, bitwise_or, and
  bitwise_xor built from floor division and modulo, because GoboScript has no bitwise
  operators and "&" joins strings.
* cpu_status.gs: status normalization, flag get and set, zero and negative updates, and the
  BRK stack form.
* cpu_alu.gs: ADC, SBC, AND, ORA, EOR, ASL, LSR, ROL, ROR, CMP, CPX, CPY, BIT, INC, and DEC,
  each leaving its result byte in alu_value and its status byte in alu_status. Overflow is
  derived from signed arithmetic rather than bit masks.
* controller.gs: both serial controller ports with strobe, latch on the falling edge, and the
  trailing 1 bits after the eighth read.
* cpu_bus.gs: 2 KiB RAM with $0000-$1FFF mirroring, the open-bus latch with driven masks, and
  the $4016/$4017 controller window. PPU, APU, $4014 OAM DMA, and cartridge windows are not
  ported yet, so reads of those addresses return the retained latch and writes are dropped.
* cartridge.gs: iNES 1.0 and NES 2.0 header parsing into the cartridge_* result globals,
  covering the signature, version bits, mapper and submapper, mirroring, battery, trainer
  flag, PRG and CHR ROM sizes including the NES 2.0 exponent form, the four RAM and NVRAM
  sizes, and the trainer, PRG, and CHR payload offsets. Failures set one numeric error code
  (1 truncated header, 2 invalid magic, 3 unsupported version, 4 invalid ROM size, 5 image too
  large, 6 truncated payload) and leave every field at zero, in the same check order as the
  TypeScript reference. Powers of two are built by doubling in a repeat loop, and a size that
  loses integer precision is reported as -1.
* rom_loader.gs: loads the generated ROM list, checks the iNES signature, copies the embedded
  header into the parser, and writes the summary text the self test reports.
* cpu_core.gs: the six CPU registers, one logged bus transaction per cycle in
  cpu_access_log, program-counter fetch byte and word, push and pop byte and word, and status
  push and restore. Every helper that spends a cycle is a proc that leaves its result in a
  documented global (cpu_cycle_value, cpu_fetched_byte, cpu_fetched_word, cpu_popped_byte,
  cpu_popped_word) rather than a func used in an expression, because GoboScript hoists an
  expression-position func call in front of the enclosing statement and a nested bus access
  would then be ordered by a lowering detail instead of by the source. The reference suspends each instruction with a generator so one bus
  transaction is visible at a time; this port performs the same accesses in the same order and
  counts one cycle each without suspending, which is exact for CPU state and access order and
  an approximation only for a device that would interleave mid-instruction, such as the DMC
  DMA that is not ported yet.
* cpu_addressing.gs: all thirteen official addressing modes, including the zero-page and
  indexed dummy reads, the extra cycle when an indexed access crosses a page or writes, and
  the JMP indirect pointer wrap inside one page. An illegal mode and access pair records an
  error code instead of stopping the project, where the TypeScript reference throws.
* cpu_sequence.gs: the cycle sequences that do not need opcode decoding: reset, BRK, JSR,
  RTI, RTS, the NMI and IRQ/BRK hardware interrupts, and a relative branch. Opcode fetch stays
  with the caller, because the TypeScript reference reaches BRK, JSR, RTI, and RTS through
  execute_instruction_cycles, which fetches the opcode first. Interrupt acceptance policy
  (polling the NMI latch and the IRQ line between instructions, masking IRQ with the interrupt
  disable flag) lives in cpu_control.gs; this header runs the sequence it is given.
* cpu_opcode.gs: the 76-name cpu_mnemonic enum, whose ids come from
  tests/fixtures/goboscript/opcode_table.json, and the decode of one opcode byte into the
  mnemonic, addressing mode, base cycles, operand access, page-cross flag, and official flag.
  The values are read from data/opcode_table.txt, generated by `npm run scratch:opcode`, at
  the record offset 3 + opcode * 6, so a decoded instruction can be handed to
  cpu_resolve_operand without translation. cpu_check_opcode_table verifies the list length and
  header first, and a table that did not load reports an error code instead of decoding zeros.
  Opcode dispatch and per-instruction execution are not ported; the caller still picks which
  sequence or operand step to run.
* cpu_instruction.gs: executes one whole instruction, and every official mnemonic is
  dispatched. cpu_execute_instruction fetches and decodes the opcode byte and then runs the
  sequence for that mnemonic: the KIL jam flag, BRK, JSR, RTI, RTS, the eight relative branches
  (dispatched on the decoded relative mode, with the condition taken from the mnemonic), JMP
  absolute and JMP indirect, PHA, PHP, PLA, PLP, the six register transfers, TXS, the seven flag
  instructions, INX, DEX, INY, DEY, and NOP. Everything else goes through
  cpu_execute_regular_instruction, which resolves the operand and then spends the cycles its
  kind needs: a dummy read of the opcode byte for implied and accumulator forms, nothing extra
  for an immediate operand, and one read, one write, or the read, write-back, and write of a
  read-modify-write for a memory operand. Operand effects come from cpu_alu.gs and
  cpu_status.gs, which the shared vectors already compare exhaustively with the reference, so
  one cycle is still logged per bus transaction and a vector pins the cycle count and the
  ordered accesses together. Anything the port does not execute sets cpu_instruction_error
  instead of guessing: 1 undecodable opcode, 2 unofficial opcode, 3 unresolved operand,
  4 unsupported mnemonic, 5 unsupported operand. cpu_control.gs ports finish_instruction and the
  sequence selection around it.
* cpu_control.gs: picks the next sequence the way begin_next_sequence does: a jammed CPU keeps
  reading its vector, a latched NMI wins over IRQ, an asserted IRQ line is accepted unless the
  interrupt disable flag masks it, and otherwise one instruction runs. It holds the NMI latch
  (cpu_request_nmi), the level-sensitive IRQ input (cpu_set_irq_line), the jam vector reads
  (cpu_execute_jammed_cycles: $FFFF, $FFFE, $FFFE the first time the CPU jams and $FFFF on every
  later jam), the reset-shaped state clear (cpu_clear_interrupt_state), and the one-instruction
  IRQ poll mask that CLI, SEI, and PLP leave behind through cpu_finish_instruction, which is what
  delays an IRQ after CLI and lets an already pending IRQ through after SEI. DMA stalls and the
  yield policy a frame loop needs are not ported.
* vector_selftest.gs: walks the generated list in data/shared_port_vectors.txt and compares
  each record with the value recorded from the TypeScript reference. Suites 1 (numeric), 3
  (bus), 7 (controller), 8 (ALU), 9 (cartridge header), 10 (CPU addressing), 11 (CPU
  cycle sequences), 12 (opcode decode), 13 (instruction execution), and 14 (control loop) are
  replayed; records for the CPU state, MMC3, PPU, and APU suites are counted as skipped rather
  than treated as passing.

The green flag runs that self test on the Stage and broadcasts "port self test done"; the
display sprite reports the summary. data/test_rom_bytes.txt, data/shared_port_vectors.txt, and
data/opcode_table.txt are generated by `npm run scratch:assets`, `npm run scratch:vectors`, and
`npm run scratch:opcode` and are not stored in Git. The default source image is test_rom.nes, a
Nintendo-derived dump with unknown
provenance that must not be modified or redistributed.

Not ported: unofficial opcodes other than KIL and their unstable high-byte stores, DMA stalls,
and the yield policy a frame loop needs; cartridge payload copying into bank lists and RAM/NVRAM
storage; PPU rendering; APU channels; MMC3 mapper banking and IRQ; and any frame loop or
rendering path.
