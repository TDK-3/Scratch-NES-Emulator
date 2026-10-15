list cartridge_bytes "data/test_rom_bytes.txt";

func test_rom_has_ines_header() {
    return cartridge_bytes[1] == 78
        and cartridge_bytes[2] == 69
        and cartridge_bytes[3] == 83
        and cartridge_bytes[4] == 26;
}

proc show_rom_status {
    if test_rom_has_ines_header() {
        say "iNES header found in the embedded test ROM.";
    } else {
        say "ROM data is missing or has an invalid iNES header.";
    }
}
