export const PPU_FRAME_WIDTH = 256;
export const PPU_FRAME_HEIGHT = 240;
export const PPU_FRAME_PIXEL_COUNT = PPU_FRAME_WIDTH * PPU_FRAME_HEIGHT;
const PPU_COLOR_INDEX_MAX = 0x3f;
const PPU_EMPHASIS_MAX = 0x07;

export interface PpuFramebufferPixel {
    readonly color_index: number;
    /** NTSC PPUMASK emphasis bits 5-7, stored independently of the six-bit palette index. */
    readonly emphasis: number;
}

/** Deterministic 256 by 240 PPU output, preserving palette index and per-pixel emphasis separately. */
export class PpuFramebuffer {
    readonly #color_indices = new Uint8Array(PPU_FRAME_PIXEL_COUNT);
    readonly #emphasis_values = new Uint8Array(PPU_FRAME_PIXEL_COUNT);

    /** Clears both output planes to palette color zero and no emphasis. */
    clear(): void {
        this.#color_indices.fill(0);
        this.#emphasis_values.fill(0);
    }

    /** Stores one six-bit palette output and its three emphasis bits. */
    set_pixel(x: number, y: number, color_index: number, emphasis: number): void {
        assert_pixel_coordinates(x, y);
        assert_color_index(color_index);
        assert_emphasis(emphasis);
        const pixel_index = y * PPU_FRAME_WIDTH + x;

        this.#color_indices[pixel_index] = color_index;
        this.#emphasis_values[pixel_index] = emphasis;
    }

    /** Returns one framebuffer pixel without exposing the backing arrays. */
    read_pixel(x: number, y: number): PpuFramebufferPixel {
        assert_pixel_coordinates(x, y);
        const pixel_index = y * PPU_FRAME_WIDTH + x;
        const color_index = this.#color_indices[pixel_index];
        const emphasis = this.#emphasis_values[pixel_index];

        if (color_index === undefined || emphasis === undefined) {
            throw new RangeError(`Framebuffer pixel (${x}, ${y}) is outside its storage.`);
        }

        return { color_index, emphasis };
    }

    /** Returns a copy of the row-major six-bit palette-index plane. */
    get_color_indices(): Uint8Array {
        return this.#color_indices.slice();
    }

    /** Returns a copy of the row-major three-bit emphasis plane. */
    get_emphasis_values(): Uint8Array {
        return this.#emphasis_values.slice();
    }
}

function assert_pixel_coordinates(x: number, y: number): void {
    if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        x < 0 ||
        x >= PPU_FRAME_WIDTH ||
        y < 0 ||
        y >= PPU_FRAME_HEIGHT
    ) {
        throw new RangeError(`Framebuffer coordinates (${x}, ${y}) are outside the 256 by 240 image.`);
    }
}

function assert_color_index(color_index: number): void {
    if (!Number.isInteger(color_index) || color_index < 0 || color_index > PPU_COLOR_INDEX_MAX) {
        throw new RangeError(`PPU color index ${color_index} is outside the six-bit palette range.`);
    }
}

function assert_emphasis(emphasis: number): void {
    if (!Number.isInteger(emphasis) || emphasis < 0 || emphasis > PPU_EMPHASIS_MAX) {
        throw new RangeError(`PPU emphasis ${emphasis} is outside the three-bit range.`);
    }
}
