# Admin Scope Authorization

This document describes the implementation of admin scope authorization for the banking API server.

## Overview

The banking API server now implements scope-based authorization for admin operations, requiring the `banking:admin` scope for OAuth tokens in addition to the existing role-based authorization for local JWT tokens.

## Implementation Details

### Updated `requireAdmin` Middleware

The `requireAdmin` middleware has been enhanced to support both OAuth tokens and local JWT tokens:

- **OAuth Tokens**: Must have the `banking:admin` scope
- **Local JWT Tokens**: Must have the `admin` role (backward compatibility)

### Admin Routes Protected

All admin routes now require the `banking:admin` scope for OAuth tokens:

- `GET /api/admin/stats` - System statistics
- `GET /api/admin/activity` - Activity logs with pagination and filtering
- `GET /api/admin/activity/user/:username` - User-specific activity logs
- `GET /api/admin/activity/userid/:userId` - User ID-specific activity logs
- `GET /api/admin/activity/recent` - Recent activity (last 24 hours)
- `GET /api/admin/activity/summary` - Activity summary by action type
- `GET /api/admin/activity/users/summary` - User activity summary
- `DELETE /api/admin/activity/clear` - Clear old activity logs
- `GET /api/admin/activity/export` - Export activity logs as CSV

### Error Responses

#### OAuth Token Without `banking:admin` Scope

```json
{
  "error": "insufficient_scope",
  "error_description": "Admin access requires banking:admin scope",
  "required_scopes": ["banking:admin"],
  "provided_scopes": ["banking:read", "banking:write"]
}
```

#### Local JWT Token Without Admin Role

```json
{
  "error": "Admin access required"
}
```

## Testing

### Automated Tests

The implementation includes comprehensive tests in `src/__tests__/scope-integration.test.js`:

- OAuth tokens with `banking:admin` scope should be granted access
- OAuth tokens without `banking:admin` scope should be denied access
- Local JWT tokens with admin role should be granted access (backward compatibility)
- Local JWT tokens without admin role should be denied access
- Mixed scenarios (admin role without scope, scope without role)

### Manual Testing

A test script `test-admin-scopes.js` is provided to manually verify the admin scope authorization:

```bash
# Start the server first
npm start

# In another terminal, run the test script
node test-admin-scopes.js
```

## Migration Notes

### For OAuth Tokens

- Admin operations now require the `banking:admin` scope
- The admin role in `realm_access.roles` is no longer sufficient for OAuth tokens
- OAuth providers must be configured to issue tokens with the `banking:admin` scope for admin users

### For Local JWT Tokens

- No changes required - existing role-based authorization continues to work
- Local JWT tokens with `role: 'admin'` will continue to have admin access

## Security Considerations

1. **Principle of Least Privilege**: The `banking:admin` scope should only be granted to users who need administrative access
2. **Scope Validation**: All admin routes now perform strict scope validation for OAuth tokens
3. **Backward Compatibility**: Local JWT tokens continue to work during the migration period
4. **Error Information**: Detailed error responses help with troubleshooting while not exposing sensitive information

## Configuration

Ensure your OAuth provider is configured to:

1. Issue tokens with the `banking:admin` scope for admin users
2. Map user roles to appropriate scopes
3. Configure scope-to-permission mappings according to your security requirements

## Requirements Satisfied

This implementation satisfies the following requirements from the OAuth token migration spec:

- **4.1**: Admin UI endpoints require `banking:admin` scope
- **4.2**: User management endpoints require `banking:admin` scope  
- **4.3**: Tokens lacking admin scope for admin operations return 403 Forbidden