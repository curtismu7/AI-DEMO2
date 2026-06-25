# Create Demo User Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Create Demo User" slide-over panel to the admin Users list that provisions a fully-configured PingOne user (email, cell, may_act delegation, optional MFA pre-enrollment, auto-seeded banking data) and links to a new editable `/users/:userId` detail page.

**Architecture:** A new `POST /api/admin/demo-users` BFF route orchestrates all PingOne provisioning steps sequentially and returns a per-step result. The React UI adds a slide-over panel (`CreateUserPanel.jsx`) on the Users list and a new `UserDetailPage.jsx` at `/users/:userId`.

**Tech Stack:** React (CRA, JSX in `.js` files), Express (CommonJS), `pingoneUserService.js`, `mfaService.js`, `dataStore` (store.js), PingOne Management API.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `demo_api_server/routes/adminDemoUsers.js` | `POST /api/admin/demo-users` orchestration |
| Create | `demo_api_ui/src/components/CreateUserPanel.jsx` | Slide-over form component |
| Create | `demo_api_ui/src/components/UserDetailPage.jsx` | Editable user detail page |
| Modify | `demo_api_server/services/mfaService.js` | Add `enrollEmailDevice()` / `enrollSmsDevice()` admin-token variants |
| Modify | `demo_api_server/data/store.js` | Add `seedAccountsForUser(pingoneId)` |
| Modify | `demo_api_server/routes/users.js` | Add `PATCH /api/users/:userId/attributes` for may_act |
| Modify | `demo_api_server/server.js` | Mount `adminDemoUsers` router |
| Modify | `demo_api_ui/src/components/Users.js` | Add button + wire `CreateUserPanel` |
| Modify | `demo_api_ui/src/App.js` | Register `/users/:userId` route |
| Modify | `REGRESSION_PLAN.md` | §4 bug fix / feature log entry |

---

## Task 1: Add `seedAccountsForUser` to store.js

Seeding must be vertical-aware: account names and transaction descriptions should match
the active vertical's terminology so the data looks native in the UI (e.g. "Pro Member
Account" + "Nike Running Shoes — In-Store" for sporting-goods, not "Primary Checking" +
"Coffee Shop").

**Files:**
- Modify: `demo_api_server/data/store.js`

- [ ] **Step 1.1: Locate the createAccount and createTransaction methods in store.js**

Open `demo_api_server/data/store.js` and find `createAccount` and `createTransaction`.

`createAccount` accepts: `userId`, `accountType`, `name`, `balance`, `currency`,
`accountNumberFull`, `accountNumber`, `routingNumber`, `swiftCode`, `iban`,
`branchName`, `branchCode`, `openedDate`, `accountHolderName`. Auto-adds `id`, `createdAt`, `isActive: true`.

`createTransaction` accepts: `userId`, `fromAccountId`, `toAccountId`, `description`, `type`.
Auto-adds `id`, `createdAt`, `status: 'completed'`.

- [ ] **Step 1.2: Add SEED_PROFILES constant above the class**

Add this constant above the `class DataStore {` line. It holds vertical-specific account and
transaction data so descriptions look native in each theme's UI.

```javascript
const SEED_PROFILES = {
  banking: {
    primary:   { accountType: 'CHECKING', name: 'Primary Checking', balanceBase: 2500, balanceRange: 700 },
    secondary: { accountType: 'SAVINGS',  name: 'Savings Account',  balanceBase: 8500, balanceRange: 6500 },
    transactions: [
      { description: 'Payroll Deposit',        type: 'deposit',  toSecondary: false },
      { description: 'Grocery Store',          type: 'purchase', toSecondary: false },
      { description: 'Transfer to Savings',    type: 'transfer', toSecondary: true  },
      { description: 'Coffee Shop',            type: 'purchase', toSecondary: false },
      { description: 'Utility Bill',           type: 'purchase', toSecondary: false },
    ],
  },
  'sporting-goods': {
    primary:   { accountType: 'Pro Member',   name: 'Pro Member Account', balanceBase: 1200, balanceRange: 800 },
    secondary: { accountType: 'Elite Member', name: 'Elite Rewards',      balanceBase: 4500, balanceRange: 3000 },
    transactions: [
      { description: 'Nike Running Shoes — In-Store',   type: 'In-Store', toSecondary: false },
      { description: 'Patagonia Jacket — Online',       type: 'Online',   toSecondary: false },
      { description: 'Team Jersey Bulk Order',          type: 'Team Order', toSecondary: true },
      { description: 'Titleist Golf Balls — In-Store',  type: 'In-Store', toSecondary: false },
      { description: 'Gear Return — Faulty Helmet',     type: 'Return',   toSecondary: false },
    ],
  },
  healthcare: {
    primary:   { accountType: 'Primary Care',  name: 'Primary Care Record',  balanceBase: 500,  balanceRange: 300 },
    secondary: { accountType: 'Specialist',    name: 'Specialist Coverage',  balanceBase: 2000, balanceRange: 1000 },
    transactions: [
      { description: 'Annual Physical Check-in',       type: 'Check-in',        toSecondary: false },
      { description: 'Cardiology Consultation',        type: 'Consultation',     toSecondary: true  },
      { description: 'Lab Results Records Release',    type: 'Records Release',  toSecondary: false },
      { description: 'Dermatology Referral',           type: 'Referral',         toSecondary: false },
      { description: 'Telehealth Consultation',        type: 'Consultation',     toSecondary: false },
    ],
  },
  retail: {
    primary:   { accountType: 'Rewards Points', name: 'Rewards Account',  balanceBase: 850,  balanceRange: 500 },
    secondary: { accountType: 'Store Credit',   name: 'Store Credit',     balanceBase: 200,  balanceRange: 150 },
    transactions: [
      { description: 'Electronics — Laptop Purchase',  type: 'Purchase',          toSecondary: false },
      { description: 'Points Redemption — Discount',   type: 'Points Redemption', toSecondary: true  },
      { description: 'Clothing Return',                type: 'Return',            toSecondary: false },
      { description: 'Home Goods Purchase',            type: 'Purchase',          toSecondary: false },
      { description: 'Refund — Cancelled Order',       type: 'Refund',            toSecondary: false },
    ],
  },
  workforce: {
    primary:   { accountType: 'PTO Balance',        name: 'PTO Account',       balanceBase: 15,  balanceRange: 10 },
    secondary: { accountType: 'Benefits Allowance', name: 'Benefits Allowance', balanceBase: 3000, balanceRange: 1000 },
    transactions: [
      { description: 'Vacation — 3 days',              type: 'Time Off Request', toSecondary: false },
      { description: 'Team Offsite Expense Report',    type: 'Expense Report',   toSecondary: true  },
      { description: 'Dental Benefits Claim',          type: 'Benefits Claim',   toSecondary: false },
      { description: 'Conference Travel Reimbursement',type: 'Reimbursement',    toSecondary: false },
      { description: 'Sick Day — 1 day',               type: 'Time Off Request', toSecondary: false },
    ],
  },
};
```

- [ ] **Step 1.3: Add seedAccountsForUser method**

Find the end of the class body (before the closing `}` of the class). Add:

```javascript
async seedAccountsForUser(userId) {
  const configStore = require('../services/configStore');
  const vertical = configStore.getEffective('active_vertical') || 'banking';
  const profile = SEED_PROFILES[vertical] || SEED_PROFILES.banking;

  const now = new Date().toISOString().split('T')[0];
  const acct1Full = `01${Math.floor(Math.random() * 1e10).toString().padStart(10, '0')}`;
  const acct2Full = `02${Math.floor(Math.random() * 1e10).toString().padStart(10, '0')}`;

  const primary = await this.createAccount({
    userId,
    accountType: profile.primary.accountType,
    name: profile.primary.name,
    balance: profile.primary.balanceBase + Math.floor(Math.random() * profile.primary.balanceRange),
    currency: 'USD',
    accountNumberFull: acct1Full,
    accountNumber: `****${acct1Full.slice(-4)}`,
    routingNumber: '021000021',
    swiftCode: 'CHASUS33',
    iban: `US${acct1Full}`,
    branchName: 'Main Branch',
    branchCode: '001',
    openedDate: now,
    accountHolderName: '',
  });

  const secondary = await this.createAccount({
    userId,
    accountType: profile.secondary.accountType,
    name: profile.secondary.name,
    balance: profile.secondary.balanceBase + Math.floor(Math.random() * profile.secondary.balanceRange),
    currency: 'USD',
    accountNumberFull: acct2Full,
    accountNumber: `****${acct2Full.slice(-4)}`,
    routingNumber: '021000021',
    swiftCode: 'CHASUS33',
    iban: `US${acct2Full}`,
    branchName: 'Main Branch',
    branchCode: '001',
    openedDate: now,
    accountHolderName: '',
  });

  for (const tx of profile.transactions) {
    await this.createTransaction({
      userId,
      fromAccountId: tx.toSecondary ? primary.id : null,
      toAccountId:   tx.toSecondary ? secondary.id : primary.id,
      description:   tx.description,
      type:          tx.type,
    });
  }

  return { primary, secondary, vertical };
}
```

- [ ] **Step 1.4: Verify the server still starts**

```bash
cd demo_api_server && node -e "const s = require('./data/store'); console.log(typeof s.seedAccountsForUser)"
```

Expected output: `function`

- [ ] **Step 1.5: Commit**

```bash
git add demo_api_server/data/store.js
git commit -m "feat(store): add vertical-aware seedAccountsForUser for demo user provisioning"
```

---

## Task 2: Add MFA pre-enroll helpers to mfaService.js

The existing `enrollEmailDevice` and `enrollSmsDevice` methods in `mfaService.js` require a **user access token** (they use the Devices Management API with user context). For admin-side provisioning we need worker-token variants that call the PingOne Management API directly.

**Files:**
- Modify: `demo_api_server/services/mfaService.js`

- [ ] **Step 2.1: Find the worker token method in mfaService.js**

Open `demo_api_server/services/mfaService.js` and locate how the service obtains a management/worker token. Look for references to `pingoneManagementService` or a method like `getWorkerToken()` / `getManagementToken()`. Note the pattern — it likely calls `pingoneManagementService.getAccessToken()` or similar.

- [ ] **Step 2.2: Add adminEnrollEmailDevice method**

Near the bottom of the `MfaService` class (before the closing `}` of the class), add:

```javascript
async adminEnrollEmailDevice(pingoneUserId, email) {
  const { managementApiBase, getAccessToken } = require('./pingoneManagementService');
  const token = await getAccessToken();
  const url = `${managementApiBase}/users/${pingoneUserId}/devices`;
  const response = await axios.post(url, { type: 'EMAIL', email }, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return response.data;
}
```

> Note: if `pingoneManagementService` exports differently (e.g., a singleton object), adjust the destructuring to match. Check the top of `mfaService.js` for any existing imports of `pingoneManagementService` and use the same import style.

- [ ] **Step 2.3: Add adminEnrollSmsDevice method**

Directly after `adminEnrollEmailDevice`, add:

```javascript
async adminEnrollSmsDevice(pingoneUserId, phone) {
  const { managementApiBase, getAccessToken } = require('./pingoneManagementService');
  const token = await getAccessToken();
  const url = `${managementApiBase}/users/${pingoneUserId}/devices`;
  const response = await axios.post(url, { type: 'SMS', phone }, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return response.data;
}
```

- [ ] **Step 2.4: Verify syntax**

```bash
cd demo_api_server && node -e "const m = require('./services/mfaService'); console.log(typeof m.adminEnrollEmailDevice, typeof m.adminEnrollSmsDevice)"
```

Expected: `function function`

- [ ] **Step 2.5: Commit**

```bash
git add demo_api_server/services/mfaService.js
git commit -m "feat(mfa): add adminEnrollEmailDevice and adminEnrollSmsDevice for provisioning"
```

---

## Task 3: Add PATCH /api/users/:userId/attributes endpoint

**Files:**
- Modify: `demo_api_server/routes/users.js`

- [ ] **Step 3.1: Locate the file structure**

Open `demo_api_server/routes/users.js`. Find where the PUT `/:userId` handler ends. Add the PATCH `/:userId/attributes` handler after it.

- [ ] **Step 3.2: Add the handler**

```javascript
// PATCH /api/users/:userId/attributes — update PingOne custom attributes (e.g. may_act)
router.patch(
  '/:userId/attributes',
  requireScopes(['write']),
  requireAdmin,
  async (req, res) => {
    const { userId } = req.params;
    const { mayAct } = req.body; // { enabled: bool, targetUserId: string|null }

    try {
      const pingoneUserService = require('../services/pingoneUserService');
      if (mayAct !== undefined) {
        if (mayAct.enabled && mayAct.targetUserId) {
          await pingoneUserService.setMayActAttribute(userId, { sub: mayAct.targetUserId });
        } else {
          // Clear may_act by patching with null/empty
          await pingoneUserService.updatePingOneUser(userId, [
            { op: 'remove', path: '/custom/mayAct' },
          ]);
        }
      }
      res.json({ message: 'Attributes updated successfully' });
    } catch (err) {
      const status = err.response?.status || 500;
      res.status(status).json({ error: 'Failed to update attributes', detail: err.message });
    }
  }
);
```

> `requireAdmin` and `requireScopes` are already imported at the top of users.js — check the imports to confirm their names match.

- [ ] **Step 3.3: Verify no syntax errors**

```bash
cd demo_api_server && node -e "require('./routes/users'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3.4: Commit**

```bash
git add demo_api_server/routes/users.js
git commit -m "feat(users): add PATCH /:userId/attributes for may_act updates"
```

---

## Task 4: Create POST /api/admin/demo-users route

**Files:**
- Create: `demo_api_server/routes/adminDemoUsers.js`

- [ ] **Step 4.1: Create the file**

```javascript
'use strict';

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const pingoneUserService = require('../services/pingoneUserService');
const mfaService = require('../services/mfaService');
const dataStore = require('../data/store');

// POST /api/admin/demo-users
// Provisions a complete demo user: PingOne user + attributes + MFA + banking seed
router.post('/', requireAdmin, async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    mobile,
    password,
    delegation,   // { enabled: bool, targetUserId: string|null }
    mfa,          // { enrollEmail: bool, enrollSms: bool }
    seedBanking,  // bool
  } = req.body;

  if (!firstName || !lastName || !email || !mobile || !password) {
    return res.status(400).json({ error: 'firstName, lastName, email, mobile, and password are required' });
  }

  const steps = {
    created: false,
    mobile: false,
    mayAct: false,
    emailOtp: false,
    smsOtp: false,
    banking: false,
  };
  const errors = {};
  let createdUser = null;

  // Step 1: Create PingOne user
  try {
    createdUser = await pingoneUserService.createPingOneUser({
      email,
      username: email,
      firstName,
      lastName,
      password,
      phone: mobile,
    });
    steps.created = true;
  } catch (err) {
    const status = err.response?.status || 502;
    const detail = err.response?.data?.message || err.message;
    return res.status(status).json({ error: 'Failed to create PingOne user', detail, steps });
  }

  const pingoneId = createdUser.id;

  // Step 2: Set mobile attribute
  try {
    await pingoneUserService.updatePingOneUser(pingoneId, { mobilePhone: mobile });
    steps.mobile = true;
  } catch (err) {
    errors.mobile = err.message;
  }

  // Step 3: Set may_act (delegation)
  if (delegation?.enabled && delegation?.targetUserId) {
    try {
      await pingoneUserService.setMayActAttribute(pingoneId, { sub: delegation.targetUserId });
      steps.mayAct = true;
    } catch (err) {
      errors.mayAct = err.message;
    }
  }

  // Step 4: Pre-enroll email OTP
  if (mfa?.enrollEmail) {
    try {
      await mfaService.adminEnrollEmailDevice(pingoneId, email);
      steps.emailOtp = true;
    } catch (err) {
      errors.emailOtp = err.message;
    }
  }

  // Step 5: Pre-enroll SMS OTP
  if (mfa?.enrollSms) {
    try {
      await mfaService.adminEnrollSmsDevice(pingoneId, mobile);
      steps.smsOtp = true;
    } catch (err) {
      errors.smsOtp = err.message;
    }
  }

  // Step 6: Seed banking data
  if (seedBanking !== false) {
    try {
      await dataStore.seedAccountsForUser(pingoneId);
      steps.banking = true;
    } catch (err) {
      errors.banking = err.message;
    }
  }

  const partialFailure = Object.keys(errors).length > 0;
  const statusCode = partialFailure ? 207 : 201;

  res.status(statusCode).json({
    user: {
      id: pingoneId,
      email,
      firstName,
      lastName,
    },
    pingoneId,
    steps,
    ...(partialFailure ? { errors } : {}),
  });
});

module.exports = router;
```

- [ ] **Step 4.2: Verify no syntax errors**

```bash
cd demo_api_server && node -e "require('./routes/adminDemoUsers'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 4.3: Mount the router in server.js**

Open `demo_api_server/server.js`. Find the line:
```javascript
const adminManagementRoutes = require('./routes/adminManagement');
```
Add directly below it:
```javascript
const adminDemoUsersRoutes = require('./routes/adminDemoUsers');
```

Then find:
```javascript
app.use('/api/admin/management', adminManagementRoutes);
```
Add directly below it:
```javascript
app.use('/api/admin/demo-users', authenticateToken, adminDemoUsersRoutes);
```

- [ ] **Step 4.4: Verify server starts**

```bash
cd demo_api_server && node -e "require('./server'); console.log('mounted ok')" 2>&1 | head -5
```

Expected: no `Error` or `Cannot find module` lines.

- [ ] **Step 4.5: Commit**

```bash
git add demo_api_server/routes/adminDemoUsers.js demo_api_server/server.js
git commit -m "feat(api): add POST /api/admin/demo-users provisioning endpoint"
```

---

## Task 5: Create CreateUserPanel.jsx

**Files:**
- Create: `demo_api_ui/src/components/CreateUserPanel.jsx`

- [ ] **Step 5.1: Create the file**

```jsx
import React, { useState, useEffect } from 'react';
import bffAxios from '../services/bffAxios';

export default function CreateUserPanel({ onClose, onCreated }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', mobile: '', password: '',
    delegationEnabled: false, delegateTargetUserId: '', delegateTargetEmail: '',
    enrollEmail: true, enrollSms: false,
    seedBanking: true,
  });
  const [delegateSearch, setDelegateSearch] = useState('');
  const [delegateResults, setDelegateResults] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { success, user, steps, errors }

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  // Delegate target search
  useEffect(() => {
    if (!form.delegationEnabled || delegateSearch.length < 2) {
      setDelegateResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await bffAxios.get(`/api/users/search/${encodeURIComponent(delegateSearch)}`);
        setDelegateResults(res.data.users || []);
      } catch {
        setDelegateResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [delegateSearch, form.delegationEnabled]);

  const handleSubmit = async e => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await bffAxios.post('/api/admin/demo-users', {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        mobile: form.mobile,
        password: form.password,
        delegation: {
          enabled: form.delegationEnabled,
          targetUserId: form.delegateTargetUserId || null,
        },
        mfa: { enrollEmail: form.enrollEmail, enrollSms: form.enrollSms },
        seedBanking: form.seedBanking,
      });
      setResult({ success: true, user: res.data.user, steps: res.data.steps, errors: res.data.errors });
      // Reset form for next user
      setForm({
        firstName: '', lastName: '', email: '', mobile: '', password: '',
        delegationEnabled: false, delegateTargetUserId: '', delegateTargetEmail: '',
        enrollEmail: true, enrollSms: false, seedBanking: true,
      });
      setDelegateSearch('');
      if (onCreated) onCreated(res.data.user);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      setResult({ success: false, error: detail });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Create Demo User</span>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close">×</button>
        </div>

        <div style={styles.body}>
          {result && result.success && (
            <div style={styles.successBanner}>
              <span>✅</span>
              <div>
                <strong>User created: {result.user.email}</strong>
                <div style={{ fontSize: 12, marginTop: 2 }}>
                  PingOne ID: {result.user.id}
                  {result.errors && Object.keys(result.errors).length > 0 && (
                    <span style={{ color: '#92400e' }}> · Some steps failed — see details above</span>
                  )}
                </div>
                <a href={`/users/${result.user.id}`} style={styles.profileLink}>View profile →</a>
              </div>
            </div>
          )}

          {result && result.success && result.errors && Object.keys(result.errors).length > 0 && (
            <div style={styles.warnBanner}>
              <span>⚠️</span>
              <div>
                <strong>Partial success — some steps failed:</strong>
                <ul style={{ margin: '4px 0 0 0', paddingLeft: 18, fontSize: 12 }}>
                  {Object.entries(result.errors).map(([k, v]) => (
                    <li key={k}><strong>{k}:</strong> {v}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {result && !result.success && (
            <div style={styles.errorBanner}>
              <span>❌</span>
              <div><strong>Failed to create user:</strong> {result.error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Basic Info */}
            <div style={styles.sectionLabel}>Basic Info</div>

            <div style={styles.row}>
              <div style={styles.field}>
                <label style={styles.label}>First name <span style={styles.req}>*</span></label>
                <input style={styles.input} value={form.firstName} onChange={e => set('firstName', e.target.value)} required disabled={submitting} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Last name <span style={styles.req}>*</span></label>
                <input style={styles.input} value={form.lastName} onChange={e => set('lastName', e.target.value)} required disabled={submitting} />
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Email address <span style={styles.req}>*</span></label>
              <input style={styles.input} type="email" value={form.email} onChange={e => set('email', e.target.value)} required disabled={submitting} />
              <div style={styles.hint}>Used as PingOne username and login identifier — must be unique in the environment.</div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Mobile / cell number <span style={styles.req}>*</span></label>
              <input style={styles.input} type="tel" value={form.mobile} onChange={e => set('mobile', e.target.value)} required disabled={submitting} />
              <div style={styles.hint}>Stored on the PingOne user profile. Required to enroll SMS OTP as an MFA device.</div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Temporary password <span style={styles.req}>*</span></label>
              <input style={styles.input} type="password" value={form.password} onChange={e => set('password', e.target.value)} required minLength={8} disabled={submitting} />
              <div style={styles.hint}>PingOne requires an initial password (min 8 chars). User will be prompted to change it on first login.</div>
            </div>

            {/* Delegation */}
            <div style={styles.sectionLabel}>Delegation (may_act)</div>

            <div style={styles.toggleRow}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.delegationEnabled} onChange={e => set('delegationEnabled', e.target.checked)} disabled={submitting} />
                <span>Enable delegation — this user can act on behalf of another</span>
              </label>
              <div style={styles.hint}>
                Sets the <code>may_act.sub</code> custom attribute on the PingOne user, enabling RFC 8693 token exchange for agent delegation demos.
              </div>
            </div>

            {form.delegationEnabled && (
              <div style={styles.field}>
                <label style={styles.label}>Delegate target (search by email)</label>
                <input
                  style={styles.input}
                  placeholder="Type email to search…"
                  value={delegateSearch}
                  onChange={e => setDelegateSearch(e.target.value)}
                  disabled={submitting}
                />
                {delegateResults.length > 0 && (
                  <div style={styles.dropdown}>
                    {delegateResults.map(u => (
                      <div
                        key={u.id}
                        style={styles.dropdownItem}
                        onClick={() => {
                          set('delegateTargetUserId', u.id);
                          set('delegateTargetEmail', u.email);
                          setDelegateSearch(u.email);
                          setDelegateResults([]);
                        }}
                      >
                        {u.email} {u.firstName ? `(${u.firstName} ${u.lastName})` : ''}
                      </div>
                    ))}
                  </div>
                )}
                {delegateSearch.length >= 2 && delegateResults.length === 0 && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>No users found.</div>
                )}
                {form.delegateTargetUserId && (
                  <div style={{ fontSize: 12, color: '#065f46', marginTop: 4 }}>
                    Selected: {form.delegateTargetEmail} ({form.delegateTargetUserId})
                  </div>
                )}
              </div>
            )}

            {/* MFA Enrollment */}
            <div style={styles.sectionLabel}>MFA Enrollment (optional)</div>

            <div style={styles.checkRow}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.enrollEmail} onChange={e => set('enrollEmail', e.target.checked)} disabled={submitting} />
                Enroll email OTP
              </label>
              <div style={styles.hint}>Pre-enrolls email as an MFA device so the user can log in without manual MFA setup.</div>
            </div>

            <div style={styles.checkRow}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.enrollSms} onChange={e => set('enrollSms', e.target.checked)} disabled={submitting} />
                Enroll SMS OTP (requires cell number above)
              </label>
            </div>

            {/* Banking Seed */}
            <div style={styles.sectionLabel}>Demo Banking Data</div>

            <div style={styles.checkRow}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.seedBanking} onChange={e => set('seedBanking', e.target.checked)} disabled={submitting} />
                Auto-seed demo banking data (checking + savings accounts)
              </label>
              <div style={styles.hint}>Creates sample accounts and transactions so the user can immediately demo banking features.</div>
            </div>

            <div style={styles.actions}>
              <button type="submit" style={styles.submitBtn} disabled={submitting}>
                {submitting ? 'Creating…' : 'Create User'}
              </button>
              <button type="button" style={styles.cancelBtn} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
    display: 'flex', justifyContent: 'flex-end',
  },
  panel: {
    background: '#fff', width: 480, maxWidth: '100vw', height: '100vh',
    overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
    display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, background: '#fff', zIndex: 1,
  },
  closeBtn: {
    background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280', lineHeight: 1,
  },
  body: { padding: '20px', flex: 1 },
  sectionLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#6b7280', margin: '20px 0 10px',
  },
  row: { display: 'flex', gap: 12 },
  field: { flex: 1, marginBottom: 14, position: 'relative' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' },
  req: { color: '#ef4444' },
  input: {
    width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6,
    fontSize: 13, boxSizing: 'border-box', outline: 'none',
  },
  hint: { fontSize: 11, color: '#6b7280', marginTop: 4, lineHeight: 1.5 },
  toggleRow: { marginBottom: 14 },
  checkRow: { marginBottom: 10 },
  dropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0,
    background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 180, overflowY: 'auto',
  },
  dropdownItem: {
    padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f3f4f6',
  },
  actions: { display: 'flex', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid #e5e7eb' },
  submitBtn: {
    flex: 1, padding: '10px 0', background: '#0d6efd', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  cancelBtn: {
    padding: '10px 20px', background: '#fff', color: '#374151',
    border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer',
  },
  successBanner: {
    display: 'flex', gap: 10, background: '#d1fae5', border: '1px solid #6ee7b7',
    borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 13, alignItems: 'flex-start',
  },
  warnBanner: {
    display: 'flex', gap: 10, background: '#fef3c7', border: '1px solid #fcd34d',
    borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 13, alignItems: 'flex-start',
  },
  errorBanner: {
    display: 'flex', gap: 10, background: '#fee2e2', border: '1px solid #fca5a5',
    borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 13, alignItems: 'flex-start',
  },
  profileLink: { display: 'inline-block', marginTop: 4, fontSize: 12, color: '#0d6efd' },
};
```

- [ ] **Step 5.2: Commit**

```bash
git add demo_api_ui/src/components/CreateUserPanel.jsx
git commit -m "feat(ui): add CreateUserPanel slide-over form component"
```

---

## Task 6: Wire CreateUserPanel into Users.js

**Files:**
- Modify: `demo_api_ui/src/components/Users.js`

- [ ] **Step 6.1: Add import at top of Users.js**

Find the existing imports at the top of `demo_api_ui/src/components/Users.js` and add:

```javascript
import CreateUserPanel from './CreateUserPanel';
```

- [ ] **Step 6.2: Add panel open state**

Find the existing `useState` declarations in `Users.js` (near `const [users, setUsers] = useState([])`) and add:

```javascript
const [showCreatePanel, setShowCreatePanel] = useState(false);
```

- [ ] **Step 6.3: Add "Create Demo User" button**

Find the header area of the Users list (look for the `AdminSubPageShell` wrapper or the search input row). Add the button so it sits at the top-right alongside the search field:

```jsx
<button
  onClick={() => setShowCreatePanel(true)}
  style={{
    background: '#0d6efd', color: '#fff', border: 'none',
    padding: '8px 16px', borderRadius: 6, fontSize: 13,
    fontWeight: 600, cursor: 'pointer',
  }}
>
  + Create Demo User
</button>
```

- [ ] **Step 6.4: Add panel and row link**

At the end of the returned JSX (just before the closing tag of the outermost element), add:

```jsx
{showCreatePanel && (
  <CreateUserPanel
    onClose={() => setShowCreatePanel(false)}
    onCreated={() => fetchUsers()}
  />
)}
```

Also update each user row in the table to make the name a link to the detail page. Find where the user's name is rendered (likely a `<td>` with `{user.firstName} {user.lastName}`) and wrap it:

```jsx
<a href={`/users/${user.id}`} style={{ color: '#0d6efd', textDecoration: 'none' }}>
  {user.firstName} {user.lastName}
</a>
```

- [ ] **Step 6.5: Build check**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully` or `webpack compiled with 0 errors`.

- [ ] **Step 6.6: Commit**

```bash
git add demo_api_ui/src/components/Users.js
git commit -m "feat(ui): wire CreateUserPanel into Users list with create button and row links"
```

---

## Task 7: Create UserDetailPage.jsx

**Files:**
- Create: `demo_api_ui/src/components/UserDetailPage.jsx`

- [ ] **Step 7.1: Create the file**

```jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import bffAxios from '../services/bffAxios';

export default function UserDetailPage({ user: sessionUser }) {
  const { userId } = useParams();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', mobile: '',
    agentRestrictions: 'read',
    delegationEnabled: false, delegateTargetUserId: '', delegateTargetEmail: '',
  });

  const [delegateSearch, setDelegateSearch] = useState('');
  const [delegateResults, setDelegateResults] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [userRes, accountsRes] = await Promise.all([
          bffAxios.get(`/api/users/${userId}`),
          bffAxios.get(`/api/accounts`).catch(() => ({ data: { accounts: [] } })),
        ]);
        const u = userRes.data.user || userRes.data;
        setProfile(u);
        setForm({
          firstName: u.firstName || '',
          lastName: u.lastName || '',
          email: u.email || '',
          mobile: u.mobilePhone || '',
          agentRestrictions: u.agentRestrictions || 'read',
          delegationEnabled: !!u.mayAct?.sub,
          delegateTargetUserId: u.mayAct?.sub || '',
          delegateTargetEmail: u.mayAct?.sub || '',
        });
        const allAccounts = accountsRes.data.accounts || [];
        setAccounts(allAccounts.filter(a => a.userId === userId));

        try {
          const devRes = await bffAxios.get(`/api/mfa/devices/${userId}`);
          setDevices(devRes.data.devices || []);
        } catch {
          setDevices([]);
        }
      } catch (err) {
        console.error('Failed to load user', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userId]);

  useEffect(() => {
    if (!form.delegationEnabled || delegateSearch.length < 2) {
      setDelegateResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await bffAxios.get(`/api/users/search/${encodeURIComponent(delegateSearch)}`);
        setDelegateResults(res.data.users || []);
      } catch {
        setDelegateResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [delegateSearch, form.delegationEnabled]);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const handleSaveBasic = async () => {
    setSaving(true); setSaveError(null); setSaveSuccess(false);
    try {
      await bffAxios.put(`/api/users/${userId}`, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDelegation = async () => {
    setSaving(true); setSaveError(null); setSaveSuccess(false);
    try {
      await bffAxios.patch(`/api/users/${userId}/attributes`, {
        mayAct: { enabled: form.delegationEnabled, targetUserId: form.delegateTargetUserId || null },
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRestrictions = async () => {
    setSaving(true); setSaveError(null); setSaveSuccess(false);
    try {
      await bffAxios.patch(`/api/admin/management/users/${userId}/agent-restrictions`, {
        agentRestrictions: form.agentRestrictions,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!profile) return <div style={{ padding: 32 }}>User not found.</div>;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px', fontFamily: 'inherit' }}>
      <button onClick={() => navigate('/users')} style={styles.back}>← Back to Users</button>
      <h2 style={styles.pageTitle}>{profile.firstName} {profile.lastName}</h2>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>PingOne ID: {userId}</div>

      {saveSuccess && <div style={styles.successBanner}>✅ Saved successfully.</div>}
      {saveError && <div style={styles.errorBanner}>❌ {saveError}</div>}

      {/* Basic Info */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Basic Info</div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>First name</label>
            <input style={styles.input} value={form.firstName} onChange={e => set('firstName', e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Last name</label>
            <input style={styles.input} value={form.lastName} onChange={e => set('lastName', e.target.value)} />
          </div>
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Email</label>
          <input style={styles.input} value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
        <button style={styles.saveBtn} onClick={handleSaveBasic} disabled={saving}>Save Basic Info</button>
      </div>

      {/* Delegation */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Delegation (may_act)</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
          <input type="checkbox" checked={form.delegationEnabled} onChange={e => set('delegationEnabled', e.target.checked)} />
          Enable delegation
        </label>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
          Sets <code>may_act.sub</code> — enables RFC 8693 token exchange for agent delegation demos.
        </div>
        {form.delegationEnabled && (
          <div style={{ ...styles.field, position: 'relative' }}>
            <label style={styles.label}>Delegate target (search by email)</label>
            <input
              style={styles.input}
              placeholder="Type email to search…"
              value={delegateSearch}
              onChange={e => setDelegateSearch(e.target.value)}
            />
            {delegateResults.length > 0 && (
              <div style={styles.dropdown}>
                {delegateResults.map(u => (
                  <div key={u.id} style={styles.dropdownItem} onClick={() => {
                    set('delegateTargetUserId', u.id);
                    set('delegateTargetEmail', u.email);
                    setDelegateSearch(u.email);
                    setDelegateResults([]);
                  }}>
                    {u.email} {u.firstName ? `(${u.firstName} ${u.lastName})` : ''}
                  </div>
                ))}
              </div>
            )}
            {form.delegateTargetUserId && (
              <div style={{ fontSize: 12, color: '#065f46', marginTop: 4 }}>
                Selected: {form.delegateTargetEmail}
              </div>
            )}
          </div>
        )}
        <button style={styles.saveBtn} onClick={handleSaveDelegation} disabled={saving}>Save Delegation</button>
      </div>

      {/* Agent Restrictions */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Agent Restrictions</div>
        <select style={{ ...styles.input, width: 'auto' }} value={form.agentRestrictions} onChange={e => set('agentRestrictions', e.target.value)}>
          <option value="write">Write (full access)</option>
          <option value="read">Read only</option>
          <option value="none">None (blocked)</option>
        </select>
        <button style={{ ...styles.saveBtn, marginLeft: 12 }} onClick={handleSaveRestrictions} disabled={saving}>Save</button>
      </div>

      {/* MFA Devices */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>MFA Devices</div>
        {devices.length === 0
          ? <div style={{ fontSize: 13, color: '#6b7280' }}>No active MFA devices.</div>
          : devices.map(d => (
            <div key={d.id} style={styles.deviceRow}>
              <span style={{ fontSize: 13 }}>{d.type} — {d.email || d.phone || d.nickname || d.id}</span>
              <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{d.status}</span>
            </div>
          ))
        }
      </div>

      {/* Banking Accounts */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Banking Accounts</div>
        {accounts.length === 0
          ? <div style={{ fontSize: 13, color: '#6b7280' }}>No linked accounts.</div>
          : accounts.map(a => (
            <div key={a.id} style={styles.accountRow}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</span>
              <span style={{ fontSize: 13, marginLeft: 12, color: '#374151' }}>{a.accountNumber}</span>
              <span style={{ fontSize: 13, marginLeft: 'auto', color: a.balance >= 0 ? '#065f46' : '#dc2626' }}>
                ${a.balance?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

const styles = {
  back: { background: 'none', border: 'none', color: '#0d6efd', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 16 },
  pageTitle: { fontSize: 24, fontWeight: 700, margin: '0 0 4px' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, marginBottom: 20 },
  cardTitle: { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', marginBottom: 14 },
  row: { display: 'flex', gap: 12 },
  field: { flex: 1, marginBottom: 12 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
  saveBtn: { marginTop: 12, padding: '8px 20px', background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  dropdown: { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 180, overflowY: 'auto' },
  dropdownItem: { padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f3f4f6' },
  deviceRow: { fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f3f4f6' },
  accountRow: { display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 },
  successBanner: { background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13 },
  errorBanner: { background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13 },
};
```

- [ ] **Step 7.2: Commit**

```bash
git add demo_api_ui/src/components/UserDetailPage.jsx
git commit -m "feat(ui): add UserDetailPage for editing PingOne user profile"
```

---

## Task 8: Register /users/:userId route in App.js

**Files:**
- Modify: `demo_api_ui/src/App.js`

- [ ] **Step 8.1: Add import**

Find the existing import for `Users` in `App.js`:
```javascript
import Users from './components/Users';
```
Add directly below it:
```javascript
import UserDetailPage from './components/UserDetailPage';
```

- [ ] **Step 8.2: Register route**

Find the existing `/users` route in App.js (around line 1025):
```jsx
<Route
  path="/users"
  element={
    <AdminRoute user={user}>
      <Users user={user} onLogout={logout} />
    </AdminRoute>
  }
/>
```

Add directly after it:
```jsx
<Route
  path="/users/:userId"
  element={
    <AdminRoute user={user}>
      <UserDetailPage user={user} />
    </AdminRoute>
  }
/>
```

- [ ] **Step 8.3: Build check**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully` or zero errors.

- [ ] **Step 8.4: Commit**

```bash
git add demo_api_ui/src/App.js
git commit -m "feat(ui): register /users/:userId route for UserDetailPage"
```

---

## Task 9: Update REGRESSION_PLAN.md

**Files:**
- Modify: `REGRESSION_PLAN.md`

- [ ] **Step 9.1: Add §4 entry**

Open `REGRESSION_PLAN.md` and find the §4 Bug Fix Log section. Add an entry at the top of the log:

```markdown
### 2026-05-22 — Create Demo User feature
- **What:** Added `POST /api/admin/demo-users` provisioning endpoint + `CreateUserPanel` slide-over + `UserDetailPage` at `/users/:userId`.
- **Files:** `routes/adminDemoUsers.js`, `components/CreateUserPanel.jsx`, `components/UserDetailPage.jsx`, `routes/users.js` (PATCH attributes), `data/store.js` (seedAccountsForUser), `mfaService.js` (adminEnrollEmailDevice/adminEnrollSmsDevice), `App.js`, `Users.js`, `server.js`.
- **Do not break:** Admin Users list still loads; existing `PUT /api/users/:userId` unaffected; demo-mode guard not removed from existing routes; token custody rule maintained (no tokens exposed to browser).
```

- [ ] **Step 9.2: Commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(regression): log Create Demo User feature in §4"
```

---

## Task 10: Manual verification

- [ ] **Step 10.1: Start services**

```bash
./run.sh
```

- [ ] **Step 10.2: Verify Create User flow**

1. Log in as admin → navigate to `/users`
2. Click "+ Create Demo User" — panel slides in from the right
3. Fill in all required fields (email must be unique in PingOne)
4. Leave "Enroll email OTP" checked, "Seed banking data" checked
5. Click Create User
6. Verify ✅ banner appears with PingOne ID and "View profile →" link
7. Click "View profile →" — navigates to `/users/:userId`
8. Verify all fields are populated
9. Edit first name → click "Save Basic Info" → ✅ banner appears
10. Toggle delegation on → search for a target user → select → click "Save Delegation"

- [ ] **Step 10.3: Verify partial failure handling**

In `adminDemoUsers.js`, temporarily throw in the banking seed step to verify 207 is returned and the ⚠️ banner appears in the UI with step details. Revert afterwards.

- [ ] **Step 10.4: Final build check**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: exit 0, compiled successfully.
