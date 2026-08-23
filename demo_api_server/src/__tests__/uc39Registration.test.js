'use strict';

const { USE_CASES } = require('../../config/useCases');
const authRequirements = require('../../config/auth-requirements.json');

describe('UC39 — centralized MCP revocation', () => {
  const uc = USE_CASES.find((u) => u.id === 'UC39');

  test('exists as a controls-track use case', () => {
    expect(uc).toBeTruthy();
    expect(uc.track).toBe('controls');
    expect(uc.useCaseId).toBe('enterprise-mcp-revocation');
  });

  test('declares its auth level in the source of truth', () => {
    expect(authRequirements.useCases.UC39).toBe('user');
  });

  test('expects a denial — the whole point is that access is gone', () => {
    expect(uc.expectedOutcome).toBe('DENY');
  });

  test('is gated on the enterprise-managed flag, like UC25', () => {
    expect(uc.maturity).toBe('flag:ff_enterprise_managed_mcp_auth');
  });

  test('points at the code that actually implements the refusal', () => {
    expect(uc.codeRefs).toContain('demo_api_server/services/enterpriseMcpPolicyService.js');
    expect(uc.codeRefs).toContain('demo_api_server/routes/enterpriseIdp.js');
  });
});
