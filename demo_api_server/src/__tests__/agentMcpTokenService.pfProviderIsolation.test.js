'use strict';

jest.mock('../../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingfederate'),
  getEffective: jest.fn((key) => ({
    pf_id_jag_enabled: 'true',
    pf_id_jag_subject_token_type: 'urn:ietf:params:oauth:token-type:refresh_token',
    pf_id_jag_audience: 'https://downstream.example.test',
    pf_id_jag_resource: 'https://api.example.test',
    pf_id_jag_scope: 'accounts:read',
  }[key] || '')),
}));

jest.mock('../../services/oauthService', () => ({
  performIdJagExchange: jest.fn(),
  redeemIdJag: jest.fn(),
  performTokenExchange: jest.fn(),
}));

const oauthService = require('../../services/oauthService');
const { resolvePingFederateIdJagToken, resolveMcpAccessTokenWithEvents, __test } = require('../../services/agentMcpTokenService');

const idJag = [
  Buffer.from(JSON.stringify({ typ: 'oauth-id-jag+jwt', alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ iss: 'https://pf.example.test', sub: 'user-1', aud: 'https://downstream.example.test', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url'),
  'signature',
].join('.');
const liveSession = () => ({
  oauthType: 'user', oauthProvider: 'pingfederate',
  idJagRunIntent: {
    useCaseId: 'enterprise-managed-mcp-authorization', mode: 'live-id-jag',
    createdAt: Date.now(), nonce: 'a'.repeat(32), returnTo: '/pingfederate-id-jag/demo',
  },
  oauthTokens: { refreshToken: 'server-refresh-token' },
});

describe('PingFederate provider isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    oauthService.performIdJagExchange.mockResolvedValue(idJag);
    oauthService.redeemIdJag.mockResolvedValue('downstream-access-token');
  });

  test('selects ID-JAG only for the explicit enterprise-managed demo run', () => {
    expect(__test.shouldUsePfIdJagForRun('pingfederate', 'enterprise-managed-mcp-authorization')).toBe(true);
    expect(__test.shouldUsePfIdJagForRun('pingfederate', 'delegated-access-with-proof')).toBe(false);
    expect(__test.shouldUsePfIdJagForRun('pingone', 'enterprise-managed-mcp-authorization')).toBe(false);
    expect(__test.shouldUsePfIdJagForRun('pingfederate', null)).toBe(false);
  });

  test('uses PF ID-JAG methods and never the legacy exchange method', async () => {
    const events = [];
    const token = await resolvePingFederateIdJagToken({
      session: liveSession(),
    }, events, { resource: 'https://api.example.test', scope: ['accounts:read'] });

    expect(token).toBe('downstream-access-token');
    expect(oauthService.performIdJagExchange).toHaveBeenCalledWith(
      'server-refresh-token',
      'urn:ietf:params:oauth:token-type:refresh_token',
      'https://downstream.example.test',
      'https://api.example.test',
      ['accounts:read'],
    );
    expect(oauthService.redeemIdJag).toHaveBeenCalledWith(
      idJag,
      'https://api.example.test',
      ['accounts:read'],
    );
    expect(oauthService.performTokenExchange).not.toHaveBeenCalled();
    expect(events.map((event) => event.id)).toEqual([
      'pf-id-jag-issued',
      'pf-id-jag-redeemed',
    ]);
    expect(events.every((event) => event.provenance === 'live-id-jag' && event.mode === 'id-jag')).toBe(true);
  });

  test('rejects UC40 without a PF user session before any exchange', async () => {
    const req = { body: { useCaseId: 'enterprise-managed-mcp-authorization' }, session: { oauthType: 'user', oauthProvider: 'pingfederate' } };
    await expect(resolveMcpAccessTokenWithEvents(req, 'get_account_balance')).rejects.toMatchObject({
      code: 'id_jag_login_required',
      loginTarget: '/pingfederate-id-jag/demo',
    });
    expect(oauthService.performIdJagExchange).not.toHaveBeenCalled();
    expect(oauthService.performTokenExchange).not.toHaveBeenCalled();
  });

  test('rejects PingOne session even when a live intent is present', async () => {
    const req = { body: { useCaseId: 'enterprise-managed-mcp-authorization' }, session: { oauthType: 'user', oauthProvider: 'pingone', idJagRunIntent: { mode: 'live-id-jag', useCaseId: 'enterprise-managed-mcp-authorization' }, oauthTokens: { accessToken: 'user-token' } } };
    await expect(resolveMcpAccessTokenWithEvents(req, 'get_account_balance')).rejects.toMatchObject({ code: 'id_jag_provider_required' });
    expect(oauthService.performIdJagExchange).not.toHaveBeenCalled();
  });

  test('rejects a PF session with no tokens and no live intent', () => {
    expect(() => __test.assertPfIdJagRunAllowed({ session: { oauthType: 'user', oauthProvider: 'pingfederate' } }, 'enterprise-managed-mcp-authorization')).toThrow(expect.objectContaining({ code: 'id_jag_login_required' }));
  });

  // Regression: an existing PF session used to be refused (forcing a second
  // sign-in) unless it carried a fresh intent from the logout/login handoff.
  test('reuses an existing PF session without a live intent', () => {
    const session = { oauthType: 'user', oauthProvider: 'pingfederate', oauthTokens: { accessToken: 'user-token' } };
    expect(() => __test.assertPfIdJagRunAllowed({ session }, 'enterprise-managed-mcp-authorization')).not.toThrow();
  });
});
