import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedScene } from "../../shared/saved";
import { ApiError } from "../../src/api";
import type { Instance } from "../../src/cut/types";
import { trimToMask } from "../../src/sam/cutout";
import {
  boxPixels, DEFAULT_GROUND, fitThumb, forgetOwner, ownerToken, saveForm, savedScene, sendSave, THUMB_MAX_BYTES, thumbSteps,
} from "../../src/share/save";

const inst = (id: number, type: Instance["type"], over: Partial<Instance> = {}): Instance => ({
  id, objIndex: id, type, noun: type, sky: false, bbox: { x: 10, y: 20, w: 2, h: 2 }, mask: new Uint8Array([1, 1, 0, 1]),
  source: "sam-noun", ...over,
});
const instances = [inst(0, "tree"), inst(1, "mountain"), inst(2, "house")];
const work = { data: new Uint8ClampedArray(4 * 800 * 600), width: 800, height: 600 };
const base = { title: "Village", view: "side" as const, instances, work };
const blob = (type: string) => new Blob([new Uint8Array([1, 2, 3])], { type });

afterEach(() => { vi.unstubAllGlobals(); });

describe("savedScene", () => {
  it("builds a v1 SavedScene without masks or positions and without moves when nothing moved", () => {
    const s = savedScene(base, false, {});
    expect(s).toEqual({
      v: 1, title: "Village", view: "side", img: { w: 800, h: 600 }, ground: DEFAULT_GROUND, backdrop: "gradient",
      instances: instances.map(({ mask: _m, ...rest }) => rest),
    });
    expect("moves" in s).toBe(false);
    expect(s.instances.some((i) => "mask" in i)).toBe(false);
    expect(SavedScene.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
  });

  it("keeps the given ground, marks an image backdrop and passes moves through unchanged", () => {
    const moves = { "0": { x: 1.5, y: 0, z: -3 }, "2": { x: -4, y: 0, z: 2 } };
    const s = savedScene({ ...base, ground: "#a0b1c2" }, true, moves);
    expect(s).toMatchObject({ ground: "#a0b1c2", backdrop: "image", moves });
    expect(SavedScene.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it.each([
    ["a terrain Instance", { "1": { x: 0, y: 0, z: 0 } }],
    ["an unknown id", { "7": { x: 0, y: 0, z: 0 } }],
    ["a place outside the world", { "0": { x: 999, y: 0, z: 0 } }],
  ])("fails fast with ApiError 400 for moves naming %s", (_, moves) => {
    expect(() => savedScene(base, false, moves)).toThrow(ApiError);
    expect(() => savedScene(base, false, moves)).toThrow(/moves/);
  });
});

describe("saveForm", () => {
  const files = { source: blob("image/jpeg"), thumb: blob("image/jpeg"), backdrop: blob("image/jpeg"), cuts: [0, 1, 2].map(() => blob("image/png")) };

  it("names every field after its R2 key: scene text, source, thumb, backdrop and one cut per Instance id", () => {
    const sparse = [inst(0, "tree"), inst(3, "house"), inst(12, "cloud", { objIndex: 2, sky: true })];
    const scene = savedScene({ ...base, instances: sparse }, true, {});
    const form = saveForm(scene, files);
    expect([...form.keys()]).toEqual(["scene", "source.jpg", "thumb.jpg", "backdrop.jpg", "cut/0.png", "cut/3.png", "cut/12.png"]);
    expect(typeof form.get("scene")).toBe("string");
    expect(JSON.parse(form.get("scene") as string)).toEqual(scene);
    expect(form.get("cut/3.png")).toBeInstanceOf(File);
  });

  it("sends backdrop.jpg only for an image backdrop", () => {
    const form = saveForm(savedScene(base, false, {}), { ...files, backdrop: null });
    expect([...form.keys()]).toEqual(["scene", "source.jpg", "thumb.jpg", "cut/0.png", "cut/1.png", "cut/2.png"]);
  });
});

describe("thumb fitting", () => {
  // Fake JPEG encoder: bytes grow with quality and height (the width is always 640).
  const fake = (bytesPerRow: number) => vi.fn(async ({ q, h }: { q: number; h: number }) => new Blob([new Uint8Array(Math.round(q * h * bytesPerRow))]));

  it("lowers the quality first, then crops the height, never below the steps", async () => {
    const encode = fake(400);  // full 1000 px never fits; 480 px fits at 0.4
    const thumb = await fitThumb(encode, 1000);
    expect(thumb.size).toBeLessThanOrEqual(THUMB_MAX_BYTES);
    expect(encode.mock.calls.map(([s]) => [s.h, s.q])).toEqual([
      [1000, 0.85], [1000, 0.7], [1000, 0.55], [1000, 0.4], [480, 0.85], [480, 0.7], [480, 0.55], [480, 0.4],
    ]);
  });

  it("keeps the full height when the best quality fits", async () => {
    const encode = fake(100);
    await fitThumb(encode, 360);
    expect(encode.mock.calls).toEqual([[{ q: 0.85, h: 360 }]]);
  });

  it("only crops to heights below the frame", () => {
    expect(new Set(thumbSteps(400).map((s) => s.h))).toEqual(new Set([400, 360, 240]));
    expect(new Set(thumbSteps(200).map((s) => s.h))).toEqual(new Set([200]));
  });

  it("throws when even the smallest step is too large", async () => {
    await expect(fitThumb(fake(2000), 1000)).rejects.toThrow("does not fit");
  });
});

describe("boxPixels", () => {
  it("crops the work pixels to the bbox, the size of the mask, so the cut-out matches the Card", () => {
    const w = 4, h = 3, data = new Uint8ClampedArray(4 * w * h).map((_, i) => i); // pixel k holds bytes 4k…4k+3
    const o = { bbox: { x: 1, y: 1, w: 2, h: 2 }, mask: new Uint8Array([1, 0, 1, 1]) };
    const p = boxPixels({ data, width: w, height: h }, o);
    expect([p.width, p.height]).toEqual([2, 2]);
    expect(p.width * p.height).toBe(o.mask.length);
    const px = (x: number, y: number) => [...data.subarray(4 * (y * w + x), 4 * (y * w + x) + 4)];
    expect([...p.data]).toEqual([...px(1, 1), ...px(2, 1), ...px(1, 2), ...px(2, 2)]);
    const cut = trimToMask(p.data, o.mask, p.width, p.height)!;
    expect([...cut.data]).toEqual([...px(1, 1), 0, 0, 0, 0, ...px(1, 2), ...px(2, 2)]);
  });
});

describe("sendSave and owner tokens", () => {
  const fakeStorage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };
  const reply = (res: Response | Error) =>
    vi.stubGlobal("fetch", vi.fn(async () => { if (res instanceof Error) throw res; return res; }));

  it("posts the form to /api/worlds and stores the Owner_Token under owner:<id>", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    reply(Response.json({ id: "Ab3dE5gH9k", ownerToken: "tok" }, { status: 201 }));
    const form = new FormData();
    expect(await sendSave(form)).toEqual({ id: "Ab3dE5gH9k", ownerToken: "tok", url: "/w/Ab3dE5gH9k" });
    expect(vi.mocked(fetch).mock.calls[0]).toEqual(["/api/worlds", { method: "POST", body: form }]);
    expect(storage.m.get("owner:Ab3dE5gH9k")).toBe("tok");
    expect(ownerToken("Ab3dE5gH9k")).toBe("tok");
    forgetOwner("Ab3dE5gH9k");
    expect(ownerToken("Ab3dE5gH9k")).toBeNull();
  });

  it.each([
    [403, "Only drawings checked by this app can be saved."],
    [413, "This world is too large to save."],
    [400, "This world could not be saved: thumb.jpg must be 640 px wide."],
    [415, "This world could not be saved: thumb.jpg must be 640 px wide."],
    [500, "The server could not save this world. Try again later."],
  ])("turns a %i into an ApiError with a plain message and stores nothing", async (status, message) => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    reply(Response.json({ error: "thumb.jpg must be 640 px wide" }, { status }));
    await expect(sendSave(new FormData())).rejects.toMatchObject({ name: "ApiError", status, message });
    expect(storage.m.size).toBe(0);
  });

  it("reports a network failure as status 0", async () => {
    reply(new TypeError("Failed to fetch"));
    await expect(sendSave(new FormData())).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/reach the server/) });
  });

  it("still returns the save when storage is unavailable, and reads no token", async () => {
    const off = () => { throw new DOMException("denied", "SecurityError"); };
    vi.stubGlobal("localStorage", { getItem: off, setItem: off, removeItem: off });
    reply(Response.json({ id: "Ab3dE5gH9k", ownerToken: "tok" }, { status: 201 }));
    expect((await sendSave(new FormData())).id).toBe("Ab3dE5gH9k");
    expect(ownerToken("Ab3dE5gH9k")).toBeNull();
    expect(() => forgetOwner("Ab3dE5gH9k")).not.toThrow();
  });
});
