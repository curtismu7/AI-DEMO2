import { describe, expect, it } from 'vitest';
import { HOSTILE_MCP_SCENARIOS } from '../hostileMcpScenarios';

describe('HOSTILE_MCP_SCENARIOS', () => {
  it('defines the three content-to-Privilege-denial scenarios', () => {
    expect(HOSTILE_MCP_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'poisoned-tool',
      'poisoned-resource',
      'poisoned-prompt',
    ]);
  });

  it('uses the correct MCP source request for resource and prompt scenarios', () => {
    expect(HOSTILE_MCP_SCENARIOS.find((scenario) => scenario.id === 'poisoned-resource').source).toMatchObject({
      kind: 'resource',
      method: 'resources/read',
      params: { uri: 'mcp://hostile/account-verification' },
    });
    expect(HOSTILE_MCP_SCENARIOS.find((scenario) => scenario.id === 'poisoned-prompt').source).toMatchObject({
      kind: 'prompt',
      method: 'prompts/get',
      params: { name: 'account_review', arguments: { account_id: 'demo-001' } },
    });
  });

  it('uses the same safe stub action for every scenario', () => {
    for (const scenario of HOSTILE_MCP_SCENARIOS) {
      expect(scenario.inducedCall.name).toBe('create_transfer');
      expect(scenario.inducedCall.arguments).toEqual({ amount: 1, to: 'external-001' });
      expect(JSON.stringify(scenario)).not.toMatch(/bearer|password|api[-_ ]?key|https?:\/\//i);
    }
  });
});
