# Header Consolidation Design

**Date:** 2026-05-25  
**Status:** Approved

---

## Problem

The dashboard currently renders three stacked headers before any content:

| Layer | Component | Height | Background |
|---|---|---|---|
| 1 | `TopNav` | ~52px | Dark gradient |
| 2 | `DashboardHeader` | ~48px | White |
| 3 | `UserTokenStatusBar` | ~36px | Light grey |

Total: **~160px** of header real estate before the agent panel and Token Chain become visible. This hurts usability — the core demo content is pushed too far down.

---

## Goal

Collapse all three headers into **one unified dark bar** (~52px), recovering ~108px of vertical space for the agent panel and Token Chain. No functionality lost except items explicitly removed.

---

## Design

### Single unified bar (52px, dark gradient)

```
[Logo] Super Bank | Admin Dashboard    [Customer] [Admin] [Setup]    [● Curtis Muir  12m 34s  View Token] [🔍] [C ▾]
└─ left ───────────────────────────────┴─ center ──────────────────┴─ right ─────────────────────────────────────────┘
```

**Left:** Brand icon (MdAccountBalance) + "Super Bank" name + vertical divider + "Admin Dashboard" badge (replaces DashboardHeader entirely)

**Center:** Customer / Admin / Setup quick-nav buttons (unchanged from TopNav)

**Right (left to right):**
1. **Token pill** — green dot · username · live countdown · "View Token" link (replaces UserTokenStatusBar)
2. **Search icon** (unchanged)
3. **User menu avatar** (unchanged — see menu changes below)

### Token pill states

| State | Appearance |
|---|---|
| Loading | Shimmer placeholder |
| Active | ● green dot · name · `12m 34s` · View Token |
| Expiring (<5min) | ● amber dot · name · `4m 12s` · View Token (amber text) |
| Expired | ● red dot · `Session expired` · Sign In link |
| Anonymous | Not shown; Login button in right slot instead |

### User menu additions

Two items added to existing `UserMenu` dropdown (below Settings, above Log Out):

1. **Switch to Admin/Customer View** — previously the `topnav-view-switch` button in the top bar
2. User ID displayed in the existing menu header section (was shown in status bar)

### Items removed

| Removed | Reason |
|---|---|
| `▶ Run Servers` button | Explicitly removed per product decision |
| `DashboardHeader` component (entire) | Replaced by brand + badge in unified bar |
| `UserTokenStatusBar` component (entire) | Replaced by token pill in unified bar |
| "AI Demo" `<h1>` title | Redundant — brand name already present |
| Page label text (e.g. "Administrator Dashboard") | Redundant — dashboard badge covers this |

---

## Component Changes

### `TopNav.js` — primary change surface

- Remove `topnav-view-switch` button from JSX (move to UserMenu)
- Remove `topnav-run-servers-btn` button + `RunServersModal` usage
- Remove `pageLabel` logic + `topnav-page-label` element
- Add brand logo `<img>` (or use existing `MdAccountBalance` icon) + divider + dashboard badge inline in left section
- Add token pill component inline in right section (receives `user`, `tokenSecondsLeft`, `onOpenModal` props — same as current UserTokenStatusBar)
- Token pill handles all 4 states (loading shimmer, active, expiring, expired/anonymous)

### `TopNav.css` — update styles

- Remove: `.topnav-view-switch`, `.topnav-run-servers-btn`, `.topnav-page-label` rules
- Add: `.topnav-badge` (inline dashboard badge), `.topnav-token-pill` and sub-elements

### `UserMenu.js` — add two items

- Add "Switch to Admin/Customer View" button (receives `isAdminView` + `onSwitchView` props, or reads from router internally)
- Add user ID to existing `.user-menu-info` block in the dropdown header

### `Dashboard.js` — remove two components

- Remove `<DashboardHeader variant="admin" />` import + usage
- Remove `<UserTokenStatusBar ... />` import + usage
- Pass `tokenSecondsLeft` and `onOpenModal` down to `TopNav` instead (TopNav already receives `user`)

### `CustomerDashboard.js` (or equivalent customer page) — same removal

- Remove `<DashboardHeader variant="customer" />` + `<UserTokenStatusBar />` if present

### Files deleted

- `demo_api_ui/src/components/DashboardHeader.js`
- `demo_api_ui/src/components/DashboardHeader.css`
- `demo_api_ui/src/components/UserTokenStatusBar.jsx`
- `demo_api_ui/src/components/UserTokenStatusBar.css`

---

## Props threading

`TopNav` currently receives `user` and `onLogout`. Add:

```js
TopNav({ user, onLogout, tokenSecondsLeft, onOpenTokenModal })
```

`Dashboard.js` already has `tokenSecondsLeft` and `setShowTokenModal` in state — pass them straight through.

---

## What does NOT change

- All OAuth/session/token logic — purely cosmetic/layout change
- `RunServersModal` component (can be deleted once button removed, or kept for future)
- `UserMenu` dropdown items (Profile, Notifications, Settings, Logout) — only additions
- Token modal itself (`setShowTokenModal` / modal component)
- Any route, API call, or BFF behaviour

---

## Success criteria

1. `npm run build` in `demo_api_ui/` exits 0
2. Single header bar visible on `/admin` and `/dashboard` — no white DashboardHeader, no grey status bar
3. Token pill shows name + countdown + "View Token" on admin and customer pages
4. "View Token" opens the token modal (same as before)
5. Expiring token (<5min) shows amber colour in pill
6. User menu contains "Switch to Customer/Admin View" and it navigates correctly
7. User ID visible in user menu header
8. No `▶ Run Servers` button anywhere
9. `DashboardHeader` and `UserTokenStatusBar` files deleted
10. Existing TopNav tests (if any) updated; no new console errors
