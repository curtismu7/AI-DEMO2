# OAuth Client Credentials API Documentation

## Overview

This document provides comprehensive API documentation for the OAuth 2.0 client credentials implementation in the Super Banking API. It includes all endpoints, request/response formats, error handling, and usage examples.

## Base URL

```
Production: https://api.banking-demo.com
Development: http://localhost:3001
```

## Authentication

All OAuth endpoints use HTTP Basic Authentication with the client credentials:

```
Authorization: Basic <base64(client_id:client_secret)>
```

## OAuth Endpoints

### Client Registration

#### Register New OAuth Client

```http
POST /api/oauth/clients
Authorization: Bearer <admin_access_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "My Banking Integration",
  "description": "Integration for account management",
  "scopes": ["banking:read", "banking:write"],
  "redirect_uris": ["https://myapp.com/callback"],
  "grant_types": ["client_credentials"]
}
```

**Response (201 Created):**
```json
{
  "client_id": "client_1234567890abcdef",
  "client_secret": "secret_abcdef1234567890",
  "client_id_issued_at": 1704067200,
  "client_secret_expires_at": 0,
  "registration_access_token": "token_abcdef1234567890",
  "registration_client_uri": "/api/oauth/clients/client_1234567890abcdef",
  "client_name": "My Banking Integration",
  "client_description": "Integration for account management",
  "scope": "banking:read banking:write",
  "grant_types": ["client_credentials"],
  "redirect_uris": ["https://myapp.com/callback"],
  "created_at": "2024-01-01T12:00:00.000Z",
  "updated_at": "2024-01-01T12:00:00.000Z"
}
```

#### Get Client Information

```http
GET /api/oauth/clients/{clientId}
Authorization: Bearer <registration_access_token>
```

**Response (200 OK):**
```json
{
  "client_id": "client_1234567890abcdef",
  "client_name": "My Banking Integration",
  "client_description": "Integration for account management",
  "scope": "banking:read banking:write",
  "grant_types": ["client_credentials"],
  "redirect_uris": ["https://myapp.com/callback"],
  "created_at": "2024-01-01T12:00:00.000Z",
  "updated_at": "2024-01-01T12:00:00.000Z"
}
```

#### Update Client Registration

```http
PUT /api/oauth/clients/{clientId}
Authorization: Bearer <registration_access_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Updated Integration Name",
  "description": "Updated description",
  "scopes": ["banking:read"],
  "redirect_uris": ["https://myapp.com/callback"]
}
```

#### Delete Client Registration

```http
DELETE /api/oauth/clients/{clientId}
Authorization: Bearer <registration_access_token>
```

**Response (204 No Content)**

#### Rotate Client Secret

```http
POST /api/oauth/clients/{clientId}/secret
Authorization: Bearer <registration_access_token>
```

**Response (200 OK):**
```json
{
  "client_id": "client_1234567890abcdef",
  "client_secret": "new_secret_abcdef1234567890",
  "client_secret_expires_at": 0,
  "rotated_at": "2024-01-01T12:00:00.000Z"
}
```

### Token Endpoint

#### Request Access Token

```http
POST /api/oauth/token
Authorization: Basic <base64(client_id:client_secret)>
Content-Type: application/x-www-form-urlencoded
```

**Request Body:**
```
grant_type=client_credentials&scope=banking:read banking:write
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6I...",
  "token_type": "Bearer",
  "expires_in": 1800,
  "scope": "banking:read banking:write",
  "issued_at": "2024-01-01T12:00:00.000Z"
}
```

#### Token Introspection

```http
POST /api/oauth/introspect
Authorization: Basic <base64(client_id:client_secret)>
Content-Type: application/x-www-form-urlencoded
```

**Request Body:**
```
token=<access_token>
```

**Response (200 OK):**
```json
{
  "active": true,
  "client_id": "client_1234567890abcdef",
  "scope": "banking:read banking:write",
  "exp": 1704069000,
  "iat": 1704067200,
  "iss": "https://api.banking-demo.com",
  "sub": "client_1234567890abcdef"
}
```

#### Token Revocation

```http
POST /api/oauth/revoke
Authorization: Basic <base64(client_id:client_secret)>
Content-Type: application/x-www-form-urlencoded
```

**Request Body:**
```
token=<access_token>&token_type_hint=access_token
```

**Response (200 OK):**
```json
{
  "revoked": true,
  "revoked_at": "2024-01-01T12:00:00.000Z"
}
```

### Token Management

#### Get Token Statistics

```http
GET /api/oauth/token/stats
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "total_tokens_issued": 1000,
  "active_tokens": 250,
  "expired_tokens": 750,
  "revoked_tokens": 50,
  "tokens_by_client": {
    "client_1234567890abcdef": 100,
    "client_abcdef1234567890": 150
  },
  "average_token_lifetime": 1200,
  "most_requested_scopes": [
    "banking:read",
    "banking:write",
    "admin:read"
  ]
}
```

#### Cleanup Expired Tokens

```http
POST /api/oauth/token/cleanup
Authorization: Bearer <admin_access_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "older_than": "7d"
}
```

**Response (200 OK):**
```json
{
  "cleaned_tokens": 150,
  "cleanup_timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Migration Endpoints

### Migration Status

```http
GET /api/migration/status
```

**Response (200 OK):**
```json
{
  "current_phase": "transition",
  "phase_description": "Both PATs and OAuth supported with warnings",
  "pat_support": "full",
  "oauth_support": "full",
  "warnings_enabled": true,
  "deprecation_date": "2024-03-31T23:59:59.999Z",
  "statistics": {
    "total_requests": 10000,
    "pat_requests": 3000,
    "oauth_requests": 7000,
    "pat_warnings": 1500,
    "pat_rejections": 100,
    "migration_progress": 0.7
  },
  "last_updated": "2024-01-01T12:00:00.000Z"
}
```

### Migration Dashboard

```http
GET /api/migration/dashboard
Authorization: Bearer <admin_access_token>
```

**Response (200 OK):**
```json
{
  "summary": {
    "total_integrations": 100,
    "oauth_migrated": 75,
    "pat_remaining": 25,
    "migration_progress_percentage": 75,
    "pat_warnings_issued": 1500,
    "pat_rejections": 100
  },
  "statistics": {
    "usage_patterns": {
      "daily_requests": {
        "oauth": [700, 750, 800, 720, 780],
        "pat": [300, 250, 200, 280, 220]
      },
      "error_rates": {
        "oauth": 0.02,
        "pat": 0.05
      }
    },
    "trends": {
      "migration_velocity": 5.2,
      "adoption_rate": 0.15
    }
  },
  "health": {
    "status": "healthy",
    "issues": []
  },
  "recommendations": [
    {
      "priority": "medium",
      "action": "Complete migration before enforcement date",
      "description": "PAT enforcement approaching in 60 days"
    }
  ]
}
```

### Migration Guide

```http
GET /api/migration/guide
```

**Response (200 OK):**
```json
{
  "title": "Migration Guide: Personal Access Tokens to OAuth Client Credentials",
  "current_phase": "transition",
  "urgency": {
    "level": "medium",
    "message": "Begin migrating to OAuth client credentials"
  },
  "steps": [
    {
      "step": 1,
      "title": "Register OAuth Client",
      "description": "Register your integration as an OAuth client",
      "endpoint": "/api/oauth/clients",
      "method": "POST"
    }
  ],
  "timeline": {
    "current_phase": {
      "name": "transition",
      "description": "Both methods supported with warnings"
    },
    "upcoming_phases": [
      {
        "name": "deprecation",
        "description": "PATs deprecated with clear timeline"
      }
    ]
  }
}
```

## Security Monitoring Endpoints

### Security Dashboard

```http
GET /api/security/dashboard
Authorization: Bearer <admin_access_token>
```

**Response (200 OK):**
```json
{
  "summary": {
    "total_alerts": 25,
    "critical_alerts": 3,
    "active_clients": 100,
    "security_score": 85.5
  },
  "alerts": [
    {
      "id": "alert_123456",
      "title": "Unusual IP Pattern Detected",
      "description": "Client accessed from 10 different IPs",
      "severity": "warning",
      "client_id": "client_1234567890abcdef",
      "status": "active",
      "timestamp": "2024-01-01T12:00:00.000Z"
    }
  ],
  "anomalies": [
    {
      "type": "unusual_ip_pattern",
      "severity": "warning",
      "description": "Multiple IP addresses for single client",
      "evidence": {
        "client_id": "client_1234567890abcdef",
        "ip_count": 10,
        "timeframe": "1h"
      }
    }
  ],
  "metrics": {
    "total_events": 10000,
    "anomalies_detected": 150,
    "alerts_generated": 25,
    "clients_monitored": 100
  }
}
```

### Security Alerts

```http
GET /api/security/alerts?severity=warning&status=active&limit=50&offset=0
Authorization: Bearer <admin_access_token>
```

**Response (200 OK):**
```json
{
  "alerts": [
    {
      "id": "alert_123456",
      "title": "High-Risk Scope Usage",
      "description": "Client accessing admin:delete scope",
      "severity": "critical",
      "client_id": "client_1234567890abcdef",
      "status": "active",
      "timestamp": "2024-01-01T12:00:00.000Z",
      "evidence": {
        "scope": "admin:delete",
        "endpoint": "/api/admin/users/123",
        "ip": "192.168.1.100"
      }
    }
  ],
  "total": 25,
  "limit": 50,
  "offset": 0,
  "filters": {
    "severity": "warning",
    "status": "active"
  }
}
```

### Resolve Security Alert

```http
POST /api/security/alerts/{alertId}/resolve
Authorization: Bearer <admin_access_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "resolution_note": "Investigated and confirmed legitimate activity",
  "action_taken": "Contacted client and verified usage"
}
```

**Response (200 OK):**
```json
{
  "message": "Security alert resolved successfully",
  "alert": {
    "id": "alert_123456",
    "status": "resolved",
    "resolved_by": "admin_user",
    "resolved_at": "2024-01-01T12:30:00.000Z",
    "resolution_note": "Investigated and confirmed legitimate activity",
    "action_taken": "Contacted client and verified usage"
  }
}
```

## Error Handling

### Standard Error Response Format

All OAuth endpoints return errors in the following format:

```json
{
  "error": "error_code",
  "error_description": "Human-readable error description",
  "error_uri": "https://docs.banking-api.com/oauth/errors#error_code",
  "state": "client_provided_state"
}
```

### Common Error Codes

#### Client Registration Errors

| Error Code | Description | HTTP Status |
|------------|-------------|-------------|
| `invalid_client_metadata` | Invalid client metadata provided | 400 |
| `client_already_exists` | Client with this name already exists | 409 |
| `unauthorized_client` | Not authorized to register clients | 403 |
| `access_denied` | Access denied by administrator | 403 |

#### Token Endpoint Errors

| Error Code | Description | HTTP Status |
|------------|-------------|-------------|
| `invalid_request` | Invalid request parameters | 400 |
| `invalid_client` | Client authentication failed | 401 |
| `invalid_grant` | Invalid grant type | 400 |
| `unauthorized_client` | Client not authorized for grant type | 403 |
| `unsupported_grant_type` | Grant type not supported | 400 |
| `invalid_scope` | Invalid or unsupported scope | 400 |
| `insufficient_scope` | Insufficient scope for requested resource | 403 |

#### Token Introspection Errors

| Error Code | Description | HTTP Status |
|------------|-------------|-------------|
| `invalid_request` | Missing token parameter | 400 |
| `invalid_token` | Token is invalid or expired | 200 (active: false) |

### Error Response Examples

#### 400 Bad Request
```json
{
  "error": "invalid_request",
  "error_description": "Missing required parameter: grant_type",
  "error_uri": "https://docs.banking-api.com/oauth/errors#invalid_request"
}
```

#### 401 Unauthorized
```json
{
  "error": "invalid_client",
  "error_description": "Client authentication failed",
  "error_uri": "https://docs.banking-api.com/oauth/errors#invalid_client"
}
```

#### 403 Forbidden
```json
{
  "error": "unauthorized_client",
  "error_description": "Client not authorized for this grant type",
  "error_uri": "https://docs.banking-api.com/oauth/errors#unauthorized_client"
}
```

## Rate Limiting

### Rate Limit Headers

All API responses include rate limiting headers:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1704067200
X-RateLimit-Retry-After: 60
```

### Rate Limits by Endpoint

| Endpoint | Requests/Minute | Burst Limit |
|----------|------------------|-------------|
| POST /api/oauth/token | 60 | 10 |
| POST /api/oauth/clients | 10 | 5 |
| GET /api/oauth/clients/{id} | 100 | 20 |
| POST /api/oauth/introspect | 100 | 20 |
| POST /api/oauth/revoke | 60 | 10 |

## SDK Examples

### Node.js SDK

```javascript
const { BankingOAuthClient } = require('@bx-finance/sdk');

const client = new BankingOAuthClient({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  baseURL: 'https://api.banking-demo.com',
  scopes: ['banking:read', 'banking:write']
});

// Get access token
const token = await client.getAccessToken();

// Make API call
const accounts = await client.getAccounts();
```

### Python SDK

```python
from bx_finance_sdk import OAuthClient, BankingAPI

client = OAuthClient(
    client_id=os.getenv('CLIENT_ID'),
    client_secret=os.getenv('CLIENT_SECRET'),
    base_url='https://api.banking-demo.com',
    scopes=['banking:read', 'banking:write']
)

api = BankingAPI(client)
accounts = api.get_accounts()
```

### cURL Examples

#### Register Client
```bash
curl -X POST https://api.banking-demo.com/api/oauth/clients \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "scopes": ["banking:read", "banking:write"],
    "grant_types": ["client_credentials"]
  }'
```

#### Get Access Token
```bash
curl -X POST https://api.banking-demo.com/api/oauth/token \
  -u "client_id:client_secret" \
  -d "grant_type=client_credentials&scope=banking:read banking:write"
```

#### Make API Call
```bash
curl -X GET https://api.banking-demo.com/api/accounts/my \
  -H "Authorization: Bearer <access_token>"
```

## Testing

### Test Environment

The test environment is available at:
```
https://test-api.banking-demo.com
```

### Test Credentials

Test clients can be registered using the test admin token:
```
test_admin_token_1234567890abcdef
```

### Automated Testing

Use the provided testing tools:

```bash
# Run full test suite
node oauthTestTools.js --baseURL https://test-api.banking-demo.com \
  --clientId test_client \
  --clientSecret test_secret \
  --scopes banking:read,banking:write \
  --iterations 100
```

## Support

### Documentation
- **Main Documentation**: https://docs.banking-api.com
- **OAuth Guide**: https://docs.banking-api.com/oauth
- **Migration Guide**: https://docs.banking-api.com/migration

### Support Channels
- **Email**: support@banking-api.com
- **Developer Forum**: https://community.banking-api.com
- **Status Page**: https://status.banking-api.com

### API Health Check
```bash
curl https://api.banking-demo.com/health
```

## Changelog

### v1.0.0 (2024-01-01)
- Initial OAuth 2.0 client credentials implementation
- Client registration and management
- Token endpoint with introspection and revocation
- Migration layer for PAT to OAuth transition
- Security monitoring and alerting
- Comprehensive documentation and testing tools

---

For additional information or support, contact our development team at devsupport@banking-api.com.
