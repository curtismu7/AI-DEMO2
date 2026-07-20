# Agent Lifecycle Demo — Design

**Date:** 2026-07-20 (revised same day after implementation research)
**Status:** Approved (design), pending implementation plan
**Vertical:** retail
**Scope:** one new showcase page, almost entirely composed from existing,
already-working subsystems. Zero new backend routes except a 2-line additive
read on an existing one.

## Goal

Demonstrate a full AI-agent access lifecycle in the retail vertical, as four
observable steps on one page:

1. Register an AI agent and have a user delegate account access via a scoped
   consent screen.
2. Have the agent call a protected MCP server/API using a scoped, revocable
   token.
3. Trigger human step-up approval (CIBA / push) for a sensitive action (a
   retail purchase).
4. Have the user revoke the agent from a self-service portal; show the token
   stops working immediately and an audit entry is created.

## Revision note

The original version of this spec planned real per-agent PingOne app
registration (new backend route, PingOne Management API call, extended
delegation schema) for step 1. That is now **out of scope**: step 1 is
represented by a pre-recorded walkthrough video instead of live registration
(no first-class "AI agent" PingOne app type exists in the repo today, and
building one is a separate, larger effort). Steps 2–4 turned out to need
**no new backend code at all** — every capability they demonstrate already
runs end-to-end through existing routes; this page only had to compose UI
around calls that already work.

## Existing coverage (confirmed by codebase research)

| Step | What it uses | Status |
|---|---|---|
| 2 | `POST /api/mcp/tool` → RFC 8693 exchange → MCP gateway (same path every chip click already uses) | Fully built, zero new backend |
| 3 | Retail `checkout` tool (`config/verticals/retail/tools.js`) + amount-threshold gate → 428 `mcp_step_up_required` w/ `step_up_method: 'ciba'` for `useCaseId: 'ciba-out-of-band-approval'` (`mcpToolAuthorizationService.js`) + `POST /api/auth/ciba/initiate` / `GET /api/auth/ciba/poll/:authReqId` (`routes/ciba.js`) | Fully built, zero new backend — new page-local orchestration copies the existing `AIAgent.js` CIBA initiate/poll/retry pattern, since that logic is inlined in `AIAgent.js` and not otherwise reusable |
| 4 | `POST /api/admin/agent/:agentId/kill-switch` (`killSwitchService.js` — RFC 7009 revoke + PingOne app disable + session/Redis invalidation), same call `ControlPlaneRoster.jsx` already makes for its "live" row | Fully built, zero new backend |
| audit | `GET /api/mcp/audit` reads `mcpAuditStore.lmdb` — durable, auto-populated by every MCP gateway tool call, already what `AuditPage.js` renders | Fully built; one additive 2-line change so the page can deep-link with the agent pre-filtered |
| 1 | No first-class "AI agent" PingOne app type / registration flow exists anywhere in the repo | Genuinely missing — represented by a pre-recorded video, not built |

`delegated-access-with-proof` (UC1) is a separate, unrelated read-only demo
(proves `act=` attribution via one read call). Not touched by this work. The
uncommitted deletions of its banking/retail goldens in the working tree are
local WIP from an unrelated golden recapture.

## Non-goals

- Not building real per-agent PingOne app registration or a scoped-consent
  grant flow (step 1) — deferred indefinitely, represented by video.
- Not modifying UC1 or its goldens.
- Not modifying `delegationService.js`, `delegation.js`, or the
  human-to-human delegation flow (`DelegationPage.js`) — no longer needed
  once step 1 became a video.
- Not adding a new authz gate for retail checkout — the existing
  amount-threshold STEP_UP/HITL/CIBA classifier is used exactly as-is.
- Not changing `killSwitchService.js` semantics. Reusing it means clicking
  "revoke" on this page ends the demo user's own logged-in session (the same
  behavior `ControlPlaneRoster.jsx`'s "live" row already has) — this is the
  real, honest kill-switch behavior, not a bug to work around.

## Architecture

### New page: `/agent-lifecycle`

`demo_api_ui/src/pages/AgentLifecyclePage.jsx`, four sections top-to-bottom:

```
Slot 1  <video>                     — pre-recorded registration+consent walkthrough
Slot 2  "Call MCP as agent" button  — POST /api/mcp/tool { tool:'list_orders' } + <TokenChainTraceRail/>
Slot 3  "Checkout $600" button      — POST /api/mcp/tool { tool:'checkout', useCaseId:'ciba-out-of-band-approval' }
                                       → page-local CIBA initiate/poll/retry
Slot 4  "Revoke agent access"       — POST /api/admin/agent/:agentId/kill-switch (reused KillSwitchConfirmModal)
                                       → retry slot 2's call to prove failure
                                       → link to /audit?agentId=<id>
```

Route added in `App.js` mirroring the existing `/delegation` route (same
nested `<Routes>` block, same `user ? <Page/> : <Navigate to="/"/>` guard, no
`TopNav`/layout wrapper needed — the outer catch-all route already supplies
that). Nav entry added to `AdminSideNav.jsx` mirroring the existing
`/delegation` entry.

### Slot 1 — pre-recorded video

`demo_api_ui/public/media/contractor-lcm-ai-agent.mp4` (copied from the
user's local `Contractor_LCM_AI_Agent.mp4`, 70.7MB, committed to git per
explicit confirmation — this permanently grows repo history by that size).
Plain `<video controls>` embed, no backend.

### Slot 2 — scoped MCP call (reuse)

Calls `callMcpTool('list_orders', {}, { vertical: 'retail' })`
(`demo_api_ui/src/services/demoAgentService.js`) — the exact function every
existing chip click uses. `list_orders` is a `scopes:['read']`, `authz:{}`
retail tool (no consent/step-up gate), distinct from `checkout`. Renders
`<TokenChainTraceRail />` inline (no props — it's a self-updating singleton
store subscriber, already used this way on `Dashboard.js`) to show the live
RFC 8693 exchange, plus the returned order list.

### Slot 3 — step-up on purchase (reuse gate, new page-local orchestration)

Calls `POST /api/mcp/tool` directly (not through `callMcpTool`, which drops
the `step_up_method` field the CIBA branch needs — confirmed by reading
`demoAgentService.js`'s error-normalization path) with
`{ tool: 'checkout', params: { product: 'Headphones', amount: 600 }, useCaseId: 'ciba-out-of-band-approval', vertical: 'retail' }`.
On a 428 body with `error === 'mcp_step_up_required'` and
`step_up_method === 'ciba'`, the page replicates `AIAgent.js`'s existing
initiate → show pending → poll → retry sequence
(`POST /api/auth/ciba/initiate`, `GET /api/auth/ciba/poll/:authReqId` every
`interval` seconds, retry the original checkout call on `status: 'approved'`)
— this exact sequence is inlined in `AIAgent.js` and not exposed as a
reusable hook/component, so the plan copies the pattern rather than
extracting a shared one (out of scope: no `AIAgent.js` refactor).
`CIBAPanel`/`CibaStepUpFlowPanel` were considered but don't fit: neither
subscribes to `/api/mcp/tool` responses or exposes a way to drive them from
outside the chat flow.

### Slot 4 — self-service revoke + proof + audit (reuse)

Fetches `GET /api/admin/control-plane/agents` (`controlPlaneApi.getAgents()`)
to get `live.id` (the real agent identity backing the session — same value
`ControlPlaneRoster.jsx` uses, `"demo-agent"` in the current fixture/config).
Reuses `<KillSwitchConfirmModal agentId={live.id} onConfirm={...} />` exactly
as `ControlPlaneRoster.jsx` does, calling
`POST /api/admin/agent/:agentId/kill-switch`. This is the demo user's own
session being killed (real semantics, matches existing precedent) — the page
states this plainly before the click. Immediately after, the page retries
slot 2's `list_orders` call inline and shows it fail. A link to
`/audit?agentId=demo-agent` lets the user view the resulting audit entry
(after re-authenticating, since the session that made the call is now dead —
same limitation `ControlPlaneRoster.jsx` already lives with).

## Additive backend change

`demo_api_ui/src/components/AuditPage.js:119` — seed `filterAgentId`'s
initial state from an `agentId` query-string param (mirrors the existing
`popout` param read at line 111), so the deep-link from slot 4 pre-filters
without requiring the user to manually re-select it. No server-side change —
`GET /api/mcp/audit` already accepts `agentId` as a query param.

## Revision 2 (2026-07-20, post-launch)

Two follow-ups after the page shipped (PR #650/#651) and was live-verified.

### Finding: slot 2 502'd — not a code bug

Live testing (logged in as `demoUser`, clicked "Call list_orders as agent")
returned `502` / `actor_token_invalid` ("The actor token is invalid or
expired."). Root cause: PingOne app **"Demo AI App - AI Agent Actor"**
(`71e878ea-2d79-4760-b570-66f00cbeffe7`, env `01d89b06`) was `enabled: false`
— `killSwitchService.disableAgentApplicationsAtPingOne()` disabled it during
earlier slot-4 (Revoke) testing; per that function's own doc comment "the
agent stays disabled until an admin re-enables it in PingOne," and nothing
had. Re-enabled via PingOne MCP (`updateApplication enabled:true`); slot 2
now returns `200` with a full 12-step green pipeline. `demo_api_ui`'s
`callMcpTool('list_orders', ...)` call itself was already correct exactly
per the original spec — no application code changes needed for this part.
Documented here so a future "revoke leaves the demo broken" report knows
the fix is re-enabling that PingOne app, not touching this page's code.

### Layout: persistent Agent + Token Chain rail on the right

Original layout (single column, `<TokenChainTraceRail/>` embedded only
inside slot 2) doesn't let the user watch the agent/rail live across all
four steps. Restructure `AgentLifecyclePage.jsx` to match the existing
`/use-cases/live` (`LiveUseCaseWorkbenchPage.js`) two-column pattern:

- **Left column:** the same four slots, unchanged internal logic.
- **Right column (persistent across all slots):** the real singleton
  `<AIAgent>` widget, hosted via the existing `useAgentUiMode()` /
  `setSurfaceHostEl()` mechanism (`AgentUiModeProvider` already wraps the
  whole app in `App.js`, so this page can call the hook exactly as
  `LiveUseCaseWorkbenchPage.js` does — no provider changes needed), stacked
  with `<TokenChainTraceRail/>` below/beside it. Same flex layout as
  `.luw-run-layout`/`.luw-agent-host`/`.luw-rail-host` in
  `LiveUseCaseWorkbenchPage.css`, ported into `AgentLifecyclePage.css` under
  `alp-`-prefixed class names to match this page's existing naming.
- Remove the inline `<TokenChainTraceRail/>` currently duplicated inside
  `ScopedCallSlot` (slot 2) — one persistent rail on the right replaces it.

No backend changes. No new dependencies — reuses `AIAgent`,
`TokenChainTraceRail`, and `useAgentUiMode` exactly as `LiveUseCaseWorkbenchPage.js`
already does.

## Testing / verification plan

- Unit (Vitest, `demo_api_ui`): `AuditPage.js`'s query-param seeding; new
  `AgentLifecyclePage.jsx` slot components (render + interaction, mocking
  `demoAgentService`/`controlPlaneApi`/`fetch`, following the existing
  `ControlPlaneRoster.test.jsx` pattern).
- Manual/live verification: run the local stack, walk all four slots in a
  browser (per `verify`/`webapp-testing` skills) — this page's real value is
  demonstrated against the live BFF/gateway/PingOne pipeline, not mocks. Two
  points flagged as needing live confirmation during implementation rather
  than static analysis: (a) the exact JSON shape of `list_orders`' result on
  the wire (`data.result` vs `data.result.content[0].text` — code will handle
  both defensively, confirm which one the running stack actually returns);
  (b) that reusing `killSwitchService` for slot 4 does disable the specific
  PingOne agent app used in slots 2/3 (it targets fixed env-configured
  `AGENT_CLIENT_ID`/`PINGONE_AI_AGENT_CLIENT_ID` — confirm this is the same
  identity the retail MCP calls actually exchange through).
- Regression: no existing route, service, or component's behavior changes —
  `AuditPage.js`'s change is purely additive (empty query param preserves
  current behavior exactly). Per `REGRESSION_PLAN.md` §1 this still touches a
  protected UI area (`AuditPage.js`) — run `regression-guard` before/after.
