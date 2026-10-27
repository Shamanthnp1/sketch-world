// SAM mask placement, copied from undo-manual (placeMask only). Masks are 0/1 Uint8Arrays, row-major, w × h.
import type { MaskRaster } from "./parse";

/** A SAM raster (its own box at left, top) placed into a w × h image-sized mask; pixels outside the image are dropped. */
export function placeMask(m: MaskRaster, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = Math.max(0, -m.top); y < m.height && m.top + y < h; y++) {
    for (let x = Math.max(0, -m.left); x < m.width && m.left + x < w; x++) {
      out[(m.top + y) * w + m.left + x] = m.data[y * m.width + x];
    }
  }
  return out;
}
