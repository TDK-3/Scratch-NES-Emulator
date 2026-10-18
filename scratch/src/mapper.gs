# Mapper selection for the GoboScript port.
#
# This header mirrors resolve_mapper in src/nes/cartridge/mapper.ts: a cartridge is routed only by
# an exact mapper and submapper pair, never by a default, and a pair that is not registered reports
# which half of it failed. Knowing the mapper id but not the submapper is a different board
# question than not knowing the mapper at all, so the two get separate codes.
#
# Presence of a route does not claim the board is implemented: mapper 4 (MMC3) is registered here
# because the TypeScript reference supports it, and the ported mapper for it is not written yet.


enum mapper_kind {
    none = 0,
    nrom = 1,
    mmc3 = 2
}

enum mapper_selection_error {
    none = 0,
    unsupported_mapper = 1,
    unsupported_submapper = 2
}

# The board family the last selection routed to, or none when it failed.
var mapper_selection_kind = 0;

# Why the last selection failed, using mapper_selection_error.
var mapper_selection_error_code = 0;

# The mapper and submapper the last selection was asked about, echoed for the reports.
var mapper_selection_mapper_id = 0;
var mapper_selection_submapper = 0;

# Sums two declared memory sizes, reporting -1 when either one is not a usable size. The parsed
# header reports -1 for a size that would lose integer precision, and the reference rejects the
# same case by returning null from its sum helper.
func mapper_sum_memory_sizes(first, second) {
    if $first < 0 {
        return -1;
    }

    if $second < 0 {
        return -1;
    }

    return $first + $second;
}

# The creation-error codes every board reports. They match the reference's creation-error strings
# one for one, so a board that rejects an image says why in the same terms whichever board it is:
# the selection half is shared with mapper_selection_error, and the board half is the size, trainer,
# and CHR memory checks each board performs.
enum mapper_error {
    none = 0,
    unsupported_mapper = 1,
    unsupported_submapper = 2,
    wrong_mapper_family = 3,
    unsupported_prg_rom_size = 4,
    unsupported_prg_ram_size = 5,
    unsupported_trainer = 6,
    unsupported_chr_memory = 7
}

# Routes one exact mapper and submapper pair, or reports which half of it is unsupported.
proc mapper_resolve mapper_id, submapper {
    mapper_selection_mapper_id = $mapper_id;
    mapper_selection_submapper = $submapper;
    mapper_selection_kind = mapper_kind.none;
    mapper_selection_error_code = mapper_selection_error.none;

    if $mapper_id == 0 and $submapper == 0 {
        mapper_selection_kind = mapper_kind.nrom;
    } elif $mapper_id == 4 and $submapper == 0 {
        mapper_selection_kind = mapper_kind.mmc3;
    } elif $mapper_id == 0 or $mapper_id == 4 {
        mapper_selection_error_code = mapper_selection_error.unsupported_submapper;
    } else {
        mapper_selection_error_code = mapper_selection_error.unsupported_mapper;
    }
}
