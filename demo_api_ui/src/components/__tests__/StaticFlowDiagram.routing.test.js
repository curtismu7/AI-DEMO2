import { describe, it, expect } from "vitest";
import { attachPoints, pickLabel, routeEdges } from "../StaticFlowDiagram";

const box = (x, y) => ({ x, y, w: 250, h: 60 });
const edge = (id, source, target, sourceHandle, targetHandle, self = false) => ({ id, source, target, sourceHandle, targetHandle, data: { self } });

describe("StaticFlowDiagram routeEdges", () => {
  it("routes around a box sitting between two others, honouring the handle sides", () => {
    const rects = { a: box(0, 0), mid: box(400, 0), b: box(800, 0) };
    const { routes, fallbacks } = routeEdges(rects, [edge("e0", "a", "b", "sr", "tl")]);
    const r = routes.e0;
    expect(fallbacks).toBe(0);
    expect(r.ok).toBe(true);
    // leaves the right side of a, enters the left side of b (the slot is snapped to a grid line near the middle)
    expect(r.pts[0].x).toBe(250);
    expect(r.pts.at(-1).x).toBe(800);
    expect(Math.abs(r.pts[0].y - 30)).toBeLessThanOrEqual(10);
    // every segment is horizontal or vertical and none enters the middle box
    for (let i = 1; i < r.pts.length; i++) {
      const [p, q] = [r.pts[i - 1], r.pts[i]];
      expect(p.x === q.x || p.y === q.y).toBe(true);
      const inside = (pt) => pt.x > 400 && pt.x < 650 && pt.y > 0 && pt.y < 60;
      expect(inside(p) && inside(q)).toBe(false);
    }
  });

  it("uses the bottom/top handles for vertical edges", () => {
    const rects = { a: box(0, 0), b: box(0, 300) };
    const { routes } = routeEdges(rects, [edge("e0", "a", "b", "sb", "tt")]);
    expect(routes.e0.pts[0].y).toBe(60);
    expect(routes.e0.pts.at(-1).y).toBe(300);
    expect(Math.abs(routes.e0.pts[0].x - 125)).toBeLessThanOrEqual(10);
  });

  it("leaves self-loops and edges to unknown boxes unrouted", () => {
    const rects = { a: box(0, 0) };
    const { routes, fallbacks } = routeEdges(rects, [edge("e0", "a", "a", "sr", "tr", true), edge("e1", "a", "gone", "sr", "tl")]);
    expect(routes).toEqual({});
    expect(fallbacks).toBe(0);
  });

  it("counts an edge the router cannot place as a fallback", () => {
    // Target handle buried inside another box: no route, caller draws the old curve.
    const rects = { a: box(0, 0), b: box(400, 0), blocker: { x: 300, y: -200, w: 600, h: 400 } };
    const { routes, fallbacks } = routeEdges(rects, [edge("e0", "a", "b", "sr", "tl")]);
    expect(routes.e0.ok).toBe(false);
    expect(fallbacks).toBe(1);
  });
});

describe("StaticFlowDiagram attachPoints", () => {
  const rects = { a: box(0, 0), x: box(500, -200), y: box(500, 0), z: box(500, 200) };
  const edges = [edge("e0", "a", "x", "sr", "tl"), edge("e1", "a", "y", "sr", "tl"), edge("e2", "a", "z", "sr", "tl")];

  it("gives arrows that share a side their own point on that side, ordered by where they go", () => {
    const att = attachPoints(rects, edges);
    const ys = ["e0", "e1", "e2"].map((id) => att[id].start.y);
    expect(new Set(ys).size).toBe(3);
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
    for (const id of ["e0", "e1", "e2"]) {
      expect(att[id].start.x).toBe(250);
      expect(att[id].start.y).toBeGreaterThan(0);
      expect(att[id].start.y).toBeLessThan(60);
      expect(att[id].end.x).toBe(500);
    }
  });

  it("keeps the forced side: bottom to top uses x on the box edge", () => {
    const att = attachPoints({ a: box(0, 0), b: box(0, 300) }, [edge("e0", "a", "b", "sb", "tt")]);
    expect(att.e0.start.y).toBe(60);
    expect(att.e0.end.y).toBe(300);
    expect(att.e0.start.x).toBe(att.e0.end.x);
  });

  it("skips self-loops and unknown boxes", () => {
    expect(attachPoints({ a: box(0, 0) }, [edge("e0", "a", "a", "sr", "tr", true), edge("e1", "a", "gone", "sr", "tl")])).toEqual({});
  });
});

describe("StaticFlowDiagram pickLabel", () => {
  const line = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
  it("uses the middle of the longest run when nothing is there", () => {
    expect(pickLabel(line, [])).toEqual({ x: 100, y: 0 });
  });
  it("moves along the line when another badge already sits on the middle", () => {
    const p = pickLabel(line, [{ x: 100, y: 0 }]);
    expect(p.y).toBe(0);
    expect(Math.abs(p.x - 100)).toBeGreaterThanOrEqual(30);
  });
  it("falls back to the midpoint for a route with no run long enough", () => {
    expect(pickLabel([{ x: 0, y: 0 }, { x: 10, y: 0 }], [])).toEqual({ x: 5, y: 0 });
  });
});

describe("StaticFlowDiagram routeEdges badges", () => {
  it("does not stack the badges of arrows that share a corridor", () => {
    const rects = { a: box(0, 0), b: box(500, 0), c: box(500, 200) };
    const { routes } = routeEdges(rects, [edge("e0", "a", "b", "sr", "tl"), edge("e1", "a", "c", "sr", "tl")]);
    const d = Math.hypot(routes.e0.label.x - routes.e1.label.x, routes.e0.label.y - routes.e1.label.y);
    expect(d).toBeGreaterThanOrEqual(30);
  });
});
