// GLSL smoothstep; e0 > e1 is allowed and reverses the ramp (smoothstep(8, 4, d) is 1 near, 0 far).
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Card fold, 0 flat to 1 upright: flat beyond 8 units, upright within 4, and never lowers once raised.
export function foldAmount(prev: number, dist: number, reducedMotion: boolean): number {
  return reducedMotion ? 1 : Math.max(prev, smoothstep(8, 4, dist));
}
