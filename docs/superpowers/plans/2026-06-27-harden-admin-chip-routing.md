# Harden Admin Chip Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile `overlay: 'admin'` marker convention with a derived admin-action set, and add a regression test suite for admin chips routing correctly when banking is the active vertical.

**Architecture:** Two independent changes. Task 1 removes the manual `overlay: 'admin'` fields from `admin/index.js` and replaces the marker check in `nlIntentParser.js` with a `Set` of admin tool names derived from `adminPlugin.getTools()` — a set that is authoritative by construction and can never fall out of sync. Task 2 adds a new `describe` block to the existing `nlIntentParser.chipFull.test.js` covering every admin chip message against `vertical: 'banking'` with `isAdmin: true`.

**Tech Stack:** Node.js/Jest; files are plain CJS modules.

## Global Constraints

- Never use `git add -A`; stage explicit files only.
- All test commands run from `/Users/cmuir/Development/AI-DEMO2/demo_api_server`.
- Work branch: `worktree-fix-admin-chip-heuristics` (the active worktree at `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/fix-admin-chip-heuristics`).
- Do not change any test that was already passing before this work started.

---

## File Map

| File | Change |
|------|--------|
| `demo_api_server/config/verticals/admin/index.js` | Remove all `overlay: 'admin'` fields from `HEURISTICS` entries |
| `demo_api_server/services/nlIntentParser.js` | Replace `h.overlay === 'admin'` guard with `adminToolNames.has(h.action)` |
| `demo_api_server/services/verticalDispatch.js` | No change needed (heuristics already prepended in prior fix) |
| `demo_api_server/src/__tests__/nlIntentParser.chipFull.test.js` | Add new `describe` block: "admin chips via banking vertical (isAdmin)" |

---

## Task 1: Replace `overlay` marker with derived admin-action set

**Files:**
- Modify: `demo_api_server/config/verticals/admin/index.js`
- Modify: `demo_api_server/services/nlIntentParser.js:663-673`

**Context:** Right now every heuristic entry in `HEURISTICS` carries `overlay: 'admin'`. The `nlIntentParser.js` plugin-dispatch block checks `h.overlay === 'admin'` to decide whether to return `kind: 'vertical'` instead of `kind: 'banking'`. If anyone adds a new admin heuristic and forgets the field, it silently routes wrong. The fix: derive the set of admin tool names once from `adminPlugin.getTools()` and check `h.action` against that set — the tool list is already the canonical source of truth for admin actions (the plugin contract already cross-checks heuristic actions against it).

**Interfaces:**
- Consumes: `adminPlugin.getTools()` → `Array<{ name: string, ... }>` (already exported by `admin/index.js`)
- Produces: no new exports; behaviour change only inside `parseHeuristic`

- [ ] **Step 1: Remove `overlay: 'admin'` from all HEURISTICS entries**

  Open `demo_api_server/config/verticals/admin/index.js`. The current `HEURISTICS` array looks like:

  ```js
  const HEURISTICS = [
    { re: /.../, action: 'lookup_customer', overlay: 'admin' },
    { re: /.../, action: 'delete_customer', overlay: 'admin' },
    { re: /.../, action: 'freeze_account', overlay: 'admin' },
    { re: /.../, action: 'adjust_balance', overlay: 'admin' },
    { re: /.../, action: 'reset_customer_password', overlay: 'admin' },
    { re: /.../, action: 'get_customer_transactions', overlay: 'admin' },
    { re: /.../, action: 'get_customer_accounts', overlay: 'admin' },
    { re: /.../, action: 'get_customer_profile', overlay: 'admin' },
  ];
  ```

  Remove every `, overlay: 'admin'` field. Also remove or update the comment above `HEURISTICS` that mentions the marker. The result should look like:

  ```js
  const HEURISTICS = [
    // "look up" (two words), "lookup", "search", "find" + customer/user/account; "who is"
    { re: /\blook\s+up\b.*\b(customer|user|account)\b|\b(lookup|search|find)\s+(customer|user|account)\b|\bfind\s+user\b|\bwho\s*(is|are)\b/, action: 'lookup_customer' },
    // delete/remove a customer/user — destructive, must precede the generic profile/account patterns
    { re: /\b(delete|remove|purge)\b.{0,20}\b(customer|user|account)\b/, action: 'delete_customer' },
    // freeze/suspend/lock with optional filler words ("suspend the user", "freeze the account")
    { re: /\b(freeze|lock|disable|unfreeze|unlock|enable|suspend)\b.{0,20}\b(account|customer|user)\b/, action: 'freeze_account' },
    // adjust/change a balance
    { re: /\badjust\s+(balance|account)\b|\bchange\s+balance\b/, action: 'adjust_balance' },
    // reset/force a password reset
    { re: /\b(reset|change|force)\s*(a\s+)?(password|pwd)\b|\bforce.*password.*reset\b/, action: 'reset_customer_password' },
    // transactions for a customer — "for this customer" / "for this user" disambiguates from banking self-transactions
    { re: /\b(transactions?|payment\s+history|recent\s+activity)\b.*\bfor\s+(this\s+)?(customer|user)\b|\bfor\s+(this\s+)?(customer|user)\b.*\b(transactions?|payment\s+history)\b/, action: 'get_customer_transactions' },
    // accounts for a customer
    { re: /\b(view|show|get|list)\s+(?:(?:customer|user|their?|the|a)\s+)?accounts?\b|\baccounts?\s+for\b/, action: 'get_customer_accounts' },
    // profile / account details (generic — keep last); "full" modifier for chip message "show full profile for this customer"
    { re: /\b(view|show|get)\s+(?:(?:full|customer|user|their?|the|a)\s+)*profile\b|\b(customer|user).*profile\b|\bprofile\s*(information|details)\b|\baccount\s+details\b/, action: 'get_customer_profile' },
  ];
  ```

- [ ] **Step 2: Update `nlIntentParser.js` to derive admin action names from `getTools()`**

  Open `demo_api_server/services/nlIntentParser.js`. Find the block inside the plugin-dispatch `for` loop that currently reads (around line 663):

  ```js
        // Banking vertical uses the kind:'banking' contract expected by all consumers.
        // Only include params when non-empty so callers can test params === undefined.
        // Admin overlay heuristics (h.overlay === 'admin') and delegate_to_specialist
        // must return kind:'vertical' so the UI routes to the correct MCP tool name.
        if (vertical === 'banking' && h.action !== 'delegate_to_specialist' && h.overlay !== 'admin') {
          const banking = { action: h.action };
          if (Object.keys(params).length > 0) banking.params = params;
          return { kind: 'banking', banking };
        }
        const returnVertical = h.overlay === 'admin' ? 'admin' : vertical;
        return { kind: 'vertical', vertical: returnVertical, action: h.action, params };
  ```

  Replace it with a version that builds the admin tool name set from the plugin itself:

  ```js
        // Banking vertical uses the kind:'banking' contract expected by all consumers.
        // Only include params when non-empty so callers can test params === undefined.
        // Admin overlay actions and delegate_to_specialist must return kind:'vertical'
        // so the UI routes to the correct MCP tool name. Derive admin action names from
        // the plugin's own tool list — the authoritative source — rather than relying on
        // a manually-set marker field on each heuristic.
        const adminPlugin = verticalDispatch.resolvePlugin('admin');
        const adminToolNames = adminPlugin
          ? new Set(adminPlugin.getTools().map((t) => t.name))
          : new Set();
        const isAdminAction = adminToolNames.has(h.action);
        if (vertical === 'banking' && h.action !== 'delegate_to_specialist' && !isAdminAction) {
          const banking = { action: h.action };
          if (Object.keys(params).length > 0) banking.params = params;
          return { kind: 'banking', banking };
        }
        const returnVertical = isAdminAction ? 'admin' : vertical;
        return { kind: 'vertical', vertical: returnVertical, action: h.action, params };
  ```

  > Note: `verticalDispatch` is already required at the top of the file (`const verticalDispatch = require('./verticalDispatch');`). `resolvePlugin` is already exported from `verticalDispatch.js`.

- [ ] **Step 3: Run the NL intent parser tests to confirm nothing broke**

  ```bash
  cd /Users/cmuir/Development/AI-DEMO2/demo_api_server
  npx jest --forceExit --no-coverage "nlIntentParser|chipFull|pluginRoute"
  ```

  Expected: all suites pass. If any test fails, stop and investigate before continuing.

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/fix-admin-chip-heuristics
  git add demo_api_server/config/verticals/admin/index.js \
          demo_api_server/services/nlIntentParser.js
  git commit -m "refactor(admin-chips): derive admin action set from getTools() instead of overlay marker"
  ```

---

## Task 2: Regression tests — admin chips via banking vertical

**Files:**
- Modify: `demo_api_server/src/__tests__/nlIntentParser.chipFull.test.js`

**Context:** The existing "admin theme chips" describe block at the bottom of the file tests admin heuristics with `vertical: 'admin'` (the standalone admin vertical). It does not cover the scenario that actually broke — an admin user on the banking dashboard (active vertical = `'banking'`, `isAdmin: true`). These tests would have caught the original bug and will catch any future regression.

The eight admin chips from `BankingChips.jsx` send these exact messages:
| Chip label | `message` field |
|---|---|
| Look Up Customer | `'look up a customer'` |
| View Transactions | `'show last 5 transactions for this customer'` |
| View Profile | `'show full profile for this customer'` |
| View Accounts | `'show all accounts for this customer'` |
| Freeze Account | `'freeze this account'` |
| Adjust Balance | `'adjust account balance'` |
| Reset Password | `'reset password for this customer'` |
| Delete Customer | `'delete this customer'` |

Each must route to `kind: 'vertical'`, `vertical: 'admin'`, and the correct `action`.

Also need a guard: the same messages should NOT route as admin actions when `isAdmin` is false.

**Interfaces:**
- Consumes: `parseHeuristic(msg, vertical, verticalCtx, options)` from `../../services/nlIntentParser`
- No new exports

- [ ] **Step 1: Write the failing tests (before Task 1's code change is applied)**

  Open `demo_api_server/src/__tests__/nlIntentParser.chipFull.test.js`. Append a new describe block at the very end of the file (after the retail block), before the closing of the file:

  ```js
  // ── Admin chip messages via banking vertical (isAdmin=true) ──────────────────
  // These are the EXACT messages BankingChips.jsx sends when an admin clicks each
  // chip while the active vertical is 'banking'. Before the fix these all returned
  // kind:'none' ("Could not parse request"). This block is the regression guard.

  describe('nlIntentParser — admin chips via banking vertical (isAdmin=true)', () => {
    function adminViaBank(msg) {
      const r = parseHeuristic(msg, 'banking', null, { isAdmin: true });
      expect(r.kind).toBe('vertical');
      expect(r.vertical).toBe('admin');
      return r;
    }

    it('chip "look up a customer" → lookup_customer', () => {
      expect(adminViaBank('look up a customer').action).toBe('lookup_customer');
    });

    it('chip "show last 5 transactions for this customer" → get_customer_transactions', () => {
      expect(adminViaBank('show last 5 transactions for this customer').action).toBe('get_customer_transactions');
    });

    it('chip "show full profile for this customer" → get_customer_profile', () => {
      expect(adminViaBank('show full profile for this customer').action).toBe('get_customer_profile');
    });

    it('chip "show all accounts for this customer" → get_customer_accounts', () => {
      expect(adminViaBank('show all accounts for this customer').action).toBe('get_customer_accounts');
    });

    it('chip "freeze this account" → freeze_account', () => {
      expect(adminViaBank('freeze this account').action).toBe('freeze_account');
    });

    it('chip "adjust account balance" → adjust_balance', () => {
      expect(adminViaBank('adjust account balance').action).toBe('adjust_balance');
    });

    it('chip "reset password for this customer" → reset_customer_password', () => {
      expect(adminViaBank('reset password for this customer').action).toBe('reset_customer_password');
    });

    it('chip "delete this customer" → delete_customer', () => {
      expect(adminViaBank('delete this customer').action).toBe('delete_customer');
    });

    // Guard: non-admin users must NOT receive admin routing for these messages.
    it('non-admin: "look up a customer" does NOT route as admin', () => {
      const r = parseHeuristic('look up a customer', 'banking', null, { isAdmin: false });
      expect(r.kind).not.toBe('vertical');
    });

    it('non-admin: "show full profile for this customer" does NOT route as admin', () => {
      const r = parseHeuristic('show full profile for this customer', 'banking', null, { isAdmin: false });
      expect(r.kind).not.toBe('vertical');
    });

    // Guard: banking self-service messages still route to banking, not admin.
    it('admin user: "show my accounts" still routes to banking', () => {
      const r = parseHeuristic('show my accounts', 'banking', null, { isAdmin: true });
      expect(r.kind).toBe('banking');
      expect(r.banking.action).toBe('accounts');
    });

    it('admin user: "what is my balance" still routes to banking', () => {
      const r = parseHeuristic('what is my balance', 'banking', null, { isAdmin: true });
      expect(r.kind).toBe('banking');
      expect(r.banking.action).toBe('balance');
    });
  });
  ```

- [ ] **Step 2: Run the tests — expect the 8 admin-routing tests to pass, guards to pass**

  ```bash
  cd /Users/cmuir/Development/AI-DEMO2/demo_api_server
  npx jest --forceExit --no-coverage "nlIntentParser.chipFull"
  ```

  Expected: all tests in the file pass (the routing fix was already committed in the prior step; these tests should all be green now). If any fail, investigate before continuing.

- [ ] **Step 3: Run the full NL suite to catch any cross-suite regression**

  ```bash
  cd /Users/cmuir/Development/AI-DEMO2/demo_api_server
  npx jest --forceExit --no-coverage "nlIntentParser|chipFull|pluginRoute|verticalRouting"
  ```

  Expected: all suites pass.

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/fix-admin-chip-heuristics
  git add demo_api_server/src/__tests__/nlIntentParser.chipFull.test.js
  git commit -m "test(admin-chips): regression suite for admin chip routing via banking vertical"
  ```

---

## Self-Review

**Spec coverage:**
- Remove fragile marker → Task 1 ✓
- Add regression tests for all 8 chip messages → Task 2 ✓
- Non-admin guard test → Task 2, step 1 ✓
- Banking-still-works guard test → Task 2, step 1 ✓

**Placeholder scan:** No TBDs, no "similar to Task N" references, all code shown in full.

**Type consistency:** `parseHeuristic(msg, vertical, verticalCtx, options)` signature used consistently across both tasks. `adminPlugin.getTools()` returns `Array<{ name: string, ... }>` — `t.name` is used in Task 1 step 2 correctly.
