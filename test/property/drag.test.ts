import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PLAYER_R, WANDER_PAD, WORLD_BOUNDS, type Bounds } from "../../src/world/collide";
import { clampKind, inBounds, placeDrag } from "../../src/world/drag";
import type { Placed } from "../../src/world/layout";
import { R_MAX, type Circle, type Vec2, type Vec3 } from "../../src/world/space";

type Kind = Placed["kind"];
// Uniform over [min, max]: fc.double is uniform over bit patterns, so in [0, 1] it would mostly give values near 0.
const STEPS = 2 ** 30;
const num = (min: number, max: number) => fc.noBias(fc.integer({ min: 0, max: STEPS })).map((n) => min + (n / STEPS) * (max - min));
const frac = fc.oneof(num(0, 1), fc.constantFrom(0, 1)); // a fraction across the bounds, with the edges exactly
const yArb = fc.oneof(num(-5, 15), fc.constantFrom(0, 0.01, 0.5, 8));
const angle = num(0, 2 * Math.PI);

// WORLD_BOUNDS, or random non-degenerate bounds (x0 < x1, z0 < z1) from a sliver to wider than the world.
const boundsArb: fc.Arbitrary<Bounds> = fc.oneof(
  fc.constant(WORLD_BOUNDS),
  fc.record({ x0: num(-30, 30), w: fc.oneof(num(0.01, 40), fc.constantFrom(0.01, 0.6)), z0: num(-30, 30), d: fc.oneof(num(0.01, 40), fc.constantFrom(0.01, 0.6)) })
    .map(({ x0, w, z0, d }) => ({ x0, x1: x0 + w, z0, z1: z0 + d })),
);
// The point at fractions (u, v) across the bounds grown by pad on every side.
const at = (b: Bounds, u: number, v: number, pad = 0): Vec2 =>
  ({ x: b.x0 - pad + u * (b.x1 - b.x0 + 2 * pad), z: b.z0 - pad + v * (b.z1 - b.z0 + 2 * pad) });

// Upright gets most runs since only it collides; terrain never moves.
const kindArb = fc.oneof({ arbitrary: fc.constant<Kind>("upright"), weight: 4 }, fc.constantFrom<Kind>("flat", "float", "sky", "terrain"));

// Where the pointer lands. i picks a circle, or the player (the last entry), to aim at.
const toArb = fc.oneof(
  fc.record({ m: fc.constant("free" as const), u: num(-3, 4), v: num(-3, 4), y: yArb }), // anywhere, often far outside the bounds
  fc.record({ m: fc.constant("huge" as const), x: fc.constantFrom(-1e300, -1e9, 0, 1e9, 1e300), z: fc.constantFrom(-1e300, -1e9, 0, 1e9, 1e300), y: fc.constantFrom(-1e9, 0, 1e9) }),
  fc.record({ m: fc.constant("centre" as const), i: fc.nat(), y: yArb }), // exactly on a blocking centre
  fc.record({ m: fc.constant("rim" as const), i: fc.nat(), a: angle, y: yArb }), // exactly r1 + r2 from it, up to rounding
  fc.record({ m: fc.constant("near" as const), i: fc.nat(), a: angle, s: num(0, 1.5), y: yArb }), // inside it or just outside
  fc.record({ m: fc.constant("nudge" as const), dx: fc.constantFrom(-0.25, 0, 0.25), dz: fc.constantFrom(-0.25, 0, 0.25) }), // an arrow-key nudge
  fc.record({ m: fc.constant("bad" as const), c: fc.constantFrom("x" as const, "y" as const, "z" as const), v: fc.constantFrom(NaN, Infinity, -Infinity) }), // a ray parallel to the drag plane
);
type To = typeof toArb extends fc.Arbitrary<infer T> ? T : never;

function resolve(t: To, b: Bounds, all: readonly Circle[], r: number, from: Vec3): Vec3 {
  switch (t.m) {
    case "free": return { ...at(b, t.u, t.v), y: t.y };
    case "huge": return { x: t.x, y: t.y, z: t.z };
    case "nudge": return { x: from.x + t.dx, y: from.y, z: from.z + t.dz };
    case "bad": return { ...from, [t.c]: t.v };
    default: {
      const k = all[t.i % all.length], d = t.m === "centre" ? 0 : (k.r + r) * (t.m === "rim" ? 1 : t.s), a = t.m === "centre" ? 0 : t.a;
      return { x: k.x + d * Math.cos(a), y: t.y, z: k.z + d * Math.sin(a) };
    }
  }
}

// Circles near the bounds with radii up to a widened wanderer's (R_MAX + WANDER_PAD); the player near the bounds too.
// froms are candidate previous positions: the first one clear of every circle and the player is used (rejection sampling).
const scenarioArb = boundsArb.chain((b) => fc.record({
  b: fc.constant(b),
  kind: kindArb,
  r: fc.oneof(fc.constantFrom(0, 0.3, R_MAX), num(0, R_MAX)),
  circles: fc.array(fc.record({ u: num(0, 1), v: num(0, 1), r: fc.oneof(fc.constantFrom(0.3, R_MAX), num(0, R_MAX + WANDER_PAD)) })
    .map(({ u, v, r }): Circle => ({ ...at(b, u, v, 1), r })), { maxLength: 8 }),
  player: fc.tuple(frac, frac).map(([u, v]) => at(b, u, v, 1)),
  froms: fc.array(fc.record({ u: frac, v: frac, y: yArb }), { minLength: 1, maxLength: 20 }),
  to: toArb,
}));

describe("Feature: sketch-world, Property 9: Dragging keeps placements valid", () => {
  // **Validates: Requirements 15.7, 15.8, 15.9, 15.10, 15.11**
  it("puts the result inside the bounds for its kind and keeps an upright result clear of every circle and the player", () => {
    fc.assert(fc.property(scenarioArb, ({ b, kind, r, circles, player, froms, to: t }) => {
      const all = [...circles, { ...player, r: PLAYER_R }];
      const clear = (p: Vec3) => all.every((k) => Math.hypot(p.x - k.x, p.z - k.z) >= k.r + r);
      // A previous position valid for its kind: terrain as generated (it never moves), others clamped into their bounds.
      const cands = froms.map(({ u, v, y }): Vec3 => ({ ...at(b, u, v, 1), y })).map((p) => kind === "terrain" ? p : clampKind(b, kind, p));
      const from = kind === "upright" ? cands.find(clear) : cands[0];
      fc.pre(from !== undefined);
      const to = resolve(t, b, all, r, from);
      const res = placeDrag({ to, from, r }, kind, b, circles, player);

      if (kind === "terrain" || ![to.x, to.y, to.z].every(Number.isFinite)) return void expect(res).toBe(from); // 15.7, NaN rays
      expect(inBounds(b, kind, res)).toBe(true); // 15.8
      if (kind !== "upright") return;
      for (const k of circles) expect(Math.hypot(res.x - k.x, res.z - k.z)).toBeGreaterThanOrEqual(k.r + r); // 15.9
      expect(Math.hypot(res.x - player.x, res.z - player.z)).toBeGreaterThanOrEqual(PLAYER_R + r);
      const q = clampKind(b, kind, to);
      if (clear(q)) { expect(res).not.toBe(from); expect(res).toEqual(q); } // 15.10–15.11: only a blocked target is pushed or refused
    }), { numRuns: 1000 });
  });
});
