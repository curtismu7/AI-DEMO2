# Delegation Vertical Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/delegation` and `/delegated-access` pages terminology-aware — each page auto-detects the active vertical and adapts all copy (page title, scope labels, grantee label, header gradient) via an explicit `delegation` block in each vertical manifest; a dropdown lets the user override the detected vertical.

**Architecture:** A new optional `delegation` field is added to the Zod manifest schema; all 5 customer manifests get explicit delegation blocks. A new `useDelegationConfig(verticalId)` hook fetches `GET /api/verticals/list` and returns the resolved config. Both UI pages consume the hook and render a vertical selector dropdown. A new `GET /api/delegation/granted-to-me` BFF endpoint (LMDB full scan) powers the "Granted to Me" tab with real data.

**Tech Stack:** React (CRA, CommonJS in BFF / ESM+JSX in UI), Zod, Express, LMDB, Jest + React Testing Library

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_server/services/verticalManifest/schema.js` | Modify | Add `ScopeLabelSchema`, `DelegationSchema`, wire into `ManifestSchema` |
| `demo_api_server/config/verticals/banking/manifest.json` | Modify | Add `delegation` block |
| `demo_api_server/config/verticals/healthcare/manifest.json` | Modify | Add `delegation` block |
| `demo_api_server/config/verticals/retail/manifest.json` | Modify | Add `delegation` block |
| `demo_api_server/config/verticals/sporting-goods/manifest.json` | Modify | Add `delegation` block |
| `demo_api_server/config/verticals/workforce/manifest.json` | Modify | Add `delegation` block |
| `demo_api_server/services/delegationService.js` | Modify | Export `getDelegationsGrantedToMe` |
| `demo_api_server/routes/delegation.js` | Modify | Add `GET /granted-to-me` route before `/:id` |
| `demo_api_ui/src/hooks/useDelegationConfig.js` | Create | Hook: fetches vertical list, returns delegation config + vertical list |
| `demo_api_ui/src/components/DelegationPage.js` | Modify | Vertical selector + adapted copy |
| `demo_api_ui/src/components/DelegatedAccessPage.js` | Modify | Vertical selector + real API wiring for both tabs |

---

## Task 1: Extend the Zod schema

**Files:**
- Modify: `demo_api_server/services/verticalManifest/schema.js`
- Test: `demo_api_server/tests/verticalManifest/schema.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `demo_api_server/tests/verticalManifest/schema.test.js`:

```js
describe('delegation block', () => {
  const withDelegation = {
    ...MIN_VALID,
    delegation: {
      pageTitle: 'Family Delegation',
      pageDescription: 'Grant access',
      granteeLabel: 'family member',
      scopeLabels: {
        view_accounts:     { label: 'View Accounts',    description: 'See accounts' },
        view_balances:     { label: 'View Balances',    description: 'See balances' },
        create_deposit:    { label: 'Make Deposits',    description: 'Deposit funds' },
        create_withdrawal: { label: 'Make Withdrawals', description: 'Withdraw funds' },
        create_transfer:   { label: 'Transfer Funds',   description: 'Transfer funds' },
      },
    },
  };

  test('valid delegation block accepted', () => {
    expect(() => ManifestSchema.parse(withDelegation)).not.toThrow();
  });

  test('delegation block is optional — manifest without it still passes', () => {
    expect(() => ManifestSchema.parse(MIN_VALID)).not.toThrow();
  });

  test('missing pageTitle rejected', () => {
    const bad = JSON.parse(JSON.stringify(withDelegation));
    delete bad.delegation.pageTitle;
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  test('missing scopeLabels.view_accounts rejected', () => {
    const bad = JSON.parse(JSON.stringify(withDelegation));
    delete bad.delegation.scopeLabels.view_accounts;
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  test('scope label missing description rejected', () => {
    const bad = JSON.parse(JSON.stringify(withDelegation));
    delete bad.delegation.scopeLabels.view_accounts.description;
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/schema.test.js --no-coverage
```

Expected: 5 new tests FAIL with `ManifestSchema.parse is not a function` or `delegation` being an unrecognized key.

- [ ] **Step 3: Add the schema**

In `demo_api_server/services/verticalManifest/schema.js`, insert after line 11 (after `FormatEnum`) and before the `RenderFieldSchema`:

```js
const ScopeLabelSchema = z.object({
  label: z.string(),
  description: z.string(),
});

const DelegationSchema = z.object({
  pageTitle: z.string(),
  pageDescription: z.string(),
  granteeLabel: z.string(),
  scopeLabels: z.object({
    view_accounts:     ScopeLabelSchema,
    view_balances:     ScopeLabelSchema,
    create_deposit:    ScopeLabelSchema,
    create_withdrawal: ScopeLabelSchema,
    create_transfer:   ScopeLabelSchema,
  }),
}).optional();
```

Then in `ManifestSchema`, add `delegation: DelegationSchema` after the `scopes` field (around line 93):

```js
  scopes: z.object({
    read: z.string().default('read'),
    write: z.string().default('write'),
    transfer: z.string().default('transfer'),
    featureScope: z.string().optional(),
  }).optional().default({}),

  delegation: DelegationSchema,   // ← add this line

  featurePage: z.object({
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/schema.test.js --no-coverage
```

Expected: all tests including the 5 new ones PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/schema.js \
        demo_api_server/tests/verticalManifest/schema.test.js
git commit -m "feat(schema): add optional delegation block to vertical manifest schema"
```

---

## Task 2: Add delegation blocks to all 5 manifests

**Files:**
- Modify: `demo_api_server/config/verticals/banking/manifest.json`
- Modify: `demo_api_server/config/verticals/healthcare/manifest.json`
- Modify: `demo_api_server/config/verticals/retail/manifest.json`
- Modify: `demo_api_server/config/verticals/sporting-goods/manifest.json`
- Modify: `demo_api_server/config/verticals/workforce/manifest.json`

- [ ] **Step 1: Add banking delegation block**

In `demo_api_server/config/verticals/banking/manifest.json`, add after the `scopes` block:

```json
  "delegation": {
    "pageTitle": "Family Delegation",
    "pageDescription": "Grant family members scoped access to your accounts — powered by RFC 8693 token exchange and PingOne",
    "granteeLabel": "family member",
    "scopeLabels": {
      "view_accounts":     { "label": "View Accounts",    "description": "See account list and details" },
      "view_balances":     { "label": "View Balances",    "description": "See account balances" },
      "create_deposit":    { "label": "Make Deposits",    "description": "Deposit funds into accounts" },
      "create_withdrawal": { "label": "Make Withdrawals", "description": "Withdraw funds from accounts" },
      "create_transfer":   { "label": "Transfer Funds",   "description": "Transfer between accounts" }
    }
  },
```

- [ ] **Step 2: Add healthcare delegation block**

In `demo_api_server/config/verticals/healthcare/manifest.json`, add after the `scopes` block:

```json
  "delegation": {
    "pageTitle": "Proxy Access",
    "pageDescription": "Authorize a caregiver or family member to access your health records — powered by RFC 8693 token exchange",
    "granteeLabel": "caregiver or family member",
    "scopeLabels": {
      "view_accounts":     { "label": "View Patient Records",  "description": "See record list and details" },
      "view_balances":     { "label": "View Coverage",         "description": "See insurance coverage details" },
      "create_deposit":    { "label": "Schedule Appointments", "description": "Book new appointments" },
      "create_withdrawal": { "label": "Cancel Appointments",   "description": "Cancel existing appointments" },
      "create_transfer":   { "label": "Release Records",       "description": "Authorize records release to providers" }
    }
  },
```

- [ ] **Step 3: Add retail delegation block**

In `demo_api_server/config/verticals/retail/manifest.json`, add after the `scopes` block:

```json
  "delegation": {
    "pageTitle": "Family Account Sharing",
    "pageDescription": "Share your Great Buy account with a family member — powered by RFC 8693 token exchange",
    "granteeLabel": "family member",
    "scopeLabels": {
      "view_accounts":     { "label": "View Account",          "description": "See account details and saved items" },
      "view_balances":     { "label": "View Balance",          "description": "See store credit and rewards balance" },
      "create_deposit":    { "label": "Make Purchases",        "description": "Buy items on this account" },
      "create_withdrawal": { "label": "Process Returns",       "description": "Return or exchange items" },
      "create_transfer":   { "label": "Transfer Store Credit", "description": "Move store credit to another account" }
    }
  },
```

- [ ] **Step 4: Add sporting-goods delegation block**

In `demo_api_server/config/verticals/sporting-goods/manifest.json`, add after the `scopes` block:

```json
  "delegation": {
    "pageTitle": "Share Loyalty Access",
    "pageDescription": "Share your Super Sports loyalty account with a family member or team member",
    "granteeLabel": "family member or team member",
    "scopeLabels": {
      "view_accounts":     { "label": "View Loyalty Accounts", "description": "See loyalty account details" },
      "view_balances":     { "label": "View Reward Points",    "description": "See reward point balances" },
      "create_deposit":    { "label": "Make Purchases",        "description": "Make purchases on the loyalty account" },
      "create_withdrawal": { "label": "Process Returns",       "description": "Return or exchange gear" },
      "create_transfer":   { "label": "Place Team Orders",     "description": "Submit team equipment orders" }
    }
  },
```

- [ ] **Step 5: Add workforce delegation block**

In `demo_api_server/config/verticals/workforce/manifest.json`, add after the `scopes` block:

```json
  "delegation": {
    "pageTitle": "Delegate Access",
    "pageDescription": "Delegate workspace access to a colleague or team member",
    "granteeLabel": "colleague or delegate",
    "scopeLabels": {
      "view_accounts":     { "label": "View Accounts",    "description": "See workspace accounts and budgets" },
      "view_balances":     { "label": "View Balance",     "description": "See available budget and allowances" },
      "create_deposit":    { "label": "Submit Requests",  "description": "Submit time-off or expense requests" },
      "create_withdrawal": { "label": "Cancel Requests",  "description": "Cancel pending requests" },
      "create_transfer":   { "label": "Approve Expenses", "description": "Approve high-value expense reports" }
    }
  },
```

- [ ] **Step 6: Validate all 5 manifests**

```bash
cd demo_api_server && node -e "
const { verticalManifest: V } = require('./services/verticalManifest');
V.init();
['banking','healthcare','retail','sporting-goods','workforce'].forEach(id => {
  const entry = V.loader.get(id);
  if (!entry) { console.log('❌ ' + id + ' NOT FOUND'); process.exit(1); }
  const del = entry.manifest.delegation;
  if (!del) { console.log('❌ ' + id + ' missing delegation block'); process.exit(1); }
  console.log('✅ ' + id + ' — ' + del.pageTitle);
});
"
```

Expected output:
```
✅ banking — Family Delegation
✅ healthcare — Proxy Access
✅ retail — Family Account Sharing
✅ sporting-goods — Share Loyalty Access
✅ workforce — Delegate Access
```

- [ ] **Step 7: Run schema tests to confirm nothing regressed**

```bash
cd demo_api_server && npx jest tests/verticalManifest/schema.test.js --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/config/verticals/banking/manifest.json \
        demo_api_server/config/verticals/healthcare/manifest.json \
        demo_api_server/config/verticals/retail/manifest.json \
        demo_api_server/config/verticals/sporting-goods/manifest.json \
        demo_api_server/config/verticals/workforce/manifest.json
git commit -m "feat(manifests): add delegation blocks to all 5 customer vertical manifests"
```

---

## Task 3: BFF — new service function and route

**Files:**
- Modify: `demo_api_server/services/delegationService.js`
- Modify: `demo_api_server/routes/delegation.js`
- Test: `demo_api_server/tests/delegationGrantedToMe.regression.test.js` (create)

- [ ] **Step 1: Write the failing regression test**

Create `demo_api_server/tests/delegationGrantedToMe.regression.test.js`:

```js
'use strict';

jest.mock('../services/lmdb/openEnv', () => {
  const records = new Map();
  return {
    getDb: () => ({
      putSync: (k, v) => records.set(k, v),
      getRange: () => [...records.values()].map(value => ({ value })),
    }),
  };
});

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');

// Must require AFTER mocks
const delegationRouter = require('../routes/delegation');
const { getDelegationsGrantedToMe } = require('../services/delegationService');

function makeApp(userId, email) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: userId, email }; next(); });
  app.use('/api/delegation', delegationRouter);
  return app;
}

describe('GET /api/delegation/granted-to-me', () => {
  beforeEach(() => {
    // Seed the mock DB via the service
    const { grantDelegation } = require('../services/delegationService');
    // Seed directly via delegationService internals won't work with the mock —
    // use the LMDB mock's putSync via the module-level records Map
    // Instead, seed by calling the internal helper via __setTestRecord if we add it,
    // OR use the route's POST endpoint with a separate user session.
    // Simplest: seed via the route
  });

  test('returns 200 with active delegations where user is delegate', async () => {
    // Seed: user alice grants to bob@example.com
    const aliceApp = makeApp('alice-id', 'alice@example.com');
    await request(aliceApp)
      .post('/api/delegation')
      .send({ delegateEmail: 'bob@example.com', scopes: ['view_accounts'] });

    // Bob queries his granted-to-me
    const bobApp = makeApp('bob-id', 'bob@example.com');
    const res = await request(bobApp).get('/api/delegation/granted-to-me');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.delegations)).toBe(true);
    expect(res.body.delegations).toHaveLength(1);
    expect(res.body.delegations[0].delegator_user_id).toBe('alice-id');
    expect(res.body.delegations[0].scopes).toEqual(['view_accounts']);
  });

  test('returns empty array when user has no incoming delegations', async () => {
    const app = makeApp('nobody-id', 'nobody@example.com');
    const res = await request(app).get('/api/delegation/granted-to-me');
    expect(res.status).toBe(200);
    expect(res.body.delegations).toHaveLength(0);
  });

  test('does not return revoked delegations', async () => {
    const aliceApp = makeApp('alice2-id', 'alice2@example.com');
    const grantRes = await request(aliceApp)
      .post('/api/delegation')
      .send({ delegateEmail: 'carol@example.com', scopes: ['view_balances'] });
    const id = grantRes.body.delegation?.id;

    // Revoke it
    if (id) await request(aliceApp).delete(`/api/delegation/${id}`);

    const carolApp = makeApp('carol-id', 'carol@example.com');
    const res = await request(carolApp).get('/api/delegation/granted-to-me');
    expect(res.body.delegations).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd demo_api_server && npx jest tests/delegationGrantedToMe.regression.test.js --no-coverage
```

Expected: FAIL — `getDelegationsGrantedToMe is not a function` and/or route 404.

- [ ] **Step 3: Add service function**

In `demo_api_server/services/delegationService.js`, add this export after `getDelegationHistory`:

```js
async function getDelegationsGrantedToMe(delegateEmail) {
  const normalised = delegateEmail.toLowerCase();
  const results = [];
  for (const { value } of _db().getRange()) {
    const rec = toRecord(value);
    if (rec && rec.delegate_email === normalised && rec.status === 'active') {
      results.push(rec);
    }
  }
  return results.sort((a, b) => b.granted_at.localeCompare(a.granted_at));
}
```

Add to the `module.exports` at the bottom of the file:

```js
  getDelegationsGrantedToMe,
```

- [ ] **Step 4: Add the route**

In `demo_api_server/routes/delegation.js`, add the new route **immediately after the `GET /history` handler** (before `GET /`) so Express doesn't match `granted-to-me` as an `:id`:

```js
// GET /api/delegation/granted-to-me — delegations where I am the delegate
router.get('/granted-to-me', async (req, res) => {
  try {
    const email = req.user.email || req.user.username || '';
    const delegations = await getDelegationsGrantedToMe(email);
    res.json({ ok: true, delegations });
  } catch (err) {
    console.error('[delegation] GET /granted-to-me error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
```

Update the `require` at the top of the route file to include the new export:

```js
const {
  grantDelegation,
  revokeDelegation,
  listDelegations,
  getDelegationHistory,
  getDelegationsGrantedToMe,   // ← add
  listAllDelegations,
  adminRevokeDelegation,
  adminGrantDelegation,
} = require('../services/delegationService');
```

- [ ] **Step 5: Run tests — confirm all pass**

```bash
cd demo_api_server && npx jest tests/delegationGrantedToMe.regression.test.js --no-coverage
```

Expected: all 3 tests PASS.

- [ ] **Step 6: Run full BFF test suite — no regressions**

```bash
cd demo_api_server && npm test -- --no-coverage 2>&1 | tail -20
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/services/delegationService.js \
        demo_api_server/routes/delegation.js \
        demo_api_server/tests/delegationGrantedToMe.regression.test.js
git commit -m "feat(delegation): add getDelegationsGrantedToMe service + GET /granted-to-me route"
```

---

## Task 4: `useDelegationConfig` hook

**Files:**
- Create: `demo_api_ui/src/hooks/useDelegationConfig.js`

The hook fetches `GET /api/verticals/list`, finds the named vertical's `delegation` block, and returns resolved config. Falls back to banking defaults when unauthenticated or when a manifest has no `delegation` block.

- [ ] **Step 1: Create the file**

Create `demo_api_ui/src/hooks/useDelegationConfig.js`:

```js
import { useState, useEffect } from 'react';

export const BANKING_DEFAULTS = {
  pageTitle: 'Family Delegation',
  pageDescription: 'Grant family members scoped access to your accounts — powered by RFC 8693 token exchange and PingOne',
  granteeLabel: 'family member',
  headerGradient: { start: '#1e3a5f', end: '#2563eb' },
  scopeLabels: {
    view_accounts:     { label: 'View Accounts',    description: 'See account list and details' },
    view_balances:     { label: 'View Balances',    description: 'See account balances' },
    create_deposit:    { label: 'Make Deposits',    description: 'Deposit funds into accounts' },
    create_withdrawal: { label: 'Make Withdrawals', description: 'Withdraw funds from accounts' },
    create_transfer:   { label: 'Transfer Funds',   description: 'Transfer between accounts' },
  },
};

function resolveConfig(verticalId, verticals) {
  if (!verticalId || !verticals) return BANKING_DEFAULTS;
  const v = verticals.find(v => v.id === verticalId);
  if (!v || !v.delegation) return BANKING_DEFAULTS;
  const cssVars = v.theme?.cssVars || {};
  return {
    ...v.delegation,
    headerGradient: {
      start: cssVars['--brand-dashboard-header-start'] || BANKING_DEFAULTS.headerGradient.start,
      end:   cssVars['--brand-dashboard-header-end']   || BANKING_DEFAULTS.headerGradient.end,
    },
  };
}

/**
 * Returns delegation display config for the given verticalId.
 * Also returns the full verticals list for populating the selector dropdown.
 *
 * Falls back to banking defaults if verticalId is null, unauthenticated,
 * or the manifest has no delegation block.
 */
export function useDelegationConfig(verticalId) {
  const [verticals, setVerticals] = useState(null);

  useEffect(() => {
    fetch('/api/verticals/list', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => setVerticals(data?.verticals || []))
      .catch(() => setVerticals([]));
  }, []);

  const config = resolveConfig(verticalId, verticals);
  return { ...config, verticals: verticals || [] };
}
```

- [ ] **Step 2: Verify the UI build picks it up**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: build exits 0 (new file is unreferenced yet — no errors).

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/hooks/useDelegationConfig.js
git commit -m "feat(hooks): add useDelegationConfig — fetches vertical delegation config with banking fallback"
```

---

## Task 5: DelegationPage — vertical selector and adapted copy

**Files:**
- Modify: `demo_api_ui/src/components/DelegationPage.js`

The page already imports React hooks. We add `useContext`, import `VerticalContext`, import `useDelegationConfig`, add a `selectedVerticalId` state seeded from the context, and replace all hardcoded strings with config values.

- [ ] **Step 1: Add imports**

At the top of `demo_api_ui/src/components/DelegationPage.js`, change:

```js
import React, { useState, useEffect, useCallback } from 'react';
```

to:

```js
import React, { useState, useEffect, useCallback, useContext } from 'react';
import { VerticalContext } from '../vertical/VerticalProvider';
import { useDelegationConfig } from '../hooks/useDelegationConfig';
```

- [ ] **Step 2: Add the vertical selector style to the `S` object**

Inside the `S` object (the inline-styles map), add:

```js
  selectorBar: {
    padding: '10px 16px',
    background: '#f8fafc',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  selectorLabel: {
    fontSize: 11, fontWeight: 700, color: '#374151',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  selectorSelect: {
    border: '1px solid #d1d5db', borderRadius: 6,
    padding: '5px 10px', fontSize: 13, background: '#fff',
    fontFamily: 'inherit', color: '#111827', cursor: 'pointer',
  },
  selectorHint: { fontSize: 11, color: '#6b7280', fontStyle: 'italic' },
```

- [ ] **Step 3: Wire the selector into the main component**

In the `DelegationPage` component function body, add at the top (after the existing `useState` declarations):

```js
  const vertCtx = useContext(VerticalContext);
  const [selectedVerticalId, setSelectedVerticalId] = useState(null);
  const [autoDetected, setAutoDetected] = useState(true);

  useEffect(() => {
    if (vertCtx?.activeId && autoDetected) {
      setSelectedVerticalId(vertCtx.activeId);
    }
  }, [vertCtx?.activeId, autoDetected]);

  const { pageTitle, pageDescription, granteeLabel, headerGradient, scopeLabels, verticals } =
    useDelegationConfig(selectedVerticalId);

  const handleVerticalChange = (e) => {
    setSelectedVerticalId(e.target.value || null);
    setAutoDetected(false);
  };
```

- [ ] **Step 4: Replace the gradient header**

Find the existing hardcoded gradient `div` at the top of the return (the one with `background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)'`). Replace it with:

```jsx
      <div style={{
        background: `linear-gradient(135deg, ${headerGradient.start} 0%, ${headerGradient.end} 100%)`,
        padding: '28px 24px 20px',
        marginBottom: 0,
        borderRadius: '0 0 0 0',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
            Account Management
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: 0 }}>{pageTitle}</h1>
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, margin: '6px 0 0' }}>
            {pageDescription}
          </p>
        </div>
      </div>
```

- [ ] **Step 5: Add the selector bar between header and content**

Immediately after the closing `</div>` of the gradient header (and before `<div style={S.inner}>`), insert:

```jsx
      {/* Vertical selector */}
      <div style={S.selectorBar}>
        <span style={S.selectorLabel}>Viewing as</span>
        <select
          value={selectedVerticalId || ''}
          onChange={handleVerticalChange}
          style={S.selectorSelect}
          aria-label="Select vertical"
        >
          <option value="">Default (Banking)</option>
          {verticals.map(v => (
            <option key={v.id} value={v.id}>{v.identity?.displayName || v.id}</option>
          ))}
        </select>
        <span style={S.selectorHint}>{autoDetected ? 'auto-detected' : 'manually changed'}</span>
      </div>
```

- [ ] **Step 6: Replace the hardcoded scope list**

Find the `VALID_SCOPES` constant at the top of the file:

```js
const VALID_SCOPES = [
  { key: 'view_accounts',     label: 'View Accounts',    description: 'See account list and details' },
  ...
];
```

Remove it. In its place, derive scopes dynamically inside `DelegationPage` from `scopeLabels`:

```js
  const SCOPE_KEYS = ['view_accounts', 'view_balances', 'create_deposit', 'create_withdrawal', 'create_transfer'];
  const resolvedScopes = SCOPE_KEYS.map(key => ({
    key,
    label: scopeLabels[key]?.label || key,
    description: scopeLabels[key]?.description || '',
  }));
```

Then replace the map call `VALID_SCOPES.map(scope => ...)` in the JSX with `resolvedScopes.map(scope => ...)`.

- [ ] **Step 7: Adapt the "Grant Account Access" card copy**

In the `Grant Account Access` card, replace the hardcoded description with:

```jsx
          <p style={S.muted}>
            Enter a {granteeLabel}'s email to grant them scoped access to your accounts.
            They will receive an email notification and can log in immediately.
          </p>
```

Replace the email placeholder:

```jsx
              placeholder={`${granteeLabel}@example.com`}
```

- [ ] **Step 8: Adapt the active delegates list — scope pills**

Find where active delegate cards render scope pills (the `pillsRow` / `pill` block mapping `d.scopes`). Replace the scope key display with the resolved label:

```jsx
                          <div style={S.pillsRow}>
                            {(d.scopes || []).map(s => (
                              <span key={s} style={S.pill}>
                                {scopeLabels[s]?.label || s.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
```

- [ ] **Step 9: Adapt the history table — Permissions column**

Find the history table's permissions `<td>`. Replace:

```jsx
                            <td style={S.td}>{(h.scopes || []).map(s => s.replace(/_/g, ' ')).join(', ')}</td>
```

with:

```jsx
                            <td style={S.td}>
                              {(h.scopes || []).map(s => (scopeLabels[s]?.label || s.replace(/_/g, ' '))).join(', ')}
                            </td>
```

- [ ] **Step 10: Build and verify**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: exits 0 with no errors.

- [ ] **Step 11: Commit**

```bash
git add demo_api_ui/src/components/DelegationPage.js
git commit -m "feat(ui): DelegationPage — vertical selector + adapted copy via useDelegationConfig"
```

---

## Task 6: DelegatedAccessPage — real API wiring and vertical selector

**Files:**
- Modify: `demo_api_ui/src/components/DelegatedAccessPage.js`
- Test: `demo_api_ui/src/components/__tests__/DelegatedAccessPage.test.js`

The page currently renders hard-coded `DEMO_GRANTED_BY_ME` and `DEMO_GRANTED_TO_ME` arrays. We replace those with real API calls, add the vertical selector, and update existing tests to mock the new fetches.

- [ ] **Step 1: Add imports to DelegatedAccessPage.js**

At the top of `demo_api_ui/src/components/DelegatedAccessPage.js`, change:

```js
import React, { useState, useEffect, useCallback } from 'react';
```

to:

```js
import React, { useState, useEffect, useCallback, useContext } from 'react';
import { VerticalContext } from '../vertical/VerticalProvider';
import { useDelegationConfig } from '../hooks/useDelegationConfig';
```

- [ ] **Step 2: Remove the demo constants**

Remove the three hardcoded blocks at the top of the file:

```js
const DEMO_ACCOUNTS = [ ... ];
const DEMO_GRANTED_BY_ME = [ ... ];
const DEMO_GRANTED_TO_ME = [ ... ];
```

- [ ] **Step 3: Add a `ScopePill` component**

After the `AccountPill` component (around line 100), add:

```js
function ScopePill({ scopeKey, scopeLabels }) {
  const label = scopeLabels?.[scopeKey]?.label || scopeKey.replace(/_/g, ' ');
  return <span className="da-pill da-pill--checking">{label}</span>;
}
```

- [ ] **Step 4: Wire the main component to real API**

In the main `DelegatedAccessPage` component, make the following changes:

**4a — Change `grantedByMe` / `grantedToMe` initialization and add a vertical selector state.** Replace the existing state declarations at lines 590–594:

```js
  // Before (remove these lines):
  const [grantedByMe, setGrantedByMe] = useState(DEMO_GRANTED_BY_ME);
  const [grantedToMe]                 = useState(DEMO_GRANTED_TO_ME);
```

With:

```js
  const vertCtx = useContext(VerticalContext);
  const [selectedVerticalId, setSelectedVerticalId] = useState(null);
  const [autoDetected, setAutoDetected] = useState(true);

  useEffect(() => {
    if (vertCtx?.activeId && autoDetected) setSelectedVerticalId(vertCtx.activeId);
  }, [vertCtx?.activeId, autoDetected]);

  const { scopeLabels, verticals, granteeLabel } = useDelegationConfig(selectedVerticalId);

  const [grantedByMe, setGrantedByMe] = useState([]);
  const [grantedToMe, setGrantedToMe] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError]     = useState('');
```

**4b — Add `loadDelegations` callback.** Add this after the state declarations, replacing the existing `handleSave` and `handleRevoke` functions:

```js
  const loadDelegations = useCallback(async () => {
    setLoadingData(true);
    setDataError('');
    try {
      const [byMeRes, toMeRes] = await Promise.all([
        fetch('/api/delegation',               { credentials: 'include' }),
        fetch('/api/delegation/granted-to-me', { credentials: 'include' }),
      ]);
      if (byMeRes.ok) {
        const d = await byMeRes.json();
        setGrantedByMe(d.delegations || []);
      }
      if (toMeRes.ok) {
        const d = await toMeRes.json();
        setGrantedToMe(d.delegations || []);
      }
    } catch (err) {
      setDataError('Failed to load delegations: ' + err.message);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => { loadDelegations(); }, [loadDelegations]);

  const handleSave = async (data) => {
    try {
      const res = await fetch('/api/delegation', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delegateEmail: data.email, scopes: data.scopes }),
      });
      const json = await res.json();
      if (!json.ok) {
        notifyInfo(json.message || 'Grant failed');
        return;
      }
      setShowAdd(false);
      notifySuccess(`Invitation sent to ${data.email}.`);
      await loadDelegations();
    } catch (err) {
      notifyInfo('Network error: ' + err.message);
    }
  };

  const handleRevoke = async (delegate) => {
    if (!window.confirm(`Revoke access for ${delegate.delegate_email || delegate.name}?`)) return;
    try {
      await fetch(`/api/delegation/${delegate.id}`, { method: 'DELETE', credentials: 'include' });
      notifySuccess(`Access revoked.`);
      await loadDelegations();
    } catch (err) {
      notifyInfo('Revoke failed: ' + err.message);
    }
  };
```

- [ ] **Step 5: Add vertical selector to DelegatedAccessPage JSX**

In the JSX return, add a selector bar immediately after the page heading section and before the tabs. Use the same style as DelegationPage:

```jsx
      {/* Vertical selector */}
      <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Viewing as</span>
        <select
          value={selectedVerticalId || ''}
          onChange={e => { setSelectedVerticalId(e.target.value || null); setAutoDetected(false); }}
          style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 10px', fontSize: 13, background: '#fff', fontFamily: 'inherit', color: '#111827', cursor: 'pointer' }}
          aria-label="Select vertical"
        >
          <option value="">Default (Banking)</option>
          {verticals.map(v => (
            <option key={v.id} value={v.id}>{v.identity?.displayName || v.id}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>{autoDetected ? 'auto-detected' : 'manually changed'}</span>
      </div>
```

- [ ] **Step 6: Replace delegate card rendering in "Access I've Granted" tab**

Find where `DEMO_GRANTED_BY_ME` was mapped to cards. Replace with real `grantedByMe` data, using email for avatar and `ScopePill` for permissions:

```jsx
          {loadingData ? (
            <p className="da-empty">Loading…</p>
          ) : dataError ? (
            <p className="da-empty" style={{ color: '#dc2626' }}>{dataError}</p>
          ) : grantedByMe.length === 0 ? (
            <div className="da-empty">
              <p>No active delegates.</p>
              <p>Use the <strong>+ Add person</strong> button to grant access to a {granteeLabel}.</p>
            </div>
          ) : (
            <ul className="da-list">
              {grantedByMe.map(d => (
                <li key={d.id} className="da-card">
                  <Avatar name={d.delegate_email} />
                  <div className="da-card__body">
                    <div className="da-card__name">{d.delegate_email}</div>
                    <div className="da-card__meta">Since {fmtDate(d.granted_at)}</div>
                    <div className="da-card__pills">
                      {(d.scopes || []).map(s => (
                        <ScopePill key={s} scopeKey={s} scopeLabels={scopeLabels} />
                      ))}
                    </div>
                  </div>
                  <button
                    className="da-card__act-btn"
                    onClick={() => setActAsDelegate(d)}
                    aria-label={`Act as ${d.delegate_email}`}
                  >
                    Act as
                  </button>
                </li>
              ))}
            </ul>
          )}
```

- [ ] **Step 7: Replace card rendering in "Granted to Me" tab**

Find where `DEMO_GRANTED_TO_ME` was mapped. Replace with real `grantedToMe` data (records returned by `/granted-to-me` have `delegator_email`, `scopes`, `granted_at`):

```jsx
          {loadingData ? (
            <p className="da-empty">Loading…</p>
          ) : grantedToMe.length === 0 ? (
            <div className="da-empty">
              <p>No one has granted you access yet.</p>
            </div>
          ) : (
            <ul className="da-list">
              {grantedToMe.map(d => (
                <li key={d.id} className="da-card">
                  <Avatar name={d.delegator_email} />
                  <div className="da-card__body">
                    <div className="da-card__name">{d.delegator_email}</div>
                    <div className="da-card__meta">Granted since {fmtDate(d.granted_at)}</div>
                    <div className="da-card__pills">
                      {(d.scopes || []).map(s => (
                        <ScopePill key={s} scopeKey={s} scopeLabels={scopeLabels} />
                      ))}
                    </div>
                  </div>
                  <button
                    className="da-card__act-btn"
                    onClick={() => setActAsDelegate(d)}
                    aria-label={`Act as delegate for ${d.delegator_email}`}
                  >
                    Act as
                  </button>
                </li>
              ))}
            </ul>
          )}
```

- [ ] **Step 8: Update existing DelegatedAccessPage tests to mock the new API calls**

In `demo_api_ui/src/components/__tests__/DelegatedAccessPage.test.js`, the existing `renderPage` helper renders the page. Add a `global.fetch` mock at the top of the file's `beforeEach` in the `DelegatedAccessPage` describe block that covers the new data fetches:

```js
const MOCK_DELEGATIONS_BY_ME = [
  { id: 'd1', delegate_email: 'sarah@example.com', scopes: ['view_accounts', 'view_balances'], status: 'active', granted_at: '2025-11-14T00:00:00Z' },
  { id: 'd2', delegate_email: 'jamie@example.com', scopes: ['view_accounts'], status: 'active', granted_at: '2026-01-03T00:00:00Z' },
];
const MOCK_DELEGATIONS_TO_ME = [
  { id: 'd3', delegator_email: 'harold@example.com', scopes: ['view_accounts', 'view_balances', 'create_deposit'], status: 'active', granted_at: '2025-09-22T00:00:00Z' },
];
```

Then in `describe('DelegatedAccessPage', () => { beforeEach(() => {`, add:

```js
    global.fetch = jest.fn((url) => {
      if (url === '/api/delegation') return Promise.resolve({
        ok: true, json: () => Promise.resolve({ delegations: MOCK_DELEGATIONS_BY_ME }),
      });
      if (url === '/api/delegation/granted-to-me') return Promise.resolve({
        ok: true, json: () => Promise.resolve({ ok: true, delegations: MOCK_DELEGATIONS_TO_ME }),
      });
      if (url === '/api/verticals/list') return Promise.resolve({
        ok: true, json: () => Promise.resolve({ verticals: [] }),
      });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
```

Also add `afterEach(() => { delete global.fetch; });` in the same describe block.

- [ ] **Step 9: Run the UI test suite**

```bash
cd demo_api_ui && npx jest --testPathPattern='DelegatedAccessPage' --no-coverage 2>&1 | tail -20
```

Expected: all existing tests pass (they test the simulator and page structure, which are preserved).

- [ ] **Step 10: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: exits 0.

- [ ] **Step 11: Commit**

```bash
git add demo_api_ui/src/components/DelegatedAccessPage.js \
        demo_api_ui/src/components/__tests__/DelegatedAccessPage.test.js
git commit -m "feat(ui): DelegatedAccessPage — real API wiring, vertical selector, ScopePill"
```

---

## Verification

After all tasks are committed, run the full verification suite:

```bash
# 1. All manifests validate and delegation blocks resolve
cd demo_api_server && node -e "
const { verticalManifest: V } = require('./services/verticalManifest');
V.init();
['banking','healthcare','retail','sporting-goods','workforce'].forEach(id => {
  const { manifest } = V.loader.get(id);
  const del = manifest.delegation;
  console.log(del ? '✅ ' + id + ' — ' + del.pageTitle : '❌ ' + id + ' missing delegation');
});
"

# 2. Full BFF test suite
cd demo_api_server && npm test -- --no-coverage 2>&1 | tail -5

# 3. UI build
cd demo_api_ui && npm run build 2>&1 | tail -5

# 4. UI tests
cd demo_api_ui && npx jest --testPathPattern='DelegatedAccessPage|useDelegationConfig' --no-coverage 2>&1 | tail -10
```

All must pass before the feature is considered done.
