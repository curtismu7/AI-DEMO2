# Enhanced OAuth Error Handling

This document describes the enhanced error handling implementation for OAuth authorization in the Banking API server.

## Overview

The enhanced error handling provides detailed, actionable error responses for OAuth authentication and authorization failures. It includes specific error types, detailed descriptions, and helpful hints for resolving issues.

## Key Features

### 1. Detailed Error Responses for Missing Scopes

When a request lacks required OAuth scopes, the system returns comprehensive error information:

```json
{
  "error": "insufficient_scope",
  "error_description": "Access denied. At least one of the following scopes is required: banking:admin",
  "requiredScopes": ["banking:admin"],
  "providedScopes": ["banking:read", "banking:write"],
  "missingScopes": ["banking:admin"],
  "validationMode": "any_required",
  "hint": "Ensure your token includes at least one of the required scopes",
  "timestamp": "2025-10-01T12:00:00.000Z",
  "path": "/api/admin/stats",
  "method": "GET"
}
```

### 2. Specific Error Handling for Invalid/Expired Tokens

The system distinguishes between different token validation failures:

- **Malformed tokens**: Returns `malformed_token` error
- **Expired tokens**: Returns `expired_token` error with expiration details
- **Invalid tokens**: Returns `invalid_token` error with helpful hints

### 3. OAuth Provider Unavailability Handling

When the OAuth provider is unavailable, the system provides graceful degradation:

```json
{
  "error": "provider_unavailable",
  "error_description": "OAuth provider is temporarily unavailable",
  "hint": "Please try again later",
  "provider_error": "Connection timeout"
}
```

## Error Types

The system defines the following OAuth error types:

- `authentication_required`: Missing or no token provided
- `invalid_token`: Token is invalid or malformed
- `expired_token`: Token has expired
- `insufficient_scope`: Token lacks required scopes
- `malformed_token`: Token format is invalid
- `provider_unavailable`: OAuth provider is unreachable
- `token_introspection_failed`: Token validation service failed

## Implementation Details

### Core Components

1. **OAuthError Class**: Standardized error object with type, message, and additional data
2. **Enhanced Middleware**: Updated authentication and authorization middleware
3. **Error Handler**: Centralized OAuth error handling middleware
4. **Health Monitoring**: OAuth provider health check integration

### Testing

Run the enhanced error handling tests:

```bash
npm test -- --testPathPattern=oauth-error-handling.test.js
```

### Demo

Run the demonstration script to see enhanced error handling in action:

```bash
node demo-enhanced-error-handling.js
```

## Benefits

- **Better Developer Experience**: Clear, actionable error messages
- **Improved Debugging**: Request tracking and detailed context
- **Consistent Format**: Standardized error responses across all endpoints
- **Graceful Degradation**: Handles OAuth provider outages gracefully
- **Security**: Appropriate error details without exposing sensitive information