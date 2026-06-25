# PAT to OAuth Migration Guide

## Overview

This guide helps you migrate from Personal Access Tokens (PATs) to OAuth 2.0 client credentials. This migration enhances security, provides better control, and prepares your integration for future features.

## Migration Timeline

### Phase 1: Preparation (Current - 30 days)
- OAuth infrastructure available
- PATs fully supported
- Migration tools and documentation available
- **Action**: Register OAuth clients and test integration

### Phase 2: Transition (30-60 days)
- Both PATs and OAuth supported
- Deprecation warnings issued for PAT usage
- Migration dashboard available
- **Action**: Begin migrating production integrations

### Phase 3: Deprecation (60-90 days)
- PATs deprecated with clear warnings
- OAuth enforcement active
- PAT rejections begin
- **Action**: Complete migration before enforcement

### Phase 4: Sunset (90+ days)
- PATs no longer supported
- OAuth-only authentication
- Legacy PATs revoked
- **Action**: Ensure all integrations use OAuth

## Step-by-Step Migration

### Step 1: Assess Current PAT Usage

#### Inventory Your PATs
```javascript
// Check which endpoints your PATs are accessing
const auditPATUsage = async (patToken) => {
  const endpoints = [
    '/api/accounts/my',
    '/api/transactions',
    '/api/accounts/my/balance'
  ];
  
  const results = {};
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          'Authorization': `PAT ${patToken}`
        }
      });
      
      results[endpoint] = {
        accessible: response.ok,
        status: response.status,
        scopes_required: response.headers.get('x-required-scopes')
      };
    } catch (error) {
      results[endpoint] = {
        accessible: false,
        error: error.message
      };
    }
  }
  
  return results;
};

// Usage
const patAudit = await auditPATUsage('your_pat_token_here');
console.log('PAT Usage Audit:', patAudit);
```

#### Determine Required Scopes
Based on your PAT usage, determine the OAuth scopes needed:

| PAT Usage | Required OAuth Scopes |
|-----------|---------------------|
| Reading accounts | `banking:read` |
| Creating transactions | `banking:write` |
| Admin operations | `admin:read`, `admin:write` |
| AI agent access | `ai_agent`, `banking:agent:invoke` |

### Step 2: Register OAuth Client

#### Create Client Registration
```javascript
const registerOAuthClient = async (patToken, clientConfig) => {
  const response = await fetch('/api/oauth/clients', {
    method: 'POST',
    headers: {
      'Authorization': `PAT ${patToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: clientConfig.name,
      description: clientConfig.description,
      scopes: clientConfig.scopes,
      redirect_uris: clientConfig.redirectUris || [],
      grant_types: ['client_credentials']
    })
  });
  
  if (!response.ok) {
    throw new Error(`Client registration failed: ${response.statusText}`);
  }
  
  return await response.json();
};

// Example registration
const clientConfig = {
  name: 'My Banking Integration',
  description: 'Migrated from PAT integration',
  scopes: ['banking:read', 'banking:write']
};

const oauthClient = await registerOAuthClient('your_pat_token', clientConfig);
console.log('OAuth Client Registered:', oauthClient.client_id);
```

#### Store Client Credentials Securely
```javascript
// Environment variables (recommended)
process.env.OAUTH_CLIENT_ID = oauthClient.client_id;
process.env.OAUTH_CLIENT_SECRET = oauthClient.client_secret;

// Or use a secret manager
const secretManager = require('./secretManager');
await secretManager.store('oauth_client_id', oauthClient.client_id);
await secretManager.store('oauth_client_secret', oauthClient.client_secret);
```

### Step 3: Update Authentication Code

#### Before (PAT-based)
```javascript
// Old PAT authentication
const makeAPIRequest = async (endpoint, options = {}) => {
  const patToken = process.env.BANKING_PAT_TOKEN;
  
  return fetch(endpoint, {
    ...options,
    headers: {
      'Authorization': `PAT ${patToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
};
```

#### After (OAuth-based)
```javascript
// New OAuth authentication
class OAuthTokenManager {
  constructor(clientId, clientSecret, scopes) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.scopes = scopes;
    this.currentToken = null;
    this.tokenExpiry = null;
  }
  
  async getAccessToken() {
    // Return cached token if still valid
    if (this.currentToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.currentToken;
    }
    
    // Request new token
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    
    const response = await fetch('/api/oauth/token', {
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
      throw new Error(`Token request failed: ${response.statusText}`);
    }
    
    const tokenData = await response.json();
    this.currentToken = tokenData.access_token;
    this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000) - 60000; // 1 minute buffer
    
    return this.currentToken;
  }
}

const tokenManager = new OAuthTokenManager(
  process.env.OAUTH_CLIENT_ID,
  process.env.OAUTH_CLIENT_SECRET,
  ['banking:read', 'banking:write']
);

const makeAPIRequest = async (endpoint, options = {}) => {
  const accessToken = await tokenManager.getAccessToken();
  
  return fetch(endpoint, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
};
```

### Step 4: Test OAuth Integration

#### Create Test Suite
```javascript
// migration.test.js
describe('PAT to OAuth Migration', () => {
  const patToken = process.env.TEST_PAT_TOKEN;
  const oauthClient = {
    clientId: process.env.TEST_OAUTH_CLIENT_ID,
    clientSecret: process.env.TEST_OAUTH_CLIENT_SECRET,
    scopes: ['banking:read', 'banking:write']
  };
  
  test('PAT access works', async () => {
    const response = await fetch('/api/accounts/my', {
      headers: { 'Authorization': `PAT ${patToken}` }
    });
    
    expect(response.ok).toBe(true);
    const accounts = await response.json();
    expect(accounts).toHaveProperty('accounts');
  });
  
  test('OAuth access works', async () => {
    const tokenManager = new OAuthTokenManager(
      oauthClient.clientId,
      oauthClient.clientSecret,
      oauthClient.scopes
    );
    
    const accessToken = await tokenManager.getAccessToken();
    const response = await fetch('/api/accounts/my', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    expect(response.ok).toBe(true);
    const accounts = await response.json();
    expect(accounts).toHaveProperty('accounts');
  });
  
  test('OAuth and PAT return same data', async () => {
    // PAT request
    const patResponse = await fetch('/api/accounts/my', {
      headers: { 'Authorization': `PAT ${patToken}` }
    });
    const patData = await patResponse.json();
    
    // OAuth request
    const tokenManager = new OAuthTokenManager(
      oauthClient.clientId,
      oauthClient.clientSecret,
      oauthClient.scopes
    );
    const accessToken = await tokenManager.getAccessToken();
    const oauthResponse = await fetch('/api/accounts/my', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const oauthData = await oauthResponse.json();
    
    // Compare results (excluding timestamps)
    expect(patData.accounts).toEqual(oauthData.accounts);
  });
});
```

#### Load Testing
```javascript
// load-test.js
const { performance } = require('perf_hooks');

const testPerformance = async (authMethod, iterations = 100) => {
  const results = {
    method: authMethod,
    iterations,
    totalTime: 0,
    successCount: 0,
    errorCount: 0,
    errors: []
  };
  
  const startTime = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    try {
      const response = await fetch('/api/accounts/my', {
        headers: authMethod === 'pat' 
          ? { 'Authorization': `PAT ${process.env.TEST_PAT_TOKEN}` }
          : { 'Authorization': `Bearer ${await getOAuthToken()}` }
      });
      
      if (response.ok) {
        results.successCount++;
      } else {
        results.errorCount++;
        results.errors.push(`HTTP ${response.status}`);
      }
    } catch (error) {
      results.errorCount++;
      results.errors.push(error.message);
    }
  }
  
  results.totalTime = performance.now() - startTime;
  results.averageTime = results.totalTime / iterations;
  
  return results;
};

// Compare performance
const patResults = await testPerformance('pat');
const oauthResults = await testPerformance('oauth');

console.log('PAT Performance:', patResults);
console.log('OAuth Performance:', oauthResults);
```

### Step 5: Deploy OAuth Integration

#### Gradual Rollout Strategy
```javascript
// feature-flag.js
class MigrationFeatureFlag {
  constructor() {
    this.useOAuth = process.env.USE_OAUTH === 'true';
    this.oauthClient = this.useOAuth ? {
      clientId: process.env.OAUTH_CLIENT_ID,
      clientSecret: process.env.OAUTH_CLIENT_SECRET,
      scopes: ['banking:read', 'banking:write']
    } : null;
    this.patToken = this.useOAuth ? null : process.env.BANKING_PAT_TOKEN;
  }
  
  async makeRequest(endpoint, options = {}) {
    if (this.useOAuth && this.oauthClient) {
      return this.makeOAuthRequest(endpoint, options);
    } else if (this.patToken) {
      return this.makePATRequest(endpoint, options);
    } else {
      throw new Error('No authentication method configured');
    }
  }
  
  async makeOAuthRequest(endpoint, options = {}) {
    const tokenManager = new OAuthTokenManager(
      this.oauthClient.clientId,
      this.oauthClient.clientSecret,
      this.oauthClient.scopes
    );
    
    const accessToken = await tokenManager.getAccessToken();
    
    return fetch(endpoint, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
  }
  
  async makePATRequest(endpoint, options = {}) {
    return fetch(endpoint, {
      ...options,
      headers: {
        'Authorization': `PAT ${this.patToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
  }
}

// Usage
const api = new MigrationFeatureFlag();

// Can switch between PAT and OAuth via environment variable
const accounts = await api.makeRequest('/api/accounts/my');
```

#### Monitoring Migration Progress
```javascript
// migration-monitor.js
class MigrationMonitor {
  constructor() {
    this.metrics = {
      patRequests: 0,
      oauthRequests: 0,
      patErrors: 0,
      oauthErrors: 0,
      migrationProgress: 0
    };
  }
  
  trackRequest(authMethod, success, error = null) {
    if (authMethod === 'pat') {
      this.metrics.patRequests++;
      if (!success) this.metrics.patErrors++;
    } else if (authMethod === 'oauth') {
      this.metrics.oauthRequests++;
      if (!success) this.metrics.oauthErrors++;
    }
    
    this.updateProgress();
  }
  
  updateProgress() {
    const totalRequests = this.metrics.patRequests + this.metrics.oauthRequests;
    if (totalRequests > 0) {
      this.metrics.migrationProgress = (this.metrics.oauthRequests / totalRequests) * 100;
    }
  }
  
  getReport() {
    return {
      ...this.metrics,
      recommendation: this.getRecommendation()
    };
  }
  
  getRecommendation() {
    if (this.metrics.migrationProgress < 25) {
      return 'Begin OAuth migration - low adoption rate';
    } else if (this.metrics.migrationProgress < 75) {
      return 'Continue OAuth migration - moderate adoption rate';
    } else if (this.metrics.migrationProgress < 95) {
      return 'Complete OAuth migration - high adoption rate';
    } else {
      return 'Migration complete - disable PAT usage';
    }
  }
}

// Integration with API client
const monitor = new MigrationMonitor();

const makeTrackedRequest = async (endpoint, authMethod, options = {}) => {
  const startTime = Date.now();
  let success = false;
  let error = null;
  
  try {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'Authorization': authMethod === 'oauth' 
          ? `Bearer ${await getOAuthToken()}`
          : `PAT ${process.env.BANKING_PAT_TOKEN}`,
        ...options.headers
      }
    });
    
    success = response.ok;
    if (!success) {
      error = `HTTP ${response.status}`;
    }
    
    return response;
  } catch (err) {
    error = err.message;
    throw err;
  } finally {
    monitor.trackRequest(authMethod, success, error);
    
    // Log migration metrics
    console.log(`Migration Progress: ${monitor.metrics.migrationProgress.toFixed(1)}%`);
  }
};
```

### Step 6: Complete Migration

#### Final Checklist
- [ ] All integrations tested with OAuth
- [ ] PAT usage below 5% of total requests
- [ ] Error rates comparable between PAT and OAuth
- [ ] Performance acceptable with OAuth
- [ ] Monitoring and alerting configured
- [ ] Documentation updated
- [ ] Team trained on OAuth workflow

#### Disable PAT Usage
```javascript
// final-migration.js
const completeMigration = async () => {
  // Verify OAuth is working
  const oauthTest = await fetch('/api/accounts/my', {
    headers: { 'Authorization': `Bearer ${await getOAuthToken()}` }
  });
  
  if (!oauthTest.ok) {
    throw new Error('OAuth integration not working properly');
  }
  
  // Revoke PATs
  const patTokens = await getActivePATs();
  for (const pat of patTokens) {
    await revokePAT(pat.id);
    console.log(`Revoked PAT: ${pat.name}`);
  }
  
  // Update configuration
  process.env.USE_OAUTH = 'true';
  delete process.env.BANKING_PAT_TOKEN;
  
  console.log('Migration completed successfully!');
};

// Run when migration progress > 95%
const monitor = new MigrationMonitor();
if (monitor.metrics.migrationProgress > 95) {
  await completeMigration();
}
```

## Troubleshooting Migration Issues

### Common Migration Problems

#### OAuth Token Request Fails
```javascript
// Debug token request
const debugTokenRequest = async () => {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  console.log('Client ID:', clientId);
  console.log('Scopes:', scopes.join(' '));
  console.log('Credentials (first 10 chars):', credentials.substring(0, 10) + '...');
  
  const response = await fetch('/api/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: scopes.join(' ')
    })
  });
  
  console.log('Response status:', response.status);
  console.log('Response headers:', Object.fromEntries(response.headers));
  
  const text = await response.text();
  console.log('Response body:', text);
  
  return response;
};
```

#### Scope Mismatch
```javascript
// Compare PAT permissions with OAuth scopes
const comparePermissions = async (patToken, oauthScopes) => {
  // Test PAT access
  const patResponse = await fetch('/api/accounts/my', {
    headers: { 'Authorization': `PAT ${patToken}` }
  });
  
  // Test OAuth access
  const tokenManager = new OAuthTokenManager(clientId, clientSecret, oauthScopes);
  const accessToken = await tokenManager.getAccessToken();
  const oauthResponse = await fetch('/api/accounts/my', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  const comparison = {
    patAccessible: patResponse.ok,
    oauthAccessible: oauthResponse.ok,
    patStatus: patResponse.status,
    oauthStatus: oauthResponse.status,
    missingScopes: []
  };
  
  if (patResponse.ok && !oauthResponse.ok) {
    // PAT works but OAuth doesn't - likely missing scopes
    const requiredScopes = oauthResponse.headers.get('x-required-scopes');
    if (requiredScopes) {
      comparison.missingScopes = requiredScopes.split(', ');
    }
  }
  
  return comparison;
};
```

#### Performance Issues
```javascript
// Compare PAT vs OAuth performance
const performanceComparison = async () => {
  const iterations = 50;
  
  // PAT performance
  const patStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    await fetch('/api/accounts/my', {
      headers: { 'Authorization': `PAT ${process.env.TEST_PAT_TOKEN}` }
    });
  }
  const patTime = Date.now() - patStart;
  
  // OAuth performance
  const tokenManager = new OAuthTokenManager(clientId, clientSecret, scopes);
  const oauthStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    await fetch('/api/accounts/my', {
      headers: { 'Authorization': `Bearer ${await tokenManager.getAccessToken()}` }
    });
  }
  const oauthTime = Date.now() - oauthStart;
  
  console.log(`PAT average: ${(patTime / iterations).toFixed(2)}ms per request`);
  console.log(`OAuth average: ${(oauthTime / iterations).toFixed(2)}ms per request`);
  console.log(`Performance ratio: ${(oauthTime / patTime).toFixed(2)}x`);
};
```

## Migration Tools and Utilities

### Migration Dashboard
```javascript
// dashboard.js
const getMigrationDashboard = async () => {
  const response = await fetch('/api/migration/dashboard');
  return await response.json();
};

const displayDashboard = async () => {
  const dashboard = await getMigrationDashboard();
  
  console.log('=== Migration Dashboard ===');
  console.log(`Progress: ${dashboard.summary.migration_progress_percentage}%`);
  console.log(`Total Integrations: ${dashboard.summary.total_integrations}`);
  console.log(`OAuth Migrated: ${dashboard.summary.oauth_migrated}`);
  console.log(`PAT Remaining: ${dashboard.summary.pat_remaining}`);
  console.log(`PAT Warnings: ${dashboard.summary.pat_warnings_issued}`);
  console.log(`PAT Rejections: ${dashboard.summary.pat_rejections}`);
  
  if (dashboard.recommendations.length > 0) {
    console.log('\nRecommendations:');
    dashboard.recommendations.forEach(rec => {
      console.log(`- [${rec.priority.toUpperCase()}] ${rec.action}`);
      console.log(`  ${rec.description}`);
    });
  }
};
```

### Automated Migration Script
```javascript
// migrate.js
const automatedMigration = async (patToken, clientConfig) => {
  console.log('Starting automated migration...');
  
  try {
    // Step 1: Register OAuth client
    console.log('Registering OAuth client...');
    const oauthClient = await registerOAuthClient(patToken, clientConfig);
    console.log(`Client registered: ${oauthClient.client_id}`);
    
    // Step 2: Test OAuth access
    console.log('Testing OAuth access...');
    const tokenManager = new OAuthTokenManager(
      oauthClient.client_id,
      oauthClient.client_secret,
      clientConfig.scopes
    );
    
    const testResponse = await fetch('/api/accounts/my', {
      headers: { 'Authorization': `Bearer ${await tokenManager.getAccessToken()}` }
    });
    
    if (!testResponse.ok) {
      throw new Error('OAuth test failed');
    }
    console.log('OAuth test passed');
    
    // Step 3: Generate migration report
    console.log('Generating migration report...');
    const report = await comparePermissions(patToken, clientConfig.scopes);
    console.log('Migration report:', report);
    
    // Step 4: Create configuration file
    const config = {
      oauth: {
        clientId: oauthClient.client_id,
        clientSecret: oauthClient.client_secret,
        scopes: clientConfig.scopes
      },
      migration: {
        completed: false,
        patToken: 'REMOVED_FOR_SECURITY',
        migrationDate: new Date().toISOString()
      }
    };
    
    require('fs').writeFileSync('oauth-config.json', JSON.stringify(config, null, 2));
    console.log('Configuration saved to oauth-config.json');
    
    console.log('Automated migration completed successfully!');
    return config;
    
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  }
};

// Usage
const migrationConfig = {
  name: 'Automated Migration Client',
  description: 'Client created via automated migration',
  scopes: ['banking:read', 'banking:write']
};

await automatedMigration('your_pat_token', migrationConfig);
```

## Support and Resources

### Getting Help
- **Migration Guide**: `/api/migration/guide`
- **Status Dashboard**: `/api/migration/status`
- **Support Email**: migration-support@banking-api.com
- **Documentation**: https://docs.banking-api.com/migration

### Monitoring Tools
- **Migration Progress**: `/api/migration/statistics`
- **Security Alerts**: `/api/security/alerts`
- **API Health**: `/health`

### Community Resources
- **Developer Forum**: https://community.banking-api.com
- **Migration Webinars**: Monthly live sessions
- **Sample Code**: https://github.com/banking-api/migration-examples

---

This migration guide ensures a smooth transition from PATs to OAuth client credentials while maintaining security and functionality throughout the process.
