// Orthogonal edge routing around boxes: A* on a coarse grid where every box (inflated by `pad`) is blocked.
// A path bends only where it must (`bend` cost), so arrows run around boxes instead of through them.
// Pure function. start/end are handle points; obstacles are absolute {x, y, w, h} rectangles.
// Returns { pts, ok }: ok=false means no clear route exists and pts is the straight line.

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export function orthoRoute({ start, end, obstacles = [], pad = 6, cell = 6, margin = 60, bend = 8, lead = 14 }) {
  // Leave the source to the right and enter the target from the left: a short straight lead-in/out
  // keeps arrowheads square to the box and gives the search room next to a handle.
  const s0 = { x: start.x + lead, y: start.y };
  const e0 = { x: end.x - lead, y: end.y };
  const xs = [s0.x, e0.x], ys = [s0.y, e0.y];
  for (const o of obstacles) { xs.push(o.x, o.x + o.w); ys.push(o.y, o.y + o.h); }
  const minX = Math.min(...xs) - margin, maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin, maxY = Math.max(...ys) + margin;
  const cols = Math.ceil((maxX - minX) / cell) + 1, rows = Math.ceil((maxY - minY) / cell) + 1;
  const toCell = (x, y) => [Math.round((x - minX) / cell), Math.round((y - minY) / cell)];
  const blocked = new Uint8Array(cols * rows);
  for (const o of obstacles) {
    const x0 = Math.floor((o.x - pad - minX) / cell), x1 = Math.ceil((o.x + o.w + pad - minX) / cell);
    const y0 = Math.floor((o.y - pad - minY) / cell), y1 = Math.ceil((o.y + o.h + pad - minY) / cell);
    for (let cy = Math.max(0, y0); cy <= Math.min(rows - 1, y1); cy++)
      for (let cx = Math.max(0, x0); cx <= Math.min(cols - 1, x1); cx++) blocked[cy * cols + cx] = 1;
  }
  const [sx, sy] = toCell(s0.x, s0.y), [ex, ey] = toCell(e0.x, e0.y);
  const open = (cx, cy) => (cx === sx && cy === sy) || (cx === ex && cy === ey) || !blocked[cy * cols + cx];
  const N = cols * rows * 4, g = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const h = (cx, cy) => Math.abs(cx - ex) + Math.abs(cy - ey);
  const heap = [];
  const push = (f, s) => { heap.push([f, s]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  // start heading right (dir 0)
  g[(sy * cols + sx) * 4] = 0; push(h(sx, sy), (sy * cols + sx) * 4);
  let goal = -1;
  while (heap.length) {
    const [, s] = pop();
    const c = s >> 2, d = s & 3, cx = c % cols, cy = (c - cx) / cols;
    if (cx === ex && cy === ey) { goal = s; break; }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue; // no U-turns
      const nx = cx + DIRS[nd][0], ny = cy + DIRS[nd][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !open(nx, ny)) continue;
      const ns = (ny * cols + nx) * 4 + nd;
      const cost = g[s] + 1 + (nd !== d ? bend : 0);
      if (cost < g[ns]) { g[ns] = cost; prev[ns] = s; push(cost + h(nx, ny), ns); }
    }
  }
  if (goal < 0) return { pts: [start, end], ok: false };
  const cells = [];
  for (let s = goal; s !== -1; s = prev[s]) { const c = s >> 2; cells.push([c % cols, (c - (c % cols)) / cols]); }
  cells.reverse();
  // Corner points of the staircase, in pixels (first and last cell included).
  const P = [{ x: minX + cells[0][0] * cell, y: minY + cells[0][1] * cell }];
  for (let i = 1; i < cells.length - 1; i++) {
    const [ax, ay] = cells[i - 1], [bx, by] = cells[i], [cx, cy] = cells[i + 1];
    if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) !== 0) P.push({ x: minX + bx * cell, y: minY + by * cell });
  }
  P.push({ x: minX + cells[cells.length - 1][0] * cell, y: minY + cells[cells.length - 1][1] * cell });
  // The grid cell centres are a few pixels off the real handle rows, so pin the first run to the start handle
  // and the last run to the end handle: every segment stays exactly horizontal or vertical.
  const horiz = (k) => P[k].y === P[k + 1].y;
  const m = P.length - 1;
  if (m >= 1) {
    if (horiz(0)) { P[0].y = s0.y; P[1].y = s0.y; } else { P[0].x = s0.x; P[1].x = s0.x; }
    P[0].x = horiz(0) ? s0.x : P[0].x; P[0].y = horiz(0) ? P[0].y : s0.y;
    const lastHoriz = P[m - 1].y === P[m].y || (horiz(0) && m === 1);
    if (lastHoriz) { P[m - 1].y = e0.y; P[m].y = e0.y; P[m].x = e0.x; } else { P[m - 1].x = e0.x; P[m].x = e0.x; P[m].y = e0.y; }
  } else {
    P[0] = { ...s0 };
  }
  const pts = [start, s0, ...P.slice(1, -1), e0, end].filter((pt, i, arr) => i === 0 || pt.x !== arr[i - 1].x || pt.y !== arr[i - 1].y);
  return { pts, ok: true };
}

/** Rounded-corner path through the points. */
export function pathFromPoints(pts, r = 10) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = { x: b.x - ((b.x - a.x) / (l1 || 1)) * rr, y: b.y - ((b.y - a.y) / (l1 || 1)) * rr };
    const p2 = { x: b.x + ((c.x - b.x) / (l2 || 1)) * rr, y: b.y + ((c.y - b.y) / (l2 || 1)) * rr };
    d += ` L${p1.x} ${p1.y} Q${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${z.x} ${z.y}`;
}

/** Label sits on the longest straight run, at its midpoint. */
export function labelPoint(pts) {
  let best = [pts[0], pts[pts.length - 1]], len = -1;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    if (l > len) { len = l; best = [pts[i - 1], pts[i]]; }
  }
  return { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 };
}
