# Cartridge boot path for the GoboScript port.
#
# This header composes what the other modules already do: check the embedded image's signature,
# copy and parse its header, validate the board, copy the payload, and attach the board to the CPU
# bus. A board that does not validate leaves the cartridge window undriven, so a bad or unsupported
# image reads the open-bus latch instead of fetching garbage, and the reason stays in the
# nrom_error_code global the validation reports.
#
# Both ported boards attach: an NROM image and an MMC3 image, and an attached MMC3 image raises a
# scanline IRQ through cartridge_board_irq_line. The NVRAM snapshots are not ported yet, so a
# battery-backed image keeps its RAM for the session only.

%include src/rom_loader
%include src/mapper_000
%include src/mapper_004
%include src/cpu_bus

# Whether a board is driving the cartridge window, echoed for the reports.
var cartridge_board_attached = 0;

# One summary line for the board, so a report can say why the cartridge window is undriven.
var cartridge_board_state_text = "";

# Loads the embedded image and attaches its board when the header parses and the board the mapper
# selection routes to validates. A header that routes nowhere, or a board that rejects its own sizes,
# leaves the cartridge window undriven and says why in the state text.
proc cartridge_load_board {
    cartridge_board_attached = 0;
    cpu_bus_cartridge_kind = mapper_kind.none;
    cartridge_board_state_text = "missing";

    if test_rom_has_ines_header() {
        cartridge_load_header;
        cartridge_parse_header;

        if cartridge_ok == 1 {
            mapper_resolve cartridge_mapper_id, cartridge_submapper;

            if mapper_selection_error_code != mapper_selection_error.none {
                cartridge_board_state_text = "selection error " & mapper_selection_error_code;
            } elif mapper_selection_kind == mapper_kind.nrom {
                cartridge_attach_nrom;
            } elif mapper_selection_kind == mapper_kind.mmc3 {
                cartridge_attach_mmc3;
            } else {
                cartridge_board_state_text = "no board for kind " & mapper_selection_kind;
            }
        } else {
            cartridge_board_state_text = "header error " & cartridge_error_code;
        }
    }
}

# Validates an NROM board, copies its payload, and attaches it.
proc cartridge_attach_nrom {
    nrom_validate;

    if nrom_ok == 1 {
        nrom_load_payload;
        cpu_bus_cartridge_kind = mapper_kind.nrom;
        ppu_bus_attach_mapper mapper_kind.nrom;
        cartridge_board_attached = 1;
        cartridge_board_state_text = "nrom prg ram " & nrom_prg_ram_bytes;
    } else {
        cartridge_board_state_text = "board error " & nrom_error_code;
    }
}

# The IRQ line the attached cartridge drives, as the one src/nes/core/nes_console.ts ORs with the APU
# line before it hands the result to the CPU. An NROM board has no counter and drives nothing; an MMC3
# board drives its scanline counter, which stays asserted until the board's $E000 acknowledges it. A
# window with no board attached drives nothing either.
func cartridge_board_irq_line() {
    if cpu_bus_cartridge_kind == mapper_kind.mmc3 {
        return mmc3_get_irq_line_asserted();
    }

    return 0;
}

# Validates an MMC3 board, copies its payload, and attaches it.
proc cartridge_attach_mmc3 {
    mmc3_validate;

    if mmc3_ok == 1 {
        mmc3_load_payload;
        cpu_bus_cartridge_kind = mapper_kind.mmc3;
        ppu_bus_attach_mapper mapper_kind.mmc3;
        cartridge_board_attached = 1;
        cartridge_board_state_text = "mmc3 banks " & mmc3_prg_bank_count;
    } else {
        cartridge_board_state_text = "board error " & mmc3_error_code;
    }
}
