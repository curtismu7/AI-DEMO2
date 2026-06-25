# MCP Gateway Pass-Through Design

**Date:** 2026-05-20  
**Status:** Approved  
**Branch:** fix/bootstrap-invalid-client-auto-retry

---

## Goal

Implement the architecture Patrick Harding described: the MCP Gateway functions as a **full enforcement point** — validating the inbound token, running PingOne Authorize for fine-grained authorization — and then **passes the same token unchanged** to the MCP Server. No RFC 8693 re-exchange between gateway and MCP server.

This gives the demo a clean, narratable token flow:

```
BFF → PingOne RFC 8693 (aud=gateway) → MCP Gateway
  Gateway: validate + introspect + PingOne Authorize
  → pass same token → MCP Server (trusts gateway's enforcement)
```

---

## Current Flow (Before)

```
BFF → RFC 8693 (aud=MCP_GW_RESOURCE_URI) → token₁
token₁ → MCP Gateway
  Gateway: validate(token₁) + introspect + PingOne Authorize
  → RFC 8693 re-exchange (aud=mcpOlbResourceUri) → token₂
  token₂ → MCP Server (validates aud=mcpOlbResourceUri)
```

Two token exchanges, two audience values, gateway re-issues a new token for every tool call.

---

## Target Flow (After)

```
BFF → RFC 8693 (aud=MCP_GW_RESOURCE_URI) → token₁
token₁ → MCP Gateway
  Gateway: validate(token₁) + introspect + PingOne Authorize
  → forward token₁ unchanged
  token₁ → MCP Server (validates aud=MCP_GW_RESOURCE_URI — same URI)
```

One token, one RFC 8693 exchange (BFF→Gateway), gateway is the sole enforcement point.

---

## Architecture

### Shared Audience

The key insight: `MCP_SERVER_RESOURCE_URI` on the MCP server is set to the **same value** as `MCP_GW_RESOURCE_URI` on the gateway. The token the BFF mints already satisfies both audience checks.

### Gateway Enforcement Stays Complete

Passthrough does **not** reduce security at the gateway — all of these still run:

- JWT decode + exp/aud validation (`tokenValidator.ts`)
- RFC 7662 active-token introspection (`GatewayIntrospectionClient`)
- Identity invariants: sub present, act.sub non-empty (`GatewayTokenPolicy`)
- D-05 anti-bypass: inbound aud must not contain upstream backend URIs
- PingOne Authorize decision (PERMIT / DENY / HITL)
- HITL challenge flow

### D-05 Anti-Bypass Invariant

D-05 checks that the inbound token's `aud` does not contain `mcpOlbResourceUri`, `mcpInvestResourceUri`, or `bankingResourceServerResourceUri`. This is safe and unchanged: in passthrough mode the inbound token carries `aud=MCP_GW_RESOURCE_URI`, which is a different value from those backend URIs. D-05 passes cleanly.

### Phase 266 Paths Unaffected

The `apikey`, `dualtoken`, and `bankingdata` targets route to `banking_resource_server` and `banking_mortgage_service` — separate backends with their own audiences. These still perform RFC 8693 re-exchange to get a token scoped to `bankingResourceServerResourceUri`. Passthrough only applies to the `olb` and `invest` WebSocket paths.

---

## Changes Required

### 1. `demo_mcp_gateway/src/config.ts`

Add `mcpServerPassthrough: boolean` to `GatewayConfig` interface.

Load from env var `MCP_GW_PASSTHROUGH_TO_MCP_SERVER` (default: `false`).

```typescript
mcpServerPassthrough: process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER === 'true',
```

### 2. `demo_mcp_gateway/src/index.ts`

**In `proxyToolsList(target, token)`:** when `config.mcpServerPassthrough` is `true`, skip `McpTokenExchangeClient.exchange()` and call `proxyJsonRpc(wsUrl, token, ...)` with the inbound token directly.

**In `handleMessage` → `tools/call` → `olb`/`invest` path:** same — when passthrough is enabled, skip the re-exchange and call `proxyJsonRpc(wsUrl, token, ...)` with the original inbound token.

No other logic changes. Auth pipeline runs identically before reaching this point.

### 3. `demo_mcp_server/.env` (config only)

Set `MCP_SERVER_RESOURCE_URI` to match `MCP_GW_RESOURCE_URI`:

```
MCP_SERVER_RESOURCE_URI=<same value as MCP_GW_RESOURCE_URI>
```

`TokenIntrospector.ts` already handles aud as a space-separated list and checks for inclusion — no code change needed in the MCP server.

### 4. `demo_api_server/.env` (config only)

`PINGONE_RESOURCE_MCP_SERVER_URI` (what the BFF requests as the token audience) must be set to `MCP_GW_RESOURCE_URI`. The BFF's `agentMcpTokenService.js` reads this to set the `audience` in the RFC 8693 exchange with PingOne.

### 5. PingOne (config only)

The MCP resource registered in PingOne must have `MCP_GW_RESOURCE_URI` as its audience value. The BFF's RFC 8693 exchange requests `audience=MCP_GW_RESOURCE_URI`; PingOne must recognise this as a valid resource audience to issue the token.

---

## Environment Variable Summary

| Service | Env var | Value |
|---|---|---|
| MCP Gateway | `MCP_GW_RESOURCE_URI` | e.g. `mcpgateway.ping.demo` |
| MCP Gateway | `MCP_GW_PASSTHROUGH_TO_MCP_SERVER` | `true` |
| MCP Gateway | `MCP_OLB_RESOURCE_URI` | (can remain set; unused in passthrough for olb/invest) |
| MCP Server | `MCP_SERVER_RESOURCE_URI` | same as `MCP_GW_RESOURCE_URI` |
| BFF | `PINGONE_RESOURCE_MCP_SERVER_URI` | same as `MCP_GW_RESOURCE_URI` |

---

## Files Changed

| File | Change type |
|---|---|
| `demo_mcp_gateway/src/config.ts` | Add `mcpServerPassthrough` field |
| `demo_mcp_gateway/src/index.ts` | Passthrough branch in `proxyToolsList` + `tools/call` dispatch |
| `demo_mcp_server/.env` | Set `MCP_SERVER_RESOURCE_URI` |
| `demo_api_server/.env` | Set `PINGONE_RESOURCE_MCP_SERVER_URI` |

No changes to: `GatewayTokenPolicy.ts`, `authorizeMcpRequestCore.ts`, `credentialSwap.ts`, `router.ts`, `proxy.ts`, MCP server source code.

---

## Out of Scope

- Phase 266 credential paths (apikey, dualtoken, bankingdata) — unchanged
- HITL flow — unchanged
- PingOne Authorize integration — unchanged
- MCP invest path — follows same passthrough logic as olb when enabled
- Production hardening (token cache eviction, introspection TTL) — unchanged

---

## Success Criteria

1. `npm run build` in `demo_mcp_gateway/` exits 0
2. `npm run build` in `demo_mcp_server/` exits 0
3. Tool call (`get_my_accounts`) succeeds end-to-end with passthrough enabled
4. Gateway logs show no `[exchange]` entry for the olb/invest leg
5. MCP server logs show token accepted with `aud=MCP_GW_RESOURCE_URI`
6. Token Chain UI shows the inbound token passing through (no second exchange event for the MCP server hop)
7. Existing Phase 266 tools (demo_show_accounts, show_mortgage, user_profile_card) still work — they still re-exchange to `bankingResourceServerResourceUri`
