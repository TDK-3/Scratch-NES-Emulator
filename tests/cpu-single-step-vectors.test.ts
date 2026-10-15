import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Cpu2A03 } from "../src/nes/cpu/cpu_2a03.js";
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

for (const fixture of fixtures) {
    test(
        `NES 2A03 reference vector ${fixture.vector.name} (${fixture.source_file}#${fixture.source_index})`,
        () => {
            assert.match(fixture.source_sha256, /^[0-9a-f]{64}$/, "pinned upstream file SHA-256");
            assert.ok(Number.isSafeInteger(fixture.source_index) && fixture.source_index >= 0);

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

                assert.equal(bus.accesses.length, previous_access_count + 1, "one bus access per clock cycle");
                assert.equal(cycle.sequence_kind, "instruction");
                assert.equal(cycle.sequence_cycle, index + 1);
                assert.equal(cycle.sequence_completed, index === fixture.vector.cycles.length - 1);
                assert.deepEqual(cycle.access, { kind, address, value });
            }

            assert.equal(bus.accesses.length, fixture.vector.cycles.length, "instruction cycle count");
            assert.deepEqual(
                bus.accesses.map(({ address, value, kind }) => [address, value, kind]),
                fixture.vector.cycles,
                "ordered CPU bus accesses",
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
                "final CPU registers",
            );

            for (const [address, value] of fixture.vector.final.ram) {
                assert.equal(
                    bus.peek(address),
                    value,
                    `final RAM at $${address.toString(16).padStart(4, "0")}`,
                );
            }
        },
    );
}
