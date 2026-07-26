# Token Chain — Authorize, MCP, Resource Server, Gateway filter/rule

**Date:** 2026-07-22  
**Branch:** continue `feat/token-chain-gap-fill` (or follow-on `feat/token-chain-az-mcp-rs`)  
**Surface:** `buildTraceSteps` / `TokenChainTraceRail` / gateway `X-Gw-Audit-Trail`  
**Depends on:** Phase D gaps (introspection / JWKS / MCP deny) already on this branch

## Goal

After a tool run, TraceRail’s **authorize**, **gateway**, **mcp**, and **api** steps each answer: *what was asked, what decided/ran, which filter or policy rule fired, and what came back* — without opening classic `TokenChainDisplay`.

## Do not break

- Existing step ids / `notinpath` / emoji allowlist / L0–L3 disclosure.
- Auth, RFC 8693 exchange, session cookie (teaching + audit-trail enrichment only).
- One live surface = TraceRail (no remounting `TokenChainDisplay`).

---

## Current gaps (evidence already exists unless noted)

| Step | Shown today | Missing |
|------|-------------|---------|
| **authorize** | why, decision, engine, decisionId, request params, raw response | Policy **statements** / advice; dual BFF + gateway evaluations side-by-side |
| **gateway** | authorize/mTLS/inbound/scope; deny label | **Which filter/stage denied or forwarded**; rule/statement that fired |
| **mcp** | JSON-RPC request (+ deny body) | Success **response**; **`gw-mcp-audit`** 5W1H |
| **api** | Often dumps `mcpResult.result` | Dedicated RS request/response from `resource-server-reply` / `_meta.apiCall` |

---

## Phase E1 — Authorize: full decision teaching

**Files:** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js` (+ tests)

1. On authorize step `kv` / evidence, surface when present:
   - `statements` (from `azEval.response.statements` **or** `gw-authorize.statements`)
   - `reason` / advice / obligations if on response
   - `authorizeRef` / policy path if present (`buildGwAuthorizeEventExtra` already maps `authorizeRef`)
2. Prefer **BFF** `ingestAuthorize` / `authorize-decision` as primary request/response.
3. If **both** BFF and `gw-authorize` exist with request/response, keep primary as today and add a collapsed second evidence block:
   - `detail.altRequest` / `detail.altResponse` titled “Gateway Authorize (same run)”  
   - Or a single `detail.secondaryEvidence[]` array TraceStepCard already can render if we extend it minimally — prefer **one** extra `<details>` in TraceStepCard only if needed; otherwise pack into response JSON with a clear `gatewayHop` sibling key in `why` + kv `["gateway authorize", "also present"]`.
4. **Why copy:** include statement codes when DENY/INDETERMINATE (e.g. `statements[].code` or `.id`).

**Done when:** Vitest — authorize step includes statement text from `gw-authorize.statements`; dual-evidence case keeps BFF request and mentions gateway hop.

---

## Phase E2 — Gateway: show filter / stage / rule that fired

Teaching ask: *“which Agent Gateway filter or rule blocked or allowed this?”*

### E2a — UI (consume what we already have)

**Files:** `buildTraceSteps.js` gateway (+ optional mcp) steps

From `gw-authorize` / `gw-mcp-audit` / deny phases, fill gateway `why` + `kv`:

| Source | Display |
|--------|---------|
| `gw-authorize.statements` | “Rule/statement: …” (codes/ids) |
| `gw-authorize.reason` | reason string |
| `gw-authorize.backend` / `policySource` | backend (real / mock / local-fallback) |
| `gw-mcp-audit.how` | decision → result (forwarded / blocked) |
| `gatewayErrorCode` / sim deny `error` | error code chip |
| Node `X-Gw-Audit-Trail.policy` | policy passed/failed (when event carries it) |

Promote **`gw-mcp-audit`** onto the **gateway** (and/or mcp) step as request/response-style evidence: title “McpAuditFilter — who/what/when/where/how”, body = `mcpAudit` JSON.

### E2b — Data path: stamp denying / completing **filter stage**

Today’s PingGateway trail (`p1az-decision.groovy`) has introspection + authorize + mcpAudit, but **not** the filter name (e.g. `McpProtectionFilter` vs `ScriptableFilter`/`p1az-decision` vs `OAuth2TokenExchangeFilter`). Node trail has stages (`introspection`, `policy`, `authorize`, `mtls`, `backend`) but TraceRail does not render them as a chain.

**Minimal contract** — add to `X-Gw-Audit-Trail` (both Node + PingGateway where feasible):

```json
{
  "filterChain": [
    { "filter": "McpAuditFilter", "result": "passed" },
    { "filter": "McpProtectionFilter", "result": "passed" },
    { "filter": "P1AZDecision", "result": "blocked", "decision": "DENY", "statements": ["…"] }
  ],
  "denyingFilter": "P1AZDecision"
}
```

**Implementation sketch:**

| Runtime | Work |
|---------|------|
| **Node** `authorizeMcpRequest.ts` | On each early-return / success, set `auditTrail.denyingFilter` / append `filterChain` stages already implied by code order (introspection → policy → authorize → mtls → backend). |
| **PingGateway** groovy / route | On deny paths in protection / validation / p1az scripts, set `denyingFilter` to the script/filter type; on success, `filterChain` with last hop `P1AZDecision` + `result: forwarded`. Full IG chain telemetry is optional — **minimum bar:** `denyingFilter` + authorize `statements` on every deny. |
| **BFF** `mcpToolPipeline.js` | When building `gw-authorize` / new `gw-filter-chain` token event from trail, copy `denyingFilter` + `filterChain` onto the event extra. |

**TraceRail:** gateway step `why` like:  
`Blocked by P1AZDecision (DENY) — statement X` or `Passed filter chain; last hop P1AZDecision → forwarded`.

**Done when:**

- Unit: buildTraceSteps with `gw-authorize` + `denyingFilter` + statements asserts why/kv.
- Unit/integration: Node middleware sets `denyingFilter` on a forced DENY (extend existing `authzProvenanceGaps` or gateway deny test).
- PingGateway: at least p1az deny path stamps `denyingFilter: "P1AZDecision"` (or ScriptableFilter name) in audit JSON.

---

## Phase E3 — MCP step: response + audit

**Files:** `buildTraceSteps.js`, possibly `tokenChainTraceStore.ingestMcpResult` normalization

1. Happy path: keep JSON-RPC **request**; add **response** = tool result content (`mcpResult.result`), not only duration.
2. Fold `gw-mcp-audit` into mcp step when present (or link “see gateway” if E2 already shows full audit — prefer **gateway owns audit**, mcp owns JSON-RPC request/response to avoid duplication; if both, mcp kv points to gateway for 5W1H).
3. Keep Phase D deny requestJson + error body.

**Done when:** Vitest — mcp done step has both request and response text; deny case unchanged.

---

## Phase E4 — Resource server (api) step: real RS hop

**Files:** `buildTraceSteps.js`; emit path already has `resource-server-reply` in `mcpToolRegistry.js`

1. Prefer `findEvent(tokenEvents, "resource-server-reply")` for status + why + kv (`toolName`, `durationMs`, `routedVia`, `resultSummary`).
2. Request evidence:
   - api-key path: `_meta.apiCall` / `evt-backend` (already partial)
   - oauth path: synthesize teaching request from tool name + args in `mcpResult.requestJson.params` labeled “MCP → banking API (via tool)” when no raw HTTP is available — **do not invent** method/URL; if only summary exists, show that honestly.
3. Response: prefer RS-shaped payload if `_meta` separates it; else `mcpResult.result` titled “Resource / tool result” (clearer than “API result” when it’s MCP content).
4. Optional follow-up (out of scope unless easy): have MCP server publish `resourceRequest: { method, path }` on `_meta` for banking tools — only if a single existing field already exists; otherwise document as Phase F.

**Done when:** Vitest — `resource-server-reply` marks api done with duration/tool in kv; api-key path still shows `apiCall`.

---

## Phase E5 — TraceStepCard / plan doc only if needed

- If `altRequest`/`altResponse` or `filterChain` list needs UI, extend TraceStepCard with one optional block (kv list or nested details) — **no** new emoji; keep L2 collapsed.
- Update `docs/superpowers/plans/2026-07-22-token-chain-teaching-flow.md` Phase E row → ✅ when merged.
- `REGRESSION_PLAN.md` §4 short entry after ship.

---

## Suggested order / PRs

| PR | Phases | Risk |
|----|--------|------|
| **1** | E1 + E3 + E4 (UI-only from existing events) | Low | ✅ on PR |
| **2** | E2a UI from existing statements/mcpAudit | Low | ✅ on PR |
| **3** | E2b `denyingFilter` / `filterChain` on Node + PingGateway + BFF event mapping | Medium (gateway) | ✅ on PR |

Do not mix E2b with unrelated gateway refactors.

---

## Verify

```bash
cd demo_api_ui && npm test -- --run \
  src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js \
  src/components/__tests__/TraceStepCard.teaching.test.jsx
cd demo_api_ui && npm run build

# After E2b:
cd demo_mcp_gateway && npm test -- --runTestsByPath tests/authzProvenanceGaps.test.ts
cd demo_api_server && npm test -- --testPathPattern='mcpToolPipeline|buildGwAuthorize'
```

Live smoke: tool call PERMIT + forced DENY — TraceRail Authorize shows statements; Gateway shows denying filter/rule; MCP shows request+response; API shows resource-server-reply summary.

---

## Out of scope

- Remounting classic TokenChainDisplay
- Full IG filter telemetry for every hop on success (nice-to-have after `denyingFilter`)
- Inventing HTTP wire logs the MCP server does not emit
