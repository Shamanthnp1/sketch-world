// The cut-out chain (Requirements 4.1, 4.6, 5.1, 5.3–5.5, 5.7–5.14): SAM by noun → one point call for the
// objects SAM missed → SAM by box → threshold cut-out. All I/O goes through the injected ChainIO, so the chain
// runs in Node with a fake (tests) or against the Worker (src/cut/io.ts). A rejected call is a miss for its stage.
// Box-stage cut-outs under MIN_SIDE are dropped (dots and specks, Requirement 5.13); noun masks have no size limit.
import type { PxBox, SparkScene } from "../../shared/scene";
import type { GridBox, PointObject, PointReply } from "../api";
import type { SegmentPrompt } from "../sam/client";
import type { MaskRaster } from "../sam/parse";
import { acceptBox, acceptNoun, assign, maskArea } from "./assign";
import { cropRgba, thresholdMask } from "./threshold";
import type { Candidate, Instance, Source } from "./types";

export const MAX_BOX_CALLS = 4;   // box SAM calls per world; later boxes go straight to the threshold cut-out
export const MAX_INSTANCES = 30;
// Long side, in px per 1024 px of the Work_Image's long side, under which a box cut-out is a dot or speck. Measured on
// the gate drawings (docs/gate.md, task 12): ms2's grass dots are 10–15 px, the smallest real objects (birds) 25 px.
export const MIN_SIDE = 20;

export interface ChainIO {
  /** SAM masks on the Work_Image for a noun or a box (in Work_Image pixels), each raster at its own left/top. */
  segment(prompt: SegmentPrompt): Promise<MaskRaster[]>;
  /** Spark boxes for `objects`, as POST /api/point replies. */
  point(objects: PointObject[]): Promise<PointReply>;
}

export type WorkPixels = Pick<ImageData, "data" | "width" | "height">;

/** `instances` in scene object order with ids 0…n−1; `notFound` = scene indices with no accepted mask and no kept box. */
export type ChainResult = { instances: Instance[]; notFound: number[] };

export async function buildInstances(scene: SparkScene, work: WorkPixels, io: ChainIO): Promise<ChainResult> {
  const objs = scene.objects, { width: W, height: H } = work, L = Math.max(W, H);
  const tiny = (w: number, h: number) => 1024 * Math.max(w, h) < MIN_SIDE * L;   // Requirement 5.13, in integers
  let nextId = 0;
  const cand = (objIndex: number, mask: MaskRaster): Candidate => ({ id: nextId++, objIndex, mask, area: maskArea(mask) });
  const inst = (objIndex: number, bbox: PxBox, mask: Uint8Array, source: Source): Instance =>
    ({ id: 0, objIndex, type: objs[objIndex].type, noun: objs[objIndex].noun, sky: objs[objIndex].sky, bbox, mask, source });
  const fromRaster = (objIndex: number, m: MaskRaster, source: Source) =>
    inst(objIndex, { x: m.left, y: m.top, w: m.width, h: m.height }, m.data, source);

  // 1. sam-noun: one request per object, all at once (SamClient keeps 3 in flight).
  const nounMasks = await Promise.all(objs.map((o) => io.segment({ noun: o.noun }).catch(() => [])));
  const nouns = assign(
    nounMasks.flatMap((ms, i) => ms.filter((m) => acceptNoun(m, objs[i].type, W, H)).map((m) => cand(i, m))),
    objs.map((o) => o.count),
  );

  // 2. One point call for the objects with no accepted noun mask. Reply indices refer to `missed`.
  const missed = objs.flatMap((_, i) => (nouns.some((c) => c.objIndex === i) ? [] : [i]));
  const reply = missed.length
    ? await io.point(missed.map((i) => ({ type: objs[i].type, noun: objs[i].noun, count: objs[i].count }))).catch(() => null)
    : null;
  const left = missed.map((i) => objs[i].count);
  const boxes = (reply?.boxes ?? [])
    .filter((b) => b.objIndex < left.length && left[b.objIndex]-- > 0)
    .map((b) => ({ objIndex: missed[b.objIndex], box: toPx(b.box, W, H) }));

  // 3. sam-box for the first MAX_BOX_CALLS boxes, in box order.
  const boxMasks = await Promise.all(
    boxes.map((b, k) => (k < MAX_BOX_CALLS ? io.segment({ box: b.box }).catch(() => []) : [])),
  );
  // assign again with one slot per accepted noun mask (in accepted order, so each passes the same checks as before
  // and is kept) and then one slot per box: a box keeps the largest mask that clashes with no earlier one. A box mask
  // competes trimmed to its set pixels (Requirement 5.14), and not at all when that is tiny (5.4, 5.13).
  const slots = nouns.map((c, i) => ({ ...c, objIndex: i }));
  const boxCands = boxMasks.flatMap((ms, k) => ms.flatMap((m) => {
    const t = acceptBox(m, boxes[k].box) ? trim(m) : null;
    return t && !tiny(t.width, t.height) ? [cand(slots.length + k, t)] : [];
  }));
  const kept = new Map(assign([...slots, ...boxCands], new Array(slots.length + boxes.length).fill(1))
    .map((c) => [c.objIndex, c.mask]));

  // 4. threshold for every box without a kept SAM mask, unless the box or its cut-out is tiny (Requirement 5.13).
  const all = [
    ...nouns.map((c) => fromRaster(c.objIndex, c.mask, "sam-noun")),
    ...boxes.flatMap(({ objIndex, box }, k) => {
      const m = kept.get(slots.length + k);
      if (m) return [fromRaster(objIndex, m, "sam-box")];
      if (tiny(box.w, box.h)) return [];   // a dot or speck: no threshold square, whatever the crop holds
      const { data, rect } = cropRgba(work, box, 4);
      const mask = thresholdMask(data, rect.w, rect.h);
      if (!mask.includes(1)) mask.fill(1);   // nothing opaque: keep the whole crop (Requirement 5.7)
      const t = trim({ data: mask, width: rect.w, height: rect.h, left: rect.x, top: rect.y });   // 5.14
      return t && !tiny(t.width, t.height) ? [fromRaster(objIndex, t, "threshold")] : [];
    }),
  ].sort((a, b) => a.objIndex - b.objIndex);   // stable: within an object, area order (noun) or box order

  return {
    instances: all.slice(0, MAX_INSTANCES).map((o, id) => ({ ...o, id })),
    notFound: missed.filter((i) => !all.some((o) => o.objIndex === i)),
  };
}

/** `m` cut to the bounding box of its set pixels (`m` itself when it has no empty margin), or null when none is set. */
function trim(m: MaskRaster): MaskRaster | null {
  const { data, width: w, height: h } = m;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return m;
  const tw = x1 - x0 + 1, th = y1 - y0 + 1, out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) out.set(data.subarray((y0 + y) * w + x0, (y0 + y) * w + x1 + 1), y * tw);
  return { data: out, width: tw, height: th, left: m.left + x0, top: m.top + y0 };
}

/** A 0–1000 grid box in w × h pixels, rounded outward and clamped to the image. */
function toPx(b: GridBox, w: number, h: number): PxBox {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x = clamp(Math.floor((b.x0 * w) / 1000), w), y = clamp(Math.floor((b.y0 * h) / 1000), h);
  return { x, y, w: clamp(Math.ceil((b.x1 * w) / 1000), w) - x, h: clamp(Math.ceil((b.y1 * h) / 1000), h) - y };
}
