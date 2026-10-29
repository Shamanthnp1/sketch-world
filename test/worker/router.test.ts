import { env, exports } from "cloudflare:workers";
import { expect, it, vi } from "vitest";

const call = (method: string, path: string) => exports.default.fetch(new Request(`https://example.com${path}`, { method }));

it.each([
  ["GET", "/api/nope"],
  ["GET", "/api/worlds/abc/extra"],
  ["POST", "/api"],
])("returns 404 JSON for unknown %s %s", async (method, path) => {
  const res = await call(method, path);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Not found" });
});

it("returns 405 with Allow for a known path and the wrong method", async () => {
  const res = await call("PUT", "/api/worlds/abc");
  expect(res.status).toBe(405);
  expect(res.headers.get("Allow")).toBe("GET, DELETE, PATCH");
  expect(await res.json()).toEqual({ error: "Method not allowed" });
});

it.each([
  ["POST", "/api/backdrop"],
  ["POST", "/api/segment"],
  ["POST", "/api/worlds"],
  ["DELETE", "/api/worlds/AAAAAAAAAA"],
])("refuses %s %s from another site's page with 403, before any limiter or model call", async (method, path) => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const limit = vi.spyOn(env.RL_BACKDROP, "limit");
  // A cross-site no-cors POST: text/plain JSON needs no preflight. "null" is what a no-referrer page sends.
  for (const origin of ["https://evil.example", "null", "http://example.com"]) {
    const res = await exports.default.fetch(new Request(`https://example.com${path}`, {
      method, headers: { Origin: origin, "Content-Type": "text/plain" }, body: JSON.stringify({ title: "Town", style: "sketch" }),
    }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Requests from other sites are not allowed" });
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(limit).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it("lets the app's own origin through, and a request without Origin", async () => {
  for (const headers of [{ Origin: "https://example.com" }, {}] as Record<string, string>[]) {
    const res = await exports.default.fetch(new Request("https://example.com/api/backdrop", { method: "POST", headers, body: "{}" }));
    expect(res.status).toBe(400);    // the handler ran: the body has no title
  }
});

it("applies D1 migrations before tests and uses the fake model key", async () => {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").first();
  expect(row).toEqual({ name: "d1_migrations" });
  expect(env.MODEL_API_KEY === "test-only-model-api-key").toBe(true);    // a boolean, so a failure never prints the key
});
