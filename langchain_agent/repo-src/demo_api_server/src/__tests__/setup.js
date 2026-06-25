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