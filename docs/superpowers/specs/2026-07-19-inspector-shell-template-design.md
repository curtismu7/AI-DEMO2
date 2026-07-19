# InspectorShell — Shared Template Design

**Date:** 2026-07-19
**Status:** Approved
**Author:** Curtis Muir

---

## Overview

Four tool-inspector pages in `demo_api_ui` (`McpInspector.js`, `PingOneMcpInspector.js`,
`ApiExplorerPanel.js`, `AgentGatewayTester.jsx`) hand-copy the same topbar + 3-column
grid layout (`.p1mcp-grid`: tool tree | param form | tabbed output), styled by
`PingOneMcpInspector.css` — a page-specific file that three *other* pages import for
its classnames. There is no real shared component, only a copy-pasted convention.

This spec extracts that layout into a real `InspectorShell` component, and — per a
scope change agreed during design — uses the extraction to also consolidate five
existing nav entries down to three pages: one merged MCP inspector, plus
`AgentGatewayTester` and `PingOneAuthorizePage` rebuilt on the same shell.

A mock of the final result (all three pages, full request/response/headers detail,
nav-rail placement) was reviewed and approved. See "Mockups" below.

---

## Goals

- Kill the copy-pasted `.p1mcp-*` grid/topbar markup — one real component, not four
  hand-rolled copies.
- Consolidate `McpInspector`, `PingOneMcpInspector`, and `ApiExplorerPanel` — three
  separate pages that are really "pick a tool source, call it, inspect the result" —
  into one page with a source switcher, instead of three near-identical routes.
- Leave `AgentGatewayTester` and `PingOneAuthorizePage` as their own pages (each has
  behavior the shell doesn't need to know about — a Tools/Config sub-tab and a
  decision-preset panel, respectively) but put them on the same shell for visual and
  structural consistency.
- Ship a skill (`inspector-template`) so the next inspector-shaped page starts on the
  template instead of drifting into another one-off copy.

## Non-goals

- `McpTrafficPage.js` and `CodeSearchPage.jsx` approximate this layout but use
  different markup (inline-flexbox and a `1fr 2fr` grid, respectively) — **not**
  converted in this pass. Follow-up work, once `InspectorShell` has shipped and
  proven itself on the four pages above.
- Every other left/right-ish page surveyed (`AuthzTestPage`, `MockAuthzRulesPage`,
  `ClientCredentialsResourcePage`, `ResourceServerPage`, `TokenExchangeTesterPage`,
  `CodeExplorerPage`, `OASDemoPage`, `TracingPage`, `TelemetryPage`) has a genuinely
  different content shape (comparison grids, chat, diagrams, single-column forms) —
  explicitly out of scope, not a template fit.
- No new BFF routes or backend changes — this is a UI-layer extraction + page merge.

---

## Architecture

### `InspectorShell` — presentational only

New files in `demo_api_ui/src/components/shared/`:

- `InspectorShell.jsx` — topbar (title, status dot, right-aligned actions) + 3-column
  CSS grid. Takes `left` / `middle` / `right` slot props and renders them as-is. Owns
  **no state and no data shape** — each page keeps its own data fetching, selection
  state, and tab state exactly as today.
- `InspectorShell.css` — the layout rules, moved out of the page-owned
  `PingOneMcpInspector.css` and renamed `p1mcp-*` → `inspector-shell-*`
  (content-agnostic: `-col-left/middle/right`, not `-col-tree/form/output`, since one
  page's left column is a captured-calls list, not a tool tree).
- `InspectorListItem.jsx` — the repeated "dot + name + badge" left-column row.
- `InspectorTabs.jsx` — the repeated Response/Request/…/Headers tab bar; bar only,
  tab content stays page-supplied.

```jsx
<InspectorShell
  title="MCP Inspector"
  statusDot={{ state: "ok", label: "Connected · banking-mcp" }}
  actions={<button>Clear History</button>}
  left={...}    // tool tree / call list / decision presets — page-owned
  middle={...}  // param form / read-only fields — page-owned
  right={...}   // output tabs, via <InspectorTabs> — page-owned
/>
```

Why presentational-only: the pages have genuinely different left-column semantics
(tool tree vs. captured calls vs. decision presets) and different tab counts (2 to 5).
Baking a data shape into the shell would force a fake-generic API onto different
things. Layout is identical; content isn't — the shell owns only the identical part.

### Three pages, not four

| Page | Route | Component | Nav group |
|---|---|---|---|
| MCP Inspector | `/pingone-mcp-inspector` (kept; see Routing below) | `McpInspectorPage.jsx` **(new)** | "PingOne MCP" — replaces "PingOne MCP Inspector" |
| Agent Gateway Tester | existing `AgentGatewayTester.jsx` route | `AgentGatewayTester.jsx` (shell-converted, unchanged data/logic) | "Banking MCP & Gateways" — **new nav entry** (component had no nav link before) |
| PingOne Authorize | `/pingone-authorize` (unchanged) | `PingOneAuthorizePage.jsx` (shell-converted, unchanged data/logic) | "Authorize" — unchanged position |

**MCP Inspector merge.** `McpInspectorPage.jsx` renders one `InspectorShell` instance
with an internal source switcher (a pill row under the topbar, only shown because
this page has >1 source) toggling between three sources, each supplying its own left
list, middle fields, and right tabs:

- **Banking MCP** — today's `McpInspector.js` tool tree + call logic, unchanged.
- **PingOne MCP** — today's `PingOneMcpInspector.js` tool tree + call logic, unchanged.
- **API Calls** — today's `ApiExplorerPanel.js` captured-call list + replay, unchanged.

Each source keeps its existing data fetching and call logic verbatim — the merge is
UI-only (one shell, one topbar, a switcher instead of three separate page mounts),
not a data-layer merge.

### Routing

- `/pingone-mcp-inspector` keeps its name and becomes the merged page's route,
  defaulting to the PingOne MCP source (`?source=banking|pingone|api` selects
  another). It inherits this route because the "PingOne MCP" nav group is where the
  merged page's nav entry ends up (see Nav placement below) — not because PingOne is
  privileged over Banking in the merged UI itself.
- `/mcp-inspector` (old `McpInspector.js` route) and `/monitoring/api-explorer` (old
  `ApiExplorerPanel.js` route) redirect to `/pingone-mcp-inspector?source=banking` and
  `?source=api` respectively, so existing bookmarks/links land on the right source
  instead of 404ing.
- `AgentGatewayTester` and `/pingone-authorize` routes are unchanged.

### Nav placement

Resolved during design — each page nests under an **existing** `AdminSideNav` group
rather than a new umbrella group:

- **MCP Inspector** → **"PingOne MCP"** group, replacing the "PingOne MCP Inspector"
  entry. The "Banking MCP & Gateways" group loses "Demo MCP Inspector" (folded in).
  The "Monitoring" group loses "API Explorer" (folded in).
- **Agent Gateway Tester** → **"Banking MCP & Gateways"** group, alongside the
  existing "PingGateway Config" / "PingGateway Test" entries it's closest to in
  purpose. New nav entry — the component currently has none.
- **PingOne Authorize** → stays in the **"Authorize"** group, same position as today.

---

## Migration order

1. **`InspectorShell` + subcomponents** — build and unit-verify in isolation first
   (no page depends on it yet).
2. **`PingOneAuthorizePage`** — shell-converted in place (route/nav unchanged), the
   simplest swap: proves the shell before the bigger merge.
3. **`AgentGatewayTester`** — shell-converted in place, adds its nav entry. Proves the
   `left` slot handles the Tools/Config sub-tab case, not just a flat/grouped list.
4. **`McpInspectorPage` (new)** — built last, composing the three existing
   sources' logic (moved, not rewritten) behind the source switcher. Old
   `McpInspector.js`, `PingOneMcpInspector.js`, `ApiExplorerPanel.js` route
   components retired once the new page covers their behavior; routes become
   redirects per "Routing" above. Nav entries updated per "Nav placement" above.

**Constraint carried into execution:** all of `demo_api_ui` is protected under
`REGRESSION_PLAN.md` §1. Execution must run in a worktree, invoke `regression-guard`
before editing, keep the emoji allowlist, and run the UI build gate after each step
above before moving to the next.

---

## Skill — `inspector-template`

`.claude/skills/inspector-template/SKILL.md`, modeled on the existing
`pingcli-demo-page` skill precedent. Two entry paths, same checklist core:

- **Convert an existing page**: inventory current left/middle/right content → swap
  markup for `InspectorShell` → migrate classnames → delete dead CSS → verify.
- **Scaffold a new page**: define left list source, middle form fields, right output
  tabs → compose from scratch on `InspectorShell` → wire route + `AdminSideNav`
  entry (into an *existing* topical group per the "Nav placement" precedent above,
  not a new group, unless no existing group fits) → verify.

Both paths end the same way: regression-guard check (protected UI), worktree
required, UI build gate, manual click-through (tool select → form → result tabs)
before done.

Trigger phrasing: "inspector page", "convert to inspector template", "tool list +
action panel layout", `/inspector-template`.

---

## Mockups

Interactive mock reviewed and approved during design, published as a Claude
Artifact (not checked into the repo — ephemeral preview only). It showed:

- The shared topbar + 3-column shell across all three pages.
- MCP Inspector's source switcher (Banking MCP / PingOne MCP / API Calls) swapping
  left list, status text, and action-button label within one shell instance.
- Full request/response/headers/decision/policy detail per source (not simplified
  Response/Request-only tabs) — output tabs vary per page: 2–5 tabs depending on
  what that source actually returns (`PingOneAuthorizePage`'s five: Decision,
  Response, Request, Policy, Headers).
- An "annotate" toggle outlining shell chrome vs. page-owned slot content, to make
  the shared-vs-page-owned boundary explicit for review.
- A left nav rail (not top tabs) previewing the three real `AdminSideNav`
  destinations, styled as sidebar links rather than in-page tabs — deliberately
  chosen over a tab bar so the mock doesn't imply "one page, three tabs" when the
  real result is three separate routes with their own nav entries.

---

## Regression considerations

- `AgentGatewayTester` and `PingOneAuthorizePage` conversions touch layout/markup
  only — call logic, state, and BFF calls are unchanged, so behavior should be
  identical pre/post conversion. Verify via existing manual flows (tool select →
  call → result) since neither page currently has dedicated jest coverage found
  during design research.
- The MCP Inspector merge changes *routes and nav entries*, not the underlying call
  logic for any of the three sources — each source's existing fetch/call code moves
  into the new page unchanged.
- Old routes (`/mcp-inspector`, `/monitoring/api-explorer`) must redirect, not 404 —
  check any hardcoded links to them elsewhere in the app (nav, docs, other pages)
  before removing the old route components.
- Emoji allowlist and other `REGRESSION_PLAN.md` §0 rules apply to all new/edited
  markup in this work.
