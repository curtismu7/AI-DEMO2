# Migration & Onboarding Plan

> **Status:** Draft — 2026-05-09  
> **Scope:** First-run onboarding UI, config surface consolidation, and the frontend import guide.  
> **Import scripts:** See [import-plan.md](import-plan.md) for the full export/import script analysis and spec.

---

## CRITICAL: The fresh-clone bootstrap problem

**The question:** If someone downloads from GitHub, can they reach the setup page without any prior configuration?

**The answer: yes, but only if `SESSION_SECRET` is generated before the server starts the first time.**

Here is why this matters:

`SESSION_SECRET` (or `CONFIG_ENCRYPTION_KEY` if set — it takes priority) is the AES-256-GCM encryption key for `config.db`. It is read at server boot — before any request is served — to initialize both the session store and the configStore encryption layer. This creates a circular dependency:

```text
User visits /configure → enters credentials → saved to config.db
                         encrypted with current SESSION_SECRET
                         ↓
Server restarted with a NEW SESSION_SECRET in .env
                         ↓
config.db decryption fails silently
All credentials gone — app appears unconfigured
OAuth calls fail with no obvious error
```

`check-env.js` (required at the top of `server.js`) validates 7 required vars. In development mode (`NODE_ENV` unset) it **warns but does not block** — the server starts using the hardcoded fallback key `'dev-fallback-key-do-not-use-in-production'`. The UI is reachable. But any credentials saved during that session are encrypted with the fallback key and will be lost the moment a real `SESSION_SECRET` is set.

### The fix: `scripts/init-env.js` run as a `prestart` hook

**Create:** `banking_api_server/scripts/init-env.js`  
**Add to `package.json`:** `"prestart": "node scripts/init-env.js"`

This runs automatically before every `npm start` and `npm run dev`. It is also called by `run-demo.sh` before launching the API server.

```js
// Pseudocode — see scripts/init-env.js for implementation
if (fs.existsSync('.env')) process.exit(0); // never overwrite

const secret = crypto.randomBytes(32).toString('hex'); // 64-char hex
fs.writeFileSync('.env', [
  `SESSION_SECRET=${secret}`,
  'PORT=3001',
  'NODE_ENV=development',
].join('\n'));

console.log('Created .env with a generated SESSION_SECRET.');
console.log('Add PingOne credentials at http://localhost:4000/configure after the server starts.');
```

**What this achieves on a fresh clone:**

1. `./run-demo.sh` (or `npm start`) triggers `prestart`
2. `.env` is created with a real, stable `SESSION_SECRET`
3. Server starts — `check-env.js` still warns about missing PingOne vars (expected)
4. `config.db` is initialized with the generated key
5. Browser hits `GET /api/health/readiness` → `configured: false` → redirects to `/configure?tab=quick-start`
6. User enters credentials on the setup page → saved to `config.db` with the stable key
7. No restart needed — credentials persist correctly on every subsequent restart

**What `run-demo.sh` already does (and does not need changing):**

`run-demo.sh` already checks if `.env` exists and warns if missing (line 144-148). It does NOT create one. After `init-env.js` is added as a `prestart` hook, `npm start` (called inside `run-demo.sh`) will trigger it automatically. No change to `run-demo.sh` needed.

### Updated "What is actually new" table

Add `scripts/init-env.js` to the new items list. This is **Step 0** — it must be done before anything else in the implementation order, because every other feature depends on the server being startable on a fresh clone.

---

## 0. Reuse inventory

Every item below already exists. The implementation calls it directly — do not rewrite it.

### Reusable BFF symbols

| Symbol | File | What it does |
|--------|------|-------------|
| `getOAuthEndpoints()` | `services/oauthEndpointResolver.js` | Returns all 6 derived PingOne URLs in one call |
| `configStore.isConfigured()` | `services/configStore.js` | `pingone_environment_id && admin_client_id` both non-empty |
| `configStore.isUserOAuthConfigured()` | `services/configStore.js` | `pingone_environment_id && user_client_id` both non-empty |
| `configStore.getEffective(key)` | `services/configStore.js` | Priority: env var → LMDB → hardcoded default |

### Reusable BFF routes

| Route | File | Reused by |
|-------|------|-----------|
| `POST /api/config/credentials/set` | `routes/configCredentials.js` | All 5 credential group saves |
| `GET /api/config/credentials/missing?action=<type>` | `routes/configCredentials.js` | Per-group test buttons; readiness endpoint |
| `POST /api/admin/setup/validate` | `routes/setupWizard.js` | "Test" button for Group 4 (Worker) |

### Shared data — extract before reuse

`CREDENTIAL_SCHEMAS` and `ACTION_REQUIREMENTS` are defined inline in `routes/configCredentials.js` and not exported. The new `health.js` readiness handler needs them too. **Extract to `services/credentialSchemas.js` first** — pure data file, no logic. See §3.

### Reusable frontend components

| Symbol | File | Props |
|--------|------|-------|
| `CfgField` | `UnifiedConfigurationPage.tsx:454` | `{ label, value, onChange, type?, help?, placeholder?, disabled? }` |
| `CfgSecretField` | `UnifiedConfigurationPage.tsx:485` | `{ label, fieldKey, value, showSecrets, onToggle, onChange, help? }` |
| `savePublicConfig(data)` | `services/configService.js` | Persists 27 public fields to IndexedDB |
| `loadPublicConfig()` | `services/configService.js` | Reads IndexedDB cache |

---

## 1. What is actually new

| New item | Type | Why it cannot be satisfied by existing code |
|----------|------|---------------------------------------------|
| `services/credentialSchemas.js` | Shared module | Extract from `configCredentials.js` so `health.js` can use it without duplicating |
| `scripts/exportMigrationBundle.js` | Node script | See [import-plan.md](import-plan.md) |
| `scripts/importMigrationBundle.js` | Node script | See [import-plan.md](import-plan.md) |
| `GET /api/health/readiness` | Handler added to `routes/health.js` | Existing `/ready` checks JWKS/MCP/DB — not credential group completeness |
| `GET /api/health/packages` | Handler added to `routes/health.js` | New — checks tar, lmdb native binary, node_modules presence for import pre-flight UI |
| `POST /api/config/derive-pingone-endpoints` | New file `routes/configDerived.js` | Wraps `getOAuthEndpoints()` for UI preview |
| Mode selector + UI | JSX in `UnifiedConfigurationPage.tsx` | Quick-start tab has no mode selector or import guide |
| `<Navigate>` redirects | 2 lines in `App.js` | `/setup` and `/onboarding` have no redirect yet |
| SideNav entry removal | 2 deletions in `SideNav.js` | Dead nav entries |

---

## 2. Preliminary step: extract `credentialSchemas.js`

Do this first — it unblocks Steps 4 and 5 with no risk to existing routes.

**Create:** `banking_api_server/services/credentialSchemas.js`

```js
const CREDENTIAL_SCHEMAS = {
  customer_oauth: {
    fields: ['client_id', 'client_secret'],
    configMap: { client_id: 'PINGONE_CLIENT_ID', client_secret: 'PINGONE_CLIENT_SECRET' },
    label: 'Customer OAuth Application'
  },
  admin_oauth: {
    fields: ['client_id', 'client_secret'],
    configMap: { client_id: 'PINGONE_ADMIN_CLIENT_ID', client_secret: 'PINGONE_ADMIN_CLIENT_SECRET' },
    label: 'Admin OAuth Application'
  },
  worker_token: {
    fields: ['worker_app_id', 'worker_app_secret'],
    configMap: { worker_app_id: 'PINGONE_WORKER_APP_ID', worker_app_secret: 'PINGONE_WORKER_APP_SECRET' },
    label: 'Worker Application'
  },
  ai_agent: {
    fields: ['client_id', 'client_secret'],
    configMap: { client_id: 'PINGONE_AI_AGENT_CLIENT_ID', client_secret: 'PINGONE_AI_AGENT_CLIENT_SECRET' },
    label: 'AI Agent Application'
  },
  environment: {
    fields: ['environment_id'],
    configMap: { environment_id: 'PINGONE_ENVIRONMENT_ID' },
    label: 'PingOne Environment'
  }
};

const ACTION_REQUIREMENTS = {
  agent_mcp:   ['environment', 'ai_agent'],
  admin_login: ['environment', 'admin_oauth'],
  user_login:  ['environment', 'customer_oauth'],
  worker_api:  ['environment', 'worker_token']
};

module.exports = { CREDENTIAL_SCHEMAS, ACTION_REQUIREMENTS };
```

**Edit:** `banking_api_server/routes/configCredentials.js` — replace inline definitions:
```js
const { CREDENTIAL_SCHEMAS, ACTION_REQUIREMENTS } = require('../services/credentialSchemas');
```
No other changes. Run `npx jest configCredentials` to confirm no regression.

---

## 3. BFF additions

### 3a. `GET /api/health/readiness` — add to `routes/health.js`

Reuses `credentialSchemas.js`, `configStore.isConfigured()`, `configStore.isUserOAuthConfigured()`, `configStore.getEffective()`. No auth required — called before login exists. **This endpoint is a hard dependency for import-plan.md AC#9** — the import script's post-import health check calls it to verify `config.db` decrypted correctly on Machine B. It must be shipped before the import scripts are considered complete.

```js
const { CREDENTIAL_SCHEMAS, ACTION_REQUIREMENTS } = require('../services/credentialSchemas');
const configStore = require('../services/configStore');

router.get('/readiness', (req, res) => {
  const missingGroups = Object.entries(ACTION_REQUIREMENTS).reduce((acc, [action, schemas]) => {
    const missing = schemas.some(schemaName => {
      const schema = CREDENTIAL_SCHEMAS[schemaName];
      return schema.fields.some(field => !configStore.getEffective(schema.configMap[field]));
    });
    if (missing) acc.push(action);
    return acc;
  }, []);

  res.json({
    configured: configStore.isConfigured(),
    userOAuthConfigured: configStore.isUserOAuthConfigured(),
    missingGroups
  });
});
```

### 3b. `GET /api/health/packages` — add to `routes/health.js`

Runs the same four checks as import script Step 0 and returns JSON. Called by the import mode UI panel on mount and polled every 5 seconds.

No auth required — must be reachable before credentials are configured.

```js
router.get('/packages', (req, res) => {
  const checks = {};

  // Check 1 — node_modules
  checks.node_modules = fs.existsSync(path.join(__dirname, '../../node_modules'));

  // Check 2 — tar
  try { require('tar'); checks.tar = true; } catch { checks.tar = false; }

  // Check 3 — LMDB driver
  let lmdbDriver = null;
  try { require('lmdb'); lmdbDriver = 'lmdb'; } catch { lmdbDriver = null; }
  checks.lmdb_driver = lmdbDriver;

  // Check 4 — LMDB native binary (in-memory open)
  checks.lmdb_native_ok = null; // null = not tested (driver unavailable)
  if (lmdbDriver === 'lmdb') {
    try {
      const { open } = require('lmdb');
      const db = open({ path: ':memory:', readOnly: false });
      db.close();
      checks.lmdb_native_ok = true;
    } catch { checks.lmdb_native_ok = false; }
  }

  const ready = checks.node_modules && checks.tar &&
                checks.lmdb_driver !== null &&
                checks.lmdb_native_ok !== false;

  res.json({
    ready,
    checks,
    remediation: {
      node_modules: 'cd banking_api_server && npm install',
      tar: 'cd banking_api_server && npm install',
      lmdb_native_ok: 'cd banking_api_server && npm rebuild lmdb',
    }
  });
});
```

Add to the `what is new` table in §1 and to the implementation order in §6.

### 3c. `POST /api/config/derive-pingone-endpoints` — new `routes/configDerived.js`

Reuses `getOAuthEndpoints()` — one call, all 6 URLs. Mount at `/api/config/derived` in `server.js`. No auth required.

```js
const { getOAuthEndpoints } = require('../services/oauthEndpointResolver');

router.post('/derive-pingone-endpoints', (req, res) => {
  const { environmentId, region } = req.body;
  if (!environmentId || !region) {
    return res.status(400).json({ error: 'environmentId and region are required' });
  }
  // oauthEndpointResolver reads env vars first in its priority chain.
  // Temporarily set them for this preview — no database write.
  const prev = { id: process.env.PINGONE_ENVIRONMENT_ID, region: process.env.PINGONE_REGION };
  process.env.PINGONE_ENVIRONMENT_ID = environmentId;
  process.env.PINGONE_REGION = region;
  const endpoints = getOAuthEndpoints();
  process.env.PINGONE_ENVIRONMENT_ID = prev.id;
  process.env.PINGONE_REGION = prev.region;
  res.json(endpoints);
});
```

If `oauthEndpointResolver.js` ever caches env var reads, revisit the env-swap approach.

---

## 4. Frontend: mode selector + UI

### 4a. Mode selector on the quick-start tab

At the very top of the quick-start tab, before any form fields, render a two-option toggle visible to **any user** (pre-login route, no auth check):

```
┌────────────────────────────────────────────────────┐
│  How would you like to get started?                │
│                                                    │
│  ●  New setup      ○  Import existing config       │
└────────────────────────────────────────────────────┘
```

State: `setupMode: 'new' | 'import'` — add to `ConfigurationState`. Default: `'new'`.

Do not auto-switch to import mode even when `configured === true` — the user may want to change credentials. Always let the user choose.

### 4b. New setup mode — 5-group progressive form

Renders when `setupMode === 'new'`.

**Progress checklist** (poll `GET /api/health/readiness` after each save):

```
[ ] PingOne Core          environment_id set
[ ] Derived Endpoints     auto-calculated (skippable)
[ ] OAuth Clients         admin + user login ready
[ ] Worker / Management   required for demo data      (skip)
[ ] AI Agent / MCP        required for agent chat      (skip)
```

**Group 1 — PingOne Core**
- `CfgField` for `PINGONE_ENVIRONMENT_ID` (UUID placeholder)
- `CfgField` for `PINGONE_REGION` rendered as `<select>`: `com` (default), `eu`, `ca`, `asia`
- Save → `POST /api/config/credentials/set` `{ type: 'environment', environment_id }`
- After save → `savePublicConfig(state)`

**Group 2 — Derived Endpoints** (shown after Group 1 saves)
- No input fields
- Button: "Generate PingOne Endpoints" → `POST /api/config/derive-pingone-endpoints`
- 6 read-only `CfgField disabled={true}` populated from response
- "Confirm & Save" → saves `oauth_*_endpoint` overrides via existing config save path
- "Skip" with note: "The app derives these at runtime — only save if you need to override them."

**Group 3 — OAuth Clients**
- `CfgField` for `PINGONE_ADMIN_CLIENT_ID`
- `CfgSecretField` for `PINGONE_ADMIN_CLIENT_SECRET`
- `CfgField` for `PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH_METHOD` as `<select>`: `basic` (default), `post`
- `CfgField` for `PINGONE_USER_CLIENT_ID`
- `CfgSecretField` for `PINGONE_USER_CLIENT_SECRET`
- Save → two calls: `POST /api/config/credentials/set` `type: 'admin_oauth'` then `type: 'customer_oauth'`
- Test button → `GET /api/config/credentials/missing?action=admin_login` + `?action=user_login`

**Group 4 — Worker / Management** (skip-able)
- `CfgField` for `PINGONE_MANAGEMENT_CLIENT_ID`
- `CfgSecretField` for `PINGONE_MANAGEMENT_CLIENT_SECRET`
- `CfgField` for `PINGONE_MGMT_TOKEN_AUTH_METHOD` as `<select>`: `basic` (default), `post`
- Save → `POST /api/config/credentials/set` `type: 'worker_token'`
- Test button → `POST /api/admin/setup/validate` (tests worker creds against PingOne Management API)

**Group 5 — AI Agent / MCP** (skip-able)
- `CfgField` for `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID`
- `CfgSecretField` for `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET`
- `CfgField` for `PINGONE_RESOURCE_MCP_SERVER_URI`
- `CfgField` for `mcp_token_exchange_scopes` (default shown as placeholder)
- `CfgField` for `mcp_exchanger_token_endpoint_auth_method` as `<select>`: `post` (default), `basic`
- Save → `POST /api/config/credentials/set` `type: 'ai_agent'`
- Test button → `GET /api/config/credentials/missing?action=agent_mcp`

**Save behavior for all groups:**
- Each group saves independently on its own "Save" button — groups are not coupled.
- Disable the Save button while the request is in-flight to prevent double-submit.
- Show inline status per group: `saving...` → `saved` → `error: <message>`.
- Call `savePublicConfig(state)` after every successful save to keep IndexedDB in sync.
- Secrets use `CfgSecretField` — never log values to console.

### 4c. Import mode — instructional UI

Renders when `setupMode === 'import'`. No credential form fields are shown. The import script runs in the terminal (server must be stopped first), so there is no in-browser file upload.

**Package readiness panel** (shown before the step guide):

The UI calls `GET /api/health/packages` on mount. This endpoint (see §3c below) runs the same checks as import script Step 0 and returns JSON. Render a status strip:

```
┌──────────────────────────────────────────────────────────────┐
│  Machine readiness                                           │
│                                                              │
│  ✓  node_modules installed                                  │
│  ✓  tar package available                                    │
│  ✗  lmdb native binary needs rebuild              │
│                                                              │
│  Fix:  cd banking_api_server && npm rebuild lmdb  │
│                                                    [Copy]   │
└──────────────────────────────────────────────────────────────┘
```

- Green row = check passed. Red row = check failed, with the exact fix command and a copy button.
- If all checks pass: strip shows a single green "Ready to import" line.
- If any check fails: a yellow banner above the step guide reads "Complete the fixes above before running the import command."
- Poll `GET /api/health/packages` every 5 seconds while the panel is visible so it updates after the user runs the fix command in the terminal.

The UI is a 3-step guide with copy buttons:

```
┌──────────────────────────────────────────────────────────────┐
│  Step 1: Stop the server                                     │
│                                                              │
│  The import requires the server to be offline.              │
│  LMDB write transactions hold exclusive locks —             │
│  importing with the server running will corrupt the DB.      │
│                                                              │
│  > ./run-demo.sh stop                    [Copy]             │
├──────────────────────────────────────────────────────────────┤
│  Step 2: Run the import                                      │
│                                                              │
│  The archive includes your .env — no manual file            │
│  copying required. The import script writes it for you.     │
│                                                              │
│  > npm run data:import -- ./banking-export-<date>.tar.gz    │
│                                                    [Copy]   │
│                                                              │
│  The script will:                                           │
│    • Back up existing data/persistent/ before any write     │
│    • Extract all data files                                 │
│    • Write .env (backs up any existing .env first)          │
│    • Run a health check — prints config status              │
├──────────────────────────────────────────────────────────────┤
│  Step 3: Restart and verify                                  │
│                                                              │
│  > ./run-demo.sh                         [Copy]             │
│                                                              │
│  Then return here — this page will show                     │
│  "Import verified" when credentials are loaded.             │
└──────────────────────────────────────────────────────────────┘
```

After the user restarts the server and returns to `/configure`, if `GET /api/health/readiness` returns `configured: true`, show a green banner: "Import verified — credentials are loaded."

> **Security note for UI copy:** The export archive contains your `.env` file and all database secrets. Treat it with the same care as your `.env` — do not commit it to git or share it publicly.

### 4d. First-run redirect in `App.js`

```js
useEffect(() => {
  fetch('/api/health/readiness')
    .then(r => r.json())
    .then(data => {
      if (!data.configured) navigate('/configure?tab=quick-start');
    })
    .catch(() => {}); // fail open — do not redirect on network error
}, []);
```

Read `new URLSearchParams(location.search).get('tab')` in `UnifiedConfigurationPage.tsx` on mount to set `activeSection`.

---

## 5. Route redirects and SideNav cleanup

**`App.js`:**
```jsx
<Route path="/setup" element={<Navigate to="/configure" replace />} />
<Route path="/onboarding" element={<Navigate to="/configure" replace />} />
```

**`SideNav.js`:** remove entries for `/setup` and `/onboarding`.

Grep all JSX for remaining hardcoded `/setup` and `/onboarding` links before closing this step.

**Final SideNav Configuration group:**
```
Configuration
  ├── Configure          (/configure)       — mode selector, new setup, import guide
  ├── Setup Wizard       (/setup/wizard)    — PingOne provisioning (creates apps/resources)
  ├── Feature Flags      (/config)          — runtime toggles only
  └── PingOne Reference  (/setup/pingone)   — static reference
```

---

## 6. Implementation order

| Step | Files touched | Depends on |
|------|--------------|------------|
| **0. `init-env.js` prestart hook** | `scripts/init-env.js` (new), `package.json` (`prestart`) | **Nothing — do this first** |
| 1. Extract `credentialSchemas.js` | `services/credentialSchemas.js` (new), `routes/configCredentials.js` (edit) | Nothing |
| 2. Export + import scripts | See [import-plan.md](import-plan.md) | Nothing |
| 3. Readiness + packages endpoints | `routes/health.js` (add 2 handlers) | Step 1 (readiness only; packages has no deps) |
| 4. Derive-endpoints endpoint | `routes/configDerived.js` (new), `server.js` (mount) | Nothing |
| 5. First-run redirect | `App.js` (add useEffect) | Step 3 |
| 6. Quick-start tab with mode selector | `UnifiedConfigurationPage.tsx` | Steps 3, 4 |
| 7. Redirects + SideNav | `App.js`, `SideNav.js` | Nothing |

Step 0 must go first — every other step assumes the server can start cleanly on a fresh clone. Steps 1, 2, 4, 7 have no inter-dependencies and can then run in parallel.

---

## 7. Acceptance criteria

### Fresh-clone bootstrap (Step 0)

1. `git clone` + `npm start` on a machine with no `.env` → server starts without crashing; `.env` is created with a 64-char hex `SESSION_SECRET`.
2. Running `npm start` again with `.env` already present → `init-env.js` exits 0 immediately without overwriting `.env`.
3. Credentials saved via the setup page persist correctly across a server restart (prove the same `SESSION_SECRET` is used before and after).

### BFF endpoints

1. `GET /api/health/readiness` on a fresh instance → `{ configured: false, userOAuthConfigured: false, missingGroups: ['admin_login','user_login','worker_api','agent_mcp'] }`.
2. After saving Group 1 + 3, `configured: true` and neither `admin_login` nor `user_login` in `missingGroups`.
3. `POST /api/config/derive-pingone-endpoints` with `{ environmentId: "abc-123", region: "com" }` → all 6 URLs contain `auth.pingone.com/abc-123/as/`. No session cookie required.

### Frontend

1. Fresh instance → any route redirects to `/configure?tab=quick-start`; mode defaults to "New setup".
2. Switching to "Import existing config" → the 5-group form hides; the 3-step import guide appears.
3. Group 1 save → progress checklist PingOne Core row turns green without page reload.
4. Group 3 save → `savePublicConfig()` is called; `admin_client_id` appears in IndexedDB.
5. Visiting `/setup` or `/onboarding` → browser ends at `/configure`.
6. `npm run build` exits 0.

### Known failure modes

| Failure | Where it surfaces | Mitigation |
| ------- | ----------------- | ---------- |
| Server starts before `init-env.js` runs | Only possible if `prestart` hook is removed | `prestart` is in `package.json`; `run-demo.sh` also calls it |
| User manually deletes `.env` mid-session | Config decryption fails on next restart | `init-env.js` generates a NEW `SESSION_SECRET` — all saved config is lost; user must re-enter via setup page |
| Double-save race on group buttons | Frontend save buttons | Disable button while request is in-flight |
| IndexedDB out of sync after save | After credential saves | `savePublicConfig()` called after every successful save |
| `?tab=quick-start` URL param ignored on mount | `UnifiedConfigurationPage.tsx` | Read `URLSearchParams` on mount to set `activeSection` |
| `getOAuthEndpoints()` called with empty env ID | Derive-endpoints handler | 400 validation before env-swap |

---

## 8. Out of scope

- Export/import scripts — fully covered in [import-plan.md](import-plan.md).
- Changing configStore encryption — SESSION_SECRET portability is handled by bundling `.env` in the export archive.
- The PAT-to-OAuth migration flow in `routes/migration.js` — unrelated to machine migration.
- The PingOne provisioning wizard at `/setup/wizard` — already complete; this plan does not touch `SetupWizard.js`.
