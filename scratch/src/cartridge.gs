# iNES/NES 2.0 header parsing for the GoboScript port.
#
# Mirrors the header contract of src/nes/cartridge/ines.ts: signature, version, mapper and
# submapper, mirroring, battery, trainer, PRG/CHR ROM sizes, the four RAM/NVRAM sizes, and
# the trainer/PRG/CHR payload offsets. Payload slicing is deliberately not ported yet, so
# this header reports the sizes and offsets a later milestone will use to copy data.
#
# Scratch custom blocks can take neither a list argument nor multiple return values, so the
# parser reads the 16 header bytes from the `cartridge_header` list and the declared image
# length from `cartridge_image_bytes`, then writes each result into a `cartridge_*` global.
# Malformed input becomes a numeric error code rather than a stopped project, matching the
# TypeScript result-value contract.
#
# Codes mirror RomParseErrorCode: 0 success, 1 truncated-header, 2 invalid-magic,
# 3 unsupported-version, 4 invalid-rom-size, 5 image-too-large, 6 truncated-payload.
# Format: 1 iNES 1.0, 2 NES 2.0. Mirroring: 1 horizontal, 2 vertical, 3 four-screen.
# On any failure every field global stays 0 and only the error code is set, so a failing
# record is still deterministic for both implementations.

%include src/numeric

enum cartridge_limit {
    max_image_bytes = 33554432,
    header_bytes = 16,
    trainer_bytes = 512,
    prg_bank_bytes = 16384,
    chr_bank_bytes = 8192,
    legacy_prg_ram_bank_bytes = 8192,
    ram_shift_base_bytes = 64,
    max_safe_integer = 9007199254740991
}

enum cartridge_error {
    none = 0,
    truncated_header = 1,
    invalid_magic = 2,
    unsupported_version = 3,
    invalid_rom_size = 4,
    image_too_large = 5,
    truncated_payload = 6
}

list cartridge_header = [0; 16];
var cartridge_image_bytes = 0;
var cartridge_ok = 0;
var cartridge_error_code = 0;
var cartridge_format = 0;
var cartridge_mapper_id = 0;
var cartridge_submapper = 0;
var cartridge_mirroring = 0;
var cartridge_battery_backed = 0;
var cartridge_has_trainer = 0;
var cartridge_prg_rom_bytes = 0;
var cartridge_chr_rom_bytes = 0;
var cartridge_prg_ram_bytes = 0;
var cartridge_prg_nvram_bytes = 0;
var cartridge_chr_ram_bytes = 0;
var cartridge_chr_nvram_bytes = 0;
var cartridge_trainer_offset = 0;
var cartridge_prg_rom_offset = 0;
var cartridge_chr_rom_offset = 0;
var cartridge_payload_end = 0;

# Reads one header byte; the argument is a 0-based header index, the list is 1-based.
func header_byte(index) {
    return normalize_byte(cartridge_header[$index + 1]);
}

# Returns 2 raised to a non-negative exponent by doubling, because GoboScript has no exponent
# operator and the float-based std/math power helper is not byte-exact.
func power_of_two(exponent) {
    local result = 1;

    repeat $exponent {
        result = result * 2;
    }

    return result;
}

# Reports whether a size still has exact integer precision, mirroring Number.isSafeInteger.
# Negative values are sizes the caller rejects separately, so only magnitude matters here.
func is_safe_size(value) {
    local numeric = to_number($value);

    if numeric > cartridge_limit.max_safe_integer {
        return 0;
    }

    if numeric < 0 - cartridge_limit.max_safe_integer {
        return 0;
    }

    return 1;
}

# Decodes a NES 2.0 ROM size; mirrors decode_nes2_rom_size(), including the exponent and
# multiplier form used when the high nibble is 15. Returns -1 where TypeScript returns
# undefined, meaning the declared size loses integer precision.
func decode_nes2_rom_size(low_byte, high_nibble, bank_bytes) {
    if $high_nibble != 15 {
        return (($high_nibble * 256) + $low_byte) * $bank_bytes;
    }

    local exponent = $low_byte // 4;
    local multiplier = (($low_byte % 4) * 2) + 1;
    local size_bytes = power_of_two(exponent) * multiplier;

    if is_safe_size(size_bytes) == 0 {
        return -1;
    }

    return size_bytes;
}

# Decodes a NES 2.0 RAM or NVRAM size; mirrors decode_nes2_ram_size().
func decode_nes2_ram_size(shift) {
    if $shift == 0 {
        return 0;
    }

    return cartridge_limit.ram_shift_base_bytes * power_of_two($shift);
}

# Returns 1 when the four signature bytes are "NES" plus the iNES end marker.
func cartridge_has_magic() {
    if header_byte(0) != 78 {
        return 0;
    }

    if header_byte(1) != 69 {
        return 0;
    }

    if header_byte(2) != 83 {
        return 0;
    }

    if header_byte(3) != 26 {
        return 0;
    }

    return 1;
}

# Clears every result global so a failure leaves a deterministic zero record.
proc cartridge_reset_results {
    cartridge_ok = 0;
    cartridge_error_code = 0;
    cartridge_format = 0;
    cartridge_mapper_id = 0;
    cartridge_submapper = 0;
    cartridge_mirroring = 0;
    cartridge_battery_backed = 0;
    cartridge_has_trainer = 0;
    cartridge_prg_rom_bytes = 0;
    cartridge_chr_rom_bytes = 0;
    cartridge_prg_ram_bytes = 0;
    cartridge_prg_nvram_bytes = 0;
    cartridge_chr_ram_bytes = 0;
    cartridge_chr_nvram_bytes = 0;
    cartridge_trainer_offset = 0;
    cartridge_prg_rom_offset = 0;
    cartridge_chr_rom_offset = 0;
    cartridge_payload_end = 0;
}

# Records one failure code; every field global stays zero.
proc cartridge_fail error_code {
    cartridge_reset_results;
    cartridge_error_code = $error_code;
}

# Parses the header list. Mirrors parse_ines_rom() up to, but not including, payload copying,
# and keeps the TypeScript check order so both implementations report the same error first.
proc cartridge_parse_header {
    local image_bytes = to_number(cartridge_image_bytes);
    local flags6 = header_byte(6);
    local flags7 = header_byte(7);
    local version_bits = bitwise_and(flags7, 12);
    local prg_banks = header_byte(4);
    local chr_banks = header_byte(5);
    local prg_ram_banks = header_byte(8);
    local size_high = header_byte(9);
    local ram_sizes = header_byte(10);
    local chr_ram_sizes = header_byte(11);
    local is_nes2 = 0;
    local low_mapper_nibble = 0;
    local high_mapper_bits = 0;
    local nes2_mapper_bits = 0;
    local prg_rom_bytes = 0;
    local chr_rom_bytes = 0;
    local prg_ram_bytes = 0;
    local prg_nvram_bytes = 0;
    local chr_ram_bytes = 0;
    local chr_nvram_bytes = 0;
    local legacy_prg_ram_bytes = 0;
    local trainer_offset = 0;
    local prg_rom_offset = 0;
    local chr_rom_offset = 0;
    local payload_end = 0;
    local prg_size_high = 0;
    local chr_size_high = 0;
    cartridge_reset_results;

    if image_bytes > cartridge_limit.max_image_bytes {
        cartridge_fail cartridge_error.image_too_large;
    } elif image_bytes < cartridge_limit.header_bytes {
        cartridge_fail cartridge_error.truncated_header;
    } elif cartridge_has_magic() == 0 {
        cartridge_fail cartridge_error.invalid_magic;
    } elif (version_bits != 0) and (version_bits != 8) {
        cartridge_fail cartridge_error.unsupported_version;
    } else {
        if version_bits == 8 {
            is_nes2 = 1;
            cartridge_format = 2;
        } else {
            cartridge_format = 1;
        }

        low_mapper_nibble = bitwise_and(flags6 // 16, 15);
        high_mapper_bits = bitwise_and(flags7, 240);
        cartridge_mapper_id = bitwise_or(low_mapper_nibble, high_mapper_bits);
        cartridge_has_trainer = bit_at(flags6, 4);
        cartridge_battery_backed = bit_at(flags6, 2);

        if bit_at(flags6, 8) == 1 {
            cartridge_mirroring = 3;
        } elif bit_at(flags6, 1) == 1 {
            cartridge_mirroring = 2;
        } else {
            cartridge_mirroring = 1;
        }

        if is_nes2 == 1 {
            nes2_mapper_bits = bitwise_and(prg_ram_banks, 15) * 256;
            cartridge_mapper_id = bitwise_or(cartridge_mapper_id, nes2_mapper_bits);
            cartridge_submapper = prg_ram_banks // 16;
            prg_size_high = bitwise_and(size_high, 15);
            chr_size_high = size_high // 16;
            prg_rom_bytes = decode_nes2_rom_size(prg_banks, prg_size_high, cartridge_limit.prg_bank_bytes);
            chr_rom_bytes = decode_nes2_rom_size(chr_banks, chr_size_high, cartridge_limit.chr_bank_bytes);
            prg_ram_bytes = decode_nes2_ram_size(bitwise_and(ram_sizes, 15));
            prg_nvram_bytes = decode_nes2_ram_size(ram_sizes // 16);
            chr_ram_bytes = decode_nes2_ram_size(bitwise_and(chr_ram_sizes, 15));
            chr_nvram_bytes = decode_nes2_ram_size(chr_ram_sizes // 16);
        } else {
            prg_rom_bytes = prg_banks * cartridge_limit.prg_bank_bytes;
            chr_rom_bytes = chr_banks * cartridge_limit.chr_bank_bytes;

            if prg_ram_banks == 0 {
                legacy_prg_ram_bytes = cartridge_limit.legacy_prg_ram_bank_bytes;
            } else {
                legacy_prg_ram_bytes = prg_ram_banks * cartridge_limit.legacy_prg_ram_bank_bytes;
            }

            if cartridge_battery_backed == 1 {
                prg_nvram_bytes = legacy_prg_ram_bytes;
            } else {
                prg_ram_bytes = legacy_prg_ram_bytes;
            }

            if chr_rom_bytes == 0 {
                chr_ram_bytes = cartridge_limit.chr_bank_bytes;
            }
        }

        if (prg_rom_bytes <= 0) or (chr_rom_bytes < 0) {
            cartridge_fail cartridge_error.invalid_rom_size;
        } elif (is_safe_size(prg_rom_bytes) == 0) or (is_safe_size(chr_rom_bytes) == 0) {
            cartridge_fail cartridge_error.invalid_rom_size;
        } else {
            trainer_offset = cartridge_limit.header_bytes;
            prg_rom_offset = trainer_offset + (cartridge_has_trainer * cartridge_limit.trainer_bytes);
            chr_rom_offset = prg_rom_offset + prg_rom_bytes;
            payload_end = chr_rom_offset + chr_rom_bytes;

            if is_safe_size(payload_end) == 0 {
                cartridge_fail cartridge_error.invalid_rom_size;
            } elif payload_end > cartridge_limit.max_image_bytes {
                cartridge_fail cartridge_error.image_too_large;
            } elif payload_end > image_bytes {
                cartridge_fail cartridge_error.truncated_payload;
            } else {
                cartridge_prg_rom_bytes = prg_rom_bytes;
                cartridge_chr_rom_bytes = chr_rom_bytes;
                cartridge_prg_ram_bytes = prg_ram_bytes;
                cartridge_prg_nvram_bytes = prg_nvram_bytes;
                cartridge_chr_ram_bytes = chr_ram_bytes;
                cartridge_chr_nvram_bytes = chr_nvram_bytes;
                cartridge_trainer_offset = trainer_offset;
                cartridge_prg_rom_offset = prg_rom_offset;
                cartridge_chr_rom_offset = chr_rom_offset;
                cartridge_payload_end = payload_end;
                cartridge_error_code = cartridge_error.none;
                cartridge_ok = 1;
            }
        }
    }
}
