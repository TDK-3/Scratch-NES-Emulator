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
# What is not ported yet: the PRG ROM, PRG RAM, CHR ROM, and CHR RAM storage itself, the CPU and
# pattern address windows with their mirroring, the trainer copy into PRG RAM at offset $1000, the
# NVRAM snapshots, and the MMC3 board. Nametable mirroring needs no mapper state, because NROM
# reports the mirroring the header declared.

%include src/cartridge
%include src/mapper

enum nrom_error {
    none = 0,
    unsupported_mapper = 1,
    unsupported_submapper = 2,
    wrong_mapper_family = 3,
    unsupported_prg_rom_size = 4,
    unsupported_prg_ram_size = 5,
    unsupported_trainer = 6,
    unsupported_chr_memory = 7
}

enum nrom_limit {
    prg_ram_bytes = 8192,
    prg_rom_16k_bytes = 16384,
    prg_rom_32k_bytes = 32768,
    pattern_bytes = 8192
}

# Whether the last validation accepted the board.
var nrom_ok = 0;

# Why it did not, using nrom_error. Codes 1 and 2 are the selection codes, because a failed
# selection is reported unchanged.
var nrom_error_code = 0;

# The board family the accepted board belongs to, or none when validation failed.
var nrom_kind = 0;

# The PRG RAM and NVRAM bytes the board would map at $6000-$7FFF, zero when validation failed.
var nrom_prg_ram_bytes = 0;

# The CHR RAM bytes the board would map, zero when CHR ROM is present or validation failed.
var nrom_chr_ram_bytes = 0;

# Clears every result the validation reports.
proc nrom_reset_results {
    nrom_ok = 0;
    nrom_error_code = nrom_error.none;
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
        nrom_error_code = nrom_error.wrong_mapper_family;
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
        nrom_error_code = nrom_error.unsupported_prg_rom_size;
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
        nrom_error_code = nrom_error.unsupported_prg_ram_size;
    } elif cartridge_has_trainer == 1 and $prg_ram_bytes == 0 {
        nrom_error_code = nrom_error.unsupported_trainer;
    } elif chr_ok == 0 {
        nrom_error_code = nrom_error.unsupported_chr_memory;
    } else {
        nrom_ok = 1;
        nrom_kind = mapper_kind.nrom;
        nrom_prg_ram_bytes = $prg_ram_bytes;

        if has_chr_rom == 0 {
            nrom_chr_ram_bytes = $chr_ram_bytes;
        }
    }
}
