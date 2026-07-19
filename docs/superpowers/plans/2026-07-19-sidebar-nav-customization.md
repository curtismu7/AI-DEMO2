# Sidebar Nav Customization + Saved Demo Configs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user check which top-level sidebar items show for them, save that selection (+ current feature-flag states) as a named reusable config, and apply built-in (Full mode / Demo mode / Learning) or custom configs later.

**Architecture:** A new boolean feature flag (`ff_sidebar_customization`) gates whether `AdminSideNav.jsx` respects a per-user hidden-items list. Two new LMDB-backed API surfaces: a shared named-config library (`/api/nav-configs`) and a per-user active-selection store (`/api/user/nav-config`), both living in one new LMDB sub-DB (`navConfigStore.lmdb.js`, same key-namespace convention as the existing `verticalStore.lmdb.js`). A new page (`/demo-config`, visible to every signed-in user — no admin gate) lets a user check/uncheck items and save/apply configs.

**Tech Stack:** Express + LMDB (`lmdb` npm package) on the backend (`demo_api_server`), React + Vite + Vitest/RTL on the frontend (`demo_api_ui`).

## Global Constraints

- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` — this plan uses only `✅` and `✕`, matching `FeatureFlagsPage.js`'s existing toast/dismiss icons.
- `configStore.js` is a REGRESSION_PLAN §1 protected area ("configStore / Config UI") — Task 1 ONLY appends one new `FIELD_DEFS` key; no existing entry is modified or reordered.
- After any `demo_api_ui/` change, `cd demo_api_ui && npm run build` must exit `0` (REGRESSION_PLAN §0 UI build gate) — this is the last step of Task 10.
- Backend tests live under `demo_api_server/src/__tests__/**/*.test.js` or `demo_api_server/tests/**/*.test.js` — `jest.config.js`'s `testMatch` (lines 36-39) does NOT match a bare `routes/__tests__/` directory, so new tests must go in `src/__tests__/`.
- Frontend tests use **Vitest**, not Jest (`demo_api_ui/vite.config.js` `test` block) — use `vi.fn()` / `vi.mock()` (or the `jest` alias installed in `src/setupTests.js`), not bare `jest.mock()` hoisting semantics from a different runner.
- Canonical per-user key is `req.user.id` (the OAuth `sub` claim) — same key `tokenChainService` and `conversationStore.lmdb.js` already use. Never key on `email` or `username`.

---

### Task 1: Register the `ff_sidebar_customization` feature flag

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js:665-671` (insert new `FLAG_REGISTRY` entry)
- Modify: `demo_api_server/services/configStore.js:309-310` (insert new `FIELD_DEFS` entry)
- Test: `demo_api_server/src/__tests__/featureFlags.route.test.js`

**Regression-guard note:** `configStore.js` is a REGRESSION_PLAN §1 protected area. This task will NOT touch any existing `FIELD_DEFS` key, value, or ordering — it only appends one new line.

**Interfaces:**
- Produces: flag id `ff_sidebar_customization` (boolean, default `false`), resolvable via the existing `resolveFlag()` / `GET /api/admin/feature-flags` / `PATCH /api/admin/feature-flags` machinery. No new code paths — reuses `routes/featureFlags.js`'s existing `resolveFlag`/`serializeFlag`.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('GET /api/admin/feature-flags', ...)` block in `demo_api_server/src/__tests__/featureFlags.route.test.js`, right after the `'registers ff_customer_skin_ping2026 with default false'` test (after line 113):

```js
    it('registers ff_sidebar_customization with default false', async () => {
      const res = await request(app).get('/api/admin/feature-flags');
      const flag = res.body.flags.find(f => f.id === 'ff_sidebar_customization');
      expect(flag).toBeDefined();
      expect(flag.type).toBe('boolean');
      expect(flag.defaultValue).toBe(false);
      expect(flag.value).toBe(false);
      expect(flag.category).toBe('UI / Dashboard');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/featureFlags.route.test.js -t "ff_sidebar_customization"`
Expected: FAIL — `expect(flag).toBeDefined()` fails because `flag` is `undefined` (the registry entry doesn't exist yet).

- [ ] **Step 3: Add the FLAG_REGISTRY entry**

In `demo_api_server/routes/featureFlags.js`, find this exact block (the end of `ff_customer_skin_ping2026`, right before `ff_mcp_gateway_pinggateway`):

```js
    impact:
      'OFF (default) = classic customer dashboard, no change. ' +
      'ON = new Ping2026 customer dashboard component; requires B2 behaviors to be built before enabling in production.',
    type:         'boolean',
    defaultValue: false,
  },
  {
    id:           'ff_mcp_gateway_pinggateway',
```

Replace it with (inserting the new entry between the two):

```js
    impact:
      'OFF (default) = classic customer dashboard, no change. ' +
      'ON = new Ping2026 customer dashboard component; requires B2 behaviors to be built before enabling in production.',
    type:         'boolean',
    defaultValue: false,
  },
  {
    id:           'ff_sidebar_customization',
    name:         'Sidebar Customization',
    category:     'UI / Dashboard',
    description:
      'When **ON**, the sidebar hides items the current user has unchecked on the Demo Config page ' +
      '(`/demo-config`). When **OFF** (default), the full sidebar always shows regardless of any saved ' +
      'per-user selection — the selection is preserved server-side either way, so re-enabling restores it.',
    impact:
      'OFF (default) = full sidebar for everyone, no change. ' +
      'ON = each user sees only their own saved subset of top-level nav items.',
    type:         'boolean',
    defaultValue: false,
  },
  {
    id:           'ff_mcp_gateway_pinggateway',
```

- [ ] **Step 4: Add the FIELD_DEFS entry**

In `demo_api_server/services/configStore.js`, find this exact line:

```js
  ff_admin_skin_ping2026:    { public: true, default: 'true'  }, // Admin dashboard new Ping2026 skin — ON by default
```

Replace it with (inserting the new key right after):

```js
  ff_admin_skin_ping2026:    { public: true, default: 'true'  }, // Admin dashboard new Ping2026 skin — ON by default
  ff_sidebar_customization:  { public: true, default: 'false' }, // Per-user sidebar item visibility (Demo Config page); must match routes/featureFlags.js FLAG_REGISTRY (defaultValue:false)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/featureFlags.route.test.js -t "ff_sidebar_customization"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/services/configStore.js demo_api_server/src/__tests__/featureFlags.route.test.js
git commit -m "feat(flags): add ff_sidebar_customization flag"
```

---

### Task 2: `navConfigStore.lmdb.js` — LMDB persistence for nav configs + per-user prefs

**Files:**
- Create: `demo_api_server/services/lmdb/navConfigStore.lmdb.js`
- Modify: `demo_api_server/services/lmdb/openEnv.js:23-25` (reserve the new DB)
- Test: `demo_api_server/src/__tests__/navConfigStore.lmdb.test.js`

**Interfaces:**
- Consumes: `openEnv().openDB(name, opts)` from `./openEnv` (existing, `services/lmdb/openEnv.js:14-26`).
- Produces (for Tasks 3 & 4):
  - `listConfigs(): Array<Config>` — seeds + returns all configs, builtins first.
  - `getConfig(id: string): Config | null`
  - `createConfig(name: string, hiddenLabels: string[], flagSnapshot: object): Config`
  - `deleteConfig(id: string): { ok: boolean, reason?: 'not_found' | 'builtin' }`
  - `getUserPrefs(userId: string): { hiddenLabels: string[], activeConfigId: string | null, updatedAt: number | null }`
  - `setUserPrefs(userId: string, hiddenLabels: string[], activeConfigId: string | null): UserPrefs`
  - `Config` shape: `{ id, name, isBuiltin, hiddenLabels, flagSnapshot, createdAt, updatedAt }`

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/src/__tests__/navConfigStore.lmdb.test.js`:

```js
'use strict';

const store = require('../../services/lmdb/navConfigStore.lmdb');

describe('navConfigStore.lmdb', () => {
  test('listConfigs seeds and returns the 3 built-in configs', () => {
    const configs = store.listConfigs();
    const names = configs.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['Full mode', 'Demo mode', 'Learning']));
    expect(configs.filter(c => c.isBuiltin)).toHaveLength(3);
  });

  test('Full mode builtin has no hidden items', () => {
    const configs = store.listConfigs();
    const full = configs.find(c => c.name === 'Full mode');
    expect(full.hiddenLabels).toEqual([]);
  });

  test('createConfig persists a custom config and getConfig retrieves it', () => {
    const created = store.createConfig('Q3 walkthrough', ['Themes', 'Developer Tools'], { ff_rar: true });
    expect(created.id).toMatch(/^cfg_/);
    expect(created.isBuiltin).toBe(false);

    const fetched = store.getConfig(created.id);
    expect(fetched.name).toBe('Q3 walkthrough');
    expect(fetched.hiddenLabels).toEqual(['Themes', 'Developer Tools']);
    expect(fetched.flagSnapshot).toEqual({ ff_rar: true });
  });

  test('deleteConfig removes a custom config', () => {
    const created = store.createConfig('Temp', [], {});
    const result = store.deleteConfig(created.id);
    expect(result.ok).toBe(true);
    expect(store.getConfig(created.id)).toBeNull();
  });

  test('deleteConfig refuses to remove a builtin', () => {
    const configs = store.listConfigs();
    const full = configs.find(c => c.name === 'Full mode');
    const result = store.deleteConfig(full.id);
    expect(result).toEqual({ ok: false, reason: 'builtin' });
    expect(store.getConfig(full.id)).not.toBeNull();
  });

  test('deleteConfig on an unknown id reports not_found', () => {
    const result = store.deleteConfig('cfg_does_not_exist');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('getUserPrefs defaults to empty hiddenLabels for a first-time user', () => {
    const prefs = store.getUserPrefs('user-never-seen-before');
    expect(prefs).toEqual({ hiddenLabels: [], activeConfigId: null, updatedAt: null });
  });

  test('setUserPrefs then getUserPrefs round-trips', () => {
    const saved = store.setUserPrefs('user-42', ['Themes'], 'cfg_abc123');
    expect(saved.hiddenLabels).toEqual(['Themes']);
    expect(saved.activeConfigId).toBe('cfg_abc123');
    expect(typeof saved.updatedAt).toBe('number');

    const fetched = store.getUserPrefs('user-42');
    expect(fetched).toEqual(saved);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && npx jest src/__tests__/navConfigStore.lmdb.test.js`
Expected: FAIL with `Cannot find module '../../services/lmdb/navConfigStore.lmdb'`

- [ ] **Step 3: Reserve the new DB in openEnv.js**

In `demo_api_server/services/lmdb/openEnv.js`, find:

```js
  // Initialize named DBs upfront to reserve them in the environment
  getDb('conversations');
  return _env;
```

Replace with:

```js
  // Initialize named DBs upfront to reserve them in the environment
  getDb('conversations');
  getDb('navConfigs');
  return _env;
```

- [ ] **Step 4: Write navConfigStore.lmdb.js**

Create `demo_api_server/services/lmdb/navConfigStore.lmdb.js`:

```js
'use strict';
/**
 * navConfigStore.lmdb.js — LMDB-backed persistence for sidebar nav
 * customization. Sibling to verticalStore.lmdb.js (same prefixed-key,
 * single-DB convention).
 *
 * Key layout (single LMDB DB named 'navConfigs'):
 *   config:<id>        -> { id, name, isBuiltin, hiddenLabels, flagSnapshot, createdAt, updatedAt }
 *   userPrefs:<userId>  -> { hiddenLabels, activeConfigId, updatedAt }
 */
const { getDb } = require('./openEnv');
const crypto = require('crypto');

const DB_NAME = 'navConfigs';

function _db() { return getDb(DB_NAME); }

// Hidden-item labels here match the top-level `allNavItems` labels in
// demo_api_ui/src/components/AdminSideNav.jsx exactly (see
// demo_api_ui/src/config/navItemsCatalog.js, the shared source list).
const BUILTIN_CONFIGS = [
  {
    id: 'full-mode',
    name: 'Full mode',
    isBuiltin: true,
    hiddenLabels: [],
    flagSnapshot: {},
  },
  {
    id: 'demo-mode',
    name: 'Demo mode',
    isBuiltin: true,
    hiddenLabels: [
      'Themes', 'Agent Demo Guide', 'PingOne MCP', 'Banking MCP & Gateways',
      'PingOne Demo Apps', 'Delegation & Consent', 'OAuth & Identity',
      'Users & Accounts', 'AI Attack Demos', 'Monitoring', 'Telemetry',
      'Diagrams', 'Agent Studio (Preview)', 'Developer Tools', 'System Tools',
      'Integration Tests',
    ],
    flagSnapshot: {},
  },
  {
    id: 'learning',
    name: 'Learning',
    isBuiltin: true,
    hiddenLabels: [
      'Themes', 'Agent Demo Guide', 'Family Delegation', 'AI Agents',
      'PingOne MCP', 'Banking MCP & Gateways', 'Delegation & Consent',
      'Industry Verticals', 'Users & Accounts', 'AI Attack Demos',
      'Monitoring', 'Telemetry', 'Agent Studio (Preview)', 'Developer Tools',
      'System Tools', 'Integration Tests',
    ],
    flagSnapshot: {},
  },
];

function seedBuiltins() {
  const db = _db();
  for (const cfg of BUILTIN_CONFIGS) {
    if (db.get(`config:${cfg.id}`) === undefined) {
      const now = Date.now();
      db.putSync(`config:${cfg.id}`, { ...cfg, createdAt: now, updatedAt: now });
    }
  }
}

function listConfigs() {
  seedBuiltins();
  const db = _db();
  const configs = [];
  for (const { value } of db.getRange({ start: 'config:', end: 'config;' })) {
    if (value) configs.push(value);
  }
  return configs.sort((a, b) => Number(b.isBuiltin) - Number(a.isBuiltin) || a.name.localeCompare(b.name));
}

function getConfig(id) {
  seedBuiltins();
  return _db().get(`config:${id}`) || null;
}

function createConfig(name, hiddenLabels, flagSnapshot) {
  const id = 'cfg_' + crypto.randomBytes(4).toString('hex');
  const now = Date.now();
  const config = { id, name, isBuiltin: false, hiddenLabels, flagSnapshot, createdAt: now, updatedAt: now };
  _db().putSync(`config:${id}`, config);
  return config;
}

function deleteConfig(id) {
  const config = _db().get(`config:${id}`);
  if (!config) return { ok: false, reason: 'not_found' };
  if (config.isBuiltin) return { ok: false, reason: 'builtin' };
  _db().removeSync(`config:${id}`);
  return { ok: true };
}

function getUserPrefs(userId) {
  const v = _db().get(`userPrefs:${userId}`);
  return v || { hiddenLabels: [], activeConfigId: null, updatedAt: null };
}

function setUserPrefs(userId, hiddenLabels, activeConfigId) {
  const prefs = { hiddenLabels, activeConfigId: activeConfigId || null, updatedAt: Date.now() };
  _db().putSync(`userPrefs:${userId}`, prefs);
  return prefs;
}

module.exports = {
  listConfigs, getConfig, createConfig, deleteConfig,
  getUserPrefs, setUserPrefs,
  seedBuiltins, BUILTIN_CONFIGS, DB_NAME,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_api_server && npx jest src/__tests__/navConfigStore.lmdb.test.js`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/lmdb/navConfigStore.lmdb.js demo_api_server/services/lmdb/openEnv.js demo_api_server/src/__tests__/navConfigStore.lmdb.test.js
git commit -m "feat(nav-config): add LMDB store for nav configs + per-user prefs"
```

---

### Task 3: `routes/navConfigs.js` — shared named-config library API

**Files:**
- Create: `demo_api_server/routes/navConfigs.js`
- Test: `demo_api_server/src/__tests__/navConfigs.route.test.js`

**Interfaces:**
- Consumes: `navConfigStore.{listConfigs,createConfig,deleteConfig}` from Task 2.
- Produces: Express router with `GET /`, `POST /`, `DELETE /:id` — mounted at `/api/nav-configs` in Task 5.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/src/__tests__/navConfigs.route.test.js`:

```js
'use strict';

const express = require('express');
const request = require('supertest');
const navConfigsRouter = require('../../routes/navConfigs');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/nav-configs', navConfigsRouter);
  return app;
}

describe('GET /api/nav-configs', () => {
  test('lists the 3 builtin configs at minimum', async () => {
    const res = await request(makeApp()).get('/api/nav-configs');
    expect(res.status).toBe(200);
    const names = res.body.configs.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['Full mode', 'Demo mode', 'Learning']));
  });
});

describe('POST /api/nav-configs', () => {
  test('creates a custom config', async () => {
    const res = await request(makeApp())
      .post('/api/nav-configs')
      .send({ name: 'My Demo', hiddenLabels: ['Themes'], flagSnapshot: { ff_rar: true } });
    expect(res.status).toBe(201);
    expect(res.body.config.name).toBe('My Demo');
    expect(res.body.config.isBuiltin).toBe(false);
  });

  test('rejects a missing name with 400', async () => {
    const res = await request(makeApp())
      .post('/api/nav-configs')
      .send({ hiddenLabels: [] });
    expect(res.status).toBe(400);
  });

  test('rejects a non-array hiddenLabels with 400', async () => {
    const res = await request(makeApp())
      .post('/api/nav-configs')
      .send({ name: 'Bad', hiddenLabels: 'not-an-array' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/nav-configs/:id', () => {
  test('deletes a custom config', async () => {
    const app = makeApp();
    const created = await request(app)
      .post('/api/nav-configs')
      .send({ name: 'Temp', hiddenLabels: [], flagSnapshot: {} });
    const res = await request(app).delete(`/api/nav-configs/${created.body.config.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  test('refuses to delete a builtin with 403', async () => {
    const app = makeApp();
    const list = await request(app).get('/api/nav-configs');
    const full = list.body.configs.find(c => c.name === 'Full mode');
    const res = await request(app).delete(`/api/nav-configs/${full.id}`);
    expect(res.status).toBe(403);
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(makeApp()).delete('/api/nav-configs/cfg_does_not_exist');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && npx jest src/__tests__/navConfigs.route.test.js`
Expected: FAIL with `Cannot find module '../../routes/navConfigs'`

- [ ] **Step 3: Write the router**

Create `demo_api_server/routes/navConfigs.js`:

```js
'use strict';
/**
 * navConfigs.js — shared named-config library for sidebar customization.
 *
 * GET    /api/nav-configs      → list all configs (builtins + custom)
 * POST   /api/nav-configs      → create a custom config from a snapshot
 * DELETE /api/nav-configs/:id  → delete a custom config (403 on builtins)
 */
const express = require('express');
const router = express.Router();
const navConfigStore = require('../services/lmdb/navConfigStore.lmdb');

router.get('/', (req, res) => {
  res.json({ configs: navConfigStore.listConfigs() });
});

router.post('/', (req, res) => {
  const { name, hiddenLabels, flagSnapshot } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!Array.isArray(hiddenLabels)) {
    return res.status(400).json({ error: 'hiddenLabels must be an array' });
  }
  const config = navConfigStore.createConfig(name.trim(), hiddenLabels, flagSnapshot || {});
  res.status(201).json({ config });
});

router.delete('/:id', (req, res) => {
  const result = navConfigStore.deleteConfig(req.params.id);
  if (!result.ok && result.reason === 'not_found') {
    return res.status(404).json({ error: 'Config not found' });
  }
  if (!result.ok && result.reason === 'builtin') {
    return res.status(403).json({ error: 'Cannot delete a built-in config' });
  }
  res.json({ deleted: true });
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && npx jest src/__tests__/navConfigs.route.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/navConfigs.js demo_api_server/src/__tests__/navConfigs.route.test.js
git commit -m "feat(nav-config): add /api/nav-configs shared library route"
```

---

### Task 4: `routes/userNavConfig.js` — per-user active selection API (flag-gated)

**Files:**
- Create: `demo_api_server/routes/userNavConfig.js`
- Test: `demo_api_server/src/__tests__/userNavConfig.route.test.js`

**Interfaces:**
- Consumes: `navConfigStore.{getUserPrefs,setUserPrefs}` (Task 2), `configStore.getEffective('ff_sidebar_customization')` (Task 1, existing `services/configStore.js` API).
- Produces: Express router with `GET /`, `PUT /` — mounted at `/api/user/nav-config` behind `authenticateToken` in Task 5. Response shape: `{ hiddenLabels: string[], activeConfigId: string|null, flagOn: boolean }`. **When `ff_sidebar_customization` is OFF, `hiddenLabels` is always `[]`** regardless of what's stored — this is how the flag gates the feature without the frontend needing to separately resolve it.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/src/__tests__/userNavConfig.route.test.js`:

```js
'use strict';

const express = require('express');
const request = require('supertest');
const userNavConfigRouter = require('../../routes/userNavConfig');
const configStore = require('../../services/configStore');

function makeApp(userId = 'test-user') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/user/nav-config', userNavConfigRouter);
  return app;
}

describe('GET /api/user/nav-config', () => {
  test('defaults to empty hiddenLabels for a first-time user', async () => {
    const res = await request(makeApp('first-time-user')).get('/api/user/nav-config');
    expect(res.status).toBe(200);
    expect(res.body.hiddenLabels).toEqual([]);
    expect(res.body.activeConfigId).toBeNull();
  });

  test('flag OFF (default) returns empty hiddenLabels even if prefs were saved', async () => {
    const app = makeApp('user-flag-off');
    await request(app).put('/api/user/nav-config').send({ hiddenLabels: ['Themes'], activeConfigId: null });
    const res = await request(app).get('/api/user/nav-config');
    expect(res.body.flagOn).toBe(false);
    expect(res.body.hiddenLabels).toEqual([]);
  });

  test('flag ON returns the stored hiddenLabels', async () => {
    await configStore.setRaw({ ff_sidebar_customization: 'true' });
    const app = makeApp('user-flag-on');
    await request(app).put('/api/user/nav-config').send({ hiddenLabels: ['Themes'], activeConfigId: null });
    const res = await request(app).get('/api/user/nav-config');
    expect(res.body.flagOn).toBe(true);
    expect(res.body.hiddenLabels).toEqual(['Themes']);
    await configStore.setRaw({ ff_sidebar_customization: 'false' });
  });
});

describe('PUT /api/user/nav-config', () => {
  test('saves hiddenLabels + activeConfigId and round-trips', async () => {
    const app = makeApp('user-roundtrip');
    const res = await request(app)
      .put('/api/user/nav-config')
      .send({ hiddenLabels: ['Themes', 'Monitoring'], activeConfigId: 'cfg_abc' });
    expect(res.status).toBe(200);
    expect(res.body.hiddenLabels).toEqual(['Themes', 'Monitoring']);
    expect(res.body.activeConfigId).toBe('cfg_abc');
  });

  test('rejects a non-array hiddenLabels with 400', async () => {
    const res = await request(makeApp())
      .put('/api/user/nav-config')
      .send({ hiddenLabels: 'nope' });
    expect(res.status).toBe(400);
  });

  test("does not leak one user's prefs to another", async () => {
    const appA = makeApp('user-a');
    const appB = makeApp('user-b');
    await request(appA).put('/api/user/nav-config').send({ hiddenLabels: ['Themes'], activeConfigId: null });
    const resB = await request(appB).get('/api/user/nav-config');
    expect(resB.body.hiddenLabels).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && npx jest src/__tests__/userNavConfig.route.test.js`
Expected: FAIL with `Cannot find module '../../routes/userNavConfig'`

- [ ] **Step 3: Write the router**

Create `demo_api_server/routes/userNavConfig.js`:

```js
'use strict';
/**
 * userNavConfig.js — per-user active sidebar selection.
 *
 * GET /api/user/nav-config → this user's current hidden-item labels
 * PUT /api/user/nav-config → update this user's hidden-item labels
 *
 * hiddenLabels is always returned as [] when ff_sidebar_customization is
 * OFF, regardless of what's stored — the flag gates the feature at read
 * time, so toggling it back on restores the user's last saved selection.
 */
const express = require('express');
const router = express.Router();
const navConfigStore = require('../services/lmdb/navConfigStore.lmdb');
const configStore = require('../services/configStore');

function isFlagOn() {
  const raw = configStore.getEffective('ff_sidebar_customization');
  return raw === true || raw === 'true';
}

router.get('/', (req, res) => {
  const flagOn = isFlagOn();
  const prefs = navConfigStore.getUserPrefs(req.user.id);
  res.json({
    hiddenLabels: flagOn ? prefs.hiddenLabels : [],
    activeConfigId: prefs.activeConfigId,
    flagOn,
  });
});

router.put('/', (req, res) => {
  const { hiddenLabels, activeConfigId } = req.body || {};
  if (!Array.isArray(hiddenLabels)) {
    return res.status(400).json({ error: 'hiddenLabels must be an array' });
  }
  const prefs = navConfigStore.setUserPrefs(req.user.id, hiddenLabels, activeConfigId || null);
  res.json({ ...prefs, flagOn: isFlagOn() });
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && npx jest src/__tests__/userNavConfig.route.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/userNavConfig.js demo_api_server/src/__tests__/userNavConfig.route.test.js
git commit -m "feat(nav-config): add /api/user/nav-config per-user route"
```

---

### Task 5: Mount both routes in server.js

**Files:**
- Modify: `demo_api_server/server.js:983-984` (add two `app.use` lines)

**Interfaces:**
- Consumes: `routes/navConfigs.js` (Task 3), `routes/userNavConfig.js` (Task 4), existing `authenticateToken` (already imported in `server.js`).
- Produces: live `/api/nav-configs` and `/api/user/nav-config` endpoints.

- [ ] **Step 1: Add the mount lines**

In `demo_api_server/server.js`, find:

```js
app.use('/api/admin/scope-audit', authenticateToken, require('./routes/scopeAudit'));
app.use('/api/admin/token-compliance', authenticateToken, require('./routes/tokenCompliance'));
```

Replace with:

```js
app.use('/api/admin/scope-audit', authenticateToken, require('./routes/scopeAudit'));
app.use('/api/admin/token-compliance', authenticateToken, require('./routes/tokenCompliance'));
app.use('/api/nav-configs', authenticateToken, require('./routes/navConfigs'));
app.use('/api/user/nav-config', authenticateToken, require('./routes/userNavConfig'));
```

- [ ] **Step 2: Verify server.js still boots and the existing full-server suite passes**

Run: `cd demo_api_server && npx jest src/__tests__/featureFlags.route.test.js`
Expected: PASS (this suite does `require('../../server')`, so a syntax error or throw in the new `app.use` lines would fail every test in the file, not just new ones — confirms the mount is wired correctly).

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/server.js
git commit -m "feat(nav-config): mount /api/nav-configs and /api/user/nav-config"
```

---

### Task 6: Frontend nav item catalog

**Files:**
- Create: `demo_api_ui/src/config/navItemsCatalog.js`
- Test: `demo_api_ui/src/config/__tests__/navItemsCatalog.test.js`

**Interfaces:**
- Produces: `NAV_ITEM_CATALOG: string[]` — the 24 top-level `AdminSideNav.jsx` `allNavItems` labels (excluding the dynamically-conditional "Latest Report" entry and the not-yet-added "Demo Config" link itself). Consumed by Task 7 (`DemoConfigPage.js`) for the checkbox list and by Task 2's `BUILTIN_CONFIGS` hidden-label lists (kept in sync by hand — same curated-subset precedent as `QuickFlagsPill.js`'s `QUICK_FLAGS`).

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/config/__tests__/navItemsCatalog.test.js`:

```js
import { describe, it, expect } from "vitest";
import { NAV_ITEM_CATALOG } from "../navItemsCatalog";

describe("NAV_ITEM_CATALOG", () => {
  it("has no duplicate labels", () => {
    expect(new Set(NAV_ITEM_CATALOG).size).toBe(NAV_ITEM_CATALOG.length);
  });

  it("does not include the Demo Config page's own link", () => {
    expect(NAV_ITEM_CATALOG).not.toContain("Demo Config");
  });

  it("includes core top-level sections", () => {
    expect(NAV_ITEM_CATALOG).toContain("Dashboard");
    expect(NAV_ITEM_CATALOG).toContain("Authorize");
    expect(NAV_ITEM_CATALOG).toContain("Learn & Present");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/config/__tests__/navItemsCatalog.test.js`
Expected: FAIL with a module-not-found error for `../navItemsCatalog`.

- [ ] **Step 3: Write the catalog**

Create `demo_api_ui/src/config/navItemsCatalog.js`:

```js
// Static catalog of top-level AdminSideNav.jsx entries, for the Demo Config
// picker + built-in preset seeds (demo_api_server/services/lmdb/navConfigStore.lmdb.js
// BUILTIN_CONFIGS). Keep in sync with allNavItems' top-level labels in
// AdminSideNav.jsx. Intentionally excludes the dynamically-conditional
// "Latest Report" entry (only rendered when a run just completed) and the
// Demo Config page's own link (never hideable).
export const NAV_ITEM_CATALOG = [
  "Home",
  "Dashboard",
  "Themes",
  "Use Cases",
  "Agent Demo Guide",
  "Family Delegation",
  "AI Agents",
  "PingOne MCP",
  "Banking MCP & Gateways",
  "PingOne Demo Apps",
  "Delegation & Consent",
  "Authorize",
  "OAuth & Identity",
  "Industry Verticals",
  "Users & Accounts",
  "AI Attack Demos",
  "Monitoring",
  "Telemetry",
  "Diagrams",
  "Agent Studio (Preview)",
  "Learn & Present",
  "Developer Tools",
  "System Tools",
  "Integration Tests",
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/config/__tests__/navItemsCatalog.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/config/navItemsCatalog.js demo_api_ui/src/config/__tests__/navItemsCatalog.test.js
git commit -m "feat(nav-config): add static nav item catalog for Demo Config page"
```

---

### Task 7: `DemoConfigPage.js` — the Demo Config page

**Files:**
- Create: `demo_api_ui/src/components/DemoConfigPage.js`
- Create: `demo_api_ui/src/components/DemoConfigPage.css`
- Test: `demo_api_ui/src/__tests__/DemoConfigPage.test.js`

**Interfaces:**
- Consumes: `NAV_ITEM_CATALOG` (Task 6), `GET/PUT /api/user/nav-config` (Task 4), `GET/POST/DELETE /api/nav-configs` (Task 3), `GET/PATCH /api/admin/feature-flags` (existing).
- Produces: default-exported `DemoConfigPage` React component, no props required. Consumed by `App.js` in Task 8.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/__tests__/DemoConfigPage.test.js`:

```js
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import DemoConfigPage from "../components/DemoConfigPage";

vi.mock("../styles/appShellPages.css", () => ({}), { virtual: true });
vi.mock("../components/DemoConfigPage.css", () => ({}), { virtual: true });
vi.mock("../config/navItemsCatalog", () => ({
  NAV_ITEM_CATALOG: ["Themes", "Monitoring", "Authorize"],
}));

const PREFS_RESPONSE = { hiddenLabels: ["Themes"], activeConfigId: null, flagOn: true };
const CONFIGS_RESPONSE = {
  configs: [
    { id: "full-mode", name: "Full mode", isBuiltin: true, hiddenLabels: [], flagSnapshot: {} },
    { id: "demo-mode", name: "Demo mode", isBuiltin: true, hiddenLabels: ["Themes"], flagSnapshot: {} },
  ],
};

function mockFetch(overrides = {}) {
  global.fetch = jest.fn((url, opts) => {
    const method = (opts && opts.method) || "GET";
    if (String(url).includes("/api/user/nav-config") && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => overrides.prefs || PREFS_RESPONSE });
    }
    if (String(url).includes("/api/nav-configs") && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => overrides.configs || CONFIGS_RESPONSE });
    }
    if (String(url).includes("/api/user/nav-config") && method === "PUT") {
      return Promise.resolve({ ok: true, json: async () => ({ hiddenLabels: [], activeConfigId: null, flagOn: true }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("DemoConfigPage", () => {
  it("renders the catalog as checkboxes, unchecking hidden items", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Themes")).toBeInTheDocument());

    expect(screen.getByLabelText("Themes")).not.toBeChecked();
    expect(screen.getByLabelText("Monitoring")).toBeChecked();
  });

  it("lists saved configs from /api/nav-configs", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Full mode")).toBeInTheDocument());
    expect(screen.getByText("Demo mode")).toBeInTheDocument();
  });

  it("toggling a checkbox updates the visible count", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText(/of 3 visible/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Monitoring"));
    expect(await screen.findByText(/1 of 3 visible/)).toBeInTheDocument();
  });

  it("shows an error banner when the prefs fetch fails", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/__tests__/DemoConfigPage.test.js`
Expected: FAIL with a module-not-found error for `../components/DemoConfigPage`.

- [ ] **Step 3: Write DemoConfigPage.js**

Create `demo_api_ui/src/components/DemoConfigPage.js`:

```jsx
import React, { useState, useEffect, useCallback } from "react";
import "../styles/appShellPages.css";
import "./DemoConfigPage.css";
import { NAV_ITEM_CATALOG } from "../config/navItemsCatalog";

export default function DemoConfigPage() {
  const [hiddenLabels, setHiddenLabels] = useState([]);
  const [activeConfigId, setActiveConfigId] = useState(null);
  const [configs, setConfigs] = useState([]);
  const [flagOn, setFlagOn] = useState(false);
  const [newConfigName, setNewConfigName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prefsRes, configsRes] = await Promise.all([
        fetch("/api/user/nav-config", { credentials: "include" }),
        fetch("/api/nav-configs", { credentials: "include" }),
      ]);
      const prefs = await prefsRes.json();
      const configsData = await configsRes.json();
      if (!prefsRes.ok) throw new Error(prefs.error || `HTTP ${prefsRes.status}`);
      if (!configsRes.ok) throw new Error(configsData.error || `HTTP ${configsRes.status}`);
      setHiddenLabels(prefs.hiddenLabels || []);
      setActiveConfigId(prefs.activeConfigId || null);
      setFlagOn(!!prefs.flagOn);
      setConfigs(configsData.configs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleLabel = (label) => {
    setHiddenLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
    setActiveConfigId(null);
  };

  const saveSelection = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/user/nav-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiddenLabels, activeConfigId: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setToast("Selection saved");
    } catch (err) {
      setError(`Failed to save: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveAsNewConfig = async () => {
    const name = newConfigName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const flagsRes = await fetch("/api/admin/feature-flags", { credentials: "include" });
      const flagsData = await flagsRes.json();
      if (!flagsRes.ok) throw new Error(flagsData.error || `HTTP ${flagsRes.status}`);
      const flagSnapshot = Object.fromEntries((flagsData.flags || []).map((f) => [f.id, f.value]));
      const res = await fetch("/api/nav-configs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, hiddenLabels, flagSnapshot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setConfigs((prev) => [...prev, data.config]);
      setNewConfigName("");
      setToast(`"${name}" saved`);
    } catch (err) {
      setError(`Failed to save config: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const applyConfig = async (config) => {
    setBusy(true);
    setError(null);
    try {
      const patchRes = await fetch("/api/admin/feature-flags", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: config.flagSnapshot || {} }),
      });
      const patchData = await patchRes.json();
      if (!patchRes.ok) throw new Error(patchData.error || `HTTP ${patchRes.status}`);

      const putRes = await fetch("/api/user/nav-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiddenLabels: config.hiddenLabels, activeConfigId: config.id }),
      });
      const putData = await putRes.json();
      if (!putRes.ok) throw new Error(putData.error || `HTTP ${putRes.status}`);

      setHiddenLabels(config.hiddenLabels || []);
      setActiveConfigId(config.id);
      setToast(`Applied "${config.name}"`);
    } catch (err) {
      setError(`Failed to apply "${config.name}": ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteConfig = async (config) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/nav-configs/${config.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setConfigs((prev) => prev.filter((c) => c.id !== config.id));
      if (activeConfigId === config.id) setActiveConfigId(null);
      setToast(`"${config.name}" deleted`);
    } catch (err) {
      setError(`Failed to delete "${config.name}": ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const visibleCount = NAV_ITEM_CATALOG.length - hiddenLabels.length;

  return (
    <div className="app-page">
      <div className="app-page-header">
        <div className="app-page-header__left">
          <h1 className="app-page-title">Demo Config</h1>
          <p className="app-page-subtitle">
            Choose which sidebar items show for you, then save the selection as a reusable config.
          </p>
        </div>
        <span className={`dc-flag-pill${flagOn ? " dc-flag-pill--on" : ""}`}>
          Sidebar Customization: {flagOn ? "ON" : "OFF"}
        </span>
      </div>

      {error && (
        <div className="dc-error" role="alert">
          <strong>Error:</strong> {error}
          <button type="button" className="dc-error__dismiss" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}
      {toast && <div className="dc-toast">✅ {toast}</div>}

      {loading ? (
        <div className="dc-loading">Loading…</div>
      ) : (
        <div className="dc-layout">
          <section className="dc-panel">
            <div className="dc-panel__head">
              <h2>Sidebar items</h2>
              <span className="dc-count">
                {visibleCount} of {NAV_ITEM_CATALOG.length} visible
              </span>
            </div>
            <div className="dc-item-grid">
              {NAV_ITEM_CATALOG.map((label) => (
                <label key={label} className="dc-nav-check">
                  <input
                    type="checkbox"
                    checked={!hiddenLabels.includes(label)}
                    onChange={() => toggleLabel(label)}
                    disabled={busy}
                    aria-label={label}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="dc-panel__actions">
              <button type="button" className="dc-btn-primary" onClick={saveSelection} disabled={busy}>
                Save current selection
              </button>
            </div>
          </section>

          <aside className="dc-configs">
            <h2>Saved configs</h2>
            <p className="dc-hint">
              Named configs bundle a sidebar selection + flag states. Apply one to switch both at once.
            </p>
            {configs.map((config) => (
              <div
                key={config.id}
                className={`dc-config-card${activeConfigId === config.id ? " dc-config-card--active" : ""}`}
              >
                <div className="dc-config-card__row1">
                  <span className="dc-config-card__name">{config.name}</span>
                  {activeConfigId === config.id && <span className="dc-badge">Active</span>}
                </div>
                <p className="dc-config-card__meta">
                  {NAV_ITEM_CATALOG.length - (config.hiddenLabels || []).length} items &middot;{" "}
                  {Object.keys(config.flagSnapshot || {}).length} flags
                </p>
                <div className="dc-config-card__actions">
                  <button type="button" onClick={() => applyConfig(config)} disabled={busy}>
                    Apply
                  </button>
                  {!config.isBuiltin && (
                    <button
                      type="button"
                      className="dc-btn-danger"
                      onClick={() => deleteConfig(config)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="dc-new-config">
              <input
                type="text"
                placeholder="Name this selection…"
                value={newConfigName}
                onChange={(e) => setNewConfigName(e.target.value)}
                disabled={busy}
              />
              <button type="button" onClick={saveAsNewConfig} disabled={busy || !newConfigName.trim()}>
                Save as new config
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write DemoConfigPage.css**

Create `demo_api_ui/src/components/DemoConfigPage.css`:

```css
.dc-flag-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 12.5px;
  color: #6b7280;
  white-space: nowrap;
}
.dc-flag-pill--on {
  color: #1d4ed8;
  border-color: rgba(29, 78, 216, 0.35);
  background: rgba(29, 78, 216, 0.06);
}

.dc-error {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 16px;
}
.dc-error__dismiss {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font-size: 14px;
}

.dc-toast {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
  border-radius: 8px;
  padding: 8px 14px;
  margin-bottom: 16px;
  font-size: 13.5px;
}

.dc-loading {
  color: #6b7280;
  padding: 24px 0;
}

.dc-layout {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 20px;
  align-items: start;
}
@media (max-width: 820px) {
  .dc-layout {
    grid-template-columns: 1fr;
  }
}

.dc-panel,
.dc-config-card,
.dc-new-config {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}
.dc-panel {
  padding: 20px 22px;
}

.dc-panel__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14px;
}
.dc-panel__head h2 {
  font-size: 14.5px;
  margin: 0;
  font-weight: 700;
}
.dc-count {
  font-size: 12px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.dc-item-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 18px;
}
.dc-nav-check {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 13.5px;
  cursor: pointer;
}
.dc-nav-check:hover {
  background: rgba(29, 78, 216, 0.06);
}
.dc-nav-check input {
  width: 15px;
  height: 15px;
  accent-color: #1d4ed8;
}

.dc-panel__actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
}

.dc-btn-primary,
.dc-panel__actions button {
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  padding: 9px 16px;
  border: 1px solid transparent;
  cursor: pointer;
  background: #1d4ed8;
  color: #fff;
}
.dc-btn-primary:disabled,
.dc-panel__actions button:disabled {
  opacity: 0.6;
  cursor: default;
}

.dc-configs h2 {
  font-size: 14.5px;
  margin: 0 0 4px;
  font-weight: 700;
}
.dc-hint {
  font-size: 12px;
  color: #94a3b8;
  margin: 0 0 14px;
  line-height: 1.5;
}

.dc-config-card {
  border-width: 1.5px;
  padding: 12px 13px;
  margin-bottom: 10px;
}
.dc-config-card--active {
  border-color: rgba(29, 78, 216, 0.35);
  background: rgba(29, 78, 216, 0.06);
}
.dc-config-card__row1 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dc-config-card__name {
  font-size: 13.5px;
  font-weight: 600;
}
.dc-badge {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #166534;
  background: rgba(76, 175, 80, 0.1);
  padding: 2px 7px;
  border-radius: 999px;
  font-weight: 700;
}
.dc-config-card__meta {
  font-size: 11.5px;
  color: #94a3b8;
  margin: 4px 0 10px;
}
.dc-config-card__actions {
  display: flex;
  gap: 8px;
}
.dc-config-card__actions button {
  padding: 5px 10px;
  font-size: 11.5px;
  flex: 1;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  background: transparent;
  cursor: pointer;
}
.dc-btn-danger {
  color: #c0392b;
}

.dc-new-config {
  border-style: dashed;
  border-width: 1.5px;
  padding: 12px 13px;
  text-align: center;
}
.dc-new-config input {
  width: 100%;
  font-family: inherit;
  font-size: 12.5px;
  padding: 7px 9px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
  margin-bottom: 8px;
  box-sizing: border-box;
}
.dc-new-config button {
  width: 100%;
  padding: 7px;
  font-size: 12px;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/__tests__/DemoConfigPage.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/DemoConfigPage.js demo_api_ui/src/components/DemoConfigPage.css demo_api_ui/src/__tests__/DemoConfigPage.test.js
git commit -m "feat(nav-config): add Demo Config page"
```

---

### Task 8: Wire `/demo-config` into App.js

**Files:**
- Modify: `demo_api_ui/src/App.js` (add import + one `<Route>`, near the `/feature-flags` route)

**Interfaces:**
- Consumes: `DemoConfigPage` (Task 7). Follows the existing "any signed-in user" route pattern used by `/delegation` (`App.js:1213-1225`) — **not** the `RequireAdminLogin`-gated pattern used by `/feature-flags`, since this page must be visible to every signed-in user, not just admins.

- [ ] **Step 1: Add the import**

In `demo_api_ui/src/App.js`, find:

```js
import FeatureFlagsPage from "./components/FeatureFlagsPage";
```

Replace with:

```js
import DemoConfigPage from "./components/DemoConfigPage";
import FeatureFlagsPage from "./components/FeatureFlagsPage";
```

- [ ] **Step 2: Add the route**

In `demo_api_ui/src/App.js`, find:

```js
                            <Route
                              path="/feature-flags"
                              element={
                                <RequireAdminLogin user={user}>
                                  <FeatureFlagsPage />
                                </RequireAdminLogin>
                              }
                            />
```

Replace with (adding the new route right before it):

```js
                            <Route
                              path="/demo-config"
                              element={
                                user ? (
                                  <DemoConfigPage />
                                ) : (
                                  <Navigate to="/" replace />
                                )
                              }
                            />
                            <Route
                              path="/feature-flags"
                              element={
                                <RequireAdminLogin user={user}>
                                  <FeatureFlagsPage />
                                </RequireAdminLogin>
                              }
                            />
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/App.js
git commit -m "feat(nav-config): wire /demo-config route (any signed-in user)"
```

---

### Task 9: `AdminSideNav.jsx` — add the nav link + per-user hidden-item filter

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (add nav entry, add a fetch effect, add a filter step)
- Test: `demo_api_ui/src/components/__tests__/adminSideNav.test.jsx` (extend, don't replace)

**Interfaces:**
- Consumes: `GET /api/user/nav-config` (Task 4). `user` prop (existing).
- Produces: a new top-level `allNavItems` entry `{ label: "Demo Config", path: "/demo-config", icon: "cfg" }`, visible to every user (no `adminOnly`/`customerOnly`) per explicit requirement. Filters `navItems` by the user's `hiddenLabels`, always keeping the "Demo Config" entry itself regardless of what's stored (self-lockout guard).

- [ ] **Step 1: Write the failing tests**

Add these two tests to the existing `describe("AdminSideNav — best-of-breed pass", ...)` block in `demo_api_ui/src/components/__tests__/adminSideNav.test.jsx`, right after the last existing test (after line 99, before the closing `});`):

```js
  it("shows the Demo Config link for a non-admin user (no admin gate)", () => {
    renderNavAsUser(customerUser);
    expect(screen.getByText("Demo Config")).toBeInTheDocument();
  });

  it("hides a nav item the user marked hidden via Demo Config, once loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).includes("/api/user/nav-config")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ hiddenLabels: ["Themes"], activeConfigId: null, flagOn: true }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );
    renderNav();
    expect(await screen.findByText("Monitoring")).toBeInTheDocument();
    expect(screen.queryByText("Themes")).toBeNull();
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/adminSideNav.test.jsx`
Expected: FAIL — `screen.getByText("Demo Config")` finds nothing yet; the hidden-item test finds "Themes" still present.

- [ ] **Step 3: Add the state + fetch effect**

In `demo_api_ui/src/components/AdminSideNav.jsx`, find:

```js
export default function AdminSideNav({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [navFilter, setNavFilter] = useState("");
  const isResizing = useRef(false);
```

Replace with:

```js
export default function AdminSideNav({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [navFilter, setNavFilter] = useState("");
  const [hiddenNavLabels, setHiddenNavLabels] = useState([]);
  const isResizing = useRef(false);

  // Per-user sidebar customization (Demo Config page). Returns [] when
  // ff_sidebar_customization is OFF or the request fails — full nav either way.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch("/api/user/nav-config", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setHiddenNavLabels(data.hiddenLabels || []);
      })
      .catch(() => {
        if (!cancelled) setHiddenNavLabels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);
```

- [ ] **Step 4: Add the nav link entry**

In `demo_api_ui/src/components/AdminSideNav.jsx`, find:

```js
    { label: "Home", path: "/", icon: "~" },
    { label: "Dashboard", path: "/dashboard", icon: "≡" },
    { label: "Themes", path: "/themes", icon: "cfg" },
    { label: "Use Cases", path: "/use-cases", icon: "demo" },
```

Replace with:

```js
    { label: "Home", path: "/", icon: "~" },
    { label: "Dashboard", path: "/dashboard", icon: "≡" },
    { label: "Themes", path: "/themes", icon: "cfg" },
    { label: "Use Cases", path: "/use-cases", icon: "demo" },
    { label: "Demo Config", path: "/demo-config", icon: "cfg" },
```

- [ ] **Step 5: Add the hidden-label filter step**

In `demo_api_ui/src/components/AdminSideNav.jsx`, find:

```js
  // Filter by role. adminOnly items are NOT hidden — they render with an
  // "admin" badge and non-admin clicks prompt an admin re-login instead.
  const navItems = allNavItems.filter((item) => !item.customerOnly || !isAdmin);
```

Replace with:

```js
  // Filter by role. adminOnly items are NOT hidden — they render with an
  // "admin" badge and non-admin clicks prompt an admin re-login instead.
  // Then filter by the user's Demo Config hidden-item selection — "Demo
  // Config" itself is never hideable (would lock the user out of undoing it).
  const navItems = allNavItems
    .filter((item) => !item.customerOnly || !isAdmin)
    .filter((item) => item.label === "Demo Config" || !hiddenNavLabels.includes(item.label));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/adminSideNav.test.jsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/components/__tests__/adminSideNav.test.jsx
git commit -m "feat(nav-config): wire Demo Config link + per-user nav item filter into AdminSideNav"
```

---

### Task 10: Full verification (UI build gate + full test suites + graphify)

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd demo_api_server && npx jest src/__tests__/navConfigStore.lmdb.test.js src/__tests__/navConfigs.route.test.js src/__tests__/userNavConfig.route.test.js src/__tests__/featureFlags.route.test.js`
Expected: PASS, all suites.

- [ ] **Step 2: Run the full frontend test suite for the touched files**

Run: `cd demo_api_ui && npx vitest run src/config/__tests__/navItemsCatalog.test.js src/__tests__/DemoConfigPage.test.js src/components/__tests__/adminSideNav.test.jsx`
Expected: PASS, all suites.

- [ ] **Step 3: UI build gate (REGRESSION_PLAN §0 — required before this work is complete)**

Run: `cd demo_api_ui && npm run build`
Expected: exits `0`.

- [ ] **Step 4: Update the graphify knowledge graph**

Run: `graphify update .`
Expected: completes without error (AST-only re-index; per CLAUDE.md, run after code edits).

- [ ] **Step 5: Manual smoke check (per CLAUDE.md — type checks/tests verify correctness, not feature correctness)**

Start the app (`./run-docker.sh` or the worktree's own dev server per the project's UI-live-verify pattern), sign in as any user, confirm:
- "Demo Config" appears in the sidebar for a non-admin customer session.
- With `ff_sidebar_customization` OFF (default), unchecking an item on `/demo-config` and saving does NOT hide it from the sidebar.
- Turn `ff_sidebar_customization` ON (via `/feature-flags` or the header pill), reload — the previously-saved hidden item is now actually hidden from the sidebar, and "Demo Config" itself is still visible.
- Apply "Demo mode" — sidebar trims to the curated subset; apply "Full mode" — everything returns.
- Save the current selection as a new named config, confirm it appears in the list and can be deleted (builtins cannot).

---

## Summary of simplifications from the design spec

- **Granularity:** the spec's "checkbox per nav item" is implemented at **top-level entry** granularity (24 items) rather than per-leaf-path (~92 paths) — checking a group (e.g. "AI Agents") hides the whole group. This matches "keep it simple for a demo" and avoids partial-group/indeterminate-checkbox state. Keyed by `label` (stable, always present) rather than `path` (several items share a path prefix via query strings, e.g. `/configure?tab=...`, and some entries have no `path` at all).
- **No dedicated "Overwrite" action:** the mock showed an Overwrite button on the active custom config; this plan omits it (delete + re-save under the same name achieves the same result with the existing primitives) to avoid adding a fourth (`PUT /api/nav-configs/:id`) endpoint for something not explicitly requested.
- **Demo mode / Learning starter selections** are concrete, real starting points (see Task 2's `BUILTIN_CONFIGS`), not placeholders — but they're a first guess at what's demo-worthy, fully editable via the page immediately after this ships.
