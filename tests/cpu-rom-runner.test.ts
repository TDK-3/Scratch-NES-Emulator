import assert from "node:assert/strict";
import test from "node:test";

import {
    compare_nestest_trace,
    create_nestest_trace_recorder,
    parse_nestest_log_line,
} from "./support/nestest_runner.js";

const CPU_TEST_PROGRAM = new Uint8Array([0xa9, 0x02, 0xe8]);
const NESTEST_LOG_LINES = [
    "C000  A9 02     LDA #$02                        A:00 X:00 Y:00 P:24 SP:FD PPU:  0, 21 CYC:7",
    "C002  E8        INX                             A:02 X:00 Y:00 P:24 SP:FD PPU:  0, 27 CYC:9",
];

test("compares a synthetic NROM program against nestest-format CPU state lines", () => {
    const recorder = create_nestest_trace_recorder(create_nrom_image(CPU_TEST_PROGRAM));

    const result = compare_nestest_trace(recorder, NESTEST_LOG_LINES);

    assert.deepEqual(result, {
        ok: true,
        matched_entries: 2,
        total_entries: 2,
        step_limit: 2,
    });
});

test("reports the first register mismatch with the expected log line number", () => {
    const recorder = create_nestest_trace_recorder(create_nrom_image(CPU_TEST_PROGRAM));
    const mismatching_log = NESTEST_LOG_LINES[0]?.replace("A:00", "A:01");

    if (mismatching_log === undefined) {
        throw new Error("The synthetic nestest log line is missing.");
    }

    const result = compare_nestest_trace(recorder, [mismatching_log]);

    assert.equal(result.ok, false);

    if (!result.ok) {
        assert.equal(result.matched_entries, 0);
        assert.equal(result.line_number, 1);
        assert.equal(result.message, "A mismatch: expected $01, got $00.");
    }
});

test("rejects an empty nestest log instead of reporting a vacuous pass", () => {
    const recorder = create_nestest_trace_recorder(create_nrom_image(CPU_TEST_PROGRAM));

    assert.throws(() => compare_nestest_trace(recorder, ["", "  "]), /does not contain any instruction entries/);
});

test("parses instruction bytes, registers, and cycle count from a nestest line", () => {
    assert.deepEqual(parse_nestest_log_line(NESTEST_LOG_LINES[1] ?? "", 2), {
        line_number: 2,
        program_counter: 0xc002,
        bytes: [0xe8],
        a: 0x02,
        x: 0x00,
        y: 0x00,
        status: 0x24,
        stack_pointer: 0xfd,
        cycles: 9,
    });
});

function create_nrom_image(program: Uint8Array): Uint8Array {
    const prg_rom = new Uint8Array(0x4000);
    prg_rom.set(program);
    const image = new Uint8Array(16 + prg_rom.byteLength);
    image.set([0x4e, 0x45, 0x53, 0x1a, 1, 0, 0, 0], 0);
    image.set(prg_rom, 16);

    return image;
}
