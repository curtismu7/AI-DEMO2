'use strict';

/**
 * Regression: the vault master password was readable without authentication.
 *
 * POST /api/admin/vault/unlock was captured by the global /api tracker with its
 * body unredacted, dual-written into the shared __global__ bucket, and served by
 * GET /api/api-calls — which was mounted with no authenticateToken and defaults
 * to that bucket. Two independent guards are asserted here: the body never
 * reaches the buffer in plaintext, and the reader requires a session.
 */

const fs = require('fs');
const path = require('path');

const tracker = require('../services/apiCallTrackerService');

describe('vault password is never parked in the API-explorer buffer', () => {
  beforeEach(() => {
    tracker._resetForTests();
  });

  test('redactBodyKeys removes every vault password field', () => {
    const out = tracker.redactBodyKeys({
      password: 'master-pw',
      currentPassword: 'old-pw',
      newPassword: 'new-pw',
      keepMe: 'visible',
    });

    expect(out.password).toBe('***REDACTED***');
    expect(out.currentPassword).toBe('***REDACTED***');
    expect(out.newPassword).toBe('***REDACTED***');
    expect(out.keepMe).toBe('visible');
  });

  test('redactBodyKeys reaches nested and arrayed bodies', () => {
    const out = tracker.redactBodyKeys({
      outer: { credentials: { password: 'nested-pw' } },
      list: [{ client_secret: 'arr-secret' }],
    });

    expect(out.outer.credentials.password).toBe('***REDACTED***');
    expect(out.list[0].client_secret).toBe('***REDACTED***');
  });

  test('a tracked vault unlock leaves no plaintext password in the global bucket', async () => {
    await tracker.trackApiCall({
      sessionId: 'some-admin-session',
      method: 'POST',
      url: '/api/admin/vault/unlock',
      requestHeaders: { cookie: 'connect.sid=s%3AadminSessionCookieValue.abcdef' },
      requestBody: { password: 'the-real-master-password' },
      responseStatus: 200,
      responseBody: { entries: 12 },
      duration: 4,
    });

    const globalCalls = tracker.getApiCalls(tracker.GLOBAL_SESSION_ID);
    expect(globalCalls.length).toBe(1);

    const serialized = JSON.stringify(globalCalls);
    expect(serialized).not.toContain('the-real-master-password');
    expect(globalCalls[0].request.body).toContain('***REDACTED***');
  });

  test('the admin session cookie is redacted in full, not truncated', async () => {
    await tracker.trackApiCall({
      sessionId: 'some-admin-session',
      method: 'POST',
      url: '/api/admin/vault/unlock',
      requestHeaders: { cookie: 'connect.sid=s%3AadminSessionCookieValue.abcdef' },
      requestBody: { password: 'pw' },
      responseStatus: 200,
      duration: 1,
    });

    const [call] = tracker.getApiCalls(tracker.GLOBAL_SESSION_ID);
    expect(call.request.headers.cookie).toBe('***REDACTED***');
    // The old truncation exposed both ends of the cookie.
    expect(call.request.headers.cookie).not.toContain('connect.sid');
    expect(call.request.headers.cookie).not.toContain('abcdef');
  });
});

describe('the API-explorer reader is authenticated', () => {
  test('/api/api-calls is mounted behind authenticateToken', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    expect(serverSrc).toMatch(
      /app\.use\(\s*'\/api\/api-calls'\s*,\s*authenticateToken\s*,/
    );
  });
});
