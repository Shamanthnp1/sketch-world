import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { thresholdMask } from "../../src/cut/threshold";

type Rgb = [number, number, number];
const grey = (v: number): Rgb => [v, v, v];
const byte = fc.integer({ min: 0, max: 255 });
// Pixels either side of the default threshold 200, including grey 200 and 199 exactly, plus any colour.
const lightPx = fc.oneof(fc.constantFrom<Rgb>([255, 255, 255], [200, 200, 200]), fc.integer({ min: 200, max: 255 }).map(grey));
const darkPx = fc.oneof(fc.constantFrom<Rgb>([0, 0, 0], [199, 199, 199]), fc.integer({ min: 0, max: 199 }).map(grey));
const anyPx = fc.oneof(lightPx, darkPx, fc.tuple(byte, byte, byte));

// A dark rectangle outline on a light background with light inside; an optional gap lets the outside leak in.
const ringArb = (w: number, h: number) =>
  fc
    .record({
      bg: lightPx, line: darkPx, inner: lightPx, gap: fc.option(fc.nat()),
      xs: fc.tuple(fc.nat(w - 1), fc.nat(w - 1)), ys: fc.tuple(fc.nat(h - 1), fc.nat(h - 1)),
    })
    .map(({ bg, line, inner, gap, xs, ys }) => {
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const px: Rgb[] = [], outline: number[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
          const edge = inside && (x === x0 || x === x1 || y === y0 || y === y1);
          if (edge) outline.push(px.length);
          px.push(edge ? line : inside ? inner : bg);
        }
      }
      if (gap !== null) px[outline[gap % outline.length]] = bg;
      return px;
    });

// Small crops: noise, two-tone light/dark grids, uniform (all light or all dark) and rings.
const cropArb = fc.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 })).chain(([w, h]) => {
  const n = w * h;
  return fc
    .oneof(
      fc.array(anyPx, { minLength: n, maxLength: n }),
      fc.tuple(lightPx, darkPx, fc.array(fc.boolean(), { minLength: n, maxLength: n }))
        .map(([l, d, bits]) => bits.map((b) => (b ? l : d))),
      anyPx.map((p) => Array<Rgb>(n).fill(p)),
      ringArb(w, h),
    )
    .map((px) => ({ w, h, rgba: Uint8ClampedArray.from(px.flatMap((p) => [...p, 255])) }));
});
// undefined uses the default threshold (200).
const lightArb = fc.oneof(
  fc.constant(undefined), fc.constant(200), fc.integer({ min: 0, max: 256 }), fc.double({ min: 0, max: 256, noNaN: true }),
);

/** Plain BFS reference: 0 = light pixel reachable from the crop border through light pixels, 1 = opaque. */
function reference(rgba: Uint8ClampedArray, w: number, h: number, light: number): number[] {
  const isLight = (x: number, y: number) => {
    const i = 4 * (y * w + x);
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2] >= light;
  };
  const out = Array<number>(w * h).fill(1), queue: [number, number][] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || out[y * w + x] === 0 || !isLight(x, y)) return;
    out[y * w + x] = 0;
    queue.push([x, y]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) visit(x, y);
  for (let k = 0; k < queue.length; k++) {
    const [x, y] = queue[k];
    visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
  }
  return out;
}

describe("Feature: sketch-world, Property 4: Threshold cut-out matches border-connected light pixels", () => {
  // **Validates: Requirements 5.6**
  it("is transparent exactly where a pixel is light and 4-connected to the crop border through light pixels", () => {
    fc.assert(fc.property(cropArb, lightArb, ({ w, h, rgba }, light) => {
      const mask = thresholdMask(rgba, w, h, light);
      expect(mask).toBeInstanceOf(Uint8Array);
      expect([...mask]).toEqual(reference(rgba, w, h, light ?? 200));
    }), { numRuns: 1000 });
  });
});
