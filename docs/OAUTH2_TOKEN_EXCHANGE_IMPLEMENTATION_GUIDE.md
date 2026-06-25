# OAuth 2.0 Token Exchange Implementation Guide
## PingOne RFC 8693 Implementation Details

This guide provides comprehensive implementation details for OAuth 2.0 Token Exchange (RFC 8693) specifically for PingOne, including common pitfalls, security considerations, and practical examples.

---

## Quick Reference

| Concept | RFC 8693 | PingOne Implementation | Example |
|---------|----------|---------------------|---------|
| **Grant Type** | `urn:ietf:params:oauth:grant-type:token-exchange` | ✅ Fully supported | `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` |
| **Subject Token** | Token being exchanged | User's access_token | `subject_token=eyJ...` |
| **Actor Token** | Optional - acting party | Agent/BFF client credentials | `actor_token=eyJ...` |
| **Audience** | Target resource server | MCP server URI | `audience=https://mcp-server.pingdemo.com` |
| **Act Claim** | Delegation chain | `act.sub` = actor identity | `{"sub":"user123","act":{"sub":"client-456"}}` |

---

## Core Implementation Patterns

### Pattern 1: Simple Token Exchange (1-Exchange)

**Use Case**: Exchange user token for MCP server access
**When to Use**: Default Super Banking demo pattern

```javascript
// banking_api_server/services/agentMcpTokenService.js
async function exchangeUserTokenForMcpToken(userAccessToken, mcpResourceUri) {
  const tokenResponse = await fetch(`${pingoneBaseUrl}/${envId}/as/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: userAccessToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: mcpResourceUri,
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'banking:accounts:read banking:transactions:read'
    })
  });
  
  return await tokenResponse.json();
}
```

### Pattern 2: Delegated Token Exchange (2-Exchange)

**Use Case**: Named agent identity in delegation chain
**When to Use**: Production environments requiring audit trails

```javascript
// Step 1: Get agent actor token via client credentials
async function getAgentActorToken() {
  const response = await fetch(`${pingoneBaseUrl}/${envId}/as/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${agentClientId}:${agentSecret}`).toString('base64')}`
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      audience: mcpResourceUri,
      scope: 'banking:agent:invoke'
    })
  });
  return await response.json();
}

// Step 2: Exchange user token with actor token
async function exchangeWithActor(userAccessToken, actorToken, mcpResourceUri) {
  const response = await fetch(`${pingoneBaseUrl}/${envId}/as/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: userAccessToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      actor_token: actorToken,
      actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: mcpResourceUri,
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'banking:accounts:read banking:transactions:read'
    })
  });
  return await response.json();
}
```

---

## Critical PingOne Configuration

### 1. Enable Token Exchange Grant

**Location**: PingOne Console → Applications → Your Application → Configuration → Grant Types

```
✅ Authorization Code
✅ Client Credentials  
✅ Token Exchange ← MUST BE ENABLED
```

### 2. Configure may_act Policy

**Location**: PingOne Console → Applications → Your Application → Resources → may_act

```json
{
  "policy": {
    "id": "may_act_policy",
    "name": "Agent Delegation Policy",
    "description": "Allow BFF to act as agent on behalf of users",
    "conditions": [
      {
        "type": "equals",
        "claim": "sub",
        "value": "{{USER_ID}}"
      },
      {
        "type": "equals", 
        "claim": "client_id",
        "value": "{{AGENT_CLIENT_ID}}"
      }
    ],
    "actions": [
      {
        "type": "allow",
        "act": {
          "sub": "{{AGENT_CLIENT_ID}}"
        }
      }
    ]
  }
}
```

### 3. Resource Server Configuration

**Location**: PingOne Console → Connections → Resources

```json
{
  "name": "Banking MCP Server",
  "audience": "https://mcp-server.pingdemo.com",
  "scopes": [
    {
      "name": "banking:accounts:read",
      "description": "Read account information"
    },
    {
      "name": "banking:transactions:read", 
      "description": "Read transaction history"
    },
    {
      "name": "banking:sensitive:read",
      "description": "Read sensitive account details"
    }
  ]
}
```

---

## Common Implementation Pitfalls

### ❌ Pitfall 1: Including `openid` scope

**Problem**: Token exchange fails with `invalid_scope`

```javascript
// WRONG - causes "May not request scopes for multiple resources"
scope: 'openid profile banking:accounts:read'

// CORRECT - no openid in token exchange
scope: 'banking:accounts:read banking:transactions:read'
```

**Why**: `openid` belongs to OIDC UserInfo resource, not your custom resource server.

### ❌ Pitfall 2: Missing Token Exchange Grant

**Problem**: `unauthorized_client` error

**Solution**: Enable Token Exchange grant type in PingOne application configuration.

### ❌ Pitfall 3: Incorrect Audience

**Problem**: `invalid_audience` or token doesn't work

```javascript
// WRONG - using PingOne base URL
audience: 'https://auth.pingone.com'

// CORRECT - using your resource server audience
audience: 'https://mcp-server.pingdemo.com'
```

### ❌ Pitfall 4: Expired Subject Token

**Problem**: `invalid_grant` error

**Solution**: Always refresh user access token before exchange if it's close to expiry.

---

## Security Best Practices

### 1. Token Validation

```javascript
function validateExchangeToken(token) {
  try {
    const decoded = jwt.decode(token, { complete: true });
    
    // Verify signature (in production)
    const verified = jwt.verify(token, publicKey);
    
    // Check critical claims
    assert(verified.aud === expectedAudience, 'Invalid audience');
    assert(verified.exp > Date.now() / 1000, 'Token expired');
    assert(verified.scope?.includes('banking:accounts:read'), 'Missing required scope');
    
    if (verified.act) {
      assert(verified.act.sub, 'Actor identity missing');
    }
    
    return verified;
  } catch (error) {
    throw new Error(`Token validation failed: ${error.message}`);
  }
}
```

### 2. Scope Minimization

```javascript
// Request only the scopes needed for the specific operation
const getRequiredScopes = (operation) => {
  const scopeMap = {
    'get_accounts': 'banking:accounts:read',
    'get_transactions': 'banking:transactions:read', 
    'get_sensitive_details': 'banking:sensitive:read'
  };
  return scopeMap[operation] || 'banking:accounts:read';
};
```

### 3. Actor Token Caching

```javascript
// Cache actor tokens to reduce client credentials calls
const actorTokenCache = new Map();

async function getCachedActorToken() {
  const cacheKey = 'agent-actor-token';
  const cached = actorTokenCache.get(cacheKey);
  
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  
  const tokenResponse = await getAgentActorToken();
  actorTokenCache.set(cacheKey, {
    token: tokenResponse.access_token,
    expiresAt: Date.now() + (tokenResponse.expires_in * 1000)
  });
  
  return tokenResponse.access_token;
}
```

---

## Debugging Token Exchange Issues

### Common Error Codes

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid_grant` | Subject token expired/invalid | Refresh user token first |
| `unauthorized_client` | Token Exchange not enabled | Enable grant type in PingOne |
| `invalid_scope` | Wrong scopes or `openid` included | Remove `openid`, use resource-specific scopes |
| `invalid_audience` | Audience doesn't match resource | Use correct resource server URI |
| `may_act_denied` | User record missing may_act | Set `may_act.sub` on user record |

### Debug Logging

```javascript
function debugTokenExchange(request, response) {
  console.log('=== Token Exchange Debug ===');
  console.log('Request:', {
    grant_type: request.grant_type,
    audience: request.audience,
    scope: request.scope,
    subject_token_type: request.subject_token_type,
    has_subject_token: !!request.subject_token,
    has_actor_token: !!request.actor_token
  });
  
  if (response.error) {
    console.error('Error Response:', {
      error: response.error,
      error_description: response.error_description,
      hint: getErrorHint(response.error)
    });
  } else {
    console.log('Success Response:', {
      token_type: response.token_type,
      expires_in: response.expires_in,
      scope: response.scope,
      has_access_token: !!response.access_token
    });
  }
}

function getErrorHint(error) {
  const hints = {
    'invalid_grant': 'Check subject token expiry and validity',
    'unauthorized_client': 'Enable Token Exchange grant in PingOne app',
    'invalid_scope': 'Remove openid scope, use resource server scopes only',
    'invalid_audience': 'Verify audience matches resource server URI'
  };
  return hints[error] || 'Check PingOne configuration';
}
```

---

## Testing Strategies

### 1. Unit Tests

```javascript
describe('Token Exchange Service', () => {
  test('should exchange user token for MCP token', async () => {
    const mockUserToken = createMockAccessToken({
      sub: 'user123',
      aud: 'https://ai-agent.pingdemo.com',
      scope: 'banking:agent:invoke'
    });
    
    const result = await exchangeUserTokenForMcpToken(
      mockUserToken, 
      'https://mcp-server.pingdemo.com'
    );
    
    expect(result.access_token).toBeDefined();
    expect(result.scope).toContain('banking:accounts:read');
    expect(result.token_type).toBe('Bearer');
  });
});
```

### 2. Integration Tests with Postman

Use the existing Postman collections:
- `Super Banking — 1-Exchange Delegated Chain — pi.flow.postman_collection.json`
- `Super Banking — 2-Exchange Delegated Chain — pi.flow.postman_collection.json`

### 3. End-to-End Tests

```javascript
describe('E2E Token Exchange Flow', () => {
  test('complete user → agent → MCP flow', async () => {
    // 1. User login
    const userSession = await loginUser();
    
    // 2. Agent request
    const agentResponse = await requestAgentAction(userSession, 'get_accounts');
    
    // 3. Verify MCP token was used
    expect(agentResponse.mcpTokenUsed).toBe(true);
    expect(agentResponse.auditTrail).toContain('token_exchange');
  });
});
```

---

## Performance Considerations

### 1. Token Caching Strategy

```javascript
class TokenExchangeCache {
  constructor() {
    this.cache = new Map();
    this.maxAge = 5 * 60 * 1000; // 5 minutes
  }
  
  get(key) {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    return entry.token;
  }
  
  set(key, token, expiresIn) {
    this.cache.set(key, {
      token,
      expires: Date.now() + (expiresIn * 1000)
    });
  }
}
```

### 2. Concurrent Request Handling

```javascript
// Prevent multiple exchanges for same user token
const pendingExchanges = new Map();

async function exchangeWithDeduplication(userToken, audience) {
  const key = `${userToken.substring(0, 10)}_${audience}`;
  
  if (pendingExchanges.has(key)) {
    return await pendingExchanges.get(key);
  }
  
  const promise = performExchange(userToken, audience);
  pendingExchanges.set(key, promise);
  
  try {
    return await promise;
  } finally {
    pendingExchanges.delete(key);
  }
}
```

---

## Migration Guide

### From 1-Exchange to 2-Exchange

1. **Add Agent Application**: Create separate OAuth app for agent
2. **Enable Actor Token**: Implement client credentials flow
3. **Update Exchange Logic**: Add actor_token to exchange request
4. **Update Resource Server**: Validate `act.sub` claims
5. **Test Both Modes**: Use feature flag to toggle between modes

### Configuration Changes

```javascript
// Before (1-Exchange)
const tokenRequest = {
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  subject_token: userAccessToken,
  audience: mcpResourceUri,
  scope: requiredScopes
};

// After (2-Exchange)  
const tokenRequest = {
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  subject_token: userAccessToken,
  actor_token: agentActorToken,
  audience: mcpResourceUri,
  scope: requiredScopes
};
```

---

## References

### RFC Standards
- [RFC 6749 - OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 7636 - PKCE](https://datatracker.ietf.org/doc/html/rfc7636)  
- [RFC 8693 - Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [RFC 9700 - OAuth 2.0 Security](https://datatracker.ietf.org/doc/html/rfc9700)

### PingOne Documentation
- [PingOne Token Exchange](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_token_exchange.html)
- [PingOne may_act](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_may_act.html)
- [PingOne Resources](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_resources.html)

### Implementation Code
- `banking_api_server/services/agentMcpTokenService.js`
- `banking_api_server/services/oauthService.js`
- `banking_api_server/middleware/tokenRefresh.js`

---

## Quick Checklist

- [ ] Token Exchange grant enabled in PingOne app
- [ ] Resource server created with correct audience
- [ ] may_act policy configured for delegation
- [ ] Subject token validation implemented
- [ ] Scope minimization enforced
- [ ] Error handling and logging added
- [ ] Token caching implemented
- [ ] Security testing completed
- [ ] Performance testing done
- [ ] Documentation updated

This guide provides everything needed to implement OAuth 2.0 Token Exchange with PingOne securely and efficiently.
