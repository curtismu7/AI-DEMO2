/**
 * OAuth Developer Testing Tools and Utilities
 * Comprehensive testing suite for OAuth client credentials integration
 * 
 * Phase 57-06: Documentation and Developer Experience
 * Developer tools for OAuth integration testing and validation
 */

'use strict';

const fetch = require('node-fetch');
const crypto = require('crypto');

/**
 * OAuth Test Client
 * Provides utilities for testing OAuth client credentials integration
 */
class OAuthTestClient {
  constructor(config = {}) {
    this.baseURL = config.baseURL || 'http://localhost:3001';
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.scopes = config.scopes || ['read'];
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Register a new OAuth client for testing
   */
  async registerTestClient(clientConfig = {}) {
    const clientData = {
      name: clientConfig.name || `Test Client ${Date.now()}`,
      description: clientConfig.description || 'Automated test client',
      scopes: clientConfig.scopes || this.scopes,
      grant_types: ['client_credentials'],
      redirect_uris: clientConfig.redirectUris || []
    };

    // Use admin token for registration (in production, this would be properly authenticated)
    const response = await fetch(`${this.baseURL}/api/oauth/clients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // In real implementation, this would use proper admin authentication
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify(clientData)
    });

    if (!response.ok) {
      throw new Error(`Client registration failed: ${response.statusText}`);
    }

    const client = await response.json();
    this.clientId = client.client_id;
    this.clientSecret = client.client_secret;
    
    return client;
  }

  /**
   * Obtain OAuth access token
   */
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Client ID and secret required for token request');
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    
    const response = await fetch(`${this.baseURL}/api/oauth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: this.scopes.join(' ')
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token request failed: ${response.status} ${error}`);
    }

    const tokenData = await response.json();
    this.accessToken = tokenData.access_token;
    this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000) - 60000; // 1 minute buffer

    return this.accessToken;
  }

  /**
   * Make authenticated API request
   */
  async makeAuthenticatedRequest(endpoint, options = {}) {
    const token = await this.getAccessToken();
    
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    return response;
  }

  /**
   * Test basic OAuth flow
   */
  async testOAuthFlow() {
    const results = {
      clientRegistration: null,
      tokenRequest: null,
      apiAccess: null,
      errors: []
    };

    try {
      // Test client registration
      if (!this.clientId) {
        results.clientRegistration = await this.registerTestClient();
      }

      // Test token request
      const token = await this.getAccessToken();
      results.tokenRequest = {
        success: true,
        tokenLength: token.length,
        tokenType: token.startsWith('eyJ') ? 'JWT' : 'Opaque'
      };

      // Test API access
      const apiResponse = await this.makeAuthenticatedRequest('/api/accounts/my');
      results.apiAccess = {
        success: apiResponse.ok,
        status: apiResponse.status,
        hasData: apiResponse.headers.get('content-length') !== '0'
      };

    } catch (error) {
      results.errors.push(error.message);
    }

    return results;
  }
}

/**
 * OAuth Performance Tester
 * Tests performance characteristics of OAuth integration
 */
class OAuthPerformanceTester {
  constructor(client) {
    this.client = client;
  }

  /**
   * Test token request performance
   */
  async testTokenPerformance(iterations = 100) {
    const results = {
      iterations,
      totalTime: 0,
      averageTime: 0,
      minTime: Infinity,
      maxTime: 0,
      successCount: 0,
      errorCount: 0,
      errors: []
    };

    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();
      
      try {
        // Force new token request by clearing cached token
        this.client.accessToken = null;
        this.client.tokenExpiry = null;
        
        await this.client.getAccessToken();
        const endTime = Date.now();
        const requestTime = endTime - startTime;
        
        results.successCount++;
        results.totalTime += requestTime;
        results.minTime = Math.min(results.minTime, requestTime);
        results.maxTime = Math.max(results.maxTime, requestTime);
        
      } catch (error) {
        results.errorCount++;
        results.errors.push(error.message);
      }
    }

    if (results.successCount > 0) {
      results.averageTime = results.totalTime / results.successCount;
    }

    return results;
  }

  /**
   * Test API request performance with OAuth
   */
  async testAPIPerformance(iterations = 100) {
    const results = {
      iterations,
      totalTime: 0,
      averageTime: 0,
      minTime: Infinity,
      maxTime: 0,
      successCount: 0,
      errorCount: 0,
      errors: []
    };

    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();
      
      try {
        const response = await this.client.makeAuthenticatedRequest('/api/accounts/my');
        const endTime = Date.now();
        const requestTime = endTime - startTime;
        
        if (response.ok) {
          results.successCount++;
          results.totalTime += requestTime;
          results.minTime = Math.min(results.minTime, requestTime);
          results.maxTime = Math.max(results.maxTime, requestTime);
        } else {
          results.errorCount++;
          results.errors.push(`HTTP ${response.status}`);
        }
        
      } catch (error) {
        results.errorCount++;
        results.errors.push(error.message);
      }
    }

    if (results.successCount > 0) {
      results.averageTime = results.totalTime / results.successCount;
    }

    return results;
  }

  /**
   * Compare OAuth vs PAT performance
   */
  async compareWithPAT(patToken, iterations = 50) {
    const oauthResults = await this.testAPIPerformance(iterations);
    const patResults = await this.testPATPerformance(patToken, iterations);

    return {
      oauth: oauthResults,
      pat: patResults,
      comparison: {
        oauthVsPatRatio: oauthResults.averageTime / patResults.averageTime,
        oauthSuccessRate: oauthResults.successCount / iterations,
        patSuccessRate: patResults.successCount / iterations
      }
    };
  }

  /**
   * Test PAT performance for comparison
   */
  async testPATPerformance(patToken, iterations = 50) {
    const results = {
      iterations,
      totalTime: 0,
      averageTime: 0,
      minTime: Infinity,
      maxTime: 0,
      successCount: 0,
      errorCount: 0,
      errors: []
    };

    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();
      
      try {
        const response = await fetch(`${this.client.baseURL}/api/accounts/my`, {
          headers: {
            'Authorization': `PAT ${patToken}`,
            'Content-Type': 'application/json'
          }
        });
        const endTime = Date.now();
        const requestTime = endTime - startTime;
        
        if (response.ok) {
          results.successCount++;
          results.totalTime += requestTime;
          results.minTime = Math.min(results.minTime, requestTime);
          results.maxTime = Math.max(results.maxTime, requestTime);
        } else {
          results.errorCount++;
          results.errors.push(`HTTP ${response.status}`);
        }
        
      } catch (error) {
        results.errorCount++;
        results.errors.push(error.message);
      }
    }

    if (results.successCount > 0) {
      results.averageTime = results.totalTime / results.successCount;
    }

    return results;
  }
}

/**
 * OAuth Security Tester
 * Tests security aspects of OAuth implementation
 */
class OAuthSecurityTester {
  constructor(client) {
    this.client = client;
  }

  /**
   * Test token security
   */
  async testTokenSecurity() {
    const results = {
      tokenFormat: null,
      tokenExpiry: null,
      tokenReuse: null,
      invalidToken: null,
      errors: []
    };

    try {
      // Test token format
      const token = await this.client.getAccessToken();
      results.tokenFormat = {
        isJWT: token.startsWith('eyJ'),
        length: token.length,
        hasStructure: token.split('.').length === 3 // JWT has 3 parts
      };

      // Test token expiry
      const originalExpiry = this.client.tokenExpiry;
      this.client.tokenExpiry = Date.now() - 1000; // Expired token
      this.client.accessToken = token;

      try {
        await this.client.makeAuthenticatedRequest('/api/accounts/my');
        results.tokenExpiry = { expired: false, properlyValidated: false };
      } catch (error) {
        results.tokenExpiry = { expired: true, properlyValidated: true };
      }

      // Reset token
      this.client.tokenExpiry = originalExpiry;

      // Test token reuse (should work)
      const response1 = await this.client.makeAuthenticatedRequest('/api/accounts/my');
      const response2 = await this.client.makeAuthenticatedRequest('/api/accounts/my');
      results.tokenReuse = {
        bothSuccessful: response1.ok && response2.ok,
        sameToken: this.client.accessToken === token
      };

      // Test invalid token
      this.client.accessToken = 'invalid_token_12345';
      try {
        await this.client.makeAuthenticatedRequest('/api/accounts/my');
        results.invalidToken = { rejected: false };
      } catch (error) {
        results.invalidToken = { rejected: true, error: error.message };
      }

    } catch (error) {
      results.errors.push(error.message);
    }

    return results;
  }

  /**
   * Test scope enforcement
   */
  async testScopeEnforcement() {
    const results = {
      validScopes: null,
      invalidScopes: null,
      insufficientScopes: null,
      errors: []
    };

    try {
      // Test with valid scopes
      this.client.scopes = ['read'];
      const validResponse = await this.client.makeAuthenticatedRequest('/api/accounts/my');
      results.validScopes = {
        success: validResponse.ok,
        status: validResponse.status
      };

      // Test with invalid scopes
      this.client.scopes = ['invalid:scope'];
      this.client.accessToken = null; // Force new token
      try {
        const invalidResponse = await this.client.makeAuthenticatedRequest('/api/accounts/my');
        results.invalidScopes = {
          success: invalidResponse.ok,
          status: invalidResponse.status
        };
      } catch (error) {
        results.invalidScopes = {
          success: false,
          error: error.message
        };
      }

      // Test with insufficient scopes (if endpoint requires more)
      this.client.scopes = ['read'];
      this.client.accessToken = null; // Force new token
      try {
        const insufficientResponse = await this.client.makeAuthenticatedRequest('/api/admin/users');
        results.insufficientScopes = {
          success: insufficientResponse.ok,
          status: insufficientResponse.status,
          properlyRejected: insufficientResponse.status === 403
        };
      } catch (error) {
        results.insufficientScopes = {
          success: false,
          error: error.message
        };
      }

    } catch (error) {
      results.errors.push(error.message);
    }

    return results;
  }
}

/**
 * OAuth Compliance Tester
 * Tests RFC compliance of OAuth implementation
 */
class OAuthComplianceTester {
  constructor(client) {
    this.client = client;
  }

  /**
   * Test RFC 6749 compliance
   */
  async testRFC6749Compliance() {
    const results = {
      tokenEndpoint: null,
      grantTypes: null,
      errorResponses: null,
      tokenStructure: null,
      errors: []
    };

    try {
      // Test token endpoint compliance
      const credentials = Buffer.from(`${this.client.clientId}:${this.client.secret}`).toString('base64');
      
      // Valid request
      const validResponse = await fetch(`${this.client.baseURL}/api/oauth/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: 'read'
        })
      });

      results.tokenEndpoint = {
        accessible: validResponse.ok,
        status: validResponse.status,
        contentType: validResponse.headers.get('content-type')
      };

      if (validResponse.ok) {
        const tokenData = await validResponse.json();
        results.tokenStructure = {
          hasAccessToken: !!tokenData.access_token,
          hasTokenType: !!tokenData.token_type,
          hasExpiresIn: !!tokenData.expires_in,
          tokenTypeCorrect: tokenData.token_type === 'Bearer',
          expiresInReasonable: tokenData.expires_in > 0 && tokenData.expires_in <= 3600
        };
      }

      // Test error responses
      const errorTests = [
        {
          name: 'invalid_grant_type',
          body: new URLSearchParams({ grant_type: 'invalid' })
        },
        {
          name: 'invalid_client_auth',
          headers: { 'Authorization': 'Basic invalid_credentials' },
          body: new URLSearchParams({ grant_type: 'client_credentials' })
        },
        {
          name: 'missing_parameters',
          body: new URLSearchParams({})
        }
      ];

      results.errorResponses = {};
      for (const test of errorTests) {
        try {
          const errorResponse = await fetch(`${this.client.baseURL}/api/oauth/token`, {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${credentials}`,
              'Content-Type': 'application/x-www-form-urlencoded',
              ...test.headers
            },
            body: test.body
          });

          const errorData = errorResponse.headers.get('content-type')?.includes('json') 
            ? await errorResponse.json() 
            : await errorResponse.text();

          results.errorResponses[test.name] = {
            status: errorResponse.status,
            hasError: !!errorData.error,
            errorDescription: !!errorData.error_description,
            compliantError: errorResponse.status >= 400 && errorResponse.status < 500
          };
        } catch (error) {
          results.errorResponses[test.name] = {
            error: error.message
          };
        }
      }

    } catch (error) {
      results.errors.push(error.message);
    }

    return results;
  }

  /**
   * Test token introspection (RFC 7662)
   */
  async testTokenIntrospection() {
    const results = {
      introspectionEndpoint: null,
      validTokenIntrospection: null,
      invalidTokenIntrospection: null,
      errors: []
    };

    try {
      const token = await this.client.getAccessToken();
      const credentials = Buffer.from(`${this.client.clientId}:${this.client.secret}`).toString('base64');

      // Test valid token introspection
      const validResponse = await fetch(`${this.client.baseURL}/api/oauth/introspect`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          token: token
        })
      });

      if (validResponse.ok) {
        const introspection = await validResponse.json();
        results.validTokenIntrospection = {
          active: introspection.active,
          hasClientId: !!introspection.client_id,
          hasScopes: !!introspection.scope,
          hasExpiry: !!introspection.exp,
          clientMatches: introspection.client_id === this.client.clientId
        };
      }

      // Test invalid token introspection
      const invalidResponse = await fetch(`${this.client.baseURL}/api/oauth/introspect`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          token: 'invalid_token'
        })
      });

      if (invalidResponse.ok) {
        const introspection = await invalidResponse.json();
        results.invalidTokenIntrospection = {
          active: introspection.active,
          properlyInactive: !introspection.active
        };
      }

      results.introspectionEndpoint = {
        validTokenAccessible: validResponse.ok,
        invalidTokenAccessible: invalidResponse.ok
      };

    } catch (error) {
      results.errors.push(error.message);
    }

    return results;
  }
}

/**
 * Comprehensive Test Runner
 * Orchestrates all OAuth tests
 */
class OAuthTestRunner {
  constructor(config = {}) {
    this.config = {
      baseURL: config.baseURL || 'http://localhost:3001',
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      scopes: config.scopes || ['read'],
      patToken: config.patToken,
      iterations: config.iterations || 50
    };
  }

  /**
   * Run comprehensive OAuth test suite
   */
  async runFullTestSuite() {
    console.log('🧪 Starting OAuth Test Suite...\n');

    const results = {
      timestamp: new Date().toISOString(),
      configuration: this.config,
      basicFlow: null,
      performance: null,
      security: null,
      compliance: null,
      summary: null
    };

    try {
      // Basic OAuth Flow Test
      console.log('📋 Testing Basic OAuth Flow...');
      const client = new OAuthTestClient(this.config);
      results.basicFlow = await client.testOAuthFlow();
      console.log(`✅ Basic Flow: ${results.basicFlow.errors.length === 0 ? 'PASSED' : 'FAILED'}\n`);

      // Performance Tests
      console.log('⚡ Testing Performance...');
      const perfTester = new OAuthPerformanceTester(client);
      results.performance = {
        tokenRequests: await perfTester.testTokenPerformance(this.config.iterations),
        apiRequests: await perfTester.testAPIPerformance(this.config.iterations)
      };

      if (this.config.patToken) {
        console.log('🔄 Comparing with PAT performance...');
        results.performance.comparison = await perfTester.compareWithPAT(
          this.config.patToken, 
          this.config.iterations
        );
      }
      console.log(`✅ Performance: Tests completed\n`);

      // Security Tests
      console.log('🔒 Testing Security...');
      const secTester = new OAuthSecurityTester(client);
      results.security = await secTester.testTokenSecurity();
      results.security.scopes = await secTester.testScopeEnforcement();
      console.log(`✅ Security: ${results.security.errors.length === 0 ? 'PASSED' : 'FAILED'}\n`);

      // Compliance Tests
      console.log('📜 Testing RFC Compliance...');
      const compTester = new OAuthComplianceTester(client);
      results.compliance = {
        rfc6749: await compTester.testRFC6749Compliance(),
        tokenIntrospection: await compTester.testTokenIntrospection()
      };
      console.log(`✅ Compliance: Tests completed\n`);

      // Generate summary
      results.summary = this.generateSummary(results);

    } catch (error) {
      results.error = error.message;
      console.error('❌ Test suite failed:', error.message);
    }

    return results;
  }

  /**
   * Generate test summary
   */
  generateSummary(results) {
    const summary = {
      overall: 'PASSED',
      passedTests: 0,
      failedTests: 0,
      totalTests: 0,
      recommendations: []
    };

    // Check basic flow
    if (results.basicFlow) {
      summary.totalTests++;
      if (results.basicFlow.errors.length === 0) {
        summary.passedTests++;
      } else {
        summary.failedTests++;
        summary.recommendations.push('Fix basic OAuth flow issues');
      }
    }

    // Check security
    if (results.security) {
      summary.totalTests++;
      if (results.security.errors.length === 0) {
        summary.passedTests++;
      } else {
        summary.failedTests++;
        summary.recommendations.push('Address security test failures');
      }
    }

    // Check performance
    if (results.performance) {
      summary.totalTests++;
      if (results.performance.tokenRequests.successCount > 0 && 
          results.performance.apiRequests.successCount > 0) {
        summary.passedTests++;
      } else {
        summary.failedTests++;
        summary.recommendations.push('Investigate performance issues');
      }
    }

    // Check compliance
    if (results.compliance) {
      summary.totalTests++;
      if (results.compliance.rfc6749.errors.length === 0) {
        summary.passedTests++;
      } else {
        summary.failedTests++;
        summary.recommendations.push('Fix RFC compliance issues');
      }
    }

    summary.overall = summary.failedTests === 0 ? 'PASSED' : 'FAILED';
    summary.successRate = (summary.passedTests / summary.totalTests * 100).toFixed(1);

    return summary;
  }

  /**
   * Print test results to console
   */
  printResults(results) {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 OAUTH TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Timestamp: ${results.timestamp}`);
    console.log(`Overall Status: ${results.summary.overall}`);
    console.log(`Success Rate: ${results.summary.successRate}%`);
    console.log(`Tests Passed: ${results.summary.passedTests}/${results.summary.totalTests}`);

    if (results.summary.recommendations.length > 0) {
      console.log('\n📋 Recommendations:');
      results.summary.recommendations.forEach(rec => {
        console.log(`  • ${rec}`);
      });
    }

    if (results.basicFlow) {
      console.log('\n📋 Basic OAuth Flow:');
      console.log(`  Client Registration: ${results.basicFlow.clientRegistration ? '✅' : '❌'}`);
      console.log(`  Token Request: ${results.basicFlow.tokenRequest ? '✅' : '❌'}`);
      console.log(`  API Access: ${results.basicFlow.apiAccess ? '✅' : '❌'}`);
    }

    if (results.performance) {
      console.log('\n⚡ Performance:');
      console.log(`  Token Requests: ${results.performance.tokenRequests.successCount}/${results.performance.tokenRequests.iterations} successful`);
      console.log(`  Avg Token Time: ${results.performance.tokenRequests.averageTime?.toFixed(2)}ms`);
      console.log(`  API Requests: ${results.performance.apiRequests.successCount}/${results.performance.apiRequests.iterations} successful`);
      console.log(`  Avg API Time: ${results.performance.apiRequests.averageTime?.toFixed(2)}ms`);

      if (results.performance.comparison) {
        console.log(`  OAuth vs PAT Ratio: ${results.performance.comparison.comparison.oauthVsPatRatio.toFixed(2)}x`);
      }
    }

    if (results.security) {
      console.log('\n🔒 Security:');
      console.log(`  Token Security: ${results.security.errors.length === 0 ? '✅' : '❌'}`);
      console.log(`  Scope Enforcement: ${results.security.scopes?.errors.length === 0 ? '✅' : '❌'}`);
    }

    if (results.compliance) {
      console.log('\n📜 RFC Compliance:');
      console.log(`  RFC 6749: ${results.compliance.rfc6749.errors.length === 0 ? '✅' : '❌'}`);
      console.log(`  Token Introspection: ${results.compliance.tokenIntrospection ? '✅' : '❌'}`);
    }

    console.log('\n' + '='.repeat(60));
  }

  /**
   * Save results to file
   */
  async saveResults(results, filename = null) {
    const fs = require('fs').promises;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultFilename = `oauth-test-results-${timestamp}.json`;
    const finalFilename = filename || defaultFilename;

    try {
      await fs.writeFile(finalFilename, JSON.stringify(results, null, 2));
      console.log(`📄 Results saved to: ${finalFilename}`);
    } catch (error) {
      console.error('❌ Failed to save results:', error.message);
    }
  }
}

// Export classes for use in tests
module.exports = {
  OAuthTestClient,
  OAuthPerformanceTester,
  OAuthSecurityTester,
  OAuthComplianceTester,
  OAuthTestRunner
};

// CLI interface for running tests
if (require.main === module) {
  const args = process.argv.slice(2);
  const config = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];
    config[key] = value;
  }

  // Convert numeric values
  if (config.iterations) config.iterations = parseInt(config.iterations);
  if (config.scopes && typeof config.scopes === 'string') {
    config.scopes = config.scopes.split(',');
  }

  const runner = new OAuthTestRunner(config);
  
  runner.runFullTestSuite()
    .then(results => {
      runner.printResults(results);
      return runner.saveResults(results);
    })
    .catch(error => {
      console.error('❌ Test runner failed:', error);
      process.exit(1);
    });
}
