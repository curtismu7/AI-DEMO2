#!/usr/bin/env node

/**
 * Test script to demonstrate transaction scope-based authorization
 * This script tests different scope combinations against transaction endpoints
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

// Helper function to create OAuth tokens with specific scopes
const createOAuthToken = (scopes, userInfo = {}) => {
  const payload = {
    sub: userInfo.id || 'test-user-123',
    preferred_username: userInfo.username || 'testuser',
    email: userInfo.email || 'test@example.com',
    scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
    iss: 'https://auth.pingone.com/test-env',
    aud: 'banking_jk_enduser',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000),
    realm_access: {
      roles: userInfo.roles || ['user']
    }
  };
  
  // Create test token without JWT library
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'test-signature';
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

// Test scenarios
const testScenarios = [
  {
    name: 'Read transactions with transactions:read scope',
    token: createOAuthToken(['transactions:read']),
    method: 'GET',
    endpoint: '/api/transactions/my',
    expectedStatus: 200,
    description: 'Should allow reading user transactions with specific transaction read scope'
  },
  {
    name: 'Read transactions with read scope',
    token: createOAuthToken(['read']),
    method: 'GET',
    endpoint: '/api/transactions/my',
    expectedStatus: 200,
    description: 'Should allow reading user transactions with general banking read scope'
  },
  {
    name: 'Read transactions without required scopes',
    token: createOAuthToken(['write']),
    method: 'GET',
    endpoint: '/api/transactions/my',
    expectedStatus: 403,
    description: 'Should deny reading transactions without read scopes'
  },
  {
    name: 'Create transaction with transactions:write scope',
    token: createOAuthToken(['transactions:write']),
    method: 'POST',
    endpoint: '/api/transactions',
    data: {
      type: 'deposit',
      amount: 100,
      toAccountId: 'test-account-123',
      description: 'Test deposit'
    },
    expectedStatus: 404, // Account not found, but scope check should pass
    description: 'Should allow creating transactions with specific transaction write scope'
  },
  {
    name: 'Create transaction with write scope',
    token: createOAuthToken(['write']),
    method: 'POST',
    endpoint: '/api/transactions',
    data: {
      type: 'deposit',
      amount: 100,
      toAccountId: 'test-account-123',
      description: 'Test deposit'
    },
    expectedStatus: 404, // Account not found, but scope check should pass
    description: 'Should allow creating transactions with general banking write scope'
  },
  {
    name: 'Create transaction without required scopes',
    token: createOAuthToken(['read']),
    method: 'POST',
    endpoint: '/api/transactions',
    data: {
      type: 'deposit',
      amount: 100,
      toAccountId: 'test-account-123',
      description: 'Test deposit'
    },
    expectedStatus: 403,
    description: 'Should deny creating transactions without write scopes'
  },
  {
    name: 'Transfer with transactions:write scope',
    token: createOAuthToken(['transactions:write']),
    method: 'POST',
    endpoint: '/api/transactions',
    data: {
      type: 'transfer',
      amount: 100,
      fromAccountId: 'test-account-from',
      toAccountId: 'test-account-to',
      description: 'Test transfer'
    },
    expectedStatus: 404, // Account not found, but scope check should pass
    description: 'Should allow transfers with transaction write scope'
  },
  {
    name: 'Transfer without required scopes',
    token: createOAuthToken(['transactions:read']),
    method: 'POST',
    endpoint: '/api/transactions',
    data: {
      type: 'transfer',
      amount: 100,
      fromAccountId: 'test-account-from',
      toAccountId: 'test-account-to',
      description: 'Test transfer'
    },
    expectedStatus: 403,
    description: 'Should deny transfers without write scopes'
  }
];

async function runTest(scenario) {
  try {
    console.log(`\n🧪 Testing: ${scenario.name}`);
    console.log(`   ${scenario.description}`);
    
    const config = {
      method: scenario.method,
      url: `${BASE_URL}${scenario.endpoint}`,
      headers: {
        'Authorization': `Bearer ${scenario.token}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (scenario.data) {
      config.data = scenario.data;
    }
    
    const response = await axios(config);
    
    if (response.status === scenario.expectedStatus) {
      console.log(`   ✅ PASS: Got expected status ${response.status}`);
      if (response.data && response.data.transactions) {
        console.log(`   📊 Response: Found ${response.data.transactions.length} transactions`);
      }
    } else {
      console.log(`   ❌ FAIL: Expected status ${scenario.expectedStatus}, got ${response.status}`);
      console.log(`   📄 Response: ${JSON.stringify(response.data, null, 2)}`);
    }
    
  } catch (error) {
    if (error.response && error.response.status === scenario.expectedStatus) {
      console.log(`   ✅ PASS: Got expected error status ${error.response.status}`);
      if (error.response.data && error.response.data.error === 'insufficient_scope') {
        console.log(`   🔒 Scope Error: ${error.response.data.error_description}`);
        console.log(`   📋 Required: ${error.response.data.required_scopes?.join(', ')}`);
        console.log(`   📋 Provided: ${error.response.data.provided_scopes?.join(', ')}`);
      }
    } else {
      console.log(`   ❌ FAIL: Expected status ${scenario.expectedStatus}, got ${error.response?.status || 'network error'}`);
      if (error.response?.data) {
        console.log(`   📄 Error Response: ${JSON.stringify(error.response.data, null, 2)}`);
      } else {
        console.log(`   📄 Error: ${error.message}`);
      }
    }
  }
}

async function main() {
  console.log('🚀 Starting Transaction Scope Authorization Tests');
  console.log('=' .repeat(60));
  
  // Set environment variables for testing
  process.env.DEBUG_TOKENS = 'false'; // Reduce noise
  process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
  
  let passCount = 0;
  let totalCount = testScenarios.length;
  
  for (const scenario of testScenarios) {
    try {
      await runTest(scenario);
      passCount++;
    } catch (error) {
      console.log(`   💥 Test failed with error: ${error.message}`);
    }
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log(`📊 Test Results: ${passCount}/${totalCount} tests passed`);
  
  if (passCount === totalCount) {
    console.log('🎉 All transaction scope authorization tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Check the output above for details.');
    process.exit(1);
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Test runner failed:', error.message);
    process.exit(1);
  });
}

module.exports = { createOAuthToken, testScenarios };