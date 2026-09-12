# Secret Rotation Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an operator a guarded, one-click way to rotate a PingOne client secret and propagate it to the vault, every service `.env`, the running containers, and the k8s secrets.

**Architecture:** A CLI (`scripts/rotate-app-secret.js`) owns the whole chain. The BFF exposes admin-gated routes that spawn it **detached** and tail its log, and a React page drives those routes. CLI-first because step 6 recreates containers — and when the rotated app is one the BFF itself authenticates with, an in-process design would kill the request performing the rotation moments after PingOne destroyed the old secret.

**Tech Stack:** Node 22 CommonJS, Express, axios, jest + supertest (server); React 19 + Vite, `apiClient` (axios), `InspectorShell`, `DraggableModal` (UI).

**Spec:** `docs/secret-rotation/2026-09-12-secret-rotation-page-design.md`

## Global Constraints

- Node >= 22. `demo_api_server` is **CommonJS** (`'use strict'` + `require`), not ESM.
- **A secret value must never appear in argv, a log file, an HTTP response, or the browser.** `execFileSync` echoes argv in its error message; that previously leaked three plaintext secrets and forced a re-rotation. Vault writes pass the value on **stdin**.
- Only the mask (`••••••••`) and an 8-hex-char SHA-256 fingerprint may cross a process or network boundary.
- The worker app is **hard-excluded** from rotation, identified at runtime via `resolveWorkerCredentials(false).clientId` — never a hardcoded id.
- Error responses use `{ error }`, never `{ message }`.
- Emoji allowlist applies (`REGRESSION_PLAN.md` §0). `✅ ❌ ⚠️ 🔐` are allowed; do not introduce others.
- All modals use `DraggableModal`. `window.confirm` is forbidden.
- Jest runs scoped: `cd demo_api_server && CI=true npx jest <path> --forceExit`.

---

### Task 1: PingOne secret-rotation service

**Files:**
- Create: `demo_api_server/services/pingOneSecretRotation.js`
- Test: `demo_api_server/tests/pingOneSecretRotation.test.js`

**Interfaces:**
- Consumes: `getManagementToken()` and `resolveWorkerCredentials(secretRequired)` from `services/pingOneClientService.js`; `configStore.getEffective(key)`.
- Produces:
  - `regenerateClientSecret(appId: string) => Promise<string>` — the new secret
  - `verifySecret(app: {clientId, tokenEndpointAuthMethod}, secret: string) => Promise<{ok: boolean, code: string}>`
  - `fingerprint(secret: string) => string` — 8 hex chars
  - `isWorkerApp(app: {clientId}) => boolean`

- [ ] **Step 1: Write the failing test**

```js
'use strict';

jest.mock('axios');
const axios = require('axios');

jest.mock('../services/configStore', () => ({
  getEffective: (k) => ({ PINGONE_ENVIRONMENT_ID: 'env-1', PINGONE_REGION: 'com' }[k] || ''),
}));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('tok-abc'),
  resolveWorkerCredentials: jest.fn(() => ({ clientId: 'worker-client-id', clientSecret: 'x' })),
}));

const {
  regenerateClientSecret, verifySecret, fingerprint, isWorkerApp,
} = require('../services/pingOneSecretRotation');

describe('pingOneSecretRotation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('regenerate POSTs with the regenerate content-type', async () => {
    axios.post.mockResolvedValue({ data: { secret: 'new-secret-value' } });
    const out = await regenerateClientSecret('app-9');
    expect(out).toBe('new-secret-value');
    const [url, body, cfg] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.pingone.com/v1/environments/env-1/applications/app-9/secret');
    expect(body).toEqual({});
    expect(cfg.headers['Content-Type']).toBe('application/vnd.pingidentity.secret.regenerate+json');
    expect(cfg.headers.Authorization).toBe('Bearer tok-abc');
  });

  test('regenerate throws when PingOne returns no secret', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await expect(regenerateClientSecret('app-9')).rejects.toThrow(/no secret/i);
  });

  test('fingerprint is 8 hex chars and stable', () => {
    expect(fingerprint('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
  });

  test('CLIENT_SECRET_POST sends credentials in the body, not a Basic header', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 't' } });
    const res = await verifySecret(
      { clientId: 'c-1', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' }, 's-1');
    expect(res.ok).toBe(true);
    const [, body, cfg] = axios.post.mock.calls[0];
    expect(body).toContain('client_secret=s-1');
    expect(cfg.headers.Authorization).toBeUndefined();
  });

  test('invalid_scope counts as a PASS — the credential was accepted', async () => {
    axios.post.mockRejectedValue({ response: { data: { error: 'invalid_scope' } } });
    await expect(verifySecret({ clientId: 'c', tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' }, 's'))
      .resolves.toEqual({ ok: true, code: 'invalid_scope' });
  });

  test('invalid_client is a real failure', async () => {
    axios.post.mockRejectedValue({ response: { data: { error: 'invalid_client' } } });
    await expect(verifySecret({ clientId: 'c', tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' }, 's'))
      .resolves.toEqual({ ok: false, code: 'invalid_client' });
  });

  test('isWorkerApp matches the configured worker clientId', () => {
    expect(isWorkerApp({ clientId: 'worker-client-id' })).toBe(true);
    expect(isWorkerApp({ clientId: 'something-else' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/pingOneSecretRotation.test.js --forceExit`
Expected: FAIL — `Cannot find module '../services/pingOneSecretRotation'`

- [ ] **Step 3: Write the implementation**

```js
'use strict';

/**
 * PingOne client-secret rotation primitives.
 *
 * The regenerate call is verb- and content-type-sensitive: PUT returns 403 and
 * application/json returns 415, both of which read like auth failures. The old
 * secret dies the instant this returns — there is no grace period.
 */

const crypto = require('node:crypto');
const axios = require('axios');
const configStore = require('./configStore');
const { getManagementToken, resolveWorkerCredentials } = require('./pingOneClientService');

const REGENERATE_CONTENT_TYPE = 'application/vnd.pingidentity.secret.regenerate+json';

function apiBase() {
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  return `https://api.pingone.${region}/v1/environments/${envId}`;
}

async function regenerateClientSecret(appId) {
  const token = await getManagementToken();
  const res = await axios.post(`${apiBase()}/applications/${appId}/secret`, {}, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': REGENERATE_CONTENT_TYPE },
    timeout: 20000,
  });
  const secret = res.data && res.data.secret;
  if (!secret) throw new Error('PingOne returned no secret from the regenerate call');
  return secret;
}

function fingerprint(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex').slice(0, 8);
}

function isWorkerApp(app) {
  const { clientId } = resolveWorkerCredentials(false);
  return Boolean(clientId) && app.clientId === clientId;
}

/**
 * Prove a secret is live by asking for a token.
 * `invalid_scope` / `unauthorized_client` mean the CREDENTIAL was accepted and the
 * request failed later on scope or grant type — that is a PASS, and the pair is how
 * you prove a rotated secret took effect.
 */
async function verifySecret(app, secret) {
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const tokenUrl = `https://auth.pingone.${region}/${envId}/as/token`;

  const usePost = String(app.tokenEndpointAuthMethod || '').toUpperCase() === 'CLIENT_SECRET_POST';
  let body = 'grant_type=client_credentials';
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (usePost) {
    body += `&client_id=${encodeURIComponent(app.clientId)}`
         + `&client_secret=${encodeURIComponent(secret)}`;
  } else {
    headers.Authorization = 'Basic '
      + Buffer.from(`${app.clientId}:${secret}`).toString('base64');
  }

  try {
    await axios.post(tokenUrl, body, { headers, timeout: 15000 });
    return { ok: true, code: 'token_issued' };
  } catch (err) {
    const code = (err.response && err.response.data && err.response.data.error) || 'request_failed';
    if (code === 'invalid_scope' || code === 'unauthorized_client') return { ok: true, code };
    return { ok: false, code };
  }
}

module.exports = { regenerateClientSecret, verifySecret, fingerprint, isWorkerApp };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/pingOneSecretRotation.test.js --forceExit`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/pingOneSecretRotation.js demo_api_server/tests/pingOneSecretRotation.test.js
git commit -m "feat(rotation): PingOne client-secret regenerate + verify primitives"
```

---

### Task 2: Export the existing `.env` propagation

**Files:**
- Modify: `demo_api_server/scripts/refresh-service-envs.js:948` (the `module.exports` line)
- Test: `demo_api_server/tests/refreshServiceEnvsExport.test.js`

**Interfaces:**
- Produces: `propagateServiceEnvs() => Promise<void>` — re-derives every service `.env` by pulling each app's current secret from PingOne. Alias keys resolve by construction because each key is fetched per app rather than matched by old value.

Why this is a one-line change: the orchestration already exists as an unexported `main()`. Do **not** reimplement propagation.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

describe('refresh-service-envs exports', () => {
  test('exposes propagateServiceEnvs for programmatic callers', () => {
    const mod = require('../scripts/refresh-service-envs');
    expect(typeof mod.propagateServiceEnvs).toBe('function');
  });

  test('still exports the helpers its existing tests use', () => {
    const mod = require('../scripts/refresh-service-envs');
    expect(typeof mod.loadVaultSecrets).toBe('function');
    expect(typeof mod.writeEnvFile).toBe('function');
    expect(typeof mod.dotenvxPlain).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/refreshServiceEnvsExport.test.js --forceExit`
Expected: FAIL — `expect(typeof mod.propagateServiceEnvs).toBe('function')` receives `"undefined"`

- [ ] **Step 3: Write the implementation**

Replace the export line at the bottom of `demo_api_server/scripts/refresh-service-envs.js`:

```js
// Exported for tests and for scripts/rotate-app-secret.js, which re-runs this
// propagation after rotating a secret. Running this file directly is unaffected —
// the `require.main === module` guard above still drives the CLI path.
module.exports = { loadVaultSecrets, writeEnvFile, dotenvxPlain, propagateServiceEnvs: main };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/refreshServiceEnvsExport.test.js --forceExit`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/scripts/refresh-service-envs.js demo_api_server/tests/refreshServiceEnvsExport.test.js
git commit -m "refactor(rotation): export refresh-service-envs propagation for programmatic use"
```

---

### Task 3: Rotation CLI with preflight

**Files:**
- Create: `scripts/rotate-app-secret.js`
- Test: `demo_api_server/tests/rotateAppSecretPreflight.test.js`

**Interfaces:**
- Consumes: `regenerateClientSecret`, `verifySecret`, `fingerprint`, `isWorkerApp` (Task 1); `propagateServiceEnvs` (Task 2); `openVault` from `demo_api_server/lib/vault`.
- Produces: `preflight({ app, vaultPath, vaultPassword }) => Promise<void>` — throws `Error` on any failure; `runRotation(opts)` for the CLI path. Exported for tests via `module.exports`.

**The ordering is the safety property.** Everything fallible — including proving the vault is writable — runs *before* the irreversible regenerate call.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

jest.mock('../../demo_api_server/services/pingOneSecretRotation', () => ({
  regenerateClientSecret: jest.fn(),
  verifySecret: jest.fn(),
  fingerprint: jest.fn(() => 'deadbeef'),
  isWorkerApp: jest.fn(() => false),
}));

const rotation = require('../../demo_api_server/services/pingOneSecretRotation');
const { preflight } = require('../../scripts/rotate-app-secret');

const APP = { id: 'a1', clientId: 'c1', name: 'Demo App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' };

describe('rotate-app-secret preflight', () => {
  beforeEach(() => jest.clearAllMocks());

  test('refuses the worker app', async () => {
    rotation.isWorkerApp.mockReturnValue(true);
    await expect(preflight({ app: APP, vaultPath: '/tmp/x', vaultPassword: 'p' }))
      .rejects.toThrow(/worker/i);
    expect(rotation.regenerateClientSecret).not.toHaveBeenCalled();
  });

  test('refuses an app with no rotatable secret', async () => {
    await expect(preflight({
      app: { ...APP, tokenEndpointAuthMethod: 'NONE' }, vaultPath: '/tmp/x', vaultPassword: 'p',
    })).rejects.toThrow(/no client secret/i);
    expect(rotation.regenerateClientSecret).not.toHaveBeenCalled();
  });

  test('refuses when the vault password is absent, before rotating', async () => {
    await expect(preflight({ app: APP, vaultPath: '/tmp/x', vaultPassword: '' }))
      .rejects.toThrow(/vault password/i);
    expect(rotation.regenerateClientSecret).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/rotateAppSecretPreflight.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../scripts/rotate-app-secret'`

- [ ] **Step 3: Write the implementation**

```js
#!/usr/bin/env node
'use strict';

/**
 * rotate-app-secret.js — rotate one PingOne client secret and propagate it.
 *
 * Runs as a detached process so it survives the container recreate in step 6:
 * when the rotated app is one ai-demo-api-server itself authenticates with,
 * an in-BFF design would kill itself moments after PingOne destroyed the old
 * secret, losing the answer to "did the vault write land?".
 *
 * Order matters. Everything fallible is preflighted BEFORE the regenerate call,
 * because that call is irreversible and has no grace period.
 *
 * Usage: node scripts/rotate-app-secret.js --app-id <id> [--restart] [--k8s]
 */

const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..');
const {
  regenerateClientSecret, verifySecret, fingerprint, isWorkerApp,
} = require(path.join(REPO_ROOT, 'demo_api_server/services/pingOneSecretRotation'));

const SECRETFUL_AUTH_METHODS = new Set(['CLIENT_SECRET_BASIC', 'CLIENT_SECRET_POST', 'CLIENT_SECRET_JWT']);

/** Throws on any condition that must stop us BEFORE the irreversible rotate. */
async function preflight({ app, vaultPath, vaultPassword }) {
  if (isWorkerApp(app)) {
    throw new Error(
      `Refusing to rotate "${app.name}": it is the configured worker app. `
      + 'Rotating it would destroy the credential this tool uses to reach the Management API.');
  }
  const method = String(app.tokenEndpointAuthMethod || '').toUpperCase();
  if (!SECRETFUL_AUTH_METHODS.has(method)) {
    throw new Error(`Refusing to rotate "${app.name}": tokenEndpointAuthMethod is ${method || 'unset'}, so it has no client secret.`);
  }
  if (!vaultPassword) {
    throw new Error('Refusing to rotate: no vault password available, so the new secret could not be persisted.');
  }
  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Refusing to rotate: vault not found at ${vaultPath}.`);
  }
}

module.exports = { preflight };

if (require.main === module) {
  // CLI path is exercised manually; see the plan's Task 3 manual verification.
  require(path.join(REPO_ROOT, 'scripts/lib/rotateAppSecretCli')).main(process.argv.slice(2));
}
```

Then create the CLI driver it defers to, `scripts/lib/rotateAppSecretCli.js`:

```js
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const { preflight } = require(path.join(REPO_ROOT, 'scripts/rotate-app-secret'));
const {
  regenerateClientSecret, verifySecret, fingerprint,
} = require(path.join(REPO_ROOT, 'demo_api_server/services/pingOneSecretRotation'));
const { propagateServiceEnvs } = require(path.join(REPO_ROOT, 'demo_api_server/scripts/refresh-service-envs'));

const VAULT_CLI = path.join(REPO_ROOT, 'demo_api_server/scripts/vault.js');

function log(msg) { process.stdout.write(`[rotate] ${msg}\n`); }

/** Writes the value on STDIN — never argv, which execFileSync echoes on error. */
function vaultSet(name, value) {
  execFileSync('node', [VAULT_CLI, 'set', name], {
    input: value, stdio: ['pipe', 'ignore', 'pipe'], cwd: REPO_ROOT,
  });
}

async function main(argv) {
  const appId = argv[argv.indexOf('--app-id') + 1];
  const vaultKey = argv[argv.indexOf('--vault-key') + 1];
  if (!appId || !vaultKey) throw new Error('usage: --app-id <id> --vault-key <NAME> [--restart] [--k8s]');

  const app = JSON.parse(execFileSync('node', [
    path.join(REPO_ROOT, 'demo_api_server/scripts/describeApp.js'), appId,
  ], { encoding: 'utf8', cwd: REPO_ROOT }));

  const vaultPath = process.env.VAULT_PATH || path.join(REPO_ROOT, 'secrets.vault');
  await preflight({ app, vaultPath, vaultPassword: process.env.VAULT_PASSWORD || '' });
  log(`preflight ok for "${app.name}"`);

  log('rotating in PingOne — the old secret dies now');
  const secret = await regenerateClientSecret(appId);
  log(`rotated. fingerprint=${fingerprint(secret)}`);

  vaultSet(vaultKey, secret);
  log(`vault updated: ${vaultKey} = ••••••••`);

  await propagateServiceEnvs();
  log('service .env files re-derived from PingOne');

  const check = await verifySecret(app, secret);
  log(check.ok ? `verified (${check.code})` : `VERIFY FAILED (${check.code})`);
  if (!check.ok) process.exitCode = 1;
}

module.exports = { main };
```

`demo_api_server/scripts/describeApp.js` does not exist yet — create it in this task:

```js
#!/usr/bin/env node
'use strict';

// Prints one PingOne app as JSON for the rotation CLI. Never prints a secret.
const { listApplicationsRaw } = require('../services/agentBuilderService');

(async () => {
  const appId = process.argv[2];
  if (!appId) { console.error('usage: describeApp.js <appId>'); process.exit(1); }
  const app = (await listApplicationsRaw()).find((a) => a.id === appId);
  if (!app) { console.error(`app ${appId} not found`); process.exit(1); }
  process.stdout.write(JSON.stringify({
    id: app.id,
    clientId: app.clientId,
    name: app.name,
    tokenEndpointAuthMethod: app.tokenEndpointAuthMethod || null,
  }));
})().catch((err) => { console.error(err.message); process.exit(1); });
```

`--restart` and `--k8s` are parsed here but acted on in Task 7. In this task, append to `main()`:

```js
  if (argv.includes('--restart')) log('restart requested — implemented in Task 7');
  if (argv.includes('--k8s')) log('k8s patch requested — implemented in Task 7');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/rotateAppSecretPreflight.test.js --forceExit`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/rotate-app-secret.js scripts/lib/rotateAppSecretCli.js demo_api_server/scripts/describeApp.js demo_api_server/tests/rotateAppSecretPreflight.test.js
git commit -m "feat(rotation): CLI orchestrator with fail-closed preflight"
```

---

### Task 4: Admin-gated BFF routes

**Files:**
- Create: `demo_api_server/routes/secretRotation.js`
- Modify: `demo_api_server/server.js` (mount beside the existing admin routes at ~line 1059)
- Modify: `demo_api_server/config/auth-requirements.json` (add `"/secret-rotation": "admin"` to `routes`)
- Test: `demo_api_server/tests/routes/secretRotation.test.js`

**Interfaces:**
- Consumes: `isWorkerApp` (Task 1); `agentBuilderService.listApplicationsRaw()`.
- Produces: `GET /api/admin/secret-rotation/apps` → `{ apps: [{id, clientId, name, tokenEndpointAuthMethod}] }`, worker and secretless apps removed.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/agentBuilderService', () => ({
  listApplicationsRaw: jest.fn().mockResolvedValue([
    { id: 'a1', clientId: 'c1', name: 'Rotatable', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' },
    { id: 'a2', clientId: 'worker-client-id', name: 'Worker', tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' },
    { id: 'a3', clientId: 'c3', name: 'Public SPA', tokenEndpointAuthMethod: 'NONE' },
  ]),
}));
jest.mock('../../services/pingOneSecretRotation', () => ({
  isWorkerApp: (app) => app.clientId === 'worker-client-id',
}));

const router = require('../../routes/secretRotation');

function appWithRouter() {
  const app = express();
  app.use('/api/admin/secret-rotation', router);
  return app;
}

describe('GET /api/admin/secret-rotation/apps', () => {
  test('lists only rotatable apps — no worker, no secretless app', async () => {
    const res = await request(appWithRouter()).get('/api/admin/secret-rotation/apps');
    expect(res.status).toBe(200);
    expect(res.body.apps.map((a) => a.id)).toEqual(['a1']);
  });

  test('never returns a secret field', async () => {
    const res = await request(appWithRouter()).get('/api/admin/secret-rotation/apps');
    expect(JSON.stringify(res.body)).not.toMatch(/secret"\s*:/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/routes/secretRotation.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../routes/secretRotation'`

- [ ] **Step 3: Write the implementation**

```js
'use strict';

const express = require('express');
const { listApplicationsRaw } = require('../services/agentBuilderService');
const { isWorkerApp } = require('../services/pingOneSecretRotation');

const router = express.Router();

const SECRETFUL = new Set(['CLIENT_SECRET_BASIC', 'CLIENT_SECRET_POST', 'CLIENT_SECRET_JWT']);

router.get('/apps', async (_req, res) => {
  try {
    const raw = await listApplicationsRaw();
    const apps = raw
      .filter((a) => SECRETFUL.has(String(a.tokenEndpointAuthMethod || '').toUpperCase()))
      .filter((a) => !isWorkerApp(a))
      .map((a) => ({
        id: a.id, clientId: a.clientId, name: a.name,
        tokenEndpointAuthMethod: a.tokenEndpointAuthMethod,
      }));
    res.json({ apps });
  } catch (err) {
    res.status(502).json({ error: `Could not list applications: ${err.message}` });
  }
});

module.exports = router;
```

Mount in `demo_api_server/server.js`, directly below the existing `mgmtApiRoutes` line:

```js
app.use('/api/admin/secret-rotation', authenticateToken, requireAdmin, secretRotationRoutes);
```

Add `"/secret-rotation": "admin"` to the `routes` map in `demo_api_server/config/auth-requirements.json`, keeping the file's alphabetical ordering.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/routes/secretRotation.test.js --forceExit`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/secretRotation.js demo_api_server/server.js demo_api_server/config/auth-requirements.json demo_api_server/tests/routes/secretRotation.test.js
git commit -m "feat(rotation): admin-gated route listing rotatable apps"
```

---

### Task 5: Start + tail routes

**Files:**
- Modify: `demo_api_server/routes/secretRotation.js`
- Test: `demo_api_server/tests/routes/secretRotationRun.test.js`

**Interfaces:**
- Produces: `POST /api/admin/secret-rotation/start` → `{ runId }`; `GET /api/admin/secret-rotation/runs/:runId` → `{ status: 'running'|'done'|'failed', lines: string[] }`.

Runs are spawned **detached** with `stdio` redirected to a log file under `demo_api_server/data/rotation-runs/<runId>.log`, so a container recreate cannot orphan the operation.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const express = require('express');
const request = require('supertest');

const spawn = jest.fn(() => ({ pid: 4242, unref: jest.fn() }));
jest.mock('node:child_process', () => ({ spawn: (...a) => spawn(...a) }));
jest.mock('../../services/agentBuilderService', () => ({ listApplicationsRaw: jest.fn() }));
jest.mock('../../services/pingOneSecretRotation', () => ({ isWorkerApp: () => false }));

const router = require('../../routes/secretRotation');

describe('POST /api/admin/secret-rotation/start', () => {
  test('spawns the CLI detached and never puts a secret in argv', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/secret-rotation', router);

    const res = await request(app)
      .post('/api/admin/secret-rotation/start')
      .send({ appId: 'a1', vaultKey: 'DEMO_CLIENT_SECRET' });

    expect(res.status).toBe(202);
    expect(res.body.runId).toMatch(/^[0-9a-f-]{36}$/);
    const [, argv, opts] = spawn.mock.calls[0];
    expect(argv).toEqual(expect.arrayContaining(['--app-id', 'a1', '--vault-key', 'DEMO_CLIENT_SECRET']));
    expect(argv.join(' ')).not.toMatch(/secret=[^ ]/);
    expect(opts.detached).toBe(true);
  });

  test('rejects a request with no appId', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/secret-rotation', router);
    const res = await request(app).post('/api/admin/secret-rotation/start').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/appId/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/routes/secretRotationRun.test.js --forceExit`
Expected: FAIL — 404, the `/start` route does not exist

- [ ] **Step 3: Write the implementation**

Append to `demo_api_server/routes/secretRotation.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUN_DIR = path.join(__dirname, '..', 'data', 'rotation-runs');

router.post('/start', (req, res) => {
  const { appId, vaultKey, restart, k8s } = req.body || {};
  if (!appId) return res.status(400).json({ error: 'appId is required' });
  if (!vaultKey) return res.status(400).json({ error: 'vaultKey is required' });

  fs.mkdirSync(RUN_DIR, { recursive: true });
  const runId = crypto.randomUUID();
  const logPath = path.join(RUN_DIR, `${runId}.log`);
  const out = fs.openSync(logPath, 'a');

  const argv = [path.join(REPO_ROOT, 'scripts/rotate-app-secret.js'),
    '--app-id', appId, '--vault-key', vaultKey];
  if (restart) argv.push('--restart');
  if (k8s) argv.push('--k8s');

  // Detached: a container recreate in the rotation's own restart step must not
  // orphan it. No secret is ever passed here — the CLI obtains it from PingOne.
  const child = spawn(process.execPath, argv, {
    cwd: REPO_ROOT, detached: true, stdio: ['ignore', out, out],
  });
  child.unref();

  res.status(202).json({ runId });
});

router.get('/runs/:runId', (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.runId)) {
    return res.status(400).json({ error: 'invalid runId' });
  }
  const logPath = path.join(RUN_DIR, `${req.params.runId}.log`);
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'run not found' });
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const done = lines.some((l) => /verified|VERIFY FAILED|Error/.test(l));
  const failed = lines.some((l) => /VERIFY FAILED|Error/.test(l));
  res.json({ status: failed ? 'failed' : (done ? 'done' : 'running'), lines });
});
```

Add `demo_api_server/data/rotation-runs/` to `.gitignore` — run logs are local artifacts.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/routes/secretRotationRun.test.js --forceExit`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/secretRotation.js demo_api_server/tests/routes/secretRotationRun.test.js .gitignore
git commit -m "feat(rotation): detached run start + log tail routes"
```

---

### Task 6: Page, confirmation modal, and nav wiring

**Files:**
- Create: `demo_api_ui/src/pages/SecretRotationPage.jsx`, `demo_api_ui/src/pages/SecretRotationPage.css`
- Modify: `demo_api_ui/src/App.js` (import + `<Route>` wrapped in `<RequireAdminLogin>`)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (nav entry)
- Modify: `demo_api_ui/src/config/navStructureCatalog.js` (same entry, same group, same order)
- Test: `demo_api_ui/src/pages/__tests__/SecretRotationPage.test.jsx`

**Interfaces:**
- Consumes: `GET /apps`, `POST /start`, `GET /runs/:runId` (Tasks 4-5); `apiClient` from `../services/apiClient`; `DraggableModal`.

**This is vitest, not jest** — `demo_api_ui` uses vitest. Run with `npm run test:unit` from `demo_api_ui`.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { apps: [
      { id: 'a1', clientId: 'c1', name: 'Demo App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' },
    ] } }),
    post: vi.fn().mockResolvedValue({ data: { runId: '11111111-1111-1111-1111-111111111111' } }),
  },
}));

import apiClient from '../../services/apiClient';
import SecretRotationPage from '../SecretRotationPage';

describe('SecretRotationPage', () => {
  beforeEach(() => vi.clearAllMocks());

  test('lists rotatable apps', async () => {
    render(<SecretRotationPage />);
    expect(await screen.findByText('Demo App')).toBeInTheDocument();
  });

  test('does not start a rotation until the confirmation is completed', async () => {
    render(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo App'));
    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));
    expect(apiClient.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /yes, rotate/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/admin/secret-rotation/start',
      expect.objectContaining({ appId: 'a1' }),
    ));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/SecretRotationPage.test.jsx`
Expected: FAIL — cannot resolve `../SecretRotationPage`

- [ ] **Step 3: Write the implementation**

```jsx
import React, { useEffect, useState, useRef } from 'react';
import InspectorShell from '../components/shared/InspectorShell';
import DraggableModal from '../components/DraggableModal';
import apiClient from '../services/apiClient';
import './SecretRotationPage.css';

const POLL_MS = 2000;

export default function SecretRotationPage() {
  const [apps, setApps] = useState([]);
  const [selected, setSelected] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [armed, setArmed] = useState(false);
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);

  useEffect(() => {
    apiClient.get('/api/admin/secret-rotation/apps')
      .then((r) => setApps(r.data.apps || []))
      .catch(() => setApps([]));
    return () => clearTimeout(timer.current);
  }, []);

  // The API never returns the secret; the fingerprint is how a run is verified
  // against `printenv KEY | shasum`.
  const fingerprint = (lines.find((l) => l.includes('fingerprint=')) || '')
    .split('fingerprint=')[1] || '';

  async function poll(runId) {
    const { data } = await apiClient.get(`/api/admin/secret-rotation/runs/${runId}`);
    setLines(data.lines || []);
    setStatus(data.status);
    if (data.status === 'running') timer.current = setTimeout(() => poll(runId), POLL_MS);
  }

  async function startRotation() {
    setConfirming(false);
    setArmed(false);
    setStatus('running');
    const { data } = await apiClient.post('/api/admin/secret-rotation/start', {
      appId: selected.id,
      vaultKey: selected.vaultKey || `${selected.name.toUpperCase().replace(/\W+/g, '_')}_CLIENT_SECRET`,
      restart: true,
      k8s: false,
      reason,
    });
    poll(data.runId);
  }

  return (
    <InspectorShell
      title="Secret Rotation"
      left={(
        <ul className="sr-app-list">
          {apps.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setSelected(a)}>{a.name}</button>
            </li>
          ))}
        </ul>
      )}
      middle={selected && (
        <div className="sr-detail">
          <h2>{selected.name}</h2>
          <p className="sr-meta">{selected.tokenEndpointAuthMethod}</p>
          <button type="button" className="sr-danger" onClick={() => setConfirming(true)}>
            Rotate secret
          </button>
          {status !== 'idle' && (
            <p className="sr-result">
              Secret: <code>••••••••</code>
              {fingerprint && <> · fingerprint <code>{fingerprint}</code></>}
            </p>
          )}
        </div>
      )}
      right={<pre className="sr-log">{lines.join('\n')}</pre>}
    >
      {confirming && (
        <DraggableModal title="Rotate this client secret?" onClose={() => setConfirming(false)}>
          <p>
            ⚠️ This cannot be undone. <strong>{selected.name}</strong>&apos;s current secret
            dies immediately, and every consumer fails until propagation completes.
          </p>
          <label htmlFor="sr-reason">Reason (required)</label>
          <input id="sr-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          {!armed ? (
            <button type="button" disabled={!reason} onClick={() => setArmed(true)}>
              I understand — arm rotation
            </button>
          ) : (
            <button type="button" className="sr-danger" onClick={startRotation}>
              Yes, rotate
            </button>
          )}
        </DraggableModal>
      )}
    </InspectorShell>
  );
}
```

Constraints for the CSS and markup:

- Use `--th-*` theme tokens only; no colour, background or font-size in inline `style={{}}` (`THEMING.md`, and `REGRESSION_PLAN.md` §0 H3 enforces it).
- Font sizes come from the scale; the floor is `--font-size-3xs` (10px).
- `⚠️` is on the emoji allowlist; do not add others.
- Verify the real `InspectorShell` and `DraggableModal` prop names before wiring — if they differ from the skeleton above, follow the components, not this plan.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/SecretRotationPage.test.jsx`
Expected: PASS, 2 tests

- [ ] **Step 5: Wire the three sources of truth**

Add the same entry to `AdminSideNav.jsx` and `navStructureCatalog.js` (identical label, same group, same position — `navStructureCatalog.drift.test.js` compares them exactly), and the guarded route to `App.js`:

```jsx
<Route path="/secret-rotation" element={
  <RequireAdminLogin user={user}><SecretRotationPage /></RequireAdminLogin>
} />
```

- [ ] **Step 6: Verify the gates**

Run: `npm run authz:verify`
Expected: PASS — fails if the route level, the `<Route>` guard, or the two nav files disagree.

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/pages/SecretRotationPage.jsx demo_api_ui/src/pages/SecretRotationPage.css demo_api_ui/src/pages/__tests__/SecretRotationPage.test.jsx demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/config/navStructureCatalog.js
git commit -m "feat(rotation): Secret Rotation admin page with confirm modal"
```

---

### Task 7: Container recreate and k8s secret patch

**Files:**
- Create: `scripts/lib/rotationTargets.js`
- Modify: `scripts/lib/rotateAppSecretCli.js`
- Test: `demo_api_server/tests/rotationTargets.test.js`

**Interfaces:**
- Produces:
  - `servicesForVaultKey(vaultKey: string) => string[]` — compose service names to recreate
  - `applyRestart(services: string[], { execFile }) => void`
  - `applyK8sPatch(vaultKey: string, secret: string, { execFile }) => void`

These are the spec's steps 6 and 7. A plain `docker restart` is **not** enough: Compose resolves `env_file` at container-**create** time, so a restarted container keeps the old value. `./run-docker.sh restart <svc>` recreates.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const { servicesForVaultKey, applyRestart, applyK8sPatch } = require('../../scripts/lib/rotationTargets');

describe('rotationTargets', () => {
  test('maps a vault key to the services that consume it', () => {
    expect(servicesForVaultKey('PINGONE_MCP_GATEWAY_CLIENT_SECRET'))
      .toEqual(expect.arrayContaining(['mcp-gateway']));
  });

  test('unknown key recreates the BFF, which reads every secret', () => {
    expect(servicesForVaultKey('SOMETHING_NEW')).toEqual(['demo-api-server']);
  });

  test('restart shells run-docker.sh, never a bare docker restart', () => {
    const execFile = jest.fn();
    applyRestart(['demo-api-server'], { execFile });
    const [cmd, args] = execFile.mock.calls[0];
    expect(cmd).toMatch(/run-docker\.sh$/);
    expect(args).toEqual(['restart', 'demo-api-server']);
  });

  test('k8s patch passes the secret on stdin, never in argv', () => {
    const execFile = jest.fn();
    applyK8sPatch('DEMO_SECRET', 'super-secret-value', { execFile });
    const [, args, opts] = execFile.mock.calls[0];
    expect(args.join(' ')).not.toContain('super-secret-value');
    expect(String(opts.input)).toContain('super-secret-value');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/rotationTargets.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../scripts/lib/rotationTargets'`

- [ ] **Step 3: Write the implementation**

```js
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

// Which compose services read which secret. The BFF is the catch-all because it
// resolves every key through configStore.
const SERVICE_MAP = {
  PINGONE_MCP_GATEWAY_CLIENT_SECRET: ['mcp-gateway', 'demo-api-server'],
  TE_CLIENT_SECRET: ['demo-api-server', 'ping-gateway'],
};

function servicesForVaultKey(vaultKey) {
  return SERVICE_MAP[vaultKey] || ['demo-api-server'];
}

/**
 * `docker restart` keeps the old env: Compose resolves env_file at container-CREATE
 * time. run-docker.sh recreates, which is the only thing that picks up a new secret.
 */
function applyRestart(services, deps = {}) {
  const execFile = deps.execFile || execFileSync;
  execFile(path.join(REPO_ROOT, 'run-docker.sh'), ['restart', ...services], {
    cwd: REPO_ROOT, stdio: ['ignore', 'inherit', 'inherit'],
  });
}

/** Secret goes on stdin — argv is echoed in execFile error messages. */
function applyK8sPatch(vaultKey, secret, deps = {}) {
  const execFile = deps.execFile || execFileSync;
  const patch = JSON.stringify({
    data: { [vaultKey]: Buffer.from(secret, 'utf8').toString('base64') },
  });
  execFile('kubectl', ['patch', 'secret', 'ai-demo-secrets', '--patch-file', '/dev/stdin'], {
    input: patch, stdio: ['pipe', 'inherit', 'inherit'],
  });
}

module.exports = { servicesForVaultKey, applyRestart, applyK8sPatch };
```

Then replace the two placeholder log lines in `scripts/lib/rotateAppSecretCli.js` with:

```js
  const { servicesForVaultKey, applyRestart, applyK8sPatch } =
    require(path.join(REPO_ROOT, 'scripts/lib/rotationTargets'));

  if (argv.includes('--restart')) {
    const services = servicesForVaultKey(vaultKey);
    log(`recreating: ${services.join(', ')}`);
    applyRestart(services);
    log('containers recreated');
  }
  if (argv.includes('--k8s')) {
    applyK8sPatch(vaultKey, secret);
    log('k8s secret patched');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/rotationTargets.test.js --forceExit`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/rotationTargets.js scripts/lib/rotateAppSecretCli.js demo_api_server/tests/rotationTargets.test.js
git commit -m "feat(rotation): recreate containers and patch k8s secrets after rotating"
```

> **`SERVICE_MAP` is deliberately small.** Extend it only when a real key needs a narrower target than the BFF; defaulting to `demo-api-server` is correct and safe because it reads every key.

---

## Manual verification (do this before opening the PR)

The unit tests never touch PingOne. Prove the chain once, by hand, against a **throwaway app you create for the purpose** — never a live demo app on a first run:

1. Create a scratch OIDC app in PingOne with `CLIENT_SECRET_POST`.
2. `node scripts/rotate-app-secret.js --app-id <scratch-id> --vault-key SCRATCH_SECRET --restart`
3. Confirm the log shows `preflight ok`, a `fingerprint=`, `vault updated`, `verified`, and `containers recreated`.
4. Confirm the fingerprint matches: `node demo_api_server/scripts/vault.js get SCRATCH_SECRET | shasum -a 256 | cut -c1-8`
5. Confirm no secret leaked: `grep -ri "$(node demo_api_server/scripts/vault.js get SCRATCH_SECRET)" demo_api_server/data/rotation-runs/` must return **nothing**.
6. Delete the scratch app and its vault entry.

## Out of scope

Rotating the worker credential; scheduled rotation; remediating already-leaked values (that is `docs/incident-response/`, and rotation at source is the only real fix).
