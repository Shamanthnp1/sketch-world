// POST /api/backdrop: Muse Image paints the sky panorama (Requirements 9.2, 9.3, 9.4, 9.5, 12.2).
// JSON {title, style}: title by the Scene_Schema title rule, style one of BACKDROP_STYLES. The browser sends no
// prompt text. Reply: the PNG as image/png; a content policy refusal → 422; any other failure → 502; the daily
// cost cap reached → 503 {mode: "sample"} (Requirement 11.7).
import { reserveCall } from "../cost";
import { jsonError } from "../http";
import { parseJson, readBody } from "../limits/input";
import { askBackdrop, BACKDROP_STYLES, BackdropRequest } from "../meta/image";
import { MetaApiError } from "../meta/metaFetch";

const MAX_BODY_BYTES = 1024;    // a 60-character title and a style fit in well under 1 KB
const BAD_BODY = `Expected JSON {title, style}: a title of 1–60 letters, digits, spaces or ',.!?- and a style of ${BACKDROP_STYLES.join(", ")}`;
export const POLICY_REFUSED = "The image model refused this backdrop under its content policy";

export async function backdrop(req: Request, env: Env): Promise<Response> {
  const raw = await readBody(req, MAX_BODY_BYTES);    // bounded read: a chunked body has no Content-Length to check
  if (raw instanceof Response) return raw;
  const body = BackdropRequest.safeParse(parseJson(raw));
  if (!body.success) return jsonError(400, BAD_BODY);

  // Reserve the Muse Image estimate first (Requirement 11.5); refused → the 503 {mode: "sample"} with no call.
  const refused = await reserveCall(env, "image", req);
  if (refused) return refused;
  let png: Uint8Array<ArrayBuffer>;
  try {
    png = await askBackdrop(env, body.data.style, body.data.title);
  } catch (err) {
    // Any other MetaApiError propagates (router → 502).
    if (err instanceof MetaApiError && err.code === "content_policy_violation") return jsonError(422, POLICY_REFUSED);
    throw err;
  }
  return new Response(png, { headers: { "Content-Type": "image/png" } });
}
