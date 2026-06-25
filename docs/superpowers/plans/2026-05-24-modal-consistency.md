# Modal Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all 13 `window.confirm()` calls in `demo_api_ui/src/` with `ConfirmModal`, ensure every modal instance has both an X close button and a Cancel button, and add an ESLint rule to prevent regressions.

**Architecture:** Local state per component — each component that needs a confirmation dialog manages its own `showModal` boolean and optional `pendingArg` state. `ConfirmModal` is rendered inline. No new context, no new hooks. Step 1 fixes `ConfirmModal` itself; Steps 2–12 replace callsites one file at a time; Step 13 adds the lint rule.

**Tech Stack:** React 18, CRA ESLint (inline `eslintConfig` in `package.json`), `components/ConfirmModal.js` + `components/KillSwitchConfirmModal.css`

---

## File map

| File | Change |
|------|--------|
| `demo_api_ui/src/components/ConfirmModal.js` | Add X close button |
| `demo_api_ui/src/components/ActivityLogs.js` | Replace 1 `window.confirm` |
| `demo_api_ui/src/components/BankingAdminOps.js` | Replace 2 `window.confirm` |
| `demo_api_ui/src/components/DelegatedAccessPage.js` | Replace 1 `window.confirm` |
| `demo_api_ui/src/components/DemoDataPage.js` | Replace 1 `window.confirm` |
| `demo_api_ui/src/components/DemoSetupPanel.js` | Replace 1 `window.confirm` |
| `demo_api_ui/src/components/LogViewer.js` | Replace 2 `window.confirm` |
| `demo_api_ui/src/components/MFALogsViewer.jsx` | Replace 1 `window.confirm` |
| `demo_api_ui/src/components/OAuthDebugLogViewer.js` | Replace 1 `window.confirm` |
| `demo_api_ui/src/components/SetupWizard.js` | Replace 1 `window.confirm` |
| `demo_api_ui/src/components/SideNav.js` | Replace 1 `window.confirm` |
| `demo_api_ui/src/components/Users.js` | Replace 1 `window.confirm` |
| `demo_api_ui/package.json` | Add `no-restricted-globals` ESLint rule |

---

### Task 1: Add X close button to ConfirmModal

**Files:**
- Modify: `demo_api_ui/src/components/ConfirmModal.js`

The component currently has Cancel + ESC support but no visible X button. Add one to the modal header area.

- [ ] **Step 1: Open and read the current file**

  Read `demo_api_ui/src/components/ConfirmModal.js`. Note the structure: backdrop → `modal-content` div → `h2` title → `p` description → button row. There is no header element — the title `h2` sits directly in the content div.

- [ ] **Step 2: Replace the file with the X button added**

  Replace the return block so it reads:

  ```jsx
  return (
    <>
      <div className="modal-backdrop" onClick={onCancel} />
      <div
        className="modal-content"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 id="confirm-modal-title" className="modal-heading" style={danger ? undefined : { color: '#1e293b', margin: 0 }}>
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '0 0 0 12px', color: '#64748b' }}
          >
            ×
          </button>
        </div>
        <p className="modal-description">{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
          <button type="button" className="modal-cancel-button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="modal-confirm-button"
            style={danger ? undefined : { background: '#2563eb', borderColor: '#1d4ed8' }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
  ```

- [ ] **Step 3: Build**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  ```
  Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

  ```bash
  git add demo_api_ui/src/components/ConfirmModal.js
  git commit -m "fix(ui): add X close button to ConfirmModal"
  ```

---

### Task 2: ActivityLogs — replace 1 window.confirm (line 198)

**Files:**
- Modify: `demo_api_ui/src/components/ActivityLogs.js`

The confirm guards `clearOldLogs()`. No argument is needed — it's a simple yes/no.

- [ ] **Step 1: Add state and import**

  At the top of the component function body, find the existing `useState` declarations and add:

  ```js
  const [showClearOldLogsModal, setShowClearOldLogsModal] = useState(false);
  ```

  Add the import at the top of the file (if `ConfirmModal` not already imported):

  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace the window.confirm guard**

  Find (around line 198):
  ```js
  if (window.confirm('Are you sure you want to clear logs older than 30 days?')) {
  ```

  Replace the entire `if` block trigger so the handler opens the modal instead:

  ```js
  // Replace: if (window.confirm(...)) { ... }
  // With: open modal; the actual deletion runs in onConfirm below
  setShowClearOldLogsModal(true);
  return;
  ```

  Then extract the deletion body into a named handler called from `onConfirm`:

  ```js
  const handleClearOldLogsConfirmed = async () => {
    setShowClearOldLogsModal(false);
    // original body that was inside the window.confirm if-block goes here
  };
  ```

- [ ] **Step 3: Render the modal**

  In the component's JSX return, just before the closing tag, add:

  ```jsx
  <ConfirmModal
    isOpen={showClearOldLogsModal}
    title="Clear old logs?"
    message="This will permanently delete all logs older than 30 days."
    confirmLabel="Clear"
    danger
    onConfirm={handleClearOldLogsConfirmed}
    onCancel={() => setShowClearOldLogsModal(false)}
  />
  ```

- [ ] **Step 4: Build**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  ```
  Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

  ```bash
  git add demo_api_ui/src/components/ActivityLogs.js
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in ActivityLogs"
  ```

---

### Task 3: BankingAdminOps — replace 2 window.confirms (lines 150, 173)

**Files:**
- Modify: `demo_api_ui/src/components/BankingAdminOps.js`

Two confirms: "Delete this account" (needs `accountId`) and "Remove this transaction" (needs `txId`).

- [ ] **Step 1: Add state**

  ```js
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [pendingDeleteAccountId, setPendingDeleteAccountId] = useState(null);
  const [showDeleteTxModal, setShowDeleteTxModal] = useState(false);
  const [pendingDeleteTxId, setPendingDeleteTxId] = useState(null);
  ```

  Add import:
  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace handleDeleteAccount**

  Find (around line 148):
  ```js
  const handleDeleteAccount = async (accountId) => {
    if (!window.confirm("Delete this account and all references? This cannot be undone.")) return;
    // ... deletion body
  };
  ```

  Replace with:
  ```js
  const handleDeleteAccount = (accountId) => {
    setPendingDeleteAccountId(accountId);
    setShowDeleteAccountModal(true);
  };

  const handleDeleteAccountConfirmed = async () => {
    setShowDeleteAccountModal(false);
    const accountId = pendingDeleteAccountId;
    setPendingDeleteAccountId(null);
    try {
      await bffAxios.delete(`/api/accounts/${encodeURIComponent(accountId)}`);
      notifySuccess("Account deleted");
      await runLookup();
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      if (err.response?.data?.error === "demo_mode") {
        notifyError("Account deletion is disabled on the shared public demo (DEMO_MODE).");
      } else {
        notifyError(msg || "Delete failed");
      }
    }
  };
  ```

- [ ] **Step 3: Replace handleDeleteTransaction**

  Find (around line 171):
  ```js
  const handleDeleteTransaction = async (txId) => {
    if (!window.confirm("Remove this transaction from history?")) return;
    // ... deletion body
  };
  ```

  Replace with:
  ```js
  const handleDeleteTransaction = (txId) => {
    setPendingDeleteTxId(txId);
    setShowDeleteTxModal(true);
  };

  const handleDeleteTxConfirmed = async () => {
    setShowDeleteTxModal(false);
    const txId = pendingDeleteTxId;
    setPendingDeleteTxId(null);
    try {
      await bffAxios.delete(`/api/transactions/${encodeURIComponent(txId)}`);
      notifySuccess("Transaction removed");
      await runLookup();
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      if (err.response?.data?.error === "demo_mode") {
        notifyError("Disabled on shared public demo (DEMO_MODE). Use a private deployment to delete.");
      } else {
        notifyError(msg || "Delete failed");
      }
    }
  };
  ```

- [ ] **Step 4: Render both modals**

  ```jsx
  <ConfirmModal
    isOpen={showDeleteAccountModal}
    title="Delete account?"
    message="This will delete the account and all references. This cannot be undone."
    confirmLabel="Delete"
    danger
    onConfirm={handleDeleteAccountConfirmed}
    onCancel={() => { setShowDeleteAccountModal(false); setPendingDeleteAccountId(null); }}
  />
  <ConfirmModal
    isOpen={showDeleteTxModal}
    title="Remove transaction?"
    message="This will remove the transaction from history. This cannot be undone."
    confirmLabel="Remove"
    danger
    onConfirm={handleDeleteTxConfirmed}
    onCancel={() => { setShowDeleteTxModal(false); setPendingDeleteTxId(null); }}
  />
  ```

- [ ] **Step 5: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/BankingAdminOps.js
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in BankingAdminOps"
  ```

---

### Task 4: DelegatedAccessPage — replace 1 window.confirm (line 609)

**Files:**
- Modify: `demo_api_ui/src/components/DelegatedAccessPage.js`

Guards revoking a delegate. Needs `delegate` object from the iteration context.

- [ ] **Step 1: Add state**

  ```js
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [pendingRevokeDelegate, setPendingRevokeDelegate] = useState(null);
  ```

  Add import:
  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace the guard**

  Find (around line 607):
  ```js
  if (!window.confirm(`Revoke ${delegate.name}'s access to your accounts?`)) return;
  // ... revoke body
  ```

  Change the handler to:
  ```js
  // Trigger:
  setPendingRevokeDelegate(delegate);
  setShowRevokeModal(true);
  return;
  ```

  Add a confirmed handler:
  ```js
  const handleRevokeConfirmed = async () => {
    setShowRevokeModal(false);
    const delegate = pendingRevokeDelegate;
    setPendingRevokeDelegate(null);
    // original revoke body here
  };
  ```

- [ ] **Step 3: Render the modal**

  ```jsx
  <ConfirmModal
    isOpen={showRevokeModal}
    title="Revoke access?"
    message={pendingRevokeDelegate ? `Revoke ${pendingRevokeDelegate.name}'s access to your accounts?` : ''}
    confirmLabel="Revoke"
    danger
    onConfirm={handleRevokeConfirmed}
    onCancel={() => { setShowRevokeModal(false); setPendingRevokeDelegate(null); }}
  />
  ```

- [ ] **Step 4: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/DelegatedAccessPage.js
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in DelegatedAccessPage"
  ```

---

### Task 5: DemoDataPage — replace 1 window.confirm (line 289)

**Files:**
- Modify: `demo_api_ui/src/components/DemoDataPage.js`

Guards `handleResetDemo`. No argument needed. Note: `demoResetting` state already exists.

- [ ] **Step 1: Add state**

  ```js
  const [showResetModal, setShowResetModal] = useState(false);
  ```

  Add import:
  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace the guard**

  Find:
  ```js
  const handleResetDemo = useCallback(async () => {
    if (!window.confirm('Reset demo? This clears all agent history, token chain events, and MCP audit logs from the server. You will stay logged in.')) return;
    setDemoResetting(true);
    // ... reset body
  }, []);
  ```

  Replace with:
  ```js
  const handleResetDemo = useCallback(() => {
    setShowResetModal(true);
  }, []);

  const handleResetDemoConfirmed = useCallback(async () => {
    setShowResetModal(false);
    setDemoResetting(true);
    try { await axios.post('/api/admin/reset-demo'); } catch (_) {}
    try { localStorage.removeItem('tokenChainHistory'); } catch (_) {}
    try { localStorage.removeItem('api-traffic-store'); } catch (_) {}
    window.location.reload();
  }, []);
  ```

- [ ] **Step 3: Render the modal**

  ```jsx
  <ConfirmModal
    isOpen={showResetModal}
    title="Reset demo?"
    message="This clears all agent history, token chain events, and MCP audit logs from the server. You will stay logged in."
    confirmLabel="Reset"
    danger
    onConfirm={handleResetDemoConfirmed}
    onCancel={() => setShowResetModal(false)}
  />
  ```

- [ ] **Step 4: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/DemoDataPage.js
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in DemoDataPage"
  ```

---

### Task 6: DemoSetupPanel — replace 1 window.confirm (line 87)

**Files:**
- Modify: `demo_api_ui/src/components/DemoSetupPanel.js`

Guards `handleResetDemo`. Logs out after reset. `demoResetting` already exists.

- [ ] **Step 1: Add state**

  ```js
  const [showResetModal, setShowResetModal] = useState(false);
  ```

  Add import:
  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace the guard**

  Find:
  ```js
  const handleResetDemo = async () => {
    if (!window.confirm('Reset demo? This clears all agent history, token chain events, and MCP audit logs. You will be logged out and the theme will reset to default.')) return;
    setDemoResetting(true);
    // ... reset body
  };
  ```

  Replace with:
  ```js
  const handleResetDemo = () => {
    setShowResetModal(true);
  };

  const handleResetDemoConfirmed = async () => {
    setShowResetModal(false);
    setDemoResetting(true);
    try { await axios.post('/api/admin/reset-demo'); } catch (_) {}
    try { localStorage.removeItem('tokenChainHistory'); } catch (_) {}
    try { localStorage.removeItem('api-traffic-store'); } catch (_) {}
    try { localStorage.removeItem('banking_ui_theme'); } catch (_) {}
    try { sessionStorage.removeItem('banking_ui_theme'); } catch (_) {}
    performLogout();
  };
  ```

- [ ] **Step 3: Render the modal**

  ```jsx
  <ConfirmModal
    isOpen={showResetModal}
    title="Reset demo?"
    message="This clears all agent history, token chain events, and MCP audit logs. You will be logged out and the theme will reset to default."
    confirmLabel="Reset"
    danger
    onConfirm={handleResetDemoConfirmed}
    onCancel={() => setShowResetModal(false)}
  />
  ```

- [ ] **Step 4: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/DemoSetupPanel.js
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in DemoSetupPanel"
  ```

---

### Task 7: LogViewer — replace 2 window.confirms (lines 246, 252)

**Files:**
- Modify: `demo_api_ui/src/components/LogViewer.js`

Both confirms are inside `clearLogs()`. The first clears toast messages (browser-only), the second clears server console logs. They're conditional on `filter.category`.

- [ ] **Step 1: Add state**

  ```js
  const [showClearToastModal, setShowClearToastModal] = useState(false);
  const [showClearLogsModal, setShowClearLogsModal] = useState(false);
  ```

  Add import:
  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace the clearLogs function**

  Find `clearLogs` (around line 244). Replace with:

  ```js
  const clearLogs = async () => {
    if (filter.category === 'toast messages') {
      setShowClearToastModal(true);
      return;
    }
    setShowClearLogsModal(true);
  };

  const handleClearToastConfirmed = () => {
    setShowClearToastModal(false);
    toastLogStore.clear();
    replaceLogsOnNextFetchRef.current = true;
    setLogs([]);
  };

  const handleClearLogsConfirmed = async () => {
    setShowClearLogsModal(false);
    try {
      await axios.delete('/api/logs/console');
      replaceLogsOnNextFetchRef.current = true;
      setLogs([]);
      fetchStats();
    } catch (err) {
      console.error('Error clearing logs:', err);
    }
  };
  ```

- [ ] **Step 3: Render both modals**

  ```jsx
  <ConfirmModal
    isOpen={showClearToastModal}
    title="Clear toast messages?"
    message="This will clear all recorded toast messages from this browser session."
    confirmLabel="Clear"
    danger
    onConfirm={handleClearToastConfirmed}
    onCancel={() => setShowClearToastModal(false)}
  />
  <ConfirmModal
    isOpen={showClearLogsModal}
    title="Clear console logs?"
    message="This will clear all console logs."
    confirmLabel="Clear"
    danger
    onConfirm={handleClearLogsConfirmed}
    onCancel={() => setShowClearLogsModal(false)}
  />
  ```

- [ ] **Step 4: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/LogViewer.js
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in LogViewer"
  ```

---

### Task 8: MFALogsViewer — replace 1 window.confirm (line 28)

**Files:**
- Modify: `demo_api_ui/src/components/MFALogsViewer.jsx`

Guards clearing MFA logs.

- [ ] **Step 1: Add state**

  ```js
  const [showClearModal, setShowClearModal] = useState(false);
  ```

  Add import:
  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace the guard**

  Find (around line 26):
  ```js
  const handleClearLogs = async () => {
    if (!window.confirm("Clear all MFA logs?")) return;
    // ... clear body
  };
  ```

  Replace with:
  ```js
  const handleClearLogs = () => {
    setShowClearModal(true);
  };

  const handleClearLogsConfirmed = async () => {
    setShowClearModal(false);
    // original clear body here
  };
  ```

- [ ] **Step 3: Render the modal**

  ```jsx
  <ConfirmModal
    isOpen={showClearModal}
    title="Clear MFA logs?"
    message="This will clear all MFA logs."
    confirmLabel="Clear"
    danger
    onConfirm={handleClearLogsConfirmed}
    onCancel={() => setShowClearModal(false)}
  />
  ```

- [ ] **Step 4: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/MFALogsViewer.jsx
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in MFALogsViewer"
  ```

---

### Task 9: OAuthDebugLogViewer — replace 1 window.confirm (line 44)

**Files:**
- Modify: `demo_api_ui/src/components/OAuthDebugLogViewer.js`

Guards clearing server-side OAuth verbose log.

- [ ] **Step 1: Add state**

  ```js
  const [showClearModal, setShowClearModal] = useState(false);
  ```

  Add import:
  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace the guard**

  Find:
  ```js
  const handleClear = async () => {
    if (!window.confirm('Clear all stored OAuth verbose log lines on the server?')) return;
    try {
      await apiClient.delete('/api/admin/oauth-debug-log');
      notifySuccess('Log cleared.');
      fetchLog();
    } catch (e) {
      notifyError(e.response?.data?.message || e.message);
    }
  };
  ```

  Replace with:
  ```js
  const handleClear = () => {
    setShowClearModal(true);
  };

  const handleClearConfirmed = async () => {
    setShowClearModal(false);
    try {
      await apiClient.delete('/api/admin/oauth-debug-log');
      notifySuccess('Log cleared.');
      fetchLog();
    } catch (e) {
      notifyError(e.response?.data?.message || e.message);
    }
  };
  ```

- [ ] **Step 3: Render the modal**

  ```jsx
  <ConfirmModal
    isOpen={showClearModal}
    title="Clear OAuth debug log?"
    message="This will clear all stored OAuth verbose log lines on the server."
    confirmLabel="Clear"
    danger
    onConfirm={handleClearConfirmed}
    onCancel={() => setShowClearModal(false)}
  />
  ```

- [ ] **Step 4: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/OAuthDebugLogViewer.js
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in OAuthDebugLogViewer"
  ```

---

### Task 10: SetupWizard — replace 1 window.confirm (line 140)

**Files:**
- Modify: `demo_api_ui/src/components/SetupWizard.js`

Guards the PingOne environment wipe. High-stakes — long message. `wipeRunning` state already exists.

- [ ] **Step 1: Add state**

  ```js
  const [showWipeModal, setShowWipeModal] = useState(false);
  ```

  Add import:
  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace the guard**

  Find (around line 138):
  ```js
  if (!window.confirm(`This will DELETE EVERYTHING in PingOne env ${creds.envId}.\n\n...`)) return;
  setWipeRunning(true);
  // ... wipe body
  ```

  Replace with — split handler into trigger + confirmed:
  ```js
  const handleWipe = () => {
    setShowWipeModal(true);
  };

  const handleWipeConfirmed = async () => {
    setShowWipeModal(false);
    setWipeRunning(true);
    // original wipe body here
  };
  ```

  Update the button/trigger that calls this to call `handleWipe` instead.

- [ ] **Step 3: Render the modal**

  ```jsx
  <ConfirmModal
    isOpen={showWipeModal}
    title={`Delete everything in PingOne env ${creds.envId}?`}
    message="Apps, resource servers, groups, custom user attributes, and users will be removed (except the worker app you're authenticated as). This cannot be undone."
    confirmLabel="Delete Everything"
    danger
    onConfirm={handleWipeConfirmed}
    onCancel={() => setShowWipeModal(false)}
  />
  ```

- [ ] **Step 4: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/SetupWizard.js
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in SetupWizard"
  ```

---

### Task 11: SideNav — replace 1 window.confirm (line 203)

**Files:**
- Modify: `demo_api_ui/src/components/SideNav.js`

Guards the "resetDemo" action inside `handleNavAction`. SideNav already uses `KillSwitchConfirmModal` for the kill switch — this is a separate confirm for the admin reset-demo action.

- [ ] **Step 1: Add state**

  ```js
  const [showResetDemoModal, setShowResetDemoModal] = useState(false);
  ```

  Add import:
  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace the guard inside handleNavAction**

  Find (around line 201):
  ```js
  } else if (action === "resetDemo") {
    if (!window.confirm("Reset demo? This clears all agent history...")) return;
    try {
      await fetch("/api/admin/reset-demo", { method: "POST", credentials: "include" });
    } catch (_) {}
    try { localStorage.removeItem("tokenChainHistory"); } catch (_) {}
    // ...
  ```

  Replace with — open modal from the action, move body to confirmed handler:
  ```js
  } else if (action === "resetDemo") {
    setShowResetDemoModal(true);
    return;
  ```

  Add outside `handleNavAction`:
  ```js
  const handleResetDemoConfirmed = async () => {
    setShowResetDemoModal(false);
    try {
      await fetch("/api/admin/reset-demo", { method: "POST", credentials: "include" });
    } catch (_) {}
    try { localStorage.removeItem("tokenChainHistory"); } catch (_) {}
    try { localStorage.removeItem("api-traffic-store"); } catch (_) {}
    window.location.reload();
  };
  ```

- [ ] **Step 3: Render the modal**

  Place alongside the existing `KillSwitchConfirmModal` render:
  ```jsx
  <ConfirmModal
    isOpen={showResetDemoModal}
    title="Reset demo?"
    message="This clears all agent history, token chain events, and MCP audit logs. You will stay logged in."
    confirmLabel="Reset"
    danger
    onConfirm={handleResetDemoConfirmed}
    onCancel={() => setShowResetDemoModal(false)}
  />
  ```

- [ ] **Step 4: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/SideNav.js
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in SideNav"
  ```

---

### Task 12: Users — replace 1 window.confirm (line 120)

**Files:**
- Modify: `demo_api_ui/src/components/Users.js`

Guards deleting a user. Needs `userId` and `userName`.

- [ ] **Step 1: Add state**

  ```js
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState(null); // { id, name }
  ```

  Add import:
  ```js
  import ConfirmModal from './ConfirmModal';
  ```

- [ ] **Step 2: Replace the guard**

  Find (around line 118):
  ```js
  const handleDeleteUser = async (userId, userName) => {
    if (!window.confirm(`Are you sure you want to delete user "${userName}"? This action cannot be undone.`)) {
      return;
    }
    // ... delete body
  };
  ```

  Replace with:
  ```js
  const handleDeleteUser = (userId, userName) => {
    setPendingDeleteUser({ id: userId, name: userName });
    setShowDeleteUserModal(true);
  };

  const handleDeleteUserConfirmed = async () => {
    setShowDeleteUserModal(false);
    const { id: userId } = pendingDeleteUser;
    setPendingDeleteUser(null);
    // original delete body here, using userId
  };
  ```

- [ ] **Step 3: Render the modal**

  ```jsx
  <ConfirmModal
    isOpen={showDeleteUserModal}
    title="Delete user?"
    message={pendingDeleteUser ? `Are you sure you want to delete user "${pendingDeleteUser.name}"? This action cannot be undone.` : ''}
    confirmLabel="Delete"
    danger
    onConfirm={handleDeleteUserConfirmed}
    onCancel={() => { setShowDeleteUserModal(false); setPendingDeleteUser(null); }}
  />
  ```

- [ ] **Step 4: Build and commit**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  git add demo_api_ui/src/components/Users.js
  git commit -m "fix(ui): replace window.confirm with ConfirmModal in Users"
  ```

---

### Task 13: Add ESLint rule to prevent regressions

**Files:**
- Modify: `demo_api_ui/package.json`

- [ ] **Step 1: Open package.json and locate eslintConfig**

  The current `eslintConfig` section in `demo_api_ui/package.json` reads:
  ```json
  "eslintConfig": {
    "extends": [
      "react-app",
      "react-app/jest"
    ]
  }
  ```

- [ ] **Step 2: Add the no-restricted-globals rule**

  Replace the `eslintConfig` block with:
  ```json
  "eslintConfig": {
    "extends": [
      "react-app",
      "react-app/jest"
    ],
    "rules": {
      "no-restricted-globals": [
        "error",
        {
          "name": "confirm",
          "message": "Use <ConfirmModal> with local state instead of window.confirm(). See docs/superpowers/specs/2026-05-24-ui-feedback-consistency-design.md"
        }
      ]
    }
  }
  ```

- [ ] **Step 3: Verify the rule fires on a test case**

  Create a temporary file to confirm the rule is active:
  ```bash
  echo "window.confirm('test')" > /tmp/lint-test.js
  cd demo_api_ui && npx eslint --no-eslintrc -c '{"rules":{"no-restricted-globals":["error",{"name":"confirm","message":"use ConfirmModal"}]}}' /tmp/lint-test.js 2>&1 | head -5
  ```
  Expected: error about `confirm`.

- [ ] **Step 4: Build (ESLint runs as part of CRA build)**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -10
  ```
  Expected: `Compiled successfully.` — no lint errors because all `window.confirm` calls are now gone.

- [ ] **Step 5: Commit**

  ```bash
  git add demo_api_ui/package.json
  git commit -m "chore(lint): ban window.confirm — enforce ConfirmModal pattern"
  ```

---

### Task 14: Final verification

- [ ] **Step 1: Confirm zero window.confirm remain**

  ```bash
  grep -rn "window\.confirm(" demo_api_ui/src --include="*.js" --include="*.jsx"
  ```
  Expected: no output.

- [ ] **Step 2: Full build**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  ```
  Expected: `Compiled successfully.`

- [ ] **Step 3: Manual smoke test**

  Open the app. Trigger each action that previously used `window.confirm`:
  - Admin → Banking Ops → delete an account → modal appears with X and Cancel
  - Admin → Users → delete a user → modal appears with X and Cancel
  - SideNav → Reset Demo → modal appears with X and Cancel
  - Clicking X closes without deleting. Clicking Cancel closes without deleting. Clicking the confirm button proceeds.
