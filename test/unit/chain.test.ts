import { describe, expect, it } from "vitest";
import type { ObjType, PxBox, SparkScene } from "../../shared/scene";
import type { GridBox, PointObject, PointReply } from "../../src/api";
import { buildInstances, MAX_BOX_CALLS, MIN_SIDE, type ChainIO } from "../../src/cut/chain";
import type { MaskRaster } from "../../src/sam/parse";

/** A full width × height raster at (left, top). */
const raster = (left: number, top: number, width: number, height: number): MaskRaster =>
  ({ data: new Uint8Array(width * height).fill(1), width, height, left, top });

/** A white w × h image with black rectangles. */
function work(w: number, h: number, dark: PxBox[] = []) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const r of dark) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) data.fill(0, 4 * (y * w + x), 4 * (y * w + x) + 3);
  return { data, width: w, height: h };
}

type Obj = [type: ObjType, count: number, sky?: boolean];
const scene = (objs: Obj[]): SparkScene => ({
  title: "Test", view: "side", isDrawing: true, safe: true,
  objects: objs.map(([type, count, sky = false]) => ({ type, noun: type, count, sky })),
});

type Out<T> = T | Error;
const settle = <T>(r: Out<T>) => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r));

/** Fake ChainIO: noun replies by noun, one point reply, box replies by box; records every call. */
function fake(o: { noun?: Record<string, Out<MaskRaster[]>>; point?: Out<PointReply>; box?: (b: PxBox) => Out<MaskRaster[]> }) {
  const calls = { noun: [] as string[], point: [] as PointObject[][], box: [] as PxBox[] };
  const io: ChainIO = {
    segment: (p) => {
      if (p.noun !== undefined) {
        calls.noun.push(p.noun);
        return settle(o.noun?.[p.noun] ?? []);
      }
      calls.box.push(p.box);
      return settle(o.box?.(p.box) ?? []);
    },
    point: (objects) => {
      calls.point.push(objects);
      return settle(o.point ?? { boxes: [] });
    },
  };
  return { io, calls };
}
const boxes = (...bs: [objIndex: number, box: GridBox][]): PointReply => ({ boxes: bs.map(([objIndex, box]) => ({ objIndex, box })) });
const summary = (r: Awaited<ReturnType<typeof buildInstances>>) => r.instances.map((i) => [i.id, i.objIndex, i.source]);

// On a 200 × 100 image the grid box (200, 300)–(300, 600) is the pixel box (40, 30) 20 × 30, which is drawn black.
const IMG = () => work(200, 100, [{ x: 40, y: 30, w: 20, h: 30 }]);
const GRID: GridBox = { x0: 200, y0: 300, x1: 300, y1: 600 };
const PX: PxBox = { x: 40, y: 30, w: 20, h: 30 };

describe("buildInstances", () => {
  it("makes sam-noun instances from accepted noun masks and skips the point call", async () => {
    const { io, calls } = fake({ noun: { tree: [raster(10, 10, 20, 30)], cloud: [raster(75, 5, 10, 10), raster(50, 5, 20, 10)] } });
    const r = await buildInstances(scene([["tree", 1], ["cloud", 2, true]]), work(100, 100), io);
    expect(calls.noun).toEqual(["tree", "cloud"]);
    expect(calls.point).toEqual([]);
    expect(summary(r)).toEqual([[0, 0, "sam-noun"], [1, 1, "sam-noun"], [2, 1, "sam-noun"]]);
    expect(r.instances[1]).toMatchObject({ type: "cloud", noun: "cloud", sky: true, bbox: { x: 50, y: 5, w: 20, h: 10 } });
    expect(r.instances[1].mask).toHaveLength(200);
    expect(r.notFound).toEqual([]);
  });

  it("sends only objects with no accepted noun mask (rejected, empty or failed) in one point call", async () => {
    const { io, calls } = fake({
      noun: { tree: [raster(10, 10, 20, 30)], house: [raster(0, 0, 100, 100)], sun: new Error("502") }, // house bbox > 60%
      point: new Error("429"),
    });
    const r = await buildInstances(scene([["tree", 1], ["house", 2], ["sun", 1], ["hill", 1]]), work(100, 100), io);
    expect(calls.point).toEqual([[
      { type: "house", noun: "house", count: 2 }, { type: "sun", noun: "sun", count: 1 }, { type: "hill", noun: "hill", count: 1 },
    ]]);
    expect(summary(r)).toEqual([[0, 0, "sam-noun"]]); // a failed point call is a miss: no box, no instance
    expect(r.notFound).toEqual([1, 2, 3]);
  });

  it("scales a box to pixels and keeps a box mask with bbox IoU ≥ 0.3 as sam-box", async () => {
    const { io, calls } = fake({ noun: { tree: [raster(150, 10, 20, 30)] }, point: boxes([0, GRID]), box: (b) => [raster(b.x, b.y, b.w, b.h)] });
    const r = await buildInstances(scene([["tree", 1], ["house", 1]]), IMG(), io);
    expect(calls.box).toEqual([PX]);
    expect(summary(r)).toEqual([[0, 0, "sam-noun"], [1, 1, "sam-box"]]); // reply index 0 is scene object 1
    expect(r.instances[1].bbox).toEqual(PX);
  });

  it("clamps a box to the image", async () => {
    const { io, calls } = fake({ point: boxes([0, { x0: 900, y0: 0, x1: 1000, y1: 1000 }]) });
    await buildInstances(scene([["tree", 1]]), work(203, 99), io);
    expect(calls.box).toEqual([{ x: 182, y: 0, w: 21, h: 99 }]);
  });

  it.each<[string, Out<MaskRaster[]>]>([
    ["fails", new Error("502")],
    ["returns no mask", []],
    ["returns a mask with bbox IoU < 0.3", [raster(0, 0, 10, 10)]],
  ])("falls back to a threshold cut-out of the crop padded by 4 px, trimmed to its shape, when box SAM %s", async (_, out) => {
    const { io } = fake({ point: boxes([0, GRID]), box: () => out });
    const r = await buildInstances(scene([["tree", 1]]), IMG(), io);
    expect(summary(r)).toEqual([[0, 0, "threshold"]]);
    const { bbox, mask } = r.instances[0];
    expect(bbox).toEqual(PX); // the 28 × 38 crop trimmed to the black square, the only opaque part
    expect(mask).toEqual(new Uint8Array(20 * 30).fill(1));
  });

  it("trims a threshold Instance's bbox and mask to the drawn shape when Spark's box is loose", async () => {
    // An L of two black rects, (40, 30) 20 × 30 and (60, 50) 10 × 10, inside the loose pixel box (20, 10) 80 × 80.
    const img = work(200, 100, [{ x: 40, y: 30, w: 20, h: 30 }, { x: 60, y: 50, w: 10, h: 10 }]);
    const { io } = fake({ point: boxes([0, { x0: 100, y0: 100, x1: 500, y1: 900 }]) });
    const r = await buildInstances(scene([["tree", 1]]), img, io);
    const { bbox, mask, source } = r.instances[0];
    expect(source).toBe("threshold");
    expect(bbox).toEqual({ x: 40, y: 30, w: 30, h: 30 });
    const want = new Uint8Array(30 * 30);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) want[y * 30 + x] = x < 20 || y >= 20 ? 1 : 0;
    expect(mask).toEqual(want);
  });

  it("trims a box mask with empty margins to its set pixels", async () => {
    const ring: MaskRaster = { data: new Uint8Array(24 * 34), width: 24, height: 34, left: 38, top: 28 };
    for (let y = 2; y < 32; y++) ring.data.fill(1, y * 24 + 2, y * 24 + 22); // the 20 × 30 square at (40, 30), 2 px margins
    const { io } = fake({ point: boxes([0, GRID]), box: () => [ring] });
    const r = await buildInstances(scene([["tree", 1]]), IMG(), io);
    expect(summary(r)).toEqual([[0, 0, "sam-box"]]);
    expect(r.instances[0].bbox).toEqual(PX);
    expect(r.instances[0].mask).toEqual(new Uint8Array(20 * 30).fill(1));
  });

  it("falls back to threshold when the box mask overlaps an accepted noun mask", async () => {
    const { io } = fake({ noun: { house: [raster(30, 20, 40, 50)] }, point: boxes([0, GRID]), box: (b) => [raster(b.x, b.y, b.w, b.h)] });
    const r = await buildInstances(scene([["house", 1], ["tree", 1]]), IMG(), io);
    expect(summary(r)).toEqual([[0, 0, "sam-noun"], [1, 1, "threshold"]]); // the tree mask lies inside the house
  });

  it("keeps the whole crop opaque when the threshold cut-out is all transparent", async () => {
    const { io } = fake({ point: boxes([0, { x0: 700, y0: 100, x1: 900, y1: 300 }]) });
    const r = await buildInstances(scene([["cloud", 1]]), IMG(), io); // a blank area of the image
    const { bbox, mask, source } = r.instances[0];
    expect(source).toBe("threshold");
    expect(bbox).toEqual({ x: 136, y: 6, w: 48, h: 28 });
    expect(mask).toHaveLength(48 * 28);
    expect(mask.every((v) => v === 1)).toBe(true);
  });

  // On a 1024 × 200 image the size limit is MIN_SIDE = 20 px. These grid boxes are the pixel boxes (512, 100) w × 11.
  const at = (x1: number): GridBox => ({ x0: 500, y0: 500, x1, y1: 555 });
  const W12 = at(511), W19 = at(518), W20 = at(519);
  const px = (w: number): PxBox => ({ x: 512, y: 100, w, h: 11 });

  it(`drops box cut-outs under ${MIN_SIDE} px per 1024 px and lists their object as not found; noun masks stay`, async () => {
    const { io, calls } = fake({
      noun: { bird: [raster(100, 20, 15, 10)] },                       // a 15 px noun mask: no size limit
      point: boxes([0, W12], [0, W19]),
      box: (b) => (b.w === 12 ? [raster(b.x, b.y, b.w, b.h)] : new Error("502")), // a 12 px mask; a failed call
    });
    const r = await buildInstances(scene([["bird", 1, true], ["flower", 2]]), work(1024, 200), io);
    expect(calls.box).toEqual([px(12), px(19)]);
    expect(summary(r)).toEqual([[0, 0, "sam-noun"]]);  // no sam-box and no threshold square for either dot
    expect(r.notFound).toEqual([1]);
  });

  it("drops a tiny all-opaque threshold square", async () => {
    const { io } = fake({ point: boxes([0, W12]) });              // box SAM finds nothing
    const dark = work(1024, 200, [{ x: 480, y: 80, w: 80, h: 50 }]); // the padded crop has no light pixel
    const r = await buildInstances(scene([["flower", 1]]), dark, io);
    expect(r.instances).toEqual([]);
    expect(r.notFound).toEqual([0]);
  });

  it.each<[string, Out<MaskRaster[]>, PxBox]>([
    ["a sam-box mask", [raster(512, 100, 20, 11)], px(20)],
    ["a whole-crop threshold cut-out (Requirement 5.7)", new Error("502"), { x: 508, y: 96, w: 28, h: 19 }],
  ])(`keeps a box at the ${MIN_SIDE} px limit as %s`, async (_, out, bbox) => {
    const { io } = fake({ point: boxes([0, W20]), box: () => out });
    const r = await buildInstances(scene([["flower", 1]]), work(1024, 200), io);
    expect(r.instances).toHaveLength(1);
    expect(r.instances[0].bbox).toEqual(bbox);
    expect(r.instances[0].mask.every((v) => v === 1)).toBe(true);
    expect(r.notFound).toEqual([]);
  });

  it(`makes at most ${MAX_BOX_CALLS} box SAM calls, in box order, and sends later boxes to threshold`, async () => {
    const grid = (k: number): GridBox => ({ x0: 150 * k + 10, y0: 100, x1: 150 * k + 100, y1: 500 });
    const { io, calls } = fake({
      point: boxes(...[0, 1, 2, 3, 4, 5].map((k): [number, GridBox] => [0, grid(k)])),
      box: (b) => [raster(b.x, b.y, b.w, b.h)],
    });
    const r = await buildInstances(scene([["tree", 6]]), work(200, 100), io);
    expect(calls.box).toEqual([0, 1, 2, 3].map((k) => ({ x: 30 * k + 2, y: 10, w: 18, h: 40 })));
    expect(r.instances.map((i) => i.source)).toEqual(["sam-box", "sam-box", "sam-box", "sam-box", "threshold", "threshold"]);
  });

  it("lists objects with no accepted mask and no box as not found, and orders instances by scene object", async () => {
    const { io } = fake({ noun: { cloud: [raster(150, 5, 20, 10)] }, point: boxes([1, GRID]) });
    const r = await buildInstances(scene([["house", 1], ["tree", 1], ["cloud", 1]]), IMG(), io);
    expect(summary(r)).toEqual([[0, 1, "threshold"], [1, 2, "sam-noun"]]);
    expect(r.notFound).toEqual([0]);
  });

  it(`keeps at most count boxes per object and at most 30 instances`, async () => {
    const twelve = (objIndex: number) => Array.from({ length: 12 }, (): [number, GridBox] => [objIndex, GRID]);
    const { io, calls } = fake({ point: boxes(...twelve(0), ...twelve(1), ...twelve(2), ...twelve(3)) });
    const r = await buildInstances(scene([["tree", 10], ["house", 10], ["cloud", 10], ["sun", 10]]), IMG(), io); // Σcount 40
    expect(calls.box).toHaveLength(MAX_BOX_CALLS);
    expect(r.instances).toHaveLength(30);
    expect(r.instances.map((i) => i.objIndex)).toEqual([...Array(10).fill(0), ...Array(10).fill(1), ...Array(10).fill(2)]);
    expect(r.instances.map((i) => i.id)).toEqual([...Array(30).keys()]);
  });
});
