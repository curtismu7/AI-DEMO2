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
    ['/api/auth/oauth/user/login', 'GET'],
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
