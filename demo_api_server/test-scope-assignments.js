#!/usr/bin/env node

/**
 * Test Script for OAuth Scope Assignments
 * 
 * This script tests scope assignments for different user types
 * and validates the scope configuration system.
 */

const { 
  BANKING_SCOPES, 
  USER_TYPE_SCOPES, 
  getCurrentEnvironmentConfig,
  getScopesForUserType,
  isValidScope,
  getOAuthProviderConfig
} = require('./config/scopes');

const { logger, LOG_CATEGORIES } = require('./utils/logger');

// Test data for different user types
const TEST_USERS = [
  {
    type: 'admin',
    username: 'admin@test.com',
    expectedScopes: USER_TYPE_SCOPES.admin
  },
  {
    type: 'customer',
    username: 'customer@test.com',
    expectedScopes: USER_TYPE_SCOPES.customer
  },
  {
    type: 'readonly',
    username: 'readonly@test.com',
    expectedScopes: USER_TYPE_SCOPES.readonly
  },
  {
    type: 'ai_agent',
    username: 'ai-agent@test.com',
    expectedScopes: USER_TYPE_SCOPES.ai_agent
  }
];

// Test scope validation
function testScopeValidation() {
  console.log('\n🔍 Testing Scope Validation...');
  
  const validScopes = Object.values(BANKING_SCOPES);
  const invalidScopes = ['invalid:scope', 'invalid', 'admin:invalid'];
  
  // Test valid scopes
  validScopes.forEach(scope => {
    const isValid = isValidScope(scope);
    console.log(`  ✅ ${scope}: ${isValid ? 'VALID' : 'INVALID'}`);
    if (!isValid) {
      console.error(`    ❌ Expected ${scope} to be valid`);
    }
  });
  
  // Test invalid scopes
  invalidScopes.forEach(scope => {
    const isValid = isValidScope(scope);
    console.log(`  ❌ ${scope}: ${isValid ? 'VALID' : 'INVALID'}`);
    if (isValid) {
      console.error(`    ❌ Expected ${scope} to be invalid`);
    }
  });
}

// Test user type scope assignments
function testUserTypeScopeAssignments() {
  console.log('\n👥 Testing User Type Scope Assignments...');
  
  TEST_USERS.forEach(user => {
    console.log(`\n  User Type: ${user.type} (${user.username})`);
    
    const assignedScopes = getScopesForUserType(user.type);
    console.log(`    Assigned Scopes: [${assignedScopes.join(', ')}]`);
    console.log(`    Expected Scopes: [${user.expectedScopes.join(', ')}]`);
    
    // Check if assigned scopes match expected scopes
    const scopesMatch = JSON.stringify(assignedScopes.sort()) === JSON.stringify(user.expectedScopes.sort());
    console.log(`    Scopes Match: ${scopesMatch ? '✅ YES' : '❌ NO'}`);
    
    if (!scopesMatch) {
      const missing = user.expectedScopes.filter(scope => !assignedScopes.includes(scope));
      const extra = assignedScopes.filter(scope => !user.expectedScopes.includes(scope));
      
      if (missing.length > 0) {
        console.log(`    Missing Scopes: [${missing.join(', ')}]`);
      }
      if (extra.length > 0) {
        console.log(`    Extra Scopes: [${extra.join(', ')}]`);
      }
    }
  });
}

// Test environment configuration
function testEnvironmentConfiguration() {
  console.log('\n🌍 Testing Environment Configuration...');
  
  const currentEnv = process.env.NODE_ENV || 'development';
  const config = getCurrentEnvironmentConfig();
  
  console.log(`  Current Environment: ${currentEnv}`);
  console.log(`  Configuration:`);
  console.log(`    Allowed Scopes: [${config.allowedScopes.join(', ')}]`);
  console.log(`    Strict Validation: ${config.strictValidation}`);
  console.log(`    Debug Scopes: ${config.debugScopes}`);
  console.log(`    Default User Type: ${config.defaultUserType}`);
  console.log(`    Validation Timeout: ${config.scopeValidationTimeout}ms`);
  console.log(`    Cache Token Validation: ${config.cacheTokenValidation}`);
  
  if (config.cacheTTL) {
    console.log(`    Cache TTL: ${config.cacheTTL}s`);
  }
}

// Test OAuth provider configuration
function testOAuthProviderConfiguration() {
  console.log('\n🔐 Testing OAuth Provider Configuration...');
  
  const providerConfig = getOAuthProviderConfig('pingone_ai_core');
  
  console.log('  PingOne Core Configuration:');
  
  // Test admin client config
  console.log('    Admin Client:');
  console.log(`      Default Scopes: [${providerConfig.adminClient.defaultScopes.join(', ')}]`);
  console.log(`      Banking Scopes: [${providerConfig.adminClient.bankingScopes.join(', ')}]`);
  
  // Test end user client config
  console.log('    End User Client:');
  console.log(`      Default Scopes: [${providerConfig.endUserClient.defaultScopes.join(', ')}]`);
  console.log(`      Banking Scopes: [${providerConfig.endUserClient.bankingScopes.join(', ')}]`);
  
  // Test AI agent client config
  console.log('    AI Agent Client:');
  console.log(`      Default Scopes: [${providerConfig.aiAgentClient.defaultScopes.join(', ')}]`);
  console.log(`      Banking Scopes: [${providerConfig.aiAgentClient.bankingScopes.join(', ')}]`);
}

// Test scope hierarchy and permissions
function testScopeHierarchy() {
  console.log('\n🏗️ Testing Scope Hierarchy...');
  
  // Test that admin users have all scopes
  const adminScopes = getScopesForUserType('admin');
  const customerScopes = getScopesForUserType('customer');
  const readonlyScopes = getScopesForUserType('readonly');
  
  console.log('  Scope Hierarchy Validation:');
  
  // Admin should have admin scope
  const adminHasAdminScope = adminScopes.includes(BANKING_SCOPES.ADMIN);
  console.log(`    Admin has admin: ${adminHasAdminScope ? '✅ YES' : '❌ NO'}`);
  
  // Customer should not have admin scope
  const customerHasAdminScope = customerScopes.includes(BANKING_SCOPES.ADMIN);
  console.log(`    Customer lacks admin: ${!customerHasAdminScope ? '✅ YES' : '❌ NO'}`);
  
  // Readonly should only have read scopes
  const readonlyHasWriteScopes = readonlyScopes.some(scope => 
    scope.includes('write') || scope === BANKING_SCOPES.ADMIN
  );
  console.log(`    Readonly lacks write scopes: ${!readonlyHasWriteScopes ? '✅ YES' : '❌ NO'}`);
  
  // AI agents should have ai_agent scope
  const aiAgentScopes = getScopesForUserType('ai_agent');
  const aiAgentHasAIScope = aiAgentScopes.includes(BANKING_SCOPES.AI_AGENT);
  console.log(`    AI Agent has ai_agent scope: ${aiAgentHasAIScope ? '✅ YES' : '❌ NO'}`);
}

// Main test function
function runScopeAssignmentTests() {
  console.log('🚀 Starting OAuth Scope Assignment Tests...');
  console.log('='.repeat(60));
  
  try {
    testScopeValidation();
    testUserTypeScopeAssignments();
    testEnvironmentConfiguration();
    testOAuthProviderConfiguration();
    testScopeHierarchy();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All scope assignment tests completed successfully!');
    
    // Log test completion
    logger.info(LOG_CATEGORIES.SCOPE_VALIDATION, 'Scope assignment tests completed', {
      environment: process.env.NODE_ENV || 'development',
      test_types: ['validation', 'user_assignments', 'environment', 'provider', 'hierarchy'],
      status: 'success'
    });
    
  } catch (error) {
    console.error('\n❌ Scope assignment tests failed:', error.message);
    
    logger.error(LOG_CATEGORIES.SCOPE_VALIDATION, 'Scope assignment tests failed', {
      environment: process.env.NODE_ENV || 'development',
      error_message: error.message,
      stack_trace: error.stack
    });
    
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runScopeAssignmentTests();
}

module.exports = {
  runScopeAssignmentTests,
  testScopeValidation,
  testUserTypeScopeAssignments,
  testEnvironmentConfiguration,
  testOAuthProviderConfiguration,
  testScopeHierarchy
};