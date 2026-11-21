// The kit's own tests. They run wherever the kit is vendored (it is not copied with it): vitest, jsdom or node.
import { describe, expect, it } from "vitest";
import { Position, getBezierPath } from "@xyflow/react";
import { boxPassport, curveOf, inOutPoint, labelOverlaps, labelSize, placeLabels, pointAt, sidePoint, slotPoint, sourceHref, sourceLabel } from "./diagramKit.js";

const REV = "d".repeat(40);
const box = (x, y, w = 200, h = 64) => ({ x, y, w, h });

describe("code pointers", () => {
  it("label a file and its lines", () => {
    expect(sourceLabel({ path: "a/b.js", line: 4 })).toBe("a/b.js:4");
    expect(sourceLabel({ path: "a/b.js", line: 4, end_line: 4 })).toBe("a/b.js:4");
    expect(sourceLabel({ path: "a/b.js", line: 4, end_line: 9 })).toBe("a/b.js:4-9");
  });
  it("link only for a GitHub https repo with a pinned commit, with the path encoded", () => {
    const repo = { url: "https://github.com/o/r.git", rev: REV };
    expect(sourceHref(repo, { path: "a b/c#.js", line: 4, end_line: 9 })).toBe(`https://github.com/o/r/blob/${REV}/a%20b/c%23.js#L4-L9`);
    expect(sourceHref(repo, { path: "a.js", line: 4 })).toBe(`https://github.com/o/r/blob/${REV}/a.js#L4`);
    for (const bad of [undefined, null, {}, { url: "https://gitlab.com/o/r", rev: REV }, { url: "https://github.com/o/r", rev: "abc" }, { url: "javascript:alert(1)", rev: REV }, { url: "https://github.com.evil.example/o/r", rev: REV }]) expect(sourceHref(bad, { path: "a.js", line: 1 })).toBeNull();
  });
});

// a -> b -> c, c -> b (a cycle), a -> d, e alone
const g = (extra = {}) => ({
  groups: { x: { label: "Group X", color: "blue" } },
  nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id.toUpperCase(), group: "x" })),
  edges: [{ source: "a", target: "b", label: "one" }, { source: "b", target: "c" }, { source: "c", target: "b", label: "back" }, { source: "a", target: "d", label: "two" }],
  ...extra,
});

describe("boxPassport", () => {
  it("a box that is not there has no passport", () => { expect(boxPassport(g(), "zzz")).toBeNull(); });
  it("lists the arrows out and in: the box at the other end and the arrow's label, in drawing order", () => {
    const p = boxPassport(g(), "b");
    expect(p.outgoing).toEqual([{ id: "c", label: "C", arrow: null }]);
    expect(p.incoming).toEqual([{ id: "a", label: "A", arrow: "one" }, { id: "c", label: "C", arrow: "back" }]);
    expect([boxPassport(g(), "e").outgoing, boxPassport(g(), "e").incoming]).toEqual([[], []]);
  });
  it("counts upstream and downstream boxes once each, never the box itself, even around a cycle", () => {
    const at = (id) => { const p = boxPassport(g(), id); return [p.upstream, p.downstream]; };
    expect(at("a")).toEqual([0, 3]); expect(at("b")).toEqual([2, 1]); expect(at("c")).toEqual([2, 1]); expect(at("d")).toEqual([1, 0]); expect(at("e")).toEqual([0, 0]);
  });
  it("the group is optional: from the groups table, from groupLabel, from the bare key, or none", () => {
    expect(boxPassport(g(), "a").group).toEqual({ key: "x", label: "Group X", color: "blue" });
    const d = g(); d.nodes[0].groupLabel = "Gateway"; expect(boxPassport(d, "a").group.label).toBe("Gateway");
    const bare = { nodes: [{ id: "a", label: "A", group: "idp" }, { id: "b", label: "B" }], edges: [] };
    expect(boxPassport(bare, "a").group).toEqual({ key: "idp", label: "idp", color: null }); expect(boxPassport(bare, "b").group).toBeNull();
  });
  it("source pointers become links to the pinned commit, and never a made-up link", () => {
    const d = g({ repo: { url: "https://github.com/o/r.git", rev: REV } }); d.nodes[0].sources = [{ path: "server/src/jobs.js", line: 88, end_line: 97, label: "apply gate" }, { path: "a.js", line: 3 }];
    const p = boxPassport(d, "a");
    expect(p.repo).toEqual({ name: "o/r", rev: "ddddddd" });
    expect(p.sources).toEqual([{ label: "apply gate", text: "server/src/jobs.js:88-97", href: `https://github.com/o/r/blob/${REV}/server/src/jobs.js#L88-L97` }, { label: null, text: "a.js:3", href: `https://github.com/o/r/blob/${REV}/a.js#L3` }]);
    const none = boxPassport(g(), "a"); expect([none.sources, none.repo]).toEqual([[], null]);
    const other = g({ repo: { url: "https://gitlab.example/o/r", rev: REV } }); other.nodes[0].sources = [{ path: "a.js", line: 1 }];
    expect(boxPassport(other, "a").sources[0].href).toBeNull();
  });
  it("arrows to a box that does not exist are ignored, not crashed on", () => {
    const d = g(); d.edges.push({ source: "a", target: "ghost" }, { source: "ghost", target: "a" });
    const p = boxPassport(d, "a"); expect([p.outgoing.length, p.incoming.length, p.downstream]).toEqual([2, 0, 3]);
  });
  it("over many generated graphs: the totals agree and the lists match the arrows", () => {
    let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let t = 0; t < 200; t++) {
      const n = 2 + rnd(10); const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `N${i}` }));
      const edges = Array.from({ length: rnd(18) }, () => ({ source: `n${rnd(n)}`, target: `n${rnd(n)}` }));
      let up = 0; let down = 0; let out = 0; let inn = 0;
      for (const x of nodes) { const p = boxPassport({ nodes, edges }, x.id); up += p.upstream; down += p.downstream; out += p.outgoing.length; inn += p.incoming.length; expect(p.upstream).toBeLessThan(n); expect(p.downstream).toBeLessThan(n); }
      expect(up).toBe(down); expect(out).toBe(edges.length); expect(inn).toBe(edges.length);
    }
  });
});

describe("where an arrow meets a box", () => {
  const b = box(10, 20, 100, 50);
  it("slotPoint: eight side slots, 30% and 70% along their side", () => {
    expect(slotPoint(b, "l1")).toEqual([10, 35, Position.Left]); expect(slotPoint(b, "r2")).toEqual([110, 55, Position.Right]);
    expect(slotPoint(b, "t1")).toEqual([40, 20, Position.Top]); expect(slotPoint(b, "b2")).toEqual([80, 70, Position.Bottom]);
    for (const bad of ["x1", "l3", "l", "", undefined, null]) expect(slotPoint(b, bad)).toBeNull();
  });
  it("sidePoint: the middle of a side", () => {
    expect(sidePoint(b, "l")).toEqual([10, 45, Position.Left]); expect(sidePoint(b, "r")).toEqual([110, 45, Position.Right]);
    expect(sidePoint(b, "t")).toEqual([60, 20, Position.Top]); expect(sidePoint(b, "b")).toEqual([60, 70, Position.Bottom]);
    expect(sidePoint(b, "x")).toBeNull();
  });
  it("inOutPoint: in and out at mid height, the back pair at 70%", () => {
    expect(inOutPoint(b, "out")).toEqual([110, 45, Position.Right]); expect(inOutPoint(b, "in")).toEqual([10, 45, Position.Left]);
    expect(inOutPoint(b, "back-out")).toEqual([10, 55, Position.Left]); expect(inOutPoint(b, "back-in")).toEqual([110, 55, Position.Right]);
    expect(inOutPoint(b, "top")).toBeNull();
  });
  it("give React Flow's own curve: its middle is exactly where React Flow puts a label, for every scheme", () => {
    const a = box(0, 0); const c = box(500, 140); const d = box(40, 320);
    const pairs = [[slotPoint(a, "r1"), slotPoint(c, "l1")], [slotPoint(c, "l2"), slotPoint(a, "r2")], [sidePoint(a, "b"), sidePoint(d, "t")], [sidePoint(d, "r"), sidePoint(c, "b")], [inOutPoint(a, "out"), inOutPoint(c, "in")], [inOutPoint(c, "back-out"), inOutPoint(a, "back-in")]];
    for (const [from, to] of pairs) {
      const [, lx, ly] = getBezierPath({ sourceX: from[0], sourceY: from[1], sourcePosition: from[2], targetX: to[0], targetY: to[1], targetPosition: to[2] });
      const [mx, my] = pointAt(curveOf(from, to), 0.5);
      expect(mx).toBeCloseTo(lx, 6); expect(my).toBeCloseTo(ly, 6);
    }
  });
});

describe("placing the labels", () => {
  const a = box(0, 0); const b = box(500, 0);
  const edge = (id, text, extra = {}) => ({ id, text, from: sidePoint(a, "r"), to: sidePoint(b, "l"), ...extra });
  it("a lone label stays exactly where React Flow would have put it", () => {
    const [, lx, ly] = getBezierPath({ sourceX: 200, sourceY: 32, sourcePosition: Position.Right, targetX: 500, targetY: 32, targetPosition: Position.Left });
    const at = placeLabels({ edges: [edge("e0", "token")], boxes: [a, b] }).get("e0");
    expect(at.x).toBeCloseTo(lx, 6); expect(at.y).toBeCloseTo(ly, 6);
  });
  it("an arrow with no text gets no label", () => { expect(placeLabels({ edges: [edge("e0", ""), edge("e1", undefined)], boxes: [a, b] }).size).toBe(0); });
  it("a request and its response between the same two boxes do not overlap, nor do six arrows between them", () => {
    expect(labelOverlaps(placeLabels({ edges: [edge("e0", "POST /users"), { id: "e1", text: "201 Created", from: sidePoint(b, "l"), to: sidePoint(a, "r") }], boxes: [a, b] }))).toBe(0);
    expect(labelOverlaps(placeLabels({ edges: Array.from({ length: 6 }, (_, i) => edge(`e${i}`, `request number ${i}`)), boxes: [a, b] }))).toBe(0);
  });
  it("a label moves out of the way of a box on its arrow, and uses the measured size when given", () => {
    const wall = box(290, -20, 120, 100);
    const at = placeLabels({ edges: [edge("e0", "token", { size: { w: 150, h: 40 } })], boxes: [a, b, wall] }).get("e0");
    expect([at.w, at.h]).toEqual([150, 40]);
    const r = { x: at.x - at.w / 2, y: at.y - at.h / 2, w: at.w, h: at.h };
    expect(r.x < wall.x + wall.w && wall.x < r.x + r.w && r.y < wall.y + wall.h && wall.y < r.y + r.h).toBe(false);
    expect(placeLabels({ edges: [edge("e0", "token", { size: { w: 0, h: 0 } })], boxes: [a, b] }).get("e0").w).toBe(labelSize("token", 11).w); // an unmeasured size (0) is ignored
  });
  it("starts the search at `prefer`, and a long label wraps at 224px", () => {
    const at = placeLabels({ edges: [edge("e0", "up", { prefer: -30 }), edge("e1", "down", { prefer: 30 })], boxes: [a, b] });
    expect(at.get("e0").y).toBeLessThan(at.get("e1").y);
    expect(labelSize("x".repeat(120), 11).w).toBe(224); expect(labelSize("token", 14).w).toBeGreaterThan(labelSize("token", 11).w);
  });
  it("is the same every time", () => {
    const edges = [edge("e0", "one"), edge("e1", "two"), edge("e2", "three")];
    expect([...placeLabels({ edges, boxes: [a, b] })]).toEqual([...placeLabels({ edges, boxes: [a, b] })]);
  });
  it("over many generated scenes: never more overlaps than putting every label at the middle of its arrow, and usually none", () => {
    let seed = 11; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    let before = 0; let after = 0; let scenes = 0;
    for (let t = 0; t < 120; t++) {
      const n = 3 + rnd(6); const boxes = Array.from({ length: n }, (_, i) => box((i % 3) * 330 + rnd(40), Math.floor(i / 3) * 190 + rnd(40)));
      const edges = Array.from({ length: 3 + rnd(8) }, (_, i) => { const s = rnd(n); const d = (s + 1 + rnd(n - 1)) % n; return { id: `e${i}`, text: `label ${i} ${"x".repeat(rnd(24))}`, from: sidePoint(boxes[s], boxes[d].x > boxes[s].x ? "r" : "l"), to: sidePoint(boxes[d], boxes[d].x > boxes[s].x ? "l" : "r") }; });
      const naive = new Map(edges.map((e) => { const [x, y] = pointAt(curveOf(e.from, e.to), 0.5); return [e.id, { x, y, ...labelSize(e.text, 11) }]; }));
      const placed = placeLabels({ edges, boxes });
      const b0 = labelOverlaps(naive); const a0 = labelOverlaps(placed);
      expect(a0).toBeLessThanOrEqual(b0); before += b0; after += a0; scenes++;
    }
    expect(before).toBeGreaterThan(20); // the scenes are crowded enough to matter
    expect(after).toBeLessThan(before / 4);
  });
});
