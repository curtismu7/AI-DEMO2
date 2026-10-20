// The live system flow map in the Ping diagram style: every lane is routed around
// the boxes by the shared pingStyle router. Counts what a reader would see
// (lanes the router could not place, lanes that cross, lanes through a box) on
// the layout at rest and after one box is dragged. The browser check on measured
// card sizes is the Playwright probe described in the PR.
import { describe, expect, it } from 'vitest';
import { CANONICAL_EDGES, NODES, RECTS, routeLanes } from '../SystemFlowMap';

const segs = (pts) => pts.slice(1).map((q, i) => [pts[i], q]);
const horiz = ([p, q]) => p.y === q.y;
// A proper crossing: one segment horizontal, the other vertical, meeting strictly inside both.
function crosses(s, t) {
  if (horiz(s) === horiz(t)) return false;
  const [h, v] = horiz(s) ? [s, t] : [t, s];
  const hx = [Math.min(h[0].x, h[1].x), Math.max(h[0].x, h[1].x)];
  const vy = [Math.min(v[0].y, v[1].y), Math.max(v[0].y, v[1].y)];
  return v[0].x > hx[0] && v[0].x < hx[1] && h[0].y > vy[0] && h[0].y < vy[1];
}

// The lanes a run can draw, by scenario. Keys are `from|to`, as buildFlowModel names them.
const CANON = CANONICAL_EDGES.map((e) => e.id);
const SCENARIOS = {
  'a standard agent run (what Simulate replays with no traffic)': CANON,
  'a step-up run: the gateway reaches MFA, consent and CIBA': [...CANON, 'pep|p1-mfa', 'pep|p1-consent', 'pep|p1-ciba'],
  'a Privilege A2A chain run': ['pa-main|pa-gw', 'pa-gw|pa-middle', 'pa-middle|pa-gw', 'pa-gw|pa-specialist'],
};

function analyse(ids, rects) {
  const edges = ids.map((id) => ({ id, source: id.split('|')[0], target: id.split('|')[1] }));
  const { routes, fallbacks } = routeLanes(rects, edges.map((e) => ({ id: e.id, from: e.source, to: e.target })));
  const placed = edges.filter((e) => routes[e.id]?.ok);
  const crossings = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      let n = 0;
      for (const s of segs(routes[placed[i].id].pts)) for (const t of segs(routes[placed[j].id].pts)) if (crosses(s, t)) n += 1;
      if (n) crossings.push(`${placed[i].id} x ${placed[j].id}`);
    }
  }
  let throughBox = 0;
  for (const e of placed) {
    for (const [id, b] of Object.entries(rects)) {
      if (id === e.source || id === e.target) continue;
      for (const [p, q] of segs(routes[e.id].pts)) {
        if (Math.max(p.x, q.x) > b.x && Math.min(p.x, q.x) < b.x + b.w && Math.max(p.y, q.y) > b.y && Math.min(p.y, q.y) < b.y + b.h) throughBox += 1;
      }
    }
  }
  return { fallbacks, crossings, throughBox };
}

describe('System Flow routing at rest', () => {
  it.each(Object.entries(SCENARIOS))('%s: every lane placed, none crossing, none through a box', (_name, ids) => {
    expect(ids.every((id) => RECTS[id.split('|')[0]] && RECTS[id.split('|')[1]])).toBe(true);
    const r = analyse(ids, RECTS);
    expect(r.fallbacks).toBe(0);
    expect(r.crossings).toEqual([]);
    expect(r.throughBox).toBe(0);
  });

  it('the support-console ceremony routes without a fallback (one recorded crossing: a ratchet, lower it, never raise it)', () => {
    const r = analyse(['browser|p1-mfa', 'bff|p1-mfa', 'p1-mfa|bff', 'bff|p1-exchange', 'bff|api', 'bff|browser', 'browser|bff'], RECTS);
    expect(r.fallbacks).toBe(0);
    expect(r.throughBox).toBe(0);
    expect(r.crossings.length).toBeLessThanOrEqual(1);
  });
});

describe('System Flow routing after one box is dragged', () => {
  const overlaps = (a, b, margin) => a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
  // Drops that leave the box a lane's width clear of every other box. Dropping a box on top of another is not a layout to route.
  const clearDrops = (ids) => Object.keys(NODES).flatMap((id) => (ids.some((k) => k.split('|').includes(id))
    ? [40, 60, 90].flatMap((d) => [[0, d], [0, -d], [d, 0], [-d, 0]].map(([dx, dy]) => [id, dx, dy]))
    : []))
    .filter(([id, dx, dy]) => {
      const moved = { ...RECTS[id], x: RECTS[id].x + dx, y: RECTS[id].y + dy };
      return !Object.entries(RECTS).some(([other, r]) => other !== id && overlaps(moved, r, 44));
    });

  // Drops that still leave a crossing (a ratchet: delete an entry when it is fixed, never add one).
  const KNOWN = new Set([
    'standard browser 0,-60',
    'step-up p1-exchange 0,40',
    'step-up p1-exchange 0,60',
    'step-up p1-mfa 0,60',
    'step-up browser 0,-60',
    'chain pa-main 0,60',
    'chain pa-main 0,-60',
    'chain pa-main 0,90',
  ]);
  const RUNS = {
    standard: CANON,
    'step-up': SCENARIOS['a step-up run: the gateway reaches MFA, consent and CIBA'],
    chain: SCENARIOS['a Privilege A2A chain run'],
  };

  it.each(Object.entries(RUNS))('%s run: one box dragged 40, 60 or 90 px along an axis leaves no crossing (bar the recorded ones)', (name, ids) => {
    const drops = clearDrops(ids);
    expect(drops.length).toBeGreaterThan(20);
    const left = [];
    for (const [id, dx, dy] of drops) {
      const r = analyse(ids, { ...RECTS, [id]: { ...RECTS[id], x: RECTS[id].x + dx, y: RECTS[id].y + dy } });
      expect(r.throughBox, `${name} ${id} ${dx},${dy}`).toBe(0);
      expect(r.fallbacks, `${name} ${id} ${dx},${dy}`).toBe(0);
      if (r.crossings.length) left.push(`${name} ${id} ${dx},${dy}`);
    }
    expect(left.filter((k) => !KNOWN.has(k))).toEqual([]);
  });

  it('the standard run, the one Simulate replays, leaves a crossing in at most one clear drop', () => {
    const drops = clearDrops(CANON);
    const crossing = drops.filter(([id, dx, dy]) => analyse(CANON, { ...RECTS, [id]: { ...RECTS[id], x: RECTS[id].x + dx, y: RECTS[id].y + dy } }).crossings.length);
    expect(crossing.length).toBeLessThanOrEqual(1);
  });
});
