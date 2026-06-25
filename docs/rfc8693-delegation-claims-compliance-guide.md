# RFC 8693 Delegation Claims Compliance - Implementation Guide

## Overview

This document provides comprehensive guidance for the RFC 8693 delegation claims compliance implementation in Phase 58. The implementation ensures proper delegation pattern with correct `may_act` and `act` claim structures, where user tokens contain authorized agent identifiers and exchanged tokens contain complete delegation chains preserving user subject identity.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Implementation Components](#implementation-components)
3. [Token Structures](#token-structures)
4. [Delegation Chain Validation](#delegation-chain-validation)
5. [Identity Format Standardization](#identity-format-standardization)
6. [Error Handling](#error-handling)
7. [Testing Strategy](#testing-strategy)
8. [Migration Guide](#migration-guide)
9. [Troubleshooting](#troubleshooting)
10. [Security Considerations](#security-considerations)

## Architecture Overview

### Core Services

```
┌─────────────────────────────────────────────────────────────┐
│                    Delegation Claims Layer                   │
├─────────────────────────────────────────────────────────────┤
│  DelegationClaimsService        │  IdentityFormatService      │
│  - may_act validation           │  - URI standardization       │
│  - act claim validation         │  - Legacy format mapping     │
│  - Delegation chain validation │  - Format validation        │
├─────────────────────────────────────────────────────────────┤
│  EnhancedTokenExchangeService  │  DelegationChainService     │
│  - Subject preservation        │  - Chain integrity checks    │
│  - Nested act claims           │  - Circular detection        │
│  - Two-exchange delegation     │  - Chain reconstruction      │
├─────────────────────────────────────────────────────────────┤
│              Validation Middleware                      │
│  - Request validation          │  - Error handling            │
│  - Token extraction            │  - Audit logging             │
│  - Response standardization     │  - Caching                    │
└─────────────────────────────────────────────────────────────┘
```

### Integration Points

- **OAuth Service**: Enhanced token exchange with proper claim structures
- **Agent MCP Service**: Integration for delegation validation
- **Audit Store**: Comprehensive logging of validation events
- **Configuration Store**: Feature flags and validation settings

## Implementation Components

### 1. Delegation Claims Service (`delegationClaimsService.js`)

**Purpose**: Core validation logic for RFC 8693 delegation claims

**Key Features**:
- `may_act` claim structure validation
- `act` claim structure validation  
- Delegation chain integrity verification
- Identifier format validation
- Legacy format mapping

**Usage Example**:
```javascript
const { validateDelegationClaims } = require('./services/delegationClaimsService');

// Validate user token may_act claims
const userValidation = validateDelegationClaims(userToken, 'user', userPreferences);

// Validate exchanged token act claims
const exchangedValidation = validateDelegationClaims(exchangedToken, 'exchanged');

// Validate complete delegation chain
const chainValidation = validateDelegationChain(userToken, exchangedToken);
```

### 2. Enhanced Token Exchange Service (`enhancedTokenExchangeService.js`)

**Purpose**: Ensures proper RFC 8693 token exchange with enhanced act claim structures

**Key Features**:
- Subject preservation through all exchange steps
- Proper nested `act` claim construction
- Two-exchange delegation support
- Token validation and reconstruction
- Comprehensive error handling

**Usage Example**:
```javascript
const { EnhancedTokenExchangeService } = require('./services/enhancedTokenExchangeService');

const enhancedService = new EnhancedTokenExchangeService(oauthService);

// Single exchange with actor token
const result = await enhancedService.performEnhancedTokenExchange(
  userToken,
  audience,
  scopes,
  { actorToken, constructNestedAct: true }
);

// Two-exchange delegation
const delegationResult = await enhancedService.performTwoExchangeDelegation(
  userToken,
  agentClientId,
  agentClientSecret,
  mcpClientId,
  mcpClientSecret,
  mcpResourceUri,
  scopes
);
```

### 3. Identity Format Standardization Service (`identityFormatStandardizationService.js`)

**Purpose**: Standardizes agent and MCP server identifier formats using URI-based naming

**Key Features**:
- URI-based identifier validation
- Legacy format mapping
- Batch standardization
- Format documentation
- Migration reporting

**Usage Example**:
```javascript
const { IdentityFormatStandardizationService } = require('./services/identityFormatStandardizationService');

const identityService = new IdentityFormatStandardizationService();

// Validate identifier format
const validation = identityService.validateIdentifierFormat('https://banking-agent.pingdemo.com/agent/test-agent', 'agent');

// Standardize legacy identifier
const standardized = identityService.standardizeIdentifier('legacy-agent', 'agent');

// Batch standardization
const batchResult = identityService.batchStandardize(['agent-1', 'agent-2'], 'agent');
```

### 4. Delegation Chain Validation Service (`delegationChainValidationService.js`)

**Purpose**: Comprehensive validation of complete delegation chain integrity

**Key Features**:
- Chain reconstruction from tokens
- Integrity verification
- Circular delegation detection
- Chain visualization
- Performance monitoring

**Usage Example**:
```javascript
const { DelegationChainValidationService } = require('./services/delegationChainValidationService');

const chainService = new DelegationChainValidationService();

// Validate complete delegation chain
const validation = await chainService.validateDelegationChain(
  userToken,
  exchangedToken,
  { chainType: 'single_exchange', strict: true }
);

// Generate chain visualization
const visualization = chainService.generateChainVisualization(validation.chain);

// Get chain statistics
const stats = chainService.getChainStatistics(validation.chain);
```

### 5. Validation Middleware (`delegationValidationMiddleware.js`)

**Purpose**: Express.js middleware for delegation claims validation and error handling

**Key Features**:
- Request token extraction
- Claim validation middleware
- Standardized error responses
- Audit logging
- Performance caching

**Usage Example**:
```javascript
const { DelegationValidationMiddleware } = require('./middleware/delegationValidationMiddleware');

const validationMiddleware = new DelegationValidationMiddleware({
  strict: true,
  autoFix: false,
  enableCaching: true,
  enableAuditLogging: true
});

// Apply middleware to routes
app.use('/api/delegated-endpoint', 
  validationMiddleware.validateUserToken(),
  validationMiddleware.validateDelegationChain('single_exchange'),
  delegatedEndpointHandler
);
```

## Token Structures

### User Token Structure

```json
{
  "sub": "user-12345",
  "aud": ["banking-api"],
  "iss": "https://auth.pingone.com/123456/as",
  "exp": 1640995200,
  "iat": 1640991600,
  "may_act": {
    "sub": "https://banking-agent.pingdemo.com/agent/test-agent"
  },
  "scope": "banking:read banking:write banking:agent:invoke"
}
```

**Key Requirements**:
- `sub`: User subject identifier (required)
- `may_act`: Authorized agent identifier (required for delegation)
- `may_act.sub`: Must be valid agent identifier format

### Exchanged Token Structure (Single Exchange)

```json
{
  "sub": "user-12345",
  "aud": ["https://mcp-server.pingdemo.com"],
  "iss": "https://auth.pingone.com/123456/as",
  "exp": 1640993400,
  "iat": 1640991700,
  "act": {
    "sub": "https://banking-app.pingdemo.com/bff/core"
  },
  "scope": "banking:read banking:agent:invoke"
}
```

**Key Requirements**:
- `sub`: User subject preserved from original token (required)
- `act`: Actor claim (required)
- `act.sub`: Current exchanger identifier (required)
- `act.act.sub`: Not expected in the simple 1-exchange path

### Exchanged Token Structure (Two-Exchange Delegation)

```json
{
  "sub": "user-12345",
  "aud": ["https://mcp-server.pingdemo.com"],
  "iss": "https://auth.pingone.com/123456/as",
  "exp": 1640995200,
  "iat": 1640993400,
  "act": {
    "sub": "https://mcp-server.pingdemo.com/mcp/test-mcp",
    "act": {
      "sub": "https://intermediate.pingdemo.com/mcp/intermediate",
      "act": {
        "sub": "https://banking-agent.pingdemo.com/agent/test-agent"
      }
    }
  },
  "scope": "banking:read banking:agent:invoke"
}
```

## Delegation Chain Validation

### Expected Chain Patterns

#### Single Exchange Chain (2 nodes)
```
user → current_exchanger
```

#### Two-Exchange Chain (3 nodes)
```
user → ai_agent → mcp_service
```

#### Subject-Only Chain (1 node)
```
user
```

### Validation Rules

1. **Subject Preservation**: User subject must be preserved through all exchanges
2. **Agent Authorization**: Agent must be authorized in user's `may_act` claim
3. **Current Actor Identity**: act.sub must match the current exchanger or MCP-facing actor
4. **Nested Actor Identity**: act.act.sub, when present, must match the prior AI agent in a multi-hop chain
5. **Circular Detection**: No circular references allowed in chain
6. **Format Compliance**: All identifiers must follow standard format

### Chain Reconstruction Example

```javascript
// Input tokens
const userToken = {
  sub: "user-12345",
  may_act: { sub: "https://banking-agent.pingdemo.com/agent/test-agent" }
};

const exchangedToken = {
  sub: "user-12345",
  act: {
    sub: "https://mcp-server.pingdemo.com/mcp/test-mcp",
    act: { sub: "https://banking-agent.pingdemo.com/agent/test-agent" }
  }
};

// Reconstructed chain
const chain = [
  { type: 'user', sub: 'user-12345', may_act: { sub: 'https://banking-agent.pingdemo.com/agent/test-agent' } },
  { type: 'agent', sub: 'https://banking-agent.pingdemo.com/agent/test-agent' },
  { type: 'mcp_server', sub: 'https://mcp-server.pingdemo.com/mcp/test-mcp' }
];
```

## Identity Format Standardization

### Standard URI Formats

#### Agent Identifiers
```
Pattern: https://{domain}.pingdemo.com/agent/{agent-id}
Example: https://banking-agent.pingdemo.com/agent/test-agent
```

#### MCP Server Identifiers
```
Pattern: https://{domain}.pingdemo.com/mcp/{mcp-id}
Example: https://mcp-server.pingdemo.com/mcp/banking-mcp
```

### Legacy Format Mapping

#### Legacy Agent Identifiers
```
Legacy: test-agent
Standard: https://banking-agent.pingdemo.com/agent/test-agent
```

#### Legacy MCP Server Identifiers
```
Legacy: test-mcp
Standard: https://mcp-server.pingdemo.com/mcp/test-mcp
```

### Migration Strategy

1. **Validation**: Identify legacy formats through validation
2. **Mapping**: Automatically map to standard formats
3. **Warning**: Log warnings for legacy format usage
4. **Documentation**: Provide migration guidance
5. **Deprecation**: Plan future deprecation of legacy formats

## Error Handling

### Error Codes and HTTP Status

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| DELEGATION_001 | 400 | Invalid token format |
| DELEGATION_002 | 401 | Missing token |
| DELEGATION_020 | 403 | Missing may_act claim |
| DELEGATION_022 | 403 | Unauthorized agent |
| DELEGATION_040 | 403 | Subject not preserved |
| DELEGATION_041 | 403 | Circular delegation |
| DELEGATION_100 | 500 | Validation failed |

### Error Response Format

```json
{
  "error": "DELEGATION_020",
  "message": "Missing may_act claim in user token",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "requestId": "req-123456",
  "tokenType": "user",
  "errors": ["Missing may_act claim"],
  "warnings": []
}
```

### Error Handling Best Practices

1. **Structured Errors**: Use standardized error codes and messages
2. **Context Information**: Include request ID and token type
3. **Audit Logging**: Log all validation failures
4. **Graceful Degradation**: Provide fallback options when possible
5. **Security**: Don't expose sensitive information in error messages

## Testing Strategy

### Test Coverage Requirements

- **Unit Tests**: >95% coverage for all services
- **Integration Tests**: End-to-end delegation flows
- **Security Tests**: Malformed claim handling
- **Performance Tests**: Validation under load
- **Compliance Tests**: RFC 8693 specification compliance

### Test Categories

#### 1. Unit Tests
- Individual service method testing
- Claim structure validation
- Identifier format validation
- Error handling scenarios

#### 2. Integration Tests
- Complete token exchange flows
- Middleware integration
- Database/cache interactions
- External service dependencies

#### 3. Security Tests
- Malformed JWT handling
- Claim tampering detection
- Circular delegation prevention
- Unauthorized agent blocking

#### 4. Performance Tests
- Validation latency measurement
- Concurrent request handling
- Memory usage monitoring
- Cache efficiency testing

### Test Data Examples

#### Valid User Token
```javascript
const validUserToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMzQ1IiwibWF5X2FjdCI6eyJzdWIiOiJodHRwczovL2JhbmtpbmctYWdlbnQucGluZ2RlbW8uY29tL2FnZW50L3Rlc3QtYWdlbnQifX0.SflKxwRJSMeQ98PjmYQhQjFzLhOA-7h5aYFFI';
```

#### Invalid Token (Missing may_act)
```javascript
const invalidUserToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMzQ1In0.SflKxwRJSMeQ98PjmYQhQjFzLhOA-7h5aYFFI';
```

#### Circular Delegation Token
```javascript
const circularToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMzQ1IiwibWF5X2FjdCI6eyJzdWIiOiJ1c2VyLTEyMzQ1In19.SflKxwRJSMeQ98PjmYQhQjFzLhOA-7h5aYFFI';
```

## Migration Guide

### From Legacy Implementation

#### 1. Assessment
- Identify current token structures
- Check for existing `may_act` claims
- Validate identifier formats
- Document current delegation patterns

#### 2. Planning
- Define migration timeline
- Plan backward compatibility
- Set up monitoring and alerting
- Prepare rollback procedures

#### 3. Implementation
- Deploy new validation services
- Update token exchange logic
- Add middleware to existing routes
- Enable comprehensive logging

#### 4. Validation
- Test with existing tokens
- Validate new token structures
- Monitor performance impact
- Check error rates

#### 5. Migration
- Gradual rollout with feature flags
- Monitor for issues
- Update documentation
- Train development team

### Backward Compatibility

- **Legacy Format Support**: Automatic mapping for legacy identifiers
- **Graceful Degradation**: Continue operation with warnings
- **Feature Flags**: Control new validation behavior
- **Monitoring**: Track legacy vs. standard format usage

## Troubleshooting

### Common Issues

#### 1. Missing may_act Claim
**Symptoms**: Token exchange failures, authorization errors
**Causes**: PingOne token policy not configured
**Solutions**: 
- Configure may_act attribute mapping in PingOne
- Enable ff_inject_may_act feature flag for testing
- Update user preferences to include authorized agents

#### 2. Invalid Identifier Format
**Symptoms**: Validation warnings, format errors
**Causes**: Legacy identifier formats in use
**Solutions**:
- Use identity standardization service
- Update agent/MCP configurations
- Plan migration to standard formats

#### 3. Subject Not Preserved
**Symptoms**: Chain validation failures, audit issues
**Causes**: Token exchange not preserving subject
**Solutions**:
- Check PingOne token exchange configuration
- Verify token exchange implementation
- Enable subject preservation validation

#### 4. Circular Delegation
**Symptoms**: Chain validation errors, security alerts
**Causes**: Incorrect agent configuration
**Solutions**:
- Review agent authorization settings
- Check may_act claim configuration
- Validate delegation chain structure

### Debugging Tools

#### 1. Validation Logging
```javascript
// Enable detailed validation logging
const middleware = new DelegationValidationMiddleware({
  enableAuditLogging: true,
  enableMonitoring: true
});
```

#### 2. Chain Visualization
```javascript
// Generate chain visualization for debugging
const visualization = chainService.generateChainVisualization(chain);
console.log('Delegation Chain:', visualization);
```

#### 3. Format Validation
```javascript
// Validate identifier formats
const validation = identityService.validateIdentifierFormat(identifier, 'agent');
console.log('Format Validation:', validation);
```

## Security Considerations

### Threat Model

#### 1. Claim Tampering
- **Risk**: Modified delegation claims
- **Mitigation**: JWT signature validation, claim structure validation
- **Detection**: Audit logging, anomaly detection

#### 2. Unauthorized Delegation
- **Risk**: Agents not authorized by users
- **Mitigation**: may_act claim validation, user preference checking
- **Detection**: Chain validation, authorization logging

#### 3. Circular Delegation
- **Risk**: Infinite delegation loops
- **Mitigation**: Circular detection, chain length limits
- **Detection**: Chain validation, monitoring

#### 4. Identifier Confusion
- **Risk**: Ambiguous or misleading identifiers
- **Mitigation**: Standardized formats, validation
- **Detection**: Format validation, audit logging

### Security Best Practices

1. **Validate All Claims**: Never trust token claims without validation
2. **Preserve Subject**: Always verify subject preservation
3. **Check Authorization**: Validate agent authorization in may_act
4. **Monitor Chains**: Track delegation chain integrity
5. **Audit Everything**: Log all validation events
6. **Rate Limit**: Prevent abuse of delegation endpoints
7. **Secure Storage**: Protect validation cache and logs

### Compliance Requirements

- **RFC 8693**: Full compliance with token exchange specification
- **OAuth 2.0**: Compliance with core OAuth specification
- **JWT Security**: Proper JWT validation and signing
- **Audit Requirements**: Comprehensive logging and monitoring
- **Data Protection**: Secure handling of delegation data

## Conclusion

This RFC 8693 delegation claims compliance implementation provides a comprehensive, secure, and standards-compliant solution for OAuth token delegation. The implementation ensures proper delegation patterns, maintains security, and provides extensive validation and monitoring capabilities.

### Key Benefits

1. **RFC Compliance**: Full RFC 8693 specification compliance
2. **Security**: Comprehensive validation and threat protection
3. **Flexibility**: Support for multiple delegation patterns
4. **Monitoring**: Extensive audit and monitoring capabilities
5. **Migration**: Smooth migration path from legacy implementations
6. **Testing**: Comprehensive test coverage and validation

### Next Steps

1. **Deployment**: Gradual rollout with monitoring
2. **Training**: Team education on new delegation patterns
3. **Documentation**: Update API documentation and guides
4. **Monitoring**: Set up alerts for delegation issues
5. **Optimization**: Performance tuning based on usage patterns

For questions or support, refer to the troubleshooting section or contact the security team.
