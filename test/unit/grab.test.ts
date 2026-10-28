import { describe, expect, it } from "vitest";
import { Moves } from "../../shared/saved";
import {
  DRAG_PX, HOLD_MS, HOLD_PX, dragHit, dragRadius, movesOf, planeHit, pressState, resetPositions, skyHit, type Card,
} from "../../src/world/build";
import { PLAYER_R, SPAWN, WANDER_PAD, WORLD_BOUNDS, step, walkCircles } from "../../src/world/collide";
import { placeDrag } from "../../src/world/drag";
import type { Placed } from "../../src/world/layout";
import { SKY_R, type Vec3 } from "../../src/world/space";
import { clearOf } from "../../src/world/walk";

const EYE: Vec3 = { x: 0, y: 1.7, z: 9 };
const norm = (d: Vec3) => { const l = Math.hypot(d.x, d.y, d.z); return { x: d.x / l, y: d.y / l, z: d.z / l }; };
const near = (a: Vec3, b: Vec3, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
};

describe("drag surfaces", () => {
  it("upright and flat Cards follow the ray's point on the ground plane", () => {
    const d = norm({ x: 0, y: -1, z: -1 }); // 45° down from eye height 1.7
    for (const kind of ["upright", "flat"] as const) near(dragHit(kind, EYE, d, EYE, { x: 0, y: 0, z: -1 }), { x: 0, y: 0, z: 9 - 1.7 });
  });
  it("gives no ground point for a ray level with or above the horizon", () => {
    for (const d of [{ x: 0, y: 0, z: -1 }, { x: 0.3, y: 0.2, z: -1 }]) expect(Number.isNaN(planeHit(EYE, d, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }).x)).toBe(true);
    // and placeDrag keeps the Card where it was
    const from = { x: 1, y: 0, z: 2 }, to = planeHit(EYE, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(placeDrag({ to, from, r: 0.3 }, "upright", WORLD_BOUNDS, [], SPAWN)).toBe(from);
  });
  it("float Cards move on the vertical plane through the Card facing the camera", () => {
    const at = { x: 2, y: 3, z: -3 }, forward = { x: 0, y: -0.3, z: -0.95 }; // camera pitched down: the plane stays vertical
    const p = dragHit("float", EYE, { x: 0.1, y: 0.05, z: -1 }, at, forward);
    near(p, { x: 1.2, y: 2.3, z: -3 }); // t = 12 to reach z = −3
    const turned = dragHit("float", EYE, norm({ x: -1, y: 0.1, z: 0 }), { x: -2, y: 3, z: 0 }, { x: -1, y: 0, z: 0 }); // facing −x: plane x = −2
    expect(turned.x).toBeCloseTo(-2, 9);
    expect(turned.y).toBeGreaterThan(EYE.y);
    expect(Number.isNaN(dragHit("float", EYE, { x: 0, y: 0, z: 1 }, at, forward).x)).toBe(true); // the plane is behind
  });
  it("sky Cards follow the ray's point on the SKY_R sphere, so placeDrag reads its azimuth and elevation", () => {
    near(skyHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -3 }), { x: 0, y: 0, z: -SKY_R });
    for (const d of [{ x: 0, y: 0.5, z: -1 }, { x: 1, y: 0.2, z: 0.1 }, { x: -0.4, y: 1, z: 0.6 }]) {
      const p = dragHit("sky", EYE, d, EYE, { x: 0, y: 0, z: -1 }), u = norm(d), t = Math.hypot(p.x - EYE.x, p.y - EYE.y, p.z - EYE.z);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(SKY_R, 9);
      near(p, { x: EYE.x + u.x * t, y: EYE.y + u.y * t, z: EYE.z + u.z * t }); // on the ray, ahead of the camera
    }
    const p = placeDrag({ to: skyHit(EYE, { x: 0, y: -1, z: -1 }), from: { x: 0, y: 20, z: -34 }, r: 0 }, "sky", WORLD_BOUNDS, [], SPAWN);
    expect((Math.atan2(p.y, Math.hypot(p.x, p.z)) * 180) / Math.PI).toBeCloseTo(10, 9); // below the horizon → 10°
  });
});

describe("pressState", () => {
  it("mouse and pen: a press on a Card drags after more than 4 px, however long it is held", () => {
    expect(pressState("wait", false, DRAG_PX, 5000)).toBe("wait");
    expect(pressState("wait", false, DRAG_PX + 0.1, 0)).toBe("drag");
  });
  it("touch: 350 ms held within 8 px picks the Card up", () => {
    expect(pressState("wait", true, 0, HOLD_MS - 1)).toBe("wait");
    expect(pressState("wait", true, DRAG_PX + 1, HOLD_MS - 1)).toBe("wait"); // more than a tap, still not a look
    expect(pressState("wait", true, HOLD_PX, HOLD_MS)).toBe("drag");
  });
  it("touch: moving more than 8 px before 350 ms looks instead", () => {
    expect(pressState("wait", true, HOLD_PX + 0.1, 100)).toBe("look");
    expect(pressState("wait", true, HOLD_PX + 0.1, HOLD_MS + 100)).toBe("look"); // a late timer doesn't turn a move into a pick-up
  });
  it("a look never becomes a drag and a drag never becomes a look", () => {
    for (const touch of [false, true]) {
      expect(pressState("look", touch, 0, HOLD_MS * 2)).toBe("look");
      expect(pressState("drag", touch, 999, 0)).toBe("drag");
    }
  });
});

const card = (id: number, kind: Placed["kind"], type: Card["type"], x: number, z: number, r?: number) => {
  const placed: Placed = { id, kind, x, y: kind === "flat" ? 0.01 : 0, z, w: 1, h: 1, ...(r ? { collide: { x, z, r } } : {}) };
  return { id, kind, type, placed, pos: { x, y: placed.y, z } };
};

describe("moves", () => {
  it("lists only Cards away from their layout position, keyed by id, and Reset positions clears it", () => {
    const cards = [card(0, "upright", "house", 1, 2, 0.8), card(3, "flat", "water", -4, 0), card(7, "upright", "tree", 5, 1, 0.3)];
    expect(movesOf(cards)).toEqual({});
    cards[1].pos = { x: -3, y: 0.01, z: 0.5 };
    cards[2].pos = { ...cards[2].pos };            // same place, new object: not a move
    expect(movesOf(cards)).toEqual({ 3: { x: -3, y: 0.01, z: 0.5 } });
    expect(Moves.safeParse(movesOf(cards)).success).toBe(true); // the SavedScene.moves shape
    cards[0].pos = { x: 1, y: 0, z: 2.25 };
    expect(Object.keys(movesOf(cards))).toEqual(["0", "3"]);
    resetPositions(cards);
    expect(movesOf(cards)).toEqual({});
    expect(cards.map((c) => c.pos)).toEqual(cards.map((c) => ({ x: c.placed.x, y: c.placed.y, z: c.placed.z })));
  });
});

describe("drop traps", () => {
  const player = SPAWN, away = { x: -0.2, z: 0 };
  const walking = (c: ReturnType<typeof card>, at: Vec3) => walkCircles([{ ...c, collide: { ...c.placed.collide!, x: at.x, z: at.z } }]);

  it("a wandering Card keeps its widened walking circle clear of the player, so the player can still walk", () => {
    const person = card(1, "upright", "person", 0, 2, 0.3);
    expect(dragRadius(person)).toBeCloseTo(0.3 + WANDER_PAD, 12);
    expect(dragRadius(card(2, "upright", "house", 0, 0, 1))).toBe(1);
    expect(dragRadius(card(3, "float", "bird", 0, 0))).toBe(0);
    const to = { x: player.x + 0.9, y: 0, z: player.z }; // right next to the player
    // With only its own r, placeDrag accepts it, and the player ends up inside the circle `step` walks against.
    const trap = placeDrag({ to, from: person.pos, r: 0.3 }, "upright", WORLD_BOUNDS, [], player);
    expect(step(player, away, walking(person, trap), WORLD_BOUNDS)).toEqual(player); // stuck, even walking away
    // With the walking radius, the drop is pushed out, and the player walks anywhere but into it.
    const p = placeDrag({ to, from: person.pos, r: dragRadius(person) }, "upright", WORLD_BOUNDS, [], player);
    expect(Math.hypot(p.x - player.x, p.z - player.z)).toBeGreaterThanOrEqual(0.3 + WANDER_PAD + PLAYER_R);
    for (const d of [away, { x: 0, z: -0.2 }, { x: 0, z: 0.2 }]) expect(step(player, d, walking(person, p), WORLD_BOUNDS)).not.toEqual(player);
  });

  it("walk ignores a circle that already holds the player, so the player can walk out of it", () => {
    const inside = { x: player.x + 0.5, z: player.z, r: 1 }, other = { x: 0, z: 0, r: 1 };
    expect(clearOf([inside, other], player)).toEqual([other]);
    expect(step(player, { x: -0.25, z: 0 }, [inside, other], WORLD_BOUNDS)).toEqual(player); // stuck without it
    expect(step(player, { x: -0.25, z: 0 }, clearOf([inside, other], player), WORLD_BOUNDS)).toEqual({ x: player.x - 0.25, z: player.z });
    expect(clearOf([{ x: player.x + 1.3, z: player.z, r: 1 }], player)).toHaveLength(1); // touching is outside, as in step
  });
});
