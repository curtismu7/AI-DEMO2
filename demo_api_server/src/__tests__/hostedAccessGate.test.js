'use strict';

const {
  isHostedAccessBypassPath,
  createHostedAccessGate,
  hostedAccessCheck,
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

describe('hostedAccessGate', () => {
  test.each([
    ['/api/auth/oauth/user/login', 'GET'],
    ['/api/auth/oauth/user/callback', 'GET'],
    ['/api/auth/oauth/login', 'GET'],
    ['/api/auth/oauth/callback', 'GET'],
    ['/api/healthz', 'GET'],
  ])('allows exact bypass %s %s', (path, method) => {
    expect(isHostedAccessBypassPath(path, method)).toBe(true);
  });

  test.each([
    ['/api/auth/oauth/user/callback/extra', 'GET'],
    ['/api/auth/oauth/user/login', 'POST'],
    ['/api/auth/oauth/callback.evil', 'GET'],
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
    })({ originalUrl: '/api/use-cases', method: 'GET', session: {} }, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('returns 401 for an anonymous direct BFF request', () => {
    const res = response();
    createHostedAccessGate({
      policy: { enabled: true },
      hasApproval: () => false,
    })({ originalUrl: '/api/use-cases', method: 'GET', session: {} }, res, jest.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'hosted_access_required' });
  });

  test('returns 401 for a present but stale session so ingress can restart OAuth', () => {
    const res = response();
    createHostedAccessGate({
      policy: { enabled: true },
      hasApproval: () => false,
    })({ originalUrl: '/api/use-cases', method: 'GET', session: { user: { oauthId: 'sub-1' } } }, res, jest.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'hosted_access_required' });
  });

  test.each([
    [{ enabled: false }, {}, 204],
    [{ enabled: true }, {}, 401],
    [{ enabled: true }, { user: { oauthId: 'sub-1' } }, 401],
  ])('check returns expected status %#', (policy, session, status) => {
    const res = response();
    hostedAccessCheck({ policy, hasApproval: () => false })({ session }, res);
    expect(res.statusCode).toBe(status);
    expect(res.body).toBeNull();
  });

  test('check returns 204 for an approved session without profile data', () => {
    const res = response();
    hostedAccessCheck({ policy: { enabled: true }, hasApproval: () => true })({ session: {} }, res);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBeNull();
  });

  test('restricted response has a locked-down CSP', () => {
    const res = response();
    sendAccessRestricted(res);
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'");
  });
});
