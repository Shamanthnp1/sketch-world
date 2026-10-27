// Shared by the routes that call the Responses API: the image as base64 and the text of a non-streaming reply.
import { z } from "zod";
import { MetaApiError } from "./metaFetch";

// Only what we read from a non-streaming /responses reply: the text sits in message items.
const Reply = z.object({
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })).default([]),
});

// The joined output_text of the message items; "" when there is none.
// An unreadable reply throws MetaApiError, the same 502 as a failed call.
export async function outputText(res: Response): Promise<string> {
  const reply = Reply.safeParse(await res.json().catch(() => null));
  if (!reply.success) throw new MetaApiError(res.status);
  return reply.data.output
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
}

// 32 KB chunks keep the argument list small and avoid per-byte string concatenation.
export function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
