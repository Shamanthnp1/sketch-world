// Input limits at the trust boundary (Requirements 3.4, 11.4).
// Pattern: each reader takes the parsed multipart FormData (readBody: the Request) and returns the validated
// value or a ready {error} Response, which the route returns as is:
//   const box = readBox(form); if (box instanceof Response) return box;
// Images are never decoded (10 ms CPU budget): size comes from File.size, type from the first 4 bytes.
import { z } from "zod";
import { NOUN } from "../../shared/scene"; // Scene_Schema noun rule (Requirement 3.4)
import { jsonError } from "../http";

export const MAX_IMAGE_BYTES = 400 * 1024;
export const MAX_CUT_PNG_BYTES = 200 * 1024; // each w/<id>/cut/<n>.png in POST /api/worlds
const MAX_TEXT_CHARS = 500;                  // global cap for any text field
const MAX_JSON_BYTES = 64 * 1024;            // default cap for JSON fields (D1 worlds.scene ≤ 64 KB)
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47];

// Not a file → 400; > 400 KB → 413; magic bytes not JPEG or PNG → 415.
export async function readImage(form: FormData, field: string): Promise<File | Response> {
  const v = form.get(field);
  if (!(v instanceof File)) return jsonError(400, `${field} must be an image file`);
  if (v.size > MAX_IMAGE_BYTES) return jsonError(413, `${field} is larger than 400 KB`);
  const head = new Uint8Array(await v.slice(0, 4).arrayBuffer());
  const starts = (magic: number[]) => magic.every((b, i) => head[i] === b);
  if (!starts(JPEG) && !starts(PNG)) return jsonError(415, `${field} must be a JPEG or PNG image`);
  return v;
}

// Missing → null (the route decides whether the field is required); a file, or longer than the
// field cap or the global 500-char cap → 400.
export function readText(form: FormData, field: string, cap: number = MAX_TEXT_CHARS): string | null | Response {
  const v = form.get(field);
  if (v === null) return null;
  if (typeof v !== "string") return jsonError(400, `${field} must be text`);
  const max = Math.min(cap, MAX_TEXT_CHARS);
  if (v.length > max) return jsonError(400, `${field} is longer than ${max} characters`);
  return v;
}

// The raw request body, at most capBytes. A Content-Length over the cap → 413 before reading; a body without one
// (chunked) is counted as it arrives and → 413 at cap + 1 bytes, so no more than the cap is ever buffered.
export async function readBody(req: Request, capBytes: number): Promise<Uint8Array | Response> {
  const tooLarge = () => jsonError(413, "Request body is too large");
  if (Number(req.headers.get("Content-Length")) > capBytes) return tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      size += r.value.byteLength;
      if (size > capBytes) {
        await reader.cancel();
        return tooLarge();
      }
      chunks.push(r.value);
    }
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

// UTF-8 JSON bytes → the parsed value unchecked (the caller validates it with zod); undefined if not JSON.
export function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

// Multipart field "noun": missing → null; otherwise it must match the Scene_Schema noun rule, else 400.
export function readNoun(form: FormData): string | null | Response {
  const v = readText(form, "noun");
  if (v === null || v instanceof Response) return v;
  return NOUN.test(v) ? v : jsonError(400, "noun must be 1–40 lowercase letters, spaces or hyphens, starting with a letter");
}

// JSON text field of at most capBytes UTF-8 bytes. Missing, a file, too large or invalid JSON → 400.
// Returns the parsed value unchecked: the caller validates it with zod.
export function readJsonField(form: FormData, field: string, capBytes: number = MAX_JSON_BYTES): unknown | Response {
  const v = form.get(field);
  if (typeof v !== "string") return jsonError(400, `${field} must be JSON text`);
  if (new TextEncoder().encode(v).byteLength > capBytes) return jsonError(400, `${field} is larger than ${capBytes} bytes`);
  try {
    return JSON.parse(v);
  } catch {
    return jsonError(400, `${field} must be valid JSON`);
  }
}

const coord = z.number().min(0).max(4096); // z.number() also rejects NaN and ±Infinity (e.g. JSON 1e999)
const Box = z.object({ x: coord, y: coord, w: coord, h: coord });
export type PxBox = z.infer<typeof Box>;

// Multipart field "box": JSON PxBox with finite values in 0–4096, else 400.
export function readBox(form: FormData): PxBox | Response {
  const raw = readText(form, "box");
  if (raw instanceof Response) return raw;
  let value: unknown;
  try {
    value = raw === null ? undefined : JSON.parse(raw);
  } catch {
    value = undefined;
  }
  const box = Box.safeParse(value);
  return box.success ? box.data : jsonError(400, "box must be JSON {x, y, w, h} with finite values in 0–4096");
}
