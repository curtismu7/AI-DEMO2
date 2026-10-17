import { describe, it, expect } from 'vitest';
import * as dot from './dotWorkbenchDiagram';
import * as aic from './aicTokenExchangeDiagram';

const cases = [
  ['dot', { GROUPS: dot.DOT_WORKBENCH_GROUPS, NODES: dot.DOT_WORKBENCH_NODES, EDGES: dot.DOT_WORKBENCH_EDGES, STEPS: dot.DOT_WORKBENCH_STEPS }],
  ['aic', { GROUPS: aic.AIC_EXCHANGE_GROUPS, NODES: aic.AIC_EXCHANGE_NODES, EDGES: aic.AIC_EXCHANGE_EDGES, STEPS: aic.AIC_EXCHANGE_STEPS }],
];

describe.each(cases)('%s diagram config', (_n, { GROUPS, NODES, EDGES, STEPS }) => {
  it('edges reference nodes and nodes reference groups', () => {
    const ids = new Set(NODES.map((n) => n.id));
    expect(ids.size).toBe(NODES.length);
    EDGES.forEach(([s, t]) => { expect(ids.has(s)).toBe(true); expect(ids.has(t)).toBe(true); });
    NODES.forEach((n) => expect(GROUPS[n.group]).toBeDefined());
  });
  it('steps cover every edge exactly once', () => {
    const covered = STEPS.flatMap((s) => s.edges).sort((a, b) => a - b);
    expect(covered).toEqual(EDGES.map((_, i) => i));
  });
});
