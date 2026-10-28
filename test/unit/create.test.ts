import { describe, expect, it } from "vitest";
import { SparkScene } from "../../shared/scene";
import { ApiError } from "../../src/api";
import { errorText, MINIMAL_SCENE, minimalInstances, missingNouns, objectCount, stepNames } from "../../src/ui/create";
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

describe("missingNouns", () => {
  it("maps notFound indices to their nouns in scene order, each once", () => {
    const scene = { objects: [obj("tree", 1), obj("sun", 1), obj("tree", 2), obj("cat", 1)] };
    expect(missingNouns(scene, [1, 0, 2])).toEqual(["sun", "tree"]);
    expect(missingNouns(scene, [])).toEqual([]);
  });
});

describe("Minimal_Scene", () => {
  it("is a valid scene marked not safe, so it can't be saved", () => {
    expect(SparkScene.parse(MINIMAL_SCENE)).toEqual(MINIMAL_SCENE);
    expect(MINIMAL_SCENE.safe).toBe(false);
  });
  it("is the whole drawing as one threshold Card, trimmed to its ink, enclosed white kept", () => {
    // a 3 × 3 ink ring with a white middle at (2, 1) in a 7 × 5 page
    const ring: [number, number][] = [[2, 1], [3, 1], [4, 1], [2, 2], [4, 2], [2, 3], [3, 3], [4, 3]];
    const [o, ...rest] = minimalInstances(page(7, 5, ring));
    expect(rest).toEqual([]);
    expect(o).toMatchObject({ id: 0, objIndex: 0, source: "threshold", type: "hill", bbox: { x: 2, y: 1, w: 3, h: 3 } });
    expect([...o.mask]).toEqual(new Array(9).fill(1));
    // a hill stands at the back, where the whole drawing fits the view
    expect(layout([o], { w: 7, h: 5 })[0]).toMatchObject({ kind: "terrain", z: Z_BACK - 2 });
  });
  it("keeps a blank page whole", () => {
    const [o] = minimalInstances(page(4, 3, []));
    expect(o.bbox).toEqual({ x: 0, y: 0, w: 4, h: 3 });
    expect(o.mask.every((v) => v === 1)).toBe(true);
  });
});
