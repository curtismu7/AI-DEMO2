# New Relic Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/monitoring/new-relic` from a chrome-less permanently-empty panel into a real New Relic dashboard with header, side nav, and a light/dark toggle — then fix the PingOne webhook and split the two pages apart.

**Architecture:** A BFF route (`/api/newrelic/pipeline`) issues three named NRQL statements to NerdGraph in one aliased GraphQL request and returns a flat JSON payload. A React component renders that payload as a pipeline strip, an inline-SVG timeseries, a category ranking, and an event table. Routing changes wrap the page in `AppShell` to restore chrome, and the PingOne panel moves to its own route and nav entry.

**Tech Stack:** Express + jest + supertest (BFF, CommonJS) · React 19.2 + Vite 8 + **vitest** (UI, not jest) · axios via `apiClient` · NerdGraph GraphQL API

## Global Constraints

- **Worktree only.** All work on branch `worktree-newrelic-dashboard`. A hard-block hook denies `Write`/`Edit` in the main checkout.
- **Stage explicitly.** `git add <files>` — never `git add -A`. A BFF jest run regenerates hundreds of files under `demo_api_server/data/step-verification/`.
- **Emoji allowlist (REGRESSION_PLAN §0).** Only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. Severity indicators use CSS, not emoji.
- **UI build gate (REGRESSION_PLAN §0).** `cd demo_api_ui && npm run build` must exit 0 before the work is complete. A green test run is not enough.
- **UI uses vitest, not jest.** `npm run test:unit`.
- **UI HTTP goes through `apiClient`** (`demo_api_ui/src/services/apiClient.js`) — never bare `axios` in a component.
- **No new dependencies.** Everything needed is already in `package.json`.
- Page and proxy stay **public** — no `authenticateToken`, no session requirement.

### Deviation from the spec (deliberate)

The spec named `chart.js` + `react-chartjs-2` for the timeseries. This plan uses
**inline SVG** instead. Reason: chart.js renders to `<canvas>`, which jsdom does
not implement, so any component test that mounts the chart needs a canvas mock or
must skip the assertion. The mock HTML already uses SVG, it carries no dependency,
and it is directly assertable in tests. Same visual result, testable.

---

## File Structure

| File | Responsibility |
|---|---|
| `demo_api_server/routes/newRelicQuery.js` | **Create.** Named NRQL queries → NerdGraph → flat JSON |
| `demo_api_server/tests/newRelicQuery.test.js` | **Create.** Route tests |
| `demo_api_server/server.js` | **Modify.** Mount the router (public) |
| `demo_api_ui/src/components/NewRelicDashboard.jsx` | **Create.** The dashboard |
| `demo_api_ui/src/components/NewRelicDashboard.css` | **Create.** Its styles, both themes |
| `demo_api_ui/src/components/__tests__/NewRelicDashboard.test.jsx` | **Create.** Component tests |
| `demo_api_ui/src/routes/MonitoringRoutes.js` | **Modify.** `NewRelicRoute` gains `AppShell`; add `PingOneEventsRoute`; delete dead route |
| `demo_api_ui/src/App.js` | **Modify.** Pass `user`/`logout`; add PingOne Events route |
| `demo_api_ui/src/components/AdminSideNav.jsx` | **Modify.** Add "PingOne Events" nav entry |
| `demo_api_server/.env.example` | **Modify.** Document `PINGONE_WEBHOOK_SECRET` |
| `docs/PINGONE-WEBHOOK.md` | **Create.** Secret + tunnel + subscription runbook |

---

## Task 1: BFF NRQL proxy

**Files:**
- Create: `demo_api_server/routes/newRelicQuery.js`
- Create: `demo_api_server/tests/newRelicQuery.test.js`
- Modify: `demo_api_server/server.js` (mount, near the existing `/api/nr-log` handler at ~line 1283)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GET /api/newrelic/pipeline?window=30m|1h|24h` returning
  `{ window: string, funnel: Array<{category: string, count: number}>, timeseries: Array<{beginTimeSeconds: number, count: number}>, stream: Array<{timestamp: number, message: string, category: string, severity: string, correlationId: string|null}> }`.
  Task 2 consumes exactly this shape.

- [ ] **Step 1: Bootstrap the worktree**

The worktree has no `node_modules`; every test command fails without this.
Symlink rather than reinstall — the main checkout's copies are current.

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/newrelic-dashboard
ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_server/node_modules demo_api_server/node_modules
ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_ui/node_modules demo_api_ui/node_modules
ln -s /Users/cmuir/Development/AI-DEMO2/node_modules node_modules
```

Verify: `ls demo_api_server/node_modules/express/package.json` prints a path.

- [ ] **Step 2: Write the failing test**

Create `demo_api_server/tests/newRelicQuery.test.js`:

```javascript
'use strict';
const request = require('supertest');
const express = require('express');

jest.mock('axios');
const axios = require('axios');

function makeApp() {
  const app = express();
  app.use('/api/newrelic', require('../routes/newRelicQuery'));
  return app;
}

const OLD_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...OLD_ENV };
  jest.clearAllMocks();
});

describe('GET /api/newrelic/pipeline', () => {
  it('503s when NR_USER_API_KEY is absent', async () => {
    delete process.env.NR_USER_API_KEY;
    process.env.NR_ACCOUNT_ID = '8369622';
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('newrelic_not_configured');
  });

  it('503s when NR_ACCOUNT_ID is absent', async () => {
    process.env.NR_USER_API_KEY = 'k';
    delete process.env.NR_ACCOUNT_ID;
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(503);
  });

  it('400s on a window outside the fixed map', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    const res = await request(makeApp())
      .get('/api/newrelic/pipeline?window=1+hour+ago+OR+1=1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_window');
  });

  it('maps a NerdGraph response into the flat payload', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    axios.post.mockResolvedValue({
      data: { data: { actor: { account: {
        funnel: { results: [{ category: 'oauth', count: 13 }] },
        timeseries: { results: [{ beginTimeSeconds: 100, count: 5 }] },
        stream: { results: [{
          timestamp: 1700, message: 'MCP tool call', category: 'mcp',
          severity: 'info', correlationId: 'abc',
        }] },
      } } } },
    });

    const res = await request(makeApp()).get('/api/newrelic/pipeline?window=24h');

    expect(res.status).toBe(200);
    expect(res.body.window).toBe('24h');
    expect(res.body.funnel).toEqual([{ category: 'oauth', count: 13 }]);
    expect(res.body.timeseries).toEqual([{ beginTimeSeconds: 100, count: 5 }]);
    expect(res.body.stream[0].correlationId).toBe('abc');
  });

  it('sends the API key as a header and never in the body', async () => {
    process.env.NR_USER_API_KEY = 'secret-key';
    process.env.NR_ACCOUNT_ID = '8369622';
    axios.post.mockResolvedValue({
      data: { data: { actor: { account: {
        funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] },
      } } } },
    });

    await request(makeApp()).get('/api/newrelic/pipeline');

    const [, body, config] = axios.post.mock.calls[0];
    expect(config.headers['Api-Key']).toBe('secret-key');
    expect(JSON.stringify(body)).not.toContain('secret-key');
  });

  it('502s when NerdGraph fails, without leaking the upstream error', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    axios.post.mockRejectedValue(new Error('ECONNREFUSED 1.2.3.4'));
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('newrelic_query_failed');
    expect(JSON.stringify(res.body)).not.toContain('1.2.3.4');
  });

  it('502s when NerdGraph returns GraphQL errors', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    axios.post.mockResolvedValue({
      data: { errors: [{ message: 'bad nrql' }] },
    });
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

```bash
cd demo_api_server && CI=true npx jest tests/newRelicQuery.test.js
```

Expected: FAIL — `Cannot find module '../routes/newRelicQuery'`.

- [ ] **Step 4: Write the route**

Create `demo_api_server/routes/newRelicQuery.js`:

```javascript
'use strict';
/**
 * New Relic read proxy — named queries only.
 *
 * The page this serves is public, which governs what is DISPLAYED. It does not
 * mean the endpoint accepts arbitrary NRQL: an open passthrough would let any
 * caller run expensive queries against the account and read every event type in
 * it. The client sends a window key, never a query.
 */
const express = require('express');
const axios = require('axios');

const router = express.Router();

const NERDGRAPH_ENDPOINT =
  process.env.NR_NERDGRAPH_ENDPOINT || 'https://api.newrelic.com/graphql';

// The only values that ever reach NRQL. A key outside this map is a 400.
const WINDOWS = {
  '30m': { since: '30 minutes ago', bucket: '2 minutes' },
  '1h': { since: '1 hour ago', bucket: '5 minutes' },
  '24h': { since: '24 hours ago', bucket: '1 hour' },
};

const DEFAULT_WINDOW = '1h';

function _buildQuery(accountId, since, bucket) {
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

router.get('/pipeline', async (req, res) => {
  const key = process.env.NR_USER_API_KEY;
  const accountId = process.env.NR_ACCOUNT_ID;
  if (!key || !accountId) {
    return res.status(503).json({ error: 'newrelic_not_configured' });
  }

  const window = String(req.query.window || DEFAULT_WINDOW);
  const spec = WINDOWS[window];
  if (!spec) {
    return res.status(400).json({ error: 'invalid_window' });
  }

  try {
    const response = await axios.post(
      NERDGRAPH_ENDPOINT,
      { query: _buildQuery(accountId, spec.since, spec.bucket) },
      {
        headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
        timeout: 10000,
      },
    );

    if (response.data && response.data.errors) {
      console.warn('[newRelicQuery] NerdGraph returned errors');
      return res.status(502).json({ error: 'newrelic_query_failed' });
    }

    const account = response.data?.data?.actor?.account || {};
    return res.json({
      window,
      funnel: account.funnel?.results || [],
      timeseries: account.timeseries?.results || [],
      stream: account.stream?.results || [],
    });
  } catch (err) {
    // Deliberately not echoed to the client — this endpoint is public and the
    // upstream message can carry hostnames and IPs.
    console.warn('[newRelicQuery] query failed:', err?.message);
    return res.status(502).json({ error: 'newrelic_query_failed' });
  }
});

module.exports = router;
```

- [ ] **Step 5: Run the tests and make sure they pass**

```bash
cd demo_api_server && CI=true npx jest tests/newRelicQuery.test.js
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Mount the router**

In `demo_api_server/server.js`, immediately after the `app.post('/api/nr-log', …)`
block closes (search for `return res.json({ ok: true });` followed by `});`), add:

```javascript
// New Relic read proxy — public, same posture as /api/nr-log above.
// Named queries only; see routes/newRelicQuery.js.
app.use('/api/newrelic', require('./routes/newRelicQuery'));
```

- [ ] **Step 7: Verify the mount responds**

```bash
cd demo_api_server && CI=true npx jest tests/newRelicQuery.test.js
```

Expected: PASS, still 7 tests (the mount is exercised end-to-end in Task 6).

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/routes/newRelicQuery.js \
        demo_api_server/tests/newRelicQuery.test.js \
        demo_api_server/server.js
git commit -m "feat(nr): named-query NRQL proxy at /api/newrelic/pipeline"
```

---

## Task 2: Dashboard component

**Files:**
- Create: `demo_api_ui/src/components/NewRelicDashboard.jsx`
- Create: `demo_api_ui/src/components/NewRelicDashboard.css`
- Create: `demo_api_ui/src/components/__tests__/NewRelicDashboard.test.jsx`

**Interfaces:**
- Consumes: `GET /api/newrelic/pipeline` from Task 1, exact shape above.
- Produces: default export `NewRelicDashboard` (no props). Task 3 renders it.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/NewRelicDashboard.test.jsx`:

```jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../../context/ThemeContext';
import NewRelicDashboard from '../NewRelicDashboard';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn() },
}));

function renderDash() {
  return render(<ThemeProvider><NewRelicDashboard /></ThemeProvider>);
}

const PAYLOAD = {
  window: '1h',
  funnel: [
    { category: 'oauth', count: 13 },
    { category: 'mcp', count: 11 },
    { category: 'intent_auth', count: 16 },
  ],
  timeseries: [
    { beginTimeSeconds: 100, count: 0 },
    { beginTimeSeconds: 200, count: 93 },
  ],
  stream: [{
    timestamp: 1786194823914,
    message: 'MCP tool call to get_my_accounts',
    category: 'mcp',
    severity: 'info',
    correlationId: 'a3f1c9e2',
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('NewRelicDashboard', () => {
  it('shows a loading state before the request resolves', () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));
    renderDash();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('renders pipeline stage counts from the funnel', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stage-oauth')).toHaveTextContent('13'));
    expect(screen.getByTestId('stage-mcp')).toHaveTextContent('11');
    expect(screen.getByTestId('stage-intent_auth')).toHaveTextContent('16');
  });

  it('shows zero for a pipeline stage absent from the funnel', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    // token_exchange is not in PAYLOAD.funnel — it must still render, as 0.
    await waitFor(() => expect(screen.getByTestId('stage-token_exchange')).toHaveTextContent('0'));
  });

  it('renders the event stream with its correlation id', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByText(/MCP tool call to get_my_accounts/)).toBeInTheDocument());
    expect(screen.getByText('a3f1c9e2')).toBeInTheDocument();
  });

  it('shows the not-configured state on 503, not a generic error', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 503 } });
    renderDash();
    await waitFor(() => expect(screen.getByText(/New Relic is not configured/i)).toBeInTheDocument());
  });

  it('shows an error state on 502', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 502 } });
    renderDash();
    await waitFor(() => expect(screen.getByText(/Could not load New Relic data/i)).toBeInTheDocument());
  });

  it('reads as no-traffic, not as an error, when every series is empty', async () => {
    apiClient.get.mockResolvedValue({
      data: { window: '1h', funnel: [], timeseries: [], stream: [] },
    });
    renderDash();
    await waitFor(() => expect(screen.getByText(/No events in this window/i)).toBeInTheDocument());
    expect(screen.queryByText(/Could not load/i)).not.toBeInTheDocument();
  });

  it('toggles the shared app theme, not local state', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(screen.getByTestId('stage-oauth')).toBeInTheDocument());

    const sw = screen.getByRole('switch', { name: /dark mode/i });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    sw.click();
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
  });

  it('requests the window the user selected', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    renderDash();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    screen.getByRole('button', { name: '24h' }).click();
    await waitFor(() =>
      expect(apiClient.get).toHaveBeenLastCalledWith('/api/newrelic/pipeline?window=24h'));
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd demo_api_ui && npx vitest run src/components/__tests__/NewRelicDashboard.test.jsx
```

Expected: FAIL — cannot resolve `../NewRelicDashboard`.

- [ ] **Step 3: Write the component**

Create `demo_api_ui/src/components/NewRelicDashboard.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { useThemeOptional } from '../context/ThemeContext';
import './NewRelicDashboard.css';

// The demo's identity pipeline, in the order a request actually travels it.
// Fixed so a stage with no traffic still renders — its absence is the signal.
const STAGES = [
  { key: 'oauth', note: 'sign-in' },
  { key: 'token_exchange', note: 'RFC 8693' },
  { key: 'introspection', note: 'gateway' },
  { key: 'intent_auth', note: 'P1AZ decision' },
  { key: 'mcp', note: 'tool call' },
];

const WINDOWS = ['30m', '1h', '24h'];
const POLL_MS = 30000;

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
    <svg viewBox="0 0 600 160" className="nrd-spark" role="img"
         aria-label={`Event volume, peak ${max} per bucket`}>
      <polyline points={coords.join(' ')} fill="none"
                stroke="var(--nrd-accent)" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
      <text x="34" y="44" className="nrd-spark-max" textAnchor="end">{max}</text>
    </svg>
  );
}

export default function NewRelicDashboard() {
  const [win, setWin] = useState('1h');
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | unconfigured | error
  const { darkMode, setDarkMode } = useThemeOptional();

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/newrelic/pipeline?window=${win}`);
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

  const counts = {};
  (data?.funnel || []).forEach((r) => { counts[r.category] = r.count; });
  const peak = Math.max(1, ...STAGES.map((s) => counts[s.key] || 0));
  const totalEvents = (data?.funnel || []).reduce((n, r) => n + (r.count || 0), 0);

  return (
    <div className="nrd">
      <div className="nrd-head">
        <div>
          <h1 className="nrd-title">New Relic</h1>
          <p className="nrd-sub">Identity pipeline as observed telemetry</p>
        </div>
        <span className="nrd-spacer" />

        <div className="nrd-seg" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w} type="button" onClick={() => setWin(w)}
                    className={w === win ? 'is-on' : ''} aria-pressed={w === win}>
              {w}
            </button>
          ))}
        </div>

        <div className="nrd-theme">
          <span className={darkMode ? '' : 'is-on'}>Light</span>
          <button type="button" className="nrd-switch" role="switch"
                  aria-checked={darkMode} aria-label="Dark mode"
                  title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
                  onClick={() => setDarkMode(!darkMode)}>
            <span className="nrd-thumb" />
          </button>
          <span className={darkMode ? 'is-on' : ''}>Dark</span>
        </div>

        <button type="button" className="nrd-btn" onClick={load}>Refresh</button>
      </div>

      {state === 'loading' && (
        <div className="nrd-msg" role="status">Loading New Relic data…</div>
      )}

      {state === 'unconfigured' && (
        <div className="nrd-msg" role="status">
          New Relic is not configured. Set <code>NR_USER_API_KEY</code> and{' '}
          <code>NR_ACCOUNT_ID</code> in <code>demo_api_server/.env</code>.
        </div>
      )}

      {state === 'error' && (
        <div className="nrd-msg nrd-msg-err" role="alert">
          Could not load New Relic data. Check the BFF logs for the upstream reason.
        </div>
      )}

      {state === 'ready' && (
        <>
          <section className="nrd-card">
            <div className="nrd-card-head"><span>Identity pipeline</span></div>
            <div className="nrd-pipe">
              {STAGES.map((s) => {
                const n = counts[s.key] || 0;
                return (
                  <div key={s.key} className={`nrd-stage${n === 0 ? ' is-zero' : ''}`}
                       data-testid={`stage-${s.key}`}>
                    <span className="nrd-stage-name">{s.key}</span>
                    <span className="nrd-stage-count">{n}</span>
                    <span className="nrd-stage-note">{s.note}</span>
                    <div className="nrd-stage-bar" style={{ width: `${(n / peak) * 100}%` }} />
                  </div>
                );
              })}
            </div>
          </section>

          {totalEvents === 0 && (data?.stream || []).length === 0 ? (
            <div className="nrd-msg" role="status">
              No events in this window. Run a use case to generate traffic.
            </div>
          ) : (
            <>
              <section className="nrd-card">
                <div className="nrd-card-head"><span>Event volume</span></div>
                <div className="nrd-card-body">
                  <Sparkline points={data?.timeseries || []} />
                </div>
              </section>

              <section className="nrd-card">
                <div className="nrd-card-head"><span>Recent events</span></div>
                <div className="nrd-tbl-wrap">
                  <table className="nrd-tbl">
                    <thead>
                      <tr>
                        <th>Time</th><th>Category</th><th>Severity</th>
                        <th>Message</th><th>Correlation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.stream || []).map((e, i) => (
                        <tr key={`${e.timestamp}-${i}`}>
                          <td className="nrd-mono">
                            {new Date(e.timestamp).toLocaleTimeString()}
                          </td>
                          <td><span className="nrd-chip">{e.category}</span></td>
                          <td>
                            <span className={`nrd-sev nrd-sev-${e.severity || 'info'}`}>
                              {e.severity || 'info'}
                            </span>
                          </td>
                          <td>{e.message}</td>
                          <td className="nrd-mono">{e.correlationId || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the styles**

Create `demo_api_ui/src/components/NewRelicDashboard.css`:

```css
/* Tokens are defined on the component root so both themes resolve from one
   place. Dark is keyed to :root[data-theme="dark"] — the attribute ThemeProvider
   writes — never to prefers-color-scheme, which this app deliberately ignores. */
.nrd {
  --nrd-surface: #ffffff;
  --nrd-surface-2: #f8fafc;
  --nrd-line: #d8e0ea;
  --nrd-line-soft: #e8edf3;
  --nrd-ink: #0f172a;
  --nrd-ink-2: #475569;
  --nrd-ink-3: #64748b;
  --nrd-accent: #1d4ed8;
  --nrd-accent-soft: #dbeafe;
  --nrd-ok: #3d9142;
  --nrd-warn: #b26a00;
  --nrd-err: #d13c31;

  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 22px 30px;
  color: var(--nrd-ink);
}

:root[data-theme="dark"] .nrd {
  --nrd-surface: #111823;
  --nrd-surface-2: #161f2c;
  --nrd-line: #253244;
  --nrd-line-soft: #1c2634;
  --nrd-ink: #e8eef7;
  --nrd-ink-2: #a5b4c8;
  --nrd-ink-3: #7d8ca1;
  --nrd-accent: #7aa2f7;
  --nrd-accent-soft: #172554;
  --nrd-ok: #6cc46c;
  --nrd-warn: #e0a145;
  --nrd-err: #f0776c;
}

.nrd-head { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
.nrd-title { margin: 0; font-size: 21px; font-weight: 700; }
.nrd-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--nrd-ink-3); }
.nrd-spacer { flex: 1; }

.nrd-seg { display: inline-flex; border: 1px solid var(--nrd-line); border-radius: 8px; overflow: hidden; background: var(--nrd-surface); }
.nrd-seg button { font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 13px; border: 0; background: transparent; color: var(--nrd-ink-2); cursor: pointer; }
.nrd-seg button + button { border-left: 1px solid var(--nrd-line); }
.nrd-seg button.is-on { background: var(--nrd-accent); color: #fff; }
.nrd-seg button:focus-visible { outline: 2px solid var(--nrd-accent); outline-offset: -2px; }

.nrd-btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 13px; border-radius: 8px; border: 1px solid var(--nrd-line); background: var(--nrd-surface); color: var(--nrd-ink-2); cursor: pointer; }
.nrd-btn:focus-visible { outline: 2px solid var(--nrd-accent); outline-offset: 1px; }

.nrd-theme { display: inline-flex; align-items: center; gap: 8px; padding: 4px 11px; border: 1px solid var(--nrd-line); border-radius: 8px; background: var(--nrd-surface); }
.nrd-theme span { font-size: 11.5px; font-weight: 600; color: var(--nrd-ink-3); user-select: none; }
.nrd-theme span.is-on { color: var(--nrd-ink); }
.nrd-switch { position: relative; width: 34px; height: 18px; flex: none; border-radius: 999px; border: 1px solid var(--nrd-line); background: var(--nrd-surface-2); cursor: pointer; padding: 0; }
.nrd-switch[aria-checked="true"] { background: var(--nrd-accent); border-color: var(--nrd-accent); }
.nrd-switch:focus-visible { outline: 2px solid var(--nrd-accent); outline-offset: 2px; }
.nrd-thumb { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--nrd-surface); border: 1px solid var(--nrd-line); transition: transform .16s ease; }
.nrd-switch[aria-checked="true"] .nrd-thumb { transform: translateX(16px); background: #fff; border-color: transparent; }
@media (prefers-reduced-motion: reduce) { .nrd-thumb { transition: none; } }

.nrd-card { background: var(--nrd-surface); border: 1px solid var(--nrd-line); border-radius: 8px; min-width: 0; }
.nrd-card-head { padding: 11px 15px; border-bottom: 1px solid var(--nrd-line-soft); font-size: 12.5px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--nrd-ink-2); }
.nrd-card-body { padding: 15px; overflow-x: auto; }

.nrd-msg { padding: 22px; border: 1px solid var(--nrd-line); border-radius: 8px; background: var(--nrd-surface); color: var(--nrd-ink-2); font-size: 13.5px; }
.nrd-msg code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: var(--nrd-ink); }
.nrd-msg-err { border-color: var(--nrd-err); color: var(--nrd-err); }

.nrd-pipe { display: flex; overflow-x: auto; }
.nrd-stage { flex: 1 1 0; min-width: 128px; padding: 13px 14px; border-right: 1px solid var(--nrd-line-soft); display: flex; flex-direction: column; gap: 3px; }
.nrd-stage:last-child { border-right: 0; }
.nrd-stage-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--nrd-ink-3); white-space: nowrap; }
.nrd-stage-count { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; font-size: 25px; font-weight: 700; line-height: 1.15; }
.nrd-stage-note { font-size: 11px; color: var(--nrd-ink-3); }
.nrd-stage-bar { height: 3px; border-radius: 2px; background: var(--nrd-accent); margin-top: 5px; }
.nrd-stage.is-zero .nrd-stage-count, .nrd-stage.is-zero .nrd-stage-name { opacity: .55; }
.nrd-stage.is-zero .nrd-stage-bar { background: var(--nrd-line); }

.nrd-spark { display: block; width: 100%; height: auto; }
.nrd-spark-max { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; font-weight: 700; fill: var(--nrd-ink-3); }

.nrd-tbl-wrap { overflow-x: auto; }
.nrd-tbl { border-collapse: collapse; width: 100%; min-width: 720px; }
.nrd-tbl th { text-align: left; font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--nrd-ink-3); padding: 9px 15px; border-bottom: 1px solid var(--nrd-line); background: var(--nrd-surface-2); white-space: nowrap; }
.nrd-tbl td { padding: 9px 15px; border-bottom: 1px solid var(--nrd-line-soft); font-size: 13px; vertical-align: top; }
.nrd-tbl tr:last-child td { border-bottom: 0; }
.nrd-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--nrd-ink-3); white-space: nowrap; }
.nrd-chip { display: inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: var(--nrd-accent-soft); color: var(--nrd-accent); white-space: nowrap; }

/* Severity is a CSS dot, never an emoji — REGRESSION_PLAN §0 allowlist. */
.nrd-sev { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--nrd-ink-2); white-space: nowrap; }
.nrd-sev::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--nrd-ok); flex: none; }
.nrd-sev-warn::before { background: var(--nrd-warn); }
.nrd-sev-error::before, .nrd-sev-err::before { background: var(--nrd-err); }
```

- [ ] **Step 5: Run the tests and make sure they pass**

```bash
cd demo_api_ui && npx vitest run src/components/__tests__/NewRelicDashboard.test.jsx
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/NewRelicDashboard.jsx \
        demo_api_ui/src/components/NewRelicDashboard.css \
        demo_api_ui/src/components/__tests__/NewRelicDashboard.test.jsx
git commit -m "feat(nr): New Relic dashboard component with pipeline, volume, and stream"
```

---

## Task 3: Restore chrome and mount the dashboard

**Files:**
- Modify: `demo_api_ui/src/routes/MonitoringRoutes.js` (delete line ~39; rewrite `NewRelicRoute` at ~line 117)
- Modify: `demo_api_ui/src/App.js:510`
- Create: `demo_api_ui/src/routes/__tests__/NewRelicRoute.test.jsx`

**Interfaces:**
- Consumes: `NewRelicDashboard` from Task 2.
- Produces: `NewRelicRoute({ user, logout })` exported from `MonitoringRoutes.js`.

**What must NOT break (REGRESSION_PLAN §1):** the page stays public — no
`authenticateToken`, no redirect for signed-out users. `/monitoring/new-relic`
must NOT be added to `isNoChromeRoute()`: with `user` null, `appRendersSideNav`
returns false, so `shellRendersSideNav` returns true and `AppShell` supplies the
sidebar. Adding it there would suppress the sidebar and reintroduce the bug.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/routes/__tests__/NewRelicRoute.test.jsx`:

```jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../context/ThemeContext';
import { NewRelicRoute } from '../MonitoringRoutes';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({
    data: { window: '1h', funnel: [{ category: 'oauth', count: 3 }], timeseries: [], stream: [] },
  });
});

describe('NewRelicRoute', () => {
  it('renders app chrome for a signed-out visitor', async () => {
    render(
      <MemoryRouter initialEntries={['/monitoring/new-relic']}>
        <ThemeProvider><NewRelicRoute user={null} logout={() => {}} /></ThemeProvider>
      </MemoryRouter>,
    );
    // The side nav is the thing PR #1452 dropped; it must be back even logged out.
    await waitFor(() => expect(screen.getByRole('navigation')).toBeInTheDocument());
  });

  it('renders the dashboard, not the PingOne panel', async () => {
    render(
      <MemoryRouter initialEntries={['/monitoring/new-relic']}>
        <ThemeProvider><NewRelicRoute user={null} logout={() => {}} /></ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('stage-oauth')).toBeInTheDocument());
    expect(screen.queryByText(/No events received yet/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd demo_api_ui && npx vitest run src/routes/__tests__/NewRelicRoute.test.jsx
```

Expected: FAIL — no `navigation` role; `NewRelicRoute` renders a bare panel.

- [ ] **Step 3: Rewrite `NewRelicRoute`**

In `demo_api_ui/src/routes/MonitoringRoutes.js`, add the import at the top:

```jsx
import NewRelicDashboard from "../components/NewRelicDashboard";
```

Replace the existing `NewRelicRoute` function (near line 117) with:

```jsx
// Public — no session required. Wrapped in AppShell so the header and side nav
// render for signed-out visitors too; TopNav and AdminSideNav are both
// null-user safe. Deliberately NOT in isNoChromeRoute(): with user null,
// shellRendersSideNav() returns true and AppShell supplies the sidebar.
export function NewRelicRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <NewRelicDashboard />
    </AppShell>
  );
}
```

- [ ] **Step 4: Delete the dead route**

In the same file, remove this line from the `<Routes>` block (~line 39). It has
never rendered — `App.js` matches `/monitoring/new-relic` first.

```jsx
        <Route path="new-relic" element={<PingOneEventPanel />} />
```

- [ ] **Step 5: Pass the props in App.js**

At `demo_api_ui/src/App.js:510`, change:

```jsx
                <Route path="/monitoring/new-relic" element={<NewRelicRoute />} />
```

to:

```jsx
                <Route
                  path="/monitoring/new-relic"
                  element={<NewRelicRoute user={user} logout={logout} />}
                />
```

- [ ] **Step 6: Run the tests and make sure they pass**

```bash
cd demo_api_ui && npx vitest run src/routes/__tests__/NewRelicRoute.test.jsx
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/routes/MonitoringRoutes.js \
        demo_api_ui/src/App.js \
        demo_api_ui/src/routes/__tests__/NewRelicRoute.test.jsx
git commit -m "fix(nr): restore header and side nav, mount the dashboard"
```

---

## Task 4: Split PingOne Events onto its own page

**Files:**
- Modify: `demo_api_ui/src/routes/MonitoringRoutes.js` (add `PingOneEventsRoute`)
- Modify: `demo_api_ui/src/App.js` (add the route beside the New Relic one)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx:823-827`

**Interfaces:**
- Consumes: `AppShell`, `PingOneEventPanel` (both already imported in `MonitoringRoutes.js`).
- Produces: `PingOneEventsRoute({ user, logout })`; route `/monitoring/pingone-events`.

- [ ] **Step 1: Write the failing test**

Append to `demo_api_ui/src/routes/__tests__/NewRelicRoute.test.jsx`:

```jsx
import { PingOneEventsRoute } from '../MonitoringRoutes';

describe('PingOneEventsRoute', () => {
  it('renders the PingOne panel with chrome', async () => {
    render(
      <MemoryRouter initialEntries={['/monitoring/pingone-events']}>
        <ThemeProvider><PingOneEventsRoute user={null} logout={() => {}} /></ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/PingOne Events/i)).toBeInTheDocument());
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd demo_api_ui && npx vitest run src/routes/__tests__/NewRelicRoute.test.jsx
```

Expected: FAIL — `PingOneEventsRoute` is not exported.

- [ ] **Step 3: Add the route component**

In `demo_api_ui/src/routes/MonitoringRoutes.js`, below `NewRelicRoute`:

```jsx
// The PingOne webhook event stream. Split out of /monitoring/new-relic, which
// was named for New Relic but rendered this. Public, matching its old behavior.
export function PingOneEventsRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingOneEventPanel />
    </AppShell>
  );
}
```

- [ ] **Step 4: Register the route**

In `demo_api_ui/src/App.js`, add the import to the existing `MonitoringRoutes`
import block alongside `NewRelicRoute` (line ~148):

```jsx
  PingOneEventsRoute,
```

Then directly after the `/monitoring/new-relic` route (line ~510):

```jsx
                {/* PingOne webhook events — public, same posture as New Relic */}
                <Route
                  path="/monitoring/pingone-events"
                  element={<PingOneEventsRoute user={user} logout={logout} />}
                />
```

- [ ] **Step 5: Add the nav entry**

In `demo_api_ui/src/components/AdminSideNav.jsx`, immediately after the existing
"New Relic" entry (closes ~line 827):

```jsx
        {
          label: "PingOne Events",
          path: "/monitoring/pingone-events",
          icon: "log",
        },
```

- [ ] **Step 6: Run the tests and make sure they pass**

```bash
cd demo_api_ui && npx vitest run src/routes/__tests__/NewRelicRoute.test.jsx
```

Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/routes/MonitoringRoutes.js \
        demo_api_ui/src/App.js \
        demo_api_ui/src/components/AdminSideNav.jsx \
        demo_api_ui/src/routes/__tests__/NewRelicRoute.test.jsx
git commit -m "feat(nr): PingOne Events gets its own route and nav entry"
```

---

## Task 5: PingOne webhook secret and runbook

**Files:**
- Modify: `demo_api_server/.env.example`
- Create: `docs/PINGONE-WEBHOOK.md`
- Modify (local only, NOT committed): `demo_api_server/.env`

**Interfaces:** none — configuration and documentation only.

Scope note from the spec: this lifts the blanket 401 but the panel still reads
zero until a public tunnel exists. Do not claim the webhook works end-to-end.

- [ ] **Step 1: Generate a secret and set it locally**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Append the printed value to `demo_api_server/.env` as
`PINGONE_WEBHOOK_SECRET=<value>`. This file is gitignored — do not stage it.

- [ ] **Step 2: Document it in .env.example**

In `demo_api_server/.env.example`, in the New Relic block near line 466, add:

```bash
# PingOne webhook HMAC secret. Without it, routes/webhookPingOne.js rejects
# every POST with 401 invalid_signature before parsing the body.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# PINGONE_WEBHOOK_SECRET=
```

- [ ] **Step 3: Write the runbook**

Create `docs/PINGONE-WEBHOOK.md`:

```markdown
# PingOne webhook to New Relic

Two things must both be true before `/monitoring/pingone-events` shows anything.

## 1. The shared secret

`routes/webhookPingOne.js` verifies an HMAC-SHA256 over the raw request body
against the `x-p1-signature` header. When `PINGONE_WEBHOOK_SECRET` is unset,
`_hmacOk()` returns false immediately and every POST gets 401 — the request body
is never even parsed.

Set it in `demo_api_server/.env`:

    PINGONE_WEBHOOK_SECRET=<64 hex chars>

Generate with:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

The same value goes in the PingOne webhook subscription.

## 2. Reachability

The endpoint is `POST /webhook/pingone` on the BFF. Locally that is
`https://api.ping.demo:3001/webhook/pingone` — a hostname that resolves only on
your machine. PingOne runs in the cloud and cannot route to it, so no amount of
secret configuration will produce events locally without a tunnel.

Options:

- **Public tunnel** (ngrok, Cloudflare Tunnel) pointed at `api.ping.demo:3001`,
  then register the tunnel URL as the webhook target.
- **SE AWS deployment** — `ai-demo.ping-devops.com` is already internet-facing;
  point the subscription there instead.

## Verifying

With the secret set, a correctly signed request is accepted:

    BODY='{"type":"AUTHENTICATION","result":{"status":"SUCCESS"}}'
    SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PINGONE_WEBHOOK_SECRET" -hex | awk '{print $2}')
    curl -sk -X POST https://api.ping.demo:3001/webhook/pingone \
      -H 'Content-Type: application/json' \
      -H "x-p1-signature: $SIG" \
      -d "$BODY"

Expected: `{"ok":true}` and the event appears at `/monitoring/pingone-events`.
An unsigned request still returns `{"error":"invalid_signature"}` — that is the
guard working, not a failure.
```

- [ ] **Step 4: Verify the secret lifts the 401**

Restart the BFF so it picks up the new env var, then run the signed-request
snippet from the runbook above.

Expected: `{"ok":true}` rather than `{"error":"invalid_signature"}`.

- [ ] **Step 5: Commit**

Note `.env` is deliberately absent — it is gitignored and holds the live secret.

```bash
git add demo_api_server/.env.example docs/PINGONE-WEBHOOK.md
git commit -m "docs(webhook): document PINGONE_WEBHOOK_SECRET and the tunnel requirement"
```

---

## Task 6: Full verification

**Files:** none modified — this task is the gate.

- [ ] **Step 1: Run the full BFF suite**

```bash
cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4
```

Expected: no new failures versus the pre-change baseline. `--maxWorkers=4` avoids
the known worker-contention flake. Pre-existing live-LLM failures are known — do
not count them as regressions, but do record the count.

- [ ] **Step 2: Run the full UI unit suite**

```bash
cd demo_api_ui && npm run test:unit
```

Expected: exit 0.

- [ ] **Step 3: Run the UI build gate**

```bash
cd demo_api_ui && npm run build
```

Expected: exit 0. This is the REGRESSION_PLAN §0 hard gate — a green test run
alone is not sufficient.

- [ ] **Step 4: Run topology verify**

```bash
npm run topology:verify
```

Expected: no drift errors.

- [ ] **Step 5: Manual check**

Open `https://local.ping-devops.com:4000/monitoring/new-relic` — the only host
where sessions work. Confirm, while signed out:

1. Header and side nav are present.
2. Pipeline stages render, with counts.
3. The theme toggle flips the page, and the chart follows.
4. "PingOne Events" appears in the nav and its page loads.
5. Removing `NR_USER_API_KEY` and restarting yields the not-configured message,
   not a stack trace.

- [ ] **Step 6: Check for stray artifacts before staging**

A BFF jest run rewrites hundreds of files under `data/step-verification/`.

```bash
git status --porcelain | grep -v "^??" | head -20
```

Stage only intended files. Never `git add -A`.

- [ ] **Step 7: Commit the verification record**

```bash
git commit --allow-empty -m "chore(nr): verification pass — suites green, build 0, topology clean"
```

---

## Self-Review

**Spec coverage.** Scope A routing/chrome → Task 3. Scope A BFF proxy → Task 1.
Scope A component → Task 2. Scope A theme → Task 2 (toggle) and Task 3 (provider
in tree). Scope B webhook → Task 5. Scope C naming → Task 4. Verification → Task 6.
No spec section is unimplemented.

**Deviation recorded.** SVG replaces chart.js, reasoned above under Global
Constraints.

**Type consistency.** The payload keys `funnel` / `timeseries` / `stream` are
produced in Task 1 Step 4, asserted in Task 1 Step 2, consumed in Task 2 Step 3,
and fixtured identically in Task 2 Step 1. Stage keys in `STAGES` match the
`category` values the funnel query returns. `NewRelicRoute({ user, logout })` is
defined in Task 3 Step 3 and called with those exact props in Task 3 Step 5.
`PingOneEventsRoute` likewise across Task 4 Steps 3 and 4.

**Known gap, deliberate.** After Task 5 the webhook accepts signed requests but
PingOne still cannot reach it. Task 5's own note and the runbook both say so.
