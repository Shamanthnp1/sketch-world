import { describe, expect, it } from "vitest";
import { scaledSize, WORK_MAX_PX } from "../../src/image/encode";
import { flatten } from "../../src/paper/flatten";
import { bilinear, invBilinear, validateQuad, type Quad } from "../../src/paper/quad";
import { checkCorners, checkWhole, toPhotoPx, wholePhoto } from "../../src/ui/corners";
import { layout } from "../../src/world/layout";
import { W } from "../../src/world/space";

/** Axis-aligned rectangle x0..x1 × y0..y1, top-left then clockwise. */
const rect = (x0: number, y0: number, x1: number, y1: number): Quad =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

describe("toPhotoPx", () => {
  const shown = { left: 20, top: 100, width: 400, height: 300 }; // a 4000 × 3000 photo shown at a tenth

  it("maps a tap on the scaled photo to photo px", () => {
    expect(toPhotoPx(20, 100, shown, 4000, 3000)).toEqual({ x: 0, y: 0 });
    expect(toPhotoPx(420, 400, shown, 4000, 3000)).toEqual({ x: 4000, y: 3000 });
    expect(toPhotoPx(220, 250, shown, 4000, 3000)).toEqual({ x: 2000, y: 1500 });
    expect(toPhotoPx(120.5, 130, shown, 4000, 3000)).toEqual({ x: 1005, y: 300 });
  });

  it("clamps a tap just off the edge to the photo", () => {
    expect(toPhotoPx(19, 401, shown, 4000, 3000)).toEqual({ x: 0, y: 3000 });
    expect(toPhotoPx(421, 99, shown, 4000, 3000)).toEqual({ x: 4000, y: 0 });
  });
});

describe("wholePhoto", () => {
  it("gives the photo's own corners from the top-left, clockwise, as a valid quad", () => {
    expect(wholePhoto(4000, 3000)).toEqual(rect(0, 0, 4000, 3000));
    expect(validateQuad(wholePhoto(3000, 4000))).toEqual({ ok: true });
  });

  it("round-trips paper coordinates on a 4 : 1 whole picture (Requirement 1.5)", () => {
    const q = wholePhoto(1024, 256), uv = invBilinear(q, bilinear(q, 0.3, 0.7))!;
    expect(uv.u).toBeCloseTo(0.3, 9);
    expect(uv.v).toBeCloseTo(0.7, 9);
  });
});

describe("checkWhole (Use the whole photo)", () => {
  it("accepts the gate's 3346 × 1186 MS Paint image (2.82 : 1), which the paper shape check refuses, and up to 4 : 1 either way", () => {
    expect(validateQuad(wholePhoto(3346, 1186)).ok).toBe(false);
    for (const [w, h] of [[3346, 1186], [4000, 3000], [1170, 2532], [1024, 256], [256, 1024], [64, 64]]) {
      expect(checkWhole(w, h)).toEqual({ ok: true });
    }
  });

  it("refuses a picture over 4 : 1, saying its shape and what to do instead", () => {
    expect(checkWhole(4100, 1000)).toEqual({
      ok: false,
      reason: "Too wide: the picture is 4.10 : 1 (the whole picture can be up to 4 : 1). Tap the corners of the part you want instead.",
    });
    expect(checkWhole(300, 1500)).toEqual({ ok: false, reason: expect.stringMatching(/^Too tall: the picture is 5\.00 : 1 /) });
  });

  it("refuses a side under 64 px", () => {
    expect(checkWhole(200, 63)).toEqual({
      ok: false, reason: "Too small: the picture is 200 × 63 px (needs at least 64 px on each side). Try a larger picture.",
    });
  });

  it("takes a 2.82 : 1 picture through flatten and the Work_Image size to layout without stretching it", () => {
    // 3346 × 1186 white, with a black block in the bottom half: x 669–1337 (a fifth of the width), y 593–1185.
    const w = 3346, h = 1186, data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 593; y < h; y++) for (let x = 669; x < 1338; x++) data.fill(0, 4 * (y * w + x), 4 * (y * w + x) + 3);
    const work = flatten({ data, width: w, height: h }, wholePhoto(w, h));
    expect([work.width, work.height]).toEqual([1024, 363]);
    expect(scaledSize(work.width, work.height, WORK_MAX_PX)).toEqual({ w: 1024, h: 363 }); // workImage keeps this size
    let x0 = work.width, y0 = work.height, x1 = -1, y1 = -1;
    for (let y = 0; y < work.height; y++) {
      for (let x = 0; x < work.width; x++) {
        if (work.data[4 * (y * work.width + x)] >= 128) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    const bbox = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    expect(Math.abs(bbox.w / bbox.h - 669 / 593)).toBeLessThan(0.02); // the block keeps its shape
    const [p] = layout([{
      id: 0, objIndex: 0, type: "house", noun: "house", sky: false, bbox, mask: new Uint8Array(bbox.w * bbox.h).fill(1), source: "sam-noun",
    }], { w: work.width, h: work.height });
    expect(p.kind).toBe("upright");
    expect(p.w / p.h).toBeCloseTo(bbox.w / bbox.h, 9); // one scale for x and y
    expect(p.w).toBeCloseTo((bbox.w * W) / 1024, 9);
    expect(p.w).toBeCloseTo(W / 5, 1);                  // 4.8 units wide
    expect(p.h).toBeCloseTo((W * 363) / 1024 / 2, 1);   // half the 8.5-unit image height: 4.25 units tall
  });
});

describe("checkCorners", () => {
  it("accepts a paper that fills 42% of the photo", () => {
    expect(checkCorners(rect(200, 150, 800, 850), 1000, 1000)).toEqual({ ok: true });
  });

  it("accepts exactly 15% and exactly 80%", () => {
    expect(checkCorners(rect(0, 0, 300, 500), 1000, 1000)).toEqual({ ok: true });
    expect(checkCorners(rect(0, 0, 800, 1000), 1000, 1000)).toEqual({ ok: true });
  });

  it("passes on validateQuad's reason, so corners tapped anticlockwise are asked for again", () => {
    const [a, b, c, d] = rect(200, 150, 800, 850);
    const r = checkCorners([a, d, c, b], 1000, 1000);
    expect(r).toEqual(validateQuad([a, d, c, b]));
    expect(r.ok).toBe(false);
  });

  it("refuses a paper under 15% or over 80% of the photo, saying how much it fills", () => {
    const small = checkCorners(rect(100, 100, 400, 480), 1000, 1000); // 11.4%
    expect(small).toEqual({ ok: false, reason: expect.stringMatching(/^Too small: the paper fills 11% of the photo \(needs 15–80%\)/) });
    const large = checkCorners(rect(50, 25, 950, 975), 1000, 1000); // 85.5%
    expect(large).toEqual({ ok: false, reason: expect.stringMatching(/^Too large: the paper fills 86% of the photo .*Use the whole photo/) });
  });

  it("still refuses tapped corners with aspect 2.0, also on a wide photo", () => {
    expect(checkCorners(rect(100, 300, 900, 700), 1000, 1000)).toEqual({ ok: false, reason: expect.stringMatching(/^Wrong shape: .*2\.00 : 1/) });
    expect(checkCorners(rect(500, 100, 2500, 1100), 3346, 1186)).toEqual({ ok: false, reason: expect.stringMatching(/^Wrong shape: .*2\.00 : 1/) });
  });

  it("refuses the whole photo, which is why Use the whole photo runs checkWhole instead", () => {
    expect(checkCorners(wholePhoto(4000, 3000), 4000, 3000).ok).toBe(false);
  });
});
