// Pure side-view layout: where each Instance's Card goes in the world (design.md "layout", Requirement 6).
import { group, type ObjType } from "../../shared/scene";
import type { Instance } from "../cut/types";
import { HORIZON, R_MAX, SKY_R, W, Z_BACK, Z_FRONT, type Circle, type Size } from "./space";

export interface Placed { // collide only for upright standing objects and buildings
  id: number; kind: "upright" | "flat" | "terrain" | "sky" | "float"; x: number; y: number; z: number; w: number; h: number; d?: number; collide?: Circle;
}

const FAR_SKY: readonly ObjType[] = ["sun", "moon", "star", "rainbow"]; // the only types placed on the sky sphere
const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** The Placed kind for an Instance (Requirement 6.2). */
export const placement = (o: Pick<Instance, "type" | "sky">): Placed["kind"] => {
  const g = group(o.type);
  if (g === "sky") return FAR_SKY.includes(o.type) ? "sky" : "float"; // cloud, bird float
  if (g === "flat" || g === "terrain") return g;
  return o.sky ? "float" : "upright"; // standing or building in the air (fish, turtle, kite) floats
};

/** Deterministic offset in [−2, 2] from an Instance id. */
export const jitter = (id: number) => ((Math.imul(id, 2654435761) >>> 0) % 401) / 100 - 2;

/** World z for an image row: the horizon and above → Z_BACK, the image bottom → Z_FRONT. */
export const depth = (yPx: number, img: Size) =>
  Z_BACK + clamp(0, 1, (yPx / img.h - HORIZON) / (1 - HORIZON)) * (Z_FRONT - Z_BACK);

// Takes no view: SparkScenes with view "top" get this side-view layout until add-on A2 ships (Requirement 6.11).
export function layout(inst: readonly Instance[], img: Size): Placed[] {
  const s = W / img.w; // world units per pixel
  return [...inst].sort((a, b) => a.id - b.id).map((o): Placed => {
    const cx = o.bbox.x + o.bbox.w / 2, cy = o.bbox.y + o.bbox.h / 2;
    const x = (cx / img.w - 0.5) * W, w = o.bbox.w * s, h = o.bbox.h * s;
    switch (placement(o)) {
      case "sky": { // azimuth ±72°, elevation 10° (bottom) – 60° (top)
        const az = (cx / img.w - 0.5) * 0.8 * Math.PI, el = lerp(rad(10), rad(60), 1 - cy / img.h);
        return { id: o.id, kind: "sky", x: SKY_R * Math.cos(el) * Math.sin(az), y: SKY_R * Math.sin(el), z: -SKY_R * Math.cos(el) * Math.cos(az), w: 2 * w, h: 2 * h };
      }
      case "float": // mid-air Card between back and front, no collision circle
        return { id: o.id, kind: "float", x, y: lerp(1.5, 6, 1 - cy / img.h), z: (Z_BACK + Z_FRONT) / 2 + jitter(o.id), w, h };
      case "terrain":
        return { id: o.id, kind: "terrain", x, y: 0, z: Z_BACK - 2, w: 1.5 * w, h: 1.5 * h };
      case "flat": {
        const z0 = depth(o.bbox.y, img), z1 = depth(o.bbox.y + o.bbox.h, img);
        return { id: o.id, kind: "flat", x, y: 0.01, z: (z0 + z1) / 2, w, h: 0, d: Math.max(0.2, z1 - z0) };
      }
      default: { // upright standing or building: the base row sets depth
        const z = depth(o.bbox.y + o.bbox.h, img), r = clamp(0.3, R_MAX, (group(o.type) === "building" ? 0.5 : 0.3) * w);
        return { id: o.id, kind: "upright", x, y: 0, z, w, h, collide: { x, z, r } };
      }
    }
  });
}
