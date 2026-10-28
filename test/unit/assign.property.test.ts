// Feature: sketch-world, Property 3: No mask is assigned to two objects
// **Validates: Requirements 4.4, 4.5**
// Masks are built as image-sized G × G 0/1 arrays, cropped to MaskRasters for `assign`, and checked by painting
// each accepted raster back into the image (no assign.ts helpers).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assign } from "../../src/cut/assign";
import type { Candidate } from "../../src/cut/types";
import type { MaskRaster } from "../../src/sam/parse";

const G = 12; // the image is G × G pixels

/** A mask as an image-sized G × G array of 0/1. */
type Paint = Uint8Array;
type Box = { x: number; y: number; w: number; h: number };
type Shape =
  | { kind: "rect"; b: Box; holes: number[] } // a box with some pixels cleared
  | { kind: "dup"; src: number } // an exact copy of an earlier mask
  | { kind: "inner"; src: number; b: Box; holes: number[] } // nested: an earlier mask ∩ a box
  | { kind: "outer"; src: number; b: Box } // nesting: an earlier mask ∪ a box
  | { kind: "shift"; src: number; dx: number; dy: number }; // overlapping: an earlier mask moved

const area = (p: Paint) => p.reduce((n, v) => n + v, 0);
const inter = (a: Paint, b: Paint) => a.reduce((n, v, i) => n + (v & b[i]), 0);
const union = (a: Paint, b: Paint) => a.reduce((n, v, i) => n + (v | b[i]), 0);

/** Reference: every set pixel of the raster, painted at its image position. */
function paint(m: MaskRaster): Paint {
  const p = new Uint8Array(G * G);
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x]) p[(m.top + y) * G + m.left + x] = 1;
  return p;
}

/** Crops a mask to its set pixels plus up to `pad` empty pixels per side, clamped to the image. */
function toRaster(p: Paint, pad: number): MaskRaster {
  let x0 = G, y0 = G, x1 = -1, y1 = -1;
  p.forEach((v, i) => {
    if (!v) return;
    const x = i % G, y = Math.floor(i / G);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  });
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  const width = Math.min(G, x1 + 1 + pad) - left, height = Math.min(G, y1 + 1 + pad) - top;
  const data = Uint8Array.from({ length: width * height }, (_, i) => p[(top + Math.floor(i / width)) * G + left + (i % width)]);
  return { data, width, height, left, top };
}

/** The box clipped to the image, minus the hole pixels (hole k is pixel k of the box, row-major, wrapped). */
function boxPaint(b: Box, holes: readonly number[] = []): Paint {
  const p = new Uint8Array(G * G), w = Math.min(b.w, G - b.x), h = Math.min(b.h, G - b.y);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[(b.y + y) * G + b.x + x] = 1;
  for (const k of holes) p[(b.y + (Math.floor(k / w) % h)) * G + b.x + (k % w)] = 0;
  return p;
}

/** Builds one mask; an empty result falls back to one pixel (rect) or a copy of its source mask. */
function build(s: Shape, built: readonly Paint[]): Paint {
  if (s.kind === "rect") {
    const p = boxPaint(s.b, s.holes);
    if (area(p) === 0) p[s.b.y * G + s.b.x] = 1;
    return p;
  }
  const src = built[s.src % built.length];
  let p: Paint;
  if (s.kind === "dup") p = src.slice();
  else if (s.kind === "inner") { const b = boxPaint(s.b, s.holes); p = src.map((v, i) => v & b[i]); }
  else if (s.kind === "outer") { const b = boxPaint(s.b); p = src.map((v, i) => v | b[i]); }
  else {
    p = new Uint8Array(G * G);
    src.forEach((v, i) => {
      const x = (i % G) + s.dx, y = Math.floor(i / G) + s.dy;
      if (v && x >= 0 && x < G && y >= 0 && y < G) p[y * G + x] = 1;
    });
  }
  return area(p) > 0 ? p : src.slice();
}

const coord = fc.integer({ min: 0, max: G - 1 });
const side = fc.integer({ min: 1, max: 8 });
const box = fc.record({ x: coord, y: coord, w: side, h: side });
const holes = fc.array(fc.integer({ min: 0, max: 63 }), { maxLength: 12 });
const src = fc.nat();
const step = fc.integer({ min: -3, max: 3 });
const rect: fc.Arbitrary<Shape> = fc.record({ kind: fc.constant("rect" as const), b: box, holes });
const shape: fc.Arbitrary<Shape> = fc.oneof(
  rect,
  fc.record({ kind: fc.constant("dup" as const), src }),
  fc.record({ kind: fc.constant("inner" as const), src, b: box, holes }),
  fc.record({ kind: fc.constant("outer" as const), src, b: box }),
  fc.record({ kind: fc.constant("shift" as const), src, dx: step, dy: step }),
);
const entry = (s: fc.Arbitrary<Shape>) =>
  fc.record({ shape: s, obj: fc.integer({ min: 0, max: 3 }), idKey: fc.integer({ min: 0, max: 999 }), order: fc.nat(), pad: fc.integer({ min: 0, max: 2 }) });

/** Random counts (0–3 for 1–4 objects) and 1–12 candidates; the first one is a rect so derived masks have a source. */
const scenario = fc
  .record({
    counts: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 4 }),
    entries: fc.tuple(entry(rect), fc.array(entry(shape), { maxLength: 11 })).map(([a, rest]) => [a, ...rest]),
  })
  .map(({ counts, entries }) => {
    const built: Paint[] = [];
    for (const e of entries) built.push(build(e.shape, built));
    const keyed = entries.map((e, i) => {
      const mask = toRaster(built[i], e.pad);
      const c: Candidate = { id: e.idKey * 100 + i, objIndex: e.obj % counts.length, mask, area: area(paint(mask)) };
      return { order: e.order, c };
    });
    // The input order is random and unrelated to the sort order.
    const candidates = keyed.sort((a, b) => a.order - b.order).map((k) => k.c);
    return { counts, candidates };
  });

/** Negative when `a` comes before `b` in the Requirement 4.4 order (object order, area desc, id). */
const sortOrder = (a: Candidate, b: Candidate) => a.objIndex - b.objIndex || b.area - a.area || a.id - b.id;

describe("assign (property)", () => {
  it("Property 3: No mask is assigned to two objects", () => {
    fc.assert(
      fc.property(scenario, ({ counts, candidates }) => {
        const out = assign(candidates, counts);

        // Each candidate at most once, and only candidates from the input.
        expect(new Set(out.map((c) => c.id)).size).toBe(out.length);
        for (const c of out) expect(candidates).toContain(c);

        // At most `count` accepted masks per scene object.
        counts.forEach((k, o) => expect(out.filter((c) => c.objIndex === o).length).toBeLessThanOrEqual(k));

        // The output is in sort order.
        for (let i = 1; i < out.length; i++) expect(sortOrder(out[i - 1], out[i])).toBeLessThan(0);

        // Every accepted pair has IoU ≤ 0.5, and no accepted mask is ≥ 80% inside an earlier accepted mask.
        const ps = out.map((c) => paint(c.mask));
        for (let j = 0; j < ps.length; j++)
          for (let i = 0; i < j; i++) {
            const n = inter(ps[i], ps[j]);
            expect(2 * n).toBeLessThanOrEqual(union(ps[i], ps[j]));
            expect(5 * n).toBeLessThan(4 * area(ps[j]));
          }
      }),
      { numRuns: 500 },
    );
  });
});

