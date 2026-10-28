// Scene_Schema: Spark's scene reply, rechecked by the Worker and typed for the browser (Requirements 3.3, 3.4).
import { z } from "zod";

export const TYPES = {
  standing: ["tree", "person", "animal", "flower", "lamp", "sign", "car", "other-standing"],
  building: ["house", "tower", "castle"],
  flat: ["water", "path", "road", "field"],
  terrain: ["mountain", "hill"],
  sky: ["sun", "moon", "cloud", "bird", "star"],
} as const;
export type Group = keyof typeof TYPES;
export type ObjType = (typeof TYPES)[Group][number];
export const ALL_TYPES: readonly ObjType[] = Object.values(TYPES).flat();

const GROUP_OF = Object.fromEntries(
  Object.entries(TYPES).flatMap(([g, types]) => types.map((t) => [t, g])),
) as Record<ObjType, Group>;
export const group = (t: ObjType): Group => GROUP_OF[t];

/** Pixel box in an image's own pixels (Work_Image, or the image sent to SAM). */
export type PxBox = { x: number; y: number; w: number; h: number };

// ≤ 40 chars; the SAM noun prompt. worker/limits/input.ts readNoun uses the same rule.
export const NOUN = /^[a-z][a-z -]{0,39}$/;

export const SparkSceneBase = z.object({
  title: z.string().min(1).max(60).regex(/^[\p{L}\p{N} ',.!?-]+$/u),
  view: z.enum(["side", "top"]),
  isDrawing: z.boolean(),
  safe: z.boolean(),
  objects: z.array(z.object({
    type: z.enum(ALL_TYPES),
    noun: z.string().min(1).max(40).regex(NOUN), // min/max repeat the regex so the JSON schema below keeps the length cap
    count: z.number().int().min(1).max(10),
    sky: z.boolean(),
  })).max(12),
});

/**
 * Keeps entry order and lowers counts from the last object until Σcount ≤ max (Requirements 3.5, 5.11).
 * An object lowered to 0 is removed, since count must stay 1–10. Pure: returns a new scene.
 */
export const capInstances = (max: number) => (scene: z.output<typeof SparkSceneBase>): z.output<typeof SparkSceneBase> => {
  let left = max; // walking forward and spending a budget lowers the tail first, same as lowering from the end
  const objects = scene.objects.map((o) => { const count = Math.min(o.count, left); left -= count; return { ...o, count }; });
  return { ...scene, objects: objects.filter((o) => o.count > 0) };
};

export const SparkScene = SparkSceneBase.transform(capInstances(30));
export type SparkScene = z.output<typeof SparkScene>;

// JSON schema for Spark's text.format. Built from SparkSceneBase because zod can't express a transform in
// JSON Schema. It meets the strict subset (every object has additionalProperties: false and requires all its keys).
// `pattern` is dropped: the Meta docs don't say whether constrained decoding supports regex (\p{L} in particular),
// so zod's recheck of the reply enforces the title and noun charsets, and understand retries once on failure.
export const SPARK_SCENE_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(SparkSceneBase, {
  override: ({ jsonSchema }) => { delete jsonSchema.pattern; },
});
delete SPARK_SCENE_JSON_SCHEMA.$schema; // not part of the documented examples; the root type is enough
