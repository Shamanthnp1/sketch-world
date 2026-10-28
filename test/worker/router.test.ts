import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";

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

it.each([
  ["POST", "/api/backdrop"],
  ["POST", "/api/worlds"],
  ["GET", "/api/worlds/abc"],
  ["DELETE", "/api/worlds/abc"],
  ["GET", "/api/gallery"],
  ["GET", "/a/w/abcdefghij/cut/1.png"],
])("routes %s %s to its (stub) handler", async (method, path) => {
  const res = await call(method, path);
  expect(res.status).toBe(501);
  expect(await res.json()).toEqual({ error: "Not implemented" });
});

it("returns 405 with Allow for a known path and the wrong method", async () => {
  const res = await call("PUT", "/api/worlds/abc");
  expect(res.status).toBe(405);
  expect(res.headers.get("Allow")).toBe("GET, DELETE");
  expect(await res.json()).toEqual({ error: "Method not allowed" });
});

it("applies D1 migrations before tests and uses the fake model key", async () => {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").first();
  expect(row).toEqual({ name: "d1_migrations" });
  expect(env.MODEL_API_KEY).toBe("test-only-model-api-key");
});
