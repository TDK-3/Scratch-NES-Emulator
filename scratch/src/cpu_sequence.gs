# CPU cycle sequences that do not depend on opcode decoding: reset, BRK, JSR, RTI, RTS, the
# two hardware interrupts, and a relative branch.
#
# These mirror the cycle generators of src/nes/cpu/cpu_2a03.ts: execute_reset_cycles,
# execute_brk_cycles, execute_jsr_cycles, execute_rti_cycles, execute_rts_cycles,
# execute_hardware_interrupt_cycles, and apply_relative_branch_cycles. Every bus access goes
# through src/cpu_core.gs, so each one appends a (kind, address, value) triple to
# cpu_access_log and spends exactly one cycle, which lets a vector pin the ordered trace and
# the cycle count at the same time.
#
# Opcode fetch is deliberately not part of these procedures. The reference reaches BRK, JSR,
# RTI, and RTS through execute_instruction_cycles, which fetches the opcode byte first, so a
# caller reproducing one of those instructions calls cpu_fetch_byte before the sequence; the
# shared vectors do exactly that. Reset and the two hardware interrupts are whole sequences
# and fetch no opcode.
#
# Interrupt acceptance policy is not ported. The reference polls the NMI latch and the IRQ
# line between sequences and masks IRQ with the interrupt disable flag; here the caller picks
# the sequence, which keeps the ported surface to the bus accesses themselves.

%include src/numeric
%include src/cpu_status
%include src/cpu_core
%include src/cpu_addressing

# Suite 11 operations. Ids 2 through 5 are instruction sequences that start after the caller
# has fetched the opcode byte, ids 1, 6, and 7 are whole sequences, and id 8 applies a
# relative branch to the operand left in the cpu_resolved_* globals.
enum cpu_sequence_op {
    reset = 1,
    brk = 2,
    jsr = 3,
    rti = 4,
    rts = 5,
    irq = 6,
    nmi = 7,
    relative_branch = 8
}

# Which vector a hardware interrupt reads.
enum cpu_interrupt_source {
    nmi = 1,
    irq = 2
}

enum cpu_sequence_error_code {
    none = 0,
    not_relative_operand = 1
}

var cpu_sequence_error = 0;

# Clears the sequence error without touching registers, cycles, or the access log.
proc cpu_reset_sequence_error {
    cpu_sequence_error = cpu_sequence_error_code.none;
}

# Seven accesses: two reads at the current program counter, three stack reads that each
# decrement the stack pointer, then the reset vector, which becomes the program counter. The
# interrupt disable flag is set; A, X, and Y are untouched.
proc cpu_execute_reset_cycles {
    local vector_low = 0;
    cpu_read_cycle cpu_program_counter;
    cpu_read_cycle cpu_program_counter;

    repeat 3 {
        cpu_read_cycle cpu_stack_page.base + cpu_stack_pointer;
        cpu_stack_pointer = normalize_byte(cpu_stack_pointer - 1);
    }

    cpu_read_cycle cpu_vector_address.reset_low;
    vector_low = cpu_cycle_value;
    cpu_read_cycle cpu_vector_address.reset_high;
    cpu_program_counter = join_bytes(cpu_cycle_value, vector_low);
    cpu_status = cpu_status + (4 * (1 - ((cpu_status // 4) % 2))); # set_status_flag(interrupt_disable,1) inlined.
}

# Seven accesses: the padding byte after the BRK opcode, the program counter pushed high byte
# first, the status pushed with the break flag set, then the IRQ/BRK vector. The interrupt
# disable flag is set before the vector is read, exactly as the reference does.
proc cpu_execute_brk_cycles {
    local vector_low = 0;
    cpu_fetch_byte;
    cpu_push_word cpu_program_counter;
    cpu_push_status 1;
    cpu_status = cpu_status + (4 * (1 - ((cpu_status // 4) % 2))); # set_status_flag(interrupt_disable,1) inlined.
    cpu_read_cycle cpu_vector_address.irq_brk_low;
    vector_low = cpu_cycle_value;
    cpu_read_cycle cpu_vector_address.irq_brk_high;
    cpu_program_counter = join_bytes(cpu_cycle_value, vector_low);
}

# Six accesses: the target low byte, a dummy read at the current stack pointer, the program
# counter pushed as it stands after the low byte, then the target high byte. The pushed value
# is the address of the high operand byte, which is why RTS adds one on the way back.
proc cpu_execute_jsr_cycles {
    local target_low = 0;
    cpu_fetch_byte;
    target_low = cpu_fetched_byte;
    cpu_read_cycle cpu_stack_page.base + cpu_stack_pointer;
    cpu_push_word cpu_program_counter;
    cpu_fetch_byte;
    cpu_program_counter = join_bytes(cpu_fetched_byte, target_low);
}

# Six accesses: a read at the program counter, a dummy read at the current stack pointer, the
# status popped and restored, then the program counter popped low byte first.
proc cpu_execute_rti_cycles {
    cpu_read_cycle cpu_program_counter;
    cpu_read_cycle cpu_stack_page.base + cpu_stack_pointer;
    cpu_pop_byte;
    cpu_restore_status_from_stack cpu_popped_byte;
    cpu_pop_word;
    cpu_program_counter = cpu_popped_word;
}

# Six accesses: a read at the program counter, a dummy read at the current stack pointer, the
# return address popped low byte first, a read at that address, and then the program counter
# becomes one past it.
proc cpu_execute_rts_cycles {
    local return_address = 0;
    cpu_read_cycle cpu_program_counter;
    cpu_read_cycle cpu_stack_page.base + cpu_stack_pointer;
    cpu_pop_word;
    return_address = cpu_popped_word;
    cpu_read_cycle return_address;
    cpu_program_counter = normalize_word(return_address + 1);
}

# Seven accesses: two reads at the program counter, the program counter pushed high byte
# first, the status pushed with the break flag clear, then the vector named by `source`, which
# is 1 for NMI and 2 for IRQ/BRK. The interrupt disable flag is set before the vector is read.
proc cpu_execute_hardware_interrupt_cycles source {
    local vector_low_address = cpu_vector_address.irq_brk_low;
    local vector_high_address = cpu_vector_address.irq_brk_high;
    local vector_low = 0;

    if $source == cpu_interrupt_source.nmi {
        vector_low_address = cpu_vector_address.nmi_low;
        vector_high_address = cpu_vector_address.nmi_high;
    }

    cpu_read_cycle cpu_program_counter;
    cpu_read_cycle cpu_program_counter;
    cpu_push_word cpu_program_counter;
    cpu_push_status 0;
    cpu_status = cpu_status + (4 * (1 - ((cpu_status // 4) % 2))); # set_status_flag(interrupt_disable,1) inlined.
    cpu_read_cycle vector_low_address;
    vector_low = cpu_cycle_value;
    cpu_read_cycle vector_high_address;
    cpu_program_counter = join_bytes(cpu_cycle_value, vector_low);
}

# Applies a relative branch to the operand in the cpu_resolved_* globals. A taken branch reads
# the origin address, reads the indexed dummy address again when the branch crosses a page, and
# then sets the program counter to the target. A branch that is not taken spends no cycles and
# changes nothing. An operand that is not a relative one reports
# cpu_sequence_error_code.not_relative_operand, where the reference throws a TypeError, and
# spends no cycles.
proc cpu_apply_relative_branch_cycles taken {
    cpu_sequence_error = cpu_sequence_error_code.none;

    if cpu_resolved_kind != cpu_operand_kind.relative {
        cpu_sequence_error = cpu_sequence_error_code.not_relative_operand;
    } elif $taken == 1 {
        cpu_read_cycle cpu_resolved_base_address;

        if cpu_resolved_page_crossed == 1 {
            cpu_read_cycle cpu_indexed_dummy_address(cpu_resolved_base_address, cpu_resolved_address);
        }

        cpu_program_counter = cpu_resolved_address;
    }
}
