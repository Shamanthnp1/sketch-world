// Card motion per frame (design.md "motion(kind, type, id, t, rm)", Requirement 14). Pure and deterministic; t in seconds.
import { group, type ObjType } from "../../shared/scene";
import type { Placed } from "./layout";

export interface Motion { dx: number; dy: number; dz: number; rotZ: number /* radians */; flip: boolean }
export type MotionRow = "wander" | "ellipse" | "drift" | "sway" | "static";

// Amplitudes from design.md's motion table.
export const WANDER_R = 0.8; // loop radius; collide.ts WANDER_PAD must stay ≥ this
export const HOP = 0.15;
export const FLOAT_X = 2, FLOAT_Y = 0.5;
export const DRIFT_X = 1.5;
export const SWAY = Math.PI / 60; // 3°

const WANDERS: readonly ObjType[] = ["animal", "person", "car"];
const TAU = 2 * Math.PI;
const phase = (id: number) => ((Math.imul(id, 2654435761) >>> 0) / 2 ** 32) * TAU; // bijective hash: distinct ids, distinct phases

/** The design.md table row for a Card. Off-table: every other float (person, car, tree, kite…) flies the ellipse; float building stays static. */
export function motionRow(kind: Placed["kind"], type: ObjType): MotionRow {
  const g = group(type);
  if (kind === "terrain" || kind === "flat" || kind === "sky" || g === "building") return "static";
  if (type === "cloud") return "drift";
  if (kind === "float") return "ellipse";
  if (WANDERS.includes(type)) return "wander";
  return g === "standing" ? "sway" : "static"; // upright sky, flat or terrain types never come out of placement
}

export function motion(kind: Placed["kind"], type: ObjType, id: number, t: number, rm: boolean): Motion {
  const row = motionRow(kind, type);
  if (rm || row === "static" || !Number.isFinite(t)) return { dx: 0, dy: 0, dz: 0, rotZ: 0, flip: false };
  const wave = (period: number) => (TAU * t) / period + phase(id);
  switch (row) {
    case "wander": { // flat loop 0.8 × 0.4 around home, a hop every 0.6 s; dx = R·cos a moves left while sin a > 0
      const a = wave(8);
      return { dx: WANDER_R * Math.cos(a), dy: HOP * Math.abs(Math.sin(wave(1.2))), dz: (WANDER_R / 2) * Math.sin(a), rotZ: 0, flip: Math.sin(a) > 0 };
    }
    case "ellipse": {
      const a = wave(10);
      return { dx: FLOAT_X * Math.cos(a), dy: FLOAT_Y * Math.sin(a), dz: 0, rotZ: 0, flip: Math.sin(a) > 0 };
    }
    case "drift": return { dx: DRIFT_X * Math.sin(wave(40)), dy: 0, dz: 0, rotZ: 0, flip: false };
    case "sway": return { dx: 0, dy: 0, dz: 0, rotZ: SWAY * Math.sin(wave(4)), flip: false };
  }
}
