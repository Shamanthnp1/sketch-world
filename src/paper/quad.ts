// Adapted from undo-manual (same author, built during the event).
// Paper geometry by bilinear interpolation (camera roughly overhead, so no homography). Quad order: the paper's
// top-left corner as seen in the photo, then clockwise. u runs along q[0]→q[1], v along q[0]→q[3].
// Coordinates are image pixels with pixel (x, y) centred at (x + 0.5, y + 0.5).
export type Pt = { x: number; y: number };
export type Quad = [Pt, Pt, Pt, Pt];

const MAX_ASPECT = 1.8;
const TOL = 1e-9;

/** Requirement 1.2: convex, clockwise on screen, aspect (longer mean of opposite sides ÷ shorter) 1.0–1.8. */
export function validateQuad(q: Quad): { ok: true } | { ok: false; reason: string } {
  // Turn at each corner; all > 0 means convex and clockwise on screen (y points down).
  const turns = q.map((a, i) => {
    const b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  });
  if (!turns.every((k) => k > 0)) {
    return turns.every((k) => k < 0)
      ? { ok: false, reason: "Counter-clockwise: click clockwise, starting at the top-left corner." }
      : { ok: false, reason: "Not convex: click the 4 paper corners in order around the paper." };
  }
  const len = (i: number, j: number) => Math.hypot(q[j].x - q[i].x, q[j].y - q[i].y);
  const a = (len(0, 1) + len(3, 2)) / 2, b = (len(1, 2) + len(0, 3)) / 2;
  const aspect = Math.max(a, b) / Math.min(a, b);
  if (aspect > MAX_ASPECT) {
    return { ok: false, reason: `Wrong shape: the paper's sides are ${aspect.toFixed(2)} : 1 (needs 1.0–${MAX_ASPECT}).` };
  }
  return { ok: true };
}

export function bilinear([a, b, c, d]: Quad, u: number, v: number): Pt {
  const w0 = (1 - u) * (1 - v), w1 = u * (1 - v), w2 = u * v, w3 = (1 - u) * v;
  return { x: w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x, y: w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y };
}

// Closed-form inverse: p − a = u·e + v·f + u·v·g gives k2·v² + k1·v + k0 = 0. Null if p is outside the quad.
export function invBilinear([a, b, c, d]: Quad, p: Pt): { u: number; v: number } | null {
  const ex = b.x - a.x, ey = b.y - a.y, fx = d.x - a.x, fy = d.y - a.y;
  const gx = a.x - b.x + c.x - d.x, gy = a.y - b.y + c.y - d.y;
  const hx = p.x - a.x, hy = p.y - a.y;
  const k2 = gx * fy - gy * fx;
  const k1 = ex * fy - ey * fx + hx * gy - hy * gx;
  const k0 = hx * ey - hy * ex;
  const disc = k1 * k1 - 4 * k0 * k2;
  if (!(disc >= 0)) return null;
  // Stable root pair s/k2 and k0/s; k0/s stays exact when k2 → 0 (a parallelogram).
  const s = -0.5 * (k1 + (k1 < 0 ? -1 : 1) * Math.sqrt(disc));
  for (const v of [k0 / s, s / k2]) {
    // u from projecting p − a − v·f onto e + v·g, so no division by a near-zero axis component.
    const dx = ex + gx * v, dy = ey + gy * v;
    const u = ((hx - fx * v) * dx + (hy - fy * v) * dy) / (dx * dx + dy * dy);
    if (u >= -TOL && u <= 1 + TOL && v >= -TOL && v <= 1 + TOL) {
      return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
    }
  }
  return null;
}
