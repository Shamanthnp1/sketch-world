// The only path from the Worker to the Meta Model API.
const BASE_URL = "https://api.meta.ai/v1";
const ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;
const TIMEOUT_MS = 30_000;
const ERROR_BODY_CAP = 16 * 1024;    // chars read from an error body to find `error.code`

// Standard mode = the plain model IDs; the "-contributor" variants are left out on purpose.
export type MetaModel = "muse-spark-1.3" | "sam-3.1" | "muse-image-1.0";

export interface MetaCall {
  route: string;                    // for the log line, e.g. "segment"
  model: MetaModel;
  path: `/${string}`;               // e.g. "/responses"
  body: Record<string, unknown>;    // JSON body; metaFetch sets `model`
  timeoutMs?: number;               // per attempt; default TIMEOUT_MS
}

// Injectable for tests; defaults are the real platform functions.
export interface MetaDeps {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

// Thrown after the last failed attempt; the router maps it to 502 {error}.
// `code` is `error.code` from the reply body (e.g. "content_policy_violation"), or null.
export class MetaApiError extends Error {
  override name = "MetaApiError";
  constructor(readonly status: number | null, readonly code: string | null = null) {
    super(`Model API call failed (${status ?? "no response"})`);
  }
}

export async function metaFetch(env: Pick<Env, "MODEL_API_KEY">, call: MetaCall, deps: MetaDeps = {}): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...call.body, model: call.model }),
  };

  let status: number | null = null;    // last HTTP status, kept when a later attempt times out
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    let res: Response | undefined;
    let failure = "";
    try {
      res = await doFetch(BASE_URL + call.path, { ...init, signal: AbortSignal.timeout(call.timeoutMs ?? TIMEOUT_MS) });
    } catch (err) {
      // Timeout or network error: retried like a 5xx. Log the error name only.
      failure = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "error";
    }
    // One line per attempt: route, model, status, latency. Never the key, headers or bodies.
    console.log(JSON.stringify({ route: call.route, model: call.model, status: res?.status ?? failure, latencyMs: Date.now() - started, attempt }));

    if (res?.ok) return res;
    status = res?.status ?? status;
    const retryable = !res || res.status === 429 || res.status >= 500;    // other 4xx: retrying won't help
    const jitterMs = random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
    const waitMs = Math.max(jitterMs, retryAfterMs(res));
    // Retry-After beyond the cap: fail now rather than hold the request.
    if (!retryable || attempt === ATTEMPTS || waitMs > BACKOFF_CAP_MS) throw new MetaApiError(status, res ? await errorCode(res) : null);
    await res?.body?.cancel();
    await sleep(waitMs);
  }
}

// Retry-After is either delay-seconds or an HTTP date.
function retryAfterMs(res: Response | undefined): number {
  const header = res?.headers.get("Retry-After");
  if (!header) return 0;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

// Reads `error.code` from the OpenAI-style envelope {error: {type, code?, param?, message}}.
// The read is capped (a longer body is cut and won't parse) and the body is never logged.
async function errorCode(res: Response): Promise<string | null> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let text = "";
    while (text.length < ERROR_BODY_CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    const code: unknown = (JSON.parse(text) as { error?: { code?: unknown } } | null)?.error?.code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;    // unreadable or not JSON
  }
}
