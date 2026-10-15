import assert from "node:assert/strict";
import test from "node:test";

import {
    NtscClock,
    NTSC_MASTER_CLOCK_HZ,
    NTSC_MASTER_TICKS_PER_CPU_CYCLE,
    NTSC_MASTER_TICKS_PER_PPU_DOT,
} from "../src/nes/core/ntsc_clock.js";

test("divides integer NTSC master ticks into twelve-tick CPU and four-tick PPU edges", () => {
    const clock = new NtscClock();
    let cpu_edges = 0;
    let ppu_edges = 0;

    for (let tick_number = 1; tick_number <= NTSC_MASTER_TICKS_PER_CPU_CYCLE; tick_number += 1) {
        const tick = clock.clock_master_tick();
        const cpu_cycle_due = tick_number % NTSC_MASTER_TICKS_PER_CPU_CYCLE === 0;
        const ppu_dot_due = tick_number % NTSC_MASTER_TICKS_PER_PPU_DOT === 0;

        assert.equal(tick.master_clock_tick, tick_number);
        assert.equal(tick.cpu_cycle_due, cpu_cycle_due);
        assert.equal(tick.ppu_dot_due, ppu_dot_due);
        cpu_edges += Number(tick.cpu_cycle_due);
        ppu_edges += Number(tick.ppu_dot_due);
    }

    assert.equal(NTSC_MASTER_CLOCK_HZ / NTSC_MASTER_TICKS_PER_CPU_CYCLE, 1_789_772.6666666667);
    assert.equal(cpu_edges, 1);
    assert.equal(ppu_edges, 3);
    assert.equal(clock.get_master_clock_ticks(), 12);
    assert.equal(clock.get_cpu_cycle_count(), 1);
    assert.equal(clock.get_ppu_dot_count(), 3);
});

test("reset restarts master and device divider phases", () => {
    const clock = new NtscClock();
    for (let index = 0; index < 7; index += 1) {
        clock.clock_master_tick();
    }

    clock.reset();

    assert.equal(clock.get_master_clock_ticks(), 0);
    assert.equal(clock.get_cpu_cycle_count(), 0);
    assert.equal(clock.get_ppu_dot_count(), 0);
    assert.equal(clock.clock_master_tick().ppu_dot_due, false);
});
