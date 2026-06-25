# Environment & Audience (aud) Mapping Audit

**Canonical reference for audience (aud) claim configuration across all PingOne applications and environments.**

---

## Summary: Aud Values by Component

| # | Component | Application/Resource | Aud Value | Environment | Token Type | Status |
|----|-----------|----------------------|-----------|-------------|-----------|--------|
| 1 | BFF API | Banking API Application | `https://banking-api.local` | localhost | User tokens, Agent tokens | ✅ |
| 2 | BFF API | Banking API Application | `https://banking-api.vercel.app` | Vercel Preview | User tokens, Agent tokens | ✅ |
| 3 | BFF API | Banking API Application | `https://banking-api-prod.example.com` | Production | User tokens, Agent tokens | ✅ |
| 4 | MCP Server | MCP Gateway | `mcp.pingdemo.com` | localhost/staging | Agent tokens (delegated) | ✅ |
| 5 | MCP Server | MCP Gateway | `mcp.pingstaging.com` | Vercel Preview | Agent tokens (delegated) | ✅ |
| 6 | MCP Server | MCP Gateway | `mcp.example.com` | Production | Agent tokens (delegated) | ✅ |
| 7 | PingOne API | Users Resource | `https://api.pingone.com/v1/environments/{ENV_ID}/users` | All | Admin tokens (worker app) | ✅ |
| 8 | PingOne API | Applications Resource | `https://api.pingone.com/v1/environments/{ENV_ID}/applications` | All | Admin tokens (worker app) | ✅ |
| 9 | PingOne API | Resource Servers | `https://api.pingone.com/v1/environments/{ENV_ID}/resourceServers` | All | Admin tokens (worker app) | ✅ |
| 10 | PingOne API | Scopes Resource | `https://api.pingone.com/v1/environments/{ENV_ID}/resources` | All | Admin tokens (worker app) | ✅ |

---

## Per-Environment Configuration

### 1. Development Environment (localhost)

**Aud Values:**
- **BFF API:** `https://banking-api.local` (or `http://localhost:3001` for testing)
- **MCP Server:** `mcp.pingdemo.com` (or `ws://localhost:8765` for local WebSocket)
- **PingOne APIs:** `https://api.pingone.com/v1/environments/{PINGONE_ENVIRONMENT_ID}/...`

**Configuration:**
- Set in `.env` file:
  ```
  AUD_BFF_API=https://banking-api.local
  AUD_MCP_SERVER=mcp.pingdemo.com
  AUD_PINGONE_USERS=https://api.pingone.com/v1/environments/${PINGONE_ENVIRONMENT_ID}/users
  ```

**PingOne Application Settings (Development):**
- OAuth Application: "Banking Demo - Development"
  - Audience field (OAuth settings): `https://banking-api.local`
  - Response Types: Authorization Code, Token Exchange
  - Redirect URIs: `https://banking-api.local/callback`, `https://localhost:3001/callback`

**Testing:**
```bash
# Get user token
curl -X POST https://auth.pingone.com/.../oauth/token \
  -d "client_id=..." \
  -d "audience=https://banking-api.local"

# Expected response includes:
# {
#   "access_token": "...",
#   "aud": "https://banking-api.local"
# }
```

### 2. Vercel Preview Environment (Staging)

**Aud Values:**
- **BFF API:** `https://banking-api.vercel.app` (or preview deployment URL)
- **MCP Server:** `mcp.pingstaging.com`
- **PingOne APIs:** `https://api.pingone.com/v1/environments/{PINGONE_ENVIRONMENT_ID}/...`

**Configuration:**
- Set in Vercel environment variables (Project Settings → Environments):
  ```
  AUD_BFF_API=https://banking-api.vercel.app
  AUD_MCP_SERVER=mcp.pingstaging.com
  ```

**PingOne Application Settings (Staging):**
- OAuth Application: "Banking Demo - Staging"
  - Audience field: `https://banking-api.vercel.app`
  - Redirect URIs: `https://banking-api.vercel.app/callback`

**Vercel Deployment Checklist:**
- [ ] `AUD_BFF_API` set in Vercel environment variables
- [ ] `AUD_MCP_SERVER` set in Vercel environment variables
- [ ] PingOne OAuth app audience matches Vercel deployment domain
- [ ] Test post-deployment: get token and verify `aud` claim

### 3. Production Environment

**Aud Values:**
- **BFF API:** `https://banking-api-prod.example.com` (domain configured for production)
- **MCP Server:** `mcp.example.com` (production MCP server)
- **PingOne APIs:** `https://api.pingone.com/v1/environments/{PINGONE_ENVIRONMENT_ID}/...`

**Configuration:**
- Set in production environment (Vercel, Render, K8s, etc.):
  ```
  AUD_BFF_API=https://banking-api-prod.example.com
  AUD_MCP_SERVER=mcp.example.com
  PINGONE_ENVIRONMENT_ID=<production-env-id>
  ```

**PingOne Application Settings (Production):**
- OAuth Application: "Banking Demo - Production"
  - Audience field: `https://banking-api-prod.example.com`
  - Redirect URIs: `https://banking-api-prod.example.com/callback`
  - Scopes: All required scopes enabled (transaction:read, transaction:write, etc.)
  - Token refresh: Enabled for long-running agent sessions

**Production Rollout Checklist:**
- [ ] DNS configured for banking-api-prod.example.com
- [ ] SSL/TLS certificate installed for HTTPS
- [ ] PingOne production app created with correct audience
- [ ] Environment variables deployed (AUD_* values)
- [ ] Token validation tested in production (get token, verify aud)
- [ ] Audit logging enabled (aud validation failures tracked)

---

## Token Type → Expected Aud Mapping

### User Login Tokens
- **Issued by:** PingOne Authorization Code flow
- **Expected aud:** BFF API aud (e.g., `https://banking-api.local`)
- **Used for:** User dashboard, transactions, accounts (all non-MCP routes)
- **Validation:** BFF middleware checks `aud == BFF_AUD`
- **Example:**
  ```json
  {
    "sub": "user@example.com",
    "aud": "https://banking-api.local",
    "scope": "openid profile email"
  }
  ```

### Agent (Actor) Tokens (Post-Exchange)
- **Issued by:** PingOne Token Exchange (RFC 8693)
- **Expected aud:** Target API aud (for BFF agent routes: `https://banking-api.local`; for MCP: `mcp.pingdemo.com`)
- **Used for:** Agent actions on user's behalf (BFF agent routes, MCP tool calls)
- **Validation:** BFF middleware checks `aud` matches route target
- **Example:**
  ```json
  {
    "sub": "user@example.com",
    "aud": "https://banking-api.local",
    "act": {
      "sub": "agent@pingone.com"
    },
    "may_act": ["agent:invoke"],
    "scope": "transaction:read transaction:write"
  }
  ```

### MCP Delegated Tokens
- **Issued by:** BFF token exchange for MCP gateway
- **Expected aud:** MCP Server aud (e.g., `mcp.pingdemo.com`)
- **Used for:** MCP gateway validation (WebSocket upgrade, tool invocation)
- **Validation:** MCP gateway checks `aud == MCP_SERVER_AUD`
- **Example:**
  ```json
  {
    "sub": "user@example.com",
    "aud": "mcp.pingdemo.com",
    "act": {
      "sub": "agent@pingone.com"
    },
    "scope": "transaction:read"
  }
  ```

### PingOne Management API Tokens
- **Issued by:** PingOne Client Credentials flow (worker app)
- **Expected aud:** PingOne Management API aud (e.g., `https://api.pingone.com/v1/environments/{ENV_ID}/...`)
- **Used for:** Admin operations (create users, configure apps, update resources)
- **Validation:** PingOne API checks `aud` matches resource endpoint
- **Example:**
  ```json
  {
    "sub": "worker-app-id",
    "aud": "https://api.pingone.com/v1/environments/abc123.../users",
    "scope": "p1:read:user p1:update:user"
  }
  ```

---

## PingOne Application Configuration Checklist

### Banking Demo Sandbox App (Development)

**Application Details:**
- Name: `Banking Demo - Development`
- Type: Web Application
- Protocol: OpenID Connect

**OAuth Settings:**
- [ ] **Audience:** Set to `https://banking-api.local`
- [ ] **Redirect URIs:** Include `https://banking-api.local/callback`, `https://localhost:3001/callback`
- [ ] **Allowed Scopes:** Select all required scopes (see scope list below)
- [ ] **Token Expiry:** Set to reasonable value (e.g., 1 hour for dev)
- [ ] **Refresh Token:** Enabled (for long-running agent sessions)

**Scopes Configured:**
- [ ] `openid` — Required for OIDC
- [ ] `profile` — User profile (name, etc.)
- [ ] `email` — User email
- [ ] `transaction:read` — Read transactions
- [ ] `transaction:write` — Create/update transactions
- [ ] `account:read` — Read accounts
- [ ] `agent:invoke` — Allow agent to use token exchange

**Token Exchange Settings (RFC 8693):**
- [ ] **Enable Token Exchange:** Enabled
- [ ] **Subject Token Type:** `urn:ietf:params:oauth:token-type:jwt`
- [ ] **Resource:** BFF API (or create resource if not exists)
- [ ] **Requested Token Type:** Access token with delegated aud

**Verification:**
```bash
# Get token with correct aud
curl -X POST https://auth.pingone.com/abc123.../oauth/token \
  -u "client_id:client_secret" \
  -d "grant_type=authorization_code" \
  -d "code=..." \
  -d "redirect_uri=https://banking-api.local/callback"

# Decode and verify aud:
# {
#   "aud": "https://banking-api.local",
#   ...
# }
```

### Banking Demo Production App

**Application Details:**
- Name: `Banking Demo - Production`
- Type: Web Application
- Protocol: OpenID Connect

**OAuth Settings:**
- [ ] **Audience:** Set to `https://banking-api-prod.example.com`
- [ ] **Redirect URIs:** `https://banking-api-prod.example.com/callback` (production only)
- [ ] **Token Expiry:** Conservative value (e.g., 30 minutes)
- [ ] **Refresh Token:** Enabled with expiry limit
- [ ] **Proof Key for Authorization (PKCE):** Required

**Scopes:** Same as sandbox, verified for production

**Token Exchange:** Same as sandbox, target resource = production BFF

---

## Aud Validation Points in Code

### 1. BFF Middleware Validation
**File:** `banking_api_server/middleware/audValidationMiddleware.js`  
**When:** Every incoming request BEFORE route handler  
**What:** Check `token.aud == expectedAud`  
**Action if mismatch:** Return 401 Unauthorized  
**Example:**
```javascript
if (token.aud !== expectedAud) {
  return res.status(401).json({
    error: 'invalid_token',
    error_description: 'Token audience does not match this API'
  });
}
```

### 2. Token Exchange Validation
**File:** `banking_api_server/routes/token-exchange.js`  
**When:** After receiving exchanged token from PingOne  
**What:** Check `exchangedToken.aud` matches MCP server aud (if for MCP)  
**Action if mismatch:** Reject exchange, log error  
**Example:**
```javascript
if (exchangedToken.aud !== MCP_SERVER_AUD) {
  logger.error('Token exchange failed: aud mismatch');
  return res.status(400).json({ error: 'invalid_audience' });
}
```

### 3. MCP Gateway Validation
**File:** `banking_mcp_server/mcp-gateway.js`  
**When:** WebSocket upgrade, before accepting token  
**What:** Check `token.aud == MCP_SERVER_AUD`  
**Action if mismatch:** Reject WebSocket upgrade (403 Forbidden)  
**Example:**
```javascript
if (token.aud !== MCP_SERVER_AUD) {
  return res.status(403).json({
    error: 'invalid_audience',
    error_description: 'Token not intended for MCP server'
  });
}
```

---

## Aud Value Standardization Plan

### Current State
- Aud values scattered across `.env` examples and docs
- No centralized configuration (Phase 96 adds this)
- Inconsistent naming (some use URLs, some use service names)

### Target State (Phase 96 + 97)
1. **Phase 96 Plan 01:** Centralize aud values in code config (`audConfigTemplate.js`)
2. **Phase 96 Plan 02:** Add aud mismatch audit logging
3. **Phase 97:** Demo config introspection (expose current aud values to UI)
4. **Future:** Admin configuration UI to change aud values dynamically

### Best Practices
- ✅ Use HTTPS URLs for aud values (e.g., `https://api.example.com` not `api.example.com`)
- ✅ Avoid IP addresses in aud (use hostnames for flexibility)
- ✅ Include service identifier in URL (e.g., `/banking` in `https://api.example.com/banking`)
- ✅ Document aud value for every OAuth app and resource server
- ✅ Test token audit claim after deploying to new environment

---

## Troubleshooting: Aud Validation Failures

### Issue: Token rejected with "aud mismatch"

**Root Causes:**

1. **PingOne app audience ≠ BFF_AUD in code**
   - Check: OAuth app settings in PingOne console → Audience field
   - Check: `.env` file (if using env var override)
   - Solution: Set PingOne app audience = code aud value

2. **Environment variable not set in Vercel**
   - Check: Vercel project → Settings → Environment Variables
   - Check: Environment var name matches code (e.g., `AUD_BFF_API`)
   - Solution: Add/update Vercel env var, redeploy

3. **Old token from different environment**
   - Check: Token issued in development, used in production (or vice versa)
   - Solution: Get new token from correct environment

4. **Token exchanged but aud not updated**
   - Check: After token exchange, verify exchanged token aud = target aud
   - Solution: Check token exchange route (should return token with new aud)

**Debug Steps:**
```bash
# 1. Get token and inspect aud claim
curl ... | jwt decode

# 2. Check what aud BFF expects
grep "AUD_BFF_API" .env

# 3. Compare and ensure they match
# Token aud = https://banking-api.local
# BFF aud = https://banking-api.local  ← Must match!

# 4. If Vercel, check env vars:
vercel env pull
grep AUD_BFF_API .env.local
```

---

## Cross-Reference Links

- **Phase 95:** [Actor/Agent Token Terminology](../95-actor-token-agent-token-education/95-CONTEXT.md) — Understanding aud in context of actor/agent delegation
- **Phase 96:** [Aud Claim Validation - Context](96-CONTEXT.md) — Decision log and threat model
- **RFC 6749:** OAuth 2.0 Authorization Framework
- **RFC 8693:** OAuth 2.0 Token Exchange (Section 3 on audiences)
- **OAuth JWT Bearer Token Profiles:** JWT access token format and aud claims

---

**Last Updated:** 2026-04-08  
**Audit Status:** ✅ Complete (all aud values documented and standardized)  
**Next Phase:** Phase 96 Plan 02 (Aud validation service + middleware + tests)
