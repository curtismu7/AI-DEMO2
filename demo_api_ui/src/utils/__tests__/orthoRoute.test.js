import { describe, it, expect } from 'vitest';
import { orthoRoute, pathFromPoints, labelPoint } from '../orthoRoute';

const hits = (pts, o, pad = 0) => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.max(a.x, b.x) > o.x - pad && Math.min(a.x, b.x) < o.x + o.w + pad && Math.max(a.y, b.y) > o.y - pad && Math.min(a.y, b.y) < o.y + o.h + pad) return true;
  }
  return false;
};

describe('orthoRoute', () => {
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
