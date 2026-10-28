import { describe, expect, it } from "vitest";
import { ALL_TYPES, type ObjType, type PxBox } from "../../shared/scene";
import type { Instance } from "../../src/cut/types";
import { depth, jitter, layout, placement } from "../../src/world/layout";
import { SKY_R, Z_BACK, Z_FRONT } from "../../src/world/space";

const img = { w: 1200, h: 800 }; // 0.02 world units per pixel
const inst = (id: number, type: ObjType, bbox: PxBox, sky = false): Instance =>
  ({ id, objIndex: 0, type, noun: type, sky, bbox, mask: new Uint8Array(0), source: "threshold" });
const one = (o: Instance) => layout([o], img)[0];
const deg = (r: number) => (r * 180) / Math.PI;

describe("placement", () => {
  it("uses the sky kind only for sun, moon, star and rainbow", () => {
    for (const type of ALL_TYPES) for (const sky of [false, true]) {
      const kind = placement({ type, sky });
      expect(kind === "sky").toBe(["sun", "moon", "star", "rainbow"].includes(type));
    }
  });

  it("floats cloud and bird, and standing or building objects with sky true", () => {
    expect(placement({ type: "cloud", sky: false })).toBe("float");
    expect(placement({ type: "bird", sky: true })).toBe("float");
    expect(placement({ type: "tree", sky: true })).toBe("float");
    expect(placement({ type: "animal", sky: true })).toBe("float");
    expect(placement({ type: "house", sky: true })).toBe("float");
  });

  it("places flat and terrain by group and other standing and building objects upright", () => {
    expect(placement({ type: "water", sky: true })).toBe("flat");
    expect(placement({ type: "hill", sky: true })).toBe("terrain");
    expect(placement({ type: "car", sky: false })).toBe("upright");
    expect(placement({ type: "castle", sky: false })).toBe("upright");
  });
});

describe("depth", () => {
  it("maps the horizon and above to Z_BACK, the bottom to Z_FRONT, monotone in between", () => {
    expect(depth(0, img)).toBe(Z_BACK);
    expect(depth(280, img)).toBe(Z_BACK); // 280 / 800 = HORIZON
    expect(depth(800, img)).toBe(Z_FRONT);
    for (let y = 0; y < 800; y += 10) expect(depth(y + 10, img)).toBeGreaterThanOrEqual(depth(y, img));
  });
});

describe("jitter", () => {
  it("is deterministic and stays in [−2, 2]", () => {
    for (let id = 0; id < 500; id++) {
      expect(jitter(id)).toBe(jitter(id));
      expect(Math.abs(jitter(id))).toBeLessThanOrEqual(2);
    }
    expect(jitter(0)).toBe(-2);
  });
});

describe("layout", () => {
  it("places standing objects upright on the ground with a 0.3 × width circle", () => {
    expect(one(inst(1, "tree", { x: 550, y: 400, w: 100, h: 400 }))).toEqual(
      { id: 1, kind: "upright", x: 0, y: 0, z: Z_FRONT, w: 2, h: 8, collide: { x: 0, z: Z_FRONT, r: 0.3 * 2 } });
  });

  it("gives buildings a 0.5 × width circle and clamps radii to [0.3, R_MAX]", () => {
    const house = one(inst(1, "house", { x: 0, y: 280, w: 200, h: 240 }));
    expect(house.kind).toBe("upright");
    expect(house.x).toBeCloseTo(-10);
    expect(house.z).toBeCloseTo(depth(520, img));
    expect(house.collide?.r).toBe(1.5); // 0.5 × 4 clamped
    expect(one(inst(2, "flower", { x: 0, y: 700, w: 25, h: 50 })).collide?.r).toBe(0.3); // 0.3 × 0.5 clamped
  });

  it("lays flat objects on the ground between the depths of their top and base rows", () => {
    const p = one(inst(1, "water", { x: 300, y: 600, w: 600, h: 100 }));
    expect(p).toMatchObject({ kind: "flat", x: 0, y: 0.01, w: 12, h: 0 });
    expect(p.z).toBeCloseTo((depth(600, img) + depth(700, img)) / 2);
    expect(p.d).toBeCloseTo(depth(700, img) - depth(600, img));
    expect(p.collide).toBeUndefined();
    expect(one(inst(2, "path", { x: 0, y: 0, w: 100, h: 100 })).d).toBe(0.2); // above the horizon: minimum extent
  });

  it("puts terrain behind Z_BACK at 1.5 × size", () => {
    expect(one(inst(1, "mountain", { x: 0, y: 100, w: 1200, h: 300 }))).toEqual(
      { id: 1, kind: "terrain", x: 0, y: 0, z: Z_BACK - 2, w: 36, h: 9 });
  });

  it("puts sun, moon, star and rainbow on the sky sphere at double size", () => {
    const p = one(inst(1, "sun", { x: 1100, y: 0, w: 100, h: 80 }));
    expect(p).toMatchObject({ kind: "sky", w: 4, h: 3.2 });
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(SKY_R);
    expect(deg(Math.asin(p.y / SKY_R))).toBeCloseTo(57.5); // lerp(10°, 60°, 1 − 40 / 800)
    expect(deg(Math.atan2(p.x, -p.z))).toBeCloseTo(66); // (1150 / 1200 − 0.5) × 144°
    const low = one(inst(2, "moon", { x: 0, y: 800, w: 0, h: 0 })), high = one(inst(3, "star", { x: 1200, y: 0, w: 0, h: 0 }));
    expect(deg(Math.asin(low.y / SKY_R))).toBeCloseTo(10);
    expect(deg(Math.atan2(low.x, -low.z))).toBeCloseTo(-72);
    expect(deg(Math.asin(high.y / SKY_R))).toBeCloseTo(60);
    expect(deg(Math.atan2(high.x, -high.z))).toBeCloseTo(72);
  });

  it("floats cloud, bird and sky-true standing or building objects mid-air with no circle", () => {
    const bbox = { x: 500, y: 0, w: 200, h: 160 }; // centre y 80 → y = lerp(1.5, 6, 0.9)
    for (const [id, type, sky] of [[1, "cloud", false], [2, "bird", false], [3, "animal", true], [4, "tower", true]] as const) {
      const p = one(inst(id, type, bbox, sky));
      expect(p).toEqual({ id, kind: "float", x: 0, y: expect.closeTo(5.55), z: (Z_BACK + Z_FRONT) / 2 + jitter(id), w: 4, h: 3.2 });
      expect(p.z).toBeGreaterThanOrEqual(-5);
      expect(p.z).toBeLessThanOrEqual(-1);
    }
    expect(one(inst(5, "bird", { x: 0, y: 800, w: 0, h: 0 })).y).toBe(1.5); // image bottom → lowest float height
  });

  it("keeps every id, sorted by id, whatever the input order", () => {
    const list = [
      inst(3, "tree", { x: 10, y: 300, w: 50, h: 100 }), inst(1, "sun", { x: 900, y: 20, w: 60, h: 60 }),
      inst(7, "water", { x: 0, y: 650, w: 400, h: 80 }), inst(2, "cloud", { x: 300, y: 40, w: 120, h: 60 }),
    ];
    const out = layout(list, img);
    expect(out.map((p) => p.id)).toEqual([1, 2, 3, 7]);
    expect(layout([...list].reverse(), img)).toEqual(out);
  });

  it("gives an upright object with a lower base row a z at least as close", () => {
    const zs = [300, 400, 500, 600, 700, 800].map((base, i) => one(inst(i, "person", { x: 100, y: base - 100, w: 40, h: 100 })).z);
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeGreaterThanOrEqual(zs[i - 1]);
  });
});
