import { describe, expect, it } from "vitest";
import { autoLevel, flatten } from "../../src/paper/flatten";
import { bilinear, type Quad } from "../../src/paper/quad";
import type { Rgba } from "../../src/sam/cutout";

const img = (w: number, h: number, px: (x: number, y: number) => number[]): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), 4 * (y * w + x));
  return { data, width: w, height: h };
};
const at = (im: Rgba, x: number, y: number) => [...im.data.subarray(4 * (y * im.width + x), 4 * (y * im.width + x) + 4)];
const quad = (...xy: number[]): Quad => [0, 1, 2, 3].map((i) => ({ x: xy[2 * i], y: xy[2 * i + 1] })) as Quad;
const grey = (w: number, h: number): Rgba => ({ data: new Uint8ClampedArray(w * h * 4).fill(200), width: w, height: h });

describe("flatten", () => {
  it("returns the photo unchanged for the identity quad", () => {
    const src = img(6, 4, (x, y) => [x * 40, y * 60, (x * y * 13) % 256, 255]);
    const out = flatten(src, quad(0, 0, 6, 0, 6, 4, 0, 4));
    expect([out.width, out.height]).toEqual([6, 4]);
    expect([...out.data]).toEqual([...src.data]);
  });

  it("rotates the photo when the paper's top-left is the photo's top-right", () => {
    const src = img(4, 3, (x, y) => [x * 60, y * 100, 7, 255]);
    const out = flatten(src, quad(4, 0, 4, 3, 0, 3, 0, 0));
    expect([out.width, out.height]).toEqual([3, 4]);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) expect(at(out, i, j)).toEqual(at(src, 3 - j, i));
  });

  it("samples a skewed quad at bilinear(q, u, v) with bilinear pixel interpolation", () => {
    const src = img(200, 200, (x, y) => [x, y, 0, 255]); // R = x, G = y, so a sample reads back its position
    const q = quad(20, 30, 170, 10, 190, 160, 10, 180);
    const out = flatten(src, q);
    expect([out.width, out.height]).toEqual([166, 151]); // mean opposite side lengths 166.2 and 150.8
    for (let j = 0; j < out.height; j++) {
      for (let i = 0; i < out.width; i++) {
        const p = bilinear(q, (i + 0.5) / out.width, (j + 0.5) / out.height), [r, g, , a] = at(out, i, j);
        expect(Math.abs(r - (p.x - 0.5))).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(g - (p.y - 0.5))).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(a).toBe(255);
      }
    }
  });

  it("caps the long side at 1024 (or maxSide) keeping the shape, and never upscales", () => {
    const src = grey(2048, 1200);
    const land = flatten(src, quad(0, 0, 2048, 0, 2048, 1200, 0, 1200));
    expect([land.width, land.height]).toEqual([1024, 600]);
    expect(at(land, 1023, 599)).toEqual([200, 200, 200, 200]);
    const port = flatten(src, quad(2048, 0, 2048, 1200, 0, 1200, 0, 0));
    expect([port.width, port.height]).toEqual([600, 1024]);
    const small = flatten(src, quad(0, 0, 2048, 0, 2048, 1200, 0, 1200), 512);
    expect([small.width, small.height]).toEqual([512, 300]);
    const crop = flatten(src, quad(100, 100, 400, 100, 400, 300, 100, 300));
    expect([crop.width, crop.height]).toEqual([300, 200]);
  });
});

describe("autoLevel", () => {
  // Greys 0, 60 ×50, 90, 180 ×50, 255 plus one colour pixel: luma p2 = 60 and p98 = 180 (nearest rank),
  // so gain = 255 / 120 = 2.125; the 0 and 255 outliers (< 2% each) do not set the range.
  const px = [[0], ...Array(50).fill([60]), [90], ...Array(50).fill([180]), [255]].map(([v]) => [v, v, v, 255]);
  px.push([70, 100, 130, 128]);
  const src = img(px.length, 1, (x) => px[x]);
  const out = autoLevel(src);
  const value = (i: number) => at(out, i, 0);

  it("maps luma p2 to 0 and p98 to 255, clamping outside", () => {
    expect(value(0)).toEqual([0, 0, 0, 255]);
    expect(value(1)).toEqual([0, 0, 0, 255]);
    expect(value(51)).toEqual([64, 64, 64, 255]); // (90 − 60) × 2.125 = 63.75
    expect(value(52)).toEqual([255, 255, 255, 255]);
    expect(value(102)).toEqual([255, 255, 255, 255]);
  });

  it("uses the same offset and gain on R, G and B and keeps alpha", () => {
    expect(value(103)).toEqual([21, 85, 149, 128]); // (10, 40, 70) × 2.125 = 21.25, 85, 148.75
    expect(at(src, 103, 0)).toEqual([70, 100, 130, 128]); // input untouched
  });

  it("leaves a flat image unchanged", () => {
    const flat = img(4, 4, () => [128, 128, 128, 255]);
    expect([...autoLevel(flat).data]).toEqual([...flat.data]);
  });
});
