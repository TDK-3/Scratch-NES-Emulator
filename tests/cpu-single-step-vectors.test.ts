import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Cpu2A03 } from "../src/nes/cpu/cpu_2a03.js";
import { CPU_OPCODE_TABLE } from "../src/nes/cpu/opcode_table.js";
import { normalize_status } from "../src/nes/cpu/registers.js";
import { FakeCpuBus } from "./support/FakeCpuBus.js";

interface CpuReferenceState {
    readonly pc: number;
    readonly s: number;
    readonly a: number;
    readonly x: number;
    readonly y: number;
    readonly p: number;
    readonly ram: readonly (readonly [number, number])[];
}

type CpuReferenceCycle = readonly [address: number, value: number, kind: "read" | "write"];

interface CpuReferenceVector {
    readonly name: string;
    readonly initial: CpuReferenceState;
    readonly final: CpuReferenceState;
    readonly cycles: readonly CpuReferenceCycle[];
}

interface CpuReferenceFixture {
    readonly source_file: string;
    readonly source_index: number;
    readonly source_sha256: string;
    readonly vector: CpuReferenceVector;
}

const fixtures = JSON.parse(
    readFileSync(new URL("./fixtures/nes6502/vectors.json", import.meta.url), "utf8"),
) as readonly CpuReferenceFixture[];

const manifest_text = readFileSync(new URL("./fixtures/nes6502/SOURCE_MANIFEST.sha256", import.meta.url), "utf8");

const manifest_hashes = new Map(
    manifest_text
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
            const [sha256, source_file] = line.split("  ");
            assert.match(sha256 ?? "", /^[0-9a-f]{64}$/, "manifest hash");
            assert.ok(source_file !== undefined && source_file.length > 0, "manifest source file");
            return [source_file, sha256] as const;
        }),
);

/** Runs one upstream single-step scenario cycle by cycle against the production CPU core. */
function run_reference_vector(fixture: CpuReferenceFixture): void {
    const label = `${fixture.vector.name} (${fixture.source_file}#${fixture.source_index})`;

    assert.match(fixture.source_sha256, /^[0-9a-f]{64}$/, `${label}: pinned upstream file SHA-256`);
    assert.equal(manifest_hashes.get(fixture.source_file), fixture.source_sha256, `${label}: manifest hash`);
    assert.ok(Number.isSafeInteger(fixture.source_index) && fixture.source_index >= 0, `${label}: source index`);

    const opcode = Number.parseInt(fixture.vector.name.split(" ")[0] ?? "", 16);
    assert.ok(Number.isInteger(opcode) && opcode >= 0 && opcode <= 0xff, `${label}: opcode byte in the vector name`);
    const is_jam_opcode = CPU_OPCODE_TABLE.get(opcode)?.mnemonic === "KIL";

    const bus = new FakeCpuBus();

    for (const [address, value] of fixture.vector.initial.ram) {
        bus.load(address, Uint8Array.of(value));
    }

    const cpu = new Cpu2A03(bus);
    cpu.program_counter = fixture.vector.initial.pc;
    cpu.stack_pointer = fixture.vector.initial.s;
    cpu.a = fixture.vector.initial.a;
    cpu.x = fixture.vector.initial.x;
    cpu.y = fixture.vector.initial.y;
    cpu.status = normalize_status(fixture.vector.initial.p);

    for (const [index, [address, value, kind]] of fixture.vector.cycles.entries()) {
        const previous_access_count = bus.accesses.length;
        const cycle = cpu.clock_cycle();

        assert.equal(bus.accesses.length, previous_access_count + 1, `${label}: one bus access per clock cycle`);
        assert.deepEqual(cycle.access, { kind, address, value }, `${label}: cycle ${index + 1} access`);

        if (!is_jam_opcode) {
            assert.equal(cycle.sequence_kind, "instruction", `${label}: cycle ${index + 1} sequence kind`);
            assert.equal(cycle.sequence_cycle, index + 1, `${label}: cycle ${index + 1} sequence position`);
            assert.equal(
                cycle.sequence_completed,
                index === fixture.vector.cycles.length - 1,
                `${label}: cycle ${index + 1} completion`,
            );
            continue;
        }

        // A jam opcode fetches its two bytes as one instruction sequence, then issues bounded jam sequences.
        if (index < 2) {
            assert.equal(cycle.sequence_kind, "instruction", `${label}: jam opcode fetch cycle ${index + 1}`);
            assert.equal(cycle.sequence_cycle, index + 1, `${label}: jam opcode fetch position ${index + 1}`);
            assert.equal(cycle.sequence_completed, index === 1, `${label}: jam opcode fetch completion`);
        } else {
            assert.equal(cycle.sequence_kind, "jam", `${label}: cycle ${index + 1} jam sequence kind`);
        }
    }

    assert.equal(bus.accesses.length, fixture.vector.cycles.length, `${label}: instruction cycle count`);
    assert.deepEqual(
        bus.accesses.map(({ address, value, kind }) => [address, value, kind]),
        fixture.vector.cycles,
        `${label}: ordered CPU bus accesses`,
    );
    assert.deepEqual(
        {
            pc: cpu.program_counter,
            s: cpu.stack_pointer,
            a: cpu.a,
            x: cpu.x,
            y: cpu.y,
            p: cpu.status,
        },
        {
            pc: fixture.vector.final.pc,
            s: fixture.vector.final.s,
            a: fixture.vector.final.a,
            x: fixture.vector.final.x,
            y: fixture.vector.final.y,
            p: normalize_status(fixture.vector.final.p),
        },
        `${label}: final CPU registers`,
    );

    for (const [address, value] of fixture.vector.final.ram) {
        assert.equal(bus.peek(address), value, `${label}: final RAM at $${address.toString(16).padStart(4, "0")}`);
    }
}

test("the pinned reference fixture covers every 2A03 opcode byte", () => {
    assert.ok(fixtures.length > 0, "the fixture must not be empty");

    const covered_opcodes = new Set(
        fixtures.map((fixture) => {
            const opcode = Number.parseInt(fixture.vector.name.split(" ")[0] ?? "", 16);
            assert.ok(Number.isInteger(opcode), `${fixture.source_file}: opcode byte in the vector name`);
            return opcode;
        }),
    );

    assert.equal(covered_opcodes.size, 0x100, "distinct opcode bytes covered");
    assert.equal(manifest_hashes.size, 0x100, "manifest entries");
    assert.equal(
        fixtures.filter((fixture) => fixture.source_sha256 !== manifest_hashes.get(fixture.source_file)).length,
        0,
        "fixture hashes that disagree with the manifest",
    );
});

const grouped_fixtures = new Map<string, CpuReferenceFixture[]>();

for (const fixture of fixtures) {
    const group = grouped_fixtures.get(fixture.source_file);

    if (group === undefined) {
        grouped_fixtures.set(fixture.source_file, [fixture]);
    } else {
        group.push(fixture);
    }
}

for (const [source_file, group] of [...grouped_fixtures.entries()].sort()) {
    test(`NES 2A03 reference vectors for ${source_file} (${group.length} pinned scenarios)`, () => {
        for (const fixture of group) {
            run_reference_vector(fixture);
        }
    });
}
