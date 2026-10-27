/// <reference types="vite/client" />
// POST /api/segment through the router, with the outbound SAM call mocked (no live API calls).
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import drawing from "../fixtures/images/line-drawing.png?inline";    // 512×384
import sam from "../fixtures/meta/smoke-sam.json";    // SAM's real reply for the noun "house" on that drawing
import { MAX_IMAGE_BYTES } from "../../worker/limits/input";

// Set in vitest.config.ts. Compared as booleans, so a failed check never prints a key.
const KEY = "test-only-model-api-key";
const drawingBytes = Uint8Array.from(atob(drawing.split(",")[1]!), (c) => c.charCodeAt(0));
const box = JSON.stringify({ x: 10.5, y: 20, w: 50, h: 60.2 });
const ONE_PROMPT = "Send exactly one of noun or box";

const png = (bytes: Uint8Array) => new File([bytes], "drawing.png");
const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const segment = (body: BodyInit) => exports.default.fetch(new Request("https://example.com/api/segment", { method: "POST", body }));
const padded = new Uint8Array(MAX_IMAGE_BYTES + 1);
padded.set(drawingBytes);
// The whole /responses body for one SAM call with this text prompt.
const samBody = (text: string) => ({
  store: false,
  model: "sam-3.1",
  input: [{
    type: "message",
    role: "user",
    content: [
      { type: "input_text", text },
      { type: "input_image", image_url: drawing },
    ],
  }],
});

let consoleSpies: MockInstance[] = [];
const logged = () => consoleSpies.flatMap((s) => s.mock.calls.flat().map(String)).join("\n");
beforeEach(() => {
  consoleSpies = [vi.spyOn(console, "log"), vi.spyOn(console, "error")].map((s) => s.mockImplementation(() => {}));
});
afterEach(() => vi.restoreAllMocks());

it("sends the noun as the SAM prompt with store: false and returns the fixture's output text", async () => {
  // Replies are built inside the mock so their bodies belong to the handler's request context.
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(sam));

  const res = await segment(form({ image: png(drawingBytes), noun: "house" }));
  const text = await res.text();

  expect(res.status).toBe(200);
  expect(JSON.parse(text)).toEqual({ outputText: sam.output[0]!.content[0]!.text });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe("https://api.meta.ai/v1/responses");
  expect(new Headers(init?.headers).get("Authorization") === `Bearer ${KEY}`).toBe(true);
  expect(JSON.parse(String(init?.body))).toEqual(samBody("house"));
  expect(text.includes(KEY)).toBe(false);
  expect(logged().includes('"route":"segment"')).toBe(true);    // proves the log capture works
  expect(logged().includes(KEY)).toBe(false);
});

it("sends a box as a whole-pixel SAM box prompt with store: false", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(sam));

  const res = await segment(form({ image: png(drawingBytes), box }));

  expect(res.status).toBe(200);
  // Box 10.5,20 + 50×60.2 → whole-pixel edges 10,20–61,81; the prompt's x2/y2 are inclusive.
  expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual(samBody("<0f>1<|box;x1=10;y1=20;x2=60;y2=80;w=512;h=384|>"));
});

it("returns an empty outputText when SAM finds nothing", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ...sam, output: [] }));

  const res = await segment(form({ image: png(drawingBytes), noun: "house" }));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ outputText: "" });
});

it.each<[string, number, string, BodyInit]>([
  ["both noun and box", 400, ONE_PROMPT, form({ image: png(drawingBytes), noun: "house", box })],
  ["neither noun nor box", 400, ONE_PROMPT, form({ image: png(drawingBytes) })],
  ["an uppercase noun", 400, "noun must be 1–40 lowercase letters, spaces or hyphens, starting with a letter", form({ image: png(drawingBytes), noun: "House" })],
  ["a box outside the image", 400, "box does not overlap the image", form({ image: png(drawingBytes), box: '{"x":600,"y":0,"w":10,"h":10}' })],
  ["an image over 400 KB", 413, "image is larger than 400 KB", form({ image: png(padded), noun: "house" })],
  ["a GIF", 415, "image must be a JPEG or PNG image", form({ image: new File(["GIF89a"], "drawing.gif"), noun: "house" })],
])("rejects %s with %i and makes no SAM call", async (_, status, error, body) => {
  const fetch = vi.spyOn(globalThis, "fetch");

  const res = await segment(body);

  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error });
  expect(fetch).not.toHaveBeenCalled();
});

it("returns 502 {error} after three 500s from SAM", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0);    // zero backoff jitter keeps the retries instant
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("upstream error", { status: 500 }));

  const res = await segment(form({ image: png(drawingBytes), noun: "house" }));
  const text = await res.text();

  expect(res.status).toBe(502);
  expect(JSON.parse(text)).toEqual({ error: "The model service failed. Please retry." });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(text.includes(KEY)).toBe(false);
  expect(logged().includes(KEY)).toBe(false);
});
