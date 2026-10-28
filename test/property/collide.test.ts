import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALL_TYPES, type ObjType } from "../../shared/scene";
import type { Instance } from "../../src/cut/types";
import { PLAYER_R, SPAWN, WORLD_BOUNDS as B, step, walkCircles } from "../../src/world/collide";
import { layout } from "../../src/world/layout";
import type { Circle, Size, Vec2 } from "../../src/world/space";

// A pixel range [a, a + n] inside [0, max], with extra weight on ranges that touch the far edge
// (a base row at the image bottom puts upright circles at Z_FRONT, the closest they get to SPAWN).
const span = (max: number) =>
  fc.tuple(fc.integer({ min: 0, max }), fc.oneof(fc.integer({ min: 0, max }), fc.constant(max)))
    .map(([a, b]) => ({ at: Math.min(a, b), n: Math.abs(a - b) }));

const instArb = (img: Size) =>
  fc.record({ id: fc.nat({ max: 10_000 }), type: fc.constantFrom(...ALL_TYPES), sky: fc.boolean(), xs: span(img.w), ys: span(img.h) })
    .map(({ id, type, sky, xs, ys }): Instance => ({
      id, objIndex: 0, type, noun: type, sky, bbox: { x: xs.at, y: ys.at, w: xs.n, h: ys.n }, mask: new Uint8Array(0), source: "threshold",
    }));

// A random world: image size, then up to 30 Instances with unique ids (Requirement 5.11).
const worldArb = fc.record({ w: fc.integer({ min: 32, max: 2048 }), h: fc.integer({ min: 32, max: 2048 }) })
  .chain((img) => fc.record({ img: fc.constant(img), inst: fc.uniqueArray(instArb(img), { maxLength: 30, size: "max", selector: (o) => o.id }) }));

// A move of length ≤ 0.25 at a random or axis-aligned angle, or aimed (±90°) at a circle centre to force blocks and slides.
const moveArb = fc.record({
  len: fc.oneof(fc.constant(0.25), fc.double({ min: 0, max: 0.25, noNaN: true })),
  angle: fc.oneof(fc.constantFrom(0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2), fc.double({ min: 0, max: 2 * Math.PI, noNaN: true })),
  toward: fc.oneof(fc.constant(null), fc.nat()),
});
type Move = { len: number; angle: number; toward: number | null };

const pointArb = fc.record({ x: fc.double({ min: B.x0, max: B.x1, noNaN: true }), z: fc.double({ min: B.z0, max: B.z1, noNaN: true }) });

const inBounds = (p: Vec2) => p.x >= B.x0 && p.x <= B.x1 && p.z >= B.z0 && p.z <= B.z1;
const clearOf = (p: Vec2, cs: readonly Circle[]) => cs.every((k) => Math.hypot(p.x - k.x, p.z - k.z) >= k.r + PLAYER_R);
const valid = (p: Vec2, cs: readonly Circle[]) => inBounds(p) && clearOf(p, cs);

function delta(m: Move, p: Vec2, cs: readonly Circle[]): Vec2 {
  const k = m.toward === null || cs.length === 0 ? null : cs[m.toward % cs.length];
  const a = k ? Math.atan2(k.z - p.z, k.x - p.x) + (m.angle - Math.PI) / 2 : m.angle;
  return { x: m.len * Math.cos(a), z: m.len * Math.sin(a) };
}

describe("Feature: sketch-world, Property 6: Collision keeps the player valid", () => {
  // **Validates: Requirements 6.4, 7.6, 7.7**
  it("keeps the player inside the bounds and outside every widened layout circle after every step", () => {
    fc.assert(fc.property(worldArb, fc.array(pointArb, { minLength: 1, maxLength: 20 }), fc.array(moveArb, { minLength: 1, maxLength: 300, size: "max" }),
      ({ img, inst }, candidates, moves) => {
        // The circles the game walks against: layout's circles, joined by id to each Instance's type for the wander widening.
        const typeOf = new Map<number, ObjType>(inst.map((o) => [o.id, o.type]));
        const circles = walkCircles(layout(inst, img).map((p) => ({ ...p, type: typeOf.get(p.id)! })));
        expect(valid(SPAWN, circles)).toBe(true); // the spawn is a valid start for every layout
        const sampled = candidates.find((c) => valid(c, circles)); // rejection sampling; none valid → SPAWN only
        for (const start of sampled ? [SPAWN, sampled] : [SPAWN]) {
          let p = start;
          for (const m of moves) {
            p = step(p, delta(m, p, circles), circles, B);
            expect(inBounds(p)).toBe(true);
            expect(clearOf(p, circles)).toBe(true);
          }
        }
      }), { numRuns: 1000 });
  });
});
