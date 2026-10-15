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

interface SharedVector {
    readonly id: number;
    readonly operation: number;
    readonly input: readonly number[];
    readonly expected: readonly number[];
}

interface SharedVectorSuite {
    readonly id: number;
    readonly name: string;
    readonly vectors: readonly SharedVector[];
}

interface SharedVectorFixture {
    readonly schema_version: number;
    readonly suites: readonly SharedVectorSuite[];
}

const FIXTURE_PATH = new URL("./fixtures/goboscript/shared_port_vectors.json", import.meta.url);
const GENERATOR_PATH = fileURLToPath(
    new URL("../scripts/generate_goboscript_shared_port_vectors.mjs", import.meta.url),
);
const fixture_text = readFileSync(FIXTURE_PATH, "utf8");
const fixture = JSON.parse(fixture_text) as SharedVectorFixture;

function get_suite(name: string): SharedVectorSuite {
    const suite = fixture.suites.find((candidate) => candidate.name === name);
    assert.ok(suite, `Missing shared vector suite ${name}.`);
    return suite;
}

function for_each_vector(suite_name: string, run: (vector: SharedVector) => void): void {
    for (const vector of get_suite(suite_name).vectors) {
        test(`shared ${suite_name} vector ${vector.id}`, () => run(vector));
    }
}

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
    assert.equal(vector.operation, 1, "Bus vector operation 1 replays CPU read/write triples.");
    const [operation_count, ...operations] = vector.input;
    assert.ok(operation_count !== undefined);
    assert.equal(operations.length, operation_count * 3);

    const bus = new NesCpuBus(make_empty_bus_devices());
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
