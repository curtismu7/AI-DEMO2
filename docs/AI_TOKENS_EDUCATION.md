# AI Tokens Education

## Overview

This guide provides comprehensive education about actor tokens, subject tokens, and other AI-related tokens used in the Super Banking demo. Understanding these token types is crucial for implementing secure AI agent integrations with banking APIs.

## Token Types in AI Integration

### Subject Token

**Definition**: The original token representing the end user's identity and permissions.

**Purpose**: 
- Represents the user who initiated the request
- Contains user's original scopes and claims
- Used as the foundation for token exchange

**Key Characteristics**:
- Issued to the user after authentication
- Contains user-specific claims (sub, aud, scope)
- May include `may_act` claim for delegation authorization
- Example: User's access token after login

### Actor Token

**Definition**: A token representing the AI agent or service acting on behalf of the user.

**Purpose**:
- Identifies the AI agent performing actions
- Enables audit trails for agent operations
- Supports delegation patterns with proper attribution

**Key Characteristics**:
- Represents the agent's identity
- Contains agent-specific claims
- Used in two-exchange token delegation
- Example: Agent's client credentials token

### Exchanged Token (MCP Token)

**Definition**: The final token issued after token exchange, containing both user and agent context.

**Purpose**:
- Grants scoped permissions to the MCP server
- Maintains audit trail with `act` claim
- Enables fine-grained access control

**Key Characteristics**:
- Contains user identity as subject (`sub`)
- Includes agent identity in `act` claim
- Scoped for specific MCP operations
- Limited lifetime for security

## Token Exchange Patterns

### Single Exchange (Impersonation)

```
User Token (Subject) + Agent Client Credentials 
    |
    v
Token Exchange
    |
    v
MCP Token (User as subject, Agent as actor)
```

**Use Case**: Direct agent access with user context
**Flow**: User token exchanged directly for MCP token
**Benefit**: Simpler flow, fewer round trips

### Double Exchange (Delegation)

```
User Token (Subject) + Agent Token (Actor)
    |
    v
Token Exchange
    |
    v
MCP Token (User as subject, Agent as actor)
```

**Use Case**: Explicit delegation with audit trail
**Flow**: Both user and agent tokens exchanged
**Benefit**: Clear audit trail, explicit consent

## Token Claims Explained

### Standard Claims

| Claim | Purpose | Example |
|-------|---------|---------|
| `sub` | Subject (user ID) | `"user-123@example.com"` |
| `aud` | Audience (resource) | `"banking-api-enduser"` |
| `iss` | Issuer (auth server) | `"https://auth.pingone.com/env123"` |
| `scope` | Permissions | `"banking:accounts:read banking:transactions:read"` |
| `exp` | Expiration time | `1640995200` |

### Delegation Claims

| Claim | Purpose | Example |
|-------|---------|---------|
| `may_act` | Authorized actors | `{"client_id": ["agent-client-id"]}` |
| `act` | Current actor | `{"sub": "agent-client-id"}` |

## Real-World Examples

### Subject Token Example
```json
{
  "aud": "https://api.superbanking.com",
  "iss": "https://auth.pingone.com/env123",
  "exp": 1640995200,
  "sub": "user-123@example.com",
  "scope": "banking:accounts:read banking:transactions:read",
  "may_act": {
    "client_id": ["agent-client-id", "admin-client-id"]
  }
}
```

### Actor Token Example
```json
{
  "aud": "https://auth.pingone.com/env123",
  "iss": "https://auth.pingone.com/env123", 
  "exp": 1640995200,
  "sub": "agent-client-id",
  "client_id": "agent-client-id"
}
```

### Exchanged Token Example
```json
{
  "aud": "banking-mcp-server",
  "iss": "https://auth.pingone.com/env123",
  "exp": 1640995200,
  "sub": "user-123@example.com",
  "scope": "banking:accounts:read banking:transactions:read",
  "act": {
    "sub": "agent-client-id"
  }
}
```

## Security Considerations

### Token Validation
- Always validate token signatures with PingOne JWKS
- Check `aud` claim matches expected resource
- Verify `exp` claim for token expiration
- Validate `may_act` claim for delegation authorization

### Scope Enforcement
- Apply principle of least privilege
- Use specific scopes for different operations
- Validate scopes at resource server level
- Monitor scope usage for security audits

### Audit Trails
- Log token exchange events
- Track `act` claim chains for delegation
- Monitor unusual token patterns
- Maintain token usage history

## Implementation Best Practices

### Token Storage
- Store tokens securely (server-side only)
- Use short-lived tokens for operations
- Implement proper token refresh mechanisms
- Never expose tokens to client-side code

### Error Handling
- Handle token expiration gracefully
- Provide clear error messages for auth failures
- Implement retry logic for token refresh
- Log security-relevant errors

### Performance
- Cache token validation results appropriately
- Use efficient token exchange flows
- Minimize token round trips
- Monitor token exchange latency

## Troubleshooting

### Common Issues

**Token Exchange Fails**
- Check `may_act` claim configuration
- Verify client credentials
- Validate token formats
- Check network connectivity

**Scope Validation Errors**
- Verify scope definitions
- Check resource server configuration
- Validate token exchange parameters
- Review policy settings

**Audit Trail Missing**
- Verify `act` claim inclusion
- Check token exchange implementation
- Validate logging configuration
- Review delegation setup

### Debug Tools

- Token inspector in the demo UI
- PingOne application logs
- MCP server debug logs
- Network request tracing

## Related Documentation

- [RFC 8693 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [PingOne Token Exchange Guide](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md)
- [MCP Server Integration](MCP_SERVER_EDUCATION.md)
- [Security Best Practices](security-best-practices.md)

## Phase 83 Implementation

This education page is part of **Phase 83: AI Tokens Education** in the Super Banking demo roadmap. The phase includes:

- Interactive token flow diagrams
- Real-time token inspection
- Educational panel integration
- Comprehensive terminology glossary
- Hands-on token exchange examples

For implementation details, see the [Phase 83 plan](../.planning/phases/83-ai-tokens-education/PLAN.md).
