// Pure geometry/layout helpers for the Telemetry page graph. No DOM, no fetch —
// vitest-testable in isolation (mirrors the tracingServiceSelect.js pattern).

// Node cards are rounded rectangles (mindmap style), not circles.
export const CARD_W = 150;
export const CARD_H = 54;

const MARGIN_X = 100;
const MARGIN_Y = 60;

/**
 * BFS depth from root nodes (no incoming edges). Cycle-safe: each node is
 * assigned once. Orphan nodes (unreachable from any root, e.g. pure cycles)
 * get depth 0.
 * @returns {Map<string, number>}
 */
function nodeDepths(graph) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const incoming = new Set(edges.map((e) => e.target));
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source).push(e.target);
  }
  const depths = new Map();
  const queue = [];
  for (const n of nodes) {
    if (!incoming.has(n.id)) {
      depths.set(n.id, 0);
      queue.push(n.id);
    }
  }
  while (queue.length) {
    const id = queue.shift();
    for (const next of out.get(id) || []) {
      if (!depths.has(next)) {
        depths.set(next, depths.get(id) + 1);
        queue.push(next);
      }
    }
  }
  for (const n of nodes) if (!depths.has(n.id)) depths.set(n.id, 0);
  return depths;
}

/**
 * Layered left-to-right layout.
 * @returns {Map<string, {x: number, y: number}>}
 */
export function autoLayout(graph, width, height) {
  const nodes = graph?.nodes || [];
  const depths = nodeDepths(graph);
  const byDepth = new Map();
  for (const n of nodes) {
    const d = depths.get(n.id);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(n.id);
  }
  const maxDepth = Math.max(0, ...byDepth.keys());
  const colStep = maxDepth > 0 ? (width - 2 * MARGIN_X) / maxDepth : 0;

  const positions = new Map();
  for (const [depth, ids] of byDepth) {
    const evenSpread = (height - 2 * MARGIN_Y) / Math.max(1, ids.length - 1);
    const rowStep = Math.max(CARD_H + 30, evenSpread);
    ids.forEach((id, i) => {
      const y = height / 2 + (i - (ids.length - 1) / 2) * rowStep;
      positions.set(id, { x: MARGIN_X + depth * colStep, y });
    });
  }
  return positions;
}

/**
 * Keep prior (possibly user-dragged) positions for surviving node ids; lay out
 * only nodes that are new this refresh. Removed ids are dropped.
 */
export function mergePositions(prev, graph, width, height) {
  const fresh = autoLayout(graph, width, height);
  const merged = new Map();
  for (const n of graph?.nodes || []) {
    merged.set(n.id, prev?.get(n.id) || fresh.get(n.id));
  }
  return merged;
}

/**
 * Curved ribbon between two cards: a horizontal cubic bezier from the source
 * card's right edge to the target card's left edge, plus a label position
 * nudged above the curve midpoint (the page renders labels in a top layer
 * with a white halo so they never hide behind cards or ribbons).
 */
export function edgePath(sourcePos, targetPos) {
  const x1 = sourcePos.x + CARD_W / 2;
  const y1 = sourcePos.y;
  const x2 = targetPos.x - CARD_W / 2;
  const y2 = targetPos.y;
  const mx = (x1 + x2) / 2;
  return {
    d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
    labelX: mx,
    labelY: (y1 + y2) / 2 - 10,
  };
}

/** Wrap a label to at most 2 lines of ~maxChars; ellipsize overflow. */
export function wrapLabel(label, maxChars = 20) {
  const words = String(label || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length > 2) {
    const rest = lines.slice(1).join(' ');
    return [lines[0], rest.length > maxChars ? `${rest.slice(0, maxChars - 1)}…` : rest];
  }
  return lines;
}
