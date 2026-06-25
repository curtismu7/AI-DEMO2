#!/usr/bin/env node

/**
 * Demo script to showcase enhanced OAuth error handling
 * 
 * This script demonstrates the improved error responses for:
 * 1. Missing tokens
 * 2. Invalid/malformed tokens  
 * 3. Insufficient scopes
 * 4. OAuth provider unavailability
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:3001';

// Helper function to make API requests and display error responses
async function testEndpoint(description, endpoint, headers = {}) {
  console.log(`\n🔍 Testing: ${description}`);
  console.log(`   Endpoint: ${endpoint}`);
  
  try {
    const response = await axios.get(`${API_BASE_URL}${endpoint}`, { headers });
    console.log(`   ✅ Success: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));
  } catch (error) {
    if (error.response) {
      console.log(`   ❌ Error: ${error.response.status}`);
      console.log(`   Enhanced Error Response:`);
      console.log(JSON.stringify(error.response.data, null, 4));
    } else {
      console.log(`   ❌ Network Error:`, error.message);
    }
  }
}

// Helper function to create mock OAuth tokens
function createMockOAuthToken(scopes, userInfo = {}) {
  const payload = {
    sub: userInfo.id || 'demo-user-123',
    preferred_username: userInfo.username || 'demouser',
    email: userInfo.email || 'demo@example.com',
    scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
    iss: 'https://auth.pingone.com/demo-env',
    aud: 'banking_jk_enduser',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000),
    realm_access: {
      roles: userInfo.roles || ['user']
    }
  };
  
  // Use a test secret (different from production)
  // Create test token without JWT library
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'demo-signature';
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function runDemo() {
  console.log('🚀 Enhanced OAuth Error Handling Demo');
  console.log('=====================================');
  
  // Test 1: Missing Authorization Header
  await testEndpoint(
    'Missing Authorization Header',
    '/api/accounts'
  );
  
  // Test 2: Malformed Token
  await testEndpoint(
    'Malformed Token',
    '/api/accounts',
    { Authorization: 'Bearer invalid-token-format' }
  );
  
  // Test 3: Insufficient Scopes
  const tokenWithWrongScopes = createMockOAuthToken(['transactions:read']);
  await testEndpoint(
    'Insufficient Scopes (has transactions:read, needs accounts:read)',
    '/api/accounts',
    { Authorization: `Bearer ${tokenWithWrongScopes}` }
  );
  
  // Test 4: Valid Token with Correct Scopes
  const validToken = createMockOAuthToken(['accounts:read']);
  await testEndpoint(
    'Valid Token with Correct Scopes',
    '/api/accounts/my',
    { Authorization: `Bearer ${validToken}` }
  );
  
  // Test 5: Admin Endpoint without Admin Scope
  const userToken = createMockOAuthToken(['read', 'write']);
  await testEndpoint(
    'Admin Endpoint without Admin Scope',
    '/api/admin/stats',
    { Authorization: `Bearer ${userToken}` }
  );
  
  // Test 6: Health Check with OAuth Provider Status
  await testEndpoint(
    'Health Check with OAuth Provider Status',
    '/health'
  );
  
  console.log('\n✨ Demo completed!');
  console.log('\nKey improvements in enhanced error handling:');
  console.log('• Detailed error descriptions with specific requirements');
  console.log('• Request tracking information (timestamp, path, method)');
  console.log('• Helpful hints for resolving issues');
  console.log('• Consistent error format across all endpoints');
  console.log('• Scope validation details (required vs provided)');
  console.log('• OAuth provider health monitoring');
}

// Check if server is running
async function checkServerHealth() {
  try {
    await axios.get(`${API_BASE_URL}/health`);
    return true;
  } catch (error) {
    return false;
  }
}

// Main execution
async function main() {
  console.log('Checking if banking API server is running...');
  
  const isServerRunning = await checkServerHealth();
  if (!isServerRunning) {
    console.log('❌ Banking API server is not running!');
    console.log('Please start the server first:');
    console.log('  cd demo_api_server && npm start');
    process.exit(1);
  }
  
  console.log('✅ Server is running, starting demo...\n');
  
  // Set environment variables for testing
  process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
  process.env.DEBUG_TOKENS = 'false'; // Reduce noise in demo
  
  await runDemo();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { runDemo, createMockOAuthToken };