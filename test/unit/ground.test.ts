import { describe, expect, it } from "vitest";
import { bandTop, groundColour, KRAFT, meanColour, mix, SKY_TOP, skyColours } from "../../src/world/ground";

type Rgb = [number, number, number];
/** w × h RGBA, each pixel colour(x, y). */
function img(w: number, h: number, colour: (x: number, y: number) => Rgb) {
  const data = new Uint8ClampedArray(4 * w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...colour(x, y), 255], 4 * (y * w + x));
  return { data, width: w, height: h };
}
const INK: Rgb = [20, 20, 20], PAPER: Rgb = [250, 246, 238];
/** An Instance-like mask over bbox, with mask value on(x, y) in bbox coordinates. */
const inst = (x: number, y: number, w: number, h: number, on: (x: number, y: number) => boolean = () => true) => ({
  bbox: { x, y, w, h }, mask: Uint8Array.from({ length: w * h }, (_, i) => +on(i % w, Math.floor(i / w))),
});

describe("groundColour", () => {
  it("is the colour of a uniform bottom band, whatever lies above it", () => {
    expect(groundColour(img(10, 20, (_x, y) => (y < 17 ? INK : [200, 190, 180])), [])).toBe("#c8beb4");
  });

  it("skips the pixels a mask covers, and keeps those under the mask's 0s", () => {
    // band rows 17–19; ink in columns 0–6 (most of the band), paper in 7–9
    const work = img(10, 20, (x) => (x < 7 ? INK : PAPER));
    expect(groundColour(work, [])).toBe("#141414");                       // unmasked: the ink is the median
    expect(groundColour(work, [inst(0, 10, 7, 10)])).toBe("#faf6ee");     // the ink's mask leaves only paper
    // a mask whose 1s cover only columns 0–1 leaves columns 2–6 of ink counted: ink is still the majority
    expect(groundColour(work, [inst(0, 10, 7, 10, (x) => x < 2)])).toBe("#141414");
  });

  it("takes the per-channel median: the middle value for an odd count, the rounded mean of the two middles for an even one", () => {
    // height 6: the band is row 5 only
    const odd = [[90, 0, 5], [10, 200, 5], [20, 100, 9]];
    expect(groundColour(img(3, 6, (x, y) => (y < 5 ? INK : (odd[x] as Rgb))), [])).toBe("#146405");
    const even = [[40, 0, 7], [10, 0, 7], [30, 255, 7], [20, 255, 7]];
    expect(groundColour(img(4, 6, (x, y) => (y < 5 ? INK : (even[x] as Rgb))), [])).toBe("#198007"); // 25, 127.5 → 128, 7
  });

  it("falls back to kraft when every band pixel is masked", () => {
    expect(groundColour(img(8, 10, () => PAPER), [inst(0, 0, 8, 10)])).toBe(KRAFT);
    expect(KRAFT).toBe("#d6ccbb");
  });

  it("starts the band at row floor(0.85 · height)", () => {
    expect([bandTop(100), bandTop(768), bandTop(20), bandTop(6), bandTop(1)]).toEqual([85, 652, 17, 5, 0]);
    // height 20: band rows 17–19 = white, white, ink → white. One row more (16, ink) or one fewer (no 17) gives grey.
    const work = img(1, 20, (_x, y) => (y === 17 || y === 18 ? [255, 255, 255] : INK));
    expect(groundColour(work, [])).toBe("#ffffff");
  });
});

describe("sky colours", () => {
  it("tints the ground towards white at the horizon, with the soft blue at the top", () => {
    expect(skyColours("#ffffff")).toEqual({ horizon: "#ffffff", top: SKY_TOP });
    const h = skyColours(KRAFT).horizon, ch = (s: string, i: number) => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16);
    for (let i = 0; i < 3; i++) {
      expect(ch(h, i)).toBeGreaterThan(ch(KRAFT, i));
      expect(ch(h, i)).toBeLessThan(255);
    }
  });

  it("mixes and averages #rrggbb colours", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#102030", "#ffffff", 0)).toBe("#102030");
    expect(meanColour([10, 20, 30, 255, 30, 40, 50, 0])).toBe("#141e28");
  });
});
