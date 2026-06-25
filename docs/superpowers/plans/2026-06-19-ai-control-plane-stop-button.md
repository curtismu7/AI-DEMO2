# AI Control Plane Stop Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the Agent Safety stop button as a cross-platform "AI Control Plane" — a per-user roster of agent identities (live + 5 demo platforms) governed from one place, with dramatic during/after visuals, a self-explaining teaching layer, a business-value band, and a push notice to open sessions.

**Architecture:** A new backend module holds a per-session demo-agent roster (mirroring the active-vertical session-scoping). New `authenticateToken`-only routes (no admin role) expose get/stop/stop-all/reset; demo stops write a real audit record + emit an `appEventService` `control_plane` event but skip PingOne disable. The live row reuses the existing unchanged `/api/admin/agent/:id/kill-switch` real kill. The frontend ports the validated visual mockup into a `ControlPlaneRoster` React component on the Agent Safety tab, subscribing to the SSE channel for a toast push.

**Tech Stack:** Node/Express (CommonJS), Jest + supertest (mocked unit tests in `src/__tests__/`), React (CRA), react-toastify, CSS/SVG (no graph lib).

**Design source of truth:** spec `docs/superpowers/specs/2026-06-19-ai-control-plane-stop-button-design.md`; validated visual mockup on disk at `.superpowers/brainstorm/18646-1781865580/content/control-plane-combined-v3.html` (the exact markup/CSS/animation to port — it is gitignored but present in this worktree).

## Global Constraints

- **No emojis in committed source code** (REGRESSION_PLAN §0). The 🔴/🛑/♟️ etc. in the mockup are content strings rendered in the UI — keep them only as user-facing text/emoji inside JSX string literals where the existing `RedButton` already uses 🔴; do NOT add emojis to comments, logs, or identifiers.
- **Any logged-in user, no admin role** — new routes use `authenticateToken` only (NOT `requireAdmin`/`requireScopes(['admin'])`).
- **Per-user/session state** — demo roster lives on `req.session.demo_agent_roster`; never global. `req.session.save()` after mutation before responding.
- **Do NOT modify** `killSwitchService.killAgent` or the existing `POST /api/admin/agent/:agentId/kill-switch` route — the live kill stays byte-for-byte.
- **Demo stops are honest** — write a real `auditLogService.recordKillEvent`, set session status, emit a `control_plane` app-event; do NOT call PingOne token/user/app disable for demo agents.
- **UI build gate must pass**: `cd demo_api_ui && npm run build` exits 0.
- **Run all commands from the worktree** `/Users/curtismuir/Development/AI-Demo/.claude/worktrees/control-plane-stop-button`; verify `git branch --show-current` = `worktree-control-plane-stop-button` before each commit; stage explicit files (never `git add -A`).
- **Jest from a worktree** needs the `=`-form ignore override (see memory `reference_jest_worktree_ignore`): run unit tests with
  `npx jest --testPathIgnorePatterns="/node_modules/" <file>` from `demo_api_server`.

---

### Task 1: Demo-agent roster module (per-session state)

**Files:**
- Create: `demo_api_server/services/controlPlane/demoAgentRoster.js`
- Test: `demo_api_server/src/__tests__/demoAgentRoster.test.js`

**Interfaces:**
- Produces:
  - `DEMO_AGENTS` → `[{ id, platform, label }]` constant (the 5 platforms).
  - `getRoster(req)` → `[{ id, platform, label, status }]` (lazily seeds all to `'active'` on `req.session`).
  - `setStatus(req, id, status)` → mutates the session roster, returns the updated entry or `null` if `id` unknown.
  - `reset(req)` → sets every demo agent back to `'active'`, returns the roster.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/demoAgentRoster.test.js
'use strict';
const roster = require('../../services/controlPlane/demoAgentRoster');

function fakeReq() { return { session: {} }; }

describe('demoAgentRoster (per-session)', () => {
  it('seeds 5 active demo agents on first read', () => {
    const req = fakeReq();
    const list = roster.getRoster(req);
    expect(list).toHaveLength(5);
    expect(list.every((a) => a.status === 'active')).toBe(true);
    expect(list.map((a) => a.id)).toEqual(
      expect.arrayContaining(['chatgpt', 'copilot', 'glean', 'agentforce', 'servicenow'])
    );
  });

  it('setStatus flips one agent and persists on the session', () => {
    const req = fakeReq();
    roster.getRoster(req);
    const updated = roster.setStatus(req, 'glean', 'revoked');
    expect(updated.status).toBe('revoked');
    expect(roster.getRoster(req).find((a) => a.id === 'glean').status).toBe('revoked');
  });

  it('setStatus returns null for an unknown id', () => {
    const req = fakeReq();
    expect(roster.setStatus(req, 'nope', 'revoked')).toBeNull();
  });

  it('reset restores all to active', () => {
    const req = fakeReq();
    roster.getRoster(req);
    roster.setStatus(req, 'glean', 'revoked');
    roster.reset(req);
    expect(roster.getRoster(req).every((a) => a.status === 'active')).toBe(true);
  });

  it('two sessions are isolated', () => {
    const a = fakeReq(); const b = fakeReq();
    roster.getRoster(a); roster.getRoster(b);
    roster.setStatus(a, 'glean', 'revoked');
    expect(roster.getRoster(b).find((x) => x.id === 'glean').status).toBe('active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns="/node_modules/" src/__tests__/demoAgentRoster.test.js`
Expected: FAIL with "Cannot find module '../../services/controlPlane/demoAgentRoster'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_server/services/controlPlane/demoAgentRoster.js
'use strict';

// Seeded demo identities representing other AI platforms. These are NOT real
// PingOne apps — stopping them writes a real audit record but does not call
// PingOne disable (there is no real user/app behind them).
const DEMO_AGENTS = [
  { id: 'chatgpt',    platform: 'ChatGPT',        label: 'ChatGPT' },
  { id: 'copilot',    platform: 'Copilot Studio', label: 'Copilot Studio' },
  { id: 'glean',      platform: 'Glean',          label: 'Glean' },
  { id: 'agentforce', platform: 'Agentforce',     label: 'Agentforce' },
  { id: 'servicenow', platform: 'ServiceNow',     label: 'ServiceNow' },
];

function seed() {
  return DEMO_AGENTS.map((a) => ({ ...a, status: 'active' }));
}

function getRoster(req) {
  if (!req.session) req.session = {};
  if (!Array.isArray(req.session.demo_agent_roster)) {
    req.session.demo_agent_roster = seed();
  }
  return req.session.demo_agent_roster;
}

function setStatus(req, id, status) {
  const list = getRoster(req);
  const entry = list.find((a) => a.id === id);
  if (!entry) return null;
  entry.status = status;
  return entry;
}

function reset(req) {
  req.session.demo_agent_roster = seed();
  return req.session.demo_agent_roster;
}

module.exports = { DEMO_AGENTS, getRoster, setStatus, reset };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns="/node_modules/" src/__tests__/demoAgentRoster.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/controlPlane/demoAgentRoster.js demo_api_server/src/__tests__/demoAgentRoster.test.js
git commit -m "feat(control-plane): per-session demo-agent roster module"
```

---

### Task 2: Live-agent descriptor helper

**Files:**
- Create: `demo_api_server/services/controlPlane/liveAgentInfo.js`
- Test: `demo_api_server/src/__tests__/liveAgentInfo.test.js`

**Interfaces:**
- Consumes: `services/agentModeResolver` (`resolveAgentMode`, `AGENT_MODES`), `services/configStore` (`get`), `services/verticalManifest/resolver` (`activeIdFor`, `resolve`).
- Produces: `getLiveAgentRow(req)` → `{ id:'demo-agent', kind:'live', label, vertical, provider, providerLabel, status:'active' }`. `label` is `"Live Agent (<verticalDisplayName>)"`. `provider` is the resolved provider string (`'helix'|'ollama'|'anthropic'|null`); `providerLabel` is the mode label (e.g. `'Helix only'`). Never throws — falls back to defaults.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/liveAgentInfo.test.js
'use strict';

jest.mock('../../services/configStore', () => ({ get: jest.fn(() => 'helix_google') }));
jest.mock('../../services/verticalManifest/resolver', () => ({
  activeIdFor: jest.fn(() => 'banking'),
  resolve: jest.fn(() => ({ identity: { displayName: 'Super Banking' } })),
}));

const { getLiveAgentRow } = require('../../services/controlPlane/liveAgentInfo');

describe('getLiveAgentRow', () => {
  it('builds the live row from mode + vertical', () => {
    const row = getLiveAgentRow({ session: {} });
    expect(row.kind).toBe('live');
    expect(row.id).toBe('demo-agent');
    expect(row.label).toBe('Live Agent (Super Banking)');
    expect(row.provider).toBe('helix');
    expect(row.status).toBe('active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns="/node_modules/" src/__tests__/liveAgentInfo.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_server/services/controlPlane/liveAgentInfo.js
'use strict';
const { resolveAgentMode } = require('../agentModeResolver');
const configStore = require('../configStore');
const verticalResolver = require('../verticalManifest/resolver');

function getLiveAgentRow(req) {
  let verticalLabel = 'Live';
  try {
    const id = verticalResolver.activeIdFor(req);
    const manifest = verticalResolver.resolve(id);
    verticalLabel = (manifest && manifest.identity && manifest.identity.displayName) || id || 'Live';
  } catch (_) { /* fall back */ }

  let provider = null;
  let providerLabel = 'Heuristics only';
  try {
    const modeId = configStore.get('agent_mode');
    const resolved = resolveAgentMode(modeId);
    provider = resolved.provider;
    providerLabel = resolved.providerLabel || resolved.mode;
  } catch (_) { /* fall back */ }

  return {
    id: 'demo-agent',
    kind: 'live',
    label: `Live Agent (${verticalLabel})`,
    vertical: verticalLabel,
    provider,
    providerLabel,
    status: 'active',
  };
}

module.exports = { getLiveAgentRow };
```

> NOTE: `resolveAgentMode` currently returns `{ mode, provider, ... }` (no `providerLabel`). If `providerLabel` is absent the code falls back to `resolved.mode`. Optionally add `label: m.label` to the `resolveAgentMode` return in `agentModeResolver.js` as a 1-line, backward-compatible addition; if you do, add it and keep its existing tests green. Otherwise leave `agentModeResolver` untouched and rely on the fallback.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns="/node_modules/" src/__tests__/liveAgentInfo.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/controlPlane/liveAgentInfo.js demo_api_server/src/__tests__/liveAgentInfo.test.js
git commit -m "feat(control-plane): live-agent descriptor (vertical + provider)"
```

---

### Task 3: Control-plane routes (get / stop / stop-all / reset)

**Files:**
- Create: `demo_api_server/routes/controlPlane.js`
- Modify: `demo_api_server/server.js` (mount the router near the other route mounts)
- Test: `demo_api_server/src/__tests__/controlPlaneRoutes.test.js`

**Interfaces:**
- Consumes: Task 1 `demoAgentRoster`, Task 2 `getLiveAgentRow`, `services/auditLogService` (`recordKillEvent`, `recordKillFailure`), `services/appEventService` (`logEvent`), `middleware/auth` (`authenticateToken`).
- Produces routes (all `authenticateToken`, no admin role), mounted at `/api/control-plane`:
  - `GET /agents` → `{ live: {...}, demo: [...] }`
  - `POST /agents/:agentId/stop` → demo only → `{ ok:true, agent, audit_id }`; live id → `409 { error:'use_live_endpoint' }`; unknown → `404`.
  - `POST /stop-all` → `{ ok:true, stopped:[{id, audit_id}], count }`
  - `POST /reset` → `{ ok:true, demo:[...] }`

**Honest-subset stop (shared helper inside the router):**

```javascript
async function stopDemoAgent(req, agent, reason) {
  const snapshot = { demo: true, agent_id: agent.id, active_sessions: [] };
  const auditId = await auditLogService.recordKillEvent(agent.id, reason, snapshot, 0, `demo-${agent.id}`);
  demoAgentRoster.setStatus(req, agent.id, 'revoked');
  appEventService.logEvent('control_plane', 'warning',
    `${agent.label} stopped by the Ping control plane`,
    { tag: 'agent_stopped', metadata: { agentId: agent.id, label: agent.label, reason, kind: 'demo', audit_id: auditId } });
  return auditId;
}
```

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/controlPlaneRoutes.test.js
'use strict';
const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { role: 'enduser' }; next(); },
}));
jest.mock('../../services/auditLogService', () => ({
  recordKillEvent: jest.fn(async () => 'audit-123'),
  recordKillFailure: jest.fn(async () => 'audit-fail'),
}));
jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn(() => ({ id: 'evt' })) }));
jest.mock('../../services/controlPlane/liveAgentInfo', () => ({
  getLiveAgentRow: () => ({ id: 'demo-agent', kind: 'live', label: 'Live Agent (Super Banking)', provider: 'helix', status: 'active' }),
}));

const auditLogService = require('../../services/auditLogService');
const controlPlaneRouter = require('../../routes/controlPlane');

// session shim: one object reused across requests in a test via a closure
function createApp(session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; req.session.save = (cb) => cb && cb(); next(); });
  app.use('/api/control-plane', controlPlaneRouter);
  return app;
}

describe('control-plane routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET /agents returns live + 5 demo', async () => {
    const res = await request(createApp({})).get('/api/control-plane/agents');
    expect(res.status).toBe(200);
    expect(res.body.live.kind).toBe('live');
    expect(res.body.demo).toHaveLength(5);
  });

  it('POST stop on a demo agent writes audit, emits event, flips status', async () => {
    const session = {};
    const app = createApp(session);
    const res = await request(app).post('/api/control-plane/agents/glean/stop').send({ reason: 'manual_safety' });
    expect(res.status).toBe(200);
    expect(res.body.audit_id).toBe('audit-123');
    expect(auditLogService.recordKillEvent).toHaveBeenCalledWith('glean', 'manual_safety', expect.any(Object), 0, 'demo-glean');
    const after = await request(app).get('/api/control-plane/agents');
    expect(after.body.demo.find((a) => a.id === 'glean').status).toBe('revoked');
  });

  it('POST stop on the live id is rejected with 409', async () => {
    const res = await request(createApp({})).post('/api/control-plane/agents/demo-agent/stop').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('use_live_endpoint');
  });

  it('POST stop on unknown id is 404', async () => {
    const res = await request(createApp({})).post('/api/control-plane/agents/nope/stop').send({});
    expect(res.status).toBe(404);
  });

  it('POST stop-all flips all active demo agents', async () => {
    const session = {};
    const app = createApp(session);
    const res = await request(app).post('/api/control-plane/stop-all').send({ reason: 'manual_safety' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(5);
    const after = await request(app).get('/api/control-plane/agents');
    expect(after.body.demo.every((a) => a.status === 'revoked')).toBe(true);
  });

  it('POST reset restores all to active', async () => {
    const session = {};
    const app = createApp(session);
    await request(app).post('/api/control-plane/stop-all').send({});
    const res = await request(app).post('/api/control-plane/reset').send({});
    expect(res.status).toBe(200);
    expect(res.body.demo.every((a) => a.status === 'active')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns="/node_modules/" src/__tests__/controlPlaneRoutes.test.js`
Expected: FAIL with "Cannot find module '../../routes/controlPlane'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_server/routes/controlPlane.js
'use strict';
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const demoAgentRoster = require('../services/controlPlane/demoAgentRoster');
const { getLiveAgentRow } = require('../services/controlPlane/liveAgentInfo');
const auditLogService = require('../services/auditLogService');
const appEventService = require('../services/appEventService');

async function stopDemoAgent(req, agent, reason) {
  const snapshot = { demo: true, agent_id: agent.id, active_sessions: [] };
  const auditId = await auditLogService.recordKillEvent(agent.id, reason, snapshot, 0, `demo-${agent.id}`);
  demoAgentRoster.setStatus(req, agent.id, 'revoked');
  appEventService.logEvent('control_plane', 'warning',
    `${agent.label} stopped by the Ping control plane`,
    { tag: 'agent_stopped', metadata: { agentId: agent.id, label: agent.label, reason, kind: 'demo', audit_id: auditId } });
  return auditId;
}

router.get('/agents', authenticateToken, (req, res) => {
  const demo = demoAgentRoster.getRoster(req);
  const live = getLiveAgentRow(req);
  return res.json({ live, demo });
});

router.post('/agents/:agentId/stop', authenticateToken, async (req, res) => {
  const { agentId } = req.params;
  const reason = (req.body && req.body.reason) || 'manual_safety';
  if (agentId === 'demo-agent') {
    return res.status(409).json({ error: 'use_live_endpoint', message: 'Stop the live agent via /api/admin/agent/demo-agent/kill-switch' });
  }
  const agent = demoAgentRoster.getRoster(req).find((a) => a.id === agentId);
  if (!agent) return res.status(404).json({ error: 'unknown_agent', message: `No demo agent '${agentId}'` });
  try {
    const auditId = await stopDemoAgent(req, agent, reason);
    req.session.save(() => res.json({ ok: true, agent: { ...agent, status: 'revoked' }, audit_id: auditId }));
  } catch (e) {
    await auditLogService.recordKillFailure(agentId, reason, e.message);
    return res.status(500).json({ error: 'stop_failed', message: e.message });
  }
});

router.post('/stop-all', authenticateToken, async (req, res) => {
  const reason = (req.body && req.body.reason) || 'manual_safety';
  const active = demoAgentRoster.getRoster(req).filter((a) => a.status === 'active');
  const stopped = [];
  for (const agent of active) {
    try {
      const auditId = await stopDemoAgent(req, agent, reason);
      stopped.push({ id: agent.id, audit_id: auditId });
    } catch (e) {
      await auditLogService.recordKillFailure(agent.id, reason, e.message);
    }
  }
  req.session.save(() => res.json({ ok: true, stopped, count: stopped.length }));
});

router.post('/reset', authenticateToken, (req, res) => {
  const demo = demoAgentRoster.reset(req);
  req.session.save(() => res.json({ ok: true, demo }));
});

module.exports = router;
```

Then mount in `server.js` (next to the other `app.use('/api/...', require('./routes/...'))` lines — search for `require('./routes/admin')` and add adjacent):

```javascript
app.use('/api/control-plane', require('./routes/controlPlane'));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns="/node_modules/" src/__tests__/controlPlaneRoutes.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/controlPlane.js demo_api_server/server.js demo_api_server/src/__tests__/controlPlaneRoutes.test.js
git commit -m "feat(control-plane): get/stop/stop-all/reset routes (any user, per-session)"
```

---

### Task 4: Let any authenticated user receive `control_plane` push events

**Files:**
- Modify: `demo_api_server/routes/admin.js` (the `GET /app-events/stream` handler, ~lines 1066-1095)
- Test: `demo_api_server/src/__tests__/appEventsStreamAccess.test.js`

**Why:** The push notice must reach non-admin users. Today the stream requires admin. Change: keep admins receiving everything; allow **any authenticated** user to connect but, for non-admins, only forward `control_plane` category events. This is additive and does not reduce admin visibility.

**Interfaces:**
- Produces: `GET /api/admin/app-events/stream` now uses `authenticateToken` (not `requireAdmin`); inside the subscribe callback, non-admin sessions only receive events where `event.category === 'control_plane'` (plus any explicit `?category=` filter, unchanged for admins).

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/appEventsStreamAccess.test.js
'use strict';
// Verifies the filtering predicate used by the stream: non-admins get only control_plane.
const { controlPlaneVisible } = require('../../routes/appEventsStreamFilter');

describe('control_plane stream visibility', () => {
  it('admin sees every category', () => {
    expect(controlPlaneVisible({ role: 'admin' }, { category: 'agent' })).toBe(true);
    expect(controlPlaneVisible({ role: 'admin' }, { category: 'control_plane' })).toBe(true);
  });
  it('non-admin sees only control_plane', () => {
    expect(controlPlaneVisible({ role: 'enduser' }, { category: 'agent' })).toBe(false);
    expect(controlPlaneVisible({ role: 'enduser' }, { category: 'control_plane' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns="/node_modules/" src/__tests__/appEventsStreamAccess.test.js`
Expected: FAIL ("Cannot find module '../../routes/appEventsStreamFilter'").

- [ ] **Step 3: Write minimal implementation**

Create the tiny predicate module so it is unit-testable:

```javascript
// demo_api_server/routes/appEventsStreamFilter.js
'use strict';
function isAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.scopes) && user.scopes.includes('admin');
}
// Returns whether this user may receive this event over the shared SSE stream.
function controlPlaneVisible(user, event) {
  if (isAdmin(user)) return true;
  return event && event.category === 'control_plane';
}
module.exports = { controlPlaneVisible, isAdmin };
```

Then edit the `GET /app-events/stream` handler in `routes/admin.js`: change the middleware from `requireAdmin, requireScopes(['admin'])` to `authenticateToken`, and gate each write with the predicate:

```javascript
const { controlPlaneVisible } = require('./appEventsStreamFilter'); // top of admin.js

router.get('/app-events/stream', authenticateToken, (req, res) => {
  const { category } = req.query;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' });
  res.flushHeaders();
  const unsubscribe = appEventService.subscribe((event) => {
    if (!controlPlaneVisible(req.user, event)) return;          // NEW access gate
    if (category && event.category !== category) return;        // existing explicit filter
    try { res.write(`event: app-event\ndata: ${JSON.stringify(event)}\n\n`); } catch (_) {}
  });
  const heartbeat = setInterval(() => { try { res.write(': hb\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});
```

> Verify `req.user` is populated by `authenticateToken` in this codebase; if user data lives on `req.session.user`, pass that to `controlPlaneVisible` instead. Confirm by reading `middleware/auth.js` before editing.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns="/node_modules/" src/__tests__/appEventsStreamAccess.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/appEventsStreamFilter.js demo_api_server/routes/admin.js demo_api_server/src/__tests__/appEventsStreamAccess.test.js
git commit -m "feat(control-plane): allow any authed user to receive control_plane push events"
```

---

### Task 5: Frontend API client

**Files:**
- Create: `demo_api_ui/src/services/controlPlaneApi.js`

**Interfaces:**
- Consumes: existing `apiClient` (axios) — match how `Admin.jsx` imports it (verify the import path used at `Admin.jsx:235`, likely `../services/apiClient` or similar).
- Produces: `getAgents()`, `stopAgent(id, reason)`, `stopAll(reason)`, `resetRoster()` — each returns the parsed response data.

- [ ] **Step 1: Implement (thin wrapper; covered by the component test in Task 6 and the build gate)**

```javascript
// demo_api_ui/src/services/controlPlaneApi.js
import apiClient from './apiClient'; // VERIFY exact path/default-vs-named against Admin.jsx

const BASE = '/api/control-plane';
export const getAgents   = () => apiClient.get(`${BASE}/agents`).then((r) => r.data);
export const stopAgent   = (id, reason = 'manual_safety') => apiClient.post(`${BASE}/agents/${id}/stop`, { reason }).then((r) => r.data);
export const stopAll     = (reason = 'manual_safety') => apiClient.post(`${BASE}/stop-all`, { reason }).then((r) => r.data);
export const resetRoster = () => apiClient.post(`${BASE}/reset`, {}).then((r) => r.data);
```

- [ ] **Step 2: Commit**

```bash
git add demo_api_ui/src/services/controlPlaneApi.js
git commit -m "feat(control-plane): frontend API client"
```

---

### Task 6: ControlPlaneRoster component (port the validated mockup)

**Files:**
- Create: `demo_api_ui/src/components/ControlPlaneRoster.jsx`
- Create: `demo_api_ui/src/components/ControlPlaneRoster.css`
- Test: `demo_api_ui/src/components/__tests__/ControlPlaneRoster.test.jsx` (light render/interaction; use the project's existing React test setup — verify whether `@testing-library/react` is present, else keep to a render smoke test)

**Source of truth:** Port the markup, CSS, and animation logic from the validated mockup
`.superpowers/brainstorm/18646-1781865580/content/control-plane-combined-v3.html`. Translate:
- the inline `<style>` → `ControlPlaneRoster.css` (prefix classes `cp-`, already namespaced).
- the vanilla-JS roster build / cascade / shockwave / stamps / flash / end-card / live caption → React state + effects.
- the hardcoded `agents` array → state seeded from `getAgents()` (Task 5); the live row from `data.live`, demo rows from `data.demo`.
- per-row stop → `stopAgent(id)`; stop-all → `stopAll()` with the staggered cascade animation; reset → `resetRoster()`.
- the live row's `stop` → reuse the EXISTING `RedButton` + `KillSwitchConfirmModal` flow (real kill via `/api/admin/agent/demo-agent/kill-switch`), unchanged.
- Keep the "What this is" intro, the 3-step "How Ping does this", the access note, and the "Why this matters" business-value band verbatim from the mockup.

**Interfaces:**
- Consumes: Task 5 api client; `useAppEventsSSE` (`demo_api_ui/src/hooks/useAppEventsSSE.js`); `notifyError`/a toast from `demo_api_ui/src/utils/appToast.js`; existing `RedButton`, `KillSwitchConfirmModal`.
- Produces: default-exported `<ControlPlaneRoster />` taking no required props.

**Push wiring (inside the component):**

```jsx
useAppEventsSSE((evt) => {
  if (evt && evt.category === 'control_plane' && evt.metadata && evt.metadata.tag !== undefined) {
    // toast in every open session
    notify(`${evt.message}${evt.metadata.reason ? ` — reason: ${evt.metadata.reason}` : ''}`);
    // reconcile roster status from the pushed metadata so other tabs update
    setAgents((prev) => prev.map((a) => a.id === evt.metadata.agentId ? { ...a, status: 'revoked' } : a));
  }
}, { category: 'control_plane' });
```

- [ ] **Step 1: Write a render smoke test (mock the api client + SSE hook)**

```jsx
// demo_api_ui/src/components/__tests__/ControlPlaneRoster.test.jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('../../services/controlPlaneApi', () => ({
  getAgents: jest.fn(async () => ({
    live: { id: 'demo-agent', kind: 'live', label: 'Live Agent (Super Banking)', provider: 'helix', status: 'active' },
    demo: [
      { id: 'chatgpt', platform: 'ChatGPT', label: 'ChatGPT', status: 'active' },
      { id: 'glean', platform: 'Glean', label: 'Glean', status: 'active' },
    ],
  })),
  stopAgent: jest.fn(), stopAll: jest.fn(), resetRoster: jest.fn(),
}));
jest.mock('../../hooks/useAppEventsSSE', () => ({ useAppEventsSSE: jest.fn() }));
jest.mock('../../utils/appToast', () => ({ notifySuccess: jest.fn(), notifyError: jest.fn() }));

import ControlPlaneRoster from '../ControlPlaneRoster';

it('renders the live row and demo platforms', async () => {
  render(<ControlPlaneRoster />);
  await waitFor(() => expect(screen.getByText(/Live Agent \(Super Banking\)/)).toBeInTheDocument());
  expect(screen.getByText('ChatGPT')).toBeInTheDocument();
  expect(screen.getByText(/Stop across all platforms/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && CI=true npx jest src/components/__tests__/ControlPlaneRoster.test.jsx`
Expected: FAIL (component not found). If `@testing-library/react`/jest is not configured in this CRA app, skip the RTL test and rely on the build gate (Step 4) — note that explicitly in the commit.

- [ ] **Step 3: Implement the component + CSS** by porting `control-plane-combined-v3.html` as described above. Keep all four sections (what / how / surface / why), the dramatic motion, the durable "Last action" summary, and the per-user reset.

- [ ] **Step 4: Verify the test passes (or build gate)**

Run: `cd demo_api_ui && CI=true npx jest src/components/__tests__/ControlPlaneRoster.test.jsx`
Expected: PASS. Then ALWAYS run the build gate: `cd demo_api_ui && npm run build` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/ControlPlaneRoster.jsx demo_api_ui/src/components/ControlPlaneRoster.css demo_api_ui/src/components/__tests__/ControlPlaneRoster.test.jsx
git commit -m "feat(control-plane): ControlPlaneRoster component (ported mockup + push)"
```

---

### Task 7: Mount the roster on the Agent Safety tab

**Files:**
- Modify: `demo_api_ui/src/components/Admin.jsx` (safety tab content, ~lines 176-227)

**Interfaces:**
- Consumes: Task 6 `ControlPlaneRoster`.
- The existing `RedButton` + `KillSwitchConfirmModal` + `ForensicAuditDashboard` stay — `ControlPlaneRoster` renders them for the live row internally OR sits above them. Simplest: render `<ControlPlaneRoster />` at the top of the safety tab and keep `ForensicAuditDashboard` beneath it. Do NOT remove the existing kill modal wiring used by the live row.

- [ ] **Step 1: Add the import**

```jsx
import ControlPlaneRoster from './ControlPlaneRoster';
```

- [ ] **Step 2: Render it at the top of the safety tab block**

```jsx
{activeTab === "safety" && (
  <div className="admin-section">
    <h2>Agent Safety Control Center</h2>
    <ControlPlaneRoster />
    {/* existing RedButton / ForensicAuditDashboard layout retained below */}
    ...
  </div>
)}
```

- [ ] **Step 3: Ensure the Agent Safety tab is reachable by any logged-in user.** Verify whether `Admin.jsx`/its route is admin-gated in the SPA. If it is, expose the control-plane surface to non-admins (e.g. ensure the safety tab renders for any authenticated user, or surface `ControlPlaneRoster` via a route any user can reach). Confirm the gating before changing it; make the minimal change that satisfies "any logged-in user can run it" without un-gating other admin tabs.

- [ ] **Step 4: Build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/Admin.jsx
git commit -m "feat(control-plane): mount roster on Agent Safety tab (any user)"
```

---

### Task 8: End-to-end manual verification + regression note

**Files:**
- Modify: `CHANGELOG.md` (add one line under [Unreleased] → Added)
- Modify: the REGRESSION_PLAN Bug/Change log if the repo convention requires it (per `regression-guard`)

- [ ] **Step 1: Run the app and verify** (use the `run` skill / `./run.sh`): log in as a NON-admin user, open Agent Safety, confirm the roster renders with the live row (correct vertical + provider) and 5 demo platforms; click a single stop (pill → revoked, trust link severs, toast fires, audit increments); click "Stop across all platforms" (cascade + end-card + persistent summary); open a second tab and confirm the toast push appears there; click Reset (all active again). Confirm the live row's stop still triggers the real kill + logout.
- [ ] **Step 2:** Confirm the existing kill-switch path is unchanged (the live `RedButton` still calls `/api/admin/agent/demo-agent/kill-switch`).
- [ ] **Step 3:** `cd demo_api_ui && npm run build` → 0; run the new backend unit tests together:
  `cd demo_api_server && npx jest --testPathIgnorePatterns="/node_modules/" src/__tests__/demoAgentRoster.test.js src/__tests__/liveAgentInfo.test.js src/__tests__/controlPlaneRoutes.test.js src/__tests__/appEventsStreamAccess.test.js`
- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(control-plane): changelog + regression note for AI Control Plane"
```

---

## Self-Review

**Spec coverage:**
- Four-verb header, trust panel, roster, stop-all, reset → Tasks 6/7 (ported mockup).
- Per-session demo registry → Task 1. Live row vertical+provider → Task 2.
- Routes (get/stop/stop-all/reset), honest-subset stop (audit yes, PingOne disable no) → Task 3.
- Any-user access (no admin role) → Tasks 3 + 7 (UI reachability) + Task 4 (push for non-admins).
- Provider-agnostic kill story → Task 2 surfaces provider; the real kill is unchanged (token-layer), so Helix/Ollama/Claude all covered without code change.
- Vertical-agnostic → Task 2 label from the vertical resolver.
- Push to all sessions → Task 3 emits `control_plane` event; Task 4 delivers to any user; Task 6 toasts + reconciles.
- Visual during/after (cascade, stamps, flash, end-card, durable summary) → Task 6.
- Self-explaining copy + business value → Task 6 (verbatim from mockup).
- Live kill preserved → Tasks 6/7 reuse the existing endpoint; constraint repeated in Global Constraints.

**Placeholder scan:** No "TBD/handle errors" left except two explicit VERIFY notes (apiClient import path in Task 5; `req.user` shape in Task 4) — both are "read this file to confirm the exact symbol," not deferred work, and each has a concrete fallback.

**Type consistency:** `getRoster/setStatus/reset(req)` (Task 1) used consistently in Task 3. `getLiveAgentRow(req)` (Task 2) → `{ live, demo }` shape consumed identically in Task 3 route, Task 5 client, and Task 6 component. `control_plane` category + `metadata.agentId/label/reason/kind/audit_id` emitted in Task 3, filtered in Task 4, consumed in Task 6 — names match.
