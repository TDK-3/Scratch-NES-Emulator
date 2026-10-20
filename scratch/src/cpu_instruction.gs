# Instruction dispatch for the GoboScript port.
#
# This header executes one instruction the way execute_instruction_cycles does in
# src/nes/cpu/cpu_2a03.ts: fetch the opcode byte, decode it through the generated table, and run
# the cycle sequence that mnemonic needs. One cycle is spent per logged bus transaction, so a
# shared vector pins the cycle count, the final registers, and the ordered accesses together.
#
# Every official mnemonic is dispatched: the loads, stores, and the ALU group through the
# regular operand path, the shifts, rotates, and counters through the read-modify-write path,
# the transfers, flag instructions, and counters through the implied path, the four stack
# instructions, the eight relative branches, both JMP forms, BRK, JSR, RTI, RTS, NOP, and the
# KIL jam flag. Operand effects come from src/cpu_alu.gs and src/cpu_status.gs, which the shared
# vectors already compare exhaustively with the reference, so what is new here is the dispatch
# and the cycle accounting around it.
#
# Not ported: unofficial opcodes other than KIL report unofficial_opcode, the unstable
# high-byte stores (AHX, SHX, SHY, TAS) stay with them, the jam vector reads that follow a KIL
# and the sequence selection that picks them are not ported, and finish_instruction is not
# ported, so interrupt acceptance between instructions (the NMI latch, the IRQ line, and the
# interrupt-disable delay) stays with the caller, exactly as it does for the sequences in
# src/cpu_sequence.gs.

%include src/numeric
%include src/cpu_status
%include src/cpu_core
%include src/cpu_addressing
%include src/cpu_alu
%include src/cpu_sequence
%include src/cpu_opcode

enum cpu_instruction_error_code {
    none = 0,
    undecodable_opcode = 1,
    unofficial_opcode = 2,
    unresolved_operand = 3,
    unsupported_mnemonic = 4,
    unsupported_operand = 5
}

var cpu_instruction_error = 0;

# The value a store writes, computed by cpu_compute_store_value from the decoded mnemonic.
var cpu_store_value = 0;

# Set by KIL. The reference reads the byte past the opcode, marks the CPU jammed, and then
# issues the jam vector reads from the next sequence; sequence selection (jam, then NMI, then
# IRQ, then an instruction) is not ported, so this flag is state a caller can inspect.
var cpu_jammed = 0;

# Clears the instruction error without touching registers or the cycle count.
proc cpu_reset_instruction_error {
    cpu_instruction_error = cpu_instruction_error_code.none;
}

# Fetches the opcode byte and decodes it, leaving the four hot fields in the cpu_opcode_*
# globals. The self test keeps its own full decode, cpu_decode_opcode, for the two cycle fields.
proc cpu_fetch_and_decode_opcode {
    cpu_fetch_byte;
    cpu_decode_opcode_hot cpu_fetched_byte;
}

# Branches are exactly the official opcodes whose decoded mode is relative, so the dispatch tests
# the mode and this proc picks the condition from the mnemonic. cpu_status is normalized by
# every writer, so each condition reads its flag bit directly instead of through
# has_status_flag; the branches are ordered by how often compiled code takes them. The operand resolution and the
# taken, page-crossing, and not-taken cycle counts are the ported relative-branch sequence.
# The status bit each pair of top opcode bits selects for a relative branch: bits 7-6 are 00 for
# the negative flag, 01 for overflow, 10 for carry, and 11 for zero.
list cpu_branch_flag_weights = [128, 64, 1, 2];

# The eight relative branches this proc dispatches by arithmetic, named here because the branch
# table no longer compares against each one: cpu_mnemonic.op_bcc, cpu_mnemonic.op_bcs,
# cpu_mnemonic.op_bne, cpu_mnemonic.op_beq, cpu_mnemonic.op_bpl, cpu_mnemonic.op_bmi,
# cpu_mnemonic.op_bvc, cpu_mnemonic.op_bvs. Any other mnemonic cannot carry the relative
# addressing mode, so the arithmetic below reaches exactly these eight opcodes.

proc cpu_execute_branch {
    local taken = 0;
    local opcode_byte = cpu_fetched_byte % 256;
    local flag_weight = 0;

    # The opcode byte is captured before the operand is resolved, because a relative operand is
    # an immediate fetch and that overwrites cpu_fetched_byte with the offset.
    cpu_resolve_operand cpu_addressing_mode.relative, cpu_operand_access.read;

    if cpu_resolved_error != cpu_operand_error_code.none {
        cpu_instruction_error = cpu_instruction_error_code.unresolved_operand;
    } else {
        # The eight branch opcodes differ in exactly two fields: bits 7-6 pick the flag and bit
        # 5 picks whether the branch is taken on set or clear. Two divisions and one list read
        # replace a chain of up to eight mnemonic comparisons and eight flag expressions.
        flag_weight = cpu_branch_flag_weights[((opcode_byte // 64) % 4) + 1];

        if ((cpu_status // flag_weight) % 2) == ((opcode_byte // 32) % 2) {
            taken = 1;
        }
    }

    if cpu_instruction_error == cpu_instruction_error_code.none {
        cpu_apply_relative_branch_cycles taken;
    }
}

# JMP absolute resolves to a memory operand and JMP indirect to a jump target; the reference
# accepts either kind and assigns the resolved address to the program counter.
proc cpu_execute_jump {
    cpu_resolve_operand cpu_opcode_mode, cpu_operand_access.read;

    if cpu_resolved_error != cpu_operand_error_code.none {
        cpu_instruction_error = cpu_instruction_error_code.unresolved_operand;
    } elif cpu_resolved_kind == cpu_operand_kind.jump_target or cpu_resolved_kind == cpu_operand_kind.memory {
        cpu_program_counter = cpu_resolved_address;
    } else {
        cpu_instruction_error = cpu_instruction_error_code.unsupported_operand;
    }
}

# The regular operand path, mirroring execute_regular_instruction_cycles: resolve the operand,
# spend the access cycles its kind needs, and apply the effect. Implied and accumulator
# instructions spend one dummy read of the opcode byte before their effect, immediate operands
# were already read while resolving, and a memory operand is read, written, or read-modify
# written here.
proc cpu_execute_regular_instruction {
    cpu_resolve_operand cpu_opcode_mode, cpu_opcode_access;

    # The operand kinds are tested immediate first and memory second because those are the two
    # a running game reaches most often; the branches themselves are unchanged.
    if cpu_resolved_error != cpu_operand_error_code.none {
        cpu_instruction_error = cpu_instruction_error_code.unresolved_operand;
    } elif cpu_resolved_kind == cpu_operand_kind.immediate {
        cpu_apply_read_instruction cpu_opcode_mnemonic, cpu_resolved_value;
    } elif cpu_resolved_kind == cpu_operand_kind.memory {
        cpu_execute_memory_instruction;
    } elif cpu_resolved_kind == cpu_operand_kind.implied {
        cpu_read_cycle cpu_program_counter;
        cpu_apply_implied_instruction;
    } elif cpu_resolved_kind == cpu_operand_kind.accumulator {
        cpu_read_cycle cpu_program_counter;
        cpu_modify_value cpu_opcode_mnemonic, cpu_a;

        if cpu_instruction_error == cpu_instruction_error_code.none {
            cpu_a = alu_value;
            cpu_status = alu_status;
        }
    } else {
        cpu_instruction_error = cpu_instruction_error_code.unsupported_operand;
    }
}

# The register, flag, and counter instructions. The branches are ordered by how often a game
# executes them rather than by the reference's source order: an if / elif chain compiles to
# nested comparisons, and a typical frame runs the first few branches far more often than the
# flag setters. The registers are bytes by construction, so copying one needs no normalize.
proc cpu_apply_implied_instruction {
    if cpu_opcode_mnemonic == cpu_mnemonic.op_inx {
        cpu_x = (cpu_x + 1) % 256;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_x + 1];
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_dex {
        cpu_x = (cpu_x - 1) % 256;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_x + 1];
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_txa {
        cpu_a = cpu_x;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_a + 1];
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_tya {
        cpu_a = cpu_y;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_a + 1];
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_tax {
        cpu_x = cpu_a;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_x + 1];
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_tay {
        cpu_y = cpu_a;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_y + 1];
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_nop {
        # NOP changes no register and spends only the dummy read, so the branch keeps the error
        # at none with an explicit assignment; GoboScript drops an empty branch.
        cpu_instruction_error = cpu_instruction_error_code.none;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_clc {
        cpu_status = cpu_status - (cpu_status % 2);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_sec {
        cpu_status = cpu_status + (1 - (cpu_status % 2));
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_cli {
        cpu_status = cpu_status - (4 * ((cpu_status // 4) % 2));
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_sei {
        cpu_status = cpu_status + (4 * (1 - ((cpu_status // 4) % 2)));
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_iny {
        cpu_y = (cpu_y + 1) % 256;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_y + 1];
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_dey {
        cpu_y = (cpu_y - 1) % 256;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_y + 1];
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_tsx {
        cpu_x = cpu_stack_pointer;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_x + 1];
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_txs {
        cpu_stack_pointer = cpu_x;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_clv {
        cpu_status = cpu_status - (64 * ((cpu_status // 64) % 2));
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_cld {
        cpu_status = cpu_status - (8 * ((cpu_status // 8) % 2));
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_sed {
        cpu_status = cpu_status + (8 * (1 - ((cpu_status // 8) % 2)));
    } else {
        cpu_instruction_error = cpu_instruction_error_code.unsupported_mnemonic;
    }
}

# Applies an operand that was read, whether it came from an immediate byte or from memory. The
# arithmetic and the flag updates are the ported ALU and status helpers, and the branches are
# ordered by how often a game executes them.
proc cpu_apply_read_instruction mnemonic, value {
    if $mnemonic == cpu_mnemonic.op_lda {
        cpu_a = $value % 256;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_a + 1];
    } elif $mnemonic == cpu_mnemonic.op_ldx {
        cpu_x = $value % 256;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_x + 1];
    } elif $mnemonic == cpu_mnemonic.op_ldy {
        cpu_y = $value % 256;
        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_y + 1];
    } elif $mnemonic == cpu_mnemonic.op_adc {
        alu_add_with_carry_byte cpu_a, $value, cpu_status;
        cpu_a = alu_value;
        cpu_status = alu_status;
    } elif $mnemonic == cpu_mnemonic.op_and {
        alu_and_byte cpu_a, $value, cpu_status;
        cpu_a = alu_value;
        cpu_status = alu_status;
    } elif $mnemonic == cpu_mnemonic.op_cmp {
        alu_compare_byte cpu_a, $value, cpu_status;
        cpu_status = alu_status;
    } elif $mnemonic == cpu_mnemonic.op_ora {
        alu_ora_byte cpu_a, $value, cpu_status;
        cpu_a = alu_value;
        cpu_status = alu_status;
    } elif $mnemonic == cpu_mnemonic.op_eor {
        alu_eor_byte cpu_a, $value, cpu_status;
        cpu_a = alu_value;
        cpu_status = alu_status;
    } elif $mnemonic == cpu_mnemonic.op_cpx {
        alu_compare_byte cpu_x, $value, cpu_status;
        cpu_status = alu_status;
    } elif $mnemonic == cpu_mnemonic.op_cpy {
        alu_compare_byte cpu_y, $value, cpu_status;
        cpu_status = alu_status;
    } elif $mnemonic == cpu_mnemonic.op_sbc {
        alu_subtract_with_carry_byte cpu_a, $value, cpu_status;
        cpu_a = alu_value;
        cpu_status = alu_status;
    } elif $mnemonic == cpu_mnemonic.op_bit {
        alu_bit_test_byte cpu_a, $value, cpu_status;
        cpu_status = alu_status;
    } else {
        cpu_instruction_error = cpu_instruction_error_code.unsupported_mnemonic;
    }
}

# The memory operand cycles: one read, one write, or the read, write-back, and write of a
# read-modify-write, in the order the reference spends them.
proc cpu_execute_memory_instruction {
    if cpu_resolved_access == cpu_operand_access.read {
        cpu_read_cycle cpu_resolved_address;
        cpu_apply_read_instruction cpu_opcode_mnemonic, cpu_cycle_value;
    } elif cpu_resolved_access == cpu_operand_access.write {
        cpu_compute_store_value;

        if cpu_instruction_error == cpu_instruction_error_code.none {
            cpu_write_cycle cpu_resolved_address, cpu_store_value;
        }
    } elif cpu_resolved_access == cpu_operand_access.read_modify_write {
        cpu_read_cycle cpu_resolved_address;
        cpu_write_cycle cpu_resolved_address, cpu_cycle_value;
        cpu_modify_value cpu_opcode_mnemonic, cpu_cycle_value;

        if cpu_instruction_error == cpu_instruction_error_code.none {
            cpu_write_cycle cpu_resolved_address, alu_value;
            cpu_status = alu_status;
        }
    } else {
        cpu_instruction_error = cpu_instruction_error_code.unsupported_operand;
    }
}

# The value a store writes. Only STA, STX, and STY are official; the unstable high-byte stores
# stay unported with the rest of the unofficial opcodes.
proc cpu_compute_store_value {
    if cpu_opcode_mnemonic == cpu_mnemonic.op_sta {
        cpu_store_value = cpu_a;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_stx {
        cpu_store_value = cpu_x;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_sty {
        cpu_store_value = cpu_y;
    } else {
        cpu_store_value = 0;
        cpu_instruction_error = cpu_instruction_error_code.unsupported_mnemonic;
    }
}

# The read-modify-write effects, mirroring modify_value for the six official mnemonics. The
# result and its status are left in alu_value and alu_status for the caller to store.
proc cpu_modify_value mnemonic, value {
    if $mnemonic == cpu_mnemonic.op_inc {
        alu_increment_byte $value, cpu_status;
    } elif $mnemonic == cpu_mnemonic.op_dec {
        alu_decrement_byte $value, cpu_status;
    } elif $mnemonic == cpu_mnemonic.op_asl {
        alu_shift_left_byte $value, cpu_status;
    } elif $mnemonic == cpu_mnemonic.op_lsr {
        alu_shift_right_byte $value, cpu_status;
    } elif $mnemonic == cpu_mnemonic.op_rol {
        alu_rotate_left_byte $value, cpu_status;
    } elif $mnemonic == cpu_mnemonic.op_ror {
        alu_rotate_right_byte $value, cpu_status;
    } else {
        cpu_instruction_error = cpu_instruction_error_code.unsupported_mnemonic;
    }
}

# Executes one instruction. The caller owns interrupt acceptance, so this proc never decides
# between an instruction and a hardware interrupt; it runs whatever is at the program counter.
#
# Dispatch reordered by frequency: branch (BCC/BCS/BEQ/BNE/BMI/BPL/BVC/BVS ~15% of dynamic
# instructions) before rare subroutine ops (JSR/RTS ~2%) to save 2 comparisons per branch.
proc cpu_execute_instruction {
    # cpu_reset_instruction_error and cpu_fetch_and_decode_opcode inlined: this proc runs once
    # per emulated instruction, and two custom-block calls for one assignment, one fetch, and
    # one decode are pure call overhead.
    cpu_instruction_error = cpu_instruction_error_code.none;
    cpu_fetch_byte;
    cpu_decode_opcode_hot cpu_fetched_byte;

    if cpu_opcode_error != cpu_opcode_error_code.none {
        cpu_instruction_error = cpu_instruction_error_code.undecodable_opcode;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_kil {
        # KIL spends the opcode fetch plus one read at the advanced program counter, then jams.
        cpu_read_cycle cpu_program_counter;
        cpu_jammed = 1;
    } elif cpu_opcode_official == 0 {
        cpu_instruction_error = cpu_instruction_error_code.unofficial_opcode;
    } elif cpu_opcode_mode == cpu_addressing_mode.relative {
        # Relative is only branches among official opcodes, so this is the branch fast path.
        cpu_execute_branch;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_jsr {
        cpu_execute_jsr_cycles;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_rts {
        cpu_execute_rts_cycles;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_brk {
        cpu_execute_brk_cycles;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_rti {
        cpu_execute_rti_cycles;
    } elif cpu_opcode_mode == cpu_addressing_mode.implied {
        # Implied mode is a large share of what a game runs, and the regular path would resolve
        # an operand that implied mode never reads. The four stack instructions keep their own
        # sequences; everything else is one dummy read of the opcode byte plus the register and
        # flag effects.
        if cpu_opcode_mnemonic == cpu_mnemonic.op_pha {
            cpu_read_cycle cpu_program_counter;
            cpu_push_byte cpu_a;
        } elif cpu_opcode_mnemonic == cpu_mnemonic.op_pla {
            cpu_read_cycle cpu_program_counter;
            cpu_read_cycle cpu_stack_page.base + cpu_stack_pointer;
            cpu_pop_byte;
            cpu_a = cpu_popped_byte;
            cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2)) + cpu_zero_negative_bits[cpu_a + 1];
        } elif cpu_opcode_mnemonic == cpu_mnemonic.op_php {
            cpu_read_cycle cpu_program_counter;
            cpu_push_status 1;
        } elif cpu_opcode_mnemonic == cpu_mnemonic.op_plp {
            cpu_read_cycle cpu_program_counter;
            cpu_read_cycle cpu_stack_page.base + cpu_stack_pointer;
            cpu_pop_byte;
            cpu_restore_status_from_stack cpu_popped_byte;
        } else {
            cpu_read_cycle cpu_program_counter;
            cpu_apply_implied_instruction;
        }
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_jmp {
        cpu_execute_jump;
    } else {
        cpu_execute_regular_instruction;
    }
}
