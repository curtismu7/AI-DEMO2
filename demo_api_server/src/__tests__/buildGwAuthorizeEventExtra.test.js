'use strict';

const { buildGwAuthorizeEventExtra } = require('../../services/agentMcpTokenService');

describe('buildGwAuthorizeEventExtra', () => {
  it('maps PingGateway parameters/rawResponse into all Token Chain aliases', () => {
    const extra = buildGwAuthorizeEventExtra({
      decision: 'PERMIT',
      backend: 'real',
      url: 'https://api.pingone.com/v1/environments/e/decisionEndpoints/d',
      tool: 'get_my_accounts',
      method: 'tools/call',
      vertical: 'banking',
      parameters: { ToolName: 'get_my_accounts', UserId: 'u1' },
      rawResponse: { decision: 'PERMIT', id: 'dec_1' },
      reason: null,
      statements: [{ effect: 'permit' }],
    });
    expect(extra.parameters).toEqual({ ToolName: 'get_my_accounts', UserId: 'u1' });
    expect(extra.rawResponse).toEqual({ decision: 'PERMIT', id: 'dec_1' });
    expect(extra.authorizeRequest).toEqual({ parameters: { ToolName: 'get_my_accounts', UserId: 'u1' } });
    expect(extra.authorizeResponse).toEqual({ decision: 'PERMIT', id: 'dec_1' });
    expect(extra.decision).toBe('PERMIT');
    expect(extra.url).toContain('decisionEndpoints');
  });

  it('returns empty object for null input', () => {
    expect(buildGwAuthorizeEventExtra(null)).toEqual({});
  });

  it('forwards denyingFilter / filterChain / lastFilter for Token Chain teaching', () => {
    const extra = buildGwAuthorizeEventExtra({
      decision: 'DENY',
      denyingFilter: 'P1AZDecision',
      lastFilter: null,
      filterChain: [{ filter: 'P1AZDecision', result: 'blocked', decision: 'DENY' }],
      policy: { passed: true },
    });
    expect(extra.denyingFilter).toBe('P1AZDecision');
    expect(extra.filterChain).toEqual([{ filter: 'P1AZDecision', result: 'blocked', decision: 'DENY' }]);
    expect(extra.policy).toEqual({ passed: true });
  });
});
