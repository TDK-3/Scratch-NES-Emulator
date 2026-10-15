import type { NesConsoleBatteryRamSnapshot } from "../core/nes_console.js";

export interface BrowserKeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const STORAGE_KEY_PREFIX = "scratch-nes-emulator:battery:v1:";
const SAVE_FORMAT_VERSION = "2";
const LEGACY_SAVE_FORMAT_VERSION = "1";
const MAX_SUPPORTED_PRG_NVRAM_BYTES = 0x2000;
const MAX_SUPPORTED_CHR_NVRAM_BYTES = 0x20_0000;
const SHA256_HEX_LENGTH = 64;
const HEX_BYTES_PER_BYTE = 2;

/** Versioned, ROM-keyed persistent storage for mapper-declared PRG and CHR NVRAM snapshots. */
export class NesBrowserBatteryRamStore {
    readonly #storage: BrowserKeyValueStorage | null;

    constructor(storage: BrowserKeyValueStorage | null) {
        this.#storage = storage;
    }

    /** Returns whether a synchronous browser storage provider was available at construction time. */
    is_available(): boolean {
        return this.#storage !== null;
    }

    /** Loads a validated ROM snapshot; malformed or size-mismatched records are deleted. */
    load(
        rom_fingerprint: string,
        expected_prg_byte_length: number,
        expected_chr_byte_length: number,
    ): NesConsoleBatteryRamSnapshot | null {
        assert_rom_fingerprint(rom_fingerprint);
        assert_byte_length(expected_prg_byte_length, "PRG", MAX_SUPPORTED_PRG_NVRAM_BYTES);
        assert_byte_length(expected_chr_byte_length, "CHR", MAX_SUPPORTED_CHR_NVRAM_BYTES);

        if (this.#storage === null) {
            return null;
        }

        const key = get_storage_key(rom_fingerprint);

        if (expected_prg_byte_length + expected_chr_byte_length === 0) {
            this.#storage.removeItem(key);
            return null;
        }

        const record = this.#storage.getItem(key);

        if (record === null) {
            return null;
        }

        const fields = record.split(":");

        if (fields[0] === LEGACY_SAVE_FORMAT_VERSION && fields.length === 3) {
            const legacy_prg_nvram = decode_region(fields[1], fields[2], expected_prg_byte_length);

            if (legacy_prg_nvram === null) {
                this.#storage.removeItem(key);
                return null;
            }

            return {
                prg_nvram: legacy_prg_nvram,
                chr_nvram: new Uint8Array(expected_chr_byte_length),
            };
        }

        if (fields[0] !== SAVE_FORMAT_VERSION || fields.length !== 5) {
            this.#storage.removeItem(key);
            return null;
        }

        const prg_nvram = decode_region(fields[1], fields[2], expected_prg_byte_length);
        const chr_nvram = decode_region(fields[3], fields[4], expected_chr_byte_length);

        if (prg_nvram === null || chr_nvram === null) {
            this.#storage.removeItem(key);
            return null;
        }

        return { prg_nvram, chr_nvram };
    }

    /** Saves copied PRG/CHR regions; empty snapshots remove obsolete records for that ROM. */
    save(rom_fingerprint: string, snapshot: NesConsoleBatteryRamSnapshot): void {
        assert_rom_fingerprint(rom_fingerprint);
        assert_byte_length(snapshot.prg_nvram.byteLength, "PRG", MAX_SUPPORTED_PRG_NVRAM_BYTES);
        assert_byte_length(snapshot.chr_nvram.byteLength, "CHR", MAX_SUPPORTED_CHR_NVRAM_BYTES);

        if (this.#storage === null) {
            return;
        }

        const key = get_storage_key(rom_fingerprint);

        if (snapshot.prg_nvram.byteLength + snapshot.chr_nvram.byteLength === 0) {
            this.#storage.removeItem(key);
            return;
        }

        const prg_hex = encode_region(snapshot.prg_nvram);
        const chr_hex = encode_region(snapshot.chr_nvram);
        this.#storage.setItem(
            key,
            `${SAVE_FORMAT_VERSION}:${snapshot.prg_nvram.byteLength}:${prg_hex}:` +
                `${snapshot.chr_nvram.byteLength}:${chr_hex}`,
        );
    }
}

/** Computes a stable SHA-256 identity so save data is isolated per exact ROM image. */
export async function fingerprint_rom(rom_bytes: Uint8Array): Promise<string> {
    const subtle_crypto = globalThis.crypto?.subtle;

    if (subtle_crypto === undefined) {
        throw new Error("Web Crypto is unavailable; this ROM cannot be keyed for persistent battery RAM.");
    }

    const input = new Uint8Array(rom_bytes.byteLength);
    input.set(rom_bytes);
    const digest = await subtle_crypto.digest("SHA-256", input.buffer as ArrayBuffer);
    const digest_bytes = new Uint8Array(digest);
    let fingerprint = "";

    for (const value of digest_bytes) {
        fingerprint += value.toString(16).padStart(2, "0");
    }

    return fingerprint;
}

function decode_region(
    encoded_length: string | undefined,
    encoded_bytes: string | undefined,
    expected_byte_length: number,
): Uint8Array | null {
    if (
        encoded_length === undefined ||
        encoded_bytes === undefined ||
        Number(encoded_length) !== expected_byte_length ||
        encoded_bytes.length !== expected_byte_length * HEX_BYTES_PER_BYTE ||
        !/^[0-9a-f]*$/i.test(encoded_bytes)
    ) {
        return null;
    }

    const bytes = new Uint8Array(expected_byte_length);

    for (let byte_index = 0; byte_index < bytes.length; byte_index += 1) {
        const hex_start = byte_index * HEX_BYTES_PER_BYTE;
        bytes[byte_index] = Number.parseInt(encoded_bytes.slice(hex_start, hex_start + 2), 16);
    }

    return bytes;
}

function encode_region(bytes: Uint8Array): string {
    let encoded = "";

    for (const value of bytes) {
        encoded += value.toString(16).padStart(2, "0");
    }

    return encoded;
}

function assert_rom_fingerprint(fingerprint: string): void {
    if (fingerprint.length !== SHA256_HEX_LENGTH || !/^[0-9a-f]{64}$/.test(fingerprint)) {
        throw new RangeError("ROM fingerprint must be a lowercase SHA-256 hex string.");
    }
}

function assert_byte_length(byte_length: number, region: "PRG" | "CHR", maximum: number): void {
    if (!Number.isSafeInteger(byte_length) || byte_length < 0 || byte_length > maximum) {
        throw new RangeError(
            `${region} NVRAM byte length must be an integer from zero through ${maximum}.`,
        );
    }
}

function get_storage_key(rom_fingerprint: string): string {
    return `${STORAGE_KEY_PREFIX}${rom_fingerprint}`;
}
