import { describe, expect, it } from "vitest";
import { trimToMask } from "../../src/sam/cutout";
import { placeMask } from "../../src/sam/masks";
import type { MaskRaster } from "../../src/sam/parse";

const solid = (left: number, top: number, width: number, height: number): MaskRaster =>
  ({ data: new Uint8Array(width * height).fill(1), width, height, left, top });
const ones = (m: Uint8Array) => [...m.keys()].filter((i) => m[i]);

describe("placeMask", () => {
  it("offsets a SAM raster by left/top and clips it to the image", () => {
    const m: MaskRaster = { data: Uint8Array.from([1, 0, 1, 1]), width: 2, height: 2, left: 3, top: 1 };
    expect(ones(placeMask(m, 6, 4))).toEqual([1 * 6 + 3, 2 * 6 + 3, 2 * 6 + 4]);
    expect(ones(placeMask(solid(-1, 2, 3, 3), 4, 3))).toEqual([2 * 4 + 0, 2 * 4 + 1]); // only row 2, cols 0–1 land
  });
});

describe("trimToMask", () => {
  // 6×5 RGBA with R = x, G = y, so the trimmed pixels show where they came from.
  const W = 6, H = 5;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set([i % W, Math.floor(i / W), 7, 255], 4 * i);

  it("trims to the mask's bounding box with alpha from the mask", () => {
    const mask = new Uint8Array(W * H);
    mask[1 * W + 1] = 1; mask[2 * W + 3] = 1;
    const t = trimToMask(rgba, mask, W, H)!;
    expect([t.width, t.height]).toEqual([3, 2]);
    const px = (x: number, y: number) => [...t.data.subarray(4 * (y * t.width + x), 4 * (y * t.width + x) + 4)];
    expect(px(0, 0)).toEqual([1, 1, 7, 255]);
    expect(px(2, 1)).toEqual([3, 2, 7, 255]);
    expect(px(1, 0)).toEqual([0, 0, 0, 0]); // inside the box, outside the mask: transparent
  });

  it("returns null for an empty mask", () => {
    expect(trimToMask(rgba, new Uint8Array(W * H), W, H)).toBeNull();
  });
});
