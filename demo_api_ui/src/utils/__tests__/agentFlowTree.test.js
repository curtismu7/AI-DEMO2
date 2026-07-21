import { describe, it, expect } from 'vitest';
import { buildAgentFlowTree } from '../agentFlowTree';

describe('buildAgentFlowTree', () => {
  it('groups known step ids into their phase, in phase order', () => {
    const steps = [
      { id: 'as', title: 'PingOne — Demo User App', status: 'done' },
      { id: 'bff', title: 'BFF — POST /api/mcp/tool', status: 'done' },
      { id: 'tool', title: 'MCP tool — get_accounts', status: 'done' },
    ];
    const tree = buildAgentFlowTree(steps, []);
    expect(tree.map((g) => g.key)).toEqual(['auth', 'agent_gateway', 'tool_execution']);
    expect(tree[0].nodes[0]).toMatchObject({ id: 'step-as', kind: 'step', status: 'done' });
  });

  it('falls back unknown step ids to the OTHER group instead of dropping them', () => {
    const steps = [{ id: 'future-step', title: 'New step', status: 'done' }];
    const tree = buildAgentFlowTree(steps, []);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ key: 'other', label: 'OTHER' });
  });

  it('appends a trailing TOKENS MINTED group, sorted by timestamp, when tokens exist', () => {
    const tokenChain = [
      { id: 'tok-2', tokenType: 'mcp_token', timestamp: 200 },
      { id: 'tok-1', tokenType: 'user_token', timestamp: 100 },
    ];
    const tree = buildAgentFlowTree([], tokenChain);
    expect(tree).toHaveLength(1);
    expect(tree[0].key).toBe('tokens');
    expect(tree[0].nodes.map((n) => n.id)).toEqual(['token-tok-1', 'token-tok-2']);
  });

  it('omits the TOKENS MINTED group entirely when tokenChain is empty', () => {
    const tree = buildAgentFlowTree([{ id: 'as', title: 'x', status: 'done' }], []);
    expect(tree.some((g) => g.key === 'tokens')).toBe(false);
  });

  it('returns an empty array when there are no steps and no tokens', () => {
    expect(buildAgentFlowTree([], [])).toEqual([]);
    expect(buildAgentFlowTree(undefined, undefined)).toEqual([]);
  });
});
