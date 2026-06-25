# ACTUAL PingOne Environment Mapping

**Source:** Direct query of PingOne Management API for environment `d02d2305-f445-406d-82ee-7cdbf6eeabfd` (region: com)

---

## Actual Applications in PingOne

| PingOne App ID | PingOne App Name | App Type | Current .env Variable | Current Value | Status |
|---|---|---|---|---|---|
| `14cefa5b-d9d6-4e51-8749-e938d4edd1c0` | Super Banking Admin App | WEB_APP | `PINGONE_ADMIN_CLIENT_ID` | `14cefa5b-d9d6-4e51-8749-e938d4edd1c0` | ✅ **CORRECT** |
| `b2752071-2d03-4927-b865-089dc40b9c85` | Super Banking User App | WEB_APP | `PINGONE_USER_CLIENT_ID` | `b2752071-2d03-4927-b865-089dc40b9c85` | ✅ **CORRECT** |
| `6380065f-f328-41c2-81ed-1daeec811285` | Super Banking MCP Token Exchanger | AI_AGENT | `AGENT_OAUTH_CLIENT_ID` | `6380065f-f328-41c2-81ed-1daeec811285` | ⚠️ **CONFUSING NAME** (not "agent oauth", it's MCP exchanger) |
| `2533a614-fcb6-4ab9-82cc-9ab407f1dbda` | Super Banking AI Agent App | AI_AGENT | `AI_AGENT_CLIENT_ID` | `2533a614-fcb6-4ab9-82cc-9ab407f1dbda` | ⚠️ **HAS SECRET BUT UNCLEAR PURPOSE** |
| `95dc946f-5e0a-4a8b-a8ba-b587b244e005` | Super Banking Worker Token | WORKER | `PINGONE_CLIENT_ID` | `95dc946f-5e0a-4a8b-a8ba-b587b244e005` | ✅ **CORRECT** (Management API) |

---

## Issues Found

### 1. ❌ Confusing Variable Names

**AGENT_OAUTH_CLIENT_ID**
- Current value: `6380065f-f328-41c2-81ed-1daeec811285`
- Actual PingOne app: **"Super Banking MCP Token Exchanger"** (NOT "agent oauth")
- **Problem:** Name doesn't reflect purpose or PingOne app name
- **Fix:** Rename to `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` or add clarifying comment

**AI_AGENT_CLIENT_ID**
- Current value: `2533a614-fcb6-4ab9-82cc-9ab407f1dbda`
- Actual PingOne app: **"Super Banking AI Agent App"**
- Has a CLIENT_SECRET in .env but it's unclear if this app should be used as a credential
- **Problem:** The code references this AS AN IDENTITY (in `act` claims, `may_act.sub`), not as an exchanging client
- **Question:** Does your Super Banking AI Agent App (AI_AGENT type) actually have token exchange grants enabled? If not, why does it have a secret in .env?

### 2. ✅ Management API Client is Correct

**PINGONE_CLIENT_ID** = `95dc946f-5e0a-4a8b-a8ba-b587b244e005` (Super Banking Worker Token, type: WORKER)
- **Status:** ✅ This is correct for Management API access
- Used by: `resourceValidationService`, `scopeAuditService` for audit feature

### 3. ❓ Missing Resource Server Information

The PingOne API endpoint for resource servers returned a 403 error (authorization scope issue). 

**Based on documentation, expected resource servers should be:**
- Super Banking AI Agent (audience: `https://ai-agent.pingdemo.com`)
- Super Banking MCP Server (audience: `https://mcp-server.pingdemo.com`)
- Super Banking Agent Gateway (audience: `https://agent-gateway.pingdemo.com`)
- Super Banking API (audience: `https://banking-api.pingdemo.com`)

---

## Current .env Configuration Review

```bash
# ✅ CORRECT
PINGONE_ADMIN_CLIENT_ID=14cefa5b-d9d6-4e51-8749-e938d4edd1c0       # Super Banking Admin App
PINGONE_ADMIN_CLIENT_SECRET=x6EeiOL3J-...                           # ✅ Matches app

PINGONE_USER_CLIENT_ID=b2752071-2d03-4927-b865-089dc40b9c85        # Super Banking User App
PINGONE_USER_CLIENT_SECRET=3NX~XdVZ1...                             # ✅ Matches app

PINGONE_CLIENT_ID=95dc946f-5e0a-4a8b-a8ba-b587b244e005             # Super Banking Worker Token (Management API)
PINGONE_CLIENT_SECRET=Ee2YBEmqrBRdELuNDAh5SPL6T01_...              # ✅ Matches app for audit feature

# ⚠️ CONFUSING / NEEDS CLARIFICATION
AGENT_OAUTH_CLIENT_ID=6380065f-f328-41c2-81ed-1daeec811285         # Actually: Super Banking MCP Token Exchanger
AGENT_OAUTH_CLIENT_SECRET=QKZm899I7...                             # ⚠️ Misleading name ("agent oauth" when it's MCP)

AI_AGENT_CLIENT_ID=2533a614-fcb6-4ab9-82cc-9ab407f1dbda            # Super Banking AI Agent App
AI_AGENT_CLIENT_SECRET=HE9OltugnW...                               # ⚠️ Has secret but used only as identity reference?

# ❌ WRONG VALUE
ENDUSER_AUDIENCE=banking_api_enduser                               # ❌ Should be: https://ai-agent.pingdemo.com
MCP_RESOURCE_URI=https://ai-agent.pingdemo.com                    # ❌ Should be: https://mcp-server.pingdemo.com
```

---

## Recommendations to Make Mapping Crystal Clear

### Option 1: Minimal Changes (Add Comments Only)

Keep variable names but add comments showing PingOne app names:

```bash
# OAuth2 client for server-side (BFF / token exchange)
# PingOne App: Super Banking Admin App
PINGONE_ADMIN_CLIENT_ID=14cefa5b-d9d6-4e51-8749-e938d4edd1c0

# OAuth2 client for end users (Web/SPA)
# PingOne App: Super Banking User App
PINGONE_USER_CLIENT_ID=b2752071-2d03-4927-b865-089dc40b9c85

# PingOne Management API client (resource/scope audit)
# PingOne App: Super Banking Worker Token
PINGONE_CLIENT_ID=95dc946f-5e0a-4a8b-a8ba-b587b244e005

# MCP Token Exchange client (Agent Gateway actor token)
# PingOne App: Super Banking MCP Token Exchanger
# NOTE: Despite the variable name "AGENT_OAUTH", this is the MCP exchanger
AGENT_OAUTH_CLIENT_ID=6380065f-f328-41c2-81ed-1daeec811285

# AI Agent identity reference (used in act/may_act claims)
# PingOne App: Super Banking AI Agent App
# NOTE: Used as identity only, not as exchanging client credential
AI_AGENT_CLIENT_ID=2533a614-fcb6-4ab9-82cc-9ab407f1dbda
```

### Option 2: Clearer Variable Naming (More Work but Much Clearer)

Rename to match PingOne app names exactly:

```bash
# Before → After
AGENT_OAUTH_CLIENT_ID → PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID
AGENT_OAUTH_CLIENT_SECRET → PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET

AI_AGENT_CLIENT_ID → PINGONE_AI_AGENT_APP_ID (identity reference only, no secret needed)
# Remove AI_AGENT_CLIENT_SECRET since it's not used as credential
```

---

## Next Steps to Verify

1. **In PingOne Console:** Check Super Banking Worker Token (95dc946f...) - verify it has "Management API" scopes enabled
2. **In PingOne Console:** Check Super Banking AI Agent App (2533a614...) - determine if it's used as OAuth credential or just identity reference
3. **Choose naming approach:** Option 1 (comments) or Option 2 (rename variables + update code)
4. **Fix resource audience values:**
   - `ENDUSER_AUDIENCE` = `https://ai-agent.pingdemo.com`
   - `MCP_RESOURCE_URI` = `https://mcp-server.pingdemo.com`
