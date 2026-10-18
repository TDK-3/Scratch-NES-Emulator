import assert from "node:assert/strict";
import test from "node:test";

import { add_with_carry, subtract_with_carry } from "../src/nes/cpu/alu.js";
import { Cpu2A03 } from "../src/nes/cpu/cpu_2a03.js";
import { FakeCpuBus } from "./support/FakeCpuBus.js";
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
import {
    CPU_ADDRESSING_FIXED_INPUT_COUNT,
    CPU_ADDRESSING_MODES,
    CPU_OPERAND_ACCESSES,
    CPU_OPERAND_KIND_IDS,
    project_cpu_addressing,
    type CpuAddressingSetup,
} from "./support/cpu_addressing_projection.js";
import {
    CPU_INSTRUCTION_ERROR_IDS,
    CPU_INSTRUCTION_FIXED_INPUT_COUNT,
    CPU_INSTRUCTION_FIXED_VALUE_COUNT,
    CPU_INSTRUCTION_PORTED_MNEMONICS,
} from "./support/cpu_instruction_projection.js";
import {
    cpu_mnemonic_ids,
    flat_opcode_table,
    opcode_table_fixture,
    project_opcode_decode,
} from "./support/cpu_opcode_projection.js";
import {
    CPU_SEQUENCE_FIXED_INPUT_COUNT,
    CPU_SEQUENCE_OPS,
    project_cpu_sequence,
    type CpuSequenceSetup,
} from "./support/cpu_sequence_projection.js";
import { parse_ines_rom } from "../src/nes/cartridge/ines.js";
import * as ported from "./support/goboscript_port_algorithms.js";
import { get_shared_vector_suite, vector_input } from "./support/shared_port_vectors.js";

/**
 * Exhaustive comparison of the bit-free GoboScript port algorithms with the bitwise TypeScript
 * reference. tests/support/goboscript_port_algorithms.ts mirrors every algorithm in the
 * mirrored headers: numeric.gs, cpu_status.gs, cpu_alu.gs, controller.gs, cpu_bus.gs,
 * cartridge.gs, cpu_core.gs, cpu_addressing.gs, cpu_sequence.gs, and cpu_opcode.gs. A
 * divergence here means either the mirror or the reference is wrong; a pass means the ported
 * arithmetic reproduces production CPU, bus, cartridge, and controller behavior for every input
 * in the swept ranges. It does not mean the .gs sources compile: the pinned GoboScript toolchain
 * is still unavailable.
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

/** Builds a mirror CPU core whose decoder starts cleared, like a fresh NesCpuBus per record. */
function make_mirror_cpu_core(vector_inputs: readonly number[]): ported.GoboscriptCpuCore {
    const core = new ported.GoboscriptCpuCore();
    core.reset_registers();
    core.bus.clear_ram();
    core.bus.reset();
    core.program_counter = vector_inputs[1] ?? 0;
    core.a = vector_inputs[2] ?? 0;
    core.x = vector_inputs[3] ?? 0;
    core.y = vector_inputs[4] ?? 0;
    core.stack_pointer = vector_inputs[5] ?? 0;
    core.status = vector_inputs[6] ?? 0;

    const setup_count = vector_inputs[7] ?? 0;

    for (let index = 0; index < setup_count; index += 1) {
        const address = vector_inputs[CPU_ADDRESSING_FIXED_INPUT_COUNT + index * 2] ?? 0;
        const value = vector_inputs[CPU_ADDRESSING_FIXED_INPUT_COUNT + index * 2 + 1] ?? 0;
        core.bus.write(address, value);
    }

    core.reset_cycle_accounting();
    return core;
}

test("the mirror reproduces every shared cpu_addressing vector", () => {
    for (const vector of get_shared_vector_suite("cpu_addressing").vectors) {
        const core = make_mirror_cpu_core(vector.input);
        core.resolve_operand(vector.operation, vector.input[0] ?? 0);

        assert.deepEqual(core.reported_values(), [...vector.expected], `cpu_addressing vector ${vector.id}`);

        const setup: CpuAddressingSetup[] = [];
        const setup_count = vector.input[7] ?? 0;

        for (let index = 0; index < setup_count; index += 1) {
            setup.push({
                address: vector_input(vector, CPU_ADDRESSING_FIXED_INPUT_COUNT + index * 2),
                value: vector_input(vector, CPU_ADDRESSING_FIXED_INPUT_COUNT + index * 2 + 1),
            });
        }

        assert.deepEqual(
            core.reported_values(),
            project_cpu_addressing(
                vector.operation,
                vector.input[0] ?? 0,
                vector_input(vector, 1),
                vector_input(vector, 2),
                vector_input(vector, 3),
                vector_input(vector, 4),
                vector_input(vector, 5),
                vector_input(vector, 6),
                setup,
            ),
            `cpu_addressing vector ${vector.id} against the reference resolution`,
        );
    }
});

test("the mirror resolves every addressing mode and access the reference accepts", () => {
    const covered = new Set<string>();

    for (const vector of get_shared_vector_suite("cpu_addressing").vectors) {
        covered.add(`${vector.operation}:${vector.input[0] ?? 0}`);
    }

    for (const mode of CPU_ADDRESSING_MODES) {
        assert.ok(covered.has(`${mode.id}:1`), `mode ${mode.name} has no read vector`);
    }

    for (const access of CPU_OPERAND_ACCESSES) {
        assert.ok(covered.has(`5:${access.id}`), `zero page has no ${access.name} vector`);
    }
});

test("the mirror reports an error code where the reference rejects a mode and access pair", () => {
    const rejected: readonly { readonly mode: number; readonly access: number }[] = [
        { mode: ported.CPU_ADDRESSING_MODE.IMPLIED, access: ported.CPU_OPERAND_ACCESS.WRITE },
        { mode: ported.CPU_ADDRESSING_MODE.IMPLIED, access: ported.CPU_OPERAND_ACCESS.READ_MODIFY_WRITE },
        { mode: ported.CPU_ADDRESSING_MODE.ACCUMULATOR, access: ported.CPU_OPERAND_ACCESS.WRITE },
        { mode: ported.CPU_ADDRESSING_MODE.IMMEDIATE, access: ported.CPU_OPERAND_ACCESS.WRITE },
        { mode: ported.CPU_ADDRESSING_MODE.IMMEDIATE, access: ported.CPU_OPERAND_ACCESS.READ_MODIFY_WRITE },
        { mode: ported.CPU_ADDRESSING_MODE.RELATIVE, access: ported.CPU_OPERAND_ACCESS.WRITE },
        { mode: ported.CPU_ADDRESSING_MODE.RELATIVE, access: ported.CPU_OPERAND_ACCESS.READ_MODIFY_WRITE },
        { mode: ported.CPU_ADDRESSING_MODE.INDIRECT, access: ported.CPU_OPERAND_ACCESS.WRITE },
        { mode: ported.CPU_ADDRESSING_MODE.INDIRECT, access: ported.CPU_OPERAND_ACCESS.READ_MODIFY_WRITE },
    ];

    for (const entry of rejected) {
        const reference = new Cpu2A03(new FakeCpuBus());
        const mode_name = CPU_ADDRESSING_MODES.find((candidate) => candidate.id === entry.mode)?.name;
        const access_name = CPU_OPERAND_ACCESSES.find((candidate) => candidate.id === entry.access)?.name;
        assert.ok(mode_name !== undefined && access_name !== undefined);
        assert.throws(
            () => reference.resolve_addressing_mode(mode_name as never, access_name as never),
            TypeError,
            `${mode_name} with ${access_name} must stay rejected`,
        );

        const core = new ported.GoboscriptCpuCore();
        core.resolve_operand(entry.mode, entry.access);
        assert.equal(core.resolved_error, ported.CPU_OPERAND_ERROR_CODE.UNSUPPORTED_ACCESS, `${mode_name}`);
        assert.equal(core.resolved_kind, CPU_OPERAND_KIND_IDS.none, `${mode_name} leaves no operand`);
        assert.equal(core.cycles, 0, `${mode_name} spends no cycle on a rejected combination`);
    }

    for (const unknown_mode of [0, 14, 255, -1]) {
        const core = new ported.GoboscriptCpuCore();
        core.resolve_operand(unknown_mode, ported.CPU_OPERAND_ACCESS.READ);
        assert.equal(core.resolved_error, ported.CPU_OPERAND_ERROR_CODE.UNKNOWN_MODE, `mode ${unknown_mode}`);
        assert.equal(core.resolved_kind, CPU_OPERAND_KIND_IDS.none, `mode ${unknown_mode}`);
    }
});

test("the mirror page-crossing and dummy-address helpers match the reference formulas", () => {
    const samples: readonly number[] = [0, 1, 0xff, 0x100, 0x1ff, 0x200, 0x3f0, 0x8000, 0x8010, 0xff00, 0xffff];

    for (const base of samples) {
        for (const address of samples) {
            const reference_crossed = (base & 0xff00) !== (address & 0xff00) ? 1 : 0;
            assert.equal(ported_page_crossed(base, address), reference_crossed, `${base} -> ${address}`);
            assert.equal(
                ported_indexed_dummy_address(base, address),
                (base & 0xff00) | (address & 0xff),
                `dummy address for ${base} -> ${address}`,
            );
        }
    }
});

/** Calls the mirror helpers through a core so both stay method-shaped like the .gs funcs. */
function ported_page_crossed(base_address: number, address: number): number {
    return new ported.GoboscriptCpuCore().page_crossed(base_address, address);
}

function ported_indexed_dummy_address(base_address: number, address: number): number {
    return new ported.GoboscriptCpuCore().indexed_dummy_address(base_address, address);
}

test("the mirror fetch helpers match the reference program-counter reads", () => {
    for (const program of [[0xa9, 0x42], [0x20, 0x00, 0x03], [0x6c, 0xff, 0x03]]) {
        const reference_bus = new FakeCpuBus();
        reference_bus.load(0x0200, Uint8Array.from(program));
        const reference = new Cpu2A03(reference_bus);
        reference.program_counter = 0x0200;

        const core = new ported.GoboscriptCpuCore();
        core.bus.clear_ram();

        for (let index = 0; index < program.length; index += 1) {
            core.bus.write(0x0200 + index, program[index] ?? 0);
        }

        core.reset_cycle_accounting();
        core.program_counter = 0x0200;

        const reference_bytes = program.map(() => read_reference_fetch_byte(reference));
        const mirror_bytes = program.map(() => {
            core.fetch_byte();
            return core.fetched_byte;
        });
        assert.deepEqual(mirror_bytes, reference_bytes, `program ${program.join(",")}`);
        assert.equal(core.program_counter, reference.program_counter);
        assert.equal(core.cycles, program.length, "one cycle per fetched byte");
        const logged_kinds = core.access_log.filter((_value, index) => index % 3 === 0);
        assert.deepEqual(logged_kinds, program.map(() => ported.CPU_ACCESS_KIND.READ));
    }

    // fetch_word joins the two fetched bytes little-endian, like fetch_word_cycle().
    const core = new ported.GoboscriptCpuCore();
    core.bus.write(0x0200, 0x34);
    core.bus.write(0x0201, 0x12);
    core.program_counter = 0x0200;
    core.reset_cycle_accounting();
    core.fetch_word();
    assert.equal(core.fetched_word, 0x1234);
    assert.equal(core.cycles, 2);
});

/** Reads one byte through the reference fetch path by resolving an immediate operand. */
function read_reference_fetch_byte(cpu: Cpu2A03): number {
    const before = cpu.program_counter;
    const operand = cpu.resolve_addressing_mode("immediate");
    assert.equal(operand.kind, "immediate");
    assert.equal(cpu.program_counter, (before + 1) & 0xffff);
    return operand.kind === "immediate" ? operand.value : 0;
}

test("the mirror stack operations match the reference stack transactions", () => {
    // PHA pushes the accumulator at $0100+SP and then decrements SP.
    const pha_bus = new FakeCpuBus();
    pha_bus.load(0x0200, Uint8Array.from([0x48]));
    const pha = new Cpu2A03(pha_bus);
    pha.program_counter = 0x0200;
    pha.a = 0x5a;
    pha.stack_pointer = 0xfd;
    pha.step();

    const pha_core = new ported.GoboscriptCpuCore();
    pha_core.stack_pointer = 0xfd;
    pha_core.push_byte(0x5a);
    assert.equal(pha_core.stack_pointer, pha.stack_pointer);
    assert.deepEqual(pha_core.access_log, [ported.CPU_ACCESS_KIND.WRITE, 0x01fd, 0x5a]);
    assert.equal(pha_bus.peek(0x01fd), 0x5a);

    // PLA increments SP first and then reads $0100+SP into the accumulator.
    const pla_bus = new FakeCpuBus();
    pla_bus.load(0x0200, Uint8Array.from([0x68]));
    pla_bus.write_cpu(0x01fe, 0x77);
    const pla = new Cpu2A03(pla_bus);
    pla.program_counter = 0x0200;
    pla.stack_pointer = 0xfd;
    pla.step();

    const pla_core = new ported.GoboscriptCpuCore();
    pla_core.bus.write(0x01fe, 0x77);
    pla_core.stack_pointer = 0xfd;
    pla_core.reset_cycle_accounting();
    pla_core.pop_byte();
    assert.equal(pla_core.popped_byte, 0x77);
    assert.equal(pla_core.stack_pointer, pla.stack_pointer);
    assert.equal(pla.a, 0x77);
    assert.deepEqual(pla_core.access_log, [ported.CPU_ACCESS_KIND.READ, 0x01fe, 0x77]);

    // JSR pushes the address of its last operand byte ($0202 here) high byte first, and RTS
    // pops low first, adds one, and spends a cycle reading that address.
    const jsr_bus = new FakeCpuBus();
    jsr_bus.load(0x0200, Uint8Array.from([0x20, 0x00, 0x03]));
    const jsr = new Cpu2A03(jsr_bus);
    jsr.program_counter = 0x0200;
    jsr.stack_pointer = 0xfd;
    jsr.step();
    assert.equal(jsr.program_counter, 0x0300);

    const jsr_core = new ported.GoboscriptCpuCore();
    jsr_core.stack_pointer = 0xfd;
    jsr_core.push_word(0x0202);
    assert.equal(jsr_core.stack_pointer, jsr.stack_pointer);
    assert.equal(jsr_bus.peek(0x01fd), 0x02);
    assert.equal(jsr_bus.peek(0x01fc), 0x02);
    assert.deepEqual(jsr_core.access_log, [
        ported.CPU_ACCESS_KIND.WRITE,
        0x01fd,
        0x02,
        ported.CPU_ACCESS_KIND.WRITE,
        0x01fc,
        0x02,
    ]);

    const rts_bus = new FakeCpuBus();
    rts_bus.load(0x0200, Uint8Array.from([0x60]));
    rts_bus.write_cpu(0x01fe, 0x33);
    rts_bus.write_cpu(0x01ff, 0x44);
    const rts = new Cpu2A03(rts_bus);
    rts.program_counter = 0x0200;
    rts.stack_pointer = 0xfd;
    rts.step();

    const rts_core = new ported.GoboscriptCpuCore();
    rts_core.bus.write(0x01fe, 0x33);
    rts_core.bus.write(0x01ff, 0x44);
    rts_core.stack_pointer = 0xfd;
    rts_core.reset_cycle_accounting();
    rts_core.pop_word();
    assert.equal(rts_core.popped_word, 0x4433);
    assert.equal(rts_core.stack_pointer, rts.stack_pointer);
    assert.equal(rts.program_counter, 0x4434);
    assert.equal(rts_core.cycles, 2);

    // BRK pushes PC then status with BREAK set; RTI restores status and pops PC.
    const brk_bus = new FakeCpuBus();
    brk_bus.load(0x0200, Uint8Array.from([0x00]));
    brk_bus.write_cpu(0xfffe, 0x00);
    brk_bus.write_cpu(0xffff, 0x04);
    const brk = new Cpu2A03(brk_bus);
    brk.program_counter = 0x0200;
    brk.stack_pointer = 0xfd;
    brk.status = 0x24;
    brk.step();

    const brk_core = new ported.GoboscriptCpuCore();
    brk_core.stack_pointer = 0xfd;
    brk_core.status = 0x24;
    brk_core.program_counter = 0x0202;
    brk_core.push_word(0x0202);
    brk_core.push_status(1);
    assert.equal(brk_core.stack_pointer, brk.stack_pointer);
    assert.equal(brk_bus.peek(0x01fb), 0x34);
    assert.equal(brk_core.access_log.at(-1), 0x34, "BRK pushes the status with BREAK set");

    const irq_core = new ported.GoboscriptCpuCore();
    irq_core.stack_pointer = 0xfd;
    irq_core.status = 0x24;
    irq_core.push_status(0);
    assert.equal(irq_core.access_log.at(-1), 0x24, "a hardware interrupt pushes BREAK clear");

    const rti_bus = new FakeCpuBus();
    rti_bus.load(0x0200, Uint8Array.from([0x40]));
    rti_bus.write_cpu(0x01fe, 0x24);
    rti_bus.write_cpu(0x01ff, 0x33);
    rti_bus.write_cpu(0x0100, 0x44);
    const rti = new Cpu2A03(rti_bus);
    rti.program_counter = 0x0200;
    rti.stack_pointer = 0xfd;
    rti.step();

    const rti_core = new ported.GoboscriptCpuCore();
    rti_core.bus.write(0x01fe, 0x24);
    rti_core.bus.write(0x01ff, 0x33);
    rti_core.bus.write(0x0100, 0x44);
    rti_core.stack_pointer = 0xfd;
    rti_core.reset_cycle_accounting();
    rti_core.pop_byte();
    rti_core.restore_status_from_stack(rti_core.popped_byte);
    rti_core.pop_word();
    const restored_pc = rti_core.popped_word;
    assert.equal(restored_pc, rti.program_counter);
    assert.equal(rti_core.status, rti.status);
    assert.equal(rti_core.stack_pointer, rti.stack_pointer);
    assert.equal(rti_core.cycles, 3);
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
/**
 * Loads the register state and memory setup of one suite-11 record, then clears the cycle
 * accounting, exactly as `run_cpu_sequence_vector` in scratch/src/vector_selftest.gs does.
 */
/**
 * Builds a mirror core for one suite-13 record the way `run_cpu_instruction_vector` does: the
 * decoder reads the canonical generated table, the setup pairs and the program bytes are written
 * through the mirrored bus, and cycle accounting starts clean at the opcode fetch.
 */
function make_mirror_cpu_instruction(vector_inputs: readonly number[]): ported.GoboscriptCpuCore {
    const core = new ported.GoboscriptCpuCore();
    core.decoder = new ported.GoboscriptCpuOpcodeDecoder(flat_opcode_table());
    core.reset_registers();
    core.bus.clear_ram();
    core.bus.reset();
    core.program_counter = vector_inputs[0] ?? 0;
    core.a = vector_inputs[1] ?? 0;
    core.x = vector_inputs[2] ?? 0;
    core.y = vector_inputs[3] ?? 0;
    core.stack_pointer = vector_inputs[4] ?? 0;
    core.status = vector_inputs[5] ?? 0;
    core.jammed = 0;

    const program_count = vector_inputs[CPU_INSTRUCTION_FIXED_INPUT_COUNT - 2] ?? 0;
    const setup_count = vector_inputs[CPU_INSTRUCTION_FIXED_INPUT_COUNT - 1] ?? 0;

    for (let index = 0; index < setup_count; index += 1) {
        const pair_start = CPU_INSTRUCTION_FIXED_INPUT_COUNT + program_count + index * 2;
        core.bus.write(vector_inputs[pair_start] ?? 0, vector_inputs[pair_start + 1] ?? 0);
    }

    for (let index = 0; index < program_count; index += 1) {
        core.bus.write(core.program_counter + index, vector_inputs[CPU_INSTRUCTION_FIXED_INPUT_COUNT + index] ?? 0);
    }

    core.reset_cycle_accounting();
    return core;
}

function make_mirror_cpu_sequence(vector_inputs: readonly number[]): ported.GoboscriptCpuCore {
    const core = new ported.GoboscriptCpuCore();
    core.reset_registers();
    core.bus.clear_ram();
    core.bus.reset();
    core.program_counter = vector_inputs[0] ?? 0;
    core.a = vector_inputs[1] ?? 0;
    core.x = vector_inputs[2] ?? 0;
    core.y = vector_inputs[3] ?? 0;
    core.stack_pointer = vector_inputs[4] ?? 0;
    core.status = vector_inputs[5] ?? 0;

    const setup_count = vector_inputs[7] ?? 0;

    for (let index = 0; index < setup_count; index += 1) {
        const address = vector_inputs[CPU_SEQUENCE_FIXED_INPUT_COUNT + index * 2] ?? 0;
        const value = vector_inputs[CPU_SEQUENCE_FIXED_INPUT_COUNT + index * 2 + 1] ?? 0;
        core.bus.write(address, value);
    }

    core.reset_cycle_accounting();
    core.reset_sequence_error();
    return core;
}

/**
 * Runs one suite-11 record on the mirror. Instruction sequences fetch their opcode byte first,
 * because the reference reaches BRK, JSR, RTI, and RTS through execute_instruction_cycles;
 * reset and the two hardware interrupts fetch no opcode.
 */
function run_mirror_cpu_sequence(operation_id: number, vector_inputs: readonly number[]): ported.GoboscriptCpuCore {
    const core = make_mirror_cpu_sequence(vector_inputs);
    const taken = vector_inputs[6] ?? 0;

    switch (operation_id) {
        case ported.CPU_SEQUENCE_OP.RESET:
            core.execute_reset_cycles();
            break;
        case ported.CPU_SEQUENCE_OP.BRK:
            core.fetch_byte();
            core.execute_brk_cycles();
            break;
        case ported.CPU_SEQUENCE_OP.JSR:
            core.fetch_byte();
            core.execute_jsr_cycles();
            break;
        case ported.CPU_SEQUENCE_OP.RTI:
            core.fetch_byte();
            core.execute_rti_cycles();
            break;
        case ported.CPU_SEQUENCE_OP.RTS:
            core.fetch_byte();
            core.execute_rts_cycles();
            break;
        case ported.CPU_SEQUENCE_OP.IRQ:
            core.execute_hardware_interrupt_cycles(ported.CPU_INTERRUPT_SOURCE.IRQ);
            break;
        case ported.CPU_SEQUENCE_OP.NMI:
            core.execute_hardware_interrupt_cycles(ported.CPU_INTERRUPT_SOURCE.NMI);
            break;
        case ported.CPU_SEQUENCE_OP.RELATIVE_BRANCH:
            core.fetch_byte();
            core.resolve_operand(ported.CPU_ADDRESSING_MODE.RELATIVE, ported.CPU_OPERAND_ACCESS.READ);
            core.apply_relative_branch_cycles(taken);
            break;
        default:
            throw new RangeError(`Unknown CPU sequence id ${operation_id}.`);
    }

    return core;
}

/** The values `run_cpu_sequence_vector` appends, in the order suite 11 records them. */
function mirror_sequence_values(core: ported.GoboscriptCpuCore): number[] {
    return [
        core.cycles,
        core.program_counter,
        core.stack_pointer,
        core.status,
        core.a,
        core.x,
        core.y,
        core.sequence_error,
        ...core.access_log,
    ];
}

/** Collects the memory setup pairs of one suite-11 record. */
function mirror_sequence_setup(vector_inputs: readonly number[]): CpuSequenceSetup[] {
    const setup: CpuSequenceSetup[] = [];
    const setup_count = vector_inputs[7] ?? 0;

    for (let index = 0; index < setup_count; index += 1) {
        setup.push({
            address: vector_inputs[CPU_SEQUENCE_FIXED_INPUT_COUNT + index * 2] ?? 0,
            value: vector_inputs[CPU_SEQUENCE_FIXED_INPUT_COUNT + index * 2 + 1] ?? 0,
        });
    }

    return setup;
}

test("the mirror reproduces every shared cpu_sequence vector", () => {
    for (const vector of get_shared_vector_suite("cpu_sequence").vectors) {
        const core = run_mirror_cpu_sequence(vector.operation, vector.input);
        assert.deepEqual(mirror_sequence_values(core), [...vector.expected], `cpu_sequence vector ${vector.id}`);
        assert.equal(
            core.cycles,
            core.access_log.length / 3,
            `cpu_sequence vector ${vector.id} spends one cycle per bus access`,
        );

        assert.deepEqual(
            mirror_sequence_values(core),
            project_cpu_sequence(
                vector.operation,
                vector_input(vector, 0),
                vector_input(vector, 1),
                vector_input(vector, 2),
                vector_input(vector, 3),
                vector_input(vector, 4),
                vector_input(vector, 5),
                vector_input(vector, 6),
                mirror_sequence_setup(vector.input),
            ),
            `cpu_sequence vector ${vector.id} against the reference sequence`,
        );
    }
});

test("the shared cpu_sequence vectors cover every ported sequence id", () => {
    const covered = new Set(get_shared_vector_suite("cpu_sequence").vectors.map((vector) => vector.operation));
    assert.deepEqual(
        [...covered].sort((first, second) => first - second),
        CPU_SEQUENCE_OPS.map((entry) => entry.id),
    );
});

test("the mirror reports an error when a branch is applied to a non-relative operand", () => {
    // The reference guards this with a TypeError inside the private
    // apply_relative_branch_cycles(), which no public entry point can reach with the wrong
    // operand kind, so the port reports a code instead of throwing and spends no cycles.
    const core = make_mirror_cpu_sequence([0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 1, 2, 0x0200, 0xa5, 0x0201, 0x30]);
    core.resolve_operand(ported.CPU_ADDRESSING_MODE.ZERO_PAGE, ported.CPU_OPERAND_ACCESS.READ);
    const cycles_before = core.cycles;
    const program_counter_before = core.program_counter;

    core.apply_relative_branch_cycles(1);

    assert.equal(core.sequence_error, ported.CPU_SEQUENCE_ERROR_CODE.NOT_RELATIVE_OPERAND);
    assert.equal(core.cycles, cycles_before, "a rejected branch spends nothing");
    assert.equal(core.program_counter, program_counter_before, "a rejected branch does not move the counter");
    assert.deepEqual(core.access_log.slice(cycles_before * 3), [], "a rejected branch touches no bus");

    // The same call with a relative operand succeeds and reports no error.
    const branched = make_mirror_cpu_sequence([0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 1, 2, 0x0200, 0x90, 0x0201, 0x05]);
    branched.fetch_byte();
    branched.resolve_operand(ported.CPU_ADDRESSING_MODE.RELATIVE, ported.CPU_OPERAND_ACCESS.READ);
    branched.apply_relative_branch_cycles(1);

    assert.equal(branched.sequence_error, ported.CPU_SEQUENCE_ERROR_CODE.NONE);
    assert.equal(branched.program_counter, 0x0207);

    // A branch that is not taken leaves the counter where the operand resolution put it.
    const not_taken = make_mirror_cpu_sequence([
        0x0200, 0x11, 0x22, 0x33, 0xfd, 0x25, 0, 2, 0x0200, 0x90, 0x0201, 0x05,
    ]);
    not_taken.fetch_byte();
    not_taken.resolve_operand(ported.CPU_ADDRESSING_MODE.RELATIVE, ported.CPU_OPERAND_ACCESS.READ);
    const cycles_after_operand = not_taken.cycles;
    not_taken.apply_relative_branch_cycles(0);

    assert.equal(not_taken.sequence_error, ported.CPU_SEQUENCE_ERROR_CODE.NONE);
    assert.equal(not_taken.cycles, cycles_after_operand, "a branch that is not taken spends nothing");
    assert.equal(not_taken.program_counter, 0x0202);
});

test("the mirrored opcode decoder reproduces the production table for all 256 opcodes", () => {
    const decoder = new ported.GoboscriptCpuOpcodeDecoder(flat_opcode_table());
    decoder.check_table();
    assert.equal(decoder.error, ported.CPU_OPCODE_ERROR_CODE.NONE, "the generated table passes its own check");
    assert.equal(decoder.table.length, 2 + 256 * 6);

    const mnemonic_ids = cpu_mnemonic_ids();
    const fixture = opcode_table_fixture();
    let officials = 0;

    for (let opcode = 0; opcode < 256; opcode += 1) {
        decoder.decode(opcode);
        const reported = decoder.reported_values();
        assert.deepEqual(reported, project_opcode_decode(opcode), `opcode $${opcode.toString(16)} decode`);
        assert.equal(reported.length, 7, "seven values are reported per opcode");
        assert.equal(reported[6], ported.CPU_OPCODE_ERROR_CODE.NONE, `opcode ${opcode} reports no error`);

        const entry = fixture.opcodes[opcode];
        assert.ok(entry !== undefined && entry.opcode === opcode, `fixture entry ${opcode} is in opcode order`);
        assert.deepEqual(reported.slice(0, 6), [
            entry.mnemonic_id,
            entry.addressing_mode_id,
            entry.base_cycles,
            entry.operand_access_id,
            entry.page_cross_cycle,
            entry.official,
        ]);

        const mnemonic = [...mnemonic_ids].find(([, id]) => id === reported[0])?.[0];
        assert.ok(mnemonic !== undefined, `mnemonic id ${reported[0]} names an instruction`);
        assert.ok(
            CPU_ADDRESSING_MODES.some((mode) => mode.id === reported[1]),
            `addressing mode id ${reported[1]} names a mode`,
        );
        assert.ok(
            CPU_OPERAND_ACCESSES.some((access) => access.id === reported[3]),
            `operand access id ${reported[3]} names an access`,
        );
        assert.ok(reported[4] === 0 || reported[4] === 1, "the page-cross flag is a flag");
        officials += reported[5] === 1 ? 1 : 0;
    }

    assert.equal(officials, 151, "the table marks the 151 official encodings");
});

test("the mirrored opcode decoder replays every suite 12 vector", () => {
    const decoder = new ported.GoboscriptCpuOpcodeDecoder(flat_opcode_table());

    for (const vector of get_shared_vector_suite("cpu_opcode").vectors) {
        decoder.decode(vector_input(vector, 0));
        assert.deepEqual(decoder.reported_values(), [...vector.expected], `cpu_opcode vector ${vector.id}`);
        assert.deepEqual(
            decoder.reported_values(),
            project_opcode_decode(vector_input(vector, 0)),
            `cpu_opcode vector ${vector.id} against the production table`,
        );
    }
});

test("the mirrored opcode decoder reports a table that did not load", () => {
    const canonical = flat_opcode_table();

    for (const broken of [
        canonical.slice(0, canonical.length - 6),
        [2, ...canonical.slice(1)],
        [canonical[0] ?? 0, 255, ...canonical.slice(2)],
        [],
    ]) {
        const decoder = new ported.GoboscriptCpuOpcodeDecoder(broken);
        decoder.check_table();
        assert.equal(decoder.error, ported.CPU_OPCODE_ERROR_CODE.BAD_TABLE, "a stale or missing table is reported");
    }

    // A table whose record is all zeros decodes to no mnemonic, which the port reports instead
    // of dispatching on a zero id.
    const zeroed = [...canonical];
    zeroed[2] = 0;
    const decoder = new ported.GoboscriptCpuOpcodeDecoder(zeroed);
    decoder.decode(0);
    assert.equal(decoder.mnemonic, 0);
    assert.equal(decoder.error, ported.CPU_OPCODE_ERROR_CODE.UNKNOWN_OPCODE);
});

test("the mirrored opcode decoder normalizes its argument and resets cleanly", () => {
    const decoder = new ported.GoboscriptCpuOpcodeDecoder(flat_opcode_table());

    decoder.decode(0x69);
    assert.equal(decoder.mnemonic, cpu_mnemonic_ids().get("ADC"), "ADC immediate decodes to ADC");
    assert.equal(decoder.mode, ported.CPU_ADDRESSING_MODE.IMMEDIATE);
    assert.equal(decoder.access, ported.CPU_OPERAND_ACCESS.READ);
    assert.equal(decoder.base_cycles, 2);

    // GoboScript list indexes are numbers, so an out-of-range byte is normalized first.
    decoder.decode(256);
    assert.deepEqual(decoder.reported_values(), project_opcode_decode(0), "256 normalizes to opcode 0");
    decoder.decode(-1);
    assert.deepEqual(decoder.reported_values(), project_opcode_decode(255), "-1 normalizes to opcode 255");

    decoder.reset_decode();
    assert.deepEqual(decoder.reported_values(), [0, 0, 0, 0, 0, 0, 0], "a reset decoder reports zeros");
});

test("the mirrored dispatcher replays every suite 13 instruction vector", () => {
    const vectors = get_shared_vector_suite("cpu_instruction").vectors;
    assert.ok(vectors.length >= 40, "suite 13 covers the ported instruction groups");

    for (const vector of vectors) {
        const core = make_mirror_cpu_instruction([...vector.input]);
        core.execute_instruction();

        const reported = core.instruction_values();
        assert.deepEqual(reported, [...vector.expected], `cpu_instruction vector ${vector.id}`);
        assert.equal(reported.length, CPU_INSTRUCTION_FIXED_VALUE_COUNT + core.cycles * 3, "one triple per cycle");
        assert.equal(core.cycles, reported[0], "the reported cycle count is the counter");
    }
});

test("the mirrored dispatcher reports what it does not execute", () => {
    // A project whose opcode table failed to load decodes nothing and refuses the instruction
    // after spending only the opcode fetch.
    const without_table = new ported.GoboscriptCpuCore();
    without_table.reset_registers();
    without_table.bus.clear_ram();
    without_table.bus.reset();
    without_table.program_counter = 0x0200;
    without_table.status = 0x24;
    without_table.bus.write(0x0200, 0xea);
    without_table.reset_cycle_accounting();
    without_table.execute_instruction();
    assert.equal(without_table.instruction_error, ported.CPU_INSTRUCTION_ERROR_CODE.UNDECODABLE_OPCODE);
    assert.equal(without_table.cycles, 1, "a refused instruction spends only its fetch");
    assert.equal(without_table.program_counter, 0x0201);

    // An official instruction the port has not reached yet is refused, not guessed at.
    const load = make_mirror_cpu_instruction([0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 2, 0, 0xa9, 0x5a]);
    load.execute_instruction();
    assert.equal(load.instruction_error, ported.CPU_INSTRUCTION_ERROR_CODE.UNSUPPORTED_MNEMONIC);
    assert.equal(load.cycles, 1);
    assert.equal(load.a, 0x11, "a refused load leaves the accumulator alone");
    assert.deepEqual(load.access_log, [0, 0x0200, 0xa9], "only the opcode fetch reaches the bus");

    // An unofficial opcode other than KIL is refused as unofficial.
    const unofficial = make_mirror_cpu_instruction([0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 2, 0, 0x03, 0x10]);
    unofficial.execute_instruction();
    assert.equal(unofficial.instruction_error, ported.CPU_INSTRUCTION_ERROR_CODE.UNOFFICIAL_OPCODE);
    assert.equal(unofficial.cycles, 1);
    assert.equal(unofficial.jammed, 0, "only KIL jams");

    // KIL spends the fetch plus one read at the advanced program counter, then jams.
    const jam = make_mirror_cpu_instruction([0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 1, 0, 0x02]);
    jam.execute_instruction();
    assert.equal(jam.instruction_error, ported.CPU_INSTRUCTION_ERROR_CODE.NONE);
    assert.equal(jam.jammed, 1);
    assert.equal(jam.cycles, 2);
    assert.deepEqual(jam.access_log, [0, 0x0200, 0x02, 0, 0x0201, 0], "the jam read follows the fetch");

    // A ported instruction clears the jam flag it did not set and reports no error.
    const nop = make_mirror_cpu_instruction([0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 1, 0, 0xea]);
    nop.execute_instruction();
    assert.equal(nop.instruction_error, ported.CPU_INSTRUCTION_ERROR_CODE.NONE);
    assert.equal(nop.jammed, 0);
    assert.equal(nop.cycles, 2, "an implied instruction spends the fetch and one dummy read");
});

test("the mirrored mnemonic ids and ported set agree with the canonical opcode table", () => {
    const mnemonic_ids = cpu_mnemonic_ids();

    for (const [name, id] of Object.entries(ported.CPU_MNEMONIC)) {
        assert.equal(mnemonic_ids.get(name), id, `CPU_MNEMONIC.${name} matches the fixture id`);
        assert.ok(CPU_INSTRUCTION_PORTED_MNEMONICS.includes(name), `${name} is in the ported set`);
    }

    assert.equal(
        Object.keys(ported.CPU_MNEMONIC).length,
        CPU_INSTRUCTION_PORTED_MNEMONICS.length,
        "the mirror declares every ported mnemonic",
    );
    assert.equal(CPU_INSTRUCTION_ERROR_IDS.none, 0, "no error is the zero code the fixture records");
});
