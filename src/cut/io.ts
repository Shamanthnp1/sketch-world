// The real ChainIO: SAM through SamClient (3 in flight, 429 retries) and Spark boxes through POST /api/point.
import { point } from "../api";
import { SamClient } from "../sam/client";
import type { ChainIO } from "./chain";

/** `jpeg` is the Work_Image JPEG the chain's pixels were read from, so masks and boxes share its pixel grid. */
export function chainIO(jpeg: Blob, sam = new SamClient()): ChainIO {
  return {
    segment: async (prompt) => (await sam.segment(jpeg, prompt)).masks,
    point: (objects) => point(jpeg, objects),
  };
}
