# MFA Logging System — Complete Guide

## Overview

The MFA Logging System provides comprehensive logging for all MFA API calls, operations, and debugging information. Every test on the MFA test page is logged with full details including:

- **API endpoints and methods** (GET, POST, PUT)
- **Request headers** (sanitized for security)
- **Request bodies** (OTP codes and tokens redacted)
- **Response bodies** (full data with sensitive values redacted)
- **HTTP status codes**
- **Duration in milliseconds**
- **User and device IDs**
- **Error details** (when operations fail)

## Quick Start

### 1. View Logs via API

Retrieve the last 50 MFA logs:
```bash
curl http://localhost:3001/api/mfa/test/logs?count=50
```

### 2. View Logs in Real-Time

Watch log file in real-time:
```bash
tail -f ./logs/mfa.log
```

Parse and format logs:
```bash
tail -f ./logs/mfa.log | jq '.'
```

### 3. Clear Logs

```bash
curl -X DELETE http://localhost:3001/api/mfa/test/logs
```

## Log Entry Structure

### API Call Log Entry

```json
{
  "timestamp": "2026-05-04T10:00:40.609Z",
  "type": "API_CALL",
  "operation": "Initiate Device Authentication",
  "method": "POST",
  "url": "https://api.pingone.com/v1/environments/{envId}/deviceAuthentications",
  "status": 200,
  "duration_ms": 245,
  "userId": "user-abc123",
  "deviceId": null,
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "***REDACTED***"
  },
  "request": {
    "method": "SMS"
  },
  "response": {
    "id": "da-xyz789",
    "status": "PENDING",
    "expiresAt": "2026-05-04T10:15:40.609Z"
  }
}
```

### Operation Log Entry

```json
{
  "timestamp": "2026-05-04T10:00:40.609Z",
  "type": "MFA_OPERATION",
  "operation": "Initiate Device Authentication",
  "userId": "user-abc123",
  "deviceId": null,
  "method": "SMS",
  "status": "PENDING",
  "daId": "da-xyz789",
  "message": "Device authentication initiated for method: SMS"
}
```

### Error Log Entry

```json
{
  "timestamp": "2026-05-04T10:00:40.609Z",
  "type": "ERROR",
  "operation": "Verify OTP",
  "userId": "user-abc123",
  "error": {
    "message": "Invalid OTP code",
    "code": "INVALID_OTP",
    "status": 400,
    "details": "The provided OTP code does not match..."
  },
  "stackTrace": "Error: Invalid OTP...\n  at..."
}
```

## Logging Categories

Each log entry is categorized by type:

| Type | Description | Example |
|------|-------------|---------|
| `API_CALL` | PingOne API call with full request/response | POST to `/deviceAuthentications` |
| `MFA_OPERATION` | High-level MFA operation | Initiate Challenge, Verify OTP |
| `DEVICE_SELECTION` | Device selection event | User selected SMS device |
| `DEVICE_LIST` | Device enumeration | Listed 3 enrolled devices |
| `ERROR` | Error that occurred | Failed verification, auth error |
| `DEBUG` | Debug information (debug mode only) | Variable values, flow decisions |

## Security & Data Redaction

Sensitive data is automatically redacted:

| Sensitive Field | Redacted As |
|-----------------|------------|
| Authorization headers | `***REDACTED***` |
| OTP/PIN codes | `***REDACTED***` |
| Access tokens | `***REDACTED***` |
| Refresh tokens | `***REDACTED***` |
| Passwords | `***REDACTED***` |
| ID tokens | `***REDACTED***` |

**Note:** The logs are safe to share in tickets or with support since sensitive values are automatically masked.

## Accessing Logs Programmatically

### Via REST API

```bash
# Get last 100 logs
GET /api/mfa/test/logs?count=100

# Get last 20 logs
GET /api/mfa/test/logs?count=20

# Clear logs
DELETE /api/mfa/test/logs
```

### Via JavaScript

```javascript
// In browser console
fetch('/api/mfa/test/logs?count=50')
  .then(r => r.json())
  .then(data => {
    console.log('Recent logs:', data.logs);
    data.logs.forEach(log => {
      console.log(`[${log.timestamp}] ${log.type} - ${log.operation}`);
    });
  });
```

### Via Node.js

```javascript
const { mfaLogger } = require('./utils/mfaLogger');

// Get recent 50 logs
const logs = mfaLogger.getRecentLogs(50);
console.log(logs);

// Clear logs
mfaLogger.clearLogs();
```

## Environment Variables

### LOG_DIRECTORY

Set custom log directory:
```bash
export LOG_DIRECTORY=/var/log/mfa
```

Default: `./logs`

### MFA_DEBUG

Enable verbose console output:
```bash
export MFA_DEBUG=true
```

When enabled, full log entries are printed to console (in addition to file logging).

## Debugging Workflow

### 1. Run a Test

Navigate to `/mfa-test` and run a test (e.g., "Initiate SMS OTP Challenge").

### 2. Check the Logs

```bash
# Get last 10 logs
curl http://localhost:3001/api/mfa/test/logs?count=10 | jq '.'
```

### 3. Look for the Operation

Find the relevant `Initiate Device Authentication` or `Verify OTP` entry.

### 4. Analyze Request/Response

```bash
# Pretty-print the request
curl http://localhost:3001/api/mfa/test/logs?count=1 | \
  jq '.logs[0].request'

# Pretty-print the response
curl http://localhost:3001/api/mfa/test/logs?count=1 | \
  jq '.logs[0].response'
```

### 5. Check Duration

Look at `duration_ms` to identify slow API calls:
```bash
curl http://localhost:3001/api/mfa/test/logs?count=20 | \
  jq '.logs[] | {operation, duration_ms, status}'
```

## Troubleshooting

### Logs Not Appearing

1. **Verify logging is enabled:**
   - Check that `LOG_DIRECTORY` is writable
   - Verify `./logs/` directory exists

2. **Enable debug mode:**
   ```bash
   export MFA_DEBUG=true
   ```
   Restart the server and check console output.

3. **Check log file:**
   ```bash
   ls -lh ./logs/mfa.log
   tail -f ./logs/mfa.log
   ```

### Logs Disappearing

Logs are kept in memory and written to file. To clear:
```bash
curl -X DELETE http://localhost:3001/api/mfa/test/logs
```

To preserve logs across restarts, ensure `./logs/` is persistent.

## Performance Notes

- Logging adds minimal overhead (~1-2ms per operation)
- Log entries are written asynchronously to file
- API response times include logging time
- Large log files can be manually rotated:
  ```bash
  mv ./logs/mfa.log ./logs/mfa.log.$(date +%s)
  ```

## Examples

### Example 1: Trace a Failed OTP Verification

```bash
# Get logs
curl http://localhost:3001/api/mfa/test/logs?count=5 | jq '.'

# Filter for errors
curl http://localhost:3001/api/mfa/test/logs?count=20 | \
  jq '.logs[] | select(.type == "ERROR")'
```

Output shows:
- What OTP was sent
- What OTP was submitted
- Why verification failed
- Full PingOne error details

### Example 2: Monitor Device Selection

```bash
curl http://localhost:3001/api/mfa/test/logs?count=10 | \
  jq '.logs[] | select(.type == "DEVICE_SELECTION")'
```

Shows all device selections with device type and outcome.

### Example 3: Check API Performance

```bash
curl http://localhost:3001/api/mfa/test/logs?count=50 | \
  jq '.logs[] | select(.type == "API_CALL") | {operation, duration_ms, status}' | \
  sort
```

Identifies slow API endpoints and any errors.

## Integration with Support

When reporting MFA issues:

1. **Export relevant logs:**
   ```bash
   curl http://localhost:3001/api/mfa/test/logs?count=100 > mfa_logs.json
   ```

2. **Include in ticket:**
   - The `mfa_logs.json` file (contains sanitized data)
   - Steps to reproduce
   - Expected vs. actual behavior

3. **Support can analyze:**
   - API call sequence
   - Error codes and messages
   - Timing issues
   - Authentication problems

## Further Reading

- [MFA Test Page Guide](./MFA_DEVICE_PICKER_GUIDE.md)
- [PingOne MFA API Documentation](https://developer.pingidentity.com/pingone-api/mfa/)
