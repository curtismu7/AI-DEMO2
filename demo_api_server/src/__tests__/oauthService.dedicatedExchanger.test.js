/**
 * @file oauthService.dedicatedExchanger.test.js
 * @description Integration test for performTokenExchangeWithDedicatedApp when
 * ff_private_key_jwt_token_exchange is ON and the dedicated private_key_jwt
 * exchanger app is provisioned.
 *
 * Asserts token exchange uses the dedicated app with client_assertion
 * (RFC 7521/7523) when enabled, and falls back to the standard methods otherwise.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

jest.mock('axios');
const axios = require('axios');

jest.mock('../../utils/oauthDebugFlags', () => ({ isOAuthVerboseDebug: () => false }));
jest.mock('../../utils/oauthVerboseLogger', () => ({ verboseOAuthLog: jest.fn() }));

const MOCK_CONFIG = {
  tokenEndpoint: 'https://auth.pingone.com/env-pkj/as/token',
  clientId: 'bff-admin-client',
  clientSecret: 'bff-admin-secret',
  redirectUri: 'https://api.ping.demo:4000/api/auth/oauth/callback',
  scopes: ['openid'],
  tokenEndpointAuthMethod: 'basic',
};
jest.mock('../../config/oauth', () => MOCK_CONFIG);

// Generate exchanger keys for the mock
const exchangerKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const EXCHANGER_PRIVATE_PEM = exchangerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const mockCfg = {
  ff_private_key_jwt_token_exchange: 'false',
  pingone_private_key_jwt_exchanger_client_id: 'test-exchanger-client',
  pingone_private_key_jwt_exchanger_private_key: EXCHANGER_PRIVATE_PEM,
  pingone_private_key_jwt_exchanger_kid: 'exchanger-test-kid',
};
jest.mock('../../services/configStore', () => ({ getEffective: (k) => mockCfg[k] }));

const svc = require('../../services/oauthService');

const USER_TOKEN = 'user-token-jwt';
const ACTOR_TOKEN = 'actor-token-jwt';
const MCP_RESOURCE = 'https://api.ping.demo:3036/mcp';
const SCOPES = ['mcp:invoke'];

describe('performTokenExchangeWithDedicatedApp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses dedicated app with private_key_jwt when enabled and provisioned', async () => {
    mockCfg.ff_private_key_jwt_token_exchange = 'true';
    axios.post.mockResolvedValue({ data: { access_token: 'mcp-access-token' } });

    const result = await svc.performTokenExchangeWithDedicatedApp(
      USER_TOKEN,
      MCP_RESOURCE,
      SCOPES
    );

    expect(result).toBe('mcp-access-token');
    expect(axios.post).toHaveBeenCalledTimes(1);

    const [url, bodyStr, opts] = axios.post.mock.calls[0];
    expect(url).toBe(MOCK_CONFIG.tokenEndpoint);
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    // Parse body to check for client_assertion instead of secret
    const body = new URLSearchParams(bodyStr);
    expect(body.get('client_id')).toBe('test-exchanger-client');
    expect(body.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
    );
    expect(body.get('client_assertion')).toBeTruthy();
    expect(body.get('client_secret')).toBeNull();
    expect(opts.headers.Authorization).toBeUndefined();

    // Verify the assertion is a valid JWT
    const assertion = body.get('client_assertion');
    expect(() => {
      jwt.decode(assertion, { complete: true });
    }).not.toThrow();
  });

  test('includes actor_token when provided', async () => {
    mockCfg.ff_private_key_jwt_token_exchange = 'true';
    axios.post.mockResolvedValue({ data: { access_token: 'mcp-token-with-act' } });

    await svc.performTokenExchangeWithDedicatedApp(USER_TOKEN, MCP_RESOURCE, SCOPES, ACTOR_TOKEN);

    const [, bodyStr] = axios.post.mock.calls[0];
    const body = new URLSearchParams(bodyStr);
    expect(body.get('actor_token')).toBe(ACTOR_TOKEN);
    expect(body.get('actor_token_type')).toBe(
      'urn:ietf:params:oauth:token-type:access_token'
    );
  });

  test('falls back to performTokenExchange when dedicated app not enabled', async () => {
    mockCfg.ff_private_key_jwt_token_exchange = 'false';
    axios.post.mockResolvedValue({ data: { access_token: 'fallback-token' } });

    const result = await svc.performTokenExchangeWithDedicatedApp(
      USER_TOKEN,
      MCP_RESOURCE,
      SCOPES
    );

    expect(result).toBe('fallback-token');
    // Should use admin client (Basic auth), not dedicated app
    const [, bodyStr, opts] = axios.post.mock.calls[0];
    const body = new URLSearchParams(bodyStr);
    expect(body.get('client_id')).toBe('bff-admin-client');
    expect(opts.headers.Authorization).toMatch(/^Basic /);
  });

  test('falls back to performTokenExchangeWithActor when enabled but no private key', async () => {
    mockCfg.ff_private_key_jwt_token_exchange = 'true';
    mockCfg.pingone_private_key_jwt_exchanger_private_key = '';
    axios.post.mockResolvedValue({ data: { access_token: 'fallback-with-actor' } });

    const result = await svc.performTokenExchangeWithDedicatedApp(
      USER_TOKEN,
      MCP_RESOURCE,
      SCOPES,
      ACTOR_TOKEN
    );

    expect(result).toBe('fallback-with-actor');
    const [, bodyStr, opts] = axios.post.mock.calls[0];
    const body = new URLSearchParams(bodyStr);
    expect(body.get('client_id')).toBe('bff-admin-client');
    expect(body.get('actor_token')).toBe(ACTOR_TOKEN);
  });

  test('throws with rich error details on exchange failure', async () => {
    mockCfg.ff_private_key_jwt_token_exchange = 'true';
    mockCfg.pingone_private_key_jwt_exchanger_private_key = EXCHANGER_PRIVATE_PEM;
    const pingoneError = {
      error: 'invalid_grant',
      error_description: 'Actor token invalid or expired',
      error_detail: 'may_act claim missing'
    };
    axios.post.mockRejectedValue({
      response: { status: 400, data: pingoneError },
      message: 'Request failed'
    });

    await expect(
      svc.performTokenExchangeWithDedicatedApp(USER_TOKEN, MCP_RESOURCE, SCOPES, ACTOR_TOKEN)
    ).rejects.toThrow(/Token exchange failed with dedicated app/);

    // Verify error has rich context
    try {
      await svc.performTokenExchangeWithDedicatedApp(USER_TOKEN, MCP_RESOURCE, SCOPES, ACTOR_TOKEN);
    } catch (err) {
      expect(err.httpStatus).toBe(400);
      expect(err.pingoneError).toBe('invalid_grant');
      expect(err.pingoneErrorDescription).toBe('Actor token invalid or expired');
      expect(err.requestContext.client_id).toBe('test-exchanger-client');
      expect(err.requestContext.audience).toBe(MCP_RESOURCE);
    }
  });
});
