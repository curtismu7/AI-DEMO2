# Token Chain Trace Rail — Design Specification

**Date:** 2026-07-02
**Status:** Draft — pending user review
**Supersedes (for portal embeds only):** `2026-06-30-token-chain-redesign.md`
**Interactive mock:** `2026-07-02-token-chain-trace-rail-mock.html` (open in a browser; v3)

---

## Problem

The redesigned `UnifiedTokenFlowInspector` was embedded into the customer/admin
portal token rails (branch `worktree-token-inspector-portal-embeds`, commit
`0e3a9bf89`). The user rejected it:

1. **Wrong look** — generic white-card styling clashes with the portal brand
   (navy headers, brand vars) that the rail and the old `TokenChainDisplay` used.
2. **Not accordion-first** — sections load expanded; the spec called for a
   collapsed summary + accordion style.
3. **Not a complete trace** — it shows a 4-step abstraction. A learner needs
   **every hop**: chat prompt, agent, LLM, tokens, exchange, PingOne Authorize,
   gateway, MCP server, resource API, reply — each with the actual request,
   response, and security detail.

## Goal

A new, purpose-built **`TokenChainTraceRail`** component that lives in the
portal token rails (same space as the old `TokenChainDisplay`), renders the
**full end-to-end pipeline** of the most recent agent action as expandable
step cards, and teaches every detail of what happened — request payloads,
responses, policy decisions, token transformations.

## Non-Goals

- No change to the full-page `/agent-flow-inspector` (`UnifiedTokenFlowInspector`).
- No change to `/monitoring/token-chain` (`TokenChainDisplay` remains).
- No change to authorization/policy logic — presentation and event plumbing only.
- No new polling loops beyond what the existing services already do.

---

## Approach (chosen: B)

- ~~A. Keep patching `UnifiedTokenFlowInspector`~~ — two-pane layout and styling
  are the rejected parts; retrofit costs more than a rebuild.
- **B. New compact component + unified trace store (chosen)** — built for the
  380px rail; reuses `ClaimDetailsModal`, `TokenLegendModal`, `TokenCard` colors.
- ~~C. Restyle legacy `TokenChainDisplay`~~ — 4,700-line component; the step-trace
  model doesn't fit its structure.

---

## 1. Placement & Layout

Embed points (identical rails/cards; `ExchangeModeToggle` mode-switcher buttons
stay above, its explanatory table moves into an accordion inside this component):

| Portal | File | Sites |
| --- | --- | --- |
| Customer | `demo_api_ui/src/components/UserDashboard.js` | 3 (middle / split / float layouts) |
| Customer 2026 | `demo_api_ui/src/components/UserDashboardPing2026.js` | 3 |
| Admin | `demo_api_ui/src/components/Dashboard.js` | 1 |
| Agent chat / floating agent | `demo_api_ui/src/components/TokenChainModal.js` (body swap; draggable shell kept) | 1 — used by the "Token Chain" toggle in `AIAgent.js`, incl. the floating-agent FAB |

The floating-agent case reuses the exact same component: `TokenChainModal`
keeps its `DraggableModal` shell and renders `<TokenChainTraceRail />` instead
of `TokenChainDisplay hideHeader`. One component, identical everywhere.

### Customer Dashboard 2026 — rail moves to the right

Approved layout change (mock: `2026-07-03-dashboard-2026-layout-mock.html`,
approved 2026-07-03): on `UserDashboardPing2026` the token rail moves from the left
grid column to the **right** column. Left-to-right order becomes
**Side Menu | Agent | Token Chain** — the agent is the main event, the trace
is the evidence panel beside it. This is a grid/order change only (the
`ud-token-rail` aside moves to the last column; agent column shifts left);
no component API changes. The classic `UserDashboard` and admin `Dashboard`
keep their existing column positions.

Rail structure top-to-bottom (see mock v3):

1. **Exchange-mode bar** (existing dark switcher, compact segmented control —
   role table removed from it)
2. **Navy header bar** — `🔗 Token Chain` + `Legend` button (opens modal)
3. **Chain summary line** — `● User → ● Agent → ● MCP  [CHAINED]` (colored dots,
   mode badge)
4. **Pipeline** — one native `<details>` card per step, ALL collapsed on load
5. **Token Summary accordion** (see §4)
6. **Exchange Mode Details accordion** (the role table that left the dark bar)

Styling: portal brand variables (`--brand-navy`, `--brand-navy-deep` header
bars, `--brand-light-gray` card bodies), token colors kept (pink/purple/green),
actor lane chips per step. No viewport media queries for stacking — the
component is single-column by construction.

## 2. Step Model

Steps stream in as the action progresses (status: pending `·`, running `⏳`,
done `✓`, denied `✗`). Happy path (11 steps):

| # | Step | Lane | Key content when expanded |
| --- | --- | --- | --- |
| 1 | Sign-in — User Token acquired | PINGONE | OIDC code+PKCE token request/response; inline **User Token card** |
| 2 | Chatbot — prompt sent | CHAT | Actual `POST /api/agent/run` body; note: cookie only, no tokens in browser |
| 3 | Agent service receives | AGENT | History load, tool catalog + scope map from gateway |
| 4 | LLM — reasoning & tool choice | LLM | Actual chat-completions request (model, system prompt, tools), tool_call response, token counts, "LLM never holds a token" |
| 5 | Agent identity token | BFF | client_credentials request; inline **Agent Token card** |
| 6 | Token exchange — delegation | BFF | Full RFC 8693 request/response, **scope diff** (`read write` → `write`), `act` chain proof; inline **Delegated Token card** |
| 7 | PingOne Authorize — policy decision | AUTHZ | See §3 — every detail |
| 8 | Agent Gateway — token validated | GATEWAY | Validation checklist: signature/JWKS kid, aud (RFC 8707), scope ⊇ tool requirement, act chain |
| 9 | MCP server — tool executes | MCP | JSON-RPC `tools/call` request/response; what the server did |
| 10 | Resource server — API call | API | Actual banking API request (bearer = delegated token) + response |
| 11 | LLM composes reply → chat | LLM | Tool-result message to LLM; streamed reply text |

Conditional steps (rendered only when they occur, in flow order):

- **7a. Step-up required (HITL/CIBA/MFA)** — after 7 when P1AZ returns
  step-up: challenge type, ACR requested, approval outcome, re-fire.
- **Denial steps** — P1AZ DENY (red card: decision detail + why), gateway 403
  scope denial (`required_scopes`, `challenge_type` recovery metadata),
  introspection-inactive. Rendered with `✗` and recovery guidance.

Card template (every step): **What happened** (2-3 sentence narrative) →
**Actual request** (method, URL, headers-of-interest, body) → **Actual
response** (status, body) → **Security detail** (scope diff / decision /
validation checks / claims links) → RFC chips. `→ Inspect claims` links open
`ClaimDetailsModal`.

## 3. PingOne Authorize Card — Every Detail

Data (all already present in the BFF — `transactionAuthorizationService.js`,
`pingOneAuthorizeService.js` — today only console-logged):

- **Engine**: `pingone` | `simulated` | failover mode applied
  (`fallback_simulated` / `deny` / `permit`)
- **How it was called**: exact URL
  (`POST {apiBase}/v1/environments/{envId}/decisionEndpoints/{endpointId}`),
  decision endpoint id, policy id **and policy name**
- **Request**: the full `parameters` object sent (Amount, TransactionType,
  UserId, agent id, acr, tokenActive, DecisionContext, …)
- **Response (raw)**: `decision` (PERMIT/DENY/INDETERMINATE), `decisionId`,
  statements/obligations (via `authorizeObligations.js`), any attributes
- **Outcome**: matched rule summary, step-up required? method (CIBA/email/MFA)?
  ACR demanded?, link to the step-up step when one fired
- **Correlation**: `decisionId` shown so it can be found in PingOne audit /
  `getRecentDecisions`

## 4. Tokens — Inline + End Summary

**Inline**: each token card renders under the step that created it (1: User,
5: Agent, 6: Delegated), color-coded with `Inspect` button.

**Token Summary accordion (end of pipeline)**: every token in the flow, each
with its **unique name** and full key claims — and **how it changed** across
the flow:

```text
User Token        sub: user-123 · scope: read write · aud: banking-api · acr: MFA
Agent Token       sub: agent-001 · client_credentials · aud: banking-api
Delegated Token   sub: user-123 · act.sub: agent-001
   changes:       scope  read write → write (narrowed)
                  aud    banking-api → mcp-gw.ping.demo (rebound, RFC 8707)
                  act    — → {sub: agent-001} (delegation proof added)
                  exp    3600s → 300s (shortened)
```

Per-token `Inspect` opens the full claims modal (claim + value + RFC
explanation). The change rows are computed by diffing the claims of the token
against its parent in the chain.

## 5. Data Contract

**UI: one trace store** (`tokenChainTraceStore.js`) merging sources that
already exist, keyed by a per-action trace id:

| Source | Steps fed | Exists today? |
| --- | --- | --- |
| AG-UI event stream (agent service) | 2, 3, 4, 11 | Partially — needs LLM request/response detail payload |
| BFF `tokenEvents` phases (SSE on `/api/mcp/tool` / `/api/agent/run`) | 1, 5, 6, 7, 7a, 8, denials | Phases yes; **detail payloads need enriching** |
| MCP traffic feed (`McpTrafficPage` source) | 9, 10 | Yes |
| `/api/token-chain/current` | token claims for cards/summary | Yes |

**Emitter enrichment (server side, additive only):**

- **BFF**: attach sanitized detail objects to existing tokenEvents —
  `authorize_detail` (§3 payload), `exchange_detail` (request form minus
  actual token strings, response minus token string, scope before/after),
  `gateway_detail` (validation checks). **Sanitization rule: raw JWT strings
  are never sent — replace with `eyJ…` prefix + claims object.**
- **Agent service**: emit `llm_detail` (model, message roles + truncated
  content, tools count, tool_calls, token usage) on the AG-UI stream.

No new endpoints; no schema changes to persisted data.

## 6. Reused Components

`ClaimDetailsModal`, `TokenLegendModal` (portal to body — safe in the rail),
token color system, `ExchangeModeToggle` (switch buttons only). New files:
`TokenChainTraceRail.jsx` + `.css`, `tokenChainTraceStore.js`, step-card
subcomponents as needed.

## 7. Replacement Plan

The 7 dashboard embed sites currently render
`<UnifiedTokenFlowInspector floatingByDefault={false} showToggle={false} embedded />`
(commit `0e3a9bf89`); they switch to `<TokenChainTraceRail />`. The 8th site,
`TokenChainModal`, swaps its body from `TokenChainDisplay hideHeader` to
`<TokenChainTraceRail />`. The `embedded` prop/CSS on
`UnifiedTokenFlowInspector` is reverted (no remaining consumer).
Test mocks added for the inspector in the four dashboard test files switch to
mocking `TokenChainTraceRail`; the UserDashboard.js sha256 canary is
re-baselined once.

## 8. Success Criteria

- Rail loads collapsed: mode bar + navy header + chain line + step titles only.
- Driving a real agent transfer in the browser populates all 11 steps with
  live data; each expanded card shows actual request + response + security
  detail; P1AZ card shows engine, URL, parameters, raw decision, decisionId,
  policy id/name, statements.
- Step-up and denial paths render their conditional steps.
- Token Summary lists every token with unique name, full claims, and
  change rows (scope/aud/act/exp diffs vs parent token).
- No horizontal overflow at 320px; identical behavior at all 8 embed points
  (7 dashboard rails/cards + the agent-chat/floating-agent `TokenChainModal`).
- Customer Dashboard 2026 renders Side Menu | Agent | Token Chain, with the
  rail in the right column.
- No raw JWT strings in any browser-visible payload.
- Existing test suites pass; new unit tests cover trace-merge and claim-diff
  logic.

## Out of Scope

- Nav entry for `/agent-flow-inspector` (separate open follow-up).
- History of past traces (only the most recent action is shown; History tab
  ideas belong to the full-page inspector).
- Redesign of the agent-page floating Token Chain panel.
