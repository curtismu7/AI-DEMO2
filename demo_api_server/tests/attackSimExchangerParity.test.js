'use strict';
/**
 * Durable guard against audience drift in the attack sims.
 *
 * ROOT CAUSE this guards (2026-07-10): the attack sims exchanged the user token
 * with the plain default-app RFC 8693 exchange, so PingOne minted the token for
 * the scope-owning API resource (aud=enduser.ping.demo) instead of the gateway
 * audience. BOTH the Node MCP Gateway and PingGateway (IG) reject that audience,
 * so every sim was denied for "wrong audience" — the correct gateway/policy
 * control (insufficient_scope, rate_limited, resource_owner_mismatch, ...) was
 * masked behind an audience failure. The real chip flow avoids this by
 * authenticating the exchange AS the MCP Exchanger app (granted the gateway
 * scopes by the two-exchange reconciler), which binds the correct `aud`.
 *
 * This test locks in that the sims use the SAME exchanger-app path, so the fix
 * cannot silently regress to the plain exchange. It uses mocks only (no creds,
 * no network) and always runs.
 */

jest.mock('../services/oauthService', () => ({
  performTokenExchangeAs: jest.fn().mockResolvedValue('exchanged.via.exchanger'),
  performTokenExchange: jest.fn().mockResolvedValue('exchanged.plain'),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(),
}));

const oauthService = require('../services/oauthService');
const configStore = require('../services/configStore');
const { _exchangeSimToken } = require('../services/attackSimulatorService');

describe('attack-sim token exchange — exchanger-app parity (anti-drift guard)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses performTokenExchangeAs (MCP Exchanger app) when exchanger creds are configured', async () => {
    configStore.getEffective.mockImplementation((k) => {
      if (k === 'pingone_mcp_token_exchanger_client_id') return 'MOCK_CLIENT_ID_not_real';
      if (k === 'pingone_mcp_token_exchanger_client_secret') return 'MOCK_VALUE_not_real';
      return undefined;
    });

    const token = await _exchangeSimToken('user.subject.token', 'mcpgateway.ping.demo', ['read']);

    expect(oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(1);
    // Signature: (subjectToken, actorToken, clientId, clientSecret, audience, scopes, method)
    const call = oauthService.performTokenExchangeAs.mock.calls[0];
    expect(call[0]).toBe('user.subject.token');
    expect(call[2]).toBe('MOCK_CLIENT_ID_not_real');   // authenticates AS the exchanger app
    expect(call[4]).toBe('mcpgateway.ping.demo');       // binds the requested gateway audience
    expect(call[5]).toEqual(['read']);
    expect(oauthService.performTokenExchange).not.toHaveBeenCalled();
    expect(token).toBe('exchanged.via.exchanger');
  });

  test('falls back to plain exchange only when the exchanger app is not configured (dev parity)', async () => {
    configStore.getEffective.mockReturnValue(undefined);

    const token = await _exchangeSimToken('user.subject.token', 'mcpgateway.ping.demo', ['read']);

    expect(oauthService.performTokenExchange).toHaveBeenCalledTimes(1);
    expect(oauthService.performTokenExchangeAs).not.toHaveBeenCalled();
    expect(token).toBe('exchanged.plain');
  });
});
