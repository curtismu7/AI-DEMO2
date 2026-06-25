# Admin Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating AI agent to the admin dashboard that auto-loads an admin color theme and exposes 8 MCP tools for customer lookup, inspection, and administrative actions — all routed through the existing RFC 8693 token exchange pipeline.

**Architecture:** A new `admin.json` vertical manifest defines the slate/amber color palette; a `useAdminTheme` hook applies it client-side on `/admin*` route entry and restores the previous theme on exit without mutating server state. Eight new MCP tools (`lookup_customer`, `get_customer_profile`, `get_customer_accounts`, `get_customer_transactions`, `freeze_account`, `reset_customer_password`, `adjust_balance`, `delete_customer`) are registered in `BankingToolRegistry.ts` with `admin:read`/`admin:write`/`admin:delete`/`users:read`/`users:manage` scopes and backed by a new BFF router `adminAgentTools.js`. The existing `BankingAgent.js` FAB is extended to appear on `/admin*` routes with an admin chip set.

**Tech Stack:** React 17 (CRA), Express/CommonJS BFF, TypeScript 5 MCP server, PingOne OAuth / RFC 8693 token exchange.

---

## File Map

| File | Status | Responsibility |
|------|--------|---------------|
| `demo_api_server/config/verticals/admin.json` | **Create** | Admin vertical manifest — slate/amber palette, identity, agent persona |
| `demo_api_ui/src/hooks/useAdminTheme.js` | **Create** | Apply admin cssVars on mount, restore previous theme on unmount |
| `demo_api_server/routes/adminAgentTools.js` | **Create** | 8 BFF route handlers for admin agent tools |
| `demo_mcp_server/src/tools/adminToolHandlers.ts` | **Create** | Handler functions for 8 admin tools (calls BFF via BankingAPIClient) |
| `demo_api_server/data/store.js` | **Modify** | Add `passwordResetRequired` flag support to user records |
| `demo_api_server/server.js` | **Modify** | Mount `adminAgentTools` router |
| `demo_mcp_server/src/tools/BankingToolRegistry.ts` | **Modify** | Register 8 new admin tool definitions |
| `demo_mcp_server/src/tools/BankingToolProvider.ts` | **Modify** | Wire admin tool handlers into dispatch map |
| `demo_api_server/services/agentMcpTokenService.js` | **Modify** | Append admin scopes when `req.user.role === 'admin'` |
| `demo_api_ui/src/components/BankingChips.js` | **Modify** | Add admin chip group shown when `user.role === 'admin'` |
| `demo_api_ui/src/components/embeddedAgentFabVisibility.js` | **Modify** | Extend `isBankingAgentDashboardRoute` to match `/admin*` |
| `demo_api_ui/src/App.js` | **Modify** | Call `useAdminTheme()` inside admin route wrapper |

---

## Task 1: Admin Vertical Manifest

**Files:**
- Create: `demo_api_server/config/verticals/admin.json`

- [ ] **Step 1.1: Create the admin vertical manifest**

```json
{
  "id": "admin",
  "schemaVersion": 2,
  "identity": {
    "displayName": "Admin Console",
    "headerTitle": "Admin Console",
    "documentTitle": "Admin Console · PingOne AI IAM",
    "logoAlt": "Admin Console",
    "tagline": "Administrative Operations",
    "logoPath": "/super-bank-icon.png"
  },
  "theme": {
    "cssVars": {
      "--app-primary-red": "#1e293b",
      "--app-primary-red-hover": "#0f172a",
      "--app-primary-red-mid": "#334155",
      "--app-primary-red-border": "#0f172a",
      "--brand-dashboard-header-start": "#0f172a",
      "--brand-dashboard-header-end": "#1e3a5f",
      "--brand-app-shell-hero-start": "#0f172a",
      "--brand-app-shell-hero-end": "#1e3a5f",
      "--theme-accent": "#f59e0b",
      "--brand-dashboard-header-text": "#f1f5f9"
    }
  },
  "terminology": {
    "account": "Account",
    "accounts": "Accounts",
    "accountTypes": ["Checking", "Savings"],
    "transaction": "Transaction",
    "transactions": "Transactions",
    "transactionTypes": ["Deposit", "Withdrawal", "Transfer"],
    "balance": "Balance",
    "agent": "Admin Agent",
    "dashboard": "Admin Console",
    "highValueAction": "Delete",
    "highValueLabel": "Destructive admin action"
  },
  "agent": {
    "persona": "Admin Agent",
    "greeting": "Hi {name}! I can look up customers, inspect their accounts and transactions, and perform administrative actions. What would you like to do?",
    "systemPromptFlavor": "You are an administrative assistant. You have elevated privileges. Always confirm destructive actions before executing them."
  },
  "dashboard": {
    "kind": "admin",
    "chips": [
      { "key": "lookup_customer", "label": "Look Up Customer" },
      { "key": "get_customer_transactions", "label": "View Transactions" },
      { "key": "get_customer_profile", "label": "View Profile" },
      { "key": "freeze_account", "label": "Freeze Account" }
    ],
    "mockData": null
  },
  "scopes": {
    "read": "admin:read",
    "write": "admin:write",
    "featureScope": "users:manage"
  },
  "demoUsers": {
    "admin": { "hint": "demoAdmin", "passwordHint": "Tigers7&" }
  }
}
```

- [ ] **Step 1.2: Verify the manifest loads**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
node -e "
const v = require('./config/verticals/admin.json');
console.log('id:', v.id);
console.log('cssVars keys:', Object.keys(v.theme.cssVars).length);
console.log('dashboard.kind:', v.dashboard.kind);
"
```

Expected output:
```
id: admin
cssVars keys: 10
dashboard.kind: admin
```

- [ ] **Step 1.3: Commit**

```bash
git add demo_api_server/config/verticals/admin.json
git commit -m "feat: add admin vertical manifest (slate/amber theme)"
```

---

## Task 2: useAdminTheme Hook

**Files:**
- Create: `demo_api_ui/src/hooks/useAdminTheme.js`

- [ ] **Step 2.1: Create the hook**

Create `demo_api_ui/src/hooks/useAdminTheme.js`:

```javascript
import { useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';

const ADMIN_CSS_VARS = {
  '--app-primary-red': '#1e293b',
  '--app-primary-red-hover': '#0f172a',
  '--app-primary-red-mid': '#334155',
  '--app-primary-red-border': '#0f172a',
  '--brand-dashboard-header-start': '#0f172a',
  '--brand-dashboard-header-end': '#1e3a5f',
  '--brand-app-shell-hero-start': '#0f172a',
  '--brand-app-shell-hero-end': '#1e3a5f',
  '--theme-accent': '#f59e0b',
  '--brand-dashboard-header-text': '#f1f5f9',
};

export function useAdminTheme() {
  const { cssVars } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    const previous = {};

    // Stash current values
    Object.keys(ADMIN_CSS_VARS).forEach((k) => {
      previous[k] = root.style.getPropertyValue(k);
    });

    // Apply admin palette
    Object.entries(ADMIN_CSS_VARS).forEach(([k, v]) => {
      root.style.setProperty(k, v);
    });

    const prevIndustry = root.dataset.industry;
    root.dataset.industry = 'admin';

    return () => {
      // Restore previous values
      Object.entries(previous).forEach(([k, v]) => {
        if (v) {
          root.style.setProperty(k, v);
        } else {
          root.style.removeProperty(k);
        }
      });
      root.dataset.industry = prevIndustry || '';
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

> Note: `cssVars` from `useTheme()` is imported so the hook re-runs if the base theme changes while on an admin route, ensuring restores are accurate.

- [ ] **Step 2.2: Wire into admin route wrapper in App.js**

Open `demo_api_ui/src/App.js`. Find the `AdminRoute` component (around line 203):

```javascript
function AdminRoute({ user, children }) {
  const toastedRef = useRef(false);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isAdmin && !toastedRef.current) {
      toastedRef.current = true;
      notifyWarning("This page is restricted to admin users.");
    }
  }, [isAdmin]);

  if (isAdmin) return children;
  return <Navigate to="/" replace />;
}
```

Add the import at the top of `App.js` with the other hook imports:

```javascript
import { useAdminTheme } from './hooks/useAdminTheme';
```

Then update `AdminRoute` to call the hook:

```javascript
function AdminRoute({ user, children }) {
  const toastedRef = useRef(false);
  const isAdmin = user?.role === "admin";
  useAdminTheme();

  useEffect(() => {
    if (!isAdmin && !toastedRef.current) {
      toastedRef.current = true;
      notifyWarning("This page is restricted to admin users.");
    }
  }, [isAdmin]);

  if (isAdmin) return children;
  return <Navigate to="/" replace />;
}
```

- [ ] **Step 2.3: Build to verify no errors**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exit 0, `Compiled successfully.`

- [ ] **Step 2.4: Commit**

```bash
git add demo_api_ui/src/hooks/useAdminTheme.js demo_api_ui/src/App.js
git commit -m "feat: auto-apply admin theme on /admin routes via useAdminTheme hook"
```

---

## Task 3: FAB Visibility on Admin Routes

**Files:**
- Modify: `demo_api_ui/src/components/embeddedAgentFabVisibility.js`

- [ ] **Step 3.1: Read the current function**

Open `demo_api_ui/src/components/embeddedAgentFabVisibility.js` and find `isBankingAgentDashboardRoute`. It currently reads:

```javascript
export function isBankingAgentDashboardRoute(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  return p === '/' || p === '/admin' || p === '/dashboard';
}
```

- [ ] **Step 3.2: Extend to match all /admin* routes**

Replace the function body so any `/admin` sub-route also shows the FAB:

```javascript
export function isBankingAgentDashboardRoute(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  return p === '/' || p === '/dashboard' || p === '/admin' || p.startsWith('/admin/');
}
```

- [ ] **Step 3.3: Build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3.4: Commit**

```bash
git add demo_api_ui/src/components/embeddedAgentFabVisibility.js
git commit -m "feat: show agent FAB on all /admin* routes"
```

---

## Task 4: Admin Chip Group

**Files:**
- Modify: `demo_api_ui/src/components/BankingChips.js`

- [ ] **Step 4.1: Read the component**

Open `demo_api_ui/src/components/BankingChips.js`. Note the `HEURISTIC_CHIPS` array at the top and the props the component receives (look for `onChipClick`, `isLoading`, and any `user` prop).

- [ ] **Step 4.2: Add admin chips constant**

After the existing `HEURISTIC_CHIPS` definition, add:

```javascript
const ADMIN_CHIPS = [
  { id: 'lookup_customer',           label: 'Look Up Customer',   message: 'look up a customer' },
  { id: 'get_customer_transactions', label: 'View Transactions',  message: 'show last 5 transactions for this customer' },
  { id: 'get_customer_profile',      label: 'View Profile',       message: 'show full profile for this customer' },
  { id: 'get_customer_accounts',     label: 'View Accounts',      message: 'show all accounts for this customer' },
  { id: 'freeze_account',            label: 'Freeze Account',     message: 'freeze this account' },
  { id: 'adjust_balance',            label: 'Adjust Balance',     message: 'adjust account balance' },
  { id: 'reset_customer_password',   label: 'Reset Password',     message: 'reset password for this customer' },
  { id: 'delete_customer',           label: 'Delete Customer',    message: 'delete this customer' },
];
```

- [ ] **Step 4.3: Accept user prop and conditionally render admin chips**

Find the component function signature. Add `user` to the destructured props if not already present:

```javascript
export function BankingChips({ onChipClick, isLoading, user }) {
```

In the JSX, before the existing heuristic chips section, add the admin chips block conditionally:

```javascript
{user?.role === 'admin' && (
  <div className="banking-chips-dropdown__section">
    <div className="banking-chips-dropdown__label">Admin Actions</div>
    <div className="banking-chips-dropdown__grid banking-chips-dropdown__grid--heuristic">
      {ADMIN_CHIPS.map((chip) => (
        <button
          key={chip.id}
          className="banking-chips-dropdown__button banking-chips-dropdown__button--heuristic"
          onClick={() => onChipClick(chip)}
          disabled={isLoading}
          title={chip.message}
        >
          {chip.label}
        </button>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 4.4: Find where BankingChips is rendered and pass user prop**

Search for `<BankingChips` in the codebase:

```bash
grep -rn "BankingChips" /Users/curtismuir/Development/AI-Demo/demo_api_ui/src --include="*.js" --include="*.jsx" | grep -v "import\|//\|\.test\."
```

For each usage found, add `user={user}` (the `user` object should already be in scope from context or props at each call site).

- [ ] **Step 4.5: Build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 4.6: Commit**

```bash
git add demo_api_ui/src/components/BankingChips.js
git commit -m "feat: add admin chip group in BankingChips (shown for admin users)"
```

---

## Task 5: Admin Agent BFF Routes

**Files:**
- Create: `demo_api_server/routes/adminAgentTools.js`
- Modify: `demo_api_server/server.js`

- [ ] **Step 5.1: Create adminAgentTools.js**

Create `demo_api_server/routes/adminAgentTools.js`:

```javascript
const express = require('express');
const router = express.Router();
const store = require('../data/store');

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin_required', message: 'Admin role required' });
  }
  next();
}

// GET /api/admin/agent/lookup?q=
router.get('/lookup', requireAdmin, async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q) return res.status(400).json({ error: 'missing_query', message: 'q is required' });

    const users = store.getAllUsers ? store.getAllUsers() : [];
    const matches = users.filter((u) => {
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      return (
        fullName.includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q)
      );
    }).map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      isActive: u.isActive,
    }));

    res.json({ users: matches, count: matches.length });
  } catch (err) {
    console.error('[adminAgentTools] GET /lookup error:', err.message);
    res.status(500).json({ error: 'lookup_error', message: err.message });
  }
});

// GET /api/admin/agent/users/:userId
router.get('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const user = store.getUserById ? store.getUserById(req.params.userId) : null;
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    const { password, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error('[adminAgentTools] GET /users/:userId error:', err.message);
    res.status(500).json({ error: 'get_user_error', message: err.message });
  }
});

// GET /api/admin/agent/users/:userId/accounts
router.get('/users/:userId/accounts', requireAdmin, async (req, res) => {
  try {
    const accounts = store.getAccountsByUserId
      ? store.getAccountsByUserId(req.params.userId)
      : [];
    res.json({ accounts, count: accounts.length });
  } catch (err) {
    console.error('[adminAgentTools] GET /users/:userId/accounts error:', err.message);
    res.status(500).json({ error: 'get_accounts_error', message: err.message });
  }
});

// GET /api/admin/agent/users/:userId/transactions?limit=5
router.get('/users/:userId/transactions', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 50);
    const allTx = store.getTransactionsByUserId
      ? store.getTransactionsByUserId(req.params.userId)
      : [];
    const sorted = allTx
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
    res.json({ transactions: sorted, count: sorted.length });
  } catch (err) {
    console.error('[adminAgentTools] GET /users/:userId/transactions error:', err.message);
    res.status(500).json({ error: 'get_transactions_error', message: err.message });
  }
});

// PATCH /api/admin/agent/accounts/:accountId/freeze
router.patch('/accounts/:accountId/freeze', requireAdmin, async (req, res) => {
  try {
    const { freeze } = req.body;
    if (typeof freeze !== 'boolean') {
      return res.status(400).json({ error: 'invalid_body', message: 'freeze (boolean) is required' });
    }
    const account = store.getAccountById
      ? store.getAccountById(req.params.accountId)
      : null;
    if (!account) return res.status(404).json({ error: 'account_not_found' });

    account.isActive = !freeze;
    if (store.updateAccount) store.updateAccount(account);

    res.json({ success: true, accountId: account.id, isActive: account.isActive, frozen: freeze });
  } catch (err) {
    console.error('[adminAgentTools] PATCH /accounts/:accountId/freeze error:', err.message);
    res.status(500).json({ error: 'freeze_error', message: err.message });
  }
});

// POST /api/admin/agent/users/:userId/reset-password
router.post('/users/:userId/reset-password', requireAdmin, async (req, res) => {
  try {
    const user = store.getUserById ? store.getUserById(req.params.userId) : null;
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    user.passwordResetRequired = true;
    if (store.updateUser) store.updateUser(user);

    res.json({ success: true, userId: user.id, passwordResetRequired: true });
  } catch (err) {
    console.error('[adminAgentTools] POST /users/:userId/reset-password error:', err.message);
    res.status(500).json({ error: 'reset_password_error', message: err.message });
  }
});

// POST /api/admin/agent/accounts/:accountId/adjust
router.post('/accounts/:accountId/adjust', requireAdmin, async (req, res) => {
  try {
    const { amount, description } = req.body;
    if (typeof amount !== 'number') {
      return res.status(400).json({ error: 'invalid_body', message: 'amount (number) is required' });
    }
    const account = store.getAccountById
      ? store.getAccountById(req.params.accountId)
      : null;
    if (!account) return res.status(404).json({ error: 'account_not_found' });

    account.balance = (account.balance || 0) + amount;
    if (store.updateAccount) store.updateAccount(account);

    const tx = store.createTransaction
      ? store.createTransaction({
          userId: account.userId,
          fromAccountId: amount < 0 ? account.id : null,
          toAccountId: amount >= 0 ? account.id : null,
          amount: Math.abs(amount),
          type: amount >= 0 ? 'deposit' : 'withdrawal',
          description: description || 'Admin balance adjustment',
          category: 'admin',
          status: 'completed',
        })
      : null;

    res.json({ success: true, accountId: account.id, newBalance: account.balance, transaction: tx });
  } catch (err) {
    console.error('[adminAgentTools] POST /accounts/:accountId/adjust error:', err.message);
    res.status(500).json({ error: 'adjust_error', message: err.message });
  }
});

// DELETE /api/admin/agent/users/:userId
router.delete('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== true) {
      return res.status(400).json({ error: 'confirmation_required', message: 'confirm: true is required' });
    }
    const user = store.getUserById ? store.getUserById(req.params.userId) : null;
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    if (store.deleteUser) store.deleteUser(req.params.userId);

    res.json({ success: true, deleted: { userId: req.params.userId } });
  } catch (err) {
    console.error('[adminAgentTools] DELETE /users/:userId error:', err.message);
    res.status(500).json({ error: 'delete_error', message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 5.2: Check which store methods actually exist**

```bash
grep -n "module.exports\|getAllUsers\|getUserById\|getAccountsByUserId\|getAccountById\|getTransactionsByUserId\|updateAccount\|updateUser\|createTransaction\|deleteUser" \
  /Users/curtismuir/Development/AI-Demo/demo_api_server/data/store.js | head -40
```

If any method is missing (e.g. `getAllUsers`, `getAccountById`, `updateUser`, `deleteUser`), add minimal implementations in `store.js` following the existing pattern. For example if `getAllUsers` is missing:

```javascript
// In store.js, in the exports section:
getAllUsers: () => Array.from(users.values()),
```

Repeat for each missing method. The store uses `Map` instances — use `.values()` to iterate and `.set(id, obj)` to update.

- [ ] **Step 5.3: Mount the router in server.js**

Open `demo_api_server/server.js`. Find the block where admin routes are imported (around line 78-80). Add:

```javascript
const adminAgentToolsRoutes = require('./routes/adminAgentTools');
```

Then find where admin routes are mounted (around line 948-950) and add — **before** the broad `/api/admin` mount:

```javascript
app.use('/api/admin/agent', authenticateToken, adminAgentToolsRoutes);
```

- [ ] **Step 5.4: Smoke test the routes**

Start the API server, then:

```bash
# Login as admin first to get a session cookie, then:
curl -s http://localhost:3001/api/admin/agent/lookup?q=demo \
  -H "Cookie: connect.sid=<your-session-cookie>" | jq .
```

Expected: `{ "users": [...], "count": N }` — no 404 or 500.

- [ ] **Step 5.5: Commit**

```bash
git add demo_api_server/routes/adminAgentTools.js demo_api_server/server.js demo_api_server/data/store.js
git commit -m "feat: add adminAgentTools BFF router with 8 admin agent endpoints"
```

---

## Task 6: Admin MCP Tool Definitions

**Files:**
- Create: `demo_mcp_server/src/tools/adminToolHandlers.ts`
- Modify: `demo_mcp_server/src/tools/BankingToolRegistry.ts`
- Modify: `demo_mcp_server/src/tools/BankingToolProvider.ts`

- [ ] **Step 6.1: Read BankingToolRegistry.ts to understand the BankingAPIClient base URL**

```bash
grep -n "BankingAPIClient\|baseURL\|apiBase\|API_BASE\|localhost:3001" \
  /Users/curtismuir/Development/AI-Demo/demo_mcp_server/src/tools/BankingToolProvider.ts | head -20
grep -n "class BankingAPIClient\|constructor\|baseUrl\|baseURL" \
  /Users/curtismuir/Development/AI-Demo/demo_mcp_server/src/BankingAPIClient.ts 2>/dev/null | head -20
```

Note the method used to call BFF endpoints (e.g. `this.apiClient.get(path, token)` / `this.apiClient.post(path, body, token)`).

- [ ] **Step 6.2: Create adminToolHandlers.ts**

Create `demo_mcp_server/src/tools/adminToolHandlers.ts`:

```typescript
import type { HandlerDeps } from './handlers/types';
import type { BankingToolResult } from './BankingToolProvider';
import { createSuccessResult, createErrorResult } from './handlers/results';

const ok = createSuccessResult;
const err = createErrorResult;

export async function executeLookupCustomer(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const q = encodeURIComponent(params.query || '');
    const data = await deps.apiClient.get(`/api/admin/agent/lookup?q=${q}`, token);
    if (!data.users?.length) return ok('No customers found matching that query.');
    const lines = data.users.map((u: any) =>
      `- ${u.firstName} ${u.lastName} (${u.email}) — ID: ${u.id} — role: ${u.role}`
    );
    return ok(`Found ${data.count} customer(s):\n${lines.join('\n')}`);
  } catch (e: any) {
    return err(`Lookup failed: ${e.message}`);
  }
}

export async function executeGetCustomerProfile(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const data = await deps.apiClient.get(`/api/admin/agent/users/${params.userId}`, token);
    const u = data.user;
    return ok(
      `Profile for ${u.firstName} ${u.lastName}:\n` +
      `  Email: ${u.email}\n` +
      `  Username: ${u.username}\n` +
      `  Role: ${u.role}\n` +
      `  Active: ${u.isActive}\n` +
      `  Password reset required: ${u.passwordResetRequired || false}\n` +
      `  Created: ${u.createdAt}`
    );
  } catch (e: any) {
    return err(`Get profile failed: ${e.message}`);
  }
}

export async function executeGetCustomerAccounts(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const data = await deps.apiClient.get(`/api/admin/agent/users/${params.userId}/accounts`, token);
    if (!data.accounts?.length) return ok('No accounts found for this user.');
    const lines = data.accounts.map((a: any) =>
      `- ${a.name} (${a.accountType}) — Balance: ${a.currency} ${a.balance?.toFixed(2)} — Active: ${a.isActive} — ID: ${a.id}`
    );
    return ok(`${data.count} account(s):\n${lines.join('\n')}`);
  } catch (e: any) {
    return err(`Get accounts failed: ${e.message}`);
  }
}

export async function executeGetCustomerTransactions(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const limit = params.limit || 5;
    const data = await deps.apiClient.get(
      `/api/admin/agent/users/${params.userId}/transactions?limit=${limit}`, token
    );
    if (!data.transactions?.length) return ok('No transactions found for this user.');
    const lines = data.transactions.map((t: any) =>
      `- [${t.createdAt?.slice(0, 10)}] ${t.type} $${t.amount?.toFixed(2)} — ${t.description} (${t.status})`
    );
    return ok(`Last ${data.count} transaction(s):\n${lines.join('\n')}`);
  } catch (e: any) {
    return err(`Get transactions failed: ${e.message}`);
  }
}

export async function executeFreezeAccount(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const data = await deps.apiClient.post(
      `/api/admin/agent/accounts/${params.accountId}/freeze`,
      { freeze: params.freeze },
      token
    );
    const action = params.freeze ? 'frozen' : 'unfrozen';
    return ok(`Account ${data.accountId} has been ${action}. isActive: ${data.isActive}`);
  } catch (e: any) {
    return err(`Freeze account failed: ${e.message}`);
  }
}

export async function executeResetCustomerPassword(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    await deps.apiClient.post(`/api/admin/agent/users/${params.userId}/reset-password`, {}, token);
    return ok(`Password reset flag set for user ${params.userId}. They will be prompted to reset on next login.`);
  } catch (e: any) {
    return err(`Reset password failed: ${e.message}`);
  }
}

export async function executeAdjustBalance(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const data = await deps.apiClient.post(
      `/api/admin/agent/accounts/${params.accountId}/adjust`,
      { amount: params.amount, description: params.description },
      token
    );
    return ok(
      `Balance adjusted for account ${data.accountId}.\n` +
      `New balance: $${data.newBalance?.toFixed(2)}`
    );
  } catch (e: any) {
    return err(`Adjust balance failed: ${e.message}`);
  }
}

export async function executeDeleteCustomer(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    if (params.confirm !== true) {
      return err('confirm must be true to delete a customer. Please confirm this destructive action.');
    }
    await deps.apiClient.delete(`/api/admin/agent/users/${params.userId}`, { confirm: true }, token);
    return ok(`Customer ${params.userId} and all associated data have been deleted.`);
  } catch (e: any) {
    return err(`Delete customer failed: ${e.message}`);
  }
}
```

- [ ] **Step 6.3: Check BankingAPIClient for the delete method signature**

```bash
grep -n "delete\|patch\|post\|get" /Users/curtismuir/Development/AI-Demo/demo_mcp_server/src/BankingAPIClient.ts | head -20
```

If `delete` or `patch` method doesn't exist on `BankingAPIClient`, adjust the handler to use `post` with an appropriate path suffix, or add the method. Check the actual method names and adjust `adminToolHandlers.ts` accordingly.

Similarly check the `patch` call in `executeFreezeAccount` — the BFF route uses `PATCH`, so if `apiClient.patch()` doesn't exist, replace with:

```typescript
const data = await deps.apiClient.post(
  `/api/admin/agent/accounts/${params.accountId}/freeze`,
  { freeze: params.freeze },
  token
);
```

And update the BFF route to `POST` to match.

- [ ] **Step 6.4: Register the 8 tools in BankingToolRegistry.ts**

Open `demo_mcp_server/src/tools/BankingToolRegistry.ts`. After the last existing tool definition (before the closing of the registry array/map), add:

```typescript
{
  name: 'lookup_customer',
  title: 'Look Up Customer',
  description: 'Search for customers by name, email, or username. Returns matching user records.',
  requiresUserAuth: true,
  requiredScopes: ['admin:read', 'users:read'],
  handler: 'executeLookupCustomer',
  readOnly: true,
  annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name, email, or username fragment to search for' }
    },
    required: ['query'],
    additionalProperties: false
  }
},
{
  name: 'get_customer_profile',
  title: 'Get Customer Profile',
  description: 'Retrieve the full profile for a customer by userId.',
  requiresUserAuth: true,
  requiredScopes: ['admin:read', 'users:read'],
  handler: 'executeGetCustomerProfile',
  readOnly: true,
  annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
  inputSchema: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'The user ID to retrieve' }
    },
    required: ['userId'],
    additionalProperties: false
  }
},
{
  name: 'get_customer_accounts',
  title: 'Get Customer Accounts',
  description: 'Retrieve all accounts for a customer by userId.',
  requiresUserAuth: true,
  requiredScopes: ['admin:read', 'users:read'],
  handler: 'executeGetCustomerAccounts',
  readOnly: true,
  annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
  inputSchema: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'The user ID whose accounts to retrieve' }
    },
    required: ['userId'],
    additionalProperties: false
  }
},
{
  name: 'get_customer_transactions',
  title: 'Get Customer Transactions',
  description: 'Retrieve the last N transactions for a customer. Defaults to 5.',
  requiresUserAuth: true,
  requiredScopes: ['admin:read', 'users:read'],
  handler: 'executeGetCustomerTransactions',
  readOnly: true,
  annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
  inputSchema: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'The user ID' },
      limit:  { type: 'number', description: 'Number of transactions to return (default 5, max 50)' }
    },
    required: ['userId'],
    additionalProperties: false
  }
},
{
  name: 'freeze_account',
  title: 'Freeze / Unfreeze Account',
  description: 'Toggle the active status of a customer account. freeze: true disables it.',
  requiresUserAuth: true,
  requiredScopes: ['admin:write', 'users:manage'],
  handler: 'executeFreezeAccount',
  readOnly: false,
  annotations: { userFacing: { readable: false, destructive: true, idempotent: true, openWorld: false } },
  inputSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'string', description: 'The account ID to freeze or unfreeze' },
      freeze:    { type: 'boolean', description: 'true to freeze, false to unfreeze' }
    },
    required: ['accountId', 'freeze'],
    additionalProperties: false
  }
},
{
  name: 'reset_customer_password',
  title: 'Reset Customer Password',
  description: 'Mark a customer account as requiring a password reset. They are prompted on next login.',
  requiresUserAuth: true,
  requiredScopes: ['admin:write', 'users:manage'],
  handler: 'executeResetCustomerPassword',
  readOnly: false,
  annotations: { userFacing: { readable: false, destructive: false, idempotent: true, openWorld: false } },
  inputSchema: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'The user ID to mark for password reset' }
    },
    required: ['userId'],
    additionalProperties: false
  }
},
{
  name: 'adjust_balance',
  title: 'Adjust Account Balance',
  description: 'Add or subtract from an account balance by seeding a transaction. Use positive amount to add, negative to subtract.',
  requiresUserAuth: true,
  requiredScopes: ['admin:write', 'users:manage'],
  handler: 'executeAdjustBalance',
  readOnly: false,
  annotations: { userFacing: { readable: false, destructive: false, idempotent: false, openWorld: false } },
  inputSchema: {
    type: 'object',
    properties: {
      accountId:   { type: 'string', description: 'The account ID to adjust' },
      amount:      { type: 'number', description: 'Amount to add (positive) or subtract (negative)' },
      description: { type: 'string', description: 'Description for the seeded transaction' }
    },
    required: ['accountId', 'amount'],
    additionalProperties: false
  }
},
{
  name: 'delete_customer',
  title: 'Delete Customer',
  description: 'Permanently delete a customer and all their accounts and transactions. Requires confirm: true.',
  requiresUserAuth: true,
  requiredScopes: ['admin:write', 'admin:delete', 'users:manage'],
  handler: 'executeDeleteCustomer',
  readOnly: false,
  annotations: { userFacing: { readable: false, destructive: true, idempotent: false, openWorld: false } },
  inputSchema: {
    type: 'object',
    properties: {
      userId:  { type: 'string', description: 'The user ID to delete' },
      confirm: { type: 'boolean', description: 'Must be true — confirms the destructive action' }
    },
    required: ['userId', 'confirm'],
    additionalProperties: false
  }
},
```

- [ ] **Step 6.5: Wire handlers into BankingToolProvider.ts dispatch map**

Open `demo_mcp_server/src/tools/handlers/index.ts`. This is where `handlerMap` lives. Add the import at the top:

```typescript
import {
  executeLookupCustomer,
  executeGetCustomerProfile,
  executeGetCustomerAccounts,
  executeGetCustomerTransactions,
  executeFreezeAccount,
  executeResetCustomerPassword,
  executeAdjustBalance,
  executeDeleteCustomer,
} from '../adminToolHandlers';
```

Then add the 8 handlers into the existing `handlerMap` object:

```typescript
export const handlerMap: Record<string, HandlerFn> = {
  // ... existing entries ...
  executeLookupCustomer,
  executeGetCustomerProfile,
  executeGetCustomerAccounts,
  executeGetCustomerTransactions,
  executeFreezeAccount,
  executeResetCustomerPassword,
  executeAdjustBalance,
  executeDeleteCustomer,
};
```

- [ ] **Step 6.6: Build the MCP server**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_mcp_server && npm run build 2>&1 | tail -20
```

Expected: exit 0, no TypeScript errors.

- [ ] **Step 6.7: Commit**

```bash
git add demo_mcp_server/src/tools/adminToolHandlers.ts \
        demo_mcp_server/src/tools/BankingToolRegistry.ts \
        demo_mcp_server/src/tools/handlers/index.ts
git commit -m "feat: register 8 admin MCP tools with admin:read/write/delete scope gates"
```

---

## Task 7: Admin Scope Injection in Token Exchange

**Files:**
- Modify: `demo_api_server/services/agentMcpTokenService.js`

- [ ] **Step 7.1: Find where candidate scopes are assembled**

```bash
grep -n "toolCandidateScopes\|candidateScopes\|MCP_TOKEN_EXCHANGE_SCOPES\|scopeTopology\|toolScopes" \
  /Users/curtismuir/Development/AI-Demo/demo_api_server/services/agentMcpTokenService.js | head -20
```

- [ ] **Step 7.2: Find where user role is accessible**

```bash
grep -n "req\.user\|session\.user\|userRole\|role" \
  /Users/curtismuir/Development/AI-Demo/demo_api_server/services/agentMcpTokenService.js | head -20
```

Note how the calling context passes user info into the service — it may be `session.user`, a parameter, or `req.user` if the service is called inside a route handler.

- [ ] **Step 7.3: Inject admin scopes for admin sessions**

In the function that assembles `toolCandidateScopes` (or the equivalent array that becomes the `scope` parameter of the token exchange request), add admin scope injection after the base scopes are built. The exact location depends on Step 7.1 findings, but the pattern to add is:

```javascript
// After base toolCandidateScopes are assembled, before the exchange call:
const userRole = session?.user?.role || req?.user?.role;
if (userRole === 'admin') {
  const adminScopes = ['admin:read', 'admin:write', 'admin:delete', 'users:read', 'users:manage'];
  adminScopes.forEach((s) => {
    if (!toolCandidateScopes.includes(s)) toolCandidateScopes.push(s);
  });
}
```

Adjust variable names (`session`, `req`, `toolCandidateScopes`) to match the actual variable names found in Step 7.1 and 7.2.

- [ ] **Step 7.4: Restart API server and verify no startup errors**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server && node server.js &
sleep 2 && curl -s http://localhost:3001/api/health | jq .
kill %1
```

Expected: health check returns OK.

- [ ] **Step 7.5: Commit**

```bash
git add demo_api_server/services/agentMcpTokenService.js
git commit -m "feat: inject admin scopes into MCP token exchange for admin sessions"
```

---

## Task 8: UI Build Gate + Final Verification

- [ ] **Step 8.1: Full UI build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: exit 0, `Compiled successfully.`

- [ ] **Step 8.2: MCP server build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_mcp_server && npm run build 2>&1 | tail -10
```

Expected: exit 0, no TypeScript errors.

- [ ] **Step 8.3: Run BFF tests**

```bash
cd /Users/curtismuir/Development/AI-Demo && npm run test:api-server 2>&1 | tail -20
```

Expected: all existing tests pass. If any test breaks due to new routes, investigate — do not add `|| true`.

- [ ] **Step 8.4: Run MCP server tests**

```bash
cd /Users/curtismuir/Development/AI-Demo && npm run test:mcp-server 2>&1 | tail -20
```

Expected: all existing tests pass.

- [ ] **Step 8.5: Final commit**

```bash
git add -A
git status  # confirm only expected files
git commit -m "feat: admin agent — theme, FAB, chips, tools, token exchange complete"
```

---

## Self-Review Checklist

| Spec requirement | Covered by |
|---|---|
| Admin vertical manifest (slate/amber palette) | Task 1 |
| Auto-apply theme on `/admin*` route, restore on exit | Task 2 |
| Does NOT call `PUT /api/config/vertical` | Task 2 — client-side only via `useAdminTheme` |
| FAB visible on all `/admin*` routes | Task 3 |
| Admin chip group (7 chips) | Task 4 |
| 8 BFF admin agent routes | Task 5 |
| store methods verified/added | Task 5 step 5.2 |
| 8 MCP tool definitions with correct scopes | Task 6 |
| Admin tool handlers calling BFF | Task 6 |
| Admin scopes injected in token exchange | Task 7 |
| UI build exit 0 | Task 8 |
| No regressions to existing tests | Task 8 |
