// POST /api/segment: one sam-3.1 call on the Work_Image (Requirements 4.1, 4.2, 11.7, 12.5, 12.9).
// Multipart: `image` (JPEG or PNG, ≤ 400 KB, with a safe Checks_Row) and exactly one prompt: `noun` (a scene noun) or
// `box` (PxBox JSON in the image's pixel coordinates, from /api/point).
import { buildObjectPrompt } from "@meta-sam/parser";
import { reserveCall } from "../cost";
import { jsonError } from "../http";
import { imageInfo, type ImageInfo } from "../limits/imageSize";
import { MAX_IMAGE_BYTES, readBox, readForm, readImage, readNoun } from "../limits/input";
import { metaFetch } from "../meta/metaFetch";
import { base64, outputText } from "../meta/reply";
import { checkedSafe, NOT_CHECKED } from "./understand";

// The image plus the prompt field and multipart framing; a larger body is refused before parsing.
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 16 * 1024;

export async function segment(req: Request, env: Env): Promise<Response> {
  const form = await readForm(req, MAX_BODY_BYTES);
  if (form instanceof Response) return form;
  const image = await readImage(form, "image");
  if (image instanceof Response) return image;

  const bytes = new Uint8Array(await image.arrayBuffer());
  const info = imageInfo(bytes);
  if (!info) return jsonError(415, "image size could not be read from its header");
  const text = promptText(form, info);
  if (text instanceof Response) return text;
  // Only a drawing /api/understand found safe (Requirement 12.9): no reservation and no SAM call otherwise.
  if (!(await checkedSafe(env, bytes))) return jsonError(403, NOT_CHECKED);

  // Reserve the SAM estimate first (Requirement 11.5); refused → the 503 {mode: "sample"} with no SAM call.
  const refused = await reserveCall(env, "sam");
  if (refused) return refused;
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

  // No message or empty text means zero matches, which is a valid result.
  return Response.json({ outputText: await outputText(res) });
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
