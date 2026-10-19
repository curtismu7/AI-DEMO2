// Pure helpers for routing PingSlideFlow arrows around its boxes (shared router: utils/orthoRoute.js).
import { createRouter } from "../utils/orthoRoute";

// Backdrops and labels: arrows may cross them (a zone, a panel, the Trust Boundary bar) so they are not obstacles.
export const NON_OBSTACLE_KINDS = ["zone", "panel", "boundary", "text"];
export const isObstacle = (n) => !NON_OBSTACLE_KINDS.includes(n.kind);

// Gateway's extra handle (s-lt) sits on the left side, 31px below the top.
const LT_DY = 31;

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

const inside = (r, p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/**
 * Route every edge. `rects` is { [nodeId]: {x,y,w,h,kind} } (absolute, measured). Returns
 * { routes: { [edgeId]: {pts, ok} }, fallbacks }. An obstacle that already contains an edge's own handle point
 * (a card sitting inside a bigger card) is ignored for that edge only.
 */
export function routeSlideEdges(edgeCfgs, rects) {
  const ids = Object.keys(rects).filter((id) => isObstacle(rects[id]));
  const obstacles = ids.map((id) => rects[id]);
  const router = createRouter({ obstacles });
  const routes = {};
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
  });
  return { routes, fallbacks };
}
