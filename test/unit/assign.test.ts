import { describe, expect, it } from "vitest";
import { acceptBox, acceptNoun, assign, maskArea } from "../../src/cut/assign";
import type { Candidate } from "../../src/cut/types";
import type { MaskRaster } from "../../src/sam/parse";

/** A width × height raster at (left, top) whose first `set` pixels (row-major) are 1. */
const raster = (left: number, top: number, width: number, height: number, set = width * height): MaskRaster =>
  ({ data: Uint8Array.from({ length: width * height }, (_, i) => (i < set ? 1 : 0)), width, height, left, top });
const cand = (id: number, objIndex: number, mask: MaskRaster): Candidate => ({ id, objIndex, mask, area: maskArea(mask) });
const ids = (cs: Candidate[]) => cs.map((c) => c.id);

describe("acceptNoun", () => {
  it("needs the area to be at least 5% of the mask's own bbox", () => {
    expect(acceptNoun(raster(0, 0, 10, 10, 5), "tree", 100, 100)).toBe(true);
    expect(acceptNoun(raster(0, 0, 10, 10, 4), "tree", 100, 100)).toBe(false);
    expect(acceptNoun(raster(0, 0, 0, 0), "tree", 100, 100)).toBe(false);
  });

  it("caps the bbox at 60% of the image, 90% for flat and terrain", () => {
    expect(acceptNoun(raster(0, 0, 10, 6), "tree", 10, 10)).toBe(true);
    expect(acceptNoun(raster(0, 0, 10, 7), "house", 10, 10)).toBe(false);
    expect(acceptNoun(raster(0, 0, 10, 9), "water", 10, 10)).toBe(true);
    expect(acceptNoun(raster(0, 0, 10, 9), "mountain", 10, 10)).toBe(true);
    expect(acceptNoun(raster(0, 0, 10, 10), "field", 10, 10)).toBe(false);
  });
});

describe("acceptBox", () => {
  it("needs bbox IoU ≥ 0.3 with the Spark box", () => {
    const m = raster(0, 0, 10, 10);
    expect(acceptBox(m, { x: 0, y: 0, w: 10, h: 3 })).toBe(true); // 30 / 100
    expect(acceptBox(m, { x: 0, y: 0, w: 10, h: 2 })).toBe(false); // 20 / 100
    expect(acceptBox(m, { x: 10, y: 0, w: 10, h: 10 })).toBe(false); // touching, no overlap
  });
});

describe("assign", () => {
  it("keeps a mask with IoU exactly 0.5 and drops one above 0.5", () => {
    const big = cand(2, 1, raster(0, 0, 10, 1)); // later object, 10 px; the small one sits inside it
    expect(ids(assign([big, cand(1, 0, raster(0, 0, 5, 1))], [1, 1]))).toEqual([1, 2]); // IoU 5/10
    expect(ids(assign([big, cand(1, 0, raster(0, 0, 6, 1))], [1, 1]))).toEqual([1]); // IoU 6/10, only 60% of big inside
  });

  it("keeps at most count masks per object, largest first, ties by id", () => {
    const cs = [cand(1, 0, raster(0, 0, 3, 1)), cand(2, 0, raster(10, 0, 5, 1)), cand(3, 0, raster(20, 0, 4, 1)),
      cand(4, 0, raster(30, 0, 5, 1))];
    expect(ids(assign(cs, [2]))).toEqual([2, 4]);
    expect(ids(assign(cs, [0]))).toEqual([]);
  });

  it("drops a mask that lies ≥ 80% inside an accepted mask of an earlier object", () => {
    const house = cand(1, 0, raster(0, 0, 10, 10));
    const innerWall = cand(2, 1, raster(2, 2, 3, 3)); // fully inside the house, IoU only 9/100
    const brickWall = cand(3, 1, raster(20, 0, 2, 2));
    const edgeWall = cand(4, 1, raster(8, 0, 5, 1)); // 2 of its 5 px (40%) inside the house
    expect(ids(assign([brickWall, edgeWall, innerWall, house], [1, 3]))).toEqual([1, 4, 3]);
  });
});
