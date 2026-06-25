# UserTokenStatusBar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `UserTokenStatusBar` below the `DashboardHeader` on `/dashboard` that shows live token status + expiry countdown and opens a modal wrapping `OAuthTokenDisplayPage` when clicked.

**Architecture:** A new self-contained `UserTokenStatusBar` component receives `user`, `tokenSecondsLeft`, `tokenExpiresAt`, and `onOpenModal` as props and renders the correct state (active/expired/not-logged-in). The existing `openTokenModal` handler in `UserDashboard.js` is reused; its `FloatingPanel` is updated to render `<OAuthTokenDisplayPage>` instead of the hand-rolled token markup. The "Token Info" toolbar button is removed — the status bar replaces it as the primary entry point.

**Tech Stack:** React 17 (CRA), CSS modules pattern (plain `.css` co-located with component), existing `FloatingPanel`, existing `OAuthTokenDisplayPage`, existing `navigateToCustomerOAuthLogin` utility.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_ui/src/components/UserTokenStatusBar.jsx` | **Create** | Status bar UI: active/expired/not-logged-in states, calls `onOpenModal` |
| `demo_api_ui/src/components/UserTokenStatusBar.css` | **Create** | Styles for the status bar |
| `demo_api_ui/src/components/UserDashboard.js` | **Modify** | Import + render `UserTokenStatusBar`; swap FloatingPanel content to `<OAuthTokenDisplayPage>`; remove "Token Info" button |

---

## Task 1: Create `UserTokenStatusBar` component

**Files:**
- Create: `demo_api_ui/src/components/UserTokenStatusBar.jsx`
- Create: `demo_api_ui/src/components/UserTokenStatusBar.css`

### Context

`UserDashboard.js` already tracks:
- `user` — user object from session (`{ firstName, lastName, email, role }`) or `null`
- `tokenExpiresAt` — Unix timestamp in **ms** (set from `/api/auth/oauth/user/status` response's `expiresAt`)
- `tokenSecondsLeft` — integer countdown updated every second via `setInterval`
- `openTokenModal` — function that fetches token data and opens the `FloatingPanel`

The status bar receives these as props and decides what to render.

**Three states:**

| Condition | Display |
|---|---|
| `user === null` | "Not logged in" + Login button |
| `user !== null && tokenSecondsLeft !== null && tokenSecondsLeft <= 0` | "⚠ Session expired" + Re-login button |
| `user !== null && tokenSecondsLeft > 0` | "● User session active · Xm Ys" clickable pill |
| `user !== null && tokenSecondsLeft === null` | Loading shimmer (token data not yet fetched) |

- [ ] **Step 1: Create the CSS file**

Create `demo_api_ui/src/components/UserTokenStatusBar.css`:

```css
/* UserTokenStatusBar — status strip below DashboardHeader */

.utsb {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 32px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  font-size: 13px;
  min-height: 40px;
}

/* Active state — clickable pill */
.utsb__active {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 20px;
  color: #15803d;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  font-size: 13px;
  line-height: 1;
}

.utsb__active:hover,
.utsb__active:focus-visible {
  background: #dcfce7;
  border-color: #86efac;
  outline: 2px solid #4ade80;
  outline-offset: 2px;
}

.utsb__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #16a34a;
  flex-shrink: 0;
}

/* Expired state */
.utsb__expired {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #b45309;
  font-weight: 500;
}

/* Not logged in state */
.utsb__anonymous {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
}

/* Login / re-login button */
.utsb__login-btn {
  padding: 4px 12px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  line-height: 1.4;
}

.utsb__login-btn:hover,
.utsb__login-btn:focus-visible {
  background: #1d4ed8;
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}

/* Loading shimmer */
.utsb__shimmer {
  width: 180px;
  height: 20px;
  border-radius: 10px;
  background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
  background-size: 200% 100%;
  animation: utsb-shimmer 1.4s infinite;
}

@keyframes utsb-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

- [ ] **Step 2: Create the component file**

Create `demo_api_ui/src/components/UserTokenStatusBar.jsx`:

```jsx
import React from 'react';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import './UserTokenStatusBar.css';

/**
 * UserTokenStatusBar
 *
 * Renders a status strip below DashboardHeader showing the user session state.
 *
 * States:
 *   - Loading: tokenSecondsLeft === null && user !== null → shimmer
 *   - Active:  tokenSecondsLeft > 0 → clickable pill with countdown
 *   - Expired: tokenSecondsLeft === 0 && user !== null → warning + re-login
 *   - Anonymous: user === null → not-logged-in + login button
 *
 * @param {object|null} props.user - Session user object or null
 * @param {number|null} props.tokenSecondsLeft - Seconds until token expiry (live countdown)
 * @param {function} props.onOpenModal - Called when user clicks the active pill
 */
export default function UserTokenStatusBar({ user, tokenSecondsLeft, onOpenModal }) {
  function formatCountdown(seconds) {
    if (seconds === null || seconds < 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  // Not logged in
  if (!user) {
    return (
      <div className="utsb" role="status" aria-label="Session status">
        <span className="utsb__anonymous">Not logged in</span>
        <button
          type="button"
          className="utsb__login-btn"
          onClick={navigateToCustomerOAuthLogin}
        >
          Login
        </button>
      </div>
    );
  }

  // Token data still loading
  if (tokenSecondsLeft === null) {
    return (
      <div className="utsb" role="status" aria-label="Session status">
        <span className="utsb__shimmer" aria-hidden="true" />
      </div>
    );
  }

  // Expired
  if (tokenSecondsLeft <= 0) {
    return (
      <div className="utsb" role="status" aria-label="Session status">
        <span className="utsb__expired">⚠ Session expired</span>
        <button
          type="button"
          className="utsb__login-btn"
          onClick={navigateToCustomerOAuthLogin}
        >
          Re-login
        </button>
      </div>
    );
  }

  // Active
  return (
    <div className="utsb" role="status" aria-label="Session status">
      <button
        type="button"
        className="utsb__active"
        onClick={onOpenModal}
        title="View token details"
      >
        <span className="utsb__dot" aria-hidden="true" />
        User session active · {formatCountdown(tokenSecondsLeft)}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Commit the new component**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/UserTokenStatusBar.jsx demo_api_ui/src/components/UserTokenStatusBar.css
git commit -m "feat(dashboard): add UserTokenStatusBar component (status + countdown)"
```

---

## Task 2: Wire `UserTokenStatusBar` into `UserDashboard.js`

**Files:**
- Modify: `demo_api_ui/src/components/UserDashboard.js`

### Context

In `UserDashboard.js`:
- Line ~38: imports are at the top
- Line ~190: state declarations (`showTokenModal`, `tokenData`, `tokenExpiresAt`, `tokenSecondsLeft`, `user`)
- Line ~553: `openTokenModal` function
- Line ~2540: JSX — `<DashboardHeader variant="customer" />` followed by `<div className="dashboard-header-stack">`
- Line ~2553: "Token Info" button inside `.dashboard-toolbar` — **remove this**
- Line ~3319: `<FloatingPanel title="Your Token Chain" ...>` — **replace inner content with `<OAuthTokenDisplayPage />`**

- [ ] **Step 1: Add the import for `UserTokenStatusBar` and `OAuthTokenDisplayPage`**

Find the imports block near the top of `UserDashboard.js`. After the `DashboardHeader` import, add:

```js
import UserTokenStatusBar from "./UserTokenStatusBar";
import OAuthTokenDisplayPage from "./OAuthTokenDisplayPage";
```

The existing imports look like:
```js
import DashboardHeader from "./DashboardHeader";
import { useTheme } from "../context/ThemeContext";
```

Becomes:
```js
import DashboardHeader from "./DashboardHeader";
import UserTokenStatusBar from "./UserTokenStatusBar";
import OAuthTokenDisplayPage from "./OAuthTokenDisplayPage";
import { useTheme } from "../context/ThemeContext";
```

- [ ] **Step 2: Render `UserTokenStatusBar` after `DashboardHeader` in the JSX**

Find this block in the JSX (around line 2540):
```jsx
      <DashboardHeader variant="customer" />
      {/* ── Toolbar row with additional actions ────────────────────── */}
      <div className="dashboard-header-stack" style={{ marginTop: 0 }}>
```

Replace with:
```jsx
      <DashboardHeader variant="customer" />
      <UserTokenStatusBar
        user={user}
        tokenSecondsLeft={tokenSecondsLeft}
        onOpenModal={openTokenModal}
      />
      {/* ── Toolbar row with additional actions ────────────────────── */}
      <div className="dashboard-header-stack" style={{ marginTop: 0 }}>
```

- [ ] **Step 3: Remove the "Token Info" toolbar button**

Find and remove this button from inside `.dashboard-toolbar` (around line 2553):
```jsx
          <button
            type="button"
            onClick={openTokenModal}
            className="dashboard-toolbar-btn"
            title="View OAuth Token Info"
          >
            Token Info
          </button>
```

Delete it entirely — the status bar is the new entry point.

- [ ] **Step 4: Replace the FloatingPanel inner content with `<OAuthTokenDisplayPage />`**

Find the `FloatingPanel` that has `title="Your Token Chain"` (around line 3319). It currently wraps a large block of hand-rolled token markup. Replace everything **inside** the `FloatingPanel` (between its opening and closing tags) with just:

```jsx
        <FloatingPanel
          title="User Session Token"
          onClose={() => setShowTokenModal(false)}
          defaultWidth={820}
          defaultHeight={Math.min(window.innerHeight - 80, 940)}
          defaultX={Math.max(0, Math.round((window.innerWidth - 820) / 2))}
          defaultY={60}
          minWidth={360}
          minHeight={200}
        >
          <div style={{ overflowY: "auto", height: "100%" }}>
            <OAuthTokenDisplayPage />
          </div>
        </FloatingPanel>
```

The old inner content — the big `{tokenData ? (() => { ... })() : ...}` block including all the `token-section`, `session-info-grid`, decoded header/payload rendering — is deleted entirely. `OAuthTokenDisplayPage` fetches its own data.

- [ ] **Step 5: Verify `tokenData` state and `fetchTokenData` function are still needed**

After step 4, `tokenData` and `fetchTokenData` are no longer used. Remove:
1. The `const [tokenData, setTokenData] = useState(null);` line (~line 192)
2. The `fetchTokenData` async function (~line 540–555) — it fetches `/api/auth/oauth/token-claims` and calls `setTokenData`
3. The `fetchTokenData()` call inside `openTokenModal` (keep `setShowTokenModal(true)` — just remove the `fetchTokenData()` call):

```js
  const openTokenModal = () => {
    setShowTokenModal(true);
  };
```

- [ ] **Step 6: Build to verify no errors**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.` with exit code 0. Fix any import or reference errors before continuing.

- [ ] **Step 7: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/UserDashboard.js
git commit -m "feat(dashboard): wire UserTokenStatusBar; replace token modal with OAuthTokenDisplayPage"
```

---

## Task 3: Verify the feature works end-to-end

- [ ] **Step 1: Start the services if not running**

```bash
cd /Users/curtismuir/Development/AI-Demo
./run.sh status
```

All services should show `[OK]`. If not: `./run.sh`.

- [ ] **Step 2: Verify status bar renders when not logged in**

Open `https://api.ping.demo:4000/dashboard` in a browser **without** a user session (or in an incognito window). The status bar should show "Not logged in" and a "Login" button.

- [ ] **Step 3: Log in and verify active state**

Click "Login", complete the PingOne user OAuth flow. After redirect to `/dashboard`:
- The status bar should show a green pill: `● User session active · Xm Ys`
- The countdown should tick down live each second
- The "Token Info" toolbar button should be gone

- [ ] **Step 4: Verify modal opens with full token detail**

Click the green pill. A `FloatingPanel` titled "User Session Token" should open showing the `OAuthTokenDisplayPage` content: Identity & Profile, Authorization, Token Validity, etc.

- [ ] **Step 5: Verify expired state rendering (manual test)**

To test without waiting for real expiry, temporarily change the `tokenSecondsLeft` tick in the browser console or pass `0` directly. The bar should show `⚠ Session expired` + "Re-login" button. Click "Re-login" — should navigate to `/api/auth/oauth/user/login`.

- [ ] **Step 6: Add REGRESSION_PLAN.md entry**

Open `REGRESSION_PLAN.md` and add to §4 (Bug Fix Log) / new feature notes:

```markdown
### 2026-05-23 — UserTokenStatusBar
- Added `UserTokenStatusBar` below `DashboardHeader` on `/dashboard`
- Shows live token countdown; opens `OAuthTokenDisplayPage` in modal on click
- Shows "Not logged in" + Login button when no session
- Shows "Session expired" + Re-login button when token has expired
- Removed hand-rolled token modal markup from `UserDashboard.js` (replaced by `OAuthTokenDisplayPage`)
- Files: `UserTokenStatusBar.jsx`, `UserTokenStatusBar.css`, `UserDashboard.js`
```

- [ ] **Step 7: Final commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add REGRESSION_PLAN.md
git commit -m "docs: log UserTokenStatusBar in REGRESSION_PLAN"
```

---

## Self-Review

**Spec coverage:**
- ✅ Status bar below page header
- ✅ Active state with live countdown
- ✅ "Not logged in" state with login link
- ✅ "Session expired" state with re-login link
- ✅ Click opens modal with `OAuthTokenDisplayPage` content
- ✅ "Token Info" toolbar button removed

**Placeholder scan:** None — all steps contain complete code.

**Type consistency:**
- `UserTokenStatusBar` props: `user` (object|null), `tokenSecondsLeft` (number|null), `onOpenModal` (function) — consistent across Tasks 1 and 2
- `formatCountdown` is defined inside the component and only used there — no cross-task naming risk
- `navigateToCustomerOAuthLogin` — matches existing export in `demo_api_ui/src/utils/authUi.js` (line 24)
