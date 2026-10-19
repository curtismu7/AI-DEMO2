import { createRouter } from "../utils/orthoRoute";

// Keep in step with NODE_CARD_WIDTH / NODE_CARD_HEIGHT in ServerTopologyPage.jsx (used until a box is measured).
const FALLBACK_W = 218;
const FALLBACK_H = 104;

// Absolute rectangles of the server boxes, from React Flow's node map (it clamps and drags boxes; the layout data does not know).
// Zones are backdrops, not obstacles.
export function serverRects(nodes) {
  const rects = {};
  for (const n of nodes) {
    if (n.type !== "server") continue;
    const p = n.internals.positionAbsolute;
    rects[n.id] = { x: p.x, y: p.y, w: n.measured?.width ?? FALLBACK_W, h: n.measured?.height ?? FALLBACK_H };
  }
  return rects;
}

// A string that changes only when a box lands somewhere new or changes size, so zustand re-routes by value.
// Returns null while any box is unmeasured: React Flow briefly drops the sizes whenever the node list is replaced (every step),
// and routing with guessed sizes would only be redone a moment later.
export function rectsKey(nodes) {
  let k = "";
  for (const n of nodes) {
    if (n.type !== "server") continue;
    if (!(n.measured?.width > 0 && n.measured?.height > 0)) return null;
    const p = n.internals.positionAbsolute;
    k += `${n.id}:${Math.round(p.x)},${Math.round(p.y)},${Math.round(n.measured.width)},${Math.round(n.measured.height)}|`;
  }
  return k;
}

// Lanes sit half a cell apart, so a coarse grid keeps arrows that share a corridor visibly apart (8px) and routes faster.
// An arrow that cannot squeeze through a narrow gap on the coarse grid is retried once on a finer one.
const ROUTE_CELL = 16;
const FINE_CELL = 8;
const SIDE_GAP = 40; // room needed between two boxes to leave one side and enter the facing side
const PORT_SPACING = ROUTE_CELL; // px between arrows sharing one side of a box: one grid line each, or they would snap together
const PORT_SPAN = 0.88; // share of a side the arrows may spread over

// The side an arrow leaves the source and the side it enters the target, from where the target lies.
// Targets to the right get right -> left; targets to the left get left -> right; otherwise top/bottom.
export function pickSides(a, b) {
  if (b.x >= a.x + a.w + SIDE_GAP) return ["r", "l"];
  if (b.x + b.w <= a.x - SIDE_GAP) return ["l", "r"];
  if (b.y >= a.y + a.h) return ["b", "t"];
  if (b.y + b.h <= a.y) return ["t", "b"];
  return ["r", "l"];
}

const mid = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// Arrows that share one side of a box get their own point along it (ordered by where their other end lies), so they do not
// share a lead-in or lie on one another. Returns a handle point per edge end.
function spreadPorts(rects, edges, sides) {
  const groups = new Map();
  edges.forEach((edge, i) => {
    if (!sides[i]) return;
    [["start", edge.source, sides[i][0], edge.target], ["end", edge.target, sides[i][1], edge.source]].forEach(([end, id, side, other]) => {
      const key = `${id}|${side}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ i, end, other });
    });
  });
  const ports = edges.map(() => ({}));
  for (const [key, list] of groups) {
    const [id, side] = key.split("|");
    const r = rects[id];
    const horizontal = side === "l" || side === "r";
    const along = (o) => (horizontal ? mid(rects[o]).y : mid(rects[o]).x);
    list.sort((p, q) => along(p.other) - along(q.other) || p.i - q.i);
    const length = horizontal ? r.h : r.w;
    const step = list.length > 1 ? Math.min(PORT_SPACING, (length * PORT_SPAN) / (list.length - 1)) : 0;
    list.forEach((item, k) => {
      const off = (k - (list.length - 1) / 2) * step;
      const c = mid(r);
      ports[item.i][item.end] = side === "r" ? { x: r.x + r.w, y: c.y + off }
        : side === "l" ? { x: r.x, y: c.y + off }
          : side === "t" ? { x: c.x + off, y: r.y } : { x: c.x + off, y: r.y + r.h };
    });
  }
  return ports;
}

const RUN_STEP = 8; // px between two arrows that share a corridor
const RUN_TRIES = 16; // sideways positions tried (+1, -1, +2, -2 ... steps)
const RUN_CLEARANCE = 4;

const hitsRect = (a, b, r, pad) => Math.max(a.x, b.x) > r.x - pad && Math.min(a.x, b.x) < r.x + r.w + pad
  && Math.max(a.y, b.y) > r.y - pad && Math.min(a.y, b.y) < r.y + r.h + pad;

// The router spreads at most three arrows over one line; further arrows in the same corridor would lie exactly on top of each
// other. Slide such a run sideways to a free line, if that keeps both neighbouring runs pointing the same way and clear of
// every box. Only inner runs move: the lead-in and lead-out stay pinned to their handles. Routes are visited in list order.
export function spreadSharedRuns(routes, rects, edges) {
  const boxes = Object.values(rects);
  const placed = [];
  const out = { ...routes };
  for (const edge of edges) {
    const route = routes[edge.id];
    if (!route || !route.ok) continue;
    let pts = route.pts;
    for (let i = 2; i + 1 <= pts.length - 3; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const vertical = a.x === b.x;
      if (!vertical && a.y !== b.y) continue;
      const c = vertical ? a.x : a.y;
      const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
      const hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      const busy = (line) => placed.some((q) => q.vertical === vertical && Math.abs(q.c - line) < 3 && Math.min(hi, q.hi) - Math.max(lo, q.lo) > 1);
      let line = c;
      if (busy(c)) {
        const prev = pts[i - 1];
        const next = pts[i + 2];
        for (let k = 1; k <= RUN_TRIES; k += 1) {
          const cand = c + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * RUN_STEP;
          if (busy(cand)) continue;
          const na = vertical ? { x: cand, y: a.y } : { x: a.x, y: cand };
          const nb = vertical ? { x: cand, y: b.y } : { x: b.x, y: cand };
          // The neighbouring runs must keep their direction (and some length), or the arrow would double back on its lead.
          const keeps = (from, was, now) => (vertical ? Math.sign(was.x - from.x) === Math.sign(now.x - from.x) && Math.abs(now.x - from.x) >= 2
            : Math.sign(was.y - from.y) === Math.sign(now.y - from.y) && Math.abs(now.y - from.y) >= 2);
          if (!keeps(prev, a, na) || !keeps(next, b, nb)) continue;
          if (boxes.some((r) => hitsRect(prev, na, r, RUN_CLEARANCE) || hitsRect(na, nb, r, RUN_CLEARANCE) || hitsRect(nb, next, r, RUN_CLEARANCE))) continue;
          pts = [...pts.slice(0, i), na, nb, ...pts.slice(i + 2)];
          line = cand;
          break;
        }
      }
      placed.push({ vertical, c: line, lo, hi });
    }
    if (pts !== route.pts) out[edge.id] = { ...route, pts };
  }
  return out;
}

// Every box is an obstacle, the edge's own two included (the lead-in/out reaches the handle). One router per call, edges in
// list order, so lanes are deterministic.
export function routeTopologyEdges(rects, edges) {
  const ids = Object.keys(rects);
  const routes = {};
  let fallbacks = 0;
  if (!ids.length) return { routes, fallbacks };
  const obstacles = ids.map((id) => rects[id]);
  const router = createRouter({ obstacles, cell: ROUTE_CELL });
  let fine = null;
  const sides = edges.map((edge) => (rects[edge.source] && rects[edge.target] ? pickSides(rects[edge.source], rects[edge.target]) : null));
  const ports = spreadPorts(rects, edges, sides);
  edges.forEach((edge, i) => {
    if (!sides[i]) return;
    const q = { start: ports[i].start, end: ports[i].end, startDir: sides[i][0], endDir: sides[i][1] };
    let result = router.route(q);
    if (!result.ok) {
      fine = fine || createRouter({ obstacles, cell: FINE_CELL });
      result = fine.route(q);
    }
    routes[edge.id] = result;
    if (!result.ok) fallbacks += 1;
  });
  return { routes: spreadSharedRuns(routes, rects, edges), fallbacks };
}
