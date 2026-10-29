// Rate limits in the router (task 10.1, Requirements 11.1, 11.2, 16.8). limit() on the env.RL_* bindings is stubbed
// with vi.spyOn; the handler's own env sees the same binding objects. The local limiters' real thresholds are
// raised in vitest.config.ts so the other route tests never reach them.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SavedScene } from "../../shared/saved";
import { randomId, randomToken, sha256Hex } from "../../worker/crypto";
import { LIMITERS, NO_IP, type LimitedRoute } from "../../worker/limits/rate";
import { call, jpg, png } from "./helpers";

const IP = "203.0.113.7";
const TOO_MANY = { error: "Too many requests. Try again in a minute." };
const BINDINGS = Object.values(LIMITERS);

const scene: SavedScene = {
  v: 1, title: "Rate town", view: "side", img: { w: 1024, h: 768 }, ground: "#7a9a3c", backdrop: "image",
  instances: [{ id: 0, objIndex: 0, type: "house", noun: "house", sky: false, bbox: { x: 100, y: 300, w: 120, h: 200 }, source: "sam-noun" }],
};
const form = (fields: Record<string, string | Uint8Array>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, typeof v === "string" ? v : new File([v], k));
  return f;
};
const req = (method: string, path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  new Request(`https://example.com${path}`, { method, body, headers });

/** A stored world and its owner token, written straight to D1. */
async function storedWorld() {
  const id = randomId(), token = randomToken();
  await env.DB.prepare("INSERT INTO worlds (id, title, scene, safe, owner_token_hash, created_at) VALUES (?1, ?2, ?3, 1, ?4, ?5)")
    .bind(id, scene.title, JSON.stringify(scene), await sha256Hex(token), Date.now()).run();
  return { id, token };
}

/** The safe Checks_Row /api/understand would write for `bytes`, which point, segment and save need. */
const checked = async (bytes: Uint8Array) =>
  env.DB.prepare("INSERT OR REPLACE INTO checks (sha256, safe, created_at) VALUES (?1, 1, ?2)").bind(await sha256Hex(bytes), Date.now()).run();

// Every limited route with a request its handler would accept (Meta call, D1 or R2 write) if it ran.
const LIMITED: [string, LimitedRoute, (headers: Record<string, string>) => Promise<Request>][] = [
  ["POST /api/understand", "understand", async (h) => req("POST", "/api/understand", form({ image: png }), h)],
  ["POST /api/point", "point", async (h) => {
    await checked(png);
    return req("POST", "/api/point", form({ image: png, objects: JSON.stringify([{ type: "house", noun: "house", count: 1 }]) }), h);
  }],
  ["POST /api/segment", "segment", async (h) => {
    await checked(png);
    return req("POST", "/api/segment", form({ image: png, noun: "house" }), h);
  }],
  ["POST /api/backdrop", "backdrop", async (h) => req("POST", "/api/backdrop", JSON.stringify({ title: "Rate town", style: "sketch" }), h)],
  ["POST /api/worlds", "save", async (h) => {
    await checked(jpg);
    return req("POST", "/api/worlds",
      form({ scene: JSON.stringify(scene), "source.jpg": jpg, "thumb.jpg": jpg, "backdrop.jpg": jpg, "cut/0.png": png }), h);
  }],
  ["PATCH /api/worlds/:id", "save", async (h) => {
    const w = await storedWorld();
    return req("PATCH", `/api/worlds/${w.id}`, JSON.stringify({ moves: { "0": { x: 1, y: 0, z: 2 } } }), { ...h, Authorization: `Bearer ${w.token}` });
  }],
];

/** Every row of every app table in D1, plus every R2 key: any write by a handler changes it. */
async function stored() {
  const { results: tables } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name",
  ).all<{ name: string }>();
  const rows = await Promise.all(tables.map(async ({ name }) => [name, (await env.DB.prepare(`SELECT * FROM "${name}"`).all()).results]));
  return { d1: Object.fromEntries(rows), r2: (await env.BUCKET.list()).objects.map((o) => o.key) };
}
/** Spies on limit() of all five bindings, answering `success` (undefined: the real local limiter answers). */
const spyLimits = (success?: boolean) => Object.fromEntries(BINDINGS.map((b) => {
  const spy = vi.spyOn(env[b], "limit");
  if (success !== undefined) spy.mockResolvedValue({ success });
  return [b, spy];
}));

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

it.each(LIMITED)("%s over the limit replies 429 with Retry-After and never runs the handler", async (_, route, build) => {
  const request = await build({ "CF-Connecting-IP": IP });
  const before = await stored();
  const limits = spyLimits(false);
  const fetch = vi.spyOn(globalThis, "fetch");

  const res = await exports.default.fetch(request);

  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBe("60");
  expect(await res.json()).toEqual(TOO_MANY);
  expect(limits[LIMITERS[route]]).toHaveBeenCalledExactlyOnceWith({ key: `${route}:${IP}` });
  for (const b of BINDINGS) if (b !== LIMITERS[route]) expect(limits[b]).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();    // no Meta call
  expect(await stored()).toEqual(before);   // no D1 or R2 write
});

// Bodies each handler refuses with its own reply, so the test shows the handler ran without calling a model.
it.each<[string, LimitedRoute, string, string, number]>([
  ["POST /api/understand", "understand", "POST", "/api/understand", 400],
  ["POST /api/point", "point", "POST", "/api/point", 400],
  ["POST /api/segment", "segment", "POST", "/api/segment", 400],
  ["POST /api/backdrop", "backdrop", "POST", "/api/backdrop", 400],
  ["POST /api/worlds", "save", "POST", "/api/worlds", 400],
  ["PATCH /api/worlds/:id", "save", "PATCH", "/api/worlds/AAAAAAAAAA", 403],    // no token
])("%s under the limit reaches the handler; without CF-Connecting-IP the key is route:no-ip", async (_, route, method, path, status) => {
  const limits = spyLimits(true);

  const res = await exports.default.fetch(req(method, path, "x"));

  expect(res.status).toBe(status);
  expect(res.headers.get("Retry-After")).toBeNull();
  expect(limits[LIMITERS[route]]).toHaveBeenCalledExactlyOnceWith({ key: `${route}:${NO_IP}` });
});

it("passes the real local limiter's success through to the handler", async () => {
  const limits = spyLimits();

  const res = await exports.default.fetch(req("POST", "/api/segment", "x", { "CF-Connecting-IP": IP }));

  expect(res.status).toBe(400);
  expect(limits.RL_SEGMENT).toHaveBeenCalledExactlyOnceWith({ key: `segment:${IP}` });
  await expect(limits.RL_SEGMENT!.mock.results[0]!.value).resolves.toEqual({ success: true });
});

it("never calls a limiter for the unlimited routes, unknown paths or the wrong method", async () => {
  const w = await storedWorld();
  const limits = spyLimits(false);
  const ip = { "CF-Connecting-IP": IP };

  // One after another: the DELETE must come after the GET of the same world.
  const statuses: number[] = [];
  for (const [method, path, headers] of [
    ["GET", `/api/worlds/${w.id}`, ip],
    ["GET", "/api/gallery", ip],
    ["GET", `/a/w/${w.id}/thumb.jpg`, ip],
    ["DELETE", `/api/worlds/${w.id}`, { ...ip, Authorization: `Bearer ${w.token}` }],
    ["GET", "/api/nope", ip],
    ["PUT", "/api/worlds/abc", ip],
  ] as const) {
    const res = await call(method, path, headers);
    statuses.push(res.status);
    await res.body?.cancel();
  }

  expect(statuses).toEqual([200, 200, 404, 204, 404, 405]);
  for (const b of BINDINGS) expect(limits[b]).not.toHaveBeenCalled();
});
