export const NES_FRAME_WIDTH = 256;
export const NES_FRAME_HEIGHT = 240;
export const NES_FRAME_PIXEL_COUNT = NES_FRAME_WIDTH * NES_FRAME_HEIGHT;

const RGBA_COMPONENT_COUNT = 4;
const PALETTE_CHANNEL_COUNT = 3;
const EMPHASIS_MASK = 0x07;
const COLOR_INDEX_MASK = 0x3f;
const EMPHASIS_DIMMING = 0.75;

// Common NTSC 2C02 RGB approximation; it is not a calibrated display or colorimetry claim.
const NES_PALETTE_RGB = new Uint8Array([
    84, 84, 84, 0, 30, 116, 8, 16, 144, 48, 0, 136,
    68, 0, 100, 92, 0, 48, 84, 4, 0, 60, 24, 0,
    32, 42, 0, 8, 58, 0, 0, 64, 0, 0, 60, 0,
    0, 50, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    152, 150, 152, 8, 76, 196, 48, 50, 236, 92, 30, 228,
    136, 20, 176, 160, 20, 100, 152, 34, 32, 120, 60, 0,
    84, 90, 0, 40, 114, 0, 8, 124, 0, 0, 118, 40,
    0, 102, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    236, 238, 236, 76, 154, 236, 120, 124, 236, 176, 98, 236,
    228, 84, 236, 236, 88, 180, 236, 106, 100, 212, 136, 32,
    160, 170, 0, 116, 196, 0, 76, 208, 32, 56, 204, 108,
    56, 180, 204, 60, 60, 60, 0, 0, 0, 0, 0, 0,
    236, 238, 236, 168, 204, 236, 188, 188, 236, 212, 178, 236,
    236, 174, 236, 236, 174, 212, 236, 180, 176, 228, 196, 144,
    204, 210, 120, 180, 222, 120, 168, 226, 144, 152, 226, 180,
    160, 214, 228, 160, 162, 160, 0, 0, 0, 0, 0, 0,
]);

export interface PixelPreservingCanvasSize {
    readonly scale: number;
    readonly width: number;
    readonly height: number;
}

/** Returns an integer CSS scale so each source pixel maps to an integer-sized screen block. */
export function calculate_pixel_preserving_size(
    available_width: number,
    available_height: number,
): PixelPreservingCanvasSize {
    if (!Number.isFinite(available_width) || available_width <= 0) {
        throw new RangeError(`Available canvas width must be positive and finite; received ${available_width}.`);
    }

    if (!Number.isFinite(available_height) || available_height <= 0) {
        throw new RangeError(`Available canvas height must be positive and finite; received ${available_height}.`);
    }

    const scale = Math.max(
        1,
        Math.floor(Math.min(available_width / NES_FRAME_WIDTH, available_height / NES_FRAME_HEIGHT)),
    );

    return {
        scale,
        width: NES_FRAME_WIDTH * scale,
        height: NES_FRAME_HEIGHT * scale,
    };
}

/** Converts 6-bit PPU palette indices and emphasis bits to opaque RGBA pixels. */
export function framebuffer_to_rgba(
    framebuffer: Uint8Array,
    emphasis: Uint8Array,
    output: Uint8ClampedArray = new Uint8ClampedArray(NES_FRAME_PIXEL_COUNT * RGBA_COMPONENT_COUNT),
): Uint8ClampedArray {
    if (framebuffer.length !== NES_FRAME_PIXEL_COUNT || emphasis.length !== NES_FRAME_PIXEL_COUNT) {
        throw new RangeError(
            `NES frame planes must each contain ${NES_FRAME_PIXEL_COUNT} pixels; ` +
                `received ${framebuffer.length} and ${emphasis.length}.`,
        );
    }

    if (output.length !== NES_FRAME_PIXEL_COUNT * RGBA_COMPONENT_COUNT) {
        throw new RangeError(`RGBA output must contain ${NES_FRAME_PIXEL_COUNT * RGBA_COMPONENT_COUNT} bytes.`);
    }

    for (let pixel_index = 0; pixel_index < NES_FRAME_PIXEL_COUNT; pixel_index += 1) {
        const color_index = framebuffer[pixel_index];
        const emphasis_bits = emphasis[pixel_index];

        if (color_index === undefined || color_index > COLOR_INDEX_MASK) {
            throw new RangeError(`NES palette index at pixel ${pixel_index} must be between 0 and 63.`);
        }

        if (emphasis_bits === undefined || emphasis_bits > EMPHASIS_MASK) {
            throw new RangeError(`NES emphasis at pixel ${pixel_index} must be between 0 and 7.`);
        }

        const palette_offset = color_index * PALETTE_CHANNEL_COUNT;
        let red = NES_PALETTE_RGB[palette_offset];
        let green = NES_PALETTE_RGB[palette_offset + 1];
        let blue = NES_PALETTE_RGB[palette_offset + 2];

        if (red === undefined || green === undefined || blue === undefined) {
            throw new Error(`NES RGB palette is missing color index ${color_index}.`);
        }

        if ((emphasis_bits & 0x01) !== 0) {
            green = dim_channel(green);
            blue = dim_channel(blue);
        }

        if ((emphasis_bits & 0x02) !== 0) {
            red = dim_channel(red);
            blue = dim_channel(blue);
        }

        if ((emphasis_bits & 0x04) !== 0) {
            red = dim_channel(red);
            green = dim_channel(green);
        }

        const output_offset = pixel_index * RGBA_COMPONENT_COUNT;
        output[output_offset] = red;
        output[output_offset + 1] = green;
        output[output_offset + 2] = blue;
        output[output_offset + 3] = 0xff;
    }

    return output;
}

/** Draws the indexed frame into a native-resolution canvas with browser interpolation disabled. */
export class NesCanvasRenderer {
    readonly #canvas: HTMLCanvasElement;
    readonly #context: CanvasRenderingContext2D;
    readonly #image_data: ImageData;

    constructor(canvas: HTMLCanvasElement) {
        this.#canvas = canvas;
        this.#canvas.width = NES_FRAME_WIDTH;
        this.#canvas.height = NES_FRAME_HEIGHT;
        this.#canvas.style.imageRendering = "pixelated";

        const context = this.#canvas.getContext("2d", { alpha: false });

        if (context === null) {
            throw new Error("The browser did not provide a 2D canvas context.");
        }

        context.imageSmoothingEnabled = false;
        this.#context = context;
        this.#image_data = context.createImageData(NES_FRAME_WIDTH, NES_FRAME_HEIGHT);
    }

    render(framebuffer: Uint8Array, emphasis: Uint8Array): void {
        framebuffer_to_rgba(framebuffer, emphasis, this.#image_data.data);
        this.#context.putImageData(this.#image_data, 0, 0);
    }

    fit_to_size(available_width: number, available_height: number): PixelPreservingCanvasSize {
        const size = calculate_pixel_preserving_size(available_width, available_height);
        this.#canvas.style.width = `${size.width}px`;
        this.#canvas.style.height = `${size.height}px`;
        return size;
    }
}

function dim_channel(channel: number): number {
    return Math.round(channel * EMPHASIS_DIMMING);
}
