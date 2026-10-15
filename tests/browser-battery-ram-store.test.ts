import assert from "node:assert/strict";
import test from "node:test";

import {
    NesBrowserBatteryRamStore,
    fingerprint_rom,
} from "../src/nes/browser/battery_ram_store.js";
import type { BrowserKeyValueStorage } from "../src/nes/browser/battery_ram_store.js";

const ROM_A_FINGERPRINT = "a".repeat(64);
const ROM_B_FINGERPRINT = "b".repeat(64);
const STORAGE_KEY_PREFIX = "scratch-nes-emulator:battery:v1:";

class FakeStorage implements BrowserKeyValueStorage {
    readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }
}

test("fingerprints exact ROM bytes with SHA-256", async () => {
    assert.equal(
        await fingerprint_rom(new TextEncoder().encode("abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
});

test("round-trips copied PRG and CHR snapshots under ROM-specific storage keys", () => {
    const storage = new FakeStorage();
    const store = new NesBrowserBatteryRamStore(storage);
    const original_prg = Uint8Array.of(0, 0x7f, 0xff);
    const original_chr = Uint8Array.of(0x12, 0x34);

    store.save(ROM_A_FINGERPRINT, { prg_nvram: original_prg, chr_nvram: original_chr });
    original_prg[0] = 0xff;
    original_chr[0] = 0xff;

    const loaded = store.load(ROM_A_FINGERPRINT, 3, 2);
    assert.deepEqual(loaded, {
        prg_nvram: Uint8Array.of(0, 0x7f, 0xff),
        chr_nvram: Uint8Array.of(0x12, 0x34),
    });
    assert.equal(store.load(ROM_B_FINGERPRINT, 3, 2), null);

    if (loaded === null) {
        assert.fail("Expected the saved battery snapshot.");
    }

    loaded.prg_nvram[1] = 0;
    loaded.chr_nvram[1] = 0;
    assert.deepEqual(store.load(ROM_A_FINGERPRINT, 3, 2), {
        prg_nvram: Uint8Array.of(0, 0x7f, 0xff),
        chr_nvram: Uint8Array.of(0x12, 0x34),
    });
});

test("persists CHR NVRAM larger than the PRG NVRAM window", () => {
    const storage = new FakeStorage();
    const store = new NesBrowserBatteryRamStore(storage);
    const chr_nvram = new Uint8Array(0x2001);
    chr_nvram[0] = 0x12;
    chr_nvram[chr_nvram.byteLength - 1] = 0x34;

    store.save(ROM_A_FINGERPRINT, {
        prg_nvram: new Uint8Array(0),
        chr_nvram,
    });

    assert.deepEqual(store.load(ROM_A_FINGERPRINT, 0, chr_nvram.byteLength), {
        prg_nvram: new Uint8Array(0),
        chr_nvram,
    });
    assert.throws(() => store.load(ROM_A_FINGERPRINT, 0, 0x20_0001), RangeError);
});

test("discards malformed, unsupported-version, and size-mismatched records", () => {
    const storage = new FakeStorage();
    const store = new NesBrowserBatteryRamStore(storage);
    const key = `${STORAGE_KEY_PREFIX}${ROM_A_FINGERPRINT}`;

    storage.setItem(key, "2:2:00xz:0:");
    assert.equal(store.load(ROM_A_FINGERPRINT, 2, 0), null);
    assert.equal(storage.getItem(key), null);

    storage.setItem(key, "3:2:0011:0:");
    assert.equal(store.load(ROM_A_FINGERPRINT, 2, 0), null);
    assert.equal(storage.getItem(key), null);

    storage.setItem(key, "2:1:00:0:");
    assert.equal(store.load(ROM_A_FINGERPRINT, 2, 0), null);
    assert.equal(storage.getItem(key), null);
});

test("migrates valid PRG-only records and handles empty snapshots", () => {
    const storage = new FakeStorage();
    const store = new NesBrowserBatteryRamStore(storage);
    const key = `${STORAGE_KEY_PREFIX}${ROM_A_FINGERPRINT}`;
    storage.setItem(key, "1:2:0011");

    assert.deepEqual(store.load(ROM_A_FINGERPRINT, 2, 0), {
        prg_nvram: Uint8Array.of(0, 0x11),
        chr_nvram: new Uint8Array(0),
    });

    store.save(ROM_A_FINGERPRINT, { prg_nvram: new Uint8Array(0), chr_nvram: new Uint8Array(0) });
    assert.equal(storage.getItem(key), null);
    assert.equal(store.load(ROM_A_FINGERPRINT, 0, 0), null);
});

test("handles unavailable storage without touching records and validates sizes", () => {
    const unavailable_store = new NesBrowserBatteryRamStore(null);
    assert.equal(unavailable_store.is_available(), false);
    assert.equal(unavailable_store.load(ROM_A_FINGERPRINT, 1, 1), null);
    assert.doesNotThrow(() =>
        unavailable_store.save(ROM_A_FINGERPRINT, {
            prg_nvram: Uint8Array.of(2),
            chr_nvram: Uint8Array.of(3),
        }),
    );

    const store = new NesBrowserBatteryRamStore(new FakeStorage());
    assert.throws(() => store.load("not-a-fingerprint", 1, 0), RangeError);
    assert.throws(() => store.load(ROM_A_FINGERPRINT, 0x2001, 0), RangeError);
});
