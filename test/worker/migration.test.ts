import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("creates the worlds, usage and checks tables and the gallery index", async () => {
  const { results } = await env.DB.prepare(
    "SELECT type, name, tbl_name FROM sqlite_master WHERE name IN ('worlds', 'usage', 'checks', 'worlds_gallery') ORDER BY name",
  ).all();
  expect(results).toEqual([
    { type: "table", name: "checks", tbl_name: "checks" },
    { type: "table", name: "usage", tbl_name: "usage" },
    { type: "table", name: "worlds", tbl_name: "worlds" },
    { type: "index", name: "worlds_gallery", tbl_name: "worlds" },
  ]);
});

it("stores and reads a world row", async () => {
  await env.DB.prepare("INSERT INTO worlds (id, title, scene, safe, owner_token_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind("aB3dE5gH7j", "My town", '{"v":1}', 1, "hash", 1_700_000_000_000).run();
  const row = await env.DB.prepare("SELECT title, scene, safe, owner_token_hash, created_at FROM worlds WHERE id = ?1").bind("aB3dE5gH7j").first();
  expect(row).toEqual({ title: "My town", scene: '{"v":1}', safe: 1, owner_token_hash: "hash", created_at: 1_700_000_000_000 });
});

it("starts a usage day at 0 micro-dollars", async () => {
  await env.DB.prepare("INSERT INTO usage (day) VALUES (?1)").bind("2026-10-28").run();
  const row = await env.DB.prepare("SELECT spent_micro FROM usage WHERE day = ?1").bind("2026-10-28").first();
  expect(row).toEqual({ spent_micro: 0 });
});

it("stores and reads a checks row", async () => {
  const sha = "a".repeat(64);
  await env.DB.prepare("INSERT INTO checks (sha256, safe, created_at) VALUES (?1, ?2, ?3)").bind(sha, 0, 1_700_000_000_000).run();
  const row = await env.DB.prepare("SELECT safe, created_at FROM checks WHERE sha256 = ?1").bind(sha).first();
  expect(row).toEqual({ safe: 0, created_at: 1_700_000_000_000 });
});
