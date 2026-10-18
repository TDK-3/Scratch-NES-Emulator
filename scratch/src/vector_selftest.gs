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
%include src/cartridge
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
    cartridge = 9
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

    if schema_version != 1 {
        port_self_test_summary = "unsupported shared vector schema " & schema_version;
    } else {
        repeat record_count {
            run_next_port_vector;
        }

        port_self_test_summary = "port vectors " & port_vectors_passed & "/" & port_vectors_run;
        port_self_test_summary = port_self_test_summary & " passed, " & port_vectors_skipped & " skipped";
        port_self_test_summary = port_self_test_summary & ", rom header " & rom_header_state_text;
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
