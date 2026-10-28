import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Moves, MovesBody, SavedScene, movesValid, type SavedInstance } from "../../shared/saved";
import { ALL_TYPES, group, type ObjType } from "../../shared/scene";
import { WORLD_BOUNDS as B } from "../../src/world/collide";
import { clampKind } from "../../src/world/drag";
import { placement, type Placed } from "../../src/world/layout";
import { SKY_R, type Size, type Vec3 } from "../../src/world/space";

type Kind = Placed["kind"];
type Scene = SavedScene & { moves: Moves };
// Uniform over [min, max], as in drag.test.ts: fc.double is uniform over bit patterns, so it would mostly give values near 0.
const STEPS = 2 ** 30;
const num = (min: number, max: number) => fc.noBias(fc.integer({ min: 0, max: STEPS })).map((n) => min + (n / STEPS) * (max - min));
const rad = (deg: number) => (deg * Math.PI) / 180;
const FLOAT_Y0 = 0.5, FLOAT_Y1 = 8, SKY_EL0 = rad(10), SKY_EL1 = rad(60); // the kind bounds of Requirement 15.8
const SKY_TOL = 1e-9; // inBounds' slack for sky points, which clampKind computes with sin and cos
const IDS = Array.from({ length: 30 }, (_, i) => i);

// A pointer point across and beyond WORLD_BOUNDS, with the exact x, z and float y edges often.
const pointArb: fc.Arbitrary<Vec3> = fc.record({
  x: fc.oneof(num(-20, 20), fc.constantFrom(B.x0, B.x1)),
  y: fc.oneof(num(-5, 15), fc.constantFrom(0, 0.01, FLOAT_Y0, FLOAT_Y1)),
  z: fc.oneof(num(-20, 20), fc.constantFrom(B.z0, B.z1)),
});

const bboxArb = (img: Size) => fc.tuple(fc.nat(img.w), fc.nat(img.w), fc.nat(img.h), fc.nat(img.h))
  .map(([a, b, c, d]) => ({ x: Math.min(a, b), y: Math.min(c, d), w: Math.abs(a - b), h: Math.abs(c - d) }));

// 1–30 Instances with random sky flags and unique ids drawn from 0–29 in random order. Often exactly 30, and half the
// scenes leave out terrain types, so 30 moved entries (the cap) come up too.
const instancesArb = (img: Size) => fc.tuple(
  fc.oneof({ arbitrary: fc.integer({ min: 1, max: 30 }), weight: 3 }, fc.constant(30)),
  fc.constantFrom(ALL_TYPES, ALL_TYPES.filter((t) => group(t) !== "terrain")),
  fc.shuffledSubarray(IDS, { minLength: 30, maxLength: 30 }),
).chain(([n, types, ids]) => fc.array(fc.record({
  objIndex: fc.nat(11), type: fc.constantFrom(...types), sky: fc.boolean(), bbox: bboxArb(img),
  source: fc.constantFrom<SavedInstance["source"]>("sam-noun", "sam-box", "threshold"),
}), { minLength: n, maxLength: n }).map((list) => list.map((o, i): SavedInstance => ({ id: ids[i], ...o, noun: o.type }))));

const movable = (s: Pick<SavedScene, "instances">) => s.instances.filter((o) => placement(o) !== "terrain");

// A valid SavedScene: some (or all) non-terrain Instances moved, each to a point clamped into the bounds for its kind.
const sceneArb: fc.Arbitrary<Scene> = fc.record({ w: fc.integer({ min: 1, max: 4096 }), h: fc.integer({ min: 1, max: 4096 }) })
  .chain((img) => fc.record({
    v: fc.constant(1 as const),
    title: fc.constantFrom("My town", "Château d'eau, 2!"),
    view: fc.constantFrom<SavedScene["view"]>("side", "top"),
    img: fc.constant(img),
    ground: fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, "0")}`),
    backdrop: fc.constantFrom<SavedScene["backdrop"]>("image", "gradient"),
    instances: instancesArb(img),
  }))
  .chain((s) => fc.oneof(fc.subarray(movable(s)), fc.constant(movable(s)))
    .chain((picked) => fc.array(pointArb, { minLength: picked.length, maxLength: picked.length })
      .map((pts) => ({ ...s, moves: Object.fromEntries(picked.map((o, i) => [String(o.id), clampKind(B, placement(o), pts[i])])) }))));

// How to break exactly one entry. pick chooses the Instance or key; d (≥ 0) is how far past a bound, 0 meaning the least step.
const breakerArb = fc.oneof(
  fc.record({ b: fc.constant("nonFinite" as const), pick: fc.nat(), c: fc.constantFrom("x" as const, "y" as const, "z" as const), v: fc.constantFrom(NaN, Infinity, -Infinity), p: pointArb }),
  { arbitrary: fc.record({ b: fc.constant("out" as const), pick: fc.nat(), side: fc.nat(), d: fc.oneof(fc.constant(0), num(0, 5)), p: pointArb }), weight: 3 },
  fc.record({ b: fc.constant("terrain" as const), pick: fc.nat(), type: fc.constantFrom<ObjType>("mountain", "hill"), p: pointArb }),
  fc.record({ b: fc.constant("unknown" as const), pick: fc.nat(), p: pointArb }),
  fc.record({ b: fc.constant("tooMany" as const), n: fc.integer({ min: 31, max: 40 }), p: pointArb }),
  fc.record({ b: fc.constant("extraKey" as const), pick: fc.nat(), key: fc.constantFrom("r", "w", "h", "id", "kind", "X"), p: pointArb }),
);
type Breaker = typeof breakerArb extends fc.Arbitrary<infer T> ? T : never;

// The least step past edge (EPSILON·|edge| ≥ one ulp, so the result is a different double), or d past it.
const past = (edge: number, dir: 1 | -1, d: number) => edge + dir * Math.max(d, Number.EPSILON * Math.abs(edge));
const onSky = (az: number, el: number): Vec3 =>
  ({ x: SKY_R * Math.cos(el) * Math.sin(az), y: SKY_R * Math.sin(el), z: -SKY_R * Math.cos(el) * Math.cos(az) });

/** q (valid for kind) moved just or well outside one of its kind's bounds. */
function outside(kind: Kind, q: Vec3, side: number, d: number): Vec3 {
  if (kind === "sky") { // beyond SKY_TOL off the sphere, or below 10° / above 60° elevation on it
    const s = side % 4, dr = 2 * SKY_TOL + d, de = 2 * SKY_TOL + d / 10; // de ≤ 0.5 rad keeps el below 90°
    if (s < 2) { const f = (SKY_R + (s === 0 ? dr : -dr)) / SKY_R; return { x: q.x * f, y: q.y * f, z: q.z * f }; }
    return onSky(Math.atan2(q.x, -q.z), s === 2 ? SKY_EL0 - de : SKY_EL1 + de);
  }
  const sides: Partial<Vec3>[] = [{ x: past(B.x0, -1, d) }, { x: past(B.x1, 1, d) }, { z: past(B.z0, -1, d) }, { z: past(B.z1, 1, d) }];
  if (kind === "float") sides.push({ y: past(FLOAT_Y0, -1, d) }, { y: past(FLOAT_Y1, 1, d) });
  return { ...q, ...sides[side % sides.length] };
}

/** The scene with exactly one bad entry in moves (a copy; the input is untouched). */
function breakOne(s: Scene, t: Breaker): { bad: SavedScene; moves: Record<string, Record<string, number>> } {
  const instances = s.instances.map((o) => ({ ...o }));
  const moves: Record<string, Record<string, number>> = { ...s.moves };
  // A non-terrain Instance's key and its entry: the saved one, else a fresh valid point.
  const entry = (pick: number) => {
    const all = movable({ instances }), o = all[pick % all.length], kind = placement(o), k = String(o.id);
    return { kind, k, q: s.moves[k] ?? clampKind(B, kind, t.p) };
  };
  switch (t.b) {
    case "nonFinite": { const { k, q } = entry(t.pick); moves[k] = { ...q, [t.c]: t.v }; break; }
    case "out": { const { kind, k, q } = entry(t.pick); moves[k] = outside(kind, q, t.side, t.d); break; }
    case "extraKey": { const { k, q } = entry(t.pick); moves[k] = { ...q, [t.key]: 0 }; break; }
    case "terrain": { // an otherwise fine upright point on a mountain or hill (made one if it was not)
      const o = instances[t.pick % instances.length];
      if (placement(o) !== "terrain") o.type = t.type;
      moves[String(o.id)] = clampKind(B, "upright", t.p);
      break;
    }
    case "unknown": { // a free id 0–99, or a zero-padded one such as "05", which the key regex allows but no String(id) is
      const ids = new Set(instances.map((o) => String(o.id)));
      const free = [...Array.from({ length: 100 }, (_, i) => String(i)), ...Array.from({ length: 10 }, (_, i) => `0${i}`)].filter((k) => !ids.has(k));
      if (Object.keys(moves).length === 30) delete moves[Object.keys(moves)[0]]; // stay at 30 entries, so only the id is wrong
      moves[free[t.pick % free.length]] = clampKind(B, "upright", t.p);
      break;
    }
    case "tooMany": // well-formed filler entries under ids 30+, which no Instance has
      for (let i = 30; Object.keys(moves).length < t.n; i++) moves[String(i)] = clampKind(B, "upright", t.p);
      break;
  }
  return { bad: { ...s, instances, moves: moves as Moves }, moves };
}

describe("Feature: sketch-world, Property 10: Saved moves round-trip", () => {
  // **Validates: Requirements 16.1, 16.2, 16.3**
  it("passes valid moves through unchanged: parsed, after a JSON round trip, and as a PATCH body", () => {
    fc.assert(fc.property(sceneArb, (scene) => {
      expect(movesValid(scene.instances, scene.moves)).toBe(true);
      expect(SavedScene.parse(scene).moves).toEqual(scene.moves);
      expect(SavedScene.parse(JSON.parse(JSON.stringify(scene))).moves).toEqual(scene.moves); // as D1 stores it
      expect(MovesBody.parse({ moves: scene.moves }).moves).toEqual(scene.moves);
      expect(MovesBody.parse(JSON.parse(JSON.stringify({ moves: scene.moves }))).moves).toEqual(scene.moves);
    }), { numRuns: 1000 });
  });

  // **Validates: Requirements 16.1, 16.2, 16.3**
  it("rejects a scene with one non-finite, out-of-bounds, terrain, unknown, surplus or extra-key entry", () => {
    fc.assert(fc.property(sceneArb, breakerArb, (scene, t) => {
      fc.pre(t.b === "terrain" || t.b === "unknown" || t.b === "tooMany" || movable(scene).length > 0);
      const { bad, moves } = breakOne(scene, t);
      for (const s of [bad, JSON.parse(JSON.stringify(bad))]) { // as built, and as JSON carries it (NaN and ±Infinity become null)
        const r = SavedScene.safeParse(s);
        expect(r.success).toBe(false);
        expect(r.error!.issues.map((i) => i.path[0])).toEqual(r.error!.issues.map(() => "moves")); // nothing else is wrong
      }
      const shape = Moves.safeParse(moves).success, body = MovesBody.safeParse({ moves }).success;
      const valid = movesValid(bad.instances, moves as Moves);
      if (t.b === "nonFinite") expect({ shape, body, valid }).toEqual({ shape: false, body: false, valid: false }); // zod numbers and inBounds
      else if (t.b === "extraKey") expect({ shape, body }).toEqual({ shape: false, body: false }); // strict entries
      else if (t.b === "tooMany") {
        expect({ shape, body }).toEqual({ shape: false, body: false });
        expect(Moves.safeParse(Object.fromEntries(Object.entries(moves).slice(0, 30))).success).toBe(true); // 30 is still fine
      } else expect({ shape, body, valid }).toEqual({ shape: true, body: true, valid: false }); // well-formed, refused against the Instances
    }), { numRuns: 1000 });
  });
});
