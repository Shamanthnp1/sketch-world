import { describe, expect, it } from "vitest";
import { ALL_TYPES } from "../../shared/scene";
import { BOUNCE_H, BOUNCE_T, GLOW, SHIMMER, TWINKLE, bounce, cardLabels, effect, labelAt } from "../../src/world/build";

const times = Array.from({ length: 400 }, (_, i) => i * 0.037);

describe("bounce", () => {
  it("is one arch of height BOUNCE_H over BOUNCE_T, and 0 outside it", () => {
    expect(bounce(0)).toBe(0);
    expect(bounce(BOUNCE_T / 2)).toBeCloseTo(BOUNCE_H);
    expect(bounce(BOUNCE_T * 0.25)).toBeGreaterThan(0);
    expect(bounce(BOUNCE_T)).toBe(0);
    expect(bounce(-0.1)).toBe(0);
    expect(bounce(Infinity)).toBe(0); // never tapped: bounceAt = −Infinity
  });
});

describe("effect", () => {
  it("water brightness pulses within [1 − SHIMMER, 1]", () => {
    const b = times.map((t) => effect("water", 3, t, false).bright);
    expect(Math.min(...b)).toBeGreaterThanOrEqual(1 - SHIMMER - 1e-12);
    expect(Math.max(...b)).toBeLessThanOrEqual(1);
    expect(Math.max(...b) - Math.min(...b)).toBeGreaterThan(SHIMMER * 0.9);
  });

  it("the sun's glow scale pulses by ±3%", () => {
    const g = times.map((t) => effect("sun", 0, t, false).glow);
    expect(GLOW).toBe(0.03);
    expect(Math.min(...g)).toBeGreaterThanOrEqual(1 - GLOW - 1e-12);
    expect(Math.max(...g)).toBeLessThanOrEqual(1 + GLOW + 1e-12);
    expect(Math.max(...g) - Math.min(...g)).toBeGreaterThan(GLOW * 1.9);
  });

  it("stars twinkle in opacity within [1 − TWINKLE, 1], out of step by id", () => {
    const a = times.map((t) => effect("star", 1, t, false).alpha);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(1 - TWINKLE - 1e-12);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    expect(effect("star", 1, 0.5, false).alpha).not.toBeCloseTo(effect("star", 2, 0.5, false).alpha);
  });

  it("is at rest when still and for every other type", () => {
    for (const type of ALL_TYPES) {
      expect(effect(type, 5, 1.3, true)).toEqual({ bright: 1, glow: 1, alpha: 1 });
      if (!["water", "sun", "star"].includes(type)) expect(effect(type, 5, 1.3, false)).toEqual({ bright: 1, glow: 1, alpha: 1 });
    }
  });
});

describe("cardLabels", () => {
  it("uses the noun, numbering repeated nouns in id order regardless of input order", () => {
    const labels = cardLabels([{ id: 2, noun: "tree" }, { id: 0, noun: "tree" }, { id: 1, noun: "house" }, { id: 3, noun: "tree" }]);
    expect([...labels.entries()].sort((a, b) => a[0] - b[0])).toEqual([[0, "tree 1"], [1, "house"], [2, "tree 2"], [3, "tree 3"]]);
  });
});

describe("labelAt", () => {
  it("sits at the tap, and stays 8 px inside the world near its edges", () => {
    expect(labelAt(180, 300, 360, 80, 30)).toEqual({ x: 180, y: 300 });
    expect(labelAt(5, 300, 360, 80, 30).x).toBe(48);   // left edge: 40 + 8
    expect(labelAt(355, 300, 360, 80, 30).x).toBe(312); // right edge: 360 − 40 − 8
    expect(labelAt(180, 10, 360, 80, 30).y).toBe(50);   // top: its height + 12 above + 8
  });
});
