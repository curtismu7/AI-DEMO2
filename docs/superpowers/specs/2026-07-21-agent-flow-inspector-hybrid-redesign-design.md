# Agent Flow Inspector — Hybrid-Tree Redesign

**Date:** 2026-07-21
**Status:** Approved (revised after full-file research — see "Revision note"), ready for implementation planning

## Revision note

The first version of this spec assumed `UnifiedTokenFlowInspector` was a single
two-pane view. Reading the full 1155-line file (plus its dependencies)
surfaced two facts that change the design:

1. The component already has **3 top-level tabs**: "Flow & Tokens" (the
   two-pane trace/claims view the mockups targeted), "Token Chain" (embeds
   `TokenChainTraceRail`), "Token Transform" (2-field gateway-in/backend-out
   view).
2. `TokenChainTraceRail` is not local to this component — it's a shared
   component used in **25+ other places** (`Dashboard.js`, `TokenChainModal.js`,
   `VerticalOpsConsole.jsx`, `agent-clinical/TokensPane.jsx`, vertical demo
   pages, etc.), backed by its own store (`tokenChainTraceStore`) with its own
   chain/mcp/trust sub-tabs. Folding its trace logic into new tree nodes would
   duplicate a widely-shared subsystem and risk drifting from what every other
   consumer sees.

Decision (confirmed): **only the "Flow & Tokens" tab's content is redesigned.**
"Token Chain" and "Token Transform" stay exactly as they are today — same
top-level tabs, same components, unchanged. This is a much smaller, safer
change than "replace all 3 tabs" implied.

## Context

`/agent-flow-inspector` renders `UnifiedTokenFlowInspector.jsx`
(`demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx`, 1155 lines).
Structure today:

- Outer wrapper: `useDraggablePanel` + `showToggle`/`floatingByDefault` props,
  float-vs-dock chrome, close button, "📋 Token Legend" button — all outside
  the tab system, applies to whichever tab is active.
- 3 tabs: **Flow & Tokens** (default) / **Token Chain** / **Token Transform**.
- **Flow & Tokens** tab = `AgentFlowSection` (left) + `OAuthInspectorSection`
  (right), side by side:
  - `AgentFlowSection`: `SecurityGuaranteeBanner`, a credential-path ribbon,
    `TokenFlowDiagram` (static RFC reference diagram, always shown),
    `TokenExchangeFlowDiagram` (toggle-shown), a simple numbered step list, a
    "Detailed Step Breakdown" built from `STEP_DETAILS`
    (`demo_api_ui/src/data/stepDetails.js` — **static, canned RFC-walkthrough
    content, identical every session**), and a clickable "Current Token Chain"
    list fetched live from `GET /api/token-chain/current` into `tokenChain`
    state (selecting one calls `onSelectToken`).
  - `OAuthInspectorSection`: fetches `/api/auth/oauth/user/status` +
    `/api/tokens/session-preview`, renders `TokenCardGrid`, `TokenCard`, and
    an accordion of `ClaimRow`s (Identity, Authorization, Token Exchange &
    Scopes — `TokenExchangeModeSummary` + `ScopeChangesCallout` +
    `tokenExchangeEvents` timeline, Account Information). Reacts to
    `selectedToken` (passed down from the tab body) to show that token's
    claims instead of the default user token.
- **Token Chain** tab = `<TokenChainTraceRail />` — untouched by this spec.
- **Token Transform** tab = two `ClaimRow`s (gateway-in audience vs
  backend-out audience) sourced from `useTokenChainOptional()` +
  `useGatewayLiveConfig()` — untouched by this spec.
- `ClaimDetailsModal` and `TokenLegendModal` render at the bottom, controlled
  by state in the main component (`showClaimsModal`/`showLegendModal`).

Live step data comes from `agentFlowDiagram`
(`demo_api_ui/src/services/agentFlowDiagramService.js`), a subscribable
singleton: `getState()` returns `{ visible, phase, toolName, steps, hint,
updatedAt, ... }`; `steps` is the array `buildCompletedSteps()` produces per
completed tool call (`id`, `title`, `detail`, `status: 'pending'|'done'|'error'`).
It also exposes `open()`, `close()`, `reset()`.

This spec redesigns the **Flow & Tokens tab's content** onto `InspectorShell`
(`demo_api_ui/src/components/shared/InspectorShell.jsx`) — the topbar + 3-col
(left tree / middle detail / right tabs) layout already used by
`McpInspectorPage.jsx`, `AgentGatewayTester.jsx`, `PingOneAuthorizePage.jsx` —
following the "hybrid tree" direction validated against three HTML mockups.

## Goals

- Replace the **Flow & Tokens tab's** internal layout with an `InspectorShell`
  instance: left = a tree mixing live flow **steps** (from
  `agentFlowDiagram.getState().steps`) and the **tokens** minted this session
  (from the existing `tokenChain` fetch), grouped by phase; middle = adaptive
  detail pane; right = tabbed output.
- Add a persistent status bar (step count / denied count / tokens-minted
  count, Prev/Next tree navigation, a "Clear" button wired to the existing
  `agentFlowDiagram.reset()`) between the topbar and the grid.
- Preserve every capability the tab has today — restructuring, not a feature
  cut: `SecurityGuaranteeBanner`, `TokenExchangeModeSummary`,
  `ScopeChangesCallout`, `TokenLegendModal`, `ClaimDetailsModal`, `TokenCard`,
  `TokenCardGrid`, `TokenFlowDiagram`, `TokenExchangeFlowDiagram` all keep
  working, just re-homed into the new layout's slots.
- Keep working in both places `UnifiedTokenFlowInspector` is embedded (see
  "Embedding" below) and in both floating and docked mode.

## Non-goals

- **"Token Chain" and "Token Transform" tabs are unchanged** — same
  components (`TokenChainTraceRail`, the two `ClaimRow`s), same tab bar
  position, no visual or behavioral change. Flagging this explicitly since an
  earlier draft of this spec assumed otherwise.
- No changes to `TokenChainTraceRail`, `tokenChainTraceStore`, or any of its
  25+ other consumers.
- No changes to how token-chain data is fetched or computed — `tokenChain`
  (`GET /api/token-chain/current`), `tokenClaims`/`tokenExchangeEvents`
  (`/api/tokens/session-preview`), `agentFlowDiagram`, and the RFC
  claim-decoding logic (`CLAIM_GLOSSARY`, `ClaimRow`, `getEventAudience`) are
  reused as-is.
- No new "replay a past session" feature. The mockups' "Re-run flow" button
  is dropped — there's no existing capability to re-execute a past agent
  action, and adding one is new functionality outside this redesign's scope.
  The status bar's "Clear" button instead wires to `agentFlowDiagram.reset()`,
  which already exists and already backs a near-identical "Clear" button on
  `TokenChainTraceRail`.
- No changes to `InspectorShell.jsx`, `InspectorTabs.jsx` themselves beyond
  what's needed to render tree nodes that mix two types (step / token) — see
  "New shared pieces" below.

## Where this changes things

| Site | Props today | After redesign |
|---|---|---|
| `/agent-flow-inspector` (`MonitoringRoutes.js` → `AgentFlowInspectorRoute`) | `floatingByDefault={false} showToggle={true}` | Same wrapper/props; the Flow & Tokens tab's docked content is now the new `InspectorShell` layout |
| `DevToolsDashboard.jsx` "Inspector" tab | `floatingByDefault={false} showToggle={false}` | Same; docked-only, no floating chrome |

(`REGRESSION_PLAN.md` §1 lists a third site, Clinical Split's `TokensPane.jsx`
— that row is stale: `TokensPane.jsx` renders `TokenChainTraceRail` directly,
not `UnifiedTokenFlowInspector`. Out of scope; the stale row is a one-line fix
but not part of this change.)

## Floating / draggable — kept

`useDraggablePanel` and the `showToggle` float/dock toggle stay exactly as
they are — they wrap the whole tab system today and continue to. Only the
Flow & Tokens tab's docked content changes.

## Embedding — full-page vs. tab-panel

`InspectorShell` already has a `fullHeight` prop: `true` → `calc(100vh - 45px)`
for a standalone route, `false` → a fixed 640px for a shell embedded inside a
taller scrolling page (added for a different case — a page with siblings
above/below, not a same-height-as-parent tab).

- `/agent-flow-inspector` (standalone route) → `fullHeight={true}`.
- `DevToolsDashboard`'s tab (`height: 100%, overflow: auto` container) needs
  the shell to fill its parent's height, not a fixed 640px or 100vh. This
  spec adds a third value, `fullHeight="fill"`, applying `height: 100%` — an
  additive CSS class alongside the existing two, not a change to either.

## Tree structure (left column, Flow & Tokens tab only)

Nodes come from two existing live sources, interleaved by insertion order
(steps and their related token both belong to the same phase group):

- **Step nodes** — one per entry in `agentFlowDiagram.getState().steps`
  (today: `as`, `agent`, `bff`, `mcp-gateway`, `pingauthorize`, `mcp`, `tool`
  — see `buildCompletedSteps()`). Each has `id`, `title`, `detail`, `status`.
  `status: 'error'` renders with the same red-state treatment the current
  step list already uses (`statusBadge()`).
- **Token nodes** — one per entry in the `tokenChain` array (already fetched
  from `GET /api/token-chain/current` by `AgentFlowSection` today), each with
  `id`, `tokenType`, `timestamp`, `tokenSub`, `tokenAct`. Selecting one is the
  existing `onSelectToken(token)` call, unchanged.
- **Phase grouping**: bucket the 7 known step ids into 4 groups for the tree
  headers — `AUTHENTICATION` (`as`), `AGENT & GATEWAY` (`agent`, `bff`,
  `mcp-gateway`), `AUTHORIZATION` (`pingauthorize`), `TOOL EXECUTION` (`mcp`,
  `tool`). Any step id not in this map (future additions) falls into a 5th
  `OTHER` group rather than being dropped — keeps the mapping from silently
  losing new steps.
- **Token placement — corrected from the original mock.** `buildCompletedSteps()`
  step objects carry no `timestamp`, only a fixed pipeline order, so true
  chronological interleaving of steps and tokens isn't implementable. Token
  nodes instead render in their own trailing group, `TOKENS MINTED`, sorted by
  their real `timestamp` ascending — honest to what the data actually
  supports, while still satisfying "the tree mixes steps and tokens."

STEP_DETAILS (the static RFC walkthrough) is **not** tree data — its content
moves to the right column's Glossary tab (see below).

## Middle column — adaptive detail

- **Step node selected**: `title`, `detail`, `status` — the same fields the
  current numbered step list (`utfi-steps`) already renders, just laid out as
  `InspectorShell` field rows instead of a list row.
- **Token node selected**: exactly what `OAuthInspectorSection` already
  computes into `tokenClaims`/`payload` when `selectedToken` is set — no new
  derivation logic, just rendering it in the middle slot instead of triggering
  a re-render of the whole right pane.

## Right column — tabs

| Tab | Source (existing, reused) |
|---|---|
| Claims | `TokenCardGrid`, `TokenCard`, `ClaimRow` accordion (Identity, Authorization) — from `OAuthInspectorSection` |
| Token Exchange | `TokenExchangeModeSummary` + `ScopeChangesCallout` + the `tokenExchangeEvents` timeline — from `OAuthInspectorSection`'s existing "Token Exchange & Scopes" section |
| Diagram | `TokenFlowDiagram` + `TokenExchangeFlowDiagram`, unchanged |
| Raw | Pretty-printed JSON of the selected node via `JsonHighlight`, same as today's raw-JSON accordion |
| Glossary | `STEP_DETAILS` (the static RFC walkthrough, moved here from tree nodes) + `CLAIM_GLOSSARY` |

`SecurityGuaranteeBanner` renders as a strip between the topbar/status bar and
the grid — same relative position it has today (top of `AgentFlowSection`).
`TokenExchangeModeSummary`'s parent accordion and `ScopeChangesCallout` move
into the "Token Exchange" tab above rather than being cut, per the "preserve
every capability" goal.

`TokenLegendModal` and `ClaimDetailsModal` keep their existing trigger points
("📋 Token Legend" topbar button, `onOpenClaimsModal` from `TokenCardGrid`'s
Inspect buttons) — no change to either modal or how they're opened.

## New shared pieces

- **`InspectorReplayBar`** (new, `demo_api_ui/src/components/shared/`) — the
  persistent counters + Prev/Next/Clear strip. Takes counts and handlers as
  props; no knowledge of token-chain or step data shapes, so it's reusable by
  any future `InspectorShell` page.
- **`kind` prop on `InspectorListItem`** — currently renders one visual shape
  (dot + label + badges). Adding `kind: 'step' | 'token'` switches the icon
  (`●` vs `▮`) and error-state coloring. Additive prop; its two existing
  callers (`McpInspectorPage.jsx`, `AgentGatewayTester.jsx`) are unaffected
  since they don't pass it (defaults to `'step'`'s current dot-only look).
- **`fullHeight="fill"` on `InspectorShell`** — new CSS modifier
  (`inspector-shell-grid--fill { height: 100%; }`) alongside the existing
  `true`/`false` handling, for the `DevToolsDashboard` embed.

## Testing

- `UnifiedTokenFlowInspector.test.jsx` (currently 26 lines, one test for the
  Token Transform tab) gets a new test for the Flow & Tokens tab's tree
  rendering and step/token selection, using the same
  `ExchangeModeProvider`-wrapped render pattern it already uses. The existing
  Token Transform test is untouched (that tab doesn't change).
- New tests for `InspectorReplayBar` and the `kind`-aware `InspectorListItem`,
  following `InspectorShell.test.jsx`'s pattern (render + `screen`/`container`
  queries, no snapshot tests).
- Manual verification: both embed sites (`/agent-flow-inspector` docked +
  floating, `DevToolsDashboard`'s Inspector tab) against a real signed-in
  session including a `status: 'error'` step (e.g. a denied tool call) to
  confirm the red-state styling survives the move; confirm Token Chain and
  Token Transform tabs are pixel-identical to before.
- UI build gate (`REGRESSION_PLAN.md` §0/§1 process) before calling this done.

## Open items for the implementation plan

- Exact prop contract for `InspectorReplayBar`.
- Confirm no other caller of `InspectorShell` currently passes a truthy
  non-boolean to `fullHeight` before adding the `"fill"` string value (grep
  during planning).
