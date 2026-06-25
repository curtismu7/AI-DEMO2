# RFC 8707 Resource Indicators - Implementation Guide

## Overview

RFC 8707 defines OAuth 2.0 Resource Indicators (RI), which allow clients to request access tokens scoped to specific resource servers. This enhances security by ensuring tokens can only be used with their intended audience and prevents token replay attacks across different services.

## What are Resource Indicators?

Resource Indicators are URIs that identify the specific resource server a token is intended for. They are sent in the authorization request as the `resource` parameter.

### Key Benefits

- **Audience Restriction**: Tokens are scoped to specific resource servers
- **Security**: Prevents token replay across different services
- **Compliance**: Required for enterprise OAuth implementations
- **Granular Control**: Fine-grained access control per resource

## RFC 8707 in Super Banking

The Super Banking demo implements RFC 8707 across multiple resource servers:

```
Resource Servers (Audiences):
- https://ai-agent.pingdemo.com     - AI Agent Service
- https://mcp-server.pingdemo.com  - MCP Server  
- https://agent-gateway.pingdemo.com - Agent Gateway
- https://resource-server.pingdemo.com - Banking API Resources
- https://api.pingone.com           - PingOne Management API
```

## Implementation Details

### Authorization Request with Resource Indicator

```
GET /{envId}/as/authorize?
  response_type=code&
  client_id={client_id}&
  redirect_uri={redirect_uri}&
  scope=profile%20email%20banking:agent:invoke&
  resource=https://ai-agent.pingdemo.com&
  state={state}&
  code_challenge={code_challenge}&
  code_challenge_method=S256
```

### Token Response with Audience

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "profile email banking:agent:invoke",
  "aud": ["https://ai-agent.pingdemo.com"]
}
```

## ASCII Flow Diagram - Resource Indicator Flow

```
    User/Client
        |
        | 1. Authorization Request
        |    resource=https://ai-agent.pingdemo.com
        v
    PingOne Authorization Server
        |
        | 2. Validate Resource Indicator
        |    - Check resource exists
        |    - Verify client has permission
        |    - Determine allowed scopes
        v
    PingOne Authorization Server
        |
        | 3. Issue Access Token
        |    aud: ["https://ai-agent.pingdemo.com"]
        |    scope: "profile email banking:agent:invoke"
        v
    Client Receives Token
        |
        | 4. Token Validation
        |    AI Agent Service validates aud
        v
    Resource Server (AI Agent)
        |
        | 5. Accept/Reject Token
        |    aud matches? -> Accept
        |    aud mismatch? -> Reject
        v
    API Access Granted/Denied
```

## Resource Server Configuration

### 1. AI Agent Service Resource

**Resource Definition:**
```json
{
  "name": "Super Banking AI Agent Service",
  "audience": "https://ai-agent.pingdemo.com",
  "description": "AI Agent service resource server",
  "scopes": [
    {
      "name": "banking:agent:invoke",
      "description": "Invoke AI Agent banking tools"
    }
  ],
  "tokenIntrospectionAuthMethod": "client_secret_basic"
}
```

**Attribute Mappings:**
```json
{
  "may_act": {
    "expression": "user.mayAct",
    "required": false
  }
}
```

### 2. MCP Server Resource

**Resource Definition:**
```json
{
  "name": "Super Banking MCP Server",
  "audience": "https://mcp-server.pingdemo.com",
  "description": "MCP Model Context Protocol server",
  "scopes": [
    {
      "name": "banking:accounts:read",
      "description": "Read user account information"
    },
    {
      "name": "banking:transactions:read", 
      "description": "Read transaction history"
    },
    {
      "name": "banking:transactions:write",
      "description": "Initiate banking transactions"
    }
  ]
}
```

**Attribute Mappings:**
```json
{
  "act": {
    "expression": "(#root.context.requestData.subjectToken?.may_act?.sub != null && #root.context.requestData.subjectToken?.may_act?.sub == #root.context.requestData.actorToken?.aud?.get(0))?#root.context.requestData.subjectToken?.may_act:null",
    "required": true
  }
}
```

## Client Configuration

### Application Resource Permissions

Each application must be granted permission to request scopes from specific resources:

**Super Banking User App:**
```json
{
  "allowedScopes": [
    "profile",
    "email", 
    "offline_access",
    "banking:agent:invoke" // From AI Agent Service
  ]
}
```

**Super Banking Admin App:**
```json
{
  "allowedScopes": [
    "banking:accounts:read",    // From MCP Server
    "banking:transactions:read", // From MCP Server  
    "banking:transactions:write" // From MCP Server
  ]
}
```

## Security Benefits

### 1. Audience Enforcement

Tokens can only be used by their intended resource server:

```javascript
// AI Agent Service Validation
function validateToken(token) {
  const decoded = jwt.decode(token);
  
  // Verify audience matches this service
  if (!decoded.aud.includes('https://ai-agent.pingdemo.com')) {
    throw new Error('Token audience mismatch');
  }
  
  // Token is valid for this service
  return true;
}
```

### 2. Cross-Service Protection

A token intended for the AI Agent cannot be used with the MCP Server:

```javascript
// This will fail - wrong audience
fetch('https://mcp-server.pingdemo.com/tools', {
  headers: {
    'Authorization': 'Bearer ' + aiAgentToken // aud: ai-agent.pingdemo.com
  }
}); // Returns 401 Unauthorized
```

### 3. Token Replay Prevention

Resource indicators prevent token replay attacks across different services:

```javascript
// Attacker cannot replay token to different service
const stolenToken = getStolenToken(); // aud: ai-agent.pingdemo.com

// Cannot use with MCP Server
const response = fetch('https://mcp-server.pingdemo.com/api', {
  headers: { 'Authorization': `Bearer ${stolenToken}` }
}); // Rejected - audience mismatch
```

## Best Practices

### 1. Unique Audiences

Each resource server should have a unique audience URI:

```
Good:
- https://ai-agent.pingdemo.com
- https://mcp-server.pingdemo.com
- https://api.pingone.com

Bad:
- https://api.pingdemo.com (too generic)
- https://pingdemo.com (too broad)
```

### 2. Scope Separation

Different resource servers should have distinct scopes:

```
AI Agent Service: banking:agent:invoke
MCP Server: banking:accounts:read, banking:transactions:read/write
PingOne API: p1:read:user, p1:update:user
```

### 3. Resource Validation

Always validate the `aud` claim in resource servers:

```javascript
// Middleware example
app.use((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const decoded = jwt.decode(token);
  
  if (!decoded.aud.includes(process.env.RESOURCE_AUDIENCE)) {
    return res.status(401).json({ error: 'Invalid token audience' });
  }
  
  next();
});
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| **invalid_request** | Invalid resource URI | Verify resource exists and URI is correct |
| **invalid_scope** | Scope not allowed for resource | Check application resource permissions |
| **access_denied** | Client not allowed for resource | Grant resource access to application |
| **Token rejected** | Audience mismatch | Verify resource server audience configuration |

### Debug Examples

**Invalid Resource:**
```
GET /authorize?resource=https://nonexistent.pingdemo.com
Response: {"error":"invalid_request","error_description":"Invalid resource URI"}
```

**Scope Not Allowed:**
```
GET /authorize?resource=https://ai-agent.pingdemo.com&scope=admin:access
Response: {"error":"invalid_scope","error_description":"Scope not allowed for resource"}
```

## Integration with Token Exchange

RFC 8707 works seamlessly with RFC 8693 Token Exchange:

```
Subject Token (aud: ai-agent.pingdemo.com)
    |
    | Token Exchange
    v
MCP Token (aud: mcp-server.pingdemo.com)
    |
    | Token Exchange  
    v
API Token (aud: api.pingone.com)
```

Each exchange produces a token with a new audience specific to the target resource server.

## Migration Guide

### From Single Audience to Resource Indicators

**Before (no resource indicator):**
```
GET /authorize?scope=profile email banking:agent:invoke
Token aud: ["https://auth.pingone.com/{envId}/as"]
```

**After (with resource indicator):**
```
GET /authorize?resource=https://ai-agent.pingdemo.com&scope=profile email banking:agent:invoke  
Token aud: ["https://ai-agent.pingdemo.com"]
```

### Migration Steps

1. **Create Resource Servers** in PingOne Console
2. **Update Applications** to request resource indicators
3. **Update Client Code** to include resource parameter
4. **Update Resource Servers** to validate audience
5. **Test All Flows** with new tokens

## Compliance

### OAuth 2.0 Security Best Practices

RFC 8707 is recommended by OAuth 2.0 security best practices:

- **OAuth 2.0 Security Best Current Practice** (RFC 6819)
- **OAuth 2.1** (draft) requires resource indicators
- **Enterprise deployments** often mandate resource indicators

### Audit Requirements

Resource indicators help meet audit requirements:

- **Token usage tracking** per resource server
- **Access control** verification
- **Security incident** investigation
- **Compliance reporting**

## Testing Resource Indicators

### Unit Tests

```javascript
describe('Resource Indicators', () => {
  test('token includes correct audience', () => {
    const token = generateToken({
      resource: 'https://ai-agent.pingdemo.com'
    });
    
    expect(token.aud).toContain('https://ai-agent.pingdemo.com');
  });
  
  test('rejects token with wrong audience', () => {
    const token = generateToken({
      resource: 'https://mcp-server.pingdemo.com'
    });
    
    expect(() => validateTokenForAIService(token))
      .toThrow('audience mismatch');
  });
});
```

### Integration Tests

```javascript
describe('Resource Indicator Integration', () => {
  test('complete flow with resource indicator', async () => {
    // 1. Authorization with resource indicator
    const authResponse = await authorize({
      resource: 'https://ai-agent.pingdemo.com',
      scope: 'banking:agent:invoke'
    });
    
    // 2. Token validation
    const token = authResponse.access_token;
    const isValid = await validateToken(token, 'https://ai-agent.pingdemo.com');
    expect(isValid).toBe(true);
    
    // 3. API usage
    const apiResponse = await callAIService(token);
    expect(apiResponse.status).toBe(200);
  });
});
```

## Monitoring

### Key Metrics

Monitor these resource indicator metrics:

- **Authorization requests** by resource
- **Token validation** success/failure rates  
- **Audience mismatch** errors
- **Resource server** access patterns

### Alerts

Set up alerts for:

- High audience mismatch rates
- Invalid resource URI requests
- Token validation failures
- Unusual access patterns

## References

- [RFC 8707 - OAuth 2.0 Resource Indicators](https://datatracker.ietf.org/doc/html/rfc8707)
- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/rfc6819)
- [PingOne Resource Servers Documentation](https://docs.pingidentity.com/pingone/p1_cloud__resource-servers_main_landing_page.html)
- [Super Banking Token Exchange Guide](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md)

---

**Implementation Status:** 
- [x] Resource servers created in PingOne
- [x] Applications configured with resource permissions
- [x] Client code updated with resource parameters
- [x] Resource server validation implemented
- [x] Testing and monitoring in place
