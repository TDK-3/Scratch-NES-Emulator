# CPU address decoder subset for the GoboScript port.
#
# Ports the parts of src/nes/cpu/nes_cpu_bus.ts that the current shared vectors cover:
# 2 KiB RAM mirrored across $0000-$1FFF, the open-bus data latch with per-device driven
# masks, the $2000-$3FFF PPU register window, the $4015 APU status register, the
# $4016/$4017 controller ports, the APU register writes, the $4014 OAM DMA stall with
# alignment cycle, the cartridge window an attached board drives, and the "undriven read
# returns the retained latch" rule.
#
# Each device window can be detached, which is what an absent device does in the
# TypeScript decoder: the window is left undriven, so its reads return the retained latch
# and its writes are dropped. The emulator attaches every device; the shared-vector replay
# detaches the devices the TypeScript reference replays without, so both sides see the
# same open-bus behavior.
#
# Scratch lists are 1-indexed, so the RAM window conversion happens in one place here.

%include src/numeric
%include src/controller
%include src/mapper
%include src/mapper_000
%include src/mapper_004
%include src/ppu_bus
%include src/ppu_2c02
%include src/apu_2a03

list cpu_ram = [0; 2048];
var cpu_open_bus = 0;
var cpu_bus_cycle_count = 0;

# OAM DMA state machine. A write to $4014 triggers a transfer from a 256-byte page to OAM.
# The state machine has four phases: halt (setup), align (optional alignment cycle),
# read (read from source), and write (write to $2004). Total cycles: 513 if even, 514 if odd.
enum cpu_dma_phase {
    idle = 0,
    halt = 1,
    align = 2,
    read = 3,
    write = 4
}

var cpu_dma_phase = 0;
var cpu_dma_page = 0;
var cpu_dma_index = 0;
var cpu_dma_data_latch = 0;
var cpu_dma_sequence_cycle = 0;
var cpu_dma_alignment_cycle_needed = 0;

# The board the cartridge loader attached, using mapper_kind. Zero leaves the cartridge window
# without a device, so its reads return the latch and its writes are dropped, exactly as the
# reference bus behaves with an absent cartridge port.
var cpu_bus_cartridge_kind = 0;

# Which devices the bus drives. A detached device leaves its window undriven: reads return the
# retained latch and writes are dropped, exactly as the reference bus behaves with an absent
# device. The emulator keeps all three attached; the shared-vector replay detaches the ones
# the TypeScript reference replays without.
var cpu_bus_ppu_attached = 1;
var cpu_bus_apu_attached = 1;
var cpu_bus_controllers_attached = 1;

# Clears the bus latch like NesCpuBus.reset(); RAM contents survive a reset.
proc cpu_bus_reset {
    cpu_open_bus = 0;
    cpu_bus_cycle_count = 0;

    # NesCpuBus.reset() also drops a pending OAM DMA transfer, so the port's DMA state
    # machine starts idle again.
    cpu_dma_phase = cpu_dma_phase.idle;
    cpu_dma_index = 0;
    cpu_dma_data_latch = 0;
    cpu_dma_sequence_cycle = 0;
    cpu_dma_alignment_cycle_needed = 0;
    ppu_reset;
    apu_reset;
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
    cpu_bus_cycle_count = cpu_bus_cycle_count + 1;

    if numeric_address < 8192 {
        return cpu_apply_driven_value(cpu_ram[(numeric_address % 2048) + 1], 255);
    }

    if numeric_address < 16384 {
        # $2000-$3FFF: PPU registers, mirrored every 8 bytes.
        if cpu_bus_ppu_attached == 1 {
            local ppu_register = numeric_address % 8;
            ppu_read_cpu_register ppu_register;
            local ppu_value = ppu_read_result;

            if ppu_register == 2 or ppu_register == 4 or ppu_register == 7 {
                return cpu_apply_driven_value(ppu_value, 255);
            }
        }

        # A detached PPU, a write-only register, and an unimplemented port all leave the
        # window undriven, so the read returns the retained latch.
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

# Reads the $4000-$401F I/O window; a detached device drives no data lines.
func cpu_bus_read_io(address) {
    if $address == 16405 and cpu_bus_apu_attached == 1 {
        apu_read_status;
        return cpu_apply_driven_value(apu_status_value, apu_status_driven_mask);
    }

    if $address == 16406 and cpu_bus_controllers_attached == 1 {
        return cpu_apply_driven_value(controller_serial_read(0), 1);
    }

    if $address == 16407 and cpu_bus_controllers_attached == 1 {
        return cpu_apply_driven_value(controller_serial_read(1), 1);
    }

    return cpu_open_bus;
}

# Writes one CPU address; mirrors write_cpu() for the ported windows.
proc cpu_bus_write address, value {
    local numeric_address = normalize_word($address);
    local numeric_value = normalize_byte($value);
    cpu_open_bus = numeric_value;
    cpu_bus_cycle_count = cpu_bus_cycle_count + 1;

    if numeric_address < 8192 {
        # $0000-$1FFF: 2 KiB of RAM, mirrored across the window.
        cpu_ram[(numeric_address % 2048) + 1] = numeric_value;
    } elif numeric_address < 16384 {
        # $2000-$3FFF: PPU registers, mirrored every 8 bytes. The RAM window is decoded
        # first, so a RAM write never reaches a PPU register.
        if cpu_bus_ppu_attached == 1 {
            local ppu_register = numeric_address % 8;
            ppu_write_cpu_register ppu_register, numeric_value;
        }
    }

    if cpu_bus_apu_attached == 1 {
        # $4000-$4013 and $4015/$4017 are APU registers; $4014 is the bus's own OAM DMA and
        # $4016 belongs to the controller port, so neither reaches the APU.
        if numeric_address >= 16384 and numeric_address <= 16403 {
            apu_write_register numeric_address, numeric_value;
        } elif numeric_address == 16405 or numeric_address == 16407 {
            apu_write_register numeric_address, numeric_value;
        }
    }

    if numeric_address == 16406 and cpu_bus_controllers_attached == 1 {
        controller_write_strobe numeric_value;
    }

    # $4014 OAM DMA: set up the DMA state machine. The alignment cycle is needed if the write
    # happens on an odd cycle (cpu_cycle_count % 2 == 1).
    if numeric_address == 16404 {
        cpu_dma_phase = cpu_dma_phase.halt;
        cpu_dma_page = numeric_value;
        cpu_dma_index = 0;
        cpu_dma_data_latch = 0;
        cpu_dma_sequence_cycle = 0;

        # Alignment cycle needed if current cycle count is odd.
        cpu_dma_alignment_cycle_needed = cpu_bus_cycle_count % 2;
    }

    if cpu_bus_cartridge_kind == mapper_kind.nrom {
        nrom_write_cpu numeric_address, numeric_value;
    } elif cpu_bus_cartridge_kind == mapper_kind.mmc3 {
        mmc3_write_cpu numeric_address, numeric_value;
    }
}
# Clocks one DMA cycle. Returns 1 if a DMA cycle was executed, 0 if no DMA is active.
# The DMA state machine: halt -> align (optional) -> read -> write (repeat 256 times).
func cpu_clock_dma_cycle() {
    if cpu_dma_phase == cpu_dma_phase.idle {
        return 0;
    }

    cpu_dma_sequence_cycle = cpu_dma_sequence_cycle + 1;
    cpu_bus_cycle_count = cpu_bus_cycle_count + 1;

    if cpu_dma_phase == cpu_dma_phase.halt {
        # Halt cycle: dummy read from the address the CPU was about to read.
        # The actual address doesn't matter for the port; we just burn a cycle.
        if cpu_dma_alignment_cycle_needed == 1 {
            cpu_dma_phase = cpu_dma_phase.align;
        } else {
            cpu_dma_phase = cpu_dma_phase.read;
        }

        return 1;
    }

    if cpu_dma_phase == cpu_dma_phase.align {
        # Alignment cycle: another dummy read.
        cpu_dma_phase = cpu_dma_phase.read;

        return 1;
    }

    if cpu_dma_phase == cpu_dma_phase.read {
        # Read cycle: read from (page << 8) | index.
        local source_address = cpu_dma_page * 256 + cpu_dma_index;
        cpu_dma_data_latch = cpu_bus_read(source_address);
        cpu_dma_phase = cpu_dma_phase.write;

        return 1;
    }

    if cpu_dma_phase == cpu_dma_phase.write {
        # Write cycle: write to $2004 (OAMDATA).
        ppu_write_cpu_register 4, cpu_dma_data_latch;
        cpu_dma_index = cpu_dma_index + 1;

        if cpu_dma_index >= 256 {
            # Transfer complete.
            cpu_dma_phase = cpu_dma_phase.idle;
        } else {
            # Continue with next read.
            cpu_dma_phase = cpu_dma_phase.read;
        }

        return 1;
    }

    return 0;
}
