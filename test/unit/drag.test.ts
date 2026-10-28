import { describe, expect, it } from "vitest";
import { PLAYER_R, WORLD_BOUNDS } from "../../src/world/collide";
import { clampKind, inBounds, placeDrag } from "../../src/world/drag";
import { SKY_R, type Circle, type Vec2, type Vec3 } from "../../src/world/space";

const B = WORLD_BOUNDS; // x ∈ [−13, 13], z ∈ [−13, 9.5]
const FAR: Vec2 = { x: 0, z: 9 }; // player at spawn, away from the test circles
const from: Vec3 = { x: 5, y: 0, z: 5 };
const deg = (r: number) => (r * 180) / Math.PI;
const el = (p: Vec3) => deg(Math.atan2(p.y, Math.hypot(p.x, p.z)));
const az = (p: Vec3) => deg(Math.atan2(p.x, -p.z));
const up = (to: Vec3, circles: readonly Circle[] = [], player = FAR, r = 0.5) => placeDrag({ to, from, r }, "upright", B, circles, player);

describe("clampKind and inBounds", () => {
  it("terrain never moves", () => {
    const f = { x: 0, y: 0, z: -14 };
    expect(placeDrag({ to: { x: 1, y: 0, z: 1 }, from: f, r: 1 }, "terrain", B, [], FAR)).toBe(f);
    expect(inBounds(B, "terrain", f)).toBe(false);
  });
  it("clamps x and z for upright and flat and keeps y", () => {
    for (const k of ["upright", "flat"] as const) {
      expect(clampKind(B, k, { x: 99, y: 0.01, z: -99 })).toEqual({ x: 13, y: 0.01, z: -13 });
      expect(clampKind(B, k, { x: -99, y: 0, z: 99 })).toEqual({ x: -13, y: 0, z: 9.5 });
      expect(inBounds(B, k, { x: 13, y: 0, z: -13 })).toBe(true);
      expect(inBounds(B, k, { x: 13.01, y: 0, z: 0 })).toBe(false);
    }
    expect(placeDrag({ to: { x: 99, y: 0.01, z: 0 }, from, r: 0 }, "flat", B, [{ x: 13, z: 0, r: 5 }], { x: 13, z: 0 })).toEqual({ x: 13, y: 0.01, z: 0 }); // no collision for flat
  });
  it("clamps float x, z and y into [0.5, 8]", () => {
    expect(clampKind(B, "float", { x: 20, y: 0, z: 20 })).toEqual({ x: 13, y: 0.5, z: 9.5 });
    expect(clampKind(B, "float", { x: 1, y: 20, z: 1 })).toEqual({ x: 1, y: 8, z: 1 });
    expect(inBounds(B, "float", { x: 1, y: 0.49, z: 1 })).toBe(false);
    expect(placeDrag({ to: { x: 1, y: 9, z: 1 }, from, r: 0 }, "float", B, [], FAR)).toEqual({ x: 1, y: 8, z: 1 });
  });
  it("clamps sky elevation to 10°–60° at both ends, keeps azimuth and puts the point on the sky sphere", () => {
    for (const [to, e] of [[{ x: 1, y: 50, z: -1 }, 60], [{ x: 3, y: -2, z: -3 }, 10], [{ x: 0, y: 0, z: 0 }, 10]] as const) {
      const p = placeDrag({ to, from, r: 0 }, "sky", B, [], FAR);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(SKY_R, 9);
      expect(el(p)).toBeCloseTo(e, 9);
      if (to.x) expect(az(p)).toBeCloseTo(45, 9);
      expect(inBounds(B, "sky", p)).toBe(true);
    }
    const mid = clampKind(B, "sky", { x: 0, y: 1, z: -1 }); // 45° straight ahead, only projected onto the sphere
    expect(mid.x).toBeCloseTo(0, 9); expect(mid.y).toBeCloseTo(SKY_R / Math.SQRT2, 9); expect(mid.z).toBeCloseTo(-SKY_R / Math.SQRT2, 9);
    expect(inBounds(B, "sky", { x: 0, y: 1, z: -1 })).toBe(false); // off the sphere
    expect(inBounds(B, "sky", { x: 0, y: SKY_R * Math.sin(Math.PI / 18 - 1e-6), z: -SKY_R * Math.cos(Math.PI / 18 - 1e-6) })).toBe(false); // just under 10°
  });
});

describe("placeDrag upright", () => {
  const A: Circle = { x: 0, z: 0, r: 1 }; // need = 1 + 0.5
  it("accepts a clear target and clamps it into the bounds", () => {
    expect(up({ x: 2, y: 0, z: 0 }, [A])).toEqual({ x: 2, y: 0, z: 0 });
    expect(up({ x: 1.5, y: 0, z: 0 }, [A])).toEqual({ x: 1.5, y: 0, z: 0 }); // exactly r1 + r2 is allowed
    expect(up({ x: 99, y: 0, z: 0 }, [A])).toEqual({ x: 13, y: 0, z: 0 });
  });
  it("pushes out of a circle along the line from its centre to r1 + r2", () => {
    const p = up({ x: 0.3, y: 0, z: 0.4 }, [A]);
    expect(p.x).toBeCloseTo(0.9, 5); expect(p.z).toBeCloseTo(1.2, 5); expect(p.y).toBe(0);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(1.5);
  });
  it("pushes out of the player's circle (r2 = 0.3)", () => {
    const p = up({ x: 0, y: 0, z: 2.5 }, [], { x: 0, z: 2 });
    expect(p.x).toBe(0); expect(p.z).toBeCloseTo(2 + 0.5 + PLAYER_R, 5);
    expect(p.z - 2).toBeGreaterThanOrEqual(0.5 + PLAYER_R);
  });
  it("returns from when the target is exactly at the blocking centre", () => {
    expect(up({ x: 0, y: 0, z: 0 }, [A])).toBe(from);
    expect(up({ x: 0, y: 0, z: 2 }, [], { x: 0, z: 2 })).toBe(from);
  });
  it("returns from when the push-out lands in another circle or out of bounds", () => {
    // the target 0.5 is clear of the second circle (2 ≥ 1), but the push to 1.5 lands just under 1 from it
    expect(up({ x: 0.5, y: 0, z: 0 }, [A, { x: 2.5, z: 0, r: 0.5 }])).toBe(from);
    expect(up({ x: 0.5, y: 0, z: 0 }, [A, { x: 2.6, z: 0, r: 0.5 }])).toEqual({ x: 1.5 + 1e-6, y: 0, z: 0 }); // control: 1.1 is clear
    expect(up({ x: 12.9, y: 0, z: 0 }, [{ x: 12.5, z: 0, r: 1 }])).toBe(from); // pushed to 14 > x1 = 13
    expect(up({ x: NaN, y: 0, z: 0 })).toBe(from);
  });
});
