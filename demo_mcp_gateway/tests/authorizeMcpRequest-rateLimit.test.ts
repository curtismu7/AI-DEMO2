'use strict';

/**
 * Integration tests for UC18 rate-limiting in buildAuthorizeMcpRequest.
 * Verifies the rate-limit injection point: after devBypass guard, before
 * introspection. Uses the injectable deps pattern to stub out auth.
 */

import { buildAuthorizeMcpRequest, getRateLimiter, resetRateLimiterForTest } from '../src/middleware/authorizeMcpRequest';
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
  mcpResourceServerWsUrl: '',
  mcpOlbResourceUri: '',
  mcpResourceServerResourceUri: '',
  pingAuthorizeEndpoint: '',
  pingAuthorizeWorkerId: '',
  pingAuthorizeMockBase: undefined,
  p1azEnabled: false,
  hitlServiceUrl: '',
  introspectionClientId: '',
  introspectionClientSecret: '',
  mcpServerPassthrough: false,
  demoApiKeyServiceKey: '',
  apiResourceServerBaseUrl: '',
  apiResourceServerApiKey: '',
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

  it('rate-limit ON: a 429 sets X-Gw-Audit-Trail so it is visible in the shared audit panel', async () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 1, rateLimitWindowMs: 10000 });
    await callMiddleware(config, TOOL_CALL_BODY); // consume the one allowed slot
    const { fakeRes } = await callMiddleware(config, TOOL_CALL_BODY); // this one is rate-limited
    expect(fakeRes.statusCode).toBe(429);
    expect(fakeRes.setHeader).toHaveBeenCalledWith('X-Gw-Audit-Trail', expect.any(String));
    const auditTrailArg = fakeRes.setHeader.mock.calls.find((c: any[]) => c[0] === 'X-Gw-Audit-Trail')[1];
    const auditTrail = JSON.parse(auditTrailArg);
    expect(auditTrail.rateLimit).toEqual({ limited: true, retryAfterMs: expect.any(Number) });
  });
});

// ---------------------------------------------------------------------------
// UC18 gap fix: the WS transport (index.ts) previously had no rate-limit check
// at all. The fix makes it call getRateLimiter(config).check(sub:toolName) —
// the SAME exported singleton-returning function the HTTP path above uses —
// rather than a second, independent limiter. These tests exercise that shared
// function directly (index.ts itself has top-level side effects — it loads
// config and binds a real listener on import — so it cannot be imported here;
// getRateLimiter is the piece both transports share, and is what this fix adds).
describe('UC18 rate-limiting — getRateLimiter is shared across HTTP and WS transports', () => {
  afterEach(() => {
    resetRateLimiterForTest();
    delete process.env.GATEWAY_RATE_LIMIT_ENABLED;
    delete process.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.GATEWAY_RATE_LIMIT_WINDOW_MS;
  });

  it('getRateLimiter(config) returns the same singleton instance on repeated calls', () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 3, rateLimitWindowMs: 10000 });
    expect(getRateLimiter(config)).toBe(getRateLimiter(config));
  });

  it('a burst consumed via the HTTP middleware exhausts the bucket a WS-style getRateLimiter().check() call would also see', async () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 2, rateLimitWindowMs: 10000 });

    // Two HTTP tools/call requests for sub=user-123, tool=get_balance — consumes the bucket.
    await callMiddleware(config, TOOL_CALL_BODY);
    await callMiddleware(config, TOOL_CALL_BODY);

    // The WS handler in index.ts computes the identical key convention
    // (`${sub}:${toolName}`) and calls getRateLimiter(config).check(key) before
    // dispatching. Simulate that call directly: it must be blocked, proving
    // WS and HTTP share one bucket rather than each transport getting its own
    // independent (and thus bypassable) allowance.
    const wsStyleResult = getRateLimiter(config).check('user-123:get_balance');
    expect(wsStyleResult.allowed).toBe(false);
    expect(wsStyleResult.retryAfterMs).toBeGreaterThan(0);
  });

  it('a WS-style burst against getRateLimiter directly is then also blocked on the HTTP path for the same sub+tool', async () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 2, rateLimitWindowMs: 10000 });

    // Simulate two WS tools/call bursts (what index.ts's new check does).
    getRateLimiter(config).check('user-123:get_balance');
    getRateLimiter(config).check('user-123:get_balance');

    // HTTP middleware call for the same sub+tool must now see the bucket exhausted.
    const { fakeRes } = await callMiddleware(config, TOOL_CALL_BODY);
    expect(fakeRes.statusCode).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// BUG #71: runtime rate-limit reconfig (POST /admin/config mutates config.rateLimit*)
// was a silent no-op — getRateLimiter froze windowMs/maxRequests at first build and
// kept serving them until process restart. getRateLimiter now rebuilds when either
// value changes, while still returning the shared singleton when they are unchanged.
// ---------------------------------------------------------------------------
describe('BUG #71 — getRateLimiter honours a runtime max/window reconfig', () => {
  afterEach(() => {
    resetRateLimiterForTest();
  });

  it('same config object identity across calls returns the SAME singleton (unchanged case preserved)', () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 5, rateLimitWindowMs: 10000 });
    const a = getRateLimiter(config);
    const b = getRateLimiter(config);
    expect(a).toBe(b);
  });

  it('raising rateLimitMaxRequests at runtime raises the enforced threshold', () => {
    // Simulate the admin path mutating the live config object in place.
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 2, rateLimitWindowMs: 10000 });

    // Exhaust the original limit of 2.
    expect(getRateLimiter(config).check('user-x:transfer').allowed).toBe(true);
    expect(getRateLimiter(config).check('user-x:transfer').allowed).toBe(true);
    expect(getRateLimiter(config).check('user-x:transfer').allowed).toBe(false);

    // adminConfig.ts mutates config.rateLimitMaxRequests → the NEXT getRateLimiter
    // must rebuild against the new threshold instead of the frozen one.
    (config as { rateLimitMaxRequests: number }).rateLimitMaxRequests = 10;
    const limiter = getRateLimiter(config);
    // Fresh limiter (rebuilt), so the raised ceiling is now in force.
    for (let i = 0; i < 10; i++) {
      expect(limiter.check('user-x:transfer').allowed).toBe(true);
    }
    expect(limiter.check('user-x:transfer').allowed).toBe(false);
  });

  it('lowering rateLimitMaxRequests at runtime lowers the enforced threshold', () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 10, rateLimitWindowMs: 10000 });
    getRateLimiter(config); // build at 10

    (config as { rateLimitMaxRequests: number }).rateLimitMaxRequests = 1;
    const limiter = getRateLimiter(config);
    expect(limiter.check('user-y:transfer').allowed).toBe(true);
    expect(limiter.check('user-y:transfer').allowed).toBe(false);
  });

  it('changing rateLimitWindowMs rebuilds the limiter (new instance)', () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 3, rateLimitWindowMs: 10000 });
    const before = getRateLimiter(config);
    (config as { rateLimitWindowMs: number }).rateLimitWindowMs = 30000;
    const after = getRateLimiter(config);
    expect(after).not.toBe(before);
  });
});
