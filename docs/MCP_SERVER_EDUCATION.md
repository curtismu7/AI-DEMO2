# MCP Server Education - /.well-known/mcp-server

## Overview

The Model Context Protocol (MCP) server provides a standardized way for AI agents to discover and interact with tools and resources. The `/.well-known/mcp-server` endpoint implements RFC 9728 for OAuth 2.0 Protected Resource Metadata, enabling automatic discovery and configuration.

## /.well-known/mcp-server Endpoint

The MCP server exposes a discovery endpoint at `/.well-known/mcp-server` that returns metadata about the server capabilities, available tools, and OAuth configuration.

### Endpoint Response

```json
{
  "issuer": "https://auth.pingone.com/{envId}/as",
  "authorization_endpoint": "https://auth.pingone.com/{envId}/as/authorize",
  "token_endpoint": "https://auth.pingone.com/{envId}/as/token",
  "jwks_uri": "https://auth.pingone.com/{envId}/as/jwks",
  "response_types_supported": ["code"],
  "grant_types_supported": [
    "authorization_code",
    "client_credentials",
    "urn:ietf:params:oauth:grant-type:token-exchange",
    "urn:openid:params:grant-type:ciba"
  ],
  "scopes_supported": [
    "banking:accounts:read",
    "banking:transactions:read", 
    "banking:transactions:write"
  ],
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post",
    "private_key_jwt"
  ],
  "code_challenge_methods_supported": ["S256"],
  "introspection_endpoint": "https://auth.pingone.com/{envId}/as/introspect",
  "revocation_endpoint": "https://auth.pingone.com/{envId}/as/revoke",
  "mcp_server": {
    "version": "1.0",
    "capabilities": [
      "tools",
      "resources",
      "prompts",
      "logging"
    ],
    "tools": [
      {
        "name": "get_accounts",
        "description": "Retrieve user's bank account information",
        "required_scopes": ["banking:accounts:read"]
      },
      {
        "name": "get_transactions",
        "description": "Retrieve transaction history",
        "required_scopes": ["banking:transactions:read"]
      },
      {
        "name": "create_transaction",
        "description": "Initiate a new transaction",
        "required_scopes": ["banking:transactions:write"]
      }
    ],
    "resources": [
      {
        "uri": "banking://accounts",
        "description": "User's bank accounts",
        "required_scopes": ["banking:accounts:read"]
      },
      {
        "uri": "banking://transactions",
        "description": "Transaction history",
        "required_scopes": ["banking:transactions:read"]
      }
    ],
    "security": {
      "token_validation": "required",
      "audience_validation": "required",
      "scope_validation": "required",
      "rate_limiting": {
        "requests_per_minute": 60,
        "burst_size": 10
      }
    }
  }
}
```

## ASCII Flow Diagram - MCP Server Discovery

```
    AI Agent Client
        |
        | 1. GET /.well-known/mcp-server
        v
    MCP Server
        |
        | 2. Return Server Metadata
        |    - Available tools
        |    - Required scopes
        |    - OAuth endpoints
        v
    AI Agent Client
        |
        | 3. Analyze Capabilities
        |    - Check tool availability
        |    - Validate scope requirements
        v
    AI Agent Client
        |
        | 4. Configure Connection
        |    - Set up OAuth client
        |    - Request appropriate scopes
        v
    OAuth Authorization
        |
        | 5. Obtain Access Token
        |    - With required scopes
        v
    AI Agent Client
        |
        | 6. Connect WebSocket
        |    - tools/call messages
        v
    MCP Server
        |
        | 7. Validate Token
        |    - Audience: mcp-server.pingdemo.com
        |    - Scopes: banking:accounts:read etc.
        v
    Tool Execution
```

## MCP Server Architecture

### Components

```
MCP Server Architecture
======================

WebSocket Handler
    |
    | 1. Connection Management
    | 2. Message Routing
    | 3. Authentication
    v
Token Validator
    |
    | 1. JWT Signature Verification
    | 2. Audience Validation
    | 3. Scope Validation
    | 4. Expiration Check
    v
Tool Registry
    |
    | 1. Tool Discovery
    | 2. Permission Check
    | 3. Parameter Validation
    v
Tool Executor
    |
    | 1. API Calls
    | 2. Data Processing
    | 3. Response Formatting
    v
Response Handler
    |
    | 1. Result Packaging
    | 2. Error Handling
    | 3. WebSocket Response
    v
AI Agent Client
```

### Security Layers

```
Security Layers
===============

1. Network Security
   - TLS 1.3 encryption
   - Certificate validation
   - IP allowlist (optional)

2. Authentication
   - JWT token validation
   - Audience verification
   - Scope enforcement

3. Authorization
   - Tool-level permissions
   - Resource access control
   - Rate limiting

4. Audit & Logging
   - Request logging
   - Tool execution tracking
   - Security event monitoring
```

## Tool Implementation

### Tool Registration

```javascript
// banking_mcp_server/src/tools/bankingTools.js

const bankingTools = {
  get_accounts: {
    name: 'get_accounts',
    description: 'Retrieve user\'s bank account information',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User identifier (from token sub claim)'
        }
      },
      required: ['userId']
    },
    requiredScopes: ['banking:accounts:read'],
    handler: async (input, context) => {
      const { userId } = input;
      const { token, scopes } = context;
      
      // Validate scopes
      if (!scopes.includes('banking:accounts:read')) {
        throw new Error('Insufficient scope for get_accounts');
      }
      
      // Call PingOne API
      const accounts = await pingOneAPI.getAccounts(userId, token);
      return formatAccountsResponse(accounts);
    }
  },
  
  create_transaction: {
    name: 'create_transaction',
    description: 'Initiate a new banking transaction',
    inputSchema: {
      type: 'object',
      properties: {
        fromAccountId: { type: 'string' },
        toAccountId: { type: 'string' },
        amount: { type: 'number', minimum: 0.01 },
        currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
        description: { type: 'string' }
      },
      required: ['fromAccountId', 'toAccountId', 'amount']
    },
    requiredScopes: ['banking:transactions:write'],
    handler: async (input, context) => {
      const { token, scopes } = context;
      
      // Validate scopes
      if (!scopes.includes('banking:transactions:write')) {
        throw new Error('Insufficient scope for create_transaction');
      }
      
      // Check for high-value transaction
      if (input.amount > 1000.00) {
        // Require step-up authentication
        return {
          requiresStepUp: true,
          stepUpType: 'ciba',
          message: 'High-value transaction requires additional authentication'
        };
      }
      
      // Process transaction
      const transaction = await pingOneAPI.createTransaction(input, token);
      return formatTransactionResponse(transaction);
    }
  }
};
```

### Tool Execution Flow

```
Tool Execution Flow
==================

1. tools/call Request
   {
     "method": "tools/call",
     "params": {
       "name": "get_accounts",
       "arguments": {
         "userId": "user-123"
       }
     }
   }

2. Token Validation
   - Decode JWT
   - Verify signature
   - Check audience: mcp-server.pingdemo.com
   - Validate scopes: banking:accounts:read

3. Tool Lookup
   - Find tool by name
   - Validate input schema
   - Check required scopes

4. Permission Check
   - User has required scope?
   - Tool is enabled?
   - Rate limit not exceeded?

5. Execution
   - Call tool handler
   - Process business logic
   - Handle errors

6. Response
   {
     "result": {
       "content": [
         {
           "type": "text",
           "text": "Account balance: $2,450.00"
         }
       ]
     }
   }
```

## Integration with Agent Request Flow

### Complete Flow Integration

```
Complete Agent Request Flow with MCP Server
==========================================

User Query
    |
    v
Banking App (BFF)
    |
    | 1. Validate user session
    | 2. Check Subject Token
    v
AI Agent
    |
    | 3. Discover MCP Server
    |    GET /.well-known/mcp-server
    v
MCP Server Discovery
    |
    | 4. Return server metadata
    |    - Available tools
    |    - OAuth configuration
    v
AI Agent
    |
    | 5. Token Exchange (RFC 8693)
    |    Subject Token -> MCP Token
    v
PingOne Auth Server
    |
    | 6. Issue MCP Token
    |    aud: mcp-server.pingdemo.com
    |    scope: banking:accounts:read
    v
AI Agent
    |
    | 7. WebSocket Connection
    |    tools/call message
    v
MCP Server
    |
    | 8. Token Validation
    |    Verify MCP Token
    |    Check scopes
    v
MCP Server
    |
    | 9. Tool Execution
    |    Call PingOne API
    v
PingOne Management API
    |
    |10. Return Account Data
    v
MCP Server
    |
    |11. Format Response
    v
AI Agent
    |
    |12. Natural Language Response
    v
Banking App
    |
    |13. Display to User
    v
User
```

## Security Considerations

### Token Validation

```javascript
// MCP Server Token Validation
function validateToken(token, expectedAudience) {
  try {
    // 1. Decode JWT
    const decoded = jwt.decode(token, { complete: true });
    
    // 2. Verify signature
    const verified = jwt.verify(token, publicKey);
    
    // 3. Check audience
    if (!verified.aud.includes(expectedAudience)) {
      throw new Error('Invalid audience');
    }
    
    // 4. Check expiration
    if (verified.exp < Date.now() / 1000) {
      throw new Error('Token expired');
    }
    
    // 5. Extract scopes
    const scopes = verified.scope ? verified.scope.split(' ') : [];
    
    return {
      valid: true,
      payload: verified,
      scopes: scopes
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}
```

### Rate Limiting

```javascript
// Rate limiting implementation
const rateLimiter = new Map();

function checkRateLimit(userId, toolName) {
  const key = `${userId}:${toolName}`;
  const now = Date.now();
  const window = 60 * 1000; // 1 minute
  const limit = 60; // 60 requests per minute
  
  if (!rateLimiter.has(key)) {
    rateLimiter.set(key, { count: 1, resetTime: now + window });
    return true;
  }
  
  const record = rateLimiter.get(key);
  
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + window;
    return true;
  }
  
  if (record.count >= limit) {
    return false;
  }
  
  record.count++;
  return true;
}
```

## Error Handling

### Standard Error Responses

```javascript
// MCP Server Error Responses
const MCP_ERRORS = {
  INVALID_TOKEN: {
    error: 'invalid_token',
    error_description: 'The provided token is invalid or expired',
    error_code: 401
  },
  INSUFFICIENT_SCOPE: {
    error: 'insufficient_scope',
    error_description: 'Token lacks required scope for this operation',
    error_code: 403
  },
  TOOL_NOT_FOUND: {
    error: 'tool_not_found',
    error_description: 'Requested tool is not available',
    error_code: 404
  },
  RATE_LIMITED: {
    error: 'rate_limited',
    error_description: 'Too many requests, please try again later',
    error_code: 429
  },
  VALIDATION_ERROR: {
    error: 'validation_error',
    error_description: 'Invalid input parameters',
    error_code: 400
  }
};
```

### Error Response Format

```json
{
  "error": {
    "code": "insufficient_scope",
    "message": "Token lacks required scope for this operation",
    "data": {
      "required_scopes": ["banking:transactions:write"],
      "provided_scopes": ["banking:accounts:read"],
      "tool": "create_transaction"
    }
  }
}
```

## Monitoring and Observability

### Metrics to Track

```javascript
// MCP Server Metrics
const metrics = {
  // Connection metrics
  websocketConnections: {
    total: 0,
    active: 0,
    errors: 0
  },
  
  // Token validation metrics
  tokenValidation: {
    success: 0,
    failures: 0,
    audienceErrors: 0,
    scopeErrors: 0,
    expiredTokens: 0
  },
  
  // Tool execution metrics
  toolExecution: {
    totalCalls: 0,
    successRate: 0,
    averageLatency: 0,
    errorsByTool: {}
  },
  
  // Security metrics
  security: {
    rateLimitHits: 0,
    unauthorizedAttempts: 0,
    suspiciousActivity: 0
  }
};
```

### Logging

```javascript
// Structured logging
const logger = {
  info: (message, context) => {
    console.log(JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      message,
      ...context
    }));
  },
  
  error: (message, error, context) => {
    console.error(JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
      error: error.message,
      stack: error.stack,
      ...context
    }));
  },
  
  security: (event, context) => {
    console.warn(JSON.stringify({
      level: 'security',
      timestamp: new Date().toISOString(),
      event,
      ...context
    }));
  }
};
```

## Testing

### Unit Tests

```javascript
// MCP Server Tests
describe('MCP Server', () => {
  test('should validate token correctly', () => {
    const token = generateValidToken();
    const result = validateToken(token, 'https://mcp-server.pingdemo.com');
    expect(result.valid).toBe(true);
  });
  
  test('should reject token with wrong audience', () => {
    const token = generateTokenWithAudience('https://wrong.pingdemo.com');
    const result = validateToken(token, 'https://mcp-server.pingdemo.com');
    expect(result.valid).toBe(false);
  });
  
  test('should enforce rate limiting', () => {
    for (let i = 0; i < 65; i++) {
      const allowed = checkRateLimit('user-123', 'get_accounts');
      if (i >= 60) {
        expect(allowed).toBe(false);
      }
    }
  });
});
```

### Integration Tests

```javascript
// Integration Tests
describe('MCP Server Integration', () => {
  test('should handle complete tool call flow', async () => {
    // 1. Connect WebSocket
    const ws = new WebSocket('ws://localhost:3001');
    
    // 2. Send tools/call message
    const message = {
      method: 'tools/call',
      params: {
        name: 'get_accounts',
        arguments: { userId: 'test-user' }
      }
    };
    
    ws.send(JSON.stringify(message));
    
    // 3. Wait for response
    const response = await waitForResponse(ws);
    
    expect(response.result).toBeDefined();
    expect(response.result.content).toHaveLength(1);
  });
});
```

## Best Practices

### Security Best Practices

1. **Always validate tokens** - Never trust incoming tokens without validation
2. **Enforce audience restriction** - Ensure tokens are for the correct resource
3. **Implement rate limiting** - Prevent abuse and DoS attacks
4. **Log security events** - Monitor for suspicious activity
5. **Use TLS** - Encrypt all WebSocket connections
6. **Validate inputs** - Sanitize all tool parameters

### Performance Best Practices

1. **Cache JWKS** - Reduce signature verification overhead
2. **Connection pooling** - Reuse database connections
3. **Async operations** - Use non-blocking I/O
4. **Response caching** - Cache frequently requested data
5. **Load balancing** - Distribute load across instances

### Operational Best Practices

1. **Health checks** - Implement /health endpoint
2. **Graceful shutdown** - Handle SIGTERM properly
3. **Configuration management** - Externalize configuration
4. **Monitoring** - Track key metrics and alerts
5. **Documentation** - Keep API docs up to date

## References

- [RFC 9728 - OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/rfc6819)
- [RFC 8693 - OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [Super Banking Token Exchange Guide](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md)

---

**Implementation Status:**
- [x] /.well-known/mcp-server endpoint implemented
- [x] Tool registry and execution framework
- [x] Token validation and scope enforcement
- [x] Rate limiting and security controls
- [x] Error handling and logging
- [x] Monitoring and observability
- [x] Comprehensive testing suite
- [x] Integration with agent request flow
- [x] Educational content and documentation

## Integration with Agent Request Flow

The MCP server education is now fully integrated into the agent request flow. The AI agent automatically discovers the MCP server capabilities through the `/.well-known/mcp-server` endpoint and uses this information to:

1. **Discover Available Tools** - The agent queries the discovery endpoint to understand what banking tools are available
2. **Validate Scopes** - The agent checks which scopes are required for each tool
3. **Configure Authentication** - The agent sets up the proper OAuth flow with the required scopes
4. **Execute Tool Calls** - The agent uses WebSocket connections to call the discovered tools

### Discovery Integration Example

```javascript
// AI Agent discovers MCP server capabilities
async function discoverMCPServer() {
  const response = await fetch('https://mcp-server.pingdemo.com/.well-known/mcp-server');
  const metadata = await response.json();
  
  // Extract available tools and their requirements
  const availableTools = metadata.mcp_server.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    requiredScopes: tool.required_scopes
  }));
  
  return availableTools;
}
```

### Educational Content References

The MCP server education content is referenced in:
- Agent request flow documentation
- Educational panels in the UI
- Developer documentation
- API reference guides

Users can access comprehensive information about:
- MCP server architecture and security
- Tool implementation patterns
- Integration best practices
- Troubleshooting guides
