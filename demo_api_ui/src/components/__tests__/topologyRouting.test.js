import { describe, expect, it } from "vitest";
import { rectsKey, routeTopologyEdges, serverRects } from "../topologyRouting";
import { SERVER_EDGES, SERVER_MAP } from "../serverTopologyData";

const node = (id, x, y, extra = {}) => ({ id, type: "server", internals: { positionAbsolute: { x, y } }, measured: { width: 218, height: 104 }, ...extra });
const inside = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

describe("topology routing helpers", () => {
  it("reads absolute rects from server nodes only, with fallback sizes before measuring", () => {
    const rects = serverRects([node("a", 10, 20), node("z", 0, 0, { type: "zone" }), { id: "b", type: "server", internals: { positionAbsolute: { x: 5, y: 6 } } }]);
    expect(Object.keys(rects)).toEqual(["a", "b"]);
    expect(rects.a).toEqual({ x: 10, y: 20, w: 218, h: 104 });
    expect(rects.b).toEqual({ x: 5, y: 6, w: 218, h: 104 });
  });

  it("changes its key only when a box moves or resizes, and ignores zones", () => {
    const base = [node("a", 10, 20), node("z", 0, 0, { type: "zone" })];
    expect(rectsKey(base)).toBe(rectsKey([node("a", 10.2, 20.4), node("z", 99, 99, { type: "zone" })]));
    expect(rectsKey(base)).not.toBe(rectsKey([node("a", 10, 40), base[1]]));
    expect(rectsKey(base)).not.toBe(rectsKey([node("a", 10, 20, { measured: { width: 218, height: 120 } }), base[1]]));
  });

  it("routes around a box standing between source and target, and skips edges with a missing endpoint", () => {
    const rects = { a: { x: 0, y: 100, w: 218, h: 104 }, mid: { x: 300, y: 100, w: 218, h: 104 }, b: { x: 600, y: 100, w: 218, h: 104 } };
    const { routes, fallbacks } = routeTopologyEdges(rects, [{ id: "ab", source: "a", target: "b" }, { id: "ax", source: "a", target: "gone" }]);
    expect(fallbacks).toBe(0);
    expect(routes.ax).toBeUndefined();
    expect(routes.ab.ok).toBe(true);
    expect(routes.ab.pts[0]).toEqual({ x: 218, y: 152 });
    expect(routes.ab.pts.at(-1)).toEqual({ x: 600, y: 152 });
    expect(routes.ab.pts.slice(1, -1).some((p) => inside(p, rects.mid))).toBe(false);
  });

  it("counts a fallback when a box is walled in", () => {
    const rects = { a: { x: 0, y: 0, w: 100, h: 100 }, b: { x: 112, y: 0, w: 100, h: 100 } };
    const { routes, fallbacks } = routeTopologyEdges(rects, [{ id: "ba", source: "b", target: "a" }]);
    expect(fallbacks).toBe(routes.ba.ok ? 0 : 1);
  });

  it("returns nothing, without throwing, before any box exists", () => {
    expect(routeTopologyEdges({}, SERVER_EDGES)).toEqual({ routes: {}, fallbacks: 0 });
  });

  it("routes every edge of the real layout with no fallback and no bend inside a box", () => {
    const rects = Object.fromEntries(SERVER_MAP.map((n) => [n.id, { x: n.position.x, y: n.position.y, w: 218, h: 104 }]));
    const { routes, fallbacks } = routeTopologyEdges(rects, SERVER_EDGES);
    expect(fallbacks).toBe(0);
    expect(Object.keys(routes)).toHaveLength(SERVER_EDGES.length);
    for (const route of Object.values(routes)) {
      route.pts.slice(1, -1).forEach((p) => Object.values(rects).forEach((r) => expect(inside(p, r)).toBe(false)));
    }
  });
});
