# APU 2A03 register dispatch, frame sequencer, and all audio channels
# for the GoboScript port.
#
# Ports the parts of src/nes/apu/apu_2a03.ts, src/nes/apu/pulse_channel.ts,
# src/nes/apu/triangle_channel.ts, src/nes/apu/noise_channel.ts,
# src/nes/apu/dmc_channel.ts, and src/nes/apu/mixer.ts that the current
# shared vectors cover: the register write dispatch for $4000-$4013, $4015,
# and $4017, the $4015 status read, both pulse channels (control, sweep,
# timer, length counter, envelope, output), the triangle channel (linear
# counter, timer, sequencer), the noise channel (LFSR, timer, envelope,
# length counter), the DMC channel (sample reader, output unit, timer, IRQ),
# the nonlinear pulse+TND mixer, and the four-step and five-step frame
# sequencer.

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

# ---- triangle channel constants ----

var TRIANGLE_CONTROL_LENGTH_HALT = 128;
var TRIANGLE_LINEAR_RELOAD_MASK = 127;
var TRIANGLE_TIMER_LOW_MASK = 255;
var TRIANGLE_TIMER_HIGH_MASK = 7;
var TRIANGLE_TIMER_HIGH_SHIFT = 8;
var TRIANGLE_TIMER_MAX = 2047;
var TRIANGLE_TIMER_MIN = 2;
var TRIANGLE_SEQUENCE_LENGTH = 32;

# Triangle waveform sequence: 0-15 up, 15-0 down
# Initialized in apu_reset to avoid line length limits.
list apu_triangle_sequence = [0; 32];

# ---- triangle channel state ----

var triangle_enabled = 0;
var triangle_length_halt = 0;
var triangle_linear_reload_value = 0;
var triangle_linear_counter = 0;
var triangle_linear_reload_flag = 0;
var triangle_timer_period = 0;
var triangle_timer_counter = 0;
var triangle_sequence_step = 0;
var triangle_length_counter = 0;

# ---- noise channel constants ----

var NOISE_LENGTH_HALT_ENVELOPE_LOOP = 32;
var NOISE_CONSTANT_VOLUME = 16;
var NOISE_VOLUME_MASK = 15;
var NOISE_MODE_MASK = 128;
var NOISE_PERIOD_INDEX_MASK = 15;
var NOISE_LONG_MODE_FEEDBACK_TAP = 1;
var NOISE_SHORT_MODE_FEEDBACK_TAP = 6;
var NOISE_LFSR_REGISTER_MASK = 32767;
var NOISE_LFSR_OUTPUT_MASK = 1;
var NOISE_LFSR_FEEDBACK_BIT = 16384;

# NTSC noise timer periods (16 entries). Initialized in apu_reset.
list apu_noise_periods = [0; 16];

# ---- noise channel state ----

var noise_enabled = 0;
var noise_control = 0;
var noise_mode = 0;
var noise_timer_period = 0;
var noise_timer_reload = 0;
var noise_timer_counter = 0;
var noise_shift_register = 1;
var noise_length_counter = 0;
var noise_envelope_start = 0;
var noise_envelope_divider = 0;
var noise_envelope_decay = 0;

# ---- DMC channel constants ----

var DMC_IRQ_ENABLE = 128;
var DMC_LOOP = 64;
var DMC_RATE_INDEX_MASK = 15;
var DMC_OUTPUT_LEVEL_MASK = 127;
var DMC_OUTPUT_BIT_MASK = 1;
var DMC_OUTPUT_DELTA = 2;
var DMC_OUTPUT_LEVEL_MAX = 127;
var DMC_SAMPLE_ADDRESS_BASE = 49152;
var DMC_SAMPLE_ADDRESS_SHIFT = 6;
var DMC_SAMPLE_LENGTH_SHIFT = 4;
var DMC_SAMPLE_LENGTH_BASE = 1;
var DMC_SAMPLE_ADDRESS_WRAP = 32768;
var DMC_SAMPLE_ADDRESS_MAX = 65535;
var DMC_SAMPLE_BITS_PER_BYTE = 8;

# NTSC DMC periods (16 entries). Initialized in apu_reset.
list apu_dmc_periods = [0; 16];

# ---- DMC channel state ----

var dmc_irq_enabled = 0;
var dmc_loop = 0;
var dmc_irq = 0;
var dmc_timer_period = 0;
var dmc_timer_reload = 0;
var dmc_timer_counter = 0;
var dmc_output_level = 0;
var dmc_sample_address_register = 0;
var dmc_sample_length_register = 0;
var dmc_current_address = 0;
var dmc_bytes_remaining = 0;
var dmc_sample_buffer = -1;
var dmc_shift_register = 0;
var dmc_bits_remaining = 0;
var dmc_silence = 1;
var dmc_load_dma_delay = -1;

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

    # Populate the triangle sequence if not already done.
    if to_number(apu_triangle_sequence[1]) == 0 {
        apu_triangle_sequence[1] = 0;
        apu_triangle_sequence[2] = 1;
        apu_triangle_sequence[3] = 2;
        apu_triangle_sequence[4] = 3;
        apu_triangle_sequence[5] = 4;
        apu_triangle_sequence[6] = 5;
        apu_triangle_sequence[7] = 6;
        apu_triangle_sequence[8] = 7;
        apu_triangle_sequence[9] = 8;
        apu_triangle_sequence[10] = 9;
        apu_triangle_sequence[11] = 10;
        apu_triangle_sequence[12] = 11;
        apu_triangle_sequence[13] = 12;
        apu_triangle_sequence[14] = 13;
        apu_triangle_sequence[15] = 14;
        apu_triangle_sequence[16] = 15;
        apu_triangle_sequence[17] = 15;
        apu_triangle_sequence[18] = 14;
        apu_triangle_sequence[19] = 13;
        apu_triangle_sequence[20] = 12;
        apu_triangle_sequence[21] = 11;
        apu_triangle_sequence[22] = 10;
        apu_triangle_sequence[23] = 9;
        apu_triangle_sequence[24] = 8;
        apu_triangle_sequence[25] = 7;
        apu_triangle_sequence[26] = 6;
        apu_triangle_sequence[27] = 5;
        apu_triangle_sequence[28] = 4;
        apu_triangle_sequence[29] = 3;
        apu_triangle_sequence[30] = 2;
        apu_triangle_sequence[31] = 1;
        apu_triangle_sequence[32] = 0;
    }

    # Populate the noise periods table if not already done.
    if to_number(apu_noise_periods[1]) == 0 {
        apu_noise_periods[1] = 4;
        apu_noise_periods[2] = 8;
        apu_noise_periods[3] = 16;
        apu_noise_periods[4] = 32;
        apu_noise_periods[5] = 64;
        apu_noise_periods[6] = 96;
        apu_noise_periods[7] = 128;
        apu_noise_periods[8] = 160;
        apu_noise_periods[9] = 202;
        apu_noise_periods[10] = 254;
        apu_noise_periods[11] = 380;
        apu_noise_periods[12] = 508;
        apu_noise_periods[13] = 762;
        apu_noise_periods[14] = 1016;
        apu_noise_periods[15] = 2034;
        apu_noise_periods[16] = 4068;
    }

    # Populate the DMC periods table if not already done.
    if to_number(apu_dmc_periods[1]) == 0 {
        apu_dmc_periods[1] = 428;
        apu_dmc_periods[2] = 380;
        apu_dmc_periods[3] = 340;
        apu_dmc_periods[4] = 320;
        apu_dmc_periods[5] = 286;
        apu_dmc_periods[6] = 254;
        apu_dmc_periods[7] = 226;
        apu_dmc_periods[8] = 214;
        apu_dmc_periods[9] = 190;
        apu_dmc_periods[10] = 160;
        apu_dmc_periods[11] = 142;
        apu_dmc_periods[12] = 128;
        apu_dmc_periods[13] = 106;
        apu_dmc_periods[14] = 85;
        apu_dmc_periods[15] = 72;
        apu_dmc_periods[16] = 54;
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
    triangle_enabled = 0;
    triangle_length_halt = 0;
    triangle_linear_reload_value = 0;
    triangle_linear_counter = 0;
    triangle_linear_reload_flag = 0;
    triangle_timer_period = 0;
    triangle_timer_counter = 0;
    triangle_sequence_step = 0;
    triangle_length_counter = 0;
    noise_enabled = 0;
    noise_control = 0;
    noise_mode = 0;
    noise_timer_period = 4;
    noise_timer_reload = 3;
    noise_timer_counter = 0;
    noise_shift_register = 1;
    noise_length_counter = 0;
    noise_envelope_start = 0;
    noise_envelope_divider = 0;
    noise_envelope_decay = 0;
    dmc_irq_enabled = 0;
    dmc_loop = 0;
    dmc_irq = 0;
    dmc_timer_period = 428;
    dmc_timer_reload = 427;
    dmc_timer_counter = 0;
    dmc_output_level = 0;
    dmc_sample_address_register = 0;
    dmc_sample_length_register = 0;
    dmc_current_address = 49152;
    dmc_bytes_remaining = 0;
    dmc_sample_buffer = -1;
    dmc_shift_register = 0;
    dmc_bits_remaining = 0;
    dmc_silence = 1;
    dmc_load_dma_delay = -1;
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
    } elif addr == APU_TRI_CONTROL {
        apu_write_triangle_control byte_value;
    } elif addr == APU_TRI_TIMER_LOW {
        apu_write_triangle_timer_low byte_value;
    } elif addr == APU_TRI_TIMER_HIGH {
        apu_write_triangle_timer_high byte_value;
    } elif addr == APU_NOISE_CONTROL {
        apu_write_noise_control byte_value;
    } elif addr == APU_NOISE_PERIOD {
        apu_write_noise_period byte_value;
    } elif addr == APU_NOISE_LENGTH {
        apu_write_noise_length byte_value;
    } elif addr == APU_DMC_CONTROL {
        apu_write_dmc_control byte_value;
    } elif addr == APU_DMC_OUTPUT {
        apu_write_dmc_output_level byte_value;
    } elif addr == APU_DMC_SAMPLE_ADDR {
        apu_write_dmc_sample_address byte_value;
    } elif addr == APU_DMC_SAMPLE_LEN {
        apu_write_dmc_sample_length byte_value;
    } elif addr == APU_STATUS {
        apu_write_status byte_value;
    } elif addr == APU_FRAME_COUNTER {
        apu_write_frame_counter byte_value;
    }
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
    local tri = bitwise_and($value, TRIANGLE_ENABLE) != 0;
    local noi = bitwise_and($value, NOISE_ENABLE) != 0;

    pulse1_enabled = p1;

    if p1 == 0 {
        pulse1_length = 0;
    }

    pulse2_enabled = p2;

    if p2 == 0 {
        pulse2_length = 0;
    }

    triangle_enabled = tri;

    if tri == 0 {
        triangle_length_counter = 0;
    }

    noise_enabled = noi;

    if noi == 0 {
        noise_length_counter = 0;
    }

    # DMC enable via $4015 bit 4
    local dmc = bitwise_and($value, DMC_ENABLE) != 0;

    if dmc == 0 {
        dmc_bytes_remaining = 0;
        dmc_load_dma_delay = -1;
    } elif dmc_bytes_remaining == 0 {
        apu_dmc_restart_sample;
        dmc_load_dma_delay = 0;
    }
    dmc_irq = 0;
}

# Writes $4017: frame counter mode and IRQ inhibit.
# Writes $4008: linear counter reload value and length halt flag.
proc apu_write_triangle_control value {
    triangle_length_halt = $value // TRIANGLE_CONTROL_LENGTH_HALT;
    triangle_linear_reload_value = $value % TRIANGLE_LINEAR_RELOAD_MASK;
}

# Writes $400A: timer low 8 bits.
proc apu_write_triangle_timer_low value {
    triangle_timer_period = (triangle_timer_period - (triangle_timer_period % 256)) + $value;
}

# Writes $400B: timer high 3 bits, length index (5 bits), and sets linear reload flag.
proc apu_write_triangle_timer_high value {
    local timer_high = ($value % 8) * 256;
    triangle_timer_period = (triangle_timer_period % 256) + timer_high;
    triangle_linear_reload_flag = 1;

    if triangle_enabled == 1 {
        local length_index = $value // 8;
        triangle_length_counter = to_number(apu_length_table[length_index + 1]);
    }
}

# Writes $400C: noise control register (length halt, constant volume, volume/envelope period)
proc apu_write_noise_control value {
    noise_control = $value;
}

# Writes $400E: noise period register (mode bit + period index)
proc apu_write_noise_period value {
    noise_mode = bitwise_and($value, NOISE_MODE_MASK) != 0;
    local period_index = bitwise_and($value, NOISE_PERIOD_INDEX_MASK);
    noise_timer_period = to_number(apu_noise_periods[period_index + 1]);
    noise_timer_reload = noise_timer_period - 1;
}

# Writes $400F: noise length register (length index + envelope restart)
proc apu_write_noise_length value {
    noise_envelope_start = 1;

    if noise_enabled == 1 {
        local length_index = $value // 8;
        noise_length_counter = to_number(apu_length_table[length_index + 1]);
    }
}

# Writes $4010: DMC control register (IRQ enable, loop mode, rate index)
proc apu_write_dmc_control value {
    dmc_irq_enabled = bitwise_and($value, DMC_IRQ_ENABLE) != 0;
    dmc_loop = bitwise_and($value, DMC_LOOP) != 0;
    local rate_index = bitwise_and($value, DMC_RATE_INDEX_MASK);
    dmc_timer_period = to_number(apu_dmc_periods[rate_index + 1]);
    dmc_timer_reload = dmc_timer_period - 1;

    if dmc_irq_enabled == 0 {
        dmc_irq = 0;
    }
}

# Writes $4011: DMC output level (direct DAC control)
proc apu_write_dmc_output_level value {
    dmc_output_level = bitwise_and($value, DMC_OUTPUT_LEVEL_MASK);
}

# Writes $4012: DMC sample address (start address in 64-byte steps from $C000)
proc apu_write_dmc_sample_address value {
    dmc_sample_address_register = $value;
}

# Writes $4013: DMC sample length (in 16-byte steps, plus one byte)
proc apu_write_dmc_sample_length value {
    dmc_sample_length_register = $value;
}

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

    if triangle_length_counter > 0 {
        value = value + TRIANGLE_ENABLE;
    }

    if noise_length_counter > 0 {
        value = value + NOISE_ENABLE;
    }

    if dmc_bytes_remaining > 0 {
        value = value + DMC_ENABLE;
    }

    if apu_frame_irq == 1 {
        value = value + FRAME_IRQ_STATUS;
    }

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

    apu_clock_triangle_timer;
    apu_clock_noise_timer;
    apu_clock_dmc_timer;
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
    apu_clock_triangle_linear_counter;
    apu_clock_noise_envelope;
}

# Half-frame event: clocks length counters and sweep.
proc apu_clock_half_frame {
    apu_clock_pulse_half_frame 1;
    apu_clock_pulse_half_frame 2;
    apu_clock_triangle_half_frame;
    apu_clock_noise_length;
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

# ---- triangle channel clocking ----

# Clocks the triangle timer every CPU cycle. When the timer reaches zero, it reloads
# and advances the sequence step if both the length counter and linear counter are > 0
# and the timer period is >= 2.
proc apu_clock_triangle_timer {
    if triangle_timer_counter == 0 {
        triangle_timer_counter = triangle_timer_period;

        # Advance sequence only if timer period >= 2 and both counters are active
        if triangle_timer_period >= TRIANGLE_TIMER_MIN {
            if triangle_length_counter > 0 and triangle_linear_counter > 0 {
                triangle_sequence_step = (triangle_sequence_step + 1) % TRIANGLE_SEQUENCE_LENGTH;
            }
        }
    } else {
        triangle_timer_counter = triangle_timer_counter - 1;
    }
}

# Clocks the triangle linear counter on a quarter-frame event.
proc apu_clock_triangle_linear_counter {
    if triangle_linear_reload_flag == 1 {
        triangle_linear_counter = triangle_linear_reload_value;
    } else if triangle_linear_counter > 0 {
        triangle_linear_counter = triangle_linear_counter - 1;
    }

    # Clear the reload flag unless the length halt bit is set
    if triangle_length_halt == 0 {
        triangle_linear_reload_flag = 0;
    }
}

# Clocks the triangle length counter on a half-frame event.
proc apu_clock_triangle_half_frame {
    if triangle_length_counter > 0 {
        if triangle_length_halt == 0 {
            triangle_length_counter = triangle_length_counter - 1;
        }
    }
}

# ---- noise channel clocking ----

# Clocks the noise timer every CPU cycle. When the timer reaches zero, it reloads
# and shifts the LFSR.
proc apu_clock_noise_timer {
    if noise_timer_counter == 0 {
        noise_timer_counter = noise_timer_reload;
        apu_shift_lfsr;
    } else {
        noise_timer_counter = noise_timer_counter - 1;
    }
}

# Shifts the noise LFSR. XOR bit 0 with the feedback tap bit, shift right,
# and put the XOR result in bit 14.
proc apu_shift_lfsr {
    local low_bit = bitwise_and(noise_shift_register, NOISE_LFSR_OUTPUT_MASK);
    local feedback_tap = 0;

    if noise_mode == 1 {
        # Short mode: feedback tap at bit 6
        feedback_tap = (noise_shift_register // 64) % 2;
    } else {
        # Long mode: feedback tap at bit 1
        feedback_tap = (noise_shift_register // 2) % 2;
    }

    local feedback = bitwise_xor(low_bit, feedback_tap);
    # Shift right and put feedback in bit 14
    noise_shift_register = (noise_shift_register // 2) + (feedback * NOISE_LFSR_FEEDBACK_BIT);
    noise_shift_register = bitwise_and(noise_shift_register, NOISE_LFSR_REGISTER_MASK);
}

# Clocks the noise envelope on a quarter-frame event.
proc apu_clock_noise_envelope {
    if noise_envelope_start == 1 {
        noise_envelope_start = 0;
        noise_envelope_decay = 15;
        noise_envelope_divider = bitwise_and(noise_control, NOISE_VOLUME_MASK);
    } elif noise_envelope_divider > 0 {
        noise_envelope_divider = noise_envelope_divider - 1;
    } else {
        noise_envelope_divider = bitwise_and(noise_control, NOISE_VOLUME_MASK);

        if noise_envelope_decay > 0 {
            noise_envelope_decay = noise_envelope_decay - 1;
        } elif bitwise_and(noise_control, NOISE_LENGTH_HALT_ENVELOPE_LOOP) != 0 {
            noise_envelope_decay = 15;
        }
    }
}

# Clocks the noise length counter on a half-frame event.
proc apu_clock_noise_length {
    if noise_length_counter > 0 {
        if bitwise_and(noise_control, NOISE_LENGTH_HALT_ENVELOPE_LOOP) == 0 {
            noise_length_counter = noise_length_counter - 1;
        }
    }
}

# ---- DMC channel clocking ----

# Clocks the DMC timer every CPU cycle. When the timer reaches zero, it reloads
# and clocks the output unit. Also counts down the load DMA delay.
proc apu_clock_dmc_timer {
    if dmc_load_dma_delay >= 0 {
        dmc_load_dma_delay = dmc_load_dma_delay - 1;
    }

    if dmc_timer_counter == 0 {
        dmc_timer_counter = dmc_timer_reload;
        apu_clock_dmc_output_unit;
    } else {
        dmc_timer_counter = dmc_timer_counter - 1;
    }
}

# Clocks the DMC output unit: processes one bit from the shift register,
# adjusting the output level up or down by 2.
proc apu_clock_dmc_output_unit {
    if dmc_bits_remaining == 0 {
        dmc_bits_remaining = 8;

        if dmc_sample_buffer < 0 {
            dmc_silence = 1;
        } else {
            dmc_shift_register = dmc_sample_buffer;
            dmc_sample_buffer = -1;
            dmc_silence = 0;
        }
    }

    if dmc_silence == 0 {
        if bitwise_and(dmc_shift_register, DMC_OUTPUT_BIT_MASK) != 0 {
            if dmc_output_level <= DMC_OUTPUT_LEVEL_MAX - DMC_OUTPUT_DELTA {
                dmc_output_level = dmc_output_level + DMC_OUTPUT_DELTA;
            }
        } elif dmc_output_level >= DMC_OUTPUT_DELTA {
            dmc_output_level = dmc_output_level - DMC_OUTPUT_DELTA;
        }

        dmc_shift_register = dmc_shift_register // 2;
    }

    dmc_bits_remaining = dmc_bits_remaining - 1;
}

# Restarts the DMC sample from the beginning using the sample address and length registers.
proc apu_dmc_restart_sample {
    dmc_current_address = DMC_SAMPLE_ADDRESS_BASE + (dmc_sample_address_register * 64);
    dmc_bytes_remaining = (dmc_sample_length_register * 16) + DMC_SAMPLE_LENGTH_BASE;
}

# Returns the address for a pending DMC DMA fetch, or -1 if none is needed.
# A fetch is needed when: load_dma_delay is done, sample_buffer is empty, and bytes_remaining > 0.
func apu_dmc_get_dma_request_address() {
    if dmc_load_dma_delay >= 0 {
        return -1;
    }

    if dmc_sample_buffer >= 0 {
        return -1;
    }

    if dmc_bytes_remaining == 0 {
        return -1;
    }

    return dmc_current_address;
}

# Supplies a byte fetched by DMC DMA and advances or restarts the sample reader.
proc apu_dmc_complete_dma_read value {
    if dmc_bytes_remaining > 0 {
        if dmc_sample_buffer < 0 {
            dmc_sample_buffer = $value;

            if dmc_current_address == DMC_SAMPLE_ADDRESS_MAX {
                dmc_current_address = DMC_SAMPLE_ADDRESS_WRAP;
            } else {
                dmc_current_address = dmc_current_address + 1;
            }

            dmc_bytes_remaining = dmc_bytes_remaining - 1;

            if dmc_bytes_remaining == 0 {
                if dmc_loop == 1 {
                    apu_dmc_restart_sample;
                } elif dmc_irq_enabled == 1 {
                    dmc_irq = 1;
                }
            }
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

# Returns the triangle output (0-15) from the waveform sequence.
func apu_get_triangle_output() {
    return to_number(apu_triangle_sequence[triangle_sequence_step + 1]);
}

# Returns the triangle length counter value.
func apu_get_triangle_length() {
    return triangle_length_counter;
}

# Returns the noise output (0-15). Output is 0 if length counter is 0 or if
# LFSR bit 0 is 1 (muted). Otherwise, returns constant volume or envelope decay.
func apu_get_noise_output() {
    if noise_length_counter == 0 {
        return 0;
    }

    # LFSR bit 0 == 1 means muted
    if bitwise_and(noise_shift_register, NOISE_LFSR_OUTPUT_MASK) != 0 {
        return 0;
    }

    if bitwise_and(noise_control, NOISE_CONSTANT_VOLUME) != 0 {
        return bitwise_and(noise_control, NOISE_VOLUME_MASK);
    }

    return noise_envelope_decay;
}

# Returns the noise length counter value.
func apu_get_noise_length() {
    return noise_length_counter;
}

# Returns the DMC output level (0-127).
func apu_get_dmc_output() {
    return dmc_output_level;
}

# Returns the DMC bytes remaining count.
func apu_get_dmc_bytes_remaining() {
    return dmc_bytes_remaining;
}

# Returns whether the frame IRQ line is asserted.
func apu_is_frame_irq_asserted() {
    return apu_frame_irq;
}

# Returns whether the DMC IRQ line is asserted.
func apu_is_dmc_irq_asserted() {
    return dmc_irq;
}

# Returns whether any APU IRQ line is asserted (frame IRQ or DMC IRQ).
func apu_is_irq_asserted() {
    return apu_frame_irq != 0 or dmc_irq != 0;
}

# ---- audio mixer ----

# Nonlinear 2A03 mixer constants. The pulse and TND channels use separate
# mixing networks with different nonlinear curves.
var APU_PULSE_MIXER_GAIN = 95.88;
var APU_PULSE_MIXER_SCALE = 8128;
var APU_PULSE_MIXER_OFFSET = 100;
var APU_TND_MIXER_GAIN = 159.79;
var APU_TND_MIXER_OFFSET = 100;
var APU_TRIANGLE_MIXER_DIVISOR = 8227;
var APU_NOISE_MIXER_DIVISOR = 12241;
var APU_DMC_MIXER_DIVISOR = 22638;

# Returns the nonlinear 2A03 pulse+TND mix, normalized to approximately 0..1.
# Uses floating-point division internally and rounds to an integer in the 0..1000 range.
func apu_mix_channels(pulse_one, pulse_two, triangle, noise, dmc) {
    local pulse_sum = $pulse_one + $pulse_two;
    local pulse_output = 0;

    if pulse_sum > 0 {
        pulse_output = APU_PULSE_MIXER_GAIN / (APU_PULSE_MIXER_SCALE / pulse_sum + APU_PULSE_MIXER_OFFSET);
    }

    local tri_term = $triangle / APU_TRIANGLE_MIXER_DIVISOR;
    local noise_term = $noise / APU_NOISE_MIXER_DIVISOR;
    local dmc_term = $dmc / APU_DMC_MIXER_DIVISOR;
    local tnd_input = tri_term + noise_term + dmc_term;
    local tnd_output = 0;

    if tnd_input > 0 {
        tnd_output = APU_TND_MIXER_GAIN / (1 / tnd_input + APU_TND_MIXER_OFFSET);
    }

    # Scale to 0..1000 range and round to integer
    return ((pulse_output + tnd_output) * 1000 + 0.5) // 1;
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
