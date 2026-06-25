# OAuth Scope Definitions and Usage

## Overview

This document defines all available OAuth scopes for the Super Banking API and provides guidance on their proper usage. Scopes control access to specific API endpoints and operations, following the principle of least privilege.

## Scope Taxonomy

### Banking Operations Scopes

#### `banking:read`
- **Description**: Read access to banking data (accounts, balances, transactions)
- **Risk Level**: Low
- **Required for**: GET /accounts/*, GET /transactions/*, GET /balances/*
- **Includes**: Basic account information, transaction history, account balances
- **User Context Required**: Yes
- **Examples**:
  ```javascript
  // Get user's accounts
  GET /api/accounts/my
  Authorization: Bearer <token_with_banking:read>
  
  // Get account balance
  GET /api/accounts/{accountId}/balance
  Authorization: Bearer <token_with_banking:read>
  
  // Get transaction history
  GET /api/transactions?account_id={accountId}
  Authorization: Bearer <token_with_banking:read>
  ```

#### `banking:accounts:read`
- **Description**: Read access to account information only
- **Risk Level**: Low
- **Required for**: GET /accounts/*, GET /balances/*
- **Includes**: Account details, balances, account metadata
- **User Context Required**: Yes
- **Notes**: More restrictive than `banking:read`, excludes transaction history
- **Examples**:
  ```javascript
  // Get account details
  GET /api/accounts/{accountId}
  Authorization: Bearer <token_with_banking:accounts:read>
  
  // Get account balance
  GET /api/accounts/{accountId}/balance
  Authorization: Bearer <token_with_banking:accounts:read>
  ```

#### `banking:transactions:read`
- **Description**: Read access to transaction history only
- **Risk Level**: Low
- **Required for**: GET /transactions/*
- **Includes**: Transaction details, transaction history, transaction metadata
- **User Context Required**: Yes
- **Notes**: More restrictive than `banking:read`, excludes account balances
- **Examples**:
  ```javascript
  // Get transaction history
  GET /api/transactions?account_id={accountId}
  Authorization: Bearer <token_with_banking:transactions:read>
  
  // Get specific transaction
  GET /api/transactions/{transactionId}
  Authorization: Bearer <token_with_banking:transactions:read>
  ```

#### `banking:write`
- **Description**: Write access to banking operations (transfers, deposits)
- **Risk Level**: High
- **Required for**: POST /transactions/*, PUT /accounts/*
- **Includes**: Creating transfers, modifying account settings, initiating payments
- **User Context Required**: Yes
- **Additional Requirements**: MFA may be required for high-value transactions
- **Examples**:
  ```javascript
  // Create transfer
  POST /api/transactions
  Authorization: Bearer <token_with_banking:write>
  Content-Type: application/json
  
  {
    "from_account_id": "123456",
    "to_account_id": "789012",
    "amount": 100.00,
    "currency": "USD"
  }
  
  // Update account settings
  PUT /api/accounts/{accountId}/settings
  Authorization: Bearer <token_with_banking:write>
  Content-Type: application/json
  
  {
    "account_name": "My Savings Account",
    "notifications_enabled": true
  }
  ```

#### `banking:transactions:write`
- **Description**: Create and modify transactions only
- **Risk Level**: High
- **Required for**: POST /transactions/*
- **Includes**: Creating transfers, payments, and transaction modifications
- **User Context Required**: Yes
- **Notes**: More restrictive than `banking:write`, excludes account management
- **Examples**:
  ```javascript
  // Create transfer
  POST /api/transactions
  Authorization: Bearer <token_with_banking:transactions:write>
  Content-Type: application/json
  
  {
    "from_account_id": "123456",
    "to_account_id": "789012",
    "amount": 100.00,
    "currency": "USD"
  }
  ```

#### `banking:sensitive:read`
- **Description**: Access to sensitive account data (full account numbers, routing numbers)
- **Risk Level**: High
- **Required for**: GET /accounts/{accountId}/sensitive
- **Includes**: Full account numbers, routing numbers, SSN (limited), tax identification
- **User Context Required**: Yes
- **Additional Requirements**: Explicit user consent required via SensitiveConsentBanner
- **Compliance**: PCI DSS, GLBA compliance requirements
- **Examples**:
  ```javascript
  // Get sensitive account details
  GET /api/accounts/{accountId}/sensitive
  Authorization: Bearer <token_with_banking:sensitive:read>
  X-User-Consent: true
  
  // Response includes:
  {
    "account_number": "1234567890123456",
    "routing_number": "021000021",
    "account_type": "checking",
    "consent_timestamp": "2024-01-01T12:00:00.000Z"
  }
  ```

### Administrative Scopes

#### `admin:read`
- **Description**: Read access to administrative endpoints
- **Risk Level**: Medium
- **Required for**: GET /api/admin/*, GET /api/users/*
- **Includes**: System status, user management read operations, configuration read access
- **User Context Required**: No (system-level access)
- **Examples**:
  ```javascript
  // Get system status
  GET /api/admin/status
  Authorization: Bearer <token_with_admin:read>
  
  // Get user list
  GET /api/admin/users
  Authorization: Bearer <token_with_admin:read>
  
  // Get configuration
  GET /api/admin/config
  Authorization: Bearer <token_with_admin:read>
  ```

#### `admin:write`
- **Description**: Write access to administrative endpoints
- **Risk Level**: High
- **Required for**: POST /api/admin/*, PUT /api/admin/*, DELETE /api/admin/*
- **Includes**: User management, system configuration, administrative operations
- **User Context Required**: No (system-level access)
- **Additional Requirements**: MFA required for sensitive operations
- **Examples**:
  ```javascript
  // Create user
  POST /api/admin/users
  Authorization: Bearer <token_with_admin:write>
  Content-Type: application/json
  
  {
    "email": "user@example.com",
    "role": "customer",
    "permissions": ["banking:read"]
  }
  
  // Update system configuration
  PUT /api/admin/config
  Authorization: Bearer <token_with_admin:write>
  Content-Type: application/json
  
  {
    "maintenance_mode": false,
    "rate_limits": {
      "requests_per_minute": 1000
    }
  }
  ```

#### `users:read`
- **Description**: Read access to user information
- **Risk Level**: Medium
- **Required for**: GET /api/users/{id}, GET /api/users/search
- **Includes**: User profiles, user metadata, user activity (limited)
- **User Context Required**: No (admin-level access)
- **Examples**:
  ```javascript
  // Get user profile
  GET /api/users/{userId}
  Authorization: Bearer <token_with_users:read>
  
  // Search users
  GET /api/users/search?q=john.doe@example.com
  Authorization: Bearer <token_with_users:read>
  ```

#### `users:manage`
- **Description**: Manage user accounts and permissions
- **Risk Level**: High
- **Required for**: POST /api/users/*, PUT /api/users/*, DELETE /api/users/*
- **Includes**: User creation, modification, deletion, permission management
- **User Context Required**: No (admin-level access)
- **Examples**:
  ```javascript
  // Update user permissions
  PUT /api/users/{userId}/permissions
  Authorization: Bearer <token_with_users:manage>
  Content-Type: application/json
  
  {
    "scopes": ["banking:read", "banking:write"],
    "expires_at": "2024-12-31T23:59:59.999Z"
  }
  
  // Disable user account
  POST /api/users/{userId}/disable
  Authorization: Bearer <token_with_users:manage>
  ```

### AI Agent Scopes

#### `ai_agent`
- **Description**: General AI agent capabilities
- **Risk Level**: Medium
- **Required for**: POST /api/agent/*, GET /api/agent/*
- **Includes**: AI agent interactions, natural language processing, agent status
- **User Context Required**: Yes
- **Examples**:
  ```javascript
  // Query AI agent
  POST /api/agent/query
  Authorization: Bearer <token_with_ai_agent>
  Content-Type: application/json
  
  {
    "query": "What's my account balance?",
    "context": "banking"
  }
  
  // Get agent status
  GET /api/agent/status
  Authorization: Bearer <token_with_ai_agent>
  ```

#### `banking:agent:invoke`
- **Description**: Invoke banking operations through AI agents
- **Risk Level**: Medium
- **Required for**: POST /api/banking-agent/*
- **Includes**: AI-driven banking operations, automated financial tasks
- **User Context Required**: Yes
- **Additional Requirements**: May require additional banking scopes
- **Examples**:
  ```javascript
  // AI agent creates transfer
  POST /api/banking-agent/execute
  Authorization: Bearer <token_with_banking:agent:invoke>
  Content-Type: application/json
  
  {
    "instruction": "Transfer $50 from checking to savings",
    "confirmation_required": true
  }
  ```

## Scope Combinations and Best Practices

### Recommended Scope Sets

#### Read-Only Banking Client
```javascript
const scopes = ['banking:read'];
// Or for more granular control:
const scopes = ['banking:accounts:read', 'banking:transactions:read'];
```

#### Full Banking Client
```javascript
const scopes = ['banking:read', 'banking:write'];
```

#### Administrative Client
```javascript
const scopes = ['admin:read', 'admin:write', 'users:read', 'users:manage'];
```

#### AI Agent Client
```javascript
const scopes = ['ai_agent', 'banking:agent:invoke', 'banking:read'];
```

### Scope Hierarchy

Some scopes include or imply others:

1. `banking:read` includes:
   - `banking:accounts:read`
   - `banking:transactions:read`

2. `banking:write` includes:
   - `banking:transactions:write`

3. `admin:write` includes:
   - `admin:read`
   - `users:read`
   - `users:manage`

### Least Privilege Principle

Always request the minimum scopes necessary:

```javascript
// BAD: Requesting more scopes than needed
const scopes = ['banking:read', 'banking:write', 'admin:read'];

// GOOD: Only requesting needed scopes
const scopes = ['banking:read']; // If only reading account data
```

## Scope Enforcement

### Server-Side Validation
```javascript
// Example middleware for scope validation
const requireScopes = (requiredScopes) => {
  return (req, res, next) => {
    const tokenScopes = req.auth?.scopes || [];
    
    const hasAllScopes = requiredScopes.every(scope => 
      tokenScopes.includes(scope) || 
      hasImpliedScope(scope, tokenScopes)
    );
    
    if (!hasAllScopes) {
      return res.status(403).json({
        error: 'insufficient_scope',
        error_description: `Required scopes: ${requiredScopes.join(', ')}`
      });
    }
    
    next();
  };
};

// Usage
app.get('/api/accounts/my', 
  authenticateToken, 
  requireScopes(['banking:read']), 
  getAccountsHandler
);
```

### Client-Side Scope Checking
```javascript
class ScopeValidator {
  constructor(tokenScopes) {
    this.tokenScopes = new Set(tokenScopes);
  }
  
  hasScope(requiredScope) {
    return this.tokenScopes.has(requiredScope) || 
           this.hasImpliedScope(requiredScope);
  }
  
  hasAllScopes(requiredScopes) {
    return requiredScopes.every(scope => this.hasScope(scope));
  }
  
  hasAnyScope(requiredScopes) {
    return requiredScopes.some(scope => this.hasScope(scope));
  }
  
  hasImpliedScope(requiredScope) {
    const implications = {
      'banking:read': ['banking:accounts:read', 'banking:transactions:read'],
      'banking:write': ['banking:transactions:write'],
      'admin:write': ['admin:read', 'users:read', 'users:manage']
    };
    
    return Object.entries(implications).some(([parent, implied]) => 
      this.tokenScopes.has(parent) && implied.includes(requiredScope)
    );
  }
}

// Usage
const validator = new ScopeValidator(token.scopes);

if (validator.hasScope('banking:write')) {
  // Can perform write operations
}

if (validator.hasAllScopes(['banking:read', 'banking:write'])) {
  // Can perform full banking operations
}
```

## Scope Usage Patterns

### Progressive Scope Requesting
```javascript
class ProgressiveScopeClient {
  constructor(baseScopes) {
    this.baseScopes = baseScopes;
    this.additionalScopes = [];
  }
  
  async requestAdditionalScopes(newScopes) {
    // Request new client with additional scopes
    const newClient = await registerClient({
      name: `${this.baseClient.name} - Extended`,
      scopes: [...this.baseScopes, ...newScopes]
    });
    
    this.additionalScopes = newScopes;
    return newClient;
  }
  
  getEffectiveScopes() {
    return [...this.baseScopes, ...this.additionalScopes];
  }
}
```

### Scope-Based Feature Flags
```javascript
class FeatureFlags {
  constructor(tokenScopes) {
    this.scopes = new Set(tokenScopes);
  }
  
  canReadAccounts() {
    return this.scopes.has('banking:read') || 
           this.scopes.has('banking:accounts:read');
  }
  
  canWriteTransactions() {
    return this.scopes.has('banking:write') || 
           this.scopes.has('banking:transactions:write');
  }
  
  canAccessSensitiveData() {
    return this.scopes.has('banking:sensitive:read');
  }
  
  canManageUsers() {
    return this.scopes.has('users:manage') || 
           this.scopes.has('admin:write');
  }
  
  canUseAIAgent() {
    return this.scopes.has('ai_agent');
  }
}
```

## Scope Migration Guide

### From PATs to OAuth Scopes
```javascript
// PAT-based approach (deprecated)
const patToken = 'pat_1234567890abcdef';
const headers = {
  'Authorization': `PAT ${patToken}`
};

// OAuth scope-based approach
const oauthToken = await getAccessToken(clientId, clientSecret, ['banking:read']);
const headers = {
  'Authorization': `Bearer ${oauthToken}`
};
```

### Scope Deprecation Timeline
- **Current**: All scopes listed above are active
- **Q2 2024**: `banking:legacy` scope deprecated
- **Q3 2024**: `admin:legacy` scope deprecated
- **Q4 2024**: All legacy scopes removed

## Testing Scope Access

### Unit Testing
```javascript
describe('Scope Validation', () => {
  test('should allow access with correct scopes', () => {
    const validator = new ScopeValidator(['banking:read', 'banking:write']);
    expect(validator.hasScope('banking:read')).toBe(true);
    expect(validator.hasScope('banking:write')).toBe(true);
  });
  
  test('should deny access without required scopes', () => {
    const validator = new ScopeValidator(['banking:read']);
    expect(validator.hasScope('banking:write')).toBe(false);
  });
  
  test('should recognize implied scopes', () => {
    const validator = new ScopeValidator(['banking:read']);
    expect(validator.hasScope('banking:accounts:read')).toBe(true);
  });
});
```

### Integration Testing
```javascript
describe('API Scope Enforcement', () => {
  test('should require banking:read for account access', async () => {
    const token = await getAccessToken(clientId, clientSecret, ['banking:read']);
    const response = await fetch('/api/accounts/my', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    expect(response.ok).toBe(true);
  });
  
  test('should reject account access without banking:read', async () => {
    const token = await getAccessToken(clientId, clientSecret, ['banking:write']);
    const response = await fetch('/api/accounts/my', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    expect(response.status).toBe(403);
  });
});
```

## Troubleshooting Scope Issues

### Common Scope Errors

#### "insufficient_scope" Error
```
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "insufficient_scope",
  "error_description": "Required scopes: banking:read"
}
```

**Solutions**:
1. Check if client has required scopes registered
2. Verify token was requested with correct scopes
3. Contact admin to add required scopes to client

#### Scope Not Recognized
```
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "invalid_scope",
  "error_description": "Invalid scope: banking:invalid"
}
```

**Solutions**:
1. Verify scope name matches documentation exactly
2. Check for typos in scope names
3. Use only officially supported scopes

### Debugging Scope Issues
```javascript
// Debug token scopes
const debugTokenScopes = async (accessToken) => {
  const response = await fetch('/api/oauth/introspect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      token: accessToken
    })
  });
  
  const introspection = await response.json();
  console.log('Token scopes:', introspection.scope);
  console.log('Token expires at:', introspection.exp);
  console.log('Client ID:', introspection.client_id);
  
  return introspection;
};
```

## Scope Security Considerations

### Scope Auditing
- Regularly audit which clients have which scopes
- Monitor scope usage patterns
- Review high-risk scope assignments
- Implement scope rotation policies

### Scope Limitations
- Maximum 10 scopes per client
- Scope names are case-sensitive
- Some scopes require additional approvals
- Sensitive scopes require MFA

### Scope Best Practices
1. **Principle of Least Privilege**: Request minimum necessary scopes
2. **Regular Review**: Periodically review and update scope assignments
3. **Scope Separation**: Use different clients for different scope sets
4. **Monitoring**: Track scope usage and unusual patterns
5. **Documentation**: Document why each scope is needed

---

For questions about scopes or to request additional scopes, contact our security team at security@banking-api.com.
