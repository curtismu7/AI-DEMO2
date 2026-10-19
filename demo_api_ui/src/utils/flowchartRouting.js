import { createRouter } from "./orthoRoute";

/**
 * Orthogonal routing for FlowchartFlowDiagram. Every leaf box is an obstacle; group boxes are not (they contain their
 * members, so an arrow has to be able to leave them). Handles are fixed: sources on the bottom edge, targets on the top.
 *
 * boxes: { [id]: { x, y, w, h, leaf } } in absolute coordinates. edges: [{ id, source, target }].
 * Returns { routes: { [edgeId]: { pts, ok } }, fallbacks } (fallbacks = edges the router could not route).
 */
export const handlePoint = ({ x, y, w, h }, dir) => (dir === "b" ? { x: x + w / 2, y: y + h } : { x: x + w / 2, y });

export function routeFlowchartEdges(boxes, edges) {
  const router = createRouter({ obstacles: Object.values(boxes).filter((b) => b.leaf) });
  const routes = {};
  let fallbacks = 0;
  for (const e of edges) {
    const a = boxes[e.source];
    const b = boxes[e.target];
    if (!a || !b || e.source === e.target) continue;
    const r = router.route({ start: handlePoint(a, "b"), end: handlePoint(b, "t"), startDir: "b", endDir: "t" });
    routes[e.id] = r;
    if (!r.ok) fallbacks += 1;
  }
  return { routes, fallbacks };
}
