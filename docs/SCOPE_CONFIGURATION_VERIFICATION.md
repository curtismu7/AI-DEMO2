# Scope Configuration Verification Guide

> **Canonical audience values and resource names** are in [`docs/PINGONE_CONFIG.md`](user-guide/PINGONE_CONFIG.md).
> For the automated startup check, set `PINGONE_VALIDATE_ON_STARTUP=true` — it runs `resourceValidationService` and `scopeAuditService` at boot.

## Overview

This guide explains how to verify and fix your PingOne scope configuration for this demo.

The verification process checks:
1. ✅ All PingOne resources exist and have the correct URIs
2. ✅ All expected scopes are attached to the correct resources
3. ✅ Code configuration (configStore.js) matches PingOne setup
4. ✅ Scope narrowing will work correctly for RFC 8693 token exchange

---

## Prerequisites

### 1. Create a PingOne Worker Application (Management API access)

**Why:** The verification script uses PingOne's Management API to read resource and scope configuration. You need a worker app with the right permissions.

**Steps:**

1. Go to **PingOne Admin Console** → **Integrations** → **Applications**
2. Click **+ Add Application**
3. Select **Worker** (not an OIDC app)
4. Name it: `Super Banking Management Worker` or similar
5. Go to **Configuration** tab
6. Note the **Client ID** and **Client Secret**
7. Make sure this worker has the role: **Admin**

### 2. Set Environment Variables

Add to your `.env` file:

```bash
# PingOne Management API credentials (for verification script)
PINGONE_MGMT_CLIENT_ID=<worker app client ID>
PINGONE_MGMT_CLIENT_SECRET=<worker app client secret>

# PingOne resource URIs (customize if not using defaults)
PINGONE_RESOURCE_MCP_SERVER_URI=mcpserver.ping.demo
PINGONE_RESOURCE_AGENT_GATEWAY_URI=agentgateway.ping.demo
PINGONE_RESOURCE_MCP_GATEWAY_URI=mcpgateway.ping.demo
PINGONE_RESOURCE_TWO_EXCHANGE_URI=mcpserver.ping.demo
```

---

## Running the Verification

### Option 1: Audit Only (no changes)

```bash
cd banking_api_server
npm run verify:scopes
```

**Output:** Lists all resources, their current scopes, and identifies missing scopes.

### Option 2: Auto-Fix Missing Scopes

```bash
npm run verify:scopes:fix
```

**Output:** Lists all resources AND attempts to create any missing scopes in PingOne.

---

## Understanding the Output

Example output:

```
ℹ️  Environment: a1b2c3d4-e5f6-7890-abcd-ef1234567890
ℹ️  Region: com

ℹ️  Authenticating with PingOne Management API...
✅ Authentication successful

ℹ️  Fetching PingOne resources...
✅ Found 7 resources

ℹ️  Checking: Super Banking API (enduser.ping.demo)
  Description: Super Banking API (End-User)
  URI: enduser.ping.demo
  Current scopes: banking:read, banking:write, banking:accounts:read
✅ All required scopes present

ℹ️  Checking: Super Banking Agent Gateway (agentgateway.ping.demo)
  Description: Super Banking Agent Gateway
  URI: agentgateway.ping.demo
  Current scopes: banking:agent:invoke
⚠️  Missing REQUIRED scopes: ai_agent
  (Run with --fix to auto-create)

...

═══════════════════════════════════════════════════════════════════════════════
⚠️  Found 1 issue(s) with scope configuration
═══════════════════════════════════════════════════════════════════════════════

ℹ️  Resource Configuration Summary:

Resource: Super Banking API
  URI: enduser.ping.demo
  ID: e9f8a7b6-c5d4-3c2b-1a09-f8e7d6c5b4a3
  Scopes: banking:read, banking:write

Resource: Super Banking Agent Gateway
  URI: agentgateway.ping.demo
  ID: d6c5b4a3-9f8e-7d6c-5b4a-39f8e7d6c5b4
  Scopes: banking:agent:invoke
```

### Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | All required scopes present; configuration OK |
| ⚠️  | Missing optional scopes or total issues found |
| ❌ | Missing required scopes or errors |

---

## Manual Verification in PingOne

If the script reports issues or you want to manually verify:

### Step 1: List All Resources

1. Go to **PingOne Admin Console** → **Integrations** → **Resources**
2. You should see at least these 5 resources:
   - **Super Banking API**
   - **Super Banking Agent Gateway**
   - **Super Banking AI Agent Service**
   - **Super Banking MCP Gateway**
   - **Super Banking MCP Server**

### Step 2: Check Resource Scopes

For each resource:

1. Click the resource name
2. Go to **Scopes** tab
3. Verify that the required scopes are listed:

**Super Banking API:**
- ✅ `banking:read` (required)
- ✅ `banking:write` (required)
- Optional: `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write`

**Super Banking Agent Gateway:**
- ✅ `banking:agent:invoke` (required)
- ✅ `ai_agent` (required)

**Super Banking AI Agent Service:**
- ✅ `banking:read` (required)
- ✅ `banking:write` (required)
- ✅ `banking:agent:invoke` (required)
- Optional: `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write`

**Super Banking MCP Gateway:**
- ✅ `banking:mcp:invoke` (required)
- ✅ `mcp_resource_access` (required)
- Optional: `banking:ai:agent:read`, `banking:ai:agent:write`

**Super Banking MCP Server:**
- ✅ `get_accounts:read` (required)
- ✅ `transfer:execute` (required)
- ✅ `check:read` (required)
- Optional: `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write`, `banking:ai:agent:read`, `banking:ai:agent:write`

### Step 3: Add Missing Scopes (Manual)

If a scope is missing:

1. Click **+ Add Scope**
2. Enter the scope name (e.g., `ai_agent`)
3. Fill in description (e.g., "AI Agent Authorization")
4. Click **Save**

---

## Updating configStore.js

The `configStore.js` now dynamically builds the `ALLOWED_SCOPES_BY_AUDIENCE` mapping from environment variables.

**This means:**
- ✅ No code changes needed when you change PingOne resource URIs
- ✅ Environment variables drive the configuration
- ✅ Scope narrowing automatically uses correct URIs

**Required Environment Variables:**

```bash
PINGONE_RESOURCE_MCP_SERVER_URI=mcpserver.ping.demo
PINGONE_RESOURCE_AGENT_GATEWAY_URI=agentgateway.ping.demo
PINGONE_RESOURCE_MCP_GATEWAY_URI=mcpgateway.ping.demo
PINGONE_RESOURCE_TWO_EXCHANGE_URI=mcpserver.ping.demo
PINGONE_AUDIENCE_ENDUSER=enduser.ping.demo
PINGONE_AUDIENCE_AI_AGENT=agentgateway.ping.demo
```

**How it works:**

When `validateScopeAudience()` is called, it:
1. Reads current values from configStore
2. Builds the scope-audience mapping dynamically
3. Narrows scopes for the target audience
4. Returns allowed + narrowed scopes

**Example:**

```javascript
// In code:
const result = configStore.validateScopeAudience(
  ['banking:read', 'banking:write', 'transfer:execute'],
  'mcpserver.ping.demo'
);
// Returns: { valid: true, scopes: ['get_accounts:read', 'transfer:execute'] }
// (narrowed to the MCP server's allowed scopes)
```

---

## Troubleshooting

### Error: "PINGONE_MGMT_CLIENT_ID or PINGONE_MGMT_CLIENT_SECRET not set"

**Solution:** 
1. Create a worker app in PingOne (see "Prerequisites" above)
2. Add the credentials to `.env`:
   ```bash
   PINGONE_MGMT_CLIENT_ID=<your client id>
   PINGONE_MGMT_CLIENT_SECRET=<your client secret>
   ```
3. Restart the script

### Error: "Authentication successful" but no resources found

**Possible causes:**
- Worker app doesn't have correct role (must be Admin)
- Environment ID is wrong
- PingOne API is temporarily unavailable

**Solution:**
1. Verify the worker app has **Admin** role:
   - Go to **PingOne Admin Console** → **Integrations** → **Applications** → Your worker app
   - Check the role assignment
2. Verify environment ID: `echo $PINGONE_ENVIRONMENT_ID`
3. Try again in a few moments

### Error: "Failed to get scopes for [resource]: HTTP 403"

**Cause:** Worker app doesn't have permission to read resource scopes.

**Solution:**
1. Verify worker app role is **Admin** (not just a custom role)
2. Check if your PingOne organization restricts API access
3. Contact your PingOne admin if you don't have API access

### Missing scopes detected but I know they're in PingOne

**Possible causes:**
- Scope name mismatch (typo, case sensitivity)
- Scope exists but is attached to wrong resource
- Cache issue (wait a few seconds after adding scope in PingOne UI)

**Solution:**
1. Check PingOne → **Resources** → your resource → **Scopes** for exact spelling
2. Verify scope is attached to the right resource (check all 5 resources)
3. Wait a few seconds for PingOne to sync
4. Run verification script again

---

## Next Steps After Verification

### If All Scopes Are Correct ✅

1. **Test the agent:**
   ```bash
   # In a new terminal:
   cd banking_api_ui
   npm start
   ```
   - Log in with user credentials
   - Try agent command: "Show my accounts"
   - Should work without "Could not parse: undefined" error

2. **Verify token narrowing:**
   - Open browser DevTools → Network tab
   - Look for `POST /api/mcp/tool` request
   - Check Response → `exchangedToken` → decode to see narrowed scopes

3. **Commit your changes:**
   ```bash
   git add banking_api_server/.env
   git commit -m "Add scope verification and configStore updates (Phase 120)"
   ```

### If Issues Remain

1. **Check logs:**
   ```bash
   cd banking_api_server
   npm start  # Run in a terminal to see logs
   ```
   - Look for scope-related errors

2. **Review configStore.js:**
   - Verify `buildAllowedScopesByAudience()` is using correct env vars
   - Test locally: 
     ```bash
     node -e "const configStore = require('./services/configStore'); console.log(configStore.buildAllowedScopesByAudience())"
     ```

3. **Run the audit report:**
   - Review [docs/SCOPE_AUDIT_FINAL_REPORT.md](SCOPE_AUDIT_FINAL_REPORT.md)
   - Check for any remaining issues listed there

---

## Reference Documentation

- **[SCOPE_AUDIT_FINAL_REPORT.md](SCOPE_AUDIT_FINAL_REPORT.md)** — Complete audit findings
- **[SCOPE_AUDIENCE_MAPPING.md](../SCOPE_AUDIENCE_MAPPING.md)** — RFC 8707 scope-audience reference
- **[REGRESSION_PLAN.md](../REGRESSION_PLAN.md)** — Critical do-not-break areas including scope validation

---

## Support

For questions or issues:
1. Check the **Troubleshooting** section above
2. Review the **[SCOPE_AUDIT_FINAL_REPORT.md](SCOPE_AUDIT_FINAL_REPORT.md)**
3. Read **[ERROR_CODES_AND_REMEDIATION.md](user-guide/ERROR_CODES_AND_REMEDIATION.md)** for scope-related errors
