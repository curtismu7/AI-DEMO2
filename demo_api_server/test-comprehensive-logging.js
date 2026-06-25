#!/usr/bin/env node

/**
 * Comprehensive test for enhanced OAuth error handling and logging
 * 
 * This script tests:
 * 1. Structured logging for OAuth token validation failures
 * 2. OAuth provider response time monitoring
 * 3. Detailed error messages for different authorization failure scenarios
 * 4. Debug logging for scope validation
 */

const axios = require('axios');
const { logger, LOG_CATEGORIES } = require('./utils/logger');
const { oauthMonitor } = require('./utils/oauthMonitor');

const API_BASE_URL = 'http://localhost:3001';

// Set environment variables for comprehensive testing
process.env.LOG_LEVEL = 'DEBUG';
process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
process.env.DEBUG_TOKENS = 'true';

// Helper function to create mock OAuth tokens
function createMockOAuthToken(scopes, userInfo = {}, expired = false) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userInfo.id || 'test-user-123',
    preferred_username: userInfo.username || 'testuser',
    email: userInfo.email || 'test@example.com',
    scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
    iss: 'https://auth.pingone.com/test-env',
    aud: 'banking_jk_enduser',
    exp: expired ? now - 3600 : now + 3600, // Expired or valid for 1 hour
    iat: now,
    realm_access: {
      roles: userInfo.roles || ['user']
    }
  };
  
  // Create test token
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'test-signature';
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// Test scenarios
const testScenarios = [
  {
    name: 'Missing Authorization Header',
    description: 'Test authentication failure logging for missing token',
    endpoint: '/api/accounts',
    headers: {},
    expectedStatus: 401,
    expectedError: 'authentication_required'
  },
  {
    name: 'Malformed Token',
    description: 'Test authentication failure logging for invalid token format',
    endpoint: '/api/accounts',
    headers: { Authorization: 'Bearer invalid-token-format' },
    expectedStatus: 401,
    expectedError: 'malformed_token'
  },
  {
    name: 'Expired Token',
    description: 'Test authentication failure logging for expired token',
    endpoint: '/api/accounts',
    headers: { Authorization: `Bearer ${createMockOAuthToken(['read'], {}, true)}` },
    expectedStatus: 401,
    expectedError: 'expired_token'
  },
  {
    name: 'Insufficient Scopes - Wrong Scope',
    description: 'Test scope validation failure logging',
    endpoint: '/api/accounts',
    headers: { Authorization: `Bearer ${createMockOAuthToken(['transactions:read'])}` },
    expectedStatus: 403,
    expectedError: 'insufficient_scope'
  },
  {
    name: 'Insufficient Scopes - No Scopes',
    description: 'Test scope validation failure with no scopes',
    endpoint: '/api/accounts',
    headers: { Authorization: `Bearer ${createMockOAuthToken([])}` },
    expectedStatus: 403,
    expectedError: 'insufficient_scope'
  },
  {
    name: 'Admin Access Without Admin Scope',
    description: 'Test admin authorization failure logging',
    endpoint: '/api/admin/stats',
    headers: { Authorization: `Bearer ${createMockOAuthToken(['read', 'write'])}` },
    expectedStatus: 403,
    expectedError: 'insufficient_scope'
  },
  {
    name: 'Valid Token with Correct Scopes',
    description: 'Test successful authentication and authorization logging',
    endpoint: '/api/accounts/my',
    headers: { Authorization: `Bearer ${createMockOAuthToken(['accounts:read'])}` },
    expectedStatus: 200,
    expectedError: null
  },
  {
    name: 'Valid Admin Token',
    description: 'Test successful admin authentication and authorization logging',
    endpoint: '/api/admin/stats',
    headers: { Authorization: `Bearer ${createMockOAuthToken(['admin'], { roles: ['admin'] })}` },
    expectedStatus: 200,
    expectedError: null
  }
];

// Test runner
async function runComprehensiveTest() {
  console.log('🚀 Starting Comprehensive OAuth Logging and Error Handling Test');
  console.log('================================================================\n');
  
  // Initialize monitoring
  const testStartTime = Date.now();
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  
  for (const scenario of testScenarios) {
    totalTests++;
    console.log(`\n📋 Test ${totalTests}: ${scenario.name}`);
    console.log(`   Description: ${scenario.description}`);
    console.log(`   Endpoint: ${scenario.endpoint}`);
    console.log(`   Expected Status: ${scenario.expectedStatus}`);
    
    try {
      const startTime = Date.now();
      const response = await axios.get(`${API_BASE_URL}${scenario.endpoint}`, { 
        headers: scenario.headers,
        validateStatus: () => true // Don't throw on error status codes
      });
      const responseTime = Date.now() - startTime;
      
      // Validate response
      const statusMatch = response.status === scenario.expectedStatus;
      const errorMatch = scenario.expectedError ? 
        response.data.error === scenario.expectedError : 
        response.status < 400;
      
      if (statusMatch && errorMatch) {
        console.log(`   ✅ PASSED (${responseTime}ms)`);
        console.log(`      Status: ${response.status}`);
        if (response.data.error) {
          console.log(`      Error Type: ${response.data.error}`);
          console.log(`      Error Description: ${response.data.error_description}`);
        }
        passedTests++;
      } else {
        console.log(`   ❌ FAILED (${responseTime}ms)`);
        console.log(`      Expected Status: ${scenario.expectedStatus}, Got: ${response.status}`);
        console.log(`      Expected Error: ${scenario.expectedError}, Got: ${response.data.error}`);
        console.log(`      Response:`, JSON.stringify(response.data, null, 2));
        failedTests++;
      }
      
      // Log detailed response for analysis
      if (process.env.VERBOSE_TESTING === 'true') {
        console.log(`      Full Response:`, JSON.stringify(response.data, null, 2));
      }
      
    } catch (error) {
      console.log(`   ❌ FAILED - Network Error: ${error.message}`);
      failedTests++;
    }
  }
  
  // Test health endpoint with monitoring data
  console.log(`\n📋 Test ${totalTests + 1}: Health Endpoint with OAuth Monitoring`);
  try {
    const response = await axios.get(`${API_BASE_URL}/health`);
    if (response.status === 200 && response.data.components.oauth_details.metrics) {
      console.log(`   ✅ PASSED - Health endpoint includes OAuth monitoring`);
      console.log(`      OAuth Metrics:`, JSON.stringify(response.data.components.oauth_details.metrics, null, 2));
      passedTests++;
    } else {
      console.log(`   ❌ FAILED - Health endpoint missing OAuth monitoring data`);
      failedTests++;
    }
    totalTests++;
  } catch (error) {
    console.log(`   ❌ FAILED - Health endpoint error: ${error.message}`);
    failedTests++;
    totalTests++;
  }
  
  // Display OAuth monitoring summary
  console.log('\n📊 OAuth Provider Monitoring Summary');
  console.log('=====================================');
  const metrics = oauthMonitor.getMetrics();
  console.log(`Total Requests: ${metrics.totalRequests}`);
  console.log(`Success Rate: ${metrics.successRate}%`);
  console.log(`Average Response Time: ${Math.round(metrics.averageResponseTime)}ms`);
  console.log(`Health Status: ${metrics.healthStatus}`);
  console.log(`Circuit Breaker Open: ${metrics.circuitBreaker.isOpen}`);
  
  if (metrics.recentErrors.length > 0) {
    console.log('\nRecent Errors:');
    metrics.recentErrors.slice(0, 5).forEach((error, index) => {
      console.log(`  ${index + 1}. ${error.errorType}: ${error.metadata?.error_message || 'Unknown error'}`);
    });
  }
  
  // Test summary
  const testDuration = Date.now() - testStartTime;
  console.log('\n🎯 Test Summary');
  console.log('===============');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log(`Success Rate: ${Math.round((passedTests / totalTests) * 100)}%`);
  console.log(`Test Duration: ${testDuration}ms`);
  
  // Log final test results
  logger.info(LOG_CATEGORIES.ERROR_HANDLING, 'Comprehensive logging test completed', {
    total_tests: totalTests,
    passed_tests: passedTests,
    failed_tests: failedTests,
    success_rate: Math.round((passedTests / totalTests) * 100),
    test_duration_ms: testDuration,
    oauth_metrics: metrics
  });
  
  if (failedTests === 0) {
    console.log('\n🎉 All tests passed! Enhanced OAuth logging and error handling is working correctly.');
    process.exit(0);
  } else {
    console.log(`\n⚠️  ${failedTests} test(s) failed. Please review the implementation.`);
    process.exit(1);
  }
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
  
  console.log('✅ Server is running, starting comprehensive test...\n');
  
  await runComprehensiveTest();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { runComprehensiveTest, createMockOAuthToken };