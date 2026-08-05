# CareConnect E2E Trace — "Release My Records" Chip

_Generated: 2026-06-02T23:51:33.388Z_

This document traces every step of the **CareConnect "Release my records"** chip flow
end-to-end, from vertical activation through RFC 8693 token exchange, MCP gateway
routing, PingAuthorize authz decision, and HITL consent gate.

**Vertical:** CareConnect (healthcare)
**Chip:** `hc5` "Release my records" (`hitlTrigger: true`)
**Tool:** `release_records` — authz: `{ stepUp: true, consent: true }`
**Expected outcome:** step-up MFA + HITL consent required (when `ff_hitl_enabled=true`)

### Where does `recordId` come from?

`release_records` requires a `recordId` (e.g. `"pr1"`, `"pr2"`, `"pr3"`). The proper two-step flow is:

1. User clicks **"My records"** chip → `view_records` → returns `[{ id: "pr1", provider: "Dr. Chen" }, ...]`
2. UI renders the records list; user selects one
3. User clicks **"Release my records"** → agent asks "To release records, I need: recordId"
4. User provides `pr1` → agent calls `release_records({ recordId: "pr1" })` → **authz gate fires**

Records are seeded from `config/verticals/healthcare/mock-data.json` (`patientRecords` array with ids `pr1`–`pr3`).

---

## Step 1 — Switch vertical to healthcare

`POST /api/verticals/active` `{ id: "healthcare" }`

**HTTP Status:** 204
**Response:** ""

---

## Step 2 — Load manifest + find HITL chip

`GET /api/verticals/me`

**Active vertical:** `healthcare`
**Display name:** CareConnect
**Terminology.account:** Patient Record
**Total chips:** 15
**HITL trigger chip:** `hc5` "Release my records" — message: "release my records"

---

## Step 3 — NL routing (chip message → intent)

`POST /api/banking-agent/nl`
```json
{ "message": "release my records", "provider": "heuristic", "vertical": "healthcare" }
```

**HTTP Status:** 200
**Source:** `heuristic`
**kind:** `vertical`
**action:** `release_records`
**vertical:** `healthcare`

---

## Step 4 — Session token claims (pre-exchange)

`GET /api/auth/oauth/token-claims`

| Claim | Value | Valid? |
|---|---|---|
| `sub` | `4511829e-44a…` | ✅ |
| `aud` | `["enduser.ping.demo"]` | ✅ |
| `iss` | `https://auth.pingone.com/d02d2305-f445-4…` | ✅ |
| `exp` | 1780447403 (✅ valid) | ✅ |
| `iat` | 1780443803 (✅ past) | ✅ |
| `scope` | `ai:agent:read transfer read openid write mortgage:read` | ✅ |

---

## Step 5 — RFC 8693 Token Exchange (user token → MCP token)

`GET /api/pingone-test/exchange-user-to-mcp`

**Status:** 200 ✅ success

| Claim | Session token | MCP token | Check |
|---|---|---|---|
| `sub` | `4511829e-44a…` | `4511829e-44a…` | ✅ preserved |
| `aud` | `["enduser.ping.demo"]` | `["mcpgateway.ping.demo"]` | ✅ narrowed |
| `exp` | ✅ valid | ✅ valid | — |
| `act` | — | ⚠️ absent (PingOne policy) | — |
| `scope` | `ai:agent:read transfer read openid write mortgage:read` | `mcp:invoke read write` | — |

---

## Step 6 — Agent invoke (full MCP pipeline)

`POST /api/agent/invoke`
```json
{ "prompt": "release my records", "forceHeuristic": true, "vertical": "healthcare" }
```

**HTTP Status:** 200 (25ms)
**Result:** ✅ Authz gate fired correctly

**Reply:** "This action requires step-up verification."

> **Why 200?** The local authz gate (`checkLocalAuthzGate`) fires before the MCP pipeline when `ff_authorize_real=false` (dev default). It returns a 200 body with `step_up_required: true`. When PingOne Authorize is live (`ff_authorize_real=true`), the tool call goes through the full MCP pipeline where the gateway returns HTTP 428. Both enforce the same security policy — the difference is where the decision is evaluated.

**Token events (pipeline legs):**
_(authz gate short-circuits before MCP token exchange — no exchange events expected)_

---

## Step 7 — App events (pipeline audit trail)

`GET /api/admin/app-events?since=…&limit=50`

**Events captured:** 0
**Categories:** _(none)_

| # | Time | Category | Event |
|---|---|---|---|
| — | — | — | No events |

---

## Step 8 — HITL + authz configuration

`GET /api/admin/feature-flags`

| Flag | Value | Expected |
|---|---|---|
| `ff_hitl_enabled` | `true` | `true` ✅ |
| `confirm_threshold_usd` | `N/A` | `250` |

**Authz gate triggered:** ✅ YES — `step_up_required: true` returned (HTTP 200 with authz body)
> When `ff_authorize_real=false` (mock outage fallback), the BFF's local authz gate returns 200 + `step_up_required`. With live PingOne Authorize (`true`), the gateway returns HTTP 428.

**Healthcare `release_records` authz config:** `{ stepUp: true, consent: true }`
This tool requires BOTH:
- MFA step-up authentication
- Human-in-the-loop consent approval

---

## Step 9 — Restore vertical to banking

`POST /api/verticals/active` `{ id: "banking" }` ✅

---

## Summary

### Full Pipeline Path

```
User chip click "Release my records"
  → POST /api/banking-agent/nl   [heuristic: "healthcare"/"release_records"]
  → POST /api/agent/invoke       [forceHeuristic: true, vertical: "healthcare"]
      → dispatchVerticalIntent("release_records", ctx)
          → checkLocalAuthzGate  [stepUp: true, consent: true → HITL gate]
            OR (when PingAuthorize live)
          → executePluginToolViaMcp("release_records")
              → executeBffTool("release_records")
                  → resolveMcpAccessTokenWithEvents (RFC 8693 exchange)
                      → PingOne Exchange #1: user token → agent token
                      → PingOne Exchange #2: agent token → MCP token
                  → callMcpToolInternal("release_records", mcpToken)
                      → MCP Gateway :3005 [validates token, PingAuthorize]
                          → MCP Server :8080 [executes handler]
                              → BFF /api/path/vertical-tool/healthcare/release_records
                                  → HITL gate → 428 consent_required
```

### Token Validation Checkpoints

| Checkpoint | What's validated | Enforced by |
|---|---|---|
| Session token | aud, sub, iss, exp, scope (RS256 JWKS) | BFF auth.js middleware |
| RFC 8693 Exchange | subject_token exp + aud, grant_type | PingOne AS |
| MCP token | active, sub, aud (MCP resource), scope, exp | MCP Gateway (introspection) |
| Tool authz | stepUp flag → MFA required; consent flag → HITL 428 | BFF dispatchVerticalIntent |
| HITL gate | ff_hitl_enabled, confirm_threshold_usd | BFF transactionConsent route |
