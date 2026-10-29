// Adapted from undo-manual (same author, built during the event).
// Corner clicks (Requirements 1.1, 1.2, 1.6, 1.7). Shows the paper photo, takes 4 taps (the paper's top-left corner as
// seen in the photo, then clockwise) as numbered markers, checks them and resolves with the corners in photo px.
// Taps arrive as `click`, which browsers fire for mouse, pen and touch taps but not for pans or pinch-zooms, so a
// phone user can zoom in to place a corner. Nothing here touches the network: the raw photo stays in the browser.
import { validateQuad, type Pt, type Quad } from "../paper/quad";
import "./corners.css";

type Rect = { left: number; top: number; width: number; height: number };
type Check = { ok: true } | { ok: false; reason: string };

const AREA_PCT = [15, 80] as const; // requirements.md Notes: the copied area check, % of the photo
// Use the whole photo (Requirement 1.7): a screenshot or drawing-app image may have any shape up to 4 : 1 (32:9 screens
// are 3.56 : 1), so the Work_Image's short side stays ≥ 256 px once the long side is cut to 1024; and ≥ 64 px a side,
// since the Work_Image is never upscaled and Spark and SAM need pixels to read.
const WHOLE_MAX_ASPECT = 4;
const WHOLE_MIN_PX = 64;
const SHOW_MAX = 2048;               // long side of the on-screen copy; taps map to the full photo
const STEPS = [
  "Tap the paper’s top-left corner.",
  "Now tap the top-right corner.",
  "Now tap the bottom-right corner.",
  "Last, tap the bottom-left corner.",
];
const DONE = "Check that the outline follows the paper’s edges, then choose Use these corners.";

/** A tap at (clientX, clientY) on an element with box `r` that shows a w × h photo, in photo px, clamped to the photo. */
export function toPhotoPx(clientX: number, clientY: number, r: Rect, w: number, h: number): Pt {
  const x = ((clientX - r.left) * w) / r.width, y = ((clientY - r.top) * h) / r.height;
  return { x: Math.min(w, Math.max(0, x)), y: Math.min(h, Math.max(0, y)) };
}

/** The photo's own corners in the same order, for a photo that shows only the paper. */
export function wholePhoto(w: number, h: number): Quad {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}

/**
 * Use the whole photo on a w × h picture: any aspect up to 4 : 1 either way and at least 64 px a side. The paper shape
 * and area checks of checkCorners are for tapped corners only: a whole picture is the drawing itself, not a paper sheet.
 */
export function checkWhole(w: number, h: number): Check {
  const short = Math.min(w, h), aspect = Math.max(w, h) / short;
  if (short < WHOLE_MIN_PX) {
    return { ok: false, reason: `Too small: the picture is ${w} × ${h} px (needs at least ${WHOLE_MIN_PX} px on each side). Try a larger picture.` };
  }
  if (aspect > WHOLE_MAX_ASPECT) {
    return {
      ok: false,
      reason: `Too ${w > h ? "wide" : "tall"}: the picture is ${aspect.toFixed(2)} : 1 (the whole picture can be up to ${WHOLE_MAX_ASPECT} : 1). Tap the corners of the part you want instead.`,
    };
  }
  return { ok: true };
}

/** Tapped corners: validateQuad (convex, clockwise, aspect 1.0–1.8), then an area of 15–80% of the w × h photo. */
export function checkCorners(q: Quad, w: number, h: number): Check {
  const shape = validateQuad(q);
  if (!shape.ok) return shape;
  const area = q.reduce((s, a, i) => s + a.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * a.y, 0) / 2;
  const pct = (100 * area) / (w * h), [lo, hi] = AREA_PCT, fills = `the paper fills ${Math.round(pct)}% of the photo`;
  if (pct < lo) return { ok: false, reason: `Too small: ${fills} (needs ${lo}–${hi}%). Tap the paper’s own corners.` };
  if (pct > hi) {
    return { ok: false, reason: `Too large: ${fills} (needs ${lo}–${hi}%). If the paper fills the photo, choose Use the whole photo.` };
  }
  return { ok: true };
}

/**
 * Shows `photo` in `host` and resolves with the 4 paper corners in the photo's own px (top-left as seen in the photo,
 * then clockwise), or null on Cancel. Removes its UI when it resolves. An HTMLImageElement must already be loaded.
 */
export function pickCorners(host: HTMLElement, photo: ImageBitmap | HTMLImageElement | HTMLCanvasElement): Promise<Quad | null> {
  const img = photo instanceof HTMLImageElement;
  const w = img ? photo.naturalWidth : photo.width, h = img ? photo.naturalHeight : photo.height;
  if (!w || !h) return Promise.reject(new Error("The photo has no pixels to show."));

  const root = document.createElement("section");
  root.className = "corners";
  root.innerHTML = `<h2 tabindex="-1">Mark the paper’s corners</h2>
    <p class="meta">Start at the top-left corner as you see it in the photo, then go clockwise. The photo stays on this device.</p>
    <p class="error" role="alert" hidden></p>
    <p class="corners-prompt" aria-live="polite"></p>
    <div class="corners-stage">
      <canvas role="img" aria-label="Your photo. Tap the 4 corners of the paper on it."></canvas>
      <svg aria-hidden="true" focusable="false" preserveAspectRatio="none">
        <polyline class="corners-line halo"></polyline><polyline class="corners-line ink"></polyline>
      </svg>
      <div class="corners-marks" aria-hidden="true"></div>
    </div>
    <div class="actions">
      <button type="button" class="primary" data-a="use" hidden>Use these corners</button>
      <button type="button" data-a="undo" hidden>Undo last corner</button>
      <button type="button" data-a="reset" hidden>Start again</button>
      <button type="button" data-a="whole">Use the whole photo</button>
      <button type="button" data-a="cancel">Cancel</button>
    </div>`;
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const button = (a: string) => $<HTMLButtonElement>(`[data-a="${a}"]`);
  const prompt = $<HTMLParagraphElement>(".corners-prompt"), err = $<HTMLParagraphElement>(".error");
  const hint = $<HTMLParagraphElement>(".meta");
  const stage = $<HTMLDivElement>(".corners-stage"), canvas = $<HTMLCanvasElement>("canvas");
  const marks = $<HTMLDivElement>(".corners-marks"), lines = root.querySelectorAll("polyline");
  const use = button("use"), undo = button("undo"), reset = button("reset");

  // The on-screen copy is drawn once; the stage keeps the photo's shape in CSS, and markers sit at % positions.
  const k = Math.min(1, SHOW_MAX / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  canvas.getContext("2d")!.drawImage(photo, 0, 0, canvas.width, canvas.height);
  stage.style.setProperty("--ar", String(w / h));
  $("svg").setAttribute("viewBox", `0 0 ${w} ${h}`);

  let pts: Pt[] = []; // photo px; holds 4 points only once they passed checkCorners
  // The error takes the hint's place (about the same height), so the photo doesn't jump under the next taps.
  const showError = (text: string) => { err.textContent = text; err.hidden = !text; hint.hidden = !!text; };
  const render = () => {
    const full = pts.length === 4;
    prompt.textContent = full ? DONE : STEPS[pts.length];
    marks.replaceChildren(...pts.map((p, i) => {
      const m = document.createElement("span"), tag = document.createElement("span");
      m.className = "corner-mark";
      m.dataset.i = String(i);
      m.style.left = `${(100 * p.x) / w}%`;
      m.style.top = `${(100 * p.y) / h}%`;
      tag.textContent = String(i + 1);
      m.append(tag);
      return m;
    }));
    const path = (full ? [...pts, pts[0]] : pts).map((p) => `${p.x},${p.y}`).join(" ");
    for (const l of lines) l.setAttribute("points", path);
    use.hidden = !full;
    undo.hidden = reset.hidden = !pts.length;
  };

  canvas.addEventListener("click", (e) => {
    if (pts.length === 4) return;
    pts.push(toPhotoPx(e.clientX, e.clientY, canvas.getBoundingClientRect(), w, h));
    if (pts.length === 4) {
      const r = checkCorners(pts as Quad, w, h);
      showError(r.ok ? "" : r.reason); // stays up during the next try
      if (!r.ok) pts = [];
    }
    render();
  });
  undo.addEventListener("click", () => { pts.pop(); render(); });
  reset.addEventListener("click", () => { pts = []; showError(""); render(); });

  render();
  host.append(root);
  $<HTMLHeadingElement>("h2").focus({ preventScroll: true }); // tells screen readers where they are
  root.scrollIntoView({ block: "start" }); // the stage is sized to fit the screen from here

  return new Promise((resolve) => {
    const finish = (q: Quad | null) => { root.remove(); resolve(q); };
    use.addEventListener("click", () => finish(pts.slice() as Quad));
    button("cancel").addEventListener("click", () => finish(null));
    // The keyboard path: no tapping needed. A screenshot or an MS Paint image is the drawing itself and may be wide
    // (the gate's ms1.png is 2.82 : 1), so only checkWhole's limits apply, not the paper sheet's shape and area.
    button("whole").addEventListener("click", () => {
      const r = checkWhole(w, h);
      if (r.ok) finish(wholePhoto(w, h));
      else showError(r.reason);
    });
  });
}
