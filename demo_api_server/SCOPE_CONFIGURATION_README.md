# Banking API Scope Configuration


## See Also

- [SCOPE_VOCABULARY.md](SCOPE_VOCABULARY.md) — Canonical scope registry
- [OAUTH_SCOPE_CONFIGURATION.md](OAUTH_SCOPE_CONFIGURATION.md) — PingOne setup
- [SCOPE_AUTHORIZATION.md](SCOPE_AUTHORIZATION.md) — Enforcement patterns

This document provides a quick reference for the OAuth scope-based authorization system implemented in the Banking API.

## Quick Start

### 1. Environment Setup

Copy the appropriate environment file for your setup:

```bash
# Development
cp .env.development .env

# Test
cp .env.test .env

# Production
cp .env.production .env
```

### 2. Configure OAuth Provider

Use the generated script from the test output to configure your OAuth provider (PingOne Core) to issue tokens with appropriate scopes.

### 3. Test Configuration

Run the scope configuration tests:

```bash
# Test scope assignments
npm run test:scope-assignments

# Test OAuth provider configuration
npm run test:oauth-provider-scopes

# Test existing OAuth integration
npm run test:oauth
```

## Banking Scopes Reference

| Scope | Description | User Types |
|-------|-------------|------------|
| `banking:accounts:read` | View bank accounts and balances | admin, customer, readonly |
| `banking:transactions:read` | View transaction history | admin, customer, readonly |
| `banking:read` | General banking read access | admin, customer, readonly |
| `banking:transactions:write` | Create deposits, withdrawals, transfers | admin, customer |
| `banking:write` | General banking write access | admin, customer |
| `banking:admin` | Full administrative access | admin |
| `ai_agent` | AI agent identification | ai_agent |

## User Type Configurations

### Admin Users
- **Scopes**: All banking scopes including `banking:admin`
- **Access**: Full system access including administrative functions
- **OAuth Client**: Admin client configuration

### Customer Users
- **Scopes**: All banking scopes except `banking:admin`
- **Access**: Full banking operations but no administrative access
- **OAuth Client**: End user client configuration

### Read-Only Users
- **Scopes**: Only read scopes
- **Access**: View-only access to banking data
- **OAuth Client**: End user client configuration

### AI Agents
- **Scopes**: `ai_agent` plus all banking scopes except `banking:admin`
- **Access**: Full banking operations with AI agent identification
- **OAuth Client**: AI agent client configuration

## Environment Variables

### Core Configuration
```bash
NODE_ENV=development|test|staging|production
DEFAULT_USER_TYPE=customer
```

### Scope Validation
```bash
STRICT_SCOPE_VALIDATION=true
SCOPE_VALIDATION_TIMEOUT=10000
CACHE_TOKEN_VALIDATION=true
TOKEN_CACHE_TTL=600
```

### Debug Settings (Development Only)
```bash
DEBUG_SCOPES=true
DEBUG_TOKENS=true
SKIP_TOKEN_SIGNATURE_VALIDATION=true
```

## Route Protection

Routes are automatically protected based on the scope mappings defined in `config/scopes.js`:

- **Account routes** → `banking:accounts:read` or `banking:read`
- **Transaction routes** → `banking:transactions:read/write` or `banking:read/write`
- **Admin routes** → `banking:admin`
- **User routes** → `banking:read/write`

## Testing

### Available Test Scripts

```bash
# Test scope assignments for user types
npm run test:scope-assignments

# Test OAuth provider scope configuration
npm run test:oauth-provider-scopes

# Test existing OAuth integration
npm run test:oauth

# Test admin scopes specifically
npm run test:admin-scopes

# Test transaction scopes specifically
npm run test:transaction-scopes
```

### Test User Accounts

Create these test users in your OAuth provider:

1. **admin@test.com** - Admin user with all scopes
2. **customer@test.com** - Customer user with banking scopes
3. **readonly@test.com** - Read-only user with read scopes only
4. **ai-agent** - AI agent client with ai_agent scope

## OAuth Provider Configuration

### PingOne Core Setup

Add this script to your PingOne Core token customization:

```javascript
function customizeToken(token, user, client) {
  const standardScopes = ['openid', 'profile', 'email'];
  let bankingScopes = [];
  
  if (user.role === 'admin') {
    bankingScopes = [
      'banking:admin',
      'banking:read',
      'banking:write',
      'banking:accounts:read',
      'banking:transactions:read',
      'banking:transactions:write'
    ];
  } else if (user.role === 'customer') {
    bankingScopes = [
      'banking:read',
      'banking:write',
      'banking:accounts:read',
      'banking:transactions:read',
      'banking:transactions:write'
    ];
  } else if (user.role === 'readonly') {
    bankingScopes = [
      'banking:read',
      'banking:accounts:read',
      'banking:transactions:read'
    ];
  }
  
  if (client.clientId.includes('ai') || client.clientId.includes('mcp')) {
    bankingScopes.push('ai_agent');
  }
  
  token.scope = [...standardScopes, ...bankingScopes].join(' ');
  return token;
}
```

## Troubleshooting

### Common Issues

1. **403 Forbidden - Insufficient Scope**
   - Check user's role in OAuth provider
   - Verify scope assignment script is active
   - Run `npm run test:oauth-provider-scopes` to validate

2. **Invalid Scope Errors**
   - Ensure scopes are defined in OAuth provider
   - Check spelling and format
   - Verify environment configuration

3. **Token Validation Failures**
   - Check OAuth provider connectivity
   - Verify client credentials
   - Enable debug mode: `DEBUG_TOKENS=true`

### Debug Mode

Enable comprehensive debugging:

```bash
NODE_ENV=development
DEBUG_SCOPES=true
DEBUG_TOKENS=true
SKIP_TOKEN_SIGNATURE_VALIDATION=true
```

## Files Reference

- `config/scopes.js` - Main scope configuration
- `OAUTH_SCOPE_CONFIGURATION.md` - Detailed configuration guide
- `test-scope-assignments.js` - Scope assignment tests
- `test-oauth-provider-scopes.js` - OAuth provider tests
- `.env.development` - Development environment config
- `.env.test` - Test environment config
- `.env.production` - Production environment config

## Migration Notes

This configuration is part of the OAuth Token Migration (Task 14). It provides:

1. ✅ Scope configuration mapping for different environments
2. ✅ Environment variable documentation for OAuth scope requirements
3. ✅ OAuth provider configuration for appropriate banking scopes
4. ✅ Testing for scope assignment for different user types

The configuration is now ready for production use and fully tested.