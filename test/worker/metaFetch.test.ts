import { afterEach, expect, it, vi } from "vitest";
import { MetaApiError, metaFetch, type MetaCall } from "../../worker/meta/metaFetch";

const KEY = "sk-test-secret-key";
const env = { MODEL_API_KEY: KEY };
const call: MetaCall = { route: "backdrop", model: "muse-image-1.0", path: "/responses", body: { input: "secret prompt" } };

afterEach(() => vi.restoreAllMocks());

// Replays `replies` in order (a reply that throws stands for a timeout or network error) and records waits.
function transport(...replies: Array<() => Response>) {
  let n = 0;
  const waits: number[] = [];
  const deps = { fetch: vi.fn(async () => replies[n++]!()), sleep: async (ms: number) => void waits.push(ms), random: () => 0.5 };
  return { deps, waits };
}

// The OpenAI-style error envelope the Meta API replies with.
const errorBody = (code: string) => JSON.stringify({ error: { type: "invalid_request_error", code, message: "secret message" } });

it("sends the bearer key and model to api.meta.ai/v1 and logs only route, model, status, latency", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ output: "secret output" }));

  const res = await metaFetch(env, call, { fetch });

  expect(res.status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe("https://api.meta.ai/v1/responses");
  expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${KEY}`);
  expect(JSON.parse(String(init.body))).toEqual({ input: "secret prompt", model: "muse-image-1.0" });
  expect(log).toHaveBeenCalledTimes(1);
  expect(Object.keys(JSON.parse(String(log.mock.calls[0]![0]))).sort()).toEqual(["attempt", "latencyMs", "model", "route", "status"]);
});

it("retries 429 and 5xx for 3 attempts in total, honours Retry-After, then throws MetaApiError with the last code", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const { deps, waits } = transport(
    () => new Response("secret body", { status: 429, headers: { "Retry-After": "2" } }),
    () => new Response("secret body", { status: 500 }),
    () => new Response(errorBody("server_error"), { status: 503 }),    // Muse Image's retryable failure
  );

  const err = await metaFetch(env, call, deps).catch((e: unknown) => e);

  expect(err).toBeInstanceOf(MetaApiError);
  expect(err).toMatchObject({ status: 503, code: "server_error" });
  expect(deps.fetch).toHaveBeenCalledTimes(3);
  expect(waits).toEqual([2000, 500]);    // Retry-After 2 s beats the 250 ms jitter; then 0.5 × 1000 ms
  const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
  expect(logged).not.toContain(KEY);
  expect(logged).not.toContain("secret");
});

it('retries a timeout and a network error, logging them as "timeout" and "error"', async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const { deps, waits } = transport(
    () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); },
    () => { throw new TypeError("Network connection lost"); },
    () => Response.json({}),
  );

  const res = await metaFetch(env, call, deps);

  expect(res.status).toBe(200);
  expect(deps.fetch).toHaveBeenCalledTimes(3);
  expect(waits).toEqual([250, 500]);    // 0.5 × 500 ms, then 0.5 × 1000 ms
  expect(log.mock.calls.map((c) => JSON.parse(String(c[0])).status)).toEqual(["timeout", "error", 200]);
});

it.each<{ why: string; status: number; headers: HeadersInit }>([
  { why: "a non-retryable 4xx", status: 400, headers: {} },
  { why: "Retry-After beyond the 8 s cap", status: 429, headers: { "Retry-After": "9" } },
])("fails after 1 attempt without waiting on $why", async ({ status, headers }) => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { deps, waits } = transport(() => new Response(null, { status, headers }));

  const err = await metaFetch(env, call, deps).catch((e: unknown) => e);

  expect(err).toBeInstanceOf(MetaApiError);
  expect(err).toMatchObject({ status, code: null });
  expect(deps.fetch).toHaveBeenCalledTimes(1);
  expect(waits).toEqual([]);
});

it.each<{ why: string; body: () => BodyInit; code: string | null }>([
  { why: "a content policy refusal", body: () => errorBody("content_policy_violation"), code: "content_policy_violation" },
  { why: "a non-JSON body", body: () => "<html>secret page</html>", code: null },
  // Never ends: only the read cap lets metaFetch return.
  { why: "an endless body", body: () => new ReadableStream({ pull: (c) => c.enqueue(new TextEncoder().encode('{"secret":"')) }), code: null },
])("reads the 4xx error code from $why in 1 attempt without logging the body", async ({ body, code }) => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const { deps, waits } = transport(() => new Response(body(), { status: 400 }));

  const err = await metaFetch(env, call, deps).catch((e: unknown) => e);

  expect(err).toBeInstanceOf(MetaApiError);
  expect(err).toMatchObject({ status: 400, code });
  expect(deps.fetch).toHaveBeenCalledTimes(1);
  expect(waits).toEqual([]);
  expect(log.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("secret");
});

it("honours Retry-After given as an HTTP date", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const at = new Date(Date.now() + 3000).toUTCString();    // whole seconds, so 2–3 s from now
  const { deps, waits } = transport(() => new Response(null, { status: 503, headers: { "Retry-After": at } }), () => Response.json({}));

  const res = await metaFetch(env, call, deps);

  expect(res.status).toBe(200);
  expect(waits).toHaveLength(1);
  expect(waits[0]).toBeGreaterThan(1000);    // well above the 250 ms jitter
  expect(waits[0]).toBeLessThanOrEqual(3000);
});

// The router's MetaApiError → 502/422 mapping is tested with the routes that call metaFetch (2.4, 8.1).
