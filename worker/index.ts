import { jsonError } from "./http";
import { asset } from "./routes/assets";
import { backdrop } from "./routes/backdrop";
import { gallery } from "./routes/gallery";
import { point } from "./routes/point";
import { segment } from "./routes/segment";
import { understand } from "./routes/understand";
import { deleteWorld, getWorld, saveWorld } from "./routes/worlds";

type Params = Record<string, string | undefined>;
type Handler = (req: Request, env: Env, ctx: ExecutionContext, params: Params) => Promise<Response>;
type Route = { method: string; pattern: URLPattern; handler: Handler };

const route = (method: string, pathname: string, handler: Handler): Route => ({
  method,
  pattern: new URLPattern({ pathname }),
  handler,
});

// Fixed route table (design "Worker routes"). The Worker builds every prompt and picks every model.
const ROUTES: Route[] = [
  route("POST", "/api/understand", understand),
  route("POST", "/api/point", point),
  route("POST", "/api/segment", segment),
  route("POST", "/api/backdrop", backdrop),
  route("POST", "/api/worlds", saveWorld),
  route("GET", "/api/worlds/:id", getWorld),
  route("DELETE", "/api/worlds/:id", deleteWorld),
  route("GET", "/api/gallery", gallery),
  // R2 keys contain slashes (w/<id>/cut/<n>.png), so the key is the wildcard group "0".
  route("GET", "/a/*", asset),
];

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    const allowed: string[] = [];
    for (const r of ROUTES) {
      const match = r.pattern.exec({ pathname: url.pathname });
      if (!match) continue;
      if (r.method !== req.method) {
        allowed.push(r.method);
        continue;
      }
      try {
        return await r.handler(req, env, ctx, match.pathname.groups);
      } catch (err) {
        // Matched by name so the router doesn't depend on worker/meta/metaFetch.ts.
        if (err instanceof Error && err.name === "MetaApiError") return jsonError(502, "The model service failed. Please retry.");
        // Name only, never the message: it could echo request data.
        console.error(JSON.stringify({ route: `${r.method} ${r.pattern.pathname}`, error: err instanceof Error ? err.name : "unknown" }));
        return jsonError(500, "Internal error");
      }
    }
    // Known path, wrong method → 405 with Allow; anything else (any other /api/* path) → 404.
    if (allowed.length) return jsonError(405, "Method not allowed", { Allow: allowed.join(", ") });
    return jsonError(404, "Not found");
  },
} satisfies ExportedHandler<Env>;
