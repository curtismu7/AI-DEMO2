import { describe, it, expect } from 'vitest';
import { handlePoint, routeFlowchartEdges } from '../flowchartRouting';
import { sizeOf } from '../../components/FlowchartFlowDiagram';

const box = (x, y, w, h, leaf = true) => ({ x, y, w, h, leaf });
const inside = (p, b) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
const crosses = (pts, b) => {
  for (let i = 1; i < pts.length; i++) {
    const [a, c] = [pts[i - 1], pts[i]];
    for (let t = 0; t <= 1; t += 0.02) if (inside({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t }, b)) return true;
  }
  return false;
};

describe('flowchartRouting', () => {
  it('uses bottom-centre for sources and top-centre for targets', () => {
    expect(handlePoint(box(0, 0, 100, 40), 'b')).toEqual({ x: 50, y: 40 });
    expect(handlePoint(box(0, 0, 100, 40), 't')).toEqual({ x: 50, y: 0 });
  });

  it('routes around a leaf box between source and target, ending exactly on the handles', () => {
    const boxes = { a: box(0, 0, 100, 40), wall: box(-200, 100, 500, 60), b: box(0, 300, 100, 40) };
    const { routes, fallbacks } = routeFlowchartEdges(boxes, [{ id: 'e0', source: 'a', target: 'b' }]);
    const r = routes.e0;
    expect(fallbacks).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.pts[0]).toEqual({ x: 50, y: 40 });
    expect(r.pts[r.pts.length - 1]).toEqual({ x: 50, y: 300 });
    expect(crosses(r.pts, boxes.wall)).toBe(false);
    r.pts.slice(1).forEach((p, i) => expect(p.x === r.pts[i].x || p.y === r.pts[i].y).toBe(true));
  });

  it('does not treat a group box as an obstacle', () => {
    const boxes = { g: box(-50, -50, 300, 500, false), a: box(0, 0, 100, 40), b: box(0, 300, 100, 40) };
    const { routes, fallbacks } = routeFlowchartEdges(boxes, [{ id: 'e0', source: 'a', target: 'b' }]);
    expect(routes.e0.ok).toBe(true);
    expect(fallbacks).toBe(0);
  });

  it('counts a fallback when the handles sit inside overlapping boxes, and skips unknown or self edges', () => {
    const boxes = { a: box(0, 0, 100, 40), b: box(10, 20, 100, 80) };
    const { routes, fallbacks } = routeFlowchartEdges(boxes, [
      { id: 'e0', source: 'a', target: 'b' },
      { id: 'e1', source: 'a', target: 'zzz' },
      { id: 'e2', source: 'a', target: 'a' },
    ]);
    expect(routes.e0.ok).toBe(false);
    expect(fallbacks).toBe(1);
    expect(routes.e1).toBeUndefined();
    expect(routes.e2).toBeUndefined();
  });

  it('plans taller boxes for long labels that wrap at max width', () => {
    const long = 'x'.repeat(80);
    expect(sizeOf(long).width).toBe(320);
    expect(sizeOf(long).height).toBeGreaterThan(17 + 16);
    expect(sizeOf('short')).toEqual({ width: 140, height: 33 });
  });
});
