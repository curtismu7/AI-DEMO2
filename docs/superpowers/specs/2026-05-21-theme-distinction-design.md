# Theme Distinction Design

**Date:** 2026-05-21
**Status:** Approved

## Problem

When switching between themes, the visual change is subtle. Super Banking and Great Buy both use blue headers, making them nearly identical on switch. Body backgrounds are dark/heavy across themes. Yellow buttons render white text on yellow (low contrast).

## Goals

1. Make every theme unmistakably distinct — switching should be immediately obvious.
2. Great Buy must not look like Super Banking.
3. Yellow buttons must use black text.
4. Body backgrounds go white/near-white across all themes (less black, simpler).

## What Is NOT Changing

- "Super Bank" always stays in the TopNav (reads from `identity.displayName` — unchanged behavior).
- Super Banking theme colors — navy is already distinct.
- TopNav background on non-retail themes — stays dark slate (`#1e293b → #334155`), which is neutral chrome.
- No refactoring of ThemeContext, vertical config service, or CSS variable application logic.

## Changes Per Theme

### Great Buy (`retail.json`)

The biggest change. Great Buy currently uses blue headers (same family as Super Banking). Replace with a black/yellow identity:

| CSS Var | Old Value | New Value |
|---|---|---|
| `--brand-dashboard-header-start` | `#0046BE` | `#1D1D1B` |
| `--brand-dashboard-header-end` | `#003a9e` | `#2d2d2b` |
| `--brand-app-shell-hero-start` | `#0046BE` | `#1D1D1B` |
| `--brand-app-shell-hero-end` | `#003a9e` | `#2d2d2b` |
| `--brand-dashboard-header-text` | `#ffffff` | `#FFE000` |
| `--app-primary-btn-text` | `#1D1D1B` | `#1D1D1B` (already correct — ensure it applies) |

TopNav background also picks up the theme: add `--brand-topnav-bg-start` / `--brand-topnav-bg-end` CSS vars (see TopNav section below).

Great Buy TopNav: black background (`#1D1D1B`), brand name in yellow (`#FFE000`).

### All Themes — Body Background

Add `--brand-body-bg` CSS var to each vertical JSON:

| Theme | Value |
|---|---|
| banking | `#f8fafc` |
| retail | `#ffffff` |
| healthcare | `#f8fafc` |
| sporting-goods | `#f8fafc` |
| workforce | `#f8fafc` |

The dashboard body/content area reads this var. Default fallback in `index.css`: `--brand-body-bg: #f8fafc`.

### Yellow Button Text Fix

`--app-primary-btn-text` is already defined as `#1D1D1B` in `retail.json`. The fix is ensuring every component that renders a primary button uses `color: var(--app-primary-btn-text, #ffffff)` instead of hardcoding `color: white`. This applies to any button using `--app-primary-red` as its background.

## TopNav Theme Color (Great Buy Only)

Add two new CSS vars to drive the TopNav background per-theme:

```
--brand-topnav-bg-start
--brand-topnav-bg-end
```

In `TopNav.css`, change `.topnav` background to:
```css
background: linear-gradient(135deg,
  var(--brand-topnav-bg-start, #1e293b) 0%,
  var(--brand-topnav-bg-end, #334155) 100%
);
```

Defaults (`#1e293b → #334155`) preserve existing behavior for all themes that don't set these vars.

Only `retail.json` sets them:
```json
"--brand-topnav-bg-start": "#1D1D1B",
"--brand-topnav-bg-end": "#2d2d2b"
```

Brand name color in TopNav also needs to be themeable. Add `--brand-topnav-text` var:
- Default: `#ffffff` (all themes unchanged)
- retail: `#FFE000`

In `TopNav.css`, `.topnav-brand-name` uses `color: var(--brand-topnav-text, #ffffff)`.

## Files to Change

| File | Change |
|---|---|
| `demo_api_server/config/verticals/retail.json` | New header colors (black/yellow), topnav vars |
| `demo_api_server/config/verticals/banking.json` | Add `--brand-body-bg: #f8fafc` |
| `demo_api_server/config/verticals/healthcare.json` | Add `--brand-body-bg: #f8fafc` |
| `demo_api_server/config/verticals/sporting-goods.json` | Add `--brand-body-bg: #f8fafc` |
| `demo_api_server/config/verticals/workforce.json` | Add `--brand-body-bg: #f8fafc` |
| `demo_api_ui/src/components/TopNav.css` | Use `--brand-topnav-bg-*` and `--brand-topnav-text` vars |
| `demo_api_ui/src/index.css` | Add fallback defaults for all new vars |
| `demo_api_ui/src/components/DashboardHeader.css` | Use `--brand-dashboard-header-text` for title color |
| Any primary button CSS | Use `color: var(--app-primary-btn-text, #ffffff)` |

## Success Criteria

1. Switching to Great Buy: TopNav turns black/yellow, dashboard header is dark with yellow title, body is white.
2. Switching back to Super Banking: TopNav returns to dark slate, header is navy, everything distinct.
3. All yellow buttons (Great Buy) show black text.
4. No regressions on other theme switches (Healthcare, Sports, Workforce).
5. `npm run build` exits 0.
