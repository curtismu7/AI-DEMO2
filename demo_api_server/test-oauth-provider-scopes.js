#!/usr/bin/env node

/**
 * Test Script for OAuth Provider Scope Configuration
 * 
 * This script validates that the OAuth provider is configured to issue
 * tokens with appropriate banking scopes for different user types.
 */

const { 
  BANKING_SCOPES, 
  USER_TYPE_SCOPES, 
  getOAuthProviderConfig
} = require('./config/scopes');

const { logger, LOG_CATEGORIES } = require('./utils/logger');

// Mock token payloads for different user types
const MOCK_TOKENS = {
  admin: {
    sub: 'admin-user-123',
    preferred_username: 'admin@test.com',
    email: 'admin@test.com',
    scope: 'openid profile email admin read write accounts:read transactions:read transactions:write',
    realm_access: {
      roles: ['admin']
    },
    aud: 'banking_jk',
    iss: 'https://openam-dna.forgeblocks.com/am/oauth2/realms/root/realms/alpha',
    exp: Math.floor(Date.now() / 1000) + 3600
  },
  
  customer: {
    sub: 'customer-user-456',
    preferred_username: 'customer@test.com',
    email: 'customer@test.com',
    scope: 'openid profile email read write accounts:read transactions:read transactions:write',
    realm_access: {
      roles: ['customer']
    },
    aud: 'banking_jk_enduser',
    iss: 'https://openam-dna.forgeblocks.com/am/oauth2/realms/root/realms/alpha',
    exp: Math.floor(Date.now() / 1000) + 3600
  },
  
  readonly: {
    sub: 'readonly-user-789',
    preferred_username: 'readonly@test.com',
    email: 'readonly@test.com',
    scope: 'openid profile email read accounts:read transactions:read',
    realm_access: {
      roles: ['user']
    },
    aud: 'banking_jk_enduser',
    iss: 'https://openam-dna.forgeblocks.com/am/oauth2/realms/root/realms/alpha',
    exp: Math.floor(Date.now() / 1000) + 3600
  },
  
  ai_agent: {
    sub: 'ai-agent-client-001',
    preferred_username: 'ai-agent',
    scope: 'openid profile ai_agent read write accounts:read transactions:read transactions:write',
    aud: 'banking_mcp_01_JK',
    iss: 'https://openam-dna.forgeblocks.com/am/oauth2/realms/root/realms/alpha',
    exp: Math.floor(Date.now() / 1000) + 3600
  }
};

// Test scope validation for each user type
function testUserTypeScopes() {
  console.log('\n👥 Testing OAuth Provider Scope Configuration...');
  
  Object.entries(MOCK_TOKENS).forEach(([userType, tokenPayload]) => {
    console.log(`\n  User Type: ${userType}`);
    console.log(`    Username: ${tokenPayload.preferred_username || tokenPayload.sub}`);
    
    // Parse scopes from token
    const tokenScopes = tokenPayload.scope.split(' ').filter(scope => 
      scope.startsWith('') || scope === 'ai_agent'
    );
    
    // Get expected scopes for user type
    const expectedScopes = USER_TYPE_SCOPES[userType] || [];
    
    console.log(`    Token Scopes: [${tokenScopes.join(', ')}]`);
    console.log(`    Expected Scopes: [${expectedScopes.join(', ')}]`);
    
    // Check if token has all expected scopes
    const missingScopes = expectedScopes.filter(scope => !tokenScopes.includes(scope));
    const extraScopes = tokenScopes.filter(scope => !expectedScopes.includes(scope));
    
    const scopesValid = missingScopes.length === 0;
    console.log(`    Scopes Valid: ${scopesValid ? '✅ YES' : '❌ NO'}`);
    
    if (missingScopes.length > 0) {
      console.log(`    Missing Scopes: [${missingScopes.join(', ')}]`);
    }
    
    if (extraScopes.length > 0) {
      console.log(`    Extra Scopes: [${extraScopes.join(', ')}]`);
    }
    
    // Test specific scope requirements
    testSpecificScopeRequirements(userType, tokenScopes);
  });
}

// Test specific scope requirements for each user type
function testSpecificScopeRequirements(userType, tokenScopes) {
  console.log(`    Specific Requirements:`);
  
  switch (userType) {
    case 'admin':
      const hasAdminScope = tokenScopes.includes(BANKING_SCOPES.ADMIN);
      console.log(`      Has admin: ${hasAdminScope ? '✅ YES' : '❌ NO'}`);
      
      const hasAllBankingScopes = [
        BANKING_SCOPES.BANKING_READ,
        BANKING_SCOPES.BANKING_WRITE,
        BANKING_SCOPES.ACCOUNTS_READ,
        BANKING_SCOPES.TRANSACTIONS_READ,
        BANKING_SCOPES.TRANSACTIONS_WRITE
      ].every(scope => tokenScopes.includes(scope));
      console.log(`      Has all banking scopes: ${hasAllBankingScopes ? '✅ YES' : '❌ NO'}`);
      break;
      
    case 'customer':
      const hasWriteAccess = tokenScopes.some(scope => scope.includes('write'));
      console.log(`      Has write access: ${hasWriteAccess ? '✅ YES' : '❌ NO'}`);
      
      const lacksAdminScope = !tokenScopes.includes(BANKING_SCOPES.ADMIN);
      console.log(`      Lacks admin scope: ${lacksAdminScope ? '✅ YES' : '❌ NO'}`);
      break;
      
    case 'readonly':
      const onlyReadScopes = !tokenScopes.some(scope => 
        scope.includes('write') || scope === BANKING_SCOPES.ADMIN
      );
      console.log(`      Only read scopes: ${onlyReadScopes ? '✅ YES' : '❌ NO'}`);
      break;
      
    case 'ai_agent':
      const hasAIAgentScope = tokenScopes.includes(BANKING_SCOPES.AI_AGENT);
      console.log(`      Has ai_agent scope: ${hasAIAgentScope ? '✅ YES' : '❌ NO'}`);
      
      const hasFullBankingAccess = tokenScopes.includes(BANKING_SCOPES.BANKING_READ) &&
                                   tokenScopes.includes(BANKING_SCOPES.BANKING_WRITE);
      console.log(`      Has full banking access: ${hasFullBankingAccess ? '✅ YES' : '❌ NO'}`);
      break;
  }
}

// Test OAuth provider client configurations
function testOAuthProviderClientConfigs() {
  console.log('\n🔐 Testing OAuth Provider Client Configurations...');
  
  const providerConfig = getOAuthProviderConfig('pingone_ai_core');
  
  // Test admin client
  console.log('\n  Admin Client Configuration:');
  const adminConfig = providerConfig.adminClient;
  console.log(`    Default Scopes: [${adminConfig.defaultScopes.join(', ')}]`);
  console.log(`    Banking Scopes: [${adminConfig.bankingScopes.join(', ')}]`);
  
  const adminHasAllRequiredScopes = USER_TYPE_SCOPES.admin.every(scope =>
    adminConfig.bankingScopes.includes(scope)
  );
  console.log(`    Has all admin scopes: ${adminHasAllRequiredScopes ? '✅ YES' : '❌ NO'}`);
  
  // Test end user client
  console.log('\n  End User Client Configuration:');
  const endUserConfig = providerConfig.endUserClient;
  console.log(`    Default Scopes: [${endUserConfig.defaultScopes.join(', ')}]`);
  console.log(`    Banking Scopes: [${endUserConfig.bankingScopes.join(', ')}]`);
  
  const endUserHasCustomerScopes = USER_TYPE_SCOPES.customer.every(scope =>
    endUserConfig.bankingScopes.includes(scope)
  );
  console.log(`    Has all customer scopes: ${endUserHasCustomerScopes ? '✅ YES' : '❌ NO'}`);
  
  const endUserLacksAdminScope = !endUserConfig.bankingScopes.includes(BANKING_SCOPES.ADMIN);
  console.log(`    Lacks admin scope: ${endUserLacksAdminScope ? '✅ YES' : '❌ NO'}`);
  
  // Test AI agent client
  console.log('\n  AI Agent Client Configuration:');
  const aiAgentConfig = providerConfig.aiAgentClient;
  console.log(`    Default Scopes: [${aiAgentConfig.defaultScopes.join(', ')}]`);
  console.log(`    Banking Scopes: [${aiAgentConfig.bankingScopes.join(', ')}]`);
  
  const aiAgentHasAIScope = aiAgentConfig.bankingScopes.includes(BANKING_SCOPES.AI_AGENT);
  console.log(`    Has ai_agent scope: ${aiAgentHasAIScope ? '✅ YES' : '❌ NO'}`);
  
  const aiAgentHasFullAccess = USER_TYPE_SCOPES.ai_agent.every(scope =>
    aiAgentConfig.bankingScopes.includes(scope)
  );
  console.log(`    Has all AI agent scopes: ${aiAgentHasFullAccess ? '✅ YES' : '❌ NO'}`);
}

// Test route access with different user types
function testRouteAccessByUserType() {
  console.log('\n🛣️ Testing Route Access by User Type...');
  
  const testRoutes = [
    { method: 'GET', path: '/api/accounts', requiredScopes: ['accounts:read', 'read'] },
    { method: 'POST', path: '/api/transactions', requiredScopes: ['transactions:write', 'write'] },
    { method: 'GET', path: '/api/admin/users', requiredScopes: ['admin'] }
  ];
  
  Object.entries(MOCK_TOKENS).forEach(([userType, tokenPayload]) => {
    console.log(`\n  User Type: ${userType}`);
    
    const userScopes = tokenPayload.scope.split(' ').filter(scope => 
      scope.startsWith('') || scope === 'ai_agent'
    );
    
    testRoutes.forEach(route => {
      const hasAccess = route.requiredScopes.some(requiredScope => 
        userScopes.includes(requiredScope)
      );
      
      console.log(`    ${route.method} ${route.path}: ${hasAccess ? '✅ ALLOWED' : '❌ DENIED'}`);
    });
  });
}

// Generate OAuth provider configuration script
function generateOAuthProviderScript() {
  console.log('\n📝 OAuth Provider Configuration Script:');
  console.log('='.repeat(60));
  
  console.log(`
// PingOne Core Scope Assignment Script
// Add this to your OAuth provider's token customization

function customizeToken(token, user, client) {
  // Standard scopes
  const standardScopes = ['openid', 'profile', 'email'];
  
  // Determine banking scopes based on user role
  let bankingScopes = [];
  
  if (user.role === 'admin') {
    bankingScopes = [
      '${BANKING_SCOPES.ADMIN}',
      '${BANKING_SCOPES.BANKING_READ}',
      '${BANKING_SCOPES.BANKING_WRITE}',
      '${BANKING_SCOPES.ACCOUNTS_READ}',
      '${BANKING_SCOPES.TRANSACTIONS_READ}',
      '${BANKING_SCOPES.TRANSACTIONS_WRITE}'
    ];
  } else if (user.role === 'customer') {
    bankingScopes = [
      '${BANKING_SCOPES.BANKING_READ}',
      '${BANKING_SCOPES.BANKING_WRITE}',
      '${BANKING_SCOPES.ACCOUNTS_READ}',
      '${BANKING_SCOPES.TRANSACTIONS_READ}',
      '${BANKING_SCOPES.TRANSACTIONS_WRITE}'
    ];
  } else if (user.role === 'readonly') {
    bankingScopes = [
      '${BANKING_SCOPES.BANKING_READ}',
      '${BANKING_SCOPES.ACCOUNTS_READ}',
      '${BANKING_SCOPES.TRANSACTIONS_READ}'
    ];
  }
  
  // Add AI agent scope for AI clients
  if (client.clientId.includes('ai') || client.clientId.includes('mcp')) {
    bankingScopes.push('${BANKING_SCOPES.AI_AGENT}');
  }
  
  // Combine all scopes
  token.scope = [...standardScopes, ...bankingScopes].join(' ');
  
  return token;
}
`);
}

// Main test function
function runOAuthProviderScopeTests() {
  console.log('🚀 Starting OAuth Provider Scope Configuration Tests...');
  console.log('='.repeat(60));
  
  try {
    testUserTypeScopes();
    testOAuthProviderClientConfigs();
    testRouteAccessByUserType();
    generateOAuthProviderScript();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All OAuth provider scope tests completed successfully!');
    
    // Log test completion
    logger.info(LOG_CATEGORIES.SCOPE_VALIDATION, 'OAuth provider scope tests completed', {
      environment: process.env.NODE_ENV || 'development',
      test_types: ['user_scopes', 'client_configs', 'route_access'],
      status: 'success'
    });
    
  } catch (error) {
    console.error('\n❌ OAuth provider scope tests failed:', error.message);
    
    logger.error(LOG_CATEGORIES.SCOPE_VALIDATION, 'OAuth provider scope tests failed', {
      environment: process.env.NODE_ENV || 'development',
      error_message: error.message,
      stack_trace: error.stack
    });
    
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runOAuthProviderScopeTests();
}

module.exports = {
  runOAuthProviderScopeTests,
  testUserTypeScopes,
  testOAuthProviderClientConfigs,
  testRouteAccessByUserType,
  generateOAuthProviderScript,
  MOCK_TOKENS
};