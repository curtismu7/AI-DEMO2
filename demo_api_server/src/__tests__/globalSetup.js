/**
 * Global Setup for OAuth Integration Tests
 * 
 * This file runs once before all tests start.
 */

module.exports = async () => {
  console.log('🚀 Starting OAuth Integration Test Suite...');
  
  // Set global test environment
  process.env.NODE_ENV = 'test';
  process.env.DEBUG_TOKENS = 'true';
  process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
  
  // Disable rate limiting for tests
  process.env.DISABLE_RATE_LIMITING = 'true';
  
  // Set test database/storage paths
  process.env.DATA_PATH = './src/__tests__/test-data';
  
  // OAuth test configuration
  process.env.OAUTH_CLIENT_ID = 'test-client-id';
  process.env.OAUTH_CLIENT_SECRET = 'test-client-secret';
  process.env.OAUTH_ISSUER = 'https://auth.pingone.com/test-env';
  process.env.OAUTH_REDIRECT_URI = 'http://localhost:3001/api/auth/oauth/callback';
  
  // Session configuration for tests
  process.env.SESSION_SECRET = 'test-session-secret-for-integration-tests';
  
  console.log('✅ Global test environment configured');
};