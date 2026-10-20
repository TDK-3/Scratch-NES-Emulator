# MMC3 board for the GoboScript port: scratch/src/mapper_004.gs
#
# This mirrors src/nes/cartridge/mapper_004.ts: the creation checks, the eight banking registers with
# the masks bank execute applies to each of them, the PRG and CHR bank selection both modes use, the
# PRG RAM enable and write-protect bits, the mirroring register with its four-screen override, the CPU
# and pattern address windows, the four IRQ registers, and the PPU A12 observation with the ten-dot
# low filter that decides when a rising edge clocks the IRQ counter.
#
# The declared nonvolatile memory is ported as well, as the tail of each RAM region: a snapshot
# copies it out and a restore copies it back only when the buffer holds exactly the declared size. A
# restore leaves the banking registers, the protection bits, and the IRQ state alone, because the
# reference restores memory without changing any register. With that, everything Mmc3Mapper does is
# ported.
#
# Scratch has no bitwise operators, so this header uses the numeric helpers the other modules use:
# bitwise_and for masks, bit_at for one bit, and floor division for a bank index. The register an
# address selects is bitwise_and(address, $E001), exactly as the reference switches on it.

%include src/numeric
%include src/cartridge
%include src/mapper
# mmc3_load_payload reads the Stage-owned generated cartridge list, so this header is included by the
# Stage, as src/rom_loader.gs and src/mapper_000.gs are.
%include src/rom_loader

enum mmc3_limit {
    prg_bank_bytes = 8192,
    min_prg_rom_bytes = 32768,
    chr_bank_bytes = 1024,
    min_chr_memory_bytes = 8192,
    prg_ram_bytes = 8192,
    pattern_bytes = 8192,
    pattern_space_bytes = 16384,
    trainer_bytes = 512,
    trainer_prg_ram_offset = 4096,
    prg_ram_start = 24576,
    prg_rom_start = 32768,
    prg_rom_offset_mask = 8191,
    chr_offset_mask = 1023,
    full_byte_mask = 255,
    ppu_address_space_bytes = 16384,
    a12_weight = 4096,
    a12_filter_dots = 10
}

# The register an address selects, as bitwise_and(address, $E001) reports it.
enum mmc3_register {
    bank_select = 32768,
    bank_data = 32769,
    mirroring = 40960,
    prg_ram_protect = 40961,
    irq_latch = 49152,
    irq_reload = 49153,
    irq_disable = 57344,
    irq_enable = 57345
}

# The operations a shared-vector record can ask this board to perform. The first four are the ones
# src/mapper_000.gs uses, the fifth reports the mirroring mode the board would give the PPU, and the
# last three drive the IRQ path: a PPU bus access, one PPU dot, and a report of the IRQ line.
enum mmc3_op {
    cpu_read = 1,
    cpu_write = 2,
    pattern_read = 3,
    pattern_write = 4,
    report_mirroring = 5,
    observe_ppu_access = 6,
    clock_ppu_dot = 7,
    report_irq = 8,
    get_prg_nvram = 9,
    load_prg_nvram = 10,
    get_chr_nvram = 11,
    load_chr_nvram = 12,
    read_prg_nvram_byte = 13,
    read_chr_nvram_byte = 14
}

# The PPU bus operations a mapper can observe. The reference's MapperPpuBusAccess carries a kind and
# a region beside the address, and Mmc3Mapper looks at the address alone, so a record names one of
# these to pin that all four clock A12 the same way. The region is a function of the address the bus
# already normalized, which is why it is not a separate field here.
enum mmc3_ppu_access {
    read_pattern = 1,
    write_pattern = 2,
    read_nametable = 3,
    write_nametable = 4
}

var mmc3_ok = 0;
var mmc3_error_code = 0;
var mmc3_kind = 0;
var mmc3_prg_rom_bytes = 0;
var mmc3_chr_rom_bytes = 0;
var mmc3_prg_ram_bytes = 0;
var mmc3_chr_ram_bytes = 0;
var mmc3_prg_nvram_bytes = 0;
var mmc3_chr_nvram_bytes = 0;
var mmc3_prg_bank_count = 0;
var mmc3_chr_bank_count = 0;
var mmc3_last_prg_bank = 0;
var mmc3_second_last_prg_bank = 0;
var mmc3_four_screen = 0;
var mmc3_header_mirroring = 1;
var mmc3_mirroring = 1;
var mmc3_bank_select = 0;
var mmc3_prg_mode = 0;
var mmc3_chr_mode = 0;
var mmc3_prg_ram_enabled = 1;
var mmc3_prg_ram_write_protected = 0;
var mmc3_irq_latch = 0;
var mmc3_irq_counter = 0;
var mmc3_irq_reload_pending = 0;
var mmc3_irq_enabled = 0;
var mmc3_irq_line_asserted = 0;
var mmc3_ppu_a12_high = 0;
var mmc3_a12_low_dots = 0;

# The board's memory, sized the way src/mapper_000.gs sizes an NROM board's: both ROM lists hold the
# declared payload, and both RAM regions hold their full window while the mapped size drives the
# aliasing. A shared-vector record names only the ROM bytes it cares about and leaves the rest zero.
list mmc3_prg_rom;
list mmc3_chr_rom;
list mmc3_prg_ram = [0; 8192];
list mmc3_chr_ram = [0; 8192];
list mmc3_bank_registers = [0; 8];

# Cached CHR banks per PPU slot (0-7 -> CHR bank index), refreshed on bank/mode writes so
# pattern reads avoid 6-branch decode and func call per PPU dot (~30k reads/frame).
list mmc3_chr_bank_cache = [0; 8];

# The board's nonvolatile memory, copied out by a snapshot and copied back by a restore. The
# reference slices the tail of each RAM region, so the bank registers decide which part of CHR RAM a
# pattern address reaches but never which bytes belong to the snapshot: the tail is measured against
# the whole declared region. A board that declares no NVRAM has an empty buffer.
list mmc3_prg_nvram_snapshot;
list mmc3_chr_nvram_snapshot;

# The last CPU read: whether the address was mapped, the byte, and the bits the board drives.
var mmc3_cpu_mapped = 0;
var mmc3_cpu_value = 0;
var mmc3_cpu_driven_mask = 0;

# Whether the last CPU write landed in PRG RAM. A bank register write reports zero here, because its
# effect shows up in the reads that follow it rather than in the write itself.
var mmc3_cpu_write_accepted = 0;

# Whether the last observed PPU address was inside the 14-bit space the reference accepts. An address
# outside it raises a range error there; the port reports the refusal instead, as it does everywhere
# else, and leaves the A12 state and the IRQ counter untouched.
var mmc3_ppu_observed = 0;

# Whether the last restore was accepted. The reference raises a range error for a snapshot whose
# length is not exactly the declared NVRAM size; the port reports the refusal instead and copies
# nothing, so a mismatched save state cannot half-restore a board.
var mmc3_nvram_loaded = 0;

# The last pattern byte read, and whether the last pattern write landed in CHR RAM.
var mmc3_pattern_value = 0;
var mmc3_pattern_write_accepted = 0;

# Refreshes the CHR bank cache from current registers/modes. 8 func calls per register write is
# trivial (writes are ~10/frame) vs 30k decode branches saved per frame.
proc mmc3_refresh_chr_cache {
    local slot = 0;

    repeat 8 {
        mmc3_chr_bank_cache[slot + 1] = mmc3_chr_bank(slot);
        slot++;
    }
}

# Puts the registers and the IRQ state back to what Mmc3Mapper.reset() leaves, without touching the
# board's memory: a reset keeps RAM and CHR RAM contents.
proc mmc3_reset {
    local index = 1;
    mmc3_mirroring = mmc3_header_mirroring;
    mmc3_bank_select = 0;
    mmc3_prg_mode = 0;
    mmc3_chr_mode = 0;
    mmc3_prg_ram_enabled = 1;
    mmc3_prg_ram_write_protected = 0;
    mmc3_irq_latch = 0;
    mmc3_irq_counter = 0;
    mmc3_irq_reload_pending = 0;
    mmc3_irq_enabled = 0;
    mmc3_irq_line_asserted = 0;
    mmc3_ppu_a12_high = 0;
    mmc3_a12_low_dots = 0;

    repeat 8 {
        mmc3_bank_registers[index] = 0;
        index++;
    }

    mmc3_refresh_chr_cache;
}

# Validates a parsed header as an MMC3 board, in the order Mmc3Mapper.create checks it: the mapper
# and submapper pair, the board family, PRG ROM in whole 8 KiB banks of at least 32 KiB, at most
# 8 KiB of summed PRG RAM and NVRAM, a trainer that needs PRG RAM, and one CHR region of at least
# 8 KiB in whole 1 KiB banks that is not CHR ROM with CHR RAM declared beside it.
proc mmc3_validate {
    local prg_ram_total = 0;
    local chr_ram_total = 0;
    local chr_memory_bytes = 0;
    mmc3_ok = 0;
    mmc3_error_code = mapper_error.none;
    mmc3_kind = mapper_kind.none;
    mmc3_prg_rom_bytes = 0;
    mmc3_chr_rom_bytes = 0;
    mmc3_prg_ram_bytes = 0;
    mmc3_chr_ram_bytes = 0;
    mmc3_prg_nvram_bytes = 0;
    mmc3_chr_nvram_bytes = 0;
    mmc3_prg_bank_count = 0;
    mmc3_chr_bank_count = 0;
    mmc3_four_screen = 0;
    mmc3_header_mirroring = cartridge_mirroring;
    mmc3_mirroring = cartridge_mirroring;
    mapper_resolve cartridge_mapper_id, cartridge_submapper;

    if mapper_selection_error_code != mapper_selection_error.none {
        mmc3_error_code = mapper_selection_error_code;
    } elif mapper_selection_kind != mapper_kind.mmc3 {
        mmc3_error_code = mapper_error.wrong_mapper_family;
    } else {
        mmc3_prg_rom_bytes = cartridge_prg_rom_bytes;
        mmc3_chr_rom_bytes = cartridge_chr_rom_bytes;
        mmc3_prg_nvram_bytes = cartridge_prg_nvram_bytes;
        mmc3_chr_nvram_bytes = cartridge_chr_nvram_bytes;
        prg_ram_total = mapper_sum_memory_sizes(cartridge_prg_ram_bytes, cartridge_prg_nvram_bytes);
        chr_ram_total = mapper_sum_memory_sizes(cartridge_chr_ram_bytes, cartridge_chr_nvram_bytes);

        if mmc3_prg_rom_bytes < mmc3_limit.min_prg_rom_bytes {
            mmc3_error_code = mapper_error.unsupported_prg_rom_size;
        } elif mmc3_prg_rom_bytes % mmc3_limit.prg_bank_bytes != 0 {
            mmc3_error_code = mapper_error.unsupported_prg_rom_size;
        } elif prg_ram_total < 0 or prg_ram_total > mmc3_limit.prg_ram_bytes {
            mmc3_error_code = mapper_error.unsupported_prg_ram_size;
        } elif cartridge_has_trainer == 1 and prg_ram_total == 0 {
            mmc3_error_code = mapper_error.unsupported_trainer;
        } elif chr_ram_total < 0 {
            mmc3_error_code = mapper_error.unsupported_chr_memory;
        } else {
            if mmc3_chr_rom_bytes > 0 {
                chr_memory_bytes = mmc3_chr_rom_bytes;
            } else {
                chr_memory_bytes = chr_ram_total;
            }

            if chr_memory_bytes < mmc3_limit.min_chr_memory_bytes {
                mmc3_error_code = mapper_error.unsupported_chr_memory;
            } elif chr_memory_bytes % mmc3_limit.chr_bank_bytes != 0 {
                mmc3_error_code = mapper_error.unsupported_chr_memory;
            } elif mmc3_chr_rom_bytes > 0 and chr_ram_total != 0 {
                mmc3_error_code = mapper_error.unsupported_chr_memory;
            } else {
                mmc3_ok = 1;
                mmc3_kind = mapper_kind.mmc3;
                mmc3_prg_ram_bytes = prg_ram_total;
                mmc3_chr_ram_bytes = 0;

                if mmc3_chr_rom_bytes == 0 {
                    mmc3_chr_ram_bytes = chr_ram_total;
                }

                mmc3_prg_bank_count = mmc3_prg_rom_bytes // mmc3_limit.prg_bank_bytes;
                mmc3_chr_bank_count = (mmc3_chr_rom_bytes + mmc3_chr_ram_bytes) // mmc3_limit.chr_bank_bytes;
                mmc3_last_prg_bank = mmc3_prg_bank_count - 1;
                mmc3_second_last_prg_bank = mmc3_prg_bank_count - 2;
                mmc3_four_screen = 0;

                if mmc3_header_mirroring == 3 {
                    mmc3_four_screen = 1;
                }

                mmc3_reset;
            }
        }
    }
}

# Puts every memory region back to the zeroes a freshly constructed board holds. The two ROM
# lists are only emptied here: mmc3_copy_prg_rom and mmc3_copy_chr_rom size them by appending the
# payload, so filling them with zeroes first would write every ROM byte twice.
proc mmc3_reset_memory {
    local index = 1;
    delete mmc3_prg_rom;
    delete mmc3_chr_rom;

    repeat mmc3_limit.prg_ram_bytes {
        mmc3_prg_ram[index] = 0;
        index++;
    }

    index = 1;

    repeat mmc3_limit.pattern_bytes {
        mmc3_chr_ram[index] = 0;
        index++;
    }
}

# Copies PRG ROM out of the generated cartridge list at the parsed payload offset.
proc mmc3_copy_prg_rom {
    local index = 0;

    # Appending the real bytes sizes the list as it fills it: the reset's zero fill and this
    # loop used to write every ROM byte twice.
    delete mmc3_prg_rom;

    repeat mmc3_prg_rom_bytes {
        add to_number(cartridge_bytes[cartridge_prg_rom_offset + index + 1]) to mmc3_prg_rom;
        index++;
    }
}

# Copies CHR ROM out of the generated cartridge list at the parsed payload offset.
proc mmc3_copy_chr_rom {
    local index = 0;

    delete mmc3_chr_rom;

    repeat mmc3_chr_rom_bytes {
        add to_number(cartridge_bytes[cartridge_chr_rom_offset + index + 1]) to mmc3_chr_rom;
        index++;
    }
}

# Copies the trainer into PRG RAM at offset $1000, modulo the mapped size, where the reference's
# constructor puts it. A board the validation accepted always has PRG RAM when it has a trainer.
proc mmc3_copy_trainer {
    local index = 0;
    local ram_index = 0;

    if cartridge_has_trainer == 1 and mmc3_prg_ram_bytes > 0 {
        repeat mmc3_limit.trainer_bytes {
            ram_index = ((mmc3_limit.trainer_prg_ram_offset + index) % mmc3_prg_ram_bytes) + 1;
            mmc3_prg_ram[ram_index] = to_number(cartridge_bytes[cartridge_trainer_offset + index + 1]);
            index++;
        }
    }
}

# Fills the board from the generated cartridge list. Runs after mmc3_validate accepted the header,
# because the sizes it computed drive the copy and the windows.
proc mmc3_load_payload {
    mmc3_reset_memory;
    mmc3_copy_prg_rom;
    mmc3_copy_chr_rom;
    mmc3_copy_trainer;

    # Loading a fresh cartridge must not inherit bank, mirroring, or IRQ state from the previous run.
    # The reset changes control state only; it leaves the payload and trainer memory intact.
    mmc3_reset;
}

# The PRG bank one CPU slot selects. Slots are $8000, $A000, $C000, and $E000, and the two slots the
# registers do not control always hold the last and second-to-last banks, which is what makes an MMC3
# image boot: the reset vector lives in the last bank.
func mmc3_prg_bank(slot) {
    local last_bank = mmc3_last_prg_bank;
    local second_last_bank = mmc3_second_last_prg_bank;
    local bank6 = mmc3_bank_registers[7];
    local bank7 = mmc3_bank_registers[8];
    local bank = 0;

    if mmc3_prg_mode == 0 {
        if $slot == 0 {
            bank = bank6;
        } elif $slot == 1 {
            bank = bank7;
        } elif $slot == 2 {
            bank = second_last_bank;
        } else {
            bank = last_bank;
        }
    } else {
        if $slot == 0 {
            bank = second_last_bank;
        } elif $slot == 1 {
            bank = bank7;
        } elif $slot == 2 {
            bank = bank6;
        } else {
            bank = last_bank;
        }
    }

    return bank % mmc3_prg_bank_count;
}

# The CHR bank one pattern slot selects. Mode 0 puts the two 2 KiB paired registers in the first two
# slots and the four 1 KiB registers in the last four; mode 1 swaps the two groups. A paired register
# selects its own bank and the one after it, which is why bank execute forces those two even.
func mmc3_chr_bank(slot) {
    local register0 = mmc3_bank_registers[1];
    local register1 = mmc3_bank_registers[2];
    local bank = 0;

    if mmc3_chr_mode == 0 {
        if $slot == 0 {
            bank = register0;
        } elif $slot == 1 {
            bank = register0 + 1;
        } elif $slot == 2 {
            bank = register1;
        } elif $slot == 3 {
            bank = register1 + 1;
        } else {
            bank = mmc3_bank_registers[$slot - 1];
        }
    } else {
        if $slot < 4 {
            bank = mmc3_bank_registers[$slot + 3];
        } elif $slot == 4 {
            bank = register0;
        } elif $slot == 5 {
            bank = register0 + 1;
        } elif $slot == 6 {
            bank = register1;
        } else {
            bank = register1 + 1;
        }
    }

    return bank % mmc3_chr_bank_count;
}

# Writes one mapper register. Bank select takes the register index and the two mode bits, bank data
# stores the value with the mask that register requires, mirroring takes the low bit unless the header
# declared four-screen, PRG RAM protect takes the enable and write-protect bits, IRQ latch takes the
# count the next clock loads, IRQ reload empties the counter and asks the next clock to load it, IRQ
# disable turns the counter off and acknowledges the line, and IRQ enable turns the counter on.
proc mmc3_write_register address, value {
    # The register mask $E001 keeps bits 15-13 and bit 0 of the address, which is the same as
    # "the $2000-aligned group plus the low bit": one division, one multiply, one add, and no
    # 65,536-entry word path through the bitwise helper. $8000-$FFFF is already a word here.
    local register_id = (($address // 8192) * 8192) + ($address % 2);
    local bank_value = $value % 256;

    if register_id == mmc3_register.bank_select {
        mmc3_bank_select = bank_value % 8;
        mmc3_prg_mode = (bank_value // 64) % 2;
        mmc3_chr_mode = (bank_value // 128) % 2;
        mmc3_refresh_chr_cache;
    } elif register_id == mmc3_register.bank_data {
        # $FE, $3F, and $7F clear one bit or the top two; on a byte that is a subtraction of
        # the remainder, which is two reporters where the bitwise helper was a call.
        if mmc3_bank_select == 0 or mmc3_bank_select == 1 {
            bank_value = bank_value - (bank_value % 2);
        } elif mmc3_bank_select == 6 {
            bank_value = bank_value - (bank_value % 64);
        } elif mmc3_bank_select == 7 {
            bank_value = bank_value - (bank_value % 128);
        }

        mmc3_bank_registers[mmc3_bank_select + 1] = bank_value;
        mmc3_refresh_chr_cache;
    } elif register_id == mmc3_register.mirroring {
        if mmc3_four_screen == 0 {
            # The mirroring ids are the cartridge parser's: 1 horizontal, 2 vertical, 3 four-screen.
            # A zero low bit selects vertical, as the reference's write does.
            if bank_value % 2 == 0 {
                mmc3_mirroring = 2;
            } else {
                mmc3_mirroring = 1;
            }
        }
    } elif register_id == mmc3_register.prg_ram_protect {
        mmc3_prg_ram_enabled = (bank_value // 128) % 2;
        mmc3_prg_ram_write_protected = (bank_value // 64) % 2;
    } elif register_id == mmc3_register.irq_latch {
        mmc3_irq_latch = bank_value;
    } elif register_id == mmc3_register.irq_reload {
        # A reload does not load the latch itself: it empties the counter and makes the next clock
        # take the latch, which is why the reference keeps a pending flag beside the counter.
        mmc3_irq_counter = 0;
        mmc3_irq_reload_pending = 1;
    } elif register_id == mmc3_register.irq_disable {
        mmc3_irq_enabled = 0;
        mmc3_irq_line_asserted = 0;
    } elif register_id == mmc3_register.irq_enable {
        mmc3_irq_enabled = 1;
    }
}

# Reads one CPU address and reports whether it was mapped, the byte, and the driven bits. $8000-$FFFF
# is the selected PRG bank, and $6000-$7FFF is PRG RAM when the board has any and the protect register
# still enables it. Anything else is unmapped, which the reference reports as a null read.
proc mmc3_read_cpu address {
    local numeric_address = $address % 65536;
    local slot = 0;
    local offset = 0;
    mmc3_cpu_mapped = 0;
    mmc3_cpu_value = 0;
    mmc3_cpu_driven_mask = 0;

    if numeric_address >= mmc3_limit.prg_rom_start {
        # Inlined mmc3_prg_bank to save 1 func call per PRG read (~23k/frame). Same logic as func.
        local last_bank = mmc3_last_prg_bank;
        local second_last_bank = mmc3_second_last_prg_bank;
        local prg_bank = 0;
        slot = (numeric_address - mmc3_limit.prg_rom_start) // mmc3_limit.prg_bank_bytes;

        if mmc3_prg_mode == 0 {
            if slot == 0 {
                prg_bank = mmc3_bank_registers[7];
            } elif slot == 1 {
                prg_bank = mmc3_bank_registers[8];
            } elif slot == 2 {
                prg_bank = second_last_bank;
            } else {
                prg_bank = last_bank;
            }
        } else {
            if slot == 0 {
                prg_bank = second_last_bank;
            } elif slot == 1 {
                prg_bank = mmc3_bank_registers[8];
            } elif slot == 2 {
                prg_bank = mmc3_bank_registers[7];
            } else {
                prg_bank = last_bank;
            }
        }

        # The slot is already the bank-aligned quotient, so the offset inside the bank is the
        # address minus the window start minus the slot's own span: one multiply and two
        # subtractions replace a second modulo on every PRG ROM read.
        offset = ((prg_bank % mmc3_prg_bank_count) * mmc3_limit.prg_bank_bytes)
            + (numeric_address - mmc3_limit.prg_rom_start - (slot * mmc3_limit.prg_bank_bytes));
        mmc3_cpu_mapped = 1;
        mmc3_cpu_value = mmc3_prg_rom[offset + 1];
        mmc3_cpu_driven_mask = mmc3_limit.full_byte_mask;
    } elif numeric_address >= mmc3_limit.prg_ram_start and mmc3_prg_ram_enabled == 1 {
        if mmc3_prg_ram_bytes > 0 {
            offset = (numeric_address - mmc3_limit.prg_ram_start) % mmc3_prg_ram_bytes;
            mmc3_cpu_mapped = 1;
            mmc3_cpu_value = mmc3_prg_ram[offset + 1];
            mmc3_cpu_driven_mask = mmc3_limit.full_byte_mask;
        }
    }
}

# Writes one CPU address. PRG RAM takes the write when it is enabled, not write protected, and present;
# $8000 and above is a mapper register write; the rest is dropped.
proc mmc3_write_cpu address, value {
    local numeric_address = normalize_word($address);
    local offset = 0;
    mmc3_cpu_write_accepted = 0;

    if numeric_address >= mmc3_limit.prg_ram_start and numeric_address < mmc3_limit.prg_rom_start {
        if mmc3_prg_ram_enabled == 1 and mmc3_prg_ram_write_protected == 0 and mmc3_prg_ram_bytes > 0 {
            offset = (numeric_address - mmc3_limit.prg_ram_start) % mmc3_prg_ram_bytes;
            mmc3_prg_ram[offset + 1] = normalize_byte($value);
            mmc3_cpu_write_accepted = 1;
        }
    } elif numeric_address >= mmc3_limit.prg_rom_start {
        mmc3_write_register numeric_address, $value;
    }
}

# Reads one pattern-table byte from the CHR bank its slot selects, out of CHR ROM when the board has
# it and out of CHR RAM otherwise. Uses the cache built on register writes to avoid per-dot decode.
proc mmc3_read_pattern address {
    # The PPU bus has already folded the address into the 16 KiB pattern space, and 16384
    # divides 65536, so the two-step mask is one modulo. The offset inside the 1 KiB CHR bank
    # is the address minus the slot's own span rather than a second modulo.
    local numeric_address = $address % mmc3_limit.pattern_space_bytes;
    local slot = numeric_address // mmc3_limit.chr_bank_bytes;
    local chr_bank = mmc3_chr_bank_cache[slot + 1];
    local offset = (chr_bank * mmc3_limit.chr_bank_bytes)
        + (numeric_address - (slot * mmc3_limit.chr_bank_bytes));
    mmc3_pattern_value = 0;

    if mmc3_chr_rom_bytes > 0 {
        mmc3_pattern_value = mmc3_chr_rom[offset + 1];
    } elif mmc3_chr_ram_bytes > 0 {
        mmc3_pattern_value = mmc3_chr_ram[offset + 1];
    }
}

# Writes one pattern-table byte. A CHR ROM board drops the write, as the reference does.
proc mmc3_write_pattern address, value {
    local numeric_address = $address % mmc3_limit.pattern_space_bytes;
    local slot = numeric_address // mmc3_limit.chr_bank_bytes;
    local chr_bank = mmc3_chr_bank_cache[slot + 1];
    local offset = (chr_bank * mmc3_limit.chr_bank_bytes)
        + (numeric_address - (slot * mmc3_limit.chr_bank_bytes));
    mmc3_pattern_write_accepted = 0;

    if mmc3_chr_ram_bytes > 0 {
        mmc3_chr_ram[offset + 1] = normalize_byte($value);
        mmc3_pattern_write_accepted = 1;
    }
}

# Observes one PPU memory access. The reference takes a MapperPpuBusAccess carrying a kind, an
# address, and a region, and reads the address alone, so the access kind changes nothing here either.
proc mmc3_observe_ppu_access access_kind, address {
    mmc3_observe_ppu_a12 $address;
}

# Observes an address the CPU placed on the PPU bus through PPUADDR, with no memory access behind it.
proc mmc3_observe_ppu_address address {
    mmc3_observe_ppu_a12 $address;
}

# Advances the board's PPU timing by one dot. The low-dot count only grows while A12 is low and has
# not reached the filter yet, so it saturates instead of running away across a long low stretch.
proc mmc3_clock_ppu_dot {
    if mmc3_ppu_a12_high == 0 and mmc3_a12_low_dots < mmc3_limit.a12_filter_dots {
        mmc3_a12_low_dots++;
    }
}

# The IRQ line the CPU samples at the start of an instruction. Mirrors get_irq_line_asserted().
func mmc3_get_irq_line_asserted() {
    return mmc3_irq_line_asserted;
}

# Watches one PPU address for the A12 rising edge that clocks the IRQ counter. An address outside the
# 14-bit space is refused and changes nothing. An address whose A12 matches the last observed one is
# ignored, so the two pattern fetches inside one tile clock nothing. A rising edge clocks the counter
# only when A12 has been low for at least ten dots, which is the filter that keeps a background-only
# frame from firing the IRQ; either edge clears the low-dot count.
proc mmc3_observe_ppu_a12 address {
    # A12 ($1000) is the 4096s bit of the address, so its state is one division instead of a
    # bit_at call, and the reference's Number.isInteger test is the floor comparison below,
    # which is checked before the division uses the value.
    local next_high = 0;
    mmc3_ppu_observed = 0;

    if $address >= 0 and $address < mmc3_limit.ppu_address_space_bytes
        and $address == $address // 1 {
        next_high = ($address // mmc3_limit.a12_weight) % 2;
        mmc3_ppu_observed = 1;

        if next_high != mmc3_ppu_a12_high {
            if next_high == 1 and mmc3_a12_low_dots >= mmc3_limit.a12_filter_dots {
                mmc3_clock_irq_counter;
            }

            mmc3_ppu_a12_high = next_high;
            mmc3_a12_low_dots = 0;
        }
    }
}

# Clocks the IRQ counter one step: a counter at zero or a pending reload takes the latch value, any
# other counter counts down by one, the reload stops being pending, and a counter that reaches zero
# while the IRQ is enabled asserts the line. The line then stays asserted until a write to $E000
# acknowledges it, which is what lets a scanline IRQ hold across the handler's own code.
proc mmc3_clock_irq_counter {
    if mmc3_irq_counter == 0 or mmc3_irq_reload_pending == 1 {
        mmc3_irq_counter = mmc3_irq_latch;
    } else {
        mmc3_irq_counter = mmc3_irq_counter - 1;
    }

    mmc3_irq_reload_pending = 0;

    if mmc3_irq_counter == 0 and mmc3_irq_enabled == 1 {
        mmc3_irq_line_asserted = 1;
    }
}

# Copies the declared nonvolatile tail of PRG RAM into the snapshot buffer, leaving the volatile part
# of the same window out, exactly as get_prg_nvram_snapshot slices it. The PRG RAM window is not
# banked, so the tail is the same bytes whichever PRG mode and bank registers are set.
proc mmc3_get_prg_nvram_snapshot {
    local start = mmc3_prg_ram_bytes - mmc3_prg_nvram_bytes;
    local index = 0;
    delete mmc3_prg_nvram_snapshot;

    repeat mmc3_prg_nvram_bytes {
        add to_number(mmc3_prg_ram[start + index + 1]) to mmc3_prg_nvram_snapshot;
        index++;
    }
}

# Restores the nonvolatile tail of PRG RAM from the snapshot buffer. Neither the enable bit nor the
# write-protect bit is consulted, because the reference restores declared nonvolatile memory without
# changing any register, and the banking registers and the IRQ state are left alone too.
proc mmc3_load_prg_nvram_snapshot {
    local start = mmc3_prg_ram_bytes - mmc3_prg_nvram_bytes;
    local index = 0;
    mmc3_nvram_loaded = 0;

    if length(mmc3_prg_nvram_snapshot) == mmc3_prg_nvram_bytes {
        mmc3_nvram_loaded = 1;

        repeat mmc3_prg_nvram_bytes {
            mmc3_prg_ram[start + index + 1] = to_number(mmc3_prg_nvram_snapshot[index + 1]);
            index++;
        }
    }
}

# Copies the declared nonvolatile tail of CHR RAM into the snapshot buffer. A CHR ROM board declares
# no CHR NVRAM, because the validation rejects CHR ROM beside declared CHR RAM, so its buffer is
# empty and its CHR ROM is never touched.
proc mmc3_get_chr_nvram_snapshot {
    local start = mmc3_chr_ram_bytes - mmc3_chr_nvram_bytes;
    local index = 0;
    delete mmc3_chr_nvram_snapshot;

    repeat mmc3_chr_nvram_bytes {
        add to_number(mmc3_chr_ram[start + index + 1]) to mmc3_chr_nvram_snapshot;
        index++;
    }
}

# Restores the nonvolatile tail of CHR RAM from the snapshot buffer, without modifying CHR ROM, the
# volatile part of CHR RAM, or the bank registers that decide which of them a pattern address sees.
proc mmc3_load_chr_nvram_snapshot {
    local start = mmc3_chr_ram_bytes - mmc3_chr_nvram_bytes;
    local index = 0;
    mmc3_nvram_loaded = 0;

    if length(mmc3_chr_nvram_snapshot) == mmc3_chr_nvram_bytes {
        mmc3_nvram_loaded = 1;

        repeat mmc3_chr_nvram_bytes {
            mmc3_chr_ram[start + index + 1] = to_number(mmc3_chr_nvram_snapshot[index + 1]);
            index++;
        }
    }
}
