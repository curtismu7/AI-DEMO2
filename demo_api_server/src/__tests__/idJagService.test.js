'use strict';

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('axios');

const axios = require('axios');
const configStore = require('../../services/configStore');
// Module scope, not lazy: setup.js's afterEach calls jest.resetModules(), so a
// require() inside a helper would bind to a different module registry than the
// mocks configured here.
const idJagService = require('../../services/idJagService');

const AS_ISSUER = 'https://mcpserver.ping.demo:8080';
const RESOURCE = 'https://mcpserver.ping.demo';

function withConfig(overrides = {}) {
  const base = {
    enterprise_idp_issuer: 'https://idp.ping.demo',
    enterprise_idp_jwks_url: 'https://api.ping.demo:3001/api/enterprise-idp/jwks',
    enterprise_mcp_as_token_url: `${AS_ISSUER}/token`,
    enterprise_mcp_as_issuer: AS_ISSUER,
  };
  const merged = { ...base, ...overrides };
  configStore.getEffective.mockImplementation((k) => (k in merged ? merged[k] : ''));
}

describe('idJagService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withConfig();
  });

  test('native mode requires BOTH issuer and jwks url', () => {
    expect(idJagService.isNativeIdJagEnabled()).toBe(true);

    withConfig({ enterprise_idp_jwks_url: '' });
    expect(idJagService.isNativeIdJagEnabled()).toBe(false);

    withConfig({ enterprise_idp_issuer: '' });
    expect(idJagService.isNativeIdJagEnabled()).toBe(false);

    withConfig({ enterprise_idp_issuer: '', enterprise_idp_jwks_url: '' });
    expect(idJagService.isNativeIdJagEnabled()).toBe(false);
  });

  test('mintIdJag posts a spec-shaped token-exchange request', async () => {
    axios.post.mockResolvedValue({
      data: {
        access_token: 'the.id.jag',
        issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
        expires_in: 120,
      },
    });
    const req = { session: { user: { oauthId: 'user-123' } }, headers: {} };
    const out = await idJagService.mintIdJag(req, {
      audience: AS_ISSUER, resource: RESOURCE, scope: 'banking:read',
    });

    expect(out.assertion).toBe('the.id.jag');
    const [, body] = axios.post.mock.calls[0];
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(body.requested_token_type).toBe('urn:ietf:params:oauth:token-type:id-jag');
    expect(body.subject_token_type).toBe('urn:ietf:params:oauth:token-type:id_token');
    expect(body.audience).toBe(AS_ISSUER);
    expect(body.resource).toBe(RESOURCE);
    expect(body.scope).toBe('banking:read');
  });

  test('redeemIdJag posts the jwt-bearer grant with the assertion', async () => {
    axios.post.mockResolvedValue({
      data: { access_token: 'mcp.access.token', token_type: 'Bearer', expires_in: 3600, scope: 'banking:read' },
    });
    const token = await idJagService.redeemIdJag('the.id.jag');

    expect(token.access_token).toBe('mcp.access.token');
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe(`${AS_ISSUER}/token`);
    const parsed = new URLSearchParams(body);
    expect(parsed.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(parsed.get('assertion')).toBe('the.id.jag');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  test('a policy DENY at the IdP surfaces its code and mints nothing', async () => {
    axios.post.mockRejectedValue({
      response: {
        status: 403,
        data: { error: 'access_denied', code: 'enterprise_mcp_policy_denied', error_description: 'Not authorized.' },
      },
    });
    const req = { session: { user: { oauthId: 'user-123' } }, headers: {} };
    await expect(
      idJagService.mintIdJag(req, { audience: AS_ISSUER, resource: RESOURCE, scope: 'banking:read' }),
    ).rejects.toMatchObject({ code: 'enterprise_mcp_policy_denied', httpStatus: 403 });
  });

  test('mintAndRedeem does NOT redeem when the mint was denied', async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 403, data: { error: 'access_denied', code: 'enterprise_mcp_policy_denied' } },
    });
    const req = { session: { user: { oauthId: 'user-123' } }, headers: {} };

    await expect(
      idJagService.mintAndRedeem(req, { resource: RESOURCE, scope: 'banking:read' }),
    ).rejects.toMatchObject({ code: 'enterprise_mcp_policy_denied' });

    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('mintAndRedeem returns both the assertion and the redeemed token', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { access_token: 'the.id.jag', expires_in: 120 } })
      .mockResolvedValueOnce({ data: { access_token: 'mcp.access.token', token_type: 'Bearer', scope: 'banking:read' } });

    const req = { session: { user: { oauthId: 'user-123' } }, headers: {} };
    const out = await idJagService.mintAndRedeem(req, { resource: RESOURCE, scope: 'banking:read' });

    expect(out.assertion).toBe('the.id.jag');
    expect(out.token.access_token).toBe('mcp.access.token');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
