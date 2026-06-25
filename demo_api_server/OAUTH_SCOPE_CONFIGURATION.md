# OAuth Scope Configuration Guide


> **📚 Canonical Scope Reference:** This guide covers **OAuth setup** (PingOne configuration, env vars).
> For **scope definitions, resource server mapping, and enforcement patterns**, see [SCOPE_VOCABULARY.md](SCOPE_VOCABULARY.md).

This document provides comprehensive guidance for configuring OAuth scopes in the Banking API system for different environments and user types.

## Overview

The Banking API uses OAuth 2.0 with scope-based authorization to provide fine-grained access control. This system supports different user types with specific scope assignments and environment-specific configurations.

## Banking Scopes

### Read Scopes
- `banking:accounts:read` - View bank accounts and balances
- `banking:transactions:read` - View transaction history
- `banking:read` - General banking read access (includes accounts and transactions)

### Write Scopes
- `banking:transactions:write` - Create deposits, withdrawals, transfers
- `banking:write` - General banking write access (includes all write operations)

### Administrative Scopes
- `banking:admin` - Full administrative access to all APIs and admin UI

### Special Scopes
- `ai_agent` - Identifies AI agent clients for dynamic client registration

## User Type Scope Mappings

### Admin Users
```
Scopes: banking:admin, banking:read, banking:write, banking:accounts:read, banking:transactions:read, banking:transactions:write
Access: Full system access including administrative functions
```

### Customer Users
```
Scopes: banking:read, banking:write, banking:accounts:read, banking:transactions:read, banking:transactions:write
Access: Full banking operations but no administrative access
```

### Read-Only Users
```
Scopes: banking:read, banking:accounts:read, banking:transactions:read
Access: View-only access to banking data
```

### AI Agents
```
Scopes: ai_agent, banking:read, banking:write, banking:accounts:read, banking:transactions:read, banking:transactions:write
Access: Full banking operations with AI agent identification
```

## Environment Variables

### Core OAuth Configuration
```bash
# PingOne Core Tenant Configuration
PINGONE_CORE_TENANT_NAME=your-tenant-name

# Admin OAuth2 Client Configuration
PINGONE_CORE_CLIENT_ID=your-admin-client-id
PINGONE_CORE_CLIENT_SECRET=your-admin-client-secret
PINGONE_CORE_REDIRECT_URI=http://localhost:3001/api/auth/oauth/callback

# End User OAuth2 Client Configuration
PINGONE_CORE_USER_CLIENT_ID=your-user-client-id
PINGONE_CORE_USER_CLIENT_SECRET=your-user-client-secret
PINGONE_CORE_USER_REDIRECT_URI=http://localhost:3001/api/auth/oauth/user/callback
```

### Scope Configuration Variables
```bash
# Default user type for new users (admin, customer, readonly, ai_agent)
DEFAULT_USER_TYPE=customer

# Scope validation settings
STRICT_SCOPE_VALIDATION=true
SCOPE_VALIDATION_TIMEOUT=10000
CACHE_TOKEN_VALIDATION=true
TOKEN_CACHE_TTL=600

# Debug settings (development only)
DEBUG_SCOPES=false
SKIP_TOKEN_SIGNATURE_VALIDATION=false
```

### Client Type Detection
```bash
# Token audience configuration for client type detection
ENDUSER_AUDIENCE=banking_jk_enduser
AI_AGENT_AUDIENCE=banking_mcp_01_JK

# AI Agent scope for dynamic client registration
AI_AGENT_SCOPE=ai_agent
```

### Environment-Specific Settings
```bash
# Environment (development, test, staging, production)
NODE_ENV=development

# Debug token information (development/test only)
DEBUG_TOKENS=false
```

## Environment-Specific Configurations

### Development Environment
```bash
NODE_ENV=development
STRICT_SCOPE_VALIDATION=false
DEBUG_SCOPES=true
DEBUG_TOKENS=true
DEFAULT_USER_TYPE=customer
SCOPE_VALIDATION_TIMEOUT=5000
CACHE_TOKEN_VALIDATION=false
```

### Test Environment
```bash
NODE_ENV=test
STRICT_SCOPE_VALIDATION=false
DEBUG_SCOPES=true
DEBUG_TOKENS=true
DEFAULT_USER_TYPE=customer
SCOPE_VALIDATION_TIMEOUT=1000
CACHE_TOKEN_VALIDATION=false
SKIP_TOKEN_SIGNATURE_VALIDATION=true
```

### Staging Environment
```bash
NODE_ENV=staging
STRICT_SCOPE_VALIDATION=true
DEBUG_SCOPES=false
DEBUG_TOKENS=false
DEFAULT_USER_TYPE=readonly
SCOPE_VALIDATION_TIMEOUT=10000
CACHE_TOKEN_VALIDATION=true
TOKEN_CACHE_TTL=300
```

### Production Environment
```bash
NODE_ENV=production
STRICT_SCOPE_VALIDATION=true
DEBUG_SCOPES=false
DEBUG_TOKENS=false
DEFAULT_USER_TYPE=readonly
SCOPE_VALIDATION_TIMEOUT=10000
CACHE_TOKEN_VALIDATION=true
TOKEN_CACHE_TTL=600
```

## OAuth Provider Configuration

### PingOne AI IAM Core setup

#### Admin Client Configuration
1. **Client Type**: Confidential
2. **Grant Types**: Authorization Code
3. **Scopes**: 
   - Standard: `openid`, `profile`, `email`
   - Banking: `banking:admin`, `banking:read`, `banking:write`, `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write`
4. **Redirect URIs**: `http://localhost:3001/api/auth/oauth/callback` (development)

#### End User Client Configuration
1. **Client Type**: Confidential
2. **Grant Types**: Authorization Code
3. **Scopes**:
   - Standard: `openid`, `profile`, `email`
   - Banking: `banking:read`, `banking:write`, `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write`
4. **Redirect URIs**: `http://localhost:3001/api/auth/oauth/user/callback` (development)

#### AI Agent Client Configuration
1. **Client Type**: Confidential
2. **Grant Types**: Client Credentials, Authorization Code
3. **Scopes**:
   - Standard: `openid`, `profile`
   - Special: `ai_agent`
   - Banking: `banking:read`, `banking:write`, `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write`

### Scope Assignment by User Role

Configure your OAuth provider to assign scopes based on user roles:

```javascript
// Example PingOne Core scope assignment script
if (user.role === 'admin') {
  token.scope = 'openid profile email banking:admin banking:read banking:write banking:accounts:read banking:transactions:read banking:transactions:write';
} else if (user.role === 'customer') {
  token.scope = 'openid profile email banking:read banking:write banking:accounts:read banking:transactions:read banking:transactions:write';
} else if (user.role === 'readonly') {
  token.scope = 'openid profile email banking:read banking:accounts:read banking:transactions:read';
}
```

## Route-to-Scope Mapping

### Account Routes
- `GET /api/accounts/*` → Requires: `banking:accounts:read` OR `banking:read`
- `POST /api/accounts` → Requires: `banking:write`
- `PUT /api/accounts/*` → Requires: `banking:write`
- `DELETE /api/accounts/*` → Requires: `banking:write`

### Transaction Routes
- `GET /api/transactions/*` → Requires: `banking:transactions:read` OR `banking:read`
- `POST /api/transactions/*` → Requires: `banking:transactions:write` OR `banking:write`
- `PUT /api/transactions/*` → Requires: `banking:transactions:write` OR `banking:write`
- `DELETE /api/transactions/*` → Requires: `banking:transactions:write` OR `banking:write`

### Admin Routes
- `* /api/admin/*` → Requires: `banking:admin`

### User Routes
- `GET /api/users/*` → Requires: `banking:read`
- `POST /api/users` → Requires: `banking:write`
- `PUT /api/users/*` → Requires: `banking:write`
- `DELETE /api/users/*` → Requires: `banking:write`

## Testing Scope Configuration

### Test User Types

Create test users with different scope assignments:

1. **Admin Test User**
   - Username: `admin@test.com`
   - Scopes: All banking scopes including `banking:admin`

2. **Customer Test User**
   - Username: `customer@test.com`
   - Scopes: All banking scopes except `banking:admin`

3. **Read-Only Test User**
   - Username: `readonly@test.com`
   - Scopes: Only read scopes (`banking:read`, `banking:accounts:read`, `banking:transactions:read`)

4. **AI Agent Test Client**
   - Client ID: `test-ai-agent`
   - Scopes: `ai_agent` plus all banking scopes

### Validation Commands

Test scope assignments using the provided test scripts:

```bash
# Test admin scopes
npm run test:admin-scopes

# Test transaction scopes
npm run test:transaction-scopes

# Test scope integration
npm run test:scope-integration
```

## Troubleshooting

### Common Issues

1. **403 Forbidden - Insufficient Scope**
   - Check user's assigned scopes in OAuth provider
   - Verify route-to-scope mapping is correct
   - Ensure token contains required scopes

2. **401 Unauthorized - Invalid Token**
   - Verify OAuth provider configuration
   - Check token expiration
   - Validate client credentials

3. **Scope Not Recognized**
   - Ensure scope is defined in OAuth provider
   - Check scope spelling and format
   - Verify environment configuration

### Debug Mode

Enable debug mode for detailed scope validation logging:

```bash
DEBUG_SCOPES=true
DEBUG_TOKENS=true
NODE_ENV=development
```

### Monitoring

Monitor scope usage and failures:

```bash
# Check OAuth monitoring logs
tail -f logs/oauth-monitor.log

# Check scope validation logs
grep "SCOPE_VALIDATION" logs/app.log
```

## Security Considerations

1. **Principle of Least Privilege**: Assign minimum required scopes
2. **Environment Separation**: Use different scope configurations per environment
3. **Token Expiration**: Configure appropriate token lifetimes
4. **Scope Validation**: Enable strict validation in production
5. **Audit Logging**: Monitor scope usage and access patterns

## Migration from JWT to OAuth Scopes

If migrating from JWT-based authentication:

1. **Phase 1**: Run both systems in parallel
2. **Phase 2**: Migrate UI to use OAuth tokens
3. **Phase 3**: Remove JWT generation code
4. **Phase 4**: Clean up JWT dependencies

See the main OAuth Token Migration specification for detailed migration steps.