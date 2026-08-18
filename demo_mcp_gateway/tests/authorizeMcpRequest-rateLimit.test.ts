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

// Decode the `sub` claim from a JWT's (unverified) payload. Used by the mocks
// below to model introspection binding the verified subject to the presented
// token — the same subject the (relocated) rate limiter now keys on.
function subOf(token: string): string {
  try {
    const payload = token.split('.')[1];
    if (payload) {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      if (claims?.sub) return String(claims.sub);
    }
  } catch { /* fall through */ }
  return 'user-123';
}

// Injectable deps: introspection active (echoing the token's subject, as real
// introspection does), authorize always PERMIT. The rate limiter runs AFTER
// introspection and keys on this verified subject.
const PERMIT_DEPS = {
  introspect: async (t: string) => ({ active: true, sub: subOf(t), exp: Math.floor(Date.now() / 1000) + 3600 }),
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
// SECURITY REGRESSION: unauthenticated rate-limit DoS against a chosen victim.
//
// The limiter used to key its bucket on a `sub` decoded straight from the
// UNVERIFIED bearer, and ran BEFORE token validation. An attacker could send
// garbage-signed JWTs carrying sub=<victim>; each call consumed a slot in the
// VICTIM's bucket before the signature/introspection check rejected the request.
// After GATEWAY_RATE_LIMIT_MAX_REQUESTS forged calls the real victim was denied
// with 429 on that tool — an unauthenticated DoS against a chosen user.
//
// The fix moves the check AFTER introspection and keys it on the verified
// subject, so a forged token is rejected (401) before it can touch any bucket.
// This test proves N forged requests do NOT consume or deny the victim's bucket.
// ---------------------------------------------------------------------------
describe('UC18 rate-limiting — forged token cannot exhaust a victim bucket', () => {
  const VICTIM_SUB = 'victim-user';

  // Genuine victim token — introspection confirms it active.
  const genuineVictimToken = [
    'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
    Buffer.from(JSON.stringify({ sub: VICTIM_SUB, aud: 'mcpgateway.ping.demo', exp: 9999999999 })).toString('base64url'),
    'genuine-signature',
  ].join('.');

  // Forged token — same claimed sub=<victim>, but a bad/garbage signature.
  // Real introspection reports it inactive (modelled by the deps below).
  const forgedVictimToken = [
    'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0',
    Buffer.from(JSON.stringify({ sub: VICTIM_SUB, aud: 'mcpgateway.ping.demo', exp: 9999999999, forged: true })).toString('base64url'),
    'GARBAGE_SIGNATURE',
  ].join('.');

  // Introspection accepts the genuine token and rejects the forged one — the
  // real gateway behaviour a bad signature produces. authorize always PERMITs.
  const INTROSPECT_VERIFIES_SIGNATURE = {
    introspect: async (t: string) => {
      if (subOf(t) === VICTIM_SUB && /GARBAGE_SIGNATURE$/.test(t)) {
        return { active: false, exp: 0 };
      }
      return { active: true, sub: subOf(t), exp: Math.floor(Date.now() / 1000) + 3600 };
    },
    authorize: async () => ({ decision: 'PERMIT' as const }),
  };

  async function call(config: GatewayConfig, bearerToken: string) {
    const middleware = buildAuthorizeMcpRequest(config, INTROSPECT_VERIFIES_SIGNATURE);
    const fakeRes = makeFakeRes();
    // The 401 (inactive-token) path builds a WWW-Authenticate header via
    // selfBaseUrl(req, ...), which reads req.headers/req.socket — supply both.
    const fakeReq = { headers: {}, socket: {} };
    await middleware(bearerToken, TOOL_CALL_BODY, fakeReq as any, fakeRes as any, async () => { /* forwarded */ });
    return fakeRes;
  }

  afterEach(() => {
    _resetLimiterForTest();
    delete process.env.GATEWAY_RATE_LIMIT_ENABLED;
    delete process.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.GATEWAY_RATE_LIMIT_WINDOW_MS;
  });

  it('N forged sub=<victim> requests do NOT consume or deny the victim real bucket', async () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 3, rateLimitWindowMs: 10000 });

    // Attacker floods far past the limit with garbage-signed tokens for the victim.
    for (let i = 0; i < 10; i++) {
      const res = await call(config, forgedVictimToken);
      // Rejected as an invalid token (401) — never rate-limited (429), because
      // the forged token is stopped by introspection before the limiter runs.
      expect(res.statusCode).toBe(401);
      expect(res.statusCode).not.toBe(429);
    }

    // The genuine victim now spends its full, untouched allowance: all 3 pass.
    for (let i = 0; i < 3; i++) {
      const res = await call(config, genuineVictimToken);
      expect(res.statusCode).not.toBe(429);
    }

    // Only the victim's OWN 4th genuine call is throttled — the limiter still
    // works for authenticated callers; the forged flood contributed nothing.
    const throttled = await call(config, genuineVictimToken);
    expect(throttled.statusCode).toBe(429);
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
