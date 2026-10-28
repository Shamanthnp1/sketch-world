import { describe, expect, it } from "vitest";
import { cropRgba, thresholdMask } from "../../src/cut/threshold";

// RGBA from rows of "#" (black) and "." (white).
const rgbaOf = (rows: string[]) =>
  Uint8ClampedArray.from(rows.join("").split("").flatMap((c) => (c === "#" ? [0, 0, 0, 255] : [255, 255, 255, 255])));
const run = (rows: string[]) => [...thresholdMask(rgbaOf(rows), rows[0].length, rows.length)].join("");

describe("thresholdMask", () => {
  it("makes an all-white crop fully transparent", () => {
    expect(run(["....", "....", "...."])).toBe("000000000000");
  });

  it("keeps the white inside a closed black ring opaque", () => {
    const rows = [".....", ".###.", ".#.#.", ".###.", "....."];
    expect(run(rows)).toBe(["00000", "01110", "01110", "01110", "00000"].join(""));
  });

  it("keeps dark pixels on the border opaque", () => {
    expect(run(["#..", "...", "..#"])).toBe("100000001");
  });

  it("uses luma against the light threshold", () => {
    const grey = (v: number) => Uint8ClampedArray.from([v, v, v, 255]);
    expect([...thresholdMask(grey(200), 1, 1)]).toEqual([0]);
    expect([...thresholdMask(grey(199), 1, 1)]).toEqual([1]);
    expect([...thresholdMask(grey(150), 1, 1, 150)]).toEqual([0]);
  });
});

describe("cropRgba", () => {
  // 10×8 image with R = x, G = y, so cropped pixels show where they came from.
  const W = 10, H = 8;
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let i = 0; i < W * H; i++) img.data.set([i % W, Math.floor(i / W), 0, 255], 4 * i);
  const px = (c: ReturnType<typeof cropRgba>, x: number, y: number) =>
    [...c.data.subarray(4 * (y * c.rect.w + x), 4 * (y * c.rect.w + x) + 2)];

  it("pads the box on each side, 4 px by default", () => {
    const c = cropRgba(img, { x: 4, y: 4, w: 1, h: 1 }, 2);
    expect(c.rect).toEqual({ x: 2, y: 2, w: 5, h: 5 });
    expect(px(c, 0, 0)).toEqual([2, 2]);
    expect(px(c, 4, 4)).toEqual([6, 6]);
    expect(cropRgba(img, { x: 4, y: 3, w: 1, h: 1 }).rect).toEqual({ x: 0, y: 0, w: 9, h: 8 });
  });

  it("clamps the crop at the image edges", () => {
    const c = cropRgba(img, { x: 7, y: 0, w: 3, h: 2 });
    expect(c.rect).toEqual({ x: 3, y: 0, w: 7, h: 6 });
    expect(c.data.length).toBe(7 * 6 * 4);
    expect(px(c, 0, 0)).toEqual([3, 0]);
    expect(px(c, 6, 5)).toEqual([9, 5]);
  });
});
