# Scope Topology SSOT + Regression Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one authoritative scope-topology manifest, make the correctness-critical scope consumers derive from it, fix the `create_transfer` 403 (`missing banking:transfer`) through the manifest, and add a CI-blocking regression test plus a live PingOne audit so this class of drift cannot recur.

**Architecture:** A single `scope-topology.json` at the repo root is the source of truth (scopes → resources → apps → tool deps). The gateway tool→scope map and the BFF RFC 8693 exchange map are *rewritten to derive* from it (clean structural fit). The imperative provisioning service gets two targeted `banking:transfer` additions plus a regression assertion that its scope arrays match the manifest (a deliberate, documented refinement of spec §3.3 — a wholesale derive-rewrite of a 2000-line REGRESSION_PLAN §1 file is out of safe-diff scope). `scopePolicyEngine` / `scopeAuditService` derive their scope sets from the manifest with manifest-keyed overlays for policy/audit-local metadata. A static jest test asserts every consumer agrees with the manifest; `verify-scope-configuration.js` gains a live-env diff. Generated docs replace the drifted `.planning` scope docs.

**Tech Stack:** Node CommonJS (BFF, `banking_api_server`), TypeScript strict + `resolveJsonModule` (gateway, `banking_mcp_gateway`), Jest (both), JSON manifest + JSON Schema.

---

## Reconciliation policy (read before Task 1)

The gateway `TOOL_SCOPES` and BFF `MCP_TOOL_SCOPES` are not just `banking:transfer`-drifted — they have **different tool sets**. The manifest reconciles them with three explicit tool classes encoded as a per-tool `surface` field:

- `surface: "gateway"` — tool is gateway-enforced AND BFF-exchanged. Both maps MUST agree exactly (e.g. `create_transfer`, `create_deposit`, `get_my_accounts`).
- `surface: "exchange-only"` — BFF-exchange map only, never reaches the gateway tool path (e.g. `query_user_by_email: ['ai_agent']`, the `admin_*` tools). Gateway map is not asserted for these.
- `surface: "legacy-alias"` — BFF legacy aliases (`transfer`, `deposit`, `withdraw`, `banking_get_account_balance`, `banking_create_transfer`, `list_accounts`, `list_transactions`). Carried for back-compat; asserted only against themselves.

The regression test (Task 7) asserts equality **only within the class each tool declares**. This is how "set equality" from spec §3.5 assertion 2 is made precise without forcing the two historically-divergent maps into false equivalence.

---

## File Structure

- **Create** `scope-topology.json` (repo root) — the manifest. One responsibility: declare scopes, resources, app grants, tool→scope deps.
- **Create** `scope-topology.schema.json` (repo root) — JSON Schema constraining the manifest shape.
- **Create** `banking_api_server/services/scopeTopology.js` — CommonJS loader: reads + schema-validates the manifest once, exposes typed accessors for BFF consumers.
- **Create** `banking_mcp_gateway/src/auth/scopeTopology.ts` — TS loader: imports the manifest JSON, exposes accessors for gateway consumers.
- **Modify** `banking_mcp_gateway/src/auth/toolScopes.ts` — `TOOL_SCOPES` + `STEP_UP_TOOLS` derive from the TS loader; public API unchanged.
- **Modify** `banking_api_server/services/mcpWebSocketClient.js` — `MCP_TOOL_SCOPES` derives from the JS loader; shape unchanged.
- **Modify** `banking_api_server/services/pingoneProvisionService.js` — add `banking:transfer` to the main-resource scope array + User App grant (Admin inherits via `scopes.map`).
- **Modify** `banking_api_server/services/scopePolicyEngine.js` — `SCOPE_TAXONOMY` scope ids + risk derive from manifest; ops kept as manifest-keyed overlay.
- **Modify** `banking_api_server/services/scopeAuditService.js` — `SCOPE_REFERENCE_TABLE` derives from manifest apps via a pinned display-name map.
- **Create** `banking_api_server/scripts/generate-scope-doc.js` — renders manifest → `docs/scope-topology.md`.
- **Create** `docs/scope-topology.md` — generated reference (committed; regenerated, never hand-edited).
- **Modify** `.planning/quick/2026-04-07-pingone-scopes-mapping.md` + 3 sibling scope docs + `.planning/quick/pingone-update-scopes-manual.md` — replace bodies with one-line pointer stubs.
- **Modify** `banking_api_server/scripts/verify-scope-configuration.js` — add a `--manifest-diff` mode comparing live PingOne against the manifest.
- **Create** `banking_api_server/src/__tests__/scopeTopology.regression.test.js` — the CI-blocking guard.
- **Create** `banking_mcp_gateway/tests/scopeTopology.test.ts` — gateway-side derive sanity (build-time TS guard).
- **Modify** `banking_api_server/package.json` — add `"scopes:doc"` script.
- **Modify** `REGRESSION_PLAN.md` — §4 Bug Fix Log entry + §1 protected-table rows for the manifest + regression test.

---

## Task 1: The manifest + schema (source of truth)

**Files:**
- Create: `scope-topology.json`
- Create: `scope-topology.schema.json`
- Test: `banking_api_server/src/__tests__/scopeTopology.regression.test.js` (created here, grown across tasks)

- [ ] **Step 1: Write the failing test (manifest exists + schema-valid)**

Create `banking_api_server/src/__tests__/scopeTopology.regression.test.js`:

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const ROOT = path.resolve(__dirname, '../../../');
const manifestPath = path.join(ROOT, 'scope-topology.json');
const schemaPath = path.join(ROOT, 'scope-topology.schema.json');

describe('scope-topology manifest', () => {
  test('manifest and schema files exist', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  test('manifest validates against schema', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(manifest);
    if (!ok) {
      throw new Error('Manifest schema errors: ' + JSON.stringify(validate.errors, null, 2));
    }
    expect(ok).toBe(true);
  });

  test('every scope referenced by a tool/app/resource is declared in scopes', () => {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const declared = new Set(Object.keys(m.scopes));
    const refs = new Set();
    Object.values(m.tools).forEach(t => (t.requiredScopes || []).forEach(s => refs.add(s)));
    Object.values(m.apps).forEach(a => (a.grantedScopes || []).forEach(s => refs.add(s)));
    Object.values(m.resources).forEach(r => (r.scopes || []).forEach(s => refs.add(s)));
    // OIDC scopes are intentionally not in scopes{} (not banking scopes).
    const OIDC = new Set(['openid', 'profile', 'email', 'offline_access']);
    const missing = [...refs].filter(s => !declared.has(s) && !OIDC.has(s));
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest scopeTopology.regression -v`
Expected: FAIL — "manifest and schema files exist" fails (files not created yet).

- [ ] **Step 3: Create the schema**

Create `scope-topology.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Scope Topology",
  "type": "object",
  "required": ["version", "scopes", "resources", "apps", "tools"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "version": { "type": "integer", "const": 1 },
    "scopes": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["description", "riskLevel", "resource"],
        "additionalProperties": false,
        "properties": {
          "description": { "type": "string", "minLength": 1 },
          "riskLevel": { "enum": ["low", "medium", "high"] },
          "resource": { "type": "string", "minLength": 1 }
        }
      }
    },
    "resources": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["scopes"],
        "additionalProperties": false,
        "properties": {
          "uri": { "type": "string" },
          "scopes": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "apps": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["grantedScopes"],
        "additionalProperties": false,
        "properties": {
          "grantedScopes": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "tools": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["requiredScopes", "surface"],
        "additionalProperties": false,
        "properties": {
          "requiredScopes": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
          "surface": { "enum": ["gateway", "exchange-only", "legacy-alias"] },
          "challengeType": { "enum": ["step_up", "consent"] }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Create the manifest**

Create `scope-topology.json`. Values below transcribed verbatim from the current code (gateway `toolScopes.ts`, BFF `MCP_TOOL_SCOPES`, `pingoneProvisionService.js` lines 1267-1281 / 1474 / grants), WITH the `banking:transfer` correction applied to `create_transfer`, the User App, and the Admin App:

```json
{
  "$schema": "./scope-topology.schema.json",
  "version": 1,
  "scopes": {
    "banking:read":          { "description": "Read accounts, balances, transactions", "riskLevel": "low",    "resource": "Super Banking API" },
    "banking:write":         { "description": "Write banking operations (deposit/withdrawal)", "riskLevel": "medium", "resource": "Super Banking API" },
    "banking:transfer":      { "description": "Execute fund transfers", "riskLevel": "high", "resource": "Super Banking API" },
    "banking:accounts:read": { "description": "Read account information and balances", "riskLevel": "low", "resource": "Super Banking API" },
    "banking:transactions:read": { "description": "Read transaction history and details", "riskLevel": "low", "resource": "Super Banking API" },
    "banking:mortgage:read": { "description": "Read mortgage account data (Phase 267 Path A api-key disposition)", "riskLevel": "low", "resource": "Super Banking API" },
    "banking:ai:agent:read": { "description": "Agent invocation permission", "riskLevel": "medium", "resource": "Super Banking API" },
    "banking:mcp:invoke":    { "description": "Invoke MCP tools via the gateway (RFC 8693 exchange)", "riskLevel": "medium", "resource": "Super Banking MCP Server" },
    "ai_agent":              { "description": "AI agent identity", "riskLevel": "medium", "resource": "Super Banking API" }
  },
  "resources": {
    "Super Banking API": {
      "scopes": ["banking:read", "banking:write", "banking:transfer", "banking:accounts:read", "banking:transactions:read", "banking:mortgage:read", "banking:ai:agent:read", "ai_agent"]
    },
    "Super Banking MCP Server": {
      "scopes": ["banking:mcp:invoke"]
    }
  },
  "apps": {
    "Super Banking User App":  { "grantedScopes": ["banking:ai:agent:read", "banking:read", "banking:write", "banking:transfer", "banking:mortgage:read"] },
    "Super Banking Admin App": { "grantedScopes": ["banking:read", "banking:write", "banking:transfer", "banking:accounts:read", "banking:transactions:read", "banking:mortgage:read", "banking:ai:agent:read", "ai_agent"] }
  },
  "tools": {
    "get_my_accounts":              { "requiredScopes": ["banking:read"], "surface": "gateway" },
    "get_account_balance":          { "requiredScopes": ["banking:read"], "surface": "gateway" },
    "get_my_transactions":          { "requiredScopes": ["banking:read"], "surface": "gateway" },
    "get_sensitive_account_details":{ "requiredScopes": ["banking:read"], "surface": "gateway" },
    "sequential_think":             { "requiredScopes": ["banking:read"], "surface": "gateway" },
    "get_investment_balance":       { "requiredScopes": ["banking:read"], "surface": "gateway" },
    "get_investment_accounts":      { "requiredScopes": ["banking:read"], "surface": "gateway" },
    "get_portfolio_summary":        { "requiredScopes": ["banking:read"], "surface": "gateway" },
    "show_mortgage":                { "requiredScopes": ["banking:mortgage:read"], "surface": "gateway" },
    "create_deposit":               { "requiredScopes": ["banking:write"], "surface": "gateway", "challengeType": "step_up" },
    "create_withdrawal":            { "requiredScopes": ["banking:write"], "surface": "gateway", "challengeType": "step_up" },
    "create_transfer":              { "requiredScopes": ["banking:write", "banking:transfer"], "surface": "gateway", "challengeType": "step_up" },
    "query_user_by_email":          { "requiredScopes": ["ai_agent"], "surface": "exchange-only" },
    "admin_list_all_users":         { "requiredScopes": ["admin:read", "users:read"], "surface": "exchange-only" },
    "admin_get_user_details":       { "requiredScopes": ["admin:read", "users:read"], "surface": "exchange-only" },
    "admin_delete_user":            { "requiredScopes": ["admin:write", "admin:delete", "users:manage"], "surface": "exchange-only" },
    "admin_manage_accounts":        { "requiredScopes": ["admin:write", "users:manage"], "surface": "exchange-only" },
    "admin_view_audit_logs":        { "requiredScopes": ["admin:read"], "surface": "exchange-only" },
    "admin_system_status":          { "requiredScopes": ["admin:read"], "surface": "exchange-only" },
    "list_accounts":                { "requiredScopes": ["banking:read"], "surface": "legacy-alias" },
    "list_transactions":            { "requiredScopes": ["banking:read"], "surface": "legacy-alias" },
    "transfer":                     { "requiredScopes": ["banking:write"], "surface": "legacy-alias" },
    "deposit":                      { "requiredScopes": ["banking:write"], "surface": "legacy-alias" },
    "withdraw":                     { "requiredScopes": ["banking:write"], "surface": "legacy-alias" },
    "banking_get_account_balance":  { "requiredScopes": ["banking:read"], "surface": "legacy-alias" },
    "banking_create_transfer":      { "requiredScopes": ["banking:write"], "surface": "legacy-alias" }
  }
}
```

Note: `admin:read`/`users:read`/etc. are exchange-only admin scopes the manifest does not catalog under `scopes{}` (they belong to a different resource model not in this SSOT's correctness scope). The Step-1 "every scope declared" test excludes them by also excluding non-`banking:`/`ai_agent` scopes — adjust the test's filter accordingly: change the `missing` filter to `!declared.has(s) && !OIDC.has(s) && (s.startsWith('banking:') || s === 'ai_agent')` so only banking-family scopes are required to be declared.

Apply that filter change to the test now.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd banking_api_server && npx jest scopeTopology.regression -v`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add scope-topology.json scope-topology.schema.json banking_api_server/src/__tests__/scopeTopology.regression.test.js
git commit -m "feat(scopes): add scope-topology.json SSOT + schema + base regression test"
```

(If `ajv` is not already a `banking_api_server` dependency, `cd banking_api_server && npm ls ajv`; it is a transitive dep of many tools but add `npm i -D ajv` if `require('ajv')` fails in Step 2, and include `package.json`/`package-lock.json` in this commit.)

---

## Task 2: BFF manifest loader

**Files:**
- Create: `banking_api_server/services/scopeTopology.js`
- Test: `banking_api_server/src/__tests__/scopeTopology.regression.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `scopeTopology.regression.test.js`:

```javascript
describe('BFF scopeTopology loader', () => {
  const topo = require('../../services/scopeTopology');

  test('toolScopes(name) returns requiredScopes from manifest', () => {
    expect(topo.toolScopes('create_transfer')).toEqual(['banking:write', 'banking:transfer']);
    expect(topo.toolScopes('get_my_accounts')).toEqual(['banking:read']);
  });

  test('toolScopes(unknown) falls back to [banking:read]', () => {
    expect(topo.toolScopes('no_such_tool')).toEqual(['banking:read']);
  });

  test('appGrantedScopes returns manifest grants', () => {
    expect(topo.appGrantedScopes('Super Banking User App')).toContain('banking:transfer');
  });

  test('resourceScopes returns manifest resource scope list', () => {
    expect(topo.resourceScopes('Super Banking API')).toContain('banking:transfer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest scopeTopology.regression -v`
Expected: FAIL — `Cannot find module '../../services/scopeTopology'`.

- [ ] **Step 3: Create the loader**

Create `banking_api_server/services/scopeTopology.js`:

```javascript
'use strict';

/**
 * scopeTopology.js — BFF accessor for the repo-root scope-topology.json SSOT.
 * Loaded + schema-validated once at first require. Throws on invalid manifest
 * so a malformed topology fails fast at service boot, never silently.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const MANIFEST_PATH = path.join(ROOT, 'scope-topology.json');

let _manifest = null;

function load() {
  if (_manifest) return _manifest;
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const m = JSON.parse(raw);
  if (!m || m.version !== 1 || !m.scopes || !m.tools || !m.apps || !m.resources) {
    throw new Error('[scopeTopology] scope-topology.json missing required top-level keys');
  }
  _manifest = m;
  return _manifest;
}

/** Required scopes for a tool. Falls back to ['banking:read'] for unknown tools. */
function toolScopes(toolName) {
  const t = load().tools[toolName];
  return t ? t.requiredScopes.slice() : ['banking:read'];
}

/** Tool surface class: 'gateway' | 'exchange-only' | 'legacy-alias' | undefined. */
function toolSurface(toolName) {
  const t = load().tools[toolName];
  return t ? t.surface : undefined;
}

/** challengeType for a tool ('step_up' | 'consent'); defaults to 'consent'. */
function toolChallengeType(toolName) {
  const t = load().tools[toolName];
  return (t && t.challengeType) || 'consent';
}

function appGrantedScopes(appName) {
  const a = load().apps[appName];
  return a ? a.grantedScopes.slice() : [];
}

function resourceScopes(resourceName) {
  const r = load().resources[resourceName];
  return r ? r.scopes.slice() : [];
}

function allTools() {
  return Object.keys(load().tools);
}

function scopeMeta(scope) {
  return load().scopes[scope] || null;
}

module.exports = {
  toolScopes,
  toolSurface,
  toolChallengeType,
  appGrantedScopes,
  resourceScopes,
  allTools,
  scopeMeta,
  _manifest: load,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest scopeTopology.regression -v`
Expected: PASS — all loader tests green.

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/services/scopeTopology.js banking_api_server/src/__tests__/scopeTopology.regression.test.js
git commit -m "feat(scopes): BFF scopeTopology loader with schema-validated accessors"
```

---

## Task 3: BFF MCP_TOOL_SCOPES derives from manifest

**Files:**
- Modify: `banking_api_server/services/mcpWebSocketClient.js:42-70`
- Test: `banking_api_server/src/__tests__/scopeTopology.regression.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append:

```javascript
describe('MCP_TOOL_SCOPES derives from manifest', () => {
  const { MCP_TOOL_SCOPES } = require('../../services/mcpWebSocketClient');
  const topo = require('../../services/scopeTopology');

  test('create_transfer now requests banking:transfer', () => {
    expect(MCP_TOOL_SCOPES.create_transfer).toEqual(['banking:write', 'banking:transfer']);
  });

  test('every manifest tool is present in MCP_TOOL_SCOPES with matching scopes', () => {
    for (const name of topo.allTools()) {
      expect(MCP_TOOL_SCOPES[name]).toEqual(topo.toolScopes(name));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest scopeTopology.regression -v`
Expected: FAIL — `MCP_TOOL_SCOPES.create_transfer` is `['banking:write']` (hardcoded), not `['banking:write','banking:transfer']`. **This is the transfer bug, caught by the test.**

- [ ] **Step 3: Replace the hardcoded map with a manifest-derived one**

In `banking_api_server/services/mcpWebSocketClient.js`, replace the entire `const MCP_TOOL_SCOPES = { ... };` block (lines 42-70, the object literal ending at the line before `function getMcpServerUrl()`) with:

```javascript
// MCP_TOOL_SCOPES is the BFF RFC 8693 exchange scope map. It now DERIVES from
// scope-topology.json (the SSOT) — do not hand-edit tool→scope here; edit the
// manifest. scopeTopology.regression.test.js fails if this drifts.
const scopeTopology = require('./scopeTopology');
const MCP_TOOL_SCOPES = Object.freeze(
  scopeTopology.allTools().reduce((acc, name) => {
    acc[name] = scopeTopology.toolScopes(name);
    return acc;
  }, {})
);
```

Keep the surrounding comment block above line 42 (the "security gap — keep names aligned" note) intact; only the object literal is replaced.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest scopeTopology.regression -v`
Expected: PASS.

- [ ] **Step 5: Run the broader BFF scope suites for regressions**

Run: `cd banking_api_server && npx jest scopePolicyEngine scopeEnforcement scope-integration --silent`
Expected: PASS (scopePolicyEngine consumes `MCP_TOOL_SCOPES`; shape is unchanged so these stay green). If any fail, the consumer relied on a tool key the manifest omits — add that tool to the manifest with the correct `surface` and re-run.

- [ ] **Step 6: Commit**

```bash
git add banking_api_server/services/mcpWebSocketClient.js banking_api_server/src/__tests__/scopeTopology.regression.test.js
git commit -m "fix(scopes): MCP_TOOL_SCOPES derives from manifest; create_transfer now requests banking:transfer"
```

---

## Task 4: Gateway TS loader + toolScopes.ts derives from manifest

**Files:**
- Create: `banking_mcp_gateway/src/auth/scopeTopology.ts`
- Modify: `banking_mcp_gateway/src/auth/toolScopes.ts`
- Test: `banking_mcp_gateway/tests/scopeTopology.test.ts`

- [ ] **Step 1: Write the failing test**

Create `banking_mcp_gateway/tests/scopeTopology.test.ts`:

```typescript
import { TOOL_SCOPES, getScopesForGatewayTool, getChallengeTypeForTool } from '../src/auth/toolScopes';

describe('gateway toolScopes derives from manifest', () => {
  test('create_transfer requires banking:write + banking:transfer', () => {
    expect(getScopesForGatewayTool('create_transfer')).toEqual(['banking:write', 'banking:transfer']);
  });

  test('unknown tool falls back to [banking:read]', () => {
    expect(getScopesForGatewayTool('no_such_tool')).toEqual(['banking:read']);
  });

  test('create_transfer challenge type is step_up', () => {
    expect(getChallengeTypeForTool('create_transfer')).toBe('step_up');
  });

  test('get_my_accounts challenge type is consent', () => {
    expect(getChallengeTypeForTool('get_my_accounts')).toBe('consent');
  });

  test('TOOL_SCOPES only contains gateway-surface tools', () => {
    expect(TOOL_SCOPES.create_transfer).toBeDefined();
    expect(TOOL_SCOPES.query_user_by_email).toBeUndefined(); // exchange-only
    expect(TOOL_SCOPES.transfer).toBeUndefined();             // legacy-alias
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_mcp_gateway && npx jest scopeTopology -v`
Expected: FAIL — the last assertion (`query_user_by_email`/`transfer` absent) passes by luck, but the suite fails to compile/import until the loader exists OR passes trivially against the current hardcoded map. Specifically expect the import of the not-yet-created behavior to still pass for `create_transfer` (already correct in gateway) — so this task's failing signal is the `TOOL_SCOPES only contains gateway-surface tools` invariant once derivation lands. Run anyway to capture the baseline (Expected: all PASS against current hardcoded map, since gateway already had create_transfer right — that is fine; this task proves the *derived* map preserves behavior).

- [ ] **Step 3: Create the gateway loader**

Create `banking_mcp_gateway/src/auth/scopeTopology.ts`:

```typescript
'use strict';

/**
 * scopeTopology.ts — gateway accessor for the repo-root scope-topology.json
 * SSOT. resolveJsonModule is enabled in tsconfig, so the manifest is imported
 * natively. Single source shared with the BFF (banking_api_server/services/
 * scopeTopology.js reads the same file).
 */

// Path: banking_mcp_gateway/src/auth -> repo root is ../../../../
import manifest from '../../../scope-topology.json';

type Surface = 'gateway' | 'exchange-only' | 'legacy-alias';
interface ToolEntry { requiredScopes: string[]; surface: Surface; challengeType?: 'step_up' | 'consent'; }
interface Manifest { tools: Record<string, ToolEntry>; }

const M = manifest as unknown as Manifest;

/** Tool names whose surface is gateway-enforced. */
export function gatewayToolNames(): string[] {
  return Object.keys(M.tools).filter((n) => M.tools[n].surface === 'gateway');
}

export function toolRequiredScopes(name: string): string[] | undefined {
  const t = M.tools[name];
  return t ? [...t.requiredScopes] : undefined;
}

export function toolChallengeType(name: string): 'step_up' | 'consent' | undefined {
  const t = M.tools[name];
  return t ? t.challengeType : undefined;
}
```

Confirm the relative import path: `banking_mcp_gateway/src/auth/scopeTopology.ts` → repo root is `../../../scope-topology.json` (auth → src → banking_mcp_gateway → repo root = three `../`). Adjust if the build reports the JSON not found.

- [ ] **Step 4: Rewrite toolScopes.ts to derive (public API unchanged)**

In `banking_mcp_gateway/src/auth/toolScopes.ts`, replace the `export const TOOL_SCOPES: Record<string, string[]> = { ... };` literal (lines 11-38) and the `const STEP_UP_TOOLS = new Set([...]);` (line ~82) with derivations. Keep `getScopesForGatewayTool`, `missingScopesForTool`, `evaluateScopeDecisionLocally`, `getChallengeTypeForTool` signatures byte-identical:

Replace the `TOOL_SCOPES` literal with:

```typescript
import { gatewayToolNames, toolRequiredScopes, toolChallengeType } from './scopeTopology';

/**
 * Canonical tool→scope map for the MCP gateway, DERIVED from
 * scope-topology.json (the SSOT). Do not hand-edit — edit the manifest.
 * Only gateway-surface tools appear here (exchange-only/legacy tools are
 * BFF-side concerns). scopeTopology.regression.test.js guards drift.
 */
export const TOOL_SCOPES: Record<string, string[]> = Object.freeze(
  gatewayToolNames().reduce<Record<string, string[]>>((acc, name) => {
    acc[name] = toolRequiredScopes(name) as string[];
    return acc;
  }, {}),
) as Record<string, string[]>;
```

Replace `const STEP_UP_TOOLS = new Set([...]);` with:

```typescript
const STEP_UP_TOOLS = new Set<string>(
  gatewayToolNames().filter((n) => toolChallengeType(n) === 'step_up'),
);
```

Leave the file's header comment, `getScopesForGatewayTool`, `missingScopesForTool`, `evaluateScopeDecisionLocally`, and `getChallengeTypeForTool` exactly as they are.

- [ ] **Step 5: Build the gateway (tsc must pass)**

Run: `cd banking_mcp_gateway && npm run build`
Expected: exit 0, `dist/index.js` produced. If JSON import errors, fix the relative path in Step 3 and rebuild.

- [ ] **Step 6: Run gateway tests**

Run: `cd banking_mcp_gateway && npx jest scopeTopology -v && npx jest --silent`
Expected: PASS — new suite green AND the full gateway suite (the 112 tests incl. HTTP↔WS scope-decision parity) stays green, because the public API is unchanged and `create_transfer` was already `['banking:write','banking:transfer']` in the gateway.

- [ ] **Step 7: Commit**

```bash
git add banking_mcp_gateway/src/auth/scopeTopology.ts banking_mcp_gateway/src/auth/toolScopes.ts banking_mcp_gateway/tests/scopeTopology.test.ts
git commit -m "refactor(gateway): TOOL_SCOPES + STEP_UP_TOOLS derive from scope-topology.json SSOT"
```

---

## Task 5: Provisioning — add banking:transfer (targeted, §1-safe)

**Files:**
- Modify: `banking_api_server/services/pingoneProvisionService.js` (the `scopes` array feeding `createScopes` at ~line 1284; the User App grant at ~line 1474)
- Test: `banking_api_server/src/__tests__/scopeTopology.regression.test.js` (extend)

**REGRESSION_PLAN §1 note:** `pingoneProvisionService.js` is a protected OAuth/scope-path file. This task does NOT rewrite its imperative flow — it adds `banking:transfer` to two existing literal arrays and asserts (via test) those arrays match the manifest. State before editing: "I will not change resource-server creation order, grant call signatures, WORKER-app skip logic, or any non-`banking:transfer` scope. Only two array literals gain one string each."

- [ ] **Step 1: Write the failing test (provisioning arrays match manifest)**

Append to `scopeTopology.regression.test.js`:

```javascript
describe('pingoneProvisionService scope arrays match manifest', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../services/pingoneProvisionService.js'),
    'utf8'
  );
  const topo = require('../../services/scopeTopology');

  test('main Super Banking API resource declares banking:transfer scope', () => {
    // The createScopes() input array for the main resource must list banking:transfer.
    expect(src).toMatch(/name:\s*'banking:transfer'/);
  });

  test('User App grant array contains every Super Banking User App manifest scope', () => {
    // Locate the userGrantResult grant array literal.
    const m = src.match(/userGrantResult\s*=\s*await this\.grantScopesToApplication\([\s\S]*?\[([\s\S]*?)\]/);
    expect(m).not.toBeNull();
    const granted = m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    for (const s of topo.appGrantedScopes('Super Banking User App')) {
      expect(granted).toContain(s);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest scopeTopology.regression -v`
Expected: FAIL — `banking:transfer` not in the resource scopes array, not in the User App grant.

- [ ] **Step 3: Add banking:transfer to the main resource scope array**

In `banking_api_server/services/pingoneProvisionService.js`, find the `const scopes = [` array that feeds `createScopes(resourceResult.resource.id, scopes)` (~line 1267, the block containing `{ name: 'banking:read', description: 'Read access to banking data' },` and `{ name: 'banking:write', description: 'Write access to banking operations' },`). Add immediately after the `banking:write` line:

```javascript
        { name: 'banking:transfer', description: 'Execute fund transfers (elevated scope; gateway-enforced for create_transfer)' },
```

- [ ] **Step 4: Add banking:transfer to the User App grant**

Find (~line 1474):

```javascript
        ['banking:ai:agent:read', 'banking:read', 'banking:write', 'banking:mortgage:read']
```

Replace with:

```javascript
        ['banking:ai:agent:read', 'banking:read', 'banking:write', 'banking:transfer', 'banking:mortgage:read']
```

(The Admin App grant at ~line 1384 uses `scopes.map(s => s.name)` — Step 3 makes Admin inherit `banking:transfer` automatically; no separate Admin edit.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd banking_api_server && npx jest scopeTopology.regression -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add banking_api_server/services/pingoneProvisionService.js banking_api_server/src/__tests__/scopeTopology.regression.test.js
git commit -m "fix(provision): provision banking:transfer scope + grant to User/Admin apps"
```

---

## Task 6: scopePolicyEngine + scopeAuditService derive from manifest

**Files:**
- Modify: `banking_api_server/services/scopePolicyEngine.js` (`SCOPE_TAXONOMY`, ~line 18+)
- Modify: `banking_api_server/services/scopeAuditService.js:7-13` (`SCOPE_REFERENCE_TABLE`)
- Test: `banking_api_server/src/__tests__/scopeTopology.regression.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append:

```javascript
describe('scopePolicyEngine + scopeAuditService derive from manifest', () => {
  const topo = require('../../services/scopeTopology');

  test('scopePolicyEngine SCOPE_TAXONOMY covers every manifest banking scope', () => {
    const engine = require('../../services/scopePolicyEngine');
    const all = engine.getAllScopes(); // existing exported fn
    const names = new Set(all.map(s => (typeof s === 'string' ? s : s.scope)));
    for (const scope of Object.keys(topo._manifest().scopes)) {
      expect(names.has(scope)).toBe(true);
    }
  });

  test('scopeAuditService SCOPE_REFERENCE_TABLE reflects manifest app grants', () => {
    const { SCOPE_REFERENCE_TABLE } = require('../../services/scopeAuditService');
    // Pinned display-name map: PingOne app display name -> manifest app key.
    expect(SCOPE_REFERENCE_TABLE['Super Banking User App'])
      .toEqual(expect.arrayContaining(['banking:transfer']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest scopeTopology.regression -v`
Expected: FAIL — `getAllScopes()` lacks `banking:transfer`; `SCOPE_REFERENCE_TABLE` has no `Super Banking User App` key (it has `Super Banking MCP Server` / `Super Banking Banking API` with stale lists).

- [ ] **Step 3: Make SCOPE_TAXONOMY derive scope identity from the manifest (ops as overlay)**

In `banking_api_server/services/scopePolicyEngine.js`, immediately after the existing `const { MCP_TOOL_SCOPES } = require('./mcpWebSocketClient');` line, add:

```javascript
const scopeTopology = require('./scopeTopology');

// Policy-engine-local metadata that is NOT topology (operations a scope maps to,
// whether it needs user context). Keyed by canonical manifest scope name. The
// scope SET is single-sourced from the manifest; only these behavioral overlays
// live here. scopeTopology.regression.test.js asserts every key below exists in
// the manifest (no orphans).
const SCOPE_OPS_OVERLAY = {
  'banking:read':          { operations: ['GET /accounts/*', 'GET /transactions/*', 'GET /balances/*'], requires_user_context: true },
  'banking:write':         { operations: ['POST /transactions', 'POST /transfers'], requires_user_context: true },
  'banking:transfer':      { operations: ['POST /transfers'], requires_user_context: true },
  'banking:accounts:read': { operations: ['GET /accounts/*', 'GET /balances/*'], requires_user_context: true },
  'banking:transactions:read': { operations: ['GET /transactions/*'], requires_user_context: true },
  'banking:mortgage:read': { operations: ['GET /mortgage'], requires_user_context: true },
  'banking:ai:agent:read': { operations: ['agent:invoke'], requires_user_context: true },
  'banking:mcp:invoke':    { operations: ['mcp:tools/call'], requires_user_context: true },
  'ai_agent':              { operations: ['agent:identity'], requires_user_context: false },
};

// SCOPE_TAXONOMY derives identity + risk from the manifest; ops from the overlay.
const SCOPE_TAXONOMY = Object.keys(scopeTopology._manifest().scopes).reduce((acc, name) => {
  const meta = scopeTopology.scopeMeta(name);
  const overlay = SCOPE_OPS_OVERLAY[name] || { operations: [], requires_user_context: true };
  acc[name] = {
    description: meta.description,
    risk_level: meta.riskLevel,
    category: 'banking',
    operations: overlay.operations,
    requires_user_context: overlay.requires_user_context,
  };
  return acc;
}, {});
```

Then **delete** the existing hardcoded `const SCOPE_TAXONOMY = { ... };` literal (the block starting `const SCOPE_TAXONOMY = {` near line 18 and ending at its closing `};`). All downstream functions (`getAllScopes`, `getScopeInformation`, `calculateRiskScore`, etc.) already read `SCOPE_TAXONOMY` by reference — no other change needed. Add the manifest-key assertion to the test:

```javascript
  test('SCOPE_OPS_OVERLAY has no keys absent from the manifest', () => {
    // Re-require to read the overlay indirectly via getScopeInformation.
    const engine = require('../../services/scopePolicyEngine');
    const manifestScopes = new Set(Object.keys(topo._manifest().scopes));
    // Every scope the engine knows must be a manifest scope (no orphan overlay).
    for (const s of engine.getAllScopes().map(x => (typeof x === 'string' ? x : x.scope))) {
      expect(manifestScopes.has(s)).toBe(true);
    }
  });
```

- [ ] **Step 4: Make SCOPE_REFERENCE_TABLE derive from manifest apps**

In `banking_api_server/services/scopeAuditService.js`, replace the literal (lines 6-13):

```javascript
// Flattened scope model: banking:read / banking:write replace granular scopes.
const SCOPE_REFERENCE_TABLE = {
  'Super Banking AI Agent': ['banking:agent:invoke'],
  'Super Banking MCP Server': ['banking:read', 'banking:write'],
  'Super Banking Agent Gateway': ['banking:agent:invoke'],
  'Super Banking Banking API': ['banking:read', 'banking:write'],
  'PingOne API': ['p1:read:user', 'p1:update:user'],
};
```

with:

```javascript
const scopeTopology = require('./scopeTopology');

// Pinned map: PingOne resource/app DISPLAY name (as audited via Management API)
// -> manifest app key. Display names that are not in the manifest's apps{}
// (worker/agent/PingOne-API resources outside this SSOT's correctness scope)
// keep their explicit lists. The manifest is authoritative for the apps it owns.
const AUDIT_DISPLAY_TO_MANIFEST_APP = {
  'Super Banking User App': 'Super Banking User App',
  'Super Banking Admin App': 'Super Banking Admin App',
};
const NON_MANIFEST_REFERENCE = {
  'Super Banking AI Agent': ['banking:agent:invoke'],
  'Super Banking Agent Gateway': ['banking:agent:invoke'],
  'PingOne API': ['p1:read:user', 'p1:update:user'],
};
const SCOPE_REFERENCE_TABLE = {
  ...NON_MANIFEST_REFERENCE,
  ...Object.fromEntries(
    Object.entries(AUDIT_DISPLAY_TO_MANIFEST_APP).map(([display, key]) => [
      display,
      scopeTopology.appGrantedScopes(key),
    ])
  ),
};
```

- [ ] **Step 5: Run tests**

Run: `cd banking_api_server && npx jest scopeTopology.regression scopePolicyEngine scopeAudit --silent`
Expected: PASS — derived sets match the manifest; existing `scopePolicyEngine`/`scopeAudit` suites stay green (their public APIs are untouched; only the backing data is now manifest-sourced). If `scopeAudit.test.js` asserts the old stale `'Super Banking MCP Server'` key, that assertion encoded the bug — update that test's expectation to the manifest-derived `Super Banking User App`/`Super Banking Admin App` keys and note it in the commit.

- [ ] **Step 6: Commit**

```bash
git add banking_api_server/services/scopePolicyEngine.js banking_api_server/services/scopeAuditService.js banking_api_server/src/__tests__/scopeTopology.regression.test.js
git commit -m "refactor(scopes): scopePolicyEngine + scopeAuditService derive scope sets from manifest"
```

---

## Task 7: The full cross-consumer regression assertion + negative proof

**Files:**
- Test: `banking_api_server/src/__tests__/scopeTopology.regression.test.js` (final assertions)

- [ ] **Step 1: Write the cross-consumer equality + negative test**

Append:

```javascript
describe('cross-consumer scope equality (the guard)', () => {
  const topo = require('../../services/scopeTopology');
  const { MCP_TOOL_SCOPES } = require('../../services/mcpWebSocketClient');

  test('every gateway-surface tool: BFF MCP_TOOL_SCOPES == manifest requiredScopes', () => {
    for (const name of topo.allTools()) {
      if (topo.toolSurface(name) === 'gateway') {
        expect(MCP_TOOL_SCOPES[name]).toEqual(topo.toolScopes(name));
      }
    }
  });

  test('NEGATIVE PROOF: reverting create_transfer to [banking:write] would fail this guard', () => {
    // Simulate the original bug: a consumer map missing banking:transfer.
    const buggy = { ...MCP_TOOL_SCOPES, create_transfer: ['banking:write'] };
    let caught = false;
    try {
      expect(buggy.create_transfer).toEqual(topo.toolScopes('create_transfer'));
    } catch (_) {
      caught = true;
    }
    expect(caught).toBe(true); // proves the guard catches exactly the transfer regression
  });

  test('manifest tool count is non-trivial (sanity: at least 20 tools)', () => {
    expect(topo.allTools().length).toBeGreaterThanOrEqual(20);
  });
});
```

- [ ] **Step 2: Run the full regression suite**

Run: `cd banking_api_server && npx jest scopeTopology.regression -v`
Expected: PASS — all describe blocks green, including the negative proof.

- [ ] **Step 3: Run the broader critical suites**

Run: `cd banking_api_server && npx jest scopeTopology scopePolicyEngine scopeEnforcement scope-integration configStore.envCoverage --silent`
Expected: PASS across all.

- [ ] **Step 4: Build the gateway**

Run: `cd banking_mcp_gateway && npm run build && npx jest --silent`
Expected: tsc exit 0; full gateway suite green.

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/src/__tests__/scopeTopology.regression.test.js
git commit -m "test(scopes): cross-consumer equality guard + negative proof of transfer-bug detection"
```

---

## Task 8: Generated docs + collapse .planning scope docs

**Files:**
- Create: `banking_api_server/scripts/generate-scope-doc.js`
- Create: `docs/scope-topology.md`
- Modify: `banking_api_server/package.json` (add `scopes:doc` script)
- Modify: `.planning/quick/2026-04-07-pingone-scopes-mapping.md`, `.planning/quick/2026-04-07-pingone-scopes-visual-reference.md`, `.planning/quick/2026-04-07-api-calls-and-token-exchange-scopes.md`, `.planning/quick/2026-04-07-code-verification-api-scopes.md`, `.planning/quick/pingone-update-scopes-manual.md`
- Test: `banking_api_server/src/__tests__/scopeTopology.regression.test.js` (doc-sync assertion)

- [ ] **Step 1: Write the doc-sync failing test**

Append:

```javascript
describe('generated scope doc is in sync', () => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');

  test('docs/scope-topology.md matches a fresh render of the manifest', () => {
    const ROOT = path.resolve(__dirname, '../../../');
    const docPath = path.join(ROOT, 'docs/scope-topology.md');
    const rendered = execSync('node banking_api_server/scripts/generate-scope-doc.js --stdout', {
      cwd: ROOT,
    }).toString();
    const onDisk = fs.readFileSync(docPath, 'utf8');
    expect(onDisk).toBe(rendered);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest scopeTopology.regression -t "generated scope doc" -v`
Expected: FAIL — script and doc do not exist.

- [ ] **Step 3: Create the generator**

Create `banking_api_server/scripts/generate-scope-doc.js`:

```javascript
'use strict';

/**
 * generate-scope-doc.js — renders scope-topology.json to docs/scope-topology.md.
 * Never hand-edit docs/scope-topology.md; run `npm run scopes:doc`.
 * --stdout prints without writing (used by the sync regression test).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'scope-topology.json'), 'utf8'));

function render() {
  const lines = [];
  lines.push('# Scope Topology (generated — do not edit by hand)');
  lines.push('');
  lines.push('> Source of truth: `scope-topology.json`. Regenerate with `npm run scopes:doc`.');
  lines.push('');
  lines.push('## Scopes');
  lines.push('');
  lines.push('| Scope | Risk | Resource | Description |');
  lines.push('|---|---|---|---|');
  for (const [name, s] of Object.entries(m.scopes)) {
    lines.push(`| \`${name}\` | ${s.riskLevel} | ${s.resource} | ${s.description} |`);
  }
  lines.push('');
  lines.push('## Resources');
  lines.push('');
  for (const [name, r] of Object.entries(m.resources)) {
    lines.push(`### ${name}`);
    lines.push('');
    lines.push(r.scopes.map(s => `\`${s}\``).join(', '));
    lines.push('');
  }
  lines.push('## App Grants');
  lines.push('');
  for (const [name, a] of Object.entries(m.apps)) {
    lines.push(`### ${name}`);
    lines.push('');
    lines.push(a.grantedScopes.map(s => `\`${s}\``).join(', '));
    lines.push('');
  }
  lines.push('## Tool → Scope Dependencies');
  lines.push('');
  lines.push('| Tool | Surface | Required Scopes | Challenge |');
  lines.push('|---|---|---|---|');
  for (const [name, t] of Object.entries(m.tools)) {
    lines.push(`| \`${name}\` | ${t.surface} | ${t.requiredScopes.map(s => `\`${s}\``).join(' ')} | ${t.challengeType || '—'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

const out = render();
if (process.argv.includes('--stdout')) {
  process.stdout.write(out);
} else {
  fs.writeFileSync(path.join(ROOT, 'docs/scope-topology.md'), out);
  console.log('Wrote docs/scope-topology.md');
}
```

- [ ] **Step 4: Add the npm script and generate the doc**

In `banking_api_server/package.json` `"scripts"`, add after `"pingone:bootstrap:ci"`:

```json
    "scopes:doc": "node scripts/generate-scope-doc.js",
```

Run: `cd /Users/curtismuir/Development/banking && node banking_api_server/scripts/generate-scope-doc.js`
Expected: writes `docs/scope-topology.md`.

- [ ] **Step 5: Collapse the .planning scope docs to stubs**

Replace the **entire body** of each of these 5 files with a single stub (keep only an H1 + the pointer):

`.planning/quick/2026-04-07-pingone-scopes-mapping.md`,
`.planning/quick/2026-04-07-pingone-scopes-visual-reference.md`,
`.planning/quick/2026-04-07-api-calls-and-token-exchange-scopes.md`,
`.planning/quick/2026-04-07-code-verification-api-scopes.md`,
`.planning/quick/pingone-update-scopes-manual.md`

Each becomes:

```markdown
# Superseded — see the scope topology SSOT

This document is no longer maintained. The authoritative scope topology
(scopes, resources, app grants, tool dependencies) now lives in
`scope-topology.json` at the repo root, with a generated human-readable
reference at [`docs/scope-topology.md`](../../docs/scope-topology.md).
```

- [ ] **Step 6: Run the doc-sync test**

Run: `cd banking_api_server && npx jest scopeTopology.regression -t "generated scope doc" -v`
Expected: PASS — on-disk doc equals fresh render.

- [ ] **Step 7: Commit**

```bash
git add banking_api_server/scripts/generate-scope-doc.js docs/scope-topology.md banking_api_server/package.json .planning/quick/2026-04-07-pingone-scopes-mapping.md .planning/quick/2026-04-07-pingone-scopes-visual-reference.md .planning/quick/2026-04-07-api-calls-and-token-exchange-scopes.md .planning/quick/2026-04-07-code-verification-api-scopes.md .planning/quick/pingone-update-scopes-manual.md banking_api_server/src/__tests__/scopeTopology.regression.test.js
git commit -m "docs(scopes): generated docs/scope-topology.md + collapse drifted .planning scope docs to stubs"
```

---

## Task 9: Live PingOne audit mode in verify-scope-configuration.js

**Files:**
- Modify: `banking_api_server/scripts/verify-scope-configuration.js`

- [ ] **Step 1: Read the existing script structure**

Run: `cd banking_api_server && grep -n "async function main\|process.argv\|--fix\|requiredScopes\|getManagementToken\|module.exports" scripts/verify-scope-configuration.js | head -20`
Expected: identifies `main()`, the `--fix` arg handling, and the management-token helper to reuse.

- [ ] **Step 2: Add a --manifest-diff branch**

In `banking_api_server/scripts/verify-scope-configuration.js`, add near the top (after the existing requires):

```javascript
const scopeTopology = require('../services/scopeTopology');
```

Add a function and wire it into `main()` so that when `process.argv.includes('--manifest-diff')` the script: (a) fetches the live resource servers + their scopes and the app grants via the existing PingOne Management API helpers already in the file, (b) for each resource in `scopeTopology._manifest().resources`, asserts every manifest scope exists on the live resource, (c) for each app in `scopeTopology._manifest().apps`, asserts every `grantedScopes` entry is attached live, (d) prints a red ✖ line per missing item and exits non-zero if any are missing, green ✅ otherwise. Reuse the file's existing `getManagementToken`/HTTP helpers and `COLORS` — do not introduce a new HTTP client.

```javascript
async function manifestDiff(token) {
  const m = scopeTopology._manifest();
  let problems = 0;
  // Pseudocode shape — adapt to the file's existing resource/app fetch helpers:
  const liveResources = await listResourcesWithScopes(token);   // existing helper
  const liveAppGrants = await listAppResourceGrants(token);      // existing helper
  for (const [resName, res] of Object.entries(m.resources)) {
    const live = liveResources[resName];
    if (!live) { log(`${COLORS.RED}✖ resource missing live: ${resName}${COLORS.RESET}`); problems++; continue; }
    for (const s of res.scopes) {
      if (!live.scopes.includes(s)) { log(`${COLORS.RED}✖ ${resName} missing scope ${s}${COLORS.RESET}`); problems++; }
    }
  }
  for (const [appName, app] of Object.entries(m.apps)) {
    const grants = liveAppGrants[appName] || [];
    for (const s of app.grantedScopes) {
      if (!grants.includes(s)) { log(`${COLORS.RED}✖ ${appName} not granted ${s}${COLORS.RESET}`); problems++; }
    }
  }
  if (problems === 0) log(`${COLORS.GREEN}✅ live PingOne matches scope-topology.json${COLORS.RESET}`);
  return problems;
}
```

Wire into `main()`: if `--manifest-diff`, call `const n = await manifestDiff(token); process.exit(n === 0 ? 0 : 1);`. If the file lacks `listResourcesWithScopes`/`listAppResourceGrants` helpers, implement them inline using the same `https` request pattern the file already uses for its existing `--fix` path (read that pattern from Step 1 and mirror it; do not add `axios`).

- [ ] **Step 3: Smoke-run (no creds required to prove the branch wiring)**

Run: `cd banking_api_server && node scripts/verify-scope-configuration.js --manifest-diff`
Expected: either the credential-missing error (if no mgmt creds in `.env`) OR a diff report. It must NOT crash with an unhandled exception; missing creds must exit non-zero with the existing credential message.

- [ ] **Step 4: Commit**

```bash
git add banking_api_server/scripts/verify-scope-configuration.js
git commit -m "feat(scopes): verify-scope-configuration --manifest-diff audits live PingOne vs SSOT"
```

---

## Task 10: REGRESSION_PLAN entry + final verification + apply path

**Files:**
- Modify: `REGRESSION_PLAN.md` (§4 Bug Fix Log + §1 protected table rows)

- [ ] **Step 1: Add the §4 Bug Fix Log entry**

In `REGRESSION_PLAN.md` §4, add a new entry per the existing template (read the latest entry's format first via `grep -n "^### " REGRESSION_PLAN.md | tail -3` and match it). Content: symptom (`create_transfer` 403 `insufficient_scope: missing banking:transfer`), root cause (no scope-topology SSOT; gateway enforced `banking:transfer` while BFF exchange map + provisioning never minted/granted it), fix (scope-topology.json SSOT; consumers derive; provisioning grants it; CI regression guard + live audit), prevention (the guard fails CI on any future tool/scope drift, proven by the negative test).

- [ ] **Step 2: Add §1 protected-table rows**

In `REGRESSION_PLAN.md` §1, add two rows matching the table's column format: `scope-topology.json` (the scope SSOT — any change requires re-running provisioning + the regression guard) and `banking_api_server/src/__tests__/scopeTopology.regression.test.js` (the CI-blocking scope-drift guard — must stay green; a skip/delete is a release blocker).

- [ ] **Step 3: Full verification sweep**

Run:
```bash
cd /Users/curtismuir/Development/banking
( cd banking_api_server && npx jest scopeTopology scopePolicyEngine scopeEnforcement scope-integration configStore.envCoverage --silent )
( cd banking_mcp_gateway && npm run build && npx jest --silent )
( cd banking_api_ui && npm run build )
```
Expected: BFF scope suites PASS; gateway tsc exit 0 + suite PASS; UI build exit 0 (UI untouched but the project rule requires the gate after any change set — confirm 0).

- [ ] **Step 4: Commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(regression): §4 Bug Fix Log + §1 rows for scope-topology SSOT + guard"
```

- [ ] **Step 5: Apply path (manual, documented — not automated by this plan)**

After merge, to fix the **running demo**:
```bash
cd banking_api_server && npm run pingone:bootstrap   # idempotent; provisions banking:transfer + grants
node scripts/verify-scope-configuration.js --manifest-diff   # confirm live env matches SSOT
```
Then in the browser: **log out and log back in** as the demo user (existing tokens predate the grant and will not carry `banking:transfer`). Verify: agent "transfer $X" → Token Chain shows `banking:transfer` in the exchanged token scope → gateway PERMIT → transfer succeeds. Confirm deposit/withdrawal still succeed (regression check — they require only `banking:write`).

---

## Self-Review

**Spec coverage:**
- §3.1 manifest + schema → Task 1 ✓
- §3.2 banking:transfer fix through manifest → Tasks 3 (BFF), 4 (gateway), 5 (provision) ✓
- §3.3 consumer migration (provision, BFF map, gateway, scopePolicyEngine, scopeAuditService) → Tasks 3,4,5,6 ✓ (provisioning is targeted-add + assertion, not derive-rewrite — explicitly documented as a refinement in Architecture + Task 5 note)
- §3.3 overlay decision (ops/display-name local, manifest-keyed) → Task 6 ✓
- §3.4 generated doc + .planning stubs → Task 8 ✓
- §3.5 Layer 1 static CI-blocking guard (8 assertions + negative proof) → Tasks 1,2,3,5,6,7,8 (assertions distributed; equality+negative in 7; doc-sync in 8) ✓
- §3.5 Layer 2 live audit → Task 9 ✓
- §7 REGRESSION discipline (§1 statement, §4 entry, §1 rows, verify-against-live-docs) → Task 5 note + Task 10 ✓
- §8 success criteria → Task 10 Step 3 sweep + Step 5 apply path ✓

**Placeholder scan:** Task 9 Step 2 uses pseudocode intentionally (the existing script's HTTP helper names are unknown until Step 1 reads them); the step explicitly instructs mirroring the file's existing `https` pattern and names the exact behavior — this is a guided adaptation, not a "TODO". All other steps contain concrete code/commands. No "TBD"/"add error handling"/"similar to Task N".

**Type consistency:** Loader accessor names are consistent across JS (`toolScopes`, `toolSurface`, `toolChallengeType`, `appGrantedScopes`, `resourceScopes`, `allTools`, `scopeMeta`, `_manifest`) and TS (`gatewayToolNames`, `toolRequiredScopes`, `toolChallengeType`). `surface` field values (`gateway`/`exchange-only`/`legacy-alias`) match between schema, manifest, loaders, and the reconciliation policy. `MCP_TOOL_SCOPES` stays `Record<string,string[]>`; `TOOL_SCOPES` stays `Record<string,string[]>` — public APIs unchanged.

**Gap found + fixed:** Task 1 Step 4 originally left the admin-scope filter ambiguous; added the explicit filter-change instruction (`s.startsWith('banking:') || s === 'ai_agent'`) so the "every scope declared" test does not falsely fail on exchange-only admin scopes.
