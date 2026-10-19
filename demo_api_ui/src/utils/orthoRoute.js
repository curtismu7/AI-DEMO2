// Orthogonal edge routing around boxes: A* on a coarse grid where every box (inflated by `pad`) is blocked.
// A path bends only where it must (`bend` cost), so arrows run around boxes instead of through them.
// Pure functions. start/end are handle points; obstacles are absolute {x, y, w, h} rectangles.
//
//   createRouter({ obstacles, pad, margin, maxCells, ... }) -> { route({ start, end, startDir, endDir, ignore }) }
//   orthoRoute({ start, end, obstacles, startDir, endDir, ... })   one-shot wrapper (builds the grid each call)
//
// Both return { pts, ok }: ok=false means no clear route exists and pts is the straight line [start, end].
//
// Sides: startDir = the direction the arrow LEAVES the start handle; endDir = the SIDE of the target box the end
// handle sits on. Both take 'r' | 'l' | 't' | 'b' (defaults 'r' and 'l'). The path runs `lead` px straight out of
// the start handle, ends with `lead` px straight into the end handle, and searches in between:
//   pts = [start, start + lead*vec(startDir), ...bends, end + lead*vec(endDir), end]   (vec: r=(1,0) l=(-1,0) t=(0,-1) b=(0,1))
// Cell size: `cell` (default 6) is the finest grid. If the diagram is so large that this exceeds `maxCells` cells,
// the cell grows until it fits (never finer than `minCell` = 4). Trade-off: a coarser grid is faster but arrows can
// only squeeze through gaps wider than about one cell plus 2*pad; a narrower gap yields ok=false (callers fall back).

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // r, b, l, t (grid y grows downwards)
const DIR_INDEX = { r: 0, b: 1, l: 2, t: 3 };
const leadPt = (p, d, lead) => ({ x: p.x + DIRS[d][0] * lead, y: p.y + DIRS[d][1] * lead });
const KEY = 1 << 21;

export function createRouter({ obstacles = [], pad = 6, cell = 6, margin = 60, maxCells = 200000, minCell = 4, bend = 8, lead = 14, lanes = 3, points = [] } = {}) {
  const baseCell = Math.max(cell, minCell);
  const extra = points.slice();
  const occupancy = new Map(); // "h:<y>" / "v:<x>" -> [{ lo, hi, lane }] spans already drawn on that exact line
  let G = null;

  function build() {
    const xs = extra.map((p) => p.x), ys = extra.map((p) => p.y);
    for (const o of obstacles) { xs.push(o.x, o.x + o.w); ys.push(o.y, o.y + o.h); }
    if (!xs.length) { xs.push(0); ys.push(0); }
    const minX = Math.min(...xs) - margin, maxX = Math.max(...xs) + margin;
    const minY = Math.min(...ys) - margin, maxY = Math.max(...ys) + margin;
    let c = Math.max(baseCell, Math.sqrt(((maxX - minX) * (maxY - minY)) / maxCells));
    let cols, rows;
    for (;;) {
      cols = Math.ceil((maxX - minX) / c) + 1; rows = Math.ceil((maxY - minY) / c) + 1;
      if (cols * rows <= maxCells) break;
      c *= 1.01;
    }
    const blocked = new Uint16Array(cols * rows); // number of (padded) obstacles covering each cell
    const spans = obstacles.map((o) => [
      Math.max(0, Math.floor((o.x - pad - minX) / c)), Math.min(cols - 1, Math.ceil((o.x + o.w + pad - minX) / c)),
      Math.max(0, Math.floor((o.y - pad - minY) / c)), Math.min(rows - 1, Math.ceil((o.y + o.h + pad - minY) / c)),
    ]);
    const paint = (i, delta) => {
      const [x0, x1, y0, y1] = spans[i];
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) blocked[cy * cols + cx] += delta;
    };
    for (let i = 0; i < spans.length; i++) paint(i, 1);
    const N = cols * rows * 4;
    return { minX, minY, c, cols, rows, blocked, paint, g: new Int32Array(N), prev: new Int32Array(N), stamp: new Uint32Array(N), gen: 0 };
  }
  G = build();

  const heapK = [], heapV = [];
  const push = (k, v) => {
    let i = heapK.length;
    heapK.push(k); heapV.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (heapK[p] <= k) break; heapK[i] = heapK[p]; heapV[i] = heapV[p]; i = p; }
    heapK[i] = k; heapV[i] = v;
  };
  const pop = () => {
    const v = heapV[0], lk = heapK.pop(), lv = heapV.pop();
    const n = heapK.length;
    if (n) {
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= n) break;
        if (m + 1 < n && heapK[m + 1] < heapK[m]) m += 1;
        if (heapK[m] >= lk) break;
        heapK[i] = heapK[m]; heapV[i] = heapV[m]; i = m;
      }
      heapK[i] = lk; heapV[i] = lv;
    }
    return v;
  };

  // A* over (cell, heading) states. reqDir >= 0 demands arriving at the goal heading that way (the straight run into
  // the end handle); -1 accepts any heading. Returns the goal state or -1.
  function search(sx, sy, sd, ex, ey, reqDir, freed) {
    const { cols, rows, blocked, g, prev, stamp } = G;
    const gen = ++G.gen;
    const open = (cx, cy) => !blocked[cy * cols + cx] || freed.has(cy * cols + cx);
    const h = (cx, cy, d) => {
      const dx = ex - cx, dy = ey - cy;
      let v = Math.abs(dx) + Math.abs(dy);
      // A turn is unavoidable unless already heading straight at an aligned goal.
      if (dx && dy) v += bend;
      else if (dx ? DIRS[d][0] !== Math.sign(dx) : dy && DIRS[d][1] !== Math.sign(dy)) v += bend;
      return v;
    };
    heapK.length = 0; heapV.length = 0;
    const s0 = (sy * cols + sx) * 4 + sd;
    g[s0] = 0; stamp[s0] = gen; prev[s0] = -1;
    push(h(sx, sy, sd) * KEY + (KEY - 1), s0 * KEY);
    while (heapK.length) {
      const v = pop();
      const s = Math.floor(v / KEY), pg = v - s * KEY;
      if (stamp[s] !== gen || g[s] !== pg) continue; // stale entry
      const c = s >> 2, d = s & 3, cx = c % cols, cy = (c - cx) / cols;
      if (cx === ex && cy === ey && (reqDir < 0 || d === reqDir)) return s;
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((d + 2) & 3)) continue; // no U-turns
        const nx = cx + DIRS[nd][0], ny = cy + DIRS[nd][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !open(nx, ny)) continue;
        const ns = (ny * cols + nx) * 4 + nd;
        const cost = pg + 1 + (nd !== d ? bend : 0);
        if (stamp[ns] !== gen || cost < g[ns]) {
          stamp[ns] = gen; g[ns] = cost; prev[ns] = s;
          push((cost + h(nx, ny, nd)) * KEY + (KEY - 1 - Math.min(cost, KEY - 1)), ns * KEY + cost);
        }
      }
    }
    return -1;
  }

  // Number of boxes whose interior the polyline enters (the lane nudge must never make this worse).
  const crossings = (pts, skip) => {
    let n = 0;
    obstacles.forEach((o, k) => {
      if (skip.has(k)) return;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (Math.max(a.x, b.x) > o.x && Math.min(a.x, b.x) < o.x + o.w && Math.max(a.y, b.y) > o.y && Math.min(a.y, b.y) < o.y + o.h) { n += 1; break; }
      }
    });
    return n;
  };

  function route({ start, end, startDir = 'r', endDir = 'l', ignore = [] }) {
    const sd = DIR_INDEX[startDir] ?? 0, ed = DIR_INDEX[endDir] ?? 2;
    const s0 = leadPt(start, sd, lead), e0 = leadPt(end, ed, lead);
    const inside = (p) => { const cx = Math.round((p.x - G.minX) / G.c), cy = Math.round((p.y - G.minY) / G.c); return cx >= 0 && cy >= 0 && cx < G.cols && cy < G.rows; };
    if (!inside(s0) || !inside(e0)) { extra.push(s0, e0); G = build(); } // endpoints beyond the grid: rebuild once around them
    const skip = new Set(ignore.filter((i) => i >= 0 && i < obstacles.length));
    skip.forEach((i) => G.paint(i, -1));
    let goal;
    const { minX, minY, c: cs } = G;
    const sx = Math.round((s0.x - minX) / cs), sy = Math.round((s0.y - minY) / cs);
    const ex = Math.round((e0.x - minX) / cs), ey = Math.round((e0.y - minY) / cs);
    try {
      // The start and end lead cells are always open, plus the few cells straight out of them that lie in padding (not
      // in a box itself): a lead shorter than `pad`, or a neighbour closer than that, must not strand the arrow.
      const freed = new Set();
      const free = (cx, cy, d) => {
        for (let k = 0; k <= Math.ceil(pad / cs) + 1; k++) {
          const x = cx + DIRS[d][0] * k, y = cy + DIRS[d][1] * k;
          if (x < 0 || y < 0 || x >= G.cols || y >= G.rows) return;
          const px = minX + x * cs, py = minY + y * cs;
          if (k && obstacles.some((o, i) => !skip.has(i) && px > o.x && px < o.x + o.w && py > o.y && py < o.y + o.h)) return;
          freed.add(y * G.cols + x);
        }
      };
      free(sx, sy, sd); free(ex, ey, ed);
      goal = search(sx, sy, sd, ex, ey, (ed + 2) & 3, freed);
      if (goal < 0) goal = search(sx, sy, sd, ex, ey, -1, freed);
    } finally {
      skip.forEach((i) => G.paint(i, 1));
    }
    if (goal < 0) return { pts: [start, end], ok: false };

    // Cell path -> corner cells.
    const states = [];
    for (let s = goal; s !== -1; s = G.prev[s]) states.push(s);
    states.reverse();
    const cellOf = (s) => { const k = s >> 2; const cx = k % G.cols; return [cx, (k - cx) / G.cols]; };
    const corners = [cellOf(states[0])];
    for (let i = 1; i < states.length - 1; i++) if ((states[i] & 3) !== (states[i + 1] & 3)) corners.push(cellOf(states[i]));
    if (states.length > 1) corners.push(cellOf(states[states.length - 1]));
    // Straight lines of the staircase: o = 'h' | 'v', c = the fixed coordinate (pixels).
    const L = [];
    for (let k = 0; k + 1 < corners.length; k++) {
      const [ax, ay] = corners[k], by = corners[k + 1][1];
      L.push(ay === by ? { o: 'h', c: minY + ay * cs } : { o: 'v', c: minX + ax * cs });
    }
    const n = L.length;
    let P; // s0, ...bends, e0
    const withLines = () => {
      const out = [s0];
      for (let k = 0; k + 1 < n; k++) out.push(L[k].o === 'h' ? { x: L[k + 1].c, y: L[k].c } : { x: L[k].c, y: L[k + 1].c });
      out.push(e0);
      return out;
    };
    if (n <= 1) {
      // One straight run (or none): the handle rows can differ by less than a cell, so jog in the middle if they do.
      const horiz = n ? L[0].o === 'h' : sd % 2 === 0;
      if (horiz ? s0.y === e0.y : s0.x === e0.x) P = [s0, e0];
      else if (horiz) { const mx = (s0.x + e0.x) / 2; P = [s0, { x: mx, y: s0.y }, { x: mx, y: e0.y }, e0]; }
      else { const my = (s0.y + e0.y) / 2; P = [s0, { x: s0.x, y: my }, { x: e0.x, y: my }, e0]; }
    } else {
      // Grid centres sit a few px off the real handles: pin the first run to the start handle and the last to the end
      // handle, so every segment stays exactly horizontal or vertical.
      L[0].c = L[0].o === 'h' ? s0.y : s0.x;
      L[n - 1].c = L[n - 1].o === 'h' ? e0.y : e0.x;
      P = withLines();
      // Lanes: interior runs that sit exactly on a line another route already uses are nudged sideways.
      if (n >= 3 && lanes > 1) {
        const orig = L.map((l) => l.c), picks = [];
        const step = cs / 2;
        for (let i = 1; i < n - 1; i++) {
          const a = P[i], b = P[i + 1];
          const lo = L[i].o === 'h' ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi = L[i].o === 'h' ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
          const key = `${L[i].o}:${Math.round(L[i].c * 1000)}`;
          const used = new Set((occupancy.get(key) || []).filter((s) => Math.min(hi, s.hi) - Math.max(lo, s.lo) > 0).map((s) => s.lane));
          let lane = 0;
          while (used.has(lane) && lane < lanes - 1) lane += 1;
          picks.push({ i, key, lo, hi, lane });
          L[i].c += Math.ceil(lane / 2) * (lane % 2 ? 1 : -1) * step;
        }
        const nudged = withLines();
        if (picks.some((p) => p.lane) && crossings(nudged, skip) > crossings(P, skip)) {
          picks.forEach((p) => { p.lane = 0; L[p.i].c = orig[p.i]; });
        } else P = nudged;
        for (const p of picks) {
          if (!occupancy.has(p.key)) occupancy.set(p.key, []);
          occupancy.get(p.key).push({ lo: p.lo, hi: p.hi, lane: p.lane });
        }
      }
    }
    const pts = [start, ...P, end].filter((pt, i, arr) => i === 0 || pt.x !== arr[i - 1].x || pt.y !== arr[i - 1].y);
    return { pts, ok: true };
  }

  return { route };
}

/** One-shot routing: builds the grid for this call only. Prefer createRouter when drawing many edges. */
export function orthoRoute({ start, end, obstacles = [], startDir = 'r', endDir = 'l', lead = 14, ...opts }) {
  const sd = DIR_INDEX[startDir] ?? 0, ed = DIR_INDEX[endDir] ?? 2;
  return createRouter({ ...opts, obstacles, lead, points: [leadPt(start, sd, lead), leadPt(end, ed, lead)] }).route({ start, end, startDir, endDir });
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
