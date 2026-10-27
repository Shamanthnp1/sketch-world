// Cut-out PNGs, copied from undo-manual: the image with alpha = mask, trimmed to the mask, long side ≤ 512 px
// and ≤ 200 KB (the R2 cut/<n>.png cap). trimToMask is the pure pixel step (runs in Node); cutout is the canvas wrapper.
import { fitBytes, scaledSize } from "../image/encode";

export const CUTOUT_MAX_BYTES = 200 * 1024;
// PNG size depends on content, so a busy cut-out may need a smaller size. 216 px always fits:
// raw 216 × 216 RGBA plus row filter bytes is ≈ 187 000 bytes, and deflate adds only a few bytes per 64 KB.
const CUTOUT_SIDES = [512, 384, 288, 216];

export type Rgba = { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number };

/** RGBA of a w × h image trimmed to the mask's bounding box; masked-out pixels become transparent black. Null if the mask is empty. */
export function trimToMask(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number): Rgba | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  const width = x1 - x0 + 1, height = y1 - y0 + 1, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y0 + y) * w + x0 + x;
      if (mask[i]) data.set(rgba.subarray(4 * i, 4 * i + 4), 4 * (y * width + x));
    }
  }
  return { data, width, height };
}

/** PNG cut-out of `img` (same w × h as `mask`): long side ≤ 512 px, shrunk further until ≤ 200 KB. Throws on an empty mask. */
export async function cutout(img: ImageData, mask: Uint8Array): Promise<Blob> {
  const t = trimToMask(img.data, mask, img.width, img.height);
  if (!t) throw new Error("Cut-out mask is empty.");
  const src = new OffscreenCanvas(t.width, t.height);
  src.getContext("2d")!.putImageData(new ImageData(t.data, t.width, t.height), 0, 0);
  return fitBytes((maxPx) => {
    const { w, h } = scaledSize(t.width, t.height, maxPx);
    if (w === t.width && h === t.height) return src.convertToBlob({ type: "image/png" });
    const dst = new OffscreenCanvas(w, h);
    const ctx = dst.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    return dst.convertToBlob({ type: "image/png" });
  }, CUTOUT_MAX_BYTES, CUTOUT_SIDES);
}
