#!/usr/bin/env node

const axios = require('axios');

// Test configuration
const BASE_URL = 'http://localhost:3001';

// Helper function to create OAuth tokens with specific scopes
const createOAuthToken = (scopes, userInfo = {}) => {
  const payload = {
    sub: userInfo.id || 'test-admin-123',
    preferred_username: userInfo.username || 'testadmin',
    email: userInfo.email || 'admin@example.com',
    scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
    iss: 'https://auth.pingone.com/test-env',
    aud: 'banking_jk_enduser',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000),
    realm_access: {
      roles: userInfo.roles || ['admin']
    }
  };
  
  // Create test token without JWT library
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'test-signature';
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

// Helper function to create local JWT tokens
const createLocalJWT = (userInfo = {}) => {
  const payload = {
    id: userInfo.id || 'test-admin-123',
    username: userInfo.username || 'testadmin',
    role: userInfo.role || 'admin'
  };
  
  // Create test token without JWT library
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'test-signature';
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

async function testAdminAccess() {
  console.log('🧪 Testing Admin Scope Authorization\n');

  // Test 1: OAuth token with admin scope
  console.log('1. Testing OAuth token with admin scope...');
  try {
    const token = createOAuthToken(['admin'], { 
      username: 'oauth-admin',
      roles: ['admin']
    });
    
    const response = await axios.get(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('   ✅ SUCCESS: Admin access granted with admin scope');
    console.log(`   📊 Response: ${JSON.stringify(response.data.stats, null, 2)}`);
  } catch (error) {
    console.log('   ❌ FAILED:', error.response?.data || error.message);
  }

  // Test 2: OAuth token without admin scope
  console.log('\n2. Testing OAuth token without admin scope...');
  try {
    const token = createOAuthToken(['read', 'write'], { 
      username: 'oauth-user',
      roles: ['user']
    });
    
    await axios.get(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log('   ❌ UNEXPECTED: Should have been denied access');
  } catch (error) {
    if (error.response?.status === 403 && error.response?.data?.error === 'insufficient_scope') {
      console.log('   ✅ SUCCESS: Admin access correctly denied without admin scope');
      console.log(`   🚫 Error: ${error.response.data.error_description}`);
      console.log(`   📋 Required: ${JSON.stringify(error.response.data.required_scopes)}`);
      console.log(`   📋 Provided: ${JSON.stringify(error.response.data.provided_scopes)}`);
    } else {
      console.log('   ❌ UNEXPECTED ERROR:', error.response?.data || error.message);
    }
  }

  // Test 3: Local JWT token with admin role (backward compatibility)
  console.log('\n3. Testing Local JWT token with admin role...');
  try {
    const token = createLocalJWT({ 
      username: 'local-admin',
      role: 'admin'
    });
    
    const response = await axios.get(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('   ✅ SUCCESS: Admin access granted with local JWT admin role');
    console.log(`   📊 Response: ${JSON.stringify(response.data.stats, null, 2)}`);
  } catch (error) {
    console.log('   ❌ FAILED:', error.response?.data || error.message);
  }

  // Test 4: Local JWT token without admin role
  console.log('\n4. Testing Local JWT token without admin role...');
  try {
    const token = createLocalJWT({ 
      username: 'local-user',
      role: 'user'
    });
    
    await axios.get(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log('   ❌ UNEXPECTED: Should have been denied access');
  } catch (error) {
    if (error.response?.status === 403 && error.response?.data?.error === 'Admin access required') {
      console.log('   ✅ SUCCESS: Admin access correctly denied without admin role');
      console.log(`   🚫 Error: ${error.response.data.error}`);
    } else {
      console.log('   ❌ UNEXPECTED ERROR:', error.response?.data || error.message);
    }
  }

  // Test 5: OAuth token with admin role but no admin scope
  console.log('\n5. Testing OAuth token with admin role but no admin scope...');
  try {
    const token = createOAuthToken(['read'], { 
      username: 'oauth-admin-no-scope',
      roles: ['admin'] // Has admin role but not admin scope
    });
    
    await axios.get(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log('   ❌ UNEXPECTED: Should have been denied access');
  } catch (error) {
    if (error.response?.status === 403 && error.response?.data?.error === 'insufficient_scope') {
      console.log('   ✅ SUCCESS: Admin access correctly denied - OAuth tokens require admin scope');
      console.log(`   🚫 Error: ${error.response.data.error_description}`);
    } else {
      console.log('   ❌ UNEXPECTED ERROR:', error.response?.data || error.message);
    }
  }

  console.log('\n🎉 Admin scope authorization tests completed!');
}

// Set environment variables for testing
process.env.DEBUG_TOKENS = 'false'; // Reduce noise
process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';

testAdminAccess().catch(console.error);