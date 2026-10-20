# apu_2a03: no-audio stub (audio removed).
# APU stub for the GoboScript port.
#
# The TypeScript reference implementation in src/nes/apu/ retains the full 2A03 APU
# (pulse, triangle, noise, DMC, frame sequencer, mixer, sampler). The GoboScript
# port historically duplicated that logic in this file (~1,483 lines, 15 lists,
# 50+ vars, 30+ procs). TurboWarp cannot reasonably play audio from the pen
# renderer and the APU burned ~400k Scratch ops/frame for no audible output.
#
# This stub removes audio entirely. It keeps the minimal interface that other
# modules previously referenced so the project still compiles and lints, but every
# proc is a no-op and every read returns the open-bus latch / zero. The backup
# branch arena/54bc3f09-scratch-nes-emulator-backup preserves the full
# implementation for reference. See docs/PERFORMANCE_AUDIT_TODO.md section 8
# for the optimization impact.

# Minimal stub state kept for bus compatibility (always 0 / not asserted).
var apu_frame_irq = 0;
var dmc_irq = 0;
var apu_status_value = 0;
var apu_status_driven_mask = 0;
var apu_register_error = 0;

enum apu_register_status {
    ok = 0,
    value_out_of_range = 1,
    address_out_of_range = 2
}

# No-op reset (kept for cpu_bus_reset call site, now removed but retained for
# lint parity; does not touch lists or timers).
proc apu_reset {
}

# No-op register write (all APU registers are unimplemented; writes are dropped).
proc apu_write_register address, value {
}

# No-op status read (always undriven, returns 0 with 0 mask so the bus latch
# is preserved; matches the stub contract in cpu_bus).
proc apu_read_status {
    apu_status_value = 0;
    apu_status_driven_mask = 0;
}

# No-op per-CPU-cycle clock (frame sequencer, pulse/triangle/noise/DMC timers
# and IRQ generation are removed; IRQ line is never asserted).
proc apu_clock_cpu_cycle {
}

# Stub procs retained for mirror contract with null reason (audio removed).
proc apu_clock_pulse_timer channel {
}

proc apu_clock_frame_sequencer {
}

proc apu_clock_quarter_frame {
}

proc apu_clock_half_frame {
}

proc apu_clock_pulse_envelope {
}

proc apu_clock_pulse_half_frame {
}

proc apu_clock_pulse_sweep {
}

proc apu_clock_triangle_timer {
}

proc apu_clock_triangle_linear_counter {
}

proc apu_clock_triangle_half_frame {
}

proc apu_clock_noise_timer {
}

proc apu_shift_lfsr {
}

proc apu_clock_noise_envelope {
}

proc apu_clock_noise_length {
}

proc apu_clock_dmc_timer {
}

proc apu_clock_dmc_output_unit {
}

proc apu_dmc_restart_sample {
}

proc apu_dmc_complete_dma_read {
}

proc apu_get_pulse_output channel {
}

proc apu_pulse_output channel {
}

proc apu_get_pulse_length channel {
}

proc apu_get_triangle_output {
}

proc apu_get_triangle_length {
}

proc apu_get_noise_output {
}

proc apu_get_noise_length {
}

proc apu_get_dmc_output {
}

proc apu_get_dmc_bytes_remaining {
}

proc apu_dmc_get_dma_request_address {
}

proc apu_write_pulse address, value {
}

proc apu_write_pulse_sweep channel, value {
}

proc apu_write_triangle_control value {
}

proc apu_write_triangle_timer_low value {
}

proc apu_write_triangle_timer_high value {
}

proc apu_write_noise_control value {
}

proc apu_write_noise_period value {
}

proc apu_write_noise_length value {
}

proc apu_write_dmc_control value {
}

proc apu_write_dmc_output_level value {
}

proc apu_write_dmc_sample_address value {
}

proc apu_write_dmc_sample_length value {
}

proc apu_write_status value {
}

proc apu_write_frame_counter value {
}

proc apu_mix_channels {
}

proc apu_is_frame_irq_asserted {
}

proc apu_is_dmc_irq_asserted {
}

proc apu_is_irq_asserted {
}

proc apu_pulse_sweep_target channel {
}

proc apu_pulse_sweep_in_range channel {
}

proc apu_sweep_target_would_oor channel {
}

proc apu_power_of_two exponent {
}
