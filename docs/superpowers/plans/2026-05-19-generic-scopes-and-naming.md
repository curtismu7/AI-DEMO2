# Generic Scopes and Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all `banking:` prefix branding from scope strings, PingOne app/resource names, resource URIs, and startup script labels so the platform is vertical-neutral.

**Architecture:** `scope-topology.json` is the SSOT — update it first, then propagate outward in dependency order: topology → vertical configs → scopes constants → BFF services/routes → provisioner → TS services (recompile) → tests → run-demo.sh → docs. A new `cleanupPingOneApps.js` script wipes the old `Super Banking *` PingOne environment before re-bootstrap creates `Demo *` names.

**Tech Stack:** Node.js (CommonJS BFF), TypeScript (MCP gateway/server/agent), React (UI — no scope string changes needed), Jest, bash (run-demo.sh), PingOne Management API.

---

## File Map

| File | Change type | What changes |
|------|-------------|--------------|
| `scope-topology.json` | Modify | Scope strings, resource URIs, add `provisioning` block, add `featureScope` to resource defs |
| `banking_api_server/config/verticals/banking.json` | Modify | `scopes` block values + add `featureScope` |
| `banking_api_server/config/verticals/retail.json` | Modify | `scopes` block values + add `featureScope` |
| `banking_api_server/config/verticals/workforce.json` | Modify | `scopes` block values + add `featureScope` |
| `banking_api_server/config/scopes.js` | Modify | Constant string values |
| `banking_api_server/services/configStore.js` | Modify | Default scope strings in config schema |
| `banking_api_server/services/agentMcpTokenService.js` | Modify | Hardcoded `banking:*` strings + `startsWith('banking:')` heuristic |
| `banking_api_server/services/agentCCTokenService.js` | Modify | Default `banking:mcp:invoke` → `mcp:invoke` |
| `banking_api_server/services/resourceIndicatorService.js` | Modify | Hardcoded scope array |
| `banking_api_server/services/scopeAuditService.js` | Modify | `Super Banking *` app name keys |
| `banking_api_server/services/scopePolicyEngine.js` | Modify | Scope strings in policy map |
| `banking_api_server/routes/transactions.js` | Modify | `requireScopes` calls + comments |
| `banking_api_server/routes/authorizeConfig.js` | Modify | Scope-keyed config object |
| `banking_api_server/routes/tokens.js` | Modify | `bankingScopes` array + fallback |
| `banking_api_server/routes/mcpInspector.js` | Modify | Fallback scope hint |
| `banking_api_server/routes/setupWizard.js` | Modify | `banking_api_enduser` default strings |
| `banking_api_server/scripts/bootstrapPingOne.js` | Modify | Audience defaults, app name list, read from topology `provisioning` block |
| `banking_api_server/scripts/cleanupPingOneApps.js` | **Create** | New standalone cleanup script |
| `banking_api_server/services/pingoneProvisionService.js` | Modify | App/resource display names read from topology `provisioning` block |
| `banking_mcp_server/src/tools/BankingToolRegistry.ts` | Modify | Hardcoded `banking:read`/`banking:write` strings |
| `banking_mcp_server/src/tools/toolScopeMap.ts` | Modify | Scope strings + fallback comment |
| `banking_mcp_server/src/auth/AuthorizationRequestGenerator.ts` | Modify | Hardcoded scope strings |
| `banking_api_server/src/__tests__/scopeTopology.regression.test.js` | Modify | Scope assertions + `Super Banking` key refs |
| `banking_api_server/src/__tests__/agentMcpTokenService.test.js` | Modify | `banking_api_enduser` audience string |
| `banking_api_server/src/__tests__/agentDelegation.real-token.test.js` | Modify | `banking:read`/`banking:write` assertions |
| `banking_api_server/src/__tests__/accounts.route.test.js` | Modify | Scope arrays in test headers |
| `banking_api_server/src/__tests__/delegationChainValidationService.test.js` | Modify | Scope strings in test fixtures |
| `banking_api_server/src/__tests__/transaction-consent-challenge.test.js` | Modify | Scope array in fixture |
| `banking_api_server/tests/ccTokenScope.regression.test.js` | Modify | Scope strings |
| `banking_api_server/tests/mcpGatewayConfig.test.js` | Modify | `mcp_scope` assertions |
| `banking_api_server/tests/tokenUtils.test.js` | Modify | Scope strings |
| `banking_api_server/tests/routes/langchainChatProxy.regression.test.js` | Modify | Scope strings |
| `banking_api_server/tests/bankingAgentLangGraphService.modes.test.js` | Modify | Scope strings |
| `run-demo.sh` | Modify | Log/pid variable values, banner/heading text, `tail_bank_logs` → `tail_demo_logs` |
| `CLAUDE.md` | Modify | `/tmp/bank-api-server.log` → `/tmp/demo-api.log` in verification checklist |
| `REGRESSION_PLAN.md` | Modify | §4 migration entry; §1 audience string update |
| `banking_api_server/package.json` | Modify | Add `pingone:cleanup` script |

---

## Task 1: Update `scope-topology.json` (the SSOT)

**Files:**
- Modify: `scope-topology.json`

This is the foundation. All downstream changes derive from it.

- [ ] **Step 1: Update scope strings**

Open `scope-topology.json`. In the `"scopes"` object, change:

```json
"read":              { "description": "Read accounts, balances, transactions", "riskLevel": "low",    "resource": "Super Banking API", "category": "data" },
"write":             { "description": "Write operations (deposit/withdrawal/transfer)", "riskLevel": "high", "resource": "Super Banking API", "category": "data" },
"transfer":          { "description": "Execute fund transfers", "riskLevel": "high", "resource": "Super Banking API", "category": "data" },
"accounts:read":     { "description": "Read account information and balances", "riskLevel": "low", "resource": "Super Banking API", "category": "data" },
"transactions:read": { "description": "Read transaction history and details", "riskLevel": "low", "resource": "Super Banking API", "category": "data" },
"mortgage:read":     { "description": "Read mortgage/feature-specific data (banking vertical)", "riskLevel": "low", "resource": "Super Banking API", "category": "feature" },
"ai:agent:read":     { "description": "Agent invocation permission", "riskLevel": "medium", "resource": "Super Banking API", "category": "agent" },
"mcp:invoke":        { "description": "Invoke MCP tools via the gateway (RFC 8693 exchange)", "riskLevel": "medium", "resource": "Super Banking MCP Server", "category": "infra" },
"agent:invoke":      { "description": "Invoke the Agent Gateway (Two-Exchange Step 1 audience)", "riskLevel": "medium", "resource": "Super Banking Agent Gateway", "category": "infra" },
```

Remove these keys entirely (old names):
- `"banking:read"`, `"banking:write"`, `"banking:transfer"`, `"banking:accounts:read"`, `"banking:transactions:read"`, `"banking:mortgage:read"`, `"banking:ai:agent:read"`, `"banking:mcp:invoke"`, `"banking:agent:invoke"`

Keep unchanged: `"ai_agent"`, `"admin:read"`, `"admin:write"`, `"admin:delete"`, `"users:read"`, `"users:manage"`

- [ ] **Step 2: Update `resources` scope arrays**

In `"resources"."Super Banking API"`, change:
```json
"scopes": ["read", "write", "transfer", "accounts:read", "transactions:read", "mortgage:read", "ai:agent:read", "ai_agent", "admin:read", "admin:write", "admin:delete", "users:read", "users:manage"]
```

In `"resources"."Super Banking MCP Server"`, change:
```json
"scopes": ["mcp:invoke"],
"mirroredScopes": ["read", "write", "mortgage:read", "ai:agent:read", "admin:read", "admin:write", "admin:delete", "users:read", "users:manage"]
```

In `"resources"."Super Banking MCP Gateway"`, change:
```json
"scopes": ["mcp:invoke"],
"mirroredScopes": ["read", "write", "transfer", "mortgage:read"]
```

In `"resources"."Super Banking Agent Gateway"`, change:
```json
"scopes": ["agent:invoke"]
```

- [ ] **Step 3: Update resource URIs**

In `"resources"."Super Banking API"`, change:
```json
"uri": "api.ping.demo"
```

(All other resource URIs stay unchanged.)

- [ ] **Step 4: Update `servers.banking_api_server.validatesAudience`**

```json
"banking_api_server": {
  "resource": "Super Banking API",
  "validatesAudience": "api.ping.demo",
  ...
}
```

- [ ] **Step 5: Update `apps` granted scope arrays**

In `"apps"."Super Banking User App"`:
```json
"grantedScopes": ["ai:agent:read", "read", "write", "transfer", "mortgage:read"]
```

In `"apps"."Super Banking Admin App"`:
```json
"grantedScopes": ["read", "write", "transfer", "accounts:read", "transactions:read", "mortgage:read", "ai:agent:read", "ai_agent", "admin:read", "admin:write", "admin:delete", "users:read", "users:manage"]
```

In `"apps"."Super Banking MCP Exchanger"`:
```json
"grantedScopes": ["read", "write", "mcp:invoke"]
```

In `"apps"."Super Banking AI Agent"`:
```json
"grantedScopes": ["agent:invoke"]
```

- [ ] **Step 6: Update `tools` required scopes**

Replace every `"banking:read"` with `"read"`, every `"banking:write"` with `"write"`, `"banking:transfer"` with `"transfer"`, `"banking:mortgage:read"` with `"mortgage:read"` in the `"tools"` object. Full result:

```json
"tools": {
  "get_my_accounts":               { "requiredScopes": ["read"], "surface": "gateway" },
  "get_account_balance":           { "requiredScopes": ["read"], "surface": "gateway" },
  "get_my_transactions":           { "requiredScopes": ["read"], "surface": "gateway" },
  "get_sensitive_account_details": { "requiredScopes": ["read"], "surface": "gateway" },
  "sequential_think":              { "requiredScopes": ["read"], "surface": "gateway" },
  "get_investment_balance":        { "requiredScopes": ["read"], "surface": "gateway" },
  "get_investment_accounts":       { "requiredScopes": ["read"], "surface": "gateway" },
  "get_portfolio_summary":         { "requiredScopes": ["read"], "surface": "gateway" },
  "show_mortgage":                 { "requiredScopes": ["mortgage:read"], "surface": "gateway" },
  "create_deposit":                { "requiredScopes": ["write"], "surface": "gateway", "challengeType": "step_up" },
  "create_withdrawal":             { "requiredScopes": ["write"], "surface": "gateway", "challengeType": "step_up" },
  "create_transfer":               { "requiredScopes": ["write", "transfer"], "surface": "gateway", "challengeType": "step_up" },
  "query_user_by_email":           { "requiredScopes": ["ai_agent"], "surface": "exchange-only" },
  "admin_list_all_users":          { "requiredScopes": ["admin:read", "users:read"], "surface": "exchange-only" },
  "admin_get_user_details":        { "requiredScopes": ["admin:read", "users:read"], "surface": "exchange-only" },
  "admin_delete_user":             { "requiredScopes": ["admin:write", "admin:delete", "users:manage"], "surface": "exchange-only" },
  "admin_manage_accounts":         { "requiredScopes": ["admin:write", "users:manage"], "surface": "exchange-only" },
  "admin_view_audit_logs":         { "requiredScopes": ["admin:read"], "surface": "exchange-only" },
  "admin_system_status":           { "requiredScopes": ["admin:read"], "surface": "exchange-only" },
  "list_accounts":                 { "requiredScopes": ["read"], "surface": "legacy-alias" },
  "list_transactions":             { "requiredScopes": ["read"], "surface": "legacy-alias" },
  "transfer":                      { "requiredScopes": ["write"], "surface": "legacy-alias" },
  "deposit":                       { "requiredScopes": ["write"], "surface": "legacy-alias" },
  "withdraw":                      { "requiredScopes": ["write"], "surface": "legacy-alias" },
  "banking_get_account_balance":   { "requiredScopes": ["read"], "surface": "legacy-alias" },
  "banking_create_transfer":       { "requiredScopes": ["write"], "surface": "legacy-alias" }
}
```

- [ ] **Step 7: Add `provisioning` block**

Add at the top level of `scope-topology.json`, before `"scopes"`:

```json
"provisioning": {
  "appPrefix": "Demo",
  "resourceNames": {
    "Super Banking API":           "Demo API",
    "Super Banking MCP Server":    "Demo MCP Server",
    "Super Banking MCP Gateway":   "Demo MCP Gateway",
    "Super Banking Agent Gateway": "Demo Agent Gateway"
  },
  "appNames": {
    "Super Banking User App":      "Demo User App",
    "Super Banking Admin App":     "Demo Admin App",
    "Super Banking MCP Server":    "Demo MCP Server",
    "Super Banking MCP Gateway":   "Demo MCP Gateway",
    "Super Banking MCP Exchanger": "Demo MCP Exchanger",
    "Super Banking AI Agent":      "Demo AI Agent",
    "Super Banking Agent":         "Demo Agent",
    "Super Banking Worker":        "Demo Worker"
  }
},
```

- [ ] **Step 8: Commit**

```bash
git add scope-topology.json
git commit -m "feat(scopes): genericize scope strings and app names in topology SSOT"
```

---

## Task 2: Update vertical configs

**Files:**
- Modify: `banking_api_server/config/verticals/banking.json`
- Modify: `banking_api_server/config/verticals/retail.json`
- Modify: `banking_api_server/config/verticals/workforce.json`

- [ ] **Step 1: Update `banking.json` scopes block**

Replace the `"scopes"` object:
```json
"scopes": {
  "read": "read",
  "write": "write",
  "transfer": "transfer",
  "featureScope": "mortgage:read"
}
```

- [ ] **Step 2: Update `retail.json` scopes block**

Replace the `"scopes"` object:
```json
"scopes": {
  "read": "read",
  "write": "write",
  "transfer": "transfer",
  "featureScope": "largepurchase:read"
}
```

- [ ] **Step 3: Update `workforce.json` scopes block**

Replace the `"scopes"` object:
```json
"scopes": {
  "read": "read",
  "write": "write",
  "transfer": "transfer",
  "featureScope": "expense:read"
}
```

- [ ] **Step 4: Commit**

```bash
git add banking_api_server/config/verticals/banking.json \
        banking_api_server/config/verticals/retail.json \
        banking_api_server/config/verticals/workforce.json
git commit -m "feat(verticals): generic scope block + featureScope per vertical"
```

---

## Task 3: Update `scopes.js` constants

**Files:**
- Modify: `banking_api_server/config/scopes.js`

- [ ] **Step 1: Update constant values in `BANKING_SCOPES`**

In the `BANKING_SCOPES` object, change the string values:
```javascript
const BANKING_SCOPES = {
  BANKING_READ:      'read',
  BANKING_WRITE:     'write',
  ADMIN:             'admin:read',   // kept for compat — actual admin uses admin:read/write/delete
  SENSITIVE:         'sensitive:read',
  AI_AGENT:          'ai:agent:read',
  AI_AGENT_IDENTITY: 'ai_agent',
  MCP_INVOKE:        'mcp:invoke',
  AGENT_INVOKE:      'agent:invoke',
};
```

- [ ] **Step 2: Update `COMPOUND_SCOPES`**

```javascript
const COMPOUND_SCOPES = {
  ACCOUNTS_READ:      'accounts:read',
  TRANSACTIONS_READ:  'transactions:read',
  TRANSACTIONS_WRITE: 'transactions:write',
  MORTGAGE_READ:      'mortgage:read',   // banking vertical featureScope; use vertical config for other verticals
};
```

- [ ] **Step 3: Update `USER_TYPE_SCOPES`**

The values reference the constants above — no string changes needed here since constants are already updated. Verify the array references still make sense (they use `BANKING_SCOPES.BANKING_READ` etc., which now resolve to `'read'`).

- [ ] **Step 4: Update `ROUTE_SCOPE_MAP` values** (uses constants — auto-updated by Step 1, but scan for any hardcoded strings)

Search the file for any remaining literal `'banking:'` strings and replace:
```bash
grep -n "banking:" banking_api_server/config/scopes.js
```
Fix any remaining literals found.

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/config/scopes.js
git commit -m "feat(scopes): update scope constants to generic names"
```

---

## Task 4: Update `configStore.js` defaults

**Files:**
- Modify: `banking_api_server/services/configStore.js`

- [ ] **Step 1: Update default scope strings in config schema**

Find and replace these default values:

| Find | Replace |
|------|---------|
| `'banking:read banking:write banking:accounts:read banking:transactions:read banking:transactions:write banking:mortgage:read ai_agent'` | `'read write accounts:read transactions:read transactions:write mortgage:read ai_agent'` |
| `default: 'banking:read banking:write banking:mcp:invoke banking:mortgage:read'` | `default: 'read write mcp:invoke mortgage:read'` |
| `default: 'banking:mcp:invoke'` | `default: 'mcp:invoke'` |
| `// BFF-inject banking:read banking:write scopes` | `// BFF-inject read write scopes` |

Also update the inline scope arrays at lines ~1016–1052:
```javascript
// Line ~1016 block — exchange scopes:
'read',
'write',
// Line ~1039 block:
'read',
'write',
'mcp:invoke',
// Line ~1050 block:
'read',
'write',
'mcp:invoke',
```

Update the comment at line ~172:
```javascript
PINGONE_AI_AGENT_CLIENT_ID: { public: true, default: '' }, // Demo AI Agent App client ID — the RFC 8693 actor
```

- [ ] **Step 2: Verify no remaining `banking:` literals**

```bash
grep -n "banking:" banking_api_server/services/configStore.js
```

Fix any remaining hits.

- [ ] **Step 3: Commit**

```bash
git add banking_api_server/services/configStore.js
git commit -m "feat(scopes): update configStore defaults to generic scope names"
```

---

## Task 5: Update BFF services

**Files:**
- Modify: `banking_api_server/services/agentMcpTokenService.js`
- Modify: `banking_api_server/services/agentCCTokenService.js`
- Modify: `banking_api_server/services/resourceIndicatorService.js`
- Modify: `banking_api_server/services/scopeAuditService.js`
- Modify: `banking_api_server/services/scopePolicyEngine.js`

- [ ] **Step 1: Update `agentMcpTokenService.js` — string replacements**

Run a search-replace across the file:

| Find | Replace |
|------|---------|
| `'banking:read'` | `'read'` |
| `'banking:write'` | `'write'` |
| `'banking:mcp:invoke'` | `'mcp:invoke'` |
| `'banking:ai:agent:read'` | `'ai:agent:read'` |
| `'banking:agent:invoke'` | `'agent:invoke'` |
| `'banking:mortgage:read'` | `'mortgage:read'` |

After replacing, verify:
```bash
grep -n "banking:" banking_api_server/services/agentMcpTokenService.js
```

- [ ] **Step 2: Fix `startsWith('banking:')` heuristic in `agentMcpTokenService.js`**

Find the line:
```javascript
const hasBankingScopes = existingScopes.some(s => s.startsWith('banking:'));
```

Replace with:
```javascript
const hasBankingScopes = existingScopes.some(s => s === 'read' || s === 'write');
```

Also update the log message on the nearby line that references `banking:*`:
```javascript
`ff_inject_scopes is ON. The user access token had no data scopes so the BFF has `
```

- [ ] **Step 3: Update `agentCCTokenService.js`**

Find the default parameter:
```javascript
scope = ['banking:mcp:invoke'],
```
Replace with:
```javascript
scope = ['mcp:invoke'],
```

Update the JSDoc comment:
```javascript
 *   - scope: scopes to request (default: ['mcp:invoke'])
```

- [ ] **Step 4: Update `resourceIndicatorService.js`**

Find:
```javascript
scopes: ['banking:read', 'banking:write', 'transactions:read', 'accounts:read'],
```
Replace with:
```javascript
scopes: ['read', 'write', 'transactions:read', 'accounts:read'],
```

- [ ] **Step 5: Update `scopeAuditService.js`**

Find:
```javascript
'Super Banking AI Agent': ['banking:agent:invoke'],
'Super Banking Agent Gateway': ['banking:agent:invoke'],
```
Replace with:
```javascript
'Demo AI Agent': ['agent:invoke'],
'Demo Agent Gateway': ['agent:invoke'],
```

- [ ] **Step 6: Update `scopePolicyEngine.js`**

Replace scope string keys and values in the policy map:
```javascript
'read':       { operations: ['GET /accounts/*', 'GET /transactions/*', 'GET /balances/*'], requires_user_context: true, category: 'data' },
'write':      { operations: ['POST /transactions', 'POST /transfers'], requires_user_context: true, category: 'data' },
'mcp:invoke': { operations: ['mcp:tools/call'], requires_user_context: true, category: 'infra' },
```

Find and replace any remaining `banking:` literals:
```bash
grep -n "banking:" banking_api_server/services/scopePolicyEngine.js
```

- [ ] **Step 7: Commit**

```bash
git add banking_api_server/services/agentMcpTokenService.js \
        banking_api_server/services/agentCCTokenService.js \
        banking_api_server/services/resourceIndicatorService.js \
        banking_api_server/services/scopeAuditService.js \
        banking_api_server/services/scopePolicyEngine.js
git commit -m "feat(scopes): update BFF services to generic scope names"
```

---

## Task 6: Update BFF routes

**Files:**
- Modify: `banking_api_server/routes/transactions.js`
- Modify: `banking_api_server/routes/authorizeConfig.js`
- Modify: `banking_api_server/routes/tokens.js`
- Modify: `banking_api_server/routes/mcpInspector.js`
- Modify: `banking_api_server/routes/setupWizard.js`

- [ ] **Step 1: Update `transactions.js`**

Replace all `requireScopes` call arguments:
- `requireScopes(['banking:read'])` → `requireScopes(['read'])`
- `requireScopes(['banking:write'])` → `requireScopes(['write'])`

Update comments referencing `banking:read`/`banking:write`/`banking:transactions:*`:
- Replace `banking:read` → `read`, `banking:write` → `write` in all comments

Verify:
```bash
grep -n "banking:" banking_api_server/routes/transactions.js
```

- [ ] **Step 2: Update `authorizeConfig.js`**

Replace the scope-keyed config object keys and descriptions:
```javascript
'read': {
  // ... description for read scope
},
'write': {
  // ... description for write scope
},
'mcp:invoke': {
  // ... description for mcp:invoke scope
},
'mortgage:read': {
  // ... description for mortgage:read scope
},
```

- [ ] **Step 3: Update `tokens.js`**

Find the `bankingScopes` array (line ~130):
```javascript
const bankingScopes = ['read', 'write', 'accounts:read',
  'transactions:read', 'mortgage:read', 'agent:invoke'];
```

Update the fallback on the next line:
```javascript
const scopesForExchange = exchangeScopes.length > 0 ? exchangeScopes : ['read'];
```

Update the comment on line ~122 that references `banking:agent:invoke`:
```javascript
// when ENDUSER_AUDIENCE is configured and the login only carries agent:invoke.
```

- [ ] **Step 4: Update `mcpInspector.js`**

Find the fallback scope hints (lines ~230, ~279):
```javascript
requiredScopesHint: MCP_TOOL_SCOPES[tool] || ['read'],
```
(Two occurrences — update both.)

- [ ] **Step 5: Update `setupWizard.js`**

Replace all occurrences of `'banking_api_enduser'` with `'api.ping.demo'`:
```bash
grep -n "banking_api_enduser" banking_api_server/routes/setupWizard.js
```
Three occurrences at lines ~92, ~377, ~378. Update all three.

- [ ] **Step 6: Commit**

```bash
git add banking_api_server/routes/transactions.js \
        banking_api_server/routes/authorizeConfig.js \
        banking_api_server/routes/tokens.js \
        banking_api_server/routes/mcpInspector.js \
        banking_api_server/routes/setupWizard.js
git commit -m "feat(scopes): update BFF routes to generic scope names and audience"
```

---

## Task 7: Create cleanup script

**Files:**
- Create: `banking_api_server/scripts/cleanupPingOneApps.js`
- Modify: `banking_api_server/package.json`

- [ ] **Step 1: Create `cleanupPingOneApps.js`**

```javascript
'use strict';

/**
 * cleanupPingOneApps.js
 *
 * Deletes all 'Super Banking *' apps and resource servers from a PingOne
 * environment so that bootstrapPingOne.js can re-create them with generic
 * 'Demo *' names.
 *
 * Usage:
 *   node scripts/cleanupPingOneApps.js            # dry-run (prints what would be deleted)
 *   node scripts/cleanupPingOneApps.js --execute  # actually deletes
 *
 * Requires in banking_api_server/.env:
 *   PINGONE_ENVIRONMENT_ID
 *   PINGONE_REGION          (e.g. com, eu, ca, ap)
 *   PINGONE_WORKER_CLIENT_ID
 *   PINGONE_WORKER_CLIENT_SECRET
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const https = require('https');

const DRY_RUN = !process.argv.includes('--execute');

const {
  PINGONE_ENVIRONMENT_ID,
  PINGONE_REGION = 'com',
  PINGONE_WORKER_CLIENT_ID,
  PINGONE_WORKER_CLIENT_SECRET,
} = process.env;

if (!PINGONE_ENVIRONMENT_ID || !PINGONE_WORKER_CLIENT_ID || !PINGONE_WORKER_CLIENT_SECRET) {
  console.error('ERROR: PINGONE_ENVIRONMENT_ID, PINGONE_WORKER_CLIENT_ID, and PINGONE_WORKER_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const AUTH_BASE = `https://auth.pingone.${PINGONE_REGION}`;
const API_BASE  = `https://api.pingone.${PINGONE_REGION}/v1`;
const ENV_PATH  = `/environments/${PINGONE_ENVIRONMENT_ID}`;

const SUPER_BANKING_APP_NAMES = [
  'Super Banking Admin App',
  'Super Banking User App',
  'Super Banking MCP Server',
  'Super Banking Worker',
  'Super Banking MCP Exchanger',
  'Super Banking MCP Gateway',
  'Super Banking Agent',
  'Super Banking AI Agent',
];

const SUPER_BANKING_RESOURCE_NAMES = [
  'Super Banking API',
  'Super Banking MCP Server',
  'Super Banking MCP Gateway',
  'Super Banking Agent Gateway',
];

async function request(method, url, token, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getWorkerToken() {
  return new Promise((resolve, reject) => {
    const creds = Buffer.from(`${PINGONE_WORKER_CLIENT_ID}:${PINGONE_WORKER_CLIENT_SECRET}`).toString('base64');
    const body = 'grant_type=client_credentials';
    const options = {
      hostname: `auth.pingone.${PINGONE_REGION}`,
      path: `/${PINGONE_ENVIRONMENT_ID}/as/token`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (!parsed.access_token) {
          reject(new Error(`Token error: ${data}`));
        } else {
          resolve(parsed.access_token);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function listApps(token) {
  const res = await request('GET', `${API_BASE}${ENV_PATH}/applications?limit=100`, token);
  return (res.body?._embedded?.applications || []);
}

async function listResources(token) {
  const res = await request('GET', `${API_BASE}${ENV_PATH}/resources?limit=100`, token);
  return (res.body?._embedded?.resources || []);
}

async function deleteApp(token, app) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete app: "${app.name}" (${app.id})`);
    return;
  }
  console.log(`  Deleting app: "${app.name}" (${app.id})`);
  const res = await request('DELETE', `${API_BASE}${ENV_PATH}/applications/${app.id}`, token);
  if (res.status === 204) {
    console.log(`  ✅ Deleted`);
  } else {
    console.error(`  ❌ Failed (${res.status}):`, res.body);
  }
}

async function deleteResource(token, resource) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete resource: "${resource.name}" (${resource.id})`);
    return;
  }
  console.log(`  Deleting resource: "${resource.name}" (${resource.id})`);
  const res = await request('DELETE', `${API_BASE}${ENV_PATH}/resources/${resource.id}`, token);
  if (res.status === 204) {
    console.log(`  ✅ Deleted`);
  } else {
    console.error(`  ❌ Failed (${res.status}):`, res.body);
  }
}

async function main() {
  console.log(DRY_RUN
    ? '\n[DRY RUN] No changes will be made. Pass --execute to actually delete.\n'
    : '\n[EXECUTE] Deleting Super Banking apps and resource servers from PingOne...\n');

  const token = await getWorkerToken();

  // Delete apps first (they reference resource servers)
  console.log('--- Apps ---');
  const apps = await listApps(token);
  const targetApps = apps.filter(a => SUPER_BANKING_APP_NAMES.includes(a.name));
  if (targetApps.length === 0) {
    console.log('  No matching apps found.');
  }
  for (const app of targetApps) {
    await deleteApp(token, app);
  }

  // Delete resource servers
  console.log('\n--- Resource Servers ---');
  const resources = await listResources(token);
  const targetResources = resources.filter(r => SUPER_BANKING_RESOURCE_NAMES.includes(r.name));
  if (targetResources.length === 0) {
    console.log('  No matching resource servers found.');
  }
  for (const resource of targetResources) {
    await deleteResource(token, resource);
  }

  console.log(DRY_RUN
    ? '\n[DRY RUN complete] Re-run with --execute to apply.\n'
    : '\nCleanup complete. Run `npm run pingone:bootstrap` to re-provision with Demo names.\n');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script to `banking_api_server/package.json`**

In the `"scripts"` section, add:
```json
"pingone:cleanup": "node scripts/cleanupPingOneApps.js"
```

- [ ] **Step 3: Verify dry-run works**

```bash
cd banking_api_server && node scripts/cleanupPingOneApps.js
```

Expected output: lists apps/resources it would delete (or "No matching apps found" if PingOne not configured). Must not throw or hang.

- [ ] **Step 4: Commit**

```bash
git add banking_api_server/scripts/cleanupPingOneApps.js banking_api_server/package.json
git commit -m "feat(provisioner): add cleanupPingOneApps script to wipe Super Banking PingOne entities"
```

---

## Task 8: Update provisioner (bootstrapPingOne.js + pingoneProvisionService.js)

**Files:**
- Modify: `banking_api_server/scripts/bootstrapPingOne.js`
- Modify: `banking_api_server/services/pingoneProvisionService.js`

- [ ] **Step 1: Update `bootstrapPingOne.js` audience defaults**

Find all occurrences of `'banking_api_enduser'` (5 occurrences at lines ~531, ~542, ~562, ~590, ~622):
```javascript
// Replace each:
process.env.PINGONE_BOOTSTRAP_AUDIENCE || 'api.ping.demo'
// and:
const audience = process.env.PINGONE_BOOTSTRAP_AUDIENCE || 'api.ping.demo';
```

Update the usage comment at line ~113:
```
PINGONE_BOOTSTRAP_AUDIENCE       Resource server audience  (default: api.ping.demo)
```

- [ ] **Step 2: Update `bootstrapPingOne.js` app name list**

Find the `KNOWN_APP_NAMES` array (lines ~812–818):
```javascript
const KNOWN_APP_NAMES = [
  'Demo Admin App',
  'Demo User App',
  'Demo MCP Server',
  'Demo Worker',
  'Demo MCP Exchanger',
  'Demo MCP Gateway',
  'Demo Agent',
  'Demo AI Agent',
];
const KNOWN_RESOURCE_NAMES = [
  'Demo API',
  'Demo MCP Server',
  'Demo MCP Gateway',
  'Demo Agent Gateway',
];
```

Update the `--recreate-apps` help text at line ~95:
```
node scripts/bootstrapPingOne.js --recreate-apps    Delete existing 'Demo *' apps then reprovision
```

- [ ] **Step 3: Update `pingoneProvisionService.js` — read display names from topology**

At the top of the file (after `const scopeTopology = require(...)` import), add:

```javascript
const rawTopology = require('../../scope-topology.json');
const PROVISIONING = rawTopology.provisioning || {};

function provisioningAppName(internalKey) {
  return (PROVISIONING.appNames || {})[internalKey] || internalKey;
}

function provisioningResourceName(internalKey) {
  return (PROVISIONING.resourceNames || {})[internalKey] || internalKey;
}
```

Then replace every hardcoded `'Super Banking ...'` display name string in provision calls with the helper:

| Find | Replace |
|------|---------|
| `'Super Banking API'` (when used as PingOne display name) | `provisioningResourceName('Super Banking API')` |
| `'Super Banking MCP Server'` (display name) | `provisioningResourceName('Super Banking MCP Server')` |
| `'Super Banking MCP Gateway'` (display name) | `provisioningResourceName('Super Banking MCP Gateway')` |
| `'Super Banking Agent Gateway'` (display name) | `provisioningResourceName('Super Banking Agent Gateway')` |
| `'Super Banking Admin App'` | `provisioningAppName('Super Banking Admin App')` |
| `'Super Banking User App'` | `provisioningAppName('Super Banking User App')` |
| `'Super Banking MCP Server'` (app) | `provisioningAppName('Super Banking MCP Server')` |
| `'Super Banking Worker'` | `provisioningAppName('Super Banking Worker')` |
| `'Super Banking MCP Exchanger'` | `provisioningAppName('Super Banking MCP Exchanger')` |
| `'Super Banking MCP Gateway'` (app) | `provisioningAppName('Super Banking MCP Gateway')` |
| `'Super Banking Agent'` | `provisioningAppName('Super Banking Agent')` |
| `'Super Banking AI Agent'` | `provisioningAppName('Super Banking AI Agent')` |

**Important:** The internal topology keys (`'Super Banking API'` as a JS object key in `resources`, `apps`, `servers`) must NOT change — only the string arguments passed to PingOne API calls change.

- [ ] **Step 4: Update `pingoneProvisionService.js` — scope strings**

Find any remaining hardcoded `banking:` scope strings (the provisioner reads most from topology, but check for stragglers):
```bash
grep -n "banking:" banking_api_server/services/pingoneProvisionService.js
```

Replace any literals found with the generic equivalents.

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/scripts/bootstrapPingOne.js \
        banking_api_server/services/pingoneProvisionService.js
git commit -m "feat(provisioner): read Demo display names from topology provisioning block; update audience default"
```

---

## Task 9: Update TypeScript services (MCP server + gateway)

**Files:**
- Modify: `banking_mcp_server/src/tools/BankingToolRegistry.ts`
- Modify: `banking_mcp_server/src/tools/toolScopeMap.ts`
- Modify: `banking_mcp_server/src/auth/AuthorizationRequestGenerator.ts`

- [ ] **Step 1: Update `toolScopeMap.ts`**

Replace all scope string values:
```typescript
const TOOL_SCOPES: Record<string, string[]> = {
  get_my_accounts:               ['read'],
  get_account_balance:           ['read'],
  get_sensitive_account_details: ['read'],
  get_my_transactions:           ['read'],
  create_deposit:                ['write'],
  create_withdrawal:             ['write'],
  create_transfer:               ['write'],
  query_user_by_email:           ['read'],
  sequential_think:              ['read'],
};
```

Update the fallback comment and value:
```typescript
 * Falls back to ['read'] for unknown tools (safe default — read-only).
```
```typescript
return TOOL_SCOPES[toolName] ?? ['read'];
```

Update the registry/token comment:
```typescript
 * Registry and token scopes both use the flat format (read, write),
```

- [ ] **Step 2: Update `BankingToolRegistry.ts`**

Replace all `requiredScopes` arrays:
- `['banking:read']` → `['read']`
- `['banking:read', 'banking:sensitive:read']` → `['read']` (drop sensitive — it wasn't in topology)
- `['banking:write']` → `['write']`

Verify:
```bash
grep -n "banking:" banking_mcp_server/src/tools/BankingToolRegistry.ts
```

- [ ] **Step 3: Update `AuthorizationRequestGenerator.ts`**

Replace:
- `'banking:read'` → `'read'`
- `'banking:write'` → `'write'`

Verify:
```bash
grep -n "banking:" banking_mcp_server/src/auth/AuthorizationRequestGenerator.ts
```

- [ ] **Step 4: Build the MCP server**

```bash
cd banking_mcp_server && npm run build
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 5: Build the MCP gateway**

```bash
cd banking_mcp_gateway && npm run build
```

Expected: exits 0. (The gateway derives scopes from topology at build time — no file changes needed, but must recompile to pick up new topology values.)

- [ ] **Step 6: Commit**

```bash
git add banking_mcp_server/src/tools/BankingToolRegistry.ts \
        banking_mcp_server/src/tools/toolScopeMap.ts \
        banking_mcp_server/src/auth/AuthorizationRequestGenerator.ts \
        banking_mcp_server/dist \
        banking_mcp_gateway/dist
git commit -m "feat(mcp): update MCP server/gateway scope strings to generic names; recompile"
```

---

## Task 10: Update tests

**Files:**
- Modify: `banking_api_server/src/__tests__/scopeTopology.regression.test.js`
- Modify: `banking_api_server/src/__tests__/agentMcpTokenService.test.js`
- Modify: `banking_api_server/src/__tests__/agentDelegation.real-token.test.js`
- Modify: `banking_api_server/src/__tests__/accounts.route.test.js`
- Modify: `banking_api_server/src/__tests__/delegationChainValidationService.test.js`
- Modify: `banking_api_server/src/__tests__/transaction-consent-challenge.test.js`
- Modify: `banking_api_server/tests/ccTokenScope.regression.test.js`
- Modify: `banking_api_server/tests/mcpGatewayConfig.test.js`
- Modify: `banking_api_server/tests/tokenUtils.test.js`
- Modify: `banking_api_server/tests/routes/langchainChatProxy.regression.test.js`
- Modify: `banking_api_server/tests/bankingAgentLangGraphService.modes.test.js`

- [ ] **Step 1: Global search-replace in all test files**

For each file, replace:
- `'banking:read'` → `'read'`
- `'banking:write'` → `'write'`
- `'banking:transfer'` → `'transfer'`
- `'banking:mcp:invoke'` → `'mcp:invoke'`
- `'banking:agent:invoke'` → `'agent:invoke'`
- `'banking:ai:agent:read'` → `'ai:agent:read'`
- `'banking:mortgage:read'` → `'mortgage:read'`
- `'banking_api_enduser'` → `'api.ping.demo'`

- [ ] **Step 2: Update `scopeTopology.regression.test.js` — topology key references**

The test references internal topology keys like `'Super Banking User App'` and `'Super Banking API'`. These internal keys are **not changing** (only display names change). The scope assertions need updating:

```javascript
// Line ~55: was 'banking:transfer'
expect(topo.appGrantedScopes('Super Banking User App')).toContain('transfer');
// Line ~59: was 'banking:transfer'
expect(topo.resourceScopes('Super Banking API')).toContain('transfer');
// Line ~99:
expect(topo.resourceScopes('Super Banking API')).toContain('transfer');
// Line ~107:
expect(topo.resourceMirroredScopes('Super Banking MCP Gateway')).toContain('read');
// Line ~134: SCOPE_REFERENCE_TABLE key stays 'Super Banking User App'
// Line ~244+: 'Super Banking User App' key stays; update scope assertions to 'read'/'write' etc.
```

- [ ] **Step 3: Update `mcpGatewayConfig.test.js` — `mcp_scope` assertions**

```javascript
// Line ~26:
mcp_scope: 'mcp:invoke',
// Line ~155:
expect(res.body.config.mcpScope).toBe('mcp:invoke');
// Line ~158 test description:
test('mcpScope defaults to "mcp:invoke" when configStore has no value', async () => {
// Line ~170:
expect(res.body.config.mcpScope).toBe('mcp:invoke');
// Line ~224:
.send({ mcp_scope: 'mcp:invoke' });
// Lines ~271, ~279:
mcp_scope: 'mcp:invoke',
```

- [ ] **Step 4: Update `ccTokenScope.regression.test.js`**

```javascript
// Line ~37:
'agent-client', 'secret', 'agent-gateway.ping.demo', 'basic', 'agent:invoke'
// Line ~42:
expect(body.get('scope')).toBe('agent:invoke');
// Line ~47:
'mcp-client', 'secret', 'mcp-gateway.ping.demo', 'basic', ['mcp:invoke', 'read']
// Line ~49:
expect(lastPostBody().get('scope')).toBe('mcp:invoke read');
```

- [ ] **Step 5: Run all updated tests**

```bash
cd banking_api_server && npm test -- --passWithNoTests 2>&1 | tail -30
```

Expected: all pass. Fix any remaining `banking:` string mismatches surfaced by failures.

- [ ] **Step 6: Commit**

```bash
git add \
  banking_api_server/src/__tests__/scopeTopology.regression.test.js \
  banking_api_server/src/__tests__/agentMcpTokenService.test.js \
  banking_api_server/src/__tests__/agentDelegation.real-token.test.js \
  banking_api_server/src/__tests__/accounts.route.test.js \
  banking_api_server/src/__tests__/delegationChainValidationService.test.js \
  banking_api_server/src/__tests__/transaction-consent-challenge.test.js \
  banking_api_server/tests/ccTokenScope.regression.test.js \
  banking_api_server/tests/mcpGatewayConfig.test.js \
  banking_api_server/tests/tokenUtils.test.js \
  banking_api_server/tests/routes/langchainChatProxy.regression.test.js \
  banking_api_server/tests/bankingAgentLangGraphService.modes.test.js
git commit -m "test: update all test fixtures to generic scope names"
```

---

## Task 11: Update `run-demo.sh`

**Files:**
- Modify: `run-demo.sh`

- [ ] **Step 1: Rename log/pid variables**

Replace every `bank-` prefix in `/tmp/` paths with `demo-`:

| Find | Replace |
|------|---------|
| `/tmp/bank-api-server.pid` | `/tmp/demo-api.pid` |
| `/tmp/bank-api-server.log` | `/tmp/demo-api.log` |
| `/tmp/bank-mcp-server.pid` | `/tmp/demo-mcp.pid` |
| `/tmp/bank-mcp-server.log` | `/tmp/demo-mcp.log` |
| `/tmp/bank-mcp-gateway.pid` | `/tmp/demo-mcp-gateway.pid` |
| `/tmp/bank-mcp-gateway.log` | `/tmp/demo-mcp-gateway.log` |
| `/tmp/bank-agent-service.pid` | `/tmp/demo-agent.pid` |
| `/tmp/bank-agent-service.log` | `/tmp/demo-agent.log` |
| `/tmp/bank-hitl-service.pid` | `/tmp/demo-hitl.pid` |
| `/tmp/bank-hitl-service.log` | `/tmp/demo-hitl.log` |
| `/tmp/bank-mcp-invest.pid` | `/tmp/demo-invest.pid` |
| `/tmp/bank-mcp-invest.log` | `/tmp/demo-invest.log` |
| `/tmp/bank-mortgage-service.pid` | `/tmp/demo-mortgage.pid` |
| `/tmp/bank-mortgage-service.log` | `/tmp/demo-mortgage.log` |
| `/tmp/bank-langchain-agent.pid` | `/tmp/demo-langchain.pid` |
| `/tmp/bank-langchain-agent.log` | `/tmp/demo-langchain.log` |
| `/tmp/bank-mcp-traffic.log` | `/tmp/demo-mcp-traffic.log` |
| `/tmp/bank-authorize-server.log` | `/tmp/demo-authorize.log` |
| `/tmp/bank-helix.log` | `/tmp/demo-helix.log` |
| `/tmp/bank-ollama.pid` | `/tmp/demo-ollama.pid` |
| `/tmp/bank-ollama.log` | `/tmp/demo-ollama.log` |
| `/tmp/bank-ui.pid` | `/tmp/demo-ui.pid` |
| `/tmp/bank-ui.log` | `/tmp/demo-ui.log` |

- [ ] **Step 2: Update banner and heading text**

```bash
# Line ~424 — banner:
echo -e "${CYAN}${BOLD}   [DEMO]  DEMO — TEST SUITE                                   ${RESET}"

# Line ~399 — stop message:
echo "[STOP] Stopping Demo services (run-demo.sh)..."

# Line ~417 — stop complete:
echo "[OK] All Demo listeners stopped (or none were running)."
```

- [ ] **Step 3: Rename `tail_bank_logs` function to `tail_demo_logs`**

Find the function definition:
```bash
tail_bank_logs() {
```
Replace with:
```bash
tail_demo_logs() {
```

Find the call site (line ~557):
```bash
tail_demo_logs "${2:-}"
```

- [ ] **Step 4: Verify no remaining `bank-` in `/tmp/` paths**

```bash
grep -n "bank-" run-demo.sh
```

The only remaining hits should be filesystem directory refs (`banking_api_server`, etc.) — not `/tmp/` paths.

- [ ] **Step 5: Commit**

```bash
git add run-demo.sh
git commit -m "feat(scripts): rename run-demo.sh log/pid files and headings to demo-* naming"
```

---

## Task 12: Update docs and build gate

**Files:**
- Modify: `CLAUDE.md`
- Modify: `REGRESSION_PLAN.md`

- [ ] **Step 1: Update `CLAUDE.md` verification checklist**

Find the quick verification checklist section. Update the log file reference:
```markdown
- Check `/tmp/demo-api.log` for `[McpExchangerToken] ✅ Token obtained`
```
(Was `/tmp/bank-api-server.log`.)

- [ ] **Step 2: Add §4 entry to `REGRESSION_PLAN.md`**

Add to §4 (Bug Fix Log) — use the existing entry template:

```markdown
| 2026-05-19 | Generic scope rename | `scope-topology.json`, all consumers | Removed `banking:` prefix from all scope strings; renamed `banking_api_enduser` → `api.ping.demo`; PingOne apps renamed `Super Banking *` → `Demo *`; run-demo.sh logs renamed `bank-*` → `demo-*`. Re-bootstrap required: `npm run pingone:cleanup -- --execute` then `npm run pingone:bootstrap`. |
```

- [ ] **Step 3: Update §1 audience string reference**

In the §1 protected files table, find the row referencing `banking_api_enduser` and update to `api.ping.demo`.

- [ ] **Step 4: Run UI build gate**

```bash
cd banking_api_ui && npm run build
```

Expected: exits 0. (UI has no scope string references — this is a sanity check.)

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md REGRESSION_PLAN.md
git commit -m "docs: update log path and regression entry for generic scope rename"
```

---

## Task 13: PingOne re-provisioning (operational — run after all code is merged)

This task is operator-run, not automated by CI.

- [ ] **Step 1: Run cleanup (dry-run first)**

```bash
cd banking_api_server && node scripts/cleanupPingOneApps.js
```

Review the output — confirm it lists the expected `Super Banking *` apps and resource servers.

- [ ] **Step 2: Execute cleanup**

```bash
cd banking_api_server && node scripts/cleanupPingOneApps.js --execute
```

Expected: all `Super Banking *` entries deleted (or "No matching apps found" if already clean). Exit 0.

- [ ] **Step 3: Re-bootstrap**

```bash
cd banking_api_server && npm run pingone:bootstrap
```

Expected: creates `Demo API`, `Demo MCP Server`, `Demo User App`, etc. Writes new client IDs/secrets to `banking_api_server/.env`.

- [ ] **Step 4: Rebuild vault**

```bash
export VAULT_PASSWORD=<your-vault-password>
# Run vault sync command (per project vault_bootstrap memory)
```

- [ ] **Step 5: Restart all services**

```bash
./run-demo.sh
```

- [ ] **Step 6: Verify**

```bash
./run-demo.sh status
```

Then open `https://api.ping.demo:4000` in a browser:
1. Log in as the banking user → `/dashboard`
2. Open the agent, click "Check Balance" chip
3. Token Chain panel shows `read` and `mcp:invoke` scopes (not `banking:read`, `banking:mcp:invoke`)
4. Log files appear at `/tmp/demo-api.log`, `/tmp/demo-mcp.log`

```bash
ls /tmp/demo-*.log
```

---

## Success Criteria

- `cd banking_api_ui && npm run build` → exit 0
- `cd banking_mcp_gateway && npm run build` → exit 0
- `cd banking_mcp_server && npm run build` → exit 0
- `cd banking_api_server && npm test -- --passWithNoTests` → all pass
- `node scripts/cleanupPingOneApps.js` (dry-run) → prints `Super Banking *` entities without error
- After re-bootstrap: PingOne token claims show `read`, `write`, `mcp:invoke` (not `banking:*`)
- Log files at `/tmp/demo-api.log` etc. after `./run-demo.sh`
- No `banking:` scope strings in PingOne token claims
