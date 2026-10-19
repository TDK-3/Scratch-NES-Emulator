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
    cpu_cycle_value = cpu_bus_read(numeric_address);

    if cpu_access_log_enabled == 1 {
        add cpu_access_kind.read to cpu_access_log;
        add numeric_address to cpu_access_log;
        add cpu_cycle_value to cpu_access_log;
    }

    cpu_cycles++;
}

# One write cycle: logs the access, spends one cycle, and writes through the bus decoder.
proc cpu_write_cycle address, value {
    local numeric_address = $address % 65536;
    local numeric_value = $value % 256;
    cpu_bus_write numeric_address, numeric_value;

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
    cpu_program_counter = (address + 1) % 65536;
}

# Reads a little-endian word at the program counter into `cpu_fetched_word`, mirroring
# fetch_word_cycle(). Both bytes are already in the byte range, so the word is assembled
# with two operators instead of a join_bytes call.
proc cpu_fetch_word {
    local low_byte = 0;
    cpu_fetch_byte;
    low_byte = cpu_fetched_byte % 256;
    cpu_fetch_byte;
    cpu_fetched_word = ((cpu_fetched_byte % 256) * 256) + low_byte;
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
    cpu_push_byte word // 256;
    cpu_push_byte word % 256;
}

# Pops a word low byte first, mirroring pop_word_cycle(); the word is left in
# `cpu_popped_word`.
proc cpu_pop_word {
    local low_byte = 0;
    cpu_pop_byte;
    low_byte = cpu_popped_byte % 256;
    cpu_pop_byte;
    cpu_popped_word = ((cpu_popped_byte % 256) * 256) + low_byte;
}

# Pushes the status byte, mirroring push_status_cycle(); `break_enabled` is 1 only for BRK,
# because a hardware interrupt pushes the break bit clear.
proc cpu_push_status break_enabled {
    cpu_status = normalize_status(cpu_status);
    cpu_push_byte pack_status_for_stack(cpu_status, $break_enabled);
}

# Restores the status byte from a popped stack byte, clearing BREAK and keeping UNUSED set.
proc cpu_restore_status_from_stack value {
    cpu_status = unpack_status_from_stack(normalize_byte($value));
}
