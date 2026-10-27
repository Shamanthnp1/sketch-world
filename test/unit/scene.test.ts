import { describe, expect, it } from "vitest";
import { ALL_TYPES, group, SPARK_SCENE_JSON_SCHEMA, SparkScene, TYPES } from "../../shared/scene";

const obj = { type: "tree", noun: "fir tree", count: 2, sky: false };
const scene = { title: "My village", view: "side", isDrawing: true, safe: true, objects: [obj] };
const ok = (patch: object) => SparkScene.safeParse({ ...scene, ...patch }).success;
const okObj = (patch: object) => ok({ objects: [{ ...obj, ...patch }] });

describe("TYPES, ALL_TYPES and group", () => {
  it("lists the 22 design.md types once each and maps them to their group", () => {
    expect(ALL_TYPES).toHaveLength(22);
    expect(new Set(ALL_TYPES).size).toBe(22);
    for (const [g, types] of Object.entries(TYPES)) for (const t of types) expect(group(t)).toBe(g);
  });
});

describe("SparkScene", () => {
  it("accepts a valid scene unchanged", () => {
    expect(SparkScene.parse(scene)).toEqual(scene);
  });
  it("checks title length 1–60", () => {
    expect(ok({ title: "a".repeat(60) })).toBe(true);
    expect(ok({ title: "a".repeat(61) })).toBe(false);
    expect(ok({ title: "" })).toBe(false);
  });
  it("allows letters in any script, digits, spaces and ',.!?-", () => {
    expect(ok({ title: "Café Ünter-den-Linden, 2 trees! Isn't it? Ok." })).toBe(true);
    expect(ok({ title: "日本の村" })).toBe(true);
  });
  it.each(["<b>hi</b>", 'say "hi"', "line\nbreak", "tab\there", "a/b", "sun 🌞", "{x}"])("rejects title %j", (title) => {
    expect(ok({ title })).toBe(false);
  });
  it("checks view and the boolean flags", () => {
    expect(ok({ view: "top" })).toBe(true);
    expect(ok({ view: "front" })).toBe(false);
    expect(ok({ isDrawing: "true" })).toBe(false);
    expect(ok({ safe: 1 })).toBe(false);
  });
  it("allows 0 to 12 objects", () => {
    expect(ok({ objects: [] })).toBe(true);
    expect(ok({ objects: Array(12).fill(obj) })).toBe(true);
    expect(ok({ objects: Array(13).fill(obj) })).toBe(false);
  });
  it("rejects an unknown type", () => {
    expect(okObj({ type: "dragon" })).toBe(false);
    expect(okObj({ type: "Tree" })).toBe(false);
  });
  it.each(["a", "t-rex", "fir tree", "a" + "b".repeat(39)])("accepts noun %j", (noun) => {
    expect(okObj({ noun })).toBe(true);
  });
  it.each(["", "Tree", "tree2", " tree", "-tree", "tree\n", "café", "a" + "b".repeat(40)])("rejects noun %j", (noun) => {
    expect(okObj({ noun })).toBe(false);
  });
  it("checks count is an integer 1–10", () => {
    expect(okObj({ count: 1 })).toBe(true);
    expect(okObj({ count: 10 })).toBe(true);
    for (const count of [0, 11, 1.5, "2"]) expect(okObj({ count })).toBe(false);
  });
  it("requires sky as a boolean", () => {
    expect(okObj({ sky: true })).toBe(true);
    expect(okObj({ sky: "no" })).toBe(false);
    expect(ok({ objects: [{ type: "tree", noun: "tree", count: 1 }] })).toBe(false);
  });
});

describe("SPARK_SCENE_JSON_SCHEMA", () => {
  type Node = { type?: string; properties?: Record<string, Node>; required?: string[]; additionalProperties?: unknown; items?: Node };
  const nodes = (n: Node): Node[] => [n, ...Object.values(n.properties ?? {}).flatMap(nodes), ...(n.items ? nodes(n.items) : [])];
  const root = SPARK_SCENE_JSON_SCHEMA as Node;

  it("meets the strict subset and has no pattern, format or $schema keys", () => {
    expect(root.type).toBe("object");
    for (const n of nodes(root)) {
      expect(n).not.toHaveProperty("pattern");
      expect(n).not.toHaveProperty("format");
      if (n.type === "object") {
        expect(n.additionalProperties).toBe(false);
        expect(n.required).toEqual(Object.keys(n.properties ?? {}));
      }
    }
    expect(root).not.toHaveProperty("$schema");
  });
  it("keeps the enums and the size caps", () => {
    const o = root.properties!.objects as Node & { maxItems: number };
    const p = o.items!.properties! as Record<string, Record<string, unknown>>;
    expect(o.maxItems).toBe(12);
    expect(p.type.enum).toEqual(ALL_TYPES);
    expect(p.noun).toMatchObject({ minLength: 1, maxLength: 40 });
    expect(p.count).toMatchObject({ type: "integer", minimum: 1, maximum: 10 });
    expect(root.properties!.title).toMatchObject({ minLength: 1, maxLength: 60 });
    expect(root.properties!.view).toMatchObject({ enum: ["side", "top"] });
  });
});
