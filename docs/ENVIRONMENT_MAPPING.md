# Environment Variable Mapping — PingOne → .env → Code

**Single source of truth:** PingOne Console applications and resource servers are the authoritative names and values.

---

## PingOne Applications (OAuth2 / Token Exchange)

| PingOne App Name | Purpose | Client ID | .env Variable | Secret Variable |
|---|---|---|---|---|
| **Super Banking User App** | End-user OIDC login; generates Subject Token | `b2752071-2d03-4927-b865-089dc40b9c85` | `PINGONE_USER_CLIENT_ID` | `PINGONE_USER_CLIENT_SECRET` |
| **Super Banking Admin App** | BFF/Server app; performs RFC 8693 Token Exchange #1; issues MCP Token | `14cefa5b-d9d6-4e51-8749-e938d4edd1c0` | `PINGONE_ADMIN_CLIENT_ID` | `PINGONE_ADMIN_CLIENT_SECRET` |
| **Super Banking MCP Token Exchanger** | Type: `AI_AGENT`. Performs RFC 8693 token exchange(s); actor credential for 1-exchange and 2-exchange chain. Auth method: `client_secret_post`. | `6380065f-f328-41c2-81ed-1daeec811285` | `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` | `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET` |
| **Super Banking AI Agent App** | Type: `AI_AGENT`. Exchange #1 actor in the 2-exchange delegated chain; Client Credentials only. | `2533a614-fcb6-4ab9-82cc-9ab407f1dbda` | `PINGONE_AI_AGENT_CLIENT_ID` | `PINGONE_AI_AGENT_CLIENT_SECRET` |
| **Super Banking Worker Token App** | Type: `WORKER`. PingOne Management API access (read/update users, audit resources). Auth method: `basic`. | `95dc946f-5e0a-4a8b-a8ba-b587b244e005` | `PINGONE_WORKER_TOKEN_CLIENT_ID` | `PINGONE_WORKER_TOKEN_CLIENT_SECRET` |

---

## PingOne Resource Servers (OAuth2 Scopes / Token Audiences)

| PingOne Resource Name | Purpose | Audience URI | .env Variable | Scopes |
|---|---|---|---|---|
| **Super Banking AI Agent** | Subject Token audience (Banking RS); carries `may_act` claim for delegation | `https://ai-agent.pingdemo.com` | `ENDUSER_AUDIENCE` | `banking:read` `banking:write` `banking:admin` `banking:sensitive` `banking:ai:agent` |
| **Super Banking MCP Server** | MCP Token audience; carries `act` claim; validates delegation | `https://mcp-server.pingdemo.com` | `AI_AGENT_AUDIENCE` / `PINGONE_RESOURCE_MCP_SERVER_URI` | `banking:read` `banking:write` `banking:mcp:invoke` |
| **Super Banking Agent Gateway** | Actor CC token audience for Exchange #1 in 2-exchange chain | `https://agent-gateway.pingdemo.com` | `AGENT_GATEWAY_AUDIENCE` | *(actor CC — no custom scopes required)* |
| **PingOne API** | Built-in; Management API access (read users, audit resources, etc.) | `https://api.pingone.com` | `PINGONE_API_AUDIENCE` | `p1:read:user`, `p1:update:user` |

---

## .env Structure: Current State vs. Authoritative

### ✅ Correct (Already Aligned)

```bash
# Super Banking User App (end-user login)
PINGONE_USER_CLIENT_ID=b2752071-2d03-4927-b865-089dc40b9c85
PINGONE_USER_CLIENT_SECRET=3NX~XdVZ1PxjQjz3z_f8rCoe-8hK1_vzUmo.9LYqiQ7h7y19L~IKCP0AL5ydVhDR

# Super Banking Admin App (BFF/token exchange)
PINGONE_ADMIN_CLIENT_ID=14cefa5b-d9d6-4e51-8749-e938d4edd1c0
PINGONE_ADMIN_CLIENT_SECRET=x6EeiOL3J-JSoZB8CnXzVVU1J4pvSWrEIl4jckxhN8u0_w8F9a.qA9-j47zfMr0O

# Agent Gateway resource server
AGENT_GATEWAY_AUDIENCE=https://agent-gateway.pingdemo.com

# PingOne auth/environment
PINGONE_ENVIRONMENT_ID=d02d2305-f445-406d-82ee-7cdbf6eeabfd
PINGONE_REGION=com
```

### ✅ All Variables Verified

| Current .env | Issue | Correct Value | Reason |
|---|---|---|---|
All env vars are correctly mapped as of the current codebase. Verified alignments:

| Env var | Status | Note |
|---------|--------|------|
| `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` | ✅ Correct | Primary env var for MCP Token Exchanger. `AGENT_OAUTH_CLIENT_ID` is a supported legacy alias. |
| `PINGONE_AI_AGENT_CLIENT_ID` | ✅ Correct | Credential for Super Banking AI Agent App (2-exchange actor). `AI_AGENT_CLIENT_ID` is a supported legacy alias. |
| `PINGONE_WORKER_TOKEN_CLIENT_ID` | ✅ Correct | Used by `mfaService`; now also aliased in configStore for `pingone_client_id` / `pingone_mgmt_client_id` so Management API services resolve it. |
| `ENDUSER_AUDIENCE` | ✅ Correct | `https://ai-agent.pingdemo.com` — Banking RS audience. |
| `AI_AGENT_AUDIENCE` / `PINGONE_RESOURCE_MCP_SERVER_URI` | ✅ Correct | `https://mcp-server.pingdemo.com` — MCP RS audience. |
| `MCP_RESOURCE_URI` | ✅ Alias | Supported fallback for `pingone_resource_mcp_server_uri` in configStore. |

---

## Code References: What Maps to What

### Services / Routes Using .env Variables

**`banking_api_server/services/resourceValidationService.js`**
- Reads: `configStore.getEffective('pingone_client_id')` → resolves `PINGONE_MANAGEMENT_CLIENT_ID` → `PINGONE_WORKER_TOKEN_CLIENT_ID` (fallback)
- **Purpose:** Authenticate to PingOne Management API to audit resources
- **PingOne App:** **Super Banking Worker Token App** (`PINGONE_WORKER_TOKEN_CLIENT_ID`)

**`banking_api_server/services/scopeAuditService.js`**
- Same credential chain as above
- **Purpose:** List and audit scopes on PingOne resource servers
- **PingOne App:** **Super Banking Worker Token App**

**`banking_api_server/services/pingOneClientService.js`**
- Reads: `PINGONE_MGMT_CLIENT_ID` → `PINGONE_MANAGEMENT_CLIENT_ID` → `PINGONE_WORKER_TOKEN_CLIENT_ID` (fallback)
- **Purpose:** General PingOne Management API calls (users, MFA, etc.)
- **PingOne App:** **Super Banking Worker Token App**

**`banking_api_server/services/mfaService.js`**
- Reads: `process.env.PINGONE_WORKER_TOKEN_CLIENT_ID` directly
- **Purpose:** PingOne MFA device management
- **PingOne App:** **Super Banking Worker Token App**

**`banking_api_server/services/delegationClaimsService.js`** (token exchange, delegation validation)
**`banking_api_server/middleware/auth.js`**
- **`aud` check:** `ENDUSER_AUDIENCE` and `AI_AGENT_AUDIENCE` are read from `process.env` at module load; if set, `authenticateToken` rejects tokens whose `aud` doesn't include a known audience (`ENDUSER_AUDIENCE`, `AI_AGENT_AUDIENCE`, or `MCP_RESOURCE_URI`).
- **`act` claim:** Extracted from `decoded.act` and attached to `req.user.actor`; `req.user.isDelegated = !!decoded.act`.
- **`may_act` claim:** Extracted by `actClaimValidator.js` for audit logging only; not used as a gating condition in `auth.js`.
- **Admin role detection:** Compares token `azp`/`client_id` to `oauthConfig.clientId` (`PINGONE_ADMIN_CLIENT_ID`). `may_act.sub` is **not** used for role gating.

**`banking_api_server/routes/oauthRoutes.js`** (user login, token exchange)
- Uses: `PINGONE_USER_CLIENT_ID` / `PINGONE_USER_CLIENT_SECRET` → Super Banking User App
- Uses: `PINGONE_ADMIN_CLIENT_ID` / `PINGONE_ADMIN_CLIENT_SECRET` → Super Banking Admin App
- **Purpose:** User OIDC login + RFC 8693 token exchange

**`banking_api_ui/src/services/configService.js`** (frontend audience/scopes)
- References: `ENDUSER_AUDIENCE` → must be Super Banking AI Agent audience (`https://ai-agent.pingdemo.com`)
- References: `MCP_RESOURCE_URI` → must be Super Banking MCP Server audience (`https://mcp-server.pingdemo.com`)
- **Purpose:** Token validation and scope enforcement in React components

---

## How to Verify Alignment (Checklist)

1. **PingOne Console → Applications:**
   - [ ] Super Banking User App: `b2752071-2d03-4927-b865-089dc40b9c85` exists
   - [ ] Super Banking Admin App: `14cefa5b-d9d6-4e51-8749-e938d4edd1c0` exists
   - [ ] Super Banking MCP Token Exchanger: `630b065f-0c28-41c2-81ed-1daee811285` exists with Client Credentials grant enabled
   - [ ] Super Banking AI Agent App: `2533a614-fcb6-4ab9-82cc-9ab407f1dbda` exists (reference only)

2. **PingOne Console → Resources (Resource Servers):**
   - [ ] Super Banking AI Agent: audience = `https://ai-agent.pingdemo.com`
   - [ ] Super Banking MCP Server: audience = `https://mcp-server.pingdemo.com`
   - [ ] Super Banking Agent Gateway: audience = `https://agent-gateway.pingdemo.com`
   - [ ] Super Banking API: audience = `https://banking-api.pingdemo.com`

3. **.env file:**
   - [ ] `PINGONE_USER_CLIENT_ID` = `b2752071-2d03-4927-b865-089dc40b9c85` (Super Banking User App)
   - [ ] `PINGONE_ADMIN_CLIENT_ID` = `14cefa5b-d9d6-4e51-8749-e938d4edd1c0` (Super Banking Admin App)
   - [ ] `PINGONE_CLIENT_ID` = `630b065f-0c28-41c2-81ed-1daee811285` (Super Banking MCP Token Exchanger)
   - [ ] `ENDUSER_AUDIENCE` = `https://ai-agent.pingdemo.com` (Super Banking AI Agent resource)
   - [ ] `MCP_RESOURCE_URI` = `https://mcp-server.pingdemo.com` (Super Banking MCP Server resource)
   - [ ] `AGENT_GATEWAY_AUDIENCE` = `https://agent-gateway.pingdemo.com` (Super Banking Agent Gateway resource)

4. **Code (grep to verify):**
   ```bash
   grep -r "PINGONE_CLIENT_ID\|PINGONE_CLIENT_SECRET" banking_api_server/services/ banking_api_server/routes/
   # Should find: resourceValidationService, scopeAuditService only
   
   grep -r "PINGONE_USER_CLIENT_ID" banking_api_server/routes/
   # Should find: oauthRoutes.js (user login)
   
   grep -r "PINGONE_ADMIN_CLIENT_ID" banking_api_server/
   # Should find: oauthRoutes.js (token exchange), services/ (delegation validation)
   
   grep -r "MCP_RESOURCE_URI" banking_api_server/ banking_api_ui/
   # Should find: configService, token validation paths
   ```

---

## Environment Variable Naming Convention

All PingOne-related .env variables follow this pattern:

```
PINGONE_{APP_OR_SERVICE}_{TYPE}
  PINGONE_ADMIN_CLIENT_ID           ← PingOne application name: Super Banking Admin App
  PINGONE_USER_CLIENT_ID            ← PingOne application name: Super Banking User App
  PINGONE_CLIENT_ID                 ← PingOne application name: Super Banking MCP Token Exchanger
                                       (shortened to PINGONE_ prefix, as it's primary/default Management API client)

{RESOURCE_OR_SERVICE}_AUDIENCE / _URI
  ENDUSER_AUDIENCE                  ← Maps to PingOne resource: Super Banking AI Agent
  MCP_RESOURCE_URI                  ← Maps to PingOne resource: Super Banking MCP Server
  AGENT_GATEWAY_AUDIENCE            ← Maps to PingOne resource: Super Banking Agent Gateway
  BFF_RESOURCE_URI                  ← Maps to PingOne resource: Super Banking API
```

**Principle:**
- Application credentials → `PINGONE_{APP_NAME}_CLIENT_{ID|SECRET}`
- Resource server audiences → `{SERVICE}_AUDIENCE` or `{SERVICE}_RESOURCE_URI` or `{SERVICE}_URI`

---

## Summary

**Before Fix:**
- ❌ `AI_AGENT_CLIENT_ID` pointing to identity reference (not usable credential)
- ❌ `MCP_RESOURCE_URI` pointing to wrong resource (`ai-agent` instead of `mcp-server`)
- ❌ Missing Management API credentials (`PINGONE_CLIENT_ID/SECRET`)
- ❌ No clear mapping between PingOne and .env files

**After Fix:**
- ✅ All .env variables directly traceable to PingOne Console applications and resources
- ✅ Clear comments in .env showing PingOne app name for each credential
- ✅ Consistent naming convention across all audience/URI variables
- ✅ Management API credentials available for audit feature
- ✅ Code references match .env variable names exactly
