# 2A03 register state, bus cycles, and stack operations for the GoboScript port.
#
# Mirrors the cycle-visible parts of src/nes/cpu/cpu_2a03.ts that do not depend on opcode
# decoding: the six architectural registers, one bus transaction per cycle, the ordered
# access trace, program-counter fetches, and the four stack operations. Instruction fetch,
# decode, and dispatch are not ported yet.
#
# Execution model, deliberately simpler than the TypeScript reference: the reference suspends
# each instruction with a generator so `clock_cycle()` exposes one bus transaction at a time.
# Scratch has no coroutines, so this port performs the same accesses in the same order and
# adds the same cycle count without suspending between them. That is exact for CPU-visible
# state and for the access order, and it is an approximation only for a device that would
# interleave with an instruction mid-flight (today that is DMC DMA, which is not ported).
# When the PPU is ported it will advance by each instruction's cycle count at instruction
# boundaries; revisit this note with measurements before claiming cycle-level interleaving.
#
# Every bus access appends kind, address, and value to `cpu_access_log` and adds one cycle to
# `cpu_cycles`, so a vector can pin both the transaction order and the cycle count. The log is
# written only while `cpu_access_log_enabled` is set: the reference takes an optional trace
# sink, and the console runs the CPU without one.

%include src/numeric
%include src/cpu_status
%include src/cpu_bus

enum cpu_access_kind {
    read = 0,
    write = 1
}

enum cpu_stack_page {
    base = 256
}

enum cpu_vector_address {
    nmi_low = 65530,
    nmi_high = 65531,
    reset_low = 65532,
    reset_high = 65533,
    irq_brk_low = 65534,
    irq_brk_high = 65535
}

var cpu_program_counter = 0;
var cpu_a = 0;
var cpu_x = 0;
var cpu_y = 0;
var cpu_stack_pointer = 0;
var cpu_status = cpu_flag.unused;
var cpu_cycles = 0;
var cpu_cycle_value = 0;
var cpu_fetched_byte = 0;
var cpu_fetched_word = 0;
var cpu_popped_byte = 0;
var cpu_popped_word = 0;

# Whether the bus accesses are logged. The reference takes an optional trace sink and the
# console runs the CPU without one, so the port keeps the log off while a game runs and
# turns it on for the shared-vector replay, which compares the access order.
var cpu_access_log_enabled = 1;

list cpu_access_log;

# Clears the trace and cycle counter without touching registers or bus state.
proc cpu_reset_cycle_accounting {
    cpu_cycles = 0;
    delete cpu_access_log;
}

# Sets the power-on register state of Cpu2A03: A, X, Y, and SP zero and status holding only
# the unused flag. Reset sequencing (seven bus accesses and the reset vector) is not ported.
proc cpu_reset_registers {
    cpu_a = 0;
    cpu_x = 0;
    cpu_y = 0;
    cpu_stack_pointer = 0;
    cpu_program_counter = 0;
    cpu_status = cpu_flag.unused;
    cpu_reset_cycle_accounting;
}

# One read cycle: logs the access, spends one cycle, and leaves the driven byte in
# `cpu_cycle_value`. Every cycle-spending helper here is a proc, not a func, so a bus access
# is never nested inside another call's arguments: GoboScript lowers an expression-position
# func call to a statement placed before the enclosing statement, which would move the access
# in the trace. Callers read the result from the documented global on the next line.
proc cpu_read_cycle address {
    local numeric_address = $address % 65536;
    local bus_value = 0;

    # Fast windows. Two windows carry almost every access a game makes: 2 KiB of RAM and the
    # cartidge window's PRG ROM. Both are decoded here instead of in a cpu_bus_read call,
    # which saves a custom-block call and a second address normalization per cycle; both
    # devices drive the full byte, so the open-bus merge is one assignment. Every other
    # address, including the PPU, I/O, and the mirror range of RAM, falls through to the bus
    # decoder, which owns the reference-complete behavior and the cycle parity of the access.
    if numeric_address < 8192 {
        cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;

        if numeric_address < 2048 {
            bus_value = cpu_ram[numeric_address + 1];
        } else {
            bus_value = cpu_ram[(numeric_address % 2048) + 1];
        }

        cpu_open_bus = bus_value;
    } elif numeric_address >= 32768 {
        cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;
        bus_value = cpu_open_bus;

        if cpu_bus_cartridge_kind == mapper_kind.nrom {
            nrom_read_cpu numeric_address;

            if nrom_cpu_mapped == 1 {
                bus_value = nrom_cpu_value % 256;
                cpu_open_bus = bus_value;
            }
        } elif cpu_bus_cartridge_kind == mapper_kind.mmc3 {
            mmc3_read_cpu numeric_address;

            if mmc3_cpu_mapped == 1 {
                bus_value = mmc3_cpu_value % 256;
                cpu_open_bus = bus_value;
            }
        }
    } else {
        # $2000-$3FFF is the PPU's register window: the read must see the PPU at this cycle.
        if numeric_address >= 8192 and numeric_address < 16384 and cpu_bus_ppu_attached == 1 {
            ppu_sync_to_cycle cpu_cycles;
        }

        bus_value = cpu_bus_read(numeric_address);
    }

    cpu_cycle_value = bus_value;

    if cpu_access_log_enabled == 1 {
        add cpu_access_kind.read to cpu_access_log;
        add numeric_address to cpu_access_log;
        add bus_value to cpu_access_log;
    }

    cpu_cycles++;
}

# One write cycle: logs the access, spends one cycle, and writes through the bus decoder.
proc cpu_write_cycle address, value {
    local numeric_address = $address % 65536;
    local numeric_value = $value % 256;

    # The same two fast windows as the read path, decoded without a cpu_bus_write call. A
    # write leaves the byte on the open-bus latch before the device sees it, exactly as the
    # bus decoder does.
    if numeric_address < 8192 {
        cpu_open_bus = numeric_value;
        cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;

        if numeric_address < 2048 {
            cpu_ram[numeric_address + 1] = numeric_value;
        } else {
            cpu_ram[(numeric_address % 2048) + 1] = numeric_value;
        }
    } elif numeric_address >= 32768 {
        cpu_open_bus = numeric_value;
        cpu_bus_cycle_parity = 1 - cpu_bus_cycle_parity;

        # A mapper write can change what the PPU's A12 line observes on the next dot, so the
        # PPU is synced to this cycle first, the same way a register write is.
        if cpu_bus_ppu_attached == 1 {
            ppu_sync_to_cycle cpu_cycles;
        }

        if cpu_bus_cartridge_kind == mapper_kind.nrom {
            nrom_write_cpu numeric_address, numeric_value;
        } elif cpu_bus_cartridge_kind == mapper_kind.mmc3 {
            mmc3_write_cpu numeric_address, numeric_value;
        }
    } else {
        if numeric_address >= 8192 and numeric_address < 16384 and cpu_bus_ppu_attached == 1 {
            ppu_sync_to_cycle cpu_cycles;
        }

        cpu_bus_write numeric_address, numeric_value;
    }

    if cpu_access_log_enabled == 1 {
        add cpu_access_kind.write to cpu_access_log;
        add numeric_address to cpu_access_log;
        add numeric_value to cpu_access_log;
    }

    cpu_cycles++;
}

# Spends one cycle on a read whose byte the instruction does not use. The reference discards
# the value; the port leaves it in `cpu_cycle_value`.
proc cpu_dummy_read_cycle address {
    cpu_read_cycle $address;
}

# Reads the byte at the program counter, advances the counter, and leaves the byte in
# `cpu_fetched_byte`, mirroring fetch_byte_cycle(). The counter is normalized by every write
# to it, so it is already an address: the advance is one modulo instead of a normalize call,
# and the read cycle normalizes the address it logs.
proc cpu_fetch_byte {
    local address = cpu_program_counter;
    cpu_read_cycle address;
    cpu_fetched_byte = cpu_cycle_value;

    # The counter is always an address, so its increment wraps by comparison instead of by a
    # modulo: $FFFF is the only input that wraps.
    if address == 65535 {
        cpu_program_counter = 0;
    } else {
        cpu_program_counter = address + 1;
    }
}

# Reads a little-endian word at the program counter into `cpu_fetched_word`, mirroring
# fetch_word_cycle(). Both bytes are already in the byte range, so the word is assembled
# with two operators instead of a join_bytes call.
proc cpu_fetch_word {
    local low_byte = 0;
    local address = cpu_program_counter;
    cpu_read_cycle address;
    low_byte = cpu_cycle_value % 256;

    # Both counter increments wrap by comparison rather than by modulo, exactly as
    # cpu_fetch_byte does; only $FFFF can wrap.
    if address == 65535 {
        address = 0;
    } else {
        address = address + 1;
    }

    cpu_read_cycle address;
    cpu_fetched_byte = cpu_cycle_value;
    cpu_fetched_word = ((cpu_cycle_value % 256) * 256) + low_byte;

    if address == 65535 {
        cpu_program_counter = 0;
    } else {
        cpu_program_counter = address + 1;
    }
}

# Pushes one byte and decrements the stack pointer, mirroring push_byte_cycle(). Scratch's
# modulo is floored, so the wrap from $00 to $FF is one operator.
proc cpu_push_byte value {
    local stack_address = cpu_stack_page.base + cpu_stack_pointer;
    cpu_write_cycle stack_address, $value;
    cpu_stack_pointer = (cpu_stack_pointer - 1) % 256;
}

# Pops one byte and increments the stack pointer, mirroring pop_byte_cycle(); the byte is left
# in `cpu_popped_byte`.
proc cpu_pop_byte {
    local next_stack_pointer = (cpu_stack_pointer + 1) % 256;
    cpu_read_cycle cpu_stack_page.base + next_stack_pointer;
    cpu_stack_pointer = next_stack_pointer;
    cpu_popped_byte = cpu_cycle_value;
}

# Pushes a word high byte first, mirroring push_word_cycle(). The two bytes are split with
# operators rather than two byte_high/byte_low calls.
proc cpu_push_word value {
    local word = $value % 65536;
    local stack_address = cpu_stack_page.base + cpu_stack_pointer;

    # cpu_push_byte inlined twice: the high byte first, then the low byte, each one write cycle
    # and one stack-pointer decrement. Two custom-block calls per pushed word are gone, and the
    # access order the reference spends is unchanged.
    cpu_write_cycle stack_address, word // 256;
    cpu_stack_pointer = (cpu_stack_pointer - 1) % 256;
    stack_address = cpu_stack_page.base + cpu_stack_pointer;
    cpu_write_cycle stack_address, word % 256;
    cpu_stack_pointer = (cpu_stack_pointer - 1) % 256;
}

# Pops a word low byte first, mirroring pop_word_cycle(); the word is left in
# `cpu_popped_word`.
proc cpu_pop_word {
    local low_byte = 0;
    local next_stack_pointer = 0;
    local high_byte = 0;

    # cpu_pop_byte inlined twice: the low byte first, then the high byte, in the order the
    # reference spends the two read cycles.
    next_stack_pointer = (cpu_stack_pointer + 1) % 256;
    cpu_read_cycle cpu_stack_page.base + next_stack_pointer;
    cpu_stack_pointer = next_stack_pointer;
    low_byte = cpu_cycle_value % 256;
    next_stack_pointer = (cpu_stack_pointer + 1) % 256;
    cpu_read_cycle cpu_stack_page.base + next_stack_pointer;
    cpu_stack_pointer = next_stack_pointer;
    high_byte = cpu_cycle_value % 256;
    cpu_popped_word = (high_byte * 256) + low_byte;
}

# Pushes the status byte, mirroring push_status_cycle(); `break_enabled` is 1 only for BRK,
# because a hardware interrupt pushes the break bit clear.
proc cpu_push_status break_enabled {
    local byte = cpu_status % 256;

    # normalize_status and pack_status_for_stack inlined: the invariant is one expression, and
    # the break bit is added rather than OR-ed because normalize_status always leaves bit 4
    # clear, so the two sets of bits cannot overlap.
    cpu_status = (byte % 16) + 32 + ((byte // 64) * 64);
    cpu_push_byte cpu_status + (16 * $break_enabled);
}

# Restores the status byte from a popped stack byte, clearing BREAK and keeping UNUSED set.
proc cpu_restore_status_from_stack value {
    local byte = $value % 256;

    # unpack_status_from_stack(normalize_byte(value)) inlined: the two helpers were the same
    # expression with a call around each.
    cpu_status = (byte % 16) + 32 + ((byte // 64) * 64);
}
