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
    controller_button_masks[$controller_index + 1] = normalize_byte($button_mask);
}

# Returns the next serial D0 bit for one port; mirrors read_controller() before the bus merge.
func controller_serial_read(controller_index) {
    local port_position = to_number($controller_index) + 1;

    if controller_strobe_high == 1 {
        return bitwise_and(controller_button_masks[port_position], 1);
    }

    local shift_register = normalize_byte(controller_shift_registers[port_position]);
    controller_shift_registers[port_position] = bitwise_or(shift_register // 2, 128);

    return bitwise_and(shift_register, 1);
}

# While bit 0 is high A is polled live; the falling edge latches both ports.
proc controller_write_strobe value {
    local next_strobe = bitwise_and(normalize_byte($value), 1);

    if (controller_strobe_high == 1) and (next_strobe == 0) {
        controller_shift_registers[1] = normalize_byte(controller_button_masks[1]);
        controller_shift_registers[2] = normalize_byte(controller_button_masks[2]);
    }

    controller_strobe_high = next_strobe;
}
