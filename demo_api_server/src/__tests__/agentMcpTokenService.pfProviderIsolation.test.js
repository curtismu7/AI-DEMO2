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
const { resolvePingFederateIdJagToken, __test } = require('../../services/agentMcpTokenService');

const idJag = [
  Buffer.from(JSON.stringify({ typ: 'oauth-id-jag+jwt', alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ iss: 'https://pf.example.test', sub: 'user-1', aud: 'https://downstream.example.test', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url'),
  'signature',
].join('.');

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
      session: { oauthTokens: { refreshToken: 'server-refresh-token' } },
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
  });
});
