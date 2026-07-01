---
name: authz-server
description: PingOne Authorization Server — architecture, API, configuration, and how the MCP Gateway delegates all auth decisions to it
---

# PingOne Authorization Server

## Architecture

Three servers handle every MCP tool call:

```
BFF (3001) ──RFC 8693──► MCP Gateway (3005) ──decision──► Authorization Server (9001)
                                   │                              ↑ introspection → PingOne AS
                                   │ PERMIT
                                   ▼
                             MCP Server (8080 / 8081)
```

| Server | Port | Responsibility |
|--------|------|----------------|
| `demo_authz_server` | 9001 | **ALL authorization**: token introspection, `act` claim, scopes, HITL |
| `demo_mcp_gateway`  | 3005 | **Routing only**: calls authz server, proxies to correct MCP server |
| `demo_mcp_server`   | 8080 / 8081 *(verify)* | **Tool execution**: handles tools/list and tools/call |

The gateway **delegates to the Authorization Server when P1AZ is active** (`MCP_GW_P1AZ_ENABLED=true`). It retains one inline fallback: when P1AZ is disabled, `tools/call` decisions are made locally via `evaluateScopeDecisionLocally(toolName, decoded.scope)` (a mock-engine local scope check — `PingOneAuthorizeClient.ts:191-206`). All other decisions still come from the Authorization Server when it is active.

---

## Authorization Server API

Implements the PingOne Authorize API so that swapping to real PingOne only requires changing `PINGAUTHORIZE_ENDPOINT` on the gateway — no code changes.

### Health check
```
GET /health
→ { status: 'ok', service: 'pingone-authz-server-mock', port: 9001 }
```

### RFC 7662 Token Introspection
```
POST /as/introspect
Content-Type: application/x-www-form-urlencoded

token=<access_token>&token_type_hint=access_token
```

**Behavior:**
- If `PINGONE_INTROSPECTION_ENDPOINT` is set → forwards to real PingOne, returns PingOne's response
- Otherwise → local JWT decode, checks `exp`, returns `{ active, sub, scope, act, may_act, ... }`

### PingOne Authorize Decision
```
POST /governance/pap/alpha/policy/:workerId/decision
Content-Type: application/json

{
  "parameters": {
    "DecisionContext": "McpToolCall" | "McpRequest" | "McpToolsList",
    "McpMethod":       "tools/call" | "tools/list",
    "ToolName":        "get_my_accounts",
    "ClientId":        "user-sub",
    "ActClientId":     "act.sub from token",
    "TokenScopes":     "read write",
    "TokenAudience":   "mcpgateway.ping.demo",
    "TransactionAmount": "500",
    "HitlApproved":    "true" | ""
  }
}
```

**Response:**
```json
{ "decision": "PERMIT" | "DENY" | "INDETERMINATE",
  "reason": "...",
  "decision_id": "<uuid>",
  "policy_version": "mock-v1" }
```

### Additional endpoints

Beyond `/health`, `/as/introspect`, and the decision endpoint, the server also exposes:
- `POST /as/token` — token endpoint
- `GET /rules`, `PUT /rules`, `POST /rules` — read/update the runtime rule overlay (`ruleStore.js`)
- `POST /admin/import-snapshot`, `GET /admin/current-snapshot` — rule-store snapshot import/export

---

## Authorization Rules (in order)

> The rule set below is the core sequence in `demo_authz_server/routes/decision.js`. The full set is **larger and feature-flag-gated** — several rules only fire when their flag is enabled. Treat `decision.js` as the source of truth; the numbering here follows its rule labels.

1. **tools/list** (`DecisionContext === 'McpToolsList'`) → **PERMIT by default, but gateable**. Subject to the admin discovery toggle (`ruleStore.getToolDiscoveryDecision() === 'DENY'` → DENY), user existence/enabled/status checks, and **per-tool candidate evaluation** via `CandidateTools` (`decision.js:231-253`).

2. **act claim** — if `ActClientId` is present AND `PINGONE_MCP_EXCHANGER_CLIENT_ID` is configured:
   - `ActClientId` must equal the configured authorized actor (MCP exchanger)
   - Mismatch → DENY (`act.sub "X" is not the authorized actor`)

2.5. **require-act** (`REQUIRE_ACT_FOR_AGENT_TOOLS`) — agent tools may be required to carry an `act` claim.

3. **scope check** — reads required scopes from `ruleStore.requiredScopesForTool()` (a **runtime-editable overlay**, not `scopeTopology.js` directly — `scopeTopology.js` is only used to derive the gateway audience):
   - Missing required scopes → DENY (`insufficient_scope: missing read`)
   - **Bypass:** banking scopes are skipped when `pinggateway:invoke` is present in the token scopes (`decision.js:413`).

3b. **deny-ceiling** — `TransactionAmount ≥ SIMULATED_AUTHORIZE_DENY_AMOUNT` (default `2000`) → DENY.

3c. **RAR** (`FF_RAR`) — Rich Authorization Requests / `RarAuthorizationDetails` evaluation.

3d. **entitlement-tier** (`FF_AUTHORIZE_GROUP_POLICY`) — group/tier-based entitlement checks.

3.5a. **resource-owner** — resource-ownership check.

3.5b. **group-membership** — group-membership check.

4. **HITL (amount-driven, two-tier)** — `decision.js:545-587`. Driven by `TransactionAmount`:
   - `amount ≥ SIMULATED_AUTHORIZE_STEPUP_AMOUNT` (default `500`) → INDETERMINATE, reason **`STEP_UP`**. A step-up is **not** discharged by `HitlApproved` — it requires a re-authentication / step-up flow.
   - `amount ≥ SIMULATED_AUTHORIZE_CONFIRM_AMOUNT` (default `250`, below the step-up threshold) → INDETERMINATE, reason **`HITL_CONSENT`**. Discharged when `HitlApproved === 'true'`.
   - (Reason strings are `STEP_UP` / `HITL_CONSENT`, not `HITL_REQUIRED`.)

4b. **intent-token** — intent-token validation (`intentValid`, tool/JTI match, confidence).

---

## Gateway Configuration

The gateway calls the Authorization Server via these env vars (in `demo_mcp_gateway/.env`):

```bash
PINGAUTHORIZE_ENDPOINT=http://localhost:9001      # Authorization Server URL
PINGAUTHORIZE_WORKER_ID=mcp-gateway-policy        # Policy ID (any string for mock)
MCP_GW_P1AZ_ENABLED=true                          # REQUIRED — enables authz server calls
```

When `MCP_GW_P1AZ_ENABLED` is false or `PINGAUTHORIZE_ENDPOINT` is not set, the gateway **fails closed (DENY all) for `tools/list` and other methods**. The one exception is `tools/call`, which falls back to a local scope decision via `evaluateScopeDecisionLocally()` (`PingOneAuthorizeClient.ts:201-206`).

---

## Authorization Server Configuration (`demo_authz_server/.env`)

```bash
AUTHZ_PORT=9001

# Upstream PingOne for introspection (optional — omit for local JWT decode)
PINGONE_INTROSPECTION_ENDPOINT=https://auth.pingone.com/<envId>/as/introspect
# GW_INTROSPECTION_CLIENT_ID MUST be the MCP Exchanger app — the client that ISSUED the
# gateway-audience exchanged token (aud: mcpgateway.ping.demo). PingOne only returns
# active:true for the issuing client or a client in the token's aud. The management Worker
# is NOT valid here — it gets active:false for another client's tokens, which propagates
# as "token inactive" → session expiry → reauth loop.
GW_INTROSPECTION_CLIENT_ID=<mcp-exchanger-client-id>
GW_INTROSPECTION_CLIENT_SECRET=<mcp-exchanger-client-secret>
PINGONE_INTROSPECTION_AUTH_METHOD=post  # non-Worker apps (including MCP Exchanger) use client_secret_post

# act claim: which client is authorized to appear in act.sub
PINGONE_MCP_EXCHANGER_CLIENT_ID=<exchanger-client-id>

# HITL threshold
CONFIRM_THRESHOLD_USD=250
```

---

## Switching to Real PingOne Authorize

When PingOne Authorize is fully configured:

1. In `demo_mcp_gateway/.env`:
   ```bash
   PINGAUTHORIZE_ENDPOINT=https://authorize.pingone.com/<envId>
   PINGAUTHORIZE_WORKER_ID=<real-worker-id>
   MCP_GW_P1AZ_ENABLED=true
   ```
2. Stop `demo_authz_server` (or leave it running — gateway won't call it)
3. The gateway code is unchanged — it already uses the PingOne Authorize API format

---

## Logs

```bash
tail -f /tmp/demo-authorize.log    # Authorization Server decisions + introspection
tail -f /tmp/demo-mcp-gateway.log  # Gateway routing + auth calls
```

Decision log format (illustrative — the current line in `decision.js:153` also carries `sub=`, `mayActSub=`, `enforceMayAct=`, `aud=`, `exp=`, `intentValid=`, `rar=`, and there is **no** separate `PERMIT — tool=…` line):
```
[AuthzServer/decision] policy=mcp-gateway-policy ctx=McpToolCall tool=get_my_accounts actor=d3f8fead sub=... mayActSub=... enforceMayAct=... scopes=[read] aud=... exp=... intentValid=... rar=... hitlApproved=false
```

---

## Files

| File | Purpose |
|------|---------|
| `demo_authz_server/index.js` | Express server entry point, port binding |
| `demo_authz_server/routes/introspect.js` | RFC 7662 introspection (delegates to PingOne or local) |
| `demo_authz_server/routes/decision.js` | PingOne Authorize decision endpoint (all policy logic) |
| `demo_authz_server/ruleStore.js` | **Now core** — runtime-editable rule overlay: required-scope-per-tool, tool-discovery toggle, candidate-tool rules (read by `decision.js`) |
| `demo_authz_server/scopeTopology.js` | Reads `scope-topology.json`; used to derive the gateway audience (not the primary source of tool→scope mapping) |
| `demo_authz_server/.env` | Configuration (introspection, act claim, HITL thresholds) |
| `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts` | Gateway's client for calling the authz server decision endpoint |
| `demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts` | Gateway's client for calling the authz server introspection endpoint |