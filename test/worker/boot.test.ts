import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("boots the Worker and replies 404 JSON", async () => {
  const res = await exports.default.fetch(new Request("https://example.com/api/nope"));
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Not found" });
});

it("applies D1 migrations before tests and uses the fake model key", async () => {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").first();
  expect(row).toEqual({ name: "d1_migrations" });
  expect(env.MODEL_API_KEY).toBe("test-only-model-api-key");
});
