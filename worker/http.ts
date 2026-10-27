// Every Worker error response has the body {error}.
export function jsonError(status: number, error: string, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}
