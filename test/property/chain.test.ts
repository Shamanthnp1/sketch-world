// Feature: sketch-world, Property 2: Fallback chain gives exactly one cut-out in source order
// **Validates: Requirements 4.6, 5.4, 5.5, 5.7, 5.8, 5.10, 5.11**
// A fake ChainIO answers each noun call, the point call and each box call from a drawn outcome: masks that pass,
// masks that are rejected (or none), or a rejected promise. The checks rebuild each stage from the fake's call log
// and masks painted into image-sized arrays; only thresholdMask (checked by Property 4) is reused from src.
// Box-stage cut-outs follow the size limit and trimming of Requirements 5.13 and 5.14: some images are up to 256 px
// wide and some boxes a few pixels across, so boxes and cut-outs under the limit (up to 5 px here) occur.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALL_TYPES, type ObjType, type PxBox, type SparkScene } from "../../shared/scene";
import type { GridBox, PointObject, PointReply } from "../../src/api";
import { buildInstances, MAX_BOX_CALLS, MAX_INSTANCES, MIN_SIDE, type ChainIO, type WorkPixels } from "../../src/cut/chain";
import { thresholdMask } from "../../src/cut/threshold";
import type { Instance } from "../../src/cut/types";
import type { MaskRaster } from "../../src/sam/parse";

type Fails = "error"; // the call rejects
type NounSpec = { kind: "good" | "sparse"; r: PxBox } | { kind: "huge" };
type BoxSpec = { kind: "fit" } | { kind: "rect"; r: PxBox };
type Obj = { type: ObjType; count: number; sky: boolean; noun: Fails | NounSpec[]; boxes: { g: GridBox; key: number }[] };
type Scenario = { W: number; H: number; dark: PxBox[]; objs: Obj[]; pointFails: boolean; boxCalls: (Fails | BoxSpec[])[] };

const error = fc.constant<Fails>("error");
/** A rect inside a W × H image, at most maxW × maxH. */
const rect = (W: number, H: number, maxW: number, maxH: number) =>
  fc.record({ x: fc.nat(W - 1), y: fc.nat(H - 1), w: fc.integer({ min: 1, max: maxW }), h: fc.integer({ min: 1, max: maxH }) })
    .map(({ x, y, w, h }): PxBox => ({ x, y, w: Math.min(w, W - x), h: Math.min(h, H - y) }));

// good: a full rect ≤ 70% × 70% of the image (bbox ≤ 49%, accepted for every type); sparse: one set pixel in a
// ≥ 5 × 5 raster (< 5% of its bbox); huge: the whole image (> 90%). Only good masks pass Requirement 4.3.
const nounSpec = (W: number, H: number): fc.Arbitrary<NounSpec> => fc.oneof(
  { weight: 3, arbitrary: rect(W, H, Math.floor(0.7 * W), Math.floor(0.7 * H)).map((r) => ({ kind: "good" as const, r })) },
  {
    weight: 1,
    arbitrary: fc.record({ x: fc.nat(W - 10), y: fc.nat(H - 10), w: fc.integer({ min: 5, max: 10 }), h: fc.integer({ min: 5, max: 10 }) })
      .map((r) => ({ kind: "sparse" as const, r })),
  },
  { weight: 1, arbitrary: fc.constant({ kind: "huge" as const }) },
);
// A box on Spark's 0–1000 grid with x0 < x1 and y0 < y1, as the Worker's zod check guarantees; half the spans are
// at most 20 grid units, so tiny boxes are common.
const span = fc.tuple(fc.integer({ min: 0, max: 999 }), fc.oneof(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 700 })))
  .map(([a, d]): [number, number] => [a, Math.min(1000, a + d)]);
const gridBox = fc.tuple(span, span).map(([[x0, x1], [y0, y1]]): GridBox => ({ x0, y0, x1, y1 }));
const objArb = (W: number, H: number): fc.Arbitrary<Obj> => fc.integer({ min: 1, max: 10 }).chain((count) => fc.record({
  type: fc.constantFrom(...ALL_TYPES), count: fc.constant(count), sky: fc.boolean(),
  noun: fc.oneof({ weight: 1, arbitrary: error }, { weight: 3, arbitrary: fc.array(nounSpec(W, H), { maxLength: 3 }) }),
  // Up to `count` boxes (the Worker trims to count); `key` interleaves the reply across objects.
  boxes: fc.array(fc.record({ g: gridBox, key: fc.nat(99) }), { maxLength: count }),
}));
// fit: the box itself (bbox IoU 1); rect: anywhere in the image (any IoU).
const boxSpec = (W: number, H: number): fc.Arbitrary<BoxSpec> => fc.oneof(
  { weight: 2, arbitrary: fc.constant({ kind: "fit" as const }) },
  { weight: 1, arbitrary: rect(W, H, W, H).map((r) => ({ kind: "rect" as const, r })) },
);
// W up to 256 makes the size limit MIN_SIDE · W / 1024 up to 5 px (under 1 px for W ≤ 48, where nothing is tiny).
const width = fc.oneof(fc.integer({ min: 24, max: 48 }), fc.integer({ min: 120, max: 256 }));
const scenario: fc.Arbitrary<Scenario> = fc.record({ W: width, H: fc.integer({ min: 24, max: 48 }) })
  .chain(({ W, H }) => fc.record({
    W: fc.constant(W), H: fc.constant(H),
    dark: fc.array(rect(W, H, 16, 16), { maxLength: 4 }),
    objs: fc.array(objArb(W, H), { minLength: 1, maxLength: 12 }), // Σcount up to 120, so the 30 cap is reached
    pointFails: fc.oneof({ weight: 1, arbitrary: fc.constant(true) }, { weight: 3, arbitrary: fc.constant(false) }),
    boxCalls: fc.array(
      fc.oneof({ weight: 1, arbitrary: error }, { weight: 3, arbitrary: fc.array(boxSpec(W, H), { maxLength: 2 }) }),
      { minLength: MAX_BOX_CALLS, maxLength: MAX_BOX_CALLS },
    ),
  }));

const nounOf = (i: number) => `obj ${String.fromCharCode(97 + i)}`;
const indexOf = (noun: string) => noun.charCodeAt(4) - 97;
const raster = (r: PxBox, data: Uint8Array = new Uint8Array(r.w * r.h).fill(1)): MaskRaster =>
  ({ data, width: r.w, height: r.h, left: r.x, top: r.y });
const rectOf = (m: MaskRaster): PxBox => ({ x: m.left, y: m.top, w: m.width, h: m.height });
const asRaster = (o: Instance) => raster(o.bbox, o.mask);

function nounMask(s: NounSpec, W: number, H: number): MaskRaster {
  if (s.kind === "huge") return raster({ x: 0, y: 0, w: W, h: H });
  if (s.kind === "good") return raster(s.r);
  const data = new Uint8Array(s.r.w * s.r.h);
  data[0] = 1;
  return raster(s.r, data);
}

/** The fake ChainIO and a log of every call and every mask it returned. */
function fakeIO(s: Scenario) {
  const log = {
    noun: [] as string[], nounMasks: s.objs.map((): MaskRaster[] => []), good: new Set<MaskRaster>(),
    point: [] as PointObject[][], reply: null as PointReply | null, box: [] as PxBox[], boxMasks: [] as (MaskRaster[] | null)[],
  };
  const io: ChainIO = {
    async segment(p) {
      if (p.noun !== undefined) {
        log.noun.push(p.noun);
        const i = indexOf(p.noun), out = s.objs[i].noun;
        if (out === "error") throw new Error("502");
        log.nounMasks[i] = out.map((spec) => nounMask(spec, s.W, s.H));
        out.forEach((spec, k) => spec.kind === "good" && log.good.add(log.nounMasks[i][k]));
        return log.nounMasks[i];
      }
      const out = s.boxCalls[log.box.length] ?? [];
      log.box.push(p.box);
      const ms = out === "error" ? null : out.map((spec) => raster(spec.kind === "fit" ? p.box : spec.r));
      log.boxMasks.push(ms);
      if (!ms) throw new Error("502");
      return ms;
    },
    async point(objects) {
      log.point.push(objects);
      if (s.pointFails) throw new Error("502");
      const pairs = objects.flatMap((o, objIndex) => s.objs[indexOf(o.noun)].boxes.map(({ g, key }) => ({ key, objIndex, box: g })));
      log.reply = { boxes: pairs.sort((a, b) => a.key - b.key).map(({ objIndex, box }) => ({ objIndex, box })) };
      return log.reply;
    },
  };
  return { io, log };
}

/** Reference scaling of a 0–1000 grid box (x0 < x1 ≤ 1000, so no clamp is needed). */
const toPx = (g: GridBox, W: number, H: number): PxBox => {
  const x = Math.floor((g.x0 * W) / 1000), y = Math.floor((g.y0 * H) / 1000);
  return { x, y, w: Math.ceil((g.x1 * W) / 1000) - x, h: Math.ceil((g.y1 * H) / 1000) - y };
};
/** The box grown by 4 px per side, clamped to the image. */
const pad = (b: PxBox, W: number, H: number): PxBox => {
  const x = Math.max(0, b.x - 4), y = Math.max(0, b.y - 4);
  return { x, y, w: Math.min(W, b.x + b.w + 4) - x, h: Math.min(H, b.y + b.h + 4) - y };
};
/** bbox IoU ≥ 0.3 (Requirement 5.4), in integers. */
const iou30 = (a: PxBox, b: PxBox) => {
  const iw = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), ih = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const inter = Math.max(0, iw) * Math.max(0, ih);
  return 10 * inter >= 3 * (a.w * a.h + b.w * b.h - inter);
};
/** Requirement 5.13: a long side under MIN_SIDE px per 1024 px of the image's long side L. */
const tiny = (w: number, h: number, L: number) => Math.max(w, h) < (MIN_SIDE * L) / 1024;
/** Requirement 5.14: the raster cut to the bounding box of its set pixels, or null when none is set. */
function trimmed(m: MaskRaster): MaskRaster | null {
  const xs: number[] = [], ys: number[] = [];
  m.data.forEach((v, k) => v && (xs.push(k % m.width), ys.push(Math.floor(k / m.width))));
  if (!xs.length) return null;
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = m.data[(y0 + y) * m.width + x0 + x];
  return { data, width: w, height: h, left: m.left + x0, top: m.top + y0 };
}
/**
 * Requirements 5.5, 5.7, 5.13, 5.14: the threshold cut-out of a box, or null when the box or the cut-out is tiny:
 * thresholdMask of the crop padded by 4 px (the whole crop opaque if that has no opaque pixel), trimmed.
 */
function thresholdCut(work: WorkPixels, px: PxBox): MaskRaster | null {
  const L = Math.max(work.width, work.height);
  if (tiny(px.w, px.h, L)) return null;
  const r = pad(px, work.width, work.height), crop = new Uint8ClampedArray(4 * r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const from = 4 * ((r.y + y) * work.width + r.x);
    crop.set(work.data.subarray(from, from + 4 * r.w), 4 * y * r.w);
  }
  const m = thresholdMask(crop, r.w, r.h), t = trimmed(raster(r, m.includes(1) ? m : m.fill(1)));
  return t && !tiny(t.width, t.height, L) ? t : null;
}
/** The instance has exactly this raster as its bbox and mask. */
const same = (o: Instance, m: MaskRaster) => {
  const r = rectOf(m);
  return o.bbox.x === r.x && o.bbox.y === r.y && o.bbox.w === r.w && o.bbox.h === r.h && o.mask.every((v, k) => v === m.data[k]);
};

async function check(s: Scenario) {
  const { W, H } = s;
  const scene: SparkScene = {
    title: "Test", view: "side", isDrawing: true, safe: true,
    objects: s.objs.map((o, i) => ({ type: o.type, noun: nounOf(i), count: o.count, sky: o.sky })),
  };
  const work = { data: new Uint8ClampedArray(4 * W * H).fill(255), width: W, height: H };
  for (const r of s.dark) for (let y = r.y; y < r.y + r.h; y++) work.data.fill(0, 4 * (y * W + r.x), 4 * (y * W + r.x + r.w));
  const { io, log } = fakeIO(s);
  const { instances: out, notFound } = await buildInstances(scene, work, io);

  const painted = new Map<Uint8Array, Uint8Array>();
  const paint = (m: MaskRaster) => {
    let p = painted.get(m.data);
    if (!p) {
      p = new Uint8Array(W * H);
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x]) p[(m.top + y) * W + m.left + x] = 1;
      painted.set(m.data, p);
    }
    return p;
  };
  /** Requirement 4.5: pixel IoU > 0.5 with `a`, or ≥ 80% of c's area inside `a`. */
  const clashes = (c: MaskRaster, a: MaskRaster) => {
    const pc = paint(c), pa = paint(a);
    let inter = 0, ac = 0, aa = 0;
    for (let k = 0; k < pc.length; k++) { inter += pc[k] & pa[k]; ac += pc[k]; aa += pa[k]; }
    return 2 * inter > ac + aa - inter || 5 * inter >= 4 * ac;
  };

  // Every instance has exactly one cut-out: its own bbox-sized 0/1 mask and one source. Ids 0…n−1, n ≤ 30, grouped
  // in scene-object order, with its object's type, noun and sky.
  const n = out.length;
  expect(n).toBeLessThanOrEqual(MAX_INSTANCES);
  expect(out.map((o) => o.id)).toEqual([...Array(n).keys()]);
  expect(new Set(out.map((o) => o.mask)).size).toBe(n);
  out.forEach((o, k) => {
    expect(o.mask).toBeInstanceOf(Uint8Array);
    expect(o.mask.length).toBe(o.bbox.w * o.bbox.h);
    expect(o.mask.every((v) => v === 0 || v === 1)).toBe(true);
    expect(["sam-noun", "sam-box", "threshold"]).toContain(o.source);
    const { type, noun, sky } = scene.objects[o.objIndex];
    expect(o).toMatchObject({ type, noun, sky });
    if (k) expect(out[k - 1].objIndex).toBeLessThanOrEqual(o.objIndex);
  });
  // The 30 cap cuts the tail, so every object before the last instance's object is complete.
  const capped = n === MAX_INSTANCES, last = n ? out[n - 1].objIndex : -1;
  const complete = (i: number) => !capped || i < last;
  const of = (i: number) => out.filter((o) => o.objIndex === i);

  // sam-noun: one noun call per object. An object is sent to the single point call exactly when none of its
  // passing masks got through de-duplication; otherwise all its instances are its own passing noun masks.
  expect([...log.noun].sort()).toEqual(scene.objects.map((o) => o.noun).sort());
  expect(log.point.length).toBeLessThanOrEqual(1);
  const sent = (log.point[0] ?? []).map((o) => indexOf(o.noun));
  if (log.point.length) expect(sent.length).toBeGreaterThan(0);
  expect(log.point[0] ?? []).toEqual(sent.map((i) => ({ type: scene.objects[i].type, noun: nounOf(i), count: scene.objects[i].count })));
  sent.forEach((v, k) => k && expect(sent[k - 1]).toBeLessThan(v));
  scene.objects.forEach((obj, i) => {
    const good = log.nounMasks[i].filter((m) => log.good.has(m)), mine = of(i), missed = sent.includes(i);
    if (!good.length) expect(missed).toBe(true);
    if (missed) expect(mine.some((o) => o.source === "sam-noun")).toBe(false);
    else {
      for (const o of mine) {
        expect(o.source).toBe("sam-noun");
        const m = good.find((g) => g.data === o.mask);
        expect(m).toBeDefined();
        expect(o.bbox).toEqual(rectOf(m!));
      }
      expect(mine.length).toBeLessThanOrEqual(obj.count);
      if (complete(i)) expect(mine.length).toBeGreaterThan(0);
    }
    // Objects before i are complete here, so their accepted noun masks are all visible.
    if (!capped || i <= last) {
      const earlier = out.filter((o) => o.objIndex < i && o.source === "sam-noun").map(asRaster);
      expect(missed).toBe(good.every((m) => earlier.some((a) => clashes(m, a))));
    }
  });

  // sam-box: the reply's boxes in reply order, scaled; box SAM for the first MAX_BOX_CALLS of them, in that order.
  // A box's fits are its masks with bbox IoU ≥ 0.3 whose set pixels are not tiny, trimmed (5.4, 5.13, 5.14); `cut` is
  // its threshold cut-out, null when tiny. A box gives one instance (sam-box from a fit, else `cut`) or, when it gets
  // no sam-box and `cut` is null, none.
  const L = Math.max(W, H);
  const boxes = (log.reply?.boxes ?? []).map((b, k) => {
    const px = toPx(b.box, W, H);
    const fits = ((k < MAX_BOX_CALLS && log.boxMasks[k]) || []).filter((m) => iou30(rectOf(m), px))
      .map(trimmed).filter((t): t is MaskRaster => !!t && !tiny(t.width, t.height, L));
    return { k, objIndex: sent[b.objIndex], px, fits, cut: thresholdCut(work, px) };
  });
  expect(log.box).toEqual(boxes.slice(0, MAX_BOX_CALLS).map((b) => b.px));
  // Each sent object's instances come from its boxes in box order: a box that gives none must have no threshold
  // cut-out, and with nothing cut every later box of a complete object also gives none.
  const byBox = new Map<number, Instance>();
  for (const i of sent) {
    const mine = of(i), bs = boxes.filter((b) => b.objIndex === i);
    let p = 0;
    for (const o of mine) {
      const gives = (b: (typeof bs)[number]) =>
        o.source === "sam-box" ? b.fits.some((f) => same(o, f)) : o.source === "threshold" && !!b.cut && same(o, b.cut);
      for (; p < bs.length && !gives(bs[p]); p++) expect(bs[p].cut).toBeNull();
      expect(p).toBeLessThan(bs.length);
      byBox.set(bs[p++].k, o);
    }
    if (complete(i)) for (; p < bs.length; p++) expect(bs[p].cut).toBeNull();
  }
  // Not found: the sent objects left with no instance (no box, or every box dropped), in scene order.
  expect(notFound).toEqual(sent.filter((i) => notFound.includes(i)));
  if (!capped) expect(notFound).toEqual(sent.filter((i) => of(i).length === 0));
  for (const i of sent) {
    const bs = boxes.filter((b) => b.objIndex === i);
    if (bs.some((b) => b.cut)) expect(notFound).not.toContain(i);
    if (bs.every((b) => !b.cut && !b.fits.length)) expect(notFound).toContain(i);
  }
  scene.objects.forEach((_, i) => {
    const has = of(i).length > 0, nf = notFound.includes(i);
    expect(has && nf).toBe(false);
    if (!capped || i <= last) expect(has || nf).toBe(true);
  });
  // With nothing cut, every accepted mask is visible: a box is sam-box exactly when one of its fits clashes with no
  // noun mask and no earlier box's mask; otherwise it gives its threshold cut-out, or nothing when that is null.
  if (!capped) {
    const nounMasks = out.filter((o) => o.source === "sam-noun").map(asRaster);
    for (const { k, fits, cut } of boxes) {
      const o = byBox.get(k);
      const before = [...nounMasks, ...[...byBox].filter(([j, b]) => j < k && b.source === "sam-box").map(([, b]) => asRaster(b))];
      const free = fits.some((f) => !before.some((a) => clashes(f, a)));
      expect(o?.source === "sam-box").toBe(free);
      if (!free) expect(o === undefined).toBe(cut === null);
      if (o?.source === "sam-box") expect(before.some((a) => clashes(asRaster(o), a))).toBe(false);
    }
  }
}

describe("Feature: sketch-world, Property 2: Fallback chain gives exactly one cut-out in source order", () => {
  // **Validates: Requirements 4.6, 5.4, 5.5, 5.7, 5.8, 5.10, 5.11**
  it("gives every instance one mask whose source is the first stage that succeeded, for any mix of outcomes", async () => {
    await fc.assert(fc.asyncProperty(scenario, check), { numRuns: 500 });
  }, 120_000);
});
