import { describe, expect, it } from "vitest";
import { NUDGE, nudgeDelta } from "../../src/ui/hud";
import { WORLD_BOUNDS } from "../../src/world/collide";
import { placeDrag } from "../../src/world/drag";
import type { Vec3 } from "../../src/world/space";

const near = (a: Vec3, b: Vec3) => {
  expect(a.x).toBeCloseTo(b.x, 12);
  expect(a.y).toBeCloseTo(b.y, 12);
  expect(a.z).toBeCloseTo(b.z, 12);
};

describe("nudgeDelta", () => {
  it("moves 0.25 relative to the camera: facing −z, ← is −x, → is +x, ↑ is away (−z), ↓ is closer (+z)", () => {
    near(nudgeDelta("upright", "left", 0), { x: -NUDGE, y: 0, z: 0 });
    near(nudgeDelta("upright", "right", 0), { x: NUDGE, y: 0, z: 0 });
    near(nudgeDelta("flat", "up", 0), { x: 0, y: 0, z: -NUDGE });
    near(nudgeDelta("float", "down", 0), { x: 0, y: 0, z: NUDGE });
  });
  it("follows the camera's yaw: turned left a quarter (facing −x), ↑ is −x and ← is +z", () => {
    near(nudgeDelta("upright", "up", Math.PI / 2), { x: -NUDGE, y: 0, z: 0 });
    near(nudgeDelta("upright", "left", Math.PI / 2), { x: 0, y: 0, z: NUDGE });
    for (let k = 0; k < 16; k++) for (const d of ["left", "right", "up", "down"] as const) {
      const v = nudgeDelta("upright", d, k * 0.7);
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(NUDGE, 12);
      expect(v.y).toBe(0);
    }
  });
  it("raise and lower change height; sky ↑/↓ change elevation, which placeDrag keeps on the sky sphere", () => {
    near(nudgeDelta("float", "raise", 1), { x: 0, y: NUDGE, z: 0 });
    near(nudgeDelta("float", "lower", 1), { x: 0, y: -NUDGE, z: 0 });
    near(nudgeDelta("sky", "up", 1), { x: 0, y: NUDGE, z: 0 });
    near(nudgeDelta("sky", "down", 1), { x: 0, y: -NUDGE, z: 0 });
    const el = (p: Vec3) => Math.atan2(p.y, Math.hypot(p.x, p.z));
    const from = { x: 0, y: 40 * Math.sin(0.5), z: -40 * Math.cos(0.5) }, d = nudgeDelta("sky", "up", 0);
    const p = placeDrag({ to: { x: from.x + d.x, y: from.y + d.y, z: from.z + d.z }, from, r: 0 }, "sky", WORLD_BOUNDS, [], { x: 0, z: 9 });
    expect(el(p)).toBeGreaterThan(el(from));
  });
});
