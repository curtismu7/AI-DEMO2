---
name: authz-server-parity
description: Rule — any change to PingOne Authorize integration (gateway, BFF) must be mirrored identically in demo_authz_server. Read this before touching any authz-related code.
---

# Mock Authorization Server Parity Rule

## The Rule

**Every change to how the system calls PingOne Authorize must be applied to `demo_authz_server` in the same commit.**

The mock (`demo_authz_server`) is a drop-in replacement for real PingOne Authorize. Swapping is a single config change on the gateway:
```bash
PINGAUTHORIZE_ENDPOINT=https://real-pingone-authorize.url  # real
PINGAUTHORIZE_ENDPOINT=http://localhost:9001               # mock
```

If the mock diverges from real PingOne, the switch to production breaks silently.

### Parity is now THREE-WAY (not just gateway ↔ mock)

The decision contract is implemented by **more than two components**. A change to the contract must be mirrored across all replicas, not only `demo_authz_server`:

| Replica | File | Role |
|---------|------|------|
| MCP Gateway | `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts` | Builds `parameters`, calls the decision endpoint |
| Mock Authz Server | `demo_authz_server/routes/decision.js` | Reference policy engine |
| BFF simulated authorize | `demo_api_server/services/simulatedAuthorizeService.js` | Replicates the decision contract (referenced 15+ times by `decision.js`) |
| BFF MCP tool authz | `demo_api_server/services/mcpToolAuthorizationService.js` | Tool-level authorization on the API server |
| PingGateway groovy | `ping-gateway/scripts/groovy/p1az-decision.groovy` | Groovy filter re-implementing the same decision contract |

Any contract change (new parameter, new context, new rule, response field) must be applied to **all** of these in the same commit.

---

## What Must Stay in Sync

### 1. Decision endpoint path
```
POST /governance/pap/alpha/policy/:workerId/decision
```
Real PingOne and mock both implement this exact path. Never change one without the other.

### 2. Request `parameters` object
Any new parameter added to `buildAuthorizeParameters()` in the gateway must be handled in `demo_authz_server/routes/decision.js`.

Current parameters (keep this list current — `buildAuthorizeParameters()`, `PingOneAuthorizeClient.ts:106-163`):
```json
{
  "parameters": {
    "DecisionContext":   "McpToolCall | McpRequest | McpToolsList | ChipAuthorization | ...",
    "McpMethod":        "tools/call | tools/list",
    "ToolName":         "view_records",
    "ClientId":         "user-sub",
    "UserId":           "resolved user id",
    "ActClientId":      "act.sub from token",
    "ActChainDepth":    "delegation chain depth",
    "MayActSub":        "may_act.sub from token",
    "TokenScopes":      "read write",
    "TokenAudience":    "mcpgateway.ping.demo",
    "TokenAudActual":   "aud actually present on the token",
    "McpResourceUri":   "target MCP resource uri",
    "TokenExp":         "exp",
    "TokenIat":         "iat",
    "TokenNbf":         "nbf",
    "TokenIss":         "iss",
    "TransactionAmount": "500",
    "TransactionType":  "create_transfer",
    "ToAccountId":      "acc_456",
    "HitlApproved":     "true | ''",
    "Vertical":         "healthcare | sporting-goods | ...",
    "RarAuthorizationDetails": "RAR authorization_details JSON",
    "IntentTokenValid":       "true | false",
    "IntentTokenMatchesTool": "true | false",
    "IntentTokenJti":         "...",
    "IntentTokenIntent":      "...",
    "IntentTokenConfidence":  "0.0–1.0",
    "TokenActive":               "introspection active",
    "TokenIntrospectionSub":     "introspection sub",
    "TokenIntrospectionExp":     "introspection exp",
    "TratPurp":         "...",
    "TratAzdAct":       "...",
    "TratSessionId":    "...",
    "TratTool":         "...",
    "TratSim":          "true | false"
  }
}
```

### 3. Response shape
```json
{
  "decision": "PERMIT | DENY | INDETERMINATE",
  "reason": "optional string",
  "decision_id": "uuid",
  "policy_version": "mock-v1 | real-policy-version",
  "advice": "optional — PERMIT path may include an advice field (decision.js:620)"
}
```

### 4. DecisionContext values
Each `DecisionContext` represents a policy branch. When adding a new one (e.g. `ChipAuthorization`):
- Add the parameter to `buildAuthorizeParameters()` in gateway
- Add the handler branch in `demo_authz_server/routes/decision.js`
- Document it in this skill

Current contexts:
| Context | When Called | Policy |
|---------|-------------|--------|
| `McpToolsList` | Gateway tools/list guard (`pingAuthorizeGuard.ts`) | **PERMIT by default, but gated**: admin discovery toggle + user-status checks + per-tool candidate eval (not "always PERMIT") |
| `McpToolCall` | Gateway per-tool guard | act + require-act + scope (with `pinggateway:invoke` bypass) + deny-ceiling + RAR + entitlement-tier + resource-owner + group-membership + amount-driven two-tier HITL (STEP_UP / HITL_CONSENT) + intent-token |
| `McpRequest` | Generic MCP request | act + scope |
| `ChipAuthorization` | **Setup page chip validation — sent by the BFF/API server, NOT the gateway** (`demo_api_server/routes/verticalManifest.js:174`) | vertical + scope per chip |

### 5. Introspection endpoint
```
POST /as/introspect
```
Must return RFC 7662 format: `{ active, sub, scope, exp, aud, act, may_act, ... }`
Delegates to real PingOne when `PINGONE_INTROSPECTION_ENDPOINT` is set.

---

## Files to Touch in Parallel

Because parity is three-way (see above), a contract change usually touches the gateway, the mock, **and** the BFF/PingGateway replicas:

| Change type | Gateway file | Mock file | Other replicas |
|-------------|-------------|-----------|----------------|
| New parameter | `src/auth/PingOneAuthorizeClient.ts` | `demo_authz_server/routes/decision.js` | `demo_api_server/services/simulatedAuthorizeService.js`, `ping-gateway/scripts/groovy/p1az-decision.groovy` |
| New DecisionContext | `src/pingAuthorizeGuard.ts` (McpToolsList) / `demo_api_server/routes/verticalManifest.js` (ChipAuthorization) | `demo_authz_server/routes/decision.js` | `demo_api_server/services/mcpToolAuthorizationService.js`, `ping-gateway/scripts/groovy/p1az-decision.groovy` |
| Response field | `src/auth/PingOneAuthorizeClient.ts` | `demo_authz_server/routes/decision.js` | `demo_api_server/services/simulatedAuthorizeService.js`, `ping-gateway/scripts/groovy/p1az-decision.groovy` |
| Introspection change | `src/auth/GatewayIntrospectionClient.ts` | `demo_authz_server/routes/introspect.js` | — |

> **Note on `ChipAuthorization`:** it is **not** emitted by the gateway. `buildAuthorizeParameters()` (`PingOneAuthorizeClient.ts:103`) only emits `McpToolCall`/`McpRequest`, and the guard adds `McpToolsList`. `ChipAuthorization` is produced by the BFF/API server (`demo_api_server/routes/verticalManifest.js:174`).

---

## Checklist Before Marking Auth Work Done

- [ ] Decision parameters match across gateway, mock, BFF `simulatedAuthorizeService.js`, and PingGateway groovy filter
- [ ] New DecisionContext handled in mock with equivalent logic (and in `mcpToolAuthorizationService.js` / groovy filter if applicable)
- [ ] Response shape identical (decision, reason, decision_id, policy_version; optional `advice`)
- [ ] Mock `.env` has all required config vars (propagated from api server via ensure_service_env)
- [ ] `demo_authz_server` restarted and health check passes at `:9001/health`