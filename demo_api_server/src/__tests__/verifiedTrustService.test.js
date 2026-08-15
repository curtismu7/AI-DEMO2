/**
 * @file verifiedTrustService.test.js
 * @description Unit tests for services/verifiedTrustService.js
 *
 * Covers:
 *   isEnabled()                    — ff_verified_trust_a2a flag read
 *   issueAgentTrustAssertion()     — missing config, endpoint construction,
 *                                    malformed flow response, 403/404 wrapping
 */

'use strict';

// ── Mock axios and configStore BEFORE requiring the service ──────────────────
jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(),
}));

const axios = require('axios');
const configStore = require('../../services/configStore');
const { isEnabled, issueAgentTrustAssertion } = require('../../services/verifiedTrustService');

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.PINGONE_DAVINCI_COMPANY_ID;
  delete process.env.PINGONE_DAVINCI_API_KEY;
  delete process.env.PINGONE_VERIFIED_TRUST_FLOW_ID;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// ═══════════════════════════════════════════════════════════════════════════
// isEnabled()
// ═══════════════════════════════════════════════════════════════════════════

describe('verifiedTrustService.isEnabled()', () => {
  test('true when ff_verified_trust_a2a is "true"', () => {
    configStore.getEffective.mockReturnValue('true');
    expect(isEnabled()).toBe(true);
    expect(configStore.getEffective).toHaveBeenCalledWith('ff_verified_trust_a2a');
  });

  test('false when the flag is unset', () => {
    configStore.getEffective.mockReturnValue(undefined);
    expect(isEnabled()).toBe(false);
  });

  test('false when the flag is explicitly "false"', () => {
    configStore.getEffective.mockReturnValue('false');
    expect(isEnabled()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// issueAgentTrustAssertion()
// ═══════════════════════════════════════════════════════════════════════════

describe('verifiedTrustService.issueAgentTrustAssertion()', () => {
  const ARGS = { agentId: 'agent-invest-specialist', actingForUserId: 'user-1', scope: 'invest:read', chainId: 'chain-abc' };

  test('throws NOT_CONFIGURED when DaVinci env vars are missing, and never calls axios', async () => {
    await expect(issueAgentTrustAssertion(ARGS)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('throws NOT_CONFIGURED when only some of the three env vars are set', async () => {
    process.env.PINGONE_DAVINCI_COMPANY_ID = 'company-1';
    // PINGONE_DAVINCI_API_KEY and PINGONE_VERIFIED_TRUST_FLOW_ID left unset
    await expect(issueAgentTrustAssertion(ARGS)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('posts to the DaVinci orchestrate-api policy/start endpoint with X-SK-API-KEY', async () => {
    process.env.PINGONE_DAVINCI_COMPANY_ID = 'company-1';
    process.env.PINGONE_DAVINCI_API_KEY = 'sk-key-1';
    process.env.PINGONE_VERIFIED_TRUST_FLOW_ID = 'policy-1';
    axios.post.mockResolvedValueOnce({
      data: { credential: 'eyJhbGciOi...mockSdJwt', credentialId: 'cred-789', expiresAt: '2026-08-10T13:00:00Z' },
    });

    const result = await issueAgentTrustAssertion(ARGS);

    expect(result).toEqual({
      credential: 'eyJhbGciOi...mockSdJwt',
      credentialId: 'cred-789',
      expiresAt: '2026-08-10T13:00:00Z',
    });
    expect(axios.post).toHaveBeenCalledWith(
      'https://orchestrate-api.pingone.com/v1/company/company-1/policy/policy-1/start',
      { agent_id: 'agent-invest-specialist', acting_for: 'user-1', scope: 'invest:read', chain_id: 'chain-abc' },
      { headers: { 'X-SK-API-KEY': 'sk-key-1', 'Content-Type': 'application/json' } }
    );
  });

  test('throws MALFORMED_RESPONSE when the flow response has no credential', async () => {
    process.env.PINGONE_DAVINCI_COMPANY_ID = 'company-1';
    process.env.PINGONE_DAVINCI_API_KEY = 'sk-key-1';
    process.env.PINGONE_VERIFIED_TRUST_FLOW_ID = 'policy-1';
    axios.post.mockResolvedValueOnce({ data: {} });

    await expect(issueAgentTrustAssertion(ARGS)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });

  test('wraps a 404 (flow/policy not found) as NOT_ENTITLED', async () => {
    process.env.PINGONE_DAVINCI_COMPANY_ID = 'company-1';
    process.env.PINGONE_DAVINCI_API_KEY = 'sk-key-1';
    process.env.PINGONE_VERIFIED_TRUST_FLOW_ID = 'policy-missing';
    axios.post.mockRejectedValueOnce({ response: { status: 404 } });

    await expect(issueAgentTrustAssertion(ARGS)).rejects.toMatchObject({ code: 'NOT_ENTITLED' });
  });

  test('wraps a 403 (no DaVinci Advanced entitlement) as NOT_ENTITLED', async () => {
    process.env.PINGONE_DAVINCI_COMPANY_ID = 'company-1';
    process.env.PINGONE_DAVINCI_API_KEY = 'sk-key-1';
    process.env.PINGONE_VERIFIED_TRUST_FLOW_ID = 'policy-1';
    axios.post.mockRejectedValueOnce({ response: { status: 403 } });

    await expect(issueAgentTrustAssertion(ARGS)).rejects.toMatchObject({ code: 'NOT_ENTITLED' });
  });

  test('propagates an unrelated error (e.g. network failure) unwrapped', async () => {
    process.env.PINGONE_DAVINCI_COMPANY_ID = 'company-1';
    process.env.PINGONE_DAVINCI_API_KEY = 'sk-key-1';
    process.env.PINGONE_VERIFIED_TRUST_FLOW_ID = 'policy-1';
    const networkErr = new Error('ECONNRESET');
    axios.post.mockRejectedValueOnce(networkErr);

    await expect(issueAgentTrustAssertion(ARGS)).rejects.toThrow('ECONNRESET');
  });
});
