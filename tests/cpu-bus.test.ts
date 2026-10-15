import assert from "node:assert/strict";
import test from "node:test";

import { FakeCpuBus } from "./support/FakeCpuBus.js";

test("reads and writes preserve byte values and ordered bus accesses", () => {
    const bus = new FakeCpuBus();

    assert.equal(bus.read_cpu(0x0000), 0);
    bus.write_cpu(0x7fff, 0x34);
    bus.write_cpu(0xffff, 0xaa);

    assert.equal(bus.read_cpu(0x7fff), 0x34);
    assert.equal(bus.read_cpu(0xffff), 0xaa);
    assert.deepEqual(bus.accesses, [
        { kind: "read", address: 0x0000, value: 0 },
        { kind: "write", address: 0x7fff, value: 0x34 },
        { kind: "write", address: 0xffff, value: 0xaa },
        { kind: "read", address: 0x7fff, value: 0x34 },
        { kind: "read", address: 0xffff, value: 0xaa },
    ]);
});

test("loads test programs without adding setup writes to the access trace", () => {
    const bus = new FakeCpuBus();

    bus.load(0xfffe, new Uint8Array([0x34, 0x12]));

    assert.equal(bus.peek(0xfffe), 0x34);
    assert.equal(bus.peek(0xffff), 0x12);
    assert.deepEqual(bus.accesses, []);
});

test("rejects address and value violations instead of hiding CPU bugs", () => {
    const bus = new FakeCpuBus();

    assert.throws(() => bus.read_cpu(-1), RangeError);
    assert.throws(() => bus.read_cpu(0x1_0000), RangeError);
    assert.throws(() => bus.write_cpu(0x1_0000, 0), RangeError);
    assert.throws(() => bus.write_cpu(0x0000, 0x100), RangeError);
    assert.throws(() => bus.load(0xffff, new Uint8Array([0x01, 0x02])), RangeError);
});

test("clears the access trace without changing memory", () => {
    const bus = new FakeCpuBus();

    bus.write_cpu(0x1234, 0x56);
    bus.clear_trace();

    assert.equal(bus.peek(0x1234), 0x56);
    assert.deepEqual(bus.accesses, []);
});
