# Admin Dashboard Two-Column Layout (Middle Mode)

**Date:** 2026-05-19
**Status:** Approved

## Problem

The admin dashboard (`Dashboard.js`) has a Middle/Float layout toggle (`AgentUiModeToggle`) in its toolbar, but selecting "Middle" has no effect on the admin content layout — the `<main>` element renders all sections in a single scrolling column regardless of placement.

## Goal

When `agentPlacement === "middle"`, split the admin `<main>` into two columns:
- **Left:** Token Chain panel (fixed width, sticky)
- **Right:** All other admin sections (Customer lookup, KPIs, etc.) — scrollable

When `agentPlacement !== "middle"` (Float), keep today's single-column stacked layout unchanged.

## Approach

CSS modifier class on `<main>`. No new state, no structural JSX changes.

## Implementation

### 1. `Dashboard.js` — conditional className on `<main>`

```jsx
<main
  id="admin-dashboard-main"
  tabIndex={-1}
  className={agentPlacement === "middle" ? "admin-dash-main--split" : undefined}
>
```

`agentPlacement` is already in scope from `useAgentUiMode()` at line 35.

### 2. CSS — new rules co-located in `Dashboard.css`

```css
/* Middle layout: Token Chain left, admin ops right */
main.admin-dash-main--split {
  display: grid;
  grid-template-columns: minmax(320px, 380px) 1fr;
  gap: 1rem;
  align-items: start;
  height: calc(100vh - var(--toolbar-height, 56px));
  overflow: hidden;
}

/* Token Chain stays in column 1, sticky */
main.admin-dash-main--split .dash-shell-card--token {
  grid-column: 1;
  position: sticky;
  top: 0;
  max-height: calc(100vh - var(--toolbar-height, 56px) - 2rem);
  overflow-y: auto;
}

/* All other sections go to column 2 */
main.admin-dash-main--split .dash-shell-card:not(.dash-shell-card--token) {
  grid-column: 2;
}

/* Responsive: revert to single column below 1024px */
@media (max-width: 1024px) {
  main.admin-dash-main--split {
    display: block;
    height: auto;
    overflow: visible;
  }
  main.admin-dash-main--split .dash-shell-card--token,
  main.admin-dash-main--split .dash-shell-card:not(.dash-shell-card--token) {
    grid-column: unset;
    position: static;
    max-height: none;
  }
}
```

### Why this works without structural changes

- `dash-shell-card--token` is already on the Token Chain `<section>` (first child of `<main>`)
- All other admin sections carry `dash-shell-card` — the `:not()` selector routes them to column 2 automatically, including any future sections added

## Files Changed

| File | Change |
|------|--------|
| `banking_api_ui/src/components/Dashboard.js` | Add conditional `className` to `<main>` |
| `banking_api_ui/src/components/Dashboard.css` | Add `admin-dash-main--split` CSS rules |

## Verification

1. Admin dashboard, Middle mode selected → Token Chain pinned left, admin sections on right
2. Admin dashboard, Float mode selected → single column layout, no change from today
3. Viewport < 1024px → single column regardless of mode
4. `cd banking_api_ui && npm run build` exits 0
