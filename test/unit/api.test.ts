import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, backdrop, deleteWorld, getGallery, getWorld, OFFLINE, point, saveMoves, understand } from "../../src/api";

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

describe("point", () => {
  const objects = [{ type: "tree" as const, noun: "tree", count: 2 }];

  it("posts the image and the objects JSON as multipart and returns the boxes", async () => {
    const boxes = { boxes: [{ objIndex: 0, box: { x0: 127, y0: 286, x1: 459, y1: 859 } }] };
    reply(Response.json(boxes));
    expect(await point(img, objects)).toEqual(boxes);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/point");
    const body = init!.body as FormData;
    expect(body.get("image")).toBeInstanceOf(Blob);
    expect(JSON.parse(body.get("objects") as string)).toEqual(objects);
  });

  it("rejects a non-2xx reply with an ApiError", async () => {
    reply(Response.json({ error: "Too many requests" }, { status: 429 }));
    await expect(point(img, objects)).rejects.toMatchObject({ name: "ApiError", status: 429, message: "Too many requests" });
  });
});

describe("backdrop", () => {
  it("posts {title, style: sketch} as JSON and returns the PNG", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    reply(new Response(png, { headers: { "Content-Type": "image/png" } }));
    const blob = await backdrop("House tree and sun");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/backdrop");
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(init!.body as string)).toEqual({ title: "House tree and sun", style: "sketch" });
  });

  it.each([422, 502])("rejects %i with an ApiError", async (status) => {
    reply(Response.json({ error: `msg ${status}` }, { status }));
    await expect(backdrop("Village")).rejects.toMatchObject({ name: "ApiError", status, message: `msg ${status}` });
  });
});

describe("saved worlds", () => {
  const id = "Ab3dE5gH9k", token = "t".repeat(43);

  it("getWorld GETs /api/worlds/:id and returns the reply; 404 is an ApiError", async () => {
    const world = { id, title: "Village", createdAt: 1, scene: {}, assets: { source: "s", thumb: "t", cuts: {} } };
    reply(Response.json(world));
    expect(await getWorld(id)).toEqual(world);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/worlds/${id}`);
    reply(Response.json({ error: "World not found" }, { status: 404 }));
    await expect(getWorld(id)).rejects.toMatchObject({ name: "ApiError", status: 404, message: "World not found" });
  });

  it("getGallery GETs /api/gallery", async () => {
    const g = { worlds: [{ id, title: "Village", thumb: "/a/w/x/thumb.jpg", createdAt: 2 }], samples: [] };
    reply(Response.json(g));
    expect(await getGallery()).toEqual(g);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/gallery");
  });

  it("saveMoves PATCHes JSON {moves} with the Owner_Token as a Bearer token; 403 rejects with the Worker's message", async () => {
    const moves = { "0": { x: 1, y: 0, z: -2 } };
    reply(new Response(null, { status: 204 }));
    await expect(saveMoves(id, token, moves)).resolves.toBeUndefined();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`/api/worlds/${id}`);
    expect(init).toMatchObject({ method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    expect(JSON.parse(init!.body as string)).toEqual({ moves });
    reply(Response.json({ error: "Only the device that saved this world can change it" }, { status: 403 }));
    await expect(saveMoves(id, token, moves)).rejects.toMatchObject({ status: 403, message: "Only the device that saved this world can change it" });
  });

  it("deleteWorld DELETEs with the Bearer token; 204 resolves, 403 rejects", async () => {
    reply(new Response(null, { status: 204 }));
    await expect(deleteWorld(id, token)).resolves.toBeUndefined();
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([`/api/worlds/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }]);
    reply(Response.json({ error: "Only the device that saved this world can delete it" }, { status: 403 }));
    await expect(deleteWorld(id, token)).rejects.toMatchObject({ name: "ApiError", status: 403 });
  });

  it("turns a request that never got a reply into ApiError 0 with a plain message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(getGallery()).rejects.toMatchObject({ name: "ApiError", status: 0, message: OFFLINE });
    await expect(deleteWorld(id, token)).rejects.toMatchObject({ status: 0, message: OFFLINE });
  });
});
