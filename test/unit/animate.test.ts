import { describe, expect, it } from "vitest";
import { ALL_TYPES, TYPES, type ObjType } from "../../shared/scene";
import { DRIFT_X, FLOAT_X, FLOAT_Y, HOP, SWAY, WANDER_R, motion, motionRow, type Motion } from "../../src/world/animate";
import { WANDER_PAD } from "../../src/world/collide";
import type { Placed } from "../../src/world/layout";

const KINDS: Placed["kind"][] = ["upright", "flat", "terrain", "sky", "float"];
const ZERO: Motion = { dx: 0, dy: 0, dz: 0, rotZ: 0, flip: false };
const IDS = [0, 1, 2, 7, 29];
const times = (period: number) => Array.from({ length: 801 }, (_, i) => (i / 800) * period); // one full period
const each = (kind: Placed["kind"], types: readonly ObjType[], period: number, f: (m: Motion, next: Motion) => void) => {
  for (const type of types) for (const id of IDS) for (const t of times(period)) f(motion(kind, type, id, t, false), motion(kind, type, id, t + 1e-4, false));
};
const facesTravel = (m: Motion, next: Motion) => { if (Math.abs(next.dx - m.dx) > 1e-7) expect(m.flip).toBe(next.dx < m.dx); };

describe("motion", () => {
  it("returns all zeros under reduced motion for every kind and type", () => {
    for (const kind of KINDS) for (const type of ALL_TYPES) for (const t of [0, 1.3, 77]) expect(motion(kind, type, 3, t, true)).toEqual(ZERO);
  });

  it("keeps terrain, flat and sky kinds and every building static", () => {
    for (const kind of ["terrain", "flat", "sky"] as const) for (const type of ALL_TYPES) expect(motion(kind, type, 1, 2.5, false)).toEqual(ZERO);
    for (const kind of KINDS) for (const type of TYPES.building) expect(motion(kind, type, 1, 2.5, false)).toEqual(ZERO);
  });

  it("wanders upright animal, person and car on a loop of radius ≤ 0.8 with 0 ≤ dy ≤ 0.15, facing travel", () => {
    expect(WANDER_R).toBeLessThanOrEqual(WANDER_PAD);
    let far = 0, high = 0;
    each("upright", ["animal", "person", "car"], 8, (m, next) => {
      const r = Math.hypot(m.dx, m.dz);
      expect(r).toBeLessThanOrEqual(0.8);
      expect(m.dy).toBeGreaterThanOrEqual(0);
      expect(m.dy).toBeLessThanOrEqual(HOP);
      expect(m.rotZ).toBe(0);
      facesTravel(m, next);
      far = Math.max(far, r); high = Math.max(high, m.dy);
    });
    expect(far).toBeGreaterThan(0.75); // it really moves
    expect(high).toBeGreaterThan(0.14);
  });

  it("flies float animal and bird (and off-table float standing types) on an ellipse |dx| ≤ 2, |dy| ≤ 0.5, facing travel", () => {
    each("float", ["animal", "bird", "person", "other-standing"], 10, (m, next) => {
      expect(Math.abs(m.dx)).toBeLessThanOrEqual(FLOAT_X);
      expect(Math.abs(m.dy)).toBeLessThanOrEqual(FLOAT_Y);
      expect(m.dz).toBe(0);
      expect(m.rotZ).toBe(0);
      facesTravel(m, next);
    });
    expect(motionRow("float", "person")).toBe("ellipse");
  });

  it("drifts clouds with |dx| ≤ 1.5 and flip false", () => {
    each("float", ["cloud"], 40, (m) => {
      expect(Math.abs(m.dx)).toBeLessThanOrEqual(DRIFT_X);
      expect({ ...m, dx: 0 }).toEqual(ZERO);
    });
  });

  it("sways upright tree, flower, lamp, sign and other-standing with |rotZ| ≤ 3°", () => {
    expect(SWAY).toBeCloseTo((3 * Math.PI) / 180, 12);
    each("upright", ["tree", "flower", "lamp", "sign", "other-standing"], 4, (m) => {
      expect(Math.abs(m.rotZ)).toBeLessThanOrEqual(SWAY);
      expect({ ...m, rotZ: 0 }).toEqual(ZERO);
    });
  });

  it("is deterministic and phase-shifted by id", () => {
    for (const kind of KINDS) for (const type of ALL_TYPES) expect(motion(kind, type, 5, 3.21, false)).toEqual(motion(kind, type, 5, 3.21, false));
    const dxs = IDS.map((id) => motion("upright", "animal", id, 2, false).dx);
    expect(new Set(dxs).size).toBe(IDS.length);
  });

  it("stays still for a non-finite t", () => {
    expect(motion("float", "bird", 1, Number.NaN, false)).toEqual(ZERO);
  });
});
