// PATCH /api/worlds/:id through the router on local D1 and R2 (task 9.6). Each test saves its own world with
// POST /api/worlds (a seeded safe Checks_Row stands in for /api/understand) and reads the stored scene text from D1.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MovesBody, SavedInstance, SavedScene, WorldReply } from "../../shared/saved";
import { randomId, randomToken, sha256Hex } from "../../worker/crypto";
import { call, jpg, png, save } from "./helpers";

const NOT_OWNER = { error: "Only the device that saved this world can change it" };
const BAD_MOVES = { error: "Expected JSON {moves}: at most 30 entries, each naming a movable instance by id, with finite x, y and z inside the bounds for its kind" };
const CAP = 8 * 1024;

const SKY = { x: 0, y: 40 * Math.sin(Math.PI / 6), z: -40 * Math.cos(Math.PI / 6) };    // elevation 30° on the SKY_R = 40 sphere
const inst = (id: number, type: SavedInstance["type"], source: SavedInstance["source"] = "sam-noun"): SavedInstance =>
  ({ id, objIndex: id, type, noun: type, sky: false, bbox: { x: 100 + 150 * id, y: 300, w: 120, h: 200 }, source });
// Upright house 0, terrain mountain 1, sky sun 2, float cloud 3; saved with one move.
const scene: SavedScene = {
  v: 1, title: "Patch town", view: "side", img: { w: 1024, h: 768 }, ground: "#7a9a3c", backdrop: "image",
  instances: [inst(0, "house"), inst(1, "mountain"), inst(2, "sun", "sam-box"), inst(3, "cloud", "threshold")],
  moves: { "0": { x: 2.5, y: 0, z: 1 } },
};
const MOVES = { "0": { x: -3, y: 0, z: 2 }, "2": SKY, "3": { x: 1, y: 7.5, z: -2 } };

/** A world saved through POST /api/worlds: its id and owner token. */
async function newWorld() {
  await env.DB.prepare("INSERT OR REPLACE INTO checks (sha256, safe, created_at) VALUES (?1, 1, ?2)").bind(await sha256Hex(jpg), Date.now()).run();
  const res = await save({
    scene: JSON.stringify(scene),
    ...Object.fromEntries(["source.jpg", "thumb.jpg", "backdrop.jpg"].map((f) => [f, new File([jpg], f)])),
    ...Object.fromEntries(scene.instances.map((i) => [`cut/${i.id}.png`, new File([png], `${i.id}.png`)])),
  });
  expect(res.status).toBe(201);
  const { id, ownerToken } = await res.json<{ id: string; ownerToken: string }>();
  return { id, token: ownerToken };
}
const patch = (id: string, body: BodyInit | null, headers: Record<string, string> = {}) =>
  exports.default.fetch(new Request(`https://example.com/api/worlds/${id}`, { method: "PATCH", body, headers }));
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const json = (body: MovesBody | Record<string, unknown>) => JSON.stringify(body);
/** The D1 worlds.scene text, or undefined when the row is gone. */
const storedText = async (id: string) =>
  (await env.DB.prepare("SELECT scene FROM worlds WHERE id = ?1").bind(id).first<{ scene: string }>())?.scene;
const served = async (id: string) => (await (await call("GET", `/api/worlds/${id}`)).json<WorldReply>()).scene;
// A valid body padded with trailing whitespace (still valid JSON) to exactly n bytes.
const sized = (n: number) => { const b = json({ moves: MOVES }); return b + " ".repeat(n - b.length); };

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

it("stores valid moves with the owner token and replies 204; GET serves them", async () => {
  const w = await newWorld();

  const res = await patch(w.id, json({ moves: MOVES }), bearer(w.token));

  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
  expect(JSON.parse((await storedText(w.id))!)).toEqual({ ...scene, moves: MOVES });    // the moves pass through unchanged
  expect(await served(w.id)).toEqual({ ...scene, moves: MOVES });
});

it("clears the moves for {moves: {}}: the stored scene has no moves key", async () => {
  const w = await newWorld();
  const { moves: _, ...without } = scene;

  const res = await patch(w.id, json({ moves: {} }), bearer(w.token));

  expect(res.status).toBe(204);
  const stored = JSON.parse((await storedText(w.id))!);
  expect(stored).toEqual(without);
  expect("moves" in stored).toBe(false);
  expect(await served(w.id)).toEqual(without);
});

it("accepts a body of exactly 8 KB", async () => {
  const w = await newWorld();
  const body = sized(CAP);
  expect(new TextEncoder().encode(body).byteLength).toBe(CAP);

  const res = await patch(w.id, body, bearer(w.token));

  expect(res.status).toBe(204);
  expect(JSON.parse((await storedText(w.id))!).moves).toEqual(MOVES);
});

it.each<[string, (w: { id: string; token: string }, other: { id: string; token: string }) => [string, Record<string, string>]]>([
  ["a wrong token", (w) => [w.id, bearer(randomToken())]],
  ["the token of another world", (w, other) => [w.id, bearer(other.token)]],
  ["no Authorization header", (w) => [w.id, {}]],
  ["the token without Bearer", (w) => [w.id, { Authorization: w.token }]],
  ["a malformed token", (w) => [w.id, bearer(w.token.slice(1))]],
  ["an unknown id", (w) => [randomId(), bearer(w.token)]],
  ["a malformed id", (w) => [w.id.slice(1), bearer(w.token)]],
])("replies 403 for %s and changes nothing", async (_, req) => {
  const w = await newWorld(), other = await newWorld();
  const before = [await storedText(w.id), await storedText(other.id)];
  const [id, headers] = req(w, other);

  const res = await patch(id, json({ moves: MOVES }), headers);

  expect(res.status).toBe(403);
  expect(await res.json()).toEqual(NOT_OWNER);
  expect([await storedText(w.id), await storedText(other.id)]).toEqual(before);
});

it.each<[string, string]>([
  ["more than 30 entries", json({ moves: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i), { x: 0, y: 0, z: 0 }])) })],
  ["an unknown Instance id", json({ moves: { "7": { x: 0, y: 0, z: 0 } } })],
  ["a zero-padded id", json({ moves: { "02": SKY } })],
  ["a terrain Instance", json({ moves: { "1": { x: 0, y: 0, z: -12 } } })],    // in bounds for upright, still refused
  ["an upright x outside the bounds", json({ moves: { "0": { x: 13.5, y: 0, z: 0 } } })],
  ["a sky point off the sphere", json({ moves: { "2": { x: 0, y: 20, z: -20 } } })],
  ["a non-finite x", json({ moves: { "0": { x: 1.25, y: 0, z: 0 } } }).replace('"x":1.25', '"x":1e999')],
  ["an extra key in the body", json({ moves: MOVES, title: "Renamed" })],
  ["an extra key in an entry", json({ moves: { "0": { x: 0, y: 0, z: 0, r: 1 } } })],
  ["a body that is not JSON", "moves=0"],
  ["an empty body", ""],
  ["a missing moves", json({})],
  ["moves of null", json({ moves: null })],
])("replies 400 for %s and changes nothing", async (_, body) => {
  const w = await newWorld();
  const before = await storedText(w.id);

  const res = await patch(w.id, body, bearer(w.token));

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual(BAD_MOVES);
  expect(await storedText(w.id)).toBe(before);
});

// Size is checked first, so an oversized body gets 413 whatever the token.
it.each<[string, (w: { id: string; token: string }) => Request]>([
  ["with Content-Length and the owner token", (w) => new Request(`https://example.com/api/worlds/${w.id}`,
    { method: "PATCH", body: sized(CAP + 1), headers: { ...bearer(w.token), "Content-Length": String(CAP + 1) } })],
  ["with Content-Length and no token", (w) => new Request(`https://example.com/api/worlds/${w.id}`,
    { method: "PATCH", body: sized(CAP + 1), headers: { "Content-Length": String(CAP + 1) } })],
  ["streamed without Content-Length and the owner token", (w) => new Request(`https://example.com/api/worlds/${w.id}`,
    { method: "PATCH", body: new Blob([sized(CAP + 1)]).stream(), headers: bearer(w.token) })],
])("refuses a body of 8 KB + 1 byte %s with 413 and changes nothing", async (name, build) => {
  const w = await newWorld();
  const before = await storedText(w.id);
  const req = build(w);
  if (name.startsWith("streamed")) expect(req.headers.get("Content-Length")).toBeNull();    // only the byte count can catch it

  const res = await exports.default.fetch(req);

  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "Request body is too large" });
  expect(await storedText(w.id)).toBe(before);
});

it("keeps GET and DELETE working after a PATCH; a PATCH after the delete gets 403", async () => {
  const w = await newWorld();
  expect((await patch(w.id, json({ moves: MOVES }), bearer(w.token))).status).toBe(204);

  expect((await call("DELETE", `/api/worlds/${w.id}`, bearer(randomToken()))).status).toBe(403);
  expect(await served(w.id)).toEqual({ ...scene, moves: MOVES });
  const deleted = await call("DELETE", `/api/worlds/${w.id}`, bearer(w.token));
  expect(deleted.status).toBe(204);
  expect((await call("GET", `/api/worlds/${w.id}`)).status).toBe(404);
  expect((await env.BUCKET.list({ prefix: `w/${w.id}/` })).objects).toEqual([]);

  const late = await patch(w.id, json({ moves: MOVES }), bearer(w.token));
  expect(late.status).toBe(403);
  expect(await storedText(w.id)).toBeUndefined();
});
