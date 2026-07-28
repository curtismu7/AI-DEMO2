# What the MCP Inspector can borrow from the Live Workbench

Date: 2026-07-26

## Context

`/use-cases/live` ([`LiveUseCaseWorkbenchPage.js`](../../../demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js)) shipped six legibility improvements in this branch: a slide-over tool drawer, a claim/proof header, an honest Expected-vs-Actual verdict, a teleprompter beat sync, and a Token Chain focus state that grows the rail on completion without hiding any of its detail. The MCP Inspector is structurally the same shape — a tool list, a parameter form, tabbed output — so it's worth asking which of those six patterns actually transfer.

This is a design assessment, not an implementation. No component changes here.

## Correcting the premise

The originating brief for this doc assumed the MCP Inspector "shares the `InspectorShell` component set." That's only true for one of its two implementations:

- **`McpInspector.js`** (861 lines) has its own bespoke dark-IDE three-column CSS grid (`p1mcp-*` classes, `PingOneMcpInspector.css`) and does **not** import `InspectorShell` — confirmed by grep, zero hits. Its columns are fixed-width; nothing resizes or collapses.
- **`McpInspectorPage.jsx`** (1492 lines) is a newer, separate file that *does* use `InspectorShell`. Its own header comment states it "Consolidates McpInspector.js (AI Demo MCP), PingOneMcpInspector.js (PingOne MCP), and ApiExplorerPanel.js (API Calls) behind one InspectorShell instance with a source switcher" ([`McpInspectorPage.jsx:1-9`](../../../demo_api_ui/src/components/McpInspectorPage.jsx#L1-L9)), and references its own prior design spec at `docs/superpowers/specs/2026-07-19-inspector-shell-template-design.md`. The original three files are left untouched and still embedded elsewhere (`McpInspector.js` in `McpGatewayConfig.jsx`; `ApiExplorerPanel.js` in `DevToolsDashboard.jsx`).

**This changes where recommendations below should land.** `McpInspectorPage.jsx` drives four sources (banking, PingOne, API calls, custom server) through one shared `InspectorShell` + `InspectorTabs`. A change made in `InspectorShell.jsx` or in `McpInspectorPage.jsx`'s shared plumbing benefits all four; a change made only in the standalone `McpInspector.js` benefits just the one embedding in `McpGatewayConfig.jsx`. Every recommendation below targets `InspectorShell`/`McpInspectorPage.jsx` unless stated otherwise.

`InspectorShell.jsx` itself: it owns only drag-to-resize for the left/middle columns, persisted to `localStorage` under `inspector-shell-panel-widths` ([`InspectorShell.jsx:5,40-77`](../../../demo_api_ui/src/components/shared/InspectorShell.jsx#L5)). There is **no collapse or hide affordance** today — resize down to `MIN_LEFT = 160px` ([`InspectorShell.jsx:6`](../../../demo_api_ui/src/components/shared/InspectorShell.jsx#L6)) is the floor.

Both inspector output panels use the same tab set today: `response` / `request` / `history` (+ `form` in the newer page) — confirmed at [`McpInspector.js:813-825`](../../../demo_api_ui/src/components/McpInspector.js#L813-L825) and [`McpInspectorPage.jsx:488-494`](../../../demo_api_ui/src/components/McpInspectorPage.jsx#L488-L494). Grepping both files for `authorize`, `Authorize`, `tokenChain`, `verdict`, and `expected` returns **zero matches in either file**. None of the policy/verdict/trace machinery the workbench relies on exists here yet.

## Candidates

### 1. Collapsible tool list — recommended, belongs in `InspectorShell`

The inspector's left tool tree has the workbench drawer's exact problem: always present, fixed real estate, squeezing the output pane where the interesting content (a large JSON response) lives. Unlike the drawer, this list isn't fixed-width — it's already resizable — but resizable isn't the same as *out of the way*, and `MIN_LEFT = 160px` still permanently reserves a column.

**Reuse:** the slide-over mechanics from Task 3 (`luw-body--drawer-closed`, transform-based hide, edge-tab reopen, `localStorage` persistence) — not the markup, since `InspectorShell` renders three CSS-grid columns, not an absolutely-positioned overlay. The port is: add a `leftCollapsed` boolean to `InspectorShell`'s existing `widths` state, a fourth grid track state (`0px` collapsed vs. `widths.left` open), and an edge-tab affordance styled like `.luw-drawer-tab`.

**Belongs in `InspectorShell` itself**, not per-page — this is exactly the kind of thing the shell should own so all four `McpInspectorPage.jsx` sources (and `AgentGatewayTester.jsx`, `PingOneAuthorizePage.jsx`, `UnifiedTokenFlowInspector.jsx`, every other `InspectorShell` consumer) get it for free, matching `InspectorShell`'s own stated contract: "Owns only the left/middle column widths... everything else is presentational" ([`InspectorShell.jsx:24-27`](../../../demo_api_ui/src/components/shared/InspectorShell.jsx#L24-L27)) — collapse state is the same category of concern as width state, not page-specific.

**Cost:** low. Pure UI state + CSS, no backend dependency, no new data.

### 2. Expected vs Actual for tool calls — rejected, no honest expectation source exists

The workbench's Expected side reads a curated catalog field, `uc.expectedOutcome`, authored per use case ([`LiveUseCaseWorkbenchPage.js` via `policyLabel`](../../../demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js)). The inspector has no equivalent. Checked three candidate sources:

- **Tool schema (`requiredScopes`)** — [`McpInspector.js:762-766`](../../../demo_api_ui/src/components/McpInspector.js#L762-L766) shows the scopes a tool *requires*, not an outcome it should *produce*. A scope requirement isn't an expectation of PERMIT/DENY for a specific call with specific params — the same tool can legitimately succeed or be denied depending on the caller's live token, not the schema.
- **`mcpHistory`** ([`getCalls`/`subscribeMcpCalls`](../../../demo_api_ui/src/components/McpInspector.js#L8)) — a log of *what actually happened* on past calls, not an authored claim about what *should* happen. Treating "last time this returned X" as "expected X" would be circular: a real regression would just update the "expectation" to match the bug.
- **Saved profiles** ([`McpInspector.js:237-254`](../../../demo_api_ui/src/components/McpInspector.js#L237-L254)) — describe *which server* to call, not what a call to it should return.

None of these are an authored, independent claim about the correct outcome. Fabricating one — e.g., "assume 200 is always expected" — would recreate precisely the bug Task 5 removed: a value that cannot disagree with itself isn't a verdict, it's decoration. **Recommendation: do not build this.** It only becomes buildable if the inspector ever gains a saved-request concept with an author-supplied expected status/shape (a "postman collection" style feature) — a much larger, separate proposal, not a port of anything shipped here.

### 3. Authorize decision as a first-class outcome — plausible, but backend-gated

An MCP tool call that gets denied by policy should read differently from one that crashes. Today both look identical: any non-2xx response is funneled into the same `catch` block, tagged "Invoke failed" ([`McpInspector.js:443-461`](../../../demo_api_ui/src/components/McpInspector.js#L443-L461)), with only a 401 special-cased into `needsLogin`. Nothing distinguishes "PingOne Authorize said no" from "the tool threw."

**Reuse:** `VerdictPair`'s tone-mapping and rendering (`toneOf()`, the chip/match markup) — genuinely reusable as-is, since it's a pure display component over `{expected, actual, state}`.

**The gate:** `VerdictPair` needs a `state` value it doesn't have to derive itself (Task 5's entire point — the component must never compute the judgement, only display it). That means `/api/mcp/inspector/invoke`'s response would need to carry a machine-readable decision field (e.g. `{ decision: 'PERMIT' | 'DENY', reason }`) distinct from a generic HTTP error. I did not find that field in the frontend code in this pass — confirming its presence (or adding it) is backend work, out of scope for this doc, and a prerequisite before any frontend change here is real rather than cosmetic. **Recommendation: worth doing, but write a follow-up spec that starts on the backend route, not the component.**

### 4. Token chain for the invoked call — rejected as scoped, real gap if pursued

Checked, not assumed, per the brief's instruction: grepping `McpInspector.js` and `McpInspectorPage.jsx` for `tokenChainTraceStore` and its methods (`beginTrace`, `ingestTokenEvent`, `completeTrace`) returns **zero hits in either file**. `handleInvoke` only ever calls `apiClient.post` and updates local `lastInvoke`/`mcpHistory` state ([`McpInspector.js:413-465`](../../../demo_api_ui/src/components/McpInspector.js#L413-L465)). The store is never populated by an inspector-initiated call — confirmed empty, not assumed.

Adding a `TokenChainTraceRail` tab to `InspectorTabs` would show nothing without also wiring `handleInvoke` to call `tokenChainTraceStore.beginTrace`/`ingestTokenEvent`/`completeTrace` the way `LiveUseCaseWorkbenchPage.js`'s `handleRunChip`/`handleRunAttack` do. That is real, non-trivial work — not a UI port, a new integration. **Recommendation: reject for this pass** — bundle it with Candidate 3 in the same follow-up spec if the backend authorize-decision field ships, since both need the same underlying request/response instrumentation to be worth building together.

### 5. Result focus on completion — rejected, wrong shape of interaction

Task 7's pattern (grow the rail, scroll to and pulse the decisive step, `aria-live` announce, persist until the next run) fits a multi-second, multi-hop pipeline where the eye needs directing to *which* of twelve steps decided the outcome. An MCP tool call is a single request/response pair completing in the tens-to-hundreds of milliseconds the output footer already reports (`{lastTiming.ms}ms`, [`McpInspector.js:840-841`](../../../demo_api_ui/src/components/McpInspector.js#L840-L841)). There is no "decisive step" to scroll to among a set of steps — there's one call and one result, already fully visible in the (single) output pane. **Recommendation: do not build.** If Candidate 4 ships and the inspector eventually renders a real multi-hop trace per call, revisit then — the pattern would apply to *that* rail, not to the plain JSON response view that exists today.

### 6. "What this tool proves" header — rejected as redundant

`UseCaseProofHeader` exists because the workbench's cards showed only a title, discarding richer catalog fields the backend already returns. The inspector doesn't have that gap: the form column already shows the selected tool's `name`, its `description` straight from `tools/list`, and its `requiredScopes` ([`McpInspector.js:757-766`](../../../demo_api_ui/src/components/McpInspector.js#L757-L766)) — the same information a proof-header band would add, already inline, already above the form. **Recommendation: do not build.**

## Explicitly not recommended

| Candidate | Reason |
|---|---|
| Expected vs Actual (verbatim port) | No authored expectation source exists for ad-hoc tool calls; fabricating one recreates the bug Task 5 removed. |
| Result focus on completion | Built for a multi-step pipeline; a single request/response has no "decisive step" to direct attention to. |
| "What this tool proves" header | The form column already surfaces name + description + scopes; a proof header would duplicate it. |

## Recommended, in priority order

1. **Collapsible tool list in `InspectorShell`** — low cost, no backend dependency, benefits every `InspectorShell` consumer immediately.
2. **Authorize decision as a first-class outcome + token chain tab** — bundle these two (Candidates 3 and 4): both are blocked on the same backend gap (the invoke route not distinguishing a policy decision from a generic error, and not emitting trace events), so they should ship together as one follow-up spec that starts with the backend contract, not the component.
