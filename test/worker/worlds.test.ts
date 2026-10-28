// POST /api/worlds through the router, on local D1 and R2. The save → get → delete round trip is in roundtrip.test.ts.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jpg, png, save } from "./helpers";    // jpg is used as source, thumb and backdrop; png as each cut-out

const SOURCE_SHA = "77fb4401cbf3134ae82ea8d28ae79eb05634dcd5e8257cf2dc58f28830832271";    // Get-FileHash of world-640.jpg
const padded = (b: Uint8Array, size: number) => { const out = new Uint8Array(size); out.set(b); return out; };    // same header, bigger file
const hex = async (text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");

// Sky point at elevation 30° on the SKY_R = 40 sphere.
const SKY = { x: 0, y: 40 * Math.sin(Math.PI / 6), z: -40 * Math.cos(Math.PI / 6) };
const inst = (id: number, type: string, source = "sam-noun") =>
  ({ id, objIndex: id, type, noun: type, sky: false, bbox: { x: 100 + 150 * id, y: 300, w: 120, h: 200 }, source });
const scene = (extra: Record<string, unknown> = {}) => ({
  v: 1, title: "My town", view: "side", img: { w: 1024, h: 768 }, ground: "#7a9a3c", backdrop: "image",
  instances: [inst(0, "house"), inst(1, "mountain"), inst(2, "sun", "sam-box"), inst(3, "cloud", "threshold")],
  ...extra,
});
// The multipart fields of a valid save for scene s; tests override or delete single fields.
const fields = (s: ReturnType<typeof scene>): Record<string, string | File> => ({
  scene: JSON.stringify(s),
  "source.jpg": new File([jpg], "source.jpg"),
  "thumb.jpg": new File([jpg], "thumb.jpg"),
  "backdrop.jpg": new File([jpg], "backdrop.jpg"),
  ...Object.fromEntries(s.instances.map((i) => [`cut/${i.id}.png`, new File([png], `${i.id}.png`)])),
});
// Everything a save could write: world rows and R2 objects.
const stored = async () => ({
  worlds: (await env.DB.prepare("SELECT COUNT(*) AS n FROM worlds").first<{ n: number }>())!.n,
  objects: (await env.BUCKET.list({ prefix: "w/" })).objects.length,
});
const setCheck = (safe: number | null) => safe === null
  ? env.DB.prepare("DELETE FROM checks WHERE sha256 = ?1").bind(SOURCE_SHA).run()
  : env.DB.prepare("INSERT OR REPLACE INTO checks (sha256, safe, created_at) VALUES (?1, ?2, ?3)").bind(SOURCE_SHA, safe, Date.now()).run();

beforeEach(async () => {
  await setCheck(1);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("saves a world with a safe Checks_Row: replies 201 {id, ownerToken}, writes the D1 row and the R2 assets", async () => {
  const moves = { "0": { x: 2.5, y: 0, z: 1 }, "2": SKY, "3": { x: -4, y: 7.5, z: -3 } };
  const s = scene({ moves });

  const res = await save(fields(s));

  expect(res.status).toBe(201);
  const reply = await res.json<{ id: string; ownerToken: string }>();
  expect(Object.keys(reply).sort()).toEqual(["id", "ownerToken"]);
  expect(reply.id).toMatch(/^[A-Za-z0-9]{10}$/);
  expect(reply.ownerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);    // 32 bytes, base64url without padding

  const row = await env.DB.prepare("SELECT title, scene, safe, owner_token_hash, created_at FROM worlds WHERE id = ?1").bind(reply.id).first<Record<string, unknown>>();
  expect(row).toMatchObject({ title: "My town", safe: 1, owner_token_hash: await hex(reply.ownerToken) });
  expect(typeof row!.created_at).toBe("number");
  expect(JSON.parse(String(row!.scene))).toEqual(s);    // moves pass through unchanged

  const { objects } = await env.BUCKET.list({ prefix: `w/${reply.id}/`, include: ["httpMetadata"] });
  expect(objects.map((o) => [o.key.slice(13), o.httpMetadata?.contentType])).toEqual([
    ["backdrop.jpg", "image/jpeg"],
    ["cut/0.png", "image/png"],
    ["cut/1.png", "image/png"],
    ["cut/2.png", "image/png"],
    ["cut/3.png", "image/png"],
    ["source.jpg", "image/jpeg"],
    ["thumb.jpg", "image/jpeg"],
  ]);
  const source = await env.BUCKET.get(`w/${reply.id}/source.jpg`);
  expect(new Uint8Array(await source!.arrayBuffer())).toEqual(jpg);
});

it("saves a gradient world without backdrop.jpg", async () => {
  const { "backdrop.jpg": _, ...rest } = fields(scene({ backdrop: "gradient" }));

  const res = await save(rest);

  expect(res.status).toBe(201);
  const { id } = await res.json<{ id: string }>();
  expect((await env.BUCKET.list({ prefix: `w/${id}/` })).objects.map((o) => o.key.slice(13))).not.toContain("backdrop.jpg");
});

it.each([
  ["no Checks_Row", null],
  ["a Checks_Row with safe = 0", 0],
])("replies 403 and writes nothing for %s", async (_, safe) => {
  await setCheck(safe);
  const before = await stored();

  const res = await save(fields(scene()));

  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "Only drawings checked by this app can be saved" });
  expect(await stored()).toEqual(before);
});

const many = scene({ instances: Array.from({ length: 31 }, (_, i) => inst(i % 30, "house")) });
it.each<[string, number, () => Record<string, string | File>]>([
  ["source.jpg over 400 KB", 413, () => ({ ...fields(scene()), "source.jpg": new File([padded(jpg, 400 * 1024 + 1)], "s.jpg") })],
  ["backdrop.jpg over 400 KB", 413, () => ({ ...fields(scene()), "backdrop.jpg": new File([padded(jpg, 400 * 1024 + 1)], "b.jpg") })],
  ["thumb.jpg over 100 KB", 413, () => ({ ...fields(scene()), "thumb.jpg": new File([padded(jpg, 100 * 1024 + 1)], "t.jpg") })],
  ["a cut PNG over 200 KB", 413, () => ({ ...fields(scene()), "cut/1.png": new File([padded(png, 200 * 1024 + 1)], "1.png") })],
  ["a scene over 64 KB", 400, () => ({ ...fields(scene()), scene: JSON.stringify(scene()) + " ".repeat(64 * 1024) })],
  ["more than 30 instances", 400, () => fields(many)],
  ["a 31st cut PNG for no Instance", 400, () => ({ ...fields(scene()), "cut/30.png": new File([png], "30.png") })],
  ["a missing cut PNG", 400, () => { const { "cut/2.png": _, ...rest } = fields(scene()); return rest; }],
  ["a PNG thumb", 415, () => ({ ...fields(scene()), "thumb.jpg": new File([png], "t.png") })],
])("refuses %s with %i and writes nothing", async (_, status, f) => {
  const before = await stored();

  const res = await save(f());

  expect(res.status).toBe(status);
  expect(typeof (await res.json<{ error: string }>()).error).toBe("string");
  expect(await stored()).toEqual(before);
});

it("refuses a streamed body over the size cap without Content-Length with 413 and writes nothing", async () => {
  const before = await stored();
  const body = new Blob([new Uint8Array(8 * 1024 * 1024)]).stream();    // over every field cap plus framing (≈ 6.9 MB)
  const req = new Request("https://example.com/api/worlds", { method: "POST", body, headers: { "Content-Type": "multipart/form-data; boundary=x" } });
  expect(req.headers.get("Content-Length")).toBeNull();

  const res = await exports.default.fetch(req);

  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "Request body is too large" });
  expect(await stored()).toEqual(before);
});

it.each<[string, () => string]>([
  ["more than 30 entries", () => JSON.stringify(scene({ moves: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i), { x: 0, y: 0, z: 0 }])) }))],
  ["an unknown Instance id", () => JSON.stringify(scene({ moves: { "7": { x: 0, y: 0, z: 0 } } }))],
  ["a terrain Instance", () => JSON.stringify(scene({ moves: { "1": { x: 0, y: 0, z: -12 } } }))],    // in bounds for upright, still refused
  ["an upright x outside the bounds", () => JSON.stringify(scene({ moves: { "0": { x: 13.5, y: 0, z: 0 } } }))],
  ["a float y above 8", () => JSON.stringify(scene({ moves: { "3": { x: 0, y: 8.5, z: -3 } } }))],
  ["a sky point off the sphere", () => JSON.stringify(scene({ moves: { "2": { x: 0, y: 20, z: -20 } } }))],
  ["a non-finite x", () => JSON.stringify(scene({ moves: { "0": { x: 1.25, y: 0, z: 0 } } })).replace('"x":1.25', '"x":1e999')],
  ["an extra key in an entry", () => JSON.stringify(scene({ moves: { "0": { x: 0, y: 0, z: 0, r: 1 } } }))],
])("refuses moves with %s with 400 and writes nothing", async (_, text) => {
  const before = await stored();

  const res = await save({ ...fields(scene()), scene: text() });

  expect(res.status).toBe(400);
  expect((await res.json<{ error: string }>()).error).toContain("moves");
  expect(await stored()).toEqual(before);
});

it("deletes the R2 assets it wrote when the D1 insert fails", async () => {
  // Zero "random" bytes give the id 0000000000, which a row already holds, so the insert fails after the R2 writes.
  vi.spyOn(crypto, "getRandomValues").mockImplementation((a) => a);
  await env.DB.prepare("INSERT OR REPLACE INTO worlds (id, title, scene, safe, owner_token_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind("0000000000", "Taken", "{}", 1, "hash", 1).run();

  const res = await save(fields(scene()));

  expect(res.status).toBe(500);
  expect((await env.BUCKET.list({ prefix: "w/0000000000/" })).objects).toEqual([]);
  expect(await env.DB.prepare("SELECT title FROM worlds WHERE id = ?1").bind("0000000000").all()).toMatchObject({ results: [{ title: "Taken" }] });
});
