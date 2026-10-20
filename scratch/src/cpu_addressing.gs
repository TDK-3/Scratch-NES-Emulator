# Addressing-mode resolution for the GoboScript port.
#
# Mirrors resolve_addressing_mode_cycles() in src/nes/cpu/cpu_2a03.ts for all thirteen
# official modes, including the dummy reads, the page-crossing extra cycle, and the JMP
# indirect pointer wrap inside one page. Each mode performs the same bus accesses in the same
# order as the reference and spends one cycle per access through src/cpu_core.gs.
#
# The reference reports an illegal mode/access combination by throwing; a Scratch project must
# not stop, so the port records `cpu_resolved_error` and leaves the operand kind at none. The
# unstable high-byte store variant (which drops the data mask on a tagged dummy read) is not
# ported yet, so no caller can request it.

%include src/cpu_core

enum cpu_addressing_mode {
    implied = 1,
    accumulator = 2,
    immediate = 3,
    relative = 4,
    zero_page = 5,
    zero_page_x = 6,
    zero_page_y = 7,
    absolute = 8,
    absolute_x = 9,
    absolute_y = 10,
    indirect = 11,
    indexed_indirect = 12,
    indirect_indexed = 13
}

enum cpu_operand_access {
    read = 1,
    write = 2,
    read_modify_write = 3
}

enum cpu_operand_kind {
    none = 0,
    implied = 1,
    accumulator = 2,
    immediate = 3,
    relative = 4,
    memory = 5,
    jump_target = 6
}

enum cpu_operand_error_code {
    none = 0,
    unsupported_access = 1,
    unknown_mode = 2
}

var cpu_resolved_kind = 0;
var cpu_resolved_mode = 0;
var cpu_resolved_access = 0;
var cpu_resolved_base_address = 0;
var cpu_resolved_address = 0;
var cpu_resolved_value = 0;
var cpu_resolved_page_crossed = 0;
var cpu_resolved_error = 0;

# Reports whether two addresses sit in different pages; mirrors page_crossed().
func cpu_page_crossed(base_address, address) {
    # Two divisions instead of two byte_high calls: the high byte is all the decision needs.
    if ($base_address % 65536) // 256 == ($address % 65536) // 256 {
        return 0;
    }

    return 1;
}

# Builds the dummy address an indexed access uses: the base page and the effective low byte.
# Mirrors indexed_dummy_address().
func cpu_indexed_dummy_address(base_address, address) {
    return (((($base_address % 65536) // 256) * 256) + ($address % 256)) % 65536;
}

# Clears every operand global so a rejected or unknown mode stays a deterministic zero record.
proc cpu_reset_operand {
    cpu_resolved_kind = cpu_operand_kind.none;
    cpu_resolved_mode = 0;
    cpu_resolved_access = 0;
    cpu_resolved_base_address = 0;
    cpu_resolved_address = 0;
    cpu_resolved_value = 0;
    cpu_resolved_page_crossed = 0;
    cpu_resolved_error = cpu_operand_error_code.none;
}

# Records a memory operand; the mode and access are already stored by the caller.
proc cpu_set_memory_operand base_address, address, page_crossed {
    cpu_resolved_kind = cpu_operand_kind.memory;
    cpu_resolved_base_address = $base_address % 65536;
    cpu_resolved_address = $address % 65536;
    cpu_resolved_page_crossed = $page_crossed;
}

# Resolves one addressing mode. Mirrors the reference switch, including which accesses spend
# a cycle and which address each dummy read uses.
#
# The branches are ordered by how often a running game reaches them, not by enum order: an
# if / elif chain is a sequence of comparisons, and immediate, zero-page, indexed-absolute,
# and relative operands cover most of the instructions a game executes. The dummy-read and
# cycle rules inside each branch are unchanged.
proc cpu_resolve_operand mode, access {
    local numeric_mode = $mode + ""; # to_number inlined
    local numeric_access = $access + ""; # to_number inlined
    local base_address = 0;
    local address = 0;
    local index_register = 0;
    local crossed = 0;
    local pointer_address = 0;
    local pointer_high_address = 0;
    local target_low = 0;
    local target_high = 0;
    local offset = 0;
    local dummy_address = 0;

    # The operand record is cleared here instead of in a cpu_reset_operand call: mode and
    # access are overwritten on the next two lines anyway, so only the six fields a branch may
    # leave alone are zeroed, and the rejected-mode branches below still see a deterministic
    # record. The mode and access of a rejected resolve are stored as asked, as before.
    cpu_resolved_kind = cpu_operand_kind.none;
    cpu_resolved_base_address = 0;
    cpu_resolved_address = 0;
    cpu_resolved_value = 0;
    cpu_resolved_page_crossed = 0;
    cpu_resolved_error = cpu_operand_error_code.none;
    cpu_resolved_mode = numeric_mode;
    cpu_resolved_access = numeric_access;

    if numeric_mode == cpu_addressing_mode.immediate {
        if numeric_access != cpu_operand_access.read {
            cpu_resolved_error = cpu_operand_error_code.unsupported_access;
        } else {
            cpu_resolved_kind = cpu_operand_kind.immediate;
            cpu_fetch_byte;
            cpu_resolved_value = cpu_fetched_byte;
        }
    } elif numeric_mode == cpu_addressing_mode.zero_page {
        cpu_fetch_byte;
        base_address = cpu_fetched_byte;
        cpu_resolved_kind = cpu_operand_kind.memory;
        cpu_resolved_base_address = base_address;
        cpu_resolved_address = base_address;
        cpu_resolved_page_crossed = 0;
    } elif (numeric_mode == cpu_addressing_mode.absolute_x) or (numeric_mode == cpu_addressing_mode.absolute_y) {
        cpu_fetch_word;
        base_address = cpu_fetched_word;

        if numeric_mode == cpu_addressing_mode.absolute_x {
            index_register = cpu_x;
        } else {
            index_register = cpu_y;
        }

        address = (base_address + index_register) % 65536;

        # cpu_page_crossed inlined: the high byte is all the decision needs, and both operands
        # are already 16-bit words, so the two normalizations it used to pay are dead.
        if (base_address // 256) == (address // 256) {
            crossed = 0;
        } else {
            crossed = 1;
        }

        if (numeric_access != cpu_operand_access.read) or (crossed == 1) {
            # cpu_indexed_dummy_address inlined and the dummy-read wrapper dropped: the address
            # is already a word, so it needs no modulo either.
            dummy_address = ((base_address // 256) * 256) + (address % 256);
            cpu_read_cycle dummy_address;
        }

        cpu_resolved_kind = cpu_operand_kind.memory;
        cpu_resolved_base_address = base_address;
        cpu_resolved_address = address;
        cpu_resolved_page_crossed = crossed;
    } elif numeric_mode == cpu_addressing_mode.relative {
        if numeric_access != cpu_operand_access.read {
            cpu_resolved_error = cpu_operand_error_code.unsupported_access;
        } else {
            cpu_fetch_byte;
            offset = to_signed_byte(cpu_fetched_byte);
            base_address = cpu_program_counter;
            address = (base_address + offset) % 65536;
            cpu_resolved_kind = cpu_operand_kind.relative;
            cpu_resolved_value = offset;
            cpu_resolved_base_address = base_address;
            cpu_resolved_address = address;

            if (base_address // 256) == (address // 256) {
                cpu_resolved_page_crossed = 0;
            } else {
                cpu_resolved_page_crossed = 1;
            }
        }
    } elif numeric_mode == cpu_addressing_mode.absolute {
        cpu_fetch_word;
        address = cpu_fetched_word;
        cpu_resolved_kind = cpu_operand_kind.memory;
        cpu_resolved_base_address = address;
        cpu_resolved_address = address;
        cpu_resolved_page_crossed = 0;
    } elif numeric_mode == cpu_addressing_mode.indirect_indexed {
        cpu_fetch_byte;
        pointer_address = cpu_fetched_byte;
        cpu_read_cycle pointer_address;
        target_low = cpu_cycle_value;
        pointer_high_address = (pointer_address + 1) % 256;
        cpu_read_cycle pointer_high_address;
        target_high = cpu_cycle_value;
        base_address = ((target_high % 256) * 256) + (target_low % 256);
        address = (base_address + cpu_y) % 65536;

        if (base_address // 256) == (address // 256) {
            crossed = 0;
        } else {
            crossed = 1;
        }

        if (numeric_access != cpu_operand_access.read) or (crossed == 1) {
            dummy_address = ((base_address // 256) * 256) + (address % 256);
            cpu_read_cycle dummy_address;
        }

        cpu_resolved_kind = cpu_operand_kind.memory;
        cpu_resolved_base_address = base_address;
        cpu_resolved_address = address;
        cpu_resolved_page_crossed = crossed;
    } elif numeric_mode == cpu_addressing_mode.implied {
        if numeric_access != cpu_operand_access.read {
            cpu_resolved_error = cpu_operand_error_code.unsupported_access;
        } else {
            cpu_resolved_kind = cpu_operand_kind.implied;
        }
    } elif (numeric_mode == cpu_addressing_mode.zero_page_x) or (numeric_mode == cpu_addressing_mode.zero_page_y) {
        cpu_fetch_byte;
        base_address = cpu_fetched_byte;

        # The index registers are bytes by construction, so they are read directly.
        if numeric_mode == cpu_addressing_mode.zero_page_x {
            index_register = cpu_x;
        } else {
            index_register = cpu_y;
        }

        cpu_read_cycle base_address;
        address = (base_address + index_register) % 256;
        cpu_resolved_kind = cpu_operand_kind.memory;
        cpu_resolved_base_address = base_address;
        cpu_resolved_address = address;
        cpu_resolved_page_crossed = 0;
    } elif numeric_mode == cpu_addressing_mode.accumulator {
        if numeric_access == cpu_operand_access.write {
            cpu_resolved_error = cpu_operand_error_code.unsupported_access;
        } else {
            cpu_resolved_kind = cpu_operand_kind.accumulator;
        }
    } elif numeric_mode == cpu_addressing_mode.indirect {
        if numeric_access != cpu_operand_access.read {
            cpu_resolved_error = cpu_operand_error_code.unsupported_access;
        } else {
            cpu_fetch_word;
            pointer_address = cpu_fetched_word;
            pointer_high_address = (pointer_address - (pointer_address % 256)) + ((pointer_address + 1) % 256);
            cpu_read_cycle pointer_address;
            target_low = cpu_cycle_value;
            cpu_read_cycle pointer_high_address;
            target_high = cpu_cycle_value;
            cpu_resolved_kind = cpu_operand_kind.jump_target;
            cpu_resolved_base_address = pointer_address;
            cpu_resolved_address = ((target_high % 256) * 256) + (target_low % 256);
        }
    } elif numeric_mode == cpu_addressing_mode.indexed_indirect {
        cpu_fetch_byte;
        base_address = cpu_fetched_byte;
        cpu_read_cycle base_address;
        pointer_address = (base_address + cpu_x) % 256;
        cpu_read_cycle pointer_address;
        target_low = cpu_cycle_value;
        pointer_high_address = (pointer_address + 1) % 256;
        cpu_read_cycle pointer_high_address;
        target_high = cpu_cycle_value;
        cpu_resolved_kind = cpu_operand_kind.memory;
        cpu_resolved_base_address = base_address;
        cpu_resolved_address = ((target_high % 256) * 256) + (target_low % 256);
        cpu_resolved_page_crossed = 0;
    } else {
        cpu_resolved_error = cpu_operand_error_code.unknown_mode;
    }
}
