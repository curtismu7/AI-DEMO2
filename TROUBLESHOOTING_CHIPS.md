# Troubleshooting: Missing or Greyed Action Chips

## Symptoms

- **Chips missing entirely**: The "Actions +" button shows no chips or an empty list
- **Chips greyed out**: Chips are visible but disabled (cannot click)
- **Tool discovery fails**: Browser console shows 502 errors on `/api/demo-agent/tools`

## Root Causes

### 1. Token Exchange Endpoint Not Found (404)
The RFC 8693 `/as/token` endpoint is not registered or the authz server is down.

**Check:**
```bash
curl -X POST http://localhost:9001/as/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange&subject_token=test&subject_token_type=urn:ietf:params:oauth:token-type:jwt"
```

**Should return:** JSON with `access_token` field (not HTML 404)

**If 404:**
- Authz server crashed: `docker-compose restart authz-server`
- Route not registered: Check `demo_authz_server/index.js` has `app.post('/as/token', require('./routes/token'))`
- Rebuild required: `docker-compose up --build authz-server`

### 2. Token Exchange Failing (Invalid Token Error)
The RFC 8693 exchange rejects the actor token with "invalid or expired" error.

**Check:** `docker logs ai-demo-authz-server | grep "actor token"`

**Causes:**
- P1AZ RFC 8693 vs Demo Authz mismatch: Use demo authz for both (simpler)
- Wrong token endpoint URL: Verify `OAUTH_TOKEN_ENDPOINT` in `demo_api_server/.env`

### 3. Tool Discovery Failing (502 from /api/demo-agent/tools)
The BFF's tool discovery endpoint is failing due to upstream errors.

**Check:** `docker logs ai-demo-api-server | grep "demo-agent/tools"`

**Likely causes:**
1. Token exchange failing (see #2)
2. MCP gateway unreachable: `curl http://localhost:3005/health`
3. Config issue: Check `/api/admin/endpoint-health`

## Debug Steps

### Step 1: Check OAuth Endpoints
Visit `https://localhost:3001/api/admin/endpoint-health` in browser (admin only)

Expected output:
```json
{
  "tokenEndpoint": {"status": "healthy", "url": "http://authz-server:9001/as/token"},
  "authorizationEndpoint": {"status": "healthy", ...},
  "jwksEndpoint": {"status": "healthy", ...}
}
```

If any show `"status": "unreachable"` → that's your issue.

### Step 2: Check Authz Server Logs
```bash
docker logs ai-demo-authz-server | tail -30
```

Look for:
- `[AuthzServer] Token Exchange: POST http://localhost:9001/as/token` ✓ (endpoint registered)
- `Cannot POST /as/token` ✗ (endpoint not registered — rebuild)
- `actor token is invalid` ✗ (token exchange failing — wrong endpoint config)

### Step 3: Check API Server Logs
```bash
docker logs ai-demo-api-server | grep -i "token\|exchange\|tools" | tail -20
```

Look for:
- `[Endpoints] Token Exchange: ✓` ✓ (startup validation passed)
- `[ENDPOINT VALIDATION] Some OAuth endpoints are unreachable` ✗ (unhealthy endpoints)
- `[demo-agent/tools] error: unknown` ✗ (tool discovery failing)

## Quick Fixes

### Chips missing + Token endpoint 404
```bash
# Rebuild authz server to register the token route
docker-compose up --build authz-server
```

### Chips missing + Token exchange failing
Check which token endpoint is configured:
```bash
grep OAUTH_TOKEN_ENDPOINT demo_api_server/.env
```

If pointing to real P1AZ but failing:
```bash
# Switch to demo authz (known working)
sed -i '' 's|OAUTH_TOKEN_ENDPOINT=.*|OAUTH_TOKEN_ENDPOINT=http://authz-server:9001/as/token|' demo_api_server/.env
docker-compose down -v && docker-compose up -d
```

### Chips greyed out (but present)
Tool discovery is returning errors. Check:
1. MCP gateway health: `curl http://localhost:3005/health`
2. BFF authorization logs: `docker logs ai-demo-api-server | grep "Authorize"`
3. Gateway logs: `docker logs ai-demo-mcp-gateway | tail -20`

## Configuration Checklist

For chips to work end-to-end:

- [ ] `OAUTH_TOKEN_ENDPOINT` is set to a reachable OAuth token endpoint
- [ ] That endpoint supports RFC 8693 token exchange (try the curl above)
- [ ] `OAUTH_AUTHORIZATION_ENDPOINT` is configured (even if unused in demo)
- [ ] Authz server is healthy: `docker ps | grep authz-server` shows `(healthy)`
- [ ] API server startup logs show `[Endpoints] Token Exchange: ✓`
- [ ] `/api/admin/endpoint-health` shows all `healthy` (except `unconfigured` is OK)
- [ ] MCP gateway is healthy: `docker ps | grep mcp-gateway` shows `Up`
- [ ] BFF tool list returns tools: `curl -sk https://localhost:3001/api/demo-agent/tools` (requires auth)
