import assert from "node:assert/strict";
import test from "node:test";

import { Cpu2A03, DEFAULT_UNSTABLE_OPCODE_MAGIC_VALUE } from "../src/nes/cpu/cpu_2a03.js";
import {
    CPU_OPCODE_TABLE,
    OFFICIAL_OPCODE_DEFINITIONS,
    UNOFFICIAL_OPCODE_DEFINITIONS,
} from "../src/nes/cpu/opcode_table.js";
import type { CpuDmaCycle } from "../src/nes/cpu/cpu_bus.js";
import type { CpuStatusFlag } from "../src/nes/cpu/registers.js";
import {
    BREAK_FLAG,
    CARRY_FLAG,
    DECIMAL_FLAG,
    INTERRUPT_DISABLE_FLAG,
    NEGATIVE_FLAG,
    OVERFLOW_FLAG,
    UNUSED_FLAG,
    ZERO_FLAG,
    has_status_flag,
    set_status_flag,
} from "../src/nes/cpu/registers.js";
import { FakeCpuBus } from "./support/FakeCpuBus.js";

const unofficial_nop_definitions = UNOFFICIAL_OPCODE_DEFINITIONS.filter(({ mnemonic }) => mnemonic === "NOP");
const unofficial_rmw_definitions = UNOFFICIAL_OPCODE_DEFINITIONS.filter(
    ({ operand_access }) => operand_access === "read_modify_write",
);

class DmcStallFakeCpuBus extends FakeCpuBus {
    readonly #trigger_address: number;
    #started = false;
    #sequence_cycle = 0;

    constructor(trigger_address: number) {
        super();
        this.#trigger_address = trigger_address;
    }

    clock_cpu_dma_cycle(held_read_address: number): CpuDmaCycle | null {
        if (!this.#started && held_read_address !== this.#trigger_address) {
            return null;
        }

        this.#started = true;

        if (this.#sequence_cycle === 4) {
            return null;
        }

        this.#sequence_cycle += 1;
        const access_address = this.#sequence_cycle === 4 ? 0xc000 : held_read_address;
        const access = {
            kind: "read" as const,
            address: access_address,
            value: this.read_cpu(access_address),
        };

        return {
            dma_kind: "dmc",
            sequence_cycle: this.#sequence_cycle,
            sequence_completed: this.#sequence_cycle === 4,
            access,
        };
    }
}

test("opcode metadata contains 151 official opcodes and implemented unofficial encodings", () => {
    assert.equal(OFFICIAL_OPCODE_DEFINITIONS.length, 151);
    assert.equal(new Set(OFFICIAL_OPCODE_DEFINITIONS.map(({ opcode }) => opcode)).size, 151);
    assert.equal(new Set(OFFICIAL_OPCODE_DEFINITIONS.map(({ mnemonic }) => mnemonic)).size, 56);
    assert.equal(unofficial_nop_definitions.length, 27);
    assert.equal(UNOFFICIAL_OPCODE_DEFINITIONS.length, 105);
    assert.equal(new Set(UNOFFICIAL_OPCODE_DEFINITIONS.map(({ opcode }) => opcode)).size, 105);
    assert.equal(UNOFFICIAL_OPCODE_DEFINITIONS.filter(({ mnemonic }) => mnemonic !== "NOP").length, 78);
    assert.equal(
        UNOFFICIAL_OPCODE_DEFINITIONS.filter(({ operand_access }) => operand_access === "read_modify_write").length,
        42,
    );
    assert.deepEqual(
        UNOFFICIAL_OPCODE_DEFINITIONS.filter(({ mnemonic }) => mnemonic === "LAX" || mnemonic === "SAX")
            .map(({ opcode }) => opcode)
            .sort((left, right) => left - right),
        [0x83, 0x87, 0x8f, 0x97, 0xa3, 0xa7, 0xaf, 0xb3, 0xb7, 0xbf],
    );
    assert.deepEqual(
        UNOFFICIAL_OPCODE_DEFINITIONS.filter(({ opcode }) => [0x0b, 0x2b, 0x4b, 0x6b, 0xcb, 0xeb].includes(opcode))
            .map(({ opcode }) => opcode)
            .sort((left, right) => left - right),
        [0x0b, 0x2b, 0x4b, 0x6b, 0xcb, 0xeb],
    );
    assert.ok(
        UNOFFICIAL_OPCODE_DEFINITIONS.every(
            ({ opcode }) => !OFFICIAL_OPCODE_DEFINITIONS.some((definition) => definition.opcode === opcode),
        ),
    );
    assert.deepEqual(UNOFFICIAL_OPCODE_DEFINITIONS.filter(({ mnemonic }) => mnemonic === "LAS"), [
        {
            opcode: 0xbb,
            mnemonic: "LAS",
            addressing_mode: "absolute_y",
            base_cycles: 4,
            operand_access: "read",
            page_cross_cycle: true,
        },
    ]);
    assert.deepEqual(
        UNOFFICIAL_OPCODE_DEFINITIONS.filter(({ mnemonic }) => mnemonic === "KIL").map(({ opcode }) => opcode),
        [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2],
    );
    assert.deepEqual(
        UNOFFICIAL_OPCODE_DEFINITIONS.filter(({ opcode }) => [0x93, 0x9b, 0x9c, 0x9e, 0x9f].includes(opcode)).map(
            ({ opcode, mnemonic, addressing_mode, base_cycles, operand_access, page_cross_cycle }) => ({
                opcode,
                mnemonic,
                addressing_mode,
                base_cycles,
                operand_access,
                page_cross_cycle,
            }),
        ),
        [
            {
                opcode: 0x93,
                mnemonic: "AHX",
                addressing_mode: "indirect_indexed",
                base_cycles: 6,
                operand_access: "write",
                page_cross_cycle: false,
            },
            {
                opcode: 0x9b,
                mnemonic: "TAS",
                addressing_mode: "absolute_y",
                base_cycles: 5,
                operand_access: "write",
                page_cross_cycle: false,
            },
            {
                opcode: 0x9c,
                mnemonic: "SHY",
                addressing_mode: "absolute_x",
                base_cycles: 5,
                operand_access: "write",
                page_cross_cycle: false,
            },
            {
                opcode: 0x9e,
                mnemonic: "SHX",
                addressing_mode: "absolute_y",
                base_cycles: 5,
                operand_access: "write",
                page_cross_cycle: false,
            },
            {
                opcode: 0x9f,
                mnemonic: "AHX",
                addressing_mode: "absolute_y",
                base_cycles: 5,
                operand_access: "write",
                page_cross_cycle: false,
            },
        ],
    );
    assert.deepEqual(
        UNOFFICIAL_OPCODE_DEFINITIONS.filter(({ opcode }) => opcode === 0x8b || opcode === 0xab).map(
            ({ opcode, mnemonic, addressing_mode, base_cycles, operand_access, page_cross_cycle }) => ({
                opcode,
                mnemonic,
                addressing_mode,
                base_cycles,
                operand_access,
                page_cross_cycle,
            }),
        ),
        [
            {
                opcode: 0x8b,
                mnemonic: "XAA",
                addressing_mode: "immediate",
                base_cycles: 2,
                operand_access: "read",
                page_cross_cycle: false,
            },
            {
                opcode: 0xab,
                mnemonic: "LXA",
                addressing_mode: "immediate",
                base_cycles: 2,
                operand_access: "read",
                page_cross_cycle: false,
            },
        ],
    );
    assert.equal(CPU_OPCODE_TABLE.size, 256);
    assert.deepEqual(
        [...CPU_OPCODE_TABLE.keys()].sort((left, right) => left - right),
        Array.from({ length: 0x100 }, (_, opcode) => opcode),
    );
});

test("every official opcode executes and its bus accesses match its cycle count", () => {
    for (const definition of OFFICIAL_OPCODE_DEFINITIONS) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([definition.opcode, 0, 0, 0, 0]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.status = UNUSED_FLAG;

        const cycles = cpu.step();
        const branch_taken =
            definition.mnemonic === "BCC" ||
            definition.mnemonic === "BNE" ||
            definition.mnemonic === "BPL" ||
            definition.mnemonic === "BVC";
        const expected_cycles =
            definition.base_cycles + (definition.addressing_mode === "relative" && branch_taken ? 1 : 0);
        const description =
            `${definition.mnemonic} opcode $${definition.opcode.toString(16).padStart(2, "0")}`;

        assert.equal(cycles, expected_cycles, description);
        assert.equal(bus.accesses.length, expected_cycles, description);
    }
});

test("executes all stable unofficial NOP variants with documented cycles and no state changes", () => {
    for (const definition of unofficial_nop_definitions) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([definition.opcode, 0x10, 0x20]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = 0xa5;
        cpu.x = 2;
        cpu.y = 3;
        cpu.stack_pointer = 0x83;
        cpu.status = 0xd5;

        const expected_program_counter =
            0x8000 +
            (definition.addressing_mode === "implied"
                ? 1
                : definition.addressing_mode === "absolute" || definition.addressing_mode === "absolute_x"
                  ? 3
                  : 2);
        const cycles = cpu.step();
        const description = `unofficial NOP opcode $${definition.opcode.toString(16).padStart(2, "0")}`;

        assert.equal(cycles, definition.base_cycles, description);
        assert.equal(bus.accesses.length, definition.base_cycles, description);
        assert.ok(bus.accesses.every(({ kind }) => kind === "read"), description);
        assert.deepEqual(
            {
                a: cpu.a,
                x: cpu.x,
                y: cpu.y,
                stack_pointer: cpu.stack_pointer,
                status: cpu.status,
                program_counter: cpu.program_counter,
            },
            {
                a: 0xa5,
                x: 2,
                y: 3,
                stack_pointer: 0x83,
                status: 0xd5,
                program_counter: expected_program_counter,
            },
            description,
        );
    }
});

test("absolute-X unofficial NOPs perform the indexed dummy read and page-cross cycle", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x1c, 0xff, 0x20]));
    bus.load(0x2100, new Uint8Array([0x7e]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.x = 1;

    assert.equal(cpu.step(), 5);
    assert.deepEqual(
        bus.accesses.map(({ kind, address, value }) => [kind, address, value]),
        [
            ["read", 0x8000, 0x1c],
            ["read", 0x8001, 0xff],
            ["read", 0x8002, 0x20],
            ["read", 0x2000, 0],
            ["read", 0x2100, 0x7e],
        ],
    );
});

test("executes stable unofficial immediate ALU opcodes with documented registers and flags", () => {
    const cases = [
        {
            opcode: 0x0b,
            a: 0xf3,
            x: 0x55,
            operand: 0x0f,
            carry_in: false,
            expected_a: 0x03,
            expected_x: 0x55,
            expected_carry: false,
            expected_negative: false,
            expected_zero: false,
            expected_overflow: true,
        },
        {
            opcode: 0x2b,
            a: 0x80,
            x: 0x25,
            operand: 0xff,
            carry_in: false,
            expected_a: 0x80,
            expected_x: 0x25,
            expected_carry: true,
            expected_negative: true,
            expected_zero: false,
            expected_overflow: true,
        },
        {
            opcode: 0x4b,
            a: 0x83,
            x: 0x25,
            operand: 0xff,
            carry_in: false,
            expected_a: 0x41,
            expected_x: 0x25,
            expected_carry: true,
            expected_negative: false,
            expected_zero: false,
            expected_overflow: true,
        },
        {
            opcode: 0x6b,
            a: 0xff,
            x: 0x25,
            operand: 0xff,
            carry_in: true,
            expected_a: 0xff,
            expected_x: 0x25,
            expected_carry: true,
            expected_negative: true,
            expected_zero: false,
            expected_overflow: false,
        },
        {
            opcode: 0x6b,
            a: 0x40,
            x: 0x25,
            operand: 0xff,
            carry_in: false,
            expected_a: 0x20,
            expected_x: 0x25,
            expected_carry: false,
            expected_negative: false,
            expected_zero: false,
            expected_overflow: true,
        },
        {
            opcode: 0xcb,
            a: 0x0f,
            x: 0x05,
            operand: 0x04,
            carry_in: false,
            expected_a: 0x0f,
            expected_x: 0x01,
            expected_carry: true,
            expected_negative: false,
            expected_zero: false,
            expected_overflow: true,
        },
        {
            opcode: 0xcb,
            a: 0x0f,
            x: 0x05,
            operand: 0x06,
            carry_in: false,
            expected_a: 0x0f,
            expected_x: 0xff,
            expected_carry: false,
            expected_negative: true,
            expected_zero: false,
            expected_overflow: true,
        },
        {
            opcode: 0xeb,
            a: 0x10,
            x: 0x25,
            operand: 0x01,
            carry_in: true,
            expected_a: 0x0f,
            expected_x: 0x25,
            expected_carry: true,
            expected_negative: false,
            expected_zero: false,
            expected_overflow: false,
        },
    ];

    for (const example of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([example.opcode, example.operand]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = example.a;
        cpu.x = example.x;
        cpu.y = 0x6c;
        cpu.stack_pointer = 0x83;
        cpu.status = UNUSED_FLAG | DECIMAL_FLAG | OVERFLOW_FLAG;
        cpu.status = set_status_flag(cpu.status, CARRY_FLAG, example.carry_in);

        assert.equal(cpu.step(), 2, `opcode $${example.opcode.toString(16)}`);
        assert.deepEqual(
            {
                a: cpu.a,
                x: cpu.x,
                y: cpu.y,
                stack_pointer: cpu.stack_pointer,
                program_counter: cpu.program_counter,
            },
            {
                a: example.expected_a,
                x: example.expected_x,
                y: 0x6c,
                stack_pointer: 0x83,
                program_counter: 0x8002,
            },
            `opcode $${example.opcode.toString(16)}`,
        );
        assert.equal(has_status_flag(cpu.status, CARRY_FLAG), example.expected_carry);
        assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), example.expected_negative);
        assert.equal(has_status_flag(cpu.status, ZERO_FLAG), example.expected_zero);
        assert.equal(has_status_flag(cpu.status, OVERFLOW_FLAG), example.expected_overflow);
        assert.equal(has_status_flag(cpu.status, DECIMAL_FLAG), true);
        assert.equal(bus.accesses.length, 2);
        assert.deepEqual(bus.accesses.map(({ kind }) => kind), ["read", "read"]);
    }
});

test("unofficial SBC immediate matches official SBC for both carry inputs", () => {
    for (const carry_in of [false, true]) {
        const results = [0xe9, 0xeb].map((opcode) => {
            const bus = new FakeCpuBus();
            bus.load(0x8000, new Uint8Array([opcode, 0x57]));
            const cpu = new Cpu2A03(bus);
            cpu.program_counter = 0x8000;
            cpu.a = 0x31;
            cpu.status = UNUSED_FLAG | DECIMAL_FLAG;
            cpu.status = set_status_flag(cpu.status, CARRY_FLAG, carry_in);

            assert.equal(cpu.step(), 2);

            return { a: cpu.a, status: cpu.status, program_counter: cpu.program_counter };
        });

        assert.deepEqual(results[1], results[0]);
    }
});

test("XAA and LXA use a configurable deterministic approximation for their unstable magic input", () => {
    assert.equal(DEFAULT_UNSTABLE_OPCODE_MAGIC_VALUE, 0xee);

    const cases = [
        { opcode: 0x8b, a: 0x10, x: 0xf3, immediate: 0x5a, expected_a: 0x52, expected_x: 0xf3, negative: false, zero: false },
        { opcode: 0x8b, a: 0x00, x: 0xff, immediate: 0x80, expected_a: 0x80, expected_x: 0xff, negative: true, zero: false },
        { opcode: 0xab, a: 0x10, x: 0x44, immediate: 0x0f, expected_a: 0x0e, expected_x: 0x0e, negative: false, zero: false },
        { opcode: 0xab, a: 0x10, x: 0x44, immediate: 0x01, expected_a: 0x00, expected_x: 0x00, negative: false, zero: true },
    ];

    for (const example of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([example.opcode, example.immediate]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = example.a;
        cpu.x = example.x;
        cpu.stack_pointer = 0x93;
        cpu.status = UNUSED_FLAG | CARRY_FLAG | OVERFLOW_FLAG | DECIMAL_FLAG | INTERRUPT_DISABLE_FLAG;

        assert.equal(cpu.step(), 2);
        assert.equal(cpu.a, example.expected_a);
        assert.equal(cpu.x, example.expected_x);
        assert.equal(cpu.stack_pointer, 0x93);
        assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), example.negative);
        assert.equal(has_status_flag(cpu.status, ZERO_FLAG), example.zero);
        assert.equal(has_status_flag(cpu.status, CARRY_FLAG), true);
        assert.equal(has_status_flag(cpu.status, OVERFLOW_FLAG), true);
        assert.equal(has_status_flag(cpu.status, DECIMAL_FLAG), true);
        assert.equal(has_status_flag(cpu.status, INTERRUPT_DISABLE_FLAG), true);
        assert.deepEqual(bus.accesses.map(({ address }) => address), [0x8000, 0x8001]);
    }

    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xab, 0xff]));
    const alternate_magic_cpu = new Cpu2A03(bus, { unstable_opcode_magic_value: 0x00 });
    alternate_magic_cpu.program_counter = 0x8000;
    alternate_magic_cpu.a = 0x12;

    assert.equal(alternate_magic_cpu.step(), 2);
    assert.equal(alternate_magic_cpu.a, 0x12);
    assert.equal(alternate_magic_cpu.x, 0x12);
    assert.throws(
        () => new Cpu2A03(new FakeCpuBus(), { unstable_opcode_magic_value: 0x100 }),
        /magic value must be an integer from 0 through 255/,
    );
});

test("LAX loads A and X from each implemented addressing mode with the expected flags and cycles", () => {
    const cases = [
        {
            opcode: 0xa3,
            operands: [0x10],
            pointer_address: 0x12,
            pointer_bytes: [0x00, 0x20],
            target: 0x2000,
            value: 0x80,
            cycles: 6,
        },
        {
            opcode: 0xa7,
            operands: [0x10],
            pointer_address: undefined,
            pointer_bytes: undefined,
            target: 0x0010,
            value: 0x00,
            cycles: 3,
        },
        {
            opcode: 0xaf,
            operands: [0x00, 0x20],
            pointer_address: undefined,
            pointer_bytes: undefined,
            target: 0x2000,
            value: 0x80,
            cycles: 4,
        },
        {
            opcode: 0xb3,
            operands: [0x10],
            pointer_address: 0x10,
            pointer_bytes: [0x00, 0x20],
            target: 0x2002,
            value: 0x80,
            cycles: 5,
        },
        {
            opcode: 0xb7,
            operands: [0x10],
            pointer_address: undefined,
            pointer_bytes: undefined,
            target: 0x0012,
            value: 0x80,
            cycles: 4,
        },
        {
            opcode: 0xbf,
            operands: [0x00, 0x20],
            pointer_address: undefined,
            pointer_bytes: undefined,
            target: 0x2002,
            value: 0x80,
            cycles: 4,
        },
    ];

    for (const example of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([example.opcode, ...example.operands]));

        if (example.pointer_address !== undefined && example.pointer_bytes !== undefined) {
            bus.load(example.pointer_address, new Uint8Array(example.pointer_bytes));
        }

        bus.load(example.target, new Uint8Array([example.value]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = 0x55;
        cpu.x = 2;
        cpu.y = 2;
        cpu.stack_pointer = 0x83;
        cpu.status = UNUSED_FLAG | CARRY_FLAG | OVERFLOW_FLAG | DECIMAL_FLAG;

        assert.equal(cpu.step(), example.cycles, `opcode $${example.opcode.toString(16)}`);
        assert.equal(cpu.a, example.value);
        assert.equal(cpu.x, example.value);
        assert.equal(cpu.program_counter, 0x8000 + 1 + example.operands.length);
        assert.equal(cpu.stack_pointer, 0x83);
        assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), (example.value & NEGATIVE_FLAG) !== 0);
        assert.equal(has_status_flag(cpu.status, ZERO_FLAG), example.value === 0);
        assert.equal(has_status_flag(cpu.status, CARRY_FLAG), true);
        assert.equal(has_status_flag(cpu.status, OVERFLOW_FLAG), true);
        assert.equal(has_status_flag(cpu.status, DECIMAL_FLAG), true);
        assert.equal(bus.accesses.length, example.cycles);
        assert.ok(bus.accesses.every(({ kind }) => kind === "read"));
    }
});

test("LAX absolute-Y and indirect-indexed reads pay one indexed page-cross cycle", () => {
    const cases = [
        {
            opcode: 0xbf,
            operands: [0xff, 0x20],
            pointer_address: undefined,
            pointer_bytes: undefined,
            cycles: 5,
            expected_addresses: [0x8000, 0x8001, 0x8002, 0x2000, 0x2100],
        },
        {
            opcode: 0xb3,
            operands: [0x10],
            pointer_address: 0x10,
            pointer_bytes: [0xff, 0x20],
            cycles: 6,
            expected_addresses: [0x8000, 0x8001, 0x0010, 0x0011, 0x2000, 0x2100],
        },
    ];

    for (const example of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([example.opcode, ...example.operands]));

        if (example.pointer_address !== undefined && example.pointer_bytes !== undefined) {
            bus.load(example.pointer_address, new Uint8Array(example.pointer_bytes));
        }

        bus.load(0x2100, new Uint8Array([0x5a]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.y = 1;

        assert.equal(cpu.step(), example.cycles);
        assert.deepEqual(bus.accesses.map(({ address }) => address), example.expected_addresses);
        assert.equal(cpu.a, 0x5a);
        assert.equal(cpu.x, 0x5a);
    }
});

test("LAS loads memory AND stack pointer into A, X, and SP with absolute-Y page-cross timing", () => {
    const cases = [
        {
            operands: [0x00, 0x20],
            target: 0x2001,
            stack_pointer: 0xf0,
            value: 0x0f,
            expected: 0x00,
            cycles: 4,
            expected_addresses: [0x8000, 0x8001, 0x8002, 0x2001],
        },
        {
            operands: [0xff, 0x20],
            target: 0x2100,
            stack_pointer: 0xe2,
            value: 0x80,
            expected: 0x80,
            cycles: 5,
            expected_addresses: [0x8000, 0x8001, 0x8002, 0x2000, 0x2100],
        },
    ];

    for (const example of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([0xbb, ...example.operands]));
        bus.load(example.target, new Uint8Array([example.value]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = 0x11;
        cpu.x = 0x22;
        cpu.y = 1;
        cpu.stack_pointer = example.stack_pointer;
        cpu.status = UNUSED_FLAG | CARRY_FLAG | OVERFLOW_FLAG | DECIMAL_FLAG;

        assert.equal(cpu.step(), example.cycles);
        assert.equal(cpu.a, example.expected);
        assert.equal(cpu.x, example.expected);
        assert.equal(cpu.stack_pointer, example.expected);
        assert.equal(has_status_flag(cpu.status, ZERO_FLAG), example.expected === 0);
        assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), (example.expected & NEGATIVE_FLAG) !== 0);
        assert.equal(has_status_flag(cpu.status, CARRY_FLAG), true);
        assert.equal(has_status_flag(cpu.status, OVERFLOW_FLAG), true);
        assert.equal(has_status_flag(cpu.status, DECIMAL_FLAG), true);
        assert.deepEqual(bus.accesses.map(({ address }) => address), example.expected_addresses);
    }
});

test("SAX stores A-and-X through indexed-indirect, zero-page, absolute, and zero-page-Y modes", () => {
    const cases = [
        {
            opcode: 0x83,
            operands: [0x10],
            pointer_address: 0x4c,
            pointer_bytes: [0x00, 0x20],
            target: 0x2000,
            cycles: 6,
        },
        {
            opcode: 0x87,
            operands: [0x10],
            pointer_address: undefined,
            pointer_bytes: undefined,
            target: 0x0010,
            cycles: 3,
        },
        {
            opcode: 0x8f,
            operands: [0x00, 0x20],
            pointer_address: undefined,
            pointer_bytes: undefined,
            target: 0x2000,
            cycles: 4,
        },
        {
            opcode: 0x97,
            operands: [0x10],
            pointer_address: undefined,
            pointer_bytes: undefined,
            target: 0x0012,
            cycles: 4,
        },
    ];

    for (const example of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([example.opcode, ...example.operands]));

        if (example.pointer_address !== undefined && example.pointer_bytes !== undefined) {
            bus.load(example.pointer_address, new Uint8Array(example.pointer_bytes));
        }

        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = 0x55;
        cpu.x = 0x3c;
        cpu.y = 2;
        cpu.stack_pointer = 0x83;
        cpu.status = UNUSED_FLAG | CARRY_FLAG | OVERFLOW_FLAG | ZERO_FLAG | DECIMAL_FLAG;
        const status_before = cpu.status;

        assert.equal(cpu.step(), example.cycles, `opcode $${example.opcode.toString(16)}`);
        assert.equal(bus.peek(example.target), 0x14);
        assert.deepEqual(
            bus.accesses.filter(({ kind }) => kind === "write"),
            [{ kind: "write", address: example.target, value: 0x14 }],
        );
        assert.equal(cpu.a, 0x55);
        assert.equal(cpu.x, 0x3c);
        assert.equal(cpu.y, 2);
        assert.equal(cpu.stack_pointer, 0x83);
        assert.equal(cpu.status, status_before);
    }
});

test("SHX and SHY store register-masked high bytes and corrupt the destination high byte only on page crossing", () => {
    const cases = [
        {
            opcode: 0x9e,
            base_address: 0x1200,
            x: 0x2f,
            y: 0x34,
            dummy_address: 0x1234,
            target: 0x1234,
            value: 0x03,
        },
        {
            opcode: 0x9c,
            base_address: 0x3400,
            x: 0x12,
            y: 0x7f,
            dummy_address: 0x3412,
            target: 0x3412,
            value: 0x35,
        },
        {
            opcode: 0x9e,
            base_address: 0x12ff,
            x: 0x0f,
            y: 0x01,
            dummy_address: 0x1200,
            target: 0x0300,
            value: 0x03,
        },
        {
            opcode: 0x9c,
            base_address: 0x56ff,
            x: 0x01,
            y: 0x27,
            dummy_address: 0x5600,
            target: 0x0700,
            value: 0x07,
        },
    ];

    for (const example of cases) {
        const bus = new FakeCpuBus();
        bus.load(
            0x8000,
            new Uint8Array([
                example.opcode,
                example.base_address & 0xff,
                example.base_address >>> 8,
            ]),
        );
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.x = example.x;
        cpu.y = example.y;
        cpu.status = 0xff;

        assert.equal(cpu.step(), 5, `opcode $${example.opcode.toString(16)}`);
        assert.equal(bus.accesses.length, 5, `opcode $${example.opcode.toString(16)}`);
        assert.deepEqual(
            bus.accesses.map(({ kind, address }) => [kind, address]),
            [
                ["read", 0x8000],
                ["read", 0x8001],
                ["read", 0x8002],
                ["read", example.dummy_address],
                ["write", example.target],
            ],
        );
        assert.deepEqual(
            bus.accesses.filter(({ kind }) => kind === "write"),
            [{ kind: "write", address: example.target, value: example.value }],
        );
        assert.equal(bus.peek(example.target), example.value);
        assert.equal(cpu.x, example.x);
        assert.equal(cpu.y, example.y);
        assert.equal(cpu.status, 0xff);
    }
});

test("AHX/TAS apply register masking, TAS updates SP, and indexed writes keep fixed cycles", () => {
    const cases = [
        {
            opcode: 0x93,
            operands: [0x20],
            pointer_address: 0x0020,
            pointer_bytes: [0x00, 0x12],
            a: 0xff,
            x: 0x2f,
            y: 0x34,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x80,
            target: 0x1234,
            value: 0x03,
            cycles: 6,
            expected_accesses: [
                ["read", 0x8000],
                ["read", 0x8001],
                ["read", 0x0020],
                ["read", 0x0021],
                ["read", 0x1234],
                ["write", 0x1234],
            ],
        },
        {
            opcode: 0x9f,
            operands: [0xff, 0x12],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0xff,
            x: 0x0f,
            y: 0x01,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x80,
            target: 0x0300,
            value: 0x03,
            cycles: 5,
            expected_accesses: [
                ["read", 0x8000],
                ["read", 0x8001],
                ["read", 0x8002],
                ["read", 0x1200],
                ["write", 0x0300],
            ],
        },
        {
            opcode: 0x9b,
            operands: [0x00, 0x40],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0xff,
            x: 0x3f,
            y: 0x22,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x3f,
            target: 0x4022,
            value: 0x01,
            cycles: 5,
            expected_accesses: [
                ["read", 0x8000],
                ["read", 0x8001],
                ["read", 0x8002],
                ["read", 0x4022],
                ["write", 0x4022],
            ],
        },
        {
            opcode: 0x9b,
            operands: [0xff, 0x56],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0x7f,
            x: 0x0f,
            y: 0x01,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x0f,
            target: 0x0700,
            value: 0x07,
            cycles: 5,
            expected_accesses: [
                ["read", 0x8000],
                ["read", 0x8001],
                ["read", 0x8002],
                ["read", 0x5600],
                ["write", 0x0700],
            ],
        },
    ];

    for (const example of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([example.opcode, ...example.operands]));

        if (example.pointer_address !== undefined && example.pointer_bytes !== undefined) {
            bus.load(example.pointer_address, new Uint8Array(example.pointer_bytes));
        }

        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = example.a;
        cpu.x = example.x;
        cpu.y = example.y;
        cpu.stack_pointer = example.initial_stack_pointer;
        cpu.status = 0xff;

        assert.equal(cpu.step(), example.cycles, `opcode $${example.opcode.toString(16)}`);
        assert.deepEqual(
            bus.accesses.map(({ kind, address }) => [kind, address]),
            example.expected_accesses,
        );
        assert.deepEqual(
            bus.accesses.filter(({ kind }) => kind === "write"),
            [{ kind: "write", address: example.target, value: example.value }],
        );
        assert.equal(bus.peek(example.target), example.value);
        assert.equal(cpu.a, example.a);
        assert.equal(cpu.x, example.x);
        assert.equal(cpu.y, example.y);
        assert.equal(cpu.stack_pointer, example.expected_stack_pointer);
        assert.equal(cpu.status, 0xff);
    }
});

test("a DMC stall on an unstable-store dummy read drops the data mask but preserves page-cross corruption", () => {
    const cases = [
        {
            opcode: 0x93,
            operands: [0x20],
            pointer_address: 0x0020,
            pointer_bytes: [0xff, 0x12],
            a: 0xff,
            x: 0x0f,
            y: 0x01,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x80,
            dummy_address: 0x1200,
            target: 0x0300,
            masked_value: 0x03,
            unmasked_value: 0x0f,
            base_cycles: 6,
        },
        {
            opcode: 0x9b,
            operands: [0xff, 0x56],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0x7f,
            x: 0x0f,
            y: 0x01,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x0f,
            dummy_address: 0x5600,
            target: 0x0700,
            masked_value: 0x07,
            unmasked_value: 0x0f,
            base_cycles: 5,
        },
        {
            opcode: 0x9c,
            operands: [0xff, 0x56],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0x00,
            x: 0x01,
            y: 0x27,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x80,
            dummy_address: 0x5600,
            target: 0x0700,
            masked_value: 0x07,
            unmasked_value: 0x27,
            base_cycles: 5,
        },
        {
            opcode: 0x9e,
            operands: [0xff, 0x12],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0x00,
            x: 0x0f,
            y: 0x01,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x80,
            dummy_address: 0x1200,
            target: 0x0300,
            masked_value: 0x03,
            unmasked_value: 0x0f,
            base_cycles: 5,
        },
        {
            opcode: 0x9f,
            operands: [0xff, 0x12],
            pointer_address: undefined,
            pointer_bytes: undefined,
            a: 0xff,
            x: 0x0f,
            y: 0x01,
            initial_stack_pointer: 0x80,
            expected_stack_pointer: 0x80,
            dummy_address: 0x1200,
            target: 0x0300,
            masked_value: 0x03,
            unmasked_value: 0x0f,
            base_cycles: 5,
        },
    ];

    for (const example of cases) {
        const bus = new DmcStallFakeCpuBus(example.dummy_address);
        bus.load(0x8000, new Uint8Array([example.opcode, ...example.operands]));
        bus.load(0xc000, new Uint8Array([0xa5]));

        if (example.pointer_address !== undefined && example.pointer_bytes !== undefined) {
            bus.load(example.pointer_address, new Uint8Array(example.pointer_bytes));
        }

        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = example.a;
        cpu.x = example.x;
        cpu.y = example.y;
        cpu.stack_pointer = example.initial_stack_pointer;
        cpu.status = 0xa5;

        assert.equal(cpu.step(), example.base_cycles + 4, `opcode $${example.opcode.toString(16)}`);
        assert.equal(bus.accesses.length, example.base_cycles + 4);
        assert.equal(example.target >>> 8, example.masked_value);
        assert.deepEqual(
            bus.accesses.filter(({ kind }) => kind === "write"),
            [{ kind: "write", address: example.target, value: example.unmasked_value }],
        );
        assert.equal(bus.peek(example.target), example.unmasked_value);
        assert.equal(
            bus.accesses.filter(({ kind, address }) => kind === "read" && address === example.dummy_address).length,
            4,
        );
        assert.equal(
            bus.accesses.filter(({ kind, address }) => kind === "read" && address === 0xc000).length,
            1,
        );
        assert.equal(cpu.stack_pointer, example.expected_stack_pointer);
        assert.equal(cpu.status, 0xa5);
    }

    const earlier_stall_bus = new DmcStallFakeCpuBus(0x8002);
    earlier_stall_bus.load(0x8000, new Uint8Array([0x9e, 0xff, 0x12]));
    earlier_stall_bus.load(0xc000, new Uint8Array([0xa5]));
    const earlier_stall_cpu = new Cpu2A03(earlier_stall_bus);
    earlier_stall_cpu.program_counter = 0x8000;
    earlier_stall_cpu.x = 0x0f;
    earlier_stall_cpu.y = 0x01;

    assert.equal(earlier_stall_cpu.step(), 9);
    assert.deepEqual(
        earlier_stall_bus.accesses.filter(({ kind }) => kind === "write"),
        [{ kind: "write", address: 0x0300, value: 0x03 }],
    );
});

test("composite unofficial RMW opcodes preserve write ordering and declared cycles in every mode", () => {
    for (const definition of unofficial_rmw_definitions) {
        let operands: number[];
        let target: number;
        let pointer_address: number | undefined;
        let pointer_bytes: number[] | undefined;

        switch (definition.addressing_mode) {
            case "zero_page":
                operands = [0x10];
                target = 0x0010;
                break;
            case "zero_page_x":
                operands = [0x10];
                target = 0x0011;
                break;
            case "absolute":
                operands = [0x00, 0x20];
                target = 0x2000;
                break;
            case "absolute_x":
                operands = [0x00, 0x20];
                target = 0x2001;
                break;
            case "absolute_y":
                operands = [0x00, 0x20];
                target = 0x2001;
                break;
            case "indexed_indirect":
                operands = [0x10];
                pointer_address = 0x11;
                pointer_bytes = [0x00, 0x20];
                target = 0x2000;
                break;
            case "indirect_indexed":
                operands = [0x10];
                pointer_address = 0x10;
                pointer_bytes = [0x00, 0x20];
                target = 0x2001;
                break;
            default:
                assert.fail(`Unexpected read-modify-write mode ${definition.addressing_mode}`);
        }

        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([definition.opcode, ...operands]));

        if (pointer_address !== undefined && pointer_bytes !== undefined) {
            bus.load(pointer_address, new Uint8Array(pointer_bytes));
        }

        bus.load(target, new Uint8Array([0x02]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = 0x10;
        cpu.x = 1;
        cpu.y = 1;
        cpu.status = UNUSED_FLAG | CARRY_FLAG;

        assert.equal(cpu.step(), definition.base_cycles, `${definition.mnemonic} $${definition.opcode.toString(16)}`);
        assert.equal(bus.accesses.length, definition.base_cycles, `${definition.mnemonic} bus cycles`);
        assert.deepEqual(
            bus.accesses.filter(({ kind }) => kind === "write"),
            [
                { kind: "write", address: target, value: 0x02 },
                { kind: "write", address: target, value: bus.peek(target) },
            ],
            `${definition.mnemonic} write sequence`,
        );
    }
});

test("composite unofficial RMW opcodes combine memory shifts with ALU and compare results", () => {
    const cases = [
        {
            opcode: 0x07,
            a: 0x01,
            value: 0x40,
            carry: false,
            expected_a: 0x81,
            expected_value: 0x80,
            expected_carry: false,
            expected_zero: false,
            expected_negative: true,
            expected_overflow: false,
        },
        {
            opcode: 0x27,
            a: 0x81,
            value: 0x80,
            carry: true,
            expected_a: 0x01,
            expected_value: 0x01,
            expected_carry: true,
            expected_zero: false,
            expected_negative: false,
            expected_overflow: false,
        },
        {
            opcode: 0x47,
            a: 0x00,
            value: 0x03,
            carry: false,
            expected_a: 0x01,
            expected_value: 0x01,
            expected_carry: true,
            expected_zero: false,
            expected_negative: false,
            expected_overflow: false,
        },
        {
            opcode: 0x67,
            a: 0x10,
            value: 0x03,
            carry: false,
            expected_a: 0x12,
            expected_value: 0x01,
            expected_carry: false,
            expected_zero: false,
            expected_negative: false,
            expected_overflow: false,
        },
        {
            opcode: 0x67,
            a: 0x7f,
            value: 0x01,
            carry: false,
            expected_a: 0x80,
            expected_value: 0x00,
            expected_carry: false,
            expected_zero: false,
            expected_negative: true,
            expected_overflow: true,
        },
        {
            opcode: 0xc7,
            a: 0x00,
            value: 0x01,
            carry: false,
            expected_a: 0x00,
            expected_value: 0x00,
            expected_carry: true,
            expected_zero: true,
            expected_negative: false,
            expected_overflow: false,
        },
        {
            opcode: 0xe7,
            a: 0x10,
            value: 0xff,
            carry: true,
            expected_a: 0x10,
            expected_value: 0x00,
            expected_carry: true,
            expected_zero: false,
            expected_negative: false,
            expected_overflow: false,
        },
    ];

    for (const example of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([example.opcode, 0x10]));
        bus.load(0x0010, new Uint8Array([example.value]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = example.a;
        cpu.status = UNUSED_FLAG | (example.carry ? CARRY_FLAG : 0);

        assert.equal(cpu.step(), 5, `opcode $${example.opcode.toString(16)}`);
        assert.equal(cpu.a, example.expected_a);
        assert.equal(bus.peek(0x0010), example.expected_value);
        assert.equal((cpu.status & CARRY_FLAG) !== 0, example.expected_carry);
        assert.equal((cpu.status & ZERO_FLAG) !== 0, example.expected_zero);
        assert.equal((cpu.status & NEGATIVE_FLAG) !== 0, example.expected_negative);
        assert.equal((cpu.status & OVERFLOW_FLAG) !== 0, example.expected_overflow);
    }
});

test("all KIL opcodes jam until reset, ignore interrupts, and continue issuing bounded bus cycles", () => {
    const kil_opcodes = [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2];

    for (const opcode of kil_opcodes) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([opcode, 0xea]));
        bus.load(0xfffc, new Uint8Array([0x00, 0x90, 0x34, 0x12]));
        bus.load(0x9000, new Uint8Array([0xea]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.status = UNUSED_FLAG;

        assert.equal(cpu.step(), 2, `KIL opcode $${opcode.toString(16)}`);
        assert.equal(cpu.program_counter, 0x8001);
        assert.deepEqual(bus.accesses, [
            { kind: "read", address: 0x8000, value: opcode },
            { kind: "read", address: 0x8001, value: 0xea },
        ]);

        bus.clear_trace();
        cpu.set_irq_line(true);
        cpu.request_nmi();

        const first_jam_sequence = [
            { kind: "read", address: 0xffff, value: 0x12 },
            { kind: "read", address: 0xfffe, value: 0x34 },
            { kind: "read", address: 0xfffe, value: 0x34 },
        ] as const;

        for (const [index, expected_access] of first_jam_sequence.entries()) {
            const jam_cycle = cpu.clock_cycle();
            assert.equal(jam_cycle.sequence_kind, "jam");
            assert.equal(jam_cycle.sequence_cycle, index + 1);
            assert.equal(jam_cycle.sequence_completed, index === first_jam_sequence.length - 1);
            assert.deepEqual(jam_cycle.access, expected_access);
        }

        assert.equal(cpu.step(), 1, "a jammed step must remain bounded");
        assert.deepEqual(bus.accesses.at(-1), { kind: "read", address: 0xffff, value: 0x12 });
        assert.equal(cpu.step(), 1);
        assert.equal(cpu.program_counter, 0x8001);

        cpu.set_irq_line(false);
        assert.equal(cpu.reset(), 7);
        assert.equal(cpu.program_counter, 0x9000);
        assert.equal(cpu.step(), 2);
        assert.equal(cpu.program_counter, 0x9001);
    }
});

test("every opcode byte is explicitly classified as official or unofficial", () => {
    assert.equal(OFFICIAL_OPCODE_DEFINITIONS.length, 151);
    assert.equal(UNOFFICIAL_OPCODE_DEFINITIONS.length, 105);
    assert.equal(CPU_OPCODE_TABLE.size, 0x100);
    assert.deepEqual(
        [...CPU_OPCODE_TABLE.keys()].sort((left, right) => left - right),
        Array.from({ length: 0x100 }, (_, opcode) => opcode),
    );
});

test("logical operations and loads update A and zero/negative flags", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xa9, 0x80, 0x09, 0x01, 0x29, 0x7f, 0x49, 0xff]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;

    assert.equal(cpu.step(), 2);
    assert.equal(cpu.a, 0x80);
    assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), true);

    assert.equal(cpu.step(), 2);
    assert.equal(cpu.a, 0x81);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.a, 0x01);
    assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), false);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.a, 0xfe);
    assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), true);
    assert.equal(has_status_flag(cpu.status, ZERO_FLAG), false);
});

test("ADC and SBC opcodes use binary 2A03 arithmetic even when decimal is set", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x69, 0x7f, 0xe9, 0x01]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.a = 0x01;
    cpu.status = UNUSED_FLAG;

    assert.equal(cpu.step(), 2);
    assert.equal(cpu.a, 0x80);
    assert.equal(has_status_flag(cpu.status, CARRY_FLAG), false);
    assert.equal(has_status_flag(cpu.status, OVERFLOW_FLAG), true);
    assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), true);

    cpu.a = 0;
    cpu.status = UNUSED_FLAG | CARRY_FLAG | DECIMAL_FLAG;
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.a, 0xff);
    assert.equal(has_status_flag(cpu.status, CARRY_FLAG), false);
    assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), true);
    assert.equal(has_status_flag(cpu.status, DECIMAL_FLAG), true);
});

test("stores preserve flags and loads read back the stored byte", () => {
    const bus = new FakeCpuBus();
    bus.load(
        0x8000,
        new Uint8Array([
            0xa9,
            0x5a,
            0x85,
            0x10,
            0xa2,
            0xa5,
            0x86,
            0x11,
            0xa0,
            0x3c,
            0x84,
            0x12,
            0xa5,
            0x10,
        ]),
    );
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;

    assert.equal(cpu.step(), 2);
    assert.equal(cpu.a, 0x5a);
    const before_sta = cpu.status;
    assert.equal(cpu.step(), 3);
    assert.equal(cpu.status, before_sta);
    assert.equal(bus.peek(0x0010), 0x5a);

    assert.equal(cpu.step(), 2);
    const before_stx = cpu.status;
    assert.equal(cpu.step(), 3);
    assert.equal(cpu.status, before_stx);
    assert.equal(bus.peek(0x0011), 0xa5);

    assert.equal(cpu.step(), 2);
    const before_sty = cpu.status;
    assert.equal(cpu.step(), 3);
    assert.equal(cpu.status, before_sty);
    assert.equal(bus.peek(0x0012), 0x3c);

    assert.equal(cpu.step(), 3);
    assert.equal(cpu.a, 0x5a);
});

test("compare and BIT instructions set their documented flags", () => {
    const compare_bus = new FakeCpuBus();
    compare_bus.load(0x8000, new Uint8Array([0xc9, 0x50, 0xe0, 0x01, 0xc0, 0xfe]));
    const compare_cpu = new Cpu2A03(compare_bus);
    compare_cpu.program_counter = 0x8000;
    compare_cpu.a = 0x50;
    compare_cpu.x = 0;
    compare_cpu.y = 0xff;

    assert.equal(compare_cpu.step(), 2);
    assert.equal(has_status_flag(compare_cpu.status, CARRY_FLAG), true);
    assert.equal(has_status_flag(compare_cpu.status, ZERO_FLAG), true);
    assert.equal(compare_cpu.step(), 2);
    assert.equal(has_status_flag(compare_cpu.status, CARRY_FLAG), false);
    assert.equal(has_status_flag(compare_cpu.status, NEGATIVE_FLAG), true);
    assert.equal(compare_cpu.step(), 2);
    assert.equal(has_status_flag(compare_cpu.status, CARRY_FLAG), true);
    assert.equal(has_status_flag(compare_cpu.status, NEGATIVE_FLAG), false);

    const bit_bus = new FakeCpuBus();
    bit_bus.load(0x8000, new Uint8Array([0x24, 0x10]));
    bit_bus.load(0x0010, new Uint8Array([0xc0]));
    const bit_cpu = new Cpu2A03(bit_bus);
    bit_cpu.program_counter = 0x8000;
    bit_cpu.a = 0x0f;

    assert.equal(bit_cpu.step(), 3);
    assert.equal(bit_cpu.a, 0x0f);
    assert.equal(has_status_flag(bit_cpu.status, ZERO_FLAG), true);
    assert.equal(has_status_flag(bit_cpu.status, OVERFLOW_FLAG), true);
    assert.equal(has_status_flag(bit_cpu.status, NEGATIVE_FLAG), true);
});

test("accumulator shifts and rotates use carry-in/out and update result flags", () => {
    const cases = [
        { opcode: 0x0a, value: 0x81, carry_in: false, result: 0x02, carry_out: true },
        { opcode: 0x4a, value: 0x03, carry_in: false, result: 0x01, carry_out: true },
        { opcode: 0x2a, value: 0x80, carry_in: true, result: 0x01, carry_out: true },
        { opcode: 0x6a, value: 0x01, carry_in: true, result: 0x80, carry_out: true },
    ];

    for (const { opcode, value, carry_in, result, carry_out } of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([opcode]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.a = value;
        cpu.status = carry_in ? UNUSED_FLAG | CARRY_FLAG : UNUSED_FLAG;

        assert.equal(cpu.step(), 2);
        assert.equal(cpu.a, result);
        assert.equal(has_status_flag(cpu.status, CARRY_FLAG), carry_out);
        assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), (result & NEGATIVE_FLAG) !== 0);
        assert.equal(has_status_flag(cpu.status, ZERO_FLAG), result === 0);
    }
});

test("INC and DEC perform NMOS read-modify-write cycles and update zero/negative", () => {
    const cases = [
        { opcode: 0xe6, initial: 0xff, result: 0x00, zero: true, negative: false },
        { opcode: 0xc6, initial: 0x00, result: 0xff, zero: false, negative: true },
    ];

    for (const { opcode, initial, result, zero, negative } of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([opcode, 0x10]));
        bus.load(0x0010, new Uint8Array([initial]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;

        assert.equal(cpu.step(), 5);
        assert.equal(bus.peek(0x0010), result);
        assert.equal(has_status_flag(cpu.status, ZERO_FLAG), zero);
        assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), negative);
        assert.deepEqual(
            bus.accesses.map(({ kind, address, value }) => [kind, address, value]),
            [
                ["read", 0x8000, opcode],
                ["read", 0x8001, 0x10],
                ["read", 0x0010, initial],
                ["write", 0x0010, initial],
                ["write", 0x0010, result],
            ],
        );
    }
});

test("register increments, decrements, and transfers wrap bytes and set flags", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0xe8, 0xca, 0xc8, 0x88, 0xaa, 0xa8, 0x8a, 0x98, 0xba, 0x9a]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.x = 0xff;
    cpu.y = 0xff;
    cpu.a = 0x80;
    cpu.stack_pointer = 0;

    assert.equal(cpu.step(), 2);
    assert.equal(cpu.x, 0);
    assert.equal(has_status_flag(cpu.status, ZERO_FLAG), true);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.x, 0xff);
    assert.equal(has_status_flag(cpu.status, NEGATIVE_FLAG), true);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.y, 0);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.y, 0xff);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.x, 0x80);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.y, 0x80);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.a, 0x80);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.a, 0x80);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.x, 0x00);
    assert.equal(cpu.step(), 2);
    assert.equal(cpu.stack_pointer, 0x00);
});

test("flag instructions change only their selected status bits", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x38, 0xd8, 0x58, 0xb8, 0xf8, 0x78, 0x18, 0x98]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.status = UNUSED_FLAG | OVERFLOW_FLAG;

    cpu.step();
    assert.equal(has_status_flag(cpu.status, CARRY_FLAG), true);
    cpu.step();
    assert.equal(has_status_flag(cpu.status, DECIMAL_FLAG), false);
    cpu.step();
    assert.equal(has_status_flag(cpu.status, INTERRUPT_DISABLE_FLAG), false);
    cpu.step();
    assert.equal(has_status_flag(cpu.status, OVERFLOW_FLAG), false);
    cpu.step();
    assert.equal(has_status_flag(cpu.status, DECIMAL_FLAG), true);
    cpu.step();
    assert.equal(has_status_flag(cpu.status, INTERRUPT_DISABLE_FLAG), true);
    cpu.step();
    assert.equal(has_status_flag(cpu.status, CARRY_FLAG), false);
    const status_before_tya = cpu.status;
    cpu.step();
    assert.equal(cpu.status & ~(ZERO_FLAG | NEGATIVE_FLAG), status_before_tya & ~(ZERO_FLAG | NEGATIVE_FLAG));
});

test("all conditional branches evaluate the matching status flag", () => {
    const cases: { opcode: number; flag: CpuStatusFlag; set: boolean; taken: boolean }[] = [
        { opcode: 0x90, flag: CARRY_FLAG, set: false, taken: true },
        { opcode: 0x90, flag: CARRY_FLAG, set: true, taken: false },
        { opcode: 0xb0, flag: CARRY_FLAG, set: true, taken: true },
        { opcode: 0xb0, flag: CARRY_FLAG, set: false, taken: false },
        { opcode: 0xf0, flag: ZERO_FLAG, set: true, taken: true },
        { opcode: 0xf0, flag: ZERO_FLAG, set: false, taken: false },
        { opcode: 0x30, flag: NEGATIVE_FLAG, set: true, taken: true },
        { opcode: 0x30, flag: NEGATIVE_FLAG, set: false, taken: false },
        { opcode: 0xd0, flag: ZERO_FLAG, set: false, taken: true },
        { opcode: 0xd0, flag: ZERO_FLAG, set: true, taken: false },
        { opcode: 0x10, flag: NEGATIVE_FLAG, set: false, taken: true },
        { opcode: 0x10, flag: NEGATIVE_FLAG, set: true, taken: false },
        { opcode: 0x50, flag: OVERFLOW_FLAG, set: false, taken: true },
        { opcode: 0x50, flag: OVERFLOW_FLAG, set: true, taken: false },
        { opcode: 0x70, flag: OVERFLOW_FLAG, set: true, taken: true },
        { opcode: 0x70, flag: OVERFLOW_FLAG, set: false, taken: false },
    ];

    for (const { opcode, flag, set, taken } of cases) {
        const bus = new FakeCpuBus();
        bus.load(0x8000, new Uint8Array([opcode, 0x02]));
        const cpu = new Cpu2A03(bus);
        cpu.program_counter = 0x8000;
        cpu.status = set_status_flag(UNUSED_FLAG, flag, set);

        assert.equal(cpu.step(), taken ? 3 : 2);
        assert.equal(cpu.program_counter, taken ? 0x8004 : 0x8002);
        assert.equal(bus.accesses.length, taken ? 3 : 2);
    }
});

test("indexed read and store instructions use page-cross and fixed dummy cycles", () => {
    const read_bus = new FakeCpuBus();
    read_bus.load(0x8000, new Uint8Array([0xbd, 0xff, 0x12]));
    read_bus.load(0x1300, new Uint8Array([0x80]));
    const read_cpu = new Cpu2A03(read_bus);
    read_cpu.program_counter = 0x8000;
    read_cpu.x = 1;

    assert.equal(read_cpu.step(), 5);
    assert.equal(read_cpu.a, 0x80);
    assert.deepEqual(
        read_bus.accesses.map(({ address }) => address),
        [0x8000, 0x8001, 0x8002, 0x1200, 0x1300],
    );

    const absolute_y_bus = new FakeCpuBus();
    absolute_y_bus.load(0x8000, new Uint8Array([0xbe, 0xff, 0x12]));
    absolute_y_bus.load(0x1300, new Uint8Array([0xa5]));
    const absolute_y_cpu = new Cpu2A03(absolute_y_bus);
    absolute_y_cpu.program_counter = 0x8000;
    absolute_y_cpu.y = 1;

    assert.equal(absolute_y_cpu.step(), 5);
    assert.equal(absolute_y_cpu.x, 0xa5);
    assert.deepEqual(
        absolute_y_bus.accesses.map(({ address }) => address),
        [0x8000, 0x8001, 0x8002, 0x1200, 0x1300],
    );

    const indirect_y_bus = new FakeCpuBus();
    indirect_y_bus.load(0x8000, new Uint8Array([0xb1, 0xff]));
    indirect_y_bus.load(0x00ff, new Uint8Array([0xff]));
    indirect_y_bus.load(0x0000, new Uint8Array([0x20]));
    indirect_y_bus.load(0x2100, new Uint8Array([0x66]));
    const indirect_y_cpu = new Cpu2A03(indirect_y_bus);
    indirect_y_cpu.program_counter = 0x8000;
    indirect_y_cpu.y = 1;

    assert.equal(indirect_y_cpu.step(), 6);
    assert.equal(indirect_y_cpu.a, 0x66);
    assert.deepEqual(
        indirect_y_bus.accesses.map(({ address }) => address),
        [0x8000, 0x8001, 0x00ff, 0x0000, 0x2000, 0x2100],
    );

    const write_bus = new FakeCpuBus();
    write_bus.load(0x8000, new Uint8Array([0x9d, 0xff, 0x12]));
    const write_cpu = new Cpu2A03(write_bus);
    write_cpu.program_counter = 0x8000;
    write_cpu.x = 1;
    write_cpu.a = 0x5a;

    assert.equal(write_cpu.step(), 5);
    assert.equal(write_bus.peek(0x1300), 0x5a);
    assert.deepEqual(
        write_bus.accesses.map(({ kind, address }) => [kind, address]),
        [
            ["read", 0x8000],
            ["read", 0x8001],
            ["read", 0x8002],
            ["read", 0x1200],
            ["write", 0x1300],
        ],
    );
});

test("a taken branch across a page costs two extra cycles", () => {
    const bus = new FakeCpuBus();
    bus.load(0x80fd, new Uint8Array([0xd0, 0x02]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x80fd;

    assert.equal(cpu.step(), 4);
    assert.equal(cpu.program_counter, 0x8101);
    assert.deepEqual(
        bus.accesses.map(({ address }) => address),
        [0x80fd, 0x80fe, 0x80ff, 0x8001],
    );
});

test("JMP absolute and indirect set PC to their resolved targets", () => {
    const absolute_bus = new FakeCpuBus();
    absolute_bus.load(0x8000, new Uint8Array([0x4c, 0x34, 0x12]));
    const absolute_cpu = new Cpu2A03(absolute_bus);
    absolute_cpu.program_counter = 0x8000;

    assert.equal(absolute_cpu.step(), 3);
    assert.equal(absolute_cpu.program_counter, 0x1234);

    const indirect_bus = new FakeCpuBus();
    indirect_bus.load(0x8000, new Uint8Array([0x6c, 0xff, 0x12]));
    indirect_bus.load(0x12ff, new Uint8Array([0x78]));
    indirect_bus.load(0x1200, new Uint8Array([0x56]));
    const indirect_cpu = new Cpu2A03(indirect_bus);
    indirect_cpu.program_counter = 0x8000;

    assert.equal(indirect_cpu.step(), 5);
    assert.equal(indirect_cpu.program_counter, 0x5678);
});

test("JSR pushes the return address and RTS resumes after it", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x20, 0x34, 0x12]));
    bus.load(0x1234, new Uint8Array([0x60]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfd;

    assert.equal(cpu.step(), 6);
    assert.equal(cpu.program_counter, 0x1234);
    assert.equal(cpu.stack_pointer, 0xfb);
    assert.equal(bus.peek(0x01fd), 0x80);
    assert.equal(bus.peek(0x01fc), 0x02);
    assert.deepEqual(
        bus.accesses.map(({ kind, address }) => [kind, address]),
        [
            ["read", 0x8000],
            ["read", 0x8001],
            ["read", 0x01fd],
            ["write", 0x01fd],
            ["write", 0x01fc],
            ["read", 0x8002],
        ],
    );

    bus.clear_trace();
    assert.equal(cpu.step(), 6);
    assert.equal(cpu.program_counter, 0x8003);
    assert.equal(cpu.stack_pointer, 0xfd);
    assert.deepEqual(
        bus.accesses.map(({ kind, address }) => [kind, address]),
        [
            ["read", 0x1234],
            ["read", 0x1235],
            ["read", 0x01fb],
            ["read", 0x01fc],
            ["read", 0x01fd],
            ["read", 0x8002],
        ],
    );
});

test("BRK pushes PC and break status before loading the IRQ vector", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x00, 0xea]));
    bus.load(0xfffe, new Uint8Array([0x34, 0x12]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfd;
    cpu.status = UNUSED_FLAG | CARRY_FLAG;

    assert.equal(cpu.step(), 7);
    assert.equal(cpu.program_counter, 0x1234);
    assert.equal(cpu.stack_pointer, 0xfa);
    assert.equal(bus.peek(0x01fd), 0x80);
    assert.equal(bus.peek(0x01fc), 0x02);
    assert.equal(bus.peek(0x01fb), UNUSED_FLAG | BREAK_FLAG | CARRY_FLAG);
    assert.equal(has_status_flag(cpu.status, INTERRUPT_DISABLE_FLAG), true);
    assert.deepEqual(
        bus.accesses.map(({ kind, address }) => [kind, address]),
        [
            ["read", 0x8000],
            ["read", 0x8001],
            ["write", 0x01fd],
            ["write", 0x01fc],
            ["write", 0x01fb],
            ["read", 0xfffe],
            ["read", 0xffff],
        ],
    );
});

test("RTI restores stacked status and program counter", () => {
    const bus = new FakeCpuBus();
    bus.load(0x8000, new Uint8Array([0x40]));
    bus.load(0x01fb, new Uint8Array([0xff, 0x34, 0x12]));
    const cpu = new Cpu2A03(bus);
    cpu.program_counter = 0x8000;
    cpu.stack_pointer = 0xfa;

    assert.equal(cpu.step(), 6);
    assert.equal(cpu.program_counter, 0x1234);
    assert.equal(cpu.stack_pointer, 0xfd);
    assert.equal(cpu.status, 0xef);
    assert.deepEqual(
        bus.accesses.map(({ kind, address }) => [kind, address]),
        [
            ["read", 0x8000],
            ["read", 0x8001],
            ["read", 0x01fa],
            ["read", 0x01fb],
            ["read", 0x01fc],
            ["read", 0x01fd],
        ],
    );
});

test("PHA, PHP, PLA, and PLP use stack cycles and normalize status", () => {
    const push_bus = new FakeCpuBus();
    push_bus.load(0x8000, new Uint8Array([0x48, 0x08]));
    const push_cpu = new Cpu2A03(push_bus);
    push_cpu.program_counter = 0x8000;
    push_cpu.stack_pointer = 0xfd;
    push_cpu.a = 0x5a;
    push_cpu.status = UNUSED_FLAG | CARRY_FLAG;

    assert.equal(push_cpu.step(), 3);
    assert.equal(push_bus.peek(0x01fd), 0x5a);
    assert.equal(push_cpu.step(), 3);
    assert.equal(push_bus.peek(0x01fc), UNUSED_FLAG | BREAK_FLAG | CARRY_FLAG);
    assert.equal(push_cpu.stack_pointer, 0xfb);

    const pull_bus = new FakeCpuBus();
    pull_bus.load(0x8000, new Uint8Array([0x28, 0x68]));
    pull_bus.load(0x01fc, new Uint8Array([0xff, 0x80]));
    const pull_cpu = new Cpu2A03(pull_bus);
    pull_cpu.program_counter = 0x8000;
    pull_cpu.stack_pointer = 0xfb;

    assert.equal(pull_cpu.step(), 4);
    assert.equal(pull_cpu.status, 0xef);
    assert.equal(pull_cpu.step(), 4);
    assert.equal(pull_cpu.a, 0x80);
    assert.equal(pull_cpu.stack_pointer, 0xfd);
    assert.equal(has_status_flag(pull_cpu.status, NEGATIVE_FLAG), true);
});
