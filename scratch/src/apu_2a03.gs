# APU 2A03 register dispatch, frame sequencer, and pulse channel for the
# GoboScript port.
#
# Ports the parts of src/nes/apu/apu_2a03.ts and src/nes/apu/pulse_channel.ts
# that the current shared vectors cover: the register write dispatch for
# $4000-$4013, $4015, and $4017, the $4015 status read, both pulse channels
# (control, sweep, timer, length counter, envelope, output), and the four-step
# and five-step frame sequencer. Triangle, noise, and DMC channels are not
# ported yet.

%include src/numeric

# ---- constants ----

var APU_PULSE_ONE_BASE = 16384;
var APU_PULSE_TWO_BASE = 16388;
var APU_PULSE_WINDOW = 4;
var APU_TRI_CONTROL = 16392;
var APU_TRI_TIMER_LOW = 16394;
var APU_TRI_TIMER_HIGH = 16395;
var APU_NOISE_CONTROL = 16396;
var APU_NOISE_PERIOD = 16398;
var APU_NOISE_LENGTH = 16399;
var APU_DMC_CONTROL = 16400;
var APU_DMC_OUTPUT = 16401;
var APU_DMC_SAMPLE_ADDR = 16402;
var APU_DMC_SAMPLE_LEN = 16403;
var APU_STATUS = 16405;
var APU_FRAME_COUNTER = 16407;

var PULSE_DUTY_SHIFT = 6;
var PULSE_DUTY_MASK = 3;
var PULSE_ENVELOPE_LOOP = 32;
var PULSE_ENVELOPE_CONSTANT = 16;
var PULSE_ENVELOPE_VOLUME_MASK = 15;
var PULSE_SWEEP_ENABLE = 128;
var PULSE_SWEEP_PERIOD_SHIFT = 4;
var PULSE_SWEEP_PERIOD_MASK = 7;
var PULSE_SWEEP_NEGATE = 8;
var PULSE_SWEEP_SHIFT_MASK = 7;
var PULSE_TIMER_LOW_MASK = 255;
var PULSE_TIMER_HIGH_MASK = 7;
var PULSE_TIMER_MAX = 2047;
var PULSE_TIMER_MIN = 8;
var PULSE_LENGTH_INDEX_SHIFT = 3;

var PULSE_ONE_ENABLE = 1;
var PULSE_TWO_ENABLE = 2;
var TRIANGLE_ENABLE = 4;
var NOISE_ENABLE = 8;
var DMC_ENABLE = 16;
var DMC_IRQ_STATUS = 128;
var FRAME_IRQ_STATUS = 64;
var FRAME_IRQ_INHIBIT = 64;
var FIVE_STEP_MODE = 128;
var APU_STATUS_DRIVEN = 223;
var FULL_BYTE = 255;

# ---- length counter table ----

# The 32-entry length counter table the 2A03 uses for the five-bit length
# index in registers $4003/$4007/$400B/$400F.
# The 32-entry length counter table the 2A03 uses for the five-bit length
# index in registers $4003/$4007/$400B/$400F. Populated at reset time.
list apu_length_table = [0; 32];

# ---- duty cycle sequences ----

# The eight-step duty sequences for the four duty modes.
list apu_duty_0 = [0, 1, 0, 0, 0, 0, 0, 0];
list apu_duty_1 = [0, 1, 1, 0, 0, 0, 0, 0];
list apu_duty_2 = [0, 1, 1, 1, 1, 0, 0, 0];
list apu_duty_3 = [1, 0, 0, 1, 1, 1, 1, 1];

# ---- frame sequencer timing ----

# Four-step events: (cycle, quarter_frame, half_frame)
# 7457: Q, 14913: QH, 22371: Q, 29829: QH
# Five-step events:
# 7457: Q, 14913: QH, 22371: Q, 29829: none, 37281: QH
var FOUR_STEP_IRQ_CYCLE = 29829;
var FOUR_STEP_LIMIT = 29830;
var FIVE_STEP_LIMIT = 37282;

# ---- pulse channel state ----

# Pulse channel 1 state
var pulse1_enabled = 0;
var pulse1_control = 0;
var pulse1_sweep_enabled = 0;
var pulse1_sweep_period = 1;
var pulse1_sweep_negate = 0;
var pulse1_sweep_shift = 0;
var pulse1_sweep_divider = 0;
var pulse1_sweep_reload = 0;
var pulse1_timer_period = 0;
var pulse1_timer_counter = 0;
var pulse1_duty_step = 0;
var pulse1_length = 0;
var pulse1_envelope_start = 0;
var pulse1_envelope_divider = 0;
var pulse1_envelope_decay = 0;

# Pulse channel 2 state
var pulse2_enabled = 0;
var pulse2_control = 0;
var pulse2_sweep_enabled = 0;
var pulse2_sweep_period = 1;
var pulse2_sweep_negate = 0;
var pulse2_sweep_shift = 0;
var pulse2_sweep_divider = 0;
var pulse2_sweep_reload = 0;
var pulse2_timer_period = 0;
var pulse2_timer_counter = 0;
var pulse2_duty_step = 0;
var pulse2_length = 0;
var pulse2_envelope_start = 0;
var pulse2_envelope_divider = 0;
var pulse2_envelope_decay = 0;

# ---- frame sequencer state ----

var apu_cpu_cycle_count = 0;
var apu_pulse_timer_phase = 0;
var apu_frame_cycle_count = 0;
var apu_frame_reset_delay = -1;
var apu_five_step_mode = 0;
var apu_frame_irq_inhibited = 0;
var apu_frame_irq = 0;

# ---- status read result ----

var apu_status_value = 0;
var apu_status_driven_mask = 0;

# ---- error code ----

var apu_register_error = 0;

enum apu_register_status {
    ok = 0,
    value_out_of_range = 1,
    address_out_of_range = 2
}

# ---- reset ----

proc apu_reset {
    # Populate the length counter table if not already done.
    if to_number(apu_length_table[1]) == 0 {
        apu_length_table[1] = 10;
        apu_length_table[2] = 254;
        apu_length_table[3] = 20;
        apu_length_table[4] = 2;
        apu_length_table[5] = 40;
        apu_length_table[6] = 4;
        apu_length_table[7] = 80;
        apu_length_table[8] = 6;
        apu_length_table[9] = 160;
        apu_length_table[10] = 8;
        apu_length_table[11] = 60;
        apu_length_table[12] = 10;
        apu_length_table[13] = 14;
        apu_length_table[14] = 12;
        apu_length_table[15] = 26;
        apu_length_table[16] = 14;
        apu_length_table[17] = 12;
        apu_length_table[18] = 16;
        apu_length_table[19] = 24;
        apu_length_table[20] = 18;
        apu_length_table[21] = 48;
        apu_length_table[22] = 20;
        apu_length_table[23] = 96;
        apu_length_table[24] = 22;
        apu_length_table[25] = 192;
        apu_length_table[26] = 24;
        apu_length_table[27] = 72;
        apu_length_table[28] = 26;
        apu_length_table[29] = 16;
        apu_length_table[30] = 28;
        apu_length_table[31] = 32;
        apu_length_table[32] = 30;
    }

    pulse1_enabled = 0;
    pulse1_control = 0;
    pulse1_sweep_enabled = 0;
    pulse1_sweep_period = 1;
    pulse1_sweep_negate = 0;
    pulse1_sweep_shift = 0;
    pulse1_sweep_divider = 0;
    pulse1_sweep_reload = 0;
    pulse1_timer_period = 0;
    pulse1_timer_counter = 0;
    pulse1_duty_step = 0;
    pulse1_length = 0;
    pulse1_envelope_start = 0;
    pulse1_envelope_divider = 0;
    pulse1_envelope_decay = 0;
    pulse2_enabled = 0;
    pulse2_control = 0;
    pulse2_sweep_enabled = 0;
    pulse2_sweep_period = 1;
    pulse2_sweep_negate = 0;
    pulse2_sweep_shift = 0;
    pulse2_sweep_divider = 0;
    pulse2_sweep_reload = 0;
    pulse2_timer_period = 0;
    pulse2_timer_counter = 0;
    pulse2_duty_step = 0;
    pulse2_length = 0;
    pulse2_envelope_start = 0;
    pulse2_envelope_divider = 0;
    pulse2_envelope_decay = 0;
    apu_cpu_cycle_count = 0;
    apu_pulse_timer_phase = 0;
    apu_frame_cycle_count = 0;
    apu_frame_reset_delay = -1;
    apu_five_step_mode = 0;
    apu_frame_irq_inhibited = 0;
    apu_frame_irq = 0;
    apu_register_error = 0;
}

# ---- register write ----

proc apu_write_register address, value {
    local addr = to_number($address);
    local byte_value = normalize_byte($value);
    apu_register_error = apu_register_status.ok;

    if addr >= APU_PULSE_ONE_BASE and addr < APU_PULSE_ONE_BASE + APU_PULSE_WINDOW {
        apu_write_pulse 1, addr - APU_PULSE_ONE_BASE, byte_value;
    } elif addr >= APU_PULSE_TWO_BASE and addr < APU_PULSE_TWO_BASE + APU_PULSE_WINDOW {
        apu_write_pulse 2, addr - APU_PULSE_TWO_BASE, byte_value;
    } elif addr == APU_STATUS {
        apu_write_status byte_value;
    } elif addr == APU_FRAME_COUNTER {
        apu_write_frame_counter byte_value;
    }
    # Triangle, noise, and DMC registers are latched and dropped for now.
}

# Writes one pulse channel register (index 0-3 within the four-byte window).
proc apu_write_pulse channel, register_index, value {
    local reg = $register_index % 4;

    if $channel == 1 {
        if reg == 0 {
            pulse1_control = $value;
        } elif reg == 1 {
            apu_write_pulse_sweep 1, $value;
        } elif reg == 2 {
            pulse1_timer_period = (pulse1_timer_period - (pulse1_timer_period % 256)) + $value;
        } elif reg == 3 {
            local timer_high = ($value % 8) * 256;
            pulse1_timer_period = (pulse1_timer_period % 256) + timer_high;
            pulse1_timer_counter = pulse1_timer_period;
            pulse1_duty_step = 0;
            pulse1_envelope_start = 1;

            if pulse1_enabled == 1 {
                local length_index = $value // 8;
                pulse1_length = to_number(apu_length_table[length_index + 1]);
            }
        }
    } else {
        if reg == 0 {
            pulse2_control = $value;
        } elif reg == 1 {
            apu_write_pulse_sweep 2, $value;
        } elif reg == 2 {
            pulse2_timer_period = (pulse2_timer_period - (pulse2_timer_period % 256)) + $value;
        } elif reg == 3 {
            local timer_high = ($value % 8) * 256;
            pulse2_timer_period = (pulse2_timer_period % 256) + timer_high;
            pulse2_timer_counter = pulse2_timer_period;
            pulse2_duty_step = 0;
            pulse2_envelope_start = 1;

            if pulse2_enabled == 1 {
                local length_index = $value // 8;
                pulse2_length = to_number(apu_length_table[length_index + 1]);
            }
        }
    }
}

# Writes the sweep register for a pulse channel.
proc apu_write_pulse_sweep channel, value {
    local enabled = bitwise_and($value, PULSE_SWEEP_ENABLE);
    local period = (bitwise_and($value // 16, PULSE_SWEEP_PERIOD_MASK)) + 1;
    local negate = bitwise_and($value, PULSE_SWEEP_NEGATE);
    local shift = bitwise_and($value, PULSE_SWEEP_SHIFT_MASK);

    if $channel == 1 {
        pulse1_sweep_enabled = enabled != 0;
        pulse1_sweep_period = period;
        pulse1_sweep_negate = negate != 0;
        pulse1_sweep_shift = shift;
        pulse1_sweep_reload = 1;
    } else {
        pulse2_sweep_enabled = enabled != 0;
        pulse2_sweep_period = period;
        pulse2_sweep_negate = negate != 0;
        pulse2_sweep_shift = shift;
        pulse2_sweep_reload = 1;
    }
}

# Writes $4015: enable/disable channels.
proc apu_write_status value {
    local p1 = bitwise_and($value, PULSE_ONE_ENABLE) != 0;
    local p2 = bitwise_and($value, PULSE_TWO_ENABLE) != 0;

    pulse1_enabled = p1;

    if p1 == 0 {
        pulse1_length = 0;
    }

    pulse2_enabled = p2;

    if p2 == 0 {
        pulse2_length = 0;
    }
    # Triangle, noise, DMC enable bits are latched but not yet ported.
}

# Writes $4017: frame counter mode and IRQ inhibit.
proc apu_write_frame_counter value {
    apu_five_step_mode = bitwise_and($value, FIVE_STEP_MODE) != 0;
    apu_frame_irq_inhibited = bitwise_and($value, FRAME_IRQ_INHIBIT) != 0;

    if apu_frame_irq_inhibited == 1 {
        apu_frame_irq = 0;
    }

    if (apu_cpu_cycle_count % 2) == 0 {
        apu_frame_reset_delay = 3;
    } else {
        apu_frame_reset_delay = 4;
    }
}

# ---- register read ----

# Reads $4015 status. The result is in apu_status_value with driven mask
# in apu_status_driven_mask.
proc apu_read_status {
    local value = 0;

    if pulse1_length > 0 {
        value = value + PULSE_ONE_ENABLE;
    }

    if pulse2_length > 0 {
        value = value + PULSE_TWO_ENABLE;
    }

    if apu_frame_irq == 1 {
        value = value + FRAME_IRQ_STATUS;
    }
    # Triangle, noise, DMC status bits are not ported yet.

    apu_status_value = value;
    apu_status_driven_mask = APU_STATUS_DRIVEN;
    apu_frame_irq = 0;
}

# ---- clocking ----

# Clocks one CPU cycle: advances channel timers and the frame sequencer.
proc apu_clock_cpu_cycle {
    apu_cpu_cycle_count = apu_cpu_cycle_count + 1;
    apu_pulse_timer_phase = 1 - apu_pulse_timer_phase;

    if apu_pulse_timer_phase == 1 {
        apu_clock_pulse_timer 1;
        apu_clock_pulse_timer 2;
    }

    apu_clock_frame_sequencer;

    if apu_frame_reset_delay >= 0 {
        apu_frame_reset_delay = apu_frame_reset_delay - 1;

        if apu_frame_reset_delay == 0 {
            apu_frame_cycle_count = 0;
            apu_frame_reset_delay = -1;

            if apu_five_step_mode == 1 {
                apu_clock_quarter_frame;
                apu_clock_half_frame;
            }
        }
    }
}

# Clocks one pulse channel timer (called at half CPU rate).
proc apu_clock_pulse_timer channel {
    if $channel == 1 {
        if pulse1_timer_counter == 0 {
            pulse1_timer_counter = pulse1_timer_period;
            pulse1_duty_step = (pulse1_duty_step + 1) % 8;
        } else {
            pulse1_timer_counter = pulse1_timer_counter - 1;
        }
    } else {
        if pulse2_timer_counter == 0 {
            pulse2_timer_counter = pulse2_timer_period;
            pulse2_duty_step = (pulse2_duty_step + 1) % 8;
        } else {
            pulse2_timer_counter = pulse2_timer_counter - 1;
        }
    }
}

# Clocks the frame sequencer: emits quarter-frame and half-frame events
# at the scheduled cycles.
proc apu_clock_frame_sequencer {
    apu_frame_cycle_count = apu_frame_cycle_count + 1;
    local quarter = 0;
    local half = 0;

    if apu_five_step_mode == 0 {
        # Four-step mode
        if apu_frame_cycle_count == 7457 {
            quarter = 1;
        }

        if apu_frame_cycle_count == 14913 {
            quarter = 1;
            half = 1;
        }

        if apu_frame_cycle_count == 22371 {
            quarter = 1;
        }

        if apu_frame_cycle_count == 29829 {
            quarter = 1;
            half = 1;
        }

        if apu_frame_cycle_count == FOUR_STEP_IRQ_CYCLE {
            if apu_frame_irq_inhibited == 0 {
                apu_frame_irq = 1;
            }
        }

        if apu_frame_cycle_count >= FOUR_STEP_LIMIT {
            apu_frame_cycle_count = 0;
        }
    } else {
        # Five-step mode
        if apu_frame_cycle_count == 7457 {
            quarter = 1;
        }

        if apu_frame_cycle_count == 14913 {
            quarter = 1;
            half = 1;
        }

        if apu_frame_cycle_count == 22371 {
            quarter = 1;
        }

        if apu_frame_cycle_count == 37281 {
            quarter = 1;
            half = 1;
        }

        if apu_frame_cycle_count >= FIVE_STEP_LIMIT {
            apu_frame_cycle_count = 0;
        }
    }

    if quarter == 1 {
        apu_clock_quarter_frame;
    }

    if half == 1 {
        apu_clock_half_frame;
    }
}

# Quarter-frame event: clocks envelopes.
proc apu_clock_quarter_frame {
    apu_clock_pulse_envelope 1;
    apu_clock_pulse_envelope 2;
}

# Half-frame event: clocks length counters and sweep.
proc apu_clock_half_frame {
    apu_clock_pulse_half_frame 1;
    apu_clock_pulse_half_frame 2;
}

# Clocks one pulse channel's envelope.
proc apu_clock_pulse_envelope channel {
    if $channel == 1 {
        if pulse1_envelope_start == 1 {
            pulse1_envelope_start = 0;
            pulse1_envelope_decay = 15;
            pulse1_envelope_divider = pulse1_control % 16;
        } elif pulse1_envelope_divider > 0 {
            pulse1_envelope_divider = pulse1_envelope_divider - 1;
        } else {
            pulse1_envelope_divider = pulse1_control % 16;

            if pulse1_envelope_decay > 0 {
                pulse1_envelope_decay = pulse1_envelope_decay - 1;
            } elif bitwise_and(pulse1_control, PULSE_ENVELOPE_LOOP) != 0 {
                pulse1_envelope_decay = 15;
            }
        }
    } else {
        if pulse2_envelope_start == 1 {
            pulse2_envelope_start = 0;
            pulse2_envelope_decay = 15;
            pulse2_envelope_divider = pulse2_control % 16;
        } elif pulse2_envelope_divider > 0 {
            pulse2_envelope_divider = pulse2_envelope_divider - 1;
        } else {
            pulse2_envelope_divider = pulse2_control % 16;

            if pulse2_envelope_decay > 0 {
                pulse2_envelope_decay = pulse2_envelope_decay - 1;
            } elif bitwise_and(pulse2_control, PULSE_ENVELOPE_LOOP) != 0 {
                pulse2_envelope_decay = 15;
            }
        }
    }
}

# Half-frame event for one pulse channel: length counter + sweep.
proc apu_clock_pulse_half_frame channel {
    if $channel == 1 {
        if pulse1_length > 0 {
            if bitwise_and(pulse1_control, PULSE_ENVELOPE_LOOP) == 0 {
                pulse1_length = pulse1_length - 1;
            }
        }

        apu_clock_pulse_sweep 1;
    } else {
        if pulse2_length > 0 {
            if bitwise_and(pulse2_control, PULSE_ENVELOPE_LOOP) == 0 {
                pulse2_length = pulse2_length - 1;
            }
        }

        apu_clock_pulse_sweep 2;
    }
}

# Clocks one pulse channel's sweep unit.
proc apu_clock_pulse_sweep channel {
    if $channel == 1 {
        if pulse1_sweep_reload == 1 {
            pulse1_sweep_divider = pulse1_sweep_period;
            pulse1_sweep_reload = 0;
        } elif pulse1_sweep_divider > 0 {
            pulse1_sweep_divider = pulse1_sweep_divider - 1;
        } else {
            if pulse1_sweep_enabled == 1 and pulse1_sweep_shift > 0 {
                if apu_pulse_sweep_in_range(1) == 1 {
                    pulse1_timer_period = apu_pulse_sweep_target(1);
                }
            }

            pulse1_sweep_divider = pulse1_sweep_period;
        }
    } else {
        if pulse2_sweep_reload == 1 {
            pulse2_sweep_divider = pulse2_sweep_period;
            pulse2_sweep_reload = 0;
        } elif pulse2_sweep_divider > 0 {
            pulse2_sweep_divider = pulse2_sweep_divider - 1;
        } else {
            if pulse2_sweep_enabled == 1 and pulse2_sweep_shift > 0 {
                if apu_pulse_sweep_in_range(2) == 1 {
                    pulse2_timer_period = apu_pulse_sweep_target(2);
                }
            }

            pulse2_sweep_divider = pulse2_sweep_period;
        }
    }
}

# ---- output getters ----

# Returns the pulse output for one channel (0-15).
func apu_get_pulse_output(channel) {
    if $channel == 1 {
        return apu_pulse_output(
            pulse1_length,
            pulse1_control,
            pulse1_duty_step,
            pulse1_timer_period,
            pulse1_sweep_negate,
            pulse1_sweep_shift,
            pulse1_envelope_decay
        );
    }

    return apu_pulse_output(
        pulse2_length,
        pulse2_control,
        pulse2_duty_step,
        pulse2_timer_period,
        pulse2_sweep_negate,
        pulse2_sweep_shift,
        pulse2_envelope_decay
    );
}

# Computes one pulse channel's DAC output.
func apu_pulse_output(length_counter, control, duty_step, timer_period, sweep_negate, sweep_shift, envelope_decay) {
    if $length_counter == 0 {
        return 0;
    }

    if $timer_period < PULSE_TIMER_MIN {
        return 0;
    }

    if $sweep_negate == 0 {
        if apu_sweep_target_would_oor($timer_period, $sweep_shift) == 1 {
            return 0;
        }
    }

    local duty = ($control // 64) % 4;
    local duty_bit = 0;

    if duty == 0 {
        duty_bit = to_number(apu_duty_0[$duty_step + 1]);
    } elif duty == 1 {
        duty_bit = to_number(apu_duty_1[$duty_step + 1]);
    } elif duty == 2 {
        duty_bit = to_number(apu_duty_2[$duty_step + 1]);
    } else {
        duty_bit = to_number(apu_duty_3[$duty_step + 1]);
    }

    if duty_bit == 0 {
        return 0;
    }

    if bitwise_and($control, PULSE_ENVELOPE_CONSTANT) != 0 {
        return $control % 16;
    }

    return $envelope_decay;
}

# Returns the length counter for one pulse channel.
func apu_get_pulse_length(channel) {
    if $channel == 1 {
        return pulse1_length;
    }

    return pulse2_length;
}

# Returns whether the frame IRQ line is asserted.
func apu_is_frame_irq_asserted() {
    return apu_frame_irq;
}

# Returns whether any APU IRQ line is asserted.
func apu_is_irq_asserted() {
    return apu_frame_irq;
}

# ---- sweep helpers ----

# Computes the sweep target for one pulse channel.
func apu_pulse_sweep_target(channel) {
    local timer = 0;
    local shift = 0;
    local negate = 0;

    if $channel == 1 {
        timer = pulse1_timer_period;
        shift = pulse1_sweep_shift;
        negate = pulse1_sweep_negate;
    } else {
        timer = pulse2_timer_period;
        shift = pulse2_sweep_shift;
        negate = pulse2_sweep_negate;
    }

    local change = timer // apu_power_of_two($shift);

    if negate == 1 {
        if $channel == 1 {
            return timer - change - 1;
        }

        return timer - change;
    }

    return timer + change;
}

# Returns whether the sweep target is in range for one channel.
func apu_pulse_sweep_in_range(channel) {
    local target = apu_pulse_sweep_target($channel);

    if target < 0 or target > PULSE_TIMER_MAX {
        return 0;
    }

    return 1;
}

# Returns whether a non-negated sweep target would be out of range.
func apu_sweep_target_would_oor(timer_period, sweep_shift) {
    if $sweep_shift == 0 {
        return 0;
    }

    local change = $timer_period // apu_power_of_two($sweep_shift);
    local target = $timer_period + change;

    if target > PULSE_TIMER_MAX {
        return 1;
    }

    return 0;
}

# ---- power of two helper ----

# Computes 2^exponent using integer multiplication in a loop, since
# GoboScript has no shift operator.
func apu_power_of_two(exponent) {
    local result = 1;

    repeat $exponent {
        result = result * 2;
    }

    return result;
}
