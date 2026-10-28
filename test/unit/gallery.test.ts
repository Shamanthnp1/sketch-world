import { describe, expect, it } from "vitest";
import type { GalleryWorld } from "../../shared/saved";
import { galleryGroups } from "../../src/ui/gallery";
import { stripItems, STRIP_MAX } from "../../src/ui/home";

const w = (id: string, createdAt = 0): GalleryWorld => ({ id: id.padEnd(10, "0"), title: `World ${id}`, thumb: `/a/w/${id.padEnd(10, "0")}/thumb.jpg`, createdAt });
const ids = (list: { id: string }[]) => list.map((x) => x.id[0]);

describe("stripItems (the Home strip)", () => {
  it("puts the samples first, then the newest, each world once, at most 6, without createdAt", () => {
    const worlds = ["a", "b", "S", "c", "d", "e", "f"].map((id, i) => w(id, 100 - i));
    const items = stripItems({ samples: [w("S"), w("T")], worlds });
    expect(ids(items)).toEqual(["S", "T", "a", "b", "c", "d"]);
    expect(items).toHaveLength(STRIP_MAX);
    expect(items[0]).toEqual({ id: "S000000000", title: "World S", thumb: "/a/w/S000000000/thumb.jpg" });
  });

  it("is the newest alone without samples, and empty for an empty gallery", () => {
    expect(ids(stripItems({ samples: [], worlds: [w("a"), w("b")] }))).toEqual(["a", "b"]);
    expect(stripItems({ samples: [], worlds: [] })).toEqual([]);
  });
});

describe("galleryGroups (the Gallery page)", () => {
  it("keeps the samples in order and drops them from the newest, which stay newest first", () => {
    const g = galleryGroups({ samples: [w("S"), w("T")], worlds: [w("a", 3), w("T", 2), w("b", 1)] });
    expect(ids(g.samples)).toEqual(["S", "T"]);
    expect(ids(g.newest)).toEqual(["a", "b"]);
  });
});
