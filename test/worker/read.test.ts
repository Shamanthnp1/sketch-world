// GET /api/worlds/:id, GET /api/gallery, DELETE /api/worlds/:id and GET /a/:key on local D1 and R2 (task 9.2).
// Worlds are written straight to D1 and R2 here; the save → get → delete round trip is in roundtrip.test.ts.
// Storage persists between tests, so every test uses fresh ids and checks only its own worlds.
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import type { GalleryReply, SavedInstance, SavedScene, WorldReply } from "../../shared/saved";
import { randomId, randomToken, sha256Hex } from "../../worker/crypto";
import { gallery } from "../../worker/routes/gallery";
import { asset } from "../../worker/routes/assets";
import { call } from "./helpers";

const inst = (id: number, type: "house" | "tree"): SavedInstance =>
  ({ id, objIndex: id, type, noun: type, sky: false, bbox: { x: 100 + 150 * id, y: 300, w: 120, h: 200 }, source: "sam-noun" });
const scene = (backdrop: SavedScene["backdrop"]): SavedScene => ({
  v: 1, title: "My town", view: "side", img: { w: 1024, h: 768 }, ground: "#7a9a3c", backdrop,
  instances: [inst(0, "house"), inst(2, "tree")], moves: { "0": { x: 2.5, y: 0, z: 1 } },
});

// A world as POST /api/worlds stores it: the D1 row and its R2 objects (content types as on save).
// `listed` defaults to 0, as on save: the operator approves a world for the Gallery by setting it to 1.
async function insertWorld(o: { title?: string; safe?: number; listed?: number; createdAt?: number; backdrop?: "image" | "gradient" } = {}) {
  const id = randomId(), token = randomToken(), s = scene(o.backdrop ?? "image");
  await env.DB.prepare("INSERT INTO worlds (id, title, scene, safe, listed, owner_token_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(id, o.title ?? s.title, JSON.stringify(s), o.safe ?? 1, o.listed ?? 0, await sha256Hex(token), o.createdAt ?? Date.now()).run();
  const files = ["source.jpg", "thumb.jpg", ...(s.backdrop === "image" ? ["backdrop.jpg"] : []), "cut/0.png", "cut/2.png"];
  for (const f of files) await env.BUCKET.put(`w/${id}/${f}`, `bytes of ${f}`, { httpMetadata: { contentType: f.endsWith(".png") ? "image/png" : "image/jpeg" } });
  return { id, token, scene: s, files };
}
const rowCount = async (id: string) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM worlds WHERE id = ?1").bind(id).first<{ n: number }>())!.n;
const objectKeys = async (id: string) => (await env.BUCKET.list({ prefix: `w/${id}/` })).objects.map((o) => o.key);

afterEach(() => vi.restoreAllMocks());

it("GET /api/worlds/:id replies with the scene and its asset URLs, never the owner hash", async () => {
  const w = await insertWorld({ createdAt: 1_700_000_000_000 });

  const res = await call("GET", `/api/worlds/${w.id}`);

  expect(res.status).toBe(200);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({
    id: w.id, title: "My town", createdAt: 1_700_000_000_000, scene: w.scene,
    assets: {
      source: `/a/w/${w.id}/source.jpg`, thumb: `/a/w/${w.id}/thumb.jpg`, backdrop: `/a/w/${w.id}/backdrop.jpg`,
      cuts: { "0": `/a/w/${w.id}/cut/0.png`, "2": `/a/w/${w.id}/cut/2.png` },
    },
  } satisfies WorldReply);
  expect(text).not.toContain(await sha256Hex(w.token));
});

it("GET /api/worlds/:id leaves out backdrop for a gradient world", async () => {
  const w = await insertWorld({ backdrop: "gradient" });

  const reply = await (await call("GET", `/api/worlds/${w.id}`)).json<WorldReply>();

  expect(Object.keys(reply.assets).sort()).toEqual(["cuts", "source", "thumb"]);
});

it.each<[string, () => Promise<string>]>([
  ["an unknown id", async () => randomId()],
  ["an unsafe world", async () => (await insertWorld({ safe: 0 })).id],
  ["a 9-char id", async () => "abcdefghi"],
  ["an 11-char id", async () => "abcdefghijk"],
  ["an id with a non-base62 char", async () => "abcdefghi-"],
])("GET /api/worlds/:id replies 404 for %s", async (_, id) => {
  const res = await call("GET", `/api/worlds/${await id()}`);

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "World not found" });
});

it("GET /api/gallery lists the 24 newest approved worlds (safe and listed), newest first, with thumbnail URLs", async () => {
  // Far-future timestamps, so these are the newest worlds whatever else the shared storage holds.
  const base = 4_000_000_000_000;
  const listed = [];
  for (let i = 0; i < 25; i++) listed.push(await insertWorld({ title: `World ${i}`, listed: 1, createdAt: base + i }));
  const unsafe = await insertWorld({ title: "Unsafe", safe: 0, listed: 1, createdAt: base + 100 });
  const unlisted = await insertWorld({ title: "Unlisted", createdAt: base + 101 });

  const res = await call("GET", "/api/gallery");

  expect(res.status).toBe(200);
  const reply = await res.json<GalleryReply>();
  const expected = listed.slice(1).reverse().map((w, i) => ({ id: w.id, title: `World ${24 - i}`, thumb: `/a/w/${w.id}/thumb.jpg`, createdAt: base + 24 - i }));
  expect(reply.worlds).toEqual(expected);    // the oldest of the 25 drops out; the newer unsafe and unlisted ones never show
  expect(reply.worlds.map((w) => w.id)).not.toContain(unsafe.id);
  expect(reply.worlds.map((w) => w.id)).not.toContain(unlisted.id);
  expect(reply.samples).toEqual([]);    // the SAMPLE_WORLD_IDS worlds of wrangler.jsonc don't exist in the test D1
});

it("GET /api/gallery leaves out a saved world until it is approved, while GET /api/worlds/:id opens it all along", async () => {
  const w = await insertWorld({ title: "Not yet", createdAt: 4_100_000_000_000 });    // the newest world, so only listed decides
  const newest = async () => (await (await call("GET", "/api/gallery")).json<GalleryReply>()).worlds.map((x) => x.id);

  expect((await call("GET", `/api/worlds/${w.id}`)).status).toBe(200);
  expect(await newest()).not.toContain(w.id);

  await env.DB.prepare("UPDATE worlds SET listed = 1 WHERE id = ?1").bind(w.id).run();    // the approve command (README)

  expect((await newest())[0]).toBe(w.id);
  expect((await call("GET", `/api/worlds/${w.id}`)).status).toBe(200);
});

it("GET /api/gallery lists SAMPLE_WORLD_IDS in their order, skipping unknown, unsafe and malformed ids, and counts them approved whatever listed says", async () => {
  // Newer than every other world in this file, and listed = 0 (the default): only being a sample lists them.
  const t = 5_000_000_000_000;
  const a = await insertWorld({ title: "Sample A", createdAt: t + 1 }), b = await insertWorld({ title: "Sample B", createdAt: t + 2 });
  const unsafe = await insertWorld({ safe: 0, createdAt: t + 3 });
  const ids = ` ${b.id}, nope,${unsafe.id},${randomId()},${a.id},${b.id},`;

  const res = await gallery(new Request("https://example.com/api/gallery"), { ...env, SAMPLE_WORLD_IDS: ids });

  const reply = await res.json<GalleryReply>();
  const B = { id: b.id, title: "Sample B", thumb: `/a/w/${b.id}/thumb.jpg`, createdAt: t + 2 };
  const A = { id: a.id, title: "Sample A", thumb: `/a/w/${a.id}/thumb.jpg`, createdAt: t + 1 };
  expect(reply.samples).toEqual([B, A]);
  expect(reply.worlds.slice(0, 2)).toEqual([B, A]);    // newest first in the newest list too
  expect(reply.worlds.map((w) => w.id)).not.toContain(unsafe.id);
});

it("DELETE /api/worlds/:id with the owner token deletes the D1 row and every R2 object of that world, then replies 204", async () => {
  const w = await insertWorld(), other = await insertWorld();

  const res = await call("DELETE", `/api/worlds/${w.id}`, { Authorization: `Bearer ${w.token}` });

  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
  expect(await rowCount(w.id)).toBe(0);
  expect(await objectKeys(w.id)).toEqual([]);
  expect((await call("GET", `/api/worlds/${w.id}`)).status).toBe(404);
  expect(await rowCount(other.id)).toBe(1);
  expect(await objectKeys(other.id)).toHaveLength(other.files.length);
});

it.each<[string, (w: { id: string; token: string }) => [string, HeadersInit]]>([
  ["a wrong token", (w) => [w.id, { Authorization: `Bearer ${randomToken()}` }]],
  ["no Authorization header", (w) => [w.id, {}]],
  ["the token without Bearer", (w) => [w.id, { Authorization: w.token }]],
  ["the token of another world", (w) => [randomId(), { Authorization: `Bearer ${w.token}` }]],    // unknown id
])("DELETE /api/worlds/:id with %s replies 403 and deletes nothing", async (_, req) => {
  const w = await insertWorld();
  const [id, headers] = req(w);

  const res = await call("DELETE", `/api/worlds/${id}`, headers);

  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "Only the device that saved this world can delete it" });
  expect(await rowCount(w.id)).toBe(1);
  expect(await objectKeys(w.id)).toHaveLength(w.files.length);
});

it.each(["thumb.jpg", "cut/2.png"])("GET /a/w/<id>/%s streams the R2 object with its content type and cache headers", async (file) => {
  const w = await insertWorld();
  const stored = (await env.BUCKET.head(`w/${w.id}/${file}`))!;

  const res = await call("GET", `/a/w/${w.id}/${file}`);

  expect(res.status).toBe(200);
  expect(new TextDecoder().decode(await res.arrayBuffer())).toBe(`bytes of ${file}`);
  expect(res.headers.get("Content-Type")).toBe(file.endsWith(".png") ? "image/png" : "image/jpeg");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("ETag")).toBe(stored.httpEtag);
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
});

it("GET /a/:key replies 404 for a well-formed key with no R2 object", async () => {
  const res = await call("GET", `/a/w/${randomId()}/source.jpg`);

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Not found" });
});

// Through the router: the URL parser resolves "." and ".." (also as %2e) before routing; "%2F" stays encoded in the key.
it.each([
  "/a/",
  "/a/w/abcdefghi/source.jpg",
  "/a/w/abcdefghijk/source.jpg",
  "/a/w/abcdefghij/cut/100.png",
  "/a/w/abcdefghij/cut/1.jpg",
  "/a/w/abcdefghij/source.png",
  "/a/w/abcdefghij/other.jpg",
  "/a/w%2Fabcdefghij%2Fsource.jpg",
  "/a/w/abcdefghij%2Fsource.jpg",
  "/a/w/abcdefghij/%2e%2e/source.jpg",
  "/a/w/abcdefghij/../../a/w/abcdefghij/source.jpg",
  "/a/w/abcdefghij/source.jpg%00",
  "/a/x/abcdefghij/source.jpg",
])("GET %s replies 404 without reading R2", async (path) => {
  const get = vi.spyOn(env.BUCKET, "get");

  const res = await call("GET", path);

  expect(res.status).toBe(404);
  expect(get).not.toHaveBeenCalled();
});

// Straight to the handler: keys the URL parser would have normalised away.
it.each(["", "w/abcdefghij/../abcdefghij/source.jpg", "w/abcdefghij/./source.jpg", "w/abcdefghij//source.jpg", "/w/abcdefghij/source.jpg", "w/abcdefghij/source.jpg\n"])(
  "the asset handler refuses the raw key %j without reading R2",
  async (key) => {
    const get = vi.spyOn(env.BUCKET, "get");

    const res = await asset(new Request("https://example.com/a/"), env, undefined, { 0: key });

    expect(res.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  },
);

it("the R2 spy sees reads made through the router (so the 404 checks above are meaningful)", async () => {
  const w = await insertWorld();
  const get = vi.spyOn(env.BUCKET, "get");

  await call("GET", `/a/w/${w.id}/source.jpg`);

  expect(get).toHaveBeenCalledExactlyOnceWith(`w/${w.id}/source.jpg`);
});
