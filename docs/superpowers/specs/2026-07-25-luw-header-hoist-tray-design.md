# Live Workbench: hoist agent toolbar, collapse Demo Script tray

Date: 2026-07-25
Route: `/use-cases/live` ([`LiveUseCaseWorkbenchPage.js`](../../../demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js))

## Problem

On `/use-cases/live` the page reads as three columns: Demo Script drawer (336px) |
agent host | Token Chain rail. Structurally it is a two-track grid
(`.luw-body { grid-template-columns: 336px 1fr }`) whose second track holds
`.luw-run-layout`, a flex row of `.luw-agent-host` + `.luw-rail-host`.

The agent is the single global `<AIAgent>` portaled
into `#luw-agent-host` with `mode="inline" splitColumnChrome`, so its header
(`.ba-header`) renders *inside* the middle column.

That header carries ten-plus controls — Routing/Wiring selects, RFC info,
Compliance, Token Chain switches, Guide, Demo steps, Agent scope, Clear progress,
Sign out. At a ~500px column width they wrap into six stacked rows and consume
most of the agent's vertical space before a single message renders.

Two changes reclaim that space:

1. Hoist the controls row out of the column into a full-width bar above the
   columns.
2. Give the Demo Script column a collapse toggle so the agent can also grow wide.

## Non-goals

- No change to any other agent surface (float, bottom dock, dashboard-middle,
  clinical split). They keep today's inline header exactly.
- No change to what the controls *do* — routing, scopes, chip dispatch, sign-out
  are untouched.
- No new global layout primitive. This is scoped to one route.

## Design

### A. Hoist `.ba-header-tools` via portal

The controls stay one React element; only their DOM parent changes. This reuses
the host-registration pattern the agent surface itself already uses
(`surfaceHostEl` in `AgentUiModeContext`), so there is no second source of truth
and no duplicated state.

**A1 — `demo_api_ui/src/context/AgentUiModeContext.js`**

Add `toolbarHostEl` + `setToolbarHostEl`, mirroring `surfaceHostEl` exactly:
default in the context shape (~L85-86), `useState(null)` (~L103), both keys in
the memoized value plus `toolbarHostEl` in the dependency array (~L175-182).

**A2 — `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js`**

Render a host node inside `.luw-topbar`:

```jsx
<div className="luw-topbar__agent-tools" ref={toolbarHostRef} />
```

Register it with the same effect shape as the existing agent host (L91-98):
callback ref into state, `setToolbarHostEl(el)` on change, identity-checked
cleanup on unmount.

Placement: after `.luw-topbar__vertical`. The topbar becomes the full-width
control bar above the grid.

**A3 — `demo_api_ui/src/components/AIAgent.js`**

`useAgentUiMode()` is already destructured at L281 — add `toolbarHostEl`.

In the header render (L7807-8009), assign the existing
`<div className="ba-header-tools">…</div>` JSX to a local const, then:

```jsx
{toolbarHostEl ? createPortal(headerTools, toolbarHostEl) : headerTools}
```

No conditional on `splitChrome` is needed: only this route registers a toolbar
host, so every other surface takes the inline branch. If the page unmounts, the
effect clears the host and the controls re-render inline — no orphaned portal.

Float-only children inside `ba-header-tools` (expand/restore, Graph, close) are
already gated on `!isInline` and stay absent here. `Sign out` is gated on
`splitChrome` and rides along, as in the current header.

**A4 — `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css`**

`.luw-topbar` gains `flex-wrap: wrap` and a slightly taller padding allowance.
`.luw-topbar__agent-tools` gets the row layout (`display: flex; align-items:
center; gap; flex-wrap: wrap`) so the hoisted controls lay out horizontally
across the full page width.

The in-column `.ba-header` then holds only the status dot, title
("Super Banking Assistant") and subtitle ("Customer · Demo") — one compact row.

### B. Collapsible Demo Script tray

**B1 — `LiveUseCaseWorkbenchPage.js`**

`drawerCollapsed` state, lazily initialised from
`localStorage.getItem('luw_demo_script_collapsed') === '1'`, wrapped in
try/catch (matching [`tokenRailLayout.js`](../../../demo_api_ui/src/utils/tokenRailLayout.js)).
Persist on change in an effect. Helpers stay inline in the page — a shared util
module is not warranted for one consumer.

Toggle button lives in `.luw-drawer__head`, following the AdminSideNav idiom
([`AdminSideNav.jsx:1257-1265`](../../../demo_api_ui/src/components/AdminSideNav.jsx)):

```jsx
<button
  type="button"
  className="luw-drawer__toggle"
  onClick={() => setDrawerCollapsed((c) => !c)}
  aria-expanded={!drawerCollapsed}
  aria-label={drawerCollapsed ? 'Expand demo script' : 'Collapse demo script'}
  title={drawerCollapsed ? 'Expand' : 'Collapse'}
>
  {drawerCollapsed ? '→' : '←'}
</button>
```

`←` / `→` are arrow glyphs already used by AdminSideNav, not emoji — the
`REGRESSION_PLAN` §0 allowlist is unaffected.

When collapsed, the drawer renders only the toggle plus a vertical
"Demo script" label; `__sub`, `__search` and `__scroll` are not rendered.

**B2 — `LiveUseCaseWorkbenchPage.css`**

```css
.luw-body--drawer-collapsed { grid-template-columns: 44px 1fr; }
```

Plus rules for the collapsed drawer's vertical label
(`writing-mode: vertical-rl`) and the toggle button.

The existing `@media (max-width: 860px)` rule sets `.luw-body { grid-template-columns: 1fr }`
for the stacked narrow layout. The collapsed modifier must be declared *before*
that media query so the stacked breakpoint still wins; the collapsed drawer's
vertical label must also revert to horizontal there.

`.luw-topbar` sits in `.luw`'s `grid-template-rows: auto 1fr` first track, so the
hoisted control bar grows the topbar and the body track absorbs the change — no
height math to update.

## Success criteria

1. `npm run build` in `demo_api_ui` succeeds.
2. Existing jest suites touching the agent header and workbench pass.
3. Live on `https://local.ping-devops.com:4000/use-cases/live`:
   - controls render as one wrapped bar above all three columns; the agent column
     header shows only dot + title + subtitle;
   - every control still works (change Routing, flip Token Chain, open Demo steps,
     toggle Agent scope, Clear progress);
   - the Demo Script toggle collapses to a ~44px rail, the agent column widens,
     and the state survives a reload;
   - a chip still dispatches end-to-end and the Token Chain rail still populates.
4. `/dashboard` (middle placement) and the floating agent still show their header
   controls inline, unchanged.

## Risk / protected areas

Per `REGRESSION_PLAN.md` §0-§1 this touches a UI surface. Explicitly **not**
changed: OAuth/login, RFC 8693 token exchange, BFF session handling, admin vs
customer role enforcement, HITL consent, ports/hosts, chip dispatch and agent
routing, `ScopePicker` / `DemoStepsDropdown` / sign-out semantics, Token Chain
rail contents.

The only cross-surface file is `AIAgent.js`, and its change is a single
conditional wrap around markup that is otherwise byte-identical.
