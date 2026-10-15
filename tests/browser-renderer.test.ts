import assert from "node:assert/strict";
import test from "node:test";

import {
    calculate_pixel_preserving_size,
    framebuffer_to_rgba,
    NES_FRAME_PIXEL_COUNT,
    NES_FRAME_WIDTH,
    NES_FRAME_HEIGHT,
    NesCanvasRenderer,
} from "../src/nes/browser/canvas_renderer.js";

const RGBA_PIXEL_COUNT = NES_FRAME_PIXEL_COUNT * 4;

test("converts PPU palette indices and emphasis into opaque RGBA pixels", () => {
    const framebuffer = new Uint8Array(NES_FRAME_PIXEL_COUNT);
    const emphasis = new Uint8Array(NES_FRAME_PIXEL_COUNT);
    const output = new Uint8ClampedArray(RGBA_PIXEL_COUNT);

    framebuffer[0] = 0;
    framebuffer[1] = 32;
    emphasis[1] = 0x02;
    framebuffer[2] = 1;
    emphasis[2] = 0x01;
    framebuffer[NES_FRAME_PIXEL_COUNT - 1] = 63;

    const converted = framebuffer_to_rgba(framebuffer, emphasis, output);

    assert.equal(converted, output);
    assert.deepEqual(Array.from(converted.subarray(0, 4)), [84, 84, 84, 255]);
    assert.deepEqual(Array.from(converted.subarray(4, 8)), [177, 238, 177, 255]);
    assert.deepEqual(Array.from(converted.subarray(8, 12)), [0, 23, 87, 255]);
    assert.deepEqual(Array.from(converted.subarray(-4)), [0, 0, 0, 255]);
});

test("rejects malformed frame planes, output buffers, palette indices, and emphasis bits", () => {
    const framebuffer = new Uint8Array(NES_FRAME_PIXEL_COUNT);
    const emphasis = new Uint8Array(NES_FRAME_PIXEL_COUNT);

    assert.throws(() => framebuffer_to_rgba(new Uint8Array(1), emphasis), /must each contain/);
    assert.throws(() => framebuffer_to_rgba(framebuffer, emphasis, new Uint8ClampedArray(1)), /RGBA output/);

    framebuffer[0] = 64;
    assert.throws(() => framebuffer_to_rgba(framebuffer, emphasis), /palette index/);

    framebuffer[0] = 0;
    emphasis[0] = 8;
    assert.throws(() => framebuffer_to_rgba(framebuffer, emphasis), /emphasis/);
});

test("chooses only integer CSS scales so the NES image stays pixel preserving", () => {
    assert.deepEqual(calculate_pixel_preserving_size(1_000, 900), {
        scale: 3,
        width: 768,
        height: 720,
    });
    assert.deepEqual(calculate_pixel_preserving_size(600, 480), {
        scale: 2,
        width: 512,
        height: 480,
    });
    assert.deepEqual(calculate_pixel_preserving_size(128, 120), {
        scale: 1,
        width: NES_FRAME_WIDTH,
        height: NES_FRAME_HEIGHT,
    });
    assert.throws(() => calculate_pixel_preserving_size(0, 480), /width must be positive/);
    assert.throws(() => calculate_pixel_preserving_size(512, Number.POSITIVE_INFINITY), /height must be positive/);
});

test("sets a native-size canvas, disables smoothing, and copies converted pixels to its context", () => {
    const image_data = {
        width: NES_FRAME_WIDTH,
        height: NES_FRAME_HEIGHT,
        data: new Uint8ClampedArray(RGBA_PIXEL_COUNT),
    } as ImageData;
    const drawn_images: ImageData[] = [];
    const context = {
        imageSmoothingEnabled: true,
        createImageData: (width: number, height: number) => {
            assert.equal(width, NES_FRAME_WIDTH);
            assert.equal(height, NES_FRAME_HEIGHT);
            return image_data;
        },
        putImageData: (image: ImageData, x: number, y: number) => {
            assert.equal(x, 0);
            assert.equal(y, 0);
            drawn_images.push(image);
        },
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
        width: 0,
        height: 0,
        style: { imageRendering: "" },
        getContext: () => context,
    } as unknown as HTMLCanvasElement;
    const renderer = new NesCanvasRenderer(canvas);

    assert.equal(canvas.width, NES_FRAME_WIDTH);
    assert.equal(canvas.height, NES_FRAME_HEIGHT);
    assert.equal(canvas.style.imageRendering, "pixelated");
    assert.equal(context.imageSmoothingEnabled, false);

    const framebuffer = new Uint8Array(NES_FRAME_PIXEL_COUNT);
    const emphasis = new Uint8Array(NES_FRAME_PIXEL_COUNT);
    framebuffer[0] = 32;
    renderer.render(framebuffer, emphasis);
    assert.equal(drawn_images.length, 1);
    assert.deepEqual(Array.from(image_data.data.subarray(0, 4)), [236, 238, 236, 255]);

    assert.deepEqual(renderer.fit_to_size(1_000, 900), { scale: 3, width: 768, height: 720 });
    assert.equal(canvas.style.width, "768px");
    assert.equal(canvas.style.height, "720px");
});
