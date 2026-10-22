# The CPU control loop for the GoboScript port.
#
# This header picks the next sequence the way begin_next_sequence does in
# src/nes/cpu/cpu_2a03.ts: a jammed CPU keeps reading its vector, a latched NMI wins over IRQ,
# an asserted IRQ line is accepted unless the interrupt-disable flag masks it, and otherwise one
# instruction runs. It also ports the two pieces of state that policy needs: the NMI latch, which
# request_nmi sets and acceptance clears, and the one-instruction IRQ poll mask that CLI, SEI,
# and PLP leave behind through finish_instruction.
#
# The poll mask is what makes the documented delay visible: after a CLI that ran with interrupt
# disable set, the next poll still uses the old value, so an IRQ waits one more instruction; after
# an SEI that ran with it clear, the next poll uses the old clear value, so an already pending IRQ
# is accepted even though the flag is now set. RTI needs no override, because it restores the
# status byte before the next boundary.
#
# The jam vector reads follow the reference-corpus convention: the first jam sequence reads
# $FFFF, $FFFE, and $FFFE, and every later jam sequence reads $FFFF only. Reset is not selected
# here, because the reference reaches it through request_reset rather than through the poll, so a
# caller runs cpu_execute_reset_cycles itself; the enum keeps its id for the reports.

%include src/numeric
%include src/cpu_status
%include src/cpu_core
%include src/cpu_addressing
%include src/cpu_alu
%include src/cpu_sequence
%include src/cpu_opcode
%include src/cpu_instruction

enum cpu_sequence_kind {
    instruction = 1,
    irq = 2,
    jam = 3,
    nmi = 4,
    reset = 5
}

# The sequence the last cpu_begin_next_sequence ran.
var cpu_selected_sequence = 0;

# The NMI latch: set by cpu_request_nmi, cleared when the sequence is accepted.
var cpu_nmi_pending = 0;

# The level-sensitive external IRQ input.
var cpu_irq_line_asserted = 0;

# The one-instruction IRQ poll mask left by CLI, SEI, and PLP. The reference stores an optional
# boolean, so the port keeps the presence and the value in two flags.
var cpu_irq_poll_mask_override_active = 0;
var cpu_irq_poll_mask_override_value = 0;

# Whether the first jam sequence has already issued its three vector reads.
var cpu_jam_vector_reads_issued = 0;

# Clears the control-loop state the way request_reset does: the jam flags, the NMI latch, and the
# poll mask. The external IRQ line is left alone, because it is driven from outside the CPU.
proc cpu_clear_interrupt_state {
    cpu_jammed = 0;
    cpu_jam_vector_reads_issued = 0;
    cpu_nmi_pending = 0;
    cpu_irq_poll_mask_override_active = 0;
    cpu_irq_poll_mask_override_value = 0;
}

# Latches an external NMI rising edge until the CPU accepts it.
proc cpu_request_nmi {
    cpu_nmi_pending = 1;
}

# Sets the level-sensitive external IRQ input; any nonzero level asserts it.
proc cpu_set_irq_line asserted {
    if $asserted == 0 {
        cpu_irq_line_asserted = 0;
    } else {
        cpu_irq_line_asserted = 1;
    }
}

# The jam sequence. Three vector reads the first time the CPU jams, one read per jam afterwards.
proc cpu_execute_jammed_cycles {
    if cpu_access_log_enabled == 1 {
        cpu_selected_sequence = cpu_sequence_kind.jam;
    }

    if cpu_jam_vector_reads_issued == 0 {
        cpu_jam_vector_reads_issued = 1;
        cpu_read_cycle cpu_vector_address.irq_brk_high;
        cpu_read_cycle cpu_vector_address.irq_brk_low;
        cpu_read_cycle cpu_vector_address.irq_brk_low;
    } else {
        cpu_read_cycle cpu_vector_address.irq_brk_high;
    }
}

# The instruction-boundary effect of CLI, SEI, and PLP: the next poll uses the interrupt-disable
# value the instruction started with, which is what delays or allows one IRQ.
proc cpu_finish_instruction interrupt_disabled_before {
    local delays_irq_poll = 0;

    if cpu_opcode_mnemonic == cpu_mnemonic.op_cli {
        delays_irq_poll = 1;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_sei {
        delays_irq_poll = 1;
    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_plp {
        delays_irq_poll = 1;
    }

    if delays_irq_poll == 1 {
        cpu_irq_poll_mask_override_active = 1;
        cpu_irq_poll_mask_override_value = $interrupt_disabled_before;
    }
}

# Runs the next sequence: jam, then a latched NMI, then an unmasked asserted IRQ, then one
# instruction. Cycle accounting is left running, so a caller that wants per-step counts resets it
# between steps.
proc cpu_begin_next_sequence {
    # has_status_flag(cpu_status, cpu_flag.interrupt_disable) inlined: cpu_status is normalized
    # by every writer, so the interrupt-disable bit is the bit with weight four read directly.
    # This runs once per emulated sequence, and the two custom-block calls the helper made were
    # a measurable share of an instruction's cost.
    local interrupt_disabled_before = (cpu_status // cpu_flag.interrupt_disable) % 2;
    local interrupt_disabled_for_poll = interrupt_disabled_before;
    local pc = 0;
    local opcode = 0;
    local operand_low = 0;
    local operand_high = 0;
    local branch_offset = 0;
    local branch_taken = 0;
    local branch_base = 0;
    local branch_target = 0;
    local cmp_diff = 0;
    local cmp_updated = 0;

    if cpu_irq_poll_mask_override_active == 1 {
        interrupt_disabled_for_poll = cpu_irq_poll_mask_override_value;
    }

    if cpu_jammed == 1 {
        cpu_execute_jammed_cycles;
    } elif cpu_nmi_pending == 1 {
        cpu_nmi_pending = 0;
        cpu_irq_poll_mask_override_active = 0;

        if cpu_access_log_enabled == 1 {
            cpu_selected_sequence = cpu_sequence_kind.nmi;
        }

        cpu_execute_hardware_interrupt_cycles cpu_interrupt_source.nmi;
    } elif cpu_irq_line_asserted == 1 and interrupt_disabled_for_poll == 0 {
        cpu_irq_poll_mask_override_active = 0;

        if cpu_access_log_enabled == 1 {
            cpu_selected_sequence = cpu_sequence_kind.irq;
        }

        cpu_execute_hardware_interrupt_cycles cpu_interrupt_source.irq;
    } else {
        cpu_irq_poll_mask_override_active = 0;

        if cpu_access_log_enabled == 1 {
            cpu_selected_sequence = cpu_sequence_kind.instruction;
        }

        cpu_instruction_error = cpu_instruction_error_code.none;
        pc = cpu_program_counter;

        # Ultra-hot inline PRG-ROM fetch + execute path for 32 KiB NROM gameplay when bus access
        # logging is off and PC has at least 3 non-wrapping PRG-ROM bytes ahead ($8000-$FFFC).
        if cpu_access_log_enabled == 0
            and cpu_bus_cartridge_kind == mapper_kind.nrom
            and cartridge_prg_rom_bytes == 32768
            and pc >= 32768
            and pc < 65533 {
            opcode = nrom_prg_rom[pc - 32767] + "";

            if opcode == 76 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                operand_high = nrom_prg_rom[pc - 32765] + "";
                cpu_fetched_byte = operand_high;
                cpu_cycle_value = operand_high;
                cpu_open_bus = operand_high;
                cpu_fetched_word = (operand_high * 256) + operand_low;
                cpu_program_counter = cpu_fetched_word;
                cpu_cycles = cpu_cycles + 3;
                cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;
            } elif opcode == 173 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                operand_high = nrom_prg_rom[pc - 32765] + "";
                cpu_fetched_byte = operand_high;
                cpu_cycle_value = operand_high;
                cpu_open_bus = operand_high;
                cpu_fetched_word = (operand_high * 256) + operand_low;
                cpu_program_counter = pc + 3;
                cpu_cycles = cpu_cycles + 3;
                cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;
                cpu_read_cycle cpu_fetched_word;
                cpu_a = cpu_cycle_value;
                cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2))
                    + cpu_zero_negative_bits[cpu_a + 1];
            } elif opcode == 165 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                cpu_fetched_byte = operand_low;
                cpu_a = cpu_ram[operand_low + 1] + "";
                cpu_cycle_value = cpu_a;
                cpu_open_bus = cpu_a;
                cpu_program_counter = pc + 2;
                cpu_cycles = cpu_cycles + 3;
                cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;
                cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2))
                    + cpu_zero_negative_bits[cpu_a + 1];
            } elif opcode == 169 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                cpu_fetched_byte = operand_low;
                cpu_cycle_value = operand_low;
                cpu_open_bus = operand_low;
                cpu_a = operand_low;
                cpu_program_counter = pc + 2;
                cpu_cycles = cpu_cycles + 2;
                cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2))
                    + cpu_zero_negative_bits[cpu_a + 1];
            } elif opcode == 141 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                operand_high = nrom_prg_rom[pc - 32765] + "";
                cpu_fetched_byte = operand_high;
                cpu_cycle_value = operand_high;
                cpu_open_bus = operand_high;
                cpu_fetched_word = (operand_high * 256) + operand_low;
                cpu_program_counter = pc + 3;
                cpu_cycles = cpu_cycles + 3;
                cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;
                cpu_write_cycle cpu_fetched_word, cpu_a;
            } elif opcode == 133 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                cpu_fetched_byte = operand_low;
                cpu_cycle_value = operand_low;
                cpu_ram[operand_low + 1] = cpu_a;
                cpu_open_bus = cpu_a;
                cpu_program_counter = pc + 2;
                cpu_cycles = cpu_cycles + 3;
                cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;
            } elif opcode == 41 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                cpu_fetched_byte = operand_low;
                cpu_cycle_value = operand_low;
                cpu_open_bus = operand_low;
                cpu_program_counter = pc + 2;
                cpu_cycles = cpu_cycles + 2;
                cpu_a = (bitwise_table_and[((cpu_a // 16) * 16) + (operand_low // 16) + 1] * 16)
                    + bitwise_table_and[((cpu_a % 16) * 16) + (operand_low % 16) + 1];
                cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2))
                    + cpu_zero_negative_bits[cpu_a + 1];
            } elif opcode == 201 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                cpu_fetched_byte = operand_low;
                cpu_cycle_value = operand_low;
                cpu_open_bus = operand_low;
                cpu_program_counter = pc + 2;
                cpu_cycles = cpu_cycles + 2;
                cmp_diff = cpu_a - operand_low;
                cmp_updated = cpu_status - (cpu_status % 2) + (1 - ((cmp_diff // 256) % 2));
                cpu_status = (cmp_updated % 128) - (2 * ((cmp_updated // 2) % 2))
                    + cpu_zero_negative_bits[(cmp_diff % 256) + 1];
            } elif opcode == 44 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                operand_high = nrom_prg_rom[pc - 32765] + "";
                cpu_fetched_byte = operand_high;
                cpu_cycle_value = operand_high;
                cpu_open_bus = operand_high;
                cpu_fetched_word = (operand_high * 256) + operand_low;
                cpu_program_counter = pc + 3;
                cpu_cycles = cpu_cycles + 3;
                cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;
                cpu_read_cycle cpu_fetched_word;
                alu_bit_test_byte cpu_a, cpu_cycle_value, cpu_status;
                cpu_status = alu_status;
            } elif opcode == 208 or opcode == 240 or opcode == 16 or opcode == 48 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                cpu_fetched_byte = operand_low;
                cpu_cycle_value = operand_low;
                cpu_open_bus = operand_low;
                branch_base = pc + 2;
                cpu_program_counter = branch_base;
                cpu_cycles = cpu_cycles + 2;
                branch_offset = operand_low;

                if branch_offset >= 128 {
                    branch_offset = branch_offset - 256;
                }

                branch_taken = 0;

                if opcode == 208 {
                    if ((cpu_status // 2) % 2) == 0 {
                        branch_taken = 1;
                    }
                } elif opcode == 240 {
                    if ((cpu_status // 2) % 2) == 1 {
                        branch_taken = 1;
                    }
                } elif opcode == 16 {
                    if (cpu_status // 128) == 0 {
                        branch_taken = 1;
                    }
                } else {
                    if (cpu_status // 128) == 1 {
                        branch_taken = 1;
                    }
                }

                if branch_taken == 1 {
                    branch_target = (branch_base + branch_offset) % 65536;
                    cpu_read_cycle branch_base;

                    if (branch_base // 256) != (branch_target // 256) {
                        branch_base = ((branch_base // 256) * 256) + (branch_target % 256);
                        cpu_read_cycle branch_base;
                    }

                    cpu_program_counter = branch_target;
                }
            } elif opcode == 202 or opcode == 136 or opcode == 232 or opcode == 200 {
                operand_low = nrom_prg_rom[pc - 32766] + "";
                cpu_fetched_byte = opcode;
                cpu_cycle_value = operand_low;
                cpu_open_bus = operand_low;
                cpu_program_counter = pc + 1;
                cpu_cycles = cpu_cycles + 2;

                if opcode == 202 {
                    cpu_x = (cpu_x - 1) % 256;
                    cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2))
                        + cpu_zero_negative_bits[cpu_x + 1];
                } elif opcode == 136 {
                    cpu_y = (cpu_y - 1) % 256;
                    cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2))
                        + cpu_zero_negative_bits[cpu_y + 1];
                } elif opcode == 232 {
                    cpu_x = (cpu_x + 1) % 256;
                    cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2))
                        + cpu_zero_negative_bits[cpu_x + 1];
                } else {
                    cpu_y = (cpu_y + 1) % 256;
                    cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2))
                        + cpu_zero_negative_bits[cpu_y + 1];
                }
            } else {
                cpu_fetched_byte = opcode;
                cpu_cycle_value = opcode;
                cpu_open_bus = opcode;
                cpu_program_counter = pc + 1;
                cpu_cycles = cpu_cycles + 1;
                cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;
                cpu_decode_opcode_hot opcode;

                if cpu_opcode_error != cpu_opcode_error_code.none {
                    cpu_instruction_error = cpu_instruction_error_code.undecodable_opcode;
                } elif cpu_opcode_mnemonic == cpu_mnemonic.op_kil {
                    cpu_read_cycle cpu_program_counter;
                    cpu_jammed = 1;
                } elif cpu_opcode_official == 0 {
                    cpu_instruction_error = cpu_instruction_error_code.unofficial_opcode;
                } elif cpu_opcode_mode == cpu_addressing_mode.relative {
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
                    if cpu_opcode_mnemonic == cpu_mnemonic.op_pha {
                        cpu_read_cycle cpu_program_counter;
                        cpu_push_byte cpu_a;
                    } elif cpu_opcode_mnemonic == cpu_mnemonic.op_pla {
                        cpu_read_cycle cpu_program_counter;
                        cpu_read_cycle cpu_stack_page.base + cpu_stack_pointer;
                        cpu_pop_byte;
                        cpu_a = cpu_popped_byte;
                        cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2))
                            + cpu_zero_negative_bits[cpu_a + 1];
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

                if cpu_opcode_mode == cpu_addressing_mode.implied {
                    cpu_finish_instruction interrupt_disabled_before;
                }
            }
        } else {
            cpu_fetch_byte;
            opcode = cpu_fetched_byte + "";
            cpu_decode_opcode_hot opcode;

            if cpu_opcode_error != cpu_opcode_error_code.none {
                cpu_instruction_error = cpu_instruction_error_code.undecodable_opcode;
            } elif cpu_opcode_mnemonic == cpu_mnemonic.op_kil {
                cpu_read_cycle cpu_program_counter;
                cpu_jammed = 1;
            } elif cpu_opcode_official == 0 {
                cpu_instruction_error = cpu_instruction_error_code.unofficial_opcode;
            } elif cpu_opcode_mode == cpu_addressing_mode.relative {
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
                if cpu_opcode_mnemonic == cpu_mnemonic.op_pha {
                    cpu_read_cycle cpu_program_counter;
                    cpu_push_byte cpu_a;
                } elif cpu_opcode_mnemonic == cpu_mnemonic.op_pla {
                    cpu_read_cycle cpu_program_counter;
                    cpu_read_cycle cpu_stack_page.base + cpu_stack_pointer;
                    cpu_pop_byte;
                    cpu_a = cpu_popped_byte;
                    cpu_status = (cpu_status % 128) - (2 * ((cpu_status // 2) % 2))
                        + cpu_zero_negative_bits[cpu_a + 1];
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

            if cpu_opcode_mode == cpu_addressing_mode.implied {
                cpu_finish_instruction interrupt_disabled_before;
            }
        }
    }
}
