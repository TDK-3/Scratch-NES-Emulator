import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Apu2A03 } from "../src/nes/apu/apu_2a03.js";
import { parse_ines_rom } from "../src/nes/cartridge/ines.js";
import { Mmc3Mapper } from "../src/nes/cartridge/mapper_004.js";
import { Cpu2A03 } from "../src/nes/cpu/cpu_2a03.js";
import type { NesCpuBusDevices } from "../src/nes/cpu/nes_cpu_bus.js";
import { NesCpuBus } from "../src/nes/cpu/nes_cpu_bus.js";
import { CPU_OPCODE_TABLE, OFFICIAL_OPCODE_DEFINITIONS } from "../src/nes/cpu/opcode_table.js";
import {
    normalize_byte,
    normalize_status,
    normalize_word,
    pack_status_for_stack,
    to_signed_byte,
    update_zero_negative_flags,
} from "../src/nes/cpu/registers.js";
import { NesControllerPorts } from "../src/nes/input/controller.js";
import { Ppu2C02 } from "../src/nes/ppu/ppu_2c02.js";
import { PpuMemoryBus } from "../src/nes/ppu/ppu_bus.js";
import { FakeCpuBus } from "./support/FakeCpuBus.js";
import { CARTRIDGE_HEADER_BYTES, project_cartridge_header } from "./support/cartridge_projection.js";
import {
    CPU_ADDRESSING_FIXED_INPUT_COUNT,
    CPU_ADDRESSING_FIXED_VALUE_COUNT,
    CPU_ADDRESSING_MODES,
    CPU_OPERAND_ACCESSES,
    project_cpu_addressing,
    type CpuAddressingSetup,
} from "./support/cpu_addressing_projection.js";
import {
    CPU_INSTRUCTION_ERROR_IDS,
    CPU_INSTRUCTION_FIXED_INPUT_COUNT,
    CPU_INSTRUCTION_FIXED_VALUE_COUNT,
    CPU_INSTRUCTION_PORTED_MNEMONICS,
    project_cpu_instruction,
    type CpuInstructionSetup,
} from "./support/cpu_instruction_projection.js";
import {
    CPU_CONTROL_FIXED_INPUT_COUNT,
    CPU_CONTROL_FIXED_VALUE_COUNT,
    CPU_CONTROL_SEQUENCE_KINDS,
    project_cpu_control,
    type CpuControlSetup,
} from "./support/cpu_control_projection.js";
import { cpu_mnemonic_ids, is_official_opcode, project_opcode_decode } from "./support/cpu_opcode_projection.js";
import {
    CPU_SEQUENCE_FIXED_INPUT_COUNT,
    CPU_SEQUENCE_FIXED_VALUE_COUNT,
    project_cpu_sequence,
    type CpuSequenceSetup,
} from "./support/cpu_sequence_projection.js";
import {
    for_each_vector,
    shared_port_fixture as fixture,
    shared_port_fixture_text as fixture_text,
} from "./support/shared_port_vectors.js";

const FIXTURE_PATH = new URL("./fixtures/goboscript/shared_port_vectors.json", import.meta.url);
const GENERATOR_PATH = fileURLToPath(
    new URL("../scripts/generate_goboscript_shared_port_vectors.mjs", import.meta.url),
);

test("generates the canonical shared vectors as a numeric GoboScript list", () => {
    const temporary_directory = mkdtempSync(join(tmpdir(), "goboscript-vectors-"));
    const output_path = join(temporary_directory, "shared_port_vectors.txt");

    try {
        const result = spawnSync(process.execPath, [GENERATOR_PATH, "--output", output_path], {
            encoding: "utf8",
            timeout: 5_000,
        });

        assert.equal(result.error, undefined, result.error?.message);
        assert.equal(result.status, 0, result.stderr);

        const actual = readFileSync(output_path, "ascii").trimEnd().split("\n").map(Number);
        const vector_count = fixture.suites.reduce((count, suite) => count + suite.vectors.length, 0);
        const expected = [fixture.schema_version, vector_count];

        for (const suite of fixture.suites) {
            for (const vector of suite.vectors) {
                expected.push(
                    suite.id,
                    vector.id,
                    vector.operation,
                    vector.input.length,
                    vector.expected.length,
                    ...vector.input,
                    ...vector.expected,
                );
            }
        }

        assert.deepEqual(actual, expected);

        const overwrite_result = spawnSync(
            process.execPath,
            [GENERATOR_PATH, "--output", fileURLToPath(FIXTURE_PATH)],
            { encoding: "utf8", timeout: 5_000 },
        );
        assert.equal(overwrite_result.status, 1);
        assert.match(overwrite_result.stderr, /must not overwrite the canonical vector fixture/);
        assert.equal(readFileSync(FIXTURE_PATH, "utf8"), fixture_text);

        const fixture_alias_path = join(temporary_directory, "fixture-alias.json");
        symlinkSync(fileURLToPath(FIXTURE_PATH), fixture_alias_path);
        const alias_result = spawnSync(
            process.execPath,
            [GENERATOR_PATH, "--output", fixture_alias_path],
            { encoding: "utf8", timeout: 5_000 },
        );

        assert.equal(alias_result.status, 1);
        assert.match(alias_result.stderr, /must not overwrite the canonical vector fixture/);
        assert.equal(readFileSync(FIXTURE_PATH, "utf8"), fixture_text);

        const fixture_hardlink_path = join(temporary_directory, "fixture-hardlink.json");
        linkSync(fileURLToPath(FIXTURE_PATH), fixture_hardlink_path);
        const hardlink_result = spawnSync(
            process.execPath,
            [GENERATOR_PATH, "--output", fixture_hardlink_path],
            { encoding: "utf8", timeout: 5_000 },
        );

        assert.equal(hardlink_result.status, 1);
        assert.match(hardlink_result.stderr, /must not overwrite the canonical vector fixture/);
        assert.equal(readFileSync(FIXTURE_PATH, "utf8"), fixture_text);
    } finally {
        rmSync(temporary_directory, { recursive: true, force: true });
    }
});

for_each_vector("numeric", (vector) => {
    const [value, second_value] = vector.input;
    let actual: number;

    switch (vector.operation) {
        case 1:
            actual = normalize_byte(value ?? 0);
            break;
        case 2:
            actual = normalize_word(value ?? 0);
            break;
        case 3:
            actual = to_signed_byte(value ?? 0);
            break;
        case 4:
            actual = normalize_status(value ?? 0);
            break;
        case 5:
            actual = pack_status_for_stack(value ?? 0, "brk");
            break;
        case 6:
            actual = update_zero_negative_flags(value ?? 0, second_value ?? 0);
            break;
        // Operations 7 through 13 pin the arithmetic bit helpers that scratch/src/numeric.gs
        // needs because GoboScript has no bitwise operators. The reference here is the native
        // expression; tests/goboscript-port-algorithms.test.ts proves the ported algorithms
        // reproduce it exhaustively.
        case 7:
            assert.ok(is_power_of_two(second_value ?? 0), "bit_at expects a power-of-two weight.");
            actual = Number((normalize_word(value ?? 0) & normalize_word(second_value ?? 0)) !== 0);
            break;
        case 8:
            actual = normalize_word(value ?? 0) & normalize_word(second_value ?? 0);
            break;
        case 9:
            actual = normalize_word(value ?? 0) | normalize_word(second_value ?? 0);
            break;
        case 10:
            actual = normalize_word(value ?? 0) ^ normalize_word(second_value ?? 0);
            break;
        case 11:
            actual = normalize_word(value ?? 0) >>> 8;
            break;
        case 12:
            actual = normalize_word(value ?? 0) & 0xff;
            break;
        case 13:
            actual = (normalize_byte(value ?? 0) << 8) | normalize_byte(second_value ?? 0);
            break;
        default:
            assert.fail(`Unsupported numeric vector operation ${vector.operation}.`);
    }

    assert.deepEqual([actual], vector.expected);
});

for_each_vector("cpu", (vector) => {
    assert.equal(vector.operation, 1, "CPU vector operation 1 executes one instruction.");
    const [program_counter, a, x, y, stack_pointer, status, program_length, ...program_and_probe] = vector.input;
    const program = program_and_probe.slice(0, program_length ?? 0);
    const probe_address = program_and_probe[program_length ?? 0];

    assert.ok(program_counter !== undefined && a !== undefined && x !== undefined && y !== undefined);
    assert.ok(stack_pointer !== undefined && status !== undefined && probe_address !== undefined);
    assert.equal(program.length, program_length);

    const bus = new FakeCpuBus();
    bus.load(program_counter, Uint8Array.from(program));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = program_counter;
    cpu.a = a;
    cpu.x = x;
    cpu.y = y;
    cpu.stack_pointer = stack_pointer;
    cpu.status = status;

    const cycles = cpu.step();
    const actual = [
        cycles,
        cpu.program_counter,
        cpu.a,
        cpu.x,
        cpu.y,
        cpu.stack_pointer,
        cpu.status,
        bus.peek(probe_address),
    ];

    assert.deepEqual(actual, vector.expected);
});

for_each_vector("bus", (vector) => {
    const [operation_count, ...operations] = vector.input;
    assert.ok(operation_count !== undefined);
    assert.equal(operations.length, operation_count * 3);

    let devices: NesCpuBusDevices;

    if (vector.operation === 1) {
        devices = make_empty_bus_devices();

        // Operation 1 replays with no devices attached. The GoboScript port always has live
        // controller ports, so these records must not read $4016/$4017.
        for (let operation_index = 0; operation_index < operation_count; operation_index += 1) {
            const kind = operations[operation_index * 3];
            const address = operations[operation_index * 3 + 1];
            assert.ok(
                !(kind === 0 && (address === 0x4016 || address === 0x4017)),
                "Bus vector operation 1 must not read the controller ports.",
            );
        }
    } else {
        assert.equal(vector.operation, 2, "Bus vector operation 2 replays with live controller ports.");
        devices = make_controller_bus_devices();
    }

    const bus = new NesCpuBus(devices);
    const read_values: number[] = [];

    for (let operation_index = 0; operation_index < operation_count; operation_index += 1) {
        const offset = operation_index * 3;
        const kind = operations[offset];
        const address = operations[offset + 1];
        const value = operations[offset + 2];

        assert.ok(kind !== undefined && address !== undefined && value !== undefined);

        if (kind === 1) {
            bus.write_cpu(address, value);
        } else {
            assert.equal(kind, 0);
            read_values.push(bus.read_cpu(address));
        }
    }

    assert.deepEqual([read_values.length, ...read_values], vector.expected);
});

for_each_vector("alu", (vector) => {
    const [first_input, second_input, third_input] = vector.input;
    assert.ok(first_input !== undefined, "ALU vectors always supply at least one operand.");

    let actual: number[];

    switch (vector.operation) {
        case 1:
            actual = run_accumulator_operand_instruction(0x69, first_input, second_input, third_input);
            break;
        case 2:
            actual = run_accumulator_operand_instruction(0xe9, first_input, second_input, third_input);
            break;
        case 3:
            actual = run_accumulator_operand_instruction(0x29, first_input, second_input, third_input);
            break;
        case 4:
            actual = run_accumulator_operand_instruction(0x09, first_input, second_input, third_input);
            break;
        case 5:
            actual = run_accumulator_operand_instruction(0x49, first_input, second_input, third_input);
            break;
        case 6:
            actual = run_accumulator_only_instruction(0x0a, first_input, second_input);
            break;
        case 7:
            actual = run_accumulator_only_instruction(0x4a, first_input, second_input);
            break;
        case 8:
            actual = run_accumulator_only_instruction(0x2a, first_input, second_input);
            break;
        case 9:
            actual = run_accumulator_only_instruction(0x6a, first_input, second_input);
            break;
        case 10:
            actual = run_register_compare_instruction(0xc9, "a", first_input, second_input, third_input);
            break;
        case 11:
            actual = run_register_compare_instruction(0xe0, "x", first_input, second_input, third_input);
            break;
        case 12:
            actual = run_register_compare_instruction(0xc0, "y", first_input, second_input, third_input);
            break;
        case 13: {
            assert.ok(second_input !== undefined && third_input !== undefined);
            const cpu = run_cpu_program(
                [0x24, ALU_ZERO_PAGE_ADDRESS],
                { a: first_input, x: 0, y: 0, status: third_input },
                [second_input],
            );
            actual = [cpu.a, cpu.status];
            break;
        }
        case 14:
            actual = run_zero_page_read_modify_write(0xe6, first_input, second_input);
            break;
        case 15:
            actual = run_zero_page_read_modify_write(0xc6, first_input, second_input);
            break;
        default:
            assert.fail(`Unsupported ALU vector operation ${vector.operation}.`);
    }

    assert.deepEqual(actual, [...vector.expected]);
});

for_each_vector("mapper", (vector) => {
    const mapper = create_test_mmc3_mapper();

    if (vector.operation === 1) {
        assert.equal(vector.input.length % 2, 0);

        for (let index = 0; index < vector.input.length; index += 2) {
            const register = vector.input[index];
            const value = vector.input[index + 1];
            assert.ok(register !== undefined && value !== undefined);
            mapper.write_cpu(0x8000, register);
            mapper.write_cpu(0x8001, value);
        }

        assert.deepEqual(
            [0x8000, 0xa000, 0xc000, 0xe000].map((address) => {
                const read = mapper.read_cpu(address, 0);
                assert.ok(read);
                return read.value;
            }),
            vector.expected,
        );
        return;
    }

    assert.equal(vector.operation, 2, "Mapper vector operation 2 clocks filtered MMC3 A12 IRQs.");
    const [irq_latch, low_dot_count] = vector.input;
    assert.ok(irq_latch !== undefined && low_dot_count !== undefined);
    mapper.write_cpu(0xc000, irq_latch);
    mapper.write_cpu(0xc001, 0);
    mapper.write_cpu(0xe001, 0);

    const ppu_bus = new PpuMemoryBus(mapper);
    const irq_states = [
        clock_mmc3_a12_rise(mapper, ppu_bus, low_dot_count),
        clock_mmc3_a12_rise(mapper, ppu_bus, low_dot_count),
    ];

    assert.deepEqual(irq_states, vector.expected);
});

for_each_vector("ppu", (vector) => {
    assert.equal(vector.operation, 1, "PPU vector operation 1 clocks the scheduled vblank NMI edge.");
    const [control, dots_before_event] = vector.input;
    assert.ok(control !== undefined && dots_before_event !== undefined);

    const ppu = new Ppu2C02(new PpuMemoryBus(make_empty_ppu_mapper()));
    ppu.write_cpu_register(0, control);

    for (let dot = 0; dot < dots_before_event; dot += 1) {
        ppu.clock_ppu_dot();
    }

    const actual = [
        ppu.get_status_register(),
        Number(ppu.take_nmi_edge()),
        Number(ppu.take_nmi_edge()),
    ];

    assert.deepEqual(actual, vector.expected);
});

for_each_vector("apu", (vector) => {
    assert.equal(vector.operation, 1, "APU vector operation 1 applies register-write pairs.");
    const [write_count, ...writes] = vector.input;
    assert.ok(write_count !== undefined);
    assert.equal(writes.length, write_count * 2);

    const apu = new Apu2A03();

    for (let write_index = 0; write_index < write_count; write_index += 1) {
        const address = writes[write_index * 2];
        const value = writes[write_index * 2 + 1];
        assert.ok(address !== undefined && value !== undefined);
        apu.write_register(address, value);
    }

    const status = apu.read_status(0);
    assert.ok(status);
    assert.deepEqual([status.value, apu.get_pulse_output(1), apu.get_pulse_length_counter(1)], vector.expected);
});

for_each_vector("controller", (vector) => {
    assert.equal(vector.operation, 1, "Controller vector operation 1 latches a button mask and reads a port.");
    const [controller_index, button_mask, read_count] = vector.input;
    assert.ok(controller_index !== undefined && button_mask !== undefined && read_count !== undefined);
    assert.ok(controller_index === 0 || controller_index === 1);

    const controllers = new NesControllerPorts();
    controllers.set_button_mask(controller_index, button_mask);
    controllers.write_strobe(1);
    controllers.write_strobe(0);
    const actual = Array.from({ length: read_count }, () => {
        const read = controllers.read_controller(controller_index, 0);
        assert.ok(read);
        return read.value;
    });

    assert.deepEqual(actual, vector.expected);
});

for_each_vector("cartridge", (vector) => {
    assert.equal(vector.operation, 1, "Cartridge vector operation 1 parses one header against an image length.");
    assert.equal(vector.input.length, CARTRIDGE_HEADER_BYTES + 1, "Cartridge vectors supply a complete header.");

    const [image_bytes] = vector.input;
    assert.ok(image_bytes !== undefined, "The first cartridge input is the ROM image length in bytes.");

    const actual = project_cartridge_header(image_bytes, vector.input.slice(1));
    assert.deepEqual(actual, [...vector.expected]);
});

for_each_vector("cpu_addressing", (vector) => {
    const mode_id = vector.operation;
    const [access_id, program_counter, accumulator, x, y, stack_pointer, status, setup_count] = vector.input;
    assert.ok(
        access_id !== undefined &&
            program_counter !== undefined &&
            accumulator !== undefined &&
            x !== undefined &&
            y !== undefined &&
            stack_pointer !== undefined &&
            status !== undefined &&
            setup_count !== undefined,
        "Addressing vectors supply the access, all six registers, and a setup count.",
    );
    assert.equal(vector.input.length, CPU_ADDRESSING_FIXED_INPUT_COUNT + setup_count * 2);

    const setup: CpuAddressingSetup[] = [];

    for (let index = 0; index < setup_count; index += 1) {
        const address = vector.input[CPU_ADDRESSING_FIXED_INPUT_COUNT + index * 2];
        const value = vector.input[CPU_ADDRESSING_FIXED_INPUT_COUNT + index * 2 + 1];
        assert.ok(address !== undefined && value !== undefined, `Setup pair ${index} is complete.`);
        setup.push({ address, value });
    }

    const actual = project_cpu_addressing(
        mode_id,
        access_id,
        program_counter,
        accumulator,
        x,
        y,
        stack_pointer,
        status,
        setup,
    );
    assert.deepEqual(actual, [...vector.expected]);

    // The ported decoder always has live controller ports, so no record may touch $4000-$401F.
    for (let offset = CPU_ADDRESSING_FIXED_VALUE_COUNT; offset < actual.length; offset += 3) {
        const address = actual[offset + 1] ?? 0;
        assert.ok(address < 0x4000 || address > 0x401f, `Access at $${address.toString(16)} is controller space.`);
    }
});

for_each_vector("cpu_sequence", (vector) => {
    const operation_id = vector.operation;
    const [program_counter, accumulator, x, y, stack_pointer, status, taken, setup_count] = vector.input;
    assert.ok(
        program_counter !== undefined &&
            accumulator !== undefined &&
            x !== undefined &&
            y !== undefined &&
            stack_pointer !== undefined &&
            status !== undefined &&
            taken !== undefined &&
            setup_count !== undefined,
        "Sequence vectors supply all six registers, the taken flag, and a setup count.",
    );
    assert.equal(vector.input.length, CPU_SEQUENCE_FIXED_INPUT_COUNT + setup_count * 2);

    const setup: CpuSequenceSetup[] = [];

    for (let index = 0; index < setup_count; index += 1) {
        const address = vector.input[CPU_SEQUENCE_FIXED_INPUT_COUNT + index * 2];
        const value = vector.input[CPU_SEQUENCE_FIXED_INPUT_COUNT + index * 2 + 1];
        assert.ok(address !== undefined && value !== undefined, `Setup pair ${index} is complete.`);
        setup.push({ address, value });
    }

    const actual = project_cpu_sequence(
        operation_id,
        program_counter,
        accumulator,
        x,
        y,
        stack_pointer,
        status,
        taken,
        setup,
    );
    assert.deepEqual(actual, [...vector.expected]);
    assert.equal(actual[0], (actual.length - CPU_SEQUENCE_FIXED_VALUE_COUNT) / 3, "one cycle per bus access");

    // The ported decoder always has live controller ports, so no record may touch $4000-$401F.
    for (let offset = CPU_SEQUENCE_FIXED_VALUE_COUNT; offset < actual.length; offset += 3) {
        const address = actual[offset + 1] ?? 0;
        assert.ok(address < 0x4000 || address > 0x401f, `Access at $${address.toString(16)} is controller space.`);
    }
});

for_each_vector("cpu_opcode", (vector) => {
    assert.equal(vector.operation, 1, "Opcode decoding has a single operation.");
    assert.equal(vector.input.length, 1, "An opcode vector supplies exactly one opcode byte.");
    const opcode = vector.input[0];
    assert.ok(opcode !== undefined, "The opcode byte is present.");

    const actual = project_opcode_decode(opcode);
    assert.deepEqual(actual, [...vector.expected]);

    // Cross-check the projected integers against the production table so a fixture that drifted
    // from src/nes/cpu/opcode_table.ts cannot pass by matching a stale projection.
    const definition = CPU_OPCODE_TABLE.get(opcode);
    assert.ok(definition !== undefined, `Opcode $${opcode.toString(16)} is defined.`);
    assert.equal(cpu_mnemonic_ids().get(definition.mnemonic), actual[0], "The mnemonic id names the instruction.");
    assert.equal(
        CPU_ADDRESSING_MODES.find((mode) => mode.id === actual[1])?.name,
        definition.addressing_mode,
        "The addressing mode id names the mode.",
    );
    assert.equal(actual[2], definition.base_cycles, "The base cycles match.");
    assert.equal(
        CPU_OPERAND_ACCESSES.find((access) => access.id === actual[3])?.name,
        definition.operand_access,
        "The operand access id names the access.",
    );
    assert.equal(actual[4], definition.page_cross_cycle ? 1 : 0, "The page-cross cycle flag matches.");
    assert.equal(
        actual[5],
        OFFICIAL_OPCODE_DEFINITIONS.some((entry) => entry.opcode === opcode) ? 1 : 0,
        "The official flag matches.",
    );
    assert.equal(actual[6], 0, "Decoding a defined opcode reports no error.");
});

for_each_vector("cpu_instruction", (vector) => {
    assert.equal(vector.operation, 1, "Instruction vectors have a single operation.");
    const [program_counter, accumulator, x, y, stack_pointer, status, program_count, setup_count] = vector.input;
    assert.ok(
        program_counter !== undefined &&
            accumulator !== undefined &&
            x !== undefined &&
            y !== undefined &&
            stack_pointer !== undefined &&
            status !== undefined &&
            program_count !== undefined &&
            setup_count !== undefined,
        "Instruction vectors supply all six registers, a program count, and a setup count.",
    );
    assert.equal(vector.input.length, CPU_INSTRUCTION_FIXED_INPUT_COUNT + program_count + setup_count * 2);

    const program: number[] = [];

    for (let index = 0; index < program_count; index += 1) {
        const byte = vector.input[CPU_INSTRUCTION_FIXED_INPUT_COUNT + index];
        assert.ok(byte !== undefined, `Program byte ${index} is present.`);
        program.push(byte);
    }

    const setup: CpuInstructionSetup[] = [];

    for (let index = 0; index < setup_count; index += 1) {
        const address = vector.input[CPU_INSTRUCTION_FIXED_INPUT_COUNT + program_count + index * 2];
        const value = vector.input[CPU_INSTRUCTION_FIXED_INPUT_COUNT + program_count + index * 2 + 1];
        assert.ok(address !== undefined && value !== undefined, `Setup pair ${index} is complete.`);
        setup.push({ address, value });
    }

    // The refusal a record documents is derived here from the production table and the ported
    // mnemonic set, never copied out of the expected values, and the projection re-checks it.
    const opcode = program[0] ?? 0;
    const mnemonic = CPU_OPCODE_TABLE.get(opcode)?.mnemonic ?? "";
    const ported_mnemonic = CPU_INSTRUCTION_PORTED_MNEMONICS.includes(mnemonic);
    const refusal = ported_mnemonic
        ? CPU_INSTRUCTION_ERROR_IDS.none
        : is_official_opcode(opcode)
          ? CPU_INSTRUCTION_ERROR_IDS.unsupported_mnemonic
          : CPU_INSTRUCTION_ERROR_IDS.unofficial_opcode;

    const actual = project_cpu_instruction(
        program_counter,
        accumulator,
        x,
        y,
        stack_pointer,
        status,
        program,
        setup,
        refusal,
    );
    assert.deepEqual(actual, [...vector.expected]);
    assert.equal(actual[0], (actual.length - CPU_INSTRUCTION_FIXED_VALUE_COUNT) / 3, "one cycle per bus access");
    assert.ok(Number.isInteger(actual[1]) && (actual[1] ?? 0) >= 0 && (actual[1] ?? 0) <= 0xffff, "final PC is a word");

    if (!ported_mnemonic) {
        // A refused instruction spends only its opcode fetch and reads that byte.
        assert.equal(actual[0], 1, "a refused instruction spends one cycle");
        assert.deepEqual(actual.slice(CPU_INSTRUCTION_FIXED_VALUE_COUNT), [0, program_counter, opcode]);
    }
});

for_each_vector("cpu_control", (vector) => {
    assert.equal(vector.operation, 1, "Control vectors have a single operation.");
    const [
        program_counter,
        accumulator,
        x,
        y,
        stack_pointer,
        status,
        nmi_pending,
        irq_line,
        step_count,
        nmi_request_step,
        irq_assert_step,
        program_count,
        setup_count,
    ] = vector.input;
    assert.ok(
        program_counter !== undefined &&
            accumulator !== undefined &&
            x !== undefined &&
            y !== undefined &&
            stack_pointer !== undefined &&
            status !== undefined &&
            nmi_pending !== undefined &&
            irq_line !== undefined &&
            step_count !== undefined &&
            nmi_request_step !== undefined &&
            irq_assert_step !== undefined &&
            program_count !== undefined &&
            setup_count !== undefined,
        "Control vectors supply all six registers, both interrupt inputs, and the step schedule.",
    );
    assert.ok(step_count >= 1, "A control record runs at least one step.");
    assert.equal(vector.input.length, CPU_CONTROL_FIXED_INPUT_COUNT + program_count + setup_count * 2);

    const program: number[] = [];

    for (let index = 0; index < program_count; index += 1) {
        const byte = vector.input[CPU_CONTROL_FIXED_INPUT_COUNT + index];
        assert.ok(byte !== undefined, `Program byte ${index} is present.`);
        program.push(byte);
    }

    const setup: CpuControlSetup[] = [];

    for (let index = 0; index < setup_count; index += 1) {
        const address = vector.input[CPU_CONTROL_FIXED_INPUT_COUNT + program_count + index * 2];
        const value = vector.input[CPU_CONTROL_FIXED_INPUT_COUNT + program_count + index * 2 + 1];
        assert.ok(address !== undefined && value !== undefined, `Setup pair ${index} is complete.`);
        setup.push({ address, value });
    }

    const actual = project_cpu_control(
        program_counter,
        accumulator,
        x,
        y,
        stack_pointer,
        status,
        nmi_pending,
        irq_line,
        step_count,
        nmi_request_step,
        irq_assert_step,
        program,
        setup,
    );
    assert.deepEqual(actual, [...vector.expected]);

    const cycles = actual[0] ?? 0;
    const kinds = actual.slice(CPU_CONTROL_FIXED_VALUE_COUNT, CPU_CONTROL_FIXED_VALUE_COUNT + step_count);
    assert.equal(actual.length, CPU_CONTROL_FIXED_VALUE_COUNT + step_count + cycles * 3, "one triple per cycle");
    assert.equal(kinds.length, step_count, "one sequence kind per step");

    for (const kind of kinds) {
        assert.ok(
            CPU_CONTROL_SEQUENCE_KINDS.some((entry) => entry.id === kind),
            `Sequence kind ${kind} is a ported id.`,
        );
    }

    // The control loop never selects reset, and a jam is sticky: once the CPU jams, every later
    // sequence is another jam.
    const reset_id = CPU_CONTROL_SEQUENCE_KINDS.find((entry) => entry.name === "reset")?.id ?? 0;
    assert.ok(!kinds.includes(reset_id), "reset is reached through request_reset, not the poll");

    const jam_id = CPU_CONTROL_SEQUENCE_KINDS.find((entry) => entry.name === "jam")?.id ?? 0;
    const first_jam = kinds.indexOf(jam_id);

    if (first_jam >= 0) {
        assert.ok(
            kinds.slice(first_jam).every((kind) => kind === jam_id),
            "a jammed CPU keeps jamming",
        );
    }
});

const ALU_PROGRAM_ADDRESS = 0x8000;
const ALU_ZERO_PAGE_ADDRESS = 0x10;

interface AluRegisters {
    readonly a: number;
    readonly x: number;
    readonly y: number;
    readonly status: number;
}

/** Runs one instruction on the production CPU and returns it together with its bus. */
function run_cpu_program(
    program: readonly number[],
    registers: AluRegisters,
    zero_page: readonly number[] = [],
): Cpu2A03 {
    const bus = new FakeCpuBus();
    bus.load(ALU_PROGRAM_ADDRESS, Uint8Array.from(program));

    for (let index = 0; index < zero_page.length; index += 1) {
        bus.write_cpu(ALU_ZERO_PAGE_ADDRESS + index, zero_page[index] ?? 0);
    }

    const cpu = new Cpu2A03(bus);
    cpu.program_counter = ALU_PROGRAM_ADDRESS;
    cpu.a = registers.a;
    cpu.x = registers.x;
    cpu.y = registers.y;
    cpu.stack_pointer = 0xfd;
    cpu.status = registers.status;
    cpu.step();
    return cpu;
}

function assert_alu_status(status: number | undefined): number {
    assert.ok(status !== undefined, "ALU vectors that change flags supply an input status byte.");
    return status;
}

/** Immediate ALU instructions of the form "$opcode operand" that update the accumulator. */
function run_accumulator_operand_instruction(
    opcode: number,
    accumulator: number,
    operand: number | undefined,
    status: number | undefined,
): number[] {
    assert.ok(operand !== undefined, "This ALU vector supplies an immediate operand.");
    const cpu = run_cpu_program(
        [opcode, operand],
        { a: accumulator, x: 0, y: 0, status: assert_alu_status(status) },
    );
    return [cpu.a, cpu.status];
}

/** Accumulator-mode shift and rotate instructions of the form "$opcode". */
function run_accumulator_only_instruction(opcode: number, accumulator: number, status: number | undefined): number[] {
    const cpu = run_cpu_program([opcode], {
        a: accumulator,
        x: 0,
        y: 0,
        status: assert_alu_status(status),
    });
    return [cpu.a, cpu.status];
}

/** CMP, CPX, and CPY: the compared register must come back unchanged. */
function run_register_compare_instruction(
    opcode: number,
    register: "a" | "x" | "y",
    register_value: number,
    operand: number | undefined,
    status: number | undefined,
): number[] {
    assert.ok(operand !== undefined, "This ALU vector supplies an immediate operand.");
    const cpu = run_cpu_program(
        [opcode, operand],
        {
            a: register === "a" ? register_value : 0,
            x: register === "x" ? register_value : 0,
            y: register === "y" ? register_value : 0,
            status: assert_alu_status(status),
        },
    );
    return [cpu[register], cpu.status];
}

/** INC/DEC $10: the expected value is the zero-page byte after the instruction. */
function run_zero_page_read_modify_write(opcode: number, operand: number, status: number | undefined): number[] {
    const bus = new FakeCpuBus();
    bus.load(ALU_PROGRAM_ADDRESS, Uint8Array.from([opcode, ALU_ZERO_PAGE_ADDRESS]));
    bus.write_cpu(ALU_ZERO_PAGE_ADDRESS, operand);

    const cpu = new Cpu2A03(bus);
    cpu.program_counter = ALU_PROGRAM_ADDRESS;
    cpu.stack_pointer = 0xfd;
    cpu.status = assert_alu_status(status);
    cpu.step();
    return [bus.peek(ALU_ZERO_PAGE_ADDRESS), cpu.status];
}

function is_power_of_two(value: number): boolean {
    return value > 0 && (value & (value - 1)) === 0;
}

function make_controller_bus_devices(): NesCpuBusDevices {
    return { ...make_empty_bus_devices(), controllers: new NesControllerPorts() };
}

function make_empty_bus_devices(): NesCpuBusDevices {
    return {
        ppu: {
            read_cpu_register: () => null,
            write_cpu_register: () => {},
        },
        apu: {
            read_status: () => null,
            write_register: () => {},
        },
        controllers: {
            read_controller: () => null,
            write_strobe: () => {},
        },
        cartridge: {
            read_cpu: () => null,
            write_cpu: () => {},
        },
    };
}

function create_test_mmc3_mapper(): Mmc3Mapper {
    const prg_bank_count = 8;
    const prg_bank_bytes = 0x2000;
    const header_bytes = 16;
    const prg_rom_bytes = prg_bank_count * prg_bank_bytes;
    const chr_rom_bytes = 0x2000;
    const image = new Uint8Array(header_bytes + prg_rom_bytes + chr_rom_bytes);
    image.set([0x4e, 0x45, 0x53, 0x1a, 4, 1, 0x40, 0]);

    for (let bank = 0; bank < prg_bank_count; bank += 1) {
        image.fill(bank + 1, header_bytes + bank * prg_bank_bytes, header_bytes + (bank + 1) * prg_bank_bytes);
    }

    const parsed = parse_ines_rom(image);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.error.message);
    const created = Mmc3Mapper.create(parsed.value);
    assert.ok(created.ok, created.ok ? "" : created.error.message);
    return created.value;
}

function clock_mmc3_a12_rise(mapper: Mmc3Mapper, ppu_bus: PpuMemoryBus, low_dot_count: number): number {
    ppu_bus.read_ppu(0x0000);

    for (let dot = 0; dot < low_dot_count; dot += 1) {
        ppu_bus.clock_ppu_dot();
    }

    ppu_bus.read_ppu(0x1000);
    const irq_asserted = Number(mapper.get_irq_line_asserted());
    ppu_bus.read_ppu(0x0000);
    return irq_asserted;
}

function make_empty_ppu_mapper() {
    return {
        read_pattern: () => 0,
        write_pattern: () => {},
        observe_ppu_access: () => {},
        clock_ppu_dot: () => {},
        get_nametable_mirroring: () => "vertical" as const,
    };
}
