// The real ChainIO: SAM through SamClient (3 in flight, 429 retries) and Spark boxes through POST /api/point.
import { point } from "../api";
import { SamClient } from "../sam/client";
import type { ChainIO } from "./chain";

export const STALE_RUN = "This run was left or replaced";

/**
 * `jpeg` is the Work_Image JPEG the chain's pixels were read from, so masks and boxes share its pixel grid. `live` is
 * asked just before each request goes out: once it is false (the user left Create, or a newer run started), a queued
 * SAM call, a 429 resend and the point call fail as misses instead of spending the shared daily budget on a world
 * nobody sees. Requests already sent still finish.
 */
export function chainIO(jpeg: Blob, live: () => boolean = () => true): ChainIO {
  const stale = () => Promise.reject(new Error(STALE_RUN));
  const sam = new SamClient({ fetch: (url, init) => (live() ? fetch(url, init) : stale()) });
  return {
    segment: async (prompt) => (await sam.segment(jpeg, prompt)).masks,
    point: (objects) => (live() ? point(jpeg, objects) : stale()),
  };
}
