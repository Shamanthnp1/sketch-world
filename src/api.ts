// Typed fetch wrappers for the Worker's /api routes. /api/segment has its own client (src/sam/client.ts);
// later tasks add the other routes here.
import type { ObjType, SparkScene } from "../shared/scene";

/**
 * A non-2xx reply. `status` tells the cases apart: 422 not a drawing (show `message`), 429 rate limited,
 * 502 model failed, 503 daily cap (Sample_Mode), 400/413/415 bad input. `message` is the Worker's {error} text.
 */
export class ApiError extends Error {
  override name = "ApiError";
  constructor(readonly status: number, message: string) {
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

async function post<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body });
  if (!res.ok) {
    const reply = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new ApiError(res.status, typeof reply?.error === "string" ? reply.error : `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}
