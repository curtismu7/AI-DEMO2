/**
 * Test Token Generator
 * Generates JWT tokens with intentional security violations for token validation testing
 * 
 * Phase 158: Add Token Validation Test Scenarios
 */

const jwt = require('jsonwebtoken');

// Test secret — not verified in production, but tokens have consistent structure
const TEST_SECRET = 'test-jwt-secret-not-verified-in-production';

/**
 * Base function to generate a test JWT token with custom claims
 * @param {Object} options - Token options
 * @param {string} options.sub - Subject (user ID)
 * @param {string} options.aud - Audience
 * @param {string[]} options.scope - Array of scopes
 * @param {Object} options.act - RFC 8693 act claim (delegation)
 * @param {number} options.exp - Expiration time (unix seconds)
 * @param {number} options.expiresIn - Seconds from now to expire (default 3600)
 * @returns {string} Signed JWT token
 */
function generateTestToken(options = {}) {
  const {
    sub = 'test-user-123',
    aud = 'https://mcp-server.banking-demo.com',
    scope = ['read', 'write'],
    act = undefined,
    exp = undefined,
    expiresIn = 3600
  } = options;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    aud,
    scope: Array.isArray(scope) ? scope.join(' ') : scope,
    iat: now,
    exp: exp !== undefined ? exp : now + expiresIn,
    client_id: 'test-client',
    jti: `test-token-${Date.now()}`,
    _test_token: true  // Marker to identify test tokens
  };

  // RFC 8693 delegation claim
  if (act) {
    payload.act = act;
  }

  return jwt.sign(payload, TEST_SECRET, {
    algorithm: 'HS256',
    noTimestamp: false
  });
}

/**
 * Generate user token with wrong scope (no mcp:* or agent scopes)
 * Scenario: User token lacks agent-required scopes
 */
function generateWrongScopeToken() {
  return generateTestToken({
    sub: 'test-user-123',
    aud: 'https://mcp-server.banking-demo.com',
    scope: ['profile', 'email', 'read'],  // Missing mcp:* or agent
    expiresIn: 3600
  });
}

/**
 * Generate token with wrong audience
 * Scenario: Token issued for different service (audience mismatch attack vector)
 */
function generateWrongAudToken() {
  return generateTestToken({
    sub: 'test-user-123',
    aud: 'https://banking-bff.banking-demo.com',  // Wrong audience (BFF instead of MCP)
    scope: ['read', 'write', 'agent'],
    expiresIn: 3600
  });
}

/**
 * Generate token without act claim (missing delegation proof)
 * Scenario: Non-delegated user token used on MCP (should have act claim)
 */
function generateMissingActToken() {
  return generateTestToken({
    sub: 'test-user-123',
    aud: 'https://mcp-server.banking-demo.com',
    scope: ['read', 'write', 'agent'],
    act: undefined,  // Explicitly no act claim
    expiresIn: 3600
  });
}

/**
 * Generate agent-scoped token (for use on user-level endpoint)
 * Scenario: Agent token used where user scopes required
 */
function generateAgentToken() {
  return generateTestToken({
    sub: 'ai-agent-core-client',
    aud: 'https://mcp-server.banking-demo.com',
    scope: ['agent', 'mcp:invoke'],  // Agent-only scopes
    act: {
      client_id: 'mcp-agent',
      sub: 'test-user-123'
    },
    expiresIn: 3600
  });
}

/**
 * Generate expired token (past expiration time)
 * Scenario: Token past expiration time
 */
function generateExpiredToken() {
  const now = Math.floor(Date.now() / 1000);
  return generateTestToken({
    sub: 'test-user-123',
    aud: 'https://mcp-server.banking-demo.com',
    scope: ['read', 'write', 'agent'],
    exp: now - 900  // Expired 15 minutes ago
  });
}

/**
 * Decode and return a test token for inspection (without verification)
 * @param {string} token - JWT token
 * @returns {Object} Decoded payload
 */
function decodeTestToken(token) {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
}

module.exports = {
  generateTestToken,
  generateWrongScopeToken,
  generateWrongAudToken,
  generateMissingActToken,
  generateAgentToken,
  generateExpiredToken,
  decodeTestToken,
  TEST_SECRET
};
