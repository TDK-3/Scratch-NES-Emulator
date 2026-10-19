import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/** One shared port-vector record. Input and expected values are flat, 1-indexed in Scratch. */
export interface SharedVector {
    readonly id: number;
    readonly operation: number;
    readonly input: readonly number[];
    readonly expected: readonly number[];
}

export interface SharedVectorSuite {
    readonly id: number;
    readonly name: string;
    readonly vectors: readonly SharedVector[];
}

export interface SharedVectorFixture {
    readonly schema_version: number;
    readonly suites: readonly SharedVectorSuite[];
}

const FIXTURE_PATH = new URL("../fixtures/goboscript/shared_port_vectors.json", import.meta.url);

/** Loads the canonical fixture and returns its text alongside the parsed suites. */
export function load_shared_port_vectors(): { readonly fixture: SharedVectorFixture; readonly text: string } {
    const text = readFileSync(FIXTURE_PATH, "utf8");
    return { fixture: JSON.parse(text) as SharedVectorFixture, text };
}

export const shared_port_vectors = load_shared_port_vectors();
export const shared_port_fixture_text = shared_port_vectors.text;
export const shared_port_fixture = shared_port_vectors.fixture;

export function get_shared_vector_suite(name: string): SharedVectorSuite {
    const suite = shared_port_fixture.suites.find((candidate) => candidate.name === name);
    assert.ok(suite, `Missing shared vector suite ${name}.`);
    return suite;
}

/** Registers one node:test case per record of a suite. */
export function for_each_vector(suite_name: string, run: (vector: SharedVector) => void): void {
    for (const vector of get_shared_vector_suite(suite_name).vectors) {
        test(`shared ${suite_name} vector ${vector.id}`, () => run(vector));
    }
}

/** Returns one vector input, failing when the record is shorter than the suite contract. */
export function vector_input(vector: SharedVector, index: number): number {
    const value = vector.input[index];
    assert.ok(value !== undefined, `Suite vector ${vector.id} is missing input ${index}.`);
    return value;
}

/** Returns one vector input when present, for records whose shape depends on the operation. */
export function optional_vector_input(vector: SharedVector, index: number): number | undefined {
    return vector.input[index];
}
