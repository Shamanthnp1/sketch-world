import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALL_TYPES, group, type ObjType } from "../../shared/scene";
import type { Instance, Source } from "../../src/cut/types";
import { layout, type Placed } from "../../src/world/layout";
import { R_MAX, SKY_R, Z_FRONT, type Size } from "../../src/world/space";

const FAR_SKY: readonly ObjType[] = ["sun", "moon", "star", "rainbow"];
const SKY_MIN_Y = SKY_R * Math.sin((10 * Math.PI) / 180);
const EPS = 1e-9;

/** The kind Requirement 6.2 asks for, written out independently of `placement`. */
const expectedKind = (type: ObjType, sky: boolean): Placed["kind"] => {
  const g = group(type);
  if (FAR_SKY.includes(type)) return "sky";
  if (g === "sky") return "float"; // cloud, bird
  if (g === "flat" || g === "terrain") return g;
  return sky ? "float" : "upright"; // standing or building
};

// Work_Image sizes up to the 1024 px long side; small sizes make equal base rows (ties) common.
const imgArb = fc.record({ w: fc.integer({ min: 1, max: 1024 }), h: fc.integer({ min: 1, max: 1024 }) });

// A pixel bbox inside the image (zero width or height allowed), from two columns and two rows.
const bboxArb = (img: Size) =>
  fc.tuple(fc.nat(img.w), fc.nat(img.w), fc.nat(img.h), fc.nat(img.h))
    .map(([a, b, c, d]) => ({ x: Math.min(a, b), y: Math.min(c, d), w: Math.abs(a - b), h: Math.abs(c - d) }));

// layout reads only id, type, sky and bbox, so the mask stays empty instead of allocating up to 30 bbox-sized masks per run.
const instanceArb = (img: Size): fc.Arbitrary<Instance> =>
  fc.record({
    id: fc.integer({ min: 0, max: 1000 }), objIndex: fc.nat(11), type: fc.constantFrom(...ALL_TYPES), sky: fc.boolean(),
    bbox: bboxArb(img), source: fc.constantFrom<Source>("sam-noun", "sam-box", "threshold"),
  }).map((o) => ({ ...o, noun: o.type, mask: new Uint8Array(0) }));

// Up to 30 Instances with unique ids, plus a random permutation of the same list.
const worldArb = imgArb.chain((img) =>
  fc.uniqueArray(instanceArb(img), { maxLength: 30, selector: (o) => o.id }).chain((list) =>
    fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length }).map((perm) => ({ img, list, perm }))));

describe("Feature: sketch-world, Property 1: Layout is deterministic and depth is monotone", () => {
  // **Validates: Requirements 6.2, 6.8, 6.9, 6.10, 6.12**
  it("ignores input order, keeps upright depth monotone in the base row and keeps sky and float Cards in their bands", () => {
    fc.assert(fc.property(worldArb, ({ img, list, perm }) => {
      const order = list.map((o) => o.id);
      const out = layout(list, img);
      expect(list.map((o) => o.id)).toEqual(order); // pure: the input list is not reordered
      expect(layout(perm, img)).toEqual(out); // 6.8
      expect(out.map((p) => p.id)).toEqual([...order].sort((a, b) => a - b));

      const byId = new Map(list.map((o) => [o.id, o]));
      const upright: { base: number; z: number }[] = [];
      for (const p of out) {
        const o = byId.get(p.id)!;
        expect(p.kind).toBe(expectedKind(o.type, o.sky)); // 6.2, 6.10: sky kind only for sun, moon, star, rainbow
        expect(p.collide !== undefined).toBe(p.kind === "upright");
        if (p.kind === "sky") expect(p.y).toBeGreaterThanOrEqual(SKY_MIN_Y - EPS);
        if (p.kind === "float") { // 6.12
          expect(p.y).toBeGreaterThanOrEqual(1.5);
          expect(p.y).toBeLessThanOrEqual(6);
          expect(p.z).toBeGreaterThanOrEqual(-5);
          expect(p.z).toBeLessThanOrEqual(-1);
        }
        if (p.kind === "upright") {
          expect(p.z).toBeLessThanOrEqual(Z_FRONT);
          expect(p.collide!.r).toBeLessThanOrEqual(R_MAX);
          upright.push({ base: o.bbox.y + o.bbox.h, z: p.z });
        }
      }
      // 6.9: of any two upright Instances, the one with the larger base row has a z greater than or equal to the other's.
      const bad = upright.flatMap((a) => upright.filter((b) => a.base > b.base && a.z < b.z).map((b) => ({ a, b })));
      expect(bad).toEqual([]);
    }), { numRuns: 1000 });
  });
});
