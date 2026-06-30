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
| `demo_mcp_server`   | 8080 | **Tool execution**: handles tools/list and tools/call |

The gateway has **zero inline authorization logic**. Every decision comes from the Authorization Server.

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

---

## Authorization Rules (in order)

1. **tools/list** (`DecisionContext === 'McpToolsList'`) → always PERMIT (tool discovery is not gated)

2. **act claim** — if `ActClientId` is present AND `PINGONE_MCP_EXCHANGER_CLIENT_ID` is configured:
   - `ActClientId` must equal the configured authorized actor (MCP exchanger)
   - Mismatch → DENY (`act.sub "X" is not the authorized actor`)

3. **scope check** — reads required scopes from `scope-topology.json`:
   - Missing required scopes → DENY (`insufficient_scope: missing read`)

4. **HITL** — if tool requires `write` scope AND `HitlApproved !== 'true'`:
   - Returns INDETERMINATE (`HITL_REQUIRED`) → gateway creates HITL challenge

---

## Gateway Configuration

The gateway calls the Authorization Server via these env vars (in `demo_mcp_gateway/.env`):

```bash
PINGAUTHORIZE_ENDPOINT=http://localhost:9001      # Authorization Server URL
PINGAUTHORIZE_WORKER_ID=mcp-gateway-policy        # Policy ID (any string for mock)
MCP_GW_P1AZ_ENABLED=true                          # REQUIRED — enables authz server calls
```

When `MCP_GW_P1AZ_ENABLED` is false or `PINGAUTHORIZE_ENDPOINT` is not set, the gateway **fails closed** (DENY all) — no inline fallback.

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

Decision log format:
```
[AuthzServer/decision] policy=mcp-gateway-policy ctx=McpToolCall tool=get_my_accounts actor=d3f8fead scopes=[read] hitlApproved=false
[AuthzServer/decision] PERMIT — tool="get_my_accounts" actor="d3f8fead"
```

---

## Files

| File | Purpose |
|------|---------|
| `demo_authz_server/index.js` | Express server entry point, port binding |
| `demo_authz_server/routes/introspect.js` | RFC 7662 introspection (delegates to PingOne or local) |
| `demo_authz_server/routes/decision.js` | PingOne Authorize decision endpoint (all policy logic) |
| `demo_authz_server/scopeTopology.js` | Reads `scope-topology.json` for tool→scope mapping |
| `demo_authz_server/.env` | Configuration (introspection, act claim, HITL thresholds) |
| `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts` | Gateway's client for calling the authz server decision endpoint |
| `demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts` | Gateway's client for calling the authz server introspection endpoint |