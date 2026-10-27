import { describe, expect, it, vi } from "vitest";
import { fitBytes, IMAGE_MAX_BYTES, scaledSize, WORK_MAX_PX } from "../../src/image/encode";

describe("scaledSize", () => {
  it("scales the long side down to 1024 px and keeps the aspect", () => {
    expect(scaledSize(4032, 3024, WORK_MAX_PX)).toEqual({ w: 1024, h: 768 });
    expect(scaledSize(3000, 4000, WORK_MAX_PX)).toEqual({ w: 768, h: 1024 });
  });
  it("never scales up and keeps at least 1 px", () => {
    expect(scaledSize(1024, 768, WORK_MAX_PX)).toEqual({ w: 1024, h: 768 });
    expect(scaledSize(800, 600, WORK_MAX_PX)).toEqual({ w: 800, h: 600 });
    expect(scaledSize(5000, 1, WORK_MAX_PX)).toEqual({ w: 1024, h: 1 });
  });
});

describe("fitBytes", () => {
  // Fake encoder: size grows with quality, so only lower qualities fit.
  const sized = (bytesAt: (q: number) => number) => vi.fn(async (q: number) => new Blob([new Uint8Array(bytesAt(q))]));

  it("returns the highest JPEG quality that is ≤ 400 KB", async () => {
    const encode = sized((q) => Math.round(q * 600 * 1024));    // 0.65 → 390 KB is the first fit
    const blob = await fitBytes(encode);
    expect(blob.size).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
    expect(encode.mock.calls.map(([q]) => q)).toEqual([0.92, 0.85, 0.75, 0.65]);
  });
  it("accepts exactly the cap and stops at the first fit", async () => {
    const encode = sized(() => IMAGE_MAX_BYTES);
    expect((await fitBytes(encode)).size).toBe(IMAGE_MAX_BYTES);
    expect(encode).toHaveBeenCalledOnce();
  });
  it("throws when even the last step is too large", async () => {
    await expect(fitBytes(sized(() => 300), 200, [512, 384])).rejects.toThrow("does not fit");
  });
});
