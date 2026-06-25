# Scope-Based Authorization


> **📚 Scope Definitions:** For canonical scope names and resource server mapping, see [SCOPE_VOCABULARY.md](SCOPE_VOCABULARY.md).
> This guide covers **enforcement patterns and middleware usage**.

This document describes the scope-based authorization system implemented for the banking API server.

## Overview

The system uses OAuth access tokens with specific scopes to control access to different API endpoints. This provides fine-grained access control beyond simple role-based authorization.

## Available Scopes

### Read Scopes
- `banking:accounts:read` - View bank accounts and balances
- `banking:transactions:read` - View transaction history  
- `banking:read` - General banking read access (includes accounts and transactions)

### Write Scopes
- `banking:transactions:write` - Create deposits, withdrawals, transfers
- `banking:write` - General banking write access (includes all write operations)

### Administrative Scopes
- `banking:admin` - Full administrative access to all APIs and admin UI

## Usage

### Basic Scope Requirement

```javascript
const { requireScopes } = require('../middleware/auth');

// Require a single scope
router.get('/api/accounts', authenticateToken, requireScopes(['banking:accounts:read']), (req, res) => {
  // Handler code
});

// Require any of multiple scopes (OR logic)
router.get('/api/accounts', authenticateToken, requireScopes(['banking:accounts:read', 'banking:read']), (req, res) => {
  // Handler code
});
```

### Requiring All Scopes (AND Logic)

```javascript
// Require ALL specified scopes
router.post('/api/admin/users', authenticateToken, requireScopes(['banking:admin', 'banking:write'], true), (req, res) => {
  // Handler code
});
```

### Route-to-Scope Mapping

The system includes a predefined mapping of routes to required scopes:

```javascript
const ROUTE_SCOPE_MAP = {
  'GET /api/accounts': ['banking:accounts:read', 'banking:read'],
  'POST /api/accounts': ['banking:write'],
  'GET /api/transactions': ['banking:transactions:read', 'banking:read'],
  'POST /api/transactions': ['banking:transactions:write', 'banking:write'],
  'GET /api/admin/*': ['banking:admin'],
  // ... more mappings
};
```

## Error Responses

### Insufficient Scope (403)

```json
{
  "error": "insufficient_scope",
  "error_description": "The request requires higher privileges than provided by the access token",
  "required_scopes": ["banking:admin"],
  "provided_scopes": ["banking:read"]
}
```

### Authentication Required (401)

```json
{
  "error": "authentication_required",
  "error_description": "Authentication required to access this resource"
}
```

## Backward Compatibility

The system maintains backward compatibility with existing local JWT tokens. When a local JWT token is detected (`tokenType: 'local_jwt'`), scope validation is skipped and the request proceeds using the existing role-based authorization.

## Testing

Comprehensive unit tests are available in `src/__tests__/auth.test.js` covering:

- Scope parsing from OAuth tokens
- Scope validation logic (OR and AND logic)
- Middleware behavior with various scenarios
- Route-to-scope mapping validation
- Integration scenarios

Run tests with:

```bash
npm test
```

## Implementation Details

### Token Scope Parsing

OAuth tokens can contain scopes in two formats:
- String format: `"banking:read banking:write banking:admin"`
- Array format: `["banking:read", "banking:write", "banking:admin"]`

The `parseTokenScopes()` function handles both formats automatically.

### Scope Validation

The `hasRequiredScopes()` function supports two modes:
- **OR Logic** (default): User needs at least one of the required scopes
- **AND Logic**: User needs all of the required scopes

### Middleware Integration

The `requireScopes()` middleware integrates seamlessly with the existing authentication flow:

1. `authenticateToken` validates the token and populates `req.user`
2. `requireScopes` checks if the user has the necessary scopes
3. Request proceeds to the route handler if authorized

## Examples

### Read-Only Access

```javascript
// User with 'banking:read' scope can access:
GET /api/accounts        ✓
GET /api/transactions    ✓
GET /api/users/me        ✓

// But cannot access:
POST /api/accounts       ✗
POST /api/transactions   ✗
GET /api/admin/*         ✗
```

### Write Access

```javascript
// User with 'banking:write' scope can access:
POST /api/accounts       ✓
PUT /api/accounts/:id    ✓
POST /api/transactions   ✓

// But cannot access:
GET /api/admin/*         ✗
```

### Admin Access

```javascript
// User with 'banking:admin' scope can access:
GET /api/admin/*         ✓
POST /api/admin/*        ✓
PUT /api/admin/*         ✓
DELETE /api/admin/*      ✓
```

### Granular Access

```javascript
// User with 'banking:accounts:read' and 'banking:transactions:write':
GET /api/accounts        ✓ (has banking:accounts:read)
GET /api/accounts/my     ✓ (has banking:accounts:read)
POST /api/transactions   ✓ (has banking:transactions:write)

GET /api/transactions    ✗ (needs banking:transactions:read or banking:read)
POST /api/accounts       ✗ (needs banking:write)
```