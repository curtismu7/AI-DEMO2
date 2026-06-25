# OAuth Client Credentials Integration Guide

## Overview

This guide provides comprehensive instructions for integrating with the Super Banking API using OAuth 2.0 client credentials. This approach replaces Personal Access Tokens (PATs) with a more secure, scalable authentication method.

## Quick Start

1. **Register OAuth Client** - Create an OAuth client for your integration
2. **Receive Credentials** - Get your `client_id` and `client_secret`
3. **Request Access Token** - Exchange credentials for an access token
4. **Make API Calls** - Use the access token to authenticate requests

## Prerequisites

- Node.js 18+ or equivalent runtime
- HTTPS-enabled environment (required for production)
- Valid PingOne environment configuration

## Step 1: Register OAuth Client

### API Endpoint
```
POST /api/oauth/clients
```

### Request Body
```json
{
  "name": "My Banking Integration",
  "description": "Integration for account management and transactions",
  "scopes": ["banking:read", "banking:write"],
  "redirect_uris": ["https://myapp.com/callback"],
  "grant_types": ["client_credentials"]
}
```

### Response
```json
{
  "client_id": "client_1234567890abcdef",
  "client_secret": "secret_abcdef1234567890",
  "client_id_issued_at": 1704067200,
  "client_secret_expires_at": 0,
  "registration_access_token": "token_abcdef1234567890",
  "registration_client_uri": "/api/oauth/clients/client_1234567890abcdef"
}
```

### Example Code
```javascript
const registerClient = async () => {
  const response = await fetch('/api/oauth/clients', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer <admin_access_token>'
    },
    body: JSON.stringify({
      name: 'My Banking Integration',
      description: 'Integration for account management',
      scopes: ['banking:read', 'banking:write'],
      grant_types: ['client_credentials']
    })
  });
  
  const client = await response.json();
  console.log('Client registered:', client.client_id);
  return client;
};
```

## Step 2: Request Access Token

### API Endpoint
```
POST /api/oauth/token
```

### Request Headers
```
Authorization: Basic <base64(client_id:client_secret)>
Content-Type: application/x-www-form-urlencoded
```

### Request Body
```
grant_type=client_credentials&scope=banking:read banking:write
```

### Response
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6I...",
  "token_type": "Bearer",
  "expires_in": 1800,
  "scope": "banking:read banking:write",
  "issued_at": "2024-01-01T12:00:00.000Z"
}
```

### Example Code
```javascript
const getAccessToken = async (clientId, clientSecret, scopes) => {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
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
  
  const tokenData = await response.json();
  return tokenData.access_token;
};

// Usage
const accessToken = await getAccessToken(
  'client_1234567890abcdef',
  'secret_abcdef1234567890',
  ['banking:read', 'banking:write']
);
```

## Step 3: Make API Calls

### Authentication Header
```
Authorization: Bearer <access_token>
```

### Example API Calls
```javascript
const getAccounts = async (accessToken) => {
  const response = await fetch('/api/accounts/my', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  
  return await response.json();
};

const createTransfer = async (accessToken, transferData) => {
  const response = await fetch('/api/transactions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(transferData)
  });
  
  return await response.json();
};
```

## Available Scopes

### Banking Operations
- `banking:read` - Read access to accounts, balances, and transactions
- `banking:write` - Write access for creating transactions and transfers
- `banking:accounts:read` - Read access to account information only
- `banking:transactions:read` - Read access to transaction history only
- `banking:transactions:write` - Write access for transactions only
- `banking:sensitive:read` - Access to sensitive account data (requires explicit consent)

### Administrative Operations
- `admin:read` - Read access to administrative endpoints
- `admin:write` - Write access to administrative endpoints
- `users:read` - Read access to user information
- `users:manage` - Manage user accounts and permissions

### AI Agent Operations
- `ai_agent` - Access to AI agent capabilities
- `banking:agent:invoke` - Invoke banking operations through AI agents

## Token Management

### Token Expiry
- Access tokens expire after **30 minutes** (1800 seconds)
- Tokens cannot be refreshed - request a new token when expired
- Implement automatic token refresh in your application

### Token Storage
```javascript
class TokenManager {
  constructor(clientId, clientSecret, scopes) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.scopes = scopes;
    this.currentToken = null;
    this.tokenExpiry = null;
  }
  
  async getAccessToken() {
    // Check if current token is valid
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
    
    const tokenData = await response.json();
    this.currentToken = tokenData.access_token;
    this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000) - 60000; // Refresh 1 minute early
    
    return this.currentToken;
  }
}

// Usage
const tokenManager = new TokenManager(
  'client_1234567890abcdef',
  'secret_abcdef1234567890',
  ['banking:read', 'banking:write']
);

const accessToken = await tokenManager.getAccessToken();
```

## Error Handling

### Common Error Responses

#### 400 Bad Request
```json
{
  "error": "invalid_request",
  "error_description": "Invalid grant_type parameter"
}
```

#### 401 Unauthorized
```json
{
  "error": "invalid_client",
  "error_description": "Client authentication failed"
}
```

#### 403 Forbidden
```json
{
  "error": "insufficient_scope",
  "error_description": "Requested scope not authorized"
}
```

### Error Handling Example
```javascript
const makeApiCall = async (endpoint, options = {}) => {
  try {
    const accessToken = await tokenManager.getAccessToken();
    
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (response.status === 401) {
      // Token might be expired, force refresh and retry
      tokenManager.currentToken = null;
      const newToken = await tokenManager.getAccessToken();
      
      // Retry with new token
      const retryResponse = await fetch(endpoint, {
        ...options,
        headers: {
          'Authorization': `Bearer ${newToken}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
      
      return await retryResponse.json();
    }
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`API Error: ${error.error} - ${error.error_description}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
};
```

## Security Best Practices

### 1. Protect Client Credentials
- Store `client_secret` securely (environment variables, secret manager)
- Never commit credentials to version control
- Use different credentials for development and production
- Rotate client secrets regularly

### 2. Token Security
- Use short-lived tokens (30 minutes)
- Store tokens in memory when possible
- Implement proper token expiration handling
- Use HTTPS for all token requests

### 3. Scope Management
- Request minimum required scopes
- Use scope-specific credentials for different services
- Regularly audit scope usage
- Implement scope validation in your code

### 4. Monitoring and Logging
- Monitor token usage patterns
- Log authentication failures (without sensitive data)
- Implement rate limiting
- Set up alerts for unusual activity

## Migration from PATs

### Step-by-Step Migration

1. **Create OAuth Client**
   ```bash
   curl -X POST /api/oauth/clients \
     -H "Authorization: Bearer <admin_token>" \
     -H "Content-Type: application/json" \
     -d '{"name": "My Integration", "scopes": ["banking:read"]}'
   ```

2. **Update Authentication Code**
   ```javascript
   // Old PAT approach
   const headers = {
     'Authorization': 'PAT <personal_access_token>'
   };
   
   // New OAuth approach
   const accessToken = await getAccessToken(clientId, clientSecret, scopes);
   const headers = {
     'Authorization': `Bearer ${accessToken}`
   };
   ```

3. **Test Integration**
   - Verify all API calls work with OAuth tokens
   - Test token refresh functionality
   - Monitor for deprecation warnings

4. **Deprecate PAT**
   - Remove PAT usage from production code
   - Revoke unused PATs
   - Update documentation

### Migration Timeline
- **Phase 1** (30 days): OAuth infrastructure ready, PATs supported
- **Phase 2** (60 days): PATs deprecated with warnings
- **Phase 3** (90 days): PATs no longer supported

## Testing

### Unit Testing Example
```javascript
const { getAccessToken } = require('./oauth-client');

describe('OAuth Client', () => {
  test('should obtain access token', async () => {
    const token = await getAccessToken(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      ['banking:read']
    );
    
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
  });
});
```

### Integration Testing
```javascript
describe('API Integration', () => {
  test('should make authenticated API call', async () => {
    const tokenManager = new TokenManager(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      ['banking:read']
    );
    
    const accounts = await makeApiCall('/api/accounts/my');
    expect(accounts).toHaveProperty('accounts');
  });
});
```

## Troubleshooting

### Common Issues

#### "invalid_client" Error
- Verify client ID and secret are correct
- Check if client is registered and active
- Ensure proper Basic Auth encoding

#### "insufficient_scope" Error
- Check if requested scopes are registered for client
- Verify scope names match exactly
- Contact admin for additional scope permissions

#### Token Expired
- Implement automatic token refresh
- Check token expiry before making requests
- Handle 401 responses gracefully

### Debug Mode
Enable debug logging by setting environment variable:
```bash
DEBUG=oauth:* node app.js
```

### Support Resources
- **API Documentation**: `/docs/api/oauth`
- **Migration Guide**: `/api/migration/guide`
- **Support Contact**: support@banking-api.com
- **Status Page**: https://status.banking-api.com

## SDK Examples

### Node.js SDK
```javascript
const { BankingOAuthClient } = require('@bx-finance/sdk');

const client = new BankingOAuthClient({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  scopes: ['banking:read', 'banking:write']
});

const accounts = await client.getAccounts();
const transfer = await client.createTransfer({
  fromAccount: '123456',
  toAccount: '789012',
  amount: 100.00,
  currency: 'USD'
});
```

### Python SDK
```python
from bx_finance_sdk import OAuthClient, BankingAPI

client = OAuthClient(
    client_id=os.getenv('CLIENT_ID'),
    client_secret=os.getenv('CLIENT_SECRET'),
    scopes=['banking:read', 'banking:write']
)

api = BankingAPI(client)
accounts = api.get_accounts()
transfer = api.create_transfer(
    from_account='123456',
    to_account='789012',
    amount=100.00,
    currency='USD'
)
```

## Rate Limits

### Token Endpoint
- **Requests per minute**: 60
- **Burst limit**: 10 requests per second

### API Endpoints
- **Requests per minute**: 1000 (varies by endpoint)
- **Burst limit**: 100 requests per second

### Rate Limit Headers
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1704067200
```

## Compliance and Security

### OAuth 2.0 Compliance
- RFC 6749 compliant implementation
- RFC 7009 token revocation support
- RFC 7662 token introspection support
- PKCE support for enhanced security

### Security Certifications
- SOC 2 Type II compliant
- ISO 27001 certified
- PCI DSS compliant
- GDPR compliant

### Data Protection
- Encrypted data in transit (TLS 1.3)
- Encrypted data at rest
- Regular security audits
- Penetration testing annually

---

For additional support or questions, contact our development team at devsupport@banking-api.com or visit our developer portal at https://developers.banking-api.com.
