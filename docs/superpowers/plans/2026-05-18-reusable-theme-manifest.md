# Reusable Theme Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one Theme Manifest per vertical the single source of truth for all theme-varying presentation, with banking as the first consumer and Best Buy retail as the first non-default theme, without touching the AI/OAuth/MCP pipeline.

**Architecture:** A v2 JSON manifest at `banking_api_server/config/verticals/<id>.json` carries identity strings, CSS vars, terminology, agent persona/greeting, and dashboard config. The server serves the active manifest via the existing `/api/config/vertical` route. A single client `ThemeProvider`/`useTheme()` replaces `VerticalContext` + `IndustryBrandingContext`. Components that hardcode banking strings read the manifest instead. A `<ThemePicker>` (toolbar + config variants) lets users switch the server-wide active theme.

**Tech Stack:** Node/Express (CommonJS) BFF, React 18 (CRA, ES modules in `.js`), Jest + React Testing Library, Playwright (chip pipeline e2e).

**Data-scope note (decided 2026-05-18):** Phase 1 is presentation-only. Real tool data is **intentionally NOT themed**: `banking_api_server/data/store.js` LMDB-backed accounts/transactions still return `"Checking"/"Savings"/"Deposit"`, and `banking_mortgage_service/mortgageServer.js` (api_key disposition via `show_mortgage`) still returns the hardcoded `$425,000 / 6.125%` mortgage payload. Under Best Buy the agent's tool calls return banking data; the retail experience is carried by `<RetailDashboard>`'s manifest mock data + chip labels + greeting. Relabeling returned data / real retail responses is the **Phase 2 boundary** — do not touch `store.js`, the mortgage service, the gateway, or MCP in this plan.

**TASK 17 DESCOPED (decided 2026-05-19, user-approved):** The original
Task 17 (delete `IndustryBrandingContext`/`VerticalContext` shims +
`industryPresets.js` + `VerticalSwitcher`, migrating all consumers to
`useTheme()`) requires touching **18 non-test files** (login, nav, footer,
dashboard, agent, modals). The shims already correctly delegate to
`useTheme()` — deletion is pure cosmetic churn with zero functional benefit
and real regression risk across core surfaces, and the plan's success
criteria are already met without it. Task 17 is descoped to: **verify the
shims correctly delegate + mark them an intentional permanent compatibility
layer** (header comment changed from "removed in cleanup task" to
"permanent compatibility layer"). The 18-file migration is NOT done. The
single-source-of-truth goal is achieved: all theme state flows from the one
`ThemeContext`; the shims are thin pass-throughs to it.

**PLAN DEFECT + CORRECTION (discovered 2026-05-19 during Task 5 execution):**
The plan's research **missed** that `banking_api_ui/src/context/ThemeContext.js`
**already exists** as the light/dark-mode switcher, is mounted as
`<ThemeProvider>` at the ROOT in `banking_api_ui/src/index.js:45`, and is
consumed by 10+ files (`{ theme, toggleTheme, agentAppearance, ... }`).
Corrections applied during execution:
- **Task 5 (done):** `ThemeContext.js` was **merged** (light/dark API fully
  preserved + manifest API added), NOT created fresh. Verified merge-safe:
  all old fields retained, 7 consumers sampled OK, 7 tests pass. Commit
  `2635bed4`.
- **Task 6 (corrected):** Do **NOT** add a second `<ThemeProvider>` in
  `App.js` — one is already mounted at root in `index.js`. Instead, in
  `App.js` **remove** the `<IndustryBrandingProvider>`/`<VerticalProvider>`
  wrappers (lines ~1465-1469) and make `IndustryBrandingContext`/
  `VerticalContext` shims re-exporting from the already-root-mounted
  `useTheme()`. Net effect = the plan's intended single context, achieved by
  deletion of the redundant wrappers rather than adding a provider.
- **Tasks 7/9 (note):** `BankingAgent.js` already imports `useTheme` from
  `ThemeContext` for light/dark — when adding manifest reads, extend the
  existing import/destructure; do not add a duplicate import.

**Ground-truth note (verified 2026-05-18):** Phase 225's retail dashboard is **not wired** — `RetailModeBanner.js` and `retailMockData.js` are orphan files referenced by nothing; `UserDashboard.js`/`BankingAgent.js` contain no `ff_retail_mode`/`RETAIL_`/dashboard-`isRetail` code. The only retail coupling is one `isRetail` ternary at `BankingAgent.js:1555`. There is no `ff_retail_mode` server feature flag in `routes/featureFlags.js` to retire. Therefore `<RetailDashboard>` is **built new** (from `retailMockData.js`'s data shape), and "retire ff_retail_mode" is **orphan-file deletion**, not surgical removal.

---

## File Structure

**Server (`banking_api_server/`):**
- `config/verticals/banking.json` — migrate to schemaVersion 2 (default + fallback + real consumer)
- `config/verticals/retail.json` — migrate to schemaVersion 2 (Best Buy identity/colors/strings)
- `services/verticalConfigService.js` — add `getActiveManifest()` + schema validation in `loadVerticals()`
- `routes/verticalConfig.js` — no logic change (PUT is already auth-only, not admin-only); add a clarifying comment
- `src/__tests__/verticalConfigService.test.js` — **new** unit tests (manifest load, validation, fallback)

**Client (`banking_api_ui/src/`):**
- `context/ThemeContext.js` — **new** `ThemeProvider` + `useTheme()` (replaces both contexts)
- `context/IndustryBrandingContext.js` — becomes a thin shim re-exporting from `useTheme()`
- `context/VerticalContext.js` — becomes a thin shim re-exporting from `useTheme()`
- `App.js` — swap provider tree to `ThemeProvider`
- `components/DashboardHeader.js` — title/logo alt from `useTheme().identity`
- `components/BankingAgent.js` — greeting from `useTheme().agent`; remove `industryPresetId`/`isRetail` ternary
- `components/BankingChips.jsx` — `HEURISTIC_CHIPS` labels overlaid from `useTheme().dashboard.chips` (keys unchanged)
- `components/UserDashboard.js` — branch on `useTheme().dashboard.kind`; mount `<ThemePicker variant="toolbar" />`
- `components/RetailDashboard.js` + `.css` — **new** product/cart/orders UI
- `components/ThemePicker.js` + `.css` — **new** theme switcher (toolbar + config variants)
- `components/Config.js` — replace industry-preset picker block with `<ThemePicker variant="config" />`
- `public/index.html` — neutral `<title>`; runtime title set by `ThemeProvider`
- Deleted: `config/retailMockData.js`, `components/RetailModeBanner.js`, `components/RetailModeBanner.css`
- `components/__tests__/ThemeContext.test.js`, `components/__tests__/ThemePicker.test.js`, `components/__tests__/RetailDashboard.test.js` — **new**

**Docs:**
- `REGRESSION_PLAN.md` — §1 theme-contract row + §4 bug-fix log (only if a defect is fixed en route)

---

## Task 1: v2 manifest schema — banking.json

**Files:**
- Modify: `banking_api_server/config/verticals/banking.json`

- [ ] **Step 1: Rewrite banking.json to schemaVersion 2**

Replace the entire file with (cssVars transcribed from the current effective `:root` `--brand-navy`/`--app-primary-red` family + `bx_finance` preset so banking renders unchanged):

```json
{
  "id": "banking",
  "schemaVersion": 2,
  "identity": {
    "displayName": "Super Banking",
    "headerTitle": "Super Banking",
    "documentTitle": "Super Banking · PingOne AI IAM Core",
    "logoAlt": "Super Banking logo",
    "tagline": "AI-Powered Banking Demo",
    "logoPath": "/super-bank-icon.png"
  },
  "theme": {
    "cssVars": {
      "--app-primary-red": "#b91c1c",
      "--app-primary-red-hover": "#991b1b",
      "--app-primary-red-mid": "#dc2626",
      "--app-primary-red-border": "#7f1d1d",
      "--brand-dashboard-header-start": "#1d4ed8",
      "--brand-dashboard-header-end": "#1d4ed8",
      "--brand-app-shell-hero-start": "#1d4ed8",
      "--brand-app-shell-hero-end": "#1d4ed8",
      "--theme-accent": "#2563eb"
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
    "agent": "Banking Agent",
    "dashboard": "Dashboard",
    "highValueAction": "Transfer",
    "highValueLabel": "High-value transfer"
  },
  "agent": {
    "persona": "Banking Agent",
    "greeting": "Hi {name}! I can check your balances, move money between accounts, and explain the OAuth flows happening behind the scenes. What would you like to do?",
    "systemPromptFlavor": ""
  },
  "dashboard": {
    "kind": "banking",
    "chips": [
      { "key": "balance", "label": "Check Balance" },
      { "key": "accounts", "label": "My Accounts" },
      { "key": "transactions", "label": "Transactions" },
      { "key": "transfer", "label": "Transfer Funds" }
    ],
    "mockData": null
  },
  "scopes": {
    "read": "banking:read",
    "write": "banking:write",
    "transfer": "banking:transfer",
    "admin": "banking:admin"
  },
  "demoUsers": {
    "customer": { "hint": "bankuser", "passwordHint": "Tigers7&" },
    "admin": { "hint": "bankadmin", "passwordHint": "Tigers7&" }
  }
}
```

Note: `scopes`/`demoUsers` are retained verbatim (spec Section 2 constraint — out of the theme contract but the file still holds them for existing consumers). `{name}` is a literal placeholder the client substitutes.

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('banking_api_server/config/verticals/banking.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add banking_api_server/config/verticals/banking.json
git commit -m "feat(theme): banking.json v2 manifest schema"
```

---

## Task 2: v2 manifest schema — retail.json (Best Buy)

**Files:**
- Modify: `banking_api_server/config/verticals/retail.json`

- [ ] **Step 1: Rewrite retail.json to schemaVersion 2 with Best Buy identity**

`mockData` is transcribed from the to-be-deleted `retailMockData.js` so no data is lost:

```json
{
  "id": "retail",
  "schemaVersion": 2,
  "identity": {
    "displayName": "Best Buy",
    "headerTitle": "Best Buy",
    "documentTitle": "Best Buy · PingOne AI IAM Core",
    "logoAlt": "Best Buy logo",
    "tagline": "AI-Powered Retail Demo",
    "logoPath": "/super-bank-icon.png"
  },
  "theme": {
    "cssVars": {
      "--app-primary-red": "#0046BE",
      "--app-primary-red-hover": "#003a9e",
      "--app-primary-red-mid": "#1a5fd0",
      "--app-primary-red-border": "#002d7a",
      "--brand-dashboard-header-start": "#0046BE",
      "--brand-dashboard-header-end": "#0046BE",
      "--brand-app-shell-hero-start": "#0046BE",
      "--brand-app-shell-hero-end": "#0046BE",
      "--theme-accent": "#FFE000"
    }
  },
  "terminology": {
    "account": "Account",
    "accounts": "Accounts",
    "accountTypes": ["Rewards Points", "Store Credit", "Gift Card"],
    "transaction": "Activity",
    "transactions": "Activity",
    "transactionTypes": ["Purchase", "Return", "Refund", "Points Redemption"],
    "balance": "Balance",
    "agent": "Shopping Assistant",
    "dashboard": "My Account",
    "highValueAction": "Large Purchase",
    "highValueLabel": "High-value purchase"
  },
  "agent": {
    "persona": "Shopping Assistant",
    "greeting": "Hi {name}! I can browse products, check prices, help with your cart, and explain the OAuth flows securing your checkout. What would you like to do?",
    "systemPromptFlavor": "You are a Best Buy shopping assistant. The underlying tools are banking demo tools; keep responses retail-flavored."
  },
  "dashboard": {
    "kind": "retail",
    "chips": [
      { "key": "balance", "label": "Rewards Points" },
      { "key": "accounts", "label": "My Orders" },
      { "key": "transactions", "label": "Purchase History" },
      { "key": "transfer", "label": "Checkout" }
    ],
    "mockData": {
      "products": [
        { "id": "p1",  "sku": "BB-65QLED",  "name": "Samsung 65\" QLED TV",    "price": 1299, "stock": "In Stock",      "category": "TV" },
        { "id": "p2",  "sku": "BB-MBP14",   "name": "MacBook Pro 14\"",         "price": 1999, "stock": "In Stock",      "category": "Laptop" },
        { "id": "p3",  "sku": "BB-APP3",    "name": "AirPods Pro",              "price": 249,  "stock": "In Stock",      "category": "Audio" },
        { "id": "p4",  "sku": "BB-WH1000",  "name": "Sony WH-1000XM5",          "price": 349,  "stock": "In Stock",      "category": "Audio" },
        { "id": "p5",  "sku": "BB-PS5",     "name": "PlayStation 5",            "price": 499,  "stock": "Low Stock",     "category": "Gaming" },
        { "id": "p6",  "sku": "BB-ROGLTOP", "name": "ASUS ROG Gaming Laptop",   "price": 1199, "stock": "In Stock",      "category": "Laptop" },
        { "id": "p7",  "sku": "BB-BOSE-SL", "name": "Bose SoundLink Speaker",   "price": 149,  "stock": "In Stock",      "category": "Audio" },
        { "id": "p8",  "sku": "BB-LG27",    "name": "LG 27\" 4K Monitor",       "price": 399,  "stock": "In Stock",      "category": "Monitor" },
        { "id": "p9",  "sku": "BB-IP16PRO", "name": "iPhone 16 Pro",            "price": 999,  "stock": "Limited Stock", "category": "Phone" },
        { "id": "p10", "sku": "BB-GRM-F8",  "name": "Garmin Fenix 8",           "price": 799,  "stock": "In Stock",      "category": "Wearable" }
      ],
      "orders": [
        { "id": "o1", "product": "AirPods Pro",     "sku": "BB-APP3",    "amount": 249,  "status": "Delivered",  "date": "2026-04-20" },
        { "id": "o2", "product": "MacBook Pro 14\"", "sku": "BB-MBP14",   "amount": 1999, "status": "Shipped",    "date": "2026-04-22" },
        { "id": "o3", "product": "Bose SoundLink",   "sku": "BB-BOSE-SL", "amount": 149,  "status": "Processing", "date": "2026-04-23" }
      ]
    }
  },
  "scopes": {
    "read": "banking:read",
    "write": "banking:write",
    "transfer": "banking:transfer",
    "admin": "banking:admin"
  },
  "demoUsers": {
    "customer": { "hint": "bankuser", "passwordHint": "Tigers7&" },
    "admin": { "hint": "bankadmin", "passwordHint": "Tigers7&" }
  }
}
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('banking_api_server/config/verticals/retail.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add banking_api_server/config/verticals/retail.json
git commit -m "feat(theme): retail.json v2 manifest (Best Buy)"
```

---

## Task 3: Server — getActiveManifest() + schema validation

**Files:**
- Modify: `banking_api_server/services/verticalConfigService.js`
- Test: `banking_api_server/src/__tests__/verticalConfigService.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `banking_api_server/src/__tests__/verticalConfigService.test.js`:

```javascript
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => 'banking'),
  setConfig: jest.fn(async () => {}),
}));

const svc = require('../../services/verticalConfigService');

describe('verticalConfigService v2', () => {
  beforeEach(() => svc.reloadVerticals());

  test('getActiveManifest returns banking v2 manifest by default', () => {
    const m = svc.getActiveManifest();
    expect(m.id).toBe('banking');
    expect(m.schemaVersion).toBe(2);
    expect(m.identity.displayName).toBe('Super Banking');
    expect(m.theme.cssVars['--app-primary-red']).toBeDefined();
  });

  test('retail manifest is loaded and valid v2', () => {
    const m = svc.getVerticalConfig('retail');
    expect(m.id).toBe('retail');
    expect(m.schemaVersion).toBe(2);
    expect(m.identity.displayName).toBe('Best Buy');
    expect(m.dashboard.kind).toBe('retail');
    expect(m.dashboard.mockData.products.length).toBe(10);
  });

  test('getActiveManifest falls back to banking when active id invalid', () => {
    const configStore = require('../../services/configStore');
    configStore.getEffective.mockReturnValueOnce('does-not-exist');
    const m = svc.getActiveManifest();
    expect(m.id).toBe('banking');
  });

  test('loadVerticals skips a manifest missing required fields', () => {
    const loaded = svc.reloadVerticals();
    Object.values(loaded).forEach((v) => {
      expect(v.id).toBeDefined();
      expect(v.schemaVersion).toBe(2);
      expect(v.identity && v.identity.displayName).toBeTruthy();
      expect(v.theme && v.theme.cssVars).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest src/__tests__/verticalConfigService.test.js`
Expected: FAIL — `svc.getActiveManifest is not a function`

- [ ] **Step 3: Add validation + getActiveManifest to verticalConfigService.js**

In `loadVerticals()`, after `const config = JSON.parse(raw);` and before the `if (config.id)` block, replace that block with a validating version:

```javascript
      const config = JSON.parse(raw);
      const valid =
        config &&
        config.id &&
        config.schemaVersion === 2 &&
        config.identity &&
        config.identity.displayName &&
        config.theme &&
        config.theme.cssVars;
      if (valid) {
        verticalCache[config.id] = config;
      } else {
        console.error(
          `[verticalConfigService] Skipping invalid manifest "${file}" (must be schemaVersion 2 with identity.displayName + theme.cssVars)`
        );
      }
```

Add this function before `module.exports` (reuses existing `getActiveVertical` + `getVerticalConfig`):

```javascript
/**
 * Return the full v2 manifest for the active vertical.
 * Falls back to the banking manifest if the active id is missing/invalid.
 */
function getActiveManifest() {
  const all = loadVerticals();
  const activeId = getActiveVertical();
  return all[activeId] || all.banking || null;
}
```

Add `getActiveManifest` to the `module.exports` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest src/__tests__/verticalConfigService.test.js`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/services/verticalConfigService.js banking_api_server/src/__tests__/verticalConfigService.test.js
git commit -m "feat(theme): getActiveManifest + v2 schema validation"
```

---

## Task 4: Server — GET /api/config/vertical returns v2 manifest additively

**Files:**
- Modify: `banking_api_server/routes/verticalConfig.js`

- [ ] **Step 1: Update GET handler to return the manifest additively**

Replace the `router.get('/', ...)` handler with (adds `manifest`, keeps `config` for backward compat):

```javascript
const {
  listVerticals,
  getActiveVertical,
  setActiveVertical,
  getVerticalConfig,
  getActiveManifest,
} = require('../services/verticalConfigService');

// GET /api/config/vertical — active vertical config + full v2 manifest (public)
router.get('/', (_req, res) => {
  try {
    const config = getVerticalConfig();
    res.json({
      activeVertical: getActiveVertical(),
      config,                       // legacy shape (kept additively)
      manifest: getActiveManifest(), // v2 manifest the client consumes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

(Remove the now-duplicate top `const { ... } = require(...)` line and use only this expanded one.)

- [ ] **Step 2: Add a clarifying comment on the PUT route**

The PUT handler is already auth-only (no admin gate). Add above `router.put('/', ...)`:

```javascript
// PUT /api/config/vertical — set active vertical, server-wide.
// Intentionally any-authenticated (not admin-only): the manifest is
// presentation-only (no scopes/auth/secrets) and the customer-persona demo
// switches themes from the dashboard ThemePicker. See REGRESSION_PLAN §1
// theme-contract note.
```

- [ ] **Step 3: Run server tests**

Run: `cd banking_api_server && npx jest src/__tests__/verticalConfigService.test.js`
Expected: PASS (no regression)

- [ ] **Step 4: Commit**

```bash
git add banking_api_server/routes/verticalConfig.js
git commit -m "feat(theme): serve v2 manifest additively; document PUT auth"
```

---

## Task 5: Client — ThemeProvider / useTheme()

**Files:**
- Create: `banking_api_ui/src/context/ThemeContext.js`
- Test: `banking_api_ui/src/components/__tests__/ThemeContext.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `banking_api_ui/src/components/__tests__/ThemeContext.test.js`:

```javascript
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../../context/ThemeContext';

const MANIFEST = {
  id: 'retail',
  identity: { displayName: 'Best Buy', headerTitle: 'Best Buy', documentTitle: 'Best Buy · X', logoAlt: 'Best Buy logo', logoPath: '/x.png' },
  theme: { cssVars: { '--app-primary-red': '#0046BE' } },
  terminology: { transaction: 'Activity' },
  agent: { persona: 'Shopping Assistant', greeting: 'Hi {name}!' },
  dashboard: { kind: 'retail', chips: [{ key: 'balance', label: 'Rewards Points' }], mockData: null },
};

function Probe() {
  const t = useTheme();
  return <div>{t.identity?.displayName}|{t.dashboard?.kind}|{t.mapTerm('transaction')}</div>;
}

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ manifest: MANIFEST }) })
  );
});

test('useTheme exposes manifest fields and applies cssVars', async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByText('Best Buy|retail|Activity')).toBeInTheDocument());
  expect(document.documentElement.style.getPropertyValue('--app-primary-red')).toBe('#0046BE');
  expect(document.title).toBe('Best Buy · X');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/ThemeContext.test.js`
Expected: FAIL — cannot find module `../../context/ThemeContext`

- [ ] **Step 3: Create ThemeContext.js**

```javascript
// banking_api_ui/src/context/ThemeContext.js
import React, {
  createContext, useContext, useState, useEffect, useCallback, useMemo,
} from 'react';

const ThemeContext = createContext(null);

function applyCssVars(cssVars) {
  if (!cssVars || typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(cssVars).forEach(([k, v]) => root.style.setProperty(k, v));
}

export function ThemeProvider({ children }) {
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchManifest = useCallback(async () => {
    try {
      const res = await fetch('/api/config/vertical', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const m = data.manifest || null;
        setManifest(m);
        if (m) {
          applyCssVars(m.theme && m.theme.cssVars);
          if (m.identity && m.identity.documentTitle) {
            document.title = m.identity.documentTitle;
          }
          if (m.id && typeof document !== 'undefined') {
            document.documentElement.dataset.industry = m.id;
          }
        }
      }
    } catch (err) {
      // Non-fatal: app renders with CSS defaults if manifest fetch fails.
      console.warn('[ThemeContext] manifest fetch failed:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchManifest(); }, [fetchManifest]);

  const switchTheme = useCallback(async (id) => {
    const res = await fetch('/api/config/vertical', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verticalId: id }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${res.status}`);
    }
    await fetchManifest();
  }, [fetchManifest]);

  const mapTerm = useCallback(
    (term) => (manifest && manifest.terminology && manifest.terminology[term]) || term,
    [manifest],
  );

  const value = useMemo(() => ({
    loading,
    themeId: manifest ? manifest.id : null,
    identity: manifest ? manifest.identity : null,
    cssVars: manifest && manifest.theme ? manifest.theme.cssVars : null,
    terminology: manifest ? manifest.terminology : null,
    agent: manifest ? manifest.agent : null,
    dashboard: manifest ? manifest.dashboard : null,
    mapTerm,
    switchTheme,
  }), [manifest, loading, mapTerm, switchTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      loading: false, themeId: null, identity: null, cssVars: null,
      terminology: null, agent: null, dashboard: null,
      mapTerm: (t) => t, switchTheme: async () => {},
    };
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/ThemeContext.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add banking_api_ui/src/context/ThemeContext.js banking_api_ui/src/components/__tests__/ThemeContext.test.js
git commit -m "feat(theme): ThemeProvider/useTheme single context"
```

---

## Task 6: Wire ThemeProvider into App.js; make old contexts shims

**Files:**
- Modify: `banking_api_ui/src/App.js:111,114,1482-1486`
- Modify: `banking_api_ui/src/context/IndustryBrandingContext.js`
- Modify: `banking_api_ui/src/context/VerticalContext.js`

- [ ] **Step 1: Make IndustryBrandingContext a shim**

Replace the entire contents of `banking_api_ui/src/context/IndustryBrandingContext.js`:

```javascript
// banking_api_ui/src/context/IndustryBrandingContext.js
// SHIM: superseded by ThemeContext. Kept so existing imports keep working
// during incremental migration; removed in the cleanup task once unused.
import { useTheme } from './ThemeContext';

export function IndustryBrandingProvider({ children }) {
  return children;
}

export function useIndustryBranding() {
  const t = useTheme();
  const id = t.themeId || 'bx_finance';
  return {
    industryId: id,
    preset: { id, shortName: t.identity ? t.identity.displayName : 'Super Banking' },
    setIndustryId: () => {},
    applyIndustryId: () => {},
  };
}
```

- [ ] **Step 2: Make VerticalContext a shim**

Replace the entire contents of `banking_api_ui/src/context/VerticalContext.js`:

```javascript
// banking_api_ui/src/context/VerticalContext.js
// SHIM: superseded by ThemeContext. Removed in the cleanup task once unused.
import { useTheme } from './ThemeContext';

export function VerticalProvider({ children }) {
  return children;
}

export function useVertical() {
  const t = useTheme();
  return {
    vertical: t.terminology ? { terminology: t.terminology } : null,
    loading: t.loading,
    error: null,
    switchVertical: t.switchTheme,
    mapTerm: t.mapTerm,
  };
}
```

- [ ] **Step 3: Swap provider tree in App.js**

At `App.js:111` and `:114`, add the ThemeProvider import (keep the shim imports — they still resolve):

Add after line 114:
```javascript
import { ThemeProvider } from "./context/ThemeContext";
```

At `App.js:1482-1486`, replace:
```javascript
            <IndustryBrandingProvider>
              <VerticalProvider>
```
...and its matching closing tags with a single `ThemeProvider`. The block becomes:
```javascript
            <ThemeProvider>
              {/* children unchanged */}
            </ThemeProvider>
```
(Preserve whatever JSX was between `<VerticalProvider>` and `</VerticalProvider>` — only the two wrapper tags collapse into one `ThemeProvider`.)

- [ ] **Step 4: Build the UI**

Run: `cd banking_api_ui && npm run build`
Expected: exit 0

- [ ] **Step 5: Run the existing UI test suite (no regression)**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/ThemeContext.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add banking_api_ui/src/App.js banking_api_ui/src/context/IndustryBrandingContext.js banking_api_ui/src/context/VerticalContext.js
git commit -m "refactor(theme): single ThemeProvider; old contexts become shims"
```

---

## Task 7: DashboardHeader reads manifest identity (regression checkpoint)

**Files:**
- Modify: `banking_api_ui/src/components/DashboardHeader.js`
- Test: `banking_api_ui/src/components/__tests__/DashboardHeader.theme.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `banking_api_ui/src/components/__tests__/DashboardHeader.theme.test.js`:

```javascript
import React from 'react';
import { render, screen } from '@testing-library/react';
import DashboardHeader from '../DashboardHeader';
import { ThemeProvider } from '../../context/ThemeContext';

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        manifest: {
          id: 'retail',
          identity: { headerTitle: 'Best Buy', logoAlt: 'Best Buy logo', logoPath: '/x.png', documentTitle: 'Best Buy' },
          theme: { cssVars: {} }, terminology: {}, agent: {}, dashboard: { kind: 'retail' },
        },
      }),
    })
  );
});

test('header renders manifest headerTitle and logo alt', async () => {
  render(<ThemeProvider><DashboardHeader variant="customer" /></ThemeProvider>);
  expect(await screen.findByText('Best Buy')).toBeInTheDocument();
  expect(screen.getByAltText('Best Buy logo')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/DashboardHeader.theme.test.js`
Expected: FAIL — finds hardcoded "Super Banking", not "Best Buy"

- [ ] **Step 3: Update DashboardHeader.js**

Replace the component body so title/alt come from `useTheme()` (defaults preserve byte-identical banking output when manifest absent):

```javascript
import React from 'react';
import './DashboardHeader.css';
import { useTheme } from '../context/ThemeContext';

const DashboardHeader = ({ variant = 'customer' }) => {
  const { identity } = useTheme();
  const isAdmin = variant === 'admin';
  const label = isAdmin ? 'Admin Dashboard' : 'Customer Dashboard';
  const title = (identity && identity.headerTitle) || 'Super Banking';
  const logoAlt = (identity && identity.logoAlt) || 'Super Banking logo';
  const logoSrc = (identity && identity.logoPath) || '/super-bank-icon.png';

  return (
    <header className={`sb-dashboard-header sb-dashboard-header--${variant}`}>
      <div className="sb-dashboard-header__brand">
        <img
          src={logoSrc}
          alt={logoAlt}
          className="sb-dashboard-header__logo"
          width="36"
          height="36"
        />
        <div className="sb-dashboard-header__titles">
          <h1 className="sb-dashboard-header__name">{title}</h1>
          <span className={`sb-dashboard-header__badge sb-dashboard-header__badge--${variant}`}>
            {label}
          </span>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/DashboardHeader.theme.test.js`
Expected: PASS

- [ ] **Step 5: Build the UI**

Run: `cd banking_api_ui && npm run build`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add banking_api_ui/src/components/DashboardHeader.js banking_api_ui/src/components/__tests__/DashboardHeader.theme.test.js
git commit -m "feat(theme): DashboardHeader reads manifest identity"
```

---

## Task 8: Neutral index.html title (runtime title owned by ThemeProvider)

**Files:**
- Modify: `banking_api_ui/public/index.html:15,18`

- [ ] **Step 1: Replace hardcoded title + og:title with neutral placeholder**

At `public/index.html:18` change:
```html
  <title>Super Banking · PingOne AI IAM Core</title>
```
to:
```html
  <title>PingOne AI IAM Core</title>
```
At line 15 change:
```html
  <meta property="og:title" content="Super Banking · PingOne AI IAM Core" />
```
to:
```html
  <meta property="og:title" content="PingOne AI IAM Core" />
```
(Leave line 16 `og:description` unchanged — out of scope, marketing-stable per CLAUDE.md rule 7.)

`ThemeProvider` already sets `document.title` from `identity.documentTitle` (Task 5, Step 3) so the themed title appears post-hydration.

- [ ] **Step 2: Build the UI**

Run: `cd banking_api_ui && npm run build`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add banking_api_ui/public/index.html
git commit -m "feat(theme): neutral static title; runtime title from manifest"
```

---

## Task 9: BankingAgent greeting from manifest (remove isRetail ternary)

**Files:**
- Modify: `banking_api_ui/src/components/BankingAgent.js:11,1534-1560,1643` + 5 `welcomeMessage(` call sites
- Test: `banking_api_ui/src/components/__tests__/BankingAgent.greeting.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `banking_api_ui/src/components/__tests__/BankingAgent.greeting.test.js`:

```javascript
import { buildCustomerGreeting } from '../BankingAgent';

test('buildCustomerGreeting substitutes {name} from manifest greeting', () => {
  const g = buildCustomerGreeting(
    { firstName: 'Sam', role: 'customer' },
    'Hi {name}! Shopping time. What would you like to do?'
  );
  expect(g).toBe('Hi Sam! Shopping time. What would you like to do?');
});

test('buildCustomerGreeting falls back when no manifest greeting', () => {
  const g = buildCustomerGreeting({ firstName: 'Sam', role: 'customer' }, null);
  expect(g).toContain('Sam');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/BankingAgent.greeting.test.js`
Expected: FAIL — `buildCustomerGreeting` not exported

- [ ] **Step 3: Add exported helper; remove isRetail ternary; drop industryPresetId param**

In `BankingAgent.js`, add this exported function near `welcomeMessage` (around line 1534):

```javascript
export function buildCustomerGreeting(u, manifestGreeting) {
  const name = (u && (u.firstName || (u.name && u.name.split(' ')[0]))) || 'there';
  if (manifestGreeting) return manifestGreeting.replace('{name}', name);
  return `Hi ${name}! I can check your balances, move money between accounts, and explain the OAuth flows happening behind the scenes. What would you like to do?`;
}
```

In `welcomeMessage` (lines 1534-1560): remove the `industryPresetId = "bx_finance"` parameter (4th param) and replace the final retail block:
```javascript
  const isRetail = industryPresetId === "retail";
  return isRetail
    ? `Hi ${name}! I can browse products, check prices, help with your cart, and explain the OAuth flows securing your checkout. What would you like to do?`
    : `Hi ${name}! I can check your balances, move money between accounts, and explain the OAuth flows happening behind the scenes. What would you like to do?`;
```
with:
```javascript
  return buildCustomerGreeting(u, customerGreetingOverride);
```
Add `customerGreetingOverride = null` as the new 4th parameter of `welcomeMessage` in place of the removed `industryPresetId`.

At line 1643 replace:
```javascript
  const { preset: industryPreset } = useIndustryBranding();
```
with:
```javascript
  const { agent: themeAgent } = useTheme();
```
Add the import at line 11 area:
```javascript
import { useTheme } from "../context/ThemeContext";
```
(Leave the `useIndustryBranding` import only if other lines still use `industryPreset`; if line 1643 was its only use, remove that import too.)

At the 5 `welcomeMessage(` call sites (lines ~2278, 2339, 2388, 2595, 2641): replace the `industryPreset.id` argument (4th arg) with `themeAgent && themeAgent.greeting`.

- [ ] **Step 4: Run test + build**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/BankingAgent.greeting.test.js && npm run build`
Expected: tests PASS, build exit 0

- [ ] **Step 5: Commit**

```bash
git add banking_api_ui/src/components/BankingAgent.js banking_api_ui/src/components/__tests__/BankingAgent.greeting.test.js
git commit -m "feat(theme): agent greeting from manifest; remove isRetail ternary"
```

---

## Task 10: BankingChips labels overlaid from manifest (keys unchanged)

**Files:**
- Modify: `banking_api_ui/src/components/BankingChips.jsx:4-22`
- Test: `banking_api_ui/src/components/__tests__/BankingChips.theme.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `banking_api_ui/src/components/__tests__/BankingChips.theme.test.js`:

```javascript
import { applyChipLabels } from '../BankingChips';

const HEURISTIC = [
  { id: 'balance', label: 'Check Balance', message: 'balance' },
  { id: 'accounts', label: 'My Accounts', message: 'accounts' },
];

test('applyChipLabels overlays manifest labels by key; message/id unchanged', () => {
  const out = applyChipLabels(HEURISTIC, [
    { key: 'balance', label: 'Rewards Points' },
    { key: 'accounts', label: 'My Orders' },
  ]);
  expect(out[0]).toEqual({ id: 'balance', label: 'Rewards Points', message: 'balance' });
  expect(out[1]).toEqual({ id: 'accounts', label: 'My Orders', message: 'accounts' });
});

test('applyChipLabels returns originals when no manifest chips', () => {
  expect(applyChipLabels(HEURISTIC, null)).toEqual(HEURISTIC);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/BankingChips.theme.test.js`
Expected: FAIL — `applyChipLabels` not exported

- [ ] **Step 3: Add applyChipLabels; consume useTheme for labels only**

In `BankingChips.jsx`, add after the `HEURISTIC_CHIPS` const:

```javascript
// Overlay manifest chip LABELS by key. id + message (routing keys) are never
// changed — the chip→routing→MCP pipeline is invariant (skip-proof contract).
export function applyChipLabels(chips, manifestChips) {
  if (!Array.isArray(manifestChips)) return chips;
  const byKey = new Map(manifestChips.map((c) => [c.key, c.label]));
  return chips.map((c) => (byKey.has(c.id) ? { ...c, label: byKey.get(c.id) } : c));
}
```

Add the import at the top:
```javascript
import { useTheme } from "../context/ThemeContext";
```

Inside the component, where `HEURISTIC_CHIPS` is rendered, derive display chips:
```javascript
  const { dashboard } = useTheme();
  const heuristicChips = applyChipLabels(HEURISTIC_CHIPS, dashboard && dashboard.chips);
```
Use `heuristicChips` instead of `HEURISTIC_CHIPS` in the render path (only the heuristic group; `LLM_CHIPS` is out of scope and unchanged).

- [ ] **Step 4: Run test + build**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/BankingChips.theme.test.js && npm run build`
Expected: tests PASS, build exit 0

- [ ] **Step 5: Run the skip-proof chip pipeline suite (hard gate)**

Run: `cd banking_api_ui && npx playwright test all-chips-pipeline.real.spec.js`
Expected: PASS — every chip still routes (no skips, no 401). If unavailable in the environment, run `cd banking_api_ui && npm run test:e2e:ui:smoke` and note the chip pipeline must be verified before merge.

- [ ] **Step 6: Commit**

```bash
git add banking_api_ui/src/components/BankingChips.jsx banking_api_ui/src/components/__tests__/BankingChips.theme.test.js
git commit -m "feat(theme): chip labels from manifest; routing keys invariant"
```

---

## Task 11: RetailDashboard component (product/cart/orders, manifest-driven)

**Files:**
- Create: `banking_api_ui/src/components/RetailDashboard.js`
- Create: `banking_api_ui/src/components/RetailDashboard.css`
- Test: `banking_api_ui/src/components/__tests__/RetailDashboard.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `banking_api_ui/src/components/__tests__/RetailDashboard.test.js`:

```javascript
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RetailDashboard from '../RetailDashboard';

const DATA = {
  products: [
    { id: 'p1', sku: 'BB-1', name: 'AirPods Pro', price: 249, stock: 'In Stock', category: 'Audio' },
    { id: 'p2', sku: 'BB-2', name: 'PS5', price: 499, stock: 'Low Stock', category: 'Gaming' },
  ],
  orders: [
    { id: 'o1', product: 'AirPods Pro', sku: 'BB-1', amount: 249, status: 'Delivered', date: '2026-04-20' },
  ],
};

test('renders products, orders, and updates cart total on add', () => {
  render(<RetailDashboard data={DATA} />);
  expect(screen.getByText('AirPods Pro')).toBeInTheDocument();
  expect(screen.getByText('Delivered')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: /add to cart/i })[0]);
  expect(screen.getByTestId('retail-cart-total')).toHaveTextContent('249');
});

test('renders nothing harmful when data missing', () => {
  const { container } = render(<RetailDashboard data={null} />);
  expect(container).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/RetailDashboard.test.js`
Expected: FAIL — cannot find module `../RetailDashboard`

- [ ] **Step 3: Create RetailDashboard.js**

```javascript
// banking_api_ui/src/components/RetailDashboard.js
// Phase 1 retail dashboard: product grid + local cart + recent orders.
// Mock data comes from the theme manifest (manifest.dashboard.mockData).
// No real persistence — Phase 2 owns real retail MCP tools.
import React, { useState, useMemo } from 'react';
import './RetailDashboard.css';

function stockClass(stock) {
  if (/out/i.test(stock)) return 'retail-stock--out';
  if (/low|limited/i.test(stock)) return 'retail-stock--low';
  return 'retail-stock--in';
}

export default function RetailDashboard({ data }) {
  const products = (data && data.products) || [];
  const orders = (data && data.orders) || [];
  const [cart, setCart] = useState([]);

  const total = useMemo(
    () => cart.reduce((sum, p) => sum + (p.price || 0), 0),
    [cart],
  );

  return (
    <div className="retail-dashboard">
      <section>
        <h2 className="retail-section-title">Products</h2>
        <div className="retail-product-grid">
          {products.map((p) => (
            <div key={p.id} className="retail-product-card">
              <div className="retail-product-name">{p.name}</div>
              <div className="retail-product-meta">
                <span className="retail-product-price">${p.price}</span>
                <span className={`retail-stock ${stockClass(p.stock)}`}>{p.stock}</span>
              </div>
              <button
                type="button"
                className="retail-add-btn"
                onClick={() => setCart((c) => [...c, p])}
              >
                Add to Cart
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="retail-cart-summary">
        <h2 className="retail-section-title">Cart</h2>
        <div>
          {cart.length} item(s) — Subtotal:{' '}
          <strong data-testid="retail-cart-total">${total}</strong>
        </div>
      </section>

      <section>
        <h2 className="retail-section-title">Recent Orders</h2>
        <ul className="retail-orders-list">
          {orders.map((o) => (
            <li key={o.id} className="retail-order-row">
              <span>{o.product}</span>
              <span>${o.amount}</span>
              <span className="retail-order-status">{o.status}</span>
              <span>{o.date}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Create RetailDashboard.css**

```css
/* banking_api_ui/src/components/RetailDashboard.css */
.retail-dashboard { display: flex; flex-direction: column; gap: 24px; }
.retail-section-title { font-size: 18px; font-weight: 600; margin: 0 0 12px; color: #1e293b; }
.retail-product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
.retail-product-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; background: #fff; display: flex; flex-direction: column; gap: 10px; }
.retail-product-name { font-weight: 600; color: #0f172a; }
.retail-product-meta { display: flex; justify-content: space-between; align-items: center; }
.retail-product-price { font-weight: 700; color: var(--app-primary-red, #0046BE); }
.retail-stock { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
.retail-stock--in { background: #dcfce7; color: #166534; }
.retail-stock--low { background: #fef9c3; color: #854d0e; }
.retail-stock--out { background: #fee2e2; color: #991b1b; }
.retail-add-btn { background: var(--app-primary-red, #0046BE); color: #fff; border: none; border-radius: 6px; padding: 8px 12px; font-weight: 600; cursor: pointer; min-height: 36px; }
.retail-add-btn:hover { background: var(--app-primary-red-hover, #003a9e); }
.retail-cart-summary { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; background: #f8fafc; }
.retail-orders-list { list-style: none; margin: 0; padding: 0; }
.retail-order-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
.retail-order-status { font-weight: 600; }
```

- [ ] **Step 5: Run test + build**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/RetailDashboard.test.js && npm run build`
Expected: tests PASS, build exit 0

- [ ] **Step 6: Commit**

```bash
git add banking_api_ui/src/components/RetailDashboard.js banking_api_ui/src/components/RetailDashboard.css banking_api_ui/src/components/__tests__/RetailDashboard.test.js
git commit -m "feat(theme): RetailDashboard product/cart/orders component"
```

---

## Task 12: UserDashboard branches on manifest.dashboard.kind

**Files:**
- Modify: `banking_api_ui/src/components/UserDashboard.js:2531` (DashboardHeader render area / `renderBankingMain`)

- [ ] **Step 1: Locate the main banking render**

Run: `cd banking_api_ui && grep -n "renderBankingMain\|DashboardHeader\|splitGridClass(showBankingInMiddle)" src/components/UserDashboard.js | head`
Expected: identifies the function/JSX that renders the banking account view (the `renderBankingMain` body).

- [ ] **Step 2: Import useTheme and RetailDashboard**

Near the top imports of `UserDashboard.js` add:
```javascript
import { useTheme } from "../context/ThemeContext";
import RetailDashboard from "./RetailDashboard";
```

- [ ] **Step 3: Branch the main content on dashboard.kind**

Inside the component, near other hook calls, add:
```javascript
  const { dashboard: themeDashboard } = useTheme();
  const isRetailDashboard =
    themeDashboard && themeDashboard.kind === "retail";
```
At the point where the banking account view is rendered (the `renderBankingMain()` return or its JSX usage), wrap so retail replaces the banking middle content:
```javascript
  {isRetailDashboard ? (
    <RetailDashboard data={themeDashboard && themeDashboard.mockData} />
  ) : (
    renderBankingMain()
  )}
```
(If banking content is inline JSX rather than `renderBankingMain()`, wrap that exact JSX block with the same ternary. Do not alter the banking branch's content — only gate it.)

- [ ] **Step 4: Build the UI**

Run: `cd banking_api_ui && npm run build`
Expected: exit 0

- [ ] **Step 5: Manual sanity (documented expectation)**

With banking active (default), the dashboard renders exactly as before (no retail). With retail active, the product/cart/orders view renders. Token chain / agent / OAuth panels are unchanged in both.

- [ ] **Step 6: Commit**

```bash
git add banking_api_ui/src/components/UserDashboard.js
git commit -m "feat(theme): UserDashboard branches on manifest dashboard.kind"
```

---

## Task 13: ThemePicker component (toolbar + config variants)

**Files:**
- Create: `banking_api_ui/src/components/ThemePicker.js`
- Create: `banking_api_ui/src/components/ThemePicker.css`
- Test: `banking_api_ui/src/components/__tests__/ThemePicker.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `banking_api_ui/src/components/__tests__/ThemePicker.test.js`:

```javascript
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ThemePicker from '../ThemePicker';
import { ThemeProvider } from '../../context/ThemeContext';

beforeEach(() => {
  global.fetch = jest.fn((url, opts) => {
    if (url === '/api/config/verticals/list') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        verticals: [{ id: 'banking', displayName: 'Super Banking' }, { id: 'retail', displayName: 'Best Buy' }],
      }) });
    }
    if (url === '/api/config/vertical' && (!opts || opts.method !== 'PUT')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        manifest: { id: 'banking', identity: { displayName: 'Super Banking', documentTitle: 'x' }, theme: { cssVars: {} }, terminology: {}, agent: {}, dashboard: { kind: 'banking' } },
      }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); // PUT
  });
});

test('lists themes and PUTs on change', async () => {
  render(<ThemeProvider><ThemePicker variant="toolbar" /></ThemeProvider>);
  await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
  expect(screen.getByText('Best Buy')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'retail' } });
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/config/vertical',
      expect.objectContaining({ method: 'PUT' }),
    )
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/ThemePicker.test.js`
Expected: FAIL — cannot find module `../ThemePicker`

- [ ] **Step 3: Create ThemePicker.js**

```javascript
// banking_api_ui/src/components/ThemePicker.js
// Server-wide theme switcher. Same PUT /api/config/vertical path as the admin
// Config UI (single source of truth). variant: 'toolbar' | 'config'.
import React, { useEffect, useState } from 'react';
import './ThemePicker.css';
import { useTheme } from '../context/ThemeContext';

export default function ThemePicker({ variant = 'toolbar' }) {
  const { themeId, switchTheme } = useTheme();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config/verticals/list', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { verticals: [] }))
      .then((d) => { if (!cancelled) setList(d.verticals || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const onChange = async (e) => {
    const id = e.target.value;
    setBusy(true);
    setErr(null);
    try {
      await switchTheme(id);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`theme-picker theme-picker--${variant}`}>
      <label className="theme-picker__label" htmlFor="theme-picker-select">
        Theme
      </label>
      <select
        id="theme-picker-select"
        className="theme-picker__select"
        value={themeId || ''}
        onChange={onChange}
        disabled={busy}
      >
        {list.map((v) => (
          <option key={v.id} value={v.id}>{v.displayName}</option>
        ))}
      </select>
      {err ? <span className="theme-picker__err">{err}</span> : null}
    </div>
  );
}
```

- [ ] **Step 4: Create ThemePicker.css**

```css
/* banking_api_ui/src/components/ThemePicker.css */
.theme-picker { display: inline-flex; align-items: center; gap: 6px; }
.theme-picker__label { font-size: 12px; font-weight: 600; color: #1e293b; }
.theme-picker__select { font-size: 13px; padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; min-height: 32px; cursor: pointer; }
.theme-picker__select:focus-visible { outline: 2px solid var(--app-primary-red, #1d4ed8); outline-offset: 1px; }
.theme-picker__err { font-size: 12px; color: #991b1b; }
.theme-picker--config { gap: 10px; }
.theme-picker--config .theme-picker__select { min-height: 38px; font-size: 14px; }
```

- [ ] **Step 5: Run test + build**

Run: `cd banking_api_ui && npx react-scripts test --watchAll=false src/components/__tests__/ThemePicker.test.js && npm run build`
Expected: tests PASS, build exit 0

- [ ] **Step 6: Commit**

```bash
git add banking_api_ui/src/components/ThemePicker.js banking_api_ui/src/components/ThemePicker.css banking_api_ui/src/components/__tests__/ThemePicker.test.js
git commit -m "feat(theme): ThemePicker switcher (toolbar + config variants)"
```

---

## Task 14: Mount ThemePicker in UserDashboard toolbar

**Files:**
- Modify: `banking_api_ui/src/components/UserDashboard.js:2539` (the `dashboard-toolbar` row)

- [ ] **Step 1: Import ThemePicker**

In `UserDashboard.js` imports add:
```javascript
import ThemePicker from "./ThemePicker";
```

- [ ] **Step 2: Render it in the toolbar row**

At `UserDashboard.js:2539`, the toolbar currently is:
```javascript
          <AgentUiModeToggle variant="config" />
          <ThresholdControls />
```
Insert the picker as the first control so it sits near the top-left of the toolbar:
```javascript
          <ThemePicker variant="toolbar" />
          <AgentUiModeToggle variant="config" />
          <ThresholdControls />
```

- [ ] **Step 3: Build the UI**

Run: `cd banking_api_ui && npm run build`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add banking_api_ui/src/components/UserDashboard.js
git commit -m "feat(theme): mount ThemePicker in dashboard toolbar"
```

---

## Task 15: Repoint Config UI industry picker to ThemePicker

**Files:**
- Modify: `banking_api_ui/src/components/Config.js:1710-1765` (the "Industry & branding" card)

- [ ] **Step 1: Locate the industry-branding block**

Run: `cd banking_api_ui && grep -n "INDUSTRY_PRESETS\|ui_industry_preset\|Industry & branding\|applyIndustryId" src/components/Config.js | head`
Expected: confirms the card boundaries around lines 1710-1765 and the `INDUSTRY_PRESETS` import line.

- [ ] **Step 2: Replace the preset radio grid with ThemePicker**

Add import near the top of `Config.js`:
```javascript
import ThemePicker from "./ThemePicker";
```
Replace the inner content of the "Industry & branding" card (the radio grid mapping `INDUSTRY_PRESETS`, lines ~1729-1763) with:
```javascript
            <p className="config-help">
              Switch the active theme. This is server-wide and uses the same
              setting as the dashboard theme picker.
            </p>
            <ThemePicker variant="config" />
```
Leave the card heading/wrapper. Remove the now-unused `INDUSTRY_PRESETS` import and any `applyIndustryId`/`form.ui_industry_preset` lines **only if** they are no longer referenced elsewhere in `Config.js` (grep first; if referenced elsewhere, leave them and just swap the picker UI).

- [ ] **Step 3: Build the UI**

Run: `cd banking_api_ui && npm run build`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add banking_api_ui/src/components/Config.js
git commit -m "feat(theme): Config UI uses ThemePicker (one switch control)"
```

---

## Task 16: Delete orphan retail files

**Files:**
- Delete: `banking_api_ui/src/config/retailMockData.js`
- Delete: `banking_api_ui/src/components/RetailModeBanner.js`
- Delete: `banking_api_ui/src/components/RetailModeBanner.css`

- [ ] **Step 1: Verify zero references remain**

Run: `cd banking_api_ui && grep -rn "retailMockData\|RetailModeBanner\|RETAIL_PRODUCTS\|RETAIL_ORDERS\|ff_retail_mode" src/ ; echo "exit:$?"`
Expected: no output (grep exit 1) — nothing references these. If anything prints, fix that reference before deleting.

- [ ] **Step 2: Delete the files**

Run:
```bash
git rm banking_api_ui/src/config/retailMockData.js banking_api_ui/src/components/RetailModeBanner.js banking_api_ui/src/components/RetailModeBanner.css
```

- [ ] **Step 3: Build the UI**

Run: `cd banking_api_ui && npm run build`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(theme): delete orphan Phase 225 retail files"
```

---

## Task 17: Remove context shims; finalize cleanup

**Files:**
- Delete: `banking_api_ui/src/context/IndustryBrandingContext.js`
- Delete: `banking_api_ui/src/context/VerticalContext.js`
- Modify: any remaining importers of those shims → import from `ThemeContext`
- Modify: `banking_api_ui/src/config/industryPresets.js` (remove only if fully unreferenced)

- [ ] **Step 1: Find remaining importers of the shims**

Run: `cd banking_api_ui && grep -rn "IndustryBrandingContext\|VerticalContext\|useIndustryBranding\|useVertical\|VerticalSwitcher" src/ | grep -v "context/ThemeContext"`
Expected: a list of files still importing the shims.

- [ ] **Step 2: Migrate each importer to useTheme()**

For each file from Step 1: replace `useIndustryBranding()` usage of `preset.id`/`preset.shortName` with `useTheme().themeId`/`useTheme().identity.displayName`; replace `useVertical().mapTerm`/`switchVertical` with `useTheme().mapTerm`/`switchTheme`. Update the import to `import { useTheme } from "../context/ThemeContext";`. Make the minimal change per file; do not refactor surrounding code.

- [ ] **Step 3: Verify shims and presets are unreferenced**

Run: `cd banking_api_ui && grep -rn "IndustryBrandingContext\|VerticalContext\|industryPresets\|VerticalSwitcher" src/ ; echo "exit:$?"`
Expected: no output (exit 1). If `industryPresets` still referenced, leave that file; only remove the shim contexts.

- [ ] **Step 4: Delete unreferenced files**

Run (only the ones Step 3 confirmed unreferenced):
```bash
git rm banking_api_ui/src/context/IndustryBrandingContext.js banking_api_ui/src/context/VerticalContext.js
```
If `industryPresets.js` is fully unreferenced, also `git rm banking_api_ui/src/config/industryPresets.js` and `banking_api_ui/src/components/VerticalSwitcher.js` + `.css`.

- [ ] **Step 5: Build + full UI tests**

Run: `cd banking_api_ui && npm run build && npx react-scripts test --watchAll=false src/components/__tests__/`
Expected: build exit 0; new theme tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A banking_api_ui/src
git commit -m "chore(theme): remove context shims; single useTheme consumer path"
```

---

## Task 18: REGRESSION_PLAN documentation + final verification

**Files:**
- Modify: `REGRESSION_PLAN.md` (§1 table row; §4 only if a defect was fixed)

- [ ] **Step 1: Add a §1 theme-contract row**

Read `REGRESSION_PLAN.md` §0–1 first. Add one row to the §1 protected-files table:

```
| banking_api_server/config/verticals/*.json + ThemeContext.js | Theme manifest is presentation-only (identity/cssVars/terminology/agent persona+greeting/dashboard). MUST NOT carry scopes/auth/secrets. PUT /api/config/vertical is intentionally any-authenticated (server-wide theme switch for customer-persona demo) — NOT an authz regression. Chip manifest entries change LABELS only; id/message routing keys are invariant (skip-proof chip pipeline). |
```

- [ ] **Step 2: Full server test run**

Run: `cd banking_api_server && npx jest src/__tests__/verticalConfigService.test.js && npm run test:session`
Expected: vertical tests PASS; session suite unaffected.

- [ ] **Step 3: Full UI build + theme tests**

Run: `cd banking_api_ui && npm run build && npx react-scripts test --watchAll=false src/components/__tests__/ThemeContext.test.js src/components/__tests__/ThemePicker.test.js src/components/__tests__/RetailDashboard.test.js src/components/__tests__/DashboardHeader.theme.test.js src/components/__tests__/BankingChips.theme.test.js src/components/__tests__/BankingAgent.greeting.test.js`
Expected: build exit 0; all theme tests PASS.

- [ ] **Step 4: Reusability proof (acceptance check, then revert)**

Create `banking_api_server/config/verticals/_probe.json` (copy retail.json, change `id` to `probe`, `displayName` to `Probe Theme`, one cssVar to a distinct color). Restart BFF, `PUT /api/config/vertical {"verticalId":"probe"}`, confirm the app reskins with zero component/CSS edits. Then `git checkout -- .` / delete `_probe.json` — it must NOT be committed.

Run: `rm -f banking_api_server/config/verticals/_probe.json`
Expected: file removed; no source changes were needed to add it.

- [ ] **Step 5: Commit docs**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(regression): theme-contract §1 row for reusable manifest"
```

---

## Self-Review

**1. Spec coverage:**
- §1 schema → Tasks 1, 2 (banking + retail v2, incl. identity strings, cssVars, chips label/key split, mockData, systemPromptFlavor present-not-consumed).
- §2 server (getActiveManifest, validation, fallback, additive GET, PUT auth) → Tasks 3, 4.
- §3 single useTheme, shims, deletions, hardcoded-string migration → Tasks 5, 6, 7, 8, 9, 10, 16, 17.
- §3a ThemePicker (toolbar + config, server-wide PUT) → Tasks 13, 14, 15.
- §4 AI boundary (greeting/persona only; pipeline untouched; systemPromptFlavor unwired) → Task 9 (no MCP/token files touched anywhere).
- §5 sequencing (banking byte-identical checkpoint at Task 7; chip pipeline gate at Task 10) + success criteria → Tasks 7, 10, 18 (incl. reusability probe + regression doc).
- Risks → addressed: chip pipeline hard gate (Task 10 Step 5), cssVar transcription from current effective values (Task 1 Step 1), shim-then-remove (Tasks 6→17), documented relaxed auth (Tasks 4, 18).

**2. Placeholder scan:** No TBD/TODO. Every code step has full code. The one ambiguity (banking middle JSX may be inline vs `renderBankingMain()`) is handled with an explicit grep step (Task 12 Step 1) and a stated rule, not a placeholder.

**3. Type consistency:** `useTheme()` shape `{ loading, themeId, identity, cssVars, terminology, agent, dashboard, mapTerm, switchTheme }` defined in Task 5 and used consistently in Tasks 6, 7, 9, 10, 12, 13. `applyChipLabels(chips, manifestChips)` and `buildCustomerGreeting(u, manifestGreeting)` exported in Tasks 10/9 and consumed consistently. Manifest field names (`identity.headerTitle`, `dashboard.chips[].key/label`, `dashboard.mockData.products/orders`, `agent.greeting`) match between Tasks 1/2 (JSON) and Tasks 5/7/9/10/11 (consumers).

**Deviation from spec, intentional & disclosed:** Spec assumed Phase 225's retail dashboard was wired and needed careful migration; ground truth (verified) is that it is orphan/dead code. Plan adjusts: `<RetailDashboard>` is built new (Task 11) and "retire ff_retail_mode" is orphan-file deletion (Task 16). No scope change; the spec's intent (manifest-driven retail dashboard, no flag) is fully met.
