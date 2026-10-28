// Save → read → assets → gallery → delete through the router on local D1 and R2 (task 9.3), with HTTP calls only
// apart from seeding the Checks_Row that /api/understand would write (understand.test.ts covers that write).
// Single routes and their refusals are covered in worlds.test.ts (save) and read.test.ts (read, gallery, delete, assets).
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import type { GalleryReply, GalleryWorld, SavedInstance, SavedScene, WorldReply } from "../../shared/saved";
import { sha256Hex } from "../../worker/crypto";
import { call, jpg, png, save } from "./helpers";

// Same image header, a different last byte: every asset has its own bytes, so a URL serving the wrong object fails.
const tail = (b: Uint8Array, n: number) => { const out = new Uint8Array(b.length + 1); out.set(b); out[b.length] = n; return out; };
const files: Record<string, Uint8Array> = {
  "source.jpg": tail(jpg, 1), "thumb.jpg": tail(jpg, 2), "backdrop.jpg": tail(jpg, 3),
  "cut/0.png": tail(png, 10), "cut/3.png": tail(png, 13), "cut/7.png": tail(png, 17), "cut/29.png": tail(png, 39),
};
const contentType = (file: string) => (file.endsWith(".png") ? "image/png" : "image/jpeg");

const inst = (id: number, objIndex: number, type: SavedInstance["type"], source: SavedInstance["source"]): SavedInstance =>
  ({ id, objIndex, type, noun: type, sky: false, bbox: { x: 100 + 200 * objIndex, y: 300, w: 120, h: 200 }, source });
const SKY = { x: 0, y: 40 * Math.sin(Math.PI / 6), z: -40 * Math.cos(Math.PI / 6) };    // elevation 30° on the SKY_R = 40 sphere
// Instance ids with gaps (up to the largest, 29), and a move for each movable kind; the terrain mountain has none.
const scene: SavedScene = {
  v: 1, title: "Round trip town", view: "side", img: { w: 1024, h: 768 }, ground: "#7a9a3c", backdrop: "image",
  instances: [inst(0, 0, "house", "sam-noun"), inst(3, 1, "mountain", "sam-noun"), inst(7, 2, "sun", "sam-box"), inst(29, 3, "cloud", "threshold")],
  moves: { "0": { x: 2.5, y: 0, z: 1 }, "7": SKY, "29": { x: -4, y: 7.5, z: -3 } },
};

it("saves a world, serves it, its assets and its gallery entry, refuses a wrong token, then deletes everything", async () => {
  await env.DB.prepare("INSERT OR REPLACE INTO checks (sha256, safe, created_at) VALUES (?1, 1, ?2)")
    .bind(await sha256Hex(files["source.jpg"]!), Date.now()).run();
  const before = Date.now();

  // Save.
  const saved = await save({ scene: JSON.stringify(scene), ...Object.fromEntries(Object.entries(files).map(([f, b]) => [f, new File([b], f)])) });
  expect(saved.status).toBe(201);
  const { id, ownerToken } = await saved.json<{ id: string; ownerToken: string }>();

  // Read: the scene as sent (moves included) and an asset URL for every uploaded file.
  const url = (file: string) => `/a/w/${id}/${file}`;
  const read = async () => { const res = await call("GET", `/api/worlds/${id}`); return { status: res.status, body: await res.json<WorldReply>() }; };
  const first = await read();
  expect(first.status).toBe(200);
  const world = first.body;
  expect(world).toEqual({
    id, title: "Round trip town", createdAt: world.createdAt, scene,
    assets: {
      source: url("source.jpg"), thumb: url("thumb.jpg"), backdrop: url("backdrop.jpg"),
      cuts: { "0": url("cut/0.png"), "3": url("cut/3.png"), "7": url("cut/7.png"), "29": url("cut/29.png") },
    },
  } satisfies WorldReply);
  expect(world.createdAt).toBeGreaterThanOrEqual(before);
  expect(world.createdAt).toBeLessThanOrEqual(Date.now());

  // Assets: each URL serves exactly the uploaded bytes with the content type stored on save.
  const served = async () => Object.fromEntries(await Promise.all(Object.keys(files).map(async (f) => {
    const res = await call("GET", url(f));
    return [f, { status: res.status, type: res.headers.get("Content-Type"), body: new Uint8Array(await res.arrayBuffer()) }] as const;
  })));
  const uploaded = Object.fromEntries(Object.entries(files).map(([f, b]) => [f, { status: 200, type: contentType(f), body: b }]));
  expect(await served()).toEqual(uploaded);

  // Gallery: listed with its thumb URL.
  const listed = async () => { const res = await call("GET", "/api/gallery"); expect(res.status).toBe(200); return (await res.json<GalleryReply>()).worlds; };
  const item: GalleryWorld = { id, title: "Round trip town", thumb: url("thumb.jpg"), createdAt: world.createdAt };
  expect(await listed()).toContainEqual(item);

  // A token one character off: 403, and the world, its assets and its gallery entry stay.
  const wrong = (ownerToken[0] === "A" ? "B" : "A") + ownerToken.slice(1);
  const refused = await call("DELETE", `/api/worlds/${id}`, { Authorization: `Bearer ${wrong}` });
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ error: "Only the device that saved this world can delete it" });
  expect(await read()).toEqual({ status: 200, body: world });
  expect(await served()).toEqual(uploaded);
  expect(await listed()).toContainEqual(item);

  // The owner token: 204, then the world, every asset and the gallery entry are gone.
  const deleted = await call("DELETE", `/api/worlds/${id}`, { Authorization: `Bearer ${ownerToken}` });
  expect(deleted.status).toBe(204);
  expect(await deleted.text()).toBe("");
  expect(await read()).toEqual({ status: 404, body: { error: "World not found" } });
  const statuses = Object.fromEntries(Object.entries(await served()).map(([f, a]) => [f, a.status]));
  expect(statuses).toEqual(Object.fromEntries(Object.keys(files).map((f) => [f, 404])));
  expect((await listed()).map((w) => w.id)).not.toContain(id);
});
