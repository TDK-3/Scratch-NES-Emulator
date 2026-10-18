# MMC3 board for the GoboScript port: scratch/src/mapper_004.gs
#
# This mirrors src/nes/cartridge/mapper_004.ts: the creation checks, the eight banking registers with
# the masks bank execute applies to each of them, the PRG and CHR bank selection both modes use, the
# PRG RAM enable and write-protect bits, the mirroring register with its four-screen override, and the
# CPU and pattern address windows.
#
# What is not ported yet: the IRQ latch, counter, reload, enable, and acknowledge registers, the PPU
# A12 observation with its ten-dot low filter, and the NVRAM snapshots. A write to $C000, $C001,
# $E000, or $E001 is therefore accepted and ignored, and the IRQ line stays low.
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
    full_byte_mask = 255
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

# The memory operations a shared-vector record can ask this board to perform. The first four are the
# ones src/mapper_000.gs uses, and the fifth reports the mirroring mode the board would give the PPU.
enum mmc3_op {
    cpu_read = 1,
    cpu_write = 2,
    pattern_read = 3,
    pattern_write = 4,
    report_mirroring = 5
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

# The last CPU read: whether the address was mapped, the byte, and the bits the board drives.
var mmc3_cpu_mapped = 0;
var mmc3_cpu_value = 0;
var mmc3_cpu_driven_mask = 0;

# Whether the last CPU write landed in PRG RAM. A bank register write reports zero here, because its
# effect shows up in the reads that follow it rather than in the write itself.
var mmc3_cpu_write_accepted = 0;

# The last pattern byte read, and whether the last pattern write landed in CHR RAM.
var mmc3_pattern_value = 0;
var mmc3_pattern_write_accepted = 0;

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
                mmc3_four_screen = 0;

                if mmc3_header_mirroring == 3 {
                    mmc3_four_screen = 1;
                }

                mmc3_reset;
            }
        }
    }
}

# Puts every memory region back to the zeroes a freshly constructed board holds, sizing both ROM
# lists to the declared payload so the copies and the vector records can replace items inside them.
proc mmc3_reset_memory {
    local index = 1;
    delete mmc3_prg_rom;
    delete mmc3_chr_rom;

    repeat mmc3_prg_rom_bytes {
        add 0 to mmc3_prg_rom;
    }

    repeat mmc3_chr_rom_bytes {
        add 0 to mmc3_chr_rom;
    }

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

    repeat mmc3_prg_rom_bytes {
        mmc3_prg_rom[index + 1] = to_number(cartridge_bytes[cartridge_prg_rom_offset + index + 1]);
        index++;
    }
}

# Copies CHR ROM out of the generated cartridge list at the parsed payload offset.
proc mmc3_copy_chr_rom {
    local index = 0;

    repeat mmc3_chr_rom_bytes {
        mmc3_chr_rom[index + 1] = to_number(cartridge_bytes[cartridge_chr_rom_offset + index + 1]);
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
}

# The PRG bank one CPU slot selects. Slots are $8000, $A000, $C000, and $E000, and the two slots the
# registers do not control always hold the last and second-to-last banks, which is what makes an MMC3
# image boot: the reset vector lives in the last bank.
func mmc3_prg_bank(slot) {
    local last_bank = mmc3_prg_bank_count - 1;
    local second_last_bank = mmc3_prg_bank_count - 2;
    local bank6 = to_number(mmc3_bank_registers[7]);
    local bank7 = to_number(mmc3_bank_registers[8]);
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
    local register0 = to_number(mmc3_bank_registers[1]);
    local register1 = to_number(mmc3_bank_registers[2]);
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
            bank = to_number(mmc3_bank_registers[$slot - 1]);
        }
    } else {
        if $slot < 4 {
            bank = to_number(mmc3_bank_registers[$slot + 3]);
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
# declared four-screen, and PRG RAM protect takes the enable and write-protect bits. The four IRQ
# registers are not ported yet, so a write to them is accepted and ignored.
proc mmc3_write_register address, value {
    local register_id = bitwise_and(normalize_word($address), 57345);
    local bank_value = normalize_byte($value);

    if register_id == mmc3_register.bank_select {
        mmc3_bank_select = bitwise_and(bank_value, 7);
        mmc3_prg_mode = bit_at(bank_value, 64);
        mmc3_chr_mode = bit_at(bank_value, 128);
    } elif register_id == mmc3_register.bank_data {
        if mmc3_bank_select == 0 or mmc3_bank_select == 1 {
            bank_value = bitwise_and(bank_value, 254);
        } elif mmc3_bank_select == 6 {
            bank_value = bitwise_and(bank_value, 63);
        } elif mmc3_bank_select == 7 {
            bank_value = bitwise_and(bank_value, 127);
        }

        mmc3_bank_registers[mmc3_bank_select + 1] = bank_value;
    } elif register_id == mmc3_register.mirroring {
        if mmc3_four_screen == 0 {
            # The mirroring ids are the cartridge parser's: 1 horizontal, 2 vertical, 3 four-screen.
            # A zero low bit selects vertical, as the reference's write does.
            if bitwise_and(bank_value, 1) == 0 {
                mmc3_mirroring = 2;
            } else {
                mmc3_mirroring = 1;
            }
        }
    } elif register_id == mmc3_register.prg_ram_protect {
        mmc3_prg_ram_enabled = bit_at(bank_value, 128);
        mmc3_prg_ram_write_protected = bit_at(bank_value, 64);
    }
}

# Reads one CPU address and reports whether it was mapped, the byte, and the driven bits. $8000-$FFFF
# is the selected PRG bank, and $6000-$7FFF is PRG RAM when the board has any and the protect register
# still enables it. Anything else is unmapped, which the reference reports as a null read.
proc mmc3_read_cpu address {
    local numeric_address = normalize_word($address);
    local slot = 0;
    local offset = 0;
    mmc3_cpu_mapped = 0;
    mmc3_cpu_value = 0;
    mmc3_cpu_driven_mask = 0;

    if numeric_address >= mmc3_limit.prg_rom_start {
        slot = (numeric_address - mmc3_limit.prg_rom_start) // mmc3_limit.prg_bank_bytes;
        offset = (mmc3_prg_bank(slot) * mmc3_limit.prg_bank_bytes) + bitwise_and(numeric_address, 8191);
        mmc3_cpu_mapped = 1;
        mmc3_cpu_value = to_number(mmc3_prg_rom[offset + 1]);
        mmc3_cpu_driven_mask = mmc3_limit.full_byte_mask;
    } elif numeric_address >= mmc3_limit.prg_ram_start and mmc3_prg_ram_enabled == 1 {
        if mmc3_prg_ram_bytes > 0 {
            offset = (numeric_address - mmc3_limit.prg_ram_start) % mmc3_prg_ram_bytes;
            mmc3_cpu_mapped = 1;
            mmc3_cpu_value = to_number(mmc3_prg_ram[offset + 1]);
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
# it and out of CHR RAM otherwise.
proc mmc3_read_pattern address {
    local numeric_address = normalize_word($address) % mmc3_limit.pattern_space_bytes;
    local slot = numeric_address // mmc3_limit.chr_bank_bytes;
    local offset = (mmc3_chr_bank(slot) * mmc3_limit.chr_bank_bytes) + bitwise_and(numeric_address, 1023);
    mmc3_pattern_value = 0;

    if mmc3_chr_rom_bytes > 0 {
        mmc3_pattern_value = to_number(mmc3_chr_rom[offset + 1]);
    } elif mmc3_chr_ram_bytes > 0 {
        mmc3_pattern_value = to_number(mmc3_chr_ram[offset + 1]);
    }
}

# Writes one pattern-table byte. A CHR ROM board drops the write, as the reference does.
proc mmc3_write_pattern address, value {
    local numeric_address = normalize_word($address) % mmc3_limit.pattern_space_bytes;
    local slot = numeric_address // mmc3_limit.chr_bank_bytes;
    local offset = (mmc3_chr_bank(slot) * mmc3_limit.chr_bank_bytes) + bitwise_and(numeric_address, 1023);
    mmc3_pattern_write_accepted = 0;

    if mmc3_chr_ram_bytes > 0 {
        mmc3_chr_ram[offset + 1] = normalize_byte($value);
        mmc3_pattern_write_accepted = 1;
    }
}
