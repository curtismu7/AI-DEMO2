# Worker Credential Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Secret Rotation tool rotate `Demo AI App - Introspection Worker` (`PINGONE_WORKER_CLIENT_ID`/`PINGONE_WORKER_CLIENT_SECRET`) — the one PingOne app still hard-excluded — without breaking the in-flight rotation run or any of this repo's other PingOne-Management-API callers.

**Architecture:** Three independent, additive changes: (1) make the rotation CLI's own mid-run worker-token resolution read the vault before the (possibly now-stale) `.env` file, so `propagateServiceEnvs()` still succeeds when the app being rotated IS the worker; (2) add the worker to the same direct clientId→vaultKey mapping the other 15 non-legacy apps already use, and stop filtering it out of `/apps`; (3) tell the operator, in the confirm modal, that rotating this one app breaks the whole demo's PingOne connectivity until a restart — not just this app's own consumers, unlike every other app in the tool.

**Tech Stack:** Node.js/CommonJS (`demo_api_server`), Jest, React/Vitest (`demo_api_ui`).

**Spec:** `docs/secret-rotation/2026-09-13-worker-credential-rotation-design.md` (and its parent, `docs/secret-rotation/2026-09-12-secret-rotation-page-design.md`)

## Global Constraints

- Never print, log, or return a secret value in plaintext anywhere outside the vault write itself (existing repo-wide rule, restated because this plan touches the one credential with the widest blast radius in the whole app).
- No changes to any of the 20+ files that already read `PINGONE_WORKER_CLIENT_ID`/`SECRET` outside `scripts/refresh-service-envs.js` — the spec found them all already correct for their situation; this plan does not touch `services/pingOneAuthorizeService.js`, `services/pingOneClientService.js`, `services/pingOneUserService.js`, `services/pingOneGroupProvisionService.js`, `services/twoExchangeReconciler.js`, `routes/health.js`, `routes/mcpPingOneAdminAuth.js`, or `routes/authorize.js`.
- No `.env` write-back mechanism of any kind — a container restart remains the only way `process.env`-based consumers pick up a rotated secret, exactly as for every other app this tool already handles.
- `npm run authz:verify` and the existing secret-rotation test suites (`tests/refreshServiceEnvsRotatableKeys.test.js`, `tests/routes/secretRotation.test.js`, `tests/routes/secretRotationRun.test.js`, `demo_api_ui/src/pages/__tests__/SecretRotationPage.test.jsx`) must stay green throughout.

---

### Task 1: Vault-first worker-token resolution inside `refresh-service-envs.js`'s `main()`

**Files:**
- Modify: `demo_api_server/scripts/refresh-service-envs.js:468-492` (the `main()` function's worker-token acquisition)
- Create: `demo_api_server/tests/refreshServiceEnvsWorkerVaultFirst.test.js`

**Interfaces:**
- Consumes: `loadVaultSecrets(names, root)` — already exported from this file, already used elsewhere in `main()` at line 595 for `INTENT_TOKEN_SECRET`/`BFF_INTERNAL_SECRET`. Signature: `async function loadVaultSecrets(names: string[], root?: string): Promise<Record<string,string>>` — returns `{}` on any failure (no vault, wrong password, key absent), never throws.
- Produces: no new exports. `main()`'s behavior changes only in the one branch described below.

The current code (`demo_api_server/scripts/refresh-service-envs.js:468-492`):

```js
async function main() {
  if (!fs.existsSync(API_ENV)) {
    throw skip('[refresh-envs] demo_api_server/.env not found — bootstrap not yet run, skipping.');
  }

  const apiVars = parseEnv(API_ENV);
  const envId  = apiVars.PINGONE_ENVIRONMENT_ID;
  const region = apiVars.PINGONE_REGION || 'com';
  const workerId     = apiVars.PINGONE_WORKER_CLIENT_ID;
  const workerSecret = apiVars.PINGONE_WORKER_CLIENT_SECRET;

  if (!envId || !workerId || !workerSecret) {
    throw skip('[refresh-envs] Missing PINGONE_ENVIRONMENT_ID / WORKER credentials in api_server .env — skipping.');
  }

  const asBase = `https://auth.pingone.${region}/${envId}/as`;

  let token;
  try {
    token = await getWorkerToken(envId, workerId, workerSecret, region);
    console.log('[refresh-envs] PingOne worker token acquired.');
  } catch (err) {
    throw skip(`[refresh-envs] WARNING: Could not get PingOne worker token: ${err.message}\n`
      + '[refresh-envs] Services will start with existing .env files.');
  }
```

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/refreshServiceEnvsWorkerVaultFirst.test.js`:

```js
'use strict';

// The rotation CLI calls propagateServiceEnvs() (this file's main(), exported
// as propagateServiceEnvs) AFTER vaultSet() has already written a freshly
// rotated worker secret to the vault, but BEFORE demo-api-server has been
// restarted — so apiVars.PINGONE_WORKER_CLIENT_SECRET (read from the raw
// .env file) is still the OLD, now-dead value at this point. Without this
// fix, main()'s own getWorkerToken() call fails with invalid_client and the
// other 11 services' .env files never get re-derived in that pass.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const API_ENV = path.join(ROOT, 'demo_api_server', '.env');

const ENV_TEXT = [
  'PINGONE_ENVIRONMENT_ID=env-1',
  'PINGONE_REGION=com',
  'PINGONE_WORKER_CLIENT_ID=worker-id',
  'PINGONE_WORKER_CLIENT_SECRET=old-dead-secret',
].join('\n');

describe('refresh-service-envs main() — worker token is vault-first', () => {
  let realExists;
  let realRead;
  let mod;

  beforeEach(() => {
    jest.resetModules();
    realExists = fs.existsSync;
    realRead = fs.readFileSync;
    fs.existsSync = (p) => (p === API_ENV ? true : realExists(p));
    fs.readFileSync = (p, enc) => (p === API_ENV ? ENV_TEXT : realRead(p, enc));
    mod = require('../scripts/refresh-service-envs');
  });

  afterEach(() => {
    fs.existsSync = realExists;
    fs.readFileSync = realRead;
  });

  test('prefers a vault-supplied worker secret over the stale .env value', async () => {
    const getWorkerToken = jest.fn().mockResolvedValue('tok');
    const loadVaultSecrets = jest.fn().mockResolvedValue({ PINGONE_WORKER_CLIENT_SECRET: 'new-rotated-secret' });
    // main() takes no deps today — Step 3 adds an optional deps param so this
    // test (and only this test) can observe which secret reached getWorkerToken.
    await mod.propagateServiceEnvs({ getWorkerToken, loadVaultSecrets }).catch(() => {});
    expect(getWorkerToken).toHaveBeenCalledWith('env-1', 'worker-id', 'new-rotated-secret', 'com');
  });

  test('falls back to the .env value when the vault has nothing for this key', async () => {
    const getWorkerToken = jest.fn().mockResolvedValue('tok');
    const loadVaultSecrets = jest.fn().mockResolvedValue({});
    await mod.propagateServiceEnvs({ getWorkerToken, loadVaultSecrets }).catch(() => {});
    expect(getWorkerToken).toHaveBeenCalledWith('env-1', 'worker-id', 'old-dead-secret', 'com');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest tests/refreshServiceEnvsWorkerVaultFirst.test.js --forceExit`
Expected: FAIL — `propagateServiceEnvs` does not currently accept a `deps` argument, so `getWorkerToken`/`loadVaultSecrets` are never substituted and the real network call throws (caught by the test's own `.catch(() => {})`), then the `expect` on the never-called mock fails.

- [ ] **Step 3: Implement the minimal fix**

In `demo_api_server/scripts/refresh-service-envs.js`, change `main()`'s signature and worker-token block (replacing the block shown in this task's intro):

```js
async function main(deps = {}) {
  const getToken = deps.getWorkerToken || getWorkerToken;
  const loadVault = deps.loadVaultSecrets || loadVaultSecrets;

  if (!fs.existsSync(API_ENV)) {
    throw skip('[refresh-envs] demo_api_server/.env not found — bootstrap not yet run, skipping.');
  }

  const apiVars = parseEnv(API_ENV);
  const envId  = apiVars.PINGONE_ENVIRONMENT_ID;
  const region = apiVars.PINGONE_REGION || 'com';
  const workerId = apiVars.PINGONE_WORKER_CLIENT_ID;
  // Vault-first: if the app being rotated IS the worker, vaultSet() has
  // already written the new secret by the time this runs (rotateAppSecretCli
  // calls propagateServiceEnvs() right after vaultSet()), but apiVars still
  // holds the OLD, now-dead value from the not-yet-restarted .env file.
  // Degrades to apiVars when the vault has nothing for this key (the normal
  // case, and every fresh clone with no vault), so this changes nothing
  // outside an in-flight worker rotation.
  const vaultWorker = await loadVault(['PINGONE_WORKER_CLIENT_SECRET']);
  const workerSecret = vaultWorker.PINGONE_WORKER_CLIENT_SECRET || apiVars.PINGONE_WORKER_CLIENT_SECRET;

  if (!envId || !workerId || !workerSecret) {
    throw skip('[refresh-envs] Missing PINGONE_ENVIRONMENT_ID / WORKER credentials in api_server .env — skipping.');
  }

  const asBase = `https://auth.pingone.${region}/${envId}/as`;

  let token;
  try {
    token = await getToken(envId, workerId, workerSecret, region);
    console.log('[refresh-envs] PingOne worker token acquired.');
  } catch (err) {
    throw skip(`[refresh-envs] WARNING: Could not get PingOne worker token: ${err.message}\n`
      + '[refresh-envs] Services will start with existing .env files.');
  }
```

Everything below this block in `main()` is unchanged — `token` still flows into the rest of the function exactly as before.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/refreshServiceEnvsWorkerVaultFirst.test.js --forceExit`
Expected: PASS (2/2)

- [ ] **Step 5: Run the existing propagation tests to confirm nothing else broke**

Run: `cd demo_api_server && CI=true npx jest tests/refreshServiceEnvsExport.test.js tests/refreshServiceEnvsRotatableKeys.test.js tests/rotationContainerPaths.test.js --forceExit`
Expected: PASS, same counts as before this task (this file's `require.main === module` CLI entry point at the bottom, which calls `main()` with no arguments, is unaffected — `deps = {}` defaults to the real functions exactly as `main()` behaved before this change).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/scripts/refresh-service-envs.js demo_api_server/tests/refreshServiceEnvsWorkerVaultFirst.test.js
git commit -m "fix(secret-rotation): worker-token resolution is vault-first in refresh-service-envs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Add the worker to the rotatable list; annotate it instead of filtering it out

**Files:**
- Modify: `demo_api_server/scripts/refresh-service-envs.js` (`DIRECT_VAULT_KEY_ENV_PAIRS`)
- Modify: `demo_api_server/routes/secretRotation.js` (`GET /apps`)
- Test: `demo_api_server/tests/refreshServiceEnvsRotatableKeys.test.js` (invert the existing worker-exclusion test)
- Test: `demo_api_server/tests/routes/secretRotation.test.js`

**Interfaces:**
- Consumes: `isWorkerApp(app)` from `demo_api_server/services/pingOneSecretRotation.js` — unchanged signature `(app: {clientId, id, ...}) => boolean`, already imported in `routes/secretRotation.js`.
- Produces: `/api/admin/secret-rotation/apps` response entries gain a new boolean field, `isWorker`. Every existing field (`id`, `clientId`, `name`, `tokenEndpointAuthMethod`, `vaultKey`) is unchanged. Task 3's UI change consumes `isWorker`.

- [ ] **Step 1: Write the failing tests**

In `demo_api_server/tests/refreshServiceEnvsRotatableKeys.test.js`, find this existing test (in the original `describe('getRotatableVaultKeyMap', ...)` block):

```js
  test('EXCLUDES the worker — rotating it destroys the credential this tool uses', async () => {
    const map = await getRotatableVaultKeyMap(deps());
    expect(map['worker-id']).toBeUndefined();
    expect(map['app-wk']).toBeUndefined();
  });
```

Delete this test — it is superseded, not merely edited (the assertion it made is the opposite of the new behavior). Its replacement belongs in the file's second describe block, `describe('getRotatableVaultKeyMap — direct .env-known apps', ...)`, where the other 15 direct apps are already tested. That block's `ENV_TEXT` (via its `DIRECT_ENV_TEXT = [ENV_TEXT, ...]`) already includes `PINGONE_WORKER_CLIENT_ID=worker-id` from the file's top-level constant — no new env fixture needed. Add this test alongside that block's existing ones, using its existing `ALL_APPS` and `deps()`:

```js
  // 2026-09-13: the worker is no longer excluded. Task 1's vault-first fix
  // inside main()'s own worker-token resolution is what makes rotating it
  // safe for the CLI's own mid-run propagation step; this map's job is just
  // to say "the worker is a rotatable app now", same as any other direct app.
  test('includes the worker once DIRECT_VAULT_KEY_ENV_PAIRS covers it, keyed by id and clientId', async () => {
    const allAppsWithWorker = [...ALL_APPS, { id: 'app-worker', clientId: 'worker-id' }];
    const map = await getRotatableVaultKeyMap({
      ...deps(),
      listAllApps: jest.fn().mockResolvedValue(allAppsWithWorker),
    });
    expect(map['worker-id']).toBe('PINGONE_WORKER_CLIENT_SECRET');
    expect(map['app-worker']).toBe('PINGONE_WORKER_CLIENT_SECRET');
  });
```

In `demo_api_server/tests/routes/secretRotation.test.js`, this file's `listApplicationsRaw` mock (top of file) already returns an `a2`/`worker-client-id` entry that its `isWorkerApp` mock (`app.clientId === 'worker-client-id'`) already identifies as the worker — today it's excluded only because the `beforeEach`'s `getRotatableVaultKeyMap` mock never maps `worker-client-id` to a vault key. Add two tests inside the existing `describe('GET /api/admin/secret-rotation/apps', ...)` block, after the existing `'never returns a secret field'` test:

```js
  test('includes the worker once it has a vault-key mapping, flagged isWorker: true', async () => {
    getRotatableVaultKeyMap.mockResolvedValue({
      c1: 'PINGONE_MCP_GATEWAY_CLIENT_SECRET',
      a1: 'PINGONE_MCP_GATEWAY_CLIENT_SECRET',
      'worker-client-id': 'PINGONE_WORKER_CLIENT_SECRET',
      a2: 'PINGONE_WORKER_CLIENT_SECRET',
    });
    const res = await request(appWithRouter()).get('/api/admin/secret-rotation/apps');
    const worker = res.body.apps.find((a) => a.id === 'a2');
    expect(worker).toBeDefined();
    expect(worker.isWorker).toBe(true);
  });

  test('flags a non-worker app isWorker: false', async () => {
    const res = await request(appWithRouter()).get('/api/admin/secret-rotation/apps');
    const nonWorker = res.body.apps.find((a) => a.id === 'a1');
    expect(nonWorker.isWorker).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest tests/refreshServiceEnvsRotatableKeys.test.js tests/routes/secretRotation.test.js --forceExit`
Expected: FAIL — the worker still isn't in `DIRECT_VAULT_KEY_ENV_PAIRS`, and `/apps` entries have no `isWorker` field yet.

- [ ] **Step 3: Implement**

In `demo_api_server/scripts/refresh-service-envs.js`, add one entry to `DIRECT_VAULT_KEY_ENV_PAIRS` (defined alongside the other 15 direct-app pairs):

```js
const DIRECT_VAULT_KEY_ENV_PAIRS = [
  ['PINGONE_WORKER_CLIENT_ID', 'PINGONE_WORKER_CLIENT_SECRET'],
  ['PINGONE_ADMIN_CLIENT_ID', 'PINGONE_ADMIN_CLIENT_SECRET'],
  // ...existing 14 entries, unchanged...
];
```

(Prepending rather than appending is arbitrary — keep the existing 14 entries and the `A2A_SPECIALIST_KEYS`-derived ones exactly as they are; just add this one line to the array.)

In `demo_api_server/routes/secretRotation.js`, `GET /apps` currently reads:

```js
    const apps = raw
      .filter((a) => SECRETFUL.has(String(a.tokenEndpointAuthMethod || '').toUpperCase()))
      .filter((a) => !isWorkerApp(a))
      .filter((a) => Boolean(vaultKeys[a.clientId]))
      .map((a) => ({
        id: a.id, clientId: a.clientId, name: a.name,
        tokenEndpointAuthMethod: a.tokenEndpointAuthMethod,
        vaultKey: vaultKeys[a.clientId],
      }));
```

Change to:

```js
    const apps = raw
      .filter((a) => SECRETFUL.has(String(a.tokenEndpointAuthMethod || '').toUpperCase()))
      .filter((a) => Boolean(vaultKeys[a.clientId]))
      .map((a) => ({
        id: a.id, clientId: a.clientId, name: a.name,
        tokenEndpointAuthMethod: a.tokenEndpointAuthMethod,
        vaultKey: vaultKeys[a.clientId],
        isWorker: isWorkerApp(a),
      }));
```

(`isWorkerApp` stays imported at the top of the file — the import line does not change, only this one filter-to-annotation swap.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/refreshServiceEnvsRotatableKeys.test.js tests/routes/secretRotation.test.js --forceExit`
Expected: PASS

- [ ] **Step 5: Run the full secret-rotation server test surface**

Run: `cd demo_api_server && CI=true npx jest tests/refreshServiceEnvsRotatableKeys.test.js tests/refreshServiceEnvsExport.test.js tests/rotationContainerPaths.test.js tests/routes/secretRotation.test.js tests/routes/secretRotationRun.test.js tests/refreshServiceEnvsWorkerVaultFirst.test.js --forceExit`
Expected: PASS, every suite green.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/scripts/refresh-service-envs.js demo_api_server/routes/secretRotation.js demo_api_server/tests/refreshServiceEnvsRotatableKeys.test.js demo_api_server/tests/routes/secretRotation.test.js
git commit -m "feat(secret-rotation): the worker app is rotatable, flagged isWorker for the UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Worker-specific warning copy in the confirm modal

**Files:**
- Modify: `demo_api_ui/src/pages/SecretRotationPage.jsx`
- Test: `demo_api_ui/src/pages/__tests__/SecretRotationPage.test.jsx`

**Interfaces:**
- Consumes: `selected.isWorker` (boolean, from Task 2's `/apps` response — the mock `APPS` fixture in the test file needs one entry with `isWorker: true` added).
- Produces: no new exports; this is a pure JSX/copy change inside the existing component.

- [ ] **Step 1: Write the failing test**

In `demo_api_ui/src/pages/__tests__/SecretRotationPage.test.jsx`, add a third app to the `APPS` fixture:

```js
const APPS = [
  { id: 'a1', clientId: 'c1', name: 'Demo App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', vaultKey: 'PINGONE_AGENT_CLIENT_SECRET', isWorker: false },
  { id: 'a2', clientId: 'c2', name: 'Other App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', vaultKey: 'AGENT_CLIENT_SECRET', isWorker: false },
  { id: 'a3', clientId: 'c3', name: 'Demo AI App - Introspection Worker', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', vaultKey: 'PINGONE_WORKER_CLIENT_SECRET', isWorker: true },
];
```

(Adding `isWorker: false` to the two existing entries keeps every prior test's assertions about `Demo App`/`Other App` unchanged — they simply carry a field they don't inspect.)

Add a new test:

```js
  test('warns specifically about the worker\'s repo-wide blast radius, not the generic per-app warning', async () => {
    renderPage(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo AI App - Introspection Worker'));
    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));

    expect(screen.getByText(/every PingOne-dependent request in the demo fails/i)).toBeInTheDocument();
    expect(screen.queryByText(/every consumer fails until propagation completes/i)).not.toBeInTheDocument();
  });

  test('shows the generic per-app warning for a non-worker app', async () => {
    renderPage(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo App'));
    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));

    expect(screen.getByText(/every consumer fails until propagation completes/i)).toBeInTheDocument();
    expect(screen.queryByText(/every PingOne-dependent request in the demo fails/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/SecretRotationPage.test.jsx`
Expected: the new worker-warning test FAILS (the worker-specific text doesn't exist yet); the generic-warning test for `Demo App` PASSES already (no regression from the fixture change).

- [ ] **Step 3: Implement**

In `demo_api_ui/src/pages/SecretRotationPage.jsx`, the confirm modal currently has:

```jsx
            <p className="sr-warning">
              ⚠️ This cannot be undone. <strong>{selected.name}</strong>&apos;s current secret
              dies immediately, and every consumer fails until propagation completes.
            </p>
```

Replace with:

```jsx
            <p className="sr-warning">
              {selected.isWorker ? (
                <>
                  ⚠️ This cannot be undone. <strong>{selected.name}</strong>&apos;s current secret
                  dies immediately — and because this is the credential the whole demo uses to
                  authenticate to PingOne&apos;s Management API, every PingOne-dependent request
                  in the demo fails, not just this app&apos;s, until demo-api-server is restarted.
                </>
              ) : (
                <>
                  ⚠️ This cannot be undone. <strong>{selected.name}</strong>&apos;s current secret
                  dies immediately, and every consumer fails until propagation completes.
                </>
              )}
            </p>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/SecretRotationPage.test.jsx`
Expected: PASS, all tests (the original suite plus the two new ones).

- [ ] **Step 5: Run the full UI checks**

Run:
```bash
cd demo_api_ui && npm run test:unit && npm run build
```
Expected: exit 0 for both.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/SecretRotationPage.jsx demo_api_ui/src/pages/__tests__/SecretRotationPage.test.jsx
git commit -m "feat(secret-rotation): name the worker's repo-wide blast radius in the confirm modal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final verification (after all 3 tasks)

1. `cd demo_api_server && CI=true npx jest tests/refreshServiceEnvsRotatableKeys.test.js tests/refreshServiceEnvsExport.test.js tests/rotationContainerPaths.test.js tests/routes/secretRotation.test.js tests/routes/secretRotationRun.test.js tests/refreshServiceEnvsWorkerVaultFirst.test.js --forceExit` — all green.
2. `cd demo_api_ui && npm run test:unit && npm run build` — exit 0.
3. Live verification (after merge + deploy, matching this feature's established pattern): `docker exec ai-demo-api-server node -e "require('/app/scripts/refresh-service-envs.js').getRotatableVaultKeyMap().then(m => console.log(Object.values(m).includes('PINGONE_WORKER_CLIENT_SECRET')))"` should print `true`. Do **not** actually rotate the live worker credential as part of this verification — that is a real, irreversible action against the live PingOne tenant; confirming the map includes it is sufficient proof the code path works.
4. State ✅/❌ per the repo's "Before claiming done" checklist.
