import { describe, expect, it } from "vitest";
import { validateQuad, type Quad } from "../../src/paper/quad";
import { checkCorners, toPhotoPx, wholePhoto } from "../../src/ui/corners";

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

  it("is too wide for the shape check on a 2 : 1 photo", () => {
    const r = validateQuad(wholePhoto(2000, 1000));
    expect(r.ok).toBe(false);
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

  it("refuses the whole photo, which is why Use the whole photo only runs validateQuad", () => {
    expect(checkCorners(wholePhoto(4000, 3000), 4000, 3000).ok).toBe(false);
  });
});
