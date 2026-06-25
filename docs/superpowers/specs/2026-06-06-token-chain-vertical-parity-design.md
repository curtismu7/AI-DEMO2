# Design: Token Chain Completeness + Vertical Feature Parity

**Date:** 2026-06-06
**Approach:** A — Functional-first (token chain + verification), then content/education parity

---

## Problem Statement

Two related gaps exist in the demo:

1. **Token chain is incomplete** — the live RFC 8693 delegation trace goes dark after "exchanged token acquired." The tool invocation and its result are never connected back to the token that authorized it. Silent degraded paths (missing CC token) are invisible. The exchange request body is hidden.

2. **Vertical feature parity** — non-banking verticals (healthcare, retail, sporting-goods, workforce) lack admin pages, the sensitive-data access pattern, and some education paths that banking has. The architecture sim scenarios contain inaccuracies and are missing a HITL scenario.

---

## Phase 1 — Token Chain Improvements

### 1.1 New events

**`mcp-tool-invoked`** — emitted in `agentMcpTokenService.js` when the exchanged token is forwarded to the MCP server and the tool call dispatches.

| Field | Value |
|-------|-------|
| `toolName` | Name of the MCP tool called |
| `tokenAud` | Audience of the exchanged token used |
| `flowTraceId` | Links to the exchange events in this flow |
| `status` | `acquiring` |

**`mcp-tool-result`** — emitted when the MCP server returns.

| Field | Value |
|-------|-------|
| `toolName` | Same tool as `mcp-tool-invoked` |
| `duration` | Round-trip ms |
| `status` | `active` (success) or `failed` |
| `resultPreview` | Shape/summary only — no sensitive payload in the UI event |
| `flowTraceId` | Links back to invoked event |

**`agent-actor-token-unavailable`** — replaces the current silent subject-only fallback when `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` is absent or the CC token fetch fails.

| Field | Value |
|-------|-------|
| `reason` | `not-configured` or `fetch-failed` |
| `impact` | `"act claim will be absent from exchanged token"` |
| `status` | `degraded` |

### 1.2 Enriched existing event

**`exchange-in-progress`** — add `exchangeRequest` sub-object to the existing event (data is already computed in `agentMcpTokenService.js`, not yet emitted):

```js
exchangeRequest: {
  audience,          // requested resource URI
  scopesRequested,   // string[] of scopes sent in the exchange
  subjectTokenType,  // urn:ietf:params:oauth:token-type:access_token
  actorTokenPresent, // boolean
}
```

### 1.3 UI changes — `TokenChainPanel`

- **Tool Invocation row** — new row below the exchange section. Shows `mcp-tool-invoked` → `mcp-tool-result` pair with status badge and `resultPreview`.
- **Degraded badge** — on the actor token step when `agent-actor-token-unavailable` fired, replacing the current implicit `⚠ act absent` indicator.
- **Exchange Request collapsible** — on the exchange step, a collapsible "Exchange Request" detail showing the four `exchangeRequest` fields.

### 1.4 Files touched (Phase 1)

| File | Change |
|------|--------|
| `demo_api_server/services/agentMcpTokenService.js` | Emit `mcp-tool-invoked`, `mcp-tool-result`, `agent-actor-token-unavailable`; enrich `exchange-in-progress` |
| `demo_api_ui/src/components/TokenChainPanel.js` (or `TokenChainDisplay.js`) | Render new events + degraded badge + exchange collapsible |

---

## Phase 2 — Vertical Parity

### 2a. Functional verification gate

Before any Phase 2 content work: run the agent end-to-end on each non-banking vertical (healthcare, retail, sporting-goods, workforce). Confirm:
- Tool calls dispatch and return results
- RFC 8693 exchange fires and token chain events appear
- HITL consent gate triggers where a HITL chip is configured
- No silent errors in `/tmp/demo-api.log`

Fix any breakages before proceeding. This is the gate for 2b–2e.

### 2b. Vertical admin pages

Create one admin operations page per non-banking vertical, mirroring the structure of `BankingAdminOps` at `/admin/banking`.

| Route | Component | Vertical-specific operations |
|-------|-----------|------------------------------|
| `/admin/healthcare` | `HealthcareAdminOps` | Patient records, appointments, coverage |
| `/admin/retail` | `RetailAdminOps` | Orders, rewards, inventory |
| `/admin/sporting-goods` | `SportingGoodsAdminOps` | Gear inventory, rentals, loyalty |
| `/admin/workforce` | `WorkforceAdminOps` | Benefits, expenses, PTO requests |

`AdminSideNav.jsx` already has a vertical-aware nav array. Add one entry per vertical pointing to its admin route. No changes to sidebar layout/icons/CSS (frozen per memory).

### 2c. Sensitive-data access pattern on all verticals

Add one high-security MCP tool per non-banking vertical. Each requires elevated scope + HITL gate, matching the `sensitive_account_details` pattern in banking.

| Vertical | Tool name | Scope required |
|----------|-----------|----------------|
| healthcare | `sensitive_patient_records` | `health:sensitive:read` |
| retail | `sensitive_order_history` | `retail:sensitive:read` |
| sporting-goods | `sensitive_membership_details` | `sports:sensitive:read` |
| workforce | `sensitive_payroll_details` | `workforce:sensitive:read` |

Add a corresponding chip to each vertical's `manifest.json` chips10 array alongside the existing HITL chip.

### 2d. Education paths generalized

Move `api_key_demo` and `dual_token_demo` out of `demo_api_server/config/verticals/banking/index.js` heuristics into a shared cross-vertical routing table (e.g. a `sharedHeuristics` or `educationRoutes` object imported by all vertical index files). No new UI — rendering already exists.

### 2e. Architecture sim accuracy pass

Audit `demo_api_ui/src/config/architecture-sim-scenarios.js` against the live implementation.

Known issues to fix:
- `mcp-tool-call` steps 5–6: "token forwarded to MCP server" step is present but no step shows tool result returned — add a result-return step.
- `mcp-tool-call` step 3: scenario says "BFF → MCP Gateway" but does not show the RFC 8693 exchange as a sub-step — split into exchange step + forward step.

New scenario to add:
- **HITL consent gate** — shows the 428 pause, consent prompt in the browser, user approve/deny, and BFF resuming the tool call.

---

## Success Criteria

**Phase 1 done when:**
- Making any MCP tool call on any vertical shows `mcp-tool-invoked` → `mcp-tool-result` in the token chain panel
- When CC token is absent, chain shows `agent-actor-token-unavailable` with `degraded` status instead of silent fallback
- Exchange step shows collapsible request body
- `npm run build` in `demo_api_ui/` exits 0

**Phase 2 done when:**
- Agent tool calls on healthcare, retail, sporting-goods, workforce all produce token chain events end-to-end (2a gate)
- `/admin/healthcare`, `/admin/retail`, `/admin/sporting-goods`, `/admin/workforce` routes exist and render vertical-specific ops (2b)
- `sensitive_patient_records` (and equivalents) trigger HITL gate on their respective verticals (2c)
- `api_key_demo` and `dual_token_demo` are reachable from any vertical's agent (2d)
- `mcp-tool-call` sim scenario shows result-return step; HITL scenario added (2e)

---

## Out of Scope

- Live token events driving the architecture sim (confirmed scripted-only)
- RFC 7009 token revocation in normal flows
- Two-exchange path UI clarity improvements (deferred)
- New vertical personas or dashboard types
