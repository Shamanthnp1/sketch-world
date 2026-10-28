// Save & share (Requirements 10.1, 10.5, 10.12, 16.5): POST /api/worlds as multipart with the SavedScene, the exact
// understand JPEG, one cut-out PNG per Instance, the re-encoded backdrop and a thumbnail of the world, then the
// Owner_Token in localStorage. A refused save only rejects with an ApiError carrying a plain message: the world is
// never disposed or navigated away from, so it stays playable (10.12). The pure parts run in Node; thumbnail(),
// backdropJpeg() and the cutout() calls need OffscreenCanvas.
import { SavedScene, type Moves } from "../../shared/saved";
import type { SparkScene } from "../../shared/scene";
import { ApiError, saveWorldRequest } from "../api";
import type { WorkPixels } from "../cut/chain";
import { cropRgba } from "../cut/threshold";
import type { Instance } from "../cut/types";
import { fitBytes, workImage } from "../image/encode";
import { cutout, type Rgba } from "../sam/cutout";
import type { World } from "../world/build";

export const DEFAULT_GROUND = "#d6ccbb";  // build.ts's kraft ground, until 8.2's groundColour
export const THUMB_W = 640;
export const THUMB_MAX_BYTES = 100 * 1024;
const THUMB_QUALITIES = [0.85, 0.7, 0.55, 0.4];
const THUMB_CROPS = [480, 360, 240];      // centre-band heights tried when no quality fits the full height

export interface SaveInput {
  title: SparkScene["title"];
  view: SparkScene["view"];
  ground?: string;                         // #rrggbb; DEFAULT_GROUND when absent
  backdrop?: Blob | null;                  // the /api/backdrop image; none → "gradient"
  instances: readonly Instance[];
  work: WorkPixels;                        // the Work_Image pixels the masks refer to; its size is SavedScene.img
  sourceJpeg: Blob;                        // the exact bytes sent to /api/understand (the Worker hashes them for the safe check)
  world: Pick<World, "renderer" | "scene" | "camera" | "moves">;
}
export interface Saved { id: string; ownerToken: string; url: `/w/${string}` }

/**
 * Saves the world. Rejects with an ApiError whose message can be shown as is: `status` is the Worker's (403 not
 * checked by this app, 400/415 bad upload, 413 too large, 429 too many saves), 400 when the scene fails the schema
 * here, or 0 when no reply came (network) or a picture could not be made.
 */
export async function saveWorld(input: SaveInput): Promise<Saved> {
  const scene = savedScene(input, !!input.backdrop, input.world.moves());
  let form: FormData;
  try {
    const thumb = await thumbnail(input.world);
    const backdrop = input.backdrop ? await backdropJpeg(input.backdrop) : null;
    const cuts: Blob[] = [];
    for (const inst of input.instances) { // one at a time keeps at most one cut-out's canvases in memory
      const p = boxPixels(input.work, inst);
      cuts.push(await cutout(new ImageData(p.data, p.width, p.height), inst.mask));
    }
    form = saveForm(scene, { source: input.sourceJpeg, thumb, backdrop, cuts });
  } catch (err) {
    throw new ApiError(0, `Could not prepare this world for saving (${err instanceof Error ? err.message : "unknown error"}).`);
  }
  return sendSave(form);
}

/** The SavedScene: masks stripped, no positions, `moves` only when a Card was moved. Throws ApiError 400 if the schema refuses it. */
export function savedScene(
  { title, view, ground, instances, work }: Pick<SaveInput, "title" | "view" | "ground" | "instances" | "work">,
  hasBackdrop: boolean,
  moves: Moves,
): SavedScene {
  const parsed = SavedScene.safeParse({
    v: 1, title, view, img: { w: work.width, h: work.height }, ground: ground ?? DEFAULT_GROUND,
    backdrop: hasBackdrop ? "image" : "gradient",
    instances: instances.map(({ mask: _mask, ...rest }) => rest),
    ...(Object.keys(moves).length > 0 && { moves }),
  });
  if (parsed.success) return parsed.data;
  const paths = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "scene"))].join(", ");
  throw new ApiError(400, `This world can't be saved: its ${paths} did not pass the check.`);
}

/** The multipart body: fields named after their R2 key under w/<id>/, cuts in scene order, backdrop.jpg only for "image". */
export function saveForm(scene: SavedScene, files: { source: Blob; thumb: Blob; backdrop: Blob | null; cuts: readonly Blob[] }): FormData {
  const form = new FormData();
  form.append("scene", JSON.stringify(scene)); // text, not a Blob: the Worker reads it as a string
  form.append("source.jpg", files.source, "source.jpg");
  form.append("thumb.jpg", files.thumb, "thumb.jpg");
  if (scene.backdrop === "image") form.append("backdrop.jpg", files.backdrop!, "backdrop.jpg");
  scene.instances.forEach((inst, k) => form.append(`cut/${inst.id}.png`, files.cuts[k]!, `${inst.id}.png`));
  return form;
}

/** POSTs the form; on 201 stores the Owner_Token under owner:<id>. Errors become ApiErrors with plain messages. */
export async function sendSave(form: FormData): Promise<Saved> {
  let reply: { id: string; ownerToken: string };
  try {
    reply = await saveWorldRequest(form);
  } catch (err) {
    throw plainError(err);
  }
  try { localStorage.setItem(ownerKey(reply.id), reply.ownerToken); } catch { /* storage off: saved, but this device can't delete it */ }
  return { ...reply, url: `/w/${reply.id}` };
}

function plainError(err: unknown): ApiError {
  if (!(err instanceof ApiError)) return new ApiError(0, "Could not reach the server. Check your connection and try again.");
  const plain: Record<number, string> = {
    403: "Only drawings checked by this app can be saved.",
    413: "This world is too large to save.",
    429: "Too many saves in a row. Wait a minute and try again.",
  };
  const msg = plain[err.status]
    ?? (err.status === 400 || err.status === 415 ? `This world could not be saved: ${err.message}.` : "The server could not save this world. Try again later.");
  return new ApiError(err.status, msg);
}

const ownerKey = (id: string) => `owner:${id}`;
/** The Owner_Token this device got when it saved world `id`, or null. */
export function ownerToken(id: string): string | null {
  try { return localStorage.getItem(ownerKey(id)); } catch { return null; }
}
/** Drops the Owner_Token for world `id` (after a delete). */
export function forgetOwner(id: string): void {
  try { localStorage.removeItem(ownerKey(id)); } catch { /* storage off: nothing stored */ }
}

/** The Work_Image pixels under an Instance's bbox: the size its bbox-sized mask refers to, as cutout() needs (same crop as build.ts's Cards). */
export function boxPixels(work: WorkPixels, inst: Pick<Instance, "bbox">): Rgba {
  const { data, rect } = cropRgba(work, inst.bbox, 0);
  return { data: data as Rgba["data"], width: rect.w, height: rect.h };
}

/** Thumb encode steps: every quality at the full height h, then the same at the centre crops below h. The width is always 640. */
export function thumbSteps(h: number): { q: number; h: number }[] {
  return [h, ...THUMB_CROPS.filter((c) => c < h)].flatMap((height) => THUMB_QUALITIES.map((q) => ({ q, h: height })));
}

/** The first thumbSteps(h) encode that is ≤ 100 KB. */
export function fitThumb(encode: (step: { q: number; h: number }) => Promise<Blob>, h: number): Promise<Blob> {
  const steps = thumbSteps(h);
  return fitBytes((i) => encode(steps[i]!), THUMB_MAX_BYTES, steps.map((_, i) => i));
}

/** thumb.jpg: the world as it shows now, 640 px wide at the canvas's aspect, JPEG ≤ 100 KB. */
async function thumbnail({ renderer, scene, camera }: SaveInput["world"]): Promise<Blob> {
  const gl = renderer.domElement, h = Math.max(1, Math.round((THUMB_W * gl.height) / gl.width));
  const full = new OffscreenCanvas(THUMB_W, h), ctx = full.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  // preserveDrawingBuffer is off, so render and copy in the same task, before the browser clears the buffer.
  renderer.render(scene, camera);
  ctx.drawImage(gl, 0, 0, THUMB_W, h);
  return fitThumb(({ q, h: ch }) => {
    if (ch === h) return full.convertToBlob({ type: "image/jpeg", quality: q });
    const band = new OffscreenCanvas(THUMB_W, ch);
    band.getContext("2d")!.drawImage(full, 0, Math.round((h - ch) / 2), THUMB_W, ch, 0, 0, THUMB_W, ch); // keeps the horizon
    return band.convertToBlob({ type: "image/jpeg", quality: q });
  }, h);
}

/** backdrop.jpg: the backdrop on white, long side ≤ 1024 px, JPEG ≤ 400 KB (the Work_Image encoder). */
async function backdropJpeg(backdrop: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(backdrop);
  try {
    return (await workImage(bitmap)).jpeg;
  } finally {
    bitmap.close();
  }
}
