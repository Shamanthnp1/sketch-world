// Mask acceptance and de-duplication for the cut-out chain (Requirements 4.3, 4.4, 4.5, 5.4).
// A mask's own bbox is its raster (width × height at left, top): SAM returns each raster cropped to its box.
// Ratios are compared as integer products (20·area ≥ box is area ≥ 5% of box) so the boundaries are exact.
import { group, type ObjType, type PxBox } from "../../shared/scene";
import type { MaskRaster } from "../sam/parse";
import type { Candidate } from "./types";

/** Number of set pixels. */
export const maskArea = (m: MaskRaster) => m.data.reduce((n, v) => n + v, 0);

/** Requirement 4.3: area ≥ 5% of its own bbox, and the bbox covers ≤ 60% of the image (≤ 90% for flat and terrain). */
export function acceptNoun(m: MaskRaster, type: ObjType, imgW: number, imgH: number): boolean {
  const box = m.width * m.height, g = group(type);
  return box > 0 && 20 * maskArea(m) >= box && 10 * box <= (g === "flat" || g === "terrain" ? 9 : 6) * imgW * imgH;
}

/** Requirement 5.4: a box mask is accepted when its bbox has IoU ≥ 0.3 with the Spark box (both in image pixels). */
export function acceptBox(m: MaskRaster, box: PxBox): boolean {
  const iw = Math.min(m.left + m.width, box.x + box.w) - Math.max(m.left, box.x);
  const ih = Math.min(m.top + m.height, box.y + box.h) - Math.max(m.top, box.y);
  const inter = Math.max(0, iw) * Math.max(0, ih);
  return inter > 0 && 10 * inter >= 3 * (m.width * m.height + box.w * box.h - inter);
}

/** Pixels set in both masks, counted over the overlap of their rasters only (no image-sized arrays). */
function overlap(a: MaskRaster, b: MaskRaster): number {
  const x0 = Math.max(a.left, b.left), x1 = Math.min(a.left + a.width, b.left + b.width);
  const y0 = Math.max(a.top, b.top), y1 = Math.min(a.top + a.height, b.top + b.height);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const ra = (y - a.top) * a.width - a.left, rb = (y - b.top) * b.width - b.left;
    for (let x = x0; x < x1; x++) n += a.data[ra + x] & b.data[rb + x];
  }
  return n;
}

/**
 * Requirements 4.4, 4.5: walks the candidates sorted by (object order, area desc, id) and accepts one when its
 * object has fewer than `counts[objIndex]` accepted masks, its pixel IoU with every accepted mask is ≤ 0.5, and
 * < 80% of its area lies inside any accepted mask. Returns the accepted candidates in that order, each once.
 */
export function assign(candidates: readonly Candidate[], counts: readonly number[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => a.objIndex - b.objIndex || b.area - a.area || a.id - b.id);
  const left = [...counts], accepted: Candidate[] = [];
  for (const c of sorted) {
    if (!(left[c.objIndex] > 0)) continue;
    const clash = accepted.some((a) => {
      const inter = overlap(c.mask, a.mask);
      return 2 * inter > c.area + a.area - inter || 5 * inter >= 4 * c.area; // IoU > 0.5, or ≥ 80% of c inside a
    });
    if (clash) continue;
    accepted.push(c);
    left[c.objIndex]--;
  }
  return accepted;
}
