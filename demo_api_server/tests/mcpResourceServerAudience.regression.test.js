/**
 * Regression: MCP invest audiences must be accepted ONLY on the A2A investment
 * portfolio callback. #819 pushed the invest audience into the shared gwAuds list
 * used by every isMcpCallback route, so an invest:read token also passed audience
 * checks on POST /api/transactions — and the write-scope gate there skips when
 * scopes are neither read nor write, allowing transfers.
 *
 * After #1269 the PingOne resource carries mcp-invest.ping.demo (not the stale
 * mcp-resource-server.ping.demo name). Exchange #3 (#1273) now lands that aud;
 * the portfolio gate must accept it (and may still accept the legacy name).
 */
'use strict';

process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'false';
process.env.ENDUSER_AUDIENCE = 'enduser.ping.demo';
process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI = 'mcpgateway.ping.demo';
process.env.PINGONE_RESOURCE_MCP_RESOURCE_SERVER_URI =
  'mcp-invest.ping.demo,mcp-resource-server.ping.demo';

let mockPayload;
jest.mock('../services/tokenValidationService', () => ({
  validateToken: jest.fn(async () => mockPayload),
}));

const { authenticateToken } = require('../middleware/auth');

function invoke(path, aud, opts = {}) {
  mockPayload = {
    sub: 'demo',
    scope: opts.scope || 'invest:read',
    aud,
    iss: 'test',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return new Promise((resolve) => {
    const req = {
      method: opts.method || 'GET',
      path,
      baseUrl: opts.baseUrl || '',
      originalUrl: (opts.baseUrl || '') + path,
      url: path,
      headers: { authorization: 'Bearer x.y.z', 'user-agent': 'jest' },
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

const isAudience401 = (r) =>
  r.outcome === 'response' &&
  r.statusCode === 401 &&
  /does not match this service's audience/.test(JSON.stringify(r.body));

describe('MCP invest audiences must stay portfolio-scoped', () => {
  test('accepts mcp-invest audience on GET /api/investment/.../portfolio', async () => {
    const r = await invoke('/accounts/acct-1/portfolio', 'mcp-invest.ping.demo', {
      baseUrl: '/api/investment',
      method: 'GET',
    });
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });

  test('accepts legacy mcp-resource-server audience on portfolio (ADD, not swap)', async () => {
    const r = await invoke('/accounts/acct-1/portfolio', 'mcp-resource-server.ping.demo', {
      baseUrl: '/api/investment',
      method: 'GET',
    });
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });

  test('rejects mcp-invest audience on POST /api/transactions (write callback)', async () => {
    const r = await invoke('/', 'mcp-invest.ping.demo', {
      baseUrl: '/api/transactions',
      method: 'POST',
      scope: 'invest:read',
    });
    expect(isAudience401(r)).toBe(true);
  });

  test('rejects mcp-invest audience on GET /api/accounts/my', async () => {
    const r = await invoke('/my', 'mcp-invest.ping.demo', {
      baseUrl: '/api/accounts',
      method: 'GET',
    });
    expect(isAudience401(r)).toBe(true);
  });

  test('still accepts MCP gateway audience on POST /api/transactions', async () => {
    const r = await invoke('/', 'mcpgateway.ping.demo', {
      baseUrl: '/api/transactions',
      method: 'POST',
      scope: 'read write',
    });
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });

  test('still accepts enduser audience on investment portfolio', async () => {
    const r = await invoke('/accounts/acct-1/portfolio', 'enduser.ping.demo', {
      baseUrl: '/api/investment',
      method: 'GET',
      scope: 'read',
    });
    expect(isAudience401(r)).toBe(false);
    expect(r.outcome).toBe('next');
  });
});
