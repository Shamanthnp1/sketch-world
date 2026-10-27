// Browser client for POST /api/segment, copied from undo-manual. Requests start first-in, first-out with
// at most 3 in flight (Requirement 4.1; was 1). A 429 waits Retry-After and resends, holding its slot;
// any other failure rejects, and the caller treats it as a miss for that stage.
//
// API: client.segment(image, { noun: "house" }) or client.segment(image, { box: { x, y, w, h } }).
// Exactly one of noun or box is sent; the box is in the image's pixels.
import type { PxBox } from "../../shared/scene";
import { parseSamOutput, type MaskRaster } from "./parse";

export const MAX_IN_FLIGHT = 3;
const MAX_429_RETRIES = 3;
const DEFAULT_WAIT_MS = 2_000;   // 429 without a usable Retry-After
const MAX_WAIT_MS = 60_000;      // the Worker's rate limit window

export type SegmentPrompt = { noun: string; box?: never } | { box: PxBox; noun?: never };

/** `ms` is the round trip of the request that succeeded: no queue wait, no 429 waits.
 *  `outputText` is the raw reply, kept so the probe page can save it as a fixture. */
export type SegmentResult = { masks: MaskRaster[]; ms: number; outputText: string };

export interface SamClientOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  base?: string;                 // origin of the Worker; "" means same origin
}

/** Rejection for a non-2xx reply; `status` lets the caller spot 503 {mode: "sample"}. */
export class SegmentError extends Error {
  override name = "SegmentError";
  constructor(readonly status: number) {
    super(`Segment request failed (${status})`);
  }
}

export class SamClient {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly fetch: NonNullable<SamClientOptions["fetch"]>;
  private readonly sleep: NonNullable<SamClientOptions["sleep"]>;
  private readonly url: string;

  constructor(opts: SamClientOptions = {}) {
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.url = `${opts.base ?? ""}/api/segment`;
  }

  /** `image` is the JPEG/PNG sent to SAM; a box prompt is in that image's pixels. */
  async segment(image: Blob, prompt: SegmentPrompt): Promise<SegmentResult> {
    // Runs synchronously up to the await, so calls take free slots or queue in call order.
    if (this.active < MAX_IN_FLIGHT) this.active++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await this.send(image, prompt);
    } finally {
      // Hand the slot straight to the next queued request, so a new call can't overtake it.
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  private async send(image: Blob, prompt: SegmentPrompt): Promise<SegmentResult> {
    const body = new FormData();
    body.append("image", image);
    if (prompt.noun !== undefined) body.append("noun", prompt.noun);
    else body.append("box", JSON.stringify(prompt.box));
    for (let retry = 0; ; retry++) {
      const started = performance.now();
      const res = await this.fetch(this.url, { method: "POST", body });
      if (res.status === 429 && retry < MAX_429_RETRIES) {
        await res.body?.cancel();
        await this.sleep(retryAfterMs(res));
        continue;
      }
      if (!res.ok) throw new SegmentError(res.status);
      const { outputText } = (await res.json()) as { outputText?: unknown };
      if (typeof outputText !== "string") throw new Error("Segment reply has no outputText");
      const ms = performance.now() - started;
      return { masks: await parseSamOutput(outputText), ms, outputText };
    }
  }
}

// shortcut: delay-seconds only (what our Worker sends); an HTTP-date falls back to the default wait.
function retryAfterMs(res: Response): number {
  const s = Number(res.headers.get("Retry-After") ?? NaN);
  return Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, MAX_WAIT_MS) : DEFAULT_WAIT_MS;
}
