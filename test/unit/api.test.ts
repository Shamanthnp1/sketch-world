import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, understand } from "../../src/api";

const img = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
const scene = { title: "Village", view: "side", isDrawing: true, safe: true, objects: [] };
const reply = (res: Response) => vi.stubGlobal("fetch", vi.fn(async (_url: string, _init: RequestInit) => res));

afterEach(() => { vi.unstubAllGlobals(); });

describe("understand", () => {
  it("posts the image as multipart and returns the scene", async () => {
    reply(Response.json(scene));
    expect(await understand(img)).toEqual(scene);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/understand");
    expect((init!.body as FormData).get("image")).toBeInstanceOf(Blob);
  });

  it.each([422, 429, 502, 503])("rejects %i with an ApiError carrying the status and the Worker's message", async (status) => {
    reply(Response.json({ error: `msg ${status}` }, { status }));
    await expect(understand(img)).rejects.toMatchObject({ name: "ApiError", status, message: `msg ${status}` });
  });

  it("falls back to a generic message when the body has no {error}", async () => {
    reply(new Response("<html>bad gateway</html>", { status: 502 }));
    const err = await understand(img).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, message: "Request failed (502)" });
  });
});
