import assert from "node:assert/strict";
import test from "node:test";

import { add_with_carry, subtract_with_carry } from "../src/nes/cpu/alu.js";
import type { NesCpuBusDevices } from "../src/nes/cpu/nes_cpu_bus.js";
import { NesCpuBus } from "../src/nes/cpu/nes_cpu_bus.js";
import type { CpuStatusFlag } from "../src/nes/cpu/registers.js";
import * as registers from "../src/nes/cpu/registers.js";
import { NesControllerPorts } from "../src/nes/input/controller.js";
import {
    CARTRIDGE_HEADER_BYTES,
    make_cartridge_image,
    project_cartridge_header,
} from "./support/cartridge_projection.js";
import { parse_ines_rom } from "../src/nes/cartridge/ines.js";
import * as ported from "./support/goboscript_port_algorithms.js";
import { get_shared_vector_suite, vector_input } from "./support/shared_port_vectors.js";

/**
 * Exhaustive comparison of the bit-free GoboScript port algorithms with the bitwise
 * TypeScript reference. tests/support/goboscript_port_algorithms.ts mirrors the arithmetic in
 * scratch/src/numeric.gs, cpu_status.gs, cpu_alu.gs, controller.gs, cpu_bus.gs, and
 * cartridge.gs, so a
 * divergence here means either the mirror or the reference is wrong; a pass means the ported
 * arithmetic reproduces production CPU, bus, and controller behavior for every input in the
 * swept ranges. It does not mean the .gs sources compile: the pinned GoboScript toolchain is
 * still unavailable.
 */

/** Every bit of the status byte, including the two the reference API does not expose. */
const FLAGS: readonly number[] = [
    registers.CARRY_FLAG,
    registers.ZERO_FLAG,
    registers.INTERRUPT_DISABLE_FLAG,
    registers.DECIMAL_FLAG,
    registers.BREAK_FLAG,
    registers.UNUSED_FLAG,
    registers.OVERFLOW_FLAG,
    registers.NEGATIVE_FLAG,
];

/** The flags registers.has_status_flag()/set_status_flag() accept as typed arguments. */
const TYPED_FLAGS: readonly CpuStatusFlag[] = [
    registers.CARRY_FLAG,
    registers.ZERO_FLAG,
    registers.INTERRUPT_DISABLE_FLAG,
    registers.DECIMAL_FLAG,
    registers.OVERFLOW_FLAG,
    registers.NEGATIVE_FLAG,
];

/** The reference flag read, written out so BREAK and UNUSED can be swept too. */
function reference_has_status_flag(status: number, flag: number): boolean {
    return (registers.normalize_status(status) & flag) !== 0;
}

/** The reference flag write, including the trailing renormalization the reference performs. */
function reference_set_status_flag(status: number, flag: number, enabled: boolean): number {
    const normalized = registers.normalize_status(status);
    return registers.normalize_status(enabled ? normalized | flag : normalized & ~flag);
}

const BYTE_VALUES: readonly number[] = Array.from({ length: 256 }, (_, index) => index);
const OUT_OF_RANGE_SAMPLES: readonly number[] = [
    -4_294_967_296, -65_537, -65_536, -1000, -257, -256, -255, -128, -1, 256, 257, 300, 1000, 65_535, 65_536, 65_537,
    4_294_967_296, Number.MAX_SAFE_INTEGER,
];
const POWER_OF_TWO_WEIGHTS: readonly number[] = Array.from({ length: 16 }, (_, index) => 2 ** index);
const STATUS_SAMPLES: readonly number[] = [
    0x00, 0x01, 0x02, 0x20, 0x21, 0x22, 0x24, 0x60, 0x63, 0xa0, 0xa1, 0xe1, 0xff, 0x130,
];
const CONTROLLER_READS_PER_CASE = 12;

test("scratch_mod reproduces Scratch's floored modulo", () => {
    for (let left = -600; left <= 600; left += 1) {
        for (const right of [1, 2, 3, 7, 8, 16, 255, 256, 2048, 65_536]) {
            const expected = left - Math.floor(left / right) * right;
            assert.equal(ported.scratch_mod(left, right), expected, `scratch_mod(${left}, ${right})`);
        }
    }
});

test("scratch_floor_divide reproduces the GoboScript // operator", () => {
    for (let left = -600; left <= 600; left += 1) {
        for (const right of [1, 2, 3, 7, 8, 256, 2048]) {
            assert.equal(
                ported.scratch_floor_divide(left, right),
                Math.floor(left / right),
                `scratch_floor_divide(${left}, ${right})`,
            );
        }
    }
});

test("to_number coerces list items like the Scratch number cast", () => {
    assert.equal(ported.to_number("255"), 255);
    assert.equal(ported.to_number("-1"), -1);
    assert.equal(ported.to_number(""), 0);
    assert.equal(ported.to_number("not a number"), 0);
    assert.equal(ported.to_number(42), 42);
});

test("normalize_byte matches the reference for bytes, words, and out-of-range integers", () => {
    for (const value of [...BYTE_VALUES, ...OUT_OF_RANGE_SAMPLES]) {
        assert.equal(ported.normalize_byte(value), registers.normalize_byte(value), `normalize_byte(${value})`);
    }

    for (let value = 0; value <= 0xffff; value += 1) {
        assert.equal(ported.normalize_byte(value), registers.normalize_byte(value), `normalize_byte(${value})`);
    }
});

test("normalize_word matches the reference for the whole address range and out-of-range integers", () => {
    for (const value of [...BYTE_VALUES, ...OUT_OF_RANGE_SAMPLES]) {
        assert.equal(ported.normalize_word(value), registers.normalize_word(value), `normalize_word(${value})`);
    }

    for (let value = 0; value <= 0xffff; value += 1) {
        assert.equal(ported.normalize_word(value), registers.normalize_word(value), `normalize_word(${value})`);
        assert.equal(
            ported.normalize_word(-value),
            registers.normalize_word(-value),
            `normalize_word(${-value})`,
        );
    }
});

test("to_signed_byte matches the reference for every byte", () => {
    for (const value of [...BYTE_VALUES, ...OUT_OF_RANGE_SAMPLES]) {
        assert.equal(ported.to_signed_byte(value), registers.to_signed_byte(value), `to_signed_byte(${value})`);
    }
});

test("byte_high and byte_low match the reference for every word", () => {
    for (let word = 0; word <= 0xffff; word += 1) {
        assert.equal(ported.byte_high(word), word >>> 8, `byte_high(${word})`);
        assert.equal(ported.byte_low(word), word & 0xff, `byte_low(${word})`);
    }

    for (const word of OUT_OF_RANGE_SAMPLES) {
        const normalized = registers.normalize_word(word);
        assert.equal(ported.byte_high(word), normalized >>> 8, `byte_high(${word})`);
        assert.equal(ported.byte_low(word), normalized & 0xff, `byte_low(${word})`);
    }
});

test("join_bytes matches the reference for every byte pair", () => {
    for (const high of BYTE_VALUES) {
        for (const low of BYTE_VALUES) {
            assert.equal(ported.join_bytes(high, low), (high << 8) | low, `join_bytes(${high}, ${low})`);
        }
    }

    assert.equal(ported.join_bytes(256, 300), (registers.normalize_byte(256) << 8) | registers.normalize_byte(300));
    assert.equal(ported.join_bytes(-1, -1), 0xffff);
});

test("bit_at matches the reference bit test for every power-of-two weight", () => {
    for (const weight of POWER_OF_TWO_WEIGHTS) {
        for (let value = 0; value <= 0xffff; value += 1) {
            const expected = Number((value & weight) !== 0);

            if (expected !== 0 || value < 0x1000 || value > 0xf000) {
                assert.equal(ported.bit_at(value, weight), expected, `bit_at(${value}, ${weight})`);
            }
        }

        for (const value of [...BYTE_VALUES, 0x5555, 0xaaaa, 0x8000, 0x7fff]) {
            assert.equal(ported.bit_at(value, weight), Number((value & weight) !== 0), `bit_at(${value}, ${weight})`);
        }
    }

    for (const weight of POWER_OF_TWO_WEIGHTS) {
        for (const value of OUT_OF_RANGE_SAMPLES) {
            const normalized = registers.normalize_word(value);
            assert.equal(
                ported.bit_at(value, weight),
                Number((normalized & weight) !== 0),
                `bit_at(${value}, ${weight})`,
            );
        }
    }
});

test("bitwise_and, bitwise_or, and bitwise_xor match the reference for every byte pair", () => {
    for (const left of BYTE_VALUES) {
        for (const right of BYTE_VALUES) {
            assert.equal(ported.bitwise_and(left, right), left & right, `bitwise_and(${left}, ${right})`);
            assert.equal(ported.bitwise_or(left, right), left | right, `bitwise_or(${left}, ${right})`);
            assert.equal(ported.bitwise_xor(left, right), left ^ right, `bitwise_xor(${left}, ${right})`);
        }
    }
});

test("bitwise_and, bitwise_or, and bitwise_xor match the reference across the word range", () => {
    for (let left = 0; left <= 0xffff; left += 1) {
        const right = (left * 257 + 43) % 0x1_0000;
        assert.equal(ported.bitwise_and(left, right), left & right, `bitwise_and(${left}, ${right})`);
        assert.equal(ported.bitwise_or(left, right), left | right, `bitwise_or(${left}, ${right})`);
        assert.equal(ported.bitwise_xor(left, right), left ^ right, `bitwise_xor(${left}, ${right})`);
        assert.equal(ported.bitwise_and(left, 0xffff), left & 0xffff, `bitwise_and(${left}, 65535)`);
        assert.equal(ported.bitwise_xor(left, 0), left ^ 0, `bitwise_xor(${left}, 0)`);
    }

    for (const value of OUT_OF_RANGE_SAMPLES) {
        const normalized = registers.normalize_word(value);
        assert.equal(ported.bitwise_and(value, 0x5a5a), normalized & 0x5a5a, `bitwise_and(${value}, 23130)`);
        assert.equal(ported.bitwise_or(value, 0x5a5a), normalized | 0x5a5a, `bitwise_or(${value}, 23130)`);
        assert.equal(ported.bitwise_xor(value, 0x5a5a), normalized ^ 0x5a5a, `bitwise_xor(${value}, 23130)`);
    }
});

test("normalize_status matches the reference for every byte and out-of-range sample", () => {
    for (const status of [...BYTE_VALUES, ...OUT_OF_RANGE_SAMPLES.filter(Number.isSafeInteger)]) {
        assert.equal(
            ported.normalize_status(status),
            registers.normalize_status(status),
            `normalize_status(${status})`,
        );
    }
});

test("has_status_flag matches the reference for every status byte and flag", () => {
    for (const status of [...BYTE_VALUES, ...STATUS_SAMPLES]) {
        for (const flag of FLAGS) {
            assert.equal(
                ported.has_status_flag(status, flag),
                Number(reference_has_status_flag(status, flag)),
                `has_status_flag(${status}, ${flag})`,
            );
        }

        for (const flag of TYPED_FLAGS) {
            assert.equal(
                Number(reference_has_status_flag(status, flag)),
                Number(registers.has_status_flag(status, flag)),
                `reference_has_status_flag(${status}, ${flag})`,
            );
        }
    }
});

test("set_status_flag matches the reference for every status byte, flag, and enable value", () => {
    for (const status of [...BYTE_VALUES, ...STATUS_SAMPLES]) {
        for (const flag of FLAGS) {
            for (const enabled of [0, 1]) {
                assert.equal(
                    ported.set_status_flag(status, flag, enabled),
                    reference_set_status_flag(status, flag, enabled === 1),
                    `set_status_flag(${status}, ${flag}, ${enabled})`,
                );
            }
        }

        for (const flag of TYPED_FLAGS) {
            for (const enabled of [false, true]) {
                assert.equal(
                    reference_set_status_flag(status, flag, enabled),
                    registers.set_status_flag(status, flag, enabled),
                    `reference_set_status_flag(${status}, ${flag}, ${enabled})`,
                );
            }
        }
    }
});

test("update_zero_negative_flags matches the reference for every status byte and result byte", () => {
    for (const status of BYTE_VALUES) {
        for (const value of BYTE_VALUES) {
            assert.equal(
                ported.update_zero_negative_flags(status, value),
                registers.update_zero_negative_flags(status, value),
                `update_zero_negative_flags(${status}, ${value})`,
            );
        }
    }

    for (const status of STATUS_SAMPLES) {
        for (const value of [-1, 256, 300, 0x100]) {
            assert.equal(
                ported.update_zero_negative_flags(status, value),
                registers.update_zero_negative_flags(status, value),
                `update_zero_negative_flags(${status}, ${value})`,
            );
        }
    }
});

test("pack_status_for_stack and unpack_status_from_stack match the reference", () => {
    for (const status of [...BYTE_VALUES, ...STATUS_SAMPLES]) {
        assert.equal(
            ported.pack_status_for_stack(status, 1),
            registers.pack_status_for_stack(status, "brk"),
            `pack_status_for_stack(${status}, 1)`,
        );
        assert.equal(
            ported.pack_status_for_stack(status, 0),
            registers.pack_status_for_stack(status, "irq"),
            `pack_status_for_stack(${status}, 0)`,
        );
        assert.equal(
            ported.unpack_status_from_stack(status),
            registers.unpack_status_from_stack(status),
            `unpack_status_from_stack(${status})`,
        );
    }
});

test("alu_add_with_carry matches add_with_carry for every operand pair and status shape", () => {
    for (const left of BYTE_VALUES) {
        for (const right of BYTE_VALUES) {
            for (const status of [0x20, 0x21, 0x60, 0xe1]) {
                const expected = add_with_carry(left, right, status);
                const actual = ported.alu_add_with_carry(left, right, status);
                assert.deepEqual(actual, expected, `alu_add_with_carry(${left}, ${right}, ${status})`);
            }
        }
    }
});

test("alu_subtract_with_carry matches subtract_with_carry for every operand pair and status shape", () => {
    for (const left of BYTE_VALUES) {
        for (const right of BYTE_VALUES) {
            for (const status of [0x20, 0x21, 0x60, 0xe1]) {
                const expected = subtract_with_carry(left, right, status);
                const actual = ported.alu_subtract_with_carry(left, right, status);
                assert.deepEqual(actual, expected, `alu_subtract_with_carry(${left}, ${right}, ${status})`);
            }
        }
    }
});

test("alu_add_with_carry and alu_subtract_with_carry match the reference for every status byte", () => {
    for (const status of BYTE_VALUES) {
        for (const [left, right] of [
            [0, 0],
            [127, 1],
            [128, 128],
            [255, 1],
            [200, 100],
            [0, 255],
        ] as const) {
            assert.deepEqual(
                ported.alu_add_with_carry(left, right, status),
                add_with_carry(left, right, status),
                `alu_add_with_carry(${left}, ${right}, ${status})`,
            );
            assert.deepEqual(
                ported.alu_subtract_with_carry(left, right, status),
                subtract_with_carry(left, right, status),
                `alu_subtract_with_carry(${left}, ${right}, ${status})`,
            );
        }
    }
});

test("the logical ALU mirrors match the CPU's AND, ORA, and EOR steps", () => {
    for (const left of BYTE_VALUES) {
        for (const right of BYTE_VALUES) {
            for (const status of [0x20, 0xe1]) {
                const and_value = registers.normalize_byte(left & right);
                assert.deepEqual(
                    ported.alu_and(left, right, status),
                    { value: and_value, status: registers.update_zero_negative_flags(status, and_value) },
                    `alu_and(${left}, ${right}, ${status})`,
                );

                const or_value = registers.normalize_byte(left | right);
                assert.deepEqual(
                    ported.alu_ora(left, right, status),
                    { value: or_value, status: registers.update_zero_negative_flags(status, or_value) },
                    `alu_ora(${left}, ${right}, ${status})`,
                );

                const xor_value = registers.normalize_byte(left ^ right);
                assert.deepEqual(
                    ported.alu_eor(left, right, status),
                    { value: xor_value, status: registers.update_zero_negative_flags(status, xor_value) },
                    `alu_eor(${left}, ${right}, ${status})`,
                );
            }
        }
    }
});

test("the shift and rotate mirrors match the CPU's accumulator steps", () => {
    for (const value of BYTE_VALUES) {
        for (const status of BYTE_VALUES) {
            const carry_in = Number(registers.has_status_flag(status, registers.CARRY_FLAG));
            const shift_left = registers.normalize_byte(value << 1);
            const shift_right = value >> 1;
            const rotate_left = registers.normalize_byte((value << 1) | carry_in);
            const rotate_right = (value >> 1) | (carry_in << 7);

            assert.deepEqual(
                ported.alu_shift_left(value, status),
                {
                    value: shift_left,
                    status: registers.update_zero_negative_flags(
                        registers.set_status_flag(
                            status,
                            registers.CARRY_FLAG,
                            (value & registers.NEGATIVE_FLAG) !== 0,
                        ),
                        shift_left,
                    ),
                },
                `alu_shift_left(${value}, ${status})`,
            );
            assert.deepEqual(
                ported.alu_shift_right(value, status),
                {
                    value: shift_right,
                    status: registers.update_zero_negative_flags(
                        registers.set_status_flag(status, registers.CARRY_FLAG, (value & registers.CARRY_FLAG) !== 0),
                        shift_right,
                    ),
                },
                `alu_shift_right(${value}, ${status})`,
            );
            assert.deepEqual(
                ported.alu_rotate_left(value, status),
                {
                    value: rotate_left,
                    status: registers.update_zero_negative_flags(
                        registers.set_status_flag(
                            status,
                            registers.CARRY_FLAG,
                            (value & registers.NEGATIVE_FLAG) !== 0,
                        ),
                        rotate_left,
                    ),
                },
                `alu_rotate_left(${value}, ${status})`,
            );
            assert.deepEqual(
                ported.alu_rotate_right(value, status),
                {
                    value: rotate_right,
                    status: registers.update_zero_negative_flags(
                        registers.set_status_flag(status, registers.CARRY_FLAG, (value & registers.CARRY_FLAG) !== 0),
                        rotate_right,
                    ),
                },
                `alu_rotate_right(${value}, ${status})`,
            );
        }
    }
});

test("alu_compare matches the CPU's CMP, CPX, and CPY step", () => {
    for (const left of BYTE_VALUES) {
        for (const right of BYTE_VALUES) {
            for (const status of [0x20, 0x21, 0xe1]) {
                const difference = registers.normalize_byte(left - right);
                const expected = {
                    value: left,
                    status: registers.update_zero_negative_flags(
                        registers.set_status_flag(status, registers.CARRY_FLAG, left >= right),
                        difference,
                    ),
                };
                assert.deepEqual(
                ported.alu_compare(left, right, status),
                expected,
                `alu_compare(${left}, ${right}, ${status})`,
            );
            }
        }
    }
});

test("alu_bit_test matches the CPU's BIT step", () => {
    for (const left of BYTE_VALUES) {
        for (const operand of BYTE_VALUES) {
            for (const status of [0x20, 0x21, 0xe1]) {
                const expected = {
                    value: left,
                    status: registers.set_status_flag(
                        registers.set_status_flag(
                            registers.set_status_flag(status, registers.ZERO_FLAG, (left & operand) === 0),
                            registers.OVERFLOW_FLAG,
                            (operand & registers.OVERFLOW_FLAG) !== 0,
                        ),
                        registers.NEGATIVE_FLAG,
                        (operand & registers.NEGATIVE_FLAG) !== 0,
                    ),
                };
                assert.deepEqual(
                    ported.alu_bit_test(left, operand, status),
                    expected,
                    `alu_bit_test(${left}, ${operand}, ${status})`,
                );
            }
        }
    }
});

test("alu_increment and alu_decrement match the CPU's INC and DEC steps", () => {
    for (const value of BYTE_VALUES) {
        for (const status of BYTE_VALUES) {
            const incremented = registers.normalize_byte(value + 1);
            const decremented = registers.normalize_byte(value - 1);
            assert.deepEqual(
                ported.alu_increment(value, status),
                { value: incremented, status: registers.update_zero_negative_flags(status, incremented) },
                `alu_increment(${value}, ${status})`,
            );
            assert.deepEqual(
                ported.alu_decrement(value, status),
                { value: decremented, status: registers.update_zero_negative_flags(status, decremented) },
                `alu_decrement(${value}, ${status})`,
            );
        }
    }
});

test("the controller mirror matches NesControllerPorts for every button mask", () => {
    for (const mask of BYTE_VALUES) {
        for (const controller_index of [0, 1] as const) {
            const reference_ports = new NesControllerPorts();
            const ported_ports = new ported.GoboscriptControllerPorts();
            reference_ports.set_button_mask(controller_index, mask);
            ported_ports.set_button_mask(controller_index, mask);
            reference_ports.write_strobe(1);
            ported_ports.write_strobe(1);
            reference_ports.write_strobe(0);
            ported_ports.write_strobe(0);

            for (let read_index = 0; read_index < CONTROLLER_READS_PER_CASE; read_index += 1) {
                const expected = reference_ports.read_controller(controller_index, 0);
                assert.ok(expected);
                assert.equal(
                    ported_ports.serial_read(controller_index),
                    expected.value,
                    `serial read ${read_index} of mask ${mask} on port ${controller_index}`,
                );
            }
        }
    }
});

test("the controller mirror polls A live while the strobe is high", () => {
    for (const mask of BYTE_VALUES) {
        for (const controller_index of [0, 1] as const) {
            const reference_ports = new NesControllerPorts();
            const ported_ports = new ported.GoboscriptControllerPorts();
            reference_ports.write_strobe(1);
            ported_ports.write_strobe(1);
            reference_ports.set_button_mask(controller_index, mask);
            ported_ports.set_button_mask(controller_index, mask);

            const expected = reference_ports.read_controller(controller_index, 0);
            assert.ok(expected);
            assert.equal(
                ported_ports.serial_read(controller_index),
                expected.value,
                `live strobe read of mask ${mask} on port ${controller_index}`,
            );
        }
    }
});

test("the controller mirror latches on the strobe falling edge only", () => {
    const reference_ports = new NesControllerPorts();
    const ported_ports = new ported.GoboscriptControllerPorts();
    reference_ports.set_button_mask(0, 0b1010_0101);
    ported_ports.set_button_mask(0, 0b1010_0101);
    reference_ports.write_strobe(1);
    ported_ports.write_strobe(1);
    reference_ports.write_strobe(1);
    ported_ports.write_strobe(1);

    // Changing the mask while the strobe is high must not reach the latched report.
    reference_ports.set_button_mask(0, 0xff);
    ported_ports.set_button_mask(0, 0xff);
    reference_ports.write_strobe(0);
    ported_ports.write_strobe(0);

    for (let read_index = 0; read_index < CONTROLLER_READS_PER_CASE; read_index += 1) {
        const expected = reference_ports.read_controller(0, 0);
        assert.ok(expected);
        assert.equal(ported_ports.serial_read(0), expected.value, `latched read ${read_index}`);
    }
});

test("the bus mirror matches NesCpuBus across every decoded window", () => {
    const reference_controllers = new NesControllerPorts();
    const reference_bus = new NesCpuBus(make_controller_bus_devices(reference_controllers));
    const ported_bus = new ported.GoboscriptCpuBus();
    const addresses = [
        0x0000, 0x0010, 0x0100, 0x07ff, 0x0800, 0x0900, 0x0fff, 0x1000, 0x1fff, 0x2000, 0x2002, 0x2004, 0x2006, 0x2007,
        0x3fff, 0x4000, 0x4014, 0x4015, 0x4016, 0x4017, 0x4018, 0x401f, 0x4020, 0x8000, 0xc000, 0xfffe,
    ];

    for (const value of [0x00, 0x01, 0x5a, 0x7f, 0x80, 0xa5, 0xc3, 0xff]) {
        for (const address of addresses) {
            reference_bus.write_cpu(address, value);
            ported_bus.write(address, value);
        }

        for (const address of addresses) {
            assert.equal(
                ported_bus.read(address),
                reference_bus.read_cpu(address),
                `read $${address.toString(16)} after $${value.toString(16)}`,
            );
        }
    }

    // Controller reads drive only data line 0, so the retained latch must supply bits 1-7.
    for (const mask of [0x00, 0x01, 0xa5, 0xff]) {
        for (const latch of [0x00, 0x5a, 0xff]) {
            reference_controllers.set_button_mask(0, mask);
            reference_controllers.set_button_mask(1, registers.normalize_byte(~mask));
            ported_bus.controllers.set_button_mask(0, mask);
            ported_bus.controllers.set_button_mask(1, registers.normalize_byte(~mask));
            reference_bus.write_cpu(0x4016, 1);
            ported_bus.write(0x4016, 1);
            reference_bus.write_cpu(0x4018, latch);
            ported_bus.write(0x4018, latch);
            reference_bus.write_cpu(0x4016, 0);
            ported_bus.write(0x4016, 0);

            for (let read_index = 0; read_index < 12; read_index += 1) {
                assert.equal(
                    ported_bus.read(0x4016),
                    reference_bus.read_cpu(0x4016),
                    `port 0 read ${read_index} with mask ${mask} and latch ${latch}`,
                );
                assert.equal(
                    ported_bus.read(0x4017),
                    reference_bus.read_cpu(0x4017),
                    `port 1 read ${read_index} with mask ${mask} and latch ${latch}`,
                );
            }
        }
    }

    reference_bus.reset();
    ported_bus.reset();
    assert.equal(ported_bus.read(0x0000), reference_bus.read_cpu(0x0000), "RAM survives reset on both sides");
    assert.equal(ported_bus.read(0x4015), reference_bus.read_cpu(0x4015), "the latch is cleared by reset");
});

test("the mirror reproduces every shared numeric vector", () => {
    for (const vector of get_shared_vector_suite("numeric").vectors) {
        const first = vector_input(vector, 0);
        const second = vector.input[1];
        let actual: number;

        switch (vector.operation) {
            case 1:
                actual = ported.normalize_byte(first);
                break;
            case 2:
                actual = ported.normalize_word(first);
                break;
            case 3:
                actual = ported.to_signed_byte(first);
                break;
            case 4:
                actual = ported.normalize_status(first);
                break;
            case 5:
                actual = ported.pack_status_for_stack(first, 1);
                break;
            case 6:
                actual = ported.update_zero_negative_flags(first, second ?? 0);
                break;
            case 7:
                actual = ported.bit_at(first, second ?? 0);
                break;
            case 8:
                actual = ported.bitwise_and(first, second ?? 0);
                break;
            case 9:
                actual = ported.bitwise_or(first, second ?? 0);
                break;
            case 10:
                actual = ported.bitwise_xor(first, second ?? 0);
                break;
            case 11:
                actual = ported.byte_high(first);
                break;
            case 12:
                actual = ported.byte_low(first);
                break;
            case 13:
                actual = ported.join_bytes(first, second ?? 0);
                break;
            default:
                assert.fail(`Unsupported numeric vector operation ${vector.operation}.`);
        }

        assert.deepEqual([actual], [...vector.expected], `numeric vector ${vector.id}`);
    }
});

test("the mirror reproduces every shared ALU vector", () => {
    for (const vector of get_shared_vector_suite("alu").vectors) {
        const first = vector_input(vector, 0);
        const second = vector.input[1] ?? 0;
        const third = vector.input[2] ?? 0;
        let actual: ported.AluResult;

        switch (vector.operation) {
            case 1:
                actual = ported.alu_add_with_carry(first, second, third);
                break;
            case 2:
                actual = ported.alu_subtract_with_carry(first, second, third);
                break;
            case 3:
                actual = ported.alu_and(first, second, third);
                break;
            case 4:
                actual = ported.alu_ora(first, second, third);
                break;
            case 5:
                actual = ported.alu_eor(first, second, third);
                break;
            case 6:
                actual = ported.alu_shift_left(first, second);
                break;
            case 7:
                actual = ported.alu_shift_right(first, second);
                break;
            case 8:
                actual = ported.alu_rotate_left(first, second);
                break;
            case 9:
                actual = ported.alu_rotate_right(first, second);
                break;
            case 10:
            case 11:
            case 12:
                actual = ported.alu_compare(first, second, third);
                break;
            case 13:
                actual = ported.alu_bit_test(first, second, third);
                break;
            case 14:
                actual = ported.alu_increment(first, second);
                break;
            case 15:
                actual = ported.alu_decrement(first, second);
                break;
            default:
                assert.fail(`Unsupported ALU vector operation ${vector.operation}.`);
        }

        assert.deepEqual([actual.value, actual.status], [...vector.expected], `ALU vector ${vector.id}`);
    }
});

test("the mirror replays every shared bus vector", () => {
    for (const vector of get_shared_vector_suite("bus").vectors) {
        const bus = new ported.GoboscriptCpuBus();
        const operation_count = vector_input(vector, 0);
        const reads: number[] = [];
        bus.reset();
        bus.controllers.reset();
        bus.controllers.set_button_mask(0, 0);
        bus.controllers.set_button_mask(1, 0);

        for (let operation_index = 0; operation_index < operation_count; operation_index += 1) {
            const kind = vector_input(vector, 1 + operation_index * 3);
            const address = vector_input(vector, 2 + operation_index * 3);
            const value = vector_input(vector, 3 + operation_index * 3);

            if (kind === 1) {
                bus.write(address, value);
            } else {
                assert.equal(kind, 0);
                reads.push(bus.read(address));
            }
        }

        assert.deepEqual([reads.length, ...reads], [...vector.expected], `bus vector ${vector.id}`);
    }
});

test("the mirror reproduces every shared controller vector", () => {
    for (const vector of get_shared_vector_suite("controller").vectors) {
        const controller_index = vector_input(vector, 0) as 0 | 1;
        const button_mask = vector_input(vector, 1);
        const read_count = vector_input(vector, 2);
        const ports = new ported.GoboscriptControllerPorts();
        ports.reset();
        ports.set_button_mask(0, 0);
        ports.set_button_mask(1, 0);
        ports.set_button_mask(controller_index, button_mask);
        ports.write_strobe(1);
        ports.write_strobe(0);

        const reads = Array.from({ length: read_count }, () => ports.serial_read(controller_index));
        assert.deepEqual(reads, [...vector.expected], `controller vector ${vector.id}`);
    }
});

const CARTRIDGE_MAGIC: readonly number[] = [0x4e, 0x45, 0x53, 0x1a];

/** Builds one 16-byte header from the iNES fields the sweeps vary. */
function cartridge_header(
    prg_banks: number,
    chr_banks: number,
    flags6: number,
    flags7: number,
    byte8 = 0,
    byte9 = 0,
    byte10 = 0,
    byte11 = 0,
): number[] {
    return [...CARTRIDGE_MAGIC, prg_banks, chr_banks, flags6, flags7, byte8, byte9, byte10, byte11, 0, 0, 0, 0, 0, 0];
}

/** Parses one header with the mirror and the reference and compares all eighteen values. */
function assert_cartridge_headers_agree(image_bytes: number, header: readonly number[], label: string): number[] {
    const parser = new ported.GoboscriptCartridgeParser();
    parser.image_bytes = image_bytes;

    for (let index = 0; index < CARTRIDGE_HEADER_BYTES; index += 1) {
        parser.header[index] = header[index] ?? 0;
    }

    parser.parse();
    const reported = parser.reported_values();
    assert.deepEqual(reported, project_cartridge_header(image_bytes, header), label);
    return reported;
}

test("the mirror reproduces every shared cartridge vector", () => {
    for (const vector of get_shared_vector_suite("cartridge").vectors) {
        const parser = new ported.GoboscriptCartridgeParser();
        parser.image_bytes = vector_input(vector, 0);

        for (let index = 0; index < CARTRIDGE_HEADER_BYTES; index += 1) {
            parser.header[index] = vector_input(vector, index + 1);
        }

        parser.parse();
        assert.deepEqual(parser.reported_values(), [...vector.expected], `cartridge vector ${vector.id}`);
        assert.deepEqual(
            parser.reported_values(),
            project_cartridge_header(parser.image_bytes, parser.header),
            `cartridge vector ${vector.id} against the reference parse`,
        );
    }
});

test("the mirror cartridge parser matches the reference for every flags6 and flags7 byte", () => {
    for (let flags6 = 0; flags6 < 256; flags6 += 1) {
        assert_cartridge_headers_agree(16_912, cartridge_header(1, 0, flags6, 0x00), `flags6 ${flags6}`);
    }

    for (let flags7 = 0; flags7 < 256; flags7 += 1) {
        assert_cartridge_headers_agree(41_488, cartridge_header(2, 1, 0x41, flags7), `flags7 ${flags7}`);
    }
});

test("the mirror cartridge parser matches the reference for every legacy PRG RAM bank count", () => {
    for (let banks = 0; banks < 16; banks += 1) {
        for (const battery_bit of [0x00, 0x02]) {
            assert_cartridge_headers_agree(
                41_488,
                cartridge_header(2, 1, 0x01 | battery_bit, 0x00, banks),
                `banks ${banks} battery ${battery_bit}`,
            );
        }
    }
});

test("the mirror cartridge parser matches the reference for every NES 2.0 mapper and RAM byte", () => {
    for (let byte8 = 0; byte8 < 256; byte8 += 1) {
        assert_cartridge_headers_agree(41_488, cartridge_header(2, 1, 0xf1, 0xf8, byte8), `mapper byte ${byte8}`);
    }

    for (let byte10 = 0; byte10 < 256; byte10 += 1) {
        assert_cartridge_headers_agree(41_488, cartridge_header(2, 1, 0x01, 0x08, 0, 0, byte10), `byte10 ${byte10}`);
    }

    for (let byte11 = 0; byte11 < 256; byte11 += 1) {
        assert_cartridge_headers_agree(41_488, cartridge_header(2, 1, 0x01, 0x08, 0, 0, 0, byte11), `byte11 ${byte11}`);
    }
});

test("the mirror NES 2.0 ROM size decoder matches the reference for every encoded size", () => {
    const exact_image_cap_bytes = 64 * 1024;
    const max_image_bytes = 32 * 1024 * 1024;
    const large_cases: { readonly low: number; readonly high: number; readonly decoded: number }[] = [];

    for (let high = 0; high < 16; high += 1) {
        for (let low = 0; low < 256; low += 1) {
            const decoded = ported.decode_nes2_rom_size(low, high, 16_384);
            const header = cartridge_header(low, 0, 0x00, 0x08, 0, high);

            if (decoded < 0) {
                // The reference decoder returns undefined, which the port reports as -1.
                assert_cartridge_headers_agree(CARTRIDGE_HEADER_BYTES, header, `unsafe low ${low} high ${high}`);
                continue;
            }

            if (decoded <= exact_image_cap_bytes) {
                const reported = assert_cartridge_headers_agree(
                    CARTRIDGE_HEADER_BYTES + decoded,
                    header,
                    `low ${low} high ${high}`,
                );
                assert.equal(reported[8], decoded, `decoded PRG size for low ${low} high ${high}`);
                continue;
            }

            // Larger sizes are compared through a short image, which both parsers must reject.
            assert_cartridge_headers_agree(CARTRIDGE_HEADER_BYTES, header, `oversized low ${low} high ${high}`);

            if (CARTRIDGE_HEADER_BYTES + decoded <= max_image_bytes) {
                large_cases.push({ low, high, decoded });
            }
        }
    }

    // Four large decoded sizes are also compared with an image that exactly fits them, so the
    // reference confirms the byte counts and not just the rejection path.
    const unique_sizes = new Map<number, { readonly low: number; readonly high: number; readonly decoded: number }>();

    for (const entry of large_cases) {
        unique_sizes.set(entry.decoded, entry);
    }

    const sorted_cases = [...unique_sizes.values()].sort((left, right) => left.decoded - right.decoded);
    assert.ok(sorted_cases.length >= 4, "the sweep produced several large but parseable sizes");

    for (const fraction of [0, 1 / 3, 2 / 3, 1]) {
        const entry = sorted_cases[Math.round(fraction * (sorted_cases.length - 1))];
        assert.ok(entry !== undefined);
        const reported = assert_cartridge_headers_agree(
            CARTRIDGE_HEADER_BYTES + entry.decoded,
            cartridge_header(entry.low, 0, 0x00, 0x08, 0, entry.high),
            `large decoded size ${entry.decoded}`,
        );
        assert.equal(reported[8], entry.decoded, `decoded PRG size ${entry.decoded}`);
    }
});

test("the mirror NES 2.0 RAM size decoder matches the reference for every shift nibble", () => {
    for (let shift = 0; shift < 16; shift += 1) {
        const decoded = ported.decode_nes2_ram_size(shift);
        const prg_reported = assert_cartridge_headers_agree(
            41_488,
            cartridge_header(2, 1, 0x01, 0x08, 0, 0, shift, 0),
            `prg ram shift ${shift}`,
        );
        const chr_reported = assert_cartridge_headers_agree(
            41_488,
            cartridge_header(2, 1, 0x01, 0x08, 0, 0, 0, shift),
            `chr ram shift ${shift}`,
        );
        assert.equal(prg_reported[10], decoded, `prg ram shift ${shift}`);
        assert.equal(chr_reported[12], decoded, `chr ram shift ${shift}`);
    }
});

test("the mirror power_of_two matches repeated doubling up to the largest decoded shift", () => {
    for (let exponent = 0; exponent <= 63; exponent += 1) {
        assert.equal(ported.power_of_two(exponent), 2 ** exponent, `power_of_two(${exponent})`);
    }
});

test("the mirror is_safe_size matches the reference safe-integer guard", () => {
    const samples: readonly number[] = [
        0,
        1,
        512,
        8_192,
        16_384,
        33_554_432,
        2 ** 40,
        Number.MAX_SAFE_INTEGER - 1,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER + 1,
        2 ** 53,
        2 ** 62,
        2 ** 63,
        -1,
        -Number.MAX_SAFE_INTEGER,
        -(Number.MAX_SAFE_INTEGER + 1),
    ];

    for (const sample of samples) {
        assert.equal(ported.is_safe_size(sample), Number.isSafeInteger(sample) ? 1 : 0, `is_safe_size(${sample})`);
    }
});

test("the mirror reports the same failure code as the reference for a truncated image", () => {
    const header = cartridge_header(2, 1, 0x01, 0x00);

    for (let image_bytes = 0; image_bytes <= CARTRIDGE_HEADER_BYTES; image_bytes += 1) {
        const parser = new ported.GoboscriptCartridgeParser();
        parser.image_bytes = image_bytes;
        make_cartridge_image(image_bytes, header).forEach((value, index) => {
            parser.header[index] = value;
        });
        parser.parse();

        const parsed = parse_ines_rom(make_cartridge_image(image_bytes, header));
        assert.equal(parser.ok, parsed.ok ? 1 : 0, `image_bytes ${image_bytes}`);
        assert.deepEqual(parser.reported_values(), project_cartridge_header(image_bytes, header));
    }
});

function make_controller_bus_devices(controllers: NesControllerPorts): NesCpuBusDevices {
    return {
        ppu: {
            read_cpu_register: () => null,
            write_cpu_register: () => {},
        },
        apu: {
            read_status: () => null,
            write_register: () => {},
        },
        controllers,
        cartridge: {
            read_cpu: () => null,
            write_cpu: () => {},
        },
    };
}
