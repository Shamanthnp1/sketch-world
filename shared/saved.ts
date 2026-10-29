// SavedScene: the world JSON stored in D1 worlds.scene (design.md "Data Models"). Checked by the Worker on
// POST /api/worlds (and PATCH for `moves`); typed for the browser's save and viewer (Requirements 10.1, 10.4, 16.1–16.3).
import { z } from "zod";
import { WORLD_BOUNDS } from "../src/world/collide";
import { inBounds } from "../src/world/drag";
import { placement } from "../src/world/layout";
import { ALL_TYPES, NOUN, SparkSceneBase } from "./scene";

export const MAX_SAVED_INSTANCES = 30;
export const MAX_MOVES = 30;
export const MAX_IMG_SIDE = 1024; // src/image/encode.ts WORK_MAX_PX

const px = z.number().min(0).max(4096); // z.number() also rejects NaN and ±Infinity

/** An Instance without its mask. Ids are 0…29 (the chain numbers them 0…n−1), so cut/<id>.png fits the asset key rule. */
export const SavedInstance = z.object({
  id: z.number().int().min(0).max(MAX_SAVED_INSTANCES - 1),
  objIndex: z.number().int().min(0).max(11),
  type: z.enum(ALL_TYPES),
  noun: z.string().regex(NOUN),
  sky: z.boolean(),
  bbox: z.object({ x: px, y: px, w: px, h: px }),
  source: z.enum(["sam-noun", "sam-box", "threshold"]),
});
export type SavedInstance = z.output<typeof SavedInstance>;

// Strict, so a valid entry passes through unchanged (no keys silently dropped). Keys are instance ids in decimal.
const Move = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
export const Moves = z.record(z.string().regex(/^\d{1,2}$/), Move)
  .refine((m) => Object.keys(m).length <= MAX_MOVES, `moves has more than ${MAX_MOVES} entries`);
export type Moves = z.output<typeof Moves>;

/** The PATCH /api/worlds/:id body (Requirement 16.7): exactly `{moves}`, which replace the saved ones; `{}` clears them. */
export const MovesBody = z.strictObject({ moves: Moves });
export type MovesBody = z.output<typeof MovesBody>;

/**
 * True if every entry names an Instance (by String(id)) and lies inside the bounds for that Instance's kind
 * (Requirements 16.2, 16.3): the same `inBounds` the drag uses, which is false for terrain and non-finite values.
 */
export function movesValid(instances: readonly Pick<SavedInstance, "id" | "type" | "sky">[], moves: Moves): boolean {
  const kinds = new Map(instances.map((i) => [String(i.id), placement(i)]));
  return Object.entries(moves).every(([id, p]) => {
    const kind = kinds.get(id);
    return kind !== undefined && inBounds(WORLD_BOUNDS, kind, p);
  });
}

// Unknown keys (such as Layout positions) are stripped: layout() recomputes positions on load.
export const SavedScene = z.object({
  v: z.literal(1),
  title: SparkSceneBase.shape.title,
  view: z.enum(["side", "top"]),
  // The Work_Image's long side is at most 1024 px (Requirement 1.3; the pad is 1024 × 768). A larger img would make
  // every Viewer allocate it, and a cut-out canvas up to its size per Instance.
  img: z.object({ w: z.number().int().min(1).max(MAX_IMG_SIDE), h: z.number().int().min(1).max(MAX_IMG_SIDE) }),
  ground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backdrop: z.enum(["image", "gradient"]),
  instances: z.array(SavedInstance).max(MAX_SAVED_INSTANCES)
    .refine((list) => new Set(list.map((i) => i.id)).size === list.length, "instance ids must be unique"),
  moves: Moves.optional(),
}).refine((s) => !s.moves || movesValid(s.instances, s.moves), {
  path: ["moves"],
  message: "moves must name movable instances and stay inside the bounds for their kind",
});
export type SavedScene = z.output<typeof SavedScene>;

/** GET /api/worlds/:id. Asset URLs are under /a/w/<id>/; `cuts` maps each Instance id to its cut-out PNG. */
export interface WorldReply {
  id: string;
  title: string;
  createdAt: number; // ms since the epoch
  scene: SavedScene;
  assets: { source: string; thumb: string; backdrop?: string /* only when scene.backdrop is "image" */; cuts: Record<string, string> };
}

/** One world in GET /api/gallery; a superset of the Home strip's GalleryItem {id, title, thumb}. */
export interface GalleryWorld { id: string; title: string; thumb: string; createdAt: number }
/** `worlds`: the 24 latest safe worlds, newest first. `samples`: the SAMPLE_WORLD_IDS worlds that exist, in that order. */
export interface GalleryReply { worlds: GalleryWorld[]; samples: GalleryWorld[] }
