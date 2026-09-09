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

  test('declares its BASELINE — the revocation is the presenter\'s second run', () => {
    // Not DENY. The denial half needs a manual console step (remove the user from
    // the allowed PingOne group) that no run performs on its own, so while the demo
    // user is still entitled the call legitimately permits and a declared DENY sat
    // as a permanent 'mismatch' on the proof strip. Forcing the outcome instead
    // would make the strip assert enforcement that never ran.
    expect(uc.expectedOutcome).toBe('PERMIT');
  });

  test('still teaches revocation — whatToSay names the step that denies', () => {
    // The point of the card is unchanged; only which half it DECLARES moved. If
    // this stops naming the console step, the card silently becomes a plain
    // happy-path token demo and the reason the outcome is PERMIT is lost.
    expect(uc.whatToSay).toMatch(/remove the user from the group/i);
    expect(uc.whatToSay).toMatch(/access is gone/i);
  });

  test('is gated on the enterprise-managed flag, like UC25', () => {
    expect(uc.maturity).toBe('flag:ff_enterprise_managed_mcp_auth');
  });

  test('points at the code that actually implements the refusal', () => {
    expect(uc.codeRefs).toContain('demo_api_server/services/enterpriseMcpPolicyService.js');
    expect(uc.codeRefs).toContain('demo_api_server/routes/enterpriseIdp.js');
  });
});
