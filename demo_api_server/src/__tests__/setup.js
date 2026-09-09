/**
 * Jest Setup for OAuth Integration Tests
 * 
 * This file sets up the test environment for OAuth integration tests.
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DEBUG_TOKENS = 'true';
process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
// Isolate LMDB from the operator's persistent store (data/persistent/lmdb/).
// Tests must never read or write it — that store holds credentials/config the
// running app needs across restarts. Point every in-process LMDB consumer
// (configStore, session store, bankingDb, …) at a per-worker throwaway dir.
process.env.LMDB_PATH = process.env.LMDB_PATH || require('./setup/lmdbTestDir').workerDir();
process.env.SESSION_SECRET = 'test-session-secret';
process.env.OAUTH_CLIENT_ID = 'test-client-id';
process.env.OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.OAUTH_ISSUER = 'https://auth.pingone.com/test-env';

// ── No real outbound network from a unit test ────────────────────────────────
// Measured 2026-09-09 over one full in-band run: the suite made ~4,000 real
// outbound connection attempts — 1,801 ENOTFOUND, 1,991 UND_ERR_SOCKET, 185
// ECONNABORTED — overwhelmingly from services/mcpChallengeProbe.js and
// services/rfc9728ComplianceAuditService.js dialling hosts like `gw.local:443`
// that do not resolve. Two failure modes come out of that, both of which read
// as "flaky tests":
//
//  1. A DNS/socket error resolves AFTER the test that started it has finished,
//     so jest attributes it to whichever test is running when it lands — the
//     random `read ECONNRESET` in a different suite every run that always
//     passes in isolation. It is independent of --maxWorkers, which is why
//     --runInBand never cured it.
//  2. Each unresolvable host costs a real DNS timeout, so wall-clock
//     assertions blow their budget (rfc9728 "concurrent load" expects <5000ms
//     and was taking 39s).
//
// LOOPBACK IS ALLOWED, and by RESOLVED ADDRESS rather than by name. The demo
// puts `api.ping.demo` and `local.ping-devops.com` on 127.0.0.1 in /etc/hosts
// (see the root CLAUDE.md), and suites like tests/anthropic.lmstudio.live.test.js
// legitimately dial the local stack through those names. A by-name loopback
// check blocks them and reds six suites — that mistake is why this is parsed
// out of /etc/hosts.
//
// Escape hatch: ALLOW_TEST_NETWORK=1 disables the guard for a run.
const fs = require('fs');
const net = require('net');

const GUARD = Symbol.for('aiDemo.testNetworkGuard');
// jest gives each test FILE its own module registry but core modules are shared,
// so without this flag the prototype gets re-wrapped once per suite — 982 nested
// wrappers in an in-band run.
if (!net.Socket.prototype[GUARD] && process.env.ALLOW_TEST_NETWORK !== '1') {
  const LOOPBACK_LITERAL = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|localhost)$/i;

  // Hostnames /etc/hosts maps to a loopback address. Read once per process.
  const loopbackNames = new Set();
  try {
    for (const rawLine of fs.readFileSync('/etc/hosts', 'utf8').split('\n')) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;
      const [addr, ...names] = line.split(/\s+/);
      if (LOOPBACK_LITERAL.test(addr)) for (const n of names) loopbackNames.add(n.toLowerCase());
    }
  } catch { /* no /etc/hosts (container, Windows) — literals still allowed */ }

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    // Socket.prototype.connect takes three shapes: connect(options),
    // connect(port, host) and — the one that matters — connect(normalized),
    // where `normalized` is Node's internal [options, callback] ARRAY. An array
    // is typeof 'object', so reading .host straight off args[0] silently yields
    // undefined for every net.connect() call and waves it through.
    const first = args[0];
    const opts = Array.isArray(first)
      ? (first[0] || {})
      : ((first && typeof first === 'object') ? first : { port: args[0], host: args[1] });
    const host = String(opts.host || opts.hostname || opts.servername || '').toLowerCase();
    // Unix sockets, and a shape we cannot read, are left alone: this guard is
    // here to stop the network, not to police connections it cannot identify.
    if (opts.path || !host || LOOPBACK_LITERAL.test(host) || loopbackNames.has(host)) {
      return originalConnect.apply(this, args);
    }
    const err = Object.assign(
      new Error(
        `getaddrinfo ENOTFOUND ${host} — outbound network is blocked in unit tests. `
        + 'Mock this call, or set ALLOW_TEST_NETWORK=1 to run against the real host '
        + '(see src/__tests__/setup.js).',
      ),
      { code: 'ENOTFOUND', errno: -3008, syscall: 'getaddrinfo', hostname: host },
    );
    // Shaped as the DNS failure these call sites already get today for the same
    // hosts, so nothing downstream has to learn a new error code — it just
    // arrives immediately instead of seconds later, inside the test that caused it.
    process.nextTick(() => this.destroy(err));
    return this;
  };
  net.Socket.prototype[GUARD] = true;
}

// Increase timeout for integration tests
jest.setTimeout(30000);

// Global test utilities
global.createMockOAuthToken = (scopes, userInfo = {}) => {
  const payload = {
    sub: userInfo.id || 'test-user-123',
    preferred_username: userInfo.username || 'testuser',
    email: userInfo.email || 'test@example.com',
    scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
    iss: 'https://auth.pingone.com/test-env',
    aud: 'banking_jk_enduser',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    realm_access: {
      roles: userInfo.roles || ['user']
    }
  };
  
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'test-signature';
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

// Mock console methods to reduce noise in tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

console.error = (...args) => {
  // Only show errors that are not expected test errors
  const message = args.join(' ');
  if (!message.includes('Error occurred for path:') && 
      !message.includes('OAuth provider unavailable') &&
      !message.includes('Test error')) {
    originalConsoleError(...args);
  }
};

console.warn = (...args) => {
  // Suppress expected warnings
  const message = args.join(' ');
  if (!message.includes('deprecated') && !message.includes('test warning')) {
    originalConsoleWarn(...args);
  }
};

console.log = (...args) => {
  // Only show logs in verbose mode
  if (process.env.VERBOSE_TESTS === 'true') {
    originalConsoleLog(...args);
  }
};

// Restore console methods after tests
afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  console.log = originalConsoleLog;
});

// Global error handler for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Clean up after each test
afterEach(() => {
  // Clear all timers
  jest.clearAllTimers();
  
  // Clear all mocks
  jest.clearAllMocks();
  
  // Reset modules
  jest.resetModules();
});

// Global test helpers
global.testHelpers = {
  // Helper to wait for async operations
  waitFor: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Helper to create test user data
  createTestUser: (overrides = {}) => ({
    id: 'test-user-123',
    username: 'testuser',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'user',
    ...overrides
  }),
  
  // Helper to create test OAuth response
  createOAuthResponse: (overrides = {}) => ({
    access_token: 'test-oauth-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'read write',
    ...overrides
  }),
  
  // Helper to create test session data
  createTestSession: (overrides = {}) => ({
    user: global.testHelpers.createTestUser(),
    oauthTokens: {
      accessToken: 'test-oauth-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
      tokenType: 'Bearer'
    },
    clientType: 'enduser',
    ...overrides
  })
};

console.log('🔧 OAuth Integration Test Setup Complete');