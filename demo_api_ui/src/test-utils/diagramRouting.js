// Test helper: lay out a StaticFlowDiagram config the way the component does (SPREAD, card height estimate), run
// the pingStyle router on it and count what a reader would see: arrows the router could not place, arrows that
// cross each other, and arrows that cut through a box. Used by the per-page diagram tests; the real browser check
// (measured card heights, after a drag) is the Playwright probe described in the PR.
import { routeEdges } from '../components/StaticFlowDiagram';

const NODE_W = 250;
const SPREAD_X = 1.2;
const SPREAD_Y = 1.12;
const wrapped = (text, per) => Math.max(1, Math.ceil(String(text).length / per));
const nodeH = (n) => 16 + wrapped(n.label, 29) * 17 + (n.sub || []).reduce((h, s) => h + wrapped(s, 33) * 16, 0);

export function layoutRects(NODES) {
  const rects = {};
  for (const n of NODES) rects[n.id] = { x: n.x * SPREAD_X, y: n.y * SPREAD_Y, w: NODE_W, h: nodeH(n) };
  return rects;
}

// Same handle choice as StaticFlowDiagram's edge builder.
export function flowEdges(NODES, EDGES) {
  const byId = new Map(NODES.map((n) => [n.id, n]));
  return EDGES.flatMap(([src, tgt, , opts = {}], i) => {
    const a = byId.get(src);
    const b = byId.get(tgt);
    if (!a || !b) return [];
    const self = src === tgt;
    const forward = a.x < b.x;
    return [{
      id: `e${i}`, source: src, target: tgt,
      sourceHandle: opts.vertical ? 'sb' : opts.lane ? (opts.lane > 0 ? 'sl' : 'sr') : self || forward ? 'sr' : 'sl',
      targetHandle: opts.vertical ? 'tt' : opts.lane ? (opts.lane > 0 ? 'tl' : 'tr') : self ? 'tr' : forward ? 'tl' : 'tr',
      data: { self },
    }];
  });
}

const segs = (pts) => pts.slice(1).map((q, i) => [pts[i], q]);
const horiz = ([p, q]) => p.y === q.y;
// A proper crossing: one segment horizontal, the other vertical, meeting strictly inside both.
function crosses(s, t) {
  if (horiz(s) === horiz(t)) return false;
  const [h, v] = horiz(s) ? [s, t] : [t, s];
  const hx = [Math.min(h[0].x, h[1].x), Math.max(h[0].x, h[1].x)];
  const vy = [Math.min(v[0].y, v[1].y), Math.max(v[0].y, v[1].y)];
  return v[0].x > hx[0] && v[0].x < hx[1] && h[0].y > vy[0] && h[0].y < vy[1];
}

export function analyzeRouting(NODES, EDGES) {
  const rects = layoutRects(NODES);
  const edges = flowEdges(NODES, EDGES);
  const { routes, fallbacks } = routeEdges(rects, edges);
  const ids = Object.keys(routes).filter((k) => routes[k].ok);
  let crossings = 0;
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      let n = 0;
      for (const s of segs(routes[ids[i]].pts)) for (const t of segs(routes[ids[j]].pts)) if (crosses(s, t)) n += 1;
      if (n) { crossings += n; pairs.push([ids[i], ids[j], n]); }
    }
  }
  // through a box: a segment passing strictly inside a card that is neither of the arrow's own ends
  let throughBox = 0;
  for (const e of edges) {
    const r = routes[e.id];
    if (!r?.ok) continue;
    for (const [id, b] of Object.entries(rects)) {
      if (id === e.source || id === e.target) continue;
      for (const [p, q] of segs(r.pts)) {
        const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
        if (x1 > b.x && x0 < b.x + b.w && y1 > b.y && y0 < b.y + b.h) throughBox += 1;
      }
    }
  }
  return { fallbacks, crossings, throughBox, pairs };
}
