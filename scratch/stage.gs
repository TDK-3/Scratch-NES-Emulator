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
%include src/shared_vectors
%include src/vector_selftest

onflag {
    run_port_self_test;
    broadcast "port self test done";
}
