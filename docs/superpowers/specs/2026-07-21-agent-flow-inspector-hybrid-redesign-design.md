# Agent Flow Inspector — Hybrid-Tree Redesign

**Date:** 2026-07-21
**Status:** Approved (mocks reviewed), ready for implementation planning

## Context

`/agent-flow-inspector` renders `UnifiedTokenFlowInspector.jsx`
(`demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx`, 1155 lines) — a
bespoke, self-contained panel: agent request-flow trace on one side, OAuth
token inspector (claims, scopes, RFC glossary) on the other, wrapped in
`useDraggablePanel` so it can float as a draggable window or dock inline.

It predates the shared `InspectorShell` component
(`demo_api_ui/src/components/shared/InspectorShell.jsx`) — a topbar + 3-column
(left tree / middle detail / right tabs) layout already adopted by
`McpInspectorPage.jsx`, `AgentGatewayTester.jsx`, and `PingOneAuthorizePage.jsx`.
That shell is this repo's homegrown version of the real MCP Inspector's tool
list → param form → tabbed response layout.

This spec redesigns `UnifiedTokenFlowInspector`'s content onto `InspectorShell`,
following the "hybrid tree" direction validated against three HTML mockups
(timeline-first, token-first, hybrid-tree). Mockups covered the shell/tree/tabs
structure only, with placeholder data — this spec maps that structure onto the
component's real, existing data sources. No new backend or data plumbing.

## Goals

- Replace `UnifiedTokenFlowInspector`'s internal layout with an `InspectorShell`
  instance: left = a tree mixing flow **steps** and the **tokens** they mint,
  grouped by auth phase; middle = adaptive detail pane (step fields or token
  claims, depending on node type); right = tabbed output.
- Add a persistent status/replay bar (steps / denials / total latency / tokens
  minted counters, plus Prev / Next / Re-run) between the topbar and the grid —
  the analog of MCP Inspector's always-visible connect/send controls.
- Preserve every capability the current component has today (see "Existing
  features carried over" below) — this is a restructuring, not a feature cut.
- Keep working in both places the component is embedded today (see
  "Embedding" below).

## Non-goals

- No changes to how token-chain data is fetched, computed, or exchanged.
  `useTokenChainOptional`, `agentFlowDiagramService`, `bffAxios`,
  `fetchEnrichedUserInfo`, `STEP_DETAILS`, and the RFC 8693 claim-decoding
  logic are reused as-is.
- No changes to `InspectorShell.jsx`, `InspectorTabs.jsx`, or
  `InspectorListItem.jsx` themselves beyond what's needed to render tree nodes
  that mix two types (step / token) — see "New shared pieces" below.
- Not touching `TokenChainTraceRail` (a separate component used by the
  Clinical Split "Tokens" tab) — that surface already has its own compact
  trace UI and is out of scope here.

## Where this replaces things

Confirmed via grep — the component is embedded in exactly two places (a third
reference, in `useGatewayLiveConfig.js`, is a comment, not an import):

| Site | Props today | After redesign |
|---|---|---|
| `/agent-flow-inspector` (`MonitoringRoutes.js` → `AgentFlowInspectorRoute`) | `floatingByDefault={false} showToggle={true}` | Same wrapper/props; docked mode is now the new `InspectorShell` layout |
| `DevToolsDashboard.jsx` "Inspector" tab | `floatingByDefault={false} showToggle={false}` | Same; docked-only, no floating chrome |

`REGRESSION_PLAN.md` §1 also lists a third site (Clinical Split's
`TokensPane.jsx`) — that row is stale: `TokensPane.jsx` currently renders
`TokenChainTraceRail`, not `UnifiedTokenFlowInspector`. Not in scope; flagging
the stale row is a one-line fix but not part of this change.

## Floating / draggable — kept

The existing `useDraggablePanel` wrapper and floating-window toggle
(`showToggle`) stay exactly as they are. Only the **docked** content changes —
today that's the two-pane trace/claims layout; after this change it's the
`InspectorShell` hybrid tree. Floating mode renders the same docked content
inside the draggable frame, same as it does today.

## Embedding — full-page vs. tab-panel

`InspectorShell` already has a `fullHeight` prop for exactly this: `true` uses
`calc(100vh - 45px)` for a standalone route, `false` uses a bounded height for
a shell embedded inside a taller scrolling page. The redesigned component
picks this the same way `UnifiedTokenFlowInspector` already knows its own
embedding context via its existing props:

- `/agent-flow-inspector` (standalone route) → `fullHeight={true}`.
- `DevToolsDashboard`'s tab (`height: 100%, overflow: auto` container) →
  `fullHeight={false}`, sized to fill the tab panel rather than a fixed 640px
  (today's `inspector-shell-grid--embedded` is a fixed 640px, added for a
  page-with-siblings case that doesn't apply here — this redesign adds a
  `100%`-height variant alongside it, not a change to the existing one).

## Tree structure (left column)

Grouped by auth phase, each phase expandable/collapsible, matching the
mockup's five phases:

1. **Sign-In** — step (PingOne OIDC) + token node (Customer Access + ID Token)
2. **Token Exchange · RFC 8693** — step (exchange request) + token node
   (exchanged, narrowed-scope, `act`-bearing token)
3. **Gateway Routing** — step only (no re-mint; audience already matches)
4. **Tool Calls** — one step node per tool call this session (success or
   denied — e.g. a step-up-required denial renders with the same red-dot
   treatment `UnifiedTokenFlowInspector` uses today)
5. **Response** — step (final status, DPoP validation) + token node (DPoP
   proof)

Step nodes source from the existing token-chain trace
(`useTokenChainOptional`) plus `STEP_DETAILS` static copy — the same sourcing
`StepDetailsSection` uses today. Token nodes source from the same claim data
`ClaimRow`/`CLAIM_GLOSSARY`/`hasAnyField`/`getEventAudience` already decode.

## Middle column — adaptive detail

- **Step node selected:** request-shaped fields (method, audience, actor,
  scopes requested/granted, latency, decision) — same fields
  `StepDetailsSection` renders today, re-homed into `InspectorShell`'s middle
  slot.
- **Token node selected:** decoded claim rows via the existing `ClaimRow`
  component, each key showing its `CLAIM_GLOSSARY` definition on hover exactly
  as today.

## Right column — tabs

Five tabs (four from the mock plus Scope Changes, restored per review):

| Tab | Source |
|---|---|
| Claims | Nearest-preceding minted token's claims (or the selected token's own, if a token node is selected) |
| Diagram | Full vertical phase/step/token list with the current selection highlighted — built from `agentFlowDiagramService` data, replacing today's separate `TokenFlowDiagram`/`TokenExchangeFlowDiagram` components with one unified view |
| Scope Changes | `ScopeChangesCallout`, unchanged, re-homed into this tab |
| Raw | Pretty-printed JSON of the selected node (step fields or token claims), via existing `JsonHighlight` |
| Glossary | `CLAIM_GLOSSARY` entries, unchanged |

## Existing features carried over

Per review, none of these are cut — they move, not disappear:

- **`SecurityGuaranteeBanner`** — renders as a strip between the topbar and
  the new replay bar, same as its position today.
- **`TokenExchangeModeSummary`** — becomes a topbar action button (next to
  Export/Re-run) that opens the same summary content in a popover, rather
  than living inline in the old layout.
- **`TokenLegendModal`** — becomes a topbar action button ("Legend") opening
  the existing modal, unchanged.
- **`ClaimDetailsModal`** — still opens on claim-row click for the deep-dive
  view, unchanged.

## New shared pieces

Two additions live in `demo_api_ui/src/components/shared/` alongside
`InspectorShell`/`InspectorTabs`/`InspectorListItem`, since both are generic
enough to be reused by a future InspectorShell page, not
`UnifiedTokenFlowInspector`-specific:

- **`InspectorReplayBar`** — the persistent counters + Prev/Next/Re-run strip.
  Takes counts and handlers as props; no knowledge of token-chain data shapes.
- **Tree nodes that mix two types** — `InspectorListItem` currently renders
  one visual shape (dot + label + optional badge). It needs a `kind` prop
  (`'step' | 'token'`) to switch the icon (`●` vs `▮`) and dot color rules,
  plus optional phase-group headers with collapse/expand. This is an additive
  prop, not a breaking change to its two existing callers.

## Testing

- `UnifiedTokenFlowInspector.test.jsx` (existing) gets updated for the new
  DOM structure — same behavioral assertions (claim rendering, scope
  narrowing, denial states) against the new tree/tabs markup.
- New tests for `InspectorReplayBar` and the `kind`-aware `InspectorListItem`
  rendering, following the pattern in `InspectorShell.test.jsx`.
- Manual verification: both embed sites (`/agent-flow-inspector` docked +
  floating, and `DevToolsDashboard`'s Inspector tab) against a real signed-in
  session, including a denied tool call (step-up) to confirm the red-state
  styling survives the move.
- UI build gate (`REGRESSION_PLAN.md` §0/§1 process) before calling this done,
  since it touches a `§1`-adjacent surface.

## Open items for the implementation plan

- Exact prop contract for `InspectorReplayBar` and the `kind` addition to
  `InspectorListItem`.
- Whether `TokenFlowDiagram`/`TokenExchangeFlowDiagram` are deleted once the
  unified Diagram tab replaces them, or kept for any other caller (grep during
  planning — not checked here).
