// The three.js World_View: paper Cards at their layout positions, one requestAnimationFrame loop for motion and
// effects, and tap → label + bounce (design.md "Browser components", "motion", Requirements 7.1–7.3, 8.2, 8.3, 12.4,
// 14.1, 14.8). Load it only through open.ts (dynamic import), so three.js stays out of the first page load.
// Walking and fold updates (6.7), drag and the HUD (6.12) and the sky backdrop (8.2) plug in through World.
import {
  CanvasTexture, Color, DoubleSide, Fog, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene,
  SRGBColorSpace, Vector2, WebGLRenderer,
} from "three";
import type { ObjType } from "../../shared/scene";
import type { WorkPixels } from "../cut/chain";
import { cropRgba } from "../cut/threshold";
import type { Instance } from "../cut/types";
import { scaledSize } from "../image/encode";
import { trimToMask } from "../sam/cutout";
import { motion } from "./animate";
import { SPAWN } from "./collide";
import { layout, type Placed } from "./layout";
import { foldAmount } from "./popup";
import type { Vec3 } from "./space";
import "./world.css";

export const EYE = 1.7;              // camera height
const PAPER = "#e7e2d8", KRAFT = "#d6ccbb", ACCENT = "255 197 51", SHADOW = "52 40 22"; // DESIGN.md tokens
const TEX_MAX = 512;                 // cut-out texture long side (design.md "Performance")
const BORDER_PX = 4;                 // white paper edge, in Work_Image pixels
const TAP_PX = 4;                    // a press that moves further is a drag (look in 6.7, move in 6.12), not a tap
const LABEL_MS = 2500;

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
  resize(): void;
  dispose(): void;
}

interface Live extends Card { bounceAt: number; canvas: HTMLCanvasElement; shadow?: Mesh; glow?: Mesh }

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
      still: false, mesh, bounceAt: -Infinity, canvas: art.canvas,
    };
    if (p.kind === "upright" || p.kind === "float") scene.add(c.shadow = new Mesh(shadowGeo, shadowMat));
    if (o.type === "sun") {
      mesh.add(c.glow = new Mesh(new PlaneGeometry(1.8 * Math.max(w, h), 1.8 * Math.max(w, h)), glowMat));
      c.glow.position.z = -0.05; // behind the sun, which faces the origin
    }
    cards.push(c);
  }

  let paused = false, raf = 0, hideLabel = 0, last = performance.now();
  const t0 = last, clock = () => (performance.now() - t0) / 1000;
  const hooks = new Set<(t: number, dt: number) => void>();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000, dt = Math.min(0.1, Math.max(0, now - last) / 1000), still = reducedMotion || paused;
    last = now;
    for (const cb of hooks) cb(t, dt);
    for (const c of cards) {
      const m = motion(c.kind, c.type, c.id, t, still || c.still), e = effect(c.type, c.id, t, still);
      const x = c.pos.x + m.dx, z = c.pos.z + m.dz;
      c.mesh.position.set(x, c.pos.y + m.dy + bounce(t - c.bounceAt), z);
      if (c.kind !== "flat" && c.kind !== "sky") c.mesh.rotation.set(-(1 - c.fold) * Math.PI / 2, 0, m.rotZ); // top folds away from the player
      c.mesh.scale.x = m.flip ? -1 : 1;
      if (c.type === "water") (c.mesh.material as MeshBasicMaterial).color.setScalar(e.bright);
      if (c.type === "star") (c.mesh.material as MeshBasicMaterial).opacity = e.alpha;
      c.glow?.scale.setScalar(e.glow);
      if (c.shadow) { // blob shadow on the ground, grows as the Card stands up
        c.shadow.position.set(x, 0.02, z);
        c.shadow.scale.set(Math.max(0.4, c.placed.w) * c.fold, 1, Math.max(0.3, 0.35 * c.placed.w) * c.fold);
      }
    }
    renderer.render(scene, camera);
  };

  const ray = new Raycaster(), ndc = new Vector2(), meshes = cards.map((c) => c.mesh);
  function pick(cx: number, cy: number): Card | null {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, 1 - ((cy - r.top) / r.height) * 2);
    ray.setFromCamera(ndc, camera);
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

  let down: { id: number; x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => { down = { id: e.pointerId, x: e.clientX, y: e.clientY }; };
  const onUp = (e: PointerEvent) => {
    if (down?.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= TAP_PX) tap(e.clientX, e.clientY);
    down = null;
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);

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
    pick, tap, resize,
    dispose() {
      cancelAnimationFrame(raf);
      clearTimeout(hideLabel);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      scene.traverse((obj) => {
        if (!(obj instanceof Mesh)) return;
        obj.geometry.dispose();
        (obj.material as MeshBasicMaterial).map?.dispose();
        (obj.material as MeshBasicMaterial).dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
      label.remove();
      host.classList.remove("world");
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
