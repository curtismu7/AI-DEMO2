// Pure helpers for routing PingSlideFlow arrows around its boxes (shared router: utils/orthoRoute.js).
import { getSmoothStepPath, Position } from "@xyflow/react";
import { createRouter } from "../utils/orthoRoute";

// Backdrops and labels: arrows may cross them (a zone, a panel, the Trust Boundary bar) so they are not obstacles.
export const NON_OBSTACLE_KINDS = ["zone", "panel", "boundary", "text"];
export const isObstacle = (n) => !NON_OBSTACLE_KINDS.includes(n.kind);

// Gateway's extra handle (s-lt) sits on the left side, 31px below the top.
const LT_DY = 31;
const POS = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom, lt: Position.Left };

/** Side letter ('l'|'r'|'t'|'b') of a config side: 'lt' is a left-side handle. */
export const sideDir = (side) => (side === "lt" ? "l" : side);

/** Handle pixel on a box rect {x,y,w,h}; `off` slides it along the side like the old smooth-step edge did. */
export function handlePoint(rect, side, off = 0) {
  const { x, y, w, h } = rect;
  if (side === "lt") return { x, y: y + LT_DY + off };
  if (side === "l") return { x, y: y + h / 2 + off };
  if (side === "r") return { x: x + w, y: y + h / 2 + off };
  if (side === "t") return { x: x + w / 2 + off, y };
  return { x: x + w / 2 + off, y: y + h };
}

/**
 * Point on the polyline `pts` nearest to `t`. Labels are hand-tuned (dx/dy) against the old smooth-step midpoint, so the
 * routed label goes where that tuned spot meets the routed line: it stays on its own line, in the same neighbourhood.
 */
export function nearestOnPath(pts, t) {
  let best = pts[0], bd = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((t.x - a.x) * dx + (t.y - a.y) * dy) / l2)) : 0;
    const p = { x: a.x + u * dx, y: a.y + u * dy };
    const d = (p.x - t.x) ** 2 + (p.y - t.y) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Rough label box (the chip is DOM text: 2xs bold title, xs sub line, optional 22px badge; max-width 230).
export function labelSize(e) {
  const title = String(e.label || "").length, sub = String(e.sub || "").split("\n");
  const textW = Math.max(title * 6, ...sub.map((l) => l.length * 5.4));
  const w = Math.min(230, textW + (e.n ? 30 : 0) + 8);
  const wrap = Math.max(1, Math.ceil(textW / Math.max(60, w - (e.n ? 30 : 0) - 8)));
  const h = Math.max(e.n ? 24 : 0, 13 * (1 + sub.filter(Boolean).length * wrap)) + 4;
  return { w, h };
}

const hits = (a, b, g = 0) => a.x < b.x + b.w - g && a.x + a.w > b.x + g && a.y < b.y + b.h - g && a.y + a.h > b.y + g;

/**
 * Label centre for a routed edge. The hand-tuned spot `target` (old smooth-step midpoint + dx/dy) is the wish; the label
 * goes to the closest spot on, or just beside, the routed line where its box covers no card and no earlier label.
 * `taken` collects placed label rects. Falls back to the nearest point on the line when nothing is clear.
 */
export function placeLabel(pts, target, size, obstacles, taken) {
  const { w, h } = size;
  const best = { c: Infinity, p: nearestOnPath(pts, target) };
  const rectAt = (p) => ({ x: p.x - w / 2, y: p.y - h / 2, w, h });
  let bestClear = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const horiz = a.y === b.y, len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const n = Math.max(1, Math.ceil(len / 6));
    const side = horiz ? { x: 0, y: h / 2 + 3 } : { x: w / 2 + 3, y: 0 };
    for (let k = 0; k <= n; k++) {
      const q = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      for (const [m, pen] of [[0, 0], [1, 8], [-1, 8]]) {
        const p = { x: q.x + side.x * m, y: q.y + side.y * m };
        const c = Math.hypot(p.x - target.x, p.y - target.y) + pen;
        if (bestClear && c >= bestClear.c) continue;
        const r = rectAt(p);
        if (obstacles.some((o) => hits(r, o, 1)) || taken.some((t) => hits(r, t))) continue;
        bestClear = { c, p };
      }
    }
  }
  const p = bestClear ? bestClear.p : best.p;
  taken.push(rectAt(p));
  return p;
}

const inside = (r, p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/**
 * Route every edge. `rects` is { [nodeId]: {x,y,w,h,kind} } (absolute, measured). Returns
 * { routes: { [edgeId]: {pts, ok} }, labels: { [edgeId]: {x,y} }, fallbacks }. An obstacle that already contains an edge's own handle point
 * (a card sitting inside a bigger card) is ignored for that edge only.
 */
export function routeSlideEdges(edgeCfgs, rects) {
  const ids = Object.keys(rects).filter((id) => isObstacle(rects[id]));
  const obstacles = ids.map((id) => rects[id]);
  const router = createRouter({ obstacles });
  const routes = {};
  const labels = {};
  const taken = [];
  let fallbacks = 0;
  edgeCfgs.forEach((e, i) => {
    const a = rects[e.from], b = rects[e.to];
    if (!a || !b) return;
    const start = handlePoint(a, e.fs, e.off);
    const end = handlePoint(b, e.ts, e.off);
    const ignore = [];
    ids.forEach((id, j) => {
      if (id !== e.from && id !== e.to && (inside(rects[id], start) || inside(rects[id], end))) ignore.push(j);
    });
    const r = router.route({ start, end, startDir: sideDir(e.fs), endDir: sideDir(e.ts), ignore });
    routes[`e${i}`] = r;
    if (!r.ok) fallbacks += 1;
    if (r.ok && (e.label || e.n) && e.at !== "end") {
      // the old smooth-step midpoint is what dx/dy were tuned against
      const [, mx, my] = getSmoothStepPath({
        sourceX: start.x, sourceY: start.y, targetX: end.x, targetY: end.y,
        sourcePosition: POS[e.fs], targetPosition: POS[e.ts], borderRadius: 0, offset: 24,
      });
      labels[`e${i}`] = placeLabel(r.pts, { x: mx + (e.dx || 0), y: my + (e.dy || 0) }, labelSize(e), obstacles, taken);
    }
  });
  return { routes, labels, fallbacks };
}
