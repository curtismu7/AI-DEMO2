# Phase 56-05 Enhancement: Error Code Integration Guide

## Overview

Phase 56-05 Enhancement provides structured, RFC 8693-compliant error code responses throughout the token exchange service. This guide documents how error codes flow through the system and how to integrate them into error handlers.

## Error Code Flow Architecture

```
Error Occurs
    ↓
mapErrorToStructuredResponse()  ← Maps to RFC 8693 code
    ↓
getErrorDetails()  ← Gets metadata (HTTP status, category, description)
    ↓
buildTokenEvent()  ← Adds error_code & category to UI event
    ↓
writeExchangeEvent()  ← Logs structured error to audit trail
    ↓
Response with error_code field  ← Returned to caller
```

## Integration Pattern

### 1. Import Error Code Functions

```javascript
const { getErrorDetails, mapErrorToCode } = require('./configStore');
const { mapErrorToStructuredResponse } = require('./agentMcpTokenService');
```

### 2. Catch and Map Errors

```javascript
try {
  // Token exchange operation
  const token = await oauthService.performTokenExchange(...);
} catch (err) {
  // Map error to RFC 8693 code
  const { errorCode, errorDetails, message } = mapErrorToStructuredResponse(err);
  
  // errorCode: 'invalid_client' | 'invalid_grant' | 'invalid_scope' | etc.
  // errorDetails: { http_status, oauth_error, description, category }
  // message: Human-readable error message
}
```

### 3. Add Error Code to Token Events

```javascript
tokenEvents.push(buildTokenEvent(
  'exchange-failed',
  'Token Exchange Failed',
  'failed',
  null,
  message,
  {
    error_code: errorCode,  // ← RFC 8693 error code
    category: errorDetails.category,  // ← Error category
    http_status: errorDetails.http_status,  // ← HTTP status
    pingoneError: err.pingoneError,
    rfc: 'RFC 8693',
  }
));
```

### 4. Log Structured Error Event

```javascript
void writeExchangeEvent({
  type: 'exchange-failed',
  level: 'error',
  message: `[TokenExchange] Failed — ${message}`,
  error_code: errorCode,  // ← Structured code for logging
  error_category: errorDetails.category,  // ← Category for metrics
  http_status: errorDetails.http_status,  // ← Status for monitoring
  oauth_error: errorDetails.oauth_error,  // ← RFC 8693 error string
  pingoneError: err.pingoneError,
  context: {
    audience: mcpResourceUri,
    scopes: effectiveToolScopes,
    method: exchangeMethod,
  },
});
```

## Error Code Reference by Phase Location

### Scoping & Audience Validation (Phase 56-04)

**Error Code Mapping**:
- `invalid_scope` — Requested scope not valid for audience (RFC 8707)
- `unauthorized_client` — Client not authorized for scope

**Token Event Fields**:
```javascript
{
  error_code: 'invalid_scope',
  message: 'Requested scope transfer:execute not allowed for https://mcp-gateway.example.com',
  category: 'Scope',
  validScopes: ['banking:mcp:invoke', 'mcp_resource_access'],
  requestedScopes: ['transfer:execute'],
}
```

### Error Code Standardization (Phase 56-05)

**Error Codes Defined**:
- Configuration: `config.missing_credentials`, `config.invalid_audience`
- Authentication: `invalid_client`, `invalid_token`, `token_expired`
- Authorization: `unauthorized_client`, `access_denied`, `may_act_validation_failed`
- Scope: `invalid_scope`, `insufficient_scope`
- Request: `invalid_request`
- Server: `server_error`, `temporarily_unavailable`

**Token Event Fields**:
```javascript
{
  error_code: 'invalid_client',
  category: 'Authentication',
  http_status: 401,
  oauth_error: 'invalid_client',
  message: 'Client authentication failed: unknown client or credentials',
  remediation: 'Check PINGONE_AI_AGENT_CLIENT_ID and client secret in environment',
}
```

## Implementation Checklist

To fully integrate error codes into your error handlers:

- [ ] Import `mapErrorToStructuredResponse` from agentMcpTokenService
- [ ] Wrap token exchange calls in try/catch
- [ ] Call `mapErrorToStructuredResponse(err)` on error
- [ ] Add `error_code` and `category` to tokenEvents via buildTokenEvent
- [ ] Add error_code to writeExchangeEvent audit logs
- [ ] Test error code mappings with different error scenarios
- [ ] Verify RFC 8693 response format in HTTP responses
- [ ] Monitor error_code metrics in audit logs

## Error Code Response Format (RFC 8693 §5.2)

All error responses follow this format:

```json
{
  "error": "invalid_scope",
  "error_description": "The requested scope is invalid",
  "error_code": "invalid_scope"
}
```

**In Token Events**:
```javascript
{
  id: 'exchange-failed-...',
  label: 'Token Exchange Failed',
  status: 'failed',
  claims: null,
  message: 'Error description',
  extra: {
    error_code: 'invalid_scope',
    category: 'Scope',
    http_status: 400,
    oauth_error: 'invalid_scope',
    rfc: 'RFC 8693'
  }
}
```

## Monitoring & Alerting

Error codes enable structured monitoring:

```javascript
// Alert if authentication errors spike
const authErrors = auditLog.filter(e => 
  e.error_category === 'Authentication' && e.timestamp > oneHourAgo
);

// Track scope mismatch patterns
const scopeErrors = auditLog.filter(e => e.error_code === 'invalid_scope');

// Monitor authorization failures
const authzErrors = auditLog.filter(e => 
  e.error_category === 'Authorization' && e.error_code === 'access_denied'
);
```

## Testing Error Codes

Test that errors are mapped correctly:

```javascript
describe('Error Code Mapping', () => {
  it('should map invalid_client error', () => {
    const err = new Error('Client authentication failed');
    err.pingoneError = 'invalid_client';
    
    const { errorCode, errorDetails } = mapErrorToStructuredResponse(err);
    
    expect(errorCode).toBe('invalid_client');
    expect(errorDetails.category).toBe('Authentication');
    expect(errorDetails.http_status).toBe(401);
  });
  
  it('should map invalid_scope error', () => {
    const err = new Error('Scope mismatch: transfer:execute not in [...]');
    
    const { errorCode } = mapErrorToStructuredResponse(err);
    expect(errorCode).toBe('invalid_scope');
  });
});
```

## Future Enhancements

- [ ] Integrate structured error codes into BFF routes (server.js)
- [ ] Add error code metrics to dashboard
- [ ] Create error code dashboard with trends
- [ ] Implement automatic remediation suggestions based on error_code
- [ ] Add error code documentation to Swagger/OpenAPI specs
- [ ] Implement error code rate limiting & throttling

## References

- **ERROR_CODES**: `banking_api_server/services/configStore.js` (18+ codes)
- **Error Mapping**: `mapErrorToStructuredResponse()` in agentMcpTokenService.js
- **Error Documentation**: `docs/ERROR_CODES_AND_REMEDIATION.md`
- **RFC 8693 §5.2**: https://tools.ietf.org/html/rfc8693#section-5.2
- **Phase 56-04**: RFC 8707 Scope-Audience Mapping
- **Phase 56-05**: RFC 8693 Standardized Error Codes
