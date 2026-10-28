// Ground and sky colours (Requirements 9.6, 9.7; design.md "Browser components"). Pure, so they run in Node.
import type { WorkPixels } from "../cut/chain";
import type { Instance } from "../cut/types";

export const KRAFT = "#d6ccbb";    // DESIGN.md --kraft: the ground when no paper pixel is left to read
export const SKY_TOP = "#a9c7df";  // the gradient sky's zenith: a soft blue, the sky Muse Image is asked for

/** First row of the bottom 15% band: rows y ≥ floor(0.85 · h), so ceil(0.15 · h) rows and at least one. */
export const bandTop = (h: number) => Math.floor((85 * h) / 100);

/**
 * The ground colour: the per-channel median of the Work_Image pixels in the bottom 15% rows that no Instance mask
 * covers (masks are bbox-sized at bbox.x, bbox.y), as #rrggbb; KRAFT when every pixel there is masked. Per channel,
 * from 256-bin histograms: exact in O(n), and each channel ignores the sparse ink strokes and JPEG noise on its own.
 * The raw median, not tinted or clamped (design.md asks for neither): a white page gives a white ground.
 */
export function groundColour(work: WorkPixels, inst: readonly Pick<Instance, "bbox" | "mask">[]): string {
  const { data, width: w, height: h } = work, y0 = bandTop(h), covered = new Uint8Array(w * (h - y0));
  for (const { bbox: b, mask } of inst) {
    for (let y = Math.max(y0, b.y); y < Math.min(h, b.y + b.h); y++) {
      for (let x = Math.max(0, b.x); x < Math.min(w, b.x + b.w); x++) if (mask[(y - b.y) * b.w + x - b.x]) covered[(y - y0) * w + x] = 1;
    }
  }
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  for (let i = 0; i < covered.length; i++) {
    if (covered[i]) continue;
    const p = 4 * (y0 * w + i);
    for (let c = 0; c < 3; c++) hist[c][data[p + c]]++;
    n++;
  }
  return n ? hex(hist.map((hc) => median(hc, n))) : KRAFT;
}

/** The median of n values from their histogram; for an even n, the rounded mean of the two middle values. */
function median(hist: Uint32Array, n: number): number {
  const at = (k: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) if ((seen += hist[v]) > k) return v;
    return 255;
  };
  return Math.round((at((n - 1) >> 1) + at(n >> 1)) / 2);
}

/** The gradient sky for a ground colour: a light tint of it at the horizon (which the fog also takes) up to SKY_TOP. */
export function skyColours(ground: string): { horizon: string; top: string } {
  return { horizon: mix(ground, "#ffffff", 0.55), top: SKY_TOP };
}

/** a + (b − a) · t per channel, for #rrggbb colours. */
export function mix(a: string, b: string, t: number): string {
  const ca = rgb(a), cb = rgb(b);
  return hex(ca.map((v, i) => Math.round(v + (cb[i] - v) * t)));
}

/** The mean colour of RGBA pixels as #rrggbb (the panorama's horizon band, for the fog). */
export function meanColour(rgba: ArrayLike<number>): string {
  const sum = [0, 0, 0], n = Math.max(1, rgba.length >> 2);
  for (let i = 0; i < rgba.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += rgba[i + c];
  return hex(sum.map((s) => Math.round(s / n)));
}

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
