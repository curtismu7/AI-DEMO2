---
name: inspector-template
description: >-
  Build or convert a tool/list-detail page (a left tool tree, a middle param
  form, a right tabbed output — the MCP Inspector layout) onto the shared
  InspectorShell component set instead of hand-rolling the topbar/grid/tree
  markup again. Use this whenever a new admin/dev-tool page needs that
  layout, or an existing page's three-column "tool list + action panel"
  markup should be converted onto the shared shell. Trigger phrasing:
  "inspector page", "convert to inspector template", "tool list + action
  panel layout", `/inspector-template`.
---

# Inspector Template

Three pages in this repo (`PingOneAuthorizePage.jsx`, `AgentGatewayTester.jsx`,
`McpInspectorPage.jsx`) already share one layout: a topbar (title, status dot,
right-aligned actions) over a 3-column grid — left tool/call tree, middle
param form, right tabbed output. That layout is a shared component set,
`demo_api_ui/src/components/shared/{InspectorShell,InspectorListItem,InspectorTabs}.jsx`.
Use it instead of copying markup from an existing page or inventing new
topbar/grid CSS.

Design spec this was built from:
`docs/superpowers/specs/2026-07-19-inspector-shell-template-design.md`.

## Component reference

**`InspectorShell`** — presentational only, owns no state. Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `title` | string | — | Topbar `<h1>` |
| `statusOn` | bool | `true` | Green vs. red status dot |
| `statusText` | string | — | Topbar status label, optional |
| `actions` | node | — | Right-aligned topbar buttons |
| `fullHeight` | bool | `true` | `false` when embedded mid-page (e.g. inside a tab), not the whole route — renders a fixed `640px` grid instead of `calc(100vh - 45px)` so it doesn't blow out page height with double scrollbars |
| `left` | node | — | Column 1 content |
| `middle` | node | — | Column 2 content |
| `right` | node | — | Column 3 content |

**`InspectorListItem`** — one left-column row. Props: `label` (string),
`active` (bool, default `false`), `dot` (`'default' | 'write' | 'sensitive'`),
`badges` (array of `'write' | 'sensitive'`), `onClick`. Renders a `<button>`
(not a `<div>`) for accessibility — a row can be both write and sensitive at
once (both badges render).

**`InspectorTabs`** — output tab bar only, not tab content. Props: `tabs`
(array of `{key, label}`), `activeKey`, `onChange`. The caller renders tab
content itself, switching on `activeKey`.

All three come from `./shared/InspectorShell.css` — import it once per page,
not copied per-page CSS.

## CSS classnames available

Beyond what the three components render for you, these are there to compose
your own column content (form fields, footers, empty states) without
inventing new rules:

- **Topbar**: `.inspector-shell-topbar__btn` (+ `--active` for a toggled-on
  state), disabled state handled automatically.
- **Left column**: `.inspector-shell-tree-header`, `.inspector-shell-tree-search`
  (wraps a `<input type="search">`), `.inspector-shell-tree-body`,
  `.inspector-shell-tree-group__label` (group headers above a run of
  `InspectorListItem`s). No footer class is provided by the shell itself —
  `McpInspectorPage`'s history/stats strips below the tree body use inline
  styles or page-owned classes; add your own if a source needs one.
- **Middle column**: `.inspector-shell-form-header` /
  `.inspector-shell-form-header__name` / `__desc`, `.inspector-shell-form-body`,
  `.inspector-shell-form-empty` (no-selection state), `.inspector-shell-field`
  (label + input/textarea pair, `.req` marks a required-field asterisk, `.type`
  is the muted type hint), `.inspector-shell-form-actions` (+ `--top` variant
  for a duplicate action row above the form, matching the pattern all three
  existing pages use: Execute/Clear both above and below the field list),
  `.inspector-shell-btn-call` / `.inspector-shell-btn-clear`,
  `.inspector-shell-form-error`.
- **Right column**: `.inspector-shell-output-body`, `.inspector-shell-output-empty`,
  `.inspector-shell-output-code` (the `<pre>` wrapping a JSON/response dump —
  pair with the existing `JsonHighlight` component, don't hand-roll syntax
  highlighting), `.inspector-shell-output-footer` (Status/Duration/Transport
  strip below the output body).
- **Page-owned, not shell-owned**: `.source-switcher` / `.src-pill` (+
  `--active`) — the row of pills `McpInspectorPage` uses to flip between its 3
  independent data sources inside one shell instance. Only compose this in if
  your page similarly multiplexes more than one backend/data source through
  one shell; a single-source page doesn't need it.

Do not invent new `p1mcp-*`-style classnames or per-page topbar/grid CSS —
if something the shell doesn't cover comes up, extend `InspectorShell.css`
(additive rule, own section) rather than duplicating the pattern per-page.

## Path 1: convert an existing page

1. Read the current page in full. Inventory what its left/middle/right
   content actually is today — don't assume it maps 1:1 onto the shell;
   real conversions in this repo have found dead code (orphaned function
   calls), CSS bugs (embedded-height overflow), and features that need a new
   `InspectorShell` prop (`fullHeight` was added this way).
2. Swap the page's own topbar/grid markup for one `<InspectorShell>` call.
   Map existing tree rows onto `InspectorListItem`, existing tab bars onto
   `InspectorTabs`.
3. Migrate classnames: rename any page-local `p1mcp-*`/bespoke topbar-grid
   classnames to the `inspector-shell-*` equivalents above. Delete the CSS
   that duplicated this shell's layout — don't leave two copies of the same
   rule live.
4. If the page is embedded mid-route (a tab inside another page, not its own
   full route), pass `fullHeight={false}`.
5. Preserve behavior exactly — this is a presentation migration, not a data-
   layer rewrite. Don't drop features while trimming markup (a real
   conversion in this repo silently dropped a session-expiry banner and
   shrank a fallback data catalog this way — both had to be restored after
   review). If the original had a login-required state, an error banner, a
   stats footer, or any other "shown sometimes" element, carry it over.
   If the page reads a routing query param (deep-link source selection,
   filters), carry that over too — don't silently drop it while migrating
   markup.
6. Verify — see Shared verification below.

## Path 2: scaffold a new page from scratch

1. Define the left list source (what does one row represent — a tool? a
   captured call? a policy?), the middle form's fields, and the right
   output's tabs, before writing any JSX.
2. Compose directly on `InspectorShell`/`InspectorListItem`/`InspectorTabs` —
   don't copy an existing page's file as a starting point (that carries its
   data logic along uninvited); start from the component reference above.
3. Wire the route and an `AdminSideNav` entry into an **existing** topical
   nav group that fits the page's subject — not a new group, unless nothing
   existing fits. Check `AdminSideNav.jsx`'s current groups first.
4. Verify — see Shared verification below.

## Shared verification (both paths)

1. **regression-guard** — `demo_api_ui` is a protected area
   (`REGRESSION_PLAN.md` §1). Invoke `regression-guard` before your first
   edit; state what you will not break.
2. **Worktree required** — edit/test/commit only in an isolated git worktree
   per this repo's working practice, never the shared main checkout.
3. **Emoji allowlist** — `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚 🔧` only, anywhere in the
   page's copy or code. `REGRESSION_PLAN.md` §0 is the source of truth.
4. **UI build gate** — `cd demo_api_ui && npm run build` must exit `0` before
   the work is done.
5. **Manual click-through** — tool/row select → form fills → Execute →
   result appears in the right column's tabs. A passing test suite is not a
   substitute for actually clicking through the page once.

## Existing examples to model from

- `demo_api_ui/src/components/PingOneAuthorizePage.jsx` — the shell instance
  lives in the page's `EvaluatePanel`, embedded under an endpoint picker
  (`fullHeight={false}`), with 4 output tabs (Decision, Response, Request,
  Form) plus a `BulkDecisionPanel` sibling shell for the "Bulk Decisions" tab
  (Results, Response, Request, JSON).
- `demo_api_ui/src/components/AgentGatewayTester.jsx` — `fullHeight={false}`
  (embedded in `McpGatewayConfig.jsx`'s tester tab).
- `demo_api_ui/src/components/McpInspectorPage.jsx` — the `.source-switcher`
  pattern: one shell instance multiplexing 3 independent data sources
  (Banking MCP / PingOne MCP / API Calls), each its own `use*Source()` hook
  returning `{statusOn, statusText, actions, left, middle, right}`, and
  `?source=` query-param deep-linking so redirects/bookmarks land on the
  right source.