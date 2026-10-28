// The cut-out chain (Requirements 4.1, 4.6, 5.1, 5.3–5.5, 5.7–5.12): SAM by noun → one point call for the
// objects SAM missed → SAM by box → threshold cut-out. All I/O goes through the injected ChainIO, so the chain
// runs in Node with a fake (tests) or against the Worker (src/cut/io.ts). A rejected call is a miss for its stage.
import type { PxBox, SparkScene } from "../../shared/scene";
import type { GridBox, PointObject, PointReply } from "../api";
import type { SegmentPrompt } from "../sam/client";
import type { MaskRaster } from "../sam/parse";
import { acceptBox, acceptNoun, assign, maskArea } from "./assign";
import { cropRgba, thresholdMask } from "./threshold";
import type { Candidate, Instance, Source } from "./types";

export const MAX_BOX_CALLS = 4;   // box SAM calls per world; later boxes go straight to the threshold cut-out
export const MAX_INSTANCES = 30;

export interface ChainIO {
  /** SAM masks on the Work_Image for a noun or a box (in Work_Image pixels), each raster at its own left/top. */
  segment(prompt: SegmentPrompt): Promise<MaskRaster[]>;
  /** Spark boxes for `objects`, as POST /api/point replies. */
  point(objects: PointObject[]): Promise<PointReply>;
}

export type WorkPixels = Pick<ImageData, "data" | "width" | "height">;

/** `instances` in scene object order with ids 0…n−1; `notFound` = scene indices with no accepted mask and no box. */
export type ChainResult = { instances: Instance[]; notFound: number[] };

export async function buildInstances(scene: SparkScene, work: WorkPixels, io: ChainIO): Promise<ChainResult> {
  const objs = scene.objects, { width: W, height: H } = work;
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
  // and is kept) and then one slot per box: a box keeps the largest mask that clashes with no earlier one.
  const slots = nouns.map((c, i) => ({ ...c, objIndex: i }));
  const kept = new Map(assign(
    [...slots, ...boxMasks.flatMap((ms, k) => ms.filter((m) => acceptBox(m, boxes[k].box)).map((m) => cand(slots.length + k, m)))],
    new Array(slots.length + boxes.length).fill(1),
  ).map((c) => [c.objIndex, c.mask]));

  // 4. threshold for every box without a kept SAM mask.
  const all = [
    ...nouns.map((c) => fromRaster(c.objIndex, c.mask, "sam-noun")),
    ...boxes.map(({ objIndex, box }, k) => {
      const m = kept.get(slots.length + k);
      if (m) return fromRaster(objIndex, m, "sam-box");
      const { data, rect } = cropRgba(work, box, 4);
      const mask = thresholdMask(data, rect.w, rect.h);
      if (!mask.includes(1)) mask.fill(1);   // nothing opaque: keep the whole crop (Requirement 5.7)
      return inst(objIndex, rect, mask, "threshold");
    }),
  ].sort((a, b) => a.objIndex - b.objIndex);   // stable: within an object, area order (noun) or box order

  return {
    instances: all.slice(0, MAX_INSTANCES).map((o, id) => ({ ...o, id })),
    notFound: missed.filter((i) => !boxes.some((b) => b.objIndex === i)),
  };
}

/** A 0–1000 grid box in w × h pixels, rounded outward and clamped to the image. */
function toPx(b: GridBox, w: number, h: number): PxBox {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x = clamp(Math.floor((b.x0 * w) / 1000), w), y = clamp(Math.floor((b.y0 * h) / 1000), h);
  return { x, y, w: clamp(Math.ceil((b.x1 * w) / 1000), w) - x, h: clamp(Math.ceil((b.y1 * h) / 1000), h) - y };
}
