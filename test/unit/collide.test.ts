import { describe, expect, it } from "vitest";
import { PLAYER_R, SPAWN, WORLD_BOUNDS, clampTo, step, walkCircles } from "../../src/world/collide";
import { R_MAX, W, Z_FRONT, type Circle, type Vec2 } from "../../src/world/space";

const B = WORLD_BOUNDS;
const A: Circle = { x: 0, z: 0, r: 1 }; // needs distance ≥ 1.3 with the 0.3 player radius
const clear = (p: Vec2, cs: readonly Circle[]) => cs.every((k) => Math.hypot(p.x - k.x, p.z - k.z) >= k.r + PLAYER_R);

describe("bounds and spawn", () => {
  it("uses the design bounds and spawns inside them", () => {
    expect(B).toEqual({ x0: -13, x1: 13, z0: -13, z1: 9.5 });
    expect(SPAWN).toEqual({ x: 0, z: 9 });
    expect(clampTo(B, SPAWN)).toEqual(SPAWN);
  });
  it("clamps on all four edges", () => {
    expect(step({ x: 12.875, z: 0 }, { x: 0.25, z: 0 }, [], B)).toEqual({ x: 13, z: 0 });
    expect(step({ x: -12.875, z: 0 }, { x: -0.25, z: 0 }, [], B)).toEqual({ x: -13, z: 0 });
    expect(step({ x: 0, z: -12.875 }, { x: 0, z: -0.25 }, [], B)).toEqual({ x: 0, z: -13 });
    expect(step({ x: 0, z: 9.375 }, { x: 0, z: 0.25 }, [], B)).toEqual({ x: 0, z: 9.5 });
    expect(clampTo(B, { x: 99, z: -99 })).toEqual({ x: 13, z: -13 });
  });
  it("keeps the spawn clear of every circle with z ≤ Z_FRONT and r ≤ R_MAX + 0.8", () => {
    const worst = Array.from({ length: W + 3 }, (_, i): Circle => ({ x: i - W / 2 - 1, z: Z_FRONT, r: R_MAX + 0.8 }));
    expect(clear(SPAWN, worst)).toBe(true);
    expect(clear(SPAWN, [{ x: 0, z: Z_FRONT, r: 2.8 }])).toBe(false); // 2.8 + 0.3 > 3, so the check can fail
  });
});

describe("step", () => {
  it("takes the full move when it is clear", () => {
    expect(step({ x: 0, z: 1.5 }, { x: 0.25, z: 0.25 }, [A], B)).toEqual({ x: 0.25, z: 1.75 });
  });
  it("slides on x when the full move hits a circle", () => {
    expect(step({ x: 0, z: 1.5 }, { x: 0.25, z: -0.25 }, [A], B)).toEqual({ x: 0.25, z: 1.5 });
  });
  it("slides on z when the full and x-only moves hit a circle", () => {
    expect(step({ x: 1.5, z: 0 }, { x: -0.25, z: 0.25 }, [A], B)).toEqual({ x: 1.5, z: 0.25 });
  });
  it("stays put when all three moves are blocked", () => {
    const p = { x: 0, z: 1.5 };
    expect(step(p, { x: 0.25, z: -0.25 }, [A, { x: 1.5, z: 1.5, r: 1 }], B)).toBe(p);
  });
});

describe("walkCircles", () => {
  it("widens only upright animal, person and car by 0.8 and drops objects without a circle", () => {
    const c = (x: number): Circle => ({ x, z: 0, r: 0.5 });
    const out = walkCircles([
      { kind: "upright", type: "animal", collide: c(1) },
      { kind: "upright", type: "person", collide: c(2) },
      { kind: "upright", type: "car", collide: c(3) },
      { kind: "upright", type: "tree", collide: c(4) },
      { kind: "upright", type: "house", collide: c(5) },
      { kind: "float", type: "animal", collide: c(6) },
      { kind: "float", type: "bird" },
    ]);
    expect(out.map((k) => k.r)).toEqual([1.3, 1.3, 1.3, 0.5, 0.5, 0.5]);
    expect(out.map((k) => k.x)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
