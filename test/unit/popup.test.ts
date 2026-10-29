import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  INTRO_CARD, INTRO_LEAD, INTRO_S, foldAmount, introFold, introLean, introOrder, introStart,
} from "../../src/world/popup";

describe("foldAmount", () => {
  it("is flat at 8 units, half up at 6 and upright at 4", () => {
    expect(foldAmount(0, 8, false)).toBe(0);
    expect(foldAmount(0, 6, false)).toBeCloseTo(0.5);
    expect(foldAmount(0, 4, false)).toBe(1);
  });

  it("clamps beyond 8 and within 4 units", () => {
    expect(foldAmount(0, 20, false)).toBe(0);
    expect(foldAmount(0, 0, false)).toBe(1);
  });

  it("stays raised when the player walks away", () => {
    const near = foldAmount(0, 5, false);
    expect(foldAmount(near, 7, false)).toBe(near);
    expect(foldAmount(1, 20, false)).toBe(1);
  });

  it("is always upright with reduced motion", () => {
    expect(foldAmount(0, 20, true)).toBe(1);
    expect(foldAmount(0, 0, true)).toBe(1);
  });
});

// A turn `order` of `count` upright Cards (at most 30 objects in a scene).
const turn = fc.integer({ min: 1, max: 30 }).chain((count) => fc.record({ count: fc.constant(count), order: fc.integer({ min: 0, max: count - 1 }) }));
const time = fc.double({ min: 0, max: 4, noNaN: true });

describe("intro pop-up", () => {
  it("has every Card flat at t = 0 and upright within 3 s", () => {
    expect(INTRO_S).toBeLessThanOrEqual(3);
    for (const [order, count] of [[0, 1], [0, 12], [11, 12], [29, 30]]) {
      expect(introFold(order, count, 0, false)).toBe(0);
      expect(introFold(order, count, INTRO_S, false)).toBe(1);
      expect(introLean(order, count, INTRO_S, false)).toBe(0);
    }
  });

  it("staggers the starts, nearest first, 0.15 s apart until 30 Cards squeeze the spread", () => {
    expect(introStart(0, 5)).toBe(INTRO_LEAD);
    expect(introStart(1, 5) - introStart(0, 5)).toBeCloseTo(0.15);
    expect(introStart(29, 30)).toBeCloseTo(INTRO_S - INTRO_CARD);
    const t = introStart(1, 5) + 0.1; // the first Card is well on its way, the second just started, the third waits
    expect(introFold(0, 5, t, false)).toBeGreaterThan(introFold(1, 5, t, false));
    expect(introFold(1, 5, t, false)).toBeGreaterThan(0);
    expect(introFold(2, 5, t, false)).toBe(0);
  });

  it("leans a little past upright and settles", () => {
    const peak = Math.max(...Array.from({ length: 61 }, (_, i) => introLean(0, 1, INTRO_LEAD + i / 100, false)));
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(0.07);
    expect(introLean(0, 1, INTRO_LEAD + INTRO_CARD, false)).toBeCloseTo(0, 9);
  });

  it("is upright at once with reduced motion", () => {
    expect(introFold(29, 30, 0, true)).toBe(1);
    expect(introLean(0, 1, INTRO_LEAD + 0.4, true)).toBe(0);
  });

  it("orders Cards nearest first, ties in input order", () => {
    const ps = [{ x: 0, z: -10 }, { x: 3, z: 4 }, { x: 0, z: 2 }, { x: -3, z: 4 }];
    expect(introOrder(ps, { x: 0, z: 9 })).toEqual([3, 0, 2, 1]); // 19, 5.83, 7 and 5.83 units away
  });

  /** **Validates: Requirements 8.4** */
  it("property: the intro fold is 0…1, never lowers in t, and is 1 from INTRO_S on", () => {
    fc.assert(fc.property(turn, time, time, ({ order, count }, a, b) => {
      const [t1, t2] = a <= b ? [a, b] : [b, a], f1 = introFold(order, count, t1, false), f2 = introFold(order, count, t2, false);
      expect(f1).toBeGreaterThanOrEqual(0);
      expect(f2).toBeLessThanOrEqual(1);
      expect(f2).toBeGreaterThanOrEqual(f1 - 1e-12);
      expect(introFold(order, count, INTRO_S + t1, false)).toBe(1);
    }));
  });

  /** **Validates: Requirements 8.4** */
  it("property: a nearer Card is never behind a farther one", () => {
    fc.assert(fc.property(turn, time, ({ order, count }, t) => {
      if (order + 1 < count) expect(introFold(order, count, t, false)).toBeGreaterThanOrEqual(introFold(order + 1, count, t, false));
    }));
  });
});
