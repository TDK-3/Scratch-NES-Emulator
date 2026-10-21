import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { decode_rom_text, encode_rom_text } from "../src/nes/cartridge/rom_text.js";
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
    CPU_CONTROL_FIXED_INPUT_COUNT,
    CPU_CONTROL_FIXED_VALUE_COUNT,
} from "./support/cpu_control_projection.js";
import {
    CPU_INSTRUCTION_ERROR_IDS,
    CPU_INSTRUCTION_FIXED_INPUT_COUNT,
    CPU_INSTRUCTION_FIXED_VALUE_COUNT,
    CPU_INSTRUCTION_PORTED_MNEMONICS,
} from "./support/cpu_instruction_projection.js";
import { CPU_OPCODE_TABLE } from "../src/nes/cpu/opcode_table.js";
import {
    cpu_mnemonic_ids,
    flat_opcode_table,
    is_official_opcode,
    opcode_table_fixture,
    project_opcode_decode,
} from "./support/cpu_opcode_projection.js";
import {
    CPU_SEQUENCE_FIXED_INPUT_COUNT,
    CPU_SEQUENCE_OPS,
    project_cpu_sequence,
    type CpuSequenceSetup,
} from "./support/cpu_sequence_projection.js";
import { make_absent_bus_devices } from "./support/recording_cpu_bus.js";
import { Mmc3Mapper } from "../src/nes/cartridge/mapper_004.js";
import { NES_FRAME_PIXEL_COUNT, framebuffer_to_rgba } from "../src/nes/browser/canvas_renderer.js";
import { PpuMemoryBus } from "../src/nes/ppu/ppu_bus.js";
import { Ppu2C02 } from "../src/nes/ppu/ppu_2c02.js";
import type { PpuMapperPort } from "../src/nes/ppu/ppu_bus.js";
import {
    MMC3_FIXED_INPUT_COUNT,
    MMC3_FIXED_VALUE_COUNT,
    MMC3_VALUES_PER_OP,
    CARTRIDGE_BUS_FIXED_INPUT_COUNT,
    CARTRIDGE_BUS_FIXED_VALUE_COUNT,
    CARTRIDGE_BUS_VALUES_PER_OP,
    MAPPER_CREATION_VALUE_COUNT,
    MAPPER_KIND_IDS,
    MAPPER_SELECTION_ERROR_IDS,
    NROM_MEMORY_CPU_READ,
    NROM_MEMORY_CPU_WRITE,
    NROM_MEMORY_FIXED_INPUT_COUNT,
    NROM_MEMORY_FIXED_VALUE_COUNT,
    NROM_MEMORY_PATTERN_READ,
    NROM_MEMORY_PATTERN_WRITE,
    NROM_MEMORY_VALUES_PER_OP,
} from "./support/mapper_projection.js";
import { NromMapper } from "../src/nes/cartridge/mapper_000.js";
import { parse_ines_rom } from "../src/nes/cartridge/ines.js";
import { resolve_mapper } from "../src/nes/cartridge/mapper.js";
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
        // The reference replays operation 1 with no devices attached and operation 2 with live
        // controller ports, so the mirror reproduces that environment before the replay.
        bus.detach_devices();
        bus.reset();
        bus.controllers.reset();
        bus.controllers.set_button_mask(0, 0);
        bus.controllers.set_button_mask(1, 0);

        if (vector.operation === 2) {
            bus.controllers_attached = true;
        }

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

test("a detached device window stays undriven on both sides", () => {
    // The TypeScript decoder leaves an absent device's window undriven: reads return the
    // retained latch and writes are dropped. The port reaches the same state by detaching the
    // device, which is what the shared-vector replay does.
    const bus = new ported.GoboscriptCpuBus();
    bus.detach_devices();
    bus.reset();

    bus.write(0x2006, 0x40);

    assert.equal(bus.read(0x2006), 0x40, "a detached PPU window returns the retained latch");
    assert.equal(bus.read(0x4015), 0x40, "a detached APU status register returns the retained latch");
    assert.equal(bus.read(0x4016), 0x40, "a detached controller port returns the retained latch");
    assert.equal(bus.read(0x4017), 0x40, "a detached controller port returns the retained latch");
    assert.equal(bus.read(0x8000), 0x40, "a detached cartridge window returns the retained latch");
});

test("an attached PPU window never answers a cartridge address", () => {
    // The PPU register window is $2000-$3FFF and the cartridge window is $4020-$FFFF. A read
    // of a cartridge address must reach the board even when the PPU is attached, because the
    // reset vector lives at $FFFC. The PPU mirrors its registers every eight bytes, so a
    // window that answered every address would answer $FFFC and $FFFF as PPU registers.
    const bus = new ported.GoboscriptCpuBus();
    const board = new ported.GoboscriptMmc3Mapper();
    board.prg_rom_bytes = 65536;
    board.prg_bank_count = 8;
    board.prg_rom[65532] = 0x24;
    board.prg_rom[65533] = 0xee;
    bus.cartridge_kind = ported.MAPPER_KIND.MMC3;
    bus.mmc3_board = board;
    bus.reset();

    assert.equal(bus.read(0xfffc), 0x24, "the reset vector low byte comes from the cartridge");
    assert.equal(bus.read(0xfffd), 0xee, "the reset vector high byte comes from the cartridge");
    assert.equal(bus.read(0xffff), 0x00, "the last cartridge byte comes from the cartridge");
});

test("a RAM write stays in the RAM window", () => {
    // The reference decoder returns for the RAM window first, so a RAM write never reaches a
    // PPU register or the cartridge. The mirror stores the byte in the mirrored RAM and
    // leaves the other windows alone.
    const bus = new ported.GoboscriptCpuBus();
    bus.reset();

    bus.write(0x0000, 0x5a);
    bus.write(0x0100, 0xa5);
    bus.write(0x0200, 0x3c);

    assert.equal(bus.read(0x0000), 0x5a, "the byte is stored in RAM");
    assert.equal(bus.read(0x0100), 0xa5, "the byte is stored in RAM");
    assert.equal(bus.read(0x0200), 0x3c, "the byte is stored in RAM");
    assert.equal(bus.read(0x2000), 0x3c, "a read outside the RAM window returns the latch");
    assert.equal(bus.read(0x8000), 0x3c, "a read outside the RAM window returns the latch");

    bus.write(0x0900, 0x11);
    assert.equal(bus.read(0x0100), 0x11, "the RAM window is mirrored every 2 KiB");
});

test("a bus reset drops a pending OAM DMA transfer", () => {
    // `NesCpuBus.reset()` clears the pending DMA state, so a transfer that a record started
    // does not continue into the next one. The mirror's reset has to do the same.
    const bus = new ported.GoboscriptCpuBus();
    bus.reset();

    bus.write(0x4014, 0x20);
    assert.equal(bus.clock_dma_cycle(), 1, "the DMA transfer is pending");

    bus.reset();
    assert.equal(bus.clock_dma_cycle(), 0, "the reset dropped the pending transfer");
});

test("the mirror stops logging the bus accesses when the trace is off", () => {
    // The reference takes an optional trace sink and the console runs the CPU without one, so
    // the port keeps the access log empty while a game runs. The cycle count still advances,
    // because the log and the cycle counter are separate.
    const core = new ported.GoboscriptCpuCore();
    core.reset_registers();
    core.access_log_enabled = false;

    core.read_cycle(0x0200);
    core.write_cycle(0x0201, 0x42);

    assert.deepEqual(core.access_log, [], "a disabled trace logs nothing");
    assert.equal(core.cycles, 2, "the cycles still count while the trace is off");

    core.access_log_enabled = true;
    core.read_cycle(0x0200);

    assert.deepEqual(core.access_log.length, 3, "an enabled trace logs the access again");
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
    core.bus.detach_devices();
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
    core.bus.detach_devices();
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

/** Builds the mirrored board validator for a suite-15 record by parsing its header first. */
function make_mirror_nrom(vector_inputs: readonly number[]): ported.GoboscriptNromMapper {
    const header = vector_inputs.slice(1, 1 + CARTRIDGE_HEADER_BYTES);
    const parsed = project_cartridge_header(vector_inputs[0] ?? 0, header);
    assert.equal(parsed[0], 1, "a board record carries a header that parses");

    const mapper = new ported.GoboscriptNromMapper();
    mapper.mapper_id = parsed[3] ?? 0;
    mapper.submapper = parsed[4] ?? 0;
    mapper.has_trainer = parsed[7] ?? 0;
    mapper.prg_rom_bytes = parsed[8] ?? 0;
    mapper.chr_rom_bytes = parsed[9] ?? 0;
    mapper.prg_ram_bytes = parsed[10] ?? 0;
    mapper.prg_nvram_bytes = parsed[11] ?? 0;
    mapper.chr_ram_bytes = parsed[12] ?? 0;
    mapper.chr_nvram_bytes = parsed[13] ?? 0;
    mapper.trainer_offset = parsed[14] ?? 0;
    mapper.prg_rom_offset = parsed[15] ?? 0;
    mapper.chr_rom_offset = parsed[16] ?? 0;
    return mapper;
}

/** Builds a mirror core for a suite-14 control record, seeding the interrupt inputs. */
function make_mirror_cpu_control(vector_inputs: readonly number[]): ported.GoboscriptCpuCore {
    const core = new ported.GoboscriptCpuCore();
    core.decoder = new ported.GoboscriptCpuOpcodeDecoder(flat_opcode_table());
    core.reset_registers();
    core.bus.detach_devices();
    core.bus.clear_ram();
    core.bus.reset();
    core.program_counter = vector_inputs[0] ?? 0;
    core.a = vector_inputs[1] ?? 0;
    core.x = vector_inputs[2] ?? 0;
    core.y = vector_inputs[3] ?? 0;
    core.stack_pointer = vector_inputs[4] ?? 0;
    core.status = vector_inputs[5] ?? 0;
    core.clear_interrupt_state();
    core.set_irq_line(vector_inputs[7] ?? 0);

    if ((vector_inputs[6] ?? 0) === 1) {
        core.request_nmi();
    }

    const program_count = vector_inputs[CPU_CONTROL_FIXED_INPUT_COUNT - 2] ?? 0;
    const setup_count = vector_inputs[CPU_CONTROL_FIXED_INPUT_COUNT - 1] ?? 0;

    for (let index = 0; index < setup_count; index += 1) {
        const pair_start = CPU_CONTROL_FIXED_INPUT_COUNT + program_count + index * 2;
        core.bus.write(vector_inputs[pair_start] ?? 0, vector_inputs[pair_start + 1] ?? 0);
    }

    for (let index = 0; index < program_count; index += 1) {
        core.bus.write(core.program_counter + index, vector_inputs[CPU_CONTROL_FIXED_INPUT_COUNT + index] ?? 0);
    }

    return core;
}

function make_mirror_cpu_sequence(vector_inputs: readonly number[]): ported.GoboscriptCpuCore {
    const core = new ported.GoboscriptCpuCore();
    core.reset_registers();
    core.bus.detach_devices();
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
    assert.ok(vectors.length >= 90, "suite 13 covers every ported instruction group and mode");

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

    // An unofficial opcode other than KIL is refused as unofficial, after only the fetch.
    const unofficial = make_mirror_cpu_instruction([0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 2, 0, 0x03, 0x10]);
    unofficial.execute_instruction();
    assert.equal(unofficial.instruction_error, ported.CPU_INSTRUCTION_ERROR_CODE.UNOFFICIAL_OPCODE);
    assert.equal(unofficial.cycles, 1);
    assert.equal(unofficial.a, 0x11, "a refused instruction leaves the registers alone");
    assert.deepEqual(unofficial.access_log, [0, 0x0200, 0x03], "only the opcode fetch reaches the bus");
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

test("the mirrored dispatcher executes every official opcode and refuses the rest", () => {
    let officials = 0;

    for (let opcode = 0; opcode < 256; opcode += 1) {
        const definition = CPU_OPCODE_TABLE.get(opcode);
        assert.ok(definition !== undefined, `opcode $${opcode.toString(16)} is defined`);
        const label = `$${opcode.toString(16).padStart(2, "0")} ${definition?.mnemonic}`;
        const core = make_mirror_cpu_instruction([
            0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 3, 0, opcode, 0x10, 0x03,
        ]);
        core.execute_instruction();

        assert.equal(core.cycles, core.access_log.length / 3, `${label} logs one access per cycle`);
        assert.ok(core.cycles >= 1, `${label} spends at least its opcode fetch`);

        if (definition?.mnemonic === "KIL") {
            assert.equal(core.instruction_error, ported.CPU_INSTRUCTION_ERROR_CODE.NONE, `${label} jams`);
            assert.equal(core.jammed, 1, `${label} sets the jam flag`);
            assert.equal(core.cycles, 2, `${label} spends the fetch and one read`);
        } else if (is_official_opcode(opcode)) {
            officials += 1;
            assert.equal(core.instruction_error, ported.CPU_INSTRUCTION_ERROR_CODE.NONE, `${label} executes`);
            assert.equal(core.jammed, 0, `${label} does not jam`);
        } else {
            assert.equal(
                core.instruction_error,
                ported.CPU_INSTRUCTION_ERROR_CODE.UNOFFICIAL_OPCODE,
                `${label} is refused`,
            );
            assert.equal(core.cycles, 1, `${label} spends only its fetch`);
        }
    }

    assert.equal(officials, 151, "every official opcode is dispatched");
});

test("the mirrored control loop replays every suite 14 vector", () => {
    const vectors = get_shared_vector_suite("cpu_control").vectors;
    assert.ok(vectors.length >= 15, "suite 14 covers the jam, NMI, IRQ, and poll-mask cases");

    for (const vector of vectors) {
        const core = make_mirror_cpu_control([...vector.input]);
        const step_count = vector.input[8] ?? 0;
        const reported = core.run_control_steps(step_count, vector.input[9] ?? 0, vector.input[10] ?? 0);

        assert.deepEqual(reported, [...vector.expected], `cpu_control vector ${vector.id}`);
        assert.equal(
            reported.length,
            CPU_CONTROL_FIXED_VALUE_COUNT + step_count + core.cycles * 3,
            "one kind per step and one triple per cycle",
        );
    }
});

test("the mirrored control loop keeps the state its records pin", () => {
    // A jammed core keeps jamming: the first jam sequence reads the vector three times and every
    // later one reads it once.
    const jammed = make_mirror_cpu_control([0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 0, 0, 3, 0, 0, 1, 0, 0x02]);
    jammed.run_control_steps(3, 0, 0);
    assert.equal(jammed.jammed, 1);
    assert.equal(jammed.jam_vector_reads_issued, 1);
    assert.equal(jammed.cycles, 6, "the KIL fetch and read, then three reads, then one");
    assert.equal(jammed.selected_sequence, ported.CPU_SEQUENCE_KIND.JAM);

    // Clearing the interrupt state drops the jam flags and the latch together, as reset does.
    jammed.clear_interrupt_state();
    assert.equal(jammed.jammed, 0);
    assert.equal(jammed.jam_vector_reads_issued, 0);
    assert.equal(jammed.nmi_pending, 0);
    assert.equal(jammed.irq_poll_mask_override_active, 0);

    // CLI leaves a poll mask that the next poll consumes, so a still asserted line waits once.
    const cli = make_mirror_cpu_control([0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 0, 1, 3, 0, 0, 3, 0, 0x58, 0xea, 0xea]);
    cli.run_control_steps(2, 0, 0);
    assert.equal(cli.irq_poll_mask_override_active, 0, "the masked poll cleared the mask");
    assert.equal(cli.selected_sequence, ported.CPU_SEQUENCE_KIND.INSTRUCTION, "the mask held the IRQ off");
    cli.run_control_steps(1, 0, 0);
    assert.equal(cli.selected_sequence, ported.CPU_SEQUENCE_KIND.IRQ, "the next boundary takes the IRQ");

    // A pending NMI is latched until it is accepted, and acceptance clears the latch.
    const nmi = make_mirror_cpu_control([0x0200, 0x11, 0x22, 0x33, 0xfd, 0x24, 1, 0, 1, 0, 0, 1, 0, 0xea]);
    assert.equal(nmi.nmi_pending, 1);
    nmi.run_control_steps(1, 0, 0);
    assert.equal(nmi.nmi_pending, 0, "accepting the NMI clears the latch");
    assert.equal(nmi.selected_sequence, ported.CPU_SEQUENCE_KIND.NMI);

    // Any nonzero level asserts the IRQ line, and zero drops it.
    const line = new ported.GoboscriptCpuCore();
    line.set_irq_line(7);
    assert.equal(line.irq_line_asserted, 1);
    line.set_irq_line(0);
    assert.equal(line.irq_line_asserted, 0);
});

test("the mirrored board validation replays every suite 15 vector", () => {
    const vectors = get_shared_vector_suite("nrom").vectors;
    assert.ok(vectors.length >= 20, "suite 15 covers both header versions and every rejection");

    for (const vector of vectors) {
        const mapper = make_mirror_nrom([...vector.input]);
        mapper.validate();
        const reported = mapper.reported_values();
        assert.deepEqual(reported, [...vector.expected], `nrom vector ${vector.id}`);
        assert.equal(reported.length, MAPPER_CREATION_VALUE_COUNT);
    }
});

test("the mirrored mapper selection routes exactly the registered boards", () => {
    for (let mapper_id = 0; mapper_id < 256; mapper_id += 1) {
        for (let submapper = 0; submapper < 16; submapper += 1) {
            const selection = new ported.GoboscriptMapperSelection();
            selection.resolve(mapper_id, submapper);

            const reference = resolve_mapper({ mapper_id, submapper });
            const expected_kind = reference.ok ? MAPPER_KIND_IDS[reference.value.kind] : 0;
            const expected_error = reference.ok ? 0 : MAPPER_SELECTION_ERROR_IDS[reference.error.code];
            const label = `mapper ${mapper_id} submapper ${submapper}`;
            assert.equal(selection.kind, expected_kind, `${label} kind`);
            assert.equal(selection.error_code, expected_error, `${label} error`);
            assert.equal(selection.mapper_id, mapper_id, `${label} echoes the mapper`);
            assert.equal(selection.submapper, submapper, `${label} echoes the submapper`);
        }
    }
});

test("the mirrored memory size sum rejects the sizes the parser reports as unusable", () => {
    assert.equal(ported.mapper_sum_memory_sizes(0, 0), 0);
    assert.equal(ported.mapper_sum_memory_sizes(2048, 2048), 4096);
    assert.equal(ported.mapper_sum_memory_sizes(-1, 0), -1, "a size that lost precision poisons the sum");
    assert.equal(ported.mapper_sum_memory_sizes(0, -1), -1);
    assert.equal(ported.mapper_sum_memory_sizes(8192, 8192), 16384, "the limit check rejects it, not the sum");
});

test("the mirrored board validation refuses what it cannot map", () => {
    // A header the parser rejected leaves zero sizes, so the board fails on its PRG ROM size
    // instead of passing as an empty cartridge.
    const unparsed = new ported.GoboscriptNromMapper();
    unparsed.validate();
    assert.equal(unparsed.ok, 0);
    assert.equal(unparsed.error_code, ported.MAPPER_ERROR.UNSUPPORTED_PRG_ROM_SIZE);
    assert.equal(unparsed.selection.kind, ported.MAPPER_KIND.NROM, "mapper 0 submapper 0 still routes");
    assert.equal(unparsed.mapped_prg_ram_bytes, 0, "a rejected board maps nothing");

    // A size the parser could not represent poisons its sum, which the limit check then reports.
    const prg_precision_loss = new ported.GoboscriptNromMapper();
    prg_precision_loss.prg_rom_bytes = 32768;
    prg_precision_loss.chr_rom_bytes = 8192;
    prg_precision_loss.prg_ram_bytes = -1;
    prg_precision_loss.validate();
    assert.equal(prg_precision_loss.error_code, ported.MAPPER_ERROR.UNSUPPORTED_PRG_RAM_SIZE);

    const chr_precision_loss = new ported.GoboscriptNromMapper();
    chr_precision_loss.prg_rom_bytes = 16384;
    chr_precision_loss.chr_rom_bytes = 8192;
    chr_precision_loss.chr_nvram_bytes = -1;
    chr_precision_loss.validate();
    assert.equal(chr_precision_loss.error_code, ported.MAPPER_ERROR.UNSUPPORTED_CHR_MEMORY);

    // The trainer check runs after the PRG RAM limit, so an oversized trainer board reports the
    // size problem first, exactly as the reference orders its checks.
    const trainer_and_oversize = new ported.GoboscriptNromMapper();
    trainer_and_oversize.prg_rom_bytes = 16384;
    trainer_and_oversize.chr_rom_bytes = 8192;
    trainer_and_oversize.has_trainer = 1;
    trainer_and_oversize.prg_ram_bytes = 16384;
    trainer_and_oversize.validate();
    assert.equal(trainer_and_oversize.error_code, ported.MAPPER_ERROR.UNSUPPORTED_PRG_RAM_SIZE);

    // Resetting clears every reported field, so a second validation cannot inherit a result.
    trainer_and_oversize.reset_results();
    assert.deepEqual(trainer_and_oversize.reported_values().slice(0, 5), [0, 0, 0, 0, 0]);
});

test("the mirrored board memory replays every suite 16 vector", () => {
    const vectors = get_shared_vector_suite("nrom_memory").vectors;
    assert.ok(vectors.length >= 12, "suite 16 covers both windows, mirroring, and aliasing");

    for (const vector of vectors) {
        const input = [...vector.input];
        const mapper = make_mirror_nrom(input);
        mapper.validate();
        assert.equal(mapper.ok, 1, `nrom_memory vector ${vector.id} runs on an accepted board`);

        const prg_count = input[17] ?? 0;
        const chr_count = input[18] ?? 0;
        const op_count = input[19] ?? 0;
        mapper.reset_memory();

        for (let index = 0; index < prg_count; index += 1) {
            const at = NROM_MEMORY_FIXED_INPUT_COUNT + index * 2;
            mapper.prg_rom[input[at] ?? 0] = input[at + 1] ?? 0;
        }

        for (let index = 0; index < chr_count; index += 1) {
            const at = NROM_MEMORY_FIXED_INPUT_COUNT + prg_count * 2 + index * 2;
            mapper.chr_rom[input[at] ?? 0] = input[at + 1] ?? 0;
        }

        const operations: (readonly [number, number, number])[] = [];

        for (let index = 0; index < op_count; index += 1) {
            const at = NROM_MEMORY_FIXED_INPUT_COUNT + (prg_count + chr_count) * 2 + index * 3;
            operations.push([input[at] ?? 0, input[at + 1] ?? 0, input[at + 2] ?? 0]);
        }

        const reported = mapper.run_memory_operations(operations);
        assert.deepEqual(reported, [...vector.expected], `nrom_memory vector ${vector.id}`);
        assert.equal(
            reported.length,
            NROM_MEMORY_FIXED_VALUE_COUNT + op_count * NROM_MEMORY_VALUES_PER_OP,
            "four board values and three per operation",
        );
    }
});

test("the mirrored board answers the windows the way the reference does", () => {
    // A 16 KiB PRG ROM board mirrors twice, and an unmapped address reports no byte.
    const mirror = new ported.GoboscriptNromMapper();
    mirror.prg_rom_bytes = 16384;
    mirror.chr_rom_bytes = 8192;
    mirror.mapped_prg_ram_bytes = 0;
    mirror.reset_memory();
    mirror.prg_rom[0] = 0x44;
    mirror.read_cpu(0x8000);
    assert.deepEqual([mirror.cpu_mapped, mirror.cpu_value, mirror.cpu_driven_mask], [1, 0x44, 0xff]);
    mirror.read_cpu(0xc000);
    assert.equal(mirror.cpu_value, 0x44, "the second half mirrors the first");
    mirror.read_cpu(0x5fff);
    assert.deepEqual([mirror.cpu_mapped, mirror.cpu_value, mirror.cpu_driven_mask], [0, 0, 0]);

    // Without mapped PRG RAM the window is closed for reads and writes alike.
    mirror.write_cpu(0x6000, 0x5a);
    assert.equal(mirror.cpu_write_accepted, 0);
    mirror.read_cpu(0x6000);
    assert.equal(mirror.cpu_mapped, 0);

    // A CHR ROM board serves the pattern table and drops writes to it.
    mirror.chr_rom[8191] = 0x22;
    mirror.read_pattern(8191);
    assert.equal(mirror.pattern_value, 0x22);
    mirror.write_pattern(8191, 0x99);
    assert.equal(mirror.pattern_write_accepted, 0);
    mirror.read_pattern(8191);
    assert.equal(mirror.pattern_value, 0x22, "a dropped write leaves the byte alone");

    // An unknown memory operation reports that the board did not take it.
    assert.deepEqual(mirror.run_memory_operations([[99, 0x8000, 0]]).slice(4), [0, 0, 0]);
});

test("the mirrored payload copy lands the bytes the reference board holds", () => {
    const header = [0x4e, 0x45, 0x53, 0x1a, 2, 1, 0x06, 0x00, 0, 0, 0, 0, 0, 0, 0, 0];
    const image_bytes = 16 + 512 + 32768 + 8192;
    const image = make_cartridge_image(image_bytes, header);

    for (let index = 16; index < image.length; index += 1) {
        image[index] = (index * 7 + 3) % 251;
    }

    const parsed = parse_ines_rom(image);
    assert.ok(parsed.ok, "the synthetic trainer image parses");
    const rom = parsed.value;
    assert.ok(rom.trainer !== null, "the image carries a trainer");
    const created = NromMapper.create(rom);
    assert.ok(created.ok, "the synthetic image is an acceptable NROM board");
    const reference = created.value;

    const mirror = make_mirror_nrom([image_bytes, ...header]);
    mirror.cartridge_bytes = [...image];
    mirror.validate();
    assert.equal(mirror.ok, 1);
    mirror.load_payload();

    assert.equal(mirror.prg_rom.length, 32768, "PRG ROM is copied to its declared size");
    assert.equal(mirror.chr_rom.length, 8192, "CHR ROM is copied to its declared size");

    for (let address = 0x8000; address <= 0xffff; address += 7) {
        const expected = reference.read_cpu(address, 0);
        mirror.read_cpu(address);
        assert.equal(mirror.cpu_mapped, 1, `$${address.toString(16)} is PRG ROM`);
        assert.equal(mirror.cpu_value, expected?.value, `PRG ROM at $${address.toString(16)}`);
    }

    for (let address = 0x6000; address < 0x8000; address += 5) {
        const expected = reference.read_cpu(address, 0);
        mirror.read_cpu(address);
        assert.equal(mirror.cpu_value, expected?.value ?? 0, `PRG RAM at $${address.toString(16)}`);
    }

    // The trainer copy is the interesting part: the reference constructor puts those 512 bytes at
    // PRG RAM offset $1000, which is $7000 on the CPU bus.
    for (let offset = 0; offset < 512; offset += 1) {
        const expected = reference.read_cpu(0x7000 + offset, 0);
        mirror.read_cpu(0x7000 + offset);
        assert.equal(mirror.cpu_value, expected?.value, `trainer byte ${offset} lands at $7000`);
    }

    for (let address = 0; address < 0x2000; address += 3) {
        mirror.read_pattern(address);
        assert.equal(mirror.pattern_value, reference.read_pattern(address), `pattern byte ${address}`);
    }

    // Resetting the board puts every region back to zeroes without changing the declared sizes.
    mirror.reset_memory();
    mirror.read_cpu(0x8000);
    assert.equal(mirror.cpu_value, 0);
    mirror.read_cpu(0x7000);
    assert.equal(mirror.cpu_value, 0, "the trainer copy is gone");
    assert.equal(mirror.prg_rom.length, 32768, "the ROM lists keep their declared size");
});

test("the mirrored bus and board replay every suite 17 vector", () => {
    const vectors = get_shared_vector_suite("cartridge_bus").vectors;
    assert.ok(vectors.length >= 10, "suite 17 covers the cartridge window with and without a board");

    for (const vector of vectors) {
        const input = [...vector.input];
        const attach = input[17] ?? 0;
        const prg_count = input[18] ?? 0;
        const op_count = input[19] ?? 0;
        const board = make_mirror_nrom(input);
        board.validate();
        const bus = new ported.GoboscriptCpuBus();
        bus.clear_ram();
        bus.reset();
        const attached = board.ok === 1 && attach === 1 ? 1 : 0;

        if (attached === 1) {
            board.reset_memory();

            for (let index = 0; index < prg_count; index += 1) {
                const at = CARTRIDGE_BUS_FIXED_INPUT_COUNT + index * 2;
                board.prg_rom[input[at] ?? 0] = input[at + 1] ?? 0;
            }

            bus.board = board;
            bus.cartridge_kind = ported.MAPPER_KIND.NROM;
        }

        const values = [attached, board.error_code];

        for (let index = 0; index < op_count; index += 1) {
            const at = CARTRIDGE_BUS_FIXED_INPUT_COUNT + prg_count * 2 + index * 3;
            const kind = input[at] ?? 0;
            const address = input[at + 1] ?? 0;
            const value = input[at + 2] ?? 0;

            if (kind === 1) {
                bus.write(address, value);
                values.push(0);
            } else {
                values.push(bus.read(address));
            }

            values.push(bus.read(0x2000));
        }

        assert.deepEqual(values, [...vector.expected], `cartridge_bus vector ${vector.id}`);
        assert.equal(values.length, CARTRIDGE_BUS_FIXED_VALUE_COUNT + op_count * CARTRIDGE_BUS_VALUES_PER_OP);
    }
});

test("the mirrored boot path answers the way the reference bus and board do", () => {
    const header = [0x4e, 0x45, 0x53, 0x1a, 2, 1, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0];
    const bytes = 16 + 32768 + 8192;
    const image = make_cartridge_image(bytes, header);

    for (let index = 16; index < image.length; index += 1) {
        image[index] = (index * 11 + 5) % 251;
    }

    const parsed = parse_ines_rom(image);
    assert.ok(parsed.ok, "the synthetic NROM image parses");
    const created = NromMapper.create(parsed.value);
    assert.ok(created.ok, "the synthetic image is an acceptable board");
    const devices = make_absent_bus_devices();
    const reference = new NesCpuBus({ ...devices, cartridge: created.value });

    // The mirror walks the same boot path: parse the header, validate the board, copy the payload,
    // and attach it to the bus, which is what cartridge_load_board composes in the project.
    const parser = new ported.GoboscriptCartridgeParser();
    parser.image_bytes = image.length;

    for (let index = 0; index < 16; index += 1) {
        parser.header[index] = image[index] ?? 0;
    }

    parser.parse();
    assert.equal(parser.ok, 1);

    const board = new ported.GoboscriptNromMapper();
    board.mapper_id = parser.mapper_id;
    board.submapper = parser.submapper;
    board.has_trainer = parser.has_trainer;
    board.prg_rom_bytes = parser.prg_rom_bytes;
    board.chr_rom_bytes = parser.chr_rom_bytes;
    board.prg_ram_bytes = parser.prg_ram_bytes;
    board.prg_nvram_bytes = parser.prg_nvram_bytes;
    board.chr_ram_bytes = parser.chr_ram_bytes;
    board.chr_nvram_bytes = parser.chr_nvram_bytes;
    board.trainer_offset = parser.trainer_offset;
    board.prg_rom_offset = parser.prg_rom_offset;
    board.chr_rom_offset = parser.chr_rom_offset;
    board.cartridge_bytes = [...image];
    board.validate();
    assert.equal(board.ok, 1);
    board.load_payload();

    const bus = new ported.GoboscriptCpuBus();
    bus.board = board;
    bus.cartridge_kind = ported.MAPPER_KIND.NROM;

    // The controller window is left out: the mirrored bus drives it from its own ports, while this
    // reference bus has no controller attached. Suite 3 compares that window on its own.
    const addresses = [
        0x0000, 0x07ff, 0x0800, 0x1fff, 0x2000, 0x3fff, 0x4020, 0x5fff, 0x6000, 0x7fff, 0x8000, 0xbfff, 0xc000,
        0xffff,
    ];

    for (const address of addresses) {
        assert.equal(bus.read(address), reference.read_cpu(address), `read $${address.toString(16)}`);
    }

    for (const [address, value] of [[0x6000, 0x5a], [0x7fff, 0xa5], [0x8000, 0x3c], [0x0001, 0x77]] as const) {
        bus.write(address, value);
        reference.write_cpu(address, value);
    }

    for (const address of addresses) {
        assert.equal(bus.read(address), reference.read_cpu(address), `after writes, $${address.toString(16)}`);
    }

    // A board that does not validate leaves the window undriven on both sides.
    const rejected = new ported.GoboscriptNromMapper();
    rejected.mapper_id = 4;
    rejected.prg_rom_bytes = 32768;
    rejected.chr_rom_bytes = 8192;
    rejected.validate();
    assert.equal(rejected.ok, 0);
    assert.equal(rejected.error_code, ported.MAPPER_ERROR.WRONG_MAPPER_FAMILY);

    const undriven = new ported.GoboscriptCpuBus();
    undriven.write(0x0000, 0x5a);
    assert.equal(undriven.read(0x8000), 0x5a, "no board means the window returns the latch");
});

/** Builds the mirrored MMC3 board for a suite-18 record, with the fields the parsed header reports. */
function make_mirror_mmc3(vector_inputs: readonly number[]): ported.GoboscriptMmc3Mapper {
    const header = vector_inputs.slice(1, 1 + CARTRIDGE_HEADER_BYTES);
    const parsed = project_cartridge_header(vector_inputs[0] ?? 0, header);
    assert.equal(parsed[0], 1, "a board record carries a header that parses");

    const mapper = new ported.GoboscriptMmc3Mapper();
    mapper.mapper_id = parsed[3] ?? 0;
    mapper.submapper = parsed[4] ?? 0;
    mapper.header_mirroring = parsed[5] ?? 1;
    mapper.has_trainer = parsed[7] ?? 0;
    mapper.prg_rom_bytes = parsed[8] ?? 0;
    mapper.chr_rom_bytes = parsed[9] ?? 0;
    mapper.prg_ram_bytes = parsed[10] ?? 0;
    mapper.prg_nvram_bytes = parsed[11] ?? 0;
    mapper.chr_ram_bytes = parsed[12] ?? 0;
    mapper.chr_nvram_bytes = parsed[13] ?? 0;
    mapper.trainer_offset = parsed[14] ?? 0;
    mapper.prg_rom_offset = parsed[15] ?? 0;
    mapper.chr_rom_offset = parsed[16] ?? 0;
    return mapper;
}

test("the mirrored MMC3 board replays every suite 18 and suite 19 vector", () => {
    const suites = ["mmc3", "mmc3_irq"] as const;
    const vectors = suites.flatMap((name) => get_shared_vector_suite(name).vectors);
    assert.ok(vectors.length >= 32, "suites 18 and 19 cover banking, protection, mirroring, and the IRQ");

    for (const vector of vectors) {
        const input = [...vector.input];
        const mapper = make_mirror_mmc3(input);
        mapper.validate();

        const prg_count = input[17] ?? 0;
        const chr_count = input[18] ?? 0;
        const op_count = input[19] ?? 0;
        mapper.reset_memory();

        for (let index = 0; index < prg_count; index += 1) {
            const at = MMC3_FIXED_INPUT_COUNT + index * 2;
            mapper.prg_rom[input[at] ?? 0] = input[at + 1] ?? 0;
        }

        for (let index = 0; index < chr_count; index += 1) {
            const at = MMC3_FIXED_INPUT_COUNT + prg_count * 2 + index * 2;
            mapper.chr_rom[input[at] ?? 0] = input[at + 1] ?? 0;
        }

        const operations: (readonly [number, number, number])[] = [];

        for (let index = 0; index < op_count; index += 1) {
            const at = MMC3_FIXED_INPUT_COUNT + (prg_count + chr_count) * 2 + index * 3;
            operations.push([input[at] ?? 0, input[at + 1] ?? 0, input[at + 2] ?? 0]);
        }

        const reported = mapper.run_memory_operations(operations);
        assert.deepEqual(reported, [...vector.expected], `mmc3 vector ${vector.id}`);
        assert.equal(reported.length, MMC3_FIXED_VALUE_COUNT + op_count * MMC3_VALUES_PER_OP);
    }
});

test("the mirrored MMC3 registers and windows follow the reference", () => {
    // A 64 KiB PRG ROM board with 8 KiB of CHR ROM: eight PRG banks and eight CHR banks.
    const mirror = new ported.GoboscriptMmc3Mapper();
    mirror.mapper_id = 4;
    mirror.header_mirroring = 1;
    mirror.prg_rom_bytes = 65536;
    mirror.chr_rom_bytes = 8192;
    mirror.prg_ram_bytes = 8192;
    mirror.validate();
    assert.equal(mirror.ok, 1);
    assert.equal(mirror.prg_bank_count, 8);
    assert.equal(mirror.chr_bank_count, 8);
    mirror.reset_memory();

    for (let bank = 0; bank < 8; bank += 1) {
        mirror.prg_rom[bank * 8192] = 0x10 + bank;
        mirror.chr_rom[bank * 1024] = 0x80 + bank;
    }

    // Bank select takes three bits and the two mode bits; bank data masks per register.
    mirror.write_register(0x8000, 0xff);
    assert.deepEqual([mirror.bank_select, mirror.prg_mode, mirror.chr_mode], [7, 1, 1]);
    mirror.write_register(0x8001, 0xff);
    assert.equal(mirror.bank_registers[7], 0x7f, "register 7 keeps seven bits");
    mirror.write_register(0x8000, 6);
    mirror.write_register(0x8001, 0xff);
    assert.equal(mirror.bank_registers[6], 0x3f, "register 6 keeps six bits");
    mirror.write_register(0x8000, 0);
    mirror.write_register(0x8001, 0xff);
    assert.equal(mirror.bank_registers[0], 0xfe, "a paired CHR register is forced even");

    // PRG mode 0 puts register 6 first and the fixed banks last; mode 1 swaps the outer slots.
    mirror.reset();
    mirror.write_register(0x8000, 6);
    mirror.write_register(0x8001, 1);
    mirror.write_register(0x8000, 7);
    mirror.write_register(0x8001, 2);
    mirror.read_cpu(0x8000);
    assert.equal(mirror.cpu_value, 0x11, "slot 0 is register 6");
    mirror.read_cpu(0xa000);
    assert.equal(mirror.cpu_value, 0x12, "slot 1 is register 7");
    mirror.read_cpu(0xc000);
    assert.equal(mirror.cpu_value, 0x16, "slot 2 is the second-to-last bank");
    mirror.read_cpu(0xe000);
    assert.equal(mirror.cpu_value, 0x17, "slot 3 is the last bank, where the reset vector lives");

    mirror.write_register(0x8000, 0x40);
    assert.equal(mirror.prg_mode, 1);
    mirror.read_cpu(0x8000);
    assert.equal(mirror.cpu_value, 0x16, "mode 1 puts the second-to-last bank first");
    mirror.read_cpu(0xc000);
    assert.equal(mirror.cpu_value, 0x11, "mode 1 puts register 6 third");

    // CHR mode 0 pairs registers 0 and 1 into the first four slots; mode 1 swaps the groups.
    mirror.reset();
    mirror.write_register(0x8000, 0);
    mirror.write_register(0x8001, 2);
    mirror.write_register(0x8000, 1);
    mirror.write_register(0x8001, 4);
    mirror.read_pattern(0x0000);
    assert.equal(mirror.pattern_value, 0x82, "slot 0 is register 0");
    mirror.read_pattern(0x0400);
    assert.equal(mirror.pattern_value, 0x83, "slot 1 is register 0 plus one");
    mirror.read_pattern(0x0800);
    assert.equal(mirror.pattern_value, 0x84, "slot 2 is register 1");
    mirror.read_pattern(0x0c00);
    assert.equal(mirror.pattern_value, 0x85, "slot 3 is register 1 plus one");
    mirror.write_register(0x8000, 2);
    mirror.write_register(0x8001, 6);
    mirror.read_pattern(0x1000);
    assert.equal(mirror.pattern_value, 0x86, "slot 4 is register 2");

    mirror.write_register(0x8000, 0x80);
    assert.equal(mirror.chr_mode, 1);
    mirror.read_pattern(0x0000);
    assert.equal(mirror.pattern_value, 0x86, "mode 1 puts register 2 first");
    mirror.read_pattern(0x1000);
    assert.equal(mirror.pattern_value, 0x82, "mode 1 puts register 0 fifth");

    // A bank past the last one wraps, which is what keeps a small board addressable.
    mirror.write_register(0x8000, 0x80);
    mirror.write_register(0x8000, 2);
    mirror.write_register(0x8001, 9);
    mirror.read_pattern(0x1000);
    assert.equal(mirror.pattern_value, 0x81, "CHR bank 9 wraps to bank 1 of 8");

    // The mirroring register takes the low bit, and the protect register takes two.
    mirror.reset();
    assert.equal(mirror.mirroring, 1, "a reset restores the mirroring the header declared");
    mirror.write_register(0xa000, 0);
    assert.equal(mirror.mirroring, 2, "a zero low bit selects vertical");
    mirror.write_register(0xa000, 1);
    assert.equal(mirror.mirroring, 1, "a one low bit selects horizontal");
    mirror.four_screen = 1;
    mirror.write_register(0xa000, 0);
    assert.equal(mirror.mirroring, 1, "a four-screen board ignores the mirroring register");
    mirror.four_screen = 0;

    mirror.write_register(0xa001, 0x40);
    assert.deepEqual([mirror.prg_ram_enabled, mirror.prg_ram_write_protected], [0, 1]);
    mirror.write_register(0xa001, 0x80);
    assert.deepEqual([mirror.prg_ram_enabled, mirror.prg_ram_write_protected], [1, 0]);
    mirror.write_cpu(0x6000, 0x5a);
    assert.equal(mirror.cpu_write_accepted, 1);
    mirror.write_register(0xa001, 0xc0);
    mirror.write_cpu(0x6001, 0xa5);
    assert.equal(mirror.cpu_write_accepted, 0, "a write-protected board drops the write");
    mirror.read_cpu(0x6000);
    assert.equal(mirror.cpu_value, 0x5a, "the earlier write survived");
    mirror.write_register(0xa001, 0x00);
    mirror.read_cpu(0x6000);
    assert.equal(mirror.cpu_mapped, 0, "a disabled window is unmapped");

    // An address below the cartridge windows is unmapped, and a register write is not a RAM write.
    mirror.write_register(0xa001, 0x80);
    mirror.read_cpu(0x5fff);
    assert.deepEqual([mirror.cpu_mapped, mirror.cpu_value, mirror.cpu_driven_mask], [0, 0, 0]);
    mirror.write_cpu(0x8000, 6);
    assert.equal(mirror.cpu_write_accepted, 0, "a bank register write does not report a RAM write");
    assert.equal(mirror.bank_select, 6);

    // An unknown memory operation reports that the board did not take it.
    assert.deepEqual(mirror.run_memory_operations([[99, 0x8000, 0]]).slice(3), [0, 0, 0]);
});

/** Builds one 64 KiB PRG, 8 KiB CHR ROM MMC3 board on both sides, ready for an IRQ script. */
function make_irq_pair(): { readonly reference: Mmc3Mapper; readonly mirror: ported.GoboscriptMmc3Mapper } {
    const header = [0x4e, 0x45, 0x53, 0x1a, 4, 1, 0x40, 0x00, 0, 0, 0, 0, 0, 0, 0, 0];
    const image_bytes = 16 + 4 * 16384 + 8192;
    const parsed = parse_ines_rom(make_cartridge_image(image_bytes, header));
    assert.ok(parsed.ok, "the synthetic MMC3 image parses");
    const created = Mmc3Mapper.create(parsed.value);
    assert.ok(created.ok, "the synthetic image is an acceptable MMC3 board");

    const mirror = make_mirror_mmc3([image_bytes, ...header]);
    mirror.validate();
    assert.equal(mirror.ok, 1, "the mirror accepts the image the reference accepts");
    mirror.reset_memory();
    return { reference: created.value, mirror };
}

type IrqStep =
    | readonly ["cpu_write", number, number]
    | readonly ["ppu_read", number]
    | readonly ["ppu_write", number, number]
    | readonly ["observe_address", number]
    | readonly ["dots", number]
    | readonly ["irq"];

/** One filtered A12 cycle: drop A12, spend the dots the filter needs, then raise it and report. */
function a12_cycle(low_dots: number, high_address = 0x1000, low_address = 0x0000): IrqStep[] {
    return [["ppu_read", low_address], ["dots", low_dots], ["ppu_read", high_address], ["irq"]];
}

/**
 * Runs one IRQ script against the reference board behind its production PPU bus and against the
 * mirror, comparing the IRQ line at every report. The mirror side applies the observation rules the
 * bus applies: a pattern or nametable access is reported to the mapper and a palette access is not,
 * which is the behavior the ported PPU will have to reproduce when it arrives.
 */
function run_irq_script(steps: readonly IrqStep[]): number {
    const { reference, mirror } = make_irq_pair();
    const ppu_bus = new PpuMemoryBus(reference);
    let reports = 0;

    for (const step of steps) {
        switch (step[0]) {
            case "cpu_write": {
                reference.write_cpu(step[1], step[2]);
                mirror.write_cpu(step[1], step[2]);
                break;
            }
            case "ppu_read": {
                const address = step[1] % 0x4000;
                ppu_bus.read_ppu(step[1]);

                // A palette access never reaches the mapper, so it observes nothing on either side.
                if (address < 0x2000) {
                    mirror.observe_ppu_access(ported.MMC3_PPU_ACCESS.READ_PATTERN, address);
                } else if (address < 0x3f00) {
                    mirror.observe_ppu_access(ported.MMC3_PPU_ACCESS.READ_NAMETABLE, address);
                }

                break;
            }
            case "ppu_write": {
                const address = step[1] % 0x4000;
                ppu_bus.write_ppu(step[1], step[2]);

                if (address < 0x2000) {
                    mirror.observe_ppu_access(ported.MMC3_PPU_ACCESS.WRITE_PATTERN, address);
                } else if (address < 0x3f00) {
                    mirror.observe_ppu_access(ported.MMC3_PPU_ACCESS.WRITE_NAMETABLE, address);
                }

                break;
            }
            case "observe_address": {
                ppu_bus.observe_ppu_address(step[1]);
                mirror.observe_ppu_address(step[1] % 0x4000);
                break;
            }
            case "dots": {
                for (let dot = 0; dot < step[1]; dot += 1) {
                    ppu_bus.clock_ppu_dot();
                    mirror.clock_ppu_dot();
                }

                break;
            }
            case "irq": {
                reports += 1;
                const expected = reference.get_irq_line_asserted() ? 1 : 0;
                assert.equal(
                    mirror.get_irq_line_asserted(),
                    expected,
                    `the mirrored IRQ line follows the reference at report ${reports}`,
                );
                break;
            }
        }
    }

    return reports;
}

test("the mirrored MMC3 scanline IRQ follows the reference through its PPU bus", () => {
    const ARM: readonly IrqStep[] = [["cpu_write", 0xc000, 1], ["cpu_write", 0xc001, 0], ["cpu_write", 0xe001, 0]];

    // A latch of one needs two filtered rises: the first loads the latch, the second counts to zero.
    assert.equal(run_irq_script([...ARM, ["irq"], ...a12_cycle(10), ...a12_cycle(10)]), 3);

    // Nine low dots are below the filter, so that rise costs no count and the reload stays pending.
    assert.equal(run_irq_script([...ARM, ...a12_cycle(9), ...a12_cycle(10), ...a12_cycle(10)]), 3);

    // A latch of three counts down over four rises, and a long low stretch saturates the filter.
    assert.equal(
        run_irq_script([
            ["cpu_write", 0xc000, 3], ["cpu_write", 0xc001, 0], ["cpu_write", 0xe001, 0],
            ...a12_cycle(40), ...a12_cycle(11), ...a12_cycle(10), ...a12_cycle(10),
        ]),
        4,
    );

    // Nametable addresses carry A12 too, and a palette access does not reach the mapper at all.
    assert.equal(
        run_irq_script([...ARM, ...a12_cycle(10, 0x3000, 0x2000), ["ppu_read", 0x3f00], ["irq"]]),
        2,
    );

    // A repeated low address is not an edge either, so it must not restart the ten-dot filter: the
    // dots spent before it still count toward the rise that follows. Without the dedup guard the
    // second low observation would clear the count and the rise below would clock nothing.
    assert.equal(
        run_irq_script([
            ["cpu_write", 0xc000, 0], ["cpu_write", 0xc001, 0], ["cpu_write", 0xe001, 0],
            ["ppu_read", 0x0000], ["dots", 5], ["ppu_read", 0x0400], ["dots", 4],
            ["ppu_read", 0x1000], ["irq"],
            ["ppu_read", 0x0000], ["dots", 5], ["ppu_read", 0x0800], ["dots", 5],
            ["ppu_read", 0x1000], ["irq"],
        ]),
        2,
    );

    // Writes observe A12 exactly as reads do.
    assert.equal(
        run_irq_script([
            ...ARM,
            ["ppu_write", 0x0000, 0x11], ["dots", 10], ["ppu_write", 0x1800, 0x22], ["irq"],
            ["ppu_write", 0x0400, 0x33], ["dots", 10], ["ppu_write", 0x1c00, 0x44], ["irq"],
        ]),
        2,
    );

    // An address the CPU placed on the bus through PPUADDR is its own observation path.
    assert.equal(
        run_irq_script([
            ...ARM,
            ["observe_address", 0x0000], ["dots", 10], ["observe_address", 0x1000], ["irq"],
            ["observe_address", 0x0000], ["dots", 10], ["observe_address", 0x1000], ["irq"],
        ]),
        2,
    );

    // $E000 acknowledges the line and disables the counter; $E001 enables it again without asserting.
    assert.equal(
        run_irq_script([
            ["cpu_write", 0xc000, 0], ["cpu_write", 0xc001, 0], ["cpu_write", 0xe001, 0],
            ...a12_cycle(10),
            ["cpu_write", 0xe000, 0], ["irq"],
            ...a12_cycle(10),
            ["cpu_write", 0xe001, 0], ["irq"],
            ...a12_cycle(10),
        ]),
        5,
    );

    // A reload in the middle of a countdown empties the counter and takes the new latch next clock.
    assert.equal(
        run_irq_script([
            ["cpu_write", 0xc000, 4], ["cpu_write", 0xc001, 0], ["cpu_write", 0xe001, 0],
            ...a12_cycle(10), ...a12_cycle(10),
            ["cpu_write", 0xc000, 1], ["cpu_write", 0xc001, 0], ["irq"],
            ...a12_cycle(10), ...a12_cycle(10),
        ]),
        5,
    );

    // The counter keeps counting while it is disabled and only asserts once it is enabled again.
    assert.equal(
        run_irq_script([
            ["cpu_write", 0xc000, 1], ["cpu_write", 0xc001, 0],
            ...a12_cycle(10), ...a12_cycle(10),
            ["cpu_write", 0xe001, 0], ["irq"],
            ...a12_cycle(10), ...a12_cycle(10),
        ]),
        5,
    );
});

test("the mirrored MMC3 A12 filter refuses what the reference refuses", () => {
    // The bus normalizes every address it forwards, so an out-of-range one can only reach the mapper
    // directly. The reference raises a range error; the mirror reports that it took no observation.
    for (const address of [0x4000, 0xffff, -1, 8192.5]) {
        const { reference, mirror } = make_irq_pair();
        assert.throws(() => reference.observe_ppu_address(address), RangeError, `address ${address}`);
        mirror.observe_ppu_address(address);
        assert.equal(mirror.ppu_observed, 0, `address ${address} is refused`);
        assert.equal(mirror.get_irq_line_asserted(), 0, "a refused observation asserts nothing");
    }

    // An in-range address is taken, and an integer one only: the fractional case the reference's
    // Number.isInteger check refuses is refused by the mirror's floor-division comparison.
    const { reference, mirror } = make_irq_pair();
    reference.observe_ppu_address(0x1000);
    mirror.observe_ppu_address(0x1000);
    assert.equal(mirror.ppu_observed, 1, "an in-range integer address is observed");
    mirror.observe_ppu_address(4095.5);
    assert.equal(mirror.ppu_observed, 0, "a fractional address is refused");
    assert.equal(mirror.ppu_a12_high, 1, "a refused observation leaves the A12 state alone");

    // Every access kind clocks A12 the same way, because the reference reads the address alone.
    const traces: string[] = [];

    for (const kind of Object.values(ported.MMC3_PPU_ACCESS)) {
        const pair = make_irq_pair();
        pair.mirror.write_cpu(0xc000, 1);
        pair.mirror.write_cpu(0xc001, 0);
        pair.mirror.write_cpu(0xe001, 0);
        const line: number[] = [];

        for (let rise = 0; rise < 3; rise += 1) {
            pair.mirror.observe_ppu_access(kind, 0x0000);

            for (let dot = 0; dot < 10; dot += 1) {
                pair.mirror.clock_ppu_dot();
            }

            pair.mirror.observe_ppu_access(kind, 0x1000);
            line.push(pair.mirror.get_irq_line_asserted());
        }

        traces.push(line.join(","));
    }

    assert.deepEqual(traces, ["0,1,1", "0,1,1", "0,1,1", "0,1,1"], "the access kind changes nothing");

    // The low-dot count saturates at the filter, so a long low stretch is not a bigger count.
    const saturated = make_irq_pair();
    saturated.mirror.write_cpu(0xc000, 2);
    saturated.mirror.write_cpu(0xc001, 0);
    saturated.mirror.write_cpu(0xe001, 0);
    saturated.mirror.observe_ppu_address(0x0000);

    for (let dot = 0; dot < 500; dot += 1) {
        saturated.mirror.clock_ppu_dot();
    }

    assert.equal(saturated.mirror.a12_low_dots, 10, "the count stops at the filter");
    saturated.mirror.observe_ppu_address(0x1000);
    assert.equal(saturated.mirror.irq_counter, 2, "one saturated stretch is still one clock");
    assert.equal(saturated.mirror.get_irq_line_asserted(), 0);

    // A high address while A12 is already high is not an edge, so it clocks nothing.
    const deduped = make_irq_pair();
    deduped.mirror.write_cpu(0xc000, 1);
    deduped.mirror.write_cpu(0xc001, 0);
    deduped.mirror.write_cpu(0xe001, 0);
    deduped.mirror.observe_ppu_address(0x0000);

    for (let dot = 0; dot < 10; dot += 1) {
        deduped.mirror.clock_ppu_dot();
    }

    deduped.mirror.observe_ppu_address(0x1000);
    assert.equal(deduped.mirror.irq_counter, 1, "the first rise loads the latch");

    for (let dot = 0; dot < 10; dot += 1) {
        deduped.mirror.clock_ppu_dot();
    }

    deduped.mirror.observe_ppu_address(0x1400);
    deduped.mirror.observe_ppu_address(0x1fff);
    assert.equal(deduped.mirror.irq_counter, 1, "a second high address is not an edge");
    assert.equal(deduped.mirror.a12_low_dots, 0, "the rising edge cleared the low-dot count");
});

test("the mirrored MMC3 payload copy lands the bytes the reference board holds", () => {
    const header = [0x4e, 0x45, 0x53, 0x1a, 2, 1, 0x46, 0x00, 1, 0, 0, 0, 0, 0, 0, 0];
    const image_bytes = 16 + 512 + 32768 + 8192;
    const image = make_cartridge_image(image_bytes, header);

    for (let index = 16; index < image.length; index += 1) {
        image[index] = (index * 13 + 7) % 251;
    }

    const parsed = parse_ines_rom(image);
    assert.ok(parsed.ok, "the synthetic MMC3 image parses");
    const rom = parsed.value;
    assert.ok(rom.trainer !== null, "the image carries a trainer");
    const created = Mmc3Mapper.create(rom);
    assert.ok(created.ok, "the synthetic image is an acceptable MMC3 board");
    const reference = created.value;

    const mirror = make_mirror_mmc3([image_bytes, ...header]);
    mirror.cartridge_bytes = [...image];
    mirror.validate();
    assert.equal(mirror.ok, 1);
    mirror.load_payload();

    assert.equal(mirror.prg_rom.length, 32768, "PRG ROM is copied to its declared size");
    assert.equal(mirror.chr_rom.length, 8192, "CHR ROM is copied to its declared size");

    for (let address = 0x8000; address <= 0xffff; address += 7) {
        const expected = reference.read_cpu(address, 0);
        mirror.read_cpu(address);
        assert.equal(mirror.cpu_value, expected?.value, `PRG ROM at $${address.toString(16)}`);
    }

    for (let address = 0x6000; address < 0x8000; address += 5) {
        const expected = reference.read_cpu(address, 0);
        mirror.read_cpu(address);
        assert.equal(mirror.cpu_value, expected?.value ?? 0, `PRG RAM at $${address.toString(16)}`);
    }

    // The trainer copy is the interesting part: the reference constructor puts those 512 bytes at
    // PRG RAM offset $1000, which is $7000 on the CPU bus.
    for (let offset = 0; offset < 512; offset += 1) {
        const expected = reference.read_cpu(0x7000 + offset, 0);
        mirror.read_cpu(0x7000 + offset);
        assert.equal(mirror.cpu_value, expected?.value, `trainer byte ${offset} lands at $7000`);
    }

    for (let address = 0; address < 0x2000; address += 3) {
        mirror.read_pattern(address);
        assert.equal(mirror.pattern_value, reference.read_pattern(address), `pattern byte ${address}`);
    }

    // Banking applies to the copied payload the same way on both sides.
    for (const [register_address, value] of [[0x8000, 6], [0x8001, 3], [0x8000, 0], [0x8001, 0x82]] as const) {
        reference.write_cpu(register_address, value);
        mirror.write_cpu(register_address, value);
    }

    for (const address of [0x8000, 0x9abc, 0xa000, 0xc000, 0xe000, 0xfffd]) {
        const expected = reference.read_cpu(address, 0);
        mirror.read_cpu(address);
        assert.equal(mirror.cpu_value, expected?.value, `banked PRG ROM at $${address.toString(16)}`);
    }

    for (let address = 0; address < 0x2000; address += 512) {
        mirror.read_pattern(address);
        assert.equal(mirror.pattern_value, reference.read_pattern(address), `banked pattern at ${address}`);
    }

    // Re-loading a cartridge must restore the fresh-board bank and IRQ state, not retain the last run.
    reference.reset();
    mirror.write_cpu(0x8000, 0xc6);
    mirror.write_cpu(0x8001, 3);
    mirror.write_cpu(0xc000, 7);
    mirror.write_cpu(0xc001, 0);
    mirror.write_cpu(0xe001, 0);
    mirror.observe_ppu_address(0x0000);
    mirror.load_payload();

    assert.deepEqual(mirror.bank_registers, new Array<number>(8).fill(0));
    assert.equal(mirror.bank_select, 0);
    assert.equal(mirror.prg_mode, 0);
    assert.equal(mirror.chr_mode, 0);
    assert.equal(mirror.mirroring, mirror.header_mirroring);
    assert.equal(mirror.irq_counter, 0);
    assert.equal(mirror.irq_enabled, 0);
    assert.equal(mirror.irq_line_asserted, 0);
    assert.equal(mirror.ppu_a12_high, 0);

    for (const address of [0x8000, 0xa000, 0xc000, 0xe000]) {
        const expected = reference.read_cpu(address, 0);
        mirror.read_cpu(address);
        assert.equal(mirror.cpu_value, expected?.value, `reloaded PRG ROM at $${address.toString(16)}`);
    }
});

test("the mirrored MMC3 PRG bank masks match a board with enough banks to see them", () => {
    // Registers 6 and 7 keep six and seven bits. At eight or fewer banks the mask is invisible,
    // because the bank index wraps to the same slot either way, so this board has 128 banks: an
    // unmasked 255 would select bank 127 and a masked one selects bank 63.
    const header = [0x4e, 0x45, 0x53, 0x1a, 64, 1, 0x40, 0x00, 0, 0, 0, 0, 0, 0, 0, 0];
    const image_bytes = 16 + 64 * 16384 + 8192;
    const image = make_cartridge_image(image_bytes, header);

    for (let index = 16; index < image.length; index += 1) {
        image[index] = (index * 3 + 1) % 251;
    }

    const parsed = parse_ines_rom(image);
    assert.ok(parsed.ok, "the one-megabyte MMC3 image parses");
    const created = Mmc3Mapper.create(parsed.value);
    assert.ok(created.ok, "the one-megabyte image is an acceptable MMC3 board");
    const reference = created.value;

    const mirror = make_mirror_mmc3([image_bytes, ...header]);
    mirror.cartridge_bytes = [...image];
    mirror.validate();
    assert.equal(mirror.ok, 1);
    assert.equal(mirror.prg_bank_count, 128);
    mirror.load_payload();

    for (const [register_address, value] of [[0x8000, 6], [0x8001, 0xff]] as const) {
        reference.write_cpu(register_address, value);
        mirror.write_cpu(register_address, value);
    }

    const expected = reference.read_cpu(0x8000, 0);
    mirror.read_cpu(0x8000);
    assert.equal(mirror.cpu_value, expected?.value, "register 6 masked to $3F selects bank 63");
    assert.equal(mirror.cpu_value, image[16 + 63 * 8192] ?? 0, "bank 63 is where the mask points");
    assert.notEqual(mirror.cpu_value, image[16 + 127 * 8192] ?? 0, "an unmasked write would select bank 127");

    for (const [register_address, value] of [[0x8000, 7], [0x8001, 0xff]] as const) {
        reference.write_cpu(register_address, value);
        mirror.write_cpu(register_address, value);
    }

    const expected7 = reference.read_cpu(0xa000, 0);
    mirror.read_cpu(0xa000);
    assert.equal(mirror.cpu_value, expected7?.value, "register 7 masked to $7F selects bank 127");
    assert.equal(mirror.cpu_value, image[16 + 127 * 8192] ?? 0, "bank 127 is where that mask points");
});

test("the mirrored bus drives an attached MMC3 board the way the reference does", () => {
    const header = [0x4e, 0x45, 0x53, 0x1a, 4, 2, 0x42, 0x00, 1, 0, 0, 0, 0, 0, 0, 0];
    const image_bytes = 16 + 65536 + 16384;
    const image = make_cartridge_image(image_bytes, header);

    for (let index = 16; index < image.length; index += 1) {
        image[index] = (index * 17 + 11) % 251;
    }

    const parsed = parse_ines_rom(image);
    assert.ok(parsed.ok, "the synthetic MMC3 image parses");
    const created = Mmc3Mapper.create(parsed.value);
    assert.ok(created.ok, "the synthetic image is an acceptable MMC3 board");
    const reference_mapper = created.value;
    const devices = make_absent_bus_devices();
    const reference = new NesCpuBus({ ...devices, cartridge: reference_mapper });

    // The mirror walks the same boot path the loader composes for an MMC3 image: parse, validate,
    // copy the payload, and attach the board to the bus.
    const parser = new ported.GoboscriptCartridgeParser();
    parser.image_bytes = image.length;

    for (let index = 0; index < 16; index += 1) {
        parser.header[index] = image[index] ?? 0;
    }

    parser.parse();
    assert.equal(parser.ok, 1);

    const board = make_mirror_mmc3([image_bytes, ...header]);
    board.cartridge_bytes = [...image];
    board.validate();
    assert.equal(board.ok, 1);
    board.load_payload();

    const bus = new ported.GoboscriptCpuBus();
    bus.mmc3_board = board;
    bus.cartridge_kind = ported.MAPPER_KIND.MMC3;

    const addresses = [
        0x0000, 0x0800, 0x1fff, 0x2000, 0x4020, 0x5fff, 0x6000, 0x7000, 0x7fff, 0x8000, 0x9abc, 0xa000, 0xbfff,
        0xc000, 0xe000, 0xfffc, 0xffff,
    ];

    for (const address of addresses) {
        assert.equal(bus.read(address), reference.read_cpu(address), `read $${address.toString(16)}`);
    }

    // Bank the two swappable PRG slots and the CHR banks through the bus, then compare again. The
    // trainer the constructor copied sits at PRG RAM offset $1000, so $7000 is worth re-reading too.
    const register_writes: readonly (readonly [number, number])[] = [
        [0x8000, 6], [0x8001, 5], [0x8000, 7], [0x8001, 2], [0x8000, 0], [0x8001, 0x0a], [0x8000, 2], [0x8001, 3],
        [0xa000, 1], [0xa001, 0x80],
    ];

    for (const [address, value] of register_writes) {
        bus.write(address, value);
        reference.write_cpu(address, value);
    }

    for (const address of addresses) {
        assert.equal(bus.read(address), reference.read_cpu(address), `banked read $${address.toString(16)}`);
    }

    for (const [address, value] of [[0x6000, 0x5a], [0x7fff, 0xa5], [0x7000, 0x3c]] as const) {
        bus.write(address, value);
        reference.write_cpu(address, value);
    }

    for (const address of addresses) {
        assert.equal(bus.read(address), reference.read_cpu(address), `after RAM writes, $${address.toString(16)}`);
    }

    assert.equal(board.mirroring, 1, "the mirroring register write reached the board");
    assert.equal(reference_mapper.get_nametable_mirroring(), "horizontal");

    // PRG mode 1 swaps the outer slots on both sides.
    bus.write(0x8000, 0x46);
    reference.write_cpu(0x8000, 0x46);

    for (const address of [0x8000, 0xa000, 0xc000, 0xe000]) {
        assert.equal(bus.read(address), reference.read_cpu(address), `PRG mode 1 at $${address.toString(16)}`);
    }

    // Disabling PRG RAM closes the window on both sides, and the latch survives the dropped write.
    bus.write(0xa001, 0x00);
    reference.write_cpu(0xa001, 0x00);
    assert.equal(bus.read(0x6000), reference.read_cpu(0x6000), "a disabled PRG RAM window returns the latch");

    // The scanline IRQ: the registers arm through the same CPU window, and the line the loader
    // reports is the cartridge's half of the OR the reference console feeds to the CPU.
    assert.equal(bus.board_irq_line(), 0, "a freshly attached board drives no IRQ");

    for (const [address, value] of [[0xc000, 1], [0xc001, 0], [0xe001, 0]] as const) {
        bus.write(address, value);
        reference.write_cpu(address, value);
    }

    for (let rise = 0; rise < 3; rise += 1) {
        board.observe_ppu_address(0x0000);
        reference_mapper.observe_ppu_address(0x0000);

        for (let dot = 0; dot < 10; dot += 1) {
            board.clock_ppu_dot();
            reference_mapper.clock_ppu_dot();
        }

        board.observe_ppu_address(0x1000);
        reference_mapper.observe_ppu_address(0x1000);
        assert.equal(
            bus.board_irq_line(),
            reference_mapper.get_irq_line_asserted() ? 1 : 0,
            `the cartridge IRQ line follows the reference after rise ${rise}`,
        );
    }

    assert.equal(bus.board_irq_line(), 1, "a latch of one asserts on the second filtered rise");

    // Acknowledge, then re-arm with a latch of zero: the counter stays off until $E001 enables it.
    for (const [address, value] of [[0xe000, 0], [0xc000, 0], [0xc001, 0], [0xe001, 0]] as const) {
        bus.write(address, value);
        reference.write_cpu(address, value);
    }

    assert.equal(bus.board_irq_line(), 0, "$E000 acknowledges the line on both sides");
    assert.equal(reference_mapper.get_irq_line_asserted(), false);

    board.observe_ppu_address(0x0000);
    reference_mapper.observe_ppu_address(0x0000);

    for (let dot = 0; dot < 10; dot += 1) {
        board.clock_ppu_dot();
        reference_mapper.clock_ppu_dot();
    }

    board.observe_ppu_address(0x1000);
    reference_mapper.observe_ppu_address(0x1000);
    assert.equal(bus.board_irq_line(), 1, "a latch of zero asserts again on the next filtered rise");
    assert.equal(reference_mapper.get_irq_line_asserted(), true);
});

test("the mirrored cartridge IRQ line stays quiet without an MMC3 board", () => {
    const bus = new ported.GoboscriptCpuBus();
    assert.equal(bus.board_irq_line(), 0, "a cartridge window with no board drives nothing");

    const nrom = new ported.GoboscriptNromMapper();
    nrom.mapper_id = 0;
    nrom.prg_rom_bytes = 32768;
    nrom.chr_rom_bytes = 8192;
    nrom.validate();
    assert.equal(nrom.ok, 1, "the NROM board the loader would attach validates");
    bus.board = nrom;
    bus.cartridge_kind = ported.MAPPER_KIND.NROM;
    assert.equal(bus.board_irq_line(), 0, "an NROM board has no scanline counter");

    // The ported loader only records the MMC3 kind after a board validated and copied, so the port
    // cannot reach an MMC3 window with no board behind it; the mirror's null check stands for that.
    const unattached = new ported.GoboscriptCpuBus();
    unattached.cartridge_kind = ported.MAPPER_KIND.MMC3;
    assert.equal(unattached.board_irq_line(), 0, "an MMC3 window with no board drives nothing");
});

function make_empty_ppu_mapper_port(): PpuMapperPort {
    return {
        read_pattern: () => 0,
        write_pattern: () => {},
        observe_ppu_access: () => {},
        clock_ppu_dot: () => {},
        get_nametable_mirroring: () => "horizontal" as const,
    };
}

test("the mirrored PPU bus routes nametable, palette, and OAM the same way as the reference", () => {
    const mirror_bus = new ported.GoboscriptPpuBus();
    const reference_mapper = make_empty_ppu_mapper_port();
    const reference_bus = new PpuMemoryBus(reference_mapper);

    // Nametable write/read with horizontal mirroring (default)
    mirror_bus.write_ppu(0x2000, 0x42);
    reference_bus.write_ppu(0x2000, 0x42);
    assert.equal(mirror_bus.read_ppu(0x2000), reference_bus.read_ppu(0x2000));
    // Horizontal mirroring: $2400 maps to the same physical byte as $2000
    assert.equal(mirror_bus.read_ppu(0x2400), reference_bus.read_ppu(0x2400));

    // Palette write/read with universal background alias
    mirror_bus.write_ppu(0x3f00, 0x3f);
    reference_bus.write_ppu(0x3f00, 0x3f);
    assert.equal(mirror_bus.read_ppu(0x3f00), reference_bus.read_ppu(0x3f00));
    // $3f10 aliases $3f00 (universal background)
    assert.equal(mirror_bus.read_ppu(0x3f10), reference_bus.read_ppu(0x3f10));

    // Palette write mask (6-bit)
    mirror_bus.write_ppu(0x3f01, 0xff);
    reference_bus.write_ppu(0x3f01, 0xff);
    assert.equal(mirror_bus.read_ppu(0x3f01), reference_bus.read_ppu(0x3f01));

    // OAM write/read
    mirror_bus.write_oam(0x00, 0xab);
    reference_bus.write_oam(0x00, 0xab);
    assert.equal(mirror_bus.read_oam(0x00), reference_bus.read_oam(0x00));

    // Address wrapping (14-bit mask)
    mirror_bus.write_ppu(0x6000, 0x12);
    reference_bus.write_ppu(0x6000, 0x12);
    assert.equal(mirror_bus.read_ppu(0x2000), reference_bus.read_ppu(0x2000));
});

test("the mirrored PPU bus routes pattern access through the attached NROM mirror", () => {
    const nrom = new ported.GoboscriptNromMapper();
    nrom.mapper_id = 0;
    nrom.prg_rom_bytes = 16384;
    nrom.chr_rom_bytes = 0;
    nrom.chr_ram_bytes = 8192;
    nrom.mirroring = 1;
    nrom.validate();
    assert.equal(nrom.ok, 1);

    const bus = new ported.GoboscriptPpuBus();
    bus.attach_nrom(nrom);
    assert.equal(bus.get_mirroring(), 1);

    // Pattern read through NROM mirror (CHR RAM is initially zero)
    bus.read_ppu(0x0000);
    assert.equal(bus.read_value, 0, "CHR RAM is initially zero");

    // Write to CHR RAM and read back
    bus.write_ppu(0x1000, 0xaa);
    bus.read_ppu(0x1000);
    assert.equal(bus.read_value, 0xaa);
});

test("the mirrored PPU 2C02 clocks vblank and NMI edges like the reference", () => {
    const mirror_bus = new ported.GoboscriptPpuBus();
    const mirror_ppu = new ported.GoboscriptPpu2C02(mirror_bus);
    const reference_bus = new PpuMemoryBus(make_empty_ppu_mapper_port());
    const reference_ppu = new Ppu2C02(reference_bus);

    // Write PPUCTRL with NMI enable
    mirror_ppu.write_cpu_register(0, 0x80);
    reference_ppu.write_cpu_register(0, 0x80);

    // Clock to vblank (scanline 241, dot 1):
    // Pre-render: 341 dots, scanlines 0-240: 241*341=82181 dots
    // Total to dot 1 of scanline 241: 341 + 82181 + 1 = 82523
    const dots_to_vblank = 82523;

    for (let i = 0; i < dots_to_vblank; i++) {
        mirror_ppu.clock_ppu_dot();
        reference_ppu.clock_ppu_dot();
    }

    // One more dot puts us at the vblank event
    mirror_ppu.clock_ppu_dot();
    reference_ppu.clock_ppu_dot();

    assert.equal(mirror_ppu.get_status_register(), reference_ppu.get_status_register());
    assert.equal(mirror_ppu.get_status_register() & 0x80, 0x80, "vblank flag is set");
    assert.equal(mirror_ppu.take_nmi_edge(), 1, "NMI edge consumed");
    assert.equal(reference_ppu.take_nmi_edge(), true);
    assert.equal(mirror_ppu.take_nmi_edge(), 0, "edge already consumed");
});

test("the mirrored CPU bus drives an OAM DMA transfer", () => {
    const bus = new ported.GoboscriptCpuBus();

    // Write some data to RAM at page $03 (these writes increment the cycle counter)
    for (let i = 0; i < 256; i++) {
        bus.write(0x0300 + i, i + 0x10);
    }

    // Trigger OAM DMA from page $03
    bus.write(0x4014, 0x03);

    // Clock the DMA until it completes, counting only the DMA cycles
    let dma_cycles = 0;
    while ((bus as any).clock_dma_cycle() === 1) {
        dma_cycles++;
    }

    // OAM DMA takes 513 or 514 cycles (not counting the $4014 write itself)
    // The DMA state machine: halt (1) -> [align (1)] -> read/write (256 pairs = 512)
    // Total: 513 if no alignment, 514 if alignment needed
    assert.ok(dma_cycles === 513 || dma_cycles === 514, `Expected 513 or 514 DMA cycles, got ${dma_cycles}`);
});

test("the mirrored PPU 2C02 suppresses vblank when PPUSTATUS is read early", () => {
    const mirror_bus = new ported.GoboscriptPpuBus();
    const mirror_ppu = new ported.GoboscriptPpu2C02(mirror_bus);
    const reference_bus = new PpuMemoryBus(make_empty_ppu_mapper_port());
    const reference_ppu = new Ppu2C02(reference_bus);

    mirror_ppu.write_cpu_register(0, 0x80);
    reference_ppu.write_cpu_register(0, 0x80);

    // Clock to scanline 241 dot 0 (one dot before vblank)
    const dots_to_241_0 = 341 + 241 * 341;

    for (let i = 0; i < dots_to_241_0; i++) {
        mirror_ppu.clock_ppu_dot();
        reference_ppu.clock_ppu_dot();
    }

    // Read PPUSTATUS at dot 0 of scanline 241 (before vblank event at dot 1)
    const mirror_status = mirror_ppu.read_status_register();
    const reference_status = reference_ppu.read_cpu_register(2, 0);

    // Both should suppress the vblank flag
    assert.equal(mirror_ppu.suppress_vblank_start, 1);

    // Clock one more dot (the vblank event dot)
    mirror_ppu.clock_ppu_dot();
    reference_ppu.clock_ppu_dot();

    // Vblank should be suppressed
    assert.equal(mirror_ppu.get_status_register() & 0x80, 0, "vblank suppressed");
    assert.equal(mirror_ppu.take_nmi_edge(), 0, "no NMI edge");
});

test("nes_palette_dim_channel matches the canvas emphasis dimming for every channel", () => {
    for (let channel = 0; channel <= 0xff; channel += 1) {
        assert.equal(ported.nes_palette_dim_channel(channel), Math.round(channel * 0.75));
    }
});

test("nes_palette_hex_byte matches two-digit hex for every byte", () => {
    for (let value = 0; value <= 0xff; value += 1) {
        assert.equal(ported.nes_palette_hex_byte(value), value.toString(16).padStart(2, "0"));
    }
});

test("nes_pen_color matches the canvas renderer for every palette index and emphasis", () => {
    // One conversion covers all 512 pairs: pixel emphasis * 64 + color holds that pair.
    const framebuffer = new Uint8Array(NES_FRAME_PIXEL_COUNT);
    const emphasis = new Uint8Array(NES_FRAME_PIXEL_COUNT);

    for (let pair = 0; pair < 512; pair += 1) {
        framebuffer[pair] = pair % 64;
        emphasis[pair] = Math.floor(pair / 64);
    }

    const rgba = framebuffer_to_rgba(framebuffer, emphasis);

    for (let pair = 0; pair < 512; pair += 1) {
        const expected =
            "#" +
            [rgba[pair * 4], rgba[pair * 4 + 1], rgba[pair * 4 + 2]]
                .map((channel) => (channel ?? 0).toString(16).padStart(2, "0"))
                .join("");
        assert.equal(ported.nes_pen_color(pair % 64, Math.floor(pair / 64)), expected);
    }
});

test("ppu_shift_pixel matches the reference fine-X bit test", () => {
    for (let fine_x = 0; fine_x <= 7; fine_x += 1) {
        const bit_mask = 0x8000 >>> fine_x;

        for (let shift_low = 0; shift_low <= 0xffff; shift_low += 1) {
            const shift_high = 0xffff - shift_low;
            const expected =
                ((shift_low & bit_mask) === 0 ? 0 : 1) |
                ((shift_high & bit_mask) === 0 ? 0 : 2);
            assert.equal(ported.ppu_shift_pixel(shift_low, shift_high, fine_x), expected);
        }
    }
});

test("ppu_select_palette_offset matches the reference priority mix", () => {
    for (let bg_pixel = 0; bg_pixel <= 3; bg_pixel += 1) {
        for (let bg_palette = 0; bg_palette <= 3; bg_palette += 1) {
            for (let has_sprite = 0; has_sprite <= 1; has_sprite += 1) {
                for (let spr_pixel = 0; spr_pixel <= 3; spr_pixel += 1) {
                    for (let spr_attributes = 0; spr_attributes <= 0xff; spr_attributes += 1) {
                        let expected = 0;

                        if (has_sprite === 1 && (bg_pixel === 0 || (spr_attributes & 0x20) === 0)) {
                            expected = 0x10 + ((spr_attributes & 0x03) << 2) + spr_pixel;
                        } else if (bg_pixel !== 0) {
                            expected = (bg_palette << 2) + bg_pixel;
                        }

                        assert.equal(
                            ported.ppu_select_palette_offset(
                                bg_pixel,
                                bg_palette,
                                has_sprite,
                                spr_pixel,
                                spr_attributes,
                            ),
                            expected,
                        );
                    }
                }
            }
        }
    }
});

test("ppu_reverse_byte_bits matches the reference bit reversal for every byte", () => {
    for (let value = 0; value <= 0xff; value += 1) {
        const expected =
            ((value & 0x01) << 7) |
            ((value & 0x02) << 5) |
            ((value & 0x04) << 3) |
            ((value & 0x08) << 1) |
            ((value & 0x10) >>> 1) |
            ((value & 0x20) >>> 3) |
            ((value & 0x40) >>> 5) |
            ((value & 0x80) >>> 7);
        assert.equal(ported.ppu_reverse_byte_bits(value), expected);
    }
});

test("ppu_sprite_row matches the reference row wrap for every scanline and Y", () => {
    for (let target_scanline = 0; target_scanline <= 0xff; target_scanline += 1) {
        for (let sprite_y = 0; sprite_y <= 0xff; sprite_y += 1) {
            const expected = (target_scanline - ((sprite_y + 1) & 0xff)) & 0xff;
            assert.equal(ported.ppu_sprite_row(target_scanline, sprite_y), expected);
        }
    }
});

test("ppu_sprite_pattern_address matches the reference sprite pattern fetch address", () => {
    const reference_pattern_address = (
        control: number,
        tile: number,
        attributes: number,
        row: number,
    ): number => {
        let effective_row = row;
        const sprite_height = (control & 0x20) === 0 ? 8 : 16;

        if ((attributes & 0x80) !== 0) {
            effective_row = sprite_height - row - 1;
        }

        if (sprite_height === 16) {
            const pattern_table = (tile & 0x01) << 12;
            const base_tile = (tile & 0xfe) + (effective_row >= 8 ? 1 : 0);
            return pattern_table + base_tile * 16 + (effective_row & 0x07);
        }

        const pattern_table = (control & 0x08) === 0 ? 0 : 0x1000;
        return pattern_table + tile * 16 + effective_row;
    };

    for (let control = 0; control <= 0xff; control += 1) {
        for (const tile of [0, 1, 2, 3, 127, 128, 254, 255]) {
            for (const attributes of [0, 32, 64, 128, 160, 192, 224, 255]) {
                for (let row = 0; row <= 15; row += 1) {
                    assert.equal(
                        ported.ppu_sprite_pattern_address(control, tile, attributes, row),
                        reference_pattern_address(control, tile, attributes, row),
                    );
                }
            }
        }
    }
});

test("the mirrored scroll increments match the reference for every VRAM address", () => {
    const reference_increment_x = (vram_address: number): number => {
        let result = vram_address;

        if ((result & 0x001f) === 0x001f) {
            result &= ~0x001f;
            result ^= 0x0400;
        } else {
            result += 1;
        }

        return result & 0x7fff;
    };
    const reference_increment_y = (vram_address: number): number => {
        let result = vram_address;

        if ((result & 0x7000) !== 0x7000) {
            return (result + 0x1000) & 0x7fff;
        }

        result &= ~0x7000;
        let coarse_y = (result & 0x03e0) >>> 5;

        if (coarse_y === 29) {
            coarse_y = 0;
            result ^= 0x0800;
        } else if (coarse_y === 31) {
            coarse_y = 0;
        } else {
            coarse_y += 1;
        }

        return ((result & ~0x03e0) | (coarse_y << 5)) & 0x7fff;
    };

    for (let vram_address = 0; vram_address <= 0x7fff; vram_address += 1) {
        assert.equal(ported.ppu_increment_scroll_x_for(vram_address), reference_increment_x(vram_address));
        assert.equal(ported.ppu_increment_scroll_y_for(vram_address), reference_increment_y(vram_address));
    }
});

test("the mirrored scroll transfers match the reference bit copies", () => {
    const counterparts = [0, 0x7fff, 0x1234, 0x2aaa, 0x5555, 0x041f, 0x7be0];

    for (let current = 0; current <= 0x7fff; current += 1) {
        for (const temporary of counterparts) {
            assert.equal(
                ported.ppu_transfer_horizontal_for(current, temporary),
                (current & ~0x041f) | (temporary & 0x041f),
            );
            assert.equal(
                ported.ppu_transfer_vertical_for(current, temporary),
                (current & ~0x7be0) | (temporary & 0x7be0),
            );
        }
    }

    for (let temporary = 0; temporary <= 0x7fff; temporary += 1) {
        for (const current of counterparts) {
            assert.equal(
                ported.ppu_transfer_horizontal_for(current, temporary),
                (current & ~0x041f) | (temporary & 0x041f),
            );
            assert.equal(
                ported.ppu_transfer_vertical_for(current, temporary),
                (current & ~0x7be0) | (temporary & 0x7be0),
            );
        }
    }
});

test("pen_display_fit_scale is the largest uniform scale that fits", () => {
    for (const stage_width of [240, 480, 960]) {
        for (const stage_height of [180, 360, 720]) {
            for (const frame_width of [256, 128]) {
                for (const frame_height of [240, 120]) {
                    const expected = Math.min(stage_width / frame_width, stage_height / frame_height);
                    const scale = ported.pen_display_fit_scale(stage_width, stage_height, frame_width, frame_height);
                    assert.equal(scale, expected);
                    assert.ok(frame_width * scale <= stage_width, "the scaled width fits");
                    assert.ok(frame_height * scale <= stage_height, "the scaled height fits");
                }
            }
        }
    }
});

test("pen_display_scale_for fits the default stage only when the setting is exactly 1", () => {
    // The default stage is 480 by 360 and (0, 0) is its center, so the fit scale is
    // min(480 / 256, 360 / 240) = 1.5: the picture becomes 384 by 360, filling the
    // height exactly. Any other setting value keeps the native 1x picture.
    assert.equal(ported.pen_display_scale_for(1), 1.5);
    assert.equal(256 * ported.pen_display_scale_for(1), 384);
    assert.equal(240 * ported.pen_display_scale_for(1), 360);

    for (const setting of [0, 2, -1, 0.5]) {
        assert.equal(ported.pen_display_scale_for(setting), 1, `setting ${setting} stays native`);
    }
});

test("pen display geometry centers every pixel band on the stage origin", () => {
    // Scratch stage coordinates put (0, 0) in the center, and scratch-render adds
    // (+0.5, +0.5) to pen lines of diameter exactly 1. The stored first-pixel goto
    // coordinates pre-subtract that offset, so the centers the pen actually draws
    // must run symmetric about zero at every scale, with each pixel band exactly
    // one scale wide: the first band starts at -(scaled size) / 2.
    for (const scale of [0.25, 0.5, 1, 1.5, 2, 2.5]) {
        const offset = ported.pen_display_renderer_offset(scale);
        assert.equal(offset, scale === 1 ? 0.5 : 0);

        const first_x = ported.pen_display_first_x_for(scale) + offset;
        const last_x = first_x + 255 * scale;
        assert.equal(first_x, -(256 * scale) / 2 + scale / 2, `first column center at scale ${scale}`);
        assert.equal(last_x, -first_x, `columns are symmetric about x 0 at scale ${scale}`);

        const first_y = ported.pen_display_first_y_for(scale) + offset;
        const last_y = first_y - 239 * scale;
        assert.equal(first_y, (240 * scale) / 2 - scale / 2, `top row center at scale ${scale}`);
        assert.equal(last_y, -first_y, `rows are symmetric about y 0 at scale ${scale}`);
    }

    assert.equal(ported.pen_display_first_x_for(1), -128, "native goto x keeps the 1x mapping");
    assert.equal(ported.pen_display_first_y_for(1), 119, "native goto y keeps the 1x mapping");
    assert.equal(ported.pen_display_first_x_for(1.5), -191.25, "fit goto x centers the 384-wide picture");
    assert.equal(ported.pen_display_first_y_for(1.5), 179.25, "fit goto y centers the 360-tall picture");
});

const SUPPLIED_ROM_IMAGE = Uint8Array.from(
    readFileSync(fileURLToPath(new URL("../test_rom.nes", import.meta.url))),
);

/** The reference decoder's string codes and the numeric codes the port reports for them. */
const ROM_TEXT_ERROR_CODES: Readonly<Record<string, number>> = {
    empty: ported.ROM_INPUT_ERROR.EMPTY,
    "odd-digits": ported.ROM_INPUT_ERROR.ODD_DIGITS,
    "too-many-bytes": ported.ROM_INPUT_ERROR.TOO_MANY_BYTES,
    "too-long": ported.ROM_INPUT_ERROR.TOO_LONG,
};

test("the mirrored ROM text decode matches the reference decoder", () => {
    // scratch/src/rom_input.gs rebuilds a cartridge image from a pasted hexadecimal string,
    // and the converter page encodes that string with the reference module, so the two have
    // to agree on every byte. The mirror is the ported scan; this compares it with the
    // reference over the same text the page produces.
    const images = [
        Uint8Array.from([0x4e, 0x45, 0x53, 0x1a, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 128, 7]),
        Uint8Array.from({ length: 256 }, (_, index) => index),
        Uint8Array.from({ length: 4_096 }, (_, index) => (index * 37 + 11) % 256),
        SUPPLIED_ROM_IMAGE,
    ];

    for (const image of images) {
        for (const format of ["continuous", "spaced", "lines"] as const) {
            const text = encode_rom_text(image, format).text;
            const reference = decode_rom_text(text);
            const decoder = new ported.GoboscriptRomInput();
            decoder.rom_input_text = text;
            decoder.parse_text();

            assert.equal(reference.ok, true, `the reference must decode ${image.byteLength} bytes`);
            assert.equal(
                decoder.rom_input_error_code,
                ported.ROM_INPUT_ERROR.NONE,
                `the port must decode ${image.byteLength} bytes in the ${format} layout`,
            );
            assert.equal(decoder.rom_input_byte_count, image.byteLength);
            assert.deepEqual(decoder.rom_input_bytes, Array.from(image));
        }
    }
});

test("the mirrored ROM text decode stops where the reference decoder stops", () => {
    const failures: readonly (readonly [string, string])[] = [
        ["", "empty"],
        ["  ,\n;.-+", "empty"],
        ["4e45531a0", "odd-digits"],
        ["f", "odd-digits"],
        ["x".repeat(ported.ROM_INPUT_LIMIT.MAX_TEXT_CHARS + 1), "too-long"],
        ["0a".repeat(ported.ROM_INPUT_LIMIT.MAX_BYTES + 1), "too-many-bytes"],
    ];

    for (const [text, expected_code] of failures) {
        const reference = decode_rom_text(text);
        const decoder = new ported.GoboscriptRomInput();
        decoder.rom_input_text = text;
        decoder.parse_text();

        assert.equal(reference.ok, false, `the reference must reject ${text.length} characters of input`);
        assert.equal(ROM_TEXT_ERROR_CODES[expected_code] !== undefined, true, `${expected_code} is mapped`);
        assert.equal(
            decoder.rom_input_error_code,
            ROM_TEXT_ERROR_CODES[expected_code],
            `the port must report ${expected_code}`,
        );

        if (!reference.ok) {
            assert.equal(decoder.rom_input_byte_count, reference.error.byte_count, "both stop at the same byte");
            assert.equal(decoder.rom_input_bytes.length, reference.error.byte_count);
        }
    }
});

test("the mirrored image validation gates the install on a complete iNES image", () => {
    const ines_1_0_header = [0x4e, 0x45, 0x53, 0x1a, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const declared_bytes = 16 + 2 * 16_384 + 1 * 8_192;
    const complete = [...ines_1_0_header, ...new Array<number>(declared_bytes - 16).fill(0xa5)];

    const accepted = new ported.GoboscriptRomInput();
    accepted.rom_input_bytes = [...complete];
    accepted.rom_input_byte_count = complete.length;
    accepted.validate_image();

    assert.equal(accepted.has_signature(), 1);
    assert.equal(accepted.rom_input_error_code, ported.ROM_INPUT_ERROR.NONE);
    assert.equal(accepted.rom_input_declared_bytes, declared_bytes);

    accepted.install_image();
    assert.deepEqual(accepted.cartridge_bytes, complete, "the install replaces the embedded image");
    assert.deepEqual(accepted.rom_input_bytes, [], "the install empties the staging list");

    const rejected: readonly (readonly [string, number[], number])[] = [
        ["a truncated payload", complete.slice(0, declared_bytes - 1), ported.ROM_INPUT_ERROR.TRUNCATED],
        ["a missing signature", [0x4d, 0x45, 0x53, 0x1a, ...complete.slice(4)], ported.ROM_INPUT_ERROR.SIGNATURE],
        ["a short header", complete.slice(0, 15), ported.ROM_INPUT_ERROR.TRUNCATED],
        ["no bytes at all", [], ported.ROM_INPUT_ERROR.TRUNCATED],
    ];

    for (const [description, staged, expected_code] of rejected) {
        const decoder = new ported.GoboscriptRomInput();
        decoder.cartridge_bytes = [...complete];
        decoder.rom_input_bytes = [...staged];
        decoder.rom_input_byte_count = staged.length;
        decoder.validate_image();

        assert.equal(decoder.rom_input_error_code, expected_code, description);
    }

    // A trainer is 512 bytes of payload the header's flag 6 bit 2 declares.
    const with_trainer = new ported.GoboscriptRomInput();
    const trainer_header = [...ines_1_0_header];
    trainer_header[6] = 4;
    with_trainer.rom_input_bytes = [...trainer_header, ...new Array<number>(declared_bytes + 512 - 16).fill(0)];
    with_trainer.rom_input_byte_count = with_trainer.rom_input_bytes.length;
    with_trainer.validate_image();

    assert.equal(with_trainer.rom_input_error_code, ported.ROM_INPUT_ERROR.NONE, "a trainer is payload too");
    assert.equal(with_trainer.rom_input_declared_bytes, declared_bytes + 512);

    // A NES 2.0 header encodes its sizes differently, so the pre-check leaves those to the
    // loader's own header parse instead of guessing from the bank counts.
    const nes_2_0 = new ported.GoboscriptRomInput();
    const nes2_header = [...ines_1_0_header];
    nes2_header[7] = 8;
    nes_2_0.rom_input_bytes = [...nes2_header, 1, 2, 3];
    nes_2_0.rom_input_byte_count = nes_2_0.rom_input_bytes.length;
    nes_2_0.validate_image();

    assert.equal(nes_2_0.rom_input_error_code, ported.ROM_INPUT_ERROR.NONE, "a NES 2.0 size is the loader's call");
    assert.equal(nes_2_0.rom_input_declared_bytes, declared_bytes);

    // A decode that already failed stays failed: the validation adds no second opinion.
    const failed = new ported.GoboscriptRomInput();
    failed.rom_input_bytes = [...complete];
    failed.rom_input_byte_count = complete.length;
    failed.rom_input_error_code = ported.ROM_INPUT_ERROR.ODD_DIGITS;
    failed.validate_image();

    assert.equal(failed.rom_input_error_code, ported.ROM_INPUT_ERROR.ODD_DIGITS);
});

test("rom_run_should_skip never skips two completed frames in a row", () => {
    assert.equal(ported.rom_run_should_skip(0, 0), 0, "skipping off draws every frame");
    assert.equal(ported.rom_run_should_skip(0, 1), 0, "skipping off draws every frame");
    assert.equal(ported.rom_run_should_skip(1, 1), 0, "a skip is never followed by another skip");
    assert.equal(ported.rom_run_should_skip(1, 0), 1, "with skipping on, a drawn frame is followed by a skip");

    let last_skipped = 0;
    let skipped = 0;
    let longest_run = 0;
    let run = 0;

    for (let frame = 0; frame < 10_000; frame += 1) {
        const should_skip = ported.rom_run_should_skip(1, last_skipped);

        last_skipped = should_skip;
        skipped += should_skip;
        run = should_skip === 1 ? run + 1 : 0;
        longest_run = Math.max(longest_run, run);
    }

    assert.equal(longest_run, 1, "the longest run of skipped frames must be one");
    assert.equal(skipped, 5_000, "half of the frames are skipped while skipping is active");
});

test("rom_run_frame_due spaces frames 1/60 second apart from the origin", () => {
    assert.equal(ported.rom_run_frame_due(0, 0), 0, "frame 0 is due at the origin");
    assert.equal(ported.rom_run_frame_due(0, 60), 1, "60 frames are due one second after the origin");
    assert.equal(ported.rom_run_frame_due(5, 120), 7, "the schedule is offset by the origin");
    assert.equal(ported.ROM_RUN_FRAME_RATE_CAP, 60, "the cap is 60 frames per second");
});

test("rom_run_is_behind is 1 only when the console is past its due time", () => {
    assert.equal(ported.rom_run_is_behind(1.0, 1.1), 0, "early is not behind");
    assert.equal(ported.rom_run_is_behind(1.1, 1.1), 0, "exactly on time is not behind");
    assert.equal(ported.rom_run_is_behind(1.2, 1.1), 1, "late is behind");
});
