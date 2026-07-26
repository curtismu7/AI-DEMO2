# Collapsible tool list in InspectorShell

Date: 2026-07-26

## Context

[`docs/superpowers/reports/2026-07-26-mcp-inspector-legibility-design.md`](../reports/2026-07-26-mcp-inspector-legibility-design.md)
(the design assessment comparing the Live Workbench's legibility patterns
against the MCP Inspector) recommends six candidates for porting workbench
patterns into the inspector, and ranks this one first: low cost, no backend
dependency, benefits every `InspectorShell` consumer immediately. This spec
covers that one candidate only. The second recommendation (authorize decision
as a first-class outcome + a token-chain tab) is backend-gated and will get
its own spec once this one ships.

`InspectorShell.jsx` (`demo_api_ui/src/components/shared/InspectorShell.jsx`)
is the shared topbar + 3-column CSS-grid layout used by five pages today —
`McpInspectorPage.jsx`, `AgentGatewayTester.jsx`, `PingOneAuthorizePage.jsx`,
`UnifiedTokenFlowInspector.jsx`, `MgmtApiRunnerPage.jsx` (confirmed by grep;
all five pass a `left` prop). It currently owns only drag-to-resize for the
left/middle columns, persisted to `localStorage` under
`inspector-shell-panel-widths`, with a hard floor of `MIN_LEFT = 160px` —
there is no way to get the left column out of the way entirely.

The workbench's own slide-over tool drawer (`LiveUseCaseWorkbenchPage.css`,
`.luw-body--drawer-closed`) solves the same "always-present, fixed real
estate" problem, but its mechanics — an absolutely-positioned overlay with a
`transform: translateX` slide and a floating edge-tab — don't map directly
onto `InspectorShell`, which lays out its three columns as grid tracks, not
an overlay. This spec ports the *concept* (collapse the tool list out of the
way, keep it easy to bring back) using mechanics native to a grid layout.

## Goals

- Let the left tool-list column collapse to zero width so the middle/right
  columns get that space back.
- Reopening must be discoverable at all times — no relying on a sliver of
  leftover column to click.
- No changes required in any of the five consumer pages — this is shell-only,
  matching `InspectorShell`'s existing contract ("owns only the left/middle
  column widths... everything else is presentational").
- Don't lose in-progress state (e.g. a typed search filter) in the left
  column when it's collapsed and reopened.

## Non-goals

- No opt-out prop — every consumer gets this for free, same as resize does
  today. (All five already pass `left`; if a future consumer omits it, the
  toggle simply doesn't render — see below.)
- No change to the middle-column resize behavior or its `MIN_MIDDLE`/`MAX_MIDDLE`
  clamps.
- No touch/mobile-specific affordance — this shell is desktop-oriented today
  (fixed `calc(100vh - 45px)` grid height) and this change doesn't alter that.

## Design

### State & persistence

A new `leftCollapsed` boolean, local to `InspectorShell`, alongside the
existing `widths` state. Persisted to its **own** `localStorage` key,
`inspector-shell-left-collapsed` — deliberately *not* merged into the
existing `inspector-shell-panel-widths` object, because
`InspectorShell.test.jsx` already asserts that object's shape with an exact
`toEqual({ left, middle })`; a merged shape would either break that test or
require every existing saved blob to migrate. A second key avoids both.

Default is `false` (expanded) when nothing valid is in storage, matching how
`loadWidths()` already falls back to `DEFAULT_WIDTHS` on missing/malformed
storage.

### Trigger

A toggle button in the topbar, reusing the existing `.inspector-shell-topbar__btn`
class (already used for other topbar actions — no new button style). It
renders only when the `left` prop is provided, placed immediately after the
title and before `statusText`/`actions`. Label and `aria-label` swap between
"Hide tools" / "Show tools"; `aria-expanded={!leftCollapsed}` reflects state
for assistive tech.

Because the button lives in the topbar rather than on the column itself, it
stays visible and clickable regardless of collapse state — no edge-tab or
overlay affordance is needed the way the workbench drawer needed one (that
drawer overlays the whole page, so its own trigger has to float independent
of the column; here the topbar already provides that independence for free).

### Layout

When `leftCollapsed` is true:

- `gridTemplateColumns` becomes `0px 0px {middle}px 6px 1fr` — both the left
  column track and its resize-handle track zero out, so the freed space
  goes straight to the middle/right columns with no dead 6px sliver sitting
  between them.
- `.inspector-shell-col-left` gets a modifier class (e.g.
  `inspector-shell-col-left--collapsed`) setting `display: none`. The
  element stays mounted — only hidden — so any state inside it (a search
  input's text, scroll position in a long tool list) survives a
  collapse/expand cycle instead of resetting.
- The left resize handle (`role="separator"` for the left column) is not
  rendered while collapsed, since there's nothing to drag.

Expanding restores the last-known `widths.left` value (unchanged from
today's persisted width) and re-renders the handle.

### Consumer impact

None. All five current `InspectorShell` callers pass a `left` prop today and
require no code changes — the toggle appears automatically.

## Testing

Extend `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`:

- Toggle button renders when `left` is provided; absent when it isn't.
- Clicking the toggle flips `aria-expanded`, applies
  `inspector-shell-col-left--collapsed`, and updates `gridTemplateColumns`
  to `0px 0px {middle}px 6px 1fr`.
- Clicking again restores the prior `gridTemplateColumns` (including a
  previously-dragged, non-default left width).
- Left-column content stays in the DOM while collapsed (query still finds
  it), confirming it's hidden, not unmounted.
- Collapsed state persists to `inspector-shell-left-collapsed` and restores
  on remount, independent of and without altering
  `inspector-shell-panel-widths` (the existing width-persistence test must
  keep passing unmodified).

Gate: `cd demo_api_ui && npm run test:unit && npm run build`.

## Rollout

Single PR, `InspectorShell.jsx` + `InspectorShell.css` + its test file only.
No feature flag — this is additive UI with no backend dependency and no
behavior change for existing widths/resize functionality.
