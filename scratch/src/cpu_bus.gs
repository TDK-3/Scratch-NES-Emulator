# CPU address decoder subset for the GoboScript port.
#
# Ports the parts of src/nes/cpu/nes_cpu_bus.ts that the current shared vectors cover:
# 2 KiB RAM mirrored across $0000-$1FFF, the open-bus data latch with per-device driven
# masks, the $4016/$4017 controller ports, and the "undriven read returns the retained
# latch" rule. PPU registers, APU registers, $4014 OAM DMA, and cartridge space are not
# ported yet: reads of those windows return the retained latch and writes are latched and
# then dropped, which is exactly what an absent device does in the TypeScript decoder.
#
# Scratch lists are 1-indexed, so the RAM window conversion happens in one place here.

%include src/numeric
%include src/controller

list cpu_ram = [0; 2048];
var cpu_open_bus = 0;

# Clears the bus latch like NesCpuBus.reset(); RAM contents survive a reset.
proc cpu_bus_reset {
    cpu_open_bus = 0;
}

# Merges a device value with the open-bus latch and re-latches the merged byte.
func cpu_apply_driven_value(value, driven_mask) {
    local driven = normalize_byte($driven_mask);
    local undriven = bitwise_xor(255, driven);
    local driven_bits = bitwise_and(normalize_byte($value), driven);
    local retained_bits = bitwise_and(cpu_open_bus, undriven);
    local merged = bitwise_or(driven_bits, retained_bits);
    cpu_open_bus = merged;

    return merged;
}

# Reads one CPU address; mirrors read_cpu() for the ported windows.
func cpu_bus_read(address) {
    local numeric_address = normalize_word($address);

    if numeric_address < 8192 {
        return cpu_apply_driven_value(cpu_ram[(numeric_address % 2048) + 1], 255);
    }

    if numeric_address < 16384 {
        # $2000-$3FFF: PPU registers are not ported yet, so no data line is driven.
        return cpu_open_bus;
    }

    if numeric_address < 16416 {
        return cpu_bus_read_io(numeric_address);
    }

    # $4020-$FFFF: cartridge space is not ported yet.
    return cpu_open_bus;
}

# Reads the $4000-$401F I/O window; unported devices drive no data lines.
func cpu_bus_read_io(address) {
    if $address == 16406 {
        return cpu_apply_driven_value(controller_serial_read(0), 1);
    }

    if $address == 16407 {
        return cpu_apply_driven_value(controller_serial_read(1), 1);
    }

    return cpu_open_bus;
}

# Writes one CPU address; mirrors write_cpu() for the ported windows.
proc cpu_bus_write address, value {
    local numeric_address = normalize_word($address);
    local numeric_value = normalize_byte($value);
    cpu_open_bus = numeric_value;

    if numeric_address < 8192 {
        cpu_ram[(numeric_address % 2048) + 1] = numeric_value;
    }

    if numeric_address == 16406 {
        controller_write_strobe numeric_value;
    }

    # PPU, APU, $4014 OAM DMA, and cartridge writes are not ported yet.
}
