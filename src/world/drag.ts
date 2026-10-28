// Pure placement of a dragged or nudged Card (design.md "placeDrag — moving objects", Requirements 15.6–15.11).
import { PLAYER_R, clampTo, type Bounds } from "./collide";
import type { Placed } from "./layout";
import { SKY_R, type Circle, type Vec2, type Vec3 } from "./space";

/** to = pointer hit on the kind's drag surface; from = position before this move; r = own collision radius. */
export interface DragTarget { to: Vec3; from: Vec3; r: number }

const rad = (deg: number) => (deg * Math.PI) / 180;
const FLOAT_Y0 = 0.5, FLOAT_Y1 = 8, SKY_EL0 = rad(10), SKY_EL1 = rad(60);
const SKY_TOL = 1e-9; // rounding slack when re-checking a sky point that clampKind computed with sin/cos
const PUSH_EPS = 1e-6; // push-out lands this far beyond r1 + r2 so rounding cannot leave it just inside
const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v));
const finite = (p: Vec3) => [p.x, p.y, p.z].every(Number.isFinite);
const elevation = (p: Vec3) => Math.atan2(p.y, Math.hypot(p.x, p.z));

/**
 * Clamp p to the bounds for its kind. Upright and flat: x, z into b, y kept. Float: also y into [0.5, 8].
 * Sky: onto the SKY_R sphere at p's azimuth (free), elevation clamped to 10°–60°. Terrain: unchanged (it never moves).
 */
export function clampKind(b: Bounds, kind: Placed["kind"], p: Vec3): Vec3 {
  if (kind === "terrain") return p;
  if (kind === "sky") { // same angles as layout: az from −z towards +x, el above the ground plane
    const az = Math.atan2(p.x, -p.z), el = clamp(SKY_EL0, SKY_EL1, elevation(p));
    return { x: SKY_R * Math.cos(el) * Math.sin(az), y: SKY_R * Math.sin(el), z: -SKY_R * Math.cos(el) * Math.cos(az) };
  }
  const { x, z } = clampTo(b, p);
  return { x, y: kind === "float" ? clamp(FLOAT_Y0, FLOAT_Y1, p.y) : p.y, z };
}

/** True if p is finite and inside the bounds clampKind clamps to for kind; terrain never is (it cannot be moved). */
export function inBounds(b: Bounds, kind: Placed["kind"], p: Vec3): boolean {
  if (kind === "terrain" || !finite(p)) return false;
  if (kind === "sky") {
    const el = elevation(p);
    return Math.abs(Math.hypot(p.x, p.y, p.z) - SKY_R) <= SKY_TOL && el >= SKY_EL0 - SKY_TOL && el <= SKY_EL1 + SKY_TOL;
  }
  return p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1 && (kind !== "float" || (p.y >= FLOAT_Y0 && p.y <= FLOAT_Y1));
}

/**
 * Where a dragged or nudged Card lands. Pre: target.from is valid for kind; circles exclude the Card's own circle.
 * Post: inside the bounds for kind; an upright result is ≥ k.r + target.r from every circle and ≥ pr + target.r from the player.
 */
export function placeDrag(target: DragTarget, kind: Placed["kind"], bounds: Bounds, circles: readonly Circle[], player: Vec2, pr = PLAYER_R): Vec3 {
  if (kind === "terrain" || !finite(target.to)) return target.from; // a ray parallel to the drag plane gives NaN
  const q = clampKind(bounds, kind, target.to);
  if (kind !== "upright") return q;
  const all = [...circles, { x: player.x, z: player.z, r: pr }], need = (k: Circle) => k.r + target.r;
  const ok = (p: Vec3) => inBounds(bounds, kind, p) && all.every((k) => Math.hypot(p.x - k.x, p.z - k.z) >= need(k));
  if (ok(q)) return q;
  const k = all.find((c) => Math.hypot(q.x - c.x, q.z - c.z) < need(c))!, len = Math.hypot(q.x - k.x, q.z - k.z);
  if (len === 0) return target.from; // no direction to push along
  const f = (need(k) + PUSH_EPS) / len, p = { x: k.x + (q.x - k.x) * f, y: q.y, z: k.z + (q.z - k.z) * f };
  return ok(p) ? p : target.from; // pushed out along the line from the blocking centre
}
