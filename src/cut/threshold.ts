// Threshold cut-out for boxes SAM could not cut (Requirement 5.6).
import type { PxBox } from "../../shared/scene";

/** 1 = opaque. Transparent = light pixels (luma ≥ light) 4-connected to the crop border through light pixels. */
export function thresholdMask(rgba: Uint8ClampedArray, w: number, h: number, light = 200): Uint8Array {
  const keep = new Uint8Array(w * h).fill(1);
  const stack = new Int32Array(w * h); // each pixel is pushed at most once, so this never overflows
  let top = 0;
  const isLight = (i: number) => 0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2] >= light;
  const push = (i: number) => {
    if (keep[i] && isLight(i)) {
      keep[i] = 0;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (top) {
    const i = stack[--top], x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return keep;
}

/** RGBA pixels of `box` grown by `pad` px on each side and clamped to the image, plus the crop's rect in image pixels. */
export function cropRgba(
  img: { data: Uint8ClampedArray; width: number; height: number },
  box: PxBox,
  pad = 4,
): { data: Uint8ClampedArray; rect: PxBox } {
  const x0 = Math.max(0, Math.floor(box.x - pad)), y0 = Math.max(0, Math.floor(box.y - pad));
  const x1 = Math.max(x0, Math.min(img.width, Math.ceil(box.x + box.w + pad)));
  const y1 = Math.max(y0, Math.min(img.height, Math.ceil(box.y + box.h + pad)));
  const w = x1 - x0, h = y1 - y0, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = 4 * ((y0 + y) * img.width + x0);
    data.set(img.data.subarray(from, from + 4 * w), 4 * y * w);
  }
  return { data, rect: { x: x0, y: y0, w, h } };
}
