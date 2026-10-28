import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bilinear, invBilinear, validateQuad, type Quad } from "../../src/paper/quad";

const TOL = 1e-6;
const frac = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

// A paper photo: a rectangle with aspect 1.0–1.8 (portrait or landscape), each corner moved by up to 15% of the
// short side (perspective and sloppy clicks), rotated by any angle, then scaled and placed inside a random photo.
// Corners stay in order top-left → top-right → bottom-right → bottom-left of the paper, so clockwise on screen.
const quadArb = fc
  .record({
    photo: fc.tuple(fc.integer({ min: 64, max: 4096 }), fc.integer({ min: 64, max: 4096 })),
    aspect: frac(1, 1.8),
    portrait: fc.boolean(),
    jitter: fc.oneof(fc.constant(0), frac(0, 0.15)),
    moves: fc.array(fc.tuple(frac(-1, 1), frac(-1, 1)), { minLength: 4, maxLength: 4 }),
    angle: frac(-Math.PI, Math.PI),
    fill: frac(0.05, 1),
    at: fc.tuple(frac(0, 1), frac(0, 1)),
  })
  .map(({ photo: [W, H], aspect, portrait, jitter, moves, angle, fill, at }) => {
    const [w, h] = portrait ? [1 / aspect, 1] : [1, 1 / aspect], j = jitter * Math.min(w, h);
    const c = Math.cos(angle), s = Math.sin(angle);
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y], i) => {
      const [x1, y1] = [x + j * moves[i][0], y + j * moves[i][1]];
      return { x: x1 * c - y1 * s, y: x1 * s + y1 * c };
    });
    const x0 = Math.min(...pts.map((p) => p.x)), y0 = Math.min(...pts.map((p) => p.y));
    const bw = Math.max(...pts.map((p) => p.x)) - x0, bh = Math.max(...pts.map((p) => p.y)) - y0;
    const k = fill * Math.min(W / bw, H / bh), tx = at[0] * (W - k * bw), ty = at[1] * (H - k * bh);
    return pts.map((p) => ({ x: tx + k * (p.x - x0), y: ty + k * (p.y - y0) })) as Quad;
  });

// Any (u, v) in [0, 1]², with the corners, edges and centre always reachable.
const unit = fc.oneof(fc.constantFrom(0, 0.5, 1), frac(0, 1));
const uvsArb = fc.array(fc.tuple(unit, unit), { minLength: 1, maxLength: 16 });

describe("Feature: sketch-world, Property 5: Paper flatten round trip", () => {
  // **Validates: Requirements 1.2, 1.5**
  it("invBilinear(q, bilinear(q, u, v)) returns (u, v) within 1e-6 for every quad passing validateQuad", () => {
    fc.assert(
      fc.property(quadArb, uvsArb, (q, uvs) => {
        fc.pre(validateQuad(q).ok);
        for (const [u, v] of uvs) {
          const back = invBilinear(q, bilinear(q, u, v));
          expect(back, `(u, v) = (${u}, ${v})`).not.toBeNull();
          expect(Math.abs(back!.u - u)).toBeLessThanOrEqual(TOL);
          expect(Math.abs(back!.v - v)).toBeLessThanOrEqual(TOL);
        }
      }),
      { numRuns: 2000 },
    );
  });
});
