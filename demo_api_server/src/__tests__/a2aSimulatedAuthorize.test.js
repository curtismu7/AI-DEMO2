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

  // Audience parity with the cloud policy's HasValidMcpAudience, which accepts
  // every gateway identity in scope-topology.json (role "mcp-gateway"). A
  // specialist's nested-act token is audienced to the A2A gateway, so a
  // single-value comparison against the expected URI denied every A2A call.
  const scopeTopology = require('../../services/scopeTopology');
  const A2A_GATEWAY_AUD = scopeTopology.resourceUri('Super Banking A2A MCP Gateway');
  const EXPECTED_URI = scopeTopology.resourceUri('Super Banking PingGateway MCP');

  it('PERMITs a depth-2 A2A token audienced to the A2A gateway', async () => {
    const r = await evaluateMcpFirstTool({
      userId: 'u1',
      toolName: 'get_portfolio_summary',
      actClientId: 'investment-specialist',
      nestedActClientId: 'generalist-agent',
      tokenAudience: A2A_GATEWAY_AUD,
      mcpResourceUri: EXPECTED_URI,
    });
    expect(r.raw.reason || '').not.toMatch(/Audience mismatch/);
    expect(r.decision).toBe('PERMIT');
  });

  it('still DENYs a token audienced to something that is not a gateway', async () => {
    const r = await evaluateMcpFirstTool({
      userId: 'u1',
      toolName: 'get_portfolio_summary',
      actClientId: 'investment-specialist',
      nestedActClientId: 'generalist-agent',
      tokenAudience: scopeTopology.resourceUri('Super Banking MCP Server'),
      mcpResourceUri: EXPECTED_URI,
    });
    expect(r.decision).toBe('DENY');
    expect(r.raw.reason).toMatch(/Audience mismatch/);
  });
});
