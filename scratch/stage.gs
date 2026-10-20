# Stage of the Scratch NES emulator port.
#
# The Stage owns every shared variable, list, and enum: GoboScript resolves those names from
# the Stage in sprite sources, but a proc or func is compiled into each target that includes
# its header. Keeping the headers Stage-only therefore avoids duplicated state, and the
# display sprite only reports results.
#
# The green flag runs the shared port-vector self test and then broadcasts completion. The
# Stage can neither `say` nor show variable monitors from GoboScript source, so reporting is
# left to the display sprite, which reads the Stage-owned summary variables.
costumes "assets/blank.svg";

%include src/numeric
%include src/cpu_status
%include src/cpu_alu
%include src/controller
%include src/cpu_bus
%include src/cpu_core
%include src/cpu_addressing
%include src/cpu_sequence
%include src/cpu_opcode
%include src/cpu_instruction
%include src/cpu_control
%include src/cartridge
%include src/mapper
%include src/mapper_000
%include src/rom_loader
%include src/cartridge_loader
%include src/frame_loop
%include src/nes_palette
%include src/pen_display
%include src/shared_vectors
%include src/vector_selftest
%include src/rom_run

onflag {
    # The nibble tables back every bitwise helper, so they have to exist before anything reads
    # a bus byte. The opcode table is converted from the strings its data file loads to the
    # numbers every decode wants in the same place.
    bitwise_table_init;
    nes_palette_init;
    cpu_opcode_table_normalize;

    # The shared-vector replay is a boot-time diagnostic: it replays every vector through the
    # same bus and CPU, leaves their state behind, and is then undone by the console reset, so a
    # normal run boots straight into the game. Flip port_self_test_enabled (declared in
    # src/vector_selftest.gs) to 1 to replay it.
    if port_self_test_enabled == 1 {
        run_port_self_test;
        broadcast "port self test done";
    }

    rom_run_start;
    broadcast "rom run started";
    rom_run_loop;
}
