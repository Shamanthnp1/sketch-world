// Walking in the World_View (design.md "Browser components", "step", "foldAmount"; Requirements 7.4–7.6, 8.1):
// keys move and turn, a drag on the canvas looks, touch devices get hold-to-move and hold-to-turn buttons. Each
// frame's move is split into sub-steps of length ≤ 0.25 through `step`, and every upright Card's fold is raised
// with `foldAmount`. No three.js import: the camera comes from the World, so this module stays out of the 3D chunk.
import type { World } from "./build";
import { WORLD_BOUNDS, step, walkCircles } from "./collide";
import { foldAmount } from "./popup";
import type { Vec2 } from "./space";
import "./walk.css";

export const SPEED = 3;                   // units per second
export const TURN = (120 * Math.PI) / 180; // radians per second, keys and turn buttons
export const LOOK = 0.005;                // radians per dragged CSS pixel
export const PITCH_MIN = (-30 * Math.PI) / 180, PITCH_MAX = (60 * Math.PI) / 180; // sky Cards sit at 10°–60°
export const MAX_STEP = 0.25;             // `step`'s precondition |d| ≤ 0.25

export type Intent = "forward" | "back" | "left" | "right" | "turnLeft" | "turnRight";
export type View = { yaw: number; pitch: number }; // yaw 0 faces −z, positive turns left; pitch positive looks up

// By physical key (e.code), so WASD sits in the same place on every keyboard layout. A/D strafe, ←/→ turn.
const KEYS = new Map<string, Intent>([
  ["KeyW", "forward"], ["ArrowUp", "forward"], ["KeyS", "back"], ["ArrowDown", "back"],
  ["KeyA", "left"], ["KeyD", "right"], ["ArrowLeft", "turnLeft"], ["ArrowRight", "turnRight"],
]);
export const keyIntent = (code: string): Intent | undefined => KEYS.get(code);

/** One frame's ground move of length `dist` from the held intents at `yaw`; diagonals are not faster. */
export function walkDelta(held: ReadonlySet<Intent>, yaw: number, dist: number): Vec2 {
  const f = +held.has("forward") - +held.has("back"), s = +held.has("right") - +held.has("left"), len = Math.hypot(f, s);
  if (!len) return { x: 0, z: 0 };
  const k = dist / len, sin = Math.sin(yaw), cos = Math.cos(yaw);
  return { x: (s * cos - f * sin) * k, z: (-f * cos - s * sin) * k };
}

/** +1 turning left, −1 right, 0 none or both. */
export const turnDir = (held: ReadonlySet<Intent>) => +held.has("turnLeft") - +held.has("turnRight");

/** n equal steps of length ≤ max that sum to d (one zero step for d = 0). */
export function substeps(d: Vec2, max = MAX_STEP): Vec2[] {
  const n = Math.max(1, Math.ceil(Math.hypot(d.x, d.z) / max));
  return Array.from({ length: n }, () => ({ x: d.x / n, z: d.z / n }));
}

/** Drag look, grabbing the world: dragging right turns left, dragging down looks up; pitch clamped to −30°…60°. */
export function look(v: View, dx: number, dy: number): View {
  return { yaw: v.yaw + dx * LOOK, pitch: Math.min(PITCH_MAX, Math.max(PITCH_MIN, v.pitch + dy * LOOK)) };
}

/** Distance on the ground plane, for the fold. */
export const groundDist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

export interface WalkOptions {
  /** Asked on pointerdown and on every move of a look drag; false leaves that pointer alone (6.12: Card drags). */
  canLook?: (e: PointerEvent) => boolean;
}
export interface Walk { player(): Vec2; dispose(): void }

const PAD: readonly [Intent, string, string][] = [
  ["forward", "Move forward", "↑"], ["back", "Move back", "↓"], ["turnLeft", "Turn left", "↺"], ["turnRight", "Turn right", "↻"],
];

/** Walks `world` from its camera's position; keys work while focus is inside `host` (made focusable if it isn't). */
export function attachWalk(world: World, host: HTMLElement, opts: WalkOptions = {}): Walk {
  const { camera } = world, canvas = world.renderer.domElement, canLook = opts.canLook ?? (() => true);
  const eye = camera.position.y;
  let p: Vec2 = { x: camera.position.x, z: camera.position.z }, view: View = { yaw: camera.rotation.y, pitch: camera.rotation.x };
  camera.rotation.order = "YXZ"; // yaw about world y, then pitch
  const holds = new Map<string, Intent>(); // key code or "p<pointerId>" of a held touch button → intent
  const ownTab = !host.hasAttribute("tabindex");
  if (ownTab) host.tabIndex = 0;

  const off = world.onFrame((_t, dt) => {
    const held = new Set(holds.values());
    view = { yaw: view.yaw + turnDir(held) * TURN * dt, pitch: view.pitch };
    const d = walkDelta(held, view.yaw, SPEED * dt);
    if (d.x || d.z) {
      // Circles at each Card's current home, so a Card moved by a drag (6.12) moves its circle with it.
      const circles = walkCircles(world.cards.map((c) => ({
        kind: c.kind, type: c.type, collide: c.placed.collide && { ...c.placed.collide, x: c.pos.x, z: c.pos.z },
      })));
      for (const s of substeps(d)) p = step(p, s, circles, WORLD_BOUNDS);
    }
    for (const c of world.cards) if (c.kind === "upright") c.fold = foldAmount(c.fold, groundDist(p, c.pos), world.reducedMotion);
    camera.position.set(p.x, eye, p.z);
    camera.rotation.set(view.pitch, view.yaw, 0);
  });

  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.matches("input, textarea, select"));
  const onKeyDown = (e: KeyboardEvent) => {
    const intent = keyIntent(e.code);
    // defaultPrevented: a control inside the world (6.12's Objects panel) already used the key.
    if (!intent || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
    e.preventDefault(); // no page scroll on arrows
    holds.set(e.code, intent);
  };
  const onKeyUp = (e: KeyboardEvent) => { holds.delete(e.code); };
  const clear = () => holds.clear();
  const onFocusOut = (e: FocusEvent) => { if (!host.contains(e.relatedTarget as Node | null)) clear(); };

  let lookId: number | null = null, lx = 0, ly = 0;
  const onDown = (e: PointerEvent) => {
    if (lookId !== null || (e.pointerType === "mouse" && e.button !== 0) || !canLook(e)) return;
    lookId = e.pointerId;
    lx = e.clientX;
    ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== lookId) return;
    if (canLook(e)) view = look(view, e.clientX - lx, e.clientY - ly);
    lx = e.clientX;
    ly = e.clientY;
  };
  const onEnd = (e: PointerEvent) => { if (e.pointerId === lookId) lookId = null; };

  // Touch buttons: press and hold (pointer events, so a held finger keeps moving), shown on coarse pointers by walk.css.
  const pad = Object.assign(document.createElement("div"), { className: "walk-pad" });
  const groups = [Object.assign(document.createElement("div"), { className: "walk-move" }),
    Object.assign(document.createElement("div"), { className: "walk-turn" })];
  for (const [intent, name, glyph] of PAD) {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: glyph });
    b.setAttribute("aria-label", name);
    b.addEventListener("pointerdown", (e) => {
      b.setPointerCapture(e.pointerId);
      holds.set(`p${e.pointerId}`, intent);
      b.classList.add("held");
    });
    const up = (e: PointerEvent) => { holds.delete(`p${e.pointerId}`); b.classList.remove("held"); };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) b.addEventListener(type, up);
    b.addEventListener("contextmenu", (e) => e.preventDefault()); // long-press menu on touch
    groups[intent.startsWith("turn") ? 1 : 0].append(b);
  }
  pad.append(...groups);
  host.append(pad);

  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);
  host.addEventListener("focusout", onFocusOut);
  window.addEventListener("blur", clear);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) canvas.addEventListener(type, onEnd);

  return {
    player: () => ({ ...p }),
    dispose() {
      off();
      holds.clear();
      pad.remove();
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("keyup", onKeyUp);
      host.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("blur", clear);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) canvas.removeEventListener(type, onEnd);
      if (ownTab) host.removeAttribute("tabindex");
    },
  };
}
