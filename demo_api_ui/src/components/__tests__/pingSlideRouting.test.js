import { describe, it, expect } from "vitest";
import { handlePoint, isObstacle, labelSize, nearestOnPath, placeLabel, routeSlideEdges, sideDir } from "../pingSlideRouting";

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

  it("nearestOnPath pulls a tuned label spot onto the routed line", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }];
    expect(nearestOnPath(pts, { x: 40, y: 30 })).toEqual({ x: 40, y: 0 });
    expect(nearestOnPath(pts, { x: 130, y: 60 })).toEqual({ x: 100, y: 60 });
    expect(nearestOnPath(pts, { x: -50, y: -9 })).toEqual({ x: 0, y: 0 });
  });

  it("placeLabel keeps the label on the line when clear, steps off it when a card is in the way, and avoids earlier labels", () => {
    const pts = [{ x: 0, y: 100 }, { x: 400, y: 100 }];
    const size = { w: 80, h: 30 };
    const taken = [];
    const p1 = placeLabel(pts, { x: 200, y: 110 }, size, [], taken);
    expect(p1.y).toBe(100);
    expect(Math.abs(p1.x - 200)).toBeLessThan(6);
    // second label wants the same spot: slides along or beside, never overlapping the first
    const p2 = placeLabel(pts, { x: 200, y: 110 }, size, [], taken);
    expect(Math.abs(p2.x - p1.x) >= 80 || Math.abs(p2.y - 100) >= 30).toBe(true);
    // a card right on the wanted spot pushes the label to clear air
    const card = { x: 150, y: 80, w: 100, h: 40 };
    const p3 = placeLabel(pts, { x: 200, y: 100 }, size, [card], []);
    expect(p3.x - 40 >= 250 - 1 || p3.x + 40 <= 150 + 1 || p3.y - 15 >= 120 - 1 || p3.y + 15 <= 80 + 1).toBe(true);
  });

  it("labelSize grows with sub text and badge, capped at 230 wide", () => {
    expect(labelSize({ label: "A" }).h).toBeLessThan(labelSize({ label: "A", sub: "x\ny" }).h);
    expect(labelSize({ label: "x".repeat(100), n: "1" }).w).toBe(230);
  });

  it("routeSlideEdges returns a label centre for each routed, labelled edge", () => {
    const rects = { a: box(0, 0, 80, 40), b: box(400, 0, 80, 40) };
    const { labels, fallbacks } = routeSlideEdges([{ from: "a", to: "b", fs: "r", ts: "l", label: "Hi", dy: -10 }], rects);
    expect(fallbacks).toBe(0);
    expect(labels.e0).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });
});
