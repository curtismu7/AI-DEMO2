# Login/Sign-In Button Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardise all login/sign-in/logout button text and styling across the app, extract a shared `AuthButton` component to replace inline styles, and add `UserTokenStatusBar` to the Login page.

**Architecture:** Create one new `AuthButton` component (`variant: "customer" | "admin" | "ghost"`) that replaces the hand-rolled inline styles in `QuickLoginModal` and `McpTrafficPage`. All `navigateToXxxOAuthLogin` calls are centralised through the existing `authUi.js` functions. `UserTokenStatusBar` is mounted on the Login page (anonymous state only — it already has all states built in). Label standard: "Sign In" / "Log Out" everywhere, title-case, two words.

**Tech Stack:** React (CRA), JavaScript (ES modules + JSX), CSS modules, existing `authUi.js` utility

---

## Files

| Action | Path | What changes |
|--------|------|--------------|
| **Create** | `demo_api_ui/src/components/AuthButton.jsx` | New shared button component |
| **Create** | `demo_api_ui/src/components/AuthButton.css` | Styles for AuthButton variants |
| **Modify** | `demo_api_ui/src/components/UserTokenStatusBar.jsx` | "Login" → "Sign In"; "Re-login" → "Sign In" |
| **Modify** | `demo_api_ui/src/components/Login.js` | Mount `UserTokenStatusBar`; switch to `authUi.js` helpers; shorten button labels |
| **Modify** | `demo_api_ui/src/components/QuickLoginModal.js` | Replace inline styles with `AuthButton`; use `authUi.js` |
| **Modify** | `demo_api_ui/src/components/McpTrafficPage.js` | Replace inline "Sign In" button with `AuthButton` |
| **Modify** | `demo_api_ui/src/components/SessionReauthBanner.js` | "Admin sign in" → "Admin Sign In" (capitalisation) |
| **Modify** | `demo_api_ui/src/components/Header.js` | "Logout" → "Log Out" |
| **Modify** | `demo_api_ui/src/components/SessionExpiryTimer.jsx` | "Logout" → "Log Out" (text + `title` + `aria-label`) |
| **Modify** | `demo_api_ui/src/components/UserMenu.js` | "Login" → "Sign In"; "Logout" → "Log Out" |

---

## Task 1: Create AuthButton component

`AuthButton` has three variants:
- **`customer`** — navy `#004687` background, white text (used for customer sign-in)
- **`admin`** — red `#b91c1c` background, white text (used for admin sign-in)
- **`ghost`** — transparent background, grey text, light border (used for dismiss/cancel actions)

**Files:**
- Create: `demo_api_ui/src/components/AuthButton.jsx`
- Create: `demo_api_ui/src/components/AuthButton.css`

- [ ] **Step 1: Create `AuthButton.css`**

```css
/* demo_api_ui/src/components/AuthButton.css */
.auth-btn {
  display: block;
  width: 100%;
  padding: 11px 20px;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  margin-bottom: 10px;
  text-align: center;
  transition: opacity 0.15s;
}

.auth-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.auth-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.auth-btn--customer {
  background: #004687;
  color: #ffffff;
}

.auth-btn--admin {
  background: #b91c1c;
  color: #ffffff;
}

.auth-btn--ghost {
  background: transparent;
  color: #374151;
  border: 1px solid #e2e8f0;
  font-weight: 500;
  font-size: 0.9rem;
}
```

- [ ] **Step 2: Create `AuthButton.jsx`**

```jsx
// demo_api_ui/src/components/AuthButton.jsx
import React from 'react';
import './AuthButton.css';

/**
 * AuthButton — shared button for sign-in and dismiss actions.
 *
 * @param {'customer'|'admin'|'ghost'} props.variant
 * @param {function} props.onClick
 * @param {boolean} [props.disabled]
 * @param {string} [props.className] - extra CSS classes
 * @param {React.ReactNode} props.children
 */
export default function AuthButton({ variant = 'customer', onClick, disabled = false, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      className={`auth-btn auth-btn--${variant}${className ? ' ' + className : ''}`}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/AuthButton.jsx demo_api_ui/src/components/AuthButton.css
git commit -m "feat(auth-ui): add shared AuthButton component (customer/admin/ghost variants)"
```

---

## Task 2: Fix UserTokenStatusBar labels

Change "Login" → "Sign In" and "Re-login" → "Sign In" in the two button labels inside `UserTokenStatusBar.jsx`.

**Files:**
- Modify: `demo_api_ui/src/components/UserTokenStatusBar.jsx`

- [ ] **Step 1: Fix anonymous state label (line 39)**

Change:
```jsx
          Login
```
To:
```jsx
          Sign In
```

- [ ] **Step 2: Fix expired state label (line 72)**

Change:
```jsx
          Re-login
```
To:
```jsx
          Sign In
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.` (or warnings only — no errors)

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/UserTokenStatusBar.jsx
git commit -m "fix(auth-ui): standardise UserTokenStatusBar labels to 'Sign In'"
```

---

## Task 3: Add UserTokenStatusBar to Login page + shorten labels

The Login page currently has no session status indicator. Add `UserTokenStatusBar` at the top of the card (anonymous state will show "Not logged in · Sign In"). Also switch `handleOAuthLogin` / `handleUserOAuthLogin` to use `authUi.js` functions and shorten button labels.

**Files:**
- Modify: `demo_api_ui/src/components/Login.js`

- [ ] **Step 1: Add imports to Login.js**

At the top of `demo_api_ui/src/components/Login.js`, after the existing imports, add:

```js
import UserTokenStatusBar from './UserTokenStatusBar';
import { navigateToAdminOAuthLogin, navigateToCustomerOAuthLogin } from '../utils/authUi';
```

- [ ] **Step 2: Replace handleOAuthLogin and handleUserOAuthLogin**

Find these two functions (lines 23–32):
```js
  const handleOAuthLogin = () => {
    // OAuth redirect_uri to PingOne is computed on the server (must match PingOne app allowlist).
    const apiUrl = process.env.REACT_APP_API_URL || window.location.origin;
    window.location.href = `${apiUrl}/api/auth/oauth/login`;
  };

  const handleUserOAuthLogin = () => {
    const apiUrl = process.env.REACT_APP_API_URL || window.location.origin;
    window.location.href = `${apiUrl}/api/auth/oauth/user/login`;
  };
```

Replace with:
```js
  const handleOAuthLogin = navigateToAdminOAuthLogin;
  const handleUserOAuthLogin = navigateToCustomerOAuthLogin;
```

- [ ] **Step 3: Mount UserTokenStatusBar in the JSX**

In the Login JSX, find the outer wrapper div (the first `<div>` returned). Add `UserTokenStatusBar` as the very first child inside the login card container, before the existing `<div className="login-card__header">`. The `user` prop is not available on this page (Login is only shown pre-auth), so pass `user={null}` and `tokenSecondsLeft={null}`.

Find this block (around line 90–95):
```jsx
          <div className="login-card__header">
```

Insert before it:
```jsx
          <UserTokenStatusBar user={null} tokenSecondsLeft={null} onOpenModal={() => {}} />
```

- [ ] **Step 4: Shorten button labels**

Find (line ~118):
```jsx
                  {loading ? 'Redirecting...' : 'Admin Sign in with PingOne AI IAM Core'}
```
Replace with:
```jsx
                  {loading ? 'Redirecting...' : 'Admin Sign In'}
```

Find (line ~134):
```jsx
                  {loading ? 'Redirecting...' : 'Customer Sign in with PingOne AI IAM Core'}
```
Replace with:
```jsx
                  {loading ? 'Redirecting...' : 'Customer Sign In'}
```

- [ ] **Step 5: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/Login.js
git commit -m "feat(auth-ui): add UserTokenStatusBar to Login page; shorten OAuth button labels"
```

---

## Task 4: Refactor QuickLoginModal — replace inline styles with AuthButton + authUi.js

`QuickLoginModal` currently has all button styles as inline JS objects and its own login handlers that duplicate `authUi.js`. Replace with `AuthButton` and import the shared navigation functions.

**Files:**
- Modify: `demo_api_ui/src/components/QuickLoginModal.js`

- [ ] **Step 1: Add AuthButton import**

At the top of `QuickLoginModal.js`, after the React import, add:
```js
import AuthButton from './AuthButton';
import { navigateToCustomerOAuthLogin, navigateToAdminOAuthLogin } from '../utils/authUi';
```

- [ ] **Step 2: Replace handleCustomerLogin and handleAdminLogin**

Find the two handler functions (lines 119–131):
```js
  const handleCustomerLogin = () => {
    try {
      sessionStorage.setItem('post_login_redirect', pathname);
    } catch {}
    window.location.href = '/api/auth/oauth/user/login';
  };

  const handleAdminLogin = () => {
    try {
      sessionStorage.setItem('post_login_redirect', pathname);
    } catch {}
    window.location.href = '/api/auth/oauth/login';
  };
```

Replace with:
```js
  const handleCustomerLogin = () => {
    try { sessionStorage.setItem('post_login_redirect', pathname); } catch {}
    navigateToCustomerOAuthLogin();
  };

  const handleAdminLogin = () => {
    try { sessionStorage.setItem('post_login_redirect', pathname); } catch {}
    navigateToAdminOAuthLogin();
  };
```

- [ ] **Step 3: Replace the three inline-styled buttons**

Find these buttons (lines 142–150):
```jsx
        <button type="button" style={BTN_PRIMARY_STYLE} onClick={handleCustomerLogin}>
          Customer Sign In
        </button>
        <button type="button" style={{ ...BTN_PRIMARY_STYLE, background: '#b91c1c', marginBottom: '12px' }} onClick={handleAdminLogin}>
          Admin Sign In
        </button>
        <button type="button" style={BTN_GHOST_STYLE} onClick={handleClose}>
          Back to Home
        </button>
```

Replace with:
```jsx
        <AuthButton variant="customer" onClick={handleCustomerLogin}>
          Customer Sign In
        </AuthButton>
        <AuthButton variant="admin" onClick={handleAdminLogin}>
          Admin Sign In
        </AuthButton>
        <AuthButton variant="ghost" onClick={handleClose}>
          Back to Home
        </AuthButton>
```

- [ ] **Step 4: Remove now-unused style constants**

Delete the six const objects at the top of the file: `OVERLAY_STYLE`, `MODAL_STYLE`, `ICON_STYLE`, `TITLE_STYLE`, `SUBTITLE_STYLE`, `BTN_PRIMARY_STYLE`, `BTN_GHOST_STYLE`, `CLOSE_STYLE`.

Keep `OVERLAY_STYLE`, `MODAL_STYLE`, `ICON_STYLE`, `TITLE_STYLE`, `SUBTITLE_STYLE`, and `CLOSE_STYLE` — those are still used for the overlay/modal/header chrome. **Only remove `BTN_PRIMARY_STYLE` and `BTN_GHOST_STYLE`.**

- [ ] **Step 5: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/QuickLoginModal.js
git commit -m "refactor(auth-ui): replace QuickLoginModal inline styles with AuthButton; use authUi.js"
```

---

## Task 5: Fix McpTrafficPage inline Sign In button

Replace the one hardcoded inline-styled "Sign In" button in the unauthenticated error state.

**Files:**
- Modify: `demo_api_ui/src/components/McpTrafficPage.js`

- [ ] **Step 1: Add AuthButton import**

Find the import block at the top of `McpTrafficPage.js`. Add:
```js
import AuthButton from './AuthButton';
```

- [ ] **Step 2: Replace the inline Sign In button**

Find (lines 581–587):
```jsx
            <button
              type="button"
              onClick={() => navigateToCustomerOAuthLogin()}
              style={{ padding: '6px 16px', borderRadius: '6px', border: 'none', background: '#1d4ed8', color: '#fff', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
            >
              Sign In
            </button>
```

Replace with:
```jsx
            <AuthButton variant="customer" onClick={() => navigateToCustomerOAuthLogin()}>
              Sign In
            </AuthButton>
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/McpTrafficPage.js
git commit -m "fix(auth-ui): replace McpTrafficPage inline sign-in button with AuthButton"
```

---

## Task 6: Fix SessionReauthBanner capitalisation

The `signInLabel` produces "Admin sign in" (lowercase "sign") and "Sign in" (lowercase "in"). Standardise to title-case.

**Files:**
- Modify: `demo_api_ui/src/components/SessionReauthBanner.js`

- [ ] **Step 1: Fix signInLabel**

Find (line 22):
```js
  const signInLabel = role === 'admin' ? 'Admin sign in' : 'Sign in';
```
Replace with:
```js
  const signInLabel = role === 'admin' ? 'Admin Sign In' : 'Sign In';
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/SessionReauthBanner.js
git commit -m "fix(auth-ui): capitalise SessionReauthBanner sign-in label to 'Admin Sign In' / 'Sign In'"
```

---

## Task 7: Standardise logout labels — Header, SessionExpiryTimer, UserMenu

Three components use "Logout" (one word). Standardise to "Log Out" (two words) across all three.

**Files:**
- Modify: `demo_api_ui/src/components/Header.js`
- Modify: `demo_api_ui/src/components/SessionExpiryTimer.jsx`
- Modify: `demo_api_ui/src/components/UserMenu.js`

- [ ] **Step 1: Fix Header.js**

Find (line 152):
```jsx
                Logout
```
Replace with:
```jsx
                Log Out
```

- [ ] **Step 2: Fix SessionExpiryTimer.jsx**

Find (lines 219–226):
```jsx
          <button
            className="banking-header__logout-btn"
            onClick={performLogout}
            title="Logout"
            aria-label="Logout"
          >
            Logout
          </button>
```
Replace with:
```jsx
          <button
            className="banking-header__logout-btn"
            onClick={performLogout}
            title="Log Out"
            aria-label="Log Out"
          >
            Log Out
          </button>
```

- [ ] **Step 3: Fix UserMenu.js — "Login" → "Sign In" and "Logout" → "Log Out"**

Find (lines 92–99):
```jsx
          <button className="user-menu-item user-menu-item-primary" onClick={handleLogin} type="button">
            <MdLogin className="user-menu-item-icon" />
            <span>Login</span>
          </button>
          <button className="user-menu-item user-menu-item-danger" onClick={handleLogout} type="button">
            <MdLogout className="user-menu-item-icon" />
            <span>Logout</span>
          </button>
```
Replace with:
```jsx
          <button className="user-menu-item user-menu-item-primary" onClick={handleLogin} type="button">
            <MdLogin className="user-menu-item-icon" />
            <span>Sign In</span>
          </button>
          <button className="user-menu-item user-menu-item-danger" onClick={handleLogout} type="button">
            <MdLogout className="user-menu-item-icon" />
            <span>Log Out</span>
          </button>
```

- [ ] **Step 4: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/Header.js \
        demo_api_ui/src/components/SessionExpiryTimer.jsx \
        demo_api_ui/src/components/UserMenu.js
git commit -m "fix(auth-ui): standardise 'Logout'→'Log Out' and 'Login'→'Sign In' across Header, SessionExpiryTimer, UserMenu"
```

---

## Task 8: Final build verification

- [ ] **Step 1: Full production build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -10
```
Expected: `Compiled successfully.` with exit code 0.

- [ ] **Step 2: Visual smoke-check (manual)**

Start services and verify:
```bash
cd /Users/curtismuir/Development/AI-Demo
./run.sh
```

Check these 5 locations:
1. **`/` (Login page)** — `UserTokenStatusBar` visible at top showing "Not logged in · Sign In"; two buttons read "Admin Sign In" and "Customer Sign In"
2. **`UserTokenStatusBar` anonymous state** — button reads "Sign In" (not "Login")
3. **`UserTokenStatusBar` expired state** — button reads "Sign In" (not "Re-login")
4. **`QuickLoginModal`** — navigate to `/accounts` without logging in; modal buttons read "Customer Sign In", "Admin Sign In", "Back to Home"; no inline style artefacts
5. **Dashboard header or Admin sidebar** — logout button/item reads "Log Out"

- [ ] **Step 3: Done — no REGRESSION_PLAN.md entry needed**

This change touches only text labels and styling. No logic, no auth flow, no session handling changed. No new critical area to add to §1. No bug to log in §4.
