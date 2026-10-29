import type { Vec2 } from "./space";

// GLSL smoothstep; e0 > e1 is allowed and reverses the ramp (smoothstep(8, 4, d) is 1 near, 0 far).
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Card fold, 0 flat to 1 upright: flat beyond 8 units, upright within 4, and never lowers once raised.
export function foldAmount(prev: number, dist: number, reducedMotion: boolean): number {
  return reducedMotion ? 1 : Math.max(prev, smoothstep(8, 4, dist));
}

// The intro pop-up when a World opens (Requirement 8.4): the upright Cards fold up in turn, nearest to the player
// first, like the Home page's pop-up book. Card `order` of `count` starts INTRO_LEAD + order × gap seconds in (the gap
// at most INTRO_GAP, every start within INTRO_SPREAD of the first) and rises over INTRO_CARD with an ease-out-back
// spring. build.ts keeps max(fold, introFold) in Card.fold, so the fold still never lowers.
export const INTRO_LEAD = 0.3, INTRO_CARD = 0.6, INTRO_GAP = 0.15, INTRO_SPREAD = 1.8;
export const INTRO_S = INTRO_LEAD + INTRO_SPREAD + INTRO_CARD; // 2.7 s: every Card is upright by then
const BACK = 1.3; // ease-out-back strength: peaks 6% past upright (about 5°), close to Home's --spring overshoot

/** Seconds after the World opens when Card `order` (0 = nearest) of `count` upright Cards starts to fold up. */
export const introStart = (order: number, count: number) =>
  INTRO_LEAD + order * Math.min(INTRO_GAP, INTRO_SPREAD / Math.max(1, count - 1));

/** The spring: 0 until the Card's start, a moment past 1, then exactly 1 from INTRO_CARD after its start. */
function introSpring(order: number, count: number, t: number): number {
  const x = (t - introStart(order, count)) / INTRO_CARD, u = x - 1;
  if (x <= 0) return 0;
  return x >= 1 ? 1 : Math.max(0, 1 + (BACK + 1) * u ** 3 + BACK * u ** 2);
}

/** Card `order`'s intro fold t seconds after the World opens: 0 → 1 and never lower; 1 with reduced motion. */
export function introFold(order: number, count: number, t: number, reducedMotion: boolean): number {
  return reducedMotion ? 1 : Math.min(1, introSpring(order, count, t));
}

/** The spring's overshoot past upright, as extra fold: drawn as a lean toward the player, never kept in Card.fold. */
export function introLean(order: number, count: number, t: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.max(0, introSpring(order, count, t) - 1);
}

/** Each point's intro order by ground distance from `from`: 0 for the nearest, ties in input order. */
export function introOrder(ps: readonly Vec2[], from: Vec2): number[] {
  const d = ps.map((p) => Math.hypot(p.x - from.x, p.z - from.z)), order: number[] = [];
  ps.map((_, i) => i).sort((a, b) => d[a]! - d[b]! || a - b).forEach((i, k) => { order[i] = k; });
  return order;
}
