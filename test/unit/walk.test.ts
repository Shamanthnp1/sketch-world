import { describe, expect, it } from "vitest";
import { SPAWN, WORLD_BOUNDS, step } from "../../src/world/collide";
import { foldAmount } from "../../src/world/popup";
import {
  LOOK, MAX_STEP, PITCH_MAX, PITCH_MIN, groundDist, keyIntent, look, substeps, turnDir, walkDelta, type Intent,
} from "../../src/world/walk";

const held = (...i: Intent[]) => new Set(i);
const close = (a: { x: number; z: number }, b: { x: number; z: number }) => {
  expect(a.x).toBeCloseTo(b.x, 12);
  expect(a.z).toBeCloseTo(b.z, 12);
};

describe("keyIntent", () => {
  it("maps W/S and ↑/↓ to moving, A/D to strafing and ←/→ to turning, by physical key", () => {
    expect(["KeyW", "ArrowUp", "KeyS", "ArrowDown", "KeyA", "KeyD", "ArrowLeft", "ArrowRight"].map(keyIntent))
      .toEqual(["forward", "forward", "back", "back", "left", "right", "turnLeft", "turnRight"]);
  });
  it("ignores every other key", () => {
    for (const code of ["KeyQ", "Space", "Escape", "Enter", "", "constructor", "toString"]) expect(keyIntent(code)).toBeUndefined();
  });
});

describe("walkDelta", () => {
  it("moves along the facing direction: yaw 0 faces −z, positive yaw turns left", () => {
    close(walkDelta(held("forward"), 0, 1), { x: 0, z: -1 });
    close(walkDelta(held("back"), 0, 1), { x: 0, z: 1 });
    close(walkDelta(held("right"), 0, 1), { x: 1, z: 0 });
    close(walkDelta(held("left"), 0, 1), { x: -1, z: 0 });
    close(walkDelta(held("forward"), Math.PI / 2, 1), { x: -1, z: 0 });
    close(walkDelta(held("right"), Math.PI / 2, 1), { x: 0, z: -1 });
  });
  it("keeps diagonals at the same length and cancels opposite keys", () => {
    const d = walkDelta(held("forward", "right"), 0.7, 0.3);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(0.3, 12);
    expect(walkDelta(held("forward", "back"), 1, 0.3)).toEqual({ x: 0, z: 0 });
    expect(walkDelta(held("turnLeft"), 1, 0.3)).toEqual({ x: 0, z: 0 });
  });
});

describe("turnDir", () => {
  it("is +1 left, −1 right, 0 for none or both", () => {
    expect([turnDir(held("turnLeft")), turnDir(held("turnRight")), turnDir(held()), turnDir(held("turnLeft", "turnRight"))])
      .toEqual([1, -1, 0, 0]);
  });
});

describe("substeps", () => {
  it("splits a delta into equal steps of length ≤ 0.25 that sum to it", () => {
    for (let k = 0; k <= 400; k++) {
      const a = k * 2.399, len = k * 0.013, d = { x: len * Math.cos(a), z: len * Math.sin(a) };
      const s = substeps(d);
      expect(s.length).toBe(Math.max(1, Math.ceil(len / MAX_STEP)));
      for (const e of s) expect(Math.hypot(e.x, e.z)).toBeLessThanOrEqual(MAX_STEP + 1e-12);
      close(s.reduce((t, e) => ({ x: t.x + e.x, z: t.z + e.z }), { x: 0, z: 0 }), d);
    }
  });
  it("uses one step up to 0.25 and one zero step for no move", () => {
    expect(substeps({ x: 0, z: -0.25 })).toEqual([{ x: 0, z: -0.25 }]);
    expect(substeps({ x: 0, z: 0.5 })).toEqual([{ x: 0, z: 0.25 }, { x: 0, z: 0.25 }]);
    expect(substeps({ x: 0, z: 0 })).toEqual([{ x: 0, z: 0 }]);
  });
  it("keeps a large delta from jumping over a circle", () => {
    const wall = [{ x: 0, z: 5, r: 0.3 }], d = { x: 0, z: -5 };      // one 5-unit step lands past it
    expect(step(SPAWN, d, wall, WORLD_BOUNDS).z).toBeLessThan(5);
    const p = substeps(d).reduce((q, s) => step(q, s, wall, WORLD_BOUNDS), SPAWN);
    expect(p.z).toBeGreaterThanOrEqual(5.6);
  });
});

describe("look", () => {
  it("grabs the world: dragging right turns left, dragging down looks up", () => {
    const v = look({ yaw: 0, pitch: 0 }, 100, 20);
    expect(v.yaw).toBeCloseTo(100 * LOOK, 12);
    expect(v.pitch).toBeCloseTo(20 * LOOK, 12);
  });
  it("clamps pitch to −30°…60°, high enough for the sky Cards", () => {
    expect(look({ yaw: 1, pitch: 0 }, 0, 1e6)).toEqual({ yaw: 1, pitch: PITCH_MAX });
    expect(look({ yaw: 1, pitch: 0 }, 0, -1e6)).toEqual({ yaw: 1, pitch: PITCH_MIN });
    expect(PITCH_MAX).toBeCloseTo(Math.PI / 3, 12);
    expect(PITCH_MIN).toBeCloseTo(-Math.PI / 6, 12);
  });
});

describe("groundDist", () => {
  it("measures on the ground plane, ignoring height", () => {
    expect(groundDist({ x: 0, z: 0 }, { x: 3, y: 5, z: 4 } as { x: number; z: number })).toBe(5);
  });
  it("raises a Card at 4 units with foldAmount", () => {
    expect(foldAmount(0, groundDist(SPAWN, { x: 0, z: SPAWN.z - 4 }), false)).toBe(1);
    expect(foldAmount(0, groundDist(SPAWN, { x: 0, z: SPAWN.z - 8 }), false)).toBe(0);
  });
});
