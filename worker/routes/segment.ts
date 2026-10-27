// POST /api/segment: one sam-3.1 call on the Work_Image (Requirements 4.1, 4.2, 12.5).
// Multipart: `image` (JPEG or PNG, ≤ 400 KB) and exactly one prompt: `noun` (a scene noun) or
// `box` (PxBox JSON in the image's pixel coordinates, from /api/point).
import { buildObjectPrompt } from "@meta-sam/parser";
import { z } from "zod";
import { jsonError } from "../http";
import { imageInfo, type ImageInfo } from "../limits/imageSize";
import { MAX_IMAGE_BYTES, readBox, readImage, readNoun } from "../limits/input";
import { MetaApiError, metaFetch } from "../meta/metaFetch";

// The image plus the prompt field and multipart framing; a larger body is refused before parsing.
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 16 * 1024;

// Only what we read from a non-streaming /responses reply: the text sits in message items.
const SamReply = z.object({
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })).default([]),
});

export async function segment(req: Request, env: Env): Promise<Response> {
  if (Number(req.headers.get("Content-Length")) > MAX_BODY_BYTES) return jsonError(413, "Request body is too large");
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, "Expected a multipart/form-data body");
  const image = await readImage(form, "image");
  if (image instanceof Response) return image;

  const bytes = new Uint8Array(await image.arrayBuffer());
  const info = imageInfo(bytes);
  if (!info) return jsonError(415, "image size could not be read from its header");
  const text = promptText(form, info);
  if (text instanceof Response) return text;

  // Task 10.2 inserts the SAM cost reserve here (rate limits are applied in the router, task 10.1).
  const res = await metaFetch(env, {
    route: "segment",
    model: "sam-3.1",
    path: "/responses",
    body: {
      store: false,    // privacy: Meta keeps no copy (confirmed live for sam-3.1 by npm run smoke)
      input: [{
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text },
          { type: "input_image", image_url: `data:${info.type};base64,${base64(bytes)}` },
        ],
      }],
    },
  });

  const reply = SamReply.safeParse(await res.json().catch(() => null));
  if (!reply.success) throw new MetaApiError(res.status);    // unreadable reply: same 502 as a failed call
  // No message or empty text means zero matches, which is a valid result.
  const outputText = reply.data.output
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
  return Response.json({ outputText });
}

// The SAM text prompt: the noun as is, or a box prompt. Both or neither field → 400.
function promptText(form: FormData, info: ImageInfo): string | Response {
  if (form.has("noun") === form.has("box")) return jsonError(400, "Send exactly one of noun or box");
  const noun = readNoun(form);
  if (noun !== null) return noun;    // the noun, or its 400
  const box = readBox(form);
  if (box instanceof Response) return box;

  // The prompt needs integer, half-open edges inside the image; PxBox values may be fractional.
  const left = Math.min(Math.floor(box.x), info.width);
  const top = Math.min(Math.floor(box.y), info.height);
  const right = Math.min(Math.ceil(box.x + box.w), info.width);
  const bottom = Math.min(Math.ceil(box.y + box.h), info.height);
  if (left >= right || top >= bottom) return jsonError(400, "box does not overlap the image");
  return buildObjectPrompt({ size: info, objects: [{ id: 1, prompts: [{ box: { left, top, right, bottom } }] }] });
}

// 32 KB chunks keep the argument list small and avoid per-byte string concatenation.
function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
