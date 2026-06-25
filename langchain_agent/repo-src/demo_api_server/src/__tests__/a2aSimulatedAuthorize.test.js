/**
 * @file a2aSimulatedAuthorize.test.js
 * BFF simulated Authorize parity for the A2A act-chain guard (Slice 2). Mirrors
 * demo_authz_server Rule 1c: an a2aDelegated tool is DENIED unless the token's act
 * chain shows a specialist delegated by the generalist (nestedActClientId present).
 */

const { evaluateMcpFirstTool } = require('../../services/simulatedAuthorizeService');

describe('simulatedAuthorizeService — A2A act-chain guard', () => {
  it('DENYs an a2aDelegated tool for the generalist (no nested delegation)', async () => {
    const r = await evaluateMcpFirstTool({ userId: 'u1', toolName: 'get_portfolio_summary', actClientId: 'generalist-agent' });
    expect(r.decision).toBe('DENY');
    expect(r.raw.reason).toMatch(/a2a_delegation_required/);
  });

  it('PERMITs an a2aDelegated tool when a specialist is delegated (nested act present)', async () => {
    const r = await evaluateMcpFirstTool({
      userId: 'u1',
      toolName: 'get_portfolio_summary',
      actClientId: 'investment-specialist',
      nestedActClientId: 'generalist-agent',
    });
    expect(r.raw.reason || '').not.toMatch(/a2a_delegation_required/);
    expect(r.decision).toBe('PERMIT');
  });

  it('DENYs a read-scoped sensitive tool for the generalist (depth 1)', async () => {
    const r = await evaluateMcpFirstTool({ userId: 'u1', toolName: 'sensitive_patient_records', actClientId: 'generalist-agent' });
    expect(r.decision).toBe('DENY');
    expect(r.raw.reason).toMatch(/a2a_delegation_required/);
  });

  it('leaves non-a2a tools unaffected', async () => {
    const r = await evaluateMcpFirstTool({ userId: 'u1', toolName: 'get_my_accounts', actClientId: 'generalist-agent' });
    expect(r.decision).toBe('PERMIT');
  });
});
