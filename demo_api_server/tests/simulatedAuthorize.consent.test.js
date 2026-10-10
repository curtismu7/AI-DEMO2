'use strict';

/**
 * Task 4 (may_act re-architecture): the simulated P1AZ engine's per-user
 * consent guard — parity with demo_authz_server Rule 2.6 (Task 3).
 *
 * On agent-mediated tools the acting agent (actClientId) must match the
 * signed-in user's consent (mayActSub). Absent → DENY no_user_consent;
 * mismatch → DENY may_act_mismatch. A2A-delegated tools skip (act chain is
 * their authorization), as do calls without an agent actor.
 */

jest.mock('../services/configStore', () => ({
  get: jest.fn((key) => (key === 'ff_require_act_for_agent_tools' ? 'true' : 'false')),
  getEffective: jest.fn(() => ''),
}));

const { evaluateMcpFirstTool } = require('../services/simulatedAuthorizeService');

function baseParams(extra = {}) {
  return {
    userId: 'user-1',
    toolName: 'create_transfer',
    tokenAudience: 'mcpgateway.ping.demo',
    actClientId: 'agent-1',
    mayActSub: 'agent-1',
    amount: null,
    ...extra,
  };
}

describe('evaluateMcpFirstTool — Rule 2.6 parity (per-user consent)', () => {
  // create_transfer is a consent-challenge tool, so the no-consent-issue
  // baseline is the HITL pause (INDETERMINATE), not PERMIT — the same shape
  // the challenge rules produce. The consent guard must fire BEFORE that
  // pause (parity with demo_authz_server, where Rule 2.6 precedes Rule 4).
  test('pass: mayActSub === actClientId → the HITL pause, not a consent deny', async () => {
    const out = await evaluateMcpFirstTool(baseParams());
    expect(out.decision).toBe('INDETERMINATE');
    expect(out.raw?.reason || '').toMatch(/consent tool/);
  });

  test('mismatch: consented actor differs from acting agent → DENY may_act_mismatch (before the challenge)', async () => {
    const out = await evaluateMcpFirstTool(baseParams({ mayActSub: 'some-other-agent' }));
    expect(out.decision).toBe('DENY');
    expect(out.raw?.reason || '').toMatch(/may_act_mismatch/);
  });

  test('absent: no bridged consent → DENY no_user_consent (fail closed)', async () => {
    const out = await evaluateMcpFirstTool(baseParams({ mayActSub: null }));
    expect(out.decision).toBe('DENY');
    expect(out.raw?.reason || '').toMatch(/no_user_consent/);
  });

  test('skips A2A-delegated tools (act chain authorizes them)', async () => {
    const out = await evaluateMcpFirstTool(baseParams({
      toolName: 'get_portfolio_summary',
      mayActSub: null,
      nestedActClientId: 'agent-1',
    }));
    expect(String(out.raw?.reason || out.reason || '')).not.toMatch(/no_user_consent/);
  });

  test('skips non-agent-mediated tools', async () => {
    const out = await evaluateMcpFirstTool(baseParams({
      toolName: 'get_my_accounts',
      mayActSub: null,
    }));
    expect(String(out.raw?.reason || out.reason || '')).not.toMatch(/no_user_consent/);
  });
});
