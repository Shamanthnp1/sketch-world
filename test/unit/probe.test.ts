import { describe, expect, it } from "vitest";
import gateFixture from "../fixtures/meta/gate/line-drawing.json";
import { ApiError } from "../../src/api";
import { SegmentError } from "../../src/sam/client";
import { placeMask } from "../../src/sam/masks";
import { parseSamOutput, type MaskRaster } from "../../src/sam/parse";
import {
  costMicro, dollars, edgePixels, errorText, fixtureName, gateScore, markdownRow, maskFill, parseFixture,
  rejectReason, segmentNote,
} from "../../src/ui/probe";

const raster = (width: number, height: number, set: number, left = 0, top = 0): MaskRaster =>
  ({ data: Uint8Array.from({ length: width * height }, (_, i) => (i < set ? 1 : 0)), width, height, left, top });

describe("cost estimate", () => {
  it("uses the design.md fixed estimates: Spark $0.01 per understand call, SAM $0.0025 per segment call", () => {
    expect(costMicro(1, 0)).toBe(10_000);
    expect(costMicro(1, 3)).toBe(17_500);
    expect(dollars(costMicro(1, 0))).toBe("$0.01");
    expect(dollars(costMicro(1, 3))).toBe("$0.0175");
    expect(dollars(costMicro(1, 16))).toBe("$0.05");
  });
});

describe("maskFill and rejectReason (Requirement 4.3)", () => {
  it("is the set share of the mask's own box; 0 for an empty raster", () => {
    expect(maskFill(raster(10, 10, 25))).toBe(0.25);
    expect(maskFill(raster(0, 0, 0))).toBe(0);
  });

  it("rejects a mask under 5% of its box, and a box over 60% of the image (90% for flat and terrain)", () => {
    expect(rejectReason(raster(10, 10, 5), "house", 100, 100)).toBeNull();
    expect(rejectReason(raster(10, 10, 4), "house", 100, 100)).toBe("fills only 4% of its box");
    const big = raster(61, 100, 3000);    // box covers 61% of a 100 × 100 image
    expect(rejectReason(big, "house", 100, 100)).toBe("box covers 61% of the image");
    expect(rejectReason(big, "water", 100, 100)).toBeNull();
    expect(rejectReason(big, "hill", 100, 100)).toBeNull();
    expect(rejectReason(raster(91, 100, 5000), "water", 100, 100)).toBe("box covers 91% of the image");
  });
});

describe("edgePixels", () => {
  it("keeps the set pixels next to an unset pixel or the image edge", () => {
    const mask = new Uint8Array(25);
    for (const i of [6, 7, 8, 11, 12, 13, 16, 17, 18]) mask[i] = 1;    // 3 × 3 block inside 5 × 5
    expect(edgePixels(mask, 5, 5)).toEqual([6, 7, 8, 11, 13, 16, 17, 18]);
    expect(edgePixels(new Uint8Array(4).fill(1), 2, 2)).toEqual([0, 1, 2, 3]);
  });
});

describe("gateScore", () => {
  const rows = [
    { count: 3, accepted: 2, listed: true, clean: true },     // 3 trees listed, 2 clean cut-outs
    { count: 1, accepted: 4, listed: true, clean: true },     // extra masks count once
    { count: 1, accepted: 1, listed: false, clean: false },
  ];

  it("counts Spark counts for Listed and accepted masks up to the count for Clean", () => {
    expect(gateScore(rows, 5)).toEqual({ listed: 4 / 5, clean: 3 / 5 });
  });

  it("caps at 100% and needs a whole number of drawn objects ≥ 1", () => {
    expect(gateScore(rows, 2)).toEqual({ listed: 1, clean: 1 });
    for (const drawn of [NaN, 0, 2.5]) expect(gateScore(rows, drawn)).toBeNull();
  });
});

describe("markdownRow", () => {
  it("writes one docs/gate.md row", () => {
    expect(markdownRow({ file: "village.jpg", drawn: 5, score: { listed: 0.8, clean: 2 / 3 }, ms: 12_345, costMicro: 25_000 }))
      .toBe("| village.jpg | 5 | 80% | 67% | 12.3 s | $0.025 |");
  });

  it("prints a dash for missing values and escapes pipes in the file name", () => {
    expect(markdownRow({ file: "a|b.png", drawn: null, score: null, ms: null, costMicro: 10_000 }))
      .toBe("| a\\|b.png | — | — | — | — | $0.01 |");
  });
});

describe("replies fixture", () => {
  it("parses the committed line-drawing fixture, whose house reply lines up with the 512 × 384 image", async () => {
    const fx = parseFixture(gateFixture);
    expect(fx).not.toBeNull();
    expect(fx!.image).toEqual({ name: "line-drawing.png", w: 512, h: 384 });
    expect(fx!.understand.objects.map((o) => o.noun)).toEqual(["house", "tree", "sun"]);
    expect(Object.keys(fx!.segments)).toEqual(["house"]);
    const [m] = await parseSamOutput(fx!.segments.house);
    expect(rejectReason(m, "house", 512, 384)).toBeNull();
    expect(placeMask(m, 512, 384).reduce((n, v) => n + v, 0)).toBeGreaterThan(0);
  });

  it("round-trips the saved shape and rejects anything else", () => {
    const saved = JSON.parse(JSON.stringify({ image: { name: "x.png", w: 10, h: 8 }, understand: gateFixture.understand,
      segments: { house: "" } }));
    expect(parseFixture(saved)).toEqual(saved);
    expect(parseFixture({ ...saved, understand: undefined })).toBeNull();
    expect(parseFixture({ ...saved, image: { name: "x.png", w: 0, h: 8 } })).toBeNull();
    expect(parseFixture({ ...saved, segments: { house: 1 } })).toBeNull();
    expect(parseFixture(gateFixture.understand)).toBeNull();
  });

  it("is named after the image", () => {
    expect(fixtureName("line-drawing.png")).toBe("line-drawing.json");
    expect(fixtureName("cat.photo.jpeg")).toBe("cat.photo.json");
    expect(fixtureName("noext")).toBe("noext.json");
  });
});

describe("error text", () => {
  it("shows the Worker's 422 message and plain text for the other failures", () => {
    expect(errorText(new ApiError(422, "Please use a drawing"))).toBe("Please use a drawing. Pick another image.");
    expect(errorText(new ApiError(429, "x"))).toMatch(/try again in a minute/i);
    expect(errorText(new ApiError(502, "x"))).toMatch(/model failed/);
    expect(errorText(new ApiError(503, "x"))).toMatch(/budget/);
    expect(errorText(new ApiError(413, "Request body is too large")))
      .toBe("Request body is too large. Try again or pick another image.");
    expect(errorText(new TypeError("Failed to fetch"))).toMatch(/Couldn't reach the Worker/);
    expect(errorText(new SyntaxError("Unexpected token <"))).toMatch(/wrangler dev/);
    expect(errorText(new Error("at foo (bar.ts:1:2)"))).toBe("Something went wrong. Try again.");
  });

  it("notes a failed segment call on its row", () => {
    expect(segmentNote(new SegmentError(502))).toBe("Request failed (502)");
    expect(segmentNote(new SegmentError(429))).toMatch(/429/);
    expect(segmentNote(new TypeError("Failed to fetch"))).toBe("Network error");
  });
});
