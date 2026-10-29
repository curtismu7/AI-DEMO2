'use strict';

const {
  isHostedAccessBypassPath,
  createHostedAccessGate,
  hostedAccessCheck,
  isBootstrapApplicationSession,
  sendAccessRestricted,
} = require('../../middleware/hostedAccessGate');

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    type(value) { this.headers['content-type'] = value; return this; },
    send(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

describe('hostedAccessGate CIMD client documents', () => {
  const doc = '/api/cimd/privilege/langchain-agent/client-metadata.json';

  test('exact GET document paths bypass the gate', () => {
    expect(isHostedAccessBypassPath(doc, 'GET')).toBe(true);
    expect(isHostedAccessBypassPath(`${doc}?x=1`, 'GET')).toBe(true);
    expect(isHostedAccessBypassPath('/api/cimd/privilege/privilege-mcp-client/client-metadata.json', 'GET')).toBe(true);
    expect(isHostedAccessBypassPath('/api/pf-ai-agent/cimd/client-metadata.json', 'GET')).toBe(true);
    expect(isHostedAccessBypassPath('/api/pf-ai-agent/cimd/callback', 'GET')).toBe(false);
  });

  test('the readiness check is not public: it fetches, so it stays behind sign-in', () => {
    expect(isHostedAccessBypassPath('/api/cimd/privilege/check', 'GET')).toBe(false);
  });

  test('the identifier-policy endpoint is public GET (sign-in modal reads it)', () => {
    expect(isHostedAccessBypassPath('/api/auth/hosted-access/identifier-policy', 'GET')).toBe(true);
    expect(isHostedAccessBypassPath('/api/auth/hosted-access/identifier-policy', 'POST')).toBe(false);
  });

  test('other methods, other slugs and the mock-AS routes stay gated', () => {
    expect(isHostedAccessBypassPath(doc, 'POST')).toBe(false);
    expect(isHostedAccessBypassPath('/api/cimd/privilege/unlisted/client-metadata.json', 'GET')).toBe(false);
    expect(isHostedAccessBypassPath('/api/cimd/agents', 'GET')).toBe(false);
    expect(isHostedAccessBypassPath('/api/cimd/agents/super-banking-agent/client-metadata.json', 'GET')).toBe(false);
  });
});

describe('hostedAccessGate static brand assets', () => {
  test.each([
    ['/branding/ping-logo.png', 'GET'],
    ['/favicon-16.png', 'GET'],
    ['/favicon-32.png', 'GET'],
    ['/apple-touch-icon.png', 'GET'],
  ])('allows the signed-out boot asset %s', (path, method) => {
    expect(isHostedAccessBypassPath(path, method)).toBe(true);
  });

  test('other branding files and subpaths stay gated', () => {
    expect(isHostedAccessBypassPath('/branding/funnybank-logo.svg', 'GET')).toBe(false);
    expect(isHostedAccessBypassPath('/branding/ping-logo.png/extra', 'GET')).toBe(false);
    expect(isHostedAccessBypassPath('/branding/ping-logo.png', 'POST')).toBe(false);
    expect(isHostedAccessBypassPath('/favicon-32.png.evil', 'GET')).toBe(false);
  });
});

describe('hostedAccessGate', () => {
  test.each([
    ['/api/auth/hosted-access/login', 'GET'],
    ['/api/auth/hosted-access/callback', 'GET'],
    ['/api/auth/hosted-access/logout', 'GET'],
    ['/api/auth/hosted-registration/request', 'POST'],
    ['/api/auth/hosted-registration/verify', 'POST'],
    ['/api/auth/hosted-registration/resend', 'POST'],
    ['/api/auth/hosted-registration/status', 'GET'],
    ['/api/healthz', 'GET'],
  ])('allows exact bypass %s %s', (path, method) => {
    expect(isHostedAccessBypassPath(path, method)).toBe(true);
  });

  test.each([
    ['/api/auth/hosted-access/callback/extra', 'GET'],
    ['/api/auth/hosted-access/login', 'POST'],
    ['/api/auth/hosted-access/callback.evil', 'GET'],
    // GET /api/auth/oauth/user/login used to be listed here. The app sign-in is now deliberately reachable before the wall
    // (see 'the app sign-in unlocks the wall' below); the rest of the app auth routes stay gated.
    ['/api/auth/oauth/user/consent', 'POST'],
    ['/api/auth/hosted-registration/request/extra', 'POST'],
    ['/api/use-cases', 'GET'],
  ])('rejects bypass confusion %s %s', (path, method) => {
    expect(isHostedAccessBypassPath(path, method)).toBe(false);
  });

  test('is a no-op when disabled', () => {
    const next = jest.fn();
    createHostedAccessGate({ policy: { enabled: false } })({ originalUrl: '/api/use-cases' }, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('permits a current approved session', () => {
    const next = jest.fn();
    createHostedAccessGate({
      policy: { enabled: true },
      hasApproval: () => true,
    })({ originalUrl: '/api/use-cases', method: 'GET', session: {}, hostedSession: {} }, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each(['demouser', 'demoadmin', 'DemoUser', 'DEMOADMIN'])('recognizes the protected demo bootstrap account %s', (username) => {
    expect(isBootstrapApplicationSession({
      user: { username },
      oauthType: 'user',
      oauthTokens: { accessToken: 'real-oauth-token', expiresAt: Date.now() + 60_000 },
    })).toBe(true);
  });

  test.each(['demo', 'demouser2', 'demoadmin@example.com', undefined])('does not recognize a different account %s', (username) => {
    expect(isBootstrapApplicationSession({
      user: { username },
      oauthType: 'user',
      oauthTokens: { accessToken: 'real-oauth-token', expiresAt: Date.now() + 60_000 },
    })).toBe(false);
  });

  test.each([
    [{ user: { username: 'demouser' } }, 'missing OAuth credentials'],
    [{ user: { username: 'demouser' }, oauthType: 'user', oauthTokens: { accessToken: '_cookie_session' } }, 'stub OAuth credential'],
    [{ user: { username: 'demouser' }, oauthType: 'user', oauthTokens: { accessToken: 'real-token', expiresAt: Date.now() - 1 } }, 'expired OAuth credential'],
  ])('does not permit a bootstrap name with %s', (session) => {
    expect(isBootstrapApplicationSession(session)).toBe(false);
  });

  test('permits an authenticated demouser without hosted approval', () => {
    const next = jest.fn();
    createHostedAccessGate({
      policy: { enabled: true },
      hasApproval: () => false,
    })({
      originalUrl: '/api/use-cases',
      method: 'GET',
      session: { user: { username: 'demouser' }, oauthType: 'user', oauthTokens: { accessToken: 'real-token' } },
      hostedSession: {},
    }, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('returns 401 for an anonymous direct BFF request', () => {
    const res = response();
    createHostedAccessGate({
      policy: { enabled: true },
      hasApproval: () => false,
    })({ originalUrl: '/api/use-cases', method: 'GET', session: {}, hostedSession: {} }, res, jest.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'hosted_access_required' });
  });

  test('redirects a browser navigation to hosted login; fetch still gets 401 JSON', () => {
    const policy = { enabled: true };
    const gate = createHostedAccessGate({ policy, hasApproval: () => false });
    const nav = { ...response(), redirect(url) { this.redirected = url; } };
    gate({
      originalUrl: '/api/use-cases?x=1', method: 'GET',
      headers: { accept: 'text/html,application/xhtml+xml' }, session: {}, hostedSession: {},
    }, nav, jest.fn());
    expect(nav.redirected).toBe('/api/auth/hosted-access/login?return_to=%2Fapi%2Fuse-cases%3Fx%3D1');

    const xhr = response();
    gate({
      originalUrl: '/api/use-cases', method: 'GET',
      headers: { accept: 'application/json' }, session: {}, hostedSession: {},
    }, xhr, jest.fn());
    expect(xhr.statusCode).toBe(401);
  });

  // Service-to-server calls (mcp-server vertical-tool callback, banking data
  // fetches) carry a Bearer and no hosted cookie — the gate must pass them to
  // authenticateToken instead of 401-ing (broke every vertical tool call on
  // SE 2026-10-13).
  test.each([
    ['POST /api/path/vertical-tool', 'POST'],
    ['GET /api/accounts/my', 'GET'],
    ['GET /api/transactions/my', 'GET'],
  ])('passes a Bearer-carrying request through to authentication: %s', (path, method) => {
    const next = jest.fn();
    createHostedAccessGate({
      policy: { enabled: true },
      hasApproval: () => false,
    })({
      originalUrl: path.replace(/^[A-Z]+ /, ''),
      method,
      headers: { authorization: 'Bearer some-delegated-token' },
      session: {},
      hostedSession: {},
    }, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('does not treat a malformed or empty Authorization header as a Bearer', () => {
    const next = jest.fn();
    const res = response();
    createHostedAccessGate({
      policy: { enabled: true },
      hasApproval: () => false,
    })({
      originalUrl: '/api/use-cases',
      method: 'GET',
      headers: { authorization: 'Bearer   ' },
      session: {},
      hostedSession: {},
    }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 for a present but stale session so ingress can restart OAuth', () => {
    const res = response();
    createHostedAccessGate({
      policy: { enabled: true },
      hasApproval: () => false,
    })({ originalUrl: '/api/use-cases', method: 'GET', session: { user: { oauthId: 'sub-1' } }, hostedSession: {} }, res, jest.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'hosted_access_required' });
  });

  test.each([
    [{ enabled: false }, {}, 204],
    [{ enabled: true }, {}, 401],
    [{ enabled: true }, { user: { oauthId: 'sub-1' } }, 401],
    [{ enabled: true }, { user: { username: 'demoadmin' }, oauthType: 'admin', oauthTokens: { accessToken: 'real-token' } }, 204],
  ])('check returns expected status %#', (policy, session, status) => {
    const res = response();
    hostedAccessCheck({ policy, hasApproval: () => false })({ session, hostedSession: session }, res);
    expect(res.statusCode).toBe(status);
    expect(res.body).toBeNull();
  });

  test('check returns 204 for an approved session without profile data', () => {
    const res = response();
    hostedAccessCheck({ policy: { enabled: true }, hasApproval: () => true })({ session: {}, hostedSession: {} }, res);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBeNull();
  });

  test('restricted response has a locked-down CSP', () => {
    const res = response();
    sendAccessRestricted(res);
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'");
  });

  test('a denied evaluation returns subject and reason for the audit log', () => {
    const claims = { sub: 's1', email: 'a@pingidentity.com', email_verified: true, groups: [] };
    const result = require('../../services/hostedAccessPolicy').evaluateHostedIdentity(claims, {
      enabled: true, requiredGroupId: 'grp-1', domainSet: new Set(['pingidentity.com']),
      rejectPlusAddressing: true, identifierSet: new Set(),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('group_not_allowed');
    expect(result.subject).toBe('s1');
    expect(result.email).toBe('a@pingidentity.com');
  });
});

describe('hostedAccessGate OBO MCP endpoint', () => {
  test('the unauthenticated POST to the MCP endpoint bypasses the wall so it can return the OAuth challenge', () => {
    expect(isHostedAccessBypassPath('/api/obo/mcp', 'POST')).toBe(true);
  });
  test('the metadata GET bypasses the wall; POST to it stays walled', () => {
    expect(isHostedAccessBypassPath('/api/obo/mcp/oauth-protected-resource', 'GET')).toBe(true);
    expect(isHostedAccessBypassPath('/api/obo/mcp/oauth-protected-resource', 'POST')).toBe(false);
  });
  test('other OBO paths and methods stay walled', () => {
    expect(isHostedAccessBypassPath('/api/obo/mcp', 'GET')).toBe(false);
    expect(isHostedAccessBypassPath('/api/obo/downstream', 'GET')).toBe(false);
  });
});

// The app's own sign-in unlocks the wall (one login, not two). The user callback already evaluates the wall's policy
// and stamps hostedAccessApproval on the APP session; the gate used to read only the separate hosted session, so a
// second, front-door login was needed. These pin the rule: a current approval on an app session with LIVE tokens opens
// the wall, every near-miss does not, and only the sign-in endpoints are reachable before it.
describe('hostedAccessGate — the app sign-in unlocks the wall', () => {
  const policy = { enabled: true };
  const hasApproval = (s) => Boolean(s && s.hostedAccessApproval);
  const live = (over = {}) => ({
    user: { username: 'sam' }, oauthType: 'user', hostedAccessApproval: { v: 1 },
    oauthTokens: { accessToken: 'real-token', expiresAt: Date.now() + 60_000 }, ...over,
  });
  const run = (session, hostedSession) => {
    const gate = createHostedAccessGate({ policy, hasApproval });
    const res = response();
    const next = jest.fn();
    gate({ method: 'GET', originalUrl: '/api/accounts/my', headers: {}, session, hostedSession }, res, next);
    return { res, next };
  };

  test('an approved app session with live tokens opens the wall', () => {
    expect(run(live()).next).toHaveBeenCalled();
  });

  test('the hosted session still opens it on its own', () => {
    expect(run(undefined, { hostedAccessApproval: { v: 1 } }).next).toHaveBeenCalled();
  });

  test.each([
    ['no approval on the app session', live({ hostedAccessApproval: undefined })],
    ['expired tokens', live({ oauthTokens: { accessToken: 'real-token', expiresAt: Date.now() - 1000 } })],
    ['cookie-only session marker', live({ oauthTokens: { accessToken: '_cookie_session' } })],
    ['no access token', live({ oauthTokens: {} })],
    ['no oauthType', live({ oauthType: undefined })],
    ['an unknown oauthType', live({ oauthType: 'guest' })],
  ])('stays walled: %s', (_name, session) => {
    const { res, next } = run(session);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('the readiness check agrees with the gate', () => {
    const check = hostedAccessCheck({ policy, hasApproval });
    const open = response(); check({ session: live(), hostedSession: undefined }, open);
    expect(open.statusCode).toBe(204);
    const shut = response(); check({ session: live({ hostedAccessApproval: undefined }), hostedSession: undefined }, shut);
    expect(shut.statusCode).toBe(401);
  });

  test.each([
    ['GET', '/api/auth/oauth/user/login'],
    ['GET', '/api/auth/oauth/user/callback'],
    ['GET', '/api/auth/oauth/user/silent-reauth'],
    ['GET', '/api/auth/oauth/user/status'],
    ['POST', '/api/auth/oauth/user/pi-flow/credentials'],
    ['POST', '/api/auth/oauth/user/pi-flow/assertion'],
    ['POST', '/api/auth/oauth/user/pi-flow/otp'],
    ['POST', '/api/auth/oauth/user/pi-flow/passwordless'],
    ['POST', '/api/auth/oauth/user/pi-flow/device'],
    ['GET', '/api/auth/oauth/user/pi-flow/external'],
  ])('the sign-in endpoint %s %s is reachable before the wall', (method, path) => {
    expect(isHostedAccessBypassPath(path, method)).toBe(true);
    expect(isHostedAccessBypassPath(`${path}?return_to=%2Fx`, method)).toBe(true);
  });

  test.each([
    ['POST', '/api/auth/oauth/user/consent'],
    ['GET', '/api/auth/oauth/user/token-claims'],
    ['POST', '/api/auth/oauth/user/refresh'],
    ['POST', '/api/auth/oauth/user/revoke'],
    ['POST', '/api/auth/oauth/user/id-jag/intent'],
    ['GET', '/api/auth/oauth/user/logout'],
    ['GET', '/api/auth/oauth/user/pi-flow/credentials'],
    ['POST', '/api/auth/oauth/user/login'],
    ['GET', '/api/auth/oauth/login'],
    ['POST', '/api/auth/oauth/pi-flow/credentials'],
  ])('everything else under the app auth routes stays gated: %s %s', (method, path) => {
    expect(isHostedAccessBypassPath(path, method)).toBe(false);
  });
});
