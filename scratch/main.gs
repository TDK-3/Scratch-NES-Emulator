# Display sprite for the GoboScript port.
#
# All shared state, enums, and procs are declared in stage.gs through the src headers. A
# sprite resolves Stage variable, list, and enum names without redeclaring them, while
# including a header here would duplicate its procs and shadow its state with sprite-local
# copies. This sprite only reports what the Stage computed.
costumes "assets/blank.svg";

onflag {
    say "Running the shared port vectors...";
}

on "port self test done" {
    say port_self_test_summary;
}
