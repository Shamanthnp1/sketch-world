import { describe, expect, it } from "vitest";
import { cropRgba } from "../../src/cut/threshold";
import type { Instance } from "../../src/cut/types";
import { trimToMask } from "../../src/sam/cutout";
import { applyMoves, pasteCut } from "../../src/ui/viewer";
import { movesOf } from "../../src/world/build";
import { layout } from "../../src/world/layout";

const blank = (width: number, height: number) => ({ data: new Uint8ClampedArray(4 * width * height), width, height });

describe("pasteCut", () => {
  it("makes alpha >= 128 the mask and writes only those pixels, opaque", () => {
    const work = blank(4, 3), rect = { x: 1, y: 1, w: 2, h: 2 };
    const cut = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 0, 70, 80, 90, 128, 1, 2, 3, 127]);
    expect([...pasteCut(work, rect, cut)]).toEqual([1, 0, 1, 0]);
    const px = (x: number, y: number) => [...work.data.subarray(4 * (y * 4 + x), 4 * (y * 4 + x) + 4)];
    expect(px(1, 1)).toEqual([10, 20, 30, 255]);
    expect(px(1, 2)).toEqual([70, 80, 90, 255]);
    expect(px(2, 1)).toEqual([0, 0, 0, 0]);
    expect(px(2, 2)).toEqual([0, 0, 0, 0]);
    expect(work.data.filter((_, i) => i % 4 === 3 && work.data[i] > 0)).toHaveLength(2);
  });

  it("leaves an overlapping cut-out's pixels alone where its own alpha is low", () => {
    const work = blank(3, 1);
    pasteCut(work, { x: 0, y: 0, w: 2, h: 1 }, new Uint8ClampedArray([9, 9, 9, 255, 8, 8, 8, 255]));
    pasteCut(work, { x: 1, y: 0, w: 2, h: 1 }, new Uint8ClampedArray([0, 0, 0, 0, 7, 7, 7, 255]));
    expect([...work.data]).toEqual([9, 9, 9, 255, 8, 8, 8, 255, 7, 7, 7, 255]);
  });

  it("round trip: the saved cut-out pasted back gives the Card the same picture and mask (cardArt's crop + trimToMask)", () => {
    const w = 40, h = 30, work = blank(w, h);
    for (let i = 0; i < work.data.length; i++) work.data[i] = i % 4 === 3 ? 255 : (i * 37) % 251;
    const bbox = { x: 5, y: 4, w: 12, h: 9 }, crop = cropRgba(work, bbox, 0);
    // A mask that reaches every edge of the bbox, as SAM and threshold masks do (to within the 4 px threshold padding).
    const mask = Uint8Array.from({ length: bbox.w * bbox.h }, (_, k) => (k % bbox.w === 0 || k % 7 !== 3 ? 1 : 0));
    const saved = trimToMask(crop.data, mask, bbox.w, bbox.h)!;
    expect([saved.width, saved.height]).toEqual([bbox.w, bbox.h]);
    const rebuilt = blank(w, h), rect = cropRgba(rebuilt, bbox, 0).rect;
    const back = pasteCut(rebuilt, rect, saved.data);
    expect([...back]).toEqual([...mask]);
    expect(trimToMask(cropRgba(rebuilt, bbox, 0).data, back, rect.w, rect.h)).toEqual(saved);
  });
});

describe("applyMoves", () => {
  const inst = (id: number, type: Instance["type"], bbox: Instance["bbox"]): Instance =>
    ({ id, objIndex: id, type, noun: type, sky: false, bbox, mask: new Uint8Array(0), source: "sam-noun" });
  const instances = [inst(0, "tree", { x: 100, y: 300, w: 80, h: 160 }), inst(1, "house", { x: 500, y: 320, w: 200, h: 180 }), inst(2, "hill", { x: 0, y: 200, w: 900, h: 200 })];
  const cards = () => layout(instances, { w: 1024, h: 768 }).map((p) => ({ id: p.id, placed: p, pos: { x: p.x, y: p.y, z: p.z } }));

  it("puts each moved Card at its saved place after layout, so moves() gives the saved moves back", () => {
    const moves = { "0": { x: -3.5, y: 0, z: 1.25 }, "1": { x: 4, y: 0, z: -2 } }, c = cards();
    applyMoves(c, moves);
    expect(movesOf(c)).toEqual(moves);
    expect(c[2].pos).toEqual({ x: c[2].placed.x, y: c[2].placed.y, z: c[2].placed.z });
  });

  it("leaves the layout as is without moves, and ignores ids with no Card", () => {
    const c = cards();
    applyMoves(c);
    applyMoves(c, { "9": { x: 1, y: 0, z: 1 } });
    expect(movesOf(c)).toEqual({});
  });
});
