# NROM board validation for the GoboScript port.
#
# This header mirrors the checks NromMapper.create makes in src/nes/cartridge/mapper_000.ts, in the
# same order, over the header the parser already decoded into the cartridge_* globals: the board
# has to be an exact mapper 0 submapper 0 route, its PRG ROM has to be 16 KiB or 32 KiB, its
# declared PRG RAM and NVRAM have to sum to a usable size of at most 8 KiB, a trainer needs PRG RAM
# at $7000-$71FF, and the pattern memory has to be exactly 8 KiB of CHR ROM with no CHR RAM, or up
# to 8 KiB of CHR RAM with no CHR ROM.
#
# The reference also rejects a trainer whose length is not 512 bytes. The parser only ever reports a
# 512-byte trainer, so that check cannot fail here and is not ported; a header that lies about its
# payload length is caught by the parse, which suite 9 covers.
#
# The memory and the address windows are ported too: PRG ROM at $8000-$FFFF modulo its size, so a
# 16 KiB board mirrors twice, PRG RAM at $6000-$7FFF modulo the mapped size, and the pattern table
# from CHR ROM when the board has it or from CHR RAM otherwise. A write only lands in RAM, and an
# address outside both windows is reported unmapped instead of stopping the project, where the
# reference returns a null read.
#
# The declared nonvolatile memory is ported too, as the tail of each RAM region: a snapshot copies it
# out and a restore copies it back only when the buffer holds exactly the declared size, which is the
# length the reference insists on before it restores anything.
#
# What is not ported yet: the PPU-side nametable mirroring consumer, and the MMC3 board. Nametable
# mirroring needs no mapper state, because NROM reports the mirroring the header declared.

%include src/cartridge
%include src/mapper
# nrom_load_payload reads the Stage-owned generated cartridge list, so this header is included by
# the Stage, as src/rom_loader.gs is. The window and validation procs only touch the board's own
# lists and globals.
%include src/rom_loader

enum nrom_limit {
    prg_ram_bytes = 8192,
    prg_rom_16k_bytes = 16384,
    prg_rom_32k_bytes = 32768,
    pattern_bytes = 8192
}

# The four memory operations a shared-vector record can ask a board to perform.
enum nrom_memory_op {
    cpu_read = 1,
    cpu_write = 2,
    pattern_read = 3,
    pattern_write = 4,
    get_prg_nvram = 5,
    load_prg_nvram = 6,
    get_chr_nvram = 7,
    load_chr_nvram = 8,
    read_prg_nvram_byte = 9,
    read_chr_nvram_byte = 10
}

enum nrom_window {
    prg_ram_start = 24576,
    prg_rom_start = 32768,
    trainer_bytes = 512,
    trainer_prg_ram_offset = 4096,
    full_byte_mask = 255
}

# The board's memory. Every region is sized to the bytes the board declares, so a Scratch replace
# always lands inside it: both ROM lists hold the declared PRG and CHR ROM sizes, and both RAM
# regions hold their full window. The mapped size the validation computed drives the aliasing,
# exactly as the reference's modulo does, so a 2 KiB PRG RAM board wraps inside the first 2 KiB of
# an 8 KiB list. A shared-vector record names only the ROM bytes it cares about and leaves the rest
# at the zero a freshly copied image holds.
list nrom_prg_rom;
list nrom_chr_rom;
list nrom_prg_ram = [0; 8192];
list nrom_chr_ram = [0; 8192];

# The board's nonvolatile memory, copied out by a snapshot and copied back by a restore. The
# reference slices the tail of each RAM region: the last declared NVRAM bytes of the mapped window,
# leaving the volatile part of the same region alone. These two lists are the port's serialization
# buffer, so a save path would fill them from stored data before a restore, the way the generated
# data lists fill the ROM. A board that declares no NVRAM has an empty buffer.
list nrom_prg_nvram_snapshot;
list nrom_chr_nvram_snapshot;

# The last CPU read: whether the address was mapped, the byte, and the bits the board drives.
var nrom_cpu_mapped = 0;
var nrom_cpu_value = 0;
var nrom_cpu_driven_mask = 0;

# Whether the last CPU write landed in PRG RAM.
var nrom_cpu_write_accepted = 0;

# The last pattern byte read, and whether the last pattern write landed in CHR RAM.
var nrom_pattern_value = 0;
var nrom_pattern_write_accepted = 0;

# Whether the last validation accepted the board.
var nrom_ok = 0;

# Why it did not, using mapper_error. Codes 1 and 2 are the selection codes, because a failed
# selection is reported unchanged.
var nrom_error_code = 0;

# The board family the accepted board belongs to, or none when validation failed.
var nrom_kind = 0;

# The PRG RAM and NVRAM bytes the board would map at $6000-$7FFF, zero when validation failed.
var nrom_prg_ram_bytes = 0;

# The CHR RAM bytes the board would map, zero when CHR ROM is present or validation failed.
var nrom_chr_ram_bytes = 0;

# Whether the last restore was accepted. The reference raises a range error for a snapshot whose
# length is not exactly the declared NVRAM size; the port reports the refusal instead and copies
# nothing, so a mismatched save state cannot half-restore a board.
var nrom_nvram_loaded = 0;

# Clears every result the validation reports.
proc nrom_reset_results {
    nrom_ok = 0;
    nrom_error_code = mapper_error.none;
    nrom_kind = mapper_kind.none;
    nrom_prg_ram_bytes = 0;
    nrom_chr_ram_bytes = 0;
}

# Validates the parsed header as an NROM board. Runs after cartridge_parse_header and reads its
# globals; a header the parser rejected carries zero sizes and reports an unsupported PRG ROM size.
proc nrom_validate {
    nrom_reset_results;
    mapper_resolve cartridge_mapper_id, cartridge_submapper;

    if mapper_selection_error_code != mapper_selection_error.none {
        nrom_error_code = mapper_selection_error_code;
    } elif mapper_selection_kind != mapper_kind.nrom {
        nrom_error_code = mapper_error.wrong_mapper_family;
    } else {
        nrom_check_prg_rom;
    }
}

# PRG ROM is 16 KiB or 32 KiB; anything else is not an NROM board.
proc nrom_check_prg_rom {
    local prg_rom_ok = 0;

    if cartridge_prg_rom_bytes == nrom_limit.prg_rom_16k_bytes {
        prg_rom_ok = 1;
    } elif cartridge_prg_rom_bytes == nrom_limit.prg_rom_32k_bytes {
        prg_rom_ok = 1;
    }

    if prg_rom_ok == 0 {
        nrom_error_code = mapper_error.unsupported_prg_rom_size;
    } else {
        nrom_accept_prg_rom;
    }
}

# Sums both declared memory pairs and hands them to the limit checks.
proc nrom_accept_prg_rom {
    local prg_ram_bytes = mapper_sum_memory_sizes(cartridge_prg_ram_bytes, cartridge_prg_nvram_bytes);
    local chr_ram_bytes = mapper_sum_memory_sizes(cartridge_chr_ram_bytes, cartridge_chr_nvram_bytes);
    nrom_apply_memory_limits prg_ram_bytes, chr_ram_bytes;
}

# Applies the PRG RAM, trainer, and pattern-memory limits, in the reference's order, and records
# the two sizes the board would map when every check passes.
proc nrom_apply_memory_limits prg_ram_bytes, chr_ram_bytes {
    local has_chr_rom = 0;
    local chr_ok = 0;

    if cartridge_chr_rom_bytes != 0 {
        has_chr_rom = 1;
    }

    if has_chr_rom == 1 and cartridge_chr_rom_bytes == nrom_limit.pattern_bytes and $chr_ram_bytes == 0 {
        chr_ok = 1;
    } elif has_chr_rom == 0 and $chr_ram_bytes > 0 and $chr_ram_bytes <= nrom_limit.pattern_bytes {
        chr_ok = 1;
    }

    if $prg_ram_bytes < 0 or $prg_ram_bytes > nrom_limit.prg_ram_bytes {
        nrom_error_code = mapper_error.unsupported_prg_ram_size;
    } elif cartridge_has_trainer == 1 and $prg_ram_bytes == 0 {
        nrom_error_code = mapper_error.unsupported_trainer;
    } elif chr_ok == 0 {
        nrom_error_code = mapper_error.unsupported_chr_memory;
    } else {
        nrom_ok = 1;
        nrom_kind = mapper_kind.nrom;
        nrom_prg_ram_bytes = $prg_ram_bytes;

        if has_chr_rom == 0 {
            nrom_chr_ram_bytes = $chr_ram_bytes;
        }
    }
}

# Puts every region back to the zeroes a freshly constructed board holds, sizing both ROM lists to
# the declared payload so the copies and the vector records can replace items inside them.
proc nrom_reset_memory {
    local index = 1;
    delete nrom_prg_rom;
    delete nrom_chr_rom;

    repeat nrom_limit.prg_ram_bytes {
        nrom_prg_ram[index] = 0;
        index++;
    }

    index = 1;

    repeat nrom_limit.pattern_bytes {
        nrom_chr_ram[index] = 0;
        index++;
    }
}

# Copies PRG ROM out of the generated cartridge list at the parsed payload offset.
proc nrom_copy_prg_rom {
    local index = 0;

    # Appending the real bytes sizes the list as it fills it: the reset's zero fill and this
    # loop used to write every ROM byte twice.
    delete nrom_prg_rom;

    repeat cartridge_prg_rom_bytes {
        add to_number(cartridge_bytes[cartridge_prg_rom_offset + index + 1]) to nrom_prg_rom;
        index++;
    }
}

# Copies CHR ROM out of the generated cartridge list at the parsed payload offset.
proc nrom_copy_chr_rom {
    local index = 0;

    delete nrom_chr_rom;

    repeat cartridge_chr_rom_bytes {
        add to_number(cartridge_bytes[cartridge_chr_rom_offset + index + 1]) to nrom_chr_rom;
        index++;
    }
}

# Copies the trainer into PRG RAM at offset $1000, modulo the mapped size, where the reference's
# constructor puts it. A board the validation accepted always has PRG RAM when it has a trainer.
proc nrom_copy_trainer {
    local index = 0;
    local ram_index = 0;

    if cartridge_has_trainer == 1 and nrom_prg_ram_bytes > 0 {
        repeat nrom_window.trainer_bytes {
            ram_index = ((nrom_window.trainer_prg_ram_offset + index) % nrom_prg_ram_bytes) + 1;
            nrom_prg_ram[ram_index] = to_number(cartridge_bytes[cartridge_trainer_offset + index + 1]);
            index++;
        }
    }
}

# Fills the board from the generated cartridge list. Runs after nrom_validate accepted the header,
# because the mapped sizes it computed drive the copy and the windows.
proc nrom_load_payload {
    nrom_reset_memory;
    nrom_copy_prg_rom;
    nrom_copy_chr_rom;
    nrom_copy_trainer;
}

# Reads one CPU address and reports whether it was mapped, the byte, and the driven bits.
proc nrom_read_cpu address {
    local index = 0;
    nrom_cpu_mapped = 0;
    nrom_cpu_value = 0;
    nrom_cpu_driven_mask = 0;

    if $address >= nrom_window.prg_rom_start {
        index = (($address - nrom_window.prg_rom_start) % cartridge_prg_rom_bytes) + 1;
        nrom_cpu_mapped = 1;
        nrom_cpu_value = nrom_prg_rom[index];
        nrom_cpu_driven_mask = nrom_window.full_byte_mask;
    } elif $address >= nrom_window.prg_ram_start and nrom_prg_ram_bytes > 0 {
        index = (($address - nrom_window.prg_ram_start) % nrom_prg_ram_bytes) + 1;
        nrom_cpu_mapped = 1;
        nrom_cpu_value = nrom_prg_ram[index];
        nrom_cpu_driven_mask = nrom_window.full_byte_mask;
    }
}

# Writes one CPU address. Only PRG RAM takes a write; PRG ROM ignores it, as the reference does.
proc nrom_write_cpu address, value {
    nrom_cpu_write_accepted = 0;

    if $address >= nrom_window.prg_ram_start and $address < nrom_window.prg_rom_start {
        if nrom_prg_ram_bytes > 0 {
            nrom_prg_ram[(($address - nrom_window.prg_ram_start) % nrom_prg_ram_bytes) + 1] = normalize_byte($value);
            nrom_cpu_write_accepted = 1;
        }
    }
}

# Reads one pattern-table byte from CHR ROM when the board has it, or from CHR RAM modulo the
# mapped size otherwise.
proc nrom_read_pattern address {
    nrom_pattern_value = 0;

    if cartridge_chr_rom_bytes > 0 {
        nrom_pattern_value = nrom_chr_rom[$address + 1];
    } elif nrom_chr_ram_bytes > 0 {
        nrom_pattern_value = nrom_chr_ram[($address % nrom_chr_ram_bytes) + 1];
    }
}

# Writes one pattern-table byte. A CHR ROM board drops the write, as the reference does.
proc nrom_write_pattern address, value {
    nrom_pattern_write_accepted = 0;

    if cartridge_chr_rom_bytes == 0 and nrom_chr_ram_bytes > 0 {
        nrom_chr_ram[($address % nrom_chr_ram_bytes) + 1] = normalize_byte($value);
        nrom_pattern_write_accepted = 1;
    }
}

# Copies the declared nonvolatile tail of PRG RAM into the snapshot buffer, leaving the volatile part
# of the same window out, exactly as get_prg_nvram_snapshot slices it.
proc nrom_get_prg_nvram_snapshot {
    local start = nrom_prg_ram_bytes - cartridge_prg_nvram_bytes;
    local index = 0;
    delete nrom_prg_nvram_snapshot;

    repeat cartridge_prg_nvram_bytes {
        add to_number(nrom_prg_ram[start + index + 1]) to nrom_prg_nvram_snapshot;
        index++;
    }
}

# Restores the nonvolatile tail of PRG RAM from the snapshot buffer. The board's write protection is
# not consulted, because the reference restores declared nonvolatile memory without changing any
# enable or protection register: a save state is not a CPU write.
proc nrom_load_prg_nvram_snapshot {
    local start = nrom_prg_ram_bytes - cartridge_prg_nvram_bytes;
    local index = 0;
    nrom_nvram_loaded = 0;

    if length(nrom_prg_nvram_snapshot) == cartridge_prg_nvram_bytes {
        nrom_nvram_loaded = 1;

        repeat cartridge_prg_nvram_bytes {
            nrom_prg_ram[start + index + 1] = to_number(nrom_prg_nvram_snapshot[index + 1]);
            index++;
        }
    }
}

# Copies the declared nonvolatile tail of CHR RAM into the snapshot buffer. A CHR ROM board declares
# no CHR NVRAM, because the validation rejects CHR ROM beside declared CHR RAM, so its buffer is empty
# and its CHR ROM is never touched.
proc nrom_get_chr_nvram_snapshot {
    local start = nrom_chr_ram_bytes - cartridge_chr_nvram_bytes;
    local index = 0;
    delete nrom_chr_nvram_snapshot;

    repeat cartridge_chr_nvram_bytes {
        add to_number(nrom_chr_ram[start + index + 1]) to nrom_chr_nvram_snapshot;
        index++;
    }
}

# Restores the nonvolatile tail of CHR RAM from the snapshot buffer, without modifying CHR ROM or the
# volatile part of CHR RAM.
proc nrom_load_chr_nvram_snapshot {
    local start = nrom_chr_ram_bytes - cartridge_chr_nvram_bytes;
    local index = 0;
    nrom_nvram_loaded = 0;

    if length(nrom_chr_nvram_snapshot) == cartridge_chr_nvram_bytes {
        nrom_nvram_loaded = 1;

        repeat cartridge_chr_nvram_bytes {
            nrom_chr_ram[start + index + 1] = to_number(nrom_chr_nvram_snapshot[index + 1]);
            index++;
        }
    }
}
