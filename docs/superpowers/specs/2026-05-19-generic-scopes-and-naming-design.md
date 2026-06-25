# Generic Scopes, App Names, and Run-Script Naming

**Date:** 2026-05-19  
**Approach:** Option B — SSOT-first, then propagate  
**Status:** Approved for implementation planning

---

## Problem

The platform now supports multiple verticals (banking, retail, workforce) but all scope strings, PingOne app names, resource server URIs, and startup script labels still carry the `banking:` prefix or `Super Banking` branding. This creates friction when demoing non-banking verticals and makes the platform look banking-specific to audiences who are evaluating it for retail or workforce use cases.

---

## Scope Renames

`scope-topology.json` is the SSOT. All scope string changes flow from it.

### Action scopes

| Old | New |
|-----|-----|
| `banking:read` | `read` |
| `banking:write` | `write` |
| `banking:transfer` | `transfer` |
| `banking:accounts:read` | `accounts:read` |
| `banking:transactions:read` | `transactions:read` |
| `banking:ai:agent:read` | `ai:agent:read` |

### Infrastructure scopes

| Old | New |
|-----|-----|
| `banking:mcp:invoke` | `mcp:invoke` |
| `banking:agent:invoke` | `agent:invoke` |

### Unchanged scopes

- `admin:read`, `admin:write`, `admin:delete` — already generic
- `users:read`, `users:manage` — already generic
- `ai_agent` — OIDC identity marker, not a domain scope

### Vertical-driven feature scope (replaces `banking:mortgage:read`)

Each vertical config gains a `featureScope` key in its `scopes` block. The provisioner reads this at bootstrap time and provisions the scope on the resource server.

| Vertical | `featureScope` value |
|----------|---------------------|
| banking | `mortgage:read` |
| retail | `largepurchase:read` |
| workforce | `expense:read` |

The `show_mortgage` MCP tool continues to require `mortgage:read` — it is banking-vertical-only. The `featureScope` key is what gets provisioned in PingOne; whether a tool uses it is a separate concern.

**Updated vertical `scopes` block shape:**

```json
"scopes": {
  "read": "read",
  "write": "write",
  "transfer": "transfer",
  "featureScope": "mortgage:read"
}
```

---

## PingOne App & Resource Names

### `scope-topology.json` — new `provisioning` block

Internal JS object keys (`"Super Banking API"` etc.) in `resources`, `apps`, `servers` are **unchanged** — they are map keys in code, invisible to PingOne. Only the display names provisioned into PingOne change.

A new top-level `provisioning` block holds the generic display names:

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
}
```

`bootstrapPingOne.js` and `pingoneProvisionService.js` read display names from this block. The `--recreate-apps` matcher switches from the hardcoded `"Super Banking *"` list to matching against `provisioning.appNames` values.

---

## Cleanup Script

**New file:** `banking_api_server/scripts/cleanupPingOneApps.js`  
**New npm script:** `npm run pingone:cleanup` (in `banking_api_server/package.json`)

### Behavior

- Reads the canonical `"Super Banking *"` app names and resource server names from the hardcoded list (same list currently in `bootstrapPingOne.js`)
- Calls PingOne Management API: deletes apps first (they reference resource servers), then resource servers
- Uses `PINGONE_WORKER_CLIENT_ID` / `PINGONE_WORKER_CLIENT_SECRET` from `.env` — same auth pattern as the provisioner
- **Dry-run by default** — prints what would be deleted; requires `--execute` flag to actually delete
- Full clean slate: deletes both apps and resource servers so bootstrap re-creates everything from `scope-topology.json`

### Credential rotation flow (post-cleanup)

After running the cleanup script, all PingOne client IDs and secrets change. The required sequence:

1. `npm run pingone:cleanup -- --execute` — wipes all `Super Banking *` apps and resource servers
2. `npm run pingone:bootstrap` — creates new `Demo *` apps, writes new credentials to `banking_api_server/.env`
3. Rebuild vault: export `VAULT_PASSWORD`, run vault sync command
4. `./run-demo.sh` — restart all services

The bootstrap already overwrites `.env` completely with new client IDs/secrets. No manual `.env` editing required. The only manual step is vault re-sync.

---

## Resource URIs (Audience Strings)

| Old URI | New URI |
|---------|---------|
| `banking_api_enduser` | `api.ping.demo` |
| `mcp-server.ping.demo` | unchanged |
| `api.ping.demo` | unchanged |
| `agent-gateway.ping.demo` | unchanged |

**Propagation of `api.ping.demo`:**

- `scope-topology.json` `servers.banking_api_server.validatesAudience`
- `banking_api_server/middleware/auth.js` — JWT `aud` validation default
- `banking_api_server/services/configStore.js` — default audience config
- `bootstrapPingOne.js` — `PINGONE_BOOTSTRAP_AUDIENCE` default
- `.env` — `PINGONE_RESOURCE_SERVER_URI` (or equivalent key) default value

Existing `.env` files with `banking_api_enduser` continue to work until re-provisioned. After cleanup + bootstrap, PingOne issues tokens with `aud: api.ping.demo`.

---

## `run-demo.sh` Genericization

### Log/PID file renames

| Old | New |
|-----|-----|
| `/tmp/bank-api-server.log` | `/tmp/demo-api.log` |
| `/tmp/bank-api-server.pid` | `/tmp/demo-api.pid` |
| `/tmp/bank-mcp-server.log` | `/tmp/demo-mcp.log` |
| `/tmp/bank-mcp-server.pid` | `/tmp/demo-mcp.pid` |
| `/tmp/bank-mcp-gateway.log` | `/tmp/demo-mcp-gateway.log` |
| `/tmp/bank-mcp-gateway.pid` | `/tmp/demo-mcp-gateway.pid` |
| `/tmp/bank-agent-service.log` | `/tmp/demo-agent.log` |
| `/tmp/bank-agent-service.pid` | `/tmp/demo-agent.pid` |
| `/tmp/bank-hitl-service.log` | `/tmp/demo-hitl.log` |
| `/tmp/bank-hitl-service.pid` | `/tmp/demo-hitl.pid` |
| `/tmp/bank-mcp-invest.log` | `/tmp/demo-invest.log` |
| `/tmp/bank-mcp-invest.pid` | `/tmp/demo-invest.pid` |
| `/tmp/bank-mortgage-service.log` | `/tmp/demo-mortgage.log` |
| `/tmp/bank-mortgage-service.pid` | `/tmp/demo-mortgage.pid` |
| `/tmp/bank-langchain-agent.log` | `/tmp/demo-langchain.log` |
| `/tmp/bank-langchain-agent.pid` | `/tmp/demo-langchain.pid` |
| `/tmp/bank-mcp-traffic.log` | `/tmp/demo-mcp-traffic.log` |
| `/tmp/bank-authorize-server.log` | `/tmp/demo-authorize.log` |
| `/tmp/bank-helix.log` | `/tmp/demo-helix.log` |
| `/tmp/bank-ollama.log` | `/tmp/demo-ollama.log` |
| `/tmp/bank-ollama.pid` | `/tmp/demo-ollama.pid` |
| `/tmp/bank-ui.log` | `/tmp/demo-ui.log` |
| `/tmp/bank-ui.pid` | `/tmp/demo-ui.pid` |

### Console output / banner changes

- Banner: `SUPER BANK — TEST SUITE` → `DEMO — TEST SUITE`
- Stop message: `Stopping Banking services` → `Stopping Demo services`
- Stop message: `All Banking listeners stopped` → `All Demo listeners stopped`
- `tail_bank_logs` function → `tail_demo_logs`
- Directory references (`banking_api_server/`, etc.) stay as-is — real filesystem paths, not display labels

---

## Code Consumer Propagation

### `banking_api_server/config/scopes.js`

Constant value updates:
- `BANKING_SCOPES.BANKING_READ` → `'read'`
- `BANKING_SCOPES.BANKING_WRITE` → `'write'`
- `BANKING_SCOPES.BANKING_TRANSFER` → `'transfer'`
- `BANKING_SCOPES.AI_AGENT` → `'ai:agent:read'`
- `COMPOUND_SCOPES.ACCOUNTS_READ` → `'accounts:read'`
- `COMPOUND_SCOPES.TRANSACTIONS_READ` → `'transactions:read'`
- `COMPOUND_SCOPES.MORTGAGE_READ` — removed; replaced by vertical `featureScope` lookup
- New constants: `MCP_INVOKE: 'mcp:invoke'`, `AGENT_INVOKE: 'agent:invoke'`

### `banking_api_server/services/agentMcpTokenService.js`

Hardcoded string replacements:
- `'banking:read'` → `'read'`
- `'banking:write'` → `'write'`
- `'banking:mcp:invoke'` → `'mcp:invoke'`
- `'banking:ai:agent:read'` → `'ai:agent:read'`
- `'banking:agent:invoke'` → `'agent:invoke'`

**`startsWith('banking:')` heuristic fix:** The `ff_inject_scopes` fallback uses `existingScopes.some(s => s.startsWith('banking:'))` to detect whether the user token has any banking scopes. After rename this heuristic breaks. Replacement: check for presence of `'read'` or `'write'` in the scope set — same intent, vertical-neutral.

### `banking_mcp_gateway` and `banking_mcp_server`

Both derive scope maps from topology at build time via `scopeTopology.ts`. No string changes needed — recompile after topology update.

### Tests

Files with hardcoded `banking:*` scope strings that need updating:
- `banking_api_server/tests/ccTokenScope.regression.test.js`
- `banking_api_server/tests/mcpGatewayConfig.test.js`
- `banking_api_server/tests/tokenUtils.test.js`
- `banking_api_server/tests/routes/langchainChatProxy.regression.test.js`
- Any test file returned by: `grep -rl "banking:read\|banking:write\|banking:mcp\|banking:agent" banking_api_server/tests banking_mcp_server/src`

### Documentation

- `CLAUDE.md` quick verification checklist: `/tmp/bank-api-server.log` → `/tmp/demo-api.log`
- `REGRESSION_PLAN.md`: add §4 migration entry; update §1 audience string reference from `banking_api_enduser` to `api.ping.demo`

---

## Execution Order

1. Update `scope-topology.json` — new scope strings, `provisioning` block, `api.ping.demo` URI, vertical `featureScope` in `resources`
2. Update vertical configs — `banking.json`, `retail.json`, `workforce.json` `scopes` blocks
3. Update `banking_api_server/config/scopes.js` — constant values
4. Update BFF services — `agentMcpTokenService.js` and other hardcoded `banking:` references
5. Update provisioner — `pingoneProvisionService.js`, `bootstrapPingOne.js` (display names from topology, new audience default)
6. Create cleanup script — `scripts/cleanupPingOneApps.js`, add `pingone:cleanup` npm script
7. Recompile TypeScript services — `banking_mcp_gateway`, `banking_mcp_server`, `banking_agent_service`
8. Update tests — replace hardcoded `banking:*` strings
9. Update `run-demo.sh` — log/pid renames, banner/heading text, `tail_demo_logs`
10. Update docs — `CLAUDE.md`, `REGRESSION_PLAN.md`
11. Run cleanup script + re-bootstrap PingOne + rebuild vault

---

## Success Criteria

- `cd banking_api_ui && npm run build` exits 0
- `cd banking_mcp_gateway && npm run build` exits 0
- `cd banking_mcp_server && npm run build` exits 0
- `npx jest ccTokenScope.regression mcpGatewayConfig tokenUtils` all pass
- `npm run pingone:cleanup -- --execute` deletes all `Super Banking *` apps and resource servers without error
- `npm run pingone:bootstrap` creates all `Demo *` apps and resources, writes new `.env`
- Banking vertical: login → `/dashboard` → agent tool call → Token Chain shows `read` and `mcp:invoke` scopes (not `banking:read`, `banking:mcp:invoke`)
- Log files appear at `/tmp/demo-api.log`, `/tmp/demo-mcp.log` etc. after `./run-demo.sh`
- No `banking:` scope strings appear in PingOne token claims after re-provisioning
