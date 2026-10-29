// Typed fetch wrappers for the Worker's /api routes. /api/segment has its own client (src/sam/client.ts).
import type { GalleryReply, Moves, WorldReply } from "../shared/saved";
import type { ObjType, SparkScene } from "../shared/scene";

/**
 * A non-2xx reply. `status` tells the cases apart: 422 not a drawing (show `message`), 429 rate limited,
 * 502 model failed, 503 daily cap (Sample_Mode), 400/413/415 bad input. `message` is the Worker's {error} text;
 * `mode` is the reply's {mode} ("sample" with the daily cap's 503).
 */
export class ApiError extends Error {
  override name = "ApiError";
  constructor(readonly status: number, message: string, readonly mode?: string) {
    super(message);
  }
}

/** POST /api/understand with the Work_Image JPEG. The Worker has already checked the reply with Scene_Schema. */
export function understand(image: Blob): Promise<SparkScene> {
  const body = new FormData();
  body.append("image", image);
  return post("/api/understand", body);
}

/** A scene object sent to POST /api/point. */
export type PointObject = { type: ObjType; noun: string; count: number };
/** A box on the image's 0–1000 grid: (x0, y0) top-left, (x1, y1) bottom-right. */
export type GridBox = { x0: number; y0: number; x1: number; y1: number };
/** `objIndex` indexes the `objects` list that was sent; at most `count` boxes per object, in Spark's order. */
export type PointReply = { boxes: { objIndex: number; box: GridBox }[] };

/** POST /api/point with the Work_Image JPEG and the objects SAM missed by name (1–12). */
export function point(image: Blob, objects: readonly PointObject[]): Promise<PointReply> {
  const body = new FormData();
  body.append("image", image);
  body.append("objects", JSON.stringify(objects));
  return post("/api/point", body);
}

/** POST /api/worlds with the multipart save that src/share/save.ts builds. 201 → the new world's id and Owner_Token. */
export function saveWorldRequest(form: FormData): Promise<{ id: string; ownerToken: string }> {
  return post("/api/worlds", form);
}

/** POST /api/backdrop: Muse Image paints the sky panorama for the world `title`; resolves to the PNG. 422: refused under its content policy, 502: failed. */
export async function backdrop(title: string, style: "sketch" = "sketch"): Promise<Blob> {
  const res = await fetch("/api/backdrop", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, style }),
  });
  if (!res.ok) throw await apiError(res);
  return res.blob();
}

/** GET /api/worlds/:id: a saved world's SavedScene and asset URLs. 404: no such world (or deleted). */
export async function getWorld(id: string): Promise<WorldReply> {
  return (await send(`/api/worlds/${encodeURIComponent(id)}`)).json() as Promise<WorldReply>;
}

/** GET /api/gallery: the 24 latest approved worlds, newest first, and the sample worlds. */
export async function getGallery(): Promise<GalleryReply> {
  return (await send("/api/gallery")).json() as Promise<GalleryReply>;
}

/** PATCH /api/worlds/:id with the Owner_Token: replaces the saved moves ({} clears them). 204; 403 wrong token, 400 bad moves, 413 too large. */
export async function saveMoves(id: string, token: string, moves: Moves): Promise<void> {
  await send(`/api/worlds/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ moves }),
  });
}

/** DELETE /api/worlds/:id with the Owner_Token. 204; 403 wrong token (or no such world). */
export async function deleteWorld(id: string, token: string): Promise<void> {
  await send(`/api/worlds/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

export const OFFLINE = "Could not reach the server. Check your connection and try again.";

/** fetch, with a failed request (no network) as ApiError 0 and a non-2xx reply as ApiError, both with a message to show. */
async function send(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, init).catch(() => { throw new ApiError(0, OFFLINE); });
  if (!res.ok) throw await apiError(res);
  return res;
}

async function post<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

async function apiError(res: Response): Promise<ApiError> {
  const reply = (await res.json().catch(() => null)) as { error?: unknown; mode?: unknown } | null;
  return new ApiError(res.status, typeof reply?.error === "string" ? reply.error : `Request failed (${res.status})`,
    typeof reply?.mode === "string" ? reply.mode : undefined);
}
