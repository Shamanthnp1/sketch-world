// Paper photo → Work_Image (Requirements 1.3, 1.4). Pure RGBA buffers, so it runs in Node; ImageData fits Rgba.
import type { Rgba } from "../sam/cutout";
import { bilinear, type Quad } from "./quad";

/** Warps the quad to a w × h image (mean opposite side lengths, long side ≤ maxSide, never upscaled). */
export function flatten(src: Rgba, q: Quad, maxSide = 1024): Rgba {
  const len = (i: number, j: number) => Math.hypot(q[j].x - q[i].x, q[j].y - q[i].y);
  const a = (len(0, 1) + len(3, 2)) / 2, b = (len(1, 2) + len(0, 3)) / 2;
  const s = Math.min(1, maxSide / Math.max(a, b));
  const w = Math.max(1, Math.round(a * s)), h = Math.max(1, Math.round(b * s));
  const { data, width: W, height: H } = src, out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p = bilinear(q, (i + 0.5) / w, (j + 0.5) / h);
      // Bilinear sample between pixel centres; points off the photo take the nearest edge pixel.
      const fx = Math.min(W - 1, Math.max(0, p.x - 0.5)), fy = Math.min(H - 1, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const i00 = 4 * (y0 * W + x0), dx = x0 < W - 1 ? 4 : 0, dy = y0 < H - 1 ? 4 * W : 0;
      for (let c = 0, o = 4 * (j * w + i); c < 4; c++) {
        const top = data[i00 + c] * (1 - tx) + data[i00 + dx + c] * tx;
        const bot = data[i00 + dy + c] * (1 - tx) + data[i00 + dy + dx + c] * tx;
        out[o + c] = top * (1 - ty) + bot * ty;
      }
    }
  }
  return { data: out, width: w, height: h };
}

/** Maps luma percentile 2 to 0 and 98 to 255 with the same offset and gain on R, G and B; alpha is kept. */
export function autoLevel(img: Rgba): Rgba {
  const d = img.data, n = img.width * img.height, hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.round(0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2])]++;
  // Nearest rank: the value at index floor(p · (n − 1)) of the sorted lumas.
  const pct = (p: number) => {
    const k = Math.floor(p * (n - 1));
    for (let v = 0, c = 0; v < 256; v++) if ((c += hist[v]) > k) return v;
    return 255;
  };
  const lo = pct(0.02), hi = pct(0.98), out = new Uint8ClampedArray(d);
  if (hi > lo) {
    const g = 255 / (hi - lo);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = (d[i] - lo) * g;
      out[i + 1] = (d[i + 1] - lo) * g;
      out[i + 2] = (d[i + 2] - lo) * g;
    }
  }
  return { data: out, width: img.width, height: img.height };
}
