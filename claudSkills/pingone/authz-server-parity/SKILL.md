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

---

## What Must Stay in Sync

### 1. Decision endpoint path
```
POST /governance/pap/alpha/policy/:workerId/decision
```
Real PingOne and mock both implement this exact path. Never change one without the other.

### 2. Request `parameters` object
Any new parameter added to `buildAuthorizeParameters()` in the gateway must be handled in `demo_authz_server/routes/decision.js`.

Current parameters (keep this list current):
```json
{
  "parameters": {
    "DecisionContext":   "McpToolCall | McpRequest | McpToolsList | ChipAuthorization | ...",
    "McpMethod":        "tools/call | tools/list",
    "ToolName":         "view_records",
    "ClientId":         "user-sub",
    "ActClientId":      "act.sub from token",
    "TokenScopes":      "read write",
    "TokenAudience":    "mcpgateway.ping.demo",
    "TransactionAmount": "500",
    "TransactionType":  "create_transfer",
    "ToAccountId":      "acc_456",
    "HitlApproved":     "true | ''",
    "Vertical":         "healthcare | sporting-goods | ...",
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
  "policy_version": "mock-v1 | real-policy-version"
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
| `McpToolsList` | Gateway tools/list guard | Always PERMIT |
| `McpToolCall` | Gateway per-tool guard | act + scope + HITL |
| `McpRequest` | Generic MCP request | act + scope |
| `ChipAuthorization` | Setup page chip validation | vertical + scope per chip |

### 5. Introspection endpoint
```
POST /as/introspect
```
Must return RFC 7662 format: `{ active, sub, scope, exp, aud, act, may_act, ... }`
Delegates to real PingOne when `PINGONE_INTROSPECTION_ENDPOINT` is set.

---

## Files to Touch in Parallel

| Change type | Gateway file | Mock file |
|-------------|-------------|-----------|
| New parameter | `src/auth/PingOneAuthorizeClient.ts` | `demo_authz_server/routes/decision.js` |
| New DecisionContext | `src/pingAuthorizeGuard.ts` | `demo_authz_server/routes/decision.js` |
| Response field | `src/auth/PingOneAuthorizeClient.ts` | `demo_authz_server/routes/decision.js` |
| Introspection change | `src/auth/GatewayIntrospectionClient.ts` | `demo_authz_server/routes/introspect.js` |

---

## Checklist Before Marking Auth Work Done

- [ ] Decision parameters match between gateway and mock
- [ ] New DecisionContext handled in mock with equivalent logic
- [ ] Response shape identical (decision, reason, decision_id, policy_version)
- [ ] Mock `.env` has all required config vars (propagated from api server via ensure_service_env)
- [ ] `demo_authz_server` restarted and health check passes at `:9001/health`