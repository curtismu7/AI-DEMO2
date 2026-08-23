/**
 * Regression: a native-ID-JAG-redeemed agentToken is signed by oauth-mcp's own
 * embedded AS, never by PingOne. Before this fix, authenticateToken always
 * verified against PingOne's JWKS, so an ID-JAG-redeemed token calling back into
 * the BFF's own Banking API (BankingAPIClient.getAccountBalance et al, via
 * oauth-mcp) always 401'd "invalid_token" — signature verification against the
 * wrong JWKS fails regardless of the token's audience.
 *
 * authenticateToken must now route a token whose iss names oauth-mcp's own
 * embedded AS to oauth-mcp's OWN JWKS (allowHttp — that JWKS is internal-Docker-
 * network-only, served over plain HTTP), and every other token to PingOne's
 * JWKS exactly as before.
 */
'use strict';

process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'false';
process.env.ENDUSER_AUDIENCE = 'enduser.ping.demo';
process.env.PINGONE_RESOURCE_MCP_SERVER_URI = 'mcpserver.ping.demo';
process.env.OAUTH_MCP_ID_JAG_ISSUER = 'https://localhost:8080';
process.env.OAUTH_MCP_ID_JAG_JWKS_URL = 'http://mcp-server:8080/jwks';

let mockPayload;
const mockValidateToken = jest.fn(async () => mockPayload);
jest.mock('../services/tokenValidationService', () => ({
  validateToken: (...args) => mockValidateToken(...args),
}));

const { authenticateToken } = require('../middleware/auth');

// Real, unsigned-but-well-formed JWT so authenticateToken's unverified iss
// decode (getJwtClaim) reads a genuine iss claim from the token string itself.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (payload) => `${b64u({ alg: 'RS256' })}.${b64u(payload)}.sig`;

function invoke(token, { aud = 'mcpserver.ping.demo', iss } = {}) {
  mockPayload = {
    sub: 'demo',
    scope: 'read',
    aud,
    iss: iss || 'test',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return new Promise((resolve) => {
    const req = {
      method: 'GET',
      path: '/acct-1/balance',
      baseUrl: '/api/accounts',
      originalUrl: '/api/accounts/acct-1/balance',
      url: '/acct-1/balance',
      headers: { authorization: `Bearer ${token}`, 'user-agent': 'jest' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      connection: { remoteAddress: '127.0.0.1' },
      session: {},
      body: {},
    };
    let statusCode = null;
    const res = {
      set() { return this; },
      status(c) { statusCode = c; return this; },
      json(o) {
        resolve({ outcome: 'response', statusCode, body: o });
        return this;
      },
    };
    Promise.resolve(
      authenticateToken(req, res, () => resolve({ outcome: 'next', statusCode: null, body: null })),
    ).catch((e) => resolve({ outcome: 'throw', err: e.message }));
  });
}

beforeEach(() => {
  mockValidateToken.mockClear();
});

describe('ID-JAG issuer routes to oauth-mcp\'s own JWKS', () => {
  test('a token whose iss is oauth-mcp\'s embedded AS verifies against oauth-mcp\'s JWKS', async () => {
    const token = fakeJwt({ iss: 'https://localhost:8080', sub: 'user-1' });
    const r = await invoke(token, { iss: 'https://localhost:8080' });

    expect(mockValidateToken).toHaveBeenCalledTimes(1);
    const [, opts] = mockValidateToken.mock.calls[0];
    expect(opts.jwksUri).toBe('http://mcp-server:8080/jwks');
    expect(opts.issuer).toBe('https://localhost:8080');
    expect(opts.allowHttp).toBe(true);
    expect(r.outcome).toBe('next');
  });

  test('a PingOne-issued token still verifies against PingOne\'s JWKS unchanged', async () => {
    const token = fakeJwt({ iss: 'https://auth.pingone.com/env-123/as', sub: 'user-1' });
    const r = await invoke(token, { iss: 'https://auth.pingone.com/env-123/as' });

    expect(mockValidateToken).toHaveBeenCalledTimes(1);
    const [, opts] = mockValidateToken.mock.calls[0];
    expect(opts.jwksUri).not.toBe('http://mcp-server:8080/jwks');
    expect(opts.allowHttp).toBeUndefined();
    expect(r.outcome).toBe('next');
  });

  test('a malformed token falls through to the PingOne path without throwing', async () => {
    const r = await invoke('not-a-jwt', { iss: 'test' });

    expect(mockValidateToken).toHaveBeenCalledTimes(1);
    const [, opts] = mockValidateToken.mock.calls[0];
    expect(opts.allowHttp).toBeUndefined();
    expect(r.outcome).toBe('next');
  });
});
