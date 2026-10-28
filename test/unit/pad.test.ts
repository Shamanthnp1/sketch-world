import { describe, expect, it } from "vitest";
import { PAD_H, PAD_W, StrokeModel, toCanvas, WIDTHS } from "../../src/pad/pad";

const p = (x: number, y = 0) => ({ x, y });

describe("StrokeModel", () => {
  it("collects points into the stroke being drawn, with its width", () => {
    const m = new StrokeModel();
    m.start(p(1), 4);
    m.add(p(2));
    m.end();
    m.start(p(3), 22);
    m.add(p(4));
    m.add(p(5));
    m.end();
    expect(m.strokes).toEqual([{ width: 4, pts: [p(1), p(2)] }, { width: 22, pts: [p(3), p(4), p(5)] }]);
  });

  it("takes no points after a stroke ends", () => {
    const m = new StrokeModel();
    m.start(p(1), 10);
    m.end();
    expect(m.add(p(2))).toBeNull();
    expect(m.strokes[0].pts).toEqual([p(1)]);
  });

  it("undo removes the most recent stroke, and is a no-op on an empty pad", () => {
    const m = new StrokeModel();
    m.undo();
    expect(m.strokes).toEqual([]);
    m.start(p(1), 4);
    m.end();
    m.start(p(2), 10);
    m.end();
    m.undo();
    expect(m.strokes).toEqual([{ width: 4, pts: [p(1)] }]);
  });

  it("undo during a stroke removes that stroke and stops it taking points", () => {
    const m = new StrokeModel();
    m.start(p(1), 4);
    m.end();
    m.start(p(2), 10);
    m.undo();
    expect(m.add(p(3))).toBeNull();
    expect(m.strokes).toEqual([{ width: 4, pts: [p(1)] }]);
  });

  it("clear empties the pad; undo right after brings the drawing back", () => {
    const m = new StrokeModel();
    m.start(p(1), 4);
    m.end();
    m.start(p(2), 22);
    m.end();
    const drawn = structuredClone(m.strokes);
    m.clear();
    expect(m.strokes).toEqual([]);
    m.undo();
    expect(m.strokes).toEqual(drawn);
  });

  it("a new stroke after clear drops the cleared drawing", () => {
    const m = new StrokeModel();
    m.start(p(1), 4);
    m.end();
    m.clear();
    m.start(p(2), 10);
    m.end();
    m.undo();
    m.undo();
    expect(m.strokes).toEqual([]);
  });
});

describe("toCanvas", () => {
  it("maps a pad shown at 512 × 384 to the 1024 × 768 canvas", () => {
    const rect = { left: 100, top: 50, width: 512, height: 384 };
    expect(toCanvas(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(toCanvas(612, 434, rect)).toEqual({ x: PAD_W, y: PAD_H });
    expect(toCanvas(356, 242, rect)).toEqual({ x: 512, y: 384 });
  });

  it("is the identity at full size and runs past the edge without clamping", () => {
    const rect = { left: 0, top: 0, width: PAD_W, height: PAD_H };
    expect(toCanvas(300, 200, rect)).toEqual({ x: 300, y: 200 });
    expect(toCanvas(-10, PAD_H + 5, rect)).toEqual({ x: -10, y: PAD_H + 5 });
  });
});

it("offers brush widths of 4, 10 and 22 px on a 1024 × 768 pad", () => {
  expect(WIDTHS).toEqual([4, 10, 22]);
  expect([PAD_W, PAD_H]).toEqual([1024, 768]);
});
