import { afterEach, expect, it, vi } from "vitest";
import { chainIO, STALE_RUN } from "../../src/cut/io";

afterEach(() => { vi.unstubAllGlobals(); });

it("sends no queued SAM call and no point call once the run is stale", async () => {
  const fetch = vi.fn(async () => Response.json({ outputText: "" }));
  vi.stubGlobal("fetch", fetch);
  let live = true;
  const io = chainIO(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), () => live);

  // 5 noun requests: SamClient sends 3 at once and queues 2. Then the user leaves the page.
  const segments = ["house", "tree", "sun", "cloud", "bird"].map((noun) => io.segment({ noun }));
  expect(fetch).toHaveBeenCalledTimes(3);
  live = false;
  const results = await Promise.allSettled(segments);

  expect(fetch).toHaveBeenCalledTimes(3);
  expect(results.slice(3)).toEqual([0, 1].map(() => ({ status: "rejected", reason: new Error(STALE_RUN) })));
  await expect(io.point([{ type: "tree", noun: "tree", count: 1 }])).rejects.toThrow(STALE_RUN);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("sends every request while the run is live", async () => {
  const fetch = vi.fn(async (url: string) => (url === "/api/point" ? Response.json({ boxes: [] }) : Response.json({ outputText: "" })));
  vi.stubGlobal("fetch", fetch);
  const io = chainIO(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]));

  await Promise.all(["house", "tree", "sun", "cloud"].map((noun) => io.segment({ noun })));
  expect(await io.point([{ type: "tree", noun: "tree", count: 1 }])).toEqual({ boxes: [] });
  expect(fetch).toHaveBeenCalledTimes(5);
});
