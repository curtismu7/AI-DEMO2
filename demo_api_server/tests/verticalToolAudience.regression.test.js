/**
 * Regression: the MCP-server → BFF vertical-tool callback must accept the MCP
 * gateway audience (aud=mcpgateway.ping.demo), while every other route must
 * still reject it. Guards the bug where auth.js compared the router-RELATIVE
 * path (req.path === '/vertical-tool') against the full mount path
 * ('/api/path/vertical-tool'), making the gateway-audience branch dead code and
 * 401-ing every vertical tool call ("Error getting from agent").
 *
 * The real pipeline test (tests/real/workforce/view-benefits-via-mcp.test.js)
 * only catches this with all services up; this unit-level guard always runs.
 */
'use strict';

// Audience validation is only reachable with signature-skip OFF — set before
// requiring auth.js (env is read at module load).
process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'false';
process.env.ENDUSER_AUDIENCE = 'enduser.ping.demo';
process.env.PINGONE_RESOURCE_BFF_URI = 'enduser.ping.demo';
process.env.MCP_GW_RESOURCE_URI = 'mcpgateway.ping.demo';
process.env.PF_ISSUER_URI = 'https://pf.example/as';
process.env.PF_JWKS_URI = 'https://pf.example/as/JWKS';
process.env.PINGONE_ISSUER_URI = 'https://auth.pingone.com/env-test/as';

let mockPayload;
jest.mock('../services/tokenValidationService', () => ({
  validateToken: jest.fn(async () => mockPayload),
}));
jest.mock('../services/oauthEndpointResolver', () => ({
  getPingOneIssuer: jest.fn(() => 'https://auth.pingone.com/env-test/as'),
  getPingOneJwksUri: jest.fn(() => 'https://auth.pingone.com/env-test/as/jwks'),
}));
jest.mock('../config/oauth', () => ({
  get issuer() { return 'https://pf.example/as'; },
  get jwksEndpoint() { return 'https://pf.example/as/JWKS'; },
}));

const { authenticateToken } = require('../middleware/auth');
const { validateToken } = require('../services/tokenValidationService');

function createTestToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.test-signature`;
}

function invoke(path, aud, opts = {}) {
  mockPayload = {
    sub: 'demo',
    scope: 'read write admin',
    aud,
    iss: opts.iss || 'test',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const bearerToken = opts.token || createTestToken(mockPayload);
  return new Promise((resolve) => {
    const req = {
      method: opts.method || 'POST',
      path,
      baseUrl: opts.baseUrl || '',
      originalUrl: (opts.baseUrl || '') + path,
      url: path,
      headers: { authorization: `Bearer ${bearerToken}`, 'user-agent': 'axios/1.16.0' },
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
  jest.clearAllMocks();
});

const isAudience401 = (r) =>
  r.outcome === 'response' &&
  r.statusCode === 401 &&
  /does not match this service's audience/.test(JSON.stringify(r.body));

describe('vertical-tool callback audience acceptance', () => {
  test('validates PingOne-issued callback tokens with PingOne JWKS while PF is active', async () => {
    const pingOneIssuer = 'https://auth.pingone.com/env-test/as';
    const token = createTestToken({ iss: pingOneIssuer });
    const r = await invoke('/my', 'enduser.ping.demo', { method: 'GET', iss: pingOneIssuer, token });

    expect(r.outcome).toBe('next');
    expect(validateToken).toHaveBeenCalledWith(token, {
      jwksUri: 'https://auth.pingone.com/env-test/as/jwks',
      issuer: pingOneIssuer,
    });
  });

  test('keeps PF-issued tokens on PF JWKS while PF is active', async () => {
    const pfIssuer = 'https://pf.example/as';
    const token = createTestToken({ iss: pfIssuer });
    const r = await invoke('/my', 'enduser.ping.demo', { method: 'GET', iss: pfIssuer, token });

    expect(r.outcome).toBe('next');
    expect(validateToken).toHaveBeenCalledWith(token, {
      jwksUri: 'https://pf.example/as/JWKS',
      issuer: pfIssuer,
    });
  });

  test('accepts MCP gateway audience on /vertical-tool (router-relative path)', async () => {
    const r = await invoke('/vertical-tool', 'mcpgateway.ping.demo');
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next'); // passes auth with valid scopes
  });

  test('still rejects MCP gateway audience on a normal route', async () => {
    const r = await invoke('/api/accounts/my', 'mcpgateway.ping.demo');
    expect(isAudience401(r)).toBe(true);
  });

  test('accepts the normal enduser audience on /vertical-tool', async () => {
    const r = await invoke('/vertical-tool', 'enduser.ping.demo');
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });

  test('accepts MCP gateway audience on Path B /identity', async () => {
    const r = await invoke('/identity', 'mcpgateway.ping.demo');
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });

  test('accepts PingGateway audience on Path B /identity', async () => {
    const r = await invoke('/identity', 'https://api.ping.demo:3036/mcp');
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });

  test('still rejects PingGateway audience on a normal route', async () => {
    const r = await invoke('/api/accounts/my', 'https://api.ping.demo:3036/mcp');
    expect(isAudience401(r)).toBe(true);
  });
});

// MCP-server write callbacks: BankingAPIClient POSTs transactions (create_transfer/
// deposit/withdrawal) and account writes (fee waiver, contact email) with the
// gateway-audience token when Step 9 exchange is not configured. These exact
// mounted routes must accept the gateway audience; any other router root must not.
describe('MCP write-callback audience acceptance', () => {
  test('accepts MCP gateway audience on POST /api/transactions (router-relative /)', async () => {
    const r = await invoke('/', 'mcpgateway.ping.demo', { baseUrl: '/api/transactions' });
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });

  test('accepts MCP gateway audience on POST /api/accounts/:id/fee-waiver-request', async () => {
    const r = await invoke('/acct-1/fee-waiver-request', 'mcpgateway.ping.demo', { baseUrl: '/api/accounts' });
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });

  test('accepts MCP gateway audience on PATCH /api/accounts/:id/contact-email', async () => {
    const r = await invoke('/acct-1/contact-email', 'mcpgateway.ping.demo', { baseUrl: '/api/accounts', method: 'PATCH' });
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });

  test('still rejects MCP gateway audience on another router root POST', async () => {
    const r = await invoke('/', 'mcpgateway.ping.demo', { baseUrl: '/api/admin' });
    expect(isAudience401(r)).toBe(true);
  });

  test('still rejects MCP gateway audience on GET /api/transactions root', async () => {
    const r = await invoke('/', 'mcpgateway.ping.demo', { baseUrl: '/api/transactions', method: 'GET' });
    expect(isAudience401(r)).toBe(true);
  });

  test('still accepts enduser audience on POST /api/transactions', async () => {
    const r = await invoke('/', 'enduser.ping.demo', { baseUrl: '/api/transactions' });
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });
});
