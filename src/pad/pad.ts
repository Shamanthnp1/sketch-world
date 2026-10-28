// Drawing_Pad (Requirement 2): a 1024 × 768 canvas, black strokes on white, brush widths 4, 10 and 22 px, undo,
// clear and a PNG export. StrokeModel and toCanvas are pure (tested in Node); createPad adds the tools, the canvas
// renderer and the pointer wiring for mouse, pen and touch.
import "./pad.css";

export const PAD_W = 1024;
export const PAD_H = 768;
export const WIDTHS = [4, 10, 22] as const;
export type Width = (typeof WIDTHS)[number];
export interface Pt { x: number; y: number }
export interface Stroke { width: Width; pts: Pt[] }
export interface Pad { undo(): void; clear(): void; isEmpty(): boolean; exportPng(): Promise<Blob> }

/** Strokes in drawing order. Only the stroke being drawn takes new points. */
export class StrokeModel {
  strokes: Stroke[] = [];
  private live: Stroke | null = null;
  private cleared: Stroke[] = [];    // what the last clear removed, so an accidental Clear can be undone

  start(p: Pt, width: Width): Stroke {
    this.cleared = [];
    this.live = { width, pts: [p] };
    this.strokes.push(this.live);
    return this.live;
  }
  /** Adds p to the stroke being drawn and returns it, or null if no stroke is being drawn. */
  add(p: Pt): Stroke | null {
    this.live?.pts.push(p);
    return this.live;
  }
  end(): void { this.live = null; }
  /** Removes the most recent stroke; right after a clear, brings the cleared drawing back. */
  undo(): void {
    this.live = null;
    if (this.strokes.length) this.strokes.pop();
    else [this.strokes, this.cleared] = [this.cleared, []];
  }
  clear(): void {
    this.live = null;
    if (this.strokes.length) [this.cleared, this.strokes] = [this.strokes, []];
  }
}

/** Client (CSS px) coordinates → canvas px, for the canvas shown scaled to `rect`. Not clamped: strokes run off the edge. */
export function toCanvas(clientX: number, clientY: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">): Pt {
  return { x: ((clientX - rect.left) * PAD_W) / rect.width, y: ((clientY - rect.top) * PAD_H) / rect.height };
}

/** Paints s from point index `from` on (0 = the whole stroke). A one-point stroke is a dot. */
function paint(ctx: CanvasRenderingContext2D, s: Stroke, from = 0): void {
  const { pts, width } = s;
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, 2 * Math.PI);    // zero-length lines draw nothing in some browsers
    ctx.fill();
    return;
  }
  ctx.lineWidth = width;
  const a = pts[Math.max(0, from - 1)];
  ctx.moveTo(a.x, a.y);
  for (let i = Math.max(1, from); i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/** Appends the pad (width picker, Undo, Clear and the canvas) to `host`. */
export function createPad(host: HTMLElement): Pad {
  const root = document.createElement("div");
  root.className = "pad";
  root.innerHTML = `
    <div class="actions">
      <div class="pad-widths" role="group" aria-label="Brush width">
        <button type="button" data-w="4" aria-pressed="false">Thin</button>
        <button type="button" data-w="10" aria-pressed="true">Medium</button>
        <button type="button" data-w="22" aria-pressed="false">Thick</button>
      </div>
      <button type="button" class="pad-undo">Undo</button>
      <button type="button" class="pad-clear">Clear</button>
    </div>
    <canvas class="pad-canvas" width="${PAD_W}" height="${PAD_H}" role="img" aria-label="Drawing pad"></canvas>`;
  host.append(root);

  const canvas = root.querySelector("canvas")!;
  const ctx = canvas.getContext("2d")!;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000";
  const model = new StrokeModel();
  let width: Width = 10;
  const redraw = () => {
    ctx.fillStyle = "#fff";    // painted into the bitmap, so the PNG is white, not transparent
    ctx.fillRect(0, 0, PAD_W, PAD_H);
    ctx.fillStyle = "#000";
    for (const s of model.strokes) paint(ctx, s);
  };
  redraw();

  // One stroke at a time: other fingers and pointers are ignored while a stroke is being drawn.
  let pointer: number | null = null;
  const at = (e: PointerEvent) => toCanvas(e.clientX, e.clientY, canvas.getBoundingClientRect());
  canvas.addEventListener("pointerdown", (e) => {
    if (pointer !== null || e.button !== 0) return;    // left button, pen tip or touch only
    e.preventDefault();    // no text selection or compatibility mouse events while drawing
    pointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);    // keep the stroke when the pointer leaves the canvas
    paint(ctx, model.start(at(e), width));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointer) return;
    const s = model.add(at(e));
    if (s) paint(ctx, s, s.pts.length - 1);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    model.end();
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) canvas.addEventListener(type, end);

  const pad: Pad = {
    undo() { model.undo(); redraw(); },
    clear() { model.clear(); redraw(); },
    isEmpty: () => !model.strokes.length,
    exportPng: () => new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not export the drawing."))), "image/png")),
  };

  const widthButtons = root.querySelectorAll<HTMLButtonElement>("[data-w]");
  for (const b of widthButtons) b.addEventListener("click", () => {
    width = Number(b.dataset.w) as Width;
    for (const o of widthButtons) o.ariaPressed = String(o === b);
  });
  root.querySelector(".pad-undo")!.addEventListener("click", () => pad.undo());
  root.querySelector(".pad-clear")!.addEventListener("click", () => pad.clear());
  return pad;
}
