import { describe, expect, it } from "vitest";
import { bilinear, invBilinear, validateQuad, type Quad } from "../../src/paper/quad";

const quad = (...xy: number[]): Quad => [0, 1, 2, 3].map((i) => ({ x: xy[2 * i], y: xy[2 * i + 1] })) as Quad;
const rect = (w: number, h: number) => quad(100, 100, 100 + w, 100, 100 + w, 100 + h, 100, 100 + h);
const rotate = (q: Quad, deg: number): Quad => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return q.map(({ x, y }) => ({ x: 500 + (x - 500) * c - (y - 500) * s, y: 500 + (x - 500) * s + (y - 500) * c })) as Quad;
};
const SKEWED = quad(120, 90, 610, 130, 650, 760, 80, 700);
const reason = (q: Quad) => {
  const r = validateQuad(q);
  return r.ok ? "ok" : r.reason;
};

describe("validateQuad", () => {
  it("accepts a square, A4 portrait and landscape, and the 1.8 limit", () => {
    for (const q of [rect(400, 400), rect(400, 566), rect(566, 400), rect(400, 720)]) expect(validateQuad(q)).toEqual({ ok: true });
  });
  it("accepts rotated and skewed convex clockwise quads", () => {
    expect(validateQuad(rotate(rect(400, 566), 30))).toEqual({ ok: true });
    expect(validateQuad(rotate(rect(566, 400), -70))).toEqual({ ok: true });
    expect(validateQuad(SKEWED)).toEqual({ ok: true });
  });
  it("rejects counter-clockwise corners", () => {
    const [a, b, c, d] = rect(400, 566);
    expect(reason([a, d, c, b])).toMatch(/^Counter-clockwise/);
    expect(reason([SKEWED[0], SKEWED[3], SKEWED[2], SKEWED[1]])).toMatch(/^Counter-clockwise/);
  });
  it("rejects concave, self-crossing and degenerate quads", () => {
    expect(reason(quad(100, 100, 500, 100, 250, 250, 100, 666))).toMatch(/^Not convex/);
    expect(reason(quad(100, 100, 500, 100, 100, 666, 500, 666))).toMatch(/^Not convex/);
    expect(reason(quad(100, 100, 500, 100, 500, 100, 100, 666))).toMatch(/^Not convex/);
  });
  it("rejects an aspect above 1.8", () => {
    expect(reason(rect(400, 760))).toMatch(/^Wrong shape: .*1\.90/);
    expect(reason(rotate(rect(800, 400), 20))).toMatch(/^Wrong shape/);
  });
});

describe("bilinear / invBilinear", () => {
  it("maps the unit square corners to the quad corners in order", () => {
    expect([bilinear(SKEWED, 0, 0), bilinear(SKEWED, 1, 0), bilinear(SKEWED, 1, 1), bilinear(SKEWED, 0, 1)]).toEqual(SKEWED);
  });
  it("inverts a rectangle exactly", () => {
    expect(invBilinear(rect(400, 566), { x: 200, y: 241.5 })).toEqual({ u: 0.25, v: 0.25 });
  });
  it("round-trips (u, v) on rotated, skewed and parallelogram quads", () => {
    const shear = quad(100, 100, 500, 150, 560, 700, 160, 650);
    for (const q of [rotate(rect(400, 566), 30), SKEWED, shear]) {
      for (const u of [0, 0.3, 0.7, 1]) {
        for (const v of [0, 0.5, 1]) {
          const uv = invBilinear(q, bilinear(q, u, v))!;
          expect(uv.u).toBeCloseTo(u, 9);
          expect(uv.v).toBeCloseTo(v, 9);
        }
      }
    }
  });
  it("returns null outside the quad", () => {
    expect(invBilinear(SKEWED, { x: 50, y: 50 })).toBeNull();
    expect(invBilinear(SKEWED, { x: 700, y: 400 })).toBeNull();
  });
});
