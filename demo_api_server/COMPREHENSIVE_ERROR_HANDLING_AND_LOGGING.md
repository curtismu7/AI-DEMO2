# Comprehensive OAuth Error Handling and Logging

This document describes the enhanced error handling and logging system implemented for OAuth token validation in the banking API server.

## Overview

The system provides:
- **Structured logging** for all OAuth token validation events
- **Real-time monitoring** of OAuth provider response times and failures
- **Detailed error messages** for different authorization failure scenarios
- **Debug logging** for scope validation during development
- **Circuit breaker pattern** for OAuth provider resilience

## Components

### 1. Structured Logger (`utils/logger.js`)

A comprehensive logging utility that provides consistent, structured logging across the application.

#### Features:
- **Multiple log levels**: ERROR, WARN, INFO, DEBUG
- **Categorized logging**: Different categories for OAuth validation, scope validation, etc.
- **File logging support**: Optional file-based logging with rotation
- **Color-coded console output**: Easy visual identification of log levels
- **OAuth-specific logging methods**: Specialized methods for common OAuth scenarios

#### Usage:
```javascript
const { logger, LOG_CATEGORIES } = require('./utils/logger');

// Basic logging
logger.info(LOG_CATEGORIES.OAUTH_VALIDATION, 'Token validation successful', {
  user_id: 'user123',
  scopes: ['banking:read']
});

// OAuth-specific logging
logger.logAuthenticationAttempt(true, {
  method: 'GET',
  path: '/api/accounts',
  response_time_ms: 150
});
```

#### Configuration:
- `LOG_LEVEL`: Set logging level (ERROR, WARN, INFO, DEBUG)
- `ENABLE_FILE_LOGGING`: Enable file-based logging
- `LOG_DIRECTORY`: Directory for log files

### 2. OAuth Provider Monitor (`utils/oauthMonitor.js`)

Tracks OAuth provider performance and implements circuit breaker pattern.

#### Features:
- **Response time tracking**: Average and individual request times
- **Success/failure rate monitoring**: Real-time success rate calculation
- **Circuit breaker**: Automatic failover when provider is unhealthy
- **Error categorization**: Track different types of OAuth errors
- **Health status determination**: Automatic health assessment

#### Metrics Tracked:
- Total requests
- Successful/failed requests
- Average response time
- Error counts by type
- Recent errors (last 50)
- Circuit breaker status

#### Usage:
```javascript
const { oauthMonitor } = require('./utils/oauthMonitor');

// Record successful request
oauthMonitor.recordRequest(true, 150, null, { user_id: 'user123' });

// Record failed request
oauthMonitor.recordRequest(false, 300, 'invalid_token', { error_details: '...' });

// Get current metrics
const metrics = oauthMonitor.getMetrics();
```

### 3. Enhanced OAuth Error Handler (`middleware/oauthErrorHandler.js`)

Comprehensive error handling with detailed logging and monitoring integration.

#### Enhanced Features:
- **Request context tracking**: Method, path, user agent, IP address
- **Response time monitoring**: Track validation performance
- **Circuit breaker integration**: Prevent requests when provider is down
- **Detailed error categorization**: Specific error types for different scenarios
- **Retry logic with exponential backoff**: Resilient token introspection

#### Error Types:
- `INVALID_TOKEN`: Token is invalid or revoked
- `EXPIRED_TOKEN`: Token has expired
- `INSUFFICIENT_SCOPE`: Token lacks required scopes
- `AUTHENTICATION_REQUIRED`: No token provided
- `PROVIDER_UNAVAILABLE`: OAuth provider is unreachable
- `TOKEN_INTROSPECTION_FAILED`: Introspection request failed
- `MALFORMED_TOKEN`: Token format is invalid

### 4. Enhanced Authentication Middleware (`middleware/auth.js`)

Updated authentication middleware with comprehensive logging.

#### Enhancements:
- **Request context logging**: Track all authentication attempts
- **Scope parsing with logging**: Detailed scope extraction logging
- **Performance monitoring**: Track authentication response times
- **Error context preservation**: Maintain error context through the chain

## Logging Categories

The system uses categorized logging for better organization:

- `oauth_validation`: OAuth token validation events
- `scope_validation`: Scope checking and validation
- `token_introspection`: OAuth provider introspection calls
- `provider_health`: OAuth provider health checks
- `authentication`: Authentication attempts and results
- `authorization`: Authorization decisions
- `error_handling`: General error handling events

## Error Response Format

All OAuth errors follow a consistent format:

```json
{
  "error": "insufficient_scope",
  "error_description": "Access denied. At least one of the following scopes is required: banking:accounts:read",
  "timestamp": "2025-10-01T13:45:30.123Z",
  "path": "/api/accounts",
  "method": "GET",
  "required_scopes": ["banking:accounts:read"],
  "provided_scopes": ["banking:transactions:read"],
  "missing_scopes": ["banking:accounts:read"],
  "validation_mode": "any_required",
  "hint": "Ensure your token includes at least one of the required scopes"
}
```

## Health Monitoring

The `/health` endpoint provides comprehensive OAuth provider monitoring:

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2025-10-01T13:45:30.123Z",
  "service": "banking-api-server",
  "components": {
    "api": "healthy",
    "oauth_provider": "healthy",
    "oauth_details": {
      "healthy": true,
      "responseTime": 145,
      "timestamp": "2025-10-01T13:45:30.123Z",
      "metrics": {
        "total_requests": 1250,
        "success_rate": 98,
        "average_response_time": 156,
        "circuit_breaker_open": false,
        "health_status": "healthy",
        "recent_errors": []
      }
    }
  },
  "response_time_ms": 12
}
```

## Configuration

### Environment Variables

- `LOG_LEVEL`: Logging level (ERROR, WARN, INFO, DEBUG) - default: INFO
- `ENABLE_FILE_LOGGING`: Enable file logging (true/false) - default: false
- `LOG_DIRECTORY`: Log file directory - default: ./logs
- `OAUTH_FAILURE_THRESHOLD`: Circuit breaker failure threshold - default: 5
- `OAUTH_RESET_TIMEOUT`: Circuit breaker reset timeout (ms) - default: 60000
- `DEBUG_TOKENS`: Enable detailed token debugging - default: false

### Development vs Production

#### Development Settings:
```bash
LOG_LEVEL=DEBUG
DEBUG_TOKENS=true
ENABLE_FILE_LOGGING=true
```

#### Production Settings:
```bash
LOG_LEVEL=INFO
DEBUG_TOKENS=false
ENABLE_FILE_LOGGING=true
LOG_DIRECTORY=/var/log/banking-api
```

## Testing

### Comprehensive Test Suite

Run the comprehensive logging test:

```bash
node test-comprehensive-logging.js
```

This test covers:
- Missing authorization headers
- Malformed tokens
- Expired tokens
- Insufficient scopes
- Admin access validation
- Successful authentication flows
- Health endpoint monitoring

### Manual Testing

Use the demo script to see error handling in action:

```bash
node demo-enhanced-error-handling.js
```

## Monitoring and Alerting

### Key Metrics to Monitor

1. **OAuth Provider Health**:
   - Response time > 5000ms
   - Success rate < 90%
   - Circuit breaker open

2. **Authentication Failures**:
   - High rate of invalid tokens
   - Frequent scope validation failures
   - Unusual error patterns

3. **Performance**:
   - Average response times
   - Request volume
   - Error rates by type

### Log Analysis

Search for specific events:

```bash
# Authentication failures
grep "authentication.*false" logs/error.log

# Scope validation issues
grep "insufficient_scope" logs/warn.log

# OAuth provider issues
grep "provider_unavailable" logs/error.log
```

## Best Practices

1. **Log Levels**:
   - Use DEBUG for detailed troubleshooting
   - Use INFO for normal operations
   - Use WARN for recoverable issues
   - Use ERROR for serious problems

2. **Error Handling**:
   - Always provide helpful error messages
   - Include request context in logs
   - Use structured data for analysis

3. **Performance**:
   - Monitor OAuth provider response times
   - Use circuit breaker to prevent cascading failures
   - Cache introspection results when appropriate

4. **Security**:
   - Never log sensitive token data
   - Sanitize user input in logs
   - Use appropriate log levels for security events

## Troubleshooting

### Common Issues

1. **High OAuth Provider Response Times**:
   - Check network connectivity
   - Verify OAuth provider status
   - Consider caching strategies

2. **Frequent Scope Validation Failures**:
   - Review scope assignments
   - Check token generation process
   - Verify scope mapping configuration

3. **Circuit Breaker Activation**:
   - Check OAuth provider health
   - Review failure threshold settings
   - Monitor error patterns

### Debug Mode

Enable debug logging for detailed troubleshooting:

```bash
export LOG_LEVEL=DEBUG
export DEBUG_TOKENS=true
```

This provides detailed information about:
- Token parsing and validation
- Scope extraction and checking
- OAuth provider interactions
- Request/response timing

## Future Enhancements

Potential improvements:
- Metrics export to monitoring systems (Prometheus, etc.)
- Log aggregation integration (ELK stack, etc.)
- Advanced alerting rules
- Performance optimization based on metrics
- Automated health checks and recovery