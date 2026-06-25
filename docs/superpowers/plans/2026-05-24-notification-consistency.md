# Notification Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect all direct `toast.*()` calls in non-wrapper components to `appToast` helpers (`notifyError`, `notifySuccess`, `notifyInfo`, `notifyWarning`) and add an ESLint rule to prevent new direct imports.

**Architecture:** Mechanical import swap and call-site replacement, file by file. No new files, no API changes. The `appToast` helpers already exist in `demo_api_ui/src/utils/appToast.js` with the same signatures. Three files are authorised wrappers and must NOT be changed.

**Tech Stack:** React 18, CRA ESLint (inline `eslintConfig` in `package.json`), `utils/appToast.js`

**Prerequisite:** Plan `2026-05-24-modal-consistency.md` must be complete first (ESLint rule slot in `package.json` is already in use after that plan).

---

## Exempt files — do NOT change these

| File | Reason |
|------|--------|
| `utils/appToast.js` | The canonical wrapper itself |
| `utils/dashboardToast.js` | Session-aware customer error wrapper |
| `components/ErrorToast.js` | Teaching-content error component |

---

## File map

| File | Change |
|------|--------|
| `demo_api_ui/src/components/Profile.js` | Replace all `toast.*` with `notify*` helpers |
| `demo_api_ui/src/components/SecurityCenter.js` | Replace all `toast.*` with `notify*` helpers |
| `demo_api_ui/src/components/SetupPage.js` | Replace all `toast.*` with `notify*` helpers |
| `demo_api_ui/src/components/PingOneSetupGuidePage.js` | Replace all `toast.*` with `notify*` helpers |
| `demo_api_ui/src/components/UserAccounts.js` | Replace all `toast.*` with `notify*` helpers |
| `demo_api_ui/src/components/UserTransactions.js` | Replace all `toast.*` with `notify*` helpers |
| `demo_api_ui/src/hooks/useErrorHandler.js` | Replace all `toast.*` with `notify*` helpers |
| `demo_api_ui/package.json` | Add `no-restricted-imports` ESLint rule |

---

### Task 1: Profile.js

**Files:**
- Modify: `demo_api_ui/src/components/Profile.js`

Current calls (all `toast.*`):
- Line 88: `toast.success('Profile updated successfully')`
- Line 91: `toast.error(err.response?.data?.error_description || err.message || 'Failed to update profile')`
- Line 111: `toast.success('Device removed')`
- Line 114: `toast.error(err.response?.data?.message || 'Failed to remove device')`
- Line 136: `toast.error(err.response?.data?.message || 'Failed to send OTP')`
- Line 154: `toast.error(err.response?.data?.message || 'Invalid OTP — please try again')`

- [ ] **Step 1: Replace the import**

  Remove:
  ```js
  import { toast } from 'react-toastify';
  ```

  Add (or merge into existing appToast import if present):
  ```js
  import { notifySuccess, notifyError } from '../utils/appToast';
  ```

- [ ] **Step 2: Replace all call sites**

  | Find | Replace with |
  |------|-------------|
  | `toast.success('Profile updated successfully')` | `notifySuccess('Profile updated successfully')` |
  | `toast.error(err.response?.data?.error_description \|\| err.message \|\| 'Failed to update profile')` | `notifyError(err.response?.data?.error_description \|\| err.message \|\| 'Failed to update profile')` |
  | `toast.success('Device removed')` | `notifySuccess('Device removed')` |
  | `toast.error(err.response?.data?.message \|\| 'Failed to remove device')` | `notifyError(err.response?.data?.message \|\| 'Failed to remove device')` |
  | `toast.error(err.response?.data?.message \|\| 'Failed to send OTP')` | `notifyError(err.response?.data?.message \|\| 'Failed to send OTP')` |
  | `toast.error(err.response?.data?.message \|\| 'Invalid OTP — please try again')` | `notifyError(err.response?.data?.message \|\| 'Invalid OTP — please try again')` |

- [ ] **Step 3: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/Profile.js
  git commit -m "fix(ui): redirect toast() to appToast helpers in Profile"
  ```

---

### Task 2: SecurityCenter.js

**Files:**
- Modify: `demo_api_ui/src/components/SecurityCenter.js`

Current calls:
- Line 78: `toast.success('Device removed.')`
- Line 80: `toast.error(err.message || 'Failed to remove device.')`
- Line 108: `toast.success('Device renamed.')`
- Line 110: `toast.error(err.message || 'Failed to rename device.')`
- Line 154: `toast.success('Email OTP device enrolled.')`
- Line 204: `toast.success('SMS OTP device enrolled.')`

- [ ] **Step 1: Replace the import**

  Remove:
  ```js
  import { toast } from 'react-toastify';
  ```

  Add:
  ```js
  import { notifySuccess, notifyError } from '../utils/appToast';
  ```

- [ ] **Step 2: Replace all call sites**

  | Find | Replace with |
  |------|-------------|
  | `toast.success('Device removed.')` | `notifySuccess('Device removed.')` |
  | `toast.error(err.message \|\| 'Failed to remove device.')` | `notifyError(err.message \|\| 'Failed to remove device.')` |
  | `toast.success('Device renamed.')` | `notifySuccess('Device renamed.')` |
  | `toast.error(err.message \|\| 'Failed to rename device.')` | `notifyError(err.message \|\| 'Failed to rename device.')` |
  | `toast.success('Email OTP device enrolled.')` | `notifySuccess('Email OTP device enrolled.')` |
  | `toast.success('SMS OTP device enrolled.')` | `notifySuccess('SMS OTP device enrolled.')` |

- [ ] **Step 3: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/SecurityCenter.js
  git commit -m "fix(ui): redirect toast() to appToast helpers in SecurityCenter"
  ```

---

### Task 3: SetupPage.js

**Files:**
- Modify: `demo_api_ui/src/components/SetupPage.js`

Current calls:
- `toast.error(`Server error ${resp.status}`)` — error during SSE bootstrap
- `toast.success(...)` (multiple, around lines 146–187) — success after bootstrap/cleanup steps
- `toast.warning(...)` (around lines 150, 193) — partial success
- `toast.info(...)` (lines 159, 203) — informational
- `toast.error(...)` (multiple, lines 161, 205, 210) — failure cases
- `toast.error("Clipboard not available...")` and `toast.success("Copied...")` / `toast.error("Copy failed")` — clipboard helpers

- [ ] **Step 1: Replace the import**

  Remove:
  ```js
  import { toast } from "react-toastify";
  ```

  Add:
  ```js
  import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '../utils/appToast';
  ```

- [ ] **Step 2: Replace all call sites**

  Go through the file and apply:
  - `toast.error(...)` → `notifyError(...)`
  - `toast.success(...)` → `notifySuccess(...)`
  - `toast.warning(...)` → `notifyWarning(...)`
  - `toast.info(...)` → `notifyInfo(...)`

  There are no custom options/config objects passed in this file — all calls are plain `toast.TYPE(message)` form.

- [ ] **Step 3: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/SetupPage.js
  git commit -m "fix(ui): redirect toast() to appToast helpers in SetupPage"
  ```

---

### Task 4: PingOneSetupGuidePage.js

**Files:**
- Modify: `demo_api_ui/src/components/PingOneSetupGuidePage.js`

Current calls (all clipboard helpers, lines 15–20):
- `toast.error('Clipboard not available in this browser')`
- `() => toast.success(`Copied ${label}`)`
- `() => toast.error('Copy failed')`

- [ ] **Step 1: Replace the import**

  Remove:
  ```js
  import { toast } from 'react-toastify';
  ```

  Add:
  ```js
  import { notifySuccess, notifyError } from '../utils/appToast';
  ```

- [ ] **Step 2: Replace call sites**

  | Find | Replace with |
  |------|-------------|
  | `toast.error('Clipboard not available in this browser')` | `notifyError('Clipboard not available in this browser')` |
  | `() => toast.success(\`Copied ${label}\`)` | `() => notifySuccess(\`Copied ${label}\`)` |
  | `() => toast.error('Copy failed')` | `() => notifyError('Copy failed')` |

- [ ] **Step 3: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/PingOneSetupGuidePage.js
  git commit -m "fix(ui): redirect toast() to appToast helpers in PingOneSetupGuidePage"
  ```

---

### Task 5: UserAccounts.js

**Files:**
- Modify: `demo_api_ui/src/components/UserAccounts.js`

Current calls:
- Line 46: `toast.error('Failed to load accounts')`
- Line 55: `toast.info(\`${action} for account ${account.name} - This would open the appropriate flow\`)`

- [ ] **Step 1: Replace the import**

  Remove:
  ```js
  import { toast } from 'react-toastify';
  ```

  Add:
  ```js
  import { notifyError, notifyInfo } from '../utils/appToast';
  ```

- [ ] **Step 2: Replace call sites**

  | Find | Replace with |
  |------|-------------|
  | `toast.error('Failed to load accounts')` | `notifyError('Failed to load accounts')` |
  | `toast.info(\`${action} for account ${account.name}...\`)` | `notifyInfo(\`${action} for account ${account.name}...\`)` |

- [ ] **Step 3: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/UserAccounts.js
  git commit -m "fix(ui): redirect toast() to appToast helpers in UserAccounts"
  ```

---

### Task 6: UserTransactions.js

**Files:**
- Modify: `demo_api_ui/src/components/UserTransactions.js`

Current calls:
- Line 74: `toast.error('Failed to load transactions')`
- Line 83: `toast.info(\`${action} - This would open the appropriate flow\`)`

- [ ] **Step 1: Replace the import**

  Remove:
  ```js
  import { toast } from 'react-toastify';
  ```

  Add:
  ```js
  import { notifyError, notifyInfo } from '../utils/appToast';
  ```

- [ ] **Step 2: Replace call sites**

  | Find | Replace with |
  |------|-------------|
  | `toast.error('Failed to load transactions')` | `notifyError('Failed to load transactions')` |
  | `toast.info(\`${action} - This would open the appropriate flow\`)` | `notifyInfo(\`${action} - This would open the appropriate flow\`)` |

- [ ] **Step 3: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/UserTransactions.js
  git commit -m "fix(ui): redirect toast() to appToast helpers in UserTransactions"
  ```

---

### Task 7: useErrorHandler.js

**Files:**
- Modify: `demo_api_ui/src/hooks/useErrorHandler.js`

Current calls (lines 62–64):
- `toast.warning(content, toastConfig)` — when `display.severity === 'warning'`
- `toast.info(content, toastConfig)` — otherwise

Note: `toastConfig` is a local options object. The `notifyWarning` and `notifyInfo` helpers accept an optional second `options` argument — pass `toastConfig` through.

- [ ] **Step 1: Check appToast helper signatures**

  Open `demo_api_ui/src/utils/appToast.js` and confirm `notifyWarning` and `notifyInfo` accept a second `options` param:

  ```js
  // Expected signatures:
  export function notifyWarning(message, options = {}) { ... }
  export function notifyInfo(message, options = {}) { ... }
  ```

  If they do, proceed. If not, add the `options` pass-through to `appToast.js` first (e.g. `toast.warning(message, { autoClose: 5000, ...options })`).

- [ ] **Step 2: Replace the import**

  Remove:
  ```js
  import { toast } from 'react-toastify';
  ```

  Add:
  ```js
  import { notifyWarning, notifyInfo } from '../utils/appToast';
  ```

  Adjust the relative path: `useErrorHandler.js` is in `hooks/`, so `appToast` is at `'../utils/appToast'`.

- [ ] **Step 3: Replace call sites**

  Find (around lines 62–64):
  ```js
  if (display.severity === 'warning') {
    toast.warning(content, toastConfig);
  } else {
    toast.info(content, toastConfig);
  }
  ```

  Replace with:
  ```js
  if (display.severity === 'warning') {
    notifyWarning(content, toastConfig);
  } else {
    notifyInfo(content, toastConfig);
  }
  ```

- [ ] **Step 4: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/hooks/useErrorHandler.js
  git commit -m "fix(ui): redirect toast() to appToast helpers in useErrorHandler"
  ```

---

### Task 8: Add ESLint no-restricted-imports rule

**Files:**
- Modify: `demo_api_ui/package.json`

**Prerequisite:** The modal plan must already have added `no-restricted-globals` to the `rules` block. This task adds a second rule to the same block.

- [ ] **Step 1: Open package.json and locate the rules block**

  After the modal plan, `eslintConfig.rules` contains:
  ```json
  "rules": {
    "no-restricted-globals": ["error", { "name": "confirm", "message": "..." }]
  }
  ```

- [ ] **Step 2: Add no-restricted-imports**

  Extend `rules` to:
  ```json
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
  ```

- [ ] **Step 3: Add eslint-disable comments to the three exempt wrapper files**

  Each of the three wrapper files imports `toast` directly and must be silenced:

  In `demo_api_ui/src/utils/appToast.js` — add at top of file:
  ```js
  /* eslint-disable no-restricted-imports */
  ```

  In `demo_api_ui/src/utils/dashboardToast.js` — add at top of file:
  ```js
  /* eslint-disable no-restricted-imports */
  ```

  In `demo_api_ui/src/components/ErrorToast.js` — add at top of file:
  ```js
  /* eslint-disable no-restricted-imports */
  ```

- [ ] **Step 4: Build (ESLint runs as part of CRA build)**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -10
  ```
  Expected: `Compiled successfully.` — all direct `toast` imports outside exempt files are gone, so no lint errors.

- [ ] **Step 5: Commit**

  ```bash
  git add demo_api_ui/package.json \
          demo_api_ui/src/utils/appToast.js \
          demo_api_ui/src/utils/dashboardToast.js \
          demo_api_ui/src/components/ErrorToast.js
  git commit -m "chore(lint): ban direct react-toastify toast imports — enforce appToast pattern"
  ```

---

### Task 9: Final verification

- [ ] **Step 1: Confirm zero direct toast imports remain outside exempt files**

  ```bash
  grep -rn "import.*toast.*from 'react-toastify'\|import.*toast.*from \"react-toastify\"" \
    demo_api_ui/src --include="*.js" --include="*.jsx" \
    | grep -v "appToast\|dashboardToast\|ErrorToast"
  ```
  Expected: no output.

- [ ] **Step 2: Full build**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  ```
  Expected: `Compiled successfully.`

- [ ] **Step 3: Manual smoke test**

  Trigger an error path in the app (e.g. attempt an invalid profile update, try a failing device action). Verify:
  - Error toast appears with the standard styling (matches other toasts in the app)
  - No console errors about toastify configuration
