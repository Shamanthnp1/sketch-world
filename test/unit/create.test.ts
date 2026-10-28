import { describe, expect, it } from "vitest";
import { SparkScene } from "../../shared/scene";
import { ApiError } from "../../src/api";
import { canResend, errorText, MINIMAL_SCENE, minimalWorld, missingNouns, noteText, objectCount, stepNames } from "../../src/ui/create";
import { layout } from "../../src/world/layout";
import { Z_BACK } from "../../src/world/space";

const obj = (noun: string, count: number) => ({ type: "tree" as const, noun, count, sky: false });

/** w × h white RGBA with the listed pixels in ink. */
function page(w: number, h: number, ink: [number, number][]) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x, y] of ink) data.fill(20, 4 * (y * w + x), 4 * (y * w + x) + 3);
  return { data, width: w, height: h };
}

describe("progress steps", () => {
  it("names the three stages, with Σcount once Spark has replied", () => {
    expect(stepNames()).toEqual(["Reading your drawing", "Cutting out the objects", "Popping up your world"]);
    expect(stepNames(6)[1]).toBe("Cutting out 6 objects");
    expect(stepNames(1)[1]).toBe("Cutting out 1 object");
  });
  it("Σcount adds every object's count", () => {
    expect(objectCount({ objects: [obj("tree", 3), obj("house", 1), obj("bird", 2)] })).toBe(6);
    expect(objectCount({ objects: [] })).toBe(0);
  });
});

describe("errorText", () => {
  it("shows the Worker's own message for 422", () => {
    expect(errorText(new ApiError(422, "Please use a drawing; photos of real people aren't supported"))).toBe(
      "Please use a drawing; photos of real people aren't supported");
  });
  it("says try again in a minute for 429 and 503", () => {
    expect(errorText(new ApiError(429, "x"))).toMatch(/try again in a minute/);
    expect(errorText(new ApiError(503, "x"))).toBe(errorText(new ApiError(429, "y")));
  });
  it("gives a short reason of its own for 400, 413 and 415, and a generic line otherwise", () => {
    const texts = [400, 413, 415].map((s) => errorText(new ApiError(s, "field is larger than 400 KB")));
    expect(new Set(texts).size).toBe(3);
    for (const t of texts) expect(t).not.toMatch(/field/);
    expect(errorText(new TypeError("Failed to fetch"))).toBe(errorText(new ApiError(500, "boom")));
  });
});

describe("canResend", () => {
  it("offers Try again unless the picture itself was refused", () => {
    for (const s of [400, 413, 415, 422]) expect(canResend(new ApiError(s, "x"))).toBe(false);
    for (const s of [429, 500, 503]) expect(canResend(new ApiError(s, "x"))).toBe(true);
    expect(canResend(new TypeError("Failed to fetch"))).toBe(true);
  });
});

describe("missingNouns", () => {
  it("maps notFound indices to their nouns in scene order, each once", () => {
    const scene = { objects: [obj("tree", 1), obj("sun", 1), obj("tree", 2), obj("cat", 1)] };
    expect(missingNouns(scene, [1, 0, 2])).toEqual(["sun", "tree"]);
    expect(missingNouns(scene, [])).toEqual([]);
  });
});

describe("noteText", () => {
  it("says why a Minimal_Scene can't be saved, lists the nouns not found, and is empty for neither", () => {
    expect(noteText({ saveable: true, notFound: [] })).toBe("");
    expect(noteText({ saveable: true, notFound: ["sun", "cat"] })).toBe("Not found in your drawing: sun, cat.");
    expect(noteText({ saveable: false, notFound: [] })).toMatch(/one card\. This world can’t be saved\.$/);
  });
});

describe("Minimal_Scene", () => {
  it("is a valid scene marked not safe, so it can't be saved", () => {
    expect(SparkScene.parse(MINIMAL_SCENE)).toEqual(MINIMAL_SCENE);
    expect(MINIMAL_SCENE.safe).toBe(false);
  });
  it("is the whole drawing as one threshold Card, trimmed to its ink, enclosed white kept, centred on a wide page", () => {
    // a 3 × 3 ink ring with a white middle at (5, 4) in a 12 × 10 page framed by a dark edge line (a corner tapped
    // just outside the paper), which the 2 px margin drops
    const ring: [number, number][] = [[4, 3], [5, 3], [6, 3], [4, 4], [6, 4], [4, 5], [5, 5], [6, 5]];
    const frame: [number, number][] = [];
    for (let x = 0; x < 12; x++) frame.push([x, 0], [x, 9]);
    for (let y = 1; y < 9; y++) frame.push([0, y], [11, y]);
    const { work, instances: [o, ...rest] } = minimalWorld(page(12, 10, [...frame, ...ring]));
    expect(rest).toEqual([]);
    expect(work).toMatchObject({ width: 9, height: 3 }); // MINIMAL_PAGE × the longer side, the drawing's height
    expect(o).toMatchObject({ id: 0, objIndex: 0, source: "threshold", type: "hill", bbox: { x: 3, y: 0, w: 3, h: 3 } });
    expect([...o.mask]).toEqual(new Array(9).fill(1));
    // the page holds the drawing's pixels at the bbox and white elsewhere
    const ink = (x: number, y: number) => work.data[4 * (y * work.width + x)] === 20;
    expect([ink(3, 0), ink(4, 1), ink(5, 2), ink(2, 0), ink(6, 2)]).toEqual([true, false, true, false, false]);
    // a hill at the back whose longer side is 12 units, so the whole drawing is in view from the spawn point
    const p = layout([o], { w: work.width, h: work.height })[0];
    expect(p).toMatchObject({ kind: "terrain", x: 0, z: Z_BACK - 2 });
    expect(Math.max(p.w, p.h)).toBeCloseTo(12);
  });
  it("keeps a blank page whole", () => {
    const { work, instances: [o] } = minimalWorld(page(4, 3, []));
    expect(o.bbox).toEqual({ x: 4, y: 0, w: 4, h: 3 });
    expect(work).toMatchObject({ width: 12, height: 3 });
    expect(o.mask.every((v) => v === 1)).toBe(true);
  });
});
