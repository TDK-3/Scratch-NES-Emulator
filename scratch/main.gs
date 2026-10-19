# Display sprite for the GoboScript port.
#
# All shared state, enums, and procs are declared in stage.gs through the src headers. A
# sprite resolves Stage variable, list, and enum names without redeclaring them, while
# including a header here would duplicate its procs and shadow its state with sprite-local
# copies. This sprite only reports what the Stage computed.
costumes "assets/blank.svg";

onflag {
    say "Running the shared port vectors...";

    # The Stage runs the console one bounded chunk at a time, so this loop keeps the report
    # current while the emulator runs. The wait yields to the Stage between the updates, so
    # the emulator is not starved by the display.
    forever {
        wait 0.5;

        if rom_run_started == 1 {
            say rom_run_state_text;
        }
    }
}

on "port self test done" {
    say port_self_test_summary;
}

on "rom run started" {
    say rom_run_state_text;
}
