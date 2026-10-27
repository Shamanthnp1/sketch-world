// Work_Image encoding (Requirement 3.1): long side ≤ 1024 px, JPEG ≤ 400 KB. Copied from undo-manual
// analyzer/encode.ts without the cell-crop code. scaledSize and fitBytes are pure (tested in Node);
// the rest draws on an OffscreenCanvas.

export const WORK_MAX_PX = 1024;
export const IMAGE_MAX_BYTES = 400 * 1024;    // same cap as the Worker (worker/limits/input.ts)
const QUALITIES = [0.92, 0.85, 0.75, 0.65, 0.5, 0.35];

/** w × h scaled down (never up) so the longer side is ≤ maxPx, rounded, at least 1 px. */
export function scaledSize(w: number, h: number, maxPx: number): { w: number; h: number } {
  const s = Math.min(1, maxPx / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** First encode(step), in step order, that fits maxBytes. Steps are JPEG qualities by default. Throws if none fits. */
export async function fitBytes(
  encode: (step: number) => Promise<Blob>,
  maxBytes: number = IMAGE_MAX_BYTES,
  steps: readonly number[] = QUALITIES,
): Promise<Blob> {
  for (const step of steps) {
    const blob = await encode(step);
    if (blob.size <= maxBytes) return blob;
  }
  throw new Error(`Image does not fit in ${Math.round(maxBytes / 1024)} KB.`);
}

export function pixels(c: OffscreenCanvas): ImageData {
  return c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
}

/** JPEG ≤ 400 KB, lowering the quality until it fits. */
export function toJpeg(c: OffscreenCanvas): Promise<Blob> {
  return fitBytes((quality) => c.convertToBlob({ type: "image/jpeg", quality }));
}

/**
 * The Work_Image: `src` on white, scaled so the long side is ≤ 1024 px, plus its JPEG (≤ 400 KB).
 * Read pixels with pixels(canvas): they match the JPEG's size, so SAM masks line up with them.
 */
export async function workImage(src: ImageBitmap | ImageData): Promise<{ canvas: OffscreenCanvas; jpeg: Blob }> {
  let from: CanvasImageSource;
  if (src instanceof ImageBitmap) from = src;
  else {
    from = new OffscreenCanvas(src.width, src.height);
    from.getContext("2d")!.putImageData(src, 0, 0);
  }
  const { w, h } = scaledSize(src.width, src.height, WORK_MAX_PX);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";    // JPEG has no alpha: a transparent PNG drawing would otherwise turn black
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(from, 0, 0, w, h);
  return { canvas, jpeg: await toJpeg(canvas) };
}
