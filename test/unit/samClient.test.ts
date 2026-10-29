import { describe, expect, it, vi } from "vitest";
import smoke from "../fixtures/meta/smoke-sam.json";
import { retryWaitMs, SamClient, SegmentError } from "../../src/sam/client";

const img = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
const ok = (outputText = "") => Response.json({ outputText });
const field = (init: RequestInit, name: string) => (init.body as FormData).get(name);
const samText = smoke.output[0].content[0].text;    // the message item; SAM replies have no reasoning item

describe("SamClient", () => {
  it("starts requests FIFO with at most 3 in flight, and a 500 rejects without blocking the queue", async () => {
    const nouns = ["a", "b", "c", "d", "e", "f", "g"];
    const delay: Record<string, number> = { a: 15, b: 5, c: 10 };    // uneven, so slots free up out of order
    const started: string[] = [];
    let inFlight = 0, maxInFlight = 0;
    const client = new SamClient({
      fetch: async (_url, init) => {
        const noun = field(init, "noun") as string;
        started.push(noun);
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await new Promise((r) => setTimeout(r, delay[noun] ?? 1));
        inFlight--;
        return noun === "b" ? new Response("boom", { status: 500 }) : ok();
      },
    });

    const results = await Promise.allSettled(nouns.map((noun) => client.segment(img, { noun })));

    expect(started).toEqual(nouns);
    expect(maxInFlight).toBe(3);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", ...Array(5).fill("fulfilled")]);
    const err = (results[1] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(SegmentError);
    expect(err.status).toBe(500);
  });

  it("on 429 waits Retry-After, then resends the same image and noun", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "3" } }))
      .mockResolvedValueOnce(ok(samText));
    const sleep = vi.fn(async () => {});
    const client = new SamClient({ fetch, sleep });

    const res = await client.segment(img, { noun: "house" });

    expect(res.outputText).toBe(samText);
    expect(res.masks).toHaveLength(1);
    expect(res.ms).toBeGreaterThanOrEqual(0);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3000);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe("/api/segment");
      expect(field(init, "image")).toBeInstanceOf(Blob);
      expect(field(init, "noun")).toBe("house");
      expect(field(init, "box")).toBeNull();
    }
  });

  it("sends a box prompt as JSON without a noun", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ok());
    const box = { x: 1.5, y: 2, w: 30, h: 40 };

    await new SamClient({ fetch, base: "https://w.example" }).segment(img, { box });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://w.example/api/segment");
    expect(JSON.parse(field(init, "box") as string)).toEqual(box);
    expect(field(init, "noun")).toBeNull();
  });

  it("rejects after 3 retries on repeated 429, backing off 2 s, 4 s, 8 s without Retry-After", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 429 }));
    const sleep = vi.fn(async () => {});
    const client = new SamClient({ fetch, sleep });

    await expect(client.segment(img, { noun: "tree" })).rejects.toMatchObject({ name: "SegmentError", status: 429 });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[2000], [4000], [8000]]);
  });

  it("with the real timer, 429 twice waits 2 s then 4 s and the third request succeeds", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn()
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(ok(samText));
      const res = new SamClient({ fetch }).segment(img, { noun: "house" });
      const calls = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); return fetch.mock.calls.length; };
      expect(await calls(1999)).toBe(1);
      expect(await calls(1)).toBe(2);
      expect(await calls(3999)).toBe(2);
      expect(await calls(1)).toBe(3);
      vi.useRealTimers();
      expect((await res).masks).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries the reply's mode on a 503, so the page can spot the daily cap", async () => {
    const fetch = vi.fn(async () => Response.json({ mode: "sample", reason: "visitor", error: "Daily budget used up" }, { status: 503 }));
    await expect(new SamClient({ fetch }).segment(img, { noun: "sun" })).rejects.toMatchObject({ status: 503, mode: "sample", reason: "visitor" });
    expect(fetch).toHaveBeenCalledTimes(1); // only 429 is retried
    const plain = vi.fn(async () => new Response("<html>busy</html>", { status: 503 }));
    await expect(new SamClient({ fetch: plain }).segment(img, { noun: "sun" })).rejects.toMatchObject({ status: 503, mode: undefined, reason: undefined });
  });
});

describe("retryWaitMs", () => {
  it("honours Retry-After seconds up to 10 s, and backs off 2, 4, 8 s without a usable one", () => {
    expect(retryWaitMs("3", 0)).toBe(3000);
    expect(retryWaitMs("0", 2)).toBe(0);
    expect(retryWaitMs("60", 0)).toBe(10_000);
    expect([0, 1, 2].map((r) => retryWaitMs(null, r))).toEqual([2000, 4000, 8000]);
    expect(retryWaitMs("Wed, 21 Oct 2026 07:28:00 GMT", 1)).toBe(4000); // an HTTP-date: the backoff
    expect(retryWaitMs("-5", 0)).toBe(2000);
  });
});
