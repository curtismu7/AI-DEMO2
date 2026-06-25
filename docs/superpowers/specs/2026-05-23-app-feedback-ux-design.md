# App Feedback UX — Design Spec
**Date:** 2026-05-23  
**Status:** Approved for planning  

---

## Problem

The app has four categories of feedback gaps that leave users uncertain about what is happening:

1. **Async operations give no in-flight signal** — save buttons, API calls, and form submissions go silent while pending; users can't tell if their click registered.
2. **Hard navigations cause a blank flash** — logout, Reset Demo, and role-switch redirect immediately with no transition message.
3. **Destructive actions use native `window.confirm()`** — 13 sites use unstyled browser dialogs with no design context, no danger styling, and no impact detail.
4. **Errors are swallowed silently** — 142 empty `catch` blocks; user-triggered actions that fail produce no feedback; background/polling failures leave no DevTools trace.

---

## Decisions

### 1. Async button states (all user-triggered buttons)

**Pattern:** Inline spinner → brief success state → toast on both success and error.

- While pending: button becomes `disabled`, label changes to `"Saving…"` (or action-appropriate verb), spinner icon added.
- On success: label briefly shows `"✅ Saved"` with green background (~1.5s), then resets. A `notifySuccess()` toast fires.
- On error: button resets immediately. A `notifyError()` toast fires with a human-readable message.
- **No new component needed** — implement as a local `useSavingState` hook that returns `{ saving, saved, error, run }`. Callers wrap their async handler with `run()`.

**`useSavingState` interface:**
```js
const { saving, saved, run } = useSavingState();
// saving: bool — in flight
// saved: bool — brief success state (auto-clears after 1500ms)
// run(asyncFn, { successMsg, errorMsg }) — executes fn, manages state + toasts
```

### 2. Context-aware LogoutPage (hard navigations)

**Pattern:** Pass `?reason=<slug>` as a query param through the logout flow. LogoutPage reads it and shows contextual messaging.

**Reasons and messages:**

| `reason` slug | Heading | Subtext |
|---|---|---|
| `demo-reset` | Demo reset complete | State cleared. Sign back in to start fresh. |
| `role-switch` | Switching view | Taking you to the new role… |
| *(none / default)* | You're signed out | Your session has been ended securely. |

**Implementation:**
- `oauthUser.js` `/logout` route: read `req.query.reason`, append it to `postLogoutUri` as `?reason=<value>`. Allowlist: `['demo-reset', 'role-switch']` — unknown values are dropped.
- `LogoutPage.js`: use `useSearchParams()` to read `reason`, swap heading/subtext accordingly.
- All callers that want a reason: append `?reason=<slug>` to `/api/auth/logout` URL (e.g. `window.location.href = '/api/auth/logout?reason=demo-reset'`).

**Scope of callers to update:**
- `AdminSideNav.jsx` `handleResetConfirm` → `?reason=demo-reset`
- `UserDashboard.js` Reset Demo modal → `?reason=demo-reset`
- `DemoSetupPanel.js` `handleResetDemo` → `?reason=demo-reset`
- `AdminSideNav.jsx` `handleAction('logout')` → no reason (default)
- `AdminSideNav.jsx` role-switch redirect → `?reason=role-switch` (currently uses `redirectUrl` from server response — client appends `?reason=role-switch` to the redirectUrl before following it, since the server controls the destination path but the client owns the reason context)

### 3. ConfirmModal — replace all `window.confirm()` + add `impact` prop

**Pattern:** Replace all 13 `window.confirm()` sites with `<ConfirmModal>`. Extend `ConfirmModal` with one new optional prop: `impact` — a string shown in a red callout between the message and the buttons.

**Updated `ConfirmModal` interface:**
```js
<ConfirmModal
  isOpen={bool}
  title="Delete user"
  message="This action cannot be undone."
  impact="Removes 3 accounts and 47 transactions permanently."  // optional
  confirmLabel="Delete"
  cancelLabel="Cancel"
  danger={true}
  onConfirm={fn}
  onCancel={fn}
/>
```

**Sites that get `impact` text** (high-stakes, irreversible):
| Site | impact text |
|---|---|
| `Users.js` delete user | `"All of this user's accounts and transactions will be permanently removed."` |
| `SetupWizard.js` wipe PingOne env | `"All apps, resource servers, groups, and users will be deleted from PingOne. This cannot be undone."` |
| `BankingAdminOps.js` reset accounts | `"All demo account balances and transaction history will be reset to defaults."` |

**Sites that get ConfirmModal without impact** (routine / reversible):
- `BankingAdminOps.js` remove transaction
- `DelegatedAccessPage.js` revoke delegate access
- `OAuthDebugLogViewer.js` clear OAuth logs
- `ActivityLogs.js` clear old logs
- `LogViewer.js` clear toast log (×2)
- `MFALogsViewer.jsx` clear MFA logs
- `DemoSetupPanel.js` reset demo
- `DemoDataPage.js` reset demo
- `SideNav.js` reset demo (unused in app, but update for consistency)

**Implementation note:** Components that don't already import/use `ConfirmModal` will need a `showConfirmModal` + `useState` added. Follow the pattern already in `UserDashboard.js` and `Dashboard.js`.

### 4. Error handling audit

**User-triggered actions → `notifyError()`:**  
Any `catch` block after a user-initiated API call that currently swallows silently gets a `notifyError()` call with a human-readable message. Pattern:
```js
} catch (err) {
  notifyError(err.response?.data?.message || err.response?.data?.error || err.message || 'Something went wrong.');
}
```

**Background / polling / fire-and-forget → `console.warn()`:**  
Silent catches in polling loops, token refresh, theme manifest fetch, WebSocket reconnect, and similar background operations get `console.warn('[ComponentName]', err)` added so DevTools shows the failure without bothering the user.

**Storage catches (localStorage/sessionStorage) → leave silent:**  
These fire in incognito/restricted environments and are intentionally silent. No change.

**Affected files for user-action errors:**
- `Users.js` — delete user
- `ActivityLogs.js` — clear logs
- `OAuthDebugLogViewer.js` — clear logs (already has `notifyError`, verify completeness)
- `MFALogsViewer.jsx` — clear MFA logs
- `DemoDataPage.js` — reset demo
- `DelegatedAccessPage.js` — revoke access
- `DemoSetupPanel.js` — reset demo (catch block after POST)
- `AdminSideNav.jsx` — reset confirm catch
- `LogViewer.js` — clear log actions

**Affected files for background `console.warn`:**
- `TokenChainContext.js` — 4 empty catch blocks
- `BankingAgent.js` — ~8 empty catches (abort, scroll, reconnect operations)
- `ComplianceModalPopout.js` — 1 empty catch

---

## What is NOT in scope

- The `BankingAgent.js` conversation/streaming path — §1 protected, separate concern.
- Any `catch` in `SecurityCenter.js` `res.json().catch(() => ({}))` — these are JSON parse fallbacks, not swallowed errors.
- The `FloatingPanel.jsx` pointer capture catch — browser API quirk, intentionally silent.
- Refactoring existing error handling that already calls `notifyError()` — only add where missing.
- Loading skeletons / page-level loading states — out of scope for this pass.

---

## Files changed

| File | Change |
|---|---|
| `demo_api_ui/src/hooks/useSavingState.js` | **New** — async button state hook |
| `demo_api_ui/src/components/ConfirmModal.js` | Add `impact` prop + red callout rendering |
| `demo_api_ui/src/components/LogoutPage.js` | Read `?reason=` param, swap heading/subtext |
| `demo_api_server/routes/oauthUser.js` | Allowlist + forward `reason` query param to `postLogoutUri` |
| `demo_api_ui/src/components/AdminSideNav.jsx` | Append `?reason=` to logout/reset calls; apply `useSavingState` to save actions |
| `demo_api_ui/src/components/UserDashboard.js` | Replace Reset Demo `window.confirm` with ConfirmModal (already done); apply `useSavingState`; fix catch blocks |
| `demo_api_ui/src/components/DemoSetupPanel.js` | Replace `window.confirm`; apply `useSavingState`; fix catch |
| `demo_api_ui/src/components/Users.js` | Replace `window.confirm` with ConfirmModal + impact; fix catch |
| `demo_api_ui/src/components/BankingAdminOps.js` | Replace `window.confirm` with ConfirmModal + impact |
| `demo_api_ui/src/components/DelegatedAccessPage.js` | Replace `window.confirm` with ConfirmModal |
| `demo_api_ui/src/components/OAuthDebugLogViewer.js` | Replace `window.confirm` with ConfirmModal |
| `demo_api_ui/src/components/ActivityLogs.js` | Replace `window.confirm` with ConfirmModal; fix catch |
| `demo_api_ui/src/components/LogViewer.js` | Replace `window.confirm` ×2 with ConfirmModal |
| `demo_api_ui/src/components/MFALogsViewer.jsx` | Replace `window.confirm` with ConfirmModal; fix catch |
| `demo_api_ui/src/components/DemoDataPage.js` | Replace `window.confirm` with ConfirmModal; fix catch |
| `demo_api_ui/src/components/SetupWizard.js` | Replace `window.confirm` with ConfirmModal + impact |
| `demo_api_ui/src/components/SideNav.js` | Replace `window.confirm` with ConfirmModal (component unused in app, update for completeness) |
| `demo_api_ui/src/context/TokenChainContext.js` | Add `console.warn` to 4 empty catches |
| `demo_api_ui/src/components/BankingAgent.js` | Add `console.warn` to ~8 empty background catches |
| `demo_api_ui/src/components/ComplianceModalPopout.js` | Add `console.warn` to empty catch |

---

## Success criteria

- Zero `window.confirm()` calls in production UI code.
- Every user-triggered async action: button disables + shows spinner while pending, shows success state on completion, fires a toast. Failed actions fire `notifyError()`.
- Reset Demo, logout: land on `/logout` page with correct contextual heading.
- `npm run build` in `demo_api_ui/` → exit 0 throughout.
- No regressions to §1-protected paths (OAuth, session, HITL, MCP token exchange).
