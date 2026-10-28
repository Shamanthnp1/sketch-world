import { describe, expect, it } from "vitest";
import { foldAmount } from "../../src/world/popup";

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
