import { describe, expect, it } from "vitest";
import { PRIVACY_KEY, PRIVACY_POINTS, privacyAccepted, rememberPrivacy } from "../../src/ui/privacy";

/** A Storage stand-in: a Map, or one whose every call throws (Safari private mode, storage blocked). */
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const broken = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };

describe("privacy acceptance storage", () => {
  it("is not accepted on a fresh device, and is once remembered", () => {
    const s = memory();
    expect(privacyAccepted(s)).toBe(false);
    rememberPrivacy(s);
    expect(privacyAccepted(s)).toBe(true);
    expect([...s.m]).toEqual([[PRIVACY_KEY, "1"]]);
  });
  it("counts another value under the key as not accepted", () => {
    const s = memory();
    s.setItem(PRIVACY_KEY, "true");
    expect(privacyAccepted(s)).toBe(false);
  });
  it("treats storage that throws or is missing as not accepted, without throwing", () => {
    expect(() => rememberPrivacy(broken)).not.toThrow();
    expect(privacyAccepted(broken)).toBe(false);
    expect(() => rememberPrivacy(null)).not.toThrow();
    expect(privacyAccepted(null)).toBe(false);
  });
});

describe("privacy notice text (Requirement 12.1)", () => {
  it("says the drawing goes to Meta's models, saved worlds are public and in the Gallery, and the saving device can delete", () => {
    const text = PRIVACY_POINTS.join(" ");
    expect(text).toMatch(/drawing is sent to Meta’s AI models/);
    expect(text).toMatch(/only the flattened drawing is sent/);
    expect(text).toMatch(/anyone with its link can open it, and it’s listed in the Gallery/);
    expect(text).toMatch(/device that saved a world can delete it/);
  });
});
