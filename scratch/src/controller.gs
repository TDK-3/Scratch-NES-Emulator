# Two standard NES serial controller ports.
#
# Mirrors src/nes/input/controller.ts: bit 0 of $4016 is the strobe, A is polled live while
# the strobe is high, the falling edge latches all eight buttons, and serial reads report
# A/B/Select/Start/Up/Down/Left/Right followed by trailing 1 bits. Only data line 0 is
# driven, so cpu_bus.gs merges the remaining bits from the open-bus latch.
#
# Scratch lists are 1-indexed, so every 0/1 controller index is converted to a list position
# at this one boundary.

%include src/numeric

# Live host button state per port, in A/B/Select/Start/Up/Down/Left/Right bit order.
list controller_button_masks = [0, 0];

# Latched serial report per port; bit 0 is the next reported button.
list controller_shift_registers = [0, 0];

var controller_strobe_high = 0;

# Clears serial latches and the strobe while preserving live button states, like reset().
proc controller_reset {
    controller_shift_registers[1] = 0;
    controller_shift_registers[2] = 0;
    controller_strobe_high = 0;
}

# Replaces one live button mask; mirrors set_button_mask().
proc controller_set_button_mask controller_index, button_mask {
    controller_button_masks[($controller_index + "") + 1] = ($button_mask + "") % 256;
}

# Returns the next serial D0 bit for one port; mirrors read_controller() before the bus merge.
func controller_serial_read(controller_index) {
    local port_position = ($controller_index + "") + 1;
    local shift_register = 0;

    # Both masks here are the single data line, and the shift register holds a byte, so every
    # bitwise helper call in this proc is a modulo: ">> 1 | 128" is the same as dividing by two
    # and adding 128, because the bit division clears and the add sets disjoint bits.
    if (controller_strobe_high + "") == 1 {
        return (controller_button_masks[port_position] + "") % 2;
    }

    shift_register = (controller_shift_registers[port_position] + "") % 256;
    controller_shift_registers[port_position] = (shift_register // 2) + 128;

    return shift_register % 2;
}

# While bit 0 is high A is polled live; the falling edge latches both ports.
proc controller_write_strobe value {
    local next_strobe = (($value + "") % 256) % 2;

    if (controller_strobe_high + "") == 1 and next_strobe == 0 {
        # The masks are stored as bytes by controller_set_button_mask, so the latch is a copy
        # and needs no second normalization.
        controller_shift_registers[1] = controller_button_masks[1];
        controller_shift_registers[2] = controller_button_masks[2];
    }

    controller_strobe_high = next_strobe;
}
