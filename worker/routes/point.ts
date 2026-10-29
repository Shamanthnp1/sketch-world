// POST /api/point: Spark boxes for the scene objects SAM missed by name (Requirements 5.1, 5.2, 11.7, 12.2).
// Multipart: `image` (JPEG or PNG, ≤ 400 KB) and `objects` (JSON [{type, noun, count}], 1–12 entries).
// The browser sends no prompt text. Reply: {boxes: [{objIndex, box: {x0, y0, x1, y1}}]} on Spark's 0–1000 grid,
// at most `count` boxes per object, in Spark's order; the browser scales them to pixels.
import { reserveCall } from "../cost";
import { jsonError } from "../http";
import { imageInfo } from "../limits/imageSize";
import { MAX_IMAGE_BYTES, readForm, readImage, readJsonField } from "../limits/input";
import { askPoint, PointObjects, SparkBoxes } from "../meta/spark";

// The image, the objects field and multipart framing; a larger body is refused before parsing.
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 16 * 1024;
const MAX_OBJECTS_BYTES = 4 * 1024;    // 12 compact entries are under 1 KB
const ATTEMPTS = 2;                    // one retry when the reply is not a valid box list

export async function point(req: Request, env: Env): Promise<Response> {
  const form = await readForm(req, MAX_BODY_BYTES);
  if (form instanceof Response) return form;
  const image = await readImage(form, "image");
  if (image instanceof Response) return image;
  const raw = readJsonField(form, "objects", MAX_OBJECTS_BYTES);
  if (raw instanceof Response) return raw;
  const objects = PointObjects.safeParse(raw);
  if (!objects.success) return jsonError(400, "objects must be 1–12 entries of {type, noun, count}");

  const bytes = new Uint8Array(await image.arrayBuffer());
  const info = imageInfo(bytes);
  if (!info) return jsonError(415, "image size could not be read from its header");

  let reply: SparkBoxes | undefined;
  for (let attempt = 1; attempt <= ATTEMPTS && !reply; attempt++) {
    // Each attempt reserves the Spark estimate first (Requirement 11.5); refused → the 503 {mode: "sample"}
    // with no Spark call. A MetaApiError propagates (router → 502).
    const refused = await reserveCall(env, "spark");
    if (refused) return refused;
    const parsed = SparkBoxes.safeParse(parseJson(await askPoint(env, bytes, info.type, objects.data)));
    if (parsed.success) reply = parsed.data;
    // Field paths only, never values: the reply describes the user's drawing.
    else console.log(JSON.stringify({ route: "point", attempt, invalid: parsed.error.issues.map((i) => i.path.join(".")) }));
  }
  if (!reply) return jsonError(502, "The model reply was not a valid list of boxes. Please retry.");

  // Boxes still allowed per object: an objIndex past the list is dropped, and so is each box beyond `count`.
  const left = objects.data.map((o) => o.count);
  return Response.json({ boxes: reply.boxes.filter((b) => b.objIndex < left.length && left[b.objIndex]!-- > 0) });
}

// Not JSON → undefined, which then fails the schema like any other bad reply.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
