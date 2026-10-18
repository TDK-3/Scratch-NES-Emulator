# Instruction dispatch for the GoboScript port.
#
# This header executes one instruction the way execute_instruction_cycles does in
# src/nes/cpu/cpu_2a03.ts: fetch the opcode byte, decode it through the generated table, and run
# the cycle sequence that mnemonic needs. One cycle is spent per logged bus transaction, so a
# shared vector pins the cycle count, the final registers, and the ordered accesses together.
#
# Ported here: the KIL jam flag, BRK, JSR, RTI, and RTS (the last four through
# src/cpu_sequence.gs),
# the eight relative branches, both JMP forms, the four stack instructions, the six register
# transfers, the seven flag instructions, INX, DEX, INY, DEY, and NOP.
#
# Not ported yet: the jam vector reads that follow a KIL and the sequence selection that picks
# them, instructions with an immediate or a memory operand, which is the load, store,
# ALU, and read-modify-write groups. Decoding one of them reports
# cpu_instruction_error_code.unsupported_mnemonic after the opcode fetch instead of executing,
# and an unofficial opcode other than KIL reports unofficial_opcode, so an unported instruction
# can never pass silently. finish_instruction is not ported either, so interrupt acceptance
# between instructions (the NMI latch, the IRQ line, and the interrupt-disable delay) stays with
# the caller, exactly as it does for the sequences in src/cpu_sequence.gs.

%include src/numeric
%include src/cpu_status
%include src/cpu_core
%include src/cpu_addressing
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

# Set by KIL. The reference reads the byte at the program counter, marks the CPU jammed, and
# then issues the jam vector reads from the next sequence; sequence selection (jam, then NMI,
# then IRQ, then an instruction) is not ported, so this flag is state a caller can inspect.
var cpu_jammed = 0;

# Clears the instruction error without touching registers or the cycle count.
proc cpu_reset_instruction_error {
    cpu_instruction_error = cpu_instruction_error_code.none;
}

# Fetches the opcode byte and decodes it, leaving the six fields in the cpu_opcode_* globals.
proc cpu_fetch_and_decode_opcode {
    cpu_fetch_byte;
    cpu_decode_opcode cpu_fetched_byte;
}

# Branches are exactly the official opcodes whose decoded mode is relative, so the dispatch tests
# the mode and this proc picks the condition from the mnemonic. The operand resolution and the
# taken, page-crossing, and not-taken cycle counts are the ported relative-branch sequence.
proc cpu_execute_branch {
    local taken = 0;
    cpu_resolve_operand cpu_addressing_mode.relative, cpu_operand_access.read;

    if cpu_resolved_error != cpu_operand_error_code.none {
        cpu_instruction_error = cpu_instruction_error_code.unresolved_operand;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_bcc {
        taken = 1 - has_status_flag(cpu_status, cpu_flag.carry);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_bcs {
        taken = has_status_flag(cpu_status, cpu_flag.carry);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_beq {
        taken = has_status_flag(cpu_status, cpu_flag.zero);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_bmi {
        taken = has_status_flag(cpu_status, cpu_flag.negative);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_bne {
        taken = 1 - has_status_flag(cpu_status, cpu_flag.zero);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_bpl {
        taken = 1 - has_status_flag(cpu_status, cpu_flag.negative);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_bvc {
        taken = 1 - has_status_flag(cpu_status, cpu_flag.overflow);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_bvs {
        taken = has_status_flag(cpu_status, cpu_flag.overflow);
    } else {
        cpu_instruction_error = cpu_instruction_error_code.unsupported_mnemonic;
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

# Implied instructions resolve to no operand, so the reference spends one dummy read of the
# opcode byte and then applies the effect without touching the bus.
proc cpu_execute_implied_instruction {
    cpu_resolve_operand cpu_opcode_mode, cpu_opcode_access;

    if cpu_resolved_error != cpu_operand_error_code.none {
        cpu_instruction_error = cpu_instruction_error_code.unresolved_operand;
    } else {
        cpu_read_cycle cpu_program_counter;
        cpu_apply_implied_instruction;
    }
}

# The register, flag, and counter instructions, in the order the reference lists them.
proc cpu_apply_implied_instruction {
    if cpu_opcode_mnemonic == cpu_mnemonic.op_inx {
        cpu_x = normalize_byte(cpu_x + 1);
        cpu_status = update_zero_negative_flags(cpu_status, cpu_x);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_iny {
        cpu_y = normalize_byte(cpu_y + 1);
        cpu_status = update_zero_negative_flags(cpu_status, cpu_y);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_dex {
        cpu_x = normalize_byte(cpu_x - 1);
        cpu_status = update_zero_negative_flags(cpu_status, cpu_x);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_dey {
        cpu_y = normalize_byte(cpu_y - 1);
        cpu_status = update_zero_negative_flags(cpu_status, cpu_y);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_tax {
        cpu_x = normalize_byte(cpu_a);
        cpu_status = update_zero_negative_flags(cpu_status, cpu_x);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_tay {
        cpu_y = normalize_byte(cpu_a);
        cpu_status = update_zero_negative_flags(cpu_status, cpu_y);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_tsx {
        cpu_x = normalize_byte(cpu_stack_pointer);
        cpu_status = update_zero_negative_flags(cpu_status, cpu_x);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_txa {
        cpu_a = normalize_byte(cpu_x);
        cpu_status = update_zero_negative_flags(cpu_status, cpu_a);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_txs {
        cpu_stack_pointer = normalize_byte(cpu_x);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_tya {
        cpu_a = normalize_byte(cpu_y);
        cpu_status = update_zero_negative_flags(cpu_status, cpu_a);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_clc {
        cpu_status = set_status_flag(cpu_status, cpu_flag.carry, 0);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_cld {
        cpu_status = set_status_flag(cpu_status, cpu_flag.decimal, 0);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_cli {
        cpu_status = set_status_flag(cpu_status, cpu_flag.interrupt_disable, 0);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_clv {
        cpu_status = set_status_flag(cpu_status, cpu_flag.overflow, 0);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_sec {
        cpu_status = set_status_flag(cpu_status, cpu_flag.carry, 1);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_sed {
        cpu_status = set_status_flag(cpu_status, cpu_flag.decimal, 1);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_sei {
        cpu_status = set_status_flag(cpu_status, cpu_flag.interrupt_disable, 1);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_nop {
        # NOP changes no register and spends only the dummy read, so the branch keeps the error
        # at none with an explicit assignment; GoboScript drops an empty branch.
        cpu_instruction_error = cpu_instruction_error_code.none;
    } else {
        cpu_instruction_error = cpu_instruction_error_code.unsupported_mnemonic;
    }
}

# Executes one instruction. The caller owns interrupt acceptance, so this proc never decides
# between an instruction and a hardware interrupt; it runs whatever is at the program counter.
proc cpu_execute_instruction {
    cpu_reset_instruction_error;
    cpu_fetch_and_decode_opcode;

    if cpu_opcode_error != cpu_opcode_error_code.none {
        cpu_instruction_error = cpu_instruction_error_code.undecodable_opcode;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_kil {
        # KIL spends the opcode fetch plus one read at the advanced program counter, then jams.
        # The reference marks the CPU jammed here and issues the jam vector reads from the next
        # sequence, which is not ported, so cpu_jammed is state for a caller to inspect.
        cpu_read_cycle cpu_program_counter;
        cpu_jammed = 1;
    } elif cpu_opcode_official == 0 {
        cpu_instruction_error = cpu_instruction_error_code.unofficial_opcode;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_brk {
        cpu_execute_brk_cycles;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_jsr {
        cpu_execute_jsr_cycles;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_rti {
        cpu_execute_rti_cycles;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_rts {
        cpu_execute_rts_cycles;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_pha {
        cpu_read_cycle cpu_program_counter;
        cpu_push_byte cpu_a;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_php {
        cpu_read_cycle cpu_program_counter;
        cpu_push_status 1;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_pla {
        cpu_read_cycle cpu_program_counter;
        cpu_read_cycle cpu_stack_page.base + cpu_stack_pointer;
        cpu_pop_byte;
        cpu_a = cpu_popped_byte;
        cpu_status = update_zero_negative_flags(cpu_status, cpu_a);
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_plp {
        cpu_read_cycle cpu_program_counter;
        cpu_read_cycle cpu_stack_page.base + cpu_stack_pointer;
        cpu_pop_byte;
        cpu_restore_status_from_stack cpu_popped_byte;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_jmp {
        cpu_execute_jump;
    } elif cpu_opcode_mode == cpu_addressing_mode.relative {
        cpu_execute_branch;
    } elif cpu_opcode_mode == cpu_addressing_mode.implied {
        cpu_execute_implied_instruction;
    } else {
        cpu_instruction_error = cpu_instruction_error_code.unsupported_mnemonic;
    }
}
