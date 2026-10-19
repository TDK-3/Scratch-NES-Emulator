# PPU memory bus for the GoboScript port.
#
# Routes the PPU's 14-bit address space to mapper pattern memory, mirrored
# nametable RAM, and palette RAM. Primary OAM is a separate 256-byte space
# exposed through ppu_bus_read_oam / ppu_bus_write_oam.
#
# Address normalization masks to 14 bits (0-16383), then dispatches:
#   0x0000-0x1FFF  pattern tables  -> attached mapper
#   0x2000-0x3EFF  nametables      -> 4 KiB nametable RAM with mirroring
#   0x3F00-0x3FFF  palette         -> 32-byte palette RAM with aliases
#
# The mapper port is whichever board the cartridge loader attached. Pattern
# accesses forward to the board's read_pattern / write_pattern; nametable
# mirroring is queried from the board on every access. Every pattern and
# nametable access is also reported to the board before it runs, the way
# PpuMemoryBus calls observe_ppu_access, because the MMC3 A12 filter clocks
# its scanline IRQ from the addresses the rendering pipeline fetches. The
# address-bus observer and the per-dot mapper clock forward as well when an
# MMC3 board is attached, and are no-ops otherwise.

%include src/numeric
%include src/mapper
%include src/mapper_000
%include src/mapper_004

# Nametable storage: four 1 KiB tables in 4096 bytes.
list ppu_nametable_ram = [0; 4096];

# Palette storage: 32 bytes (6-bit colors in the low bits).
list ppu_palette_ram = [0; 32];

# Primary OAM: 256 bytes.
list ppu_oam = [0; 256];

# The mapper that drives pattern-table access, mirroring mapper_kind.
var ppu_bus_mapper_kind = 0;

# Last access description for mapper observation.
var ppu_bus_last_access_kind = 0;
var ppu_bus_last_access_address = 0;
var ppu_bus_last_access_region = 0;

# Read result from the last ppu_bus_read_ppu call.
var ppu_bus_read_value = 0;

# Whether the last read or write mapped to the pattern region through the
# attached mapper. A read through an absent mapper returns zero.
var ppu_bus_pattern_mapped = 0;

# Whether the last write reached pattern memory through the attached mapper.
var ppu_bus_pattern_write_accepted = 0;

enum ppu_bus_region {
    pattern = 1,
    nametable = 2,
    palette = 3
}

enum ppu_bus_access {
    read = 1,
    write = 2
}

# Clears volatile bus state; nametable, palette, and OAM contents survive.
proc ppu_bus_reset {
    ppu_bus_last_access_kind = 0;
    ppu_bus_last_access_address = 0;
    ppu_bus_last_access_region = 0;
    ppu_bus_read_value = 0;
    ppu_bus_pattern_mapped = 0;
    ppu_bus_pattern_write_accepted = 0;
}

# Zeroes nametable, palette, and OAM storage. The TypeScript PpuMemoryBus
# starts each instance with cleared RAM, so a vector that reads an address
# it never wrote must see zero on both sides.
proc ppu_bus_clear_memory {
    local index = 1;

    repeat 4096 {
        ppu_nametable_ram[index] = 0;
        index++;
    }

    index = 1;

    repeat 32 {
        ppu_palette_ram[index] = 0;
        index++;
    }

    index = 1;

    repeat 256 {
        ppu_oam[index] = 0;
        index++;
    }
}

# Attaches a mapper by kind so pattern reads/writes and mirroring queries
# reach it. An absent mapper (kind 0) leaves pattern reads returning zero
# and pattern writes dropped, which is what the TypeScript bus does when
# no mapper port is provided.
proc ppu_bus_attach_mapper kind {
    ppu_bus_mapper_kind = $kind;
}

# Queries the nametable mirroring mode from the attached mapper. The
# cartridge parser and the two ported boards all agree on the same ids:
# 1 horizontal, 2 vertical, 3 four-screen. An absent mapper defaults to
# horizontal mirroring, matching the header default.
func ppu_bus_get_mirroring() {
    if ppu_bus_mapper_kind == mapper_kind.nrom {
        return cartridge_mirroring;
    }

    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
        return mmc3_mirroring;
    }

    return 1;
}

# Normalizes a PPU address input to 14 bits, like PpuMemoryBus does with
# its 0x3FFF mask. Inputs outside 0-65535 report an invalid-address code
# through ppu_bus_address_error instead of throwing.
var ppu_bus_address_error = 0;

enum ppu_bus_address_status {
    ok = 0,
    out_of_range = 1
}

func ppu_bus_normalize_address(address) {
    local numeric = to_number($address);

    # The range test runs first because every rendering and register path arrives inside it;
    # the integer test only has to run for a value that could otherwise be accepted.
    if numeric < 0 or numeric > 65535 or numeric != numeric // 1 {
        ppu_bus_address_error = ppu_bus_address_status.out_of_range;

        return 0;
    }

    ppu_bus_address_error = ppu_bus_address_status.ok;

    return numeric % 16384;
}

# Maps a nametable-region address (after 14-bit normalization, so the
# caller already folded $3000-$3EFF back to $2000-$2EFF range by subtracting
# $1000 where needed) through the attached mapper's mirroring mode into a
# 0-4095 index into ppu_nametable_ram.
func ppu_bus_map_nametable(address) {
    local base_address = $address;

    if base_address >= 12288 {
        base_address = base_address - 4096;
    }

    local logical_table = (base_address - 8192) // 1024;
    local page_offset = base_address % 1024;
    local physical_table = 0;
    local mirroring = ppu_bus_get_mirroring();

    if mirroring == 2 {
        physical_table = logical_table % 2;
    } elif mirroring == 1 {
        physical_table = logical_table // 2;
    } elif mirroring == 3 {
        physical_table = logical_table;
    } else {
        physical_table = logical_table // 2;
    }

    return physical_table * 1024 + page_offset + 1;
}

# Maps a palette-region address to a 1-32 palette index. The 5-bit mask
# collapses the $3F00-$3FFF window to 32 slots; addresses where bits 3-4
# are both set ($3F00/$3F04/$3F08/$3F0C) alias the universal background
# colors at $3F00-$3F03, matching PpuMemoryBus::map_palette_address.
func ppu_bus_map_palette(address) {
    local index = $address % 32;

    if index >= 16 {
        if index % 4 == 0 {
            index = index - 16;
        }
    }

    return index + 1;
}

# Reads one byte from the 14-bit PPU address space. The result is stored in
# ppu_bus_read_value; the region and whether a mapper drove the access are
# in ppu_bus_last_access_region and ppu_bus_pattern_mapped.
proc ppu_bus_read_ppu address {
    local ppu_address = ppu_bus_normalize_address($address);
    ppu_bus_read_value = 0;
    ppu_bus_pattern_mapped = 0;
    ppu_bus_last_access_kind = ppu_bus_access.read;
    ppu_bus_last_access_address = ppu_address;

    if ppu_address < 8192 {
        ppu_bus_last_access_region = ppu_bus_region.pattern;
        ppu_bus_observe_access ppu_bus_access.read, ppu_address;
        ppu_bus_read_pattern ppu_address;
    } elif ppu_address < 16128 {
        ppu_bus_last_access_region = ppu_bus_region.nametable;
        ppu_bus_observe_access ppu_bus_access.read, ppu_address;
        local nt_index = ppu_bus_map_nametable(ppu_address);
        ppu_bus_read_value = to_number(ppu_nametable_ram[nt_index]);
    } else {
        ppu_bus_last_access_region = ppu_bus_region.palette;
        local pal_index = ppu_bus_map_palette(ppu_address);
        ppu_bus_read_value = to_number(ppu_palette_ram[pal_index]);
    }
}

# Writes one byte into the 14-bit PPU address space. Pattern writes forward
# to the attached mapper; palette writes mask to six bits.
proc ppu_bus_write_ppu address, value {
    local ppu_address = ppu_bus_normalize_address($address);
    local byte_value = normalize_byte($value);
    ppu_bus_pattern_write_accepted = 0;
    ppu_bus_last_access_kind = ppu_bus_access.write;
    ppu_bus_last_access_address = ppu_address;

    if ppu_address < 8192 {
        ppu_bus_last_access_region = ppu_bus_region.pattern;
        ppu_bus_observe_access ppu_bus_access.write, ppu_address;
        ppu_bus_write_pattern ppu_address, byte_value;
    } elif ppu_address < 16128 {
        ppu_bus_last_access_region = ppu_bus_region.nametable;
        ppu_bus_observe_access ppu_bus_access.write, ppu_address;
        local nt_index = ppu_bus_map_nametable(ppu_address);
        ppu_nametable_ram[nt_index] = byte_value;
    } else {
        ppu_bus_last_access_region = ppu_bus_region.palette;
        local pal_index = ppu_bus_map_palette(ppu_address);
        ppu_palette_ram[pal_index] = byte_value % 64;
    }
}

# Reads one nametable byte for the rendering pipeline. The address is already
# the $2000-$3EFF window the PPU computes, so the generic read's address
# normalization and region decode would only repeat work: this proc folds
# $3000-$3EFF back by hand, reports the access to the board exactly as
# ppu_bus_read_ppu does, and maps the four logical tables through the
# attached board's mirroring mode inline. The pipeline calls this several
# dozen times per scanline, which makes the two saved custom-block calls
# worth the duplicated arithmetic. CPU reads still take ppu_bus_read_ppu.
proc ppu_bus_read_nametable address {
    local base_address = $address;
    local logical_table = 0;
    local mirroring = 1;
    local physical_table = 0;

    if base_address >= 12288 {
        base_address = base_address - 4096;
    }

    # ppu_bus_observe_access() inlined: this read runs several dozen times per scanline, the
    # observation is one comparison on NROM, and the mirroring query is the same board check.
    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
        mmc3_observe_ppu_access ppu_bus_access.read, $address;
        mirroring = mmc3_mirroring;
    } elif ppu_bus_mapper_kind == mapper_kind.nrom {
        mirroring = cartridge_mirroring;
    }

    logical_table = (base_address - 8192) // 1024;

    if mirroring == 2 {
        physical_table = logical_table % 2;
    } elif mirroring == 3 {
        physical_table = logical_table;
    } else {
        physical_table = logical_table // 2;
    }

    ppu_bus_read_value = ppu_nametable_ram[(physical_table * 1024) + (base_address % 1024) + 1];
}

# Reads one pattern-table byte for the rendering pipeline: the address is
# already in $0000-$1FFF, so the only work besides the read itself is the
# board observation that clocks the MMC3 A12 filter.
proc ppu_bus_read_pattern_window address {
    if ppu_bus_mapper_kind == mapper_kind.nrom {
        # NROM has no observer and its read_pattern takes no bank lookup, so the two hops
        # through ppu_bus_observe_access and ppu_bus_read_pattern are pure call overhead on
        # the board the embedded image uses. The fields the generic path would set are set
        # here directly.
        ppu_bus_pattern_mapped = 1;
        nrom_read_pattern $address;
        ppu_bus_read_value = nrom_pattern_value;
    } else {
        ppu_bus_observe_access ppu_bus_access.read, $address;
        ppu_bus_read_pattern $address;
    }
}

# Reads pattern memory through the attached mapper. An absent mapper leaves
# ppu_bus_read_value at zero and ppu_bus_pattern_mapped at 0.
proc ppu_bus_read_pattern address {
    ppu_bus_pattern_mapped = 0;
    ppu_bus_read_value = 0;

    if ppu_bus_mapper_kind == mapper_kind.nrom {
        nrom_read_pattern $address;
        ppu_bus_pattern_mapped = 1;
        ppu_bus_read_value = nrom_pattern_value;
    } elif ppu_bus_mapper_kind == mapper_kind.mmc3 {
        mmc3_read_pattern $address;
        ppu_bus_pattern_mapped = 1;
        ppu_bus_read_value = mmc3_pattern_value;
    }
}

# Writes pattern memory through the attached mapper. An absent mapper drops
# the write and leaves ppu_bus_pattern_write_accepted at 0.
proc ppu_bus_write_pattern address, value {
    ppu_bus_pattern_write_accepted = 0;

    if ppu_bus_mapper_kind == mapper_kind.nrom {
        nrom_write_pattern $address, $value;
        ppu_bus_pattern_write_accepted = nrom_pattern_write_accepted;
    } elif ppu_bus_mapper_kind == mapper_kind.mmc3 {
        mmc3_write_pattern $address, $value;
        ppu_bus_pattern_write_accepted = mmc3_pattern_write_accepted;
    }
}

# Reports one pattern or nametable access to the attached mapper before the
# access runs, mirroring the observe_ppu_access calls in PpuMemoryBus. NROM
# ignores accesses, so only an attached MMC3 board receives them, and its
# A12 filter decides from the address alone whether the IRQ counter clocks.
# Palette accesses are never reported, matching the reference bus.
proc ppu_bus_observe_access access_kind, address {
    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
        mmc3_observe_ppu_access $access_kind, $address;
    }
}

# Reports the PPU address bus value set by a PPUADDR write to the attached
# mapper, without inventing a memory read or write. NROM has no observer;
# MMC3 forwards the address to the A12 filter.
proc ppu_bus_observe_ppu_address address {
    local ppu_address = ppu_bus_normalize_address($address);

    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
        mmc3_observe_ppu_address ppu_address;
    }
}

# Advances the attached mapper by one PPU dot. NROM ignores the tick; MMC3
# saturates its A12 filter counter. The MMC3 body is written out rather than
# calling mmc3_clock_ppu_dot, because this proc runs once per PPU dot, and a
# custom-block call for two comparisons is not worth its cost there.
proc ppu_bus_clock_ppu_dot {
    if ppu_bus_mapper_kind == mapper_kind.mmc3 {
        if mmc3_ppu_a12_high == 0 and mmc3_a12_low_dots < mmc3_limit.a12_filter_dots {
            mmc3_a12_low_dots = mmc3_a12_low_dots + 1;
        }
    }
}

# Reads one byte from primary OAM through an 8-bit address. Inputs outside
# 0-255 report an out-of-range error through ppu_bus_oam_error and set the
# read value to zero.
var ppu_bus_oam_error = 0;
var ppu_bus_oam_read_value = 0;

proc ppu_bus_read_oam address {
    local numeric = to_number($address);

    if numeric != numeric // 1 or numeric < 0 or numeric > 255 {
        ppu_bus_oam_error = 1;
        ppu_bus_oam_read_value = 0;
    } else {
        ppu_bus_oam_error = 0;
        ppu_bus_oam_read_value = to_number(ppu_oam[numeric + 1]);
    }
}

# Writes one byte to primary OAM through an 8-bit address. Inputs outside
# 0-255 or non-byte values are rejected; the write is stored otherwise.
proc ppu_bus_write_oam address, value {
    local numeric = to_number($address);
    local byte_value = normalize_byte($value);

    if numeric != numeric // 1 or numeric < 0 or numeric > 255 {
        ppu_bus_oam_error = 1;
    } else {
        ppu_bus_oam_error = 0;
        ppu_oam[numeric + 1] = byte_value;
    }
}
