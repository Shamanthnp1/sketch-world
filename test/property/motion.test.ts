import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALL_TYPES, type ObjType } from "../../shared/scene";
import { motion, type Motion } from "../../src/world/animate";
import type { Placed } from "../../src/world/layout";

type Row = "wander" | "ellipse" | "drift" | "sway" | "static";
const EPS = 1e-12; // floating-point slack on upper bounds only

// design.md motion table, written out here rather than read from motionRow so a wrong row in animate.ts shows up.
// Off-table: any other float card flies the ellipse, an upright sky/flat/terrain type stays static.
const WANDER: readonly ObjType[] = ["animal", "person", "car"];
const SWAY: readonly ObjType[] = ["tree", "flower", "lamp", "sign", "other-standing"];
const BUILDING: readonly ObjType[] = ["house", "tower", "castle"];
function expectedRow(kind: Placed["kind"], type: ObjType): Row {
  if (kind === "terrain" || kind === "flat" || kind === "sky" || BUILDING.includes(type)) return "static"; // 14.6
  if (type === "cloud") return "drift"; // 14.4
  if (kind === "float") return "ellipse"; // 14.3
  if (WANDER.includes(type)) return "wander"; // 14.2
  return SWAY.includes(type) ? "sway" : "static"; // 14.5
}

const kindArb = fc.constantFrom<Placed["kind"]>("upright", "flat", "terrain", "sky", "float");
const typeArb = fc.constantFrom(...ALL_TYPES);
const idArb = fc.integer({ min: 0, max: 2 ** 31 });
// Seconds: the first minute, hours either side of 0, any double (huge, -0, ±Infinity, NaN) and the non-finite ones.
const tArb = fc.oneof(
  fc.double({ min: 0, max: 60, noNaN: true }),
  fc.double({ min: -36_000, max: 36_000, noNaN: true }),
  fc.double(),
  fc.constantFrom(Number.NaN, Infinity, -Infinity),
);
const inputArb = fc.tuple(kindArb, typeArb, idArb, tArb, fc.boolean());

const isZero = (v: number) => expect(Math.abs(v)).toBe(0); // -0 counts as 0
const atMost = (v: number, max: number) => expect(Math.abs(v)).toBeLessThanOrEqual(max + EPS);

function checkRow(m: Motion, row: Row) {
  switch (row) {
    case "wander": // 14.2
      expect(Math.hypot(m.dx, m.dz)).toBeLessThanOrEqual(0.8 + EPS);
      expect(m.dy).toBeGreaterThanOrEqual(0);
      expect(m.dy).toBeLessThanOrEqual(0.15 + EPS);
      isZero(m.rotZ);
      return;
    case "ellipse": // 14.3
      atMost(m.dx, 2); atMost(m.dy, 0.5); isZero(m.dz); isZero(m.rotZ);
      return;
    case "drift": // 14.4
      atMost(m.dx, 1.5); isZero(m.dy); isZero(m.dz); isZero(m.rotZ);
      expect(m.flip).toBe(false);
      return;
    case "sway": // 14.5
      atMost(m.rotZ, Math.PI / 60); isZero(m.dx); isZero(m.dy); isZero(m.dz);
      expect(m.flip).toBe(false);
      return;
    case "static": // 14.6
      isZero(m.dx); isZero(m.dy); isZero(m.dz); isZero(m.rotZ);
      expect(m.flip).toBe(false);
  }
}

describe("Feature: sketch-world, Property 8: Motion is bounded and deterministic", () => {
  // **Validates: Requirements 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.10**
  it("gives equal offsets for equal inputs, keeps each offset within its row's amplitude and zeroes them all under rm", () => {
    fc.assert(fc.property(inputArb, inputArb, ([kind, type, id, t, rm], other) => {
      const m = motion(kind, type, id, t, rm);
      motion(...other); // a call in between must not change the next answer
      expect(motion(kind, type, id, t, rm)).toEqual(m); // 14.7
      expect(typeof m.flip).toBe("boolean");
      if (rm) { isZero(m.dx); isZero(m.dy); isZero(m.dz); isZero(m.rotZ); return; } // 14.10
      checkRow(m, Number.isFinite(t) ? expectedRow(kind, type) : "static");
    }), { numRuns: 5000 });
  });
});
