# Dashboard Shell & Navigation Design

**Date:** 2026-05-23  
**Status:** Approved  
**Scope:** Add `UserTokenStatusBar` to both dashboards; add top nav tab strip with Dashboard, Users (admin only), Setup, Education, Logout links.

---

## Goal

Both the admin dashboard (`/admin`) and user dashboard (`/dashboard`) get a consistent chrome stack:

```
DashboardHeader      (logo + role badge — existing)
DashboardNavTabs     (tab strip — new, inside DashboardShell)
UserTokenStatusBar   (session status + countdown — existing component)
{children}           (existing dashboard content, unchanged)
```

A new `DashboardShell` wrapper component owns all three rows and is used by both dashboards.

---

## Layout

### Admin Dashboard (`/admin`)
```
[⬡ PingOne Demo]                                          [ADMIN]
[ Dashboard | Users | Setup | Education ]         [ Logout ]
[● Admin User  admin@demo.com  |  Token expires in 847s  [View Token] ]
… existing admin content …
```

### User Dashboard (`/dashboard`)
```
[⬡ PingOne Demo]                                       [CUSTOMER]
[ Dashboard | Setup | Education ]                  [ Logout ]
[● Demo User  user@demo.com  |  Token expires in 412s  [View Token] ]
… existing user content …
```

---

## New Files

### `demo_api_ui/src/components/DashboardShell.jsx`

Wrapper component. Renders `DashboardHeader`, the nav tab strip, and `UserTokenStatusBar`, then `{children}`.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `variant` | `"admin" \| "user"` | Controls which tabs appear and header badge |
| `user` | object \| null | Passed to `UserTokenStatusBar` (`firstName`, `lastName`, `email`, `id`, `role`) |
| `tokenSecondsLeft` | number \| null | Live countdown, passed to `UserTokenStatusBar` |
| `onOpenModal` | function | Callback for "View Token" button — matches `UserTokenStatusBar`'s `onOpenModal` prop |
| `onLogout` | function | Callback for Logout tab click |

**Nav links by variant:**

| Link | Admin | User | Action |
|---|---|---|---|
| Dashboard | ✅ | ✅ | `navigate("/admin")` or `navigate("/dashboard")` based on `variant` |
| Users | ✅ | — | `navigate("/users")` |
| Setup | ✅ | ✅ | `navigate("/setup")` |
| Education | ✅ | ✅ | `navigate("/education")` |
| Logout | ✅ | ✅ | `onLogout()` prop (right-aligned via `margin-left: auto`) |

Active tab is determined by `useLocation()` matching the current path.

### `demo_api_ui/src/components/DashboardShell.css`

Styles for the tab strip:
- Tab row: horizontal flex, same dark background as existing `DashboardHeader` theme
- Active tab: bottom border indicator (`border-bottom: 2px solid` accent colour)
- Hover state on inactive tabs
- Logout tab: `margin-left: auto` to right-align it
- No changes to `UserTokenStatusBar.css`

---

## Modified Files

### `demo_api_ui/src/components/Dashboard.js` (admin)

1. Import `DashboardShell`
2. Wrap the top-level return JSX in `<DashboardShell variant="admin" user={user} tokenSecondsLeft={tokenSecondsLeft} onOpenModal={openTokenModal} onLogout={onLogout}>`
3. Remove only the inline "View OAuth Token Info" toolbar button (`onClick={openTokenModal}`, lines ~533–548). All other toolbar items (ThemePicker, API Calls, Reset Demo, Export) remain unchanged.
4. Remove the now-unused `UserTokenStatusBar` import (line 27 — was imported but never rendered).

### `demo_api_ui/src/components/UserDashboard.js` (user)

1. Import `DashboardShell`
2. Wrap the top-level return JSX in `<DashboardShell variant="user" user={user} tokenSecondsLeft={tokenSecondsLeft} onOpenModal={() => setShowTokenModal(true)} onLogout={onLogout}>`
3. Remove the standalone `<UserTokenStatusBar>` render at line 2524 (shell owns it now)
4. The countdown `useEffect` and `tokenSecondsLeft` state remain in `UserDashboard.js` — shell receives the value as a prop. `onLogout` is already a prop on `UserDashboard` passed from `App.js`.

### `demo_api_ui/src/App.js`

1. Add route: `/education` → `<EducationPage />`
2. Guard with a standard authenticated-user check (same pattern as `/dashboard`, not `AdminRoute` — accessible to both admin and user roles).
3. Import `EducationPage`.

---

## New Route: `/education`

### `demo_api_ui/src/components/EducationPage.jsx`

Thin page component. Renders a grid/list of education topics sourced from the existing `learnItems` array (defined in `AdminSideNav.jsx` at line 282). Extract `learnItems` to a shared constant file (e.g. `demo_api_ui/src/data/learnItems.js`) so both `AdminSideNav` and `EducationPage` can import it without circular deps.

Clicking a topic calls the existing `openEdu()` mechanism via `EducationUIContext` — no new education logic, just a new entry point.

**No new education content** — purely a navigation surface to what already exists.

---

## What Does Not Change

- `UserTokenStatusBar.jsx` — no changes to the component itself
- `UserTokenStatusBar.css` — no changes
- `DashboardHeader.js` — no changes; shell renders it as-is
- All existing dashboard content (account panels, token chain, MCP agent, user lookup) — untouched
- Token countdown state management — stays in each parent dashboard; shell is a pure display consumer
- `AdminSideNav.jsx` education section — remains as-is; `EducationPage` is an additional entry point, not a replacement

---

## Success Criteria

- Both `/admin` and `/dashboard` show: header → nav tabs → token status bar → content
- Admin sees 5 tabs: Dashboard, Users, Setup, Education, Logout
- User sees 4 tabs: Dashboard, Setup, Education, Logout
- Active tab is highlighted based on current route
- "View Token" in the token bar opens the existing token modal on both dashboards
- Logout tab calls the existing `logout()` function
- `/education` route loads and lists education topics; clicking a topic opens the education panel
- `npm run build` in `demo_api_ui/` exits 0
- No regression: admin login → `/admin`, user login → `/dashboard`, OAuth callbacks unchanged

---

## Out of Scope

- Redesigning existing dashboard content
- Mobile/responsive nav (existing dashboards are desktop-first)
- Changing education panel content
- Adding new education topics
