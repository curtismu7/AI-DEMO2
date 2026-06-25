# Lighthouse Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Lighthouse performance auditing panel to the Admin section — admins can trigger on-demand audits and view a 30-run history with score trend chart.

**Architecture:** Lighthouse runs as a Node.js library inside `demo_api_server` via two new BFF routes (`POST /api/admin/lighthouse/run`, `GET /api/admin/lighthouse/history`). Results are stored in LMDB capped at 30 entries. A `node-cron` job triggers nightly scheduled runs. The React UI is a new standalone admin sub-page at `/admin/performance`.

**Tech Stack:** Node.js (CommonJS), `lighthouse` npm package, `chrome-launcher`, `node-cron`, LMDB (`lmdb` via existing `openEnv`), React (CRA, ES modules + JSX in `.js`), `react-chartjs-2` + `chart.js` (already in deps)

---

## File Map

### New — BFF
- `demo_api_server/services/lighthouseService.js` — `runLighthouseAudit()`, `getHistory()`, `saveResult()`, `isRunning` flag
- `demo_api_server/services/lighthouseScheduler.js` — `node-cron` job, calls `runLighthouseAudit()`
- `demo_api_server/routes/lighthouseRoute.js` — `POST /run`, `GET /history`, auth gating
- `demo_api_server/tests/lighthouseRoute.regression.test.js` — unit tests

### New — UI
- `demo_api_ui/src/components/LighthousePanel.js` — main panel component
- `demo_api_ui/src/components/LighthousePanel.css` — panel styles
- `demo_api_ui/src/components/LighthouseTrendChart.js` — sparkline chart

### Modified
- `demo_api_server/server.js` — mount route + start scheduler
- `demo_api_server/package.json` — add `lighthouse`, `chrome-launcher`, `node-cron`
- `demo_api_ui/src/components/AdminSideNav.jsx` — add nav entry (array only)
- `demo_api_ui/src/App.js` — add `/admin/performance` route
- `docs/ENV_VARS.md` — document `LIGHTHOUSE_CRON`
- `REGRESSION_PLAN.md` — §1 tracked files + §4 bug log entry

---

## Task 1: Install BFF dependencies

**Files:**
- Modify: `demo_api_server/package.json`

- [ ] **Step 1: Install packages**

```bash
cd demo_api_server
npm install lighthouse chrome-launcher node-cron
```

- [ ] **Step 2: Verify installed**

```bash
node -e "require('lighthouse'); require('chrome-launcher'); require('node-cron'); console.log('ok')"
```

Expected output: `ok`

- [ ] **Step 3: Commit**

```bash
cd ..
git add demo_api_server/package.json demo_api_server/package-lock.json
git commit -m "chore: install lighthouse, chrome-launcher, node-cron in demo_api_server"
```

---

## Task 2: Write the regression test (failing)

**Files:**
- Create: `demo_api_server/tests/lighthouseRoute.regression.test.js`

- [ ] **Step 1: Create the test file**

```javascript
// demo_api_server/tests/lighthouseRoute.regression.test.js
'use strict';

jest.mock('../services/lighthouseService', () => ({
  runLighthouseAudit: jest.fn(),
  getHistory: jest.fn(),
  isRunning: false,
}));

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const lighthouseRoute = require('../routes/lighthouseRoute');
const lighthouseService = require('../services/lighthouseService');

function buildApp({ sessionUser } = {}) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (sessionUser) req.session.user = sessionUser;
    next();
  });
  app.use('/api/admin/lighthouse', lighthouseRoute);
  return app;
}

const ADMIN_USER = { id: 'u1', role: 'admin', sub: 'u1' };
const CUSTOMER_USER = { id: 'u2', role: 'customer', sub: 'u2' };

const MOCK_RESULT = {
  timestamp: '2026-05-27T00:00:00.000Z',
  scores: { performance: 91, accessibility: 96, bestPractices: 78, seo: 48 },
  metrics: { fcp: 0.9, lcp: 1.2, tbt: 20, cls: 0, si: 2.4 },
};

describe('POST /api/admin/lighthouse/run', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 when not logged in', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(401);
  });

  test('returns 403 when logged in as customer', async () => {
    const app = buildApp({ sessionUser: CUSTOMER_USER });
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(403);
  });

  test('returns 429 when audit already in progress', async () => {
    lighthouseService.isRunning = true;
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(429);
    lighthouseService.isRunning = false;
  });

  test('returns 200 with result on success', async () => {
    lighthouseService.runLighthouseAudit.mockResolvedValue(MOCK_RESULT);
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: MOCK_RESULT });
  });

  test('returns 503 when Chrome unavailable', async () => {
    const err = new Error('Chrome not found');
    err.code = 'CHROME_NOT_FOUND';
    lighthouseService.runLighthouseAudit.mockRejectedValue(err);
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(503);
  });

  test('returns 504 on timeout', async () => {
    const err = new Error('Audit timed out');
    err.code = 'LIGHTHOUSE_TIMEOUT';
    lighthouseService.runLighthouseAudit.mockRejectedValue(err);
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(504);
  });
});

describe('GET /api/admin/lighthouse/history', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 when not logged in', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/admin/lighthouse/history');
    expect(res.status).toBe(401);
  });

  test('returns 403 when logged in as customer', async () => {
    const app = buildApp({ sessionUser: CUSTOMER_USER });
    const res = await request(app).get('/api/admin/lighthouse/history');
    expect(res.status).toBe(403);
  });

  test('returns 200 with history array', async () => {
    lighthouseService.getHistory.mockReturnValue([MOCK_RESULT]);
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).get('/api/admin/lighthouse/history');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ history: [MOCK_RESULT] });
  });

  test('returns empty array when no history', async () => {
    lighthouseService.getHistory.mockReturnValue([]);
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).get('/api/admin/lighthouse/history');
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server
npx jest lighthouseRoute.regression --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../routes/lighthouseRoute'`

---

## Task 3: Implement lighthouseService

**Files:**
- Create: `demo_api_server/services/lighthouseService.js`

- [ ] **Step 1: Create the service**

```javascript
// demo_api_server/services/lighthouseService.js
'use strict';

const { getDb } = require('./lmdb/openEnv');

const DB_KEY = 'lighthouse_history';
const MAX_HISTORY = 30;
const AUDIT_TIMEOUT_MS = 60_000;

/** In-memory flag — prevents concurrent audit runs. */
let isRunning = false;

/**
 * Run a Lighthouse audit against the given URL.
 * Requires Chrome to be installed on the host.
 * @returns {Promise<{timestamp, scores, metrics}>}
 */
async function runLighthouseAudit(url) {
  // Lazy-require so the module loads fine in test environments that mock it
  const chromeLauncher = require('chrome-launcher');
  const lighthouse = require('lighthouse');

  let chrome;
  const timer = setTimeout(() => {
    if (chrome) chrome.kill().catch(() => {});
    const err = new Error('Audit timed out after 60s');
    err.code = 'LIGHTHOUSE_TIMEOUT';
    throw err;
  }, AUDIT_TIMEOUT_MS);

  try {
    chrome = await chromeLauncher.launch({ chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'] });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error('Chrome could not be launched: ' + e.message);
    err.code = 'CHROME_NOT_FOUND';
    throw err;
  }

  try {
    const runnerResult = await lighthouse(url, {
      port: chrome.port,
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      output: 'json',
      logLevel: 'error',
    });

    clearTimeout(timer);

    const cats = runnerResult.lhr.categories;
    const audits = runnerResult.lhr.audits;

    const result = {
      timestamp: new Date().toISOString(),
      scores: {
        performance:   Math.round((cats['performance']?.score   ?? 0) * 100),
        accessibility: Math.round((cats['accessibility']?.score ?? 0) * 100),
        bestPractices: Math.round((cats['best-practices']?.score ?? 0) * 100),
        seo:           Math.round((cats['seo']?.score           ?? 0) * 100),
      },
      metrics: {
        fcp: audits['first-contentful-paint']?.numericValue  ? +(audits['first-contentful-paint'].numericValue / 1000).toFixed(1) : null,
        lcp: audits['largest-contentful-paint']?.numericValue ? +(audits['largest-contentful-paint'].numericValue / 1000).toFixed(1) : null,
        tbt: audits['total-blocking-time']?.numericValue      ? Math.round(audits['total-blocking-time'].numericValue) : null,
        cls: audits['cumulative-layout-shift']?.numericValue  != null ? +audits['cumulative-layout-shift'].numericValue.toFixed(3) : null,
        si:  audits['speed-index']?.numericValue              ? +(audits['speed-index'].numericValue / 1000).toFixed(1) : null,
      },
    };

    saveResult(result);
    return result;
  } finally {
    await chrome.kill().catch(() => {});
  }
}

/**
 * Persist a result to LMDB, capped at MAX_HISTORY entries.
 * Oldest entry is dropped when the cap is reached.
 */
function saveResult(result) {
  try {
    const db = getDb('lighthouse');
    const existing = db.get(DB_KEY) || [];
    const updated = [...existing, result];
    if (updated.length > MAX_HISTORY) updated.shift();
    db.putSync(DB_KEY, updated);
  } catch (err) {
    console.error('[lighthouse] LMDB write failed — result not persisted:', err.message);
  }
}

/**
 * Return the stored audit history (up to MAX_HISTORY entries), newest last.
 */
function getHistory() {
  try {
    const db = getDb('lighthouse');
    return db.get(DB_KEY) || [];
  } catch (err) {
    console.error('[lighthouse] LMDB read failed:', err.message);
    return [];
  }
}

module.exports = { runLighthouseAudit, saveResult, getHistory, get isRunning() { return isRunning; }, set isRunning(v) { isRunning = v; } };
```

- [ ] **Step 2: Verify file is valid JS**

```bash
cd demo_api_server
node -e "require('./services/lighthouseService'); console.log('ok')"
```

Expected: `ok`

---

## Task 4: Implement lighthouseRoute

**Files:**
- Create: `demo_api_server/routes/lighthouseRoute.js`

- [ ] **Step 1: Create the route**

```javascript
// demo_api_server/routes/lighthouseRoute.js
'use strict';

const express = require('express');
const router = express.Router();
const configStore = require('../services/configStore');
const lighthouseService = require('./lighthouseService');

// Resolve the audit target URL from configStore (PUBLIC_APP_URL) or fall back to default
function getAuditUrl() {
  const base = configStore.getEffective('PUBLIC_APP_URL') || 'https://api.ping.demo:4000';
  return `${base}/admin`;
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
  next();
}

/**
 * POST /api/admin/lighthouse/run
 * Triggers a Lighthouse audit. Returns the result immediately.
 */
router.post('/run', requireAdmin, async (req, res) => {
  if (lighthouseService.isRunning) {
    return res.status(429).json({ error: 'An audit is already in progress' });
  }

  lighthouseService.isRunning = true;
  try {
    const result = await lighthouseService.runLighthouseAudit(getAuditUrl());
    res.json({ result });
  } catch (err) {
    console.error('[lighthouse] Audit failed:', err.message);
    if (err.code === 'CHROME_NOT_FOUND') {
      return res.status(503).json({ error: 'Lighthouse audit failed: Chrome not available' });
    }
    if (err.code === 'LIGHTHOUSE_TIMEOUT') {
      return res.status(504).json({ error: 'Lighthouse audit timed out' });
    }
    res.status(500).json({ error: 'Lighthouse audit failed: ' + err.message });
  } finally {
    lighthouseService.isRunning = false;
  }
});

/**
 * GET /api/admin/lighthouse/history
 * Returns stored audit history (up to 30 entries).
 */
router.get('/history', requireAdmin, (req, res) => {
  const history = lighthouseService.getHistory();
  res.json({ history });
});

module.exports = router;
```

- [ ] **Step 2: Fix the require path in the route**

The route currently requires `'./lighthouseService'` but should be `'../services/lighthouseService'`. Fix it:

```javascript
// Change this line in lighthouseRoute.js:
const lighthouseService = require('./lighthouseService');
// To:
const lighthouseService = require('../services/lighthouseService');
```

- [ ] **Step 3: Verify file is valid JS**

```bash
cd demo_api_server
node -e "require('./routes/lighthouseRoute'); console.log('ok')"
```

Expected: `ok`

---

## Task 5: Run tests — verify they pass

- [ ] **Step 1: Run regression tests**

```bash
cd demo_api_server
npx jest lighthouseRoute.regression --no-coverage 2>&1 | tail -30
```

Expected: all tests PASS (12 tests)

- [ ] **Step 2: Commit BFF service + route + tests**

```bash
cd ..
git add demo_api_server/services/lighthouseService.js \
        demo_api_server/routes/lighthouseRoute.js \
        demo_api_server/tests/lighthouseRoute.regression.test.js
git commit -m "feat(lighthouse): add lighthouseService, lighthouseRoute, regression tests"
```

---

## Task 6: Implement lighthouseScheduler

**Files:**
- Create: `demo_api_server/services/lighthouseScheduler.js`

- [ ] **Step 1: Create the scheduler**

```javascript
// demo_api_server/services/lighthouseScheduler.js
'use strict';

const cron = require('node-cron');
const configStore = require('./configStore');
const { runLighthouseAudit } = require('./lighthouseService');

const DEFAULT_CRON = '0 0 * * *'; // midnight daily

/**
 * Start the Lighthouse scheduled audit job.
 * Schedule is read from LIGHTHOUSE_CRON via configStore at startup.
 * Changes to LIGHTHOUSE_CRON take effect on next BFF restart.
 */
function startScheduler() {
  const schedule = configStore.getEffective('LIGHTHOUSE_CRON') || DEFAULT_CRON;

  if (!cron.validate(schedule)) {
    console.warn(`[lighthouse-scheduler] Invalid cron expression "${schedule}" — using default "${DEFAULT_CRON}"`);
  }

  const validSchedule = cron.validate(schedule) ? schedule : DEFAULT_CRON;

  cron.schedule(validSchedule, async () => {
    console.log('[lighthouse-scheduler] Running scheduled audit...');
    try {
      const configHostnameService = require('./configHostnameService');
      const base = configStore.getEffective('PUBLIC_APP_URL') || 'https://api.ping.demo:4000';
      await runLighthouseAudit(`${base}/admin`);
      console.log('[lighthouse-scheduler] Scheduled audit complete');
    } catch (err) {
      console.error('[lighthouse-scheduler] Scheduled audit failed:', err.message);
    }
  });

  console.log(`[lighthouse-scheduler] Scheduled audit registered: "${validSchedule}"`);
}

module.exports = { startScheduler };
```

- [ ] **Step 2: Verify file is valid JS**

```bash
cd demo_api_server
node -e "require('./services/lighthouseScheduler'); console.log('ok')"
```

Expected: `ok`

---

## Task 7: Mount route and start scheduler in server.js

**Files:**
- Modify: `demo_api_server/server.js`

- [ ] **Step 1: Add require statements** — find the block of admin route requires (around line 72–95) and add:

```javascript
const lighthouseRoute = require('./routes/lighthouseRoute');
const { startScheduler: startLighthouseScheduler } = require('./services/lighthouseScheduler');
```

- [ ] **Step 2: Mount the route** — find the block of `app.use('/api/admin/...')` mounts (around line 988) and add:

```javascript
app.use('/api/admin/lighthouse', lighthouseRoute);
```

- [ ] **Step 3: Start the scheduler** — find the `.listen()` callback or startup block (search for `server.listen` or `app.listen`) and add after the vault loader starts:

```javascript
startLighthouseScheduler();
```

- [ ] **Step 4: Verify server starts without error**

```bash
cd demo_api_server
node -e "
  process.env.NODE_ENV = 'test';
  // Just check the requires load without actually binding to a port
  require('./routes/lighthouseRoute');
  require('./services/lighthouseScheduler');
  console.log('ok');
"
```

Expected: `ok`

- [ ] **Step 5: Commit**

```bash
cd ..
git add demo_api_server/server.js demo_api_server/services/lighthouseScheduler.js
git commit -m "feat(lighthouse): mount route and start scheduler in server.js"
```

---

## Task 8: Document LIGHTHOUSE_CRON in ENV_VARS.md

**Files:**
- Modify: `docs/ENV_VARS.md`

- [ ] **Step 1: Add env var entry** — open `docs/ENV_VARS.md` and add an entry for `LIGHTHOUSE_CRON` in the appropriate section (alongside other optional config vars):

```markdown
### LIGHTHOUSE_CRON
- **Purpose:** Cron schedule for automatic Lighthouse performance audits
- **Default:** `0 0 * * *` (midnight daily)
- **Example:** `0 */6 * * *` (every 6 hours)
- **Notes:** Read at BFF startup. Changes take effect on next restart. Must be a valid cron expression. Invalid values fall back to the default.
```

- [ ] **Step 2: Commit**

```bash
git add docs/ENV_VARS.md
git commit -m "docs: document LIGHTHOUSE_CRON env var"
```

---

## Task 9: Implement LighthouseTrendChart component

**Files:**
- Create: `demo_api_ui/src/components/LighthouseTrendChart.js`

- [ ] **Step 1: Create the chart component**

```javascript
// demo_api_ui/src/components/LighthouseTrendChart.js
import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
} from 'chart.js';

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

/**
 * LighthouseTrendChart — sparkline of Performance scores across audit history.
 * @param {Array<{timestamp: string, scores: {performance: number}}>} history
 */
export default function LighthouseTrendChart({ history }) {
  if (!history || history.length === 0) return null;

  const labels = history.map((h) =>
    new Date(h.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  );
  const scores = history.map((h) => h.scores.performance);

  const data = {
    labels,
    datasets: [
      {
        data: scores,
        borderColor: '#1d4ed8',
        backgroundColor: 'transparent',
        pointRadius: 2,
        pointBackgroundColor: '#1d4ed8',
        tension: 0.3,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      y: { min: 0, max: 100, grid: { color: '#e5e7eb' }, ticks: { color: '#9ca3af', font: { size: 11 } } },
      x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { size: 11 }, maxTicksLimit: 8 } },
    },
  };

  return (
    <div style={{ height: '80px' }}>
      <Line data={data} options={options} />
    </div>
  );
}
```

---

## Task 10: Implement LighthousePanel component

**Files:**
- Create: `demo_api_ui/src/components/LighthousePanel.js`
- Create: `demo_api_ui/src/components/LighthousePanel.css`

- [ ] **Step 1: Create the CSS**

```css
/* demo_api_ui/src/components/LighthousePanel.css */
.lighthouse-panel { max-width: 900px; }
.lighthouse-panel-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.lighthouse-panel-title { font-size: 17px; font-weight: 600; color: #111827; margin: 0 0 4px; }
.lighthouse-panel-meta { font-size: 12px; color: #9ca3af; margin: 0; }
.lighthouse-run-btn { background: #1d4ed8; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-size: 13px; font-weight: 500; cursor: pointer; }
.lighthouse-run-btn:disabled { background: #93c5fd; cursor: not-allowed; }
.lighthouse-run-error { color: #dc2626; font-size: 13px; margin-top: 8px; }
.lighthouse-score-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
.lighthouse-score-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }
.lighthouse-score-card.red { background: #fef2f2; border-color: #fecaca; }
.lighthouse-score-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.8px; }
.lighthouse-score-value { font-size: 38px; font-weight: 700; margin: 8px 0 2px; }
.lighthouse-score-value.green { color: #16a34a; }
.lighthouse-score-value.yellow { color: #ca8a04; }
.lighthouse-score-value.red { color: #dc2626; }
.lighthouse-score-denom { font-size: 11px; color: #9ca3af; }
.lighthouse-chart-box,
.lighthouse-metrics-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.lighthouse-box-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 12px; }
.lighthouse-metrics-table { width: 100%; font-size: 13px; border-collapse: collapse; }
.lighthouse-metrics-table th { text-align: left; padding: 4px 0; font-size: 11px; color: #9ca3af; font-weight: 500; }
.lighthouse-metrics-table th:nth-child(2),
.lighthouse-metrics-table td:nth-child(2) { text-align: right; }
.lighthouse-metrics-table th:nth-child(3),
.lighthouse-metrics-table td:nth-child(3) { text-align: right; }
.lighthouse-metrics-table tr { border-top: 1px solid #e5e7eb; }
.lighthouse-metrics-table tr:first-child { border-top: none; }
.lighthouse-metrics-table td { padding: 9px 0; color: #374151; }
.lighthouse-tag-ok { color: #16a34a; font-weight: 600; }
.lighthouse-tag-warn { color: #dc2626; font-weight: 600; }
.lighthouse-empty { color: #9ca3af; font-size: 14px; padding: 32px 0; text-align: center; }
```

- [ ] **Step 2: Create the panel component**

```javascript
// demo_api_ui/src/components/LighthousePanel.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import LighthouseTrendChart from './LighthouseTrendChart';
import './LighthousePanel.css';

function scoreColor(score) {
  if (score >= 90) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

function metricStatus(key, value) {
  if (value == null) return { label: '—', ok: true };
  const thresholds = { fcp: 1.8, lcp: 2.5, tbt: 200, cls: 0.1, si: 3.4 };
  return value <= thresholds[key]
    ? { label: '✅ Good', ok: true }
    : { label: '⚠️ Needs work', ok: false };
}

const METRIC_LABELS = {
  fcp: 'First Contentful Paint',
  lcp: 'Largest Contentful Paint',
  tbt: 'Total Blocking Time',
  cls: 'Cumulative Layout Shift',
  si:  'Speed Index',
};

const METRIC_UNITS = { fcp: 's', lcp: 's', tbt: 'ms', cls: '', si: 's' };

export default function LighthousePanel() {
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/admin/lighthouse/history');
      setHistory(res.data.history || []);
    } catch (err) {
      setLoadError('Failed to load audit history.');
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const runAudit = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await apiClient.post('/api/admin/lighthouse/run');
      setHistory((prev) => [...prev, res.data.result].slice(-30));
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Audit failed';
      setError(msg);
    } finally {
      setRunning(false);
    }
  };

  const latest = history.length > 0 ? history[history.length - 1] : null;

  return (
    <div className="lighthouse-panel">
      <div className="lighthouse-panel-header">
        <div>
          <p className="lighthouse-panel-title">Lighthouse Performance Audit</p>
          <p className="lighthouse-panel-meta">
            Auditing: /admin
            {latest && <> &nbsp;·&nbsp; Last run: {new Date(latest.timestamp).toLocaleString()}</>}
          </p>
        </div>
        <div>
          <button className="lighthouse-run-btn" onClick={runAudit} disabled={running}>
            {running ? 'Running…' : 'Run Audit'}
          </button>
          {error && <p className="lighthouse-run-error">{error}</p>}
        </div>
      </div>

      {loadError && <p className="lighthouse-run-error">{loadError}</p>}

      {!latest ? (
        <p className="lighthouse-empty">No audits yet. Click "Run Audit" to get started.</p>
      ) : (
        <>
          {/* Score cards */}
          <div className="lighthouse-score-grid">
            {Object.entries(latest.scores).map(([key, score]) => (
              <div key={key} className={`lighthouse-score-card ${score < 50 ? 'red' : ''}`}>
                <div className="lighthouse-score-label">
                  {key === 'bestPractices' ? 'Best Practices' : key.charAt(0).toUpperCase() + key.slice(1)}
                </div>
                <div className={`lighthouse-score-value ${scoreColor(score)}`}>{score}</div>
                <div className="lighthouse-score-denom">/ 100</div>
              </div>
            ))}
          </div>

          {/* Trend chart */}
          {history.length > 1 && (
            <div className="lighthouse-chart-box">
              <div className="lighthouse-box-label">Performance Score — Last {history.length} Runs</div>
              <LighthouseTrendChart history={history} />
            </div>
          )}

          {/* Metrics table */}
          <div className="lighthouse-metrics-box">
            <div className="lighthouse-box-label">Latest Metrics</div>
            <table className="lighthouse-metrics-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(latest.metrics).map(([key, value]) => {
                  const { label, ok } = metricStatus(key, value);
                  const unit = METRIC_UNITS[key];
                  return (
                    <tr key={key}>
                      <td>{METRIC_LABELS[key]}</td>
                      <td>{value != null ? `${value}${unit}` : '—'}</td>
                      <td className={ok ? 'lighthouse-tag-ok' : 'lighthouse-tag-warn'}>{label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/LighthousePanel.js \
        demo_api_ui/src/components/LighthousePanel.css \
        demo_api_ui/src/components/LighthouseTrendChart.js
git commit -m "feat(lighthouse): add LighthousePanel and LighthouseTrendChart components"
```

---

## Task 11: Wire UI into Admin nav and routing

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (nav array only)
- Modify: `demo_api_ui/src/App.js`

- [ ] **Step 1: Add nav entry to AdminSideNav** — find the `allNavItems` array (around line 123). Add a "Performance" item to the admin-only section, alongside other admin tools like "Vault":

```javascript
{ label: "Performance", path: "/admin/performance", icon: "lht" },
```

Place it after the `{ label: "Vault", path: "/admin/vault" }` entry. Touch **only** the nav array — do not change icons, CSS, layout, or `renderNavItem`.

- [ ] **Step 2: Add route to App.js** — find the `AdminVaultPage` route (around line 1128) and add below it:

```javascript
import LighthousePanel from "./components/LighthousePanel";
// ... (add the import near the top of the file with other admin imports)

// In the Routes section, alongside the vault route:
<Route
  path="/admin/performance"
  element={
    <RequireAuth>
      <RequireAdmin>
        <AdminLayout user={user}>
          <LighthousePanel />
        </AdminLayout>
      </RequireAuth>
    </RequireAdmin>
  }
/>
```

> **Note:** Check what wrapper components `AdminVaultPage` uses (RequireAuth, AdminLayout, etc.) and mirror the same pattern exactly for the LighthousePanel route.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/AdminSideNav.jsx \
        demo_api_ui/src/App.js
git commit -m "feat(lighthouse): add Performance nav entry and /admin/performance route"
```

---

## Task 12: Build UI and verify

- [ ] **Step 1: Build the React app**

```bash
cd demo_api_ui
npm run build 2>&1 | tail -20
```

Expected: exit code 0, no errors.

- [ ] **Step 2: Run full regression test suite**

```bash
cd ..
cd demo_api_server
npx jest lighthouseRoute.regression --no-coverage
```

Expected: all tests pass.

- [ ] **Step 3: Update REGRESSION_PLAN.md** — open `REGRESSION_PLAN.md` and:

  1. In §1 (tracked files table), add:
     ```
     | `demo_api_server/routes/lighthouseRoute.js` | Lighthouse BFF route — auth gating, 429 on concurrent runs |
     | `demo_api_server/services/lighthouseService.js` | LMDB history cap logic, isRunning flag |
     ```

  2. In §4 (Bug Fix Log), add:
     ```
     ### [2026-05-27] Lighthouse Admin Panel
     Added Lighthouse performance auditing to the Admin panel. New routes: POST /api/admin/lighthouse/run, GET /api/admin/lighthouse/history. Results stored in LMDB (capped at 30). Scheduled nightly via node-cron. UI at /admin/performance.
     ```

- [ ] **Step 4: Commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs: update REGRESSION_PLAN for lighthouse admin panel"
```

---

## Task 13: Manual verification

- [ ] **Step 1: Start all services**

```bash
./run.sh
```

- [ ] **Step 2: Log in as admin** — navigate to `https://api.ping.demo:4000`, log in with admin credentials.

- [ ] **Step 3: Navigate to Performance tab** — Admin → Performance (in sidebar). Confirm empty state message is shown.

- [ ] **Step 4: Run an audit** — click "Run Audit". Button should show "Running…" and disable. After 10–30s, scores appear.

- [ ] **Step 5: Verify score cards** — four score cards show with correct colors (green/yellow/red).

- [ ] **Step 6: Verify metrics table** — FCP, LCP, TBT, CLS, Speed Index with ✅/⚠️ status.

- [ ] **Step 7: Run a second audit** — click "Run Audit" again. After completion, the trend chart should appear (requires 2+ results).

- [ ] **Step 8: Verify history API** — in a new terminal:

```bash
curl -s -b cookies.txt https://api.ping.demo:3001/api/admin/lighthouse/history | python3 -m json.tool | head -30
```

Expected: `{ "history": [ ... ] }` with 2 entries.
