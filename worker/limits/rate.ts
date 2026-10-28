// Per-route rate limits (design "Worker routes", Requirements 11.1, 11.2, 16.8). The router calls rateLimit before
// the handler. Each limited route names one Workers Rate Limiting binding; the limit and the 60 s period are set on
// the binding in wrangler.jsonc. POST /api/worlds and PATCH /api/worlds/:id share the "save" bucket of RL_SAVE.
import { jsonError } from "../http";

/** Limited route name → its binding. The name is the first part of the key. */
export const LIMITERS = {
  understand: "RL_UNDERSTAND",
  point: "RL_POINT",
  segment: "RL_SEGMENT",
  backdrop: "RL_BACKDROP",
  save: "RL_SAVE",
} as const satisfies Record<string, keyof Env>;
export type LimitedRoute = keyof typeof LIMITERS;

/** Stands in for the IP when CF-Connecting-IP is missing, which only happens off Cloudflare (local dev). */
export const NO_IP = "no-ip";
/** Every binding counts over 60 s, so a refused client can retry after that. */
export const RETRY_AFTER_S = 60;

/** `${route}:${CF-Connecting-IP}`. */
export const rateKey = (route: LimitedRoute, req: Request) => `${route}:${req.headers.get("CF-Connecting-IP") || NO_IP}`;

/** null when the request may go on; otherwise the 429 reply to send instead of running the handler. */
export async function rateLimit(env: Env, route: LimitedRoute, req: Request): Promise<Response | null> {
  const { success } = await env[LIMITERS[route]].limit({ key: rateKey(route, req) });
  if (success) return null;
  return jsonError(429, "Too many requests. Try again in a minute.", { "Retry-After": String(RETRY_AFTER_S) });
}
