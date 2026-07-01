# Vertical Ops Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five look-alike Vertical Ops pages with one reusable, per-vertical-themed "Customer 360" operator console (Direction B + a record drawer with activity timeline).

**Architecture:** A single `VerticalOpsConsole` React component renders entirely from a per-vertical config object (theme, lookup path, lookup-response adapter, category→card mappings, action mappings). The five existing page components become thin wrappers that pass their vertical id. Theming is scoped to the console's own container via `--accent/--accent2/--tint` CSS variables (NOT the global `--brand-*` system, which themes the active persona). The embedded customer agent + token-chain panel are removed; a drawer "Ask the assistant" affordance is stubbed here and wired in the companion Ops Assistant plan.

**Tech Stack:** React (CRA/Vite), `bffAxios` (axios, `withCredentials`), Vitest + React Testing Library, Bootstrap 5 utility classes + a dedicated component CSS file.

## Global Constraints

- API client: always `bffAxios` from `src/services/bffAxios.js` (axios instance, `withCredentials: true`, NO Authorization header — the BFF holds tokens). Never use raw `fetch`.
- Lookup endpoint: `GET /api/admin/<vertical>/lookup?q=<query>` (already open to any authenticated user).
- Toasts: `notifySuccess/notifyError/notifyWarning/notifyInfo` from `src/utils/appToast.js`.
- Component props stay `{ user, onLogout }` (App.js routes pass these; do not change App.js routing).
- Test runner: Vitest. Run a single test file with `npx vitest run <path>` from `demo_api_ui/`.
- Theming must be scoped to the console container element — do NOT set `--brand-*` or write to `document.documentElement` (that belongs to `VerticalProvider`/`applyThemeTokens`).
- Do not introduce new dependencies.

---

## File Structure

- Create: `demo_api_ui/src/components/verticalOps/verticalOpsConfig.js` — the five vertical configs + a `getVerticalConfig(id)` accessor. Pure data + small adapter functions. One responsibility: describe each vertical.
- Create: `demo_api_ui/src/components/verticalOps/buildTimeline.js` — derive a record's activity timeline (client-side, v1).
- Create: `demo_api_ui/src/components/verticalOps/RecordDrawer.jsx` — slide-over: record detail, action buttons, "Ask the assistant" stub, activity timeline.
- Create: `demo_api_ui/src/components/verticalOps/VerticalOpsConsole.jsx` — the console: hero + lookup, summary card, category grid; owns drawer open state.
- Create: `demo_api_ui/src/components/verticalOps/VerticalOpsConsole.css` — scoped, themed styles.
- Modify: `demo_api_ui/src/components/BankingAdminOps.js`, `HealthcareAdminOps.js`, `RetailAdminOps.js`, `SportingGoodsAdminOps.js`, `WorkforceAdminOps.js` — replace bodies with thin wrappers.
- Create tests under `demo_api_ui/src/components/verticalOps/__tests__/`.

**Lookup response shapes (from backend):**
- Verticals healthcare/retail/sporting-goods/workforce: `{ user: { id, username, name, email }, query, vertical, data: { <slice>: array|null } }`.
- Banking is account-centric (`routes/admin.js`): `{ accounts: [...], transactions: [...] }` — NO `user`/`data` wrapper. Its adapter synthesizes a customer summary from the search.

---

### Task 1: Vertical config module

**Files:**
- Create: `demo_api_ui/src/components/verticalOps/verticalOpsConfig.js`
- Test: `demo_api_ui/src/components/verticalOps/__tests__/verticalOpsConfig.test.js`

**Interfaces:**
- Produces:
  - `VERTICAL_ORDER: string[]` = `['banking','healthcare','retail','sporting-goods','workforce']`
  - `getVerticalConfig(id: string): VerticalConfig`
  - `VerticalConfig` = `{ id, name, short, icon, theme:{accent,accent2,tint}, lookupPath:string, lookupPlaceholder:string, adaptLookup(resp)=>{customer, categories}, actions: Record<string,{method,buildUrl(row,customer),body?(row,customer)}> }`
  - `customer` = `{ name, sub, avatar, stats: [string,string][] }` or `null`
  - `categories` = `[{ id, label, icon, rows:[{ id, title, sub, status, tone, actions:string[] }] }]`

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/verticalOpsConfig.test.js
import { VERTICAL_ORDER, getVerticalConfig } from '../verticalOpsConfig';

describe('verticalOpsConfig', () => {
  it('has all five verticals in order', () => {
    expect(VERTICAL_ORDER).toEqual(['banking','healthcare','retail','sporting-goods','workforce']);
  });

  it('each config has required fields and a theme', () => {
    for (const id of VERTICAL_ORDER) {
      const c = getVerticalConfig(id);
      expect(c.id).toBe(id);
      expect(typeof c.name).toBe('string');
      expect(c.theme.accent).toMatch(/^#/);
      expect(c.lookupPath).toBe(`/api/admin/${id}/lookup`);
      expect(typeof c.adaptLookup).toBe('function');
    }
  });

  it('healthcare adaptLookup maps the user + data slices into customer + categories', () => {
    const c = getVerticalConfig('healthcare');
    const out = c.adaptLookup({
      user: { id: 'u1', name: 'Maya Chen', email: 'maya@x.com', username: 'maya' },
      data: { appointments: [{ id: 'a1', provider: 'Dr Park', reason: 'Follow-up', status: 'Scheduled' }], medications: null },
    });
    expect(out.customer.name).toBe('Maya Chen');
    const appts = out.categories.find((x) => x.id === 'appointments');
    expect(appts.rows[0].id).toBe('a1');
    expect(appts.rows[0].actions).toContain('Cancel');
  });

  it('banking adaptLookup synthesizes a customer from account-centric response', () => {
    const c = getVerticalConfig('banking');
    const out = c.adaptLookup({ accounts: [{ id: 'ac1', accountNumber: '****4821', type: 'Checking', balance: 4210.55 }], transactions: [] });
    expect(out.categories.find((x) => x.id === 'accounts').rows[0].id).toBe('ac1');
    expect(out.customer).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/verticalOps/__tests__/verticalOpsConfig.test.js`
Expected: FAIL — "Cannot find module '../verticalOpsConfig'".

- [ ] **Step 3: Write the config module**

```javascript
// verticalOpsConfig.js
// Per-vertical operator console config. Pure data + lookup adapters that
// normalize each vertical's lookup response into { customer, categories }.

export const VERTICAL_ORDER = ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce'];

const money = (n) => (typeof n === 'number' ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : n);

// Map a status string to a badge tone.
function toneFor(status) {
  const s = String(status || '').toLowerCase();
  if (/(cancel|denied|unpaid|overdue|review|pending|refill needed|open|out)/.test(s)) return 'warn';
  if (/(active|scheduled|posted|paid|done|delivered|approved|released|resolved|completed)/.test(s)) return 'ok';
  return 'muted';
}

// Build a category from a slice array using a per-row mapper.
function category(id, label, icon, rows, mapRow) {
  const list = Array.isArray(rows) ? rows : [];
  return { id, label, icon, rows: list.map(mapRow) };
}

// ---- Healthcare-style adapter (user + data slices) ----
function userCentric(sliceDefs) {
  return (resp) => {
    if (!resp || !resp.user) return { customer: null, categories: [] };
    const u = resp.user;
    const data = resp.data || {};
    return {
      customer: {
        name: u.name || u.username,
        sub: `ID ${u.id}${u.email ? ' · ' + u.email : ''}`,
        avatar: (u.name || u.username || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
        stats: sliceDefs.map((d) => [d.label, String((data[d.slice] || []).length)]),
      },
      categories: sliceDefs.map((d) =>
        category(d.id, d.label, d.icon, data[d.slice], (r) => ({
          id: r.id,
          title: d.title(r),
          sub: d.sub(r),
          status: r.status || '—',
          tone: toneFor(r.status),
          actions: d.actions,
        }))
      ),
    };
  };
}

export const CONFIGS = {
  banking: {
    id: 'banking', name: 'Banking Ops', short: 'Banking', icon: '🏦',
    theme: { accent: '#2563eb', accent2: '#1e3a8a', tint: '#eef4ff' },
    lookupPath: '/api/admin/banking/lookup',
    lookupPlaceholder: 'Look up account by number or holder…',
    actions: {
      'Seed charge': { method: 'post', buildUrl: (row) => `/api/admin/banking/accounts/${encodeURIComponent(row.id)}/seed-charges` },
      'Delete': { method: 'delete', buildUrl: (row, _c, catId) => catId === 'transactions' ? `/api/transactions/${encodeURIComponent(row.id)}` : `/api/accounts/${encodeURIComponent(row.id)}` },
    },
    adaptLookup: (resp) => {
      const accounts = (resp && resp.accounts) || [];
      const txns = (resp && resp.transactions) || [];
      const total = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
      return {
        customer: accounts.length ? {
          name: accounts[0].holderName || 'Account holder',
          sub: `${accounts.length} account(s)`,
          avatar: 'AC',
          stats: [['Total balance', money(total)], ['Accounts', String(accounts.length)], ['Txns', String(txns.length)]],
        } : null,
        categories: [
          category('accounts', 'Accounts', '💳', accounts, (a) => ({ id: a.id, title: `${a.type || 'Account'} · ${a.accountNumber}`, sub: `Balance ${money(Number(a.balance))}`, status: a.status || 'Active', tone: toneFor(a.status || 'Active'), actions: ['Seed charge', 'Delete'] })),
          category('transactions', 'Transactions', '🔁', txns, (t) => ({ id: t.id, title: t.description || t.type || 'Transaction', sub: `${t._accountNumber || ''} · ${money(Number(t.amount))}`, status: t.status || 'Posted', tone: toneFor(t.status), actions: ['Delete'] })),
        ],
      };
    },
  },
  healthcare: {
    id: 'healthcare', name: 'Healthcare Ops', short: 'Healthcare', icon: '🩺',
    theme: { accent: '#0d9488', accent2: '#115e59', tint: '#ecfdf9' },
    lookupPath: '/api/admin/healthcare/lookup',
    lookupPlaceholder: 'Look up a patient by name, email, or id…',
    actions: {
      'Cancel': { method: 'post', buildUrl: (row, _c, catId) => `/api/admin/healthcare/${catId === 'referrals' ? 'referrals' : 'appointments'}/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Pay bill': { method: 'post', buildUrl: (row) => `/api/admin/healthcare/bills/${encodeURIComponent(row.id)}/pay`, body: (_r, c) => ({ userId: c.id }) },
      'Refill': { method: 'post', buildUrl: (row) => `/api/admin/healthcare/medications/${encodeURIComponent(row.id)}/refill`, body: (_r, c) => ({ userId: c.id }) },
      'Release': { method: 'post', buildUrl: (row) => `/api/admin/healthcare/records/${encodeURIComponent(row.id)}/release`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'appointments', slice: 'appointments', label: 'Appointments', icon: '📅', title: (r) => r.reason || 'Appointment', sub: (r) => `${r.date || ''} · ${r.provider || ''}`, actions: ['Cancel'] },
      { id: 'medications', slice: 'medications', label: 'Medications', icon: '💊', title: (r) => r.name || 'Medication', sub: (r) => `${r.dosage || ''} · ${r.frequency || ''}`, actions: ['Refill'] },
      { id: 'billing', slice: 'billingHistory', label: 'Billing', icon: '🧾', title: (r) => r.description || 'Bill', sub: (r) => money(Number(r.amount)), actions: ['Pay bill'] },
      { id: 'records', slice: 'patientRecords', label: 'Records', icon: '📁', title: (r) => r.type || 'Record', sub: (r) => r.provider || '', actions: ['Release'] },
      { id: 'referrals', slice: 'referrals', label: 'Referrals', icon: '➡️', title: (r) => r.specialty || 'Referral', sub: (r) => r.provider || '', actions: ['Cancel'] },
    ]),
  },
  retail: {
    id: 'retail', name: 'Retail Ops', short: 'Retail', icon: '🛍️',
    theme: { accent: '#ea580c', accent2: '#9a3412', tint: '#fff3ec' },
    lookupPath: '/api/admin/retail/lookup',
    lookupPlaceholder: 'Look up a shopper by name, email, or id…',
    actions: {
      'Cancel order': { method: 'post', buildUrl: (row) => `/api/admin/retail/orders/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Cancel sub': { method: 'post', buildUrl: (row) => `/api/admin/retail/subscriptions/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Resolve': { method: 'post', buildUrl: (row) => `/api/admin/retail/tickets/${encodeURIComponent(row.id)}/resolve`, body: (_r, c) => ({ userId: c.id }) },
      'Approve': { method: 'post', buildUrl: (row) => `/api/admin/retail/returns/${encodeURIComponent(row.id)}/approve`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'orders', slice: 'orders', label: 'Orders', icon: '📦', title: (r) => r.summary || `Order ${r.id}`, sub: (r) => money(Number(r.total)), actions: ['Cancel order'] },
      { id: 'returns', slice: 'returns', label: 'Returns', icon: '↩️', title: (r) => r.reason || `Return ${r.id}`, sub: (r) => money(Number(r.amount)), actions: ['Approve'] },
      { id: 'subscriptions', slice: 'subscriptions', label: 'Subscriptions', icon: '🔄', title: (r) => r.plan || 'Subscription', sub: (r) => r.cadence || '', actions: ['Cancel sub'] },
      { id: 'support_tickets', slice: 'support_tickets', label: 'Support', icon: '🎧', title: (r) => r.subject || 'Ticket', sub: (r) => r.opened || '', actions: ['Resolve'] },
      { id: 'rewards', slice: 'rewards', label: 'Rewards', icon: '⭐', title: (r) => r.tier || 'Rewards', sub: (r) => `${r.points || 0} pts`, actions: [] },
    ]),
  },
  'sporting-goods': {
    id: 'sporting-goods', name: 'Sporting Goods Ops', short: 'Sporting', icon: '🏅',
    theme: { accent: '#16a34a', accent2: '#14532d', tint: '#edfcef' },
    lookupPath: '/api/admin/sporting-goods/lookup',
    lookupPlaceholder: 'Look up a member by name, email, or id…',
    actions: {
      'Cancel order': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/orders/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
      'Return': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/rentals/${encodeURIComponent(row.id)}/return`, body: (_r, c) => ({ userId: c.id }) },
      'Resolve': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/tickets/${encodeURIComponent(row.id)}/resolve`, body: (_r, c) => ({ userId: c.id }) },
      'Cancel coaching': { method: 'post', buildUrl: (row) => `/api/admin/sporting-goods/coaching/${encodeURIComponent(row.id)}/cancel`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'orders', slice: 'orders', label: 'Orders', icon: '📦', title: (r) => r.summary || `Order ${r.id}`, sub: (r) => money(Number(r.total)), actions: ['Cancel order'] },
      { id: 'rentals', slice: 'rentals', label: 'Rentals', icon: '🎿', title: (r) => r.item || 'Rental', sub: (r) => r.dueBack || '', actions: ['Return'] },
      { id: 'coaching_sessions', slice: 'coaching_sessions', label: 'Coaching', icon: '🏃', title: (r) => r.title || 'Session', sub: (r) => r.when || '', actions: ['Cancel coaching'] },
      { id: 'support_tickets', slice: 'support_tickets', label: 'Support', icon: '🎧', title: (r) => r.subject || 'Ticket', sub: (r) => r.opened || '', actions: ['Resolve'] },
      { id: 'loyalty', slice: 'loyalty', label: 'Loyalty', icon: '⭐', title: (r) => r.tier || 'Loyalty', sub: (r) => `${r.points || 0} pts`, actions: [] },
    ]),
  },
  workforce: {
    id: 'workforce', name: 'Workforce Ops', short: 'Workforce', icon: '🧑‍💼',
    theme: { accent: '#7c3aed', accent2: '#4c1d95', tint: '#f5f0ff' },
    lookupPath: '/api/admin/workforce/lookup',
    lookupPlaceholder: 'Look up an employee by name, email, or id…',
    actions: {
      'Approve': { method: 'post', buildUrl: (row) => `/api/admin/workforce/expenses/${encodeURIComponent(row.id)}/approve`, body: (_r, c) => ({ userId: c.id }) },
      'Deny': { method: 'post', buildUrl: (row) => `/api/admin/workforce/expenses/${encodeURIComponent(row.id)}/deny`, body: (_r, c) => ({ userId: c.id }) },
      'Resolve': { method: 'post', buildUrl: (row) => `/api/admin/workforce/tickets/${encodeURIComponent(row.id)}/resolve`, body: (_r, c) => ({ userId: c.id }) },
      'Complete': { method: 'post', buildUrl: (row) => `/api/admin/workforce/trainings/${encodeURIComponent(row.id)}/complete`, body: (_r, c) => ({ userId: c.id }) },
    },
    adaptLookup: userCentric([
      { id: 'expenses', slice: 'expenses', label: 'Expenses', icon: '💵', title: (r) => r.description || 'Expense', sub: (r) => money(Number(r.amount)), actions: ['Approve', 'Deny'] },
      { id: 'tickets', slice: 'tickets', label: 'IT Tickets', icon: '🛠️', title: (r) => r.subject || 'Ticket', sub: (r) => r.priority || '', actions: ['Resolve'] },
      { id: 'trainings', slice: 'trainings', label: 'Training', icon: '🎓', title: (r) => r.name || 'Training', sub: (r) => r.due || '', actions: ['Complete'] },
      { id: 'pto', slice: 'pto', label: 'PTO', icon: '🌴', title: (r) => r.kind || 'PTO', sub: (r) => r.range || '', actions: [] },
      { id: 'benefits', slice: 'benefits', label: 'Benefits', icon: '🏥', title: (r) => r.plan || 'Benefit', sub: (r) => r.status || '', actions: [] },
    ]),
  },
};

export function getVerticalConfig(id) {
  const c = CONFIGS[id];
  if (!c) throw new Error(`Unknown vertical: ${id}`);
  return c;
}
```

> NOTE: slice field names (e.g. `r.reason`, `r.provider`, `r.total`) are best-effort against the demo data store. During implementation, log one real lookup response per vertical and adjust the `title`/`sub`/`stats` getters to the actual field names. The config is the ONLY place these change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/verticalOps/__tests__/verticalOpsConfig.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/verticalOps/verticalOpsConfig.js src/components/verticalOps/__tests__/verticalOpsConfig.test.js
git commit -m "feat(ops-console): per-vertical config + lookup adapters"
```

---

### Task 2: Activity timeline deriver

**Files:**
- Create: `demo_api_ui/src/components/verticalOps/buildTimeline.js`
- Test: `demo_api_ui/src/components/verticalOps/__tests__/buildTimeline.test.js`

**Interfaces:**
- Produces: `buildTimeline(row: {status?:string, createdAt?:string}, customerName: string): {title:string, when:string}[]`

> v1 decision (deviates from spec §6 "log-backed default"): derive the timeline client-side from the record (viewed / last-status / created). No new endpoint. Activity-log enrichment is a follow-up (tracked in the spec §8). This keeps the console plan frontend-only and shippable.

- [ ] **Step 1: Write the failing test**

```javascript
import { buildTimeline } from '../buildTimeline';

describe('buildTimeline', () => {
  it('returns viewed + status + created events newest-first', () => {
    const tl = buildTimeline({ status: 'Scheduled', createdAt: '2026-06-24' }, 'Maya Chen');
    expect(tl[0].title).toMatch(/viewed/i);
    expect(tl.some((e) => /Scheduled/.test(e.title))).toBe(true);
    expect(tl[tl.length - 1].title).toMatch(/created/i);
  });

  it('omits the created event when no createdAt', () => {
    const tl = buildTimeline({ status: 'Active' }, 'X');
    expect(tl.some((e) => /created/i.test(e.title))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/verticalOps/__tests__/buildTimeline.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// buildTimeline.js
export function buildTimeline(row = {}, customerName = 'this customer') {
  const events = [{ title: 'Record viewed by operator', when: 'just now' }];
  if (row.status) events.push({ title: `Status is “${row.status}”`, when: 'current' });
  if (row.createdAt) events.push({ title: `Record created for ${customerName}`, when: String(row.createdAt) });
  return events;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/verticalOps/__tests__/buildTimeline.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/verticalOps/buildTimeline.js src/components/verticalOps/__tests__/buildTimeline.test.js
git commit -m "feat(ops-console): client-side record timeline deriver"
```

---

### Task 3: RecordDrawer component

**Files:**
- Create: `demo_api_ui/src/components/verticalOps/RecordDrawer.jsx`
- Test: `demo_api_ui/src/components/verticalOps/__tests__/RecordDrawer.test.jsx`

**Interfaces:**
- Consumes: `buildTimeline` (Task 2).
- Produces: `default function RecordDrawer({ open, vertical, category, row, customer, onClose, onAction })` where `onAction(actionLabel, row, category)` is called when an action button is clicked. Renders nothing structural when `open` is false (still mounted, `aria-hidden`).

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import RecordDrawer from '../RecordDrawer';

const row = { id: 'a1', title: 'Premier Checking', sub: 'Balance $4,210.55', status: 'Active', tone: 'ok', actions: ['Seed charge', 'Delete'] };
const category = { id: 'accounts', label: 'Accounts', icon: '💳' };
const customer = { name: 'Jordan Rivera' };

it('renders record detail, actions, and a timeline when open', () => {
  render(<RecordDrawer open vertical="banking" category={category} row={row} customer={customer} onClose={() => {}} onAction={() => {}} />);
  expect(screen.getByText('Premier Checking')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Seed charge' })).toBeInTheDocument();
  expect(screen.getByText(/viewed by operator/i)).toBeInTheDocument();
});

it('calls onAction with the label, row, and category id', () => {
  const onAction = jest.fn();
  render(<RecordDrawer open vertical="banking" category={category} row={row} customer={customer} onClose={() => {}} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: 'Seed charge' }));
  expect(onAction).toHaveBeenCalledWith('Seed charge', row, 'accounts');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/verticalOps/__tests__/RecordDrawer.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// RecordDrawer.jsx
import React from 'react';
import { buildTimeline } from './buildTimeline';

export default function RecordDrawer({ open, category, row, customer, onClose, onAction }) {
  if (!open || !row) return <div className="vops-scrim" aria-hidden="true" />;
  return (
    <>
      <div className="vops-scrim vops-scrim--open" onClick={onClose} aria-hidden="true" />
      <aside className="vops-drawer vops-drawer--open" role="dialog" aria-label={row.title}>
        <header className="vops-drawer__head">
          <button className="vops-drawer__x" onClick={onClose} aria-label="Close">✕</button>
          <div className="vops-drawer__cat">{category.icon} {category.label}</div>
          <div className="vops-drawer__title">{row.title}</div>
        </header>
        <div className="vops-drawer__body">
          <div className="vops-kv"><span>Status</span><b>{row.status}</b></div>
          <div className="vops-kv"><span>Detail</span><b>{row.sub}</b></div>
          <div className="vops-kv"><span>Owner</span><b>{customer?.name || '—'}</b></div>
          <div className="vops-drawer__acts">
            {row.actions.map((a, i) => (
              <button key={a} className={i === 0 ? 'vops-btn vops-btn--primary' : 'vops-btn'} onClick={() => onAction(a, row, category.id)}>{a}</button>
            ))}
          </div>
          {/* Ops Assistant stub — wired in the Ops Assistant plan */}
          <div className="vops-assistant-stub" data-testid="ops-assistant-slot" />
          <p className="vops-tl__h">Activity</p>
          <div className="vops-tl">
            {buildTimeline(row, customer?.name).map((e, i) => (
              <div className="vops-tl__e" key={i}><div className="vops-tl__t">{e.title}</div><div className="vops-tl__s">{e.when}</div></div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/verticalOps/__tests__/RecordDrawer.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/verticalOps/RecordDrawer.jsx src/components/verticalOps/__tests__/RecordDrawer.test.jsx
git commit -m "feat(ops-console): record drawer with detail, actions, timeline"
```

---

### Task 4: VerticalOpsConsole — hero, lookup, grid, drawer wiring

**Files:**
- Create: `demo_api_ui/src/components/verticalOps/VerticalOpsConsole.jsx`
- Create: `demo_api_ui/src/components/verticalOps/VerticalOpsConsole.css`
- Test: `demo_api_ui/src/components/verticalOps/__tests__/VerticalOpsConsole.test.jsx`

**Interfaces:**
- Consumes: `getVerticalConfig` (Task 1), `RecordDrawer` (Task 3), `bffAxios`, `notify*`.
- Produces: `default function VerticalOpsConsole({ vertical, user, onLogout })`.

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VerticalOpsConsole from '../VerticalOpsConsole';

jest.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('../../../utils/appToast', () => ({ notifySuccess: jest.fn(), notifyError: jest.fn(), notifyWarning: jest.fn(), notifyInfo: jest.fn() }));
import bffAxios from '../../../services/bffAxios';

it('renders the vertical hero and applies the accent theme var', () => {
  const { container } = render(<VerticalOpsConsole vertical="healthcare" user={{ role: 'user' }} />);
  expect(screen.getByText('Healthcare Ops')).toBeInTheDocument();
  const rootEl = container.querySelector('.vops');
  expect(rootEl.style.getPropertyValue('--accent')).toBe('#0d9488');
});

it('looks up a customer and renders category cards from the response', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: { user: { id: 'u1', name: 'Maya Chen' }, data: { appointments: [{ id: 'a1', reason: 'Follow-up', status: 'Scheduled' }] } } });
  render(<VerticalOpsConsole vertical="healthcare" user={{ role: 'user' }} />);
  fireEvent.change(screen.getByPlaceholderText(/Look up a patient/i), { target: { value: 'maya' } });
  fireEvent.submit(screen.getByTestId('vops-lookup-form'));
  await waitFor(() => expect(screen.getByText('Maya Chen')).toBeInTheDocument());
  expect(bffAxios.get).toHaveBeenCalledWith('/api/admin/healthcare/lookup', { params: { q: 'maya' } });
  expect(screen.getByText('Appointments')).toBeInTheDocument();
  expect(screen.getByText('Follow-up')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/verticalOps/__tests__/VerticalOpsConsole.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```jsx
// VerticalOpsConsole.jsx
import React, { useState, useCallback } from 'react';
import bffAxios from '../../services/bffAxios';
import { notifySuccess, notifyError } from '../../utils/appToast';
import { getVerticalConfig } from './verticalOpsConfig';
import RecordDrawer from './RecordDrawer';
import './VerticalOpsConsole.css';

export default function VerticalOpsConsole({ vertical }) {
  const cfg = getVerticalConfig(vertical);
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null); // { customer, categories }
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(null);  // { category, row }

  const doLookup = useCallback(async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    try {
      const { data } = await bffAxios.get(cfg.lookupPath, { params: { q } });
      setResult(cfg.adaptLookup(data));
    } catch (err) {
      const st = err?.response?.status;
      notifyError(st === 401 ? 'Session expired — please sign in again.' : 'Lookup failed.');
      setResult(null);
    } finally { setLoading(false); }
  }, [q, cfg]);

  const runAction = useCallback(async (label, row, catId) => {
    const action = cfg.actions[label];
    if (!action) return;
    try {
      const url = action.buildUrl(row, result?.customer, catId);
      const body = action.body ? action.body(row, result?.customer) : undefined;
      if (action.method === 'delete') await bffAxios.delete(url);
      else await bffAxios.post(url, body);
      notifySuccess(`${label} done.`);
      if (drawer) setDrawer(null);
      await doLookup({ preventDefault() {} });
    } catch (err) {
      notifyError(err?.response?.data?.error || `${label} failed.`);
    }
  }, [cfg, result, drawer, doLookup]);

  const theme = { '--accent': cfg.theme.accent, '--accent2': cfg.theme.accent2, '--tint': cfg.theme.tint };

  return (
    <div className="vops" style={theme}>
      <header className="vops__hero">
        <div className="vops__brand"><span className="vops__icon">{cfg.icon}</span><h1>{cfg.name}</h1></div>
        <form className="vops__lookup" data-testid="vops-lookup-form" onSubmit={doLookup}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={cfg.lookupPlaceholder} aria-label="Lookup" />
          <button type="submit" disabled={loading}>{loading ? '…' : 'Look up'}</button>
        </form>
      </header>

      {result?.customer && (
        <section className="vops__summary">
          <div className="vops__avatar">{result.customer.avatar}</div>
          <div><div className="vops__name">{result.customer.name}</div><div className="vops__sub">{result.customer.sub}</div></div>
          <div className="vops__stats">
            {result.customer.stats.map(([k, v]) => (<div key={k} className="vops__stat"><div className="vops__statv">{v}</div><div className="vops__statk">{k}</div></div>))}
          </div>
        </section>
      )}

      {result && (
        <section className="vops__grid">
          {result.categories.map((c) => (
            <div className="vops__card" key={c.id}>
              <div className="vops__cardhead"><span>{c.icon}</span><b>{c.label}</b><span className="vops__count">{c.rows.length}</span></div>
              {c.rows.map((r) => (
                <div className="vops__item" key={r.id} onClick={() => setDrawer({ category: c, row: r })}>
                  <div className="vops__itemmain"><div className="vops__ititle">{r.title}</div><div className="vops__isub">{r.sub}</div></div>
                  <span className={`vops__badge vops__badge--${r.tone}`}>{r.status}</span>
                  <div className="vops__acts" onClick={(e) => e.stopPropagation()}>
                    {r.actions.map((a) => (<button key={a} onClick={() => runAction(a, r, c.id)}>{a}</button>))}
                  </div>
                </div>
              ))}
              {c.rows.length === 0 && <div className="vops__empty">No {c.label.toLowerCase()}.</div>}
            </div>
          ))}
        </section>
      )}

      <RecordDrawer open={!!drawer} vertical={vertical} category={drawer?.category || {}} row={drawer?.row} customer={result?.customer} onClose={() => setDrawer(null)} onAction={runAction} />
    </div>
  );
}
```

```css
/* VerticalOpsConsole.css — scoped to .vops; uses local --accent/--accent2/--tint only */
.vops { --accent:#2563eb; --accent2:#1e3a8a; --tint:#eef4ff; color:#1a2230; }
.vops__hero { background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#fff; padding:20px 28px 56px; }
.vops__brand { display:flex; align-items:center; gap:12px; } .vops__brand h1 { font-size:20px; margin:0; }
.vops__icon { width:40px;height:40px;border-radius:12px;background:#ffffff26;display:grid;place-items:center;font-size:20px; }
.vops__lookup { margin-top:16px; display:flex; gap:8px; max-width:560px; }
.vops__lookup input { flex:1; border:0; border-radius:10px; padding:12px 14px; font-size:14px; }
.vops__lookup button { border:0; border-radius:10px; padding:0 18px; font-weight:700; background:#ffffff; color:var(--accent2); cursor:pointer; }
.vops__summary { max-width:1080px; margin:-36px auto 8px; background:#fff; border:1px solid #eef0f6; border-radius:16px; padding:16px 20px; display:flex; align-items:center; gap:16px; box-shadow:0 16px 40px -24px #1a223040; }
.vops__avatar { width:52px;height:52px;border-radius:14px;background:var(--tint);color:var(--accent2);display:grid;place-items:center;font-weight:800; }
.vops__name { font-weight:800; } .vops__sub { color:#69748a; font-size:13px; }
.vops__stats { margin-left:auto; display:flex; gap:24px; }
.vops__statv { font-weight:800; color:var(--accent2); } .vops__statk { font-size:11px; color:#8a94a6; text-transform:uppercase; }
.vops__grid { max-width:1080px; margin:18px auto 40px; padding:0 12px; display:grid; grid-template-columns:repeat(2,1fr); gap:16px; }
.vops__card { background:#fff; border:1px solid #eceef5; border-radius:14px; overflow:hidden; }
.vops__cardhead { display:flex; align-items:center; gap:8px; padding:12px 16px; border-bottom:1px solid #f0f1f7; }
.vops__count { margin-left:auto; font-size:11px; font-weight:700; color:var(--accent2); background:var(--tint); padding:2px 9px; border-radius:99px; }
.vops__item { display:flex; align-items:center; gap:10px; padding:11px 16px; border-bottom:1px solid #f5f6fa; cursor:pointer; }
.vops__item:hover { background:var(--tint); } .vops__itemmain { flex:1; } .vops__ititle { font-weight:600; font-size:13px; } .vops__isub { color:#7a8498; font-size:12px; }
.vops__badge { font-size:11px; padding:3px 9px; border-radius:99px; font-weight:700; }
.vops__badge--ok { background:#e7f7f0; color:#0f9d6b; } .vops__badge--warn { background:#fdf1dd; color:#c77c14; } .vops__badge--muted { background:#eef0f6; color:#69748a; }
.vops__acts button { background:#fff; border:1px solid #dfe3ee; color:#404a5e; font-size:12px; padding:5px 10px; border-radius:8px; margin-left:6px; cursor:pointer; }
.vops__empty { padding:14px 16px; color:#8a94a6; font-size:13px; }
/* drawer */
.vops-scrim { position:fixed; inset:0; background:#1a223066; opacity:0; pointer-events:none; transition:.2s; z-index:1040; }
.vops-scrim--open { opacity:1; pointer-events:auto; }
.vops-drawer { position:fixed; top:0; right:0; height:100vh; width:440px; max-width:92vw; background:#fff; transform:translateX(100%); transition:.25s; z-index:1041; overflow:auto; box-shadow:-20px 0 60px -30px #1a223080; }
.vops-drawer--open { transform:translateX(0); }
.vops-drawer__head { background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#fff; padding:18px 20px; position:relative; }
.vops-drawer__x { position:absolute; top:14px; right:16px; background:#ffffff33; border:0; color:#fff; width:30px;height:30px;border-radius:8px; cursor:pointer; }
.vops-drawer__cat { font-size:12px; opacity:.85; text-transform:uppercase; } .vops-drawer__title { font-weight:800; font-size:18px; margin-top:4px; }
.vops-drawer__body { padding:18px 20px; }
.vops-kv { display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid #f1f2f8; font-size:13px; } .vops-kv span { color:#8a94a6; }
.vops-drawer__acts { display:flex; gap:8px; flex-wrap:wrap; margin:16px 0; }
.vops-btn { border:1px solid #dfe3ee; background:#fff; color:#404a5e; border-radius:9px; padding:9px 14px; font-weight:700; font-size:13px; cursor:pointer; }
.vops-btn--primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.vops-tl__h { font-size:11px; text-transform:uppercase; color:#8a94a6; margin:18px 0 12px; }
.vops-tl { border-left:2px solid #eceef5; margin-left:5px; padding-left:18px; }
.vops-tl__e { position:relative; padding-bottom:14px; } .vops-tl__e::before { content:""; position:absolute; left:-25px; top:3px; width:10px;height:10px;border-radius:99px; background:var(--accent); box-shadow:0 0 0 3px var(--tint); }
.vops-tl__t { font-weight:600; font-size:13px; } .vops-tl__s { font-size:12px; color:#7a8498; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/verticalOps/__tests__/VerticalOpsConsole.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/verticalOps/VerticalOpsConsole.jsx src/components/verticalOps/VerticalOpsConsole.css src/components/verticalOps/__tests__/VerticalOpsConsole.test.jsx
git commit -m "feat(ops-console): VerticalOpsConsole — hero, lookup, grid, actions, drawer"
```

---

### Task 5: Convert the five page components to thin wrappers

**Files:**
- Modify: `demo_api_ui/src/components/BankingAdminOps.js`
- Modify: `demo_api_ui/src/components/HealthcareAdminOps.js`
- Modify: `demo_api_ui/src/components/RetailAdminOps.js`
- Modify: `demo_api_ui/src/components/SportingGoodsAdminOps.js`
- Modify: `demo_api_ui/src/components/WorkforceAdminOps.js`
- Test: `demo_api_ui/src/components/verticalOps/__tests__/pageWrappers.test.jsx`

**Interfaces:**
- Consumes: `VerticalOpsConsole` (Task 4).
- Produces: each file keeps its default export name/signature `({ user, onLogout })` so `App.js` imports and routes are unchanged.

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen } from '@testing-library/react';
jest.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('../../../utils/appToast', () => ({ notifySuccess: jest.fn(), notifyError: jest.fn(), notifyWarning: jest.fn(), notifyInfo: jest.fn() }));
import BankingAdminOps from '../../BankingAdminOps';
import WorkforceAdminOps from '../../WorkforceAdminOps';

it('BankingAdminOps renders the Banking console', () => {
  render(<BankingAdminOps user={{ role: 'user' }} onLogout={() => {}} />);
  expect(screen.getByText('Banking Ops')).toBeInTheDocument();
});
it('WorkforceAdminOps renders the Workforce console', () => {
  render(<WorkforceAdminOps user={{ role: 'user' }} onLogout={() => {}} />);
  expect(screen.getByText('Workforce Ops')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/verticalOps/__tests__/pageWrappers.test.jsx`
Expected: FAIL — current components render the old 3-column layout, not "Banking Ops"/"Workforce Ops" headings (or fail on removed imports).

- [ ] **Step 3: Replace each file body with a wrapper**

`BankingAdminOps.js` (apply the analogous one-liner to each of the five, changing only the `vertical` value: `banking`, `healthcare`, `retail`, `sporting-goods`, `workforce`):

```jsx
import React from 'react';
import VerticalOpsConsole from './verticalOps/VerticalOpsConsole';

export default function BankingAdminOps({ user, onLogout }) {
  return <VerticalOpsConsole vertical="banking" user={user} onLogout={onLogout} />;
}
```

> Removing the old bodies drops the imports of `AIAgent`, `TokenChainDisplay`, `ExchangeModeToggle`, `PageNav`, `LookupUserChips`, and `BankingAdminOps.css` from these files — that is intended (token-chain + embedded agent are gone). Leave those shared components in the repo; other pages may use them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/verticalOps/__tests__/pageWrappers.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full ops test set + commit**

Run: `npx vitest run src/components/verticalOps`
Expected: PASS (all suites).

```bash
git add src/components/BankingAdminOps.js src/components/HealthcareAdminOps.js src/components/RetailAdminOps.js src/components/SportingGoodsAdminOps.js src/components/WorkforceAdminOps.js src/components/verticalOps/__tests__/pageWrappers.test.jsx
git commit -m "feat(ops-console): route the five ops pages through VerticalOpsConsole"
```

---

### Task 6: Manual verification in the running app

**Files:** none (verification only).

- [ ] **Step 1: Field-name reconciliation**

For each vertical, perform a real lookup and confirm card titles/subs/stats are populated. Where a field shows `undefined`/blank, fix the getter in `verticalOpsConfig.js` to match the real slice field name, then re-run `npx vitest run src/components/verticalOps`.

- [ ] **Step 2: Visual + behavior check**

Per the Docker setup (UI is Vite HMR on :4000), hard-refresh and as a customer visit `/admin/banking`, `/admin/healthcare`, `/admin/retail`, `/admin/sporting-goods`, `/admin/workforce`. Confirm: distinct theme per vertical; lookup populates the grid; clicking a row opens the drawer with timeline; an action button succeeds and refreshes; no token-chain panel or embedded agent remains.

- [ ] **Step 3: Commit any config fixes**

```bash
git add src/components/verticalOps/verticalOpsConfig.js
git commit -m "fix(ops-console): align config field getters to live lookup data"
```

---

## Self-Review

- **Spec coverage:** Direction B layout (Task 4) ✓; per-vertical theme distinct (Task 1 theme + Task 4 scoped vars) ✓; record drawer + activity timeline (Tasks 2,3) ✓; lookup + actions reuse existing endpoints (Task 1 mappings, Task 4 wiring) ✓; agent demoted (Task 5 removes embedded agent; drawer has assistant slot) ✓; five pages share one console (Task 5) ✓; `/admin` untouched ✓. Timeline data source: v1 client-derived — documented deviation from spec §6 default, enrichment deferred to spec §8.
- **Placeholder scan:** none — all steps contain real code/commands. Field-name caveat is explicitly handled in Task 6.
- **Type consistency:** `adaptLookup`→`{customer, categories}`, `category.rows[].{id,title,sub,status,tone,actions}`, `onAction(label,row,catId)`, `actions[label].{method,buildUrl,body}` are consistent across Tasks 1, 3, 4, 5.
