# UI Feedback Consistency Design
**Date:** 2026-05-24  
**Status:** Approved  
**Scope:** Two sequential PRs — modal dialogs (PR 1), notification toasts (PR 2)

---

## Problem

The UI has two inconsistent user-feedback patterns that make the codebase harder to maintain and produce a degraded user experience:

1. **Confirmation dialogs:** 13 `window.confirm()` callsites use the browser's native blocking dialog instead of the existing `ConfirmModal` React component. Native dialogs are unstyled, cannot be dismissed with ESC in a consistent way, and block the browser thread.

2. **Notification toasts:** 15+ components import `toast` directly from `react-toastify` and call it without going through the project's `appToast` helpers (`notifyError`, `notifySuccess`, `notifyInfo`, `notifyWarning`). This bypasses standard duration, styling, and severity conventions.

---

## Goals

- Zero `window.confirm()` calls in `demo_api_ui/src/` (outside test files)
- Zero direct `import { toast }` from `react-toastify` outside of the two authorised wrapper files (`utils/appToast.js`, `utils/dashboardToast.js`, `components/ErrorToast.js`)
- Every `ConfirmModal` instance has both an **X close button** (top-right) and an explicit **Cancel button** (footer) — always present, both fire `onCancel`
- `npm run build` exits 0 after each PR

---

## Architecture

### PR 1 — Modal consistency

**Pattern:** Local state in each component. No new context or hook.

```jsx
// 1. State
const [showXxxModal, setShowXxxModal] = useState(false);
const [pendingXxx, setPendingXxx] = useState(null); // only if action needs an argument

// 2. Trigger (replaces window.confirm guard)
<button onClick={() => { setPendingXxx(item); setShowXxxModal(true); }}>
  Delete
</button>

// 3. Modal render
<ConfirmModal
  isOpen={showXxxModal}
  title="Delete item?"
  message="This cannot be undone."
  onConfirm={() => { handleDelete(pendingXxx); setShowXxxModal(false); setPendingXxx(null); }}
  onCancel={() => { setShowXxxModal(false); setPendingXxx(null); }}
/>
```

**`ConfirmModal` contract change:** The component must always render:
- An **X button** (`aria-label="Close"`) in the top-right corner of the modal header, wired to `onCancel`
- A **Cancel button** in the modal footer, wired to `onCancel`

**Confirmed via code audit:** `ConfirmModal` already has a Cancel button and ESC key support, but is **missing the X close button**. Step 1 of the implementation is to add it to `components/ConfirmModal.js` before touching any call site.

#### Callsites to replace (13 total)

| File | Line(s) | Action label |
|------|---------|--------------|
| `components/ActivityLogs.js` | 198 | Clear logs older than 30 days |
| `components/BankingAdminOps.js` | 150, 173 | Admin operation; Remove transaction |
| `components/DelegatedAccessPage.js` | 609 | Revoke delegated access |
| `components/DemoDataPage.js` | 289 | Reset demo (stay logged in) |
| `components/DemoSetupPanel.js` | 87 | Reset demo (logs out) |
| `components/LogViewer.js` | 246, 252 | Clear toast messages; Clear console logs |
| `components/MFALogsViewer.jsx` | 28 | Clear MFA logs |
| `components/OAuthDebugLogViewer.js` | 44 | Clear OAuth verbose logs |
| `components/SetupWizard.js` | 140 | Delete everything in PingOne env |
| `components/SideNav.js` | 203 | (side nav action) |
| `components/Users.js` | 120 | Delete user |

Each replacement adds ~6–8 lines of state + modal render and removes the `window.confirm()` guard. No other logic changes.

---

### PR 2 — Notification consistency

**Pattern:** Replace all direct `toast.*()` / `toast()` calls in non-wrapper components with the appropriate `appToast` helper.

**Mapping:**
| Direct call | Replace with |
|-------------|-------------|
| `toast.error(msg)` | `notifyError(msg)` |
| `toast.success(msg)` | `notifySuccess(msg)` |
| `toast.info(msg)` | `notifyInfo(msg)` |
| `toast.warning(msg)` / `toast.warn(msg)` | `notifyWarning(msg)` |
| `toast(msg)` (untyped) | `notifyInfo(msg)` — or appropriate severity by context |

**Import change per file:**
```js
// Remove:
import { toast } from 'react-toastify';
// Add (if not already present):
import { notifyError, notifySuccess, notifyInfo, notifyWarning } from '../utils/appToast';
// (adjust relative path per file location)
```

#### Files to update (7 non-wrapper callsites)

| File | Notes |
|------|-------|
| `components/PingOneSetupGuidePage.js` | Replace all `toast.*` calls |
| `components/Profile.js` | Replace all `toast.*` calls |
| `components/SecurityCenter.js` | Replace all `toast.*` calls |
| `components/SetupPage.js` | Replace all `toast.*` calls |
| `components/UserAccounts.js` | Replace all `toast.*` calls |
| `components/UserTransactions.js` | Replace all `toast.*` calls |
| `hooks/useErrorHandler.js` | Replace all `toast.*` calls |

**Exempt (authorised wrappers — do not change):**
- `utils/appToast.js` — the canonical wrapper itself
- `utils/dashboardToast.js` — session-aware customer error wrapper
- `components/ErrorToast.js` — teaching-content error component

---

## Data flow

No data flow changes. Both PRs are purely call-site replacements — no new services, no new state management, no API changes.

---

## Error handling

- `ConfirmModal` `onCancel` must always be callable (never undefined). All callsites pass it.
- Toast helper functions (`notifyError` etc.) are already null-safe in `appToast.js`. No additional guard needed.

---

## Testing

- **Manual:** After each PR, verify the replaced interactions work end-to-end:
  - PR 1: Trigger each formerly-`window.confirm` action and confirm the modal appears with both X and Cancel buttons; confirm cancel aborts the action and confirm proceeds.
  - PR 2: Trigger an error path in each updated component and verify the toast appears with correct styling/severity.
- **Build gate:** `cd demo_api_ui && npm run build` must exit 0 after each PR.
- **Regression:** No existing tests cover `window.confirm` (jsdom silently returns `false` for it). No new tests required — this is a mechanical UI substitution.

---

## Enforcement (lint rules)

After the fix PRs land, two ESLint rules are added to `demo_api_ui/package.json` `eslintConfig` to prevent regressions in new components. CRA supports these rules without ejecting.

```json
"eslintConfig": {
  "extends": ["react-app", "react-app/jest"],
  "rules": {
    "no-restricted-globals": [
      "error",
      {
        "name": "confirm",
        "message": "Use <ConfirmModal> with local state instead of window.confirm(). See docs/superpowers/specs/2026-05-24-ui-feedback-consistency-design.md"
      }
    ],
    "no-restricted-imports": [
      "error",
      {
        "paths": [
          {
            "name": "react-toastify",
            "importNames": ["toast"],
            "message": "Import notifyError/notifySuccess/notifyInfo/notifyWarning from utils/appToast instead. Direct toast() is only allowed in utils/appToast.js, utils/dashboardToast.js, and components/ErrorToast.js."
          }
        ]
      }
    ]
  }
}
```

**Exempt files** (`no-restricted-imports` must be overridden with `/* eslint-disable */` in the three authorised wrappers — or via `overrides` in the ESLint config targeting those specific paths.)

The lint rules are added in **PR 1** so the constraint is live immediately after modals are cleaned up.

---

## Sequence

1. **Audit `ConfirmModal`** — add X close button (confirmed missing).
2. **PR 1 — Modals + lint rules** — replace all 13 `window.confirm()` call sites; add both ESLint rules to `package.json`. Build. Manual smoke.
3. **PR 2 — Notifications** — redirect 7 non-wrapper `toast` call sites. Build. Manual smoke.

---

## Non-goals

- Button ARIA labels (separate concern)
- Empty state standardisation (separate concern)
- Loading state variable naming (separate concern)
- Any changes to `appToast.js` API
- Any changes to `ConfirmModal` props API beyond ensuring X + Cancel are always rendered
