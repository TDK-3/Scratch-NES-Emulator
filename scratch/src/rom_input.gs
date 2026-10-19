# Runtime ROM text loading for the GoboScript port.
#
# The port embeds one selected image as a decimal list the build generates, so changing the
# cartridge means regenerating that data and rebuilding the project. This header rebuilds the
# same list at runtime instead: the run loop samples a load key, the Stage asks the host for a
# string of hexadecimal byte values, and cartridge_bytes is replaced with what the string
# describes. src/nes/cartridge/rom_text.ts in the TypeScript reference defines the format, the
# ROM string converter page encodes a .nes file into it, and
# tests/support/goboscript_port_algorithms.ts mirrors the decode below so the automated suite
# compares the two sides instead of trusting either one.
#
# Every byte is exactly two hexadecimal digits, most significant nibble first, so a 40 KiB
# image is 80,000 characters rather than the 135,000 or so the old decimal format needed.
# Any character that is not a hexadecimal digit separates two digits, so spaces, commas, and
# newlines all work and a separator may even fall between the two digits of a byte. The scan
# walks one character at a time because Scratch has no split block.
#
# Scratch's string-to-number cast follows JavaScript's Number(): "0x" joined with one
# hexadecimal digit reads as that nibble, while every other character reads as zero. The digit
# "0" also reads as zero, so the scan tests that character separately before trusting the
# cast. Two nibbles then make one byte, and a leftover nibble at the end is a reported error
# rather than a silently truncated byte.
#
# The bytes land in a staging list first. Only an image that carries the iNES signature and at
# least the payload its header declares replaces cartridge_bytes, so a mistyped or truncated
# paste leaves the running game alone. The run loop reboots the console after the swap through
# the same boot path the embedded image uses, so a board that fails to validate still reports
# its own reason instead of fetching from an undriven cartridge window.
#
# The load key is sampled by the run loop rather than by a key-press hat. A hat would start its
# own script while the console kept running, so the byte list could be replaced in the middle
# of a frame. Sampling in the loop stops the console for as long as the host needs to type, and
# the edge test keeps one press from asking twice.
#
# Limits: a Scratch list holds 200,000 items and silently drops the adds past that, so an image
# beyond the limit would load truncated rather than fail; the decode rejects it instead. The
# character bound only rejects text that could not describe an acceptable image at all: the
# continuous form needs 400,000 characters for the largest acceptable image.

%include src/numeric
%include src/rom_loader

# The numeric reason a load stopped, reported as words by rom_input_error_text().
enum rom_input_error {
    none = 0,
    empty = 1,
    odd_digits = 2,
    too_many_bytes = 3,
    too_long = 4,
    signature = 5,
    truncated = 6
}

# The image and text sizes the decode accepts; see the limits note above.
enum rom_input_limit {
    max_bytes = 200000,
    max_text_chars = 1000000
}

# The pasted byte text, as the host handed it over.
var rom_input_text = "";

# The decoded bytes, staged until the image they describe validates.
list rom_input_bytes;

# The staged byte count and the numeric reason the load stopped.
var rom_input_byte_count = 0;
var rom_input_error_code = 0;

# The payload size the staged header declares, so a report can compare it with the count.
var rom_input_declared_bytes = 0;

# Whether the load key was down at the previous sample, so one press asks once.
var rom_input_key_held = 0;

# Set by the key sample and cleared by the run loop when it services the request.
var rom_input_requested = 0;

# Samples the load key once and records the press that was not down at the last sample. The
# caller services rom_input_requested with the console stopped, which is why this only
# reports the edge instead of asking here.
proc rom_input_poll_key {
    if key_pressed("q") {
        if rom_input_key_held == 0 {
            rom_input_requested = 1;
        }

        rom_input_key_held = 1;
    } else {
        rom_input_key_held = 0;
    }
}

# Asks the host for the hex byte text and keeps the answer. An empty answer is the host's way
# of cancelling, which the caller reports without touching the running image.
proc rom_input_ask_for_text {
    ask "Paste the ROM hex byte string, then press Enter. Leave it empty to keep the current ROM.";

    rom_input_text = answer();
}

# Decodes rom_input_text into the staging list and reports the reason it stopped. Mirrors
# decode_rom_text() in src/nes/cartridge/rom_text.ts, which the automated suite compares
# against GoboscriptRomInput.parse_text in tests/support/goboscript_port_algorithms.ts.
proc rom_input_parse_text {
    local text_length = 0;
    local cursor = 1;
    local character = "";
    local nibble_value = 0;
    local pending_nibble = 0;
    local has_pending_nibble = 0;

    rom_input_error_code = rom_input_error.none;
    rom_input_byte_count = 0;
    rom_input_declared_bytes = 0;
    delete rom_input_bytes;

    text_length = length rom_input_text;

    if text_length > rom_input_limit.max_text_chars {
        rom_input_error_code = rom_input_error.too_long;
    } else {
        until cursor > text_length or rom_input_error_code != rom_input_error.none {
            character = rom_input_text[cursor];

            # "0" casts to 0 like a separator, so it takes the first branch. Every other
            # hexadecimal digit casts to 1-15 through the "0x" prefix, and every other
            # character casts to 0 and is therefore ignored. The cast is written inline
            # because a to_number() call would be one custom block per character.
            if character == "0" {
                nibble_value = 0;
            } else {
                nibble_value = ("0x" & character) + "";
            }

            if nibble_value > 0 or character == "0" {
                if has_pending_nibble == 0 {
                    pending_nibble = nibble_value;
                    has_pending_nibble = 1;
                } elif length rom_input_bytes >= rom_input_limit.max_bytes {
                    rom_input_error_code = rom_input_error.too_many_bytes;
                } else {
                    add ((pending_nibble * 16) + nibble_value) to rom_input_bytes;
                    rom_input_byte_count = rom_input_byte_count + 1;
                    pending_nibble = 0;
                    has_pending_nibble = 0;
                }
            }

            cursor = cursor + 1;
        }

        if rom_input_error_code == rom_input_error.none {
            if has_pending_nibble == 1 {
                rom_input_error_code = rom_input_error.odd_digits;
            } elif rom_input_byte_count == 0 {
                rom_input_error_code = rom_input_error.empty;
            }
        }
    }
}

# True when the staged bytes start with the four-byte iNES signature "NES\x1A", the same check
# test_rom_has_ines_header() runs over the embedded list.
func rom_input_has_signature() {
    return rom_input_bytes[1] == 78
        and rom_input_bytes[2] == 69
        and rom_input_bytes[3] == 83
        and rom_input_bytes[4] == 26;
}

# Checks the staged image before anything overwrites the running one: the header has to be
# complete, it has to carry the iNES signature, and an iNES 1.0 header has to declare a
# payload the staged count actually holds. A NES 2.0 header encodes its sizes differently, so
# this pre-check leaves those to the loader's own header parse, which reports them with the
# cartridge error codes.
proc rom_input_validate_image {
    local prg_banks = 0;
    local chr_banks = 0;
    local flags6 = 0;
    local flags7 = 0;
    local trainer_bytes = 0;
    local declared_bytes = 0;

    if rom_input_error_code == rom_input_error.none {
        if rom_input_byte_count < cartridge_limit.header_bytes {
            rom_input_error_code = rom_input_error.truncated;
        } elif rom_input_has_signature() == 0 {
            rom_input_error_code = rom_input_error.signature;
        } else {
            prg_banks = rom_input_bytes[5];
            chr_banks = rom_input_bytes[6];
            flags6 = rom_input_bytes[7];
            flags7 = rom_input_bytes[8];
            trainer_bytes = 0;

            if bit_at(flags6, 4) == 1 {
                trainer_bytes = 512;
            }

            declared_bytes = 16 + (prg_banks * 16384) + (chr_banks * 8192) + trainer_bytes;
            rom_input_declared_bytes = declared_bytes;

            if bitwise_and(flags7, 12) != 8 {
                if declared_bytes > rom_input_limit.max_bytes {
                    rom_input_error_code = rom_input_error.too_many_bytes;
                } elif rom_input_byte_count < declared_bytes {
                    rom_input_error_code = rom_input_error.truncated;
                }
            }
        }
    }
}

# Replaces the embedded image with the staged bytes. The copy is the price of validating
# first: a rejected paste never reaches cartridge_bytes, and the run loop reboots from
# whatever is there when this returns.
proc rom_input_install_image {
    local index = 1;
    local staged_bytes = 0;

    staged_bytes = length rom_input_bytes;
    delete cartridge_bytes;

    repeat staged_bytes {
        add rom_input_bytes[index] to cartridge_bytes;
        index++;
    }

    delete rom_input_bytes;
}

# The short phrase a report shows for the numeric reason a load stopped.
func rom_input_error_text() {
    if rom_input_error_code == rom_input_error.empty {
        return "no byte values";
    }

    if rom_input_error_code == rom_input_error.odd_digits {
        return "an odd number of hexadecimal digits";
    }

    if rom_input_error_code == rom_input_error.too_many_bytes {
        return "more bytes than a Scratch list holds";
    }

    if rom_input_error_code == rom_input_error.too_long {
        return "more text than the decode accepts";
    }

    if rom_input_error_code == rom_input_error.signature {
        return "no iNES signature";
    }

    if rom_input_error_code == rom_input_error.truncated {
        return "an image shorter than its header declares";
    }

    return "an unknown reason";
}
