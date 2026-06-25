# Sporting-Goods Vertical — Authorization Server Integration Test
**Date:** 2026-06-03  
**Branch:** main (`52058d1b`)  
**Test runner:** Playwright E2E (`npm run test:e2e:real:vertical:core`) + direct authz server API tests

---

## Architecture Under Test

```
Browser (Playwright)
  → BFF :3001  (OAuth session, RFC 8693 token exchange)
    → MCP Gateway :3005  (routing only — delegates all auth)
      → Authorization Server :9001  (PingOne Authorize mock — ALL decisions)
        → PingOne AS :443  (RFC 7662 introspection → active: true)
      → MCP Server :8080  (local JWT decode, tool execution)
        → BFF :3001 /api/path/vertical-tool  (sporting-goods tool executor)
```

---

## Phase 1 — Service Health ✅ All 13 services healthy

---

## Phase 2 — Playwright E2E: Sporting-Goods Core Chips ✅ 6/6 PASS

```
E2E_VERTICAL=sporting-goods npm run test:e2e:real:vertical:core

Running 6 tests using 1 worker

  ✓  1  Heuristic — My gear        (MCP list_gear)      911ms
  ✓  2  LLM (Helix) — My gear      (MCP list_gear)      7.0s
  ✓  3  Heuristic — My rentals     (MCP list_rentals)   876ms
  ✓  4  LLM (Helix) — My rentals   (MCP list_rentals)   5.9s
  ✓  5  Heuristic — My loyalty pts (MCP loyalty_balance) 964ms
  ✓  6  LLM (Helix) — My loyalty pts (MCP loyalty_balance) 5.1s

  6 passed (38.9s)
```

**Chips tested:** list_gear, list_rentals, loyalty_balance  
**Modes:** Heuristic (fast path) + LLM/Helix (full LLM path)

---

## Phase 3 — Authorization Server Decisions (live, from /tmp/demo-authorize.log) ✅

All 6 tool calls flowed through the Authorization Server and received PERMIT:

```
[AuthzServer/decision] ctx=McpToolCall tool=list_gear     scopes=[mcp:invoke read] → PERMIT
[AuthzServer/decision] ctx=McpToolCall tool=list_gear     scopes=[mcp:invoke read] → PERMIT
[AuthzServer/decision] ctx=McpToolCall tool=list_rentals  scopes=[mcp:invoke read] → PERMIT
[AuthzServer/decision] ctx=McpToolCall tool=list_rentals  scopes=[mcp:invoke read] → PERMIT
[AuthzServer/decision] ctx=McpToolCall tool=loyalty_balance scopes=[mcp:invoke read] → PERMIT
[AuthzServer/decision] ctx=McpToolCall tool=loyalty_balance scopes=[mcp:invoke read] → PERMIT
```

**Zero inline fallback** — every decision came from the standalone Authorization Server.

---

## Phase 4 — Gateway Audit Trail (live, from /tmp/demo-mcp-gateway.log) ✅

6 gateway audit trails logged, all showing:

```json
{
  "introspection": { "active": true, "sub": "4511829e-44a0-4cab-8f42-1f9ad860ae91" },
  "policy":        { "passed": true },
  "authorize":     { "decision": "PERMIT" },
  "mtls":          { "enabled": false }
}
```

**Introspection → PingOne:** `active: true` for all 6 tokens  
**Policy validation:** passed for all 6  
**Authorization Server decision:** PERMIT for all 6

---

## Phase 5 — Direct Authz Server API Tests ✅

All decision types verified with correct PERMIT/DENY responses:

| Test | DecisionContext | Tool | Scopes | Actor | Expected | Result |
|------|----------------|------|--------|-------|----------|--------|
| 1 | ChipAuthorization | gear_order_status | read write | — | PERMIT | ✅ |
| 2 | ChipAuthorization | extend_rental | read write | — | PERMIT | ✅ |
| 3 | ChipAuthorization | extend_rental | read | — | DENY (missing write) | ✅ |
| 4 | McpToolCall | gear_order_status | read write | d3f8fead (authorized) | PERMIT | ✅ |
| 5 | McpToolCall | gear_order_status | read write | unknown-xyz | DENY (act mismatch) | ✅ |
| 6 | McpToolsList | — | — | — | PERMIT (always) | ✅ |

---

## Phase 6 — Unit Test Suite ✅

```
Test Suites: 41 passed, 41 total
Tests:       722 passed, 722 total
```

TokenIntrospector tests updated for local JWT decode (gateway already authorized).

---

## Observations

**`actor=(none)` in E2E:** The E2E session tokens arrive at the gateway without an `act` claim.
This means the exchange for this session path is running subject-only (no actor token).
The act-claim enforcement is still correct — when `ActClientId = ''`, the authz server
correctly skips the actor check (an empty actor is not "unauthorized", it's undelegated).
Full two-exchange delegation with `act` claim would require the AI Agent credentials
to be wired into the E2E session. The tool results are correct regardless.

---

## Summary

| Phase | Status |
|-------|--------|
| All 13 services healthy | ✅ PASS |
| Playwright E2E 6/6 sporting-goods chips | ✅ PASS |
| Authorization Server logged PERMIT for all 6 live tool calls | ✅ PASS |
| Gateway introspection → PingOne: active:true for all | ✅ PASS |
| Gateway audit: policy passed + authorize PERMIT for all | ✅ PASS |
| ChipAuthorization PERMIT/DENY scope enforcement | ✅ PASS |
| McpToolCall actor validation (authorized vs unauthorized) | ✅ PASS |
| 722/722 unit tests | ✅ PASS |
