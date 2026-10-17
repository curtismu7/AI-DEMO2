import { describe, expect, it } from 'vitest';
import * as dc from '../delegatedCommerceDiagram';
import * as chain from '../delegationChainValueDiagram';
import * as pa from '../personalAgentStudioDiagram';

const cfgs = {
  delegatedCommerce: [dc.DELEGATED_COMMERCE_NODES, dc.DELEGATED_COMMERCE_EDGES, dc.DELEGATED_COMMERCE_GROUPS, dc.DELEGATED_COMMERCE_STEPS],
  delegationChain: [chain.DELEGATION_CHAIN_NODES, chain.DELEGATION_CHAIN_EDGES, chain.DELEGATION_CHAIN_GROUPS, chain.DELEGATION_CHAIN_STEPS],
  personalAgent: [pa.PERSONAL_AGENT_NODES, pa.PERSONAL_AGENT_EDGES, pa.PERSONAL_AGENT_GROUPS, pa.PERSONAL_AGENT_STEPS],
};

describe.each(Object.entries(cfgs))('%s diagram config', (_n, [nodes, edges, groups, steps]) => {
  it('edges reference nodes, nodes reference groups, ids unique', () => {
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    nodes.forEach((n) => expect(groups[n.group]).toBeTruthy());
    edges.forEach(([s, t]) => { expect(ids).toContain(s); expect(ids).toContain(t); });
  });
  it('steps cover every edge exactly once', () => {
    const covered = steps.flatMap((s) => s.edges).sort((a, b) => a - b);
    expect(covered).toEqual(edges.map((_, i) => i));
  });
});
