# PingOne Authorize Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a PingOne Authorize dashboard at `/monitoring/p1az` showing real PERMIT/DENY decisions, backed by a generalized New Relic view registry that the two planned gateway dashboards will reuse.

**Architecture:** The BFF's single-purpose `/api/newrelic/pipeline` becomes `/api/newrelic/view/:view` with a server-side registry of named NRQL sets — the client still sends only a key, never a query. The UI extracts three shared components out of `NewRelicDashboard` and both pages compose them.

**Tech Stack:** Express + jest + supertest (BFF, CommonJS) · React 19.2 + Vite 8 + **vitest** (UI, not jest) · `apiClient` for HTTP · inline SVG (no chart library)

## Global Constraints

- **Worktree only.** Branch `worktree-p1az-dashboard-spec`. A hard-block hook denies `Write`/`Edit` in the main checkout.
- **Stage explicitly** — `git add <files>`. NEVER `git add -A`; a BFF jest run rewrites hundreds of files under `demo_api_server/data/step-verification/`.
- **Emoji allowlist (REGRESSION_PLAN §0):** only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. Severity/decision indicators use CSS, never emoji.
- **UI build gate (§0):** `cd demo_api_ui && npm run build` must exit 0. A green test run is not enough.
- **UI uses vitest** (`vi.*`), never `jest.*`. BFF uses jest.
- **UI HTTP goes through `apiClient`**, never bare `axios` in a component.
- **No new npm dependencies.**
- **Dark mode:** every new component must paint its own `background` from a `--*-ground` token defined in **both** themes, keyed to `:root[data-theme="dark"]` — never `prefers-color-scheme`. This is the #1484 regression.
- Pages and proxy stay **public** — no `authenticateToken`, no session checks.

### Spec correction (verified during planning)

The spec lists "populate `decisionId`" as an emit-site addition. **No code change is
possible or needed:** `pingOneAuthorizeService.js:459` already does
`raw.id || raw.decisionId || null` and `routes/authorize.js` already threads it into
the event metadata. It arrives `null` because PingOne's decision response carries no
id on this path — upstream behavior, not a gap. Only `latencyMs` is implemented.

---

## File Structure

| File | Responsibility |
|---|---|
| `demo_api_server/routes/newRelicQuery.js` | **Modify.** View registry, `7d` window, `/view/:view` route, `/pipeline` alias |
| `demo_api_server/tests/newRelicQuery.test.js` | **Modify.** Registry + window tests |
| `demo_api_server/routes/authorize.js` | **Modify.** `latencyMs` on the live-evaluate emit |
| `demo_api_server/tests/authorizeLatency.test.js` | **Create.** Asserts `latencyMs` is emitted |
| `demo_api_ui/src/components/dashboard/DashboardShell.jsx` | **Create.** Window selector, theme toggle, refresh, five states |
| `demo_api_ui/src/components/dashboard/StatStrip.jsx` | **Create.** Labelled counts with scaled bars |
| `demo_api_ui/src/components/dashboard/EventStream.jsx` | **Create.** Scrollable table |
| `demo_api_ui/src/components/dashboard/dashboard.css` | **Create.** Shared tokens + styles, both themes |
| `demo_api_ui/src/components/NewRelicDashboard.jsx` | **Modify.** Compose the shared components |
| `demo_api_ui/src/components/P1AzDashboard.jsx` | **Create.** The new page |
| `demo_api_ui/src/routes/MonitoringRoutes.js` | **Modify.** `P1AzRoute` |
| `demo_api_ui/src/App.js` | **Modify.** Register `/monitoring/p1az` |
| `demo_api_ui/src/components/AdminSideNav.jsx` | **Modify.** Nav entry after "PingOne Events" |

---

## Task 1: BFF view registry and 7d window

**Files:**
- Modify: `demo_api_server/routes/newRelicQuery.js`
- Modify: `demo_api_server/tests/newRelicQuery.test.js`

**Interfaces:**
- Produces: `GET /api/newrelic/view/:view?window=30m|1h|24h|7d` where `view ∈ {pipeline, authorize}`.
  - `pipeline` returns `{ view, window, funnel, timeseries, stream }` (unchanged shape).
  - `authorize` returns `{ view, window, decisions, posture, timeseries, stream }` where
    `decisions: Array<{decision: string, count: number}>`,
    `posture: Array<{tag: string, count: number}>`,
    `timeseries: Array<{beginTimeSeconds: number, count: number}>`,
    `stream: Array<{timestamp, tag, decision, amount, stepUpRequired, type, engine}>`.
  - `GET /api/newrelic/pipeline` remains, returning the pipeline payload.
  - Unknown view → 400 `{error:'invalid_view'}`. Unknown window → 400 `{error:'invalid_window'}`.
  Task 4 consumes the `authorize` shape verbatim.

- [ ] **Step 1: Bootstrap the worktree**

No `node_modules` in a fresh worktree; every test command fails without this.

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-dashboard-spec
ln -sfn /Users/cmuir/Development/AI-DEMO2/demo_api_server/node_modules demo_api_server/node_modules
ln -sfn /Users/cmuir/Development/AI-DEMO2/demo_api_ui/node_modules demo_api_ui/node_modules
ln -sfn /Users/cmuir/Development/AI-DEMO2/node_modules node_modules
```

Verify: `ls demo_api_server/node_modules/express/package.json` prints a path.

- [ ] **Step 2: Write the failing tests**

Append to `demo_api_server/tests/newRelicQuery.test.js`, inside the existing top-level scope (the file already has `jest.mock('axios')`, a module-scope `require` of the route, and `makeApp()`; reuse them):

```javascript
describe('GET /api/newrelic/view/:view', () => {
  function nerdgraphOk(account) {
    axios.post.mockResolvedValue({ data: { data: { actor: { account } } } });
  }

  it('400s on an unknown view', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    const res = await request(makeApp()).get('/api/newrelic/view/not-a-view');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_view');
  });

  it('accepts the 7d window', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] },
    });
    const res = await request(makeApp()).get('/api/newrelic/view/pipeline?window=7d');
    expect(res.status).toBe(200);
    expect(res.body.window).toBe('7d');
    const sent = axios.post.mock.calls[0][1].query;
    expect(sent).toContain('7 days ago');
    expect(sent).toContain('TIMESERIES 6 hours');
  });

  it('maps the authorize view into decisions/posture/timeseries/stream', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      decisions: { results: [{ decision: 'PERMIT', count: 1 }, { decision: 'DENY', count: 2 }] },
      posture: { results: [{ tag: 'authorize/fail-open', count: 1 }] },
      timeseries: { results: [{ beginTimeSeconds: 10, count: 3 }] },
      stream: { results: [{ timestamp: 1, tag: 'authorize/deny', decision: 'DENY', amount: 60000, stepUpRequired: false, type: 'transfer', engine: 'pingone' }] },
    });
    const res = await request(makeApp()).get('/api/newrelic/view/authorize?window=24h');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('authorize');
    expect(res.body.decisions).toHaveLength(2);
    expect(res.body.posture[0].tag).toBe('authorize/fail-open');
    expect(res.body.stream[0].amount).toBe(60000);
  });

  it("the authorize view queries category='authorize', not logtype", async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      decisions: { results: [] }, posture: { results: [] },
      timeseries: { results: [] }, stream: { results: [] },
    });
    await request(makeApp()).get('/api/newrelic/view/authorize');
    const sent = axios.post.mock.calls[0][1].query;
    expect(sent).toContain("category='authorize'");
    expect(sent).toContain('FACET decision');
    expect(sent).toContain('FACET tag');
  });

  it('caches per view, so authorize does not serve the pipeline payload', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] },
    });
    await request(makeApp()).get('/api/newrelic/view/pipeline?window=1h');

    nerdgraphOk({
      decisions: { results: [{ decision: 'PERMIT', count: 9 }] }, posture: { results: [] },
      timeseries: { results: [] }, stream: { results: [] },
    });
    const res = await request(makeApp()).get('/api/newrelic/view/authorize?window=1h');
    expect(res.body.view).toBe('authorize');
    expect(res.body.decisions[0].count).toBe(9);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('keeps /pipeline working as an alias', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      funnel: { results: [{ category: 'oauth', count: 4 }] },
      timeseries: { results: [] }, stream: { results: [] },
    });
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(200);
    expect(res.body.funnel[0].category).toBe('oauth');
  });
});
```

The existing suite calls `router._resetCache()` between specs — confirm that
`beforeEach` still runs it, and if the file does not already have one, add:

```javascript
beforeEach(() => { require('../routes/newRelicQuery')._resetCache(); });
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd demo_api_server && CI=true npx jest tests/newRelicQuery.test.js
```

Expected: FAIL — `/view/:view` 404s, so status is 404 not 400/200.

- [ ] **Step 4: Add the 7d window and the view registry**

In `demo_api_server/routes/newRelicQuery.js`, replace the `WINDOWS` constant:

```javascript
// The only values that ever reach NRQL. A key outside this map is a 400.
// Buckets are per-window: a fixed 5-minute bucket over 7 days would return
// 2016 points and swamp the sparkline.
const WINDOWS = {
  '30m': { since: '30 minutes ago', bucket: '2 minutes' },
  '1h': { since: '1 hour ago', bucket: '5 minutes' },
  '24h': { since: '24 hours ago', bucket: '1 hour' },
  '7d': { since: '7 days ago', bucket: '6 hours' },
};
```

Then replace `_buildQuery` with a per-view builder and registry:

```javascript
function _pipelineQuery(accountId, since, bucket) {
  const funnel =
    `SELECT count(*) FROM Log WHERE logtype='app_event' FACET category SINCE ${since}`;
  const timeseries =
    `SELECT count(*) FROM Log WHERE logtype='app_event' TIMESERIES ${bucket} SINCE ${since}`;
  const stream =
    'SELECT timestamp, message, category, severity, correlationId ' +
    `FROM Log WHERE logtype='app_event' SINCE ${since} LIMIT 50`;

  // JSON.stringify supplies the surrounding quotes and escapes the single
  // quotes inside each NRQL string. accountId is coerced to a number so it can
  // never carry syntax.
  return `{ actor { account(id: ${Number(accountId)}) {
    funnel: nrql(query: ${JSON.stringify(funnel)}) { results }
    timeseries: nrql(query: ${JSON.stringify(timeseries)}) { results }
    stream: nrql(query: ${JSON.stringify(stream)}) { results }
  } } }`;
}

function _authorizeQuery(accountId, since, bucket) {
  const decisions =
    `SELECT count(*) FROM Log WHERE category='authorize' AND decision IS NOT NULL FACET decision SINCE ${since}`;
  const posture =
    `SELECT count(*) FROM Log WHERE category='authorize' FACET tag SINCE ${since}`;
  const timeseries =
    `SELECT count(*) FROM Log WHERE category='authorize' TIMESERIES ${bucket} SINCE ${since}`;
  const stream =
    'SELECT timestamp, tag, decision, amount, stepUpRequired, type, engine, latencyMs ' +
    `FROM Log WHERE category='authorize' SINCE ${since} LIMIT 50`;

  return `{ actor { account(id: ${Number(accountId)}) {
    decisions: nrql(query: ${JSON.stringify(decisions)}) { results }
    posture: nrql(query: ${JSON.stringify(posture)}) { results }
    timeseries: nrql(query: ${JSON.stringify(timeseries)}) { results }
    stream: nrql(query: ${JSON.stringify(stream)}) { results }
  } } }`;
}

// Named query sets. The client sends a VIEW KEY, never a query — an open
// passthrough would let any caller run arbitrary NRQL against the account.
const VIEWS = {
  pipeline: {
    build: _pipelineQuery,
    map: (a) => ({
      funnel: a.funnel?.results || [],
      timeseries: a.timeseries?.results || [],
      stream: a.stream?.results || [],
    }),
  },
  authorize: {
    build: _authorizeQuery,
    map: (a) => ({
      decisions: a.decisions?.results || [],
      posture: a.posture?.results || [],
      timeseries: a.timeseries?.results || [],
      stream: a.stream?.results || [],
    }),
  },
};
```

- [ ] **Step 5: Replace the route handler**

Replace the whole `router.get('/pipeline', …)` handler with a shared handler
plus two routes:

```javascript
async function _handleView(viewName, req, res) {
  const key = process.env.NR_USER_API_KEY;
  const accountId = process.env.NR_ACCOUNT_ID;
  if (!key || !String(accountId || '').trim() || !Number.isFinite(Number(accountId))) {
    return res.status(503).json({ error: 'newrelic_not_configured' });
  }

  const view = VIEWS[viewName];
  if (!view) {
    return res.status(400).json({ error: 'invalid_view' });
  }

  const window = String(req.query.window || DEFAULT_WINDOW);
  const spec = WINDOWS[window];
  if (!spec) {
    return res.status(400).json({ error: 'invalid_window' });
  }

  // Cache key includes the view — otherwise an authorize request inside the TTL
  // would be served the pipeline payload.
  const cacheKey = `${viewName}:${window}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.payload);
  }

  try {
    const response = await axios.post(
      NERDGRAPH_ENDPOINT,
      { query: view.build(accountId, spec.since, spec.bucket) },
      {
        headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
        timeout: 10000,
      },
    );

    if (response.data && response.data.errors) {
      console.warn('[newRelicQuery] NerdGraph returned errors:', response.data.errors);
      return res.status(502).json({ error: 'newrelic_query_failed' });
    }

    const account = response.data?.data?.actor?.account || {};
    const payload = { view: viewName, window, ...view.map(account) };
    _cache.set(cacheKey, { at: Date.now(), payload });
    return res.json(payload);
  } catch (err) {
    // Deliberately not echoed to the client — this endpoint is public and the
    // upstream message can carry hostnames and IPs.
    console.warn('[newRelicQuery] query failed:', err?.message);
    return res.status(502).json({ error: 'newrelic_query_failed' });
  }
}

router.get('/view/:view', (req, res) => _handleView(String(req.params.view), req, res));

// Alias kept so anything already calling /pipeline keeps working.
router.get('/pipeline', (req, res) => _handleView('pipeline', req, res));
```

- [ ] **Step 6: Run the tests**

```bash
cd demo_api_server && CI=true npx jest tests/newRelicQuery.test.js
```

Expected: PASS — the original suite plus the 6 new tests.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/routes/newRelicQuery.js demo_api_server/tests/newRelicQuery.test.js
git commit -m "feat(nr): view registry and 7d window on the New Relic proxy"
```

---

## Task 2: Emit latencyMs on authorize decisions

**Files:**
- Modify: `demo_api_server/routes/authorize.js` (the live-evaluate handler, ~line 393)
- Create: `demo_api_server/tests/authorizeLatency.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `authorize` app events carry a numeric `latencyMs` in `metadata`. Task 4 renders it.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/authorizeLatency.test.js`:

```javascript
'use strict';
const request = require('supertest');
const express = require('express');

jest.mock('../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { AUTHORIZE: 'authorize' },
}));
jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluatePingOneTransaction: jest.fn(),
  isPingOneConfigured: jest.fn(() => true),
}));

const appEventService = require('../services/appEventService');
const p1az = require('../services/pingOneAuthorizeService');
const authorizeRouter = require('../routes/authorize');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/authorize', authorizeRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NR_LICENSE_KEY = '';
  p1az.evaluatePingOneTransaction.mockResolvedValue({
    decision: 'DENY',
    stepUpRequired: true,
    decisionId: null,
    path: 'decision-endpoint',
    raw: {},
  });
});

describe('authorize live evaluate emits latencyMs', () => {
  it('includes a numeric latencyMs in the event metadata', async () => {
    await request(makeApp())
      .post('/api/authorize/test-evaluate')
      .send({ amount: 60000, type: 'transfer', acr: 'pwd', userId: 'probe' });

    const call = appEventService.logEvent.mock.calls
      .find((c) => c[0] === 'authorize');
    expect(call).toBeDefined();
    const meta = call[3].metadata;
    expect(typeof meta.latencyMs).toBe('number');
    expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('still carries the decision alongside latency', async () => {
    await request(makeApp())
      .post('/api/authorize/test-evaluate')
      .send({ amount: 60000, type: 'transfer', acr: 'pwd', userId: 'probe' });

    const call = appEventService.logEvent.mock.calls
      .find((c) => c[0] === 'authorize');
    expect(call[3].metadata.decision).toBe('DENY');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/authorizeLatency.test.js
```

Expected: FAIL — `typeof meta.latencyMs` is `'undefined'`.

If instead the suite errors because the mocked service is missing an export the
route requires, read the route's `require` line for
`services/pingOneAuthorizeService` and add those names to the mock factory.
Report which names you added.

- [ ] **Step 3: Add the timing**

In `demo_api_server/routes/authorize.js`, in the live-evaluate handler, wrap the
evaluation call:

```javascript
      const _t0 = Date.now();
      const result = await evaluatePingOneTransaction({ userId, amount: numAmount, type, acr: acr || undefined });
      const latencyMs = Date.now() - _t0;
      logEvent('authorize', result.decision === 'PERMIT' ? 'info' : 'warning',
        `Authorize [pingone/force-live] ${result.decision} — ${type} $${numAmount}`,
        { tag: result.decision === 'PERMIT' ? 'authorize/permit' : 'authorize/deny',
          metadata: { engine: 'pingone', forced: true, decision: result.decision, type, amount: numAmount, userId, stepUpRequired: result.stepUpRequired, decisionId: result.decisionId, path: result.path, latencyMs, ...(useCaseId ? { useCaseId } : {}) } });
```

Only `_t0`, `latencyMs`, and the `latencyMs` metadata key are new — everything
else is the existing line, unchanged.

- [ ] **Step 4: Run the tests**

```bash
cd demo_api_server && CI=true npx jest tests/authorizeLatency.test.js
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/authorize.js demo_api_server/tests/authorizeLatency.test.js
git commit -m "feat(nr): measure and emit authorize decision latency"
```

---

## Task 3: Extract shared dashboard components

**Files:**
- Create: `demo_api_ui/src/components/dashboard/DashboardShell.jsx`
- Create: `demo_api_ui/src/components/dashboard/StatStrip.jsx`
- Create: `demo_api_ui/src/components/dashboard/EventStream.jsx`
- Create: `demo_api_ui/src/components/dashboard/dashboard.css`
- Create: `demo_api_ui/src/components/dashboard/__tests__/DashboardShell.test.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces, all default exports:
  - `DashboardShell({ title, subtitle, window, onWindow, windows, onRefresh, state, notConfiguredHint, children })` — `state ∈ 'loading'|'ready'|'unconfigured'|'error'`; renders children only when `ready`.
  - `StatStrip({ items })` where `items: Array<{ key, label, value, note?, tone? }>`, `tone ∈ 'default'|'warn'|'bad'|'muted'`.
  - `EventStream({ columns, rows })` where `columns: Array<{ key, label, className? }>` and `rows: Array<object>`.
  Tasks 4 and 5 consume these exact signatures.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/dashboard/__tests__/DashboardShell.test.jsx`:

```jsx
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../../../context/ThemeContext';
import DashboardShell from '../DashboardShell';
import StatStrip from '../StatStrip';
import EventStream from '../EventStream';

const WINDOWS = ['30m', '1h', '24h', '7d'];

function shell(props = {}) {
  return render(
    <ThemeProvider>
      <DashboardShell
        title="Test"
        subtitle="sub"
        window="24h"
        windows={WINDOWS}
        onWindow={() => {}}
        onRefresh={() => {}}
        state="ready"
        {...props}
      >
        <p>body</p>
      </DashboardShell>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('DashboardShell', () => {
  it('offers every window including 7d', () => {
    shell();
    WINDOWS.forEach((w) =>
      expect(screen.getByRole('button', { name: w })).toBeInTheDocument());
  });

  it('marks the selected window pressed', () => {
    shell({ window: '7d' });
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders children only when ready', () => {
    shell({ state: 'loading' });
    expect(screen.queryByText('body')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('shows the not-configured hint on unconfigured, not an error', () => {
    shell({ state: 'unconfigured', notConfiguredHint: 'set NR_USER_API_KEY' });
    expect(screen.getByText(/set NR_USER_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an alert on error', () => {
    shell({ state: 'error' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('toggles the shared app theme', () => {
    shell();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    screen.getByRole('switch', { name: /dark mode/i }).click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('StatStrip', () => {
  it('renders each item with its value and testid', () => {
    render(<StatStrip items={[
      { key: 'permit', label: 'PERMIT', value: 3 },
      { key: 'deny', label: 'DENY', value: 5, tone: 'bad' },
    ]} />);
    expect(screen.getByTestId('stat-permit')).toHaveTextContent('3');
    expect(screen.getByTestId('stat-deny')).toHaveTextContent('5');
  });

  it('renders a zero item rather than hiding it', () => {
    render(<StatStrip items={[{ key: 'failopen', label: 'fail-open', value: 0 }]} />);
    expect(screen.getByTestId('stat-failopen')).toHaveTextContent('0');
  });
});

describe('EventStream', () => {
  it('renders a row per record using the column keys', () => {
    render(<EventStream
      columns={[{ key: 'decision', label: 'Decision' }, { key: 'amount', label: 'Amount' }]}
      rows={[{ decision: 'DENY', amount: 60000 }]}
    />);
    expect(screen.getByText('DENY')).toBeInTheDocument();
    expect(screen.getByText('60000')).toBeInTheDocument();
  });

  it('renders an empty message when there are no rows', () => {
    render(<EventStream columns={[{ key: 'a', label: 'A' }]} rows={[]} />);
    expect(screen.getByText(/no events/i)).toBeInTheDocument();
  });
});

// jsdom does not apply stylesheets — static check, guarding the #1484 regression
// where a component set color but no background and went unreadable in dark mode.
describe('dashboard.css theme grounds', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../dashboard.css'), 'utf8');

  it('paints its own ground', () => {
    expect(css).toMatch(/background:\s*var\(--dash-ground\)/);
  });

  it('defines --dash-ground in both themes with different values', () => {
    const light = css.match(/\.dash\s*\{[^}]*--dash-ground:\s*(#[0-9a-f]{3,8})/i);
    const dark = css.match(/\[data-theme="dark"\][^{]*\{[^}]*--dash-ground:\s*(#[0-9a-f]{3,8})/i);
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
    expect(light[1].toLowerCase()).not.toBe(dark[1].toLowerCase());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_ui && npx vitest run src/components/dashboard/__tests__/DashboardShell.test.jsx
```

Expected: FAIL — cannot resolve `../DashboardShell`.

- [ ] **Step 3: Write dashboard.css**

Create `demo_api_ui/src/components/dashboard/dashboard.css`:

```css
/* Shared dashboard tokens. Dark is keyed to :root[data-theme="dark"] — the
   attribute ThemeProvider writes — never prefers-color-scheme, which this app
   deliberately ignores. .dash paints its own background: without it, dark-mode
   ink lands on the app shell's light ground (the #1484 bug). */
.dash {
  --dash-ground: #eef2f7;
  --dash-surface: #ffffff;
  --dash-surface-2: #f8fafc;
  --dash-line: #d8e0ea;
  --dash-line-soft: #e8edf3;
  --dash-ink: #0f172a;
  --dash-ink-2: #475569;
  --dash-ink-3: #64748b;
  --dash-accent: #1d4ed8;
  --dash-accent-soft: #dbeafe;
  --dash-ok: #3d9142;
  --dash-warn: #b26a00;
  --dash-bad: #d13c31;

  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 22px 30px;
  color: var(--dash-ink);
  background: var(--dash-ground);
  min-height: 100%;
}

:root[data-theme="dark"] .dash {
  --dash-ground: #0a0f18;
  --dash-surface: #111823;
  --dash-surface-2: #161f2c;
  --dash-line: #253244;
  --dash-line-soft: #1c2634;
  --dash-ink: #e8eef7;
  --dash-ink-2: #a5b4c8;
  --dash-ink-3: #7d8ca1;
  --dash-accent: #7aa2f7;
  --dash-accent-soft: #172554;
  --dash-ok: #6cc46c;
  --dash-warn: #e0a145;
  --dash-bad: #f0776c;
}

.dash-head { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
.dash-title { margin: 0; font-size: 21px; font-weight: 700; }
.dash-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--dash-ink-3); }
.dash-spacer { flex: 1; }

.dash-seg { display: inline-flex; border: 1px solid var(--dash-line); border-radius: 8px; overflow: hidden; background: var(--dash-surface); }
.dash-seg button { font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 13px; border: 0; background: transparent; color: var(--dash-ink-2); cursor: pointer; }
.dash-seg button + button { border-left: 1px solid var(--dash-line); }
.dash-seg button.is-on { background: var(--dash-accent); color: #fff; }
.dash-seg button:focus-visible { outline: 2px solid var(--dash-accent); outline-offset: -2px; }

.dash-btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 13px; border-radius: 8px; border: 1px solid var(--dash-line); background: var(--dash-surface); color: var(--dash-ink-2); cursor: pointer; }
.dash-btn:focus-visible { outline: 2px solid var(--dash-accent); outline-offset: 1px; }

.dash-theme { display: inline-flex; align-items: center; gap: 8px; padding: 4px 11px; border: 1px solid var(--dash-line); border-radius: 8px; background: var(--dash-surface); }
.dash-theme span { font-size: 11.5px; font-weight: 600; color: var(--dash-ink-3); user-select: none; }
.dash-theme span.is-on { color: var(--dash-ink); }
.dash-switch { position: relative; width: 34px; height: 18px; flex: none; border-radius: 999px; border: 1px solid var(--dash-line); background: var(--dash-surface-2); cursor: pointer; padding: 0; }
.dash-switch[aria-checked="true"] { background: var(--dash-accent); border-color: var(--dash-accent); }
.dash-switch:focus-visible { outline: 2px solid var(--dash-accent); outline-offset: 2px; }
.dash-thumb { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--dash-surface); border: 1px solid var(--dash-line); transition: transform .16s ease; }
.dash-switch[aria-checked="true"] .dash-thumb { transform: translateX(16px); background: #fff; border-color: transparent; }
@media (prefers-reduced-motion: reduce) { .dash-thumb { transition: none; } }

.dash-msg { padding: 22px; border: 1px solid var(--dash-line); border-radius: 8px; background: var(--dash-surface); color: var(--dash-ink-2); font-size: 13.5px; }
.dash-msg code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: var(--dash-ink); }
.dash-msg-err { border-color: var(--dash-bad); color: var(--dash-bad); }

.dash-card { background: var(--dash-surface); border: 1px solid var(--dash-line); border-radius: 8px; min-width: 0; }
.dash-card-head { padding: 11px 15px; border-bottom: 1px solid var(--dash-line-soft); font-size: 12.5px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--dash-ink-2); }
.dash-card-body { padding: 15px; overflow-x: auto; }

.dash-strip { display: flex; overflow-x: auto; }
.dash-stat { flex: 1 1 0; min-width: 128px; padding: 13px 14px; border-right: 1px solid var(--dash-line-soft); display: flex; flex-direction: column; gap: 3px; }
.dash-stat:last-child { border-right: 0; }
.dash-stat-label { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--dash-ink-3); white-space: nowrap; }
.dash-stat-value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; font-size: 25px; font-weight: 700; line-height: 1.15; }
.dash-stat-note { font-size: 11px; color: var(--dash-ink-3); }
.dash-stat-bar { height: 3px; border-radius: 2px; background: var(--dash-accent); margin-top: 5px; }
.dash-stat.is-zero .dash-stat-value, .dash-stat.is-zero .dash-stat-label { opacity: .55; }
.dash-stat.is-zero .dash-stat-bar { background: var(--dash-line); }
.dash-stat.tone-warn .dash-stat-value { color: var(--dash-warn); }
.dash-stat.tone-warn .dash-stat-bar { background: var(--dash-warn); }
.dash-stat.tone-bad .dash-stat-value { color: var(--dash-bad); }
.dash-stat.tone-bad .dash-stat-bar { background: var(--dash-bad); }

.dash-tbl-wrap { overflow-x: auto; }
.dash-tbl { border-collapse: collapse; width: 100%; min-width: 720px; }
.dash-tbl th { text-align: left; font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--dash-ink-3); padding: 9px 15px; border-bottom: 1px solid var(--dash-line); background: var(--dash-surface-2); white-space: nowrap; }
.dash-tbl td { padding: 9px 15px; border-bottom: 1px solid var(--dash-line-soft); font-size: 13px; vertical-align: top; }
.dash-tbl tr:last-child td { border-bottom: 0; }
.dash-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--dash-ink-3); white-space: nowrap; }
.dash-chip { display: inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: var(--dash-accent-soft); color: var(--dash-accent); white-space: nowrap; }

.dash-spark { display: block; width: 100%; height: auto; }
.dash-spark-max { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; font-weight: 700; fill: var(--dash-ink-3); }
```

- [ ] **Step 4: Write the three components**

Create `demo_api_ui/src/components/dashboard/StatStrip.jsx`:

```jsx
import React from 'react';

/**
 * Labelled counts with a bar scaled to the largest item. Zero items still
 * render — their absence is the signal on a posture strip.
 */
export default function StatStrip({ items }) {
  const peak = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  return (
    <div className="dash-strip">
      {items.map((i) => {
        const n = Number(i.value) || 0;
        const tone = i.tone && i.tone !== 'default' ? ` tone-${i.tone}` : '';
        return (
          <div key={i.key} className={`dash-stat${n === 0 ? ' is-zero' : ''}${tone}`}
               data-testid={`stat-${i.key}`}>
            <span className="dash-stat-label">{i.label}</span>
            <span className="dash-stat-value">{n}</span>
            {i.note ? <span className="dash-stat-note">{i.note}</span> : null}
            <div className="dash-stat-bar" style={{ width: `${(n / peak) * 100}%` }} />
          </div>
        );
      })}
    </div>
  );
}
```

Create `demo_api_ui/src/components/dashboard/EventStream.jsx`:

```jsx
import React from 'react';

export default function EventStream({ columns, rows }) {
  if (!rows || rows.length === 0) {
    return <div className="dash-msg" role="status">No events in this window.</div>;
  }
  return (
    <div className="dash-tbl-wrap">
      <table className="dash-tbl">
        <thead>
          <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.timestamp || 'row'}-${i}`}>
              {columns.map((c) => (
                <td key={c.key} className={c.className || ''}>
                  {r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Create `demo_api_ui/src/components/dashboard/DashboardShell.jsx`:

```jsx
import React from 'react';
import { useThemeOptional } from '../../context/ThemeContext';
import './dashboard.css';

/**
 * Chrome shared by every New Relic-backed dashboard: title, window selector,
 * theme toggle, refresh, and the four load states. Children render only when
 * state is 'ready', so pages never have to guard their own body.
 */
export default function DashboardShell({
  title, subtitle, window: win, windows, onWindow, onRefresh,
  state, notConfiguredHint, children,
}) {
  const { darkMode, setDarkMode } = useThemeOptional();

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1 className="dash-title">{title}</h1>
          {subtitle ? <p className="dash-sub">{subtitle}</p> : null}
        </div>
        <span className="dash-spacer" />

        <div className="dash-seg" role="group" aria-label="Time window">
          {windows.map((w) => (
            <button key={w} type="button" onClick={() => onWindow(w)}
                    className={w === win ? 'is-on' : ''} aria-pressed={w === win}>
              {w}
            </button>
          ))}
        </div>

        <div className="dash-theme">
          <span className={darkMode ? '' : 'is-on'}>Light</span>
          <button type="button" className="dash-switch" role="switch"
                  aria-checked={darkMode} aria-label="Dark mode"
                  title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
                  onClick={() => setDarkMode(!darkMode)}>
            <span className="dash-thumb" />
          </button>
          <span className={darkMode ? 'is-on' : ''}>Dark</span>
        </div>

        <button type="button" className="dash-btn" onClick={onRefresh}>Refresh</button>
      </div>

      {state === 'loading' && (
        <div className="dash-msg" role="status">Loading…</div>
      )}

      {state === 'unconfigured' && (
        <div className="dash-msg" role="status">{notConfiguredHint}</div>
      )}

      {state === 'error' && (
        <div className="dash-msg dash-msg-err" role="alert">
          Could not load data. Check the BFF logs for the upstream reason.
        </div>
      )}

      {state === 'ready' && children}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

```bash
cd demo_api_ui && npx vitest run src/components/dashboard/__tests__/DashboardShell.test.jsx
```

Expected: PASS, 12 tests.

- [ ] **Step 6: Verify the CSS guard is load-bearing**

Temporarily delete the `background: var(--dash-ground);` line from
`dashboard.css`, re-run the suite, and confirm the "paints its own ground" test
FAILS. Restore the line and re-run to green. Report both counts.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/dashboard/
git commit -m "feat(nr): extract shared DashboardShell, StatStrip and EventStream"
```

---

## Task 4: P1AZ dashboard component

**Files:**
- Create: `demo_api_ui/src/components/P1AzDashboard.jsx`
- Create: `demo_api_ui/src/components/__tests__/P1AzDashboard.test.jsx`

**Interfaces:**
- Consumes: `DashboardShell`, `StatStrip`, `EventStream` from Task 3 (signatures in that task's Interfaces block); `GET /api/newrelic/view/authorize` from Task 1.
- Produces: default export `P1AzDashboard`, no props. Task 5 mounts it.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/P1AzDashboard.test.jsx`:

```jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../../context/ThemeContext';
import P1AzDashboard from '../P1AzDashboard';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

const PAYLOAD = {
  view: 'authorize',
  window: '24h',
  decisions: [{ decision: 'PERMIT', count: 1 }, { decision: 'DENY', count: 2 }],
  posture: [
    { tag: 'authorize/permit', count: 1 },
    { tag: 'authorize/deny', count: 2 },
    { tag: 'authorize/fail-open', count: 3 },
  ],
  timeseries: [{ beginTimeSeconds: 1, count: 0 }, { beginTimeSeconds: 2, count: 3 }],
  stream: [{
    timestamp: 1786240000000, tag: 'authorize/deny', decision: 'DENY',
    amount: 60000, stepUpRequired: false, type: 'transfer', engine: 'pingone', latencyMs: 42,
  }],
};

function renderDash() {
  return render(<ThemeProvider><P1AzDashboard /></ThemeProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('P1AzDashboard', () => {
  it('defaults to the 24h window, not 1h', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
      '/api/newrelic/view/authorize?window=24h'));
  });

  it('renders PERMIT and DENY counts from the decisions facet', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stat-PERMIT')).toHaveTextContent('1'));
    expect(screen.getByTestId('stat-DENY')).toHaveTextContent('2');
  });

  it('renders every posture stat including ones absent from the payload', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stat-fail-open')).toHaveTextContent('3'));
    // failover is not in PAYLOAD.posture — it must still render, as 0
    expect(screen.getByTestId('stat-failover')).toHaveTextContent('0');
  });

  it('renders the decision stream with amount and latency', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByText('60000')).toBeInTheDocument());
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows the not-configured state on 503, not a generic error', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 503 } });
    renderDash();
    await waitFor(() => expect(screen.getByText(/NR_USER_API_KEY/)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error state on 502', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 502 } });
    renderDash();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('requests the window the user selected', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    screen.getByRole('button', { name: '7d' }).click();
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(
      '/api/newrelic/view/authorize?window=7d'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_ui && npx vitest run src/components/__tests__/P1AzDashboard.test.jsx
```

Expected: FAIL — cannot resolve `../P1AzDashboard`.

- [ ] **Step 3: Write the component**

Create `demo_api_ui/src/components/P1AzDashboard.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import DashboardShell from './dashboard/DashboardShell';
import StatStrip from './dashboard/StatStrip';
import EventStream from './dashboard/EventStream';

const WINDOWS = ['30m', '1h', '24h', '7d'];
// 24h, not 1h: authorize decisions are far sparser than pipeline events, and a
// 1h default renders an empty page most of the time.
const DEFAULT_WINDOW = '24h';
const POLL_MS = 30000;

// Fixed so a posture signal that stops appearing still renders as 0 — the
// absence of fail-open is exactly what an operator needs to see.
const POSTURE = [
  { tag: 'authorize/gate-skipped', key: 'gate-skipped', label: 'gate-skipped', tone: 'muted' },
  { tag: 'authorize/policy-not-found', key: 'policy-not-found', label: 'policy-not-found', tone: 'warn' },
  { tag: 'authorize/fail-open', key: 'fail-open', label: 'fail-open', tone: 'bad' },
  { tag: 'authorize/failover', key: 'failover', label: 'failover', tone: 'warn' },
];

const STREAM_COLUMNS = [
  { key: 'time', label: 'Time', className: 'dash-mono' },
  { key: 'decision', label: 'Decision' },
  { key: 'amount', label: 'Amount', className: 'dash-mono' },
  { key: 'type', label: 'Type' },
  { key: 'stepUp', label: 'Step-up' },
  { key: 'engine', label: 'Engine' },
  { key: 'latencyMs', label: 'Latency ms', className: 'dash-mono' },
];

function Sparkline({ points }) {
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.count), 1);
  const step = points.length > 1 ? 540 / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = 40 + i * step;
    const y = 140 - (p.count / max) * 102;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox="0 0 600 160" className="dash-spark" role="img"
         aria-label={`Authorize volume, peak ${max} per bucket`}>
      <polyline points={coords.join(' ')} fill="none" stroke="var(--dash-accent)"
                strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <text x="34" y="44" className="dash-spark-max" textAnchor="end">{max}</text>
    </svg>
  );
}

export default function P1AzDashboard() {
  const [win, setWin] = useState(DEFAULT_WINDOW);
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/newrelic/view/authorize?window=${win}`);
      setData(res.data);
      setState('ready');
    } catch (err) {
      setState(err?.response?.status === 503 ? 'unconfigured' : 'error');
    }
  }, [win]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const decisionCounts = {};
  (data?.decisions || []).forEach((r) => { decisionCounts[r.decision] = r.count; });
  const decisionItems = ['PERMIT', 'DENY'].map((d) => ({
    key: d,
    label: d,
    value: decisionCounts[d] || 0,
    tone: d === 'DENY' ? 'bad' : 'default',
  }));

  const postureCounts = {};
  (data?.posture || []).forEach((r) => { postureCounts[r.tag] = r.count; });
  const postureItems = POSTURE.map((p) => ({
    key: p.key,
    label: p.label,
    value: postureCounts[p.tag] || 0,
    tone: (postureCounts[p.tag] || 0) > 0 ? p.tone : 'default',
  }));

  const rows = (data?.stream || []).map((e) => ({
    timestamp: e.timestamp,
    time: e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '',
    decision: e.decision || '',
    amount: e.amount,
    type: e.type || '',
    stepUp: e.stepUpRequired === true ? 'yes' : 'no',
    engine: e.engine || '',
    latencyMs: e.latencyMs,
  }));

  return (
    <DashboardShell
      title="PingOne Authorize"
      subtitle="Decisions and gate posture, from New Relic"
      window={win}
      windows={WINDOWS}
      onWindow={setWin}
      onRefresh={load}
      state={state}
      notConfiguredHint={
        <>New Relic is not configured. Set <code>NR_USER_API_KEY</code> and{' '}
        <code>NR_ACCOUNT_ID</code> in <code>demo_api_server/.env</code>.</>
      }
    >
      <section className="dash-card">
        <div className="dash-card-head">Decisions</div>
        <StatStrip items={decisionItems} />
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Gate posture</div>
        <StatStrip items={postureItems} />
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Volume</div>
        <div className="dash-card-body"><Sparkline points={data?.timeseries || []} /></div>
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Recent decisions</div>
        <EventStream columns={STREAM_COLUMNS} rows={rows} />
      </section>
    </DashboardShell>
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
cd demo_api_ui && npx vitest run src/components/__tests__/P1AzDashboard.test.jsx
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/P1AzDashboard.jsx \
        demo_api_ui/src/components/__tests__/P1AzDashboard.test.jsx
git commit -m "feat(nr): PingOne Authorize dashboard component"
```

---

## Task 5: Route and nav wiring

**Files:**
- Modify: `demo_api_ui/src/routes/MonitoringRoutes.js`
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx:854-858`
- Modify: `demo_api_ui/src/routes/__tests__/NewRelicRoute.test.jsx`

**Interfaces:**
- Consumes: `P1AzDashboard` from Task 4 (default export, no props).
- Produces: `P1AzRoute({ user, logout })` exported from `MonitoringRoutes.js`; route `/monitoring/p1az`.

**What must NOT break:** the page stays public — no auth guard, no redirect. Do
NOT add `/monitoring/p1az` to `isNoChromeRoute()` in `sideNavOwner.js`: with
`user` null, `appRendersSideNav` is already false, so `shellRendersSideNav`
returns true and `AppShell` supplies the sidebar. Listing it there would
suppress the sidebar — the exact bug #1476 fixed.

- [ ] **Step 1: Write the failing test**

Append to `demo_api_ui/src/routes/__tests__/NewRelicRoute.test.jsx` (the file
already mocks `apiClient` and the context hooks — reuse that setup):

```jsx
import { P1AzRoute } from '../MonitoringRoutes';

describe('P1AzRoute', () => {
  it('renders app chrome and the dashboard for a signed-out visitor', async () => {
    apiClient.get.mockResolvedValue({
      data: { view: 'authorize', window: '24h', decisions: [{ decision: 'PERMIT', count: 2 }], posture: [], timeseries: [], stream: [] },
    });
    render(
      <MemoryRouter initialEntries={['/monitoring/p1az']}>
        <ThemeProvider><P1AzRoute user={null} logout={() => {}} /></ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('navigation')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('stat-PERMIT')).toHaveTextContent('2'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_ui && npx vitest run src/routes/__tests__/NewRelicRoute.test.jsx
```

Expected: FAIL — `P1AzRoute` is not exported.

- [ ] **Step 3: Add the route component**

In `demo_api_ui/src/routes/MonitoringRoutes.js`, add the import near the other
component imports:

```jsx
import P1AzDashboard from "../components/P1AzDashboard";
```

Then add below `PingOneEventsRoute`:

```jsx
// PingOne Authorize decisions and gate posture. Public, matching the other
// monitoring pages. Deliberately NOT in isNoChromeRoute(): with user null,
// shellRendersSideNav() returns true and AppShell supplies the sidebar.
export function P1AzRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <P1AzDashboard />
    </AppShell>
  );
}
```

- [ ] **Step 4: Register the route**

In `demo_api_ui/src/App.js`, add `P1AzRoute` to the existing `MonitoringRoutes`
import block, then add the route directly after `/monitoring/pingone-events`:

```jsx
                {/* PingOne Authorize decisions — public, same posture as the others */}
                <Route
                  path="/monitoring/p1az"
                  element={<P1AzRoute user={user} logout={logout} />}
                />
```

- [ ] **Step 5: Add the nav entry**

In `demo_api_ui/src/components/AdminSideNav.jsx`, immediately after the
"PingOne Events" entry (which closes around line 858):

```jsx
        {
          label: "PingOne Authorize",
          path: "/monitoring/p1az",
          icon: "log",
        },
```

- [ ] **Step 6: Run the tests**

```bash
cd demo_api_ui && npx vitest run src/routes/__tests__/NewRelicRoute.test.jsx
```

Expected: PASS — the existing route tests plus the new one.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/routes/MonitoringRoutes.js demo_api_ui/src/App.js \
        demo_api_ui/src/components/AdminSideNav.jsx \
        demo_api_ui/src/routes/__tests__/NewRelicRoute.test.jsx
git commit -m "feat(nr): mount the PingOne Authorize dashboard at /monitoring/p1az"
```

---

## Task 6: Point NewRelicDashboard at the shared components

**Files:**
- Modify: `demo_api_ui/src/components/NewRelicDashboard.jsx`

**Interfaces:**
- Consumes: `DashboardShell`, `StatStrip`, `EventStream` from Task 3; the view registry from Task 1.
- Produces: nothing new. The existing `NewRelicDashboard` tests must still pass unchanged.

This task is what makes Task 3 an extraction rather than a duplication. Do it
last so a failure here cannot block the new page.

- [ ] **Step 1: Run the existing tests to establish the baseline**

```bash
cd demo_api_ui && npx vitest run src/components/__tests__/NewRelicDashboard.test.jsx
```

Record the passing count. It must be identical after the refactor.

- [ ] **Step 2: Rewrite NewRelicDashboard to compose the shared components**

Replace the window/theme/state chrome and the stat/table markup with
`DashboardShell`, `StatStrip` and `EventStream`. Keep:

- the five pipeline stages and their order (`oauth`, `token_exchange`,
  `introspection`, `intent_auth`, `mcp`) with their existing `data-testid`
  values `stage-<key>` — the existing tests assert on them, so `StatStrip` must
  be given `key` values equal to the stage keys;
- the `severity`-dot rendering in the stream, including the `warning` mapping
  fixed in #1481;
- the `1h` default window (only P1AZ uses 24h), now including `7d` in the list;
- the request URL — switch to `/api/newrelic/view/pipeline?window=…`.

`NewRelicDashboard.css` keeps only rules with no shared equivalent; anything
now supplied by `dashboard.css` is deleted rather than left dead.

- [ ] **Step 3: Run the tests**

```bash
cd demo_api_ui && npx vitest run src/components/__tests__/NewRelicDashboard.test.jsx
```

Expected: the same count as Step 1, all passing. If a test now fails because a
`data-testid` moved, fix the component, not the test — those assertions are the
contract.

- [ ] **Step 4: Run both dashboard suites together**

```bash
cd demo_api_ui && npx vitest run src/components/__tests__/NewRelicDashboard.test.jsx src/components/__tests__/P1AzDashboard.test.jsx src/components/dashboard/__tests__/DashboardShell.test.jsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/NewRelicDashboard.jsx demo_api_ui/src/components/NewRelicDashboard.css
git commit -m "refactor(nr): compose NewRelicDashboard from the shared components"
```

---

## Task 7: Full verification

**Files:** none modified — this task is the gate.

- [ ] **Step 1: Full BFF suite**

```bash
cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4
```

`--maxWorkers=4` avoids the known worker-contention flake. Record the count and
compare against the pre-change baseline; re-run any failure in isolation before
calling it a regression.

- [ ] **Step 2: Full UI unit suite**

```bash
cd demo_api_ui && npm run test:unit
```

Known pre-existing: failures in `UserDashboardPing2026.test.js`
(`setToolbarHostEl is not a function`) are not caused by this work — that file
is untouched here. Anything else is a regression.

- [ ] **Step 3: UI build gate**

```bash
cd demo_api_ui && npm run build
```

Expected: exit 0. REGRESSION_PLAN §0 hard gate.

- [ ] **Step 4: Topology verify**

```bash
npm run topology:verify
```

Expected: no drift.

- [ ] **Step 5: Generate real traffic and check the page**

```bash
curl -sk -X POST https://api.ping.demo:3001/api/authorize/test-evaluate \
  -H 'Content-Type: application/json' \
  -d '{"amount":100,"type":"transfer","acr":"pwd","userId":"plan-verify"}'
curl -sk -X POST https://api.ping.demo:3001/api/authorize/test-evaluate \
  -H 'Content-Type: application/json' \
  -d '{"amount":60000,"type":"transfer","acr":"pwd","userId":"plan-verify"}'
```

Expected: `PERMIT` then `DENY`. Then open
`https://local.ping-devops.com:4000/monitoring/p1az` and confirm: header and
side nav present, PERMIT and DENY counts non-zero at the 24h window, the theme
toggle flips the page including the chart, `7d` is selectable, and
"PingOne Authorize" appears in the nav.

New Relic ingest lags a few seconds — if the counts are stale, hit Refresh.

- [ ] **Step 6: Check the working tree before staging**

```bash
git status --porcelain | grep -v "^??" | head -20
```

A BFF jest run rewrites `data/step-verification/`. Stage only intended files.

- [ ] **Step 7: Commit the verification record**

```bash
git commit --allow-empty -m "chore(nr): verification pass — suites green, build 0, topology clean"
```

---

## Self-Review

**Spec coverage.** View registry + `7d` + per-window buckets → Task 1. `latencyMs`
→ Task 2. Shared components → Task 3. P1AZ page with decision strip, posture row,
volume, stream, 24h default → Task 4. Route + nav → Task 5. NewRelicDashboard
composition → Task 6. Verification incl. the dark-mode ground guard → Tasks 3 and 7.
`decisionId` is explicitly dropped with the reason recorded in Global Constraints.

**Placeholder scan.** No TBD/TODO; every code step carries real code. Task 6
Step 2 is prose rather than a full file listing — deliberate, because it is a
mechanical refactor of a file the implementer will have open, and its contract
is pinned by the existing tests plus the explicit keep-list.

**Type consistency.** `DashboardShell`/`StatStrip`/`EventStream` signatures are
declared in Task 3's Interfaces and used identically in Tasks 4 and 6.
`StatStrip` item keys drive `data-testid="stat-<key>"`, which Task 4's tests
(`stat-PERMIT`, `stat-fail-open`) and Task 6's keep-list (`stage-<key>`) both
depend on. The `authorize` payload keys `decisions`/`posture`/`timeseries`/
`stream` are produced in Task 1 Step 4 and consumed in Task 4 Step 3.
