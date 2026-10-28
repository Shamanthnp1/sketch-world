// POST /api/worlds saves a world (Requirements 10.1–10.4, 12.8, 16.1–16.3, 16.5). Multipart fields, the files
// named after their R2 key under w/<id>/ (design.md "R2 keys"):
//   scene          SavedScene JSON text (≤ 64 KB), checked with shared/saved.ts, `moves` included
//   source.jpg     JPEG ≤ 400 KB: the exact bytes sent to /api/understand
//   thumb.jpg      JPEG ≤ 100 KB, 640 px wide
//   backdrop.jpg   JPEG ≤ 400 KB, sent exactly when scene.backdrop is "image"
//   cut/<n>.png    PNG ≤ 200 KB, long side ≤ 512 px, one per Instance id n
// Every field once and no others. Images are checked by header bytes only (the Worker never decodes them).
import { SavedScene, type WorldReply } from "../../shared/saved";
import { randomId, randomToken, sha256Hex, WORLD_ID } from "../crypto";
import { jsonError } from "../http";
import { imageInfo, type ImageInfo } from "../limits/imageSize";
import { MAX_CUT_PNG_BYTES, MAX_IMAGE_BYTES, readJsonField } from "../limits/input";

const MAX_SCENE_BYTES = 64 * 1024;
const MAX_THUMB_BYTES = 100 * 1024;
const THUMB_WIDTH = 640;
const MAX_CUT_SIDE = 512;
// Every field at its cap plus multipart framing; a larger body is refused before parsing.
const MAX_BODY_BYTES = MAX_SCENE_BYTES + 30 * MAX_CUT_PNG_BYTES + 2 * MAX_IMAGE_BYTES + MAX_THUMB_BYTES + 64 * 1024;

type Spec = { key: string; cap: number; type: ImageInfo["type"] };
type Upload = { key: string; bytes: Uint8Array; info: ImageInfo };

export async function saveWorld(req: Request, env: Env): Promise<Response> {
  if (Number(req.headers.get("Content-Length")) > MAX_BODY_BYTES) return jsonError(413, "Request body is too large");
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, "Expected a multipart/form-data body");

  const raw = readJsonField(form, "scene", MAX_SCENE_BYTES);
  if (raw instanceof Response) return raw;
  const parsed = SavedScene.safeParse(raw);
  // Field paths only: they name what to fix without echoing the values.
  if (!parsed.success) return jsonError(400, `scene is not a valid SavedScene (${[...new Set(parsed.error.issues.map((i) => i.path.join(".") || "scene"))].join(", ")})`);
  const scene = parsed.data;

  const specs: Spec[] = [
    { key: "source.jpg", cap: MAX_IMAGE_BYTES, type: "image/jpeg" },
    { key: "thumb.jpg", cap: MAX_THUMB_BYTES, type: "image/jpeg" },
    ...(scene.backdrop === "image" ? [{ key: "backdrop.jpg", cap: MAX_IMAGE_BYTES, type: "image/jpeg" } as const] : []),
    ...scene.instances.map((i): Spec => ({ key: `cut/${i.id}.png`, cap: MAX_CUT_PNG_BYTES, type: "image/png" })),
  ];
  const fields = [...form.keys()], expected = new Set(["scene", ...specs.map((s) => s.key)]);
  if (new Set(fields).size !== fields.length) return jsonError(400, "Each field may be sent only once");
  const extra = fields.find((f) => !expected.has(f));
  if (extra !== undefined) return jsonError(400, `Unexpected field ${extra.slice(0, 40)}`);

  const uploads: Upload[] = [];
  for (const spec of specs) {
    const upload = await readUpload(form, spec);
    if (upload instanceof Response) return upload;
    uploads.push(upload);
  }
  for (const { key, info } of uploads) {
    if (key === "thumb.jpg" && info.width !== THUMB_WIDTH) return jsonError(400, `thumb.jpg must be ${THUMB_WIDTH} px wide`);
    if (info.type === "image/png" && Math.max(info.width, info.height) > MAX_CUT_SIDE) return jsonError(400, `${key} must have a long side of at most ${MAX_CUT_SIDE} px`);
  }

  // The safe flag comes from Spark via the Checks_Row that /api/understand wrote, never from the client.
  const check = await env.DB.prepare("SELECT safe FROM checks WHERE sha256 = ?1").bind(await sha256Hex(uploads[0]!.bytes)).first<{ safe: number }>();
  if (check?.safe !== 1) return jsonError(403, "Only drawings checked by this app can be saved");

  const id = randomId(), ownerToken = randomToken();
  const keys = uploads.map((u) => `w/${id}/${u.key}`);
  // R2 first, D1 last: the D1 row is what makes the world visible (viewer, gallery), so it only appears once every
  // asset exists. On any failure, delete every key of this save (deleting a key never written is a no-op) and rethrow.
  try {
    const puts = await Promise.allSettled(uploads.map((u, i) => env.BUCKET.put(keys[i]!, u.bytes, { httpMetadata: { contentType: u.info.type } })));
    const failed = puts.find((p) => p.status === "rejected");
    if (failed) throw failed.reason;
    await env.DB.prepare("INSERT INTO worlds (id, title, scene, safe, owner_token_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(id, scene.title, JSON.stringify(scene), check.safe, await sha256Hex(ownerToken), Date.now())
      .run();
  } catch (err) {
    await env.BUCKET.delete(keys).catch((e: unknown) =>
      console.error(JSON.stringify({ route: "worlds", cleanup: "failed", error: e instanceof Error ? e.name : "unknown" })));
    throw err;
  }
  return Response.json({ id, ownerToken }, { status: 201 });
}

// Not a file → 400; over its cap → 413; header not the expected PNG or JPEG → 415.
async function readUpload(form: FormData, { key, cap, type }: Spec): Promise<Upload | Response> {
  const v = form.get(key);
  if (!(v instanceof File)) return jsonError(400, `${key} must be a file`);
  if (v.size > cap) return jsonError(413, `${key} is larger than ${cap / 1024} KB`);
  const bytes = new Uint8Array(await v.arrayBuffer());
  const info = imageInfo(bytes);
  if (info?.type !== type) return jsonError(415, `${key} must be a ${type === "image/png" ? "PNG" : "JPEG"} image`);
  return { key, bytes, info };
}

/** The URL GET /a/:key serves the R2 object w/<id>/<file> at. */
export const assetUrl = (id: string, file: string) => `/a/w/${id}/${file}`;

// GET /api/worlds/:id (Requirement 10.6): the stored SavedScene plus its asset URLs. Never returns owner_token_hash.
export async function getWorld(_req: Request, env: Env, _ctx: unknown, { id = "" }: { id?: string }): Promise<Response> {
  if (!WORLD_ID.test(id)) return jsonError(404, "World not found");
  const row = await env.DB.prepare("SELECT title, scene, created_at FROM worlds WHERE id = ?1 AND safe = 1")
    .bind(id).first<{ title: string; scene: string; created_at: number }>();
  if (!row) return jsonError(404, "World not found");
  const scene = JSON.parse(row.scene) as SavedScene;    // checked by the SavedScene schema on save
  const reply: WorldReply = {
    id, title: row.title, createdAt: row.created_at, scene,
    assets: {
      source: assetUrl(id, "source.jpg"),
      thumb: assetUrl(id, "thumb.jpg"),
      ...(scene.backdrop === "image" && { backdrop: assetUrl(id, "backdrop.jpg") }),
      cuts: Object.fromEntries(scene.instances.map((i) => [String(i.id), assetUrl(id, `cut/${i.id}.png`)])),
    },
  };
  return Response.json(reply);
}

// DELETE /api/worlds/:id (Requirements 10.10, 10.11). A missing or wrong token and an unknown id get the same 403,
// so the route never tells whether an id exists.
export async function deleteWorld(req: Request, env: Env, _ctx: unknown, { id = "" }: { id?: string }): Promise<Response> {
  if (!(await isOwner(req, env, id))) return jsonError(403, "Only the device that saved this world can delete it");
  // D1 first: the row is what makes the world visible, so it leaves the viewer and gallery even if R2 cleanup fails.
  await env.DB.prepare("DELETE FROM worlds WHERE id = ?1").bind(id).run();
  try {
    // A world has at most 33 objects (source, thumb, backdrop, 30 cuts), so one list page (up to 1000) holds them all.
    const { objects } = await env.BUCKET.list({ prefix: `w/${id}/` });
    if (objects.length) await env.BUCKET.delete(objects.map((o) => o.key));
  } catch (err) {
    console.error(JSON.stringify({ route: "worlds", cleanup: "failed", error: err instanceof Error ? err.name : "unknown" }));
  }
  return new Response(null, { status: 204 });
}

// True if the request carries `Authorization: Bearer <Owner_Token>` whose SHA-256 equals the world's stored hash,
// compared in constant time. The token is hashed before the lookup, so a known and an unknown id cost the same.
async function isOwner(req: Request, env: Env, id: string): Promise<boolean> {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get("Authorization") ?? "")?.[1];
  if (!token || !WORLD_ID.test(id)) return false;
  const hash = new TextEncoder().encode(await sha256Hex(token));
  const row = await env.DB.prepare("SELECT owner_token_hash FROM worlds WHERE id = ?1").bind(id).first<{ owner_token_hash: string }>();
  if (!row) return false;
  const stored = new TextEncoder().encode(row.owner_token_hash);
  return stored.byteLength === hash.byteLength && crypto.subtle.timingSafeEqual(stored, hash);
}
