import { describe, expect, it } from "vitest";
import { pickSides, rectsKey, routeTopologyEdges, serverRects, spreadSharedRuns } from "../topologyRouting";
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

  it("gives no key while a box is unmeasured, so a step does not trigger a second routing", () => {
    expect(rectsKey([node("a", 10, 20), { id: "b", type: "server", internals: { positionAbsolute: { x: 5, y: 6 } } }])).toBeNull();
    expect(rectsKey([node("a", 10, 20), node("z", 0, 0, { type: "zone", measured: undefined })])).toMatch(/^a:10,20,218,104\|$/);
  });

  it("picks the sides facing the target: right to left, left to right, else top and bottom", () => {
    const a = { x: 500, y: 500, w: 218, h: 104 };
    expect(pickSides(a, { x: 900, y: 0, w: 218, h: 104 })).toEqual(["r", "l"]);
    expect(pickSides(a, { x: 100, y: 900, w: 218, h: 104 })).toEqual(["l", "r"]);
    expect(pickSides(a, { x: 520, y: 900, w: 218, h: 104 })).toEqual(["b", "t"]);
    expect(pickSides(a, { x: 520, y: 100, w: 218, h: 104 })).toEqual(["t", "b"]);
  });

  it("starts each arrow of one side, and parallel arrows between the same two boxes, at its own point", () => {
    const rects = { a: { x: 0, y: 0, w: 218, h: 104 }, b: { x: 700, y: 0, w: 218, h: 104 } };
    const { routes } = routeTopologyEdges(rects, [{ id: "one", source: "a", target: "b" }, { id: "two", source: "a", target: "b" }]);
    expect(routes.one.pts[0].y).not.toBe(routes.two.pts[0].y);
    expect(routes.one.pts.at(-1).y).not.toBe(routes.two.pts.at(-1).y);
    expect(routes.one.pts[0].x).toBe(218);
    expect(routes.one.pts.at(-1).x).toBe(700);
  });

  it("leaves a target on its left from the left side of the source and enters the right side", () => {
    const rects = { a: { x: 700, y: 0, w: 218, h: 104 }, b: { x: 0, y: 0, w: 218, h: 104 } };
    const { routes } = routeTopologyEdges(rects, [{ id: "ab", source: "a", target: "b" }]);
    expect(routes.ab.pts[0].x).toBe(700);
    expect(routes.ab.pts.at(-1).x).toBe(218);
  });

  it("slides a run that lies exactly on another arrow's run to a free line, and leaves the lead segments alone", () => {
    const rects = { box: { x: 1000, y: 1000, w: 10, h: 10 } };
    const mk = () => ({ ok: true, pts: [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }, { x: 186, y: 300 }, { x: 200, y: 300 }] });
    const out = spreadSharedRuns({ a: mk(), b: mk() }, rects, [{ id: "a" }, { id: "b" }]);
    expect(out.a.pts[2].x).toBe(100);
    expect(out.b.pts[2].x).not.toBe(100);
    expect(out.b.pts[2].x).toBe(out.b.pts[3].x);
    expect(out.b.pts[0]).toEqual({ x: 0, y: 0 });
    expect(out.b.pts[1]).toEqual({ x: 14, y: 0 });
    expect(out.b.pts.at(-1)).toEqual({ x: 200, y: 300 });
  });

  it("does not slide a run into a box", () => {
    const rects = { wall: { x: 66, y: 100, w: 400, h: 100 } };
    const mk = () => ({ ok: true, pts: [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 300 }, { x: 186, y: 300 }, { x: 200, y: 300 }] });
    const out = spreadSharedRuns({ a: mk(), b: mk() }, rects, [{ id: "a" }, { id: "b" }]);
    const x = out.b.pts[2].x;
    expect(x).not.toBe(60);
    expect(x < 66 - 4 || x > 466 + 4).toBe(true);
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
