// GET /a/:key serves one saved-world asset from R2 (Requirement 10.8). The key is the router's wildcard group, still
// percent-encoded (an encoded slash stays "%2F"); the URL parser has already resolved "." and ".." segments.
import { jsonError } from "../http";

// design.md "R2 keys". Checked before any R2 read; nothing else in the bucket is reachable.
const KEY = /^w\/[A-Za-z0-9]{10}\/(source\.jpg|backdrop\.jpg|thumb\.jpg|cut\/\d{1,2}\.png)$/;

export async function asset(_req: Request, env: Env, _ctx: unknown, { 0: key = "" }: { 0?: string }): Promise<Response> {
  if (!KEY.test(key)) return jsonError(404, "Not found");
  const obj = await env.BUCKET.get(key);
  if (!obj) return jsonError(404, "Not found");
  const headers = new Headers();
  obj.writeHttpMetadata(headers);    // the content type stored on save
  headers.set("ETag", obj.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  // Keys never change for an id and ids are never reused. A deleted world's assets stay only in caches that already hold them.
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}
