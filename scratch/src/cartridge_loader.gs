# Cartridge boot path for the GoboScript port.
#
# This header composes what the other modules already do: check the embedded image's signature,
# copy and parse its header, validate the board, copy the payload, and attach the board to the CPU
# bus. A board that does not validate leaves the cartridge window undriven, so a bad or unsupported
# image reads the open-bus latch instead of fetching garbage, and the reason stays in the
# nrom_error_code global the validation reports.
#
# The embedded default image is an MMC3 cartridge, so this reports a wrong board family until
# mapper 4 is ported. An NROM image attaches, and the ported CPU can then fetch from $8000.

%include src/rom_loader
%include src/mapper_000
%include src/cpu_bus

# Whether a board is driving the cartridge window, echoed for the reports.
var cartridge_board_attached = 0;

# One summary line for the board, so a report can say why the cartridge window is undriven.
var cartridge_board_state_text = "";

# Loads the embedded image and attaches its board when the header parses and the board validates.
proc cartridge_load_board {
    cartridge_board_attached = 0;
    cpu_bus_cartridge_kind = mapper_kind.none;
    cartridge_board_state_text = "missing";

    if test_rom_has_ines_header() {
        cartridge_load_header;
        cartridge_parse_header;

        if cartridge_ok == 1 {
            nrom_validate;

            if nrom_ok == 1 {
                nrom_load_payload;
                cpu_bus_cartridge_kind = mapper_kind.nrom;
                cartridge_board_attached = 1;
                cartridge_board_state_text = "nrom prg ram " & nrom_prg_ram_bytes;
            } else {
                cartridge_board_state_text = "board error " & nrom_error_code;
            }
        } else {
            cartridge_board_state_text = "header error " & cartridge_error_code;
        }
    }
}
