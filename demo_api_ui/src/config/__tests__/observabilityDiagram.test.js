import { describe, it, expect } from 'vitest';
import { buildObservabilityDiagram, OBS_PLANES } from '../observabilityDiagram';
import { MCP_OBS_GROUPS, MCP_OBS_NODES, MCP_OBS_EDGES, MCP_OBS_STEPS } from '../mcpObservabilityDiagram';

const PING_PALETTE = ['#151a24', '#b5231a', '#5a5f69'];
const KINDS = ['rfc', 'spec', 'emerging'];

const cfgs = [
  ['observability (all planes)', buildObservabilityDiagram('all')],
  ...OBS_PLANES.map((p) => [`observability (${p})`, buildObservabilityDiagram(p)]),
  ['mcp observability', { GROUPS: MCP_OBS_GROUPS, NODES: MCP_OBS_NODES, EDGES: MCP_OBS_EDGES, STEPS: MCP_OBS_STEPS }],
];

describe.each(cfgs)('%s diagram', (_n, { GROUPS, NODES, EDGES, STEPS }) => {
  it('edges reference nodes, nodes reference groups, ids are unique', () => {
    const ids = new Set(NODES.map((n) => n.id));
    expect(ids.size).toBe(NODES.length);
    EDGES.forEach(([s, t]) => { expect(ids.has(s)).toBe(true); expect(ids.has(t)).toBe(true); });
    NODES.forEach((n) => expect(GROUPS[n.group]).toBeDefined());
  });
  it('uses the Ping palette', () => {
    Object.values(GROUPS).forEach((g) => expect(PING_PALETTE).toContain(g.bg));
  });
  it('steps cover every edge exactly once', () => {
    expect(STEPS.flatMap((s) => s.edges).sort((a, b) => a - b)).toEqual(EDGES.map((_, i) => i));
  });
  it('every step has a request form, kinded standards, and says why there is no token', () => {
    STEPS.forEach((s) => {
      expect(s.detail.form.length, s.key).toBeGreaterThan(10);
      expect(s.detail.refs.length, s.key).toBeGreaterThan(0);
      s.detail.refs.forEach((r) => expect(KINDS).toContain(r.kind));
      expect(s.detail.tokens).toEqual([]);
      expect(s.detail.form).toContain(s.detail.noToken);
    });
  });
  it('no emoji, no JWT literal', () => {
    const text = JSON.stringify({ NODES, EDGES, STEPS });
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
  it('boxes sit on a wide grid (no two boxes closer than 200px across and 120px down)', () => {
    NODES.forEach((a, i) => NODES.slice(i + 1).forEach((b) => {
      expect(Math.abs(a.x - b.x) >= 200 || Math.abs(a.y - b.y) >= 120, `${a.id}/${b.id}`).toBe(true);
    }));
  });
});

describe('observability plane filter', () => {
  it('each plane keeps only its own arrows and the boxes they touch', () => {
    const all = buildObservabilityDiagram('all');
    const sum = OBS_PLANES.reduce((n, p) => n + buildObservabilityDiagram(p).EDGES.length, 0);
    expect(sum).toBe(all.EDGES.length);
    const metrics = buildObservabilityDiagram('metrics');
    expect(metrics.NODES.map((n) => n.id)).not.toContain('loki');
    expect(metrics.NODES.map((n) => n.id)).toContain('prom');
  });
  it('Grafana is shared by all three planes', () => {
    OBS_PLANES.forEach((p) => expect(buildObservabilityDiagram(p).NODES.map((n) => n.id)).toContain('graf'));
  });
  it('the data hops match the stack', () => {
    const text = JSON.stringify(buildObservabilityDiagram('all').STEPS);
    ['/v1/traces', '/loki/api/v1/push', ':8085', 'default receiver is a deliberate no-op'].forEach((w) => expect(text).toContain(w));
  });
});
