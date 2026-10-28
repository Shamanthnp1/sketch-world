// Player movement against collision circles (design.md "step(p, d, circles, b)", Requirements 7.3, 7.6, 7.7, 7.9).
import type { ObjType } from "../../shared/scene";
import { W, Z_BACK, Z_FRONT, type Circle, type Vec2 } from "./space";

export type Bounds = { x0: number; x1: number; z0: number; z1: number };
export const WORLD_BOUNDS: Bounds = { x0: -W / 2 - 1, x1: W / 2 + 1, z0: Z_BACK - 1, z1: Z_FRONT + 3.5 };
export const SPAWN: Vec2 = { x: 0, z: Z_FRONT + 3 };
export const PLAYER_R = 0.3;
export const WANDER_PAD = 0.8; // the wander loop radius in design.md's motion table
const WANDERS: readonly ObjType[] = ["animal", "person", "car"];

const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v));
export const clampTo = (b: Bounds, p: Vec2): Vec2 => ({ x: clamp(b.x0, b.x1, p.x), z: clamp(b.z0, b.z1, p.z) });

/** The circles to pass to `step`: every `collide`, with upright animal, person and car circles widened by 0.8. */
export function walkCircles(objs: readonly { kind: string; type: ObjType; collide?: Circle }[]): Circle[] {
  return objs.flatMap(({ kind, type, collide: c }) =>
    !c ? [] : kind === "upright" && WANDERS.includes(type) ? [{ ...c, r: c.r + WANDER_PAD }] : [c]);
}

/** One sub-step (|d| ≤ 0.25): full move, then x only, then z only, each clamped; the first clear of every circle wins, else p. */
export function step(p: Vec2, d: Vec2, circles: readonly Circle[], b: Bounds, pr = PLAYER_R): Vec2 {
  for (const c of [{ x: p.x + d.x, z: p.z + d.z }, { x: p.x + d.x, z: p.z }, { x: p.x, z: p.z + d.z }]) {
    const q = clampTo(b, c);
    if (circles.every((k) => (q.x - k.x) ** 2 + (q.z - k.z) ** 2 >= (k.r + pr) ** 2)) return q;
  }
  return p;
}
