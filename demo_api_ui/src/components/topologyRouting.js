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
export function rectsKey(nodes) {
  let k = "";
  for (const n of nodes) {
    if (n.type !== "server") continue;
    const p = n.internals.positionAbsolute;
    k += `${n.id}:${Math.round(p.x)},${Math.round(p.y)},${Math.round(n.measured?.width ?? 0)},${Math.round(n.measured?.height ?? 0)}|`;
  }
  return k;
}

// Source handles sit on the right of a box, target handles on the left. Every box is an obstacle, the edge's own two included
// (the lead-in/out reaches the handle). One router per call, edges in list order, so lanes are deterministic.
export function routeTopologyEdges(rects, edges) {
  const ids = Object.keys(rects);
  const routes = {};
  let fallbacks = 0;
  if (!ids.length) return { routes, fallbacks };
  const router = createRouter({ obstacles: ids.map((id) => rects[id]) });
  for (const edge of edges) {
    const a = rects[edge.source];
    const b = rects[edge.target];
    if (!a || !b) continue;
    const result = router.route({
      start: { x: a.x + a.w, y: a.y + a.h / 2 },
      end: { x: b.x, y: b.y + b.h / 2 },
      startDir: "r",
      endDir: "l",
    });
    routes[edge.id] = result;
    if (!result.ok) fallbacks += 1;
  }
  return { routes, fallbacks };
}
