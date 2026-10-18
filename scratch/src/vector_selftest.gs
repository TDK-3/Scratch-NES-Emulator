# Shared port-vector self test.
#
# Walks the generated numeric list in scratch/data/shared_port_vectors.txt, runs every
# record through the ported GoboScript modules, and compares the results with the values
# recorded from the TypeScript reference. Records for suites that are not ported yet are
# counted as skipped instead of being silently treated as passing. Today that is suite 2
# (CPU core), 4 (MMC3), 5 (PPU), and 6 (APU).
#
# List layout (schema version 1, one decimal value per line, 1-indexed Scratch positions):
#   [1] schema version, [2] record count, then per record:
#   suite id, case id, operation id, input count, expected count, inputs..., expected...
#
# The whole walk is run-without-screen-refresh. It covers a few hundred short records, so it
# does not need yield points; the frame loop that a ported CPU core will need is separate.

%include src/numeric
%include src/cpu_status
%include src/cpu_alu
%include src/controller
%include src/cpu_bus
%include src/cpu_core
%include src/cpu_addressing
%include src/cpu_sequence
%include src/cpu_opcode
%include src/cpu_instruction
%include src/cpu_control
%include src/cartridge
%include src/mapper
%include src/mapper_000
%include src/cartridge_loader
%include src/rom_loader
%include src/shared_vectors

enum port_suite {
    numeric = 1,
    cpu = 2,
    bus = 3,
    mapper = 4,
    ppu = 5,
    apu = 6,
    controller = 7,
    alu = 8,
    cartridge = 9,
    cpu_addressing = 10,
    cpu_sequence = 11,
    cpu_opcode = 12,
    cpu_instruction = 13,
    cpu_control = 14,
    nrom = 15,
    nrom_memory = 16,
    cartridge_bus = 17
}

# Suite 1 operations. Values 1 through 6 are the original numeric contract; 7 through 13
# cover the arithmetic bit helpers this port needs because GoboScript has no bitwise
# operators. Every id must stay in sync with tests/shared-port-vectors.test.ts.
enum numeric_op {
    op_normalize_byte = 1,
    op_normalize_word = 2,
    op_to_signed_byte = 3,
    op_normalize_status = 4,
    op_pack_status_for_stack = 5,
    op_update_zero_negative = 6,
    op_bit_at = 7,
    op_bitwise_and = 8,
    op_bitwise_or = 9,
    op_bitwise_xor = 10,
    op_byte_high = 11,
    op_byte_low = 12,
    op_join_bytes = 13
}

# Suite 8 operations. Each id names the 2A03 instruction whose production behavior the
# TypeScript reference executes to produce the recorded value and status byte.
enum alu_op {
    op_adc = 1,
    op_sbc = 2,
    op_and = 3,
    op_ora = 4,
    op_eor = 5,
    op_asl = 6,
    op_lsr = 7,
    op_rol = 8,
    op_ror = 9,
    op_cmp = 10,
    op_cpx = 11,
    op_cpy = 12,
    op_bit = 13,
    op_inc = 14,
    op_dec = 15
}

var port_vector_cursor = 0;
var port_vectors_run = 0;
var port_vectors_passed = 0;
var port_vectors_failed = 0;
var port_vectors_skipped = 0;
var port_first_failure = "";
var port_self_test_done = 0;
var port_self_test_summary = "";
list port_actual_values;
list port_bus_reads;
list port_sequence_kinds;

# Runs every shared vector and writes a human-readable summary for the Stage monitor.
proc run_port_self_test {
    local schema_version = to_number(shared_port_vectors[1]);
    local record_count = to_number(shared_port_vectors[2]);
    port_vector_cursor = 3;
    port_vectors_run = 0;
    port_vectors_passed = 0;
    port_vectors_failed = 0;
    port_vectors_skipped = 0;
    port_first_failure = "";
    port_self_test_done = 0;
    port_self_test_summary = "";
    rom_header_report;
    cartridge_load_board;
    cpu_check_opcode_table;

    if schema_version != 1 {
        port_self_test_summary = "unsupported shared vector schema " & schema_version;
    } elif cpu_opcode_error != cpu_opcode_error_code.none {
        port_self_test_summary = "opcode table failed its length and header check";
    } else {
        repeat record_count {
            run_next_port_vector;
        }

        port_self_test_summary = "port vectors " & port_vectors_passed & "/" & port_vectors_run;
        port_self_test_summary = port_self_test_summary & " passed, " & port_vectors_skipped & " skipped";
        port_self_test_summary = port_self_test_summary & ", rom header " & rom_header_state_text;
        port_self_test_summary = port_self_test_summary & ", board " & cartridge_board_state_text;
    }

    if port_vectors_failed > 0 {
        port_self_test_summary = port_self_test_summary & "; first failure: " & port_first_failure;
    }

    port_self_test_done = 1;
}

# Reads one record at the cursor, dispatches it, and advances the cursor past the record.
proc run_next_port_vector {
    local suite_id = to_number(shared_port_vectors[port_vector_cursor]);
    local case_id = to_number(shared_port_vectors[port_vector_cursor + 1]);
    local operation = to_number(shared_port_vectors[port_vector_cursor + 2]);
    local input_count = to_number(shared_port_vectors[port_vector_cursor + 3]);
    local expected_count = to_number(shared_port_vectors[port_vector_cursor + 4]);
    local input_start = port_vector_cursor + 5;
    local expected_start = input_start + input_count;
    local skipped = 0;
    port_vector_cursor = expected_start + expected_count;
    delete port_actual_values;

    if suite_id == port_suite.numeric {
        run_numeric_vector operation, input_start;
    } elif suite_id == port_suite.alu {
        run_alu_vector operation, input_start;
    } elif suite_id == port_suite.bus {
        run_bus_vector input_start;
    } elif suite_id == port_suite.controller {
        run_controller_vector input_start;
    } elif suite_id == port_suite.cartridge {
        run_cartridge_vector input_start;
    } elif suite_id == port_suite.cpu_addressing {
        run_cpu_addressing_vector operation, input_start;
    } elif suite_id == port_suite.cpu_sequence {
        run_cpu_sequence_vector operation, input_start;
    } elif suite_id == port_suite.cpu_opcode {
        run_cpu_opcode_vector input_start;
    } elif suite_id == port_suite.cpu_instruction {
        run_cpu_instruction_vector input_start;
    } elif suite_id == port_suite.cpu_control {
        run_cpu_control_vector input_start;
    } elif suite_id == port_suite.nrom {
        run_nrom_vector input_start;
    } elif suite_id == port_suite.nrom_memory {
        run_nrom_memory_vector input_start;
    } elif suite_id == port_suite.cartridge_bus {
        run_cartridge_bus_vector input_start;
    } else {
        # Suite 2 (CPU core), 4 (MMC3), 5 (PPU), and 6 (APU) are not ported yet.
        skipped = 1;
    }

    if skipped == 1 {
        port_vectors_skipped++;
    } else {
        compare_vector_results suite_id, case_id, expected_start, expected_count;
    }
}

# Suite 1: one numeric helper result per record.
proc run_numeric_vector operation, input_start {
    local first = to_number(shared_port_vectors[$input_start]);
    local second = to_number(shared_port_vectors[$input_start + 1]);
    local result = 0;

    if $operation == numeric_op.op_normalize_byte {
        result = normalize_byte(first);
    } elif $operation == numeric_op.op_normalize_word {
        result = normalize_word(first);
    } elif $operation == numeric_op.op_to_signed_byte {
        result = to_signed_byte(first);
    } elif $operation == numeric_op.op_normalize_status {
        result = normalize_status(first);
    } elif $operation == numeric_op.op_pack_status_for_stack {
        # Operation 5 records the BRK form, the only form with the break bit set.
        result = pack_status_for_stack(first, 1);
    } elif $operation == numeric_op.op_update_zero_negative {
        result = update_zero_negative_flags(first, second);
    } elif $operation == numeric_op.op_bit_at {
        result = bit_at(first, second);
    } elif $operation == numeric_op.op_bitwise_and {
        result = bitwise_and(first, second);
    } elif $operation == numeric_op.op_bitwise_or {
        result = bitwise_or(first, second);
    } elif $operation == numeric_op.op_bitwise_xor {
        result = bitwise_xor(first, second);
    } elif $operation == numeric_op.op_byte_high {
        result = byte_high(first);
    } elif $operation == numeric_op.op_byte_low {
        result = byte_low(first);
    } elif $operation == numeric_op.op_join_bytes {
        result = join_bytes(first, second);
    }

    add result to port_actual_values;
}

# Suite 8: the ALU result byte and the status byte produced by the matching instruction.
proc run_alu_vector operation, input_start {
    local left = to_number(shared_port_vectors[$input_start]);
    local right = to_number(shared_port_vectors[$input_start + 1]);
    local status = to_number(shared_port_vectors[$input_start + 2]);

    if $operation == alu_op.op_adc {
        alu_add_with_carry left, right, status;
    } elif $operation == alu_op.op_sbc {
        alu_subtract_with_carry left, right, status;
    } elif $operation == alu_op.op_and {
        alu_and left, right, status;
    } elif $operation == alu_op.op_ora {
        alu_ora left, right, status;
    } elif $operation == alu_op.op_eor {
        alu_eor left, right, status;
    } elif $operation == alu_op.op_asl {
        alu_shift_left left, right;
    } elif $operation == alu_op.op_lsr {
        alu_shift_right left, right;
    } elif $operation == alu_op.op_rol {
        alu_rotate_left left, right;
    } elif $operation == alu_op.op_ror {
        alu_rotate_right left, right;
    } elif $operation == alu_op.op_cmp {
        alu_compare left, right, status;
    } elif $operation == alu_op.op_cpx {
        alu_compare left, right, status;
    } elif $operation == alu_op.op_cpy {
        alu_compare left, right, status;
    } elif $operation == alu_op.op_bit {
        alu_bit_test left, right, status;
    } elif $operation == alu_op.op_inc {
        alu_increment left, right;
    } elif $operation == alu_op.op_dec {
        alu_decrement left, right;
    }

    add alu_value to port_actual_values;
    add alu_status to port_actual_values;
}

# Suite 3: replay CPU bus operations and report every read.
#
# The port always has live controller ports, so operation 1 records (which the TypeScript
# side replays with no devices attached) must not read $4016/$4017. Operation 2 records use
# live controller ports on both sides.
proc run_bus_vector input_start {
    local operation_count = to_number(shared_port_vectors[$input_start]);
    local offset = 1;
    local kind = 0;
    local address = 0;
    local value = 0;
    local read_index = 1;
    local read_count = 0;
    delete port_bus_reads;
    cpu_bus_reset;
    controller_reset;
    controller_set_button_mask 0, 0;
    controller_set_button_mask 1, 0;

    repeat operation_count {
        kind = to_number(shared_port_vectors[$input_start + offset]);
        address = to_number(shared_port_vectors[$input_start + offset + 1]);
        value = to_number(shared_port_vectors[$input_start + offset + 2]);
        offset += 3;

        if kind == 1 {
            cpu_bus_write address, value;
        } else {
            add cpu_bus_read(address) to port_bus_reads;
        }
    }

    read_count = length port_bus_reads;
    add read_count to port_actual_values;

    repeat read_count {
        add to_number(port_bus_reads[read_index]) to port_actual_values;
        read_index++;
    }
}

# Suite 7: latch one button mask and report the serial D0 bits of one port.
proc run_controller_vector input_start {
    local controller_index = to_number(shared_port_vectors[$input_start]);
    local button_mask = to_number(shared_port_vectors[$input_start + 1]);
    local read_count = to_number(shared_port_vectors[$input_start + 2]);
    controller_reset;
    controller_set_button_mask 0, 0;
    controller_set_button_mask 1, 0;
    controller_set_button_mask controller_index, button_mask;
    controller_write_strobe 1;
    controller_write_strobe 0;

    repeat read_count {
        add controller_serial_read(controller_index) to port_actual_values;
    }
}

# Suite 9: parse one 16-byte header and report every parsed field or the error code.
#
# The record is 17 inputs (declared image length, then header bytes 0 through 15) and 18
# expected values: ok, error code, format, mapper, submapper, mirroring, battery, trainer,
# PRG ROM bytes, CHR ROM bytes, PRG RAM, PRG NVRAM, CHR RAM, CHR NVRAM, trainer offset, PRG
# offset, CHR offset, and payload end. Failures report zeros after the error code on both
# sides, so a rejected header stays a deterministic record.
proc run_cartridge_vector input_start {
    local index = 0;
    cartridge_image_bytes = to_number(shared_port_vectors[$input_start]);

    repeat cartridge_limit.header_bytes {
        cartridge_header[index + 1] = to_number(shared_port_vectors[$input_start + index + 1]);
        index++;
    }

    cartridge_parse_header;
    add cartridge_ok to port_actual_values;
    add cartridge_error_code to port_actual_values;
    add cartridge_format to port_actual_values;
    add cartridge_mapper_id to port_actual_values;
    add cartridge_submapper to port_actual_values;
    add cartridge_mirroring to port_actual_values;
    add cartridge_battery_backed to port_actual_values;
    add cartridge_has_trainer to port_actual_values;
    add cartridge_prg_rom_bytes to port_actual_values;
    add cartridge_chr_rom_bytes to port_actual_values;
    add cartridge_prg_ram_bytes to port_actual_values;
    add cartridge_prg_nvram_bytes to port_actual_values;
    add cartridge_chr_ram_bytes to port_actual_values;
    add cartridge_chr_nvram_bytes to port_actual_values;
    add cartridge_trainer_offset to port_actual_values;
    add cartridge_prg_rom_offset to port_actual_values;
    add cartridge_chr_rom_offset to port_actual_values;
    add cartridge_payload_end to port_actual_values;
}

# Suite 10: one addressing-mode resolution, where the operation id is the addressing mode.
# Inputs are the access kind (1 read, 2 write, 3 read-modify-write), PC, A, X, Y, SP, status,
# a setup count, and then that many (address, value) pairs written to the decoder before the
# resolution. Expected values are the eleven resolved-operand fields (kind, mode, access, base
# address, address, value, page crossed, error, cycles, final PC, final SP) followed by one
# (kind, address, value) triple per bus access, so the dummy reads, their addresses, and the
# cycle count are pinned along with the operand. Setup writes spend no cycles on either side,
# which is why the accounting is cleared after them.
proc run_cpu_addressing_vector operation, input_start {
    local access = to_number(shared_port_vectors[$input_start]);
    local setup_count = to_number(shared_port_vectors[$input_start + 7]);
    local setup_index = 0;
    local setup_address = 0;
    local setup_value = 0;
    local log_index = 1;
    local log_count = 0;
    cpu_reset_registers;
    cpu_bus_clear_ram;
    cpu_bus_reset;
    cpu_program_counter = to_number(shared_port_vectors[$input_start + 1]);
    cpu_a = to_number(shared_port_vectors[$input_start + 2]);
    cpu_x = to_number(shared_port_vectors[$input_start + 3]);
    cpu_y = to_number(shared_port_vectors[$input_start + 4]);
    cpu_stack_pointer = to_number(shared_port_vectors[$input_start + 5]);
    cpu_status = to_number(shared_port_vectors[$input_start + 6]);

    repeat setup_count {
        setup_address = to_number(shared_port_vectors[$input_start + 8 + (setup_index * 2)]);
        setup_value = to_number(shared_port_vectors[$input_start + 9 + (setup_index * 2)]);
        cpu_bus_write setup_address, setup_value;
        setup_index++;
    }

    cpu_reset_cycle_accounting;
    cpu_resolve_operand $operation, access;
    add cpu_resolved_kind to port_actual_values;
    add cpu_resolved_mode to port_actual_values;
    add cpu_resolved_access to port_actual_values;
    add cpu_resolved_base_address to port_actual_values;
    add cpu_resolved_address to port_actual_values;
    add cpu_resolved_value to port_actual_values;
    add cpu_resolved_page_crossed to port_actual_values;
    add cpu_resolved_error to port_actual_values;
    add cpu_cycles to port_actual_values;
    add cpu_program_counter to port_actual_values;
    add cpu_stack_pointer to port_actual_values;
    log_count = length cpu_access_log;

    repeat log_count {
        add to_number(cpu_access_log[log_index]) to port_actual_values;
        log_index++;
    }
}

# Suite 11: one CPU cycle sequence, where the operation id names the sequence. Inputs are PC,
# A, X, Y, SP, status, the relative-branch taken flag, a setup count, and then that many
# (address, value) pairs written before the sequence runs. Expected values are the cycle
# count, the final program counter, stack pointer, status, A, X, and Y, the sequence error
# code, and then one (kind, address, value) triple per bus access. BRK, JSR, RTI, RTS, and the
# relative branch fetch their opcode byte first, because the reference reaches them through
# execute_instruction_cycles; reset and the two hardware interrupts fetch no opcode.
proc run_cpu_sequence_vector operation, input_start {
    local taken = to_number(shared_port_vectors[$input_start + 6]);
    local setup_count = to_number(shared_port_vectors[$input_start + 7]);
    local setup_index = 0;
    local setup_address = 0;
    local setup_value = 0;
    local log_index = 1;
    local log_count = 0;
    cpu_reset_registers;
    cpu_bus_clear_ram;
    cpu_bus_reset;
    cpu_program_counter = to_number(shared_port_vectors[$input_start]);
    cpu_a = to_number(shared_port_vectors[$input_start + 1]);
    cpu_x = to_number(shared_port_vectors[$input_start + 2]);
    cpu_y = to_number(shared_port_vectors[$input_start + 3]);
    cpu_stack_pointer = to_number(shared_port_vectors[$input_start + 4]);
    cpu_status = to_number(shared_port_vectors[$input_start + 5]);

    repeat setup_count {
        setup_address = to_number(shared_port_vectors[$input_start + 8 + (setup_index * 2)]);
        setup_value = to_number(shared_port_vectors[$input_start + 9 + (setup_index * 2)]);
        cpu_bus_write setup_address, setup_value;
        setup_index++;
    }

    cpu_reset_cycle_accounting;
    cpu_reset_sequence_error;

    if $operation == cpu_sequence_op.reset {
        cpu_execute_reset_cycles;
    } elif $operation == cpu_sequence_op.brk {
        cpu_fetch_byte;
        cpu_execute_brk_cycles;
    } elif $operation == cpu_sequence_op.jsr {
        cpu_fetch_byte;
        cpu_execute_jsr_cycles;
    } elif $operation == cpu_sequence_op.rti {
        cpu_fetch_byte;
        cpu_execute_rti_cycles;
    } elif $operation == cpu_sequence_op.rts {
        cpu_fetch_byte;
        cpu_execute_rts_cycles;
    } elif $operation == cpu_sequence_op.irq {
        cpu_execute_hardware_interrupt_cycles cpu_interrupt_source.irq;
    } elif $operation == cpu_sequence_op.nmi {
        cpu_execute_hardware_interrupt_cycles cpu_interrupt_source.nmi;
    } elif $operation == cpu_sequence_op.relative_branch {
        cpu_fetch_byte;
        cpu_resolve_operand cpu_addressing_mode.relative, cpu_operand_access.read;
        cpu_apply_relative_branch_cycles taken;
    }

    add cpu_cycles to port_actual_values;
    add cpu_program_counter to port_actual_values;
    add cpu_stack_pointer to port_actual_values;
    add cpu_status to port_actual_values;
    add cpu_a to port_actual_values;
    add cpu_x to port_actual_values;
    add cpu_y to port_actual_values;
    add cpu_sequence_error to port_actual_values;
    log_count = length cpu_access_log;

    repeat log_count {
        add to_number(cpu_access_log[log_index]) to port_actual_values;
        log_index++;
    }
}

# Compares the produced values with the recorded expectations and keeps the first failure.
proc compare_vector_results suite_id, case_id, expected_start, expected_count {
    local index = 0;
    local mismatches = 0;
    local actual = 0;
    local expected = 0;
    local produced_count = length port_actual_values;
    port_vectors_run++;

    repeat $expected_count {
        actual = to_number(port_actual_values[index + 1]);
        expected = to_number(shared_port_vectors[$expected_start + index]);

        if actual != expected {
            mismatches++;

            if port_first_failure == "" {
                port_first_failure = "suite " & $suite_id & " case " & $case_id;
                port_first_failure = port_first_failure & " value " & index;
                port_first_failure = port_first_failure & " expected " & expected & " got " & actual;
            }
        }

        index++;
    }

    if produced_count != $expected_count {
        mismatches++;

        if port_first_failure == "" {
            port_first_failure = "suite " & $suite_id & " case " & $case_id;
            port_first_failure = port_first_failure & " produced " & produced_count & " values";
            port_first_failure = port_first_failure & ", expected " & $expected_count;
        }
    }

    if mismatches == 0 {
        port_vectors_passed++;
    } else {
        port_vectors_failed++;
    }
}

# Replays one opcode decode vector: decode the opcode byte and report the six table fields
# together with the decoder's error code. Suite 12 has a single operation, so the handler takes
# only the input position, like the bus, controller, and cartridge handlers.
proc run_cpu_opcode_vector input_start {
    local opcode = to_number(shared_port_vectors[$input_start]);
    cpu_decode_opcode opcode;
    add cpu_opcode_mnemonic to port_actual_values;
    add cpu_opcode_mode to port_actual_values;
    add cpu_opcode_base_cycles to port_actual_values;
    add cpu_opcode_access to port_actual_values;
    add cpu_opcode_page_cross_cycle to port_actual_values;
    add cpu_opcode_official to port_actual_values;
    add cpu_opcode_error to port_actual_values;
}

# Replays one executed instruction: write the setup pairs and the program bytes, run one
# instruction through the ported dispatcher, and report the eight fixed values followed by one
# (kind, address, value) triple per bus access.
proc run_cpu_instruction_vector input_start {
    local program_counter = to_number(shared_port_vectors[$input_start]);
    local program_count = to_number(shared_port_vectors[$input_start + 6]);
    local setup_count = to_number(shared_port_vectors[$input_start + 7]);
    local program_start = $input_start + 8;
    local setup_start = program_start + program_count;
    local program_index = 0;
    local setup_index = 0;
    local setup_address = 0;
    local setup_value = 0;
    local log_index = 1;
    local log_count = 0;
    cpu_reset_registers;
    cpu_bus_clear_ram;
    cpu_bus_reset;
    cpu_program_counter = program_counter;
    cpu_a = to_number(shared_port_vectors[$input_start + 1]);
    cpu_x = to_number(shared_port_vectors[$input_start + 2]);
    cpu_y = to_number(shared_port_vectors[$input_start + 3]);
    cpu_stack_pointer = to_number(shared_port_vectors[$input_start + 4]);
    cpu_status = to_number(shared_port_vectors[$input_start + 5]);
    cpu_jammed = 0;

    repeat setup_count {
        setup_address = to_number(shared_port_vectors[setup_start + (setup_index * 2)]);
        setup_value = to_number(shared_port_vectors[setup_start + 1 + (setup_index * 2)]);
        cpu_bus_write setup_address, setup_value;
        setup_index++;
    }

    repeat program_count {
        setup_address = program_counter + program_index;
        setup_value = to_number(shared_port_vectors[program_start + program_index]);
        cpu_bus_write setup_address, setup_value;
        program_index++;
    }

    cpu_reset_cycle_accounting;
    cpu_execute_instruction;
    add cpu_cycles to port_actual_values;
    add cpu_program_counter to port_actual_values;
    add cpu_stack_pointer to port_actual_values;
    add cpu_status to port_actual_values;
    add cpu_a to port_actual_values;
    add cpu_x to port_actual_values;
    add cpu_y to port_actual_values;
    add cpu_instruction_error to port_actual_values;
    log_count = length cpu_access_log;

    repeat log_count {
        add to_number(cpu_access_log[log_index]) to port_actual_values;
        log_index++;
    }
}

# Replays one control-loop record: write the setup pairs and the program bytes, seed the interrupt
# inputs, run the steps the record asks for through the ported control loop, and report the eight
# fixed values, one sequence kind per step, and one (kind, address, value) triple per bus access.
proc run_cpu_control_vector input_start {
    local program_counter = to_number(shared_port_vectors[$input_start]);
    local step_count = to_number(shared_port_vectors[$input_start + 8]);
    local nmi_request_step = to_number(shared_port_vectors[$input_start + 9]);
    local irq_assert_step = to_number(shared_port_vectors[$input_start + 10]);
    local program_count = to_number(shared_port_vectors[$input_start + 11]);
    local setup_count = to_number(shared_port_vectors[$input_start + 12]);
    local program_start = $input_start + 13;
    local setup_start = program_start + program_count;
    local program_index = 0;
    local setup_index = 0;
    local setup_address = 0;
    local setup_value = 0;
    local log_index = 1;
    local log_count = 0;
    local kind_index = 1;
    local step = 1;
    cpu_reset_registers;
    cpu_bus_clear_ram;
    cpu_bus_reset;
    cpu_program_counter = program_counter;
    cpu_a = to_number(shared_port_vectors[$input_start + 1]);
    cpu_x = to_number(shared_port_vectors[$input_start + 2]);
    cpu_y = to_number(shared_port_vectors[$input_start + 3]);
    cpu_stack_pointer = to_number(shared_port_vectors[$input_start + 4]);
    cpu_status = to_number(shared_port_vectors[$input_start + 5]);
    cpu_clear_interrupt_state;
    cpu_set_irq_line to_number(shared_port_vectors[$input_start + 7]);
    delete port_sequence_kinds;

    if to_number(shared_port_vectors[$input_start + 6]) == 1 {
        cpu_request_nmi;
    }

    repeat setup_count {
        setup_address = to_number(shared_port_vectors[setup_start + (setup_index * 2)]);
        setup_value = to_number(shared_port_vectors[setup_start + 1 + (setup_index * 2)]);
        cpu_bus_write setup_address, setup_value;
        setup_index++;
    }

    repeat program_count {
        setup_address = program_counter + program_index;
        setup_value = to_number(shared_port_vectors[program_start + program_index]);
        cpu_bus_write setup_address, setup_value;
        program_index++;
    }

    cpu_reset_cycle_accounting;

    repeat step_count {
        if step == nmi_request_step {
            cpu_request_nmi;
        }

        if step == irq_assert_step {
            cpu_set_irq_line 1;
        }

        cpu_begin_next_sequence;
        add cpu_selected_sequence to port_sequence_kinds;
        step++;
    }

    add cpu_cycles to port_actual_values;
    add cpu_program_counter to port_actual_values;
    add cpu_stack_pointer to port_actual_values;
    add cpu_status to port_actual_values;
    add cpu_a to port_actual_values;
    add cpu_x to port_actual_values;
    add cpu_y to port_actual_values;
    add cpu_instruction_error to port_actual_values;

    repeat step_count {
        add to_number(port_sequence_kinds[kind_index]) to port_actual_values;
        kind_index++;
    }

    log_count = length cpu_access_log;

    repeat log_count {
        add to_number(cpu_access_log[log_index]) to port_actual_values;
        log_index++;
    }
}

# Suite 15: one board validation. Inputs are the declared image length and the sixteen header
# bytes, so the record parses the header first and then validates it as an NROM board, exactly as
# a loader would. Expected values are ok, the error code, the board kind, the PRG RAM bytes the
# board would map, the CHR RAM bytes it would map, and the selection kind and error underneath.
proc run_nrom_vector input_start {
    local index = 0;
    cartridge_image_bytes = to_number(shared_port_vectors[$input_start]);

    repeat cartridge_limit.header_bytes {
        cartridge_header[index + 1] = to_number(shared_port_vectors[$input_start + index + 1]);
        index++;
    }

    cartridge_parse_header;
    nrom_validate;
    add nrom_ok to port_actual_values;
    add nrom_error_code to port_actual_values;
    add nrom_kind to port_actual_values;
    add nrom_prg_ram_bytes to port_actual_values;
    add nrom_chr_ram_bytes to port_actual_values;
    add mapper_selection_kind to port_actual_values;
    add mapper_selection_error_code to port_actual_values;
}

# Suite 16: one board's address windows. Inputs are the declared image length, the sixteen header
# bytes, the PRG ROM and CHR ROM prepare counts, the operation count, then the prepared
# (index, value) pairs for each ROM region and the (kind, address, value) operations, where kind 1
# reads the CPU window, 2 writes it, 3 reads the pattern table, and 4 writes it. Expected values
# are ok, the error code, the mapped PRG RAM and CHR RAM bytes, then three values per operation:
# whether the board took it, the byte a read returned, and the bits a CPU read drove.
proc run_nrom_memory_vector input_start {
    local prg_count = to_number(shared_port_vectors[$input_start + 17]);
    local chr_count = to_number(shared_port_vectors[$input_start + 18]);
    local op_count = to_number(shared_port_vectors[$input_start + 19]);
    local prg_start = $input_start + 20;
    local chr_start = prg_start + (prg_count * 2);
    local op_start = chr_start + (chr_count * 2);
    local index = 0;
    local prepare_index = 0;
    local op_kind = 0;
    local op_address = 0;
    local op_value = 0;
    cartridge_image_bytes = to_number(shared_port_vectors[$input_start]);

    repeat cartridge_limit.header_bytes {
        cartridge_header[index + 1] = to_number(shared_port_vectors[$input_start + index + 1]);
        index++;
    }

    cartridge_parse_header;
    nrom_validate;
    add nrom_ok to port_actual_values;
    add nrom_error_code to port_actual_values;
    add nrom_prg_ram_bytes to port_actual_values;
    add nrom_chr_ram_bytes to port_actual_values;
    nrom_reset_memory;
    index = 0;

    repeat prg_count {
        prepare_index = to_number(shared_port_vectors[prg_start + (index * 2)]) + 1;
        nrom_prg_rom[prepare_index] = to_number(shared_port_vectors[prg_start + 1 + (index * 2)]);
        index++;
    }

    index = 0;

    repeat chr_count {
        prepare_index = to_number(shared_port_vectors[chr_start + (index * 2)]) + 1;
        nrom_chr_rom[prepare_index] = to_number(shared_port_vectors[chr_start + 1 + (index * 2)]);
        index++;
    }

    index = 0;

    repeat op_count {
        op_kind = to_number(shared_port_vectors[op_start + (index * 3)]);
        op_address = to_number(shared_port_vectors[op_start + 1 + (index * 3)]);
        op_value = to_number(shared_port_vectors[op_start + 2 + (index * 3)]);

        if op_kind == nrom_memory_op.cpu_read {
            nrom_read_cpu op_address;
            add nrom_cpu_mapped to port_actual_values;
            add nrom_cpu_value to port_actual_values;
            add nrom_cpu_driven_mask to port_actual_values;
        } elif op_kind == nrom_memory_op.cpu_write {
            nrom_write_cpu op_address, op_value;
            add nrom_cpu_write_accepted to port_actual_values;
            add 0 to port_actual_values;
            add 0 to port_actual_values;
        } elif op_kind == nrom_memory_op.pattern_read {
            nrom_read_pattern op_address;
            add 1 to port_actual_values;
            add nrom_pattern_value to port_actual_values;
            add 0 to port_actual_values;
        } elif op_kind == nrom_memory_op.pattern_write {
            nrom_write_pattern op_address, op_value;
            add nrom_pattern_write_accepted to port_actual_values;
            add 0 to port_actual_values;
            add 0 to port_actual_values;
        } else {
            # No record carries another kind; report an operation the board did not take.
            add 0 to port_actual_values;
            add 0 to port_actual_values;
            add 0 to port_actual_values;
        }

        index++;
    }
}

# Suite 17: the ported CPU bus with a board attached. Inputs are the declared image length, the
# sixteen header bytes, the attach flag, the PRG ROM prepare count, the operation count, then the
# prepared (index, value) PRG ROM pairs and the (kind, address, value) operations, where kind 1
# writes the bus and any other kind reads it, as in suite 3. Expected values are whether a board is
# attached and the board error code, then two values per operation: the byte the bus returned and
# the open-bus latch it left behind, read back through $2000, an address no ported device drives.
proc run_cartridge_bus_vector input_start {
    local attach_board = to_number(shared_port_vectors[$input_start + 17]);
    local prg_count = to_number(shared_port_vectors[$input_start + 18]);
    local op_count = to_number(shared_port_vectors[$input_start + 19]);
    local prg_start = $input_start + 20;
    local op_start = prg_start + (prg_count * 2);
    local index = 0;
    local prepare_index = 0;
    local op_kind = 0;
    local op_address = 0;
    local op_value = 0;
    local attached = 0;
    cartridge_image_bytes = to_number(shared_port_vectors[$input_start]);

    repeat cartridge_limit.header_bytes {
        cartridge_header[index + 1] = to_number(shared_port_vectors[$input_start + index + 1]);
        index++;
    }

    cartridge_parse_header;
    nrom_validate;
    cpu_bus_clear_ram;
    cpu_bus_reset;
    cpu_bus_cartridge_kind = mapper_kind.none;

    if nrom_ok == 1 and attach_board == 1 {
        attached = 1;
        nrom_reset_memory;
        index = 0;

        repeat prg_count {
            prepare_index = to_number(shared_port_vectors[prg_start + (index * 2)]) + 1;
            nrom_prg_rom[prepare_index] = to_number(shared_port_vectors[prg_start + 1 + (index * 2)]);
            index++;
        }

        cpu_bus_cartridge_kind = mapper_kind.nrom;
    }

    add attached to port_actual_values;
    add nrom_error_code to port_actual_values;
    index = 0;

    repeat op_count {
        op_kind = to_number(shared_port_vectors[op_start + (index * 3)]);
        op_address = to_number(shared_port_vectors[op_start + 1 + (index * 3)]);
        op_value = to_number(shared_port_vectors[op_start + 2 + (index * 3)]);

        if op_kind == 1 {
            cpu_bus_write op_address, op_value;
            add 0 to port_actual_values;
        } else {
            add cpu_bus_read(op_address) to port_actual_values;
        }

        add cpu_bus_read(8192) to port_actual_values;
        index++;
    }
}
