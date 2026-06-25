'use strict';

/**
 * Integration tests for UC18 rate-limiting in buildAuthorizeMcpRequest.
 * Verifies the rate-limit injection point: after devBypass guard, before
 * introspection. Uses the injectable deps pattern to stub out auth.
 */

import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import { _resetLimiterForTest } from '../src/rateLimit';
import type { GatewayConfig } from '../src/config';

// Minimal config that passes all non-rate-limit guards
const makeConfig = (overrides: Partial<GatewayConfig> = {}): GatewayConfig => ({
  devBypass: false,
  gatewayResourceUri: 'mcpgateway.ping.demo',
  pingoneBaseUrl: '',
  pingoneEnvironmentId: '',
  introspectionEndpoint: '',
  authorizeApplicationId: '',
  authorizeEnvironmentId: '',
  rateLimitEnabled: false,
  rateLimitMaxRequests: 3,
  rateLimitWindowMs: 10000,
  // Remaining fields required by GatewayConfig type
  port: 3005,
  host: '0.0.0.0',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  tokenEndpointAuthMethod: 'basic',
  tokenEndpoint: '',
  mcpOlbWsUrl: '',
  mcpInvestWsUrl: '',
  mcpOlbResourceUri: '',
  mcpInvestResourceUri: '',
  pingAuthorizeEndpoint: '',
  pingAuthorizeWorkerId: '',
  pingAuthorizeMockBase: undefined,
  p1azEnabled: false,
  hitlServiceUrl: '',
  introspectionClientId: '',
  introspectionClientSecret: '',
  mcpServerPassthrough: false,
  demoApiKeyServiceKey: '',
  mortgageServiceBaseUrl: '',
  mortgageServiceApiKey: '',
  bffInternalIdTokenUrl: '',
  bffInternalSecret: 'dev-test-secret-32-bytes-padding!!',
  bankingResourceServerBaseUrl: '',
  bankingResourceServerResourceUri: '',
  mtlsEnabled: false,
  mtlsCertPath: '',
  authorizedActorClientId: '',
  ...overrides,
} as unknown as GatewayConfig);

// Injectable deps: introspection always active, authorize always PERMIT
const PERMIT_DEPS = {
  introspect: async () => ({ active: true, sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 }),
  authorize: async () => ({ decision: 'PERMIT' as const }),
};

// A minimal decoded JWT token (base64url payload with sub=user-123)
// Used as bearer token. No signature needed — middleware only reads .sub from it
// for the rate-limit key (pre-decode before Step 0 validation).
const BEARER = [
  'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0',
  Buffer.from(JSON.stringify({ sub: 'user-123', aud: 'mcpgateway.ping.demo', exp: 9999999999 })).toString('base64url'),
  '',
].join('.');

const TOOL_CALL_BODY = Buffer.from(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'get_balance', arguments: {} },
}));

const TOOLS_LIST_BODY = Buffer.from(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
}));

function makeFakeRes() {
  const res = {
    statusCode: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    writeHead: jest.fn(function(this: any, code: number) { this.statusCode = code; }),
    end: jest.fn(function(this: any, body?: string) { this._body = body ?? ''; }),
    setHeader: jest.fn(),
  };
  return res;
}

async function callMiddleware(config: GatewayConfig, body: Buffer, bearerToken = BEARER) {
  const middleware = buildAuthorizeMcpRequest(config, PERMIT_DEPS);
  const fakeRes = makeFakeRes();
  const forwarded: string[] = [];
  await middleware(
    bearerToken,
    body,
    {} as any,
    fakeRes as any,
    async (token) => { forwarded.push(token); },
  );
  return { fakeRes, forwarded };
}

afterEach(() => {
  _resetLimiterForTest();
  delete process.env.GATEWAY_RATE_LIMIT_ENABLED;
  delete process.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS;
  delete process.env.GATEWAY_RATE_LIMIT_WINDOW_MS;
});

describe('UC18 rate-limiting in buildAuthorizeMcpRequest', () => {
  it('rate-limit OFF: no 429 regardless of call count', async () => {
    const config = makeConfig({ rateLimitEnabled: false, rateLimitMaxRequests: 2, rateLimitWindowMs: 10000 });
    for (let i = 0; i < 10; i++) {
      const { fakeRes } = await callMiddleware(config, TOOL_CALL_BODY);
      expect(fakeRes.statusCode).not.toBe(429);
    }
  });

  it('rate-limit ON: calls under maxRequests pass through', async () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 3, rateLimitWindowMs: 10000 });
    for (let i = 0; i < 3; i++) {
      const { fakeRes, forwarded } = await callMiddleware(config, TOOL_CALL_BODY);
      expect(fakeRes.statusCode).not.toBe(429);
    }
  });

  it('rate-limit ON: maxRequests+1 returns 429 with code=rate_limited', async () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 3, rateLimitWindowMs: 10000 });
    // Exhaust the window
    for (let i = 0; i < 3; i++) {
      await callMiddleware(config, TOOL_CALL_BODY);
    }
    // 4th call should be rate-limited
    const { fakeRes } = await callMiddleware(config, TOOL_CALL_BODY);
    expect(fakeRes.statusCode).toBe(429);
    const body = JSON.parse(fakeRes._body);
    expect(body.code).toBe('rate_limited');
    expect(body.error).toBe('rate_limited');
    expect(body.retryAfterMs).toBeGreaterThan(0);
  });

  it('tools/list calls are NOT rate-limited even when burst is exhausted', async () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 1, rateLimitWindowMs: 10000 });
    // Exhaust the window with a tools/call
    await callMiddleware(config, TOOL_CALL_BODY);
    // tools/list should still pass through (not metered)
    const { fakeRes } = await callMiddleware(config, TOOLS_LIST_BODY);
    expect(fakeRes.statusCode).not.toBe(429);
  });

  it('rate-limit does not fire during devBypass mode', async () => {
    const config = makeConfig({ devBypass: true, rateLimitEnabled: true, rateLimitMaxRequests: 0, rateLimitWindowMs: 10000 });
    // Even with maxRequests=0, devBypass skips everything including rate-limit
    const { fakeRes, forwarded } = await callMiddleware(config, TOOL_CALL_BODY);
    // devBypass forwards directly, never hits rate-limit path
    expect(fakeRes.statusCode).not.toBe(429);
    expect(forwarded.length).toBe(1);
  });

  it('different agent sub+tool combos have independent rate-limit buckets', async () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 1, rateLimitWindowMs: 10000 });

    // Bearer with sub=user-123
    const bearer123 = [
      'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0',
      Buffer.from(JSON.stringify({ sub: 'user-123', aud: 'mcpgateway.ping.demo', exp: 9999999999 })).toString('base64url'),
      '',
    ].join('.');

    // Bearer with sub=user-456
    const bearer456 = [
      'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0',
      Buffer.from(JSON.stringify({ sub: 'user-456', aud: 'mcpgateway.ping.demo', exp: 9999999999 })).toString('base64url'),
      '',
    ].join('.');

    // Exhaust user-123's bucket
    await callMiddleware(config, TOOL_CALL_BODY, bearer123);
    const { fakeRes: res123 } = await callMiddleware(config, TOOL_CALL_BODY, bearer123);
    expect(res123.statusCode).toBe(429);

    // user-456 still has a fresh bucket
    const { fakeRes: res456 } = await callMiddleware(config, TOOL_CALL_BODY, bearer456);
    expect(res456.statusCode).not.toBe(429);
  });
});
