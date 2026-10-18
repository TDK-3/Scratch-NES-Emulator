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
%include src/mapper
%include src/mapper_000
%include src/mapper_004
%include src/ppu_bus
%include src/ppu_2c02

list cpu_ram = [0; 2048];
var cpu_open_bus = 0;

# The board the cartridge loader attached, using mapper_kind. Zero leaves the cartridge window
# without a device, so its reads return the latch and its writes are dropped, exactly as the
# reference bus behaves with an absent cartridge port.
var cpu_bus_cartridge_kind = 0;

# Clears the bus latch like NesCpuBus.reset(); RAM contents survive a reset.
proc cpu_bus_reset {
    cpu_open_bus = 0;
    ppu_reset;
}

# Zeroes RAM. NesCpuBus starts every instance with cleared RAM, so a shared-vector record
# that reads an address it never wrote must see zero on both sides.
proc cpu_bus_clear_ram {
    local index = 1;

    repeat 2048 {
        cpu_ram[index] = 0;
        index++;
    }
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
        # $2000-$3FFF: PPU registers, mirrored every 8 bytes.
        local ppu_register = numeric_address % 8;
        ppu_read_cpu_register ppu_register;
        local ppu_value = ppu_read_result;

        if ppu_register == 2 or ppu_register == 4 or ppu_register == 7 {
            return cpu_apply_driven_value(ppu_value, 255);
        }

        # Write-only registers and unimplemented ports return the retained latch.
        return cpu_open_bus;
    }

    if numeric_address < 16416 {
        return cpu_bus_read_io(numeric_address);
    }

    # $4020-$FFFF: an attached board drives the addresses it maps, and the rest of the window
    # still returns the latch, because NROM does not answer below $6000.
    if cpu_bus_cartridge_kind == mapper_kind.nrom {
        nrom_read_cpu numeric_address;

        if nrom_cpu_mapped == 1 {
            return cpu_apply_driven_value(nrom_cpu_value, nrom_cpu_driven_mask);
        }
    } elif cpu_bus_cartridge_kind == mapper_kind.mmc3 {
        mmc3_read_cpu numeric_address;

        if mmc3_cpu_mapped == 1 {
            return cpu_apply_driven_value(mmc3_cpu_value, mmc3_cpu_driven_mask);
        }
    }

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

    if numeric_address < 16384 {
        # $2000-$3FFF: PPU registers, mirrored every 8 bytes.
        local ppu_register = numeric_address % 8;
        ppu_write_cpu_register ppu_register, numeric_value;
    }

    if numeric_address < 8192 {
        cpu_ram[(numeric_address % 2048) + 1] = numeric_value;
    }

    if numeric_address == 16406 {
        controller_write_strobe numeric_value;
    }

    if cpu_bus_cartridge_kind == mapper_kind.nrom {
        nrom_write_cpu numeric_address, numeric_value;
    } elif cpu_bus_cartridge_kind == mapper_kind.mmc3 {
        mmc3_write_cpu numeric_address, numeric_value;
    }

    # APU and $4014 OAM DMA writes are not ported yet.
}
