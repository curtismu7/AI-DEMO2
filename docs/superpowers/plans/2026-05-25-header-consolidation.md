# Header Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse three stacked header components (TopNav + DashboardHeader + UserTokenStatusBar) into one unified 52px dark bar, recovering ~108px of vertical space for the agent panel and Token Chain.

**Architecture:** A new `SessionTokenContext` bridges token state from page components (Dashboard, UserDashboard) to TopNav (rendered in App.js at the route level). TopNav gains an inline token pill and dashboard badge; DashboardHeader and UserTokenStatusBar are deleted entirely; UserMenu gains the view-switch action and user ID display.

**Tech Stack:** React 18, CRA, CSS modules (plain CSS files per component), React Context API

**Spec:** `docs/superpowers/specs/2026-05-25-header-consolidation-design.md`

---

## File Map

| Action | File | What changes |
|---|---|---|
| Create | `demo_api_ui/src/context/SessionTokenContext.js` | Context + provider + hook for `tokenSecondsLeft`, `onOpenTokenModal` |
| Modify | `demo_api_ui/src/App.js` | Wrap routes in `SessionTokenProvider`; pass `tokenSecondsLeft`+`onOpenTokenModal` to `TopNav` |
| Modify | `demo_api_ui/src/components/TopNav.js` | Add token pill, dashboard badge; remove view-switch btn, run-servers btn, page label |
| Modify | `demo_api_ui/src/components/TopNav.css` | Add token pill + badge styles; remove old button styles |
| Modify | `demo_api_ui/src/components/UserMenu.js` | Add view-switch item; show user ID in dropdown header |
| Modify | `demo_api_ui/src/components/Dashboard.js` | Remove DashboardHeader + UserTokenStatusBar; publish token state via context |
| Modify | `demo_api_ui/src/components/UserDashboard.js` | Same removals; publish token state via context |
| Modify | `demo_api_ui/src/components/Login.js` | Remove UserTokenStatusBar usage |
| Delete | `demo_api_ui/src/components/DashboardHeader.js` | Eliminated |
| Delete | `demo_api_ui/src/components/DashboardHeader.css` | Eliminated |
| Delete | `demo_api_ui/src/components/UserTokenStatusBar.jsx` | Eliminated |
| Delete | `demo_api_ui/src/components/UserTokenStatusBar.css` | Eliminated |
| Modify | `demo_api_ui/src/components/__tests__/DashboardHeader.theme.test.js` | Delete file (component gone) |

---

## Task 1: Create SessionTokenContext

**Files:**
- Create: `demo_api_ui/src/context/SessionTokenContext.js`

This context lets any page component publish its live `tokenSecondsLeft` and `onOpenTokenModal` callback so that `TopNav` (rendered at the App level) can read them.

- [ ] **Step 1: Create the context file**

```js
// demo_api_ui/src/context/SessionTokenContext.js
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const SessionTokenContext = createContext(null);

export function SessionTokenProvider({ children }) {
  const [tokenSecondsLeft, setTokenSecondsLeft] = useState(null);
  const [openTokenModal, setOpenTokenModal] = useState(null); // stores a callback fn

  const publishTokenState = useCallback((seconds, openModalFn) => {
    setTokenSecondsLeft(seconds);
    setOpenTokenModal(() => openModalFn); // wrap in arrow so useState doesn't call it
  }, []);

  const value = useMemo(() => ({
    tokenSecondsLeft,
    openTokenModal,
    publishTokenState,
  }), [tokenSecondsLeft, openTokenModal, publishTokenState]);

  return (
    <SessionTokenContext.Provider value={value}>
      {children}
    </SessionTokenContext.Provider>
  );
}

export function useSessionToken() {
  const ctx = useContext(SessionTokenContext);
  if (!ctx) throw new Error('useSessionToken must be used within SessionTokenProvider');
  return ctx;
}
```

- [ ] **Step 2: Verify the file exists and has no syntax errors**

```bash
cd demo_api_ui && node -e "require('./src/context/SessionTokenContext.js')" 2>&1 || echo "CJS check skipped (ESM)"
```

Expected: no output or "CJS check skipped" (CRA uses ESM; syntax error would surface at build time).

- [ ] **Step 3: Commit**

```bash
cd demo_api_ui
git add src/context/SessionTokenContext.js
git commit -m "feat(header): add SessionTokenContext for cross-component token state"
```

---

## Task 2: Wrap App.js routes in SessionTokenProvider

**Files:**
- Modify: `demo_api_ui/src/App.js`

TopNav is rendered inside every route in App.js. Wrap the router content in `SessionTokenProvider` so both TopNav and page components share the same context instance.

- [ ] **Step 1: Add the import to App.js**

Find the imports block near the top of `demo_api_ui/src/App.js` and add:

```js
import { SessionTokenProvider } from './context/SessionTokenContext';
```

- [ ] **Step 2: Wrap the Router content**

In App.js, find the outermost JSX returned from the component. Wrap it in `<SessionTokenProvider>`. The structure should look like:

```jsx
return (
  <SessionTokenProvider>
    {/* existing ThemeProvider, BrowserRouter, etc. */}
    ...
  </SessionTokenProvider>
);
```

Place `SessionTokenProvider` outside `BrowserRouter` (or as its immediate parent) so it covers all routes. Do not restructure anything else.

- [ ] **Step 3: Build to verify no errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/App.js
git commit -m "feat(header): wrap app in SessionTokenProvider"
```

---

## Task 3: Publish token state from Dashboard.js

**Files:**
- Modify: `demo_api_ui/src/components/Dashboard.js`

Dashboard already manages `tokenSecondsLeft` and `setShowTokenModal`. Use the context to publish these so TopNav can read them.

- [ ] **Step 1: Add the import**

At the top of `demo_api_ui/src/components/Dashboard.js`, add:

```js
import { useSessionToken } from '../context/SessionTokenContext';
```

- [ ] **Step 2: Call publishTokenState in the component**

Inside the `Dashboard` function body, after the existing `tokenSecondsLeft` state declaration, add a `useEffect` that publishes whenever tokenSecondsLeft changes:

```js
const { publishTokenState } = useSessionToken();

useEffect(() => {
  publishTokenState(tokenSecondsLeft, () => setShowTokenModal(true));
}, [tokenSecondsLeft, publishTokenState]); // setShowTokenModal is stable
```

Place this after the line that declares `const [tokenSecondsLeft, setTokenSecondsLeft] = useState(null);`.

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard.js
git commit -m "feat(header): publish token state from Dashboard via SessionTokenContext"
```

---

## Task 4: Publish token state from UserDashboard.js

**Files:**
- Modify: `demo_api_ui/src/components/UserDashboard.js`

Same pattern as Task 3, for the customer dashboard.

- [ ] **Step 1: Add the import**

```js
import { useSessionToken } from '../context/SessionTokenContext';
```

- [ ] **Step 2: Call publishTokenState**

Find the existing `tokenSecondsLeft` state declaration in `UserDashboard.js`. Add directly below it:

```js
const { publishTokenState } = useSessionToken();

useEffect(() => {
  publishTokenState(tokenSecondsLeft, () => setShowTokenModal(true));
}, [tokenSecondsLeft, publishTokenState]);
```

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/components/UserDashboard.js
git commit -m "feat(header): publish token state from UserDashboard via SessionTokenContext"
```

---

## Task 5: Update TopNav — add token pill + dashboard badge

**Files:**
- Modify: `demo_api_ui/src/components/TopNav.js`

This is the main visual change. Add:
1. Dashboard badge inline after brand name
2. Token pill in the right section (reads from SessionTokenContext)

Remove:
1. `topnav-view-switch` button
2. `topnav-run-servers-btn` button + `RunServersModal` import/usage
3. `pageLabel` logic + `topnav-page-label` element

- [ ] **Step 1: Add imports to TopNav.js**

```js
import { useSessionToken } from '../context/SessionTokenContext';
```

Remove this import (RunServersModal will no longer be used):
```js
import RunServersModal from "./RunServersModal";
```

- [ ] **Step 2: Update the component body**

Replace the full `TopNav` function body with the following. Read the current file carefully first — preserve any logic not listed here (navigate, location, identity, brandName, isAdminView):

```jsx
export default function TopNav({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { identity } = useTheme();
  const { tokenSecondsLeft, openTokenModal } = useSessionToken();
  const brandName = (identity && identity.displayName) || 'Super Bank';

  const isAdminView =
    user?.role === 'admin' &&
    (location.pathname.startsWith('/admin') ||
      location.pathname === '/users' ||
      location.pathname === '/activity' ||
      location.pathname === '/audit' ||
      location.pathname === '/configure' ||
      location.pathname === '/settings' ||
      location.pathname === '/scope-audit' ||
      location.pathname === '/scope-reference' ||
      location.pathname === '/feature-flags' ||
      location.pathname === '/pingone-test' ||
      location.pathname === '/mfa-test' ||
      location.pathname === '/error-audit' ||
      location.pathname === '/oauth-debug');

  const dashboardBadge = isAdminView ? 'Admin Dashboard' : null;

  const handleSwitchView = () => {
    if (isAdminView) {
      navigate('/dashboard');
    } else {
      navigate('/admin');
    }
  };

  // Token pill helpers
  function formatCountdown(seconds) {
    if (seconds === null || seconds < 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  const tokenExpiring = tokenSecondsLeft !== null && tokenSecondsLeft > 0 && tokenSecondsLeft < 300;
  const tokenExpired = tokenSecondsLeft !== null && tokenSecondsLeft <= 0;

  const displayName =
    (user?.firstName && user?.lastName)
      ? `${user.firstName} ${user.lastName}`
      : user?.username || user?.email || null;

  return (
    <header className="topnav">
      <div className="topnav-container">

        {/* Left: Brand + dashboard badge */}
        <div className="topnav-left">
          <button
            type="button"
            className="topnav-brand"
            onClick={() => navigate(user?.role === 'admin' ? '/admin' : '/dashboard')}
            aria-label="Go to dashboard"
          >
            <MdAccountBalance className="topnav-brand-icon" />
            <span className="topnav-brand-name">{brandName}</span>
          </button>
          {dashboardBadge && (
            <>
              <span className="topnav-brand-divider" aria-hidden="true" />
              <span className="topnav-dashboard-badge">{dashboardBadge}</span>
            </>
          )}
        </div>

        {/* Center: Quick nav (admin only) */}
        {user?.role === 'admin' && (
          <nav className="topnav-center">
            <button type="button" className="topnav-group-trigger" onClick={() => navigate('/dashboard')}>Customer</button>
            <button type="button" className="topnav-group-trigger" onClick={() => navigate('/admin')}>Admin</button>
            <button type="button" className="topnav-group-trigger" onClick={() => navigate('/setup')}>Setup</button>
          </nav>
        )}

        {/* Right: token pill + search + user menu */}
        <div className="topnav-right">

          {/* Token pill — only when user is logged in */}
          {user && (
            <div
              className={`topnav-token-pill${tokenExpiring ? ' topnav-token-pill--expiring' : ''}${tokenExpired ? ' topnav-token-pill--expired' : ''}`}
              role="status"
              aria-label="Session status"
            >
              {tokenSecondsLeft === null && (
                <span className="topnav-token-pill__shimmer" aria-hidden="true" />
              )}
              {tokenSecondsLeft !== null && !tokenExpired && (
                <>
                  <span className="topnav-token-pill__dot" aria-hidden="true" />
                  {displayName && <span className="topnav-token-pill__name">{displayName}</span>}
                  <span className="topnav-token-pill__countdown">{formatCountdown(tokenSecondsLeft)}</span>
                  <button
                    type="button"
                    className="topnav-token-pill__view-btn"
                    onClick={openTokenModal}
                    title="View token details"
                  >
                    View Token
                  </button>
                </>
              )}
              {tokenExpired && (
                <>
                  <span className="topnav-token-pill__dot" aria-hidden="true" />
                  <span className="topnav-token-pill__expired-label">Session expired</span>
                  <button
                    type="button"
                    className="topnav-token-pill__view-btn"
                    onClick={() => navigateToCustomerOAuthLogin()}
                  >
                    Sign In
                  </button>
                </>
              )}
            </div>
          )}

          {/* Search */}
          <div className="topnav-search">
            <button className="topnav-search-btn" onClick={() => {}} aria-label="Search" type="button">
              <MdSearch size={20} />
            </button>
          </div>

          {/* Login button — logged-out state */}
          {!user && (
            <button type="button" className="topnav-login-btn" onClick={() => navigateToCustomerOAuthLogin()}>
              <MdLogin size={18} />
              <span>Login</span>
            </button>
          )}

          {/* User menu */}
          <UserMenu
            user={user}
            onLogout={onLogout}
            isAdminView={isAdminView}
            onSwitchView={handleSwitchView}
          />
        </div>

      </div>
    </header>
  );
}
```

Note: `searchOpen` state removed — the search button can be wired up properly in a follow-up. For now it renders the icon with a no-op `onClick` to keep the UI clean.

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.` (UserMenu prop warnings may appear — fixed in Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/components/TopNav.js
git commit -m "feat(header): replace 3-header stack with unified bar in TopNav"
```

---

## Task 6: Update UserMenu — add view switch + user ID

**Files:**
- Modify: `demo_api_ui/src/components/UserMenu.js`

UserMenu now receives two new props: `isAdminView` (boolean) and `onSwitchView` (function). Add a "Switch to Admin/Customer View" item in the dropdown, and display user ID in the header section.

- [ ] **Step 1: Update the UserMenu function signature**

Change:
```js
export default function UserMenu({ user, onLogout }) {
```
To:
```js
export default function UserMenu({ user, onLogout, isAdminView = false, onSwitchView }) {
```

- [ ] **Step 2: Add user ID to dropdown header**

Find the `.user-menu-info` div in the JSX. It currently shows name, email, and role. Add user ID below email:

```jsx
<div className="user-menu-info">
  <div className="user-menu-name">
    {user?.firstName} {user?.lastName}
  </div>
  <div className="user-menu-email">{user?.email || ''}</div>
  {user?.id && (
    <div className="user-menu-userid" title="User ID">{user.id}</div>
  )}
  <div className="user-menu-role">
    {user?.role === 'admin' ? 'Admin' : 'Customer'}
  </div>
</div>
```

(Remove the crown/person emoji from role — CLAUDE.md emoji rule.)

- [ ] **Step 3: Add view switch item**

Find the divider before the Sign In / Log Out buttons. Insert the view switch item above it:

```jsx
<div className="user-menu-divider"></div>

{user?.role === 'admin' && onSwitchView && (
  <button
    className="user-menu-item"
    type="button"
    onClick={() => { setIsOpen(false); onSwitchView(); }}
  >
    <span className="user-menu-item-icon">↔</span>
    <span>{isAdminView ? 'Switch to Customer View' : 'Switch to Admin View'}</span>
  </button>
)}

<div className="user-menu-divider"></div>
```

- [ ] **Step 4: Add user-menu-userid CSS to UserMenu.css**

Open `demo_api_ui/src/components/UserMenu.css` and add after `.user-menu-email` styles:

```css
.user-menu-userid {
  font-size: 11px;
  color: #94a3b8;
  font-family: monospace;
  margin-top: 1px;
}
```

- [ ] **Step 5: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
git add src/components/UserMenu.js src/components/UserMenu.css
git commit -m "feat(header): add view switch + user ID to UserMenu dropdown"
```

---

## Task 7: Add token pill + badge CSS to TopNav.css

**Files:**
- Modify: `demo_api_ui/src/components/TopNav.css`

Add new styles for the token pill and dashboard badge. Remove the now-unused view-switch, run-servers, and page-label rules.

- [ ] **Step 1: Remove dead CSS rules**

In `demo_api_ui/src/components/TopNav.css`, delete the rule blocks for:
- `.topnav-view-switch` and any modifier classes (`.topnav-view-switch--customer`, `.topnav-view-switch--admin`)
- `.topnav-run-servers-btn`
- `.topnav-page-label` and `.topnav-page-label__text`

- [ ] **Step 2: Add dashboard badge styles**

```css
/* Dashboard badge (inline in brand area) */
.topnav-brand-divider {
  display: inline-block;
  width: 1px;
  height: 16px;
  background: #475569;
  margin: 0 6px;
  flex-shrink: 0;
}

.topnav-dashboard-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.07);
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid #475569;
  white-space: nowrap;
}
```

- [ ] **Step 3: Add token pill styles**

```css
/* Token pill */
.topnav-token-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid #334155;
  border-radius: 5px;
  padding: 3px 10px;
  min-width: 0;
}

.topnav-token-pill__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  flex-shrink: 0;
}

.topnav-token-pill--expiring .topnav-token-pill__dot {
  background: #f59e0b;
}

.topnav-token-pill--expired .topnav-token-pill__dot {
  background: #ef4444;
}

.topnav-token-pill__name {
  font-size: 12px;
  color: #e2e8f0;
  font-weight: 600;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topnav-token-pill__countdown {
  font-size: 12px;
  color: #4ade80;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.topnav-token-pill--expiring .topnav-token-pill__countdown {
  color: #fbbf24;
}

.topnav-token-pill__view-btn {
  font-size: 11px;
  color: #60a5fa;
  background: none;
  border: none;
  border-left: 1px solid #334155;
  padding: 0 0 0 8px;
  margin-left: 3px;
  cursor: pointer;
  white-space: nowrap;
}

.topnav-token-pill__view-btn:hover {
  color: #93c5fd;
}

.topnav-token-pill__expired-label {
  font-size: 12px;
  color: #f87171;
  font-weight: 600;
}

.topnav-token-pill__shimmer {
  display: inline-block;
  width: 120px;
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(90deg, #334155 25%, #475569 50%, #334155 75%);
  background-size: 200% 100%;
  animation: topnav-shimmer 1.4s infinite;
}

@keyframes topnav-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

- [ ] **Step 4: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
git add src/components/TopNav.css
git commit -m "feat(header): add token pill + badge CSS, remove dead header styles"
```

---

## Task 8: Remove DashboardHeader and UserTokenStatusBar from Dashboard.js

**Files:**
- Modify: `demo_api_ui/src/components/Dashboard.js`

- [ ] **Step 1: Remove imports**

Delete these two import lines from `Dashboard.js`:
```js
import DashboardHeader from "./DashboardHeader";
import UserTokenStatusBar from "./UserTokenStatusBar";
```

- [ ] **Step 2: Remove JSX usage**

Find and delete:
```jsx
<DashboardHeader variant="admin" />
<UserTokenStatusBar
  user={user}
  tokenSecondsLeft={tokenSecondsLeft}
  onOpenModal={() => setShowTokenModal(true)}
/>
```

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard.js
git commit -m "feat(header): remove DashboardHeader + UserTokenStatusBar from Dashboard"
```

---

## Task 9: Remove DashboardHeader and UserTokenStatusBar from UserDashboard.js and Login.js

**Files:**
- Modify: `demo_api_ui/src/components/UserDashboard.js`
- Modify: `demo_api_ui/src/components/Login.js`

- [ ] **Step 1: Update UserDashboard.js imports**

Delete:
```js
import DashboardHeader from "./DashboardHeader";
import UserTokenStatusBar from "./UserTokenStatusBar";
```

- [ ] **Step 2: Remove UserDashboard.js JSX**

Find and delete (around line 2523):
```jsx
<DashboardHeader variant="customer" />
<UserTokenStatusBar
  user={user}
  tokenSecondsLeft={tokenSecondsLeft}
  onOpenModal={() => setShowTokenModal(true)}
/>
```

- [ ] **Step 3: Update Login.js**

Delete the import:
```js
import UserTokenStatusBar from './UserTokenStatusBar';
```

Delete the JSX usage:
```jsx
<UserTokenStatusBar user={null} tokenSecondsLeft={null} onOpenModal={() => {}} />
```

- [ ] **Step 4: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
git add src/components/UserDashboard.js src/components/Login.js
git commit -m "feat(header): remove DashboardHeader + UserTokenStatusBar from UserDashboard and Login"
```

---

## Task 10: Delete the eliminated component files

**Files:**
- Delete: `demo_api_ui/src/components/DashboardHeader.js`
- Delete: `demo_api_ui/src/components/DashboardHeader.css`
- Delete: `demo_api_ui/src/components/UserTokenStatusBar.jsx`
- Delete: `demo_api_ui/src/components/UserTokenStatusBar.css`
- Delete: `demo_api_ui/src/components/__tests__/DashboardHeader.theme.test.js`

- [ ] **Step 1: Delete the files**

```bash
cd demo_api_ui
rm src/components/DashboardHeader.js
rm src/components/DashboardHeader.css
rm src/components/UserTokenStatusBar.jsx
rm src/components/UserTokenStatusBar.css
rm src/components/__tests__/DashboardHeader.theme.test.js
```

- [ ] **Step 2: Build — verify no dangling imports**

```bash
npm run build 2>&1 | tail -15
```

Expected: `Compiled successfully.` — no "Cannot find module" errors.

- [ ] **Step 3: Run the test suite**

```bash
npm test -- --watchAll=false 2>&1 | tail -30
```

Expected: all tests pass. The `DashboardHeader.theme.test.js` file is gone so those tests no longer run — that's correct.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(header): delete DashboardHeader + UserTokenStatusBar components"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 2: Run all tests**

```bash
cd /Users/curtismuir/Development/AI-Demo && npm test 2>&1 | tail -30
```

Expected: all suites pass.

- [ ] **Step 3: Manual checklist**

Start the app (`./run.sh` from repo root), then verify:

1. `/admin` — single dark header bar visible; no white DashboardHeader below it; no grey status bar below that
2. Token pill shows: `● Curtis Muir  12m 34s  View Token` in the right of the nav bar
3. Click "View Token" → token modal opens
4. `/dashboard` (customer view) — same single bar; token pill visible; badge says nothing (no admin badge on customer page)
5. User menu (avatar click) → dropdown shows: user ID, "Switch to Admin/Customer View", Logout
6. "Switch to Admin/Customer View" navigates correctly
7. No "Run Servers" button anywhere on the page
8. Token pill turns amber when token < 5 minutes (test by temporarily reducing token lifetime in PingOne or wait)
9. Logged-out state: Login button appears in right of nav bar; no token pill

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(header): address manual verification findings"
```
