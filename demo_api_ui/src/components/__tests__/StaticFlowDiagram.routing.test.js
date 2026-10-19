import { describe, it, expect } from "vitest";
import { routeEdges } from "../StaticFlowDiagram";

const box = (x, y) => ({ x, y, w: 250, h: 60 });
const edge = (id, source, target, sourceHandle, targetHandle, self = false) => ({ id, source, target, sourceHandle, targetHandle, data: { self } });

describe("StaticFlowDiagram routeEdges", () => {
  it("routes around a box sitting between two others, honouring the handle sides", () => {
    const rects = { a: box(0, 0), mid: box(400, 0), b: box(800, 0) };
    const { routes, fallbacks } = routeEdges(rects, [edge("e0", "a", "b", "sr", "tl")]);
    const r = routes.e0;
    expect(fallbacks).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.pts[0]).toEqual({ x: 250, y: 30 });
    expect(r.pts.at(-1)).toEqual({ x: 800, y: 30 });
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
    expect(routes.e0.pts[0]).toEqual({ x: 125, y: 60 });
    expect(routes.e0.pts.at(-1)).toEqual({ x: 125, y: 300 });
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
