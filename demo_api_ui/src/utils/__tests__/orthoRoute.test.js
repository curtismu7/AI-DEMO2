import { describe, it, expect } from 'vitest';
import { orthoRoute, createRouter, pathFromPoints, labelPoint } from '../orthoRoute';

const hits = (pts, o, pad = 0) => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.max(a.x, b.x) > o.x - pad && Math.min(a.x, b.x) < o.x + o.w + pad && Math.max(a.y, b.y) > o.y - pad && Math.min(a.y, b.y) < o.y + o.h + pad) return true;
  }
  return false;
};
// Segments of a path that touch the open interior of a box (a handle on the box edge does not count).
const enters = (pts, o) => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.max(a.x, b.x) > o.x && Math.min(a.x, b.x) < o.x + o.w && Math.max(a.y, b.y) > o.y && Math.min(a.y, b.y) < o.y + o.h) return true;
  }
  return false;
};
const orthogonal = (pts) => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
// Length of collinear overlap between two polylines (same line, same coordinate).
const overlap = (A, B) => {
  let total = 0;
  for (let i = 1; i < A.length; i++) {
    for (let j = 1; j < B.length; j++) {
      const a0 = A[i - 1], a1 = A[i], b0 = B[j - 1], b1 = B[j];
      if (a0.y === a1.y && b0.y === b1.y && a0.y === b0.y) total += Math.max(0, Math.min(Math.max(a0.x, a1.x), Math.max(b0.x, b1.x)) - Math.max(Math.min(a0.x, a1.x), Math.min(b0.x, b1.x)));
      if (a0.x === a1.x && b0.x === b1.x && a0.x === b0.x) total += Math.max(0, Math.min(Math.max(a0.y, a1.y), Math.max(b0.y, b1.y)) - Math.max(Math.min(a0.y, a1.y), Math.min(b0.y, b1.y)));
    }
  }
  return total;
};

describe('orthoRoute (right to left, as before)', () => {
  it('goes around a box between start and end', () => {
    const box = { x: 200, y: 0, w: 100, h: 200 };
    const { pts, ok } = orthoRoute({ start: { x: 0, y: 100 }, end: { x: 400, y: 100 }, obstacles: [box] });
    expect(ok).toBe(true);
    expect(hits(pts, box)).toBe(false);
  });
  it('stays straight when nothing is in the way', () => {
    const { pts, ok } = orthoRoute({ start: { x: 0, y: 100 }, end: { x: 400, y: 100 } });
    expect(ok).toBe(true);
    expect(pts.every((p) => p.y === 100)).toBe(true);
  });
  it('reports ok=false when the end is walled in', () => {
    const wall = [{ x: 150, y: -500, w: 20, h: 1000 }];
    const { ok } = orthoRoute({ start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, obstacles: wall, margin: 10 });
    expect(ok).toBe(false);
  });
  it('keeps every segment exactly horizontal or vertical, whatever the handle rows', () => {
    const boxes = [{ x: 300, y: 100, w: 100, h: 300 }];
    for (const [sy, ey] of [[178, 339], [201, 77], [100, 100], [333, 14]]) {
      const { pts, ok } = orthoRoute({ start: { x: 232, y: sy }, end: { x: 0, y: ey }, obstacles: boxes });
      expect(ok).toBe(true);
      for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, `${sy}->${ey} seg ${i}`).toBe(true);
      expect(pts[0]).toEqual({ x: 232, y: sy });
      expect(pts[pts.length - 1]).toEqual({ x: 0, y: ey });
    }
  });
  it('builds a path and a label point', () => {
    const { pts } = orthoRoute({ start: { x: 0, y: 0 }, end: { x: 300, y: 120 } });
    expect(pathFromPoints(pts)).toMatch(/^M/);
    expect(labelPoint(pts)).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });
});

describe('handle sides', () => {
  const A = { x: 0, y: 0, w: 200, h: 80 };

  it('routes a vertical edge between stacked boxes straight down (bottom exit, top entry)', () => {
    const B = { x: 0, y: 300, w: 200, h: 80 };
    const { pts, ok } = orthoRoute({ start: { x: 100, y: 80 }, end: { x: 100, y: 300 }, startDir: 'b', endDir: 't', obstacles: [A, B] });
    expect(ok).toBe(true);
    expect(pts.every((p) => p.x === 100)).toBe(true);
    expect(pts[1]).toEqual({ x: 100, y: 94 });
    expect(pts[pts.length - 2]).toEqual({ x: 100, y: 286 });
  });

  it('routes upwards (top exit, bottom entry)', () => {
    const B = { x: 0, y: 300, w: 200, h: 80 };
    const { pts, ok } = orthoRoute({ start: { x: 100, y: 300 }, end: { x: 100, y: 80 }, startDir: 't', endDir: 'b', obstacles: [A, B] });
    expect(ok).toBe(true);
    expect(pts.every((p) => p.x === 100)).toBe(true);
    expect(pts[1]).toEqual({ x: 100, y: 286 });
    expect(pts[pts.length - 2]).toEqual({ x: 100, y: 94 });
  });

  it('routes right to left (left exit, right entry)', () => {
    const B = { x: -500, y: 0, w: 200, h: 80 };
    const { pts, ok } = orthoRoute({ start: { x: 0, y: 40 }, end: { x: -300, y: 40 }, startDir: 'l', endDir: 'r', obstacles: [A, B] });
    expect(ok).toBe(true);
    expect(pts.every((p) => p.y === 40)).toBe(true);
    expect(pts[1]).toEqual({ x: -14, y: 40 });
    expect(pts[pts.length - 2]).toEqual({ x: -286, y: 40 });
  });

  it('turns once from a side exit into a top entry and ends straight into the handle', () => {
    const C = { x: 400, y: 200, w: 200, h: 80 };
    const { pts, ok } = orthoRoute({ start: { x: 200, y: 40 }, end: { x: 500, y: 200 }, startDir: 'r', endDir: 't', obstacles: [A, C] });
    expect(ok).toBe(true);
    expect(orthogonal(pts)).toBe(true);
    expect(pts[1]).toEqual({ x: 214, y: 40 });
    expect(pts[pts.length - 2]).toEqual({ x: 500, y: 186 });
    expect(enters(pts, A) || enters(pts, C)).toBe(false);
  });

  it('goes around a box standing between two stacked boxes', () => {
    const B = { x: 0, y: 400, w: 200, h: 80 };
    const M = { x: -20, y: 200, w: 240, h: 40 };
    const { pts, ok } = orthoRoute({ start: { x: 100, y: 80 }, end: { x: 100, y: 400 }, startDir: 'b', endDir: 't', obstacles: [A, B, M] });
    expect(ok).toBe(true);
    expect(orthogonal(pts)).toBe(true);
    expect(hits(pts, M)).toBe(false);
    expect(pts[pts.length - 2]).toEqual({ x: 100, y: 386 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 400 });
  });

  it('reports ok=false when a wall closes the way (top entry)', () => {
    const wall = [{ x: -500, y: 150, w: 1000, h: 20 }];
    const { ok, pts } = orthoRoute({ start: { x: 100, y: 80 }, end: { x: 100, y: 400 }, startDir: 'b', endDir: 't', obstacles: wall, margin: 10 });
    expect(ok).toBe(false);
    expect(pts).toEqual([{ x: 100, y: 80 }, { x: 100, y: 400 }]);
  });

  it('keeps every segment axis-aligned for any handle coordinates and any pair of sides', () => {
    const boxes = [{ x: 100, y: 120, w: 140, h: 100 }];
    const dirs = ['r', 'l', 't', 'b'];
    for (const startDir of dirs) {
      for (const endDir of dirs) {
        for (const [start, end] of [[{ x: 13.5, y: 77 }, { x: 413, y: 381.25 }], [{ x: 401, y: 20 }, { x: 9, y: 333 }]]) {
          const { pts, ok } = orthoRoute({ start, end, startDir, endDir, obstacles: boxes });
          const tag = `${startDir}->${endDir} ${start.x},${start.y}`;
          expect(ok, tag).toBe(true);
          expect(orthogonal(pts), tag).toBe(true);
          expect(pts[0], tag).toEqual(start);
          expect(pts[pts.length - 1], tag).toEqual(end);
          expect(hits(pts, boxes[0]), tag).toBe(false);
        }
      }
    }
  });

  it('can route out of a container that is ignored', () => {
    const container = { x: 0, y: 0, w: 400, h: 300 };
    const router = createRouter({ obstacles: [container] });
    const start = { x: 100, y: 100 }, end = { x: 600, y: 100 };
    expect(router.route({ start, end }).ok).toBe(false);
    expect(router.route({ start, end, ignore: [0] }).ok).toBe(true);
    // The container is blocked again afterwards.
    expect(router.route({ start, end }).ok).toBe(false);
  });

  it('frees the lead cells when a lead point sits in a neighbour\'s padding', () => {
    // lead 4 puts the end lead point 4px from its own box, inside the 6px padding: still routable, whatever the cell phase.
    for (const x of [324, 325, 326, 327, 328, 329]) {
      const near = { x, y: -100, w: 100, h: 400 };
      const { ok, pts } = orthoRoute({ start: { x: 0, y: 30 }, end: { x, y: 30 }, startDir: 'r', endDir: 'l', obstacles: [near], pad: 6, lead: 4 });
      expect(ok, `x=${x}`).toBe(true);
      expect(pts[pts.length - 2], `x=${x}`).toEqual({ x: x - 4, y: 30 });
    }
  });
});

describe('createRouter', () => {
  it('is deterministic', () => {
    const obstacles = [{ x: 200, y: 0, w: 100, h: 200 }, { x: 0, y: 300, w: 100, h: 100 }];
    const run = () => {
      const r = createRouter({ obstacles });
      return [0, 1, 2].map((k) => r.route({ start: { x: 0, y: 100 + k * 3 }, end: { x: 500, y: 120 }, startDir: 'r', endDir: 'l' }));
    };
    expect(run()).toEqual(run());
  });

  it('spreads routes that would share a line into parallel lanes', () => {
    const wall = { x: 200, y: 0, w: 40, h: 400 };
    const a = { start: { x: 0, y: 100 }, end: { x: 500, y: 100 } };
    const b = { start: { x: 0, y: 106 }, end: { x: 500, y: 106 } };
    const solo = (q) => createRouter({ obstacles: [wall] }).route({ ...q });
    // Independent routers (no shared occupancy) run on top of each other along the detour...
    expect(overlap(solo(a).pts, solo(b).pts)).toBeGreaterThan(100);
    // ...one shared router moves the later route into its own lane.
    const shared = createRouter({ obstacles: [wall] });
    const ra = shared.route({ ...a }), rb = shared.route({ ...b });
    expect(ra.ok && rb.ok).toBe(true);
    expect(orthogonal(rb.pts)).toBe(true);
    expect(overlap(ra.pts, rb.pts)).toBeLessThan(overlap(solo(a).pts, solo(b).pts) / 2);
    expect(enters(rb.pts, wall)).toBe(false);
  });

  it('routes 70 edges on a 3000x2500 layout of 100 boxes from one shared grid, quickly', () => {
    const boxes = [];
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) boxes.push({ x: 40 + c * 295, y: 40 + r * 245, w: 140, h: 80 });
    const router = createRouter({ obstacles: boxes });
    const t0 = performance.now();
    let okCount = 0, allOrthogonal = true;
    for (let k = 0; k < 70; k++) {
      const a = boxes[(k * 7) % 100], b = boxes[(k * 13 + 5) % 100];
      if (a === b) continue;
      const { ok, pts } = router.route({ start: { x: a.x + a.w, y: a.y + a.h / 2 }, end: { x: b.x, y: b.y + b.h / 2 }, startDir: 'r', endDir: 'l' });
      if (ok) { okCount += 1; allOrthogonal = allOrthogonal && orthogonal(pts); }
    }
    const ms = performance.now() - t0;
    expect(okCount).toBeGreaterThanOrEqual(65);
    expect(allOrthogonal).toBe(true);
    // Smoke test with a generous bound (the target is ~400 ms; slow CI machines get 4x).
    expect(ms).toBeLessThan(1600);
  });
});
