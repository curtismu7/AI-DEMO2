import { describe, it, expect } from "vitest";
import { handlePoint, isObstacle, routeSlideEdges, sideDir } from "../pingSlideRouting";

const box = (x, y, w, h, kind = "card") => ({ x, y, w, h, kind });

describe("pingSlideRouting", () => {
  it("zone, panel, boundary and text are not obstacles; service boxes are", () => {
    for (const kind of ["zone", "panel", "boundary", "text"]) expect(isObstacle({ kind })).toBe(false);
    for (const kind of ["card", "redcard", "ping", "servers", "gateway", "user"]) expect(isObstacle({ kind })).toBe(true);
  });

  it("handle points sit on the box edge; off slides along the side; lt is a left handle 31px down", () => {
    const r = box(100, 200, 80, 40);
    expect(handlePoint(r, "r")).toEqual({ x: 180, y: 220 });
    expect(handlePoint(r, "l", 5)).toEqual({ x: 100, y: 225 });
    expect(handlePoint(r, "t", -10)).toEqual({ x: 130, y: 200 });
    expect(handlePoint(r, "b")).toEqual({ x: 140, y: 240 });
    expect(handlePoint(r, "lt")).toEqual({ x: 100, y: 231 });
    expect(sideDir("lt")).toBe("l");
  });

  it("routes around a box between source and target with only horizontal/vertical runs", () => {
    const rects = { a: box(0, 100, 80, 40), mid: box(200, 90, 80, 60), b: box(400, 100, 80, 40) };
    const { routes, fallbacks } = routeSlideEdges([{ from: "a", to: "b", fs: "r", ts: "l" }], rects);
    expect(fallbacks).toBe(0);
    const { pts, ok } = routes.e0;
    expect(ok).toBe(true);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
    // no point of the path lies inside the middle box
    for (let i = 1; i < pts.length; i++) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
        expect(x > 200 && x < 280 && y > 90 && y < 150).toBe(false);
      }
    }
  });

  it("a zone between the boxes does not force a detour", () => {
    const rects = { a: box(0, 100, 80, 40), zone: box(150, 0, 100, 300, "zone"), b: box(400, 100, 80, 40) };
    const { routes } = routeSlideEdges([{ from: "a", to: "b", fs: "r", ts: "l" }], rects);
    expect(routes.e0.pts.length).toBeLessThanOrEqual(4);
  });

  it("counts a fallback when the target is walled in", () => {
    const rects = { a: box(0, 100, 80, 40), b: box(400, 100, 80, 40), w1: box(330, 40, 20, 160), w2: box(530, 40, 20, 160), w3: box(330, 40, 220, 20), w4: box(330, 180, 220, 20) };
    const { routes, fallbacks } = routeSlideEdges([{ from: "a", to: "b", fs: "r", ts: "l" }], rects);
    expect(routes.e0.ok).toBe(false);
    expect(fallbacks).toBe(1);
  });

  it("a container that already holds the edge's handle is ignored for that edge", () => {
    const rects = { outer: box(0, 0, 300, 200, "redcard"), inner: box(20, 60, 80, 40), b: box(400, 70, 60, 40) };
    const { routes } = routeSlideEdges([{ from: "inner", to: "b", fs: "r", ts: "l" }], rects);
    expect(routes.e0.ok).toBe(true);
  });
});
