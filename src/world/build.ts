// The three.js World_View: paper Cards at their layout positions, one requestAnimationFrame loop for motion and
// effects, tap → label + bounce, and moving Cards by drag (design.md "Browser components", "motion", "placeDrag",
// Requirements 7.1–7.3, 8.2, 8.3, 12.4, 14.1, 14.8, 15.1–15.11). Load it only through open.ts (dynamic import), so
// three.js stays out of the first page load. Walking (walk.ts), the HUD (ui/hud.ts) and the sky backdrop (8.2) plug in
// through World.
import {
  CanvasTexture, Color, DoubleSide, Fog, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, RingGeometry,
  Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from "three";
import type { ObjType } from "../../shared/scene";
import type { WorkPixels } from "../cut/chain";
import { cropRgba } from "../cut/threshold";
import type { Instance } from "../cut/types";
import { scaledSize } from "../image/encode";
import { trimToMask } from "../sam/cutout";
import { motion } from "./animate";
import { SPAWN, WORLD_BOUNDS, walkCircles } from "./collide";
import { placeDrag } from "./drag";
import { layout, type Placed } from "./layout";
import { foldAmount } from "./popup";
import { SKY_R, type Vec3 } from "./space";
import "./world.css";

export const EYE = 1.7;              // camera height
const PAPER = "#e7e2d8", KRAFT = "#d6ccbb", ACCENT = "255 197 51", SHADOW = "52 40 22"; // DESIGN.md tokens
const ACCENT_HEX = 0xffc533, INK_HEX = 0x172331, WHITE = 0xffffff;
const TEX_MAX = 512;                 // cut-out texture long side (design.md "Performance")
const BORDER_PX = 4;                 // white paper edge, in Work_Image pixels
const LABEL_MS = 2500;
const LIFT_H = 0.25, SKY_LIFT = 0.08; // a dragged Card rises this much (sky Cards grow by 8% instead)
const LIFT_RATE = 14;                // per second: how fast the lift eases in and out
const RESUME_S = 0.6;                // motion fades back in over this after a drop or Pause motion, so Cards don't jump
const SHADOW_GROW = 0.35;            // a lifted Card's shadow is this much larger (and lighter)

// Pointer presses (Requirements 15.1–15.4).
export const DRAG_PX = 4;            // mouse and pen: a press on a Card that moves further drags it; any press within it is a tap
export const HOLD_MS = 350;          // touch: holding a Card this long picks it up…
export const HOLD_PX = 8;            // …unless the finger moved further first, which makes it a look
export type Press = "wait" | "look" | "drag";

/**
 * What a press is now. It starts as "wait" on a movable Card and as "look" anywhere else. Mouse and pen: moving more
 * than 4 px drags the Card. Touch: held 350 ms within 8 px picks the Card up; moving further first looks instead.
 * "look" and "drag" are final, so a look never becomes a drag and a drag never becomes a look.
 */
export function pressState(s: Press, touch: boolean, movedPx: number, heldMs: number): Press {
  if (s !== "wait") return s;
  if (!touch) return movedPx > DRAG_PX ? "drag" : "wait";
  return movedPx > HOLD_PX ? "look" : heldMs >= HOLD_MS ? "drag" : "wait";
}

// Drag surfaces (Requirement 15.6), on plain vectors so they test without WebGL. NaN means "no hit": placeDrag keeps `from`.
const NO_HIT: Vec3 = { x: NaN, y: NaN, z: NaN };
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }, UP: Vec3 = { x: 0, y: 1, z: 0 };
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const finite = (p: Vec3) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** Where the ray o + t·d (t > 0) meets the plane through p with normal n; NO_HIT if it runs parallel or away from it. */
export function planeHit(o: Vec3, d: Vec3, p: Vec3, n: Vec3): Vec3 {
  const t = dot(sub(p, o), n) / dot(d, n);
  return t > 0 && Number.isFinite(t) ? add(o, { x: d.x * t, y: d.y * t, z: d.z * t }) : NO_HIT;
}

/** Where the ray from o (inside the sky sphere) along d leaves the SKY_R sphere around the origin. */
export function skyHit(o: Vec3, d: Vec3): Vec3 {
  const len = Math.hypot(d.x, d.y, d.z), u = { x: d.x / len, y: d.y / len, z: d.z / len };
  const b = dot(o, u), t = -b + Math.sqrt(b * b - dot(o, o) + SKY_R * SKY_R);
  return t > 0 && Number.isFinite(t) ? add(o, { x: u.x * t, y: u.y * t, z: u.z * t }) : NO_HIT;
}

/**
 * The pointer's point on a kind's drag surface: upright and flat on the ground plane y = 0, float on the vertical
 * plane through `at` facing the camera (normal = the camera's forward on the ground), sky on the sky sphere, where
 * placeDrag turns it into azimuth and a clamped elevation.
 */
export function dragHit(kind: Placed["kind"], o: Vec3, d: Vec3, at: Vec3, forward: Vec3): Vec3 {
  if (kind === "sky") return skyHit(o, d);
  if (kind === "float") return planeHit(o, d, at, { x: forward.x, y: 0, z: forward.z });
  return planeHit(o, d, ORIGIN, UP);
}

/**
 * The radius a moved Card keeps from the player: its walking circle, which walkCircles widens by WANDER_PAD for
 * wandering types. With only its own r, a drop within that extra 0.8 would leave the player inside the circle `step`
 * uses, and every move would be refused.
 */
export const dragRadius = (c: Pick<Card, "kind" | "type" | "placed">) =>
  walkCircles([{ kind: c.kind, type: c.type, collide: c.placed.collide }])[0]?.r ?? 0;

/** SavedScene.moves (task 9.4): instance id → position for every Card whose home differs from its layout position. */
export function movesOf(cards: readonly Pick<Card, "id" | "placed" | "pos">[]): Record<string, Vec3> {
  return Object.fromEntries(cards.filter(({ pos: p, placed: l }) => p.x !== l.x || p.y !== l.y || p.z !== l.z)
    .map((c) => [String(c.id), { ...c.pos }]));
}

/** Reset positions: every Card back to its layout position. */
export function resetPositions(cards: readonly Pick<Card, "placed" | "pos">[]): void {
  for (const c of cards) c.pos = { x: c.placed.x, y: c.placed.y, z: c.placed.z };
}

// Pure helpers (unit-tested in Node).
export const BOUNCE_H = 0.4, BOUNCE_T = 0.5;
/** Hop height s seconds after a tap: one sine arch of height BOUNCE_H over BOUNCE_T, else 0. */
export const bounce = (s: number) => (s >= 0 && s < BOUNCE_T ? BOUNCE_H * Math.sin((Math.PI * s) / BOUNCE_T) : 0);

export const SHIMMER = 0.08, GLOW = 0.03, TWINKLE = 0.4;
export interface Effect { bright: number; glow: number; alpha: number }
/** Effects with no geometry change (Requirement 14.8): water brightness, sun glow scale ±3%, star opacity; at rest when still. */
export function effect(type: ObjType, id: number, t: number, still: boolean): Effect {
  const rest = { bright: 1, glow: 1, alpha: 1 };
  if (still) return rest;
  const wave = (period: number) => Math.sin((2 * Math.PI * t) / period + id * 2.399); // golden-angle phase per id
  if (type === "water") return { ...rest, bright: 1 - SHIMMER * (1 + wave(2.5)) / 2 };
  if (type === "sun") return { ...rest, glow: 1 + GLOW * wave(3) };
  if (type === "star") return { ...rest, alpha: 1 - TWINKLE * (1 + wave(1.6)) / 2 };
  return rest;
}

/** Card labels: the noun, numbered in id order when a noun repeats ("tree 1", "tree 2", "house"). */
export function cardLabels(inst: readonly Pick<Instance, "id" | "noun">[]): Map<number, string> {
  const total = new Map<string, number>(), seen = new Map<string, number>();
  for (const o of inst) total.set(o.noun, (total.get(o.noun) ?? 0) + 1);
  return new Map([...inst].sort((a, b) => a.id - b.id).map((o) => {
    const n = (seen.get(o.noun) ?? 0) + 1;
    seen.set(o.noun, n);
    return [o.id, total.get(o.noun)! > 1 ? `${o.noun} ${n}` : o.noun];
  }));
}

export interface Card {
  id: number; kind: Placed["kind"]; type: ObjType; label: string;
  placed: Placed;   // the layout result: home position, size, collision circle
  pos: Vec3;        // current home; drags and Reset positions (6.12) set it, motion offsets are added on top
  fold: number;     // 0 flat … 1 upright, used by upright Cards only; walk (6.7) raises it with foldAmount each frame
  still: boolean;   // true pauses this Card's motion (while it is dragged)
  mesh: Mesh;       // origin at the base centre (upright, float, terrain) or the centre (flat, sky)
}

export interface WorldOptions {
  instances: readonly Instance[];
  work: WorkPixels;        // the Work_Image pixels the masks refer to; its size is the layout image size
  reducedMotion: boolean;  // prefers-reduced-motion: every Card upright, no motion, no effects, no bounce
  ground?: string;         // ground colour, e.g. groundColour() in 8.2; defaults to kraft
}

export interface World {
  scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer; cards: Card[];
  readonly reducedMotion: boolean;
  setPaused(paused: boolean): void;                          // Pause motion: offsets 0, effects at rest
  onFrame(cb: (t: number, dt: number) => void): () => void;  // runs each frame before Cards update; returns unsubscribe
  pick(clientX: number, clientY: number): Card | null;       // nearest Card whose cut-out (not its transparent corner) is hit
  tap(clientX: number, clientY: number): Card | null;        // pick, show the label, bounce
  canLook(e: PointerEvent): boolean;                         // walk's default canLook: false for a press that holds or drags a Card
  place(card: Card, to: Vec3): boolean;                      // drags and HUD nudges: through placeDrag; false if the Card stayed put
  moves(): Record<string, Vec3>;                             // movesOf(cards), for SavedScene.moves (9.4)
  reset(): void;                                             // Reset positions
  select(card: Card | null): void;                           // Objects panel highlight: accent tint and an ink ring on the ground
  resize(): void;
  dispose(): void;
}

interface Live extends Card {
  bounceAt: number; canvas: HTMLCanvasElement; shadow?: Mesh; glow?: Mesh;
  w: number;     // motion weight 0…1: 0 while still, fades back in after a drop
  lift: number;  // 0 resting … 1 picked up
  off: Vec3;     // this frame's motion offset, so a drag starts from where the Card shows
}

/** One press on the canvas, from pointerdown to pointerup (one at a time). */
interface Hold {
  id: number; touch: boolean; card: Live | null; x0: number; y0: number; x: number; y: number; t0: number;
  state: Press; far: boolean; timer: number;
  at: Vec3; forward: Vec3; offset: Vec3 | null; // drag surface anchor, camera forward, and Card home − pointer hit
}

export function buildWorld(host: HTMLElement, opts: WorldOptions): World {
  const { work, reducedMotion } = opts;
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.classList.add("world");
  host.append(renderer.domElement);
  const label = Object.assign(document.createElement("div"), { className: "world-label" });
  label.setAttribute("role", "status");
  host.append(label);

  const scene = new Scene();
  scene.background = new Color(PAPER);
  scene.fog = new Fog(PAPER, 24, 70);
  const camera = new PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.set(SPAWN.x, EYE, SPAWN.z); // facing −z, three's default

  const ground = new Mesh(new PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: opts.ground ?? KRAFT }));
  ground.position.y = -0.01; // under flat Cards (y 0.01) and Cards folded flat (y 0)
  scene.add(ground);

  const shadowGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowMat = new MeshBasicMaterial({ map: radial(SHADOW, 0.45), transparent: true, depthWrite: false });
  const liftMat = new MeshBasicMaterial({ map: radial(SHADOW, 0.28), transparent: true, depthWrite: false }); // softer, under a lifted Card
  const ring = new Mesh(new RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: INK_HEX, depthWrite: false }));
  ring.visible = false;
  scene.add(ring);
  const glowMat = new MeshBasicMaterial({ map: radial(ACCENT, 0.8), transparent: true, depthWrite: false, fog: false });
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const labels = cardLabels(opts.instances), byId = new Map(opts.instances.map((o) => [o.id, o]));
  const cards: Live[] = [];

  for (const p of layout(opts.instances, { w: work.width, h: work.height })) {
    const o = byId.get(p.id)!, art = cardArt(work, o);
    if (!art) continue; // empty mask: nothing to show
    const map = new CanvasTexture(art.canvas);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = anisotropy;
    // three binds `map` per material, so each Card gets its own material; same parameters per kind → one shader program.
    const mat = new MeshBasicMaterial({ map, side: DoubleSide, alphaTest: o.type === "star" ? 0.05 : 0.5, transparent: o.type === "star", fog: p.kind !== "sky" });
    const w = p.w * art.sx, h = (p.kind === "flat" ? p.d! : p.h) * art.sy, geo = new PlaneGeometry(w, h);
    if (p.kind === "flat") geo.rotateX(-Math.PI / 2);       // lies on the ground, image top → far (−z)
    else if (p.kind !== "sky") geo.translate(0, h / 2, 0);  // base pivot: fold and sway turn about the bottom edge
    const mesh = new Mesh(geo, mat);
    mesh.position.set(p.x, p.y, p.z);
    if (p.kind === "sky") mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    const c: Live = {
      id: p.id, kind: p.kind, type: o.type, label: labels.get(p.id)!, placed: p, pos: { x: p.x, y: p.y, z: p.z },
      fold: p.kind === "upright" ? foldAmount(0, Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z), reducedMotion) : 1,
      still: false, mesh, bounceAt: -Infinity, canvas: art.canvas, w: 1, lift: 0, off: { ...ORIGIN },
    };
    if (p.kind === "upright" || p.kind === "float") scene.add(c.shadow = new Mesh(shadowGeo, shadowMat));
    if (o.type === "sun") {
      mesh.add(c.glow = new Mesh(new PlaneGeometry(1.8 * Math.max(w, h), 1.8 * Math.max(w, h)), glowMat));
      c.glow.position.z = -0.05; // behind the sun, which faces the origin
    }
    cards.push(c);
  }

  let paused = false, raf = 0, hideLabel = 0, last = performance.now(), selected: Live | null = null;
  const t0 = last, clock = () => (performance.now() - t0) / 1000;
  const hooks = new Set<(t: number, dt: number) => void>();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000, dt = Math.min(0.1, Math.max(0, now - last) / 1000), still = reducedMotion || paused;
    last = now;
    for (const cb of hooks) cb(t, dt);
    for (const c of cards) {
      const m = motion(c.kind, c.type, c.id, t, still || c.still), e = effect(c.type, c.id, t, still);
      c.w = still || c.still ? 0 : Math.min(1, c.w + dt / RESUME_S); // stops at once, fades back in
      c.lift = reducedMotion ? +c.still : c.lift + (+c.still - c.lift) * Math.min(1, dt * LIFT_RATE);
      c.off = { x: c.w * m.dx, y: c.kind === "float" ? c.w * m.dy : 0, z: c.w * m.dz }; // a hop isn't a place to drag from
      const x = c.pos.x + c.off.x, z = c.pos.z + c.off.z, sky = c.kind === "sky", s = sky ? 1 + SKY_LIFT * c.lift : 1;
      c.mesh.position.set(x, c.pos.y + c.w * m.dy + bounce(t - c.bounceAt) + (sky ? 0 : LIFT_H * c.lift), z);
      if (sky) c.mesh.lookAt(0, 0, 0); // faces the origin wherever it was dragged
      else if (c.kind !== "flat") c.mesh.rotation.set(-(1 - c.fold) * Math.PI / 2, 0, c.w * m.rotZ); // top folds away from the player
      c.mesh.scale.set(m.flip ? -s : s, s, s);
      const mat = c.mesh.material as MeshBasicMaterial;
      mat.color.setHex(c === selected ? ACCENT_HEX : WHITE);
      if (c.type === "water") mat.color.multiplyScalar(e.bright);
      if (c.type === "star") mat.opacity = e.alpha;
      c.glow?.scale.setScalar(e.glow);
      if (c.shadow) { // blob shadow on the ground, grows as the Card stands up, larger and softer while lifted
        const k = c.fold * (1 + SHADOW_GROW * c.lift);
        c.shadow.position.set(x, 0.02, z);
        c.shadow.scale.set(Math.max(0.4, c.placed.w) * k, 1, Math.max(0.3, 0.35 * c.placed.w) * k);
        c.shadow.material = c.lift > 0.5 ? liftMat : shadowMat;
      }
    }
    ring.visible = !!selected && selected.kind !== "sky";
    if (selected) ring.position.set(selected.pos.x + selected.off.x, 0.03, selected.pos.z + selected.off.z);
    renderer.render(scene, camera);
  };

  const ray = new Raycaster(), ndc = new Vector2(), meshes = cards.map((c) => c.mesh), canvasEl = renderer.domElement;
  /** Points `ray` from the camera through a client point. */
  function aim(cx: number, cy: number): void {
    const r = canvasEl.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, 1 - ((cy - r.top) / r.height) * 2);
    ray.setFromCamera(ndc, camera);
  }
  function pick(cx: number, cy: number): Card | null {
    aim(cx, cy);
    for (const hit of ray.intersectObjects(meshes, false)) {
      const c = cards[meshes.indexOf(hit.object as Mesh)];
      if (hit.uv && opaqueAt(c.canvas, hit.uv.x, hit.uv.y)) return c;
    }
    return null;
  }
  function tap(cx: number, cy: number): Card | null {
    const c = pick(cx, cy) as Live | null;
    if (!c) return null;
    const r = host.getBoundingClientRect();
    label.textContent = c.label; // user strings only via textContent (Requirement 12.4)
    label.style.left = `${cx - r.left}px`;
    label.style.top = `${cy - r.top}px`;
    label.classList.add("on");
    clearTimeout(hideLabel);
    hideLabel = window.setTimeout(() => label.classList.remove("on"), LABEL_MS);
    if (!reducedMotion) c.bounceAt = clock();
    return c;
  }

  /** Moves a Card through placeDrag against the other Cards' circles at their current homes and the player. */
  function place(card: Card, to: Vec3): boolean {
    const others = cards.flatMap((k) => (k !== card && k.placed.collide ? [{ ...k.placed.collide, x: k.pos.x, z: k.pos.z }] : []));
    // The camera stands where walk's player is: walk sets it from player() every frame, and the player moves only then.
    const from = card.pos, player = { x: camera.position.x, z: camera.position.z };
    card.pos = placeDrag({ to, from, r: dragRadius(card) }, card.kind, WORLD_BOUNDS, others, player);
    return card.pos.x !== from.x || card.pos.y !== from.y || card.pos.z !== from.z;
  }

  // Presses on the canvas: a tap (≤ 4 px) shows the label, a drag on a Card moves it, the rest is walk's look. These
  // listeners are added before attachWalk's, so `press` is current when walk asks canLook for the same event.
  let press: Hold | null = null;
  const forwardV = new Vector3();
  const hitAt = (p: Hold, cx: number, cy: number) => {
    aim(cx, cy);
    return dragHit(p.card!.kind, ray.ray.origin, ray.ray.direction, p.at, p.forward);
  };
  function drag(p: Hold): void {
    const c = p.card!, h = hitAt(p, p.x, p.y);
    if (!finite(h)) return; // above the horizon, or along the plane: stay
    p.offset ??= sub(c.pos, h);
    const to = add(h, p.offset);
    if (c.kind === "upright" || c.kind === "flat") to.y = c.pos.y; // they stay on the ground
    place(c, to);
  }
  function pickUp(p: Hold): void {
    const c = p.card!;
    p.state = "drag";
    p.at = add(c.pos, c.off); // where the Card shows now, so pausing its motion doesn't make it jump
    camera.getWorldDirection(forwardV);
    p.forward = { x: forwardV.x, y: 0, z: forwardV.z };
    const h0 = hitAt(p, p.x0, p.y0);
    p.offset = finite(h0) ? sub(p.at, h0) : null; // null: set at the first hit, from the home
    c.still = true;
    host.classList.add("dragging");
    if (p.touch) navigator.vibrate?.(15);
    drag(p);
  }
  const onDown = (e: PointerEvent) => {
    if (press || e.button !== 0) return;
    const c = pick(e.clientX, e.clientY) as Live | null, card = c && c.kind !== "terrain" ? c : null; // terrain never moves
    const p: Hold = {
      id: e.pointerId, touch: e.pointerType === "touch", card, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      t0: performance.now(), state: card ? "wait" : "look", far: false, timer: 0, at: ORIGIN, forward: ORIGIN, offset: null,
    };
    press = p;
    if (!card) return;
    canvasEl.setPointerCapture(e.pointerId);
    if (p.touch) p.timer = window.setTimeout(() => { if (press === p && p.state === "wait") pickUp(p); }, HOLD_MS);
  };
  const onMove = (e: PointerEvent) => {
    const p = press;
    if (p?.id !== e.pointerId) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const moved = Math.hypot(p.x - p.x0, p.y - p.y0), was = p.state;
    p.far ||= moved > DRAG_PX;
    p.state = pressState(was, p.touch, moved, performance.now() - p.t0);
    if (p.state !== "drag") return;
    if (was === "drag") drag(p);
    else pickUp(p);
  };
  const onEnd = (e: PointerEvent) => {
    const p = press;
    if (p?.id !== e.pointerId) return;
    press = null;
    clearTimeout(p.timer);
    if (p.state === "drag") { // dropped: it already sits where placeDrag put it; motion resumes around the new home
      p.card!.still = false;
      host.classList.remove("dragging");
    } else if (e.type === "pointerup" && !p.far) tap(e.clientX, e.clientY);
  };
  const canLook = (e: PointerEvent) => {
    const p = press;
    if (p?.id !== e.pointerId || p.state === "look") return true;
    // A touch on a Card lets walk capture it, so it can look once it moves off; nothing looks while it waits or drags.
    return p.state === "wait" && p.touch && e.type === "pointerdown";
  };
  const onMenu = (e: Event) => { if (press) e.preventDefault(); }; // a long-press menu on touch
  const ends = ["pointerup", "pointercancel", "lostpointercapture"] as const;
  canvasEl.addEventListener("pointerdown", onDown);
  canvasEl.addEventListener("pointermove", onMove);
  for (const type of ends) canvasEl.addEventListener(type, onEnd);
  canvasEl.addEventListener("contextmenu", onMenu);

  function select(card: Card | null): void {
    selected = card as Live | null;
    if (!card) return;
    const l = card.placed, r = Math.max(0.5, l.collide?.r ?? l.w / 2) + 0.2; // around its footprint
    if (card.kind === "flat") ring.scale.set(l.w / 2 + 0.2, 1, l.d! / 2 + 0.2);
    else ring.scale.set(r, 1, r);
  }

  function resize() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    scene, camera, renderer, cards, reducedMotion,
    setPaused: (b) => { paused = b; },
    onFrame: (cb) => { hooks.add(cb); return () => hooks.delete(cb); },
    pick, tap, canLook, place, select, resize,
    moves: () => movesOf(cards),
    reset: () => resetPositions(cards),
    dispose() {
      cancelAnimationFrame(raf);
      clearTimeout(hideLabel);
      if (press) clearTimeout(press.timer);
      ro.disconnect();
      canvasEl.removeEventListener("pointerdown", onDown);
      canvasEl.removeEventListener("pointermove", onMove);
      for (const type of ends) canvasEl.removeEventListener(type, onEnd);
      canvasEl.removeEventListener("contextmenu", onMenu);
      for (const m of [shadowMat, liftMat]) { m.map?.dispose(); m.dispose(); } // only one of them is on each shadow
      scene.traverse((obj) => {
        if (!(obj instanceof Mesh)) return;
        obj.geometry.dispose();
        (obj.material as MeshBasicMaterial).map?.dispose();
        (obj.material as MeshBasicMaterial).dispose();
      });
      renderer.dispose();
      canvasEl.remove();
      label.remove();
      host.classList.remove("world", "dragging");
    },
  };
}

/** The Card picture: the Instance's trimToMask cut-out (long side ≤ 512 px) on a white paper edge; sx, sy scale the plane for the edge. */
function cardArt(work: WorkPixels, o: Instance): { canvas: HTMLCanvasElement; sx: number; sy: number } | null {
  const crop = cropRgba(work, o.bbox, 0); // the bbox, which the mask is sized to
  const t = trimToMask(crop.data, o.mask, crop.rect.w, crop.rect.h);
  if (!t) return null;
  const src = canvas(t.width, t.height);
  src.getContext("2d")!.putImageData(new ImageData(t.data, t.width, t.height), 0, 0);
  // shortcut: the trimmed cut-out is stretched to the bbox size from layout (≤ the 4 px threshold padding); the Viewer's cut PNGs are trimmed the same way.
  const { w, h } = scaledSize(t.width, t.height, TEX_MAX), pad = Math.max(2, Math.round((BORDER_PX * w) / t.width));
  const out = canvas(w + 2 * pad, h + 2 * pad), ctx = out.getContext("2d", { willReadFrequently: true })!;
  for (let a = 0; a < 16; a++) ctx.drawImage(src, pad * (1 + Math.cos(a * Math.PI / 8)), pad * (1 + Math.sin(a * Math.PI / 8)), w, h);
  ctx.globalCompositeOperation = "source-in"; // the dilated silhouette becomes white paper
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(src, pad, pad, w, h);
  return { canvas: out, sx: out.width / w, sy: out.height / h };
}

function canvas(w: number, h: number): HTMLCanvasElement {
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}

/** A soft round spot of colour `rgb` ("r g b") fading from alpha a to 0, for blob shadows and the sun's glow. */
function radial(rgb: string, a: number): CanvasTexture {
  const c = canvas(64, 64), ctx = c.getContext("2d")!, g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgb(${rgb} / ${a})`);
  g.addColorStop(1, `rgb(${rgb} / 0)`); // same colour at alpha 0: "transparent" would fade through black
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** True if the Card picture is opaque at texture uv (v = 1 is the top row), so taps pass through transparent corners. */
function opaqueAt(c: HTMLCanvasElement, u: number, v: number): boolean {
  const x = Math.min(c.width - 1, Math.floor(u * c.width)), y = Math.min(c.height - 1, Math.floor((1 - v) * c.height));
  return c.getContext("2d")!.getImageData(x, y, 1, 1).data[3] > 127;
}
