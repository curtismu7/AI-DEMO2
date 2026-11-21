// The pure half of the diagram kit: no React, no DOM, so it can be tested on its own. See README.md.
//
//   boxPassport(graph, id)   everything a box can say about itself: group, code pointers, reach, arrows in and out
//   placeLabels({...})       where each arrow's label goes so no two overlap and none sits on a box
//   slotPoint / sidePoint / inOutPoint   where an arrow meets a box, for the three handle schemes the labs use
//
// A "graph" is any object shaped { nodes: [{ id, label, sub?, group?, groupLabel?, sources? }], edges: [{ source, target, label? }],
// groups?: { [key]: { label, color } }, repo?: { url, rev } } - a diagram-studio/1 document already is one, and a lab with its own
// data shape (nodes and steps, say) maps onto it in a few lines.
import { getBezierPath, Position } from "@xyflow/react";

/* ---------------------------------------------------------------- code pointers */

/** "server/src/jobs.js:88-97" (or ":88" for one line). */
export const sourceLabel = (s) => `${s.path}:${s.line}${s.end_line && s.end_line !== s.line ? `-${s.end_line}` : ""}`;

const GITHUB = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

/**
 * A link to the file at the pinned commit, or null when the graph has no `repo` or it is not a GitHub https URL with a full commit.
 * Only a validated https URL is ever turned into a link: the text of a diagram is never trusted as markup.
 */
export function sourceHref(repo, s) {
  const m = GITHUB.exec(String(repo?.url ?? ""));
  if (!m || !/^[0-9a-f]{40}$/.test(String(repo.rev))) return null;
  const range = s.end_line && s.end_line !== s.line ? `#L${s.line}-L${s.end_line}` : `#L${s.line}`;
  return `https://github.com/${m[1]}/${m[2]}/blob/${repo.rev}/${s.path.split("/").map(encodeURIComponent).join("/")}${range}`;
}

/* ---------------------------------------------------------------- box passport */

function reachable(from, next) {
  const seen = new Set(); const todo = [from];
  while (todo.length) for (const n of next.get(todo.pop()) ?? []) if (n !== from && !seen.has(n)) { seen.add(n); todo.push(n); }
  return seen.size;
}

/**
 * What an expanded box shows. `reach` follows the arrows as drawn: upstream = how many other boxes have a path of arrows TO this box,
 * downstream = how many this box has a path to (a cycle never counts a box twice, and a box is never its own upstream or downstream).
 * @returns null for an unknown box, else
 *   { id, label, sub, group: { key, label, color } | null, repo: { name, rev } | null,
 *     sources: [{ label, text, href }],              text is "path:lines"; href is a link to that file at the pinned commit, or null
 *     outgoing / incoming: [{ id, label, arrow }],    the box at the other end and the arrow's own label (or null)
 *     upstream, downstream }
 */
export function boxPassport(graph, id) {
  const n = graph.nodes.find((x) => x.id === id);
  if (!n) return null;
  const by = new Map(graph.nodes.map((x) => [x.id, x]));
  const out = new Map(); const inn = new Map();
  for (const e of graph.edges) {
    if (!by.has(e.source) || !by.has(e.target)) continue;
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)).push(e.target);
    (inn.get(e.target) ?? inn.set(e.target, []).get(e.target)).push(e.source);
  }
  const link = (e, other) => ({ id: other, label: by.get(other).label, arrow: e.label || null });
  const m = typeof graph.repo?.url === "string" ? GITHUB.exec(graph.repo.url) : null;
  const g = n.group == null ? null : graph.groups?.[n.group];
  const groupLabel = n.groupLabel ?? g?.label ?? (n.group == null ? null : String(n.group));
  return {
    id: n.id, label: n.label, sub: n.sub ?? [],
    group: groupLabel == null ? null : { key: n.group ?? null, label: groupLabel, color: g?.color ?? null },
    repo: graph.repo && /^[0-9a-f]{40}$/.test(String(graph.repo.rev)) ? { name: m ? `${m[1]}/${m[2]}` : String(graph.repo.url), rev: graph.repo.rev.slice(0, 7) } : null,
    sources: (n.sources ?? []).map((s) => ({ label: s.label || null, text: sourceLabel(s), href: sourceHref(graph.repo, s) })),
    outgoing: graph.edges.filter((e) => e.source === id && by.has(e.target)).map((e) => link(e, e.target)),
    incoming: graph.edges.filter((e) => e.target === id && by.has(e.source)).map((e) => link(e, e.source)),
    upstream: reachable(id, inn), downstream: reachable(id, out),
  };
}

/* ---------------------------------------------------------------- where an arrow meets a box */

/**
 * `box` is { x, y, w, h } (the box as React Flow measured it). Each returns [x, y, Position] or null for a handle it does not know.
 *   slotPoint("l1".."b2")        eight side slots: 1 sits 30% along its side, 2 sits 70% (the diagram-studio lab pages)
 *   sidePoint("t" | "b" | "l" | "r")   the middle of a side (React Flow's default handle position)
 *   inOutPoint("in" | "out" | "back-in" | "back-out")   the studio's handles: in/out at mid height, the back pair at 70%
 */
export function slotPoint(box, slot) {
  const k = slot?.[1] === "1" ? 0.3 : slot?.[1] === "2" ? 0.7 : null;
  if (k === null) return null;
  switch (slot[0]) {
    case "l": return [box.x, box.y + box.h * k, Position.Left];
    case "r": return [box.x + box.w, box.y + box.h * k, Position.Right];
    case "t": return [box.x + box.w * k, box.y, Position.Top];
    case "b": return [box.x + box.w * k, box.y + box.h, Position.Bottom];
    default: return null;
  }
}
export function sidePoint(box, side) {
  switch (side) {
    case "l": return [box.x, box.y + box.h / 2, Position.Left];
    case "r": return [box.x + box.w, box.y + box.h / 2, Position.Right];
    case "t": return [box.x + box.w / 2, box.y, Position.Top];
    case "b": return [box.x + box.w / 2, box.y + box.h, Position.Bottom];
    default: return null;
  }
}
export function inOutPoint(box, handle) {
  switch (handle) {
    case "out": return [box.x + box.w, box.y + box.h / 2, Position.Right];
    case "in": return [box.x, box.y + box.h / 2, Position.Left];
    case "back-out": return [box.x, box.y + box.h * 0.7, Position.Left];
    case "back-in": return [box.x + box.w, box.y + box.h * 0.7, Position.Right];
    default: return null;
  }
}

/* ---------------------------------------------------------------- label placement */
// Each label starts on its own arrow (the middle of the curve, exactly where React Flow would have put it) and, if that spot is taken
// by a box or by an earlier label, slides along the arrow and then sideways to the first spot that touches neither. The result does not
// depend on the walkthrough step, so a label never jumps while it plays.

const T = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82, 0.1, 0.9];   // along the arrow, middle first
const SIDE_STEPS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];                  // sideways, in label heights; a label drifts at most 5 heights from its arrow
const MAX_W = 224;                                                          // a longer label wraps (the stylesheet caps the width the same)
const PAD_X = 7; const PAD_Y = 3;

/** The four control points of the curve React Flow draws, read from its own path string ("M sx,sy C c1x,c1y c2x,c2y tx,ty"). */
export function curveOf(from, to) {
  const [path] = getBezierPath({ sourceX: from[0], sourceY: from[1], sourcePosition: from[2], targetX: to[0], targetY: to[1], targetPosition: to[2] });
  const n = path.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g).map(Number);
  return [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]], [n[6], n[7]]];
}

export const pointAt = ([p0, p1, p2, p3], t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
};

/** Estimated size of a label box: width from the text length, wrapped at MAX_W. The browser's real size replaces it once drawn. */
export function labelSize(text, fontPx) {
  const natural = [...String(text)].length * fontPx * 0.6 + PAD_X * 2 + 2;                  // +2: the 1px border
  const lines = Math.max(1, Math.ceil(natural / MAX_W));
  return { w: Math.round(Math.min(MAX_W, natural)), h: Math.round(lines * fontPx * 1.3 + PAD_Y * 2 + 2) };
}

const hits = (a, b, m) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const CLEAR = 4;                                           // px of air kept between a label and a box

/**
 * @param edges  [{ id, text, from: [x, y, position], to: [x, y, position], prefer, size }] in drawing order; `prefer` is a sideways
 *               offset in px to try first; `size` is the label's measured { w, h } once the browser has drawn it (until then it is
 *               estimated from the text)
 * @param boxes  [{ x, y, w, h }] every box on the canvas
 * @param fontPx the label font size (bigger in presenter mode)
 * @returns Map id -> { x, y, w, h } centre and size; an arrow with no text gets no label
 */
export function placeLabels({ edges, boxes, fontPx = 11 }) {
  const placed = []; const out = new Map();
  for (const e of edges) {
    if (!e.text) continue;
    const { w, h } = e.size?.w > 0 && e.size?.h > 0 ? e.size : labelSize(e.text, fontPx);
    const curve = curveOf(e.from, e.to);
    const step = h + 4;
    const sides = [...new Set([e.prefer ?? 0, ...SIDE_STEPS.map((k) => k * step)])];
    let best = null; let bestScore = Infinity;
    search: for (const side of sides) {
      for (const t of T) {
        const [px, py] = pointAt(curve, t);
        const r = { x: px - w / 2, y: py + side - h / 2, w, h };
        const padded = { x: r.x - CLEAR, y: r.y - CLEAR, w: w + 2 * CLEAR, h: h + 2 * CLEAR };
        const onBox = boxes.reduce((sum, b) => sum + area(padded, b), 0) / (padded.w * padded.h);   // share of the label (with its air) on a box
        const onLabel = placed.filter((q) => hits(r, q, 3)).length;
        const score = onBox * 8 + onLabel * 5 + Math.abs(side) / step * 0.3 + Math.abs(t - 0.5);
        if (score < bestScore) { best = r; bestScore = score; }
        if (!onBox && !onLabel) { best = r; break search; }
      }
    }
    placed.push(best);
    out.set(e.id, { x: best.x + w / 2, y: best.y + h / 2, w, h });
  }
  return out;
}

/** How many pairs of labels overlap (for tests and for measuring a layout). */
export function labelOverlaps(placed) {
  const rs = [...placed.values()].map((l) => ({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h }));
  let n = 0;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (hits(rs[i], rs[j], 0)) n++;
  return n;
}
