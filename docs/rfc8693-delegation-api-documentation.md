# RFC 8693 Delegation Claims API Documentation

## Overview

This API provides comprehensive RFC 8693 delegation claims validation and management capabilities. The API ensures proper delegation patterns with correct `may_act` and `act` claim structures, maintains delegation chain integrity, and provides extensive monitoring and audit capabilities.

## Base URL

```
Production: https://banking-api.pingdemo.com/api/delegation
Development: https://dev-banking-api.pingdemo.com/api/delegation
```

## Authentication

All API endpoints require valid OAuth 2.0 authentication with appropriate scopes:

- `delegation:validate` - Validate delegation claims
- `delegation:admin` - Administrative delegation operations
- `admin:read` - Read administrative data

## Endpoints

### 1. Token Validation

#### Validate User Token

```http
POST /api/delegation/validate/user
```

Validates user token delegation claims according to RFC 8693 standards.

**Request Body**:
```json
{
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "strict": true,
  "autoFix": false
}
```

**Parameters**:
- `token` (string, required): JWT token to validate
- `strict` (boolean, optional): Enable strict validation mode (default: true)
- `autoFix` (boolean, optional): Auto-fix minor issues (default: false)

**Response**:
```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "normalized": {
    "sub": "user-12345",
    "may_act": {
      "sub": "https://banking-agent.pingdemo.com/agent/test-agent"
    }
  },
  "metadata": {
    "validationTimestamp": "2024-01-01T12:00:00.000Z",
    "tokenType": "user"
  }
}
```

**Error Response**:
```json
{
  "error": "DELEGATION_020",
  "message": "Missing may_act claim in user token",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "requestId": "req-123456",
  "errors": ["Missing may_act claim"],
  "warnings": []
}
```

#### Validate Exchanged Token

```http
POST /api/delegation/validate/exchanged
```

Validates exchanged token delegation claims and act claim structure.

**Request Body**:
```json
{
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "strict": true,
  "autoFix": false
}
```

**Response**:
```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "normalized": {
    "sub": "user-12345",
    "act": {
      "sub": "https://mcp-server.pingdemo.com/mcp/test-mcp",
      "act": {
        "sub": "https://banking-agent.pingdemo.com/agent/test-agent"
      }
    }
  },
  "metadata": {
    "validationTimestamp": "2024-01-01T12:00:00.000Z",
    "tokenType": "exchanged"
  }
}
```

### 2. Delegation Chain Validation

#### Validate Complete Chain

```http
POST /api/delegation/validate/chain
```

Validates complete delegation chain integrity from user and exchanged tokens.

**Request Body**:
```json
{
  "userToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "exchangedToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "chainType": "single_exchange",
  "strict": true
}
```

**Parameters**:
- `userToken` (string, required): Original user token
- `exchangedToken` (string, required): Exchanged token
- `chainType` (string, optional): Chain type (`single_exchange`, `double_exchange`, `subject_only`)
- `strict` (boolean, optional): Enable strict validation (default: true)

**Response**:
```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "chain": [
    {
      "type": "user",
      "sub": "user-12345",
      "timestamp": "2024-01-01T12:00:00.000Z",
      "may_act": {
        "sub": "https://banking-agent.pingdemo.com/agent/test-agent"
      }
    },
    {
      "type": "agent",
      "sub": "https://banking-agent.pingdemo.com/agent/test-agent",
      "timestamp": "2024-01-01T12:00:00.000Z"
    },
    {
      "type": "mcp_server",
      "sub": "https://mcp-server.pingdemo.com/mcp/test-mcp",
      "timestamp": "2024-01-01T12:00:00.000Z"
    }
  ],
  "statistics": {
    "length": 3,
    "nodeTypes": {
      "user": 1,
      "agent": 1,
      "mcp_server": 1
    },
    "hasCircularDelegation": false,
    "subjectPreserved": true
  },
  "visualization": "user(user-12345) → agent(https://banking-agent.pingdemo.com/agent/test-agent) → mcp_server(https://mcp-server.pingdemo.com/mcp/test-mcp)"
}
```

### 3. Identity Format Management

#### Validate Identifier Format

```http
POST /api/delegation/identity/validate
```

Validates identifier format according to RFC 8693 standards.

**Request Body**:
```json
{
  "identifier": "https://banking-agent.pingdemo.com/agent/test-agent",
  "type": "agent"
}
```

**Parameters**:
- `identifier` (string, required): Identifier to validate
- `type` (string, required): Identifier type (`agent`, `mcp_server`)

**Response**:
```json
{
  "valid": true,
  "format": "standard",
  "identifier": "https://banking-agent.pingdemo.com/agent/test-agent",
  "standardized": "https://banking-agent.pingdemo.com/agent/test-agent",
  "errors": [],
  "warnings": []
}
```

#### Standardize Identifier

```http
POST /api/delegation/identity/standardize
```

Standardizes identifier to URI-based format.

**Request Body**:
```json
{
  "identifier": "legacy-agent",
  "type": "agent",
  "domain": "banking-agent"
}
```

**Response**:
```json
{
  "original": "legacy-agent",
  "standardized": "https://banking-agent.pingdemo.com/agent/legacy-agent",
  "format": "legacy",
  "migrated": true
}
```

#### Batch Standardize Identifiers

```http
POST /api/delegation/identity/batch-standardize
```

Standardizes multiple identifiers in batch.

**Request Body**:
```json
{
  "identifiers": [
    "legacy-agent-1",
    "https://banking-agent.pingdemo.com/agent/standard-agent",
    "legacy-agent-2"
  ],
  "type": "agent"
}
```

**Response**:
```json
{
  "total": 3,
  "successful": 3,
  "failed": 0,
  "results": [
    {
      "original": "legacy-agent-1",
      "standardized": "https://banking-agent.pingdemo.com/agent/legacy-agent-1",
      "status": "success"
    },
    {
      "original": "https://banking-agent.pingdemo.com/agent/standard-agent",
      "standardized": "https://banking-agent.pingdemo.com/agent/standard-agent",
      "status": "success"
    },
    {
      "original": "legacy-agent-2",
      "standardized": "https://banking-agent.pingdemo.com/agent/legacy-agent-2",
      "status": "success"
    }
  ],
  "errors": []
}
```

### 4. Enhanced Token Exchange

#### Perform Enhanced Token Exchange

```http
POST /api/delegation/exchange/enhanced
```

Performs RFC 8693 token exchange with enhanced act claim validation.

**Request Body**:
```json
{
  "subjectToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "audience": "https://mcp-server.pingdemo.com",
  "scopes": ["banking:read", "banking:write"],
  "actorToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "options": {
    "validateStructure": true,
    "preserveSubject": true,
    "constructNestedAct": true
  }
}
```

**Response**:
```json
{
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "claims": {
    "sub": "user-12345",
    "act": {
      "sub": "https://mcp-server.pingdemo.com/mcp/test-mcp",
      "act": {
        "sub": "https://banking-agent.pingdemo.com/agent/test-agent"
      }
    }
  },
  "exchangeMethod": "with-actor-nested",
  "validated": true,
  "context": {
    "timestamp": "2024-01-01T12:00:00.000Z",
    "audience": "https://mcp-server.pingdemo.com",
    "scopes": "banking:read banking:write"
  }
}
```

#### Perform Two-Exchange Delegation

```http
POST /api/delegation/exchange/two-exchange
```

Performs two-exchange delegation chain for enhanced security.

**Request Body**:
```json
{
  "userToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "agentClientId": "agent-client-123",
  "agentClientSecret": "agent-secret",
  "mcpClientId": "mcp-client-456",
  "mcpClientSecret": "mcp-secret",
  "mcpResourceUri": "https://mcp-server.pingdemo.com",
  "scopes": ["banking:read"]
}
```

**Response**:
```json
{
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "claims": {
    "sub": "user-12345",
    "act": {
      "sub": "https://mcp-server.pingdemo.com/mcp/test-mcp",
      "act": {
        "sub": "https://intermediate.pingdemo.com/mcp/intermediate",
        "act": {
          "sub": "https://banking-agent.pingdemo.com/agent/test-agent"
        }
      }
    }
  },
  "exchangeSteps": [
    {
      "step": 1,
      "description": "Agent actor token obtained"
    },
    {
      "step": 2,
      "description": "User + Agent → Agent exchanged token"
    },
    {
      "step": 3,
      "description": "MCP actor token obtained"
    },
    {
      "step": 4,
      "description": "Agent exchanged + MCP → Final token"
    }
  ],
  "chainValidation": {
    "valid": true,
    "errors": [],
    "warnings": []
  }
}
```

### 5. Monitoring and Analytics

#### Get Validation Statistics

```http
GET /api/delegation/monitoring/stats
```

Retrieves delegation validation statistics and metrics.

**Response**:
```json
{
  "period": "24h",
  "totalValidations": 12500,
  "successfulValidations": 12350,
  "failedValidations": 150,
  "successRate": 98.8,
  "averageLatency": 45,
  "tokenTypeBreakdown": {
    "user": 8500,
    "exchanged": 4000
  },
  "errorBreakdown": {
    "DELEGATION_020": 80,
    "DELEGATION_040": 45,
    "DELEGATION_041": 25
  },
  "chainStatistics": {
    "singleExchange": 11000,
    "doubleExchange": 1200,
    "subjectOnly": 300
  }
}
```

#### Get Validation History

```http
GET /api/delegation/monitoring/history
```

Retrieves recent validation history with filtering options.

**Query Parameters**:
- `limit` (number, optional): Maximum number of records (default: 100)
- `offset` (number, optional): Record offset (default: 0)
- `tokenType` (string, optional): Filter by token type
- `status` (string, optional): Filter by validation status
- `fromDate` (string, optional): Start date (ISO 8601)
- `toDate` (string, optional): End date (ISO 8601)

**Response**:
```json
{
  "total": 500,
  "limit": 100,
  "offset": 0,
  "records": [
    {
      "id": "validation-12345",
      "timestamp": "2024-01-01T12:00:00.000Z",
      "requestId": "req-123456",
      "tokenType": "user",
      "valid": true,
      "errors": [],
      "warnings": ["Using legacy agent identifier format"],
      "latency": 42,
      "chainLength": 3
    }
  ]
}
```

### 6. Administrative Operations

#### Clear Validation Cache

```http
DELETE /api/delegation/admin/cache
```

Clears delegation validation cache. Requires `delegation:admin` scope.

**Response**:
```json
{
  "cleared": true,
  "timestamp": "2024-01-01T12:00:00.000Z",
  "cacheStatistics": {
    "entriesCleared": 1250,
    "cacheSize": 0
  }
}
```

#### Get Cache Statistics

```http
GET /api/delegation/admin/cache/stats
```

Retrieves validation cache statistics. Requires `delegation:admin` scope.

**Response**:
```json
{
  "validationCache": {
    "size": 1250,
    "hitRate": 85.2,
    "entries": [
      "req-12345-user",
      "req-12346-exchanged"
    ]
  },
  "chainServiceCache": {
    "size": 450,
    "hitRate": 78.9,
    "entries": [
      "chain-12345",
      "chain-12346"
    ]
  }
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| DELEGATION_001 | 400 | Invalid token format |
| DELEGATION_002 | 401 | Missing token |
| DELEGATION_003 | 401 | Token decode failed |
| DELEGATION_010 | 401 | Missing required claim |
| DELEGATION_020 | 403 | Missing may_act claim |
| DELEGATION_022 | 403 | Unauthorized agent |
| DELEGATION_030 | 401 | Missing act claim |
| DELEGATION_040 | 403 | Subject not preserved |
| DELEGATION_041 | 403 | Circular delegation |
| DELEGATION_050 | 401 | Invalid identifier format |
| DELEGATION_100 | 500 | Validation failed |
| DELEGATION_101 | 504 | Validation timeout |

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| Token validation | 1000 requests | 1 hour |
| Chain validation | 500 requests | 1 hour |
| Identity operations | 2000 requests | 1 hour |
| Token exchange | 100 requests | 1 hour |
| Monitoring endpoints | 5000 requests | 1 hour |

## SDK Examples

### Node.js

```javascript
const axios = require('axios');

class DelegationAPI {
  constructor(baseURL, accessToken) {
    this.baseURL = baseURL;
    this.accessToken = accessToken;
  }

  async validateUserToken(token, options = {}) {
    const response = await axios.post(`${this.baseURL}/validate/user`, {
      token,
      ...options
    }, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  }

  async validateDelegationChain(userToken, exchangedToken, options = {}) {
    const response = await axios.post(`${this.baseURL}/validate/chain`, {
      userToken,
      exchangedToken,
      ...options
    }, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  }

  async standardizeIdentifier(identifier, type, options = {}) {
    const response = await axios.post(`${this.baseURL}/identity/standardize`, {
      identifier,
      type,
      ...options
    }, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  }
}

// Usage
const api = new DelegationAPI('https://banking-api.pingdemo.com/api/delegation', accessToken);

const validation = await api.validateUserToken(userToken, { strict: true });
console.log('Validation result:', validation);
```

### Python

```python
import requests
from typing import Dict, Any, Optional

class DelegationAPI:
    def __init__(self, base_url: str, access_token: str):
        self.base_url = base_url
        self.access_token = access_token
        self.headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }

    def validate_user_token(self, token: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Validate user token delegation claims"""
        payload = {'token': token}
        if options:
            payload.update(options)
        
        response = requests.post(
            f'{self.base_url}/validate/user',
            json=payload,
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()

    def validate_delegation_chain(self, user_token: str, exchanged_token: str, 
                                 options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Validate complete delegation chain"""
        payload = {
            'userToken': user_token,
            'exchangedToken': exchanged_token
        }
        if options:
            payload.update(options)
        
        response = requests.post(
            f'{self.base_url}/validate/chain',
            json=payload,
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()

    def standardize_identifier(self, identifier: str, identifier_type: str, 
                               options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Standardize identifier to URI format"""
        payload = {
            'identifier': identifier,
            'type': identifier_type
        }
        if options:
            payload.update(options)
        
        response = requests.post(
            f'{self.base_url}/identity/standardize',
            json=payload,
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()

# Usage
api = DelegationAPI('https://banking-api.pingdemo.com/api/delegation', access_token)

validation = api.validate_user_token(user_token, {'strict': True})
print(f'Validation result: {validation}')
```

## Testing

### Test Tokens

#### Valid User Token
```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMzQ1IiwibWF5X2FjdCI6eyJzdWIiOiJodHRwczovL2JhbmtpbmctYWdlbnQucGluZ2RlbW8uY29tL2FnZW50L3Rlc3QtYWdlbnQifX0.SflKxwRJSMeQ98PjmYQhQjFzLhOA-7h5aYFFI
```

#### Valid Exchanged Token
```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMzQ1IiwiYWN0Ijp7InN1YiI6Imh0dHBzOi8vbWNwLXNlcnZlci5waW5nZGVtby5jb20vbWNwL3Rlc3QtbWNwIiwiYWN0Ijp7InN1YiI6Imh0dHBzOi8vYWdlbnQtZ2F0ZXdheS5waW5nZGVtby5jb20vYWdlbnQvYWdlbnQtY2xpZW50In19fQ.SflKxwRJSMeQ98PjmYQhQjFzLhOA-7h5aYFFI
```

#### Invalid Token (Missing may_act)
```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMzQ1In0.SflKxwRJSMeQ98PjmYQhQjFzLhOA-7h5aYFFI
```

### Test Scripts

#### cURL Examples

```bash
# Validate user token
curl -X POST https://banking-api.pingdemo.com/api/delegation/validate/user \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "strict": true
  }'

# Validate delegation chain
curl -X POST https://banking-api.pingdemo.com/api/delegation/validate/chain \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "exchangedToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "chainType": "single_exchange"
  }'

# Standardize identifier
curl -X POST https://banking-api.pingdemo.com/api/delegation/identity/standardize \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "legacy-agent",
    "type": "agent"
  }'
```

## Support

For API support and questions:

- **Documentation**: [RFC 8693 Delegation Claims Compliance Guide](rfc8693-delegation-claims-compliance-guide.md)
- **Troubleshooting**: Common issues and solutions in the main guide
- **Status Page**: https://status.pingdemo.com for service availability
- **Support Email**: delegation-support@pingdemo.com
- **Developer Forum**: https://community.pingdemo.com/delegation-api

## Changelog

### v1.0.0 (2024-01-01)
- Initial release of RFC 8693 delegation claims API
- Full token validation and chain validation support
- Identity format standardization capabilities
- Enhanced token exchange with nested act claims
- Comprehensive monitoring and analytics
- Administrative operations for cache management

---

*This API is part of Phase 58: RFC 8693 Delegation Claims Compliance implementation. For more information about the overall implementation, refer to the main documentation.*
