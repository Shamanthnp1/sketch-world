// Every Worker error response has the body {error}.
export function jsonError(status: number, error: string, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}

/** Thrown to end a request with `reply` from inside a call (metaFetch's refused re-reservation); the router sends it. */
export class EarlyReply extends Error {
  override name = "EarlyReply";
  constructor(readonly reply: Response) {
    super(`Early reply (${reply.status})`);
  }
}
