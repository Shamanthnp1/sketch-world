import { describe, expect, it } from "vitest";
import smoke from "../fixtures/meta/smoke-sam.json";
import { parseSamOutput } from "../../src/sam/parse";

describe("parseSamOutput", () => {
  it("decodes the live smoke reply (noun 'house' on the 512×384 line drawing) to one offset mask", async () => {
    const masks = await parseSamOutput(smoke.output[0].content[0].text);    // the message item; no reasoning item
    expect(masks).toHaveLength(1);
    const [m] = masks;
    // Box x1=64 y1=110 x2=236 y2=328 (inclusive), mask data=219,173 (height, width).
    expect(m).toMatchObject({ width: 173, height: 219, left: 64, top: 110 });
    expect(m.data).toHaveLength(173 * 219);
    expect(m.data.every((v) => v === 0 || v === 1)).toBe(true);
    const set = m.data.reduce((n, v) => n + v, 0);
    expect(set).toBeGreaterThan(0.05 * m.data.length);
    expect(set).toBeLessThan(0.95 * m.data.length);
  });

  it("returns [] for empty output (zero matches)", async () => {
    expect(await parseSamOutput("")).toEqual([]);
  });

  it("returns [] for malformed output; bad lines become diagnostics, not throws", async () => {
    expect(await parseSamOutput("<0f>1<|box;x1=0|><|mask;data=bad|>\n")).toEqual([]);
    expect(await parseSamOutput("not segmentation output\n")).toEqual([]);
  });
});
