// POST /api/understand: Spark reads the Work_Image into a SparkScene (Requirements 3.2, 3.6, 3.8, 3.9, 11.7, 12.8).
// Multipart: `image` (JPEG or PNG, ≤ 400 KB). The browser sends no prompt text.
import { SparkScene } from "../../shared/scene";
import { reserveCall } from "../cost";
import { sha256Hex } from "../crypto";
import { jsonError } from "../http";
import { imageInfo } from "../limits/imageSize";
import { MAX_IMAGE_BYTES, readForm, readImage } from "../limits/input";
import { askScene } from "../meta/spark";

// The image plus multipart framing; a larger body is refused before parsing.
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 16 * 1024;
const ATTEMPTS = 2;    // one retry when the reply is not a valid scene
export const NOT_A_DRAWING = "Please use a drawing; photos of real people aren't supported";

export async function understand(req: Request, env: Env): Promise<Response> {
  const form = await readForm(req, MAX_BODY_BYTES);
  if (form instanceof Response) return form;
  const image = await readImage(form, "image");
  if (image instanceof Response) return image;

  const bytes = new Uint8Array(await image.arrayBuffer());
  const info = imageInfo(bytes);
  if (!info) return jsonError(415, "image size could not be read from its header");

  let scene: SparkScene | undefined;
  for (let attempt = 1; attempt <= ATTEMPTS && !scene; attempt++) {
    // Each attempt reserves the Spark estimate first, so the retry reserves again (Requirements 3.6, 11.5).
    // Refused → the 503 {mode: "sample"} with no Spark call. A MetaApiError propagates (router → 502).
    const refused = await reserveCall(env, "spark");
    if (refused) return refused;
    const parsed = SparkScene.safeParse(parseJson(await askScene(env, bytes, info.type)));
    if (parsed.success) scene = parsed.data;
    // Field paths only, never values: the reply describes the user's drawing.
    else console.log(JSON.stringify({ route: "understand", attempt, invalid: parsed.error.issues.map((i) => i.path.join(".")) }));
  }
  if (!scene) return jsonError(502, "The model reply was not a valid scene. Please retry.");

  // The Checks_Row lets POST /api/worlds take the safe flag from Spark, never from the client.
  const safe = scene.isDrawing && scene.safe;
  await env.DB.prepare("INSERT OR REPLACE INTO checks (sha256, safe, created_at) VALUES (?1, ?2, ?3)")
    .bind(await sha256Hex(bytes), safe ? 1 : 0, Date.now())
    .run();
  return safe ? Response.json(scene) : jsonError(422, NOT_A_DRAWING);
}

// Not JSON → undefined, which then fails the schema like any other bad reply.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
