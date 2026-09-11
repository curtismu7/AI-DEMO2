# LM Studio Privilege Gateway Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Also load the `verify-ai-demo2` and `regression-guard` skills before running tests or touching auth code.

**Goal:** An MCP client's own OAuth sign-in to the façade's Privilege door also establishes the façade's upstream session to the PingOne Privilege AI Gateway, so nobody has to visit `/privilege-mcp-client`.

**Architecture:** The broker (`demo_mcp_gateway` OAuthBrokerRouter) keeps the client's `resource`; after its PingOne hop, for a `…/mcp-facade/privilege-gateway/<app>/mcp` resource it parks the authorization and sends the browser to a new BFF route that runs the existing gateway sign-in for that app, stores the token per app (persisted in LMDB), and returns the browser to the broker's new `/oauth/resume`. The façade door answers 401 (instead of 503) when an app has no gateway session, so clients re-authenticate on expiry.

**Tech Stack:** BFF — Node 22, CommonJS, Express 4, LMDB, jest 29 + supertest. Broker — TypeScript 5 (`tsc`), jest 29 + ts-jest + supertest.

**Spec:** `docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md`

## Global Constraints

- Work only in the worktree `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/lmstudio-privilege-link` on branch `worktree-lmstudio-privilege-link`. Run `git branch --show-current` before every commit. Stage files by name — never `git add -A` (jest regenerates artifacts).
- Emoji allowlist (`REGRESSION_PLAN.md` §0): no emoji in code, comments, copy or docs.
- BFF error bodies use `{ error }` (`demo_api_server/CLAUDE.md`).
- Env names, exactly: `BFF_PRIVILEGE_LINK_URL` (mcp-gateway), `MCP_FACADE_PRIVILEGE_LINK` = `"true"` (demo-api-server).
- New BFF routes: `GET /api/privilege-mcp/facade-link`, `GET /api/privilege-mcp/facade-link/callback`. New broker route: `GET /oauth/resume`.
- Never log or return a token value.
- Scoped test runs only. BFF: `cd demo_api_server && CI=true ./node_modules/.bin/jest <files> --forceExit`. Never pass `--testPathIgnorePatterns`. Never `npx jest` in a worktree. Broker: `cd demo_mcp_gateway && npm run build && ./node_modules/.bin/jest <files> --forceExit` (`dist/` is gitignored).
- A red suite that is green in isolation is contention, not a regression — re-run it alone before acting.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `demo_api_server/services/privilegeGatewaySession.js` (modify) | Per-app gateway sessions; best-effort LMDB write-through; `defaultApp()` |
| `demo_api_server/services/lmdb/privilegeGatewaySessionStore.lmdb.js` (create) | LMDB key-per-app store: `loadAll`, `save`, `remove` |
| `demo_api_server/routes/mcpFacade.js` (modify) | Per-app token on the privilege door; 401 challenge behind the flag; clear the app session on upstream 401 |
| `demo_api_server/routes/privilegeMcpClient.js` (modify) | `/facade-link` + `/facade-link/callback`; shared `exchangeAuthorizationCode`; `beginOAuthFlow` callback option; DCR cache keyed by redirect URI; app on `/auth/callback` remember; `gatewaySessionsByApp` on `/state` |
| `demo_mcp_gateway/src/oauth/BrokerTokenStore.ts` (modify) | `resource` on pending; resumable authorizations |
| `demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts` (modify) | Keep `resource`; link redirect in callback; `/oauth/resume` |
| `docker-compose.yml` (modify) | The two switches |
| `lmstudio/README.md`, `REGRESSION_PLAN.md`, `TECH_DEBT.md` (modify) | Docs |

Tests: `demo_api_server/tests/services/privilegeGatewaySession.test.js` (extend), `demo_api_server/tests/services/privilegeGatewaySessionStore.test.js` (create), `demo_api_server/tests/routes/mcpFacade.privilegeGatewayDoor.test.js` (extend), `demo_api_server/tests/routes/privilegeMcpClient.facadeLink.test.js` (create), `demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionRemember.test.js` (one assertion), `demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionState.test.js` (one test + afterEach), `demo_mcp_gateway/tests/oauth-broker-router-authorize.test.ts` (extend), `demo_mcp_gateway/tests/oauth-broker-token-store.test.ts` (extend).

---

### Task 0: Make the worktree runnable

**Files:** none (symlinks only, untracked).

- [ ] **Step 1: Link node_modules from the main checkout**

Run: `bash scripts/bootstrap-worktree.sh`
Expected: exit 0; every service reports its declared deps resolve.

- [ ] **Step 2: Baseline the suites this plan touches**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/services/privilegeGatewaySession.test.js tests/routes/mcpFacade.privilegeGatewayDoor.test.js tests/routes/privilegeMcpClient.gatewaySessionRemember.test.js tests/routes/privilegeMcpClient.gatewaySessionState.test.js tests/routes/privilegeMcpClient.dcrReregister.test.js tests/checks/privilegeMcpFirstCheck.test.js --forceExit > /tmp/baseline-bff.txt 2>&1; echo "exit=$?"; tail -6 /tmp/baseline-bff.txt`
Expected: `exit=0`, all suites pass.

Run: `cd demo_mcp_gateway && npm run build > /tmp/baseline-gw.txt 2>&1 && ./node_modules/.bin/jest tests/oauth-broker-router-authorize.test.ts tests/oauth-broker-token-store.test.ts tests/gateway-oauth-broker-wiring.test.ts --forceExit >> /tmp/baseline-gw.txt 2>&1; echo "exit=$?"; tail -6 /tmp/baseline-gw.txt`
Expected: `exit=0`.

---

### Task 1: Per-app gateway sessions, persisted

**Files:**
- Create: `demo_api_server/services/lmdb/privilegeGatewaySessionStore.lmdb.js`
- Modify: `demo_api_server/services/privilegeGatewaySession.js` (whole file)
- Test: `demo_api_server/tests/services/privilegeGatewaySession.test.js` (append a describe), `demo_api_server/tests/services/privilegeGatewaySessionStore.test.js` (create)

**Interfaces:**
- Produces (used by Tasks 2 and 3):
  - `remember({ app?, accessToken, refreshToken, expiresIn, tokenUri, clientId, clientSecret }): void`
  - `getAccessToken(app?): Promise<string|null>`
  - `status(app?): { ready: boolean, reason?: 'no_session'|'refreshable'|'expired' }`
  - `statusAll(): { [app: string]: status }`
  - `clear(app?): void` — one app; the default app when omitted
  - `clearAll(): void`
  - `defaultApp(): string` — `process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP || 'opensearch22'`
  - `__setStore(store | undefined): void` — test seam
- Store module: `loadAll(): { [app]: record }`, `save(app, record)`, `remove(app)`, `DB_NAME = 'privilegeGatewaySessions'`

- [ ] **Step 1: Write the failing store test**

Create `demo_api_server/tests/services/privilegeGatewaySessionStore.test.js`:

```js
'use strict';

// The persisted half of services/privilegeGatewaySession.js. openEnv is faked
// with a Map, as in privilegeDoorStore.test.js: what is worth pinning is this
// module's key layout, not the LMDB binding twenty other stores exercise.

const mockDb = new Map();

jest.mock('../../services/lmdb/openEnv', () => ({
  getDb: () => ({
    getRange: () => [...mockDb].map(([key, value]) => ({ key, value })),
    putSync: (k, v) => { mockDb.set(k, v); return true; },
    removeSync: (k) => mockDb.delete(k),
  }),
}));

const store = require('../../services/lmdb/privilegeGatewaySessionStore.lmdb');

beforeEach(() => mockDb.clear());

describe('privilegeGatewaySessionStore', () => {
  test('stores one record per app and reads them all back', () => {
    store.save('opensearch', { accessToken: 'a' });
    store.save('opensearch22', { accessToken: 'b' });

    expect(store.loadAll()).toEqual({
      opensearch: { accessToken: 'a' },
      opensearch22: { accessToken: 'b' },
    });
  });

  test('remove drops only that app', () => {
    store.save('opensearch', { accessToken: 'a' });
    store.save('opensearch22', { accessToken: 'b' });

    store.remove('opensearch');

    expect(store.loadAll()).toEqual({ opensearch22: { accessToken: 'b' } });
  });
});
```

- [ ] **Step 2: Append the failing session tests**

Append to `demo_api_server/tests/services/privilegeGatewaySession.test.js` (after the existing `describe`):

```js
describe('privilege gateway session — one per app, persisted', () => {
  const originalApp = process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP;
  afterEach(() => {
    if (originalApp === undefined) delete process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP;
    else process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP = originalApp;
    jest.restoreAllMocks();
  });

  function fakeStore(initial = {}) {
    const data = { ...initial };
    return {
      data,
      loadAll: jest.fn(() => ({ ...data })),
      save: jest.fn((app, record) => { data[app] = record; }),
      remove: jest.fn((app) => { delete data[app]; }),
    };
  }

  test('keeps a separate session per app', async () => {
    const session = load();
    remembered(session, { app: 'opensearch', accessToken: 'os-token' });
    remembered(session, { app: 'opensearch22', accessToken: 'os22-token' });

    expect(await session.getAccessToken('opensearch')).toBe('os-token');
    expect(await session.getAccessToken('opensearch22')).toBe('os22-token');

    session.clear('opensearch');
    expect(await session.getAccessToken('opensearch')).toBeNull();
    expect(await session.getAccessToken('opensearch22')).toBe('os22-token');
  });

  test('a call with no app means the default door app', async () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP = 'opensearch22';
    const session = load();
    remembered(session, { app: 'opensearch22', accessToken: 'default-token' });

    expect(await session.getAccessToken()).toBe('default-token');
    expect(session.status()).toEqual({ ready: true });
    expect(session.statusAll()).toEqual({ opensearch22: { ready: true } });
  });

  test('clearAll drops every app', () => {
    const session = load();
    remembered(session, { app: 'a1' });
    remembered(session, { app: 'a2' });

    session.clearAll();

    expect(session.statusAll()).toEqual({});
  });

  test('survives a process restart through the store', async () => {
    const backing = fakeStore();
    const first = load();
    first.__setStore(backing);
    remembered(first, { app: 'opensearch', accessToken: 'persisted-token' });
    expect(backing.save).toHaveBeenCalledWith('opensearch', expect.objectContaining({ accessToken: 'persisted-token' }));

    const second = load(); // a fresh module, as after a container recreate
    second.__setStore(backing);
    expect(await second.getAccessToken('opensearch')).toBe('persisted-token');
  });

  test('does not resurrect an expired session that has no refresh token', () => {
    const backing = fakeStore({
      opensearch: { accessToken: 'dead', refreshToken: null, tokenUri: TOKEN_URI, expiresAt: Date.now() - 1000 },
    });
    const session = load();
    session.__setStore(backing);

    expect(session.status('opensearch')).toEqual({ ready: false, reason: 'no_session' });
  });

  test('a failing store still leaves a working in-memory session', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const session = load();
    session.__setStore({
      loadAll: () => { throw new Error('MDB_MAP_FULL'); },
      save: () => { throw new Error('MDB_MAP_FULL'); },
      remove: () => { throw new Error('MDB_MAP_FULL'); },
    });

    remembered(session, { app: 'opensearch', accessToken: 'mem-token' });

    expect(await session.getAccessToken('opensearch')).toBe('mem-token');
    expect(console.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/services/privilegeGatewaySession.test.js tests/services/privilegeGatewaySessionStore.test.js --forceExit > /tmp/t1.txt 2>&1; echo "exit=$?"; grep -E "Tests:|Cannot find module|is not a function" /tmp/t1.txt | head`
Expected: `exit=1`; the store suite fails with `Cannot find module '../../services/lmdb/privilegeGatewaySessionStore.lmdb'`; the new session tests fail (`__setStore is not a function`, `statusAll is not a function`, or the per-app assertion); the six original session tests still pass.

- [ ] **Step 4: Create the store**

Create `demo_api_server/services/lmdb/privilegeGatewaySessionStore.lmdb.js`:

```js
'use strict';
/**
 * privilegeGatewaySessionStore.lmdb.js — the façade's Privilege AI Gateway
 * sessions, persisted so a BFF container recreate does not throw them away.
 *
 * One key per Agentic App (e.g. `opensearch22`); the value is the record
 * services/privilegeGatewaySession.js keeps in memory. See that module for why
 * a gateway token is stored at all.
 */
const { getDb } = require('./openEnv');

const DB_NAME = 'privilegeGatewaySessions';

function _db() { return getDb(DB_NAME); }

/** Every stored session, keyed by app. */
function loadAll() {
  const out = {};
  for (const { key, value } of _db().getRange()) out[key] = value;
  return out;
}

function save(app, record) {
  _db().putSync(app, record);
}

function remove(app) {
  _db().removeSync(app);
}

module.exports = { loadAll, save, remove, DB_NAME };
```

- [ ] **Step 5: Rewrite the session module**

Replace the whole of `demo_api_server/services/privilegeGatewaySession.js` with:

```js
'use strict';

/**
 * The façade's upstream leg to the Privilege AI Gateway, one session per
 * Agentic App.
 *
 * WHY THIS EXISTS. Standalone MCP clients (LM Studio) register themselves with
 * whatever authorization server a door advertises. The gateway keeps its RFC
 * 7591 client registry in MEMORY — verified 2026-09-02, there is no on-disk
 * store in the container — so every gateway restart forgets every client, and a
 * client that cached its registration dead-ends on a bare "Unknown client" page
 * until a human deletes and re-adds the integration.
 *
 * The fix is to stop pointing those clients at the gateway. A door backed by
 * this module advertises OUR durable authorization server instead and keeps the
 * gateway leg server-side, where the BFF already re-registers itself when the
 * gateway forgets it (see isDcrClientStillKnown in routes/privilegeMcpClient.js).
 * The client's own registration then never breaks.
 *
 * HOW A SESSION ARRIVES. The gateway offers only authorization_code and
 * refresh_token — no client_credentials — and issues no refresh token (its
 * metadata has no offline_access), so every session is one browser sign-in and
 * lasts one access-token lifetime: 60 minutes, measured 2026-09-11. Two
 * sign-ins hand one over: /privilege-mcp-client in Privilege mode, and the MCP
 * client's own OAuth, which the broker chains through
 * /api/privilege-mcp/facade-link (see
 * docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md).
 *
 * ONE PER APP. The gateway binds a token to the Agentic App it was minted for,
 * so each app keeps its own session. A call with no app means the default door
 * app, which keeps every caller written before this split working unchanged.
 *
 * PERSISTED. This used to be deliberately in-memory, "a credential at rest for
 * no demo benefit". The benefit turned out to be real: several sessions share
 * one stack, so the BFF container is recreated often, and each recreate threw a
 * live session away. The same token is already persisted in the LMDB session
 * store (CLEAR_SESSIONS_ON_BOOT=false) and lives at most an hour, so this copy
 * adds no new kind of secret at rest. Writes are best-effort: LMDB near its
 * mapSize must not break the in-memory session.
 *
 * ponytail: one operator identity per app; key it per user if a second identity
 * ever needs this door.
 */

// Refresh this far before expiry so a call never races the clock.
const REFRESH_SKEW_MS = 60_000;

const sessions = new Map();
let loaded = false;
let storeOverride; // see __setStore

/** The app a door URL with no app segment means. */
function defaultApp() {
  return process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP || 'opensearch22';
}

function keyFor(app) {
  return app || defaultApp();
}

function store() {
  if (storeOverride !== undefined) return storeOverride;
  // Jest runs suites in parallel against one LMDB file, so persisting under
  // test would leak one suite's session into another. Suites that cover
  // persistence inject a store with __setStore.
  if (process.env.NODE_ENV === 'test') return null;
  return require('./lmdb/privilegeGatewaySessionStore.lmdb');
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const s = store();
  if (!s) return;
  try {
    for (const [app, record] of Object.entries(s.loadAll())) {
      // A session past expiry with no refresh token can never serve a call
      // again; do not resurrect it into a fresh process.
      const dead = record && !record.refreshToken && record.expiresAt <= Date.now();
      if (record?.accessToken && record.tokenUri && !dead) sessions.set(app, record);
    }
  } catch (err) {
    console.warn('[privilegeGatewaySession] could not load persisted sessions:', err.message);
  }
}

function persist(app) {
  const s = store();
  if (!s) return;
  try {
    const record = sessions.get(app);
    if (record) s.save(app, record);
    else s.remove(app);
  } catch (err) {
    console.warn('[privilegeGatewaySession] could not persist session:', err.message);
  }
}

/**
 * Record a gateway session established by an interactive sign-in.
 * Called on every successful authorization-code exchange and refresh.
 */
function remember({ app, accessToken, refreshToken, expiresIn, tokenUri, clientId, clientSecret }) {
  if (!accessToken || !tokenUri) return;
  ensureLoaded();
  const key = keyFor(app);
  sessions.set(key, {
    accessToken,
    refreshToken: refreshToken || null,
    tokenUri,
    clientId: clientId || null,
    clientSecret: clientSecret || null,
    // A token with no expires_in is treated as short-lived rather than eternal.
    expiresAt: Date.now() + (Number(expiresIn) > 0 ? Number(expiresIn) * 1000 : 300_000),
  });
  persist(key);
}

/** Drop one app's session — the default app's when none is named. */
function clear(app) {
  ensureLoaded();
  const key = keyFor(app);
  sessions.delete(key);
  persist(key);
}

/** Drop every app's session. */
function clearAll() {
  ensureLoaded();
  for (const key of [...sessions.keys()]) {
    sessions.delete(key);
    persist(key);
  }
}

function statusOf(current) {
  if (!current) return { ready: false, reason: 'no_session' };
  if (current.expiresAt - REFRESH_SKEW_MS > Date.now()) return { ready: true };
  return { ready: Boolean(current.refreshToken), reason: current.refreshToken ? 'refreshable' : 'expired' };
}

/** What the door reports when it cannot serve a request, for the operator. */
function status(app) {
  ensureLoaded();
  return statusOf(sessions.get(keyFor(app)));
}

/** status() for every app that holds a session. */
function statusAll() {
  ensureLoaded();
  return Object.fromEntries([...sessions].map(([app, record]) => [app, statusOf(record)]));
}

async function refresh(key) {
  const current = sessions.get(key);
  if (!current?.refreshToken) return null;
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
  });
  if (current.clientId) form.set('client_id', current.clientId);
  if (current.clientSecret) form.set('client_secret', current.clientSecret);

  let response;
  try {
    response = await fetch(current.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch {
    // Network trouble is not proof the session is dead — keep it and let the
    // next call try again.
    return null;
  }
  if (!response.ok) {
    // The gateway restarted (client gone) or the refresh token expired. Either
    // way this session can never be revived; drop it so status() tells the
    // operator to sign in again instead of failing opaquely forever.
    clear(key);
    return null;
  }
  let data;
  try { data = JSON.parse(await response.text()); } catch { return null; }
  if (!data.access_token) return null;

  remember({
    app: key,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || current.refreshToken,
    expiresIn: data.expires_in,
    tokenUri: current.tokenUri,
    clientId: current.clientId,
    clientSecret: current.clientSecret,
  });
  return sessions.get(key).accessToken;
}

/** A usable gateway access token for an app, or null when a human must sign in again. */
async function getAccessToken(app) {
  ensureLoaded();
  const key = keyFor(app);
  const current = sessions.get(key);
  if (!current) return null;
  if (current.expiresAt - REFRESH_SKEW_MS > Date.now()) return current.accessToken;
  return refresh(key);
}

/** Test seam: back the module with a fake store (`undefined` restores the default). */
function __setStore(s) {
  storeOverride = s;
  loaded = false;
  sessions.clear();
}

module.exports = { remember, clear, clearAll, status, statusAll, getAccessToken, defaultApp, __setStore };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/services/privilegeGatewaySession.test.js tests/services/privilegeGatewaySessionStore.test.js tests/checks/privilegeMcpFirstCheck.test.js tests/routes/privilegeMcpClient.gatewaySessionState.test.js tests/routes/mcpFacade.privilegeGatewayDoor.test.js --forceExit > /tmp/t1.txt 2>&1; echo "exit=$?"; grep -E "Tests:|Suites:" /tmp/t1.txt`
Expected: `exit=0`; 12 session tests + 2 store tests pass; the three callers' suites are unchanged and green.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # must print worktree-lmstudio-privilege-link
git add demo_api_server/services/privilegeGatewaySession.js demo_api_server/services/lmdb/privilegeGatewaySessionStore.lmdb.js demo_api_server/tests/services/privilegeGatewaySession.test.js demo_api_server/tests/services/privilegeGatewaySessionStore.test.js
git commit -m "feat(privilege): gateway sessions per Agentic App, persisted in LMDB" -m "A container recreate no longer drops the façade's gateway leg, and each app keeps its own token. No-arg calls keep meaning the default app." -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Façade door — per-app token, 401 behind the flag

**Files:**
- Modify: `demo_api_server/routes/mcpFacade.js` (the `ownsUpstreamAuth` block at ~815-837; the `upstream.status === 401` block at ~970; the DELETE handler's `getAccessToken()` at ~1117)
- Test: `demo_api_server/tests/routes/mcpFacade.privilegeGatewayDoor.test.js`

**Interfaces:**
- Consumes: `privilegeGatewaySession.getAccessToken(app)`, `status(app)`, `clear(app)`, `clearAll()` from Task 1.
- Produces: with `MCP_FACADE_PRIVILEGE_LINK=true`, a missing session answers `401`, `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<facadeBase>/.well-known/oauth-protected-resource"`, body `{ jsonrpc: '2.0', id, error: { code: -32001, message: 'Unauthorized', data: { reason: 'gateway_session_unavailable' } } }`.

- [ ] **Step 1: Extend the test file**

In `demo_api_server/tests/routes/mcpFacade.privilegeGatewayDoor.test.js`:

Replace the upstream server creation (inside `beforeAll`) so a known-stale token is refused, and point the app-scoped upstream at it:

```js
beforeAll((done) => {
  upstream = http.createServer((req, res) => {
    seenAuth = req.headers.authorization || null;
    seenPath = req.url;
    if (seenAuth === 'Bearer stale-token') {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }));
  });
  upstream.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${upstream.address().port}`;
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_URL = `${base}/opensearch22/mcp`;
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE = base;
    process.env.MCP_FACADE_OPENSEARCH_AUD = AUD;
    done();
  });
});

afterAll((done) => {
  delete process.env.MCP_FACADE_PRIVILEGE_GATEWAY_URL;
  delete process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE;
  delete process.env.MCP_FACADE_OPENSEARCH_AUD;
  upstream.close(done);
});
```

Add `let seenPath;` next to `let seenAuth;`, and these constants next to `DOOR`:

```js
const DOOR_APP = '/api/mcp-facade/privilege-gateway/opensearch/mcp';
const TOKEN_URI = 'https://mcpgw.example.com/opensearch/token';
```

Replace the `describe` block's `beforeEach`/`afterEach` with:

```js
  beforeEach(() => {
    seenAuth = undefined;
    seenPath = undefined;
    jwksService.getPublicKey.mockResolvedValue({ keyObject: publicKey, alg: 'RS256' });
    gatewaySession.clearAll();
  });
  afterEach(() => {
    gatewaySession.clearAll();
    delete process.env.MCP_FACADE_PRIVILEGE_LINK;
  });
```

Rename the first test to `'answers 503 with a remedy when no operator session exists and the gateway link is off'` (body unchanged).

Append these tests inside the `describe`:

```js
  test('with the gateway link on, a missing session answers a 401 challenge so the client re-authenticates', async () => {
    process.env.MCP_FACADE_PRIVILEGE_LINK = 'true';

    const res = await request(buildApp()).post(DOOR_APP)
      .set('Authorization', `Bearer ${callerToken()}`)
      .send(RPC);

    // The broker chains the gateway sign-in into the client's own OAuth, so a
    // re-authentication is exactly what restores this leg.
    expect(res.status).toBe(401);
    expect(res.body.error.data.reason).toBe('gateway_session_unavailable');
    expect(res.headers['www-authenticate']).toContain('/mcp-facade/privilege-gateway/opensearch/.well-known/oauth-protected-resource');
    expect(seenAuth).toBeUndefined();
  });

  test('uses the session for the app in the URL, not another app', async () => {
    gatewaySession.remember({ app: 'opensearch22', accessToken: 'os22-token', expiresIn: 3600, tokenUri: TOKEN_URI });
    gatewaySession.remember({ app: 'opensearch', accessToken: 'os-token', expiresIn: 3600, tokenUri: TOKEN_URI });

    const res = await request(buildApp()).post(DOOR_APP)
      .set('Authorization', `Bearer ${callerToken()}`)
      .send(RPC);

    expect(res.status).toBe(200);
    expect(seenPath).toBe('/opensearch/mcp');
    expect(seenAuth).toBe('Bearer os-token');
  });

  test('drops the app session when the gateway refuses its token', async () => {
    gatewaySession.remember({ app: 'opensearch', accessToken: 'stale-token', expiresIn: 3600, tokenUri: TOKEN_URI });

    const res = await request(buildApp()).post(DOOR_APP)
      .set('Authorization', `Bearer ${callerToken()}`)
      .send(RPC);

    // The client is re-challenged; its next sign-in must start from a clean slate.
    expect(res.status).toBe(401);
    expect(gatewaySession.status('opensearch')).toEqual({ ready: false, reason: 'no_session' });
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/routes/mcpFacade.privilegeGatewayDoor.test.js --forceExit > /tmp/t2.txt 2>&1; echo "exit=$?"; grep -E "✕|Tests:" /tmp/t2.txt`
Expected: `exit=1`; the 401-challenge test fails (receives 503) and the per-app test fails (sees `Bearer os22-token` or 503); the drop test fails (status still ready).

- [ ] **Step 3: Implement the door changes**

In `demo_api_server/routes/mcpFacade.js`, replace the block that starts at the comment `// A door that owns its upstream auth swaps the caller's bearer for the` through `upstreamHeaders = { ...upstreamHeaders, authorization: \`Bearer ${upstreamToken}\` };\n  }` with:

```js
  // A door that owns its upstream auth swaps the caller's bearer for the
  // server-side gateway session of the app it names. Without one there are two
  // honest answers. With the gateway link on, the client's own sign-in restores
  // this leg — the broker chains it through /api/privilege-mcp/facade-link
  // (docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md)
  // — so send the client back to authenticate. Without the link, a 401 would
  // only loop it through a sign-in that cannot fix this: say a human has to
  // sign in instead.
  let upstreamHeaders = forwardHeaders(req, correlationId);
  if (door.ownsUpstreamAuth) {
    const upstreamToken = await privilegeGatewaySession.getAccessToken(req.params.app);
    if (!upstreamToken) {
      if (process.env.MCP_FACADE_PRIVILEGE_LINK === 'true') {
        res.set('WWW-Authenticate', rewriteChallenge('Bearer error="invalid_token"', `${facadeBase(req)}/.well-known/oauth-protected-resource`, door.scopes));
        return res.status(401).json({
          jsonrpc: '2.0',
          id: rpc.id ?? null,
          error: { code: -32001, message: 'Unauthorized', data: { reason: 'gateway_session_unavailable' } },
        });
      }
      return res.status(503).json({
        jsonrpc: '2.0',
        id: rpc.id ?? null,
        error: {
          code: -32002,
          message: 'Gateway session unavailable',
          data: {
            reason: privilegeGatewaySession.status(req.params.app).reason,
            remedy: 'Sign in once at /privilege-mcp-client — the gateway forgets its clients on restart.',
          },
        },
      });
    }
    upstreamHeaders = { ...upstreamHeaders, authorization: `Bearer ${upstreamToken}` };
  }
```

Replace:

```js
  if (upstream.status === 401) {
    res.set('WWW-Authenticate', rewriteChallenge(upstream.headers.get('www-authenticate'), `${facadeBase(req)}/.well-known/oauth-protected-resource`, door.scopes));
  }
```

with:

```js
  if (upstream.status === 401) {
    // The gateway refused the session's token (it restarted, or the token was
    // minted for another app). Drop it so the client's re-authentication
    // starts from a clean slate instead of replaying a dead token.
    if (door.ownsUpstreamAuth) privilegeGatewaySession.clear(req.params.app);
    res.set('WWW-Authenticate', rewriteChallenge(upstream.headers.get('www-authenticate'), `${facadeBase(req)}/.well-known/oauth-protected-resource`, door.scopes));
  }
```

In the `router.delete([...])` handler, replace `const upstreamToken = await privilegeGatewaySession.getAccessToken();` with:

```js
    const upstreamToken = await privilegeGatewaySession.getAccessToken(req.params.app);
```

- [ ] **Step 4: Run the façade suites**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/routes/mcpFacade.privilegeGatewayDoor.test.js tests/routes/mcpFacade.privilegeEntryPath.test.js tests/routes/mcpFacade.multiApp.test.js --forceExit > /tmp/t2.txt 2>&1; echo "exit=$?"; grep -E "Tests:|Suites:" /tmp/t2.txt`
Expected: `exit=0`, all pass (6 tests in the door suite).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_server/routes/mcpFacade.js demo_api_server/tests/routes/mcpFacade.privilegeGatewayDoor.test.js
git commit -m "feat(mcp-facade): privilege door uses the per-app gateway session; 401 challenge behind MCP_FACADE_PRIVILEGE_LINK" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: BFF gateway link routes

**Files:**
- Modify: `demo_api_server/routes/privilegeMcpClient.js` — `getOrRegisterDcrClient` (~1504), `beginOAuthFlow` (~1546), new helpers after `beginOAuthFlow`, `/state` (~1838), `/auth/callback` (~2033-2096), new routes after `/auth/callback`
- Test: `demo_api_server/tests/routes/privilegeMcpClient.facadeLink.test.js` (create); `demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionRemember.test.js` (one assertion); `demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionState.test.js` (one test + afterEach)

**Interfaces:**
- Consumes: `privilegeGatewaySession.remember({ app, … })`, `statusAll()`, `defaultApp()` (Task 1).
- Produces (the broker in Task 4 relies on this contract):
  - `GET /api/privilege-mcp/facade-link?app=<name>&resume=<broker>/oauth/resume?rs=<id>` → 302 to the gateway authorize URL, or 400 `{ error }` with no redirect.
  - `GET /api/privilege-mcp/facade-link/callback` → 302 to `resume` with `link=ok`, or `link=error&reason=<≤300 chars>`; 400 `{ error }` when no link is in progress.
  - `beginOAuthFlow(session, req, { callbackPath })`.
  - `exchangeAuthorizationCode(pending, code, fallbackClientId): Promise<tokenData>`.

- [ ] **Step 1: Write the failing link tests**

Create `demo_api_server/tests/routes/privilegeMcpClient.facadeLink.test.js`:

```js
'use strict';

// /facade-link chains the Privilege gateway sign-in into an MCP client's own
// OAuth: the broker (demo_mcp_gateway) sends the browser here after its PingOne
// hop, the BFF signs it in to the gateway for one Agentic App, and hands it
// back to the broker's /oauth/resume. See
// docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md.

const express = require('express');
const request = require('supertest');

const GATEWAY = 'https://mcpgw.test.example.com';
const APP_URL = `${GATEWAY}/opensearch/mcp`;
const AUTH_URI = `${GATEWAY}/opensearch/authorize`;
const TOKEN_URI = `${GATEWAY}/opensearch/token`;
const RESUME = 'http://localhost:3005/oauth/resume?rs=parked-1';
const SID = 'facade-link-test';

const mockRemember = jest.fn();
jest.mock('../../services/privilegeGatewaySession', () => ({
  remember: (...args) => mockRemember(...args),
  clear: jest.fn(),
  clearAll: jest.fn(),
  status: jest.fn(() => ({ ready: false, reason: 'no_session' })),
  statusAll: jest.fn(() => ({})),
  getAccessToken: jest.fn(async () => null),
  defaultApp: () => 'opensearch22',
}));

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

// A self-advertising gateway: each app answers discovery on /<app>/mcp,
// registers DCR clients on /<app>/register, and redeems codes on /<app>/token.
function gatewayFetch({ tokenStatus = 200 } = {}) {
  let registered = 0;
  return jest.fn(async (url, options = {}) => {
    const [, , , app, leaf] = String(url).split('/');
    if (leaf === 'mcp') {
      return jsonResponse({ authorization_uri: `${GATEWAY}/${app}/authorize`, token_uri: `${GATEWAY}/${app}/token` });
    }
    if (leaf === 'register') {
      registered += 1;
      return jsonResponse({ client_id: `dcr-link-${registered}` });
    }
    if (leaf === 'token') {
      if (String(options.body || '').includes('dcr-liveness-probe')) return jsonResponse({ error: 'invalid_grant' }, 400);
      return tokenStatus === 200
        ? jsonResponse({ access_token: 'gateway-token', expires_in: 3600 })
        : jsonResponse({ error: 'invalid_grant' }, tokenStatus);
    }
    return jsonResponse({});
  });
}

function buildApp(sessionStore) {
  jest.resetModules();
  mockRemember.mockClear();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = SID;
    req.session = sessionStore;
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function startLink(app, query) {
  return request(app).get('/api/privilege-mcp/facade-link').query(query);
}

const origFetch = global.fetch;
const origGatewayUrl = process.env.PRIVILEGE_MCPGW_URL;

beforeEach(() => {
  process.env.PRIVILEGE_MCPGW_URL = `${GATEWAY}/opensearch22/mcp`;
  global.fetch = gatewayFetch();
});
afterEach(() => {
  global.fetch = origFetch;
  if (origGatewayUrl === undefined) delete process.env.PRIVILEGE_MCPGW_URL;
  else process.env.PRIVILEGE_MCPGW_URL = origGatewayUrl;
  jest.restoreAllMocks();
});

describe('GET /api/privilege-mcp/facade-link', () => {
  test('refuses a resume URL that is not the broker\'s own /oauth/resume', async () => {
    const app = buildApp({});
    for (const resume of [
      'https://attacker.example.com/oauth/resume?rs=x',
      'http://localhost:3005/oauth/callback?rs=x',
      'http://localhost:3005/oauth/resume',
      'not a url',
    ]) {
      const res = await startLink(app, { app: 'opensearch', resume });
      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
    }
  });

  test('refuses an app name that is not a plain name', async () => {
    const res = await startLink(buildApp({}), { app: '../admin', resume: RESUME });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  test('sends the browser to the gateway sign-in for that app, in its own session slot', async () => {
    const session = {};
    const res = await startLink(buildApp(session), { app: 'opensearch', resume: RESUME });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(AUTH_URI);
    expect(location.searchParams.get('client_id')).toBe('dcr-link-1');
    expect(location.searchParams.get('redirect_uri')).toMatch(/\/api\/privilege-mcp\/facade-link\/callback$/);
    expect(location.searchParams.get('prompt')).toBeNull();
    expect(session.privilegeFacadeLink).toMatchObject({ app: 'opensearch', resume: RESUME, tokenUri: TOKEN_URI });
    expect(session.privilegeFacadeLink.oauthState).toBe(location.searchParams.get('state'));
  });

  test('no app means the default app, as the façade reads its bare door', async () => {
    const res = await startLink(buildApp({}), { resume: RESUME });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).pathname).toBe('/opensearch22/authorize');
  });

  test('leaves a sign-in in flight on /privilege-mcp-client, and its selected door, untouched', async () => {
    const session = {};
    const app = buildApp(session);
    const pageDoor = `${GATEWAY}/opensearch22/mcp`;
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: pageDoor, clientId: 'client-abc' }).expect(200);
    const start = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    const pageState = new URL(start.body.authUrl).searchParams.get('state');

    await startLink(app, { app: 'opensearch', resume: RESUME }).expect(302);

    const { getClientSession } = require('../../routes/privilegeMcpClient').__test;
    const page = getClientSession({ sessionID: SID, session });
    expect(page.config.mcpUrl).toBe(pageDoor);
    expect(page.pendingAuth.oauthState).toBe(pageState);
  });

  test('registers its own gateway client for the link callback', async () => {
    const app = buildApp({});
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: APP_URL, clientId: 'client-abc' }).expect(200);
    const start = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    const pageClient = new URL(start.body.authUrl).searchParams.get('client_id');

    const res = await startLink(app, { app: 'opensearch', resume: RESUME }).expect(302);
    const linkClient = new URL(res.headers.location).searchParams.get('client_id');

    // The gateway binds a DCR client to its registered redirect URI; reusing
    // the page's client would send the gateway's callback to /auth/callback.
    expect(linkClient).not.toBe(pageClient);
  });
});

describe('GET /api/privilege-mcp/facade-link/callback', () => {
  async function linked({ tokenStatus } = {}) {
    global.fetch = gatewayFetch({ tokenStatus });
    const session = {};
    const app = buildApp(session);
    const res = await startLink(app, { app: 'opensearch', resume: RESUME }).expect(302);
    return { app, state: new URL(res.headers.location).searchParams.get('state') };
  }

  function callback(app, query) {
    return request(app).get('/api/privilege-mcp/facade-link/callback').query(query);
  }

  test('stores the gateway token for that app and hands the browser back to the broker', async () => {
    const { app, state } = await linked();
    const res = await callback(app, { code: 'gw-code', state });

    expect(res.status).toBe(302);
    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe('http://localhost:3005/oauth/resume');
    expect(back.searchParams.get('rs')).toBe('parked-1');
    expect(back.searchParams.get('link')).toBe('ok');
    expect(mockRemember).toHaveBeenCalledWith(expect.objectContaining({
      app: 'opensearch', accessToken: 'gateway-token', tokenUri: TOKEN_URI, clientId: 'dcr-link-1',
    }));
  });

  test('a state mismatch goes back to the broker as link=error and stores nothing', async () => {
    const { app } = await linked();
    const back = new URL((await callback(app, { code: 'gw-code', state: 'forged' })).headers.location);
    expect(back.searchParams.get('link')).toBe('error');
    expect(back.searchParams.get('reason')).toMatch(/state/i);
    expect(mockRemember).not.toHaveBeenCalled();
  });

  test('a gateway error goes back to the broker as link=error', async () => {
    const { app, state } = await linked();
    const back = new URL((await callback(app, { error: 'access_denied', error_description: 'policy', state })).headers.location);
    expect(back.searchParams.get('link')).toBe('error');
    expect(back.searchParams.get('reason')).toBe('access_denied: policy');
  });

  test('a failed token exchange goes back to the broker as link=error', async () => {
    const { app, state } = await linked({ tokenStatus: 400 });
    const back = new URL((await callback(app, { code: 'gw-code', state })).headers.location);
    expect(back.searchParams.get('link')).toBe('error');
    expect(mockRemember).not.toHaveBeenCalled();
  });

  test('is single-use, and a callback with no link in progress is a 400, not a redirect', async () => {
    const { app, state } = await linked();
    await callback(app, { code: 'gw-code', state }).expect(302);

    const again = await callback(app, { code: 'gw-code', state });
    expect(again.status).toBe(400);
    expect(again.headers.location).toBeUndefined();
  });
});
```

Add one assertion to `demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionRemember.test.js`, in the first test after `expect(mockRemember.mock.calls[0][0].accessToken).toBe('access-1');`:

```js
    expect(mockRemember.mock.calls[0][0].app).toBe('opensearch22');
```

In `demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionState.test.js`, change `afterEach(() => privilegeGatewaySession.clear());` to `afterEach(() => privilegeGatewaySession.clearAll());` and add this test at the end of the `describe`:

```js
  it('reports each app\'s session alongside the default one', async () => {
    privilegeGatewaySession.remember({
      app: 'opensearch', accessToken: 'tok', expiresIn: 3600, tokenUri: TOKEN_URI,
    });

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.gatewaySessionsByApp).toEqual({ opensearch: { ready: true } });
    expect(res.body.gatewaySession).toEqual({ ready: false, reason: 'no_session' });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/routes/privilegeMcpClient.facadeLink.test.js tests/routes/privilegeMcpClient.gatewaySessionRemember.test.js tests/routes/privilegeMcpClient.gatewaySessionState.test.js --forceExit > /tmp/t3.txt 2>&1; echo "exit=$?"; grep -E "✕|Tests:" /tmp/t3.txt`
Expected: `exit=1`; the link suite fails (404 on `/facade-link`), the remember test fails on `app`, the state test fails on `gatewaySessionsByApp`.

- [ ] **Step 3: Key the DCR cache by redirect URI**

In `getOrRegisterDcrClient`, replace:

```js
  const registerUri = new URL(authorizationUri);
  registerUri.pathname = registerUri.pathname.replace(/\/authorize$/, '/register');
  const cacheKey = registerUri.toString();
  if (dcrClientCache.has(cacheKey)) {
    const cached = dcrClientCache.get(cacheKey);
    const tokenUri = cacheKey.replace(/\/register$/, '/token');
```

with:

```js
  const registerUri = new URL(authorizationUri);
  registerUri.pathname = registerUri.pathname.replace(/\/authorize$/, '/register');
  const registerUrl = registerUri.toString();
  // Keyed by redirect URI too: the gateway binds a client to the redirect URIs
  // it registered, and /facade-link/callback is a different one from
  // /auth/callback for the same app.
  const cacheKey = `${registerUrl} ${redirectUri}`;
  if (dcrClientCache.has(cacheKey)) {
    const cached = dcrClientCache.get(cacheKey);
    const tokenUri = registerUrl.replace(/\/register$/, '/token');
```

and replace `const response = await fetch(cacheKey, {` with `const response = await fetch(registerUrl, {`.

- [ ] **Step 4: Give beginOAuthFlow a callback path**

Replace `async function beginOAuthFlow(session, req) {` with `async function beginOAuthFlow(session, req, { callbackPath } = {}) {`, and replace:

```js
  const redirectUri = `${protocol}://${host}/api/privilege-mcp/auth/callback`;
```

with:

```js
  const redirectUri = `${protocol}://${host}${callbackPath || '/api/privilege-mcp/auth/callback'}`;
```

- [ ] **Step 5: Add the shared helpers after beginOAuthFlow**

Insert directly after the closing `}` of `beginOAuthFlow` (before the `// Routes` banner):

```js
// Redeem a gateway authorization code with the PKCE verifier, redirect URI and
// client its flow started with. Shared by /auth/callback and
// /facade-link/callback so both redeem codes identically.
async function exchangeAuthorizationCode(pending, code, fallbackClientId) {
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });
  // A DCR client (self-advertising gateway, see beginOAuthFlow) is unrelated
  // to the PingOne app id — the token endpoint only recognizes its own.
  tokenBody.set('client_id', pending.dcrClientId || fallbackClientId);
  const clientSecret = pending.dcrClientSecret
    || process.env.PRIVILEGE_SSO_CLIENT_SECRET || process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET || '';
  if (clientSecret) tokenBody.set('client_secret', clientSecret);

  const tokenResponse = await fetch(pending.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });
  const tokenText = await tokenResponse.text();
  let tokenData;
  try { tokenData = JSON.parse(tokenText); } catch { throw new Error(`Token exchange non-JSON: ${tokenText.slice(0, 300)}`); }
  if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${tokenResponse.status} ${tokenText.slice(0, 300)}`);
  return tokenData;
}

// The Agentic App a gateway door URL names: https://<gateway>/<app>/mcp -> <app>.
function gatewayAppFromUrl(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || null; } catch { return null; }
}
```

- [ ] **Step 6: Use the helper in /auth/callback, and remember the app**

In `router.get('/auth/callback', …)`, replace everything from `const tokenBody = new URLSearchParams({` through `if (!tokenResponse.ok) throw new Error(\`Token exchange failed: ${tokenResponse.status} ${tokenText.slice(0, 300)}\`);` with:

```js
    const tokenData = await exchangeAuthorizationCode(session.pendingAuth, code, session.config.clientId);
```

In the same handler's `privilegeGatewaySession.remember({` call, add as the first property:

```js
        app: gatewayAppFromUrl(session.config.mcpUrl),
```

- [ ] **Step 7: Report per-app state on /state**

Replace:

```js
    // The façade's privilege-gateway door runs on a server-side gateway token
    // that dies with the process (services/privilegeGatewaySession.js). Ship its
    // state so the page can say so instead of the door failing silently.
    gatewaySession: privilegeGatewaySession.status(),
```

with:

```js
    // The façade's privilege-gateway door runs on server-side gateway tokens,
    // one per Agentic App, that expire hourly (services/privilegeGatewaySession.js).
    // Ship their state so the page can say so instead of the door failing
    // silently. gatewaySession stays the default app's — the page's banner reads it.
    gatewaySession: privilegeGatewaySession.status(),
    gatewaySessionsByApp: privilegeGatewaySession.statusAll(),
```

- [ ] **Step 8: Add the link routes after /auth/callback**

Insert directly after the `/auth/callback` route's closing `});`:

```js
// ---------------------------------------------------------------------------
// Privilege gateway link — the gateway sign-in, chained into an MCP client's
// own OAuth, so nobody has to visit this page to make the façade's
// privilege-gateway door work.
// docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md
//
// The broker (demo_mcp_gateway, OAuthBrokerRouter) sends the browser here after
// its own PingOne hop. This runs the same gateway sign-in /auth/start does, for
// one Agentic App, stores the token in services/privilegeGatewaySession.js, and
// hands the browser back to the broker's /oauth/resume to finish the client's
// flow. It keeps its own session slot and callback, so it never disturbs a
// sign-in the operator has in flight here, or the door they have selected.
// ---------------------------------------------------------------------------
const FACADE_LINK_CALLBACK_PATH = '/api/privilege-mcp/facade-link/callback';
// Same rule as the façade's app segment (routes/mcpFacade.js APP_SEGMENT): the
// name is interpolated into a gateway URL, so it is a NAME, never a path.
const LINK_APP_NAME = /^[A-Za-z0-9._-]{1,64}$/;

// Only the configured broker's own resume endpoint, never a caller-named URL:
// this route is unauthenticated and redirects.
function linkResumeUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  let url;
  let brokerOrigin;
  try {
    url = new URL(value);
    brokerOrigin = new URL(process.env.MCP_FACADE_AGENT_GATEWAY_AS || 'http://localhost:3005').origin;
  } catch {
    return null;
  }
  if (url.origin !== brokerOrigin || url.pathname !== '/oauth/resume' || !url.searchParams.get('rs')) return null;
  return url.toString();
}

function redirectToResume(res, resume, params) {
  const url = new URL(resume);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  res.redirect(url.toString());
}

router.get('/facade-link', async (req, res) => {
  // No app segment on the door means the default app, exactly as the façade reads it.
  const app = (typeof req.query.app === 'string' && req.query.app) || privilegeGatewaySession.defaultApp();
  const resume = linkResumeUrl(req.query.resume);
  if (!LINK_APP_NAME.test(app) || !resume) {
    return res.status(400).json({ error: 'facade-link needs a plain app name and the broker\'s /oauth/resume URL.' });
  }
  // A throwaway session: beginOAuthFlow reads config and writes pendingAuth,
  // and this flow must touch neither on the operator's real one. `_sid: null`
  // keeps emitEvent from broadcasting to a page that did not start it.
  const linkSession = {
    _sid: null,
    config: {
      mcpUrl: `${new URL(DEFAULT_PRIVILEGE_MCP_URL()).origin}/${app}/mcp`,
      clientId: '',
      scopes: 'openid profile email',
    },
    gatewayMode: 'privilege',
  };
  try {
    const authUrl = await beginOAuthFlow(linkSession, req, { callbackPath: FACADE_LINK_CALLBACK_PATH });
    // No prompt=none: the person at the browser is signing in right now, and a
    // login_required dead end would only surface as an error in their MCP client.
    authUrl.searchParams.delete('prompt');
    req.session.privilegeFacadeLink = { ...linkSession.pendingAuth, app, resume };
    return res.redirect(authUrl.toString());
  } catch (err) {
    return redirectToResume(res, resume, { link: 'error', reason: String(err.message).slice(0, 300) });
  }
});

router.get('/facade-link/callback', async (req, res) => {
  const link = req.session?.privilegeFacadeLink;
  if (!link?.resume) {
    return res.status(400).json({ error: 'No Privilege gateway link sign-in is in progress in this browser.' });
  }
  // Single use, whatever happens next.
  req.session.privilegeFacadeLink = null;
  const fail = (reason) => redirectToResume(res, link.resume, {
    link: 'error',
    reason: String(reason || 'Privilege gateway sign-in failed').slice(0, 300),
  });

  const { code, state, iss, error, error_description: errorDescription } = req.query;
  if (error) return fail(errorDescription ? `${error}: ${errorDescription}` : error);
  if (!code || state !== link.oauthState) return fail('OAuth state mismatch.');
  if (iss && link.issuer && iss !== link.issuer) return fail('OAuth issuer mismatch.');
  try {
    const tokenData = await exchangeAuthorizationCode(link, code, '');
    if (!tokenData.access_token) return fail('The gateway returned no access token.');
    privilegeGatewaySession.remember({
      app: link.app,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      expiresIn: tokenData.expires_in,
      tokenUri: link.tokenUri,
      clientId: link.dcrClientId,
      clientSecret: link.dcrClientSecret,
    });
    return redirectToResume(res, link.resume, { link: 'ok' });
  } catch (err) {
    return fail(err.message);
  }
});
```

- [ ] **Step 9: Run the BFF route suites**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/routes/privilegeMcpClient.facadeLink.test.js tests/routes/privilegeMcpClient.gatewaySessionRemember.test.js tests/routes/privilegeMcpClient.gatewaySessionState.test.js tests/routes/privilegeMcpClient.dcrReregister.test.js tests/routes/privilegeMcpClient.authStartNoClientId.test.js tests/routes/privilegeMcpClient.brokerClientScope.test.js tests/routes/privilegeMcpClient.config.test.js --forceExit > /tmp/t3.txt 2>&1; echo "exit=$?"; grep -E "Tests:|Suites:" /tmp/t3.txt`
Expected: `exit=0`, all pass (11 tests in the new link suite).

- [ ] **Step 10: Commit**

```bash
git branch --show-current
git add demo_api_server/routes/privilegeMcpClient.js demo_api_server/tests/routes/privilegeMcpClient.facadeLink.test.js demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionRemember.test.js demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionState.test.js
git commit -m "feat(privilege-mcp): /facade-link chains the Privilege gateway sign-in into an MCP client's OAuth" -m "Own session slot and callback, resume URL pinned to the broker's /oauth/resume, DCR client per redirect URI, per-app state on /state." -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Broker — keep resource, link redirect, /oauth/resume

**Files:**
- Modify: `demo_mcp_gateway/src/oauth/BrokerTokenStore.ts`
- Modify: `demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts`
- Test: `demo_mcp_gateway/tests/oauth-broker-token-store.test.ts`, `demo_mcp_gateway/tests/oauth-broker-router-authorize.test.ts`

**Interfaces:**
- Consumes: the Task 3 contract — `GET <BFF_PRIVILEGE_LINK_URL>?app=<name>&resume=<issuer>/oauth/resume?rs=<id>`; the BFF returns to `resume` with `link=ok` or `link=error&reason=…`.
- Produces: `PendingAuthorization.resource?: string`; `createResume(params, ttlMsOverride?): string`; `consumeResume(id): ResumableAuthorization | null`; `privilegeLinkApp(resource?): string | null` (exported); route `GET /oauth/resume`.

- [ ] **Step 1: Write the failing store tests**

Append inside the `describe('BrokerTokenStore', …)` in `demo_mcp_gateway/tests/oauth-broker-token-store.test.ts`:

```ts
  const RESUME_PARAMS = {
    clientId: 'client-1', redirectUri: 'http://127.0.0.1:1234/callback',
    scope: 'mcp:invoke', codeChallenge: 'abc', codeChallengeMethod: 'S256',
    clientState: 's', pingOneAccessToken: 't', pingOneExpiresIn: 3600,
  };

  it('round-trips a resumable authorization, once', () => {
    const store = new BrokerTokenStore();
    const id = store.createResume(RESUME_PARAMS);
    expect(store.consumeResume(id)?.pingOneAccessToken).toBe('t');
    expect(store.consumeResume(id)).toBeNull();
  });

  it('an expired resumable authorization is not returned', () => {
    const store = new BrokerTokenStore();
    const id = store.createResume(RESUME_PARAMS, -1);
    expect(store.consumeResume(id)).toBeNull();
  });
```

- [ ] **Step 2: Write the failing router tests**

Append to `demo_mcp_gateway/tests/oauth-broker-router-authorize.test.ts`:

```ts
describe('OAuthBrokerRouter — Privilege gateway link', () => {
  const LINK_URL = 'https://local.ping-devops.com:4000/api/privilege-mcp/facade-link';
  const REDIRECT = 'http://127.0.0.1:33389/mcp-oauth-callback';
  const DOOR = 'http://localhost:3002/mcp-facade/privilege-gateway/opensearch/mcp';

  afterEach(() => { delete process.env.BFF_PRIVILEGE_LINK_URL; });

  function pendingFor(tokenStore: BrokerTokenStore, clientId: string, resource?: string) {
    return tokenStore.createPendingAuthorization({
      clientId, redirectUri: REDIRECT, scope: 'mcp:invoke',
      codeChallenge: 'external-challenge', codeChallengeMethod: 'S256',
      clientState: 'external-state', pingOneCodeVerifier: 'v', resource,
    });
  }

  function parked(tokenStore: BrokerTokenStore) {
    return tokenStore.createResume({
      clientId: 'c1', redirectUri: REDIRECT, scope: 'mcp:invoke',
      codeChallenge: 'external-challenge', codeChallengeMethod: 'S256',
      clientState: 'external-state', pingOneAccessToken: 'REAL-PINGONE-TOKEN', pingOneExpiresIn: 3600,
    });
  }

  async function callbackFor(resource?: string) {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({ client_name: 'LM Studio', redirect_uris: [REDIRECT] });
    const relayState = pendingFor(tokenStore, client.client_id, resource);
    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'REAL-PINGONE-TOKEN', expires_in: 3600 } });
    const res = await supertest(server).get('/oauth/callback').query({ code: 'pingone-code', state: relayState });
    return { res, tokenStore };
  }

  it('keeps the resource the client asked for on the pending authorization', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({ client_name: 'LM Studio', redirect_uris: [REDIRECT] });
    const res = await supertest(server).get('/oauth/authorize').query({
      client_id: client.client_id, redirect_uri: REDIRECT, response_type: 'code',
      code_challenge: 'c', code_challenge_method: 'S256', state: 's', resource: DOOR,
    });
    const relayState = new URL(res.headers.location).searchParams.get('state')!;
    expect(tokenStore.consumePendingAuthorization(relayState)?.resource).toBe(DOOR);
  });

  it('parks the authorization and sends the browser to the BFF link for a Privilege door', async () => {
    process.env.BFF_PRIVILEGE_LINK_URL = LINK_URL;
    const { res } = await callbackFor(DOOR);

    expect(res.status).toBe(302);
    const link = new URL(res.headers.location);
    expect(link.origin + link.pathname).toBe(LINK_URL);
    expect(link.searchParams.get('app')).toBe('opensearch');
    const resume = new URL(link.searchParams.get('resume')!);
    expect(resume.pathname).toBe('/oauth/resume');
    expect(resume.searchParams.get('rs')).toBeTruthy();
  });

  it('omits app for the bare door, so the BFF uses its default app', async () => {
    process.env.BFF_PRIVILEGE_LINK_URL = LINK_URL;
    const { res } = await callbackFor('http://localhost:3002/mcp-facade/privilege-gateway/mcp');
    const link = new URL(res.headers.location);
    expect(link.origin + link.pathname).toBe(LINK_URL);
    expect(link.searchParams.has('app')).toBe(false);
  });

  it('returns to the client as before when the link URL is not configured', async () => {
    const { res } = await callbackFor(DOOR);
    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('code')).toBeTruthy();
  });

  it('returns to the client as before for any other door', async () => {
    process.env.BFF_PRIVILEGE_LINK_URL = LINK_URL;
    const { res } = await callbackFor('http://localhost:3002/mcp-facade/opensearch/mcp');
    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('code')).toBeTruthy();
  });

  it('link=ok issues the broker code carrying the PingOne token and the client state', async () => {
    const { tokenStore, server } = makeRouterAndServer();
    const rs = parked(tokenStore);

    const res = await supertest(server).get('/oauth/resume').query({ rs, link: 'ok' });

    expect(res.status).toBe(302);
    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('external-state');
    const issued = tokenStore.consumeCode(back.searchParams.get('code')!);
    expect(issued?.pingOneAccessToken).toBe('REAL-PINGONE-TOKEN');
    expect(issued?.codeChallenge).toBe('external-challenge');
  });

  it('link=error tells the client access_denied instead of issuing a code', async () => {
    const { tokenStore, server } = makeRouterAndServer();
    const rs = parked(tokenStore);

    const res = await supertest(server).get('/oauth/resume').query({ rs, link: 'error', reason: 'OAuth state mismatch.' });

    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('error_description')).toContain('OAuth state mismatch.');
    expect(back.searchParams.get('code')).toBeNull();
    expect(back.searchParams.get('state')).toBe('external-state');
  });

  it('an unknown or already-used resume id is invalid_grant', async () => {
    const { tokenStore, server } = makeRouterAndServer();
    const rs = parked(tokenStore);
    await supertest(server).get('/oauth/resume').query({ rs, link: 'ok' }).expect(302);

    const again = await supertest(server).get('/oauth/resume').query({ rs, link: 'ok' });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_grant');

    const unknown = await supertest(server).get('/oauth/resume').query({ rs: 'never-issued', link: 'ok' });
    expect(unknown.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd demo_mcp_gateway && ./node_modules/.bin/jest tests/oauth-broker-token-store.test.ts tests/oauth-broker-router-authorize.test.ts --forceExit > /tmp/t4.txt 2>&1; echo "exit=$?"; grep -E "error TS|✕|Tests:" /tmp/t4.txt | head -20`
Expected: `exit=1`; ts-jest type errors (`Property 'createResume' does not exist`, `'resource' does not exist in type`).

- [ ] **Step 4: Extend the token store**

In `demo_mcp_gateway/src/oauth/BrokerTokenStore.ts`, add to `PendingAuthorization` (after `correlationId?: string;`):

```ts
  /** RFC 8707 `resource` the client asked for. Names the façade door, which is
   *  how the callback knows to chain the Privilege gateway sign-in. */
  resource?: string;
```

Add after the `IssuedCode` interface:

```ts
/** An authorization parked mid-flight while the BFF signs the browser in to
 *  the Privilege AI Gateway — everything /oauth/resume needs to issue the
 *  broker's own code once the browser comes back. */
export interface ResumableAuthorization {
  id: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  clientState: string;
  pingOneAccessToken: string;
  pingOneExpiresIn: number;
  correlationId?: string;
  expiresAt: number;
}
```

In the class, add a field after `private codes …`:

```ts
  private resumable: Map<string, ResumableAuthorization> = new Map();
```

and these methods after `consumeCode`:

```ts
  createResume(params: Omit<ResumableAuthorization, 'id' | 'expiresAt'>, ttlMsOverride?: number): string {
    const id = crypto.randomBytes(32).toString('base64url');
    this.resumable.set(id, { ...params, id, expiresAt: Date.now() + (ttlMsOverride ?? PENDING_TTL_MS) });
    return id;
  }

  consumeResume(id: string): ResumableAuthorization | null {
    const entry = this.resumable.get(id);
    if (!entry) return null;
    this.resumable.delete(id);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }
```

- [ ] **Step 5: Extend the router**

In `demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts`:

Add after the `readIdentityClaims` function:

```ts
/** Façade Privilege door paths: /mcp-facade/privilege-gateway[/<app>]/mcp. */
const PRIVILEGE_DOOR_PATH = /^\/mcp-facade\/privilege-gateway(?:\/([A-Za-z0-9._-]{1,64}))?\/mcp$/;

/**
 * The Agentic App a client's `resource` names when it is the façade's Privilege
 * door: the app segment, '' for the bare door (the BFF then uses its default
 * app), or null for any other resource.
 */
export function privilegeLinkApp(resource?: string): string | null {
  if (!resource) return null;
  let path: string;
  try { path = new URL(resource).pathname; } catch { return null; }
  const match = PRIVILEGE_DOOR_PATH.exec(path);
  return match ? (match[1] || '') : null;
}
```

In `handle()`, add a case after `'/oauth/callback'`:

```ts
      case '/oauth/resume':
        return this.handleResume(res, url);
```

In `handleAuthorize`, after `const scope = url.searchParams.get('scope') || 'mcp:invoke';` add:

```ts
    const resource = url.searchParams.get('resource') || undefined;
```

and change the `createPendingAuthorization` call to:

```ts
    const relayState = this.tokenStore.createPendingAuthorization({
      clientId, redirectUri, scope, codeChallenge, codeChallengeMethod,
      clientState, pingOneCodeVerifier, correlationId, resource,
    });
```

In `handleCallback`, insert immediately before `const ownCode = this.tokenStore.createCode({`:

```ts
    // The façade's Privilege door needs a second leg the client cannot see: a
    // sign-in to the Privilege AI Gateway, held server-side by the BFF. Park
    // this authorization, let the BFF do that sign-in while the browser is
    // here, and finish at /oauth/resume. See
    // docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md.
    const linkApp = privilegeLinkApp(pending.resource);
    const linkUrl = process.env.BFF_PRIVILEGE_LINK_URL;
    if (linkApp !== null && linkUrl) {
      const resumeId = this.tokenStore.createResume({
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        scope: pending.scope,
        codeChallenge: pending.codeChallenge,
        codeChallengeMethod: pending.codeChallengeMethod,
        clientState: pending.clientState,
        pingOneAccessToken,
        pingOneExpiresIn: expiresIn,
        correlationId: pending.correlationId,
      });
      const link = new URL(linkUrl);
      if (linkApp) link.searchParams.set('app', linkApp);
      link.searchParams.set('resume', `${this.issuer(req)}/oauth/resume?rs=${encodeURIComponent(resumeId)}`);
      res.writeHead(302, { Location: link.toString() });
      res.end();
      return true;
    }

```

Add this method after `handleCallback`:

```ts
  // --- Back from the BFF's Privilege gateway sign-in (see handleCallback) ---
  private handleResume(res: ServerResponse, url: URL): boolean {
    const resumeId = url.searchParams.get('rs');
    const parked = resumeId ? this.tokenStore.consumeResume(resumeId) : null;
    if (!parked) {
      this.json(res, 400, { error: 'invalid_grant', error_description: 'Unknown or expired authorization request' });
      return true;
    }
    // redirectUri was checked against the client's registration at /oauth/authorize.
    const callback = new URL(parked.redirectUri);
    if (url.searchParams.get('link') === 'ok') {
      callback.searchParams.set('code', this.tokenStore.createCode({
        clientId: parked.clientId,
        redirectUri: parked.redirectUri,
        scope: parked.scope,
        codeChallenge: parked.codeChallenge,
        codeChallengeMethod: parked.codeChallengeMethod,
        pingOneAccessToken: parked.pingOneAccessToken,
        pingOneExpiresIn: parked.pingOneExpiresIn,
      }));
    } else {
      // Tell the client, instead of handing it a token for a door that would
      // only 401 again — that loops it through sign-in after sign-in.
      const reason = (url.searchParams.get('reason') || 'no reason given').slice(0, 300);
      callback.searchParams.set('error', 'access_denied');
      callback.searchParams.set('error_description', `Privilege gateway sign-in failed: ${reason}`);
    }
    if (parked.clientState) callback.searchParams.set('state', parked.clientState);
    res.writeHead(302, { Location: callback.toString() });
    res.end();
    return true;
  }
```

- [ ] **Step 6: Build and run the broker suites**

Run: `cd demo_mcp_gateway && npm run build > /tmp/t4.txt 2>&1 && ./node_modules/.bin/jest tests/oauth-broker-token-store.test.ts tests/oauth-broker-router-authorize.test.ts tests/oauth-broker-router-token.test.ts tests/oauth-broker-router-metadata.test.ts tests/gateway-oauth-broker-wiring.test.ts --forceExit >> /tmp/t4.txt 2>&1; echo "exit=$?"; grep -E "error TS|Tests:|Suites:" /tmp/t4.txt`
Expected: `exit=0`, no `error TS`, all suites pass.

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git add demo_mcp_gateway/src/oauth/BrokerTokenStore.ts demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts demo_mcp_gateway/tests/oauth-broker-token-store.test.ts demo_mcp_gateway/tests/oauth-broker-router-authorize.test.ts
git commit -m "feat(oauth-broker): chain the BFF's Privilege gateway sign-in for façade Privilege doors" -m "Keeps the client's resource; for /mcp-facade/privilege-gateway[/<app>]/mcp with BFF_PRIVILEGE_LINK_URL set, parks the authorization, redirects to the BFF link, and finishes at /oauth/resume." -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Switch it on, and document it

**Files:**
- Modify: `docker-compose.yml` (demo-api-server env near `MCP_FACADE_AGENT_GATEWAY_AS_INTERNAL`, ~276; mcp-gateway env near `BFF_BROKER_PROMPT_URL`, ~1103)
- Modify: `lmstudio/README.md` (lines ~14, ~15, ~93)
- Modify: `REGRESSION_PLAN.md` (§4 Bug Fix Log, new entry at the top)
- Modify: `TECH_DEBT.md` (new entry at the top)

- [ ] **Step 1: docker-compose.yml**

After the line `      MCP_FACADE_AGENT_GATEWAY_AS_INTERNAL: "http://mcp-gateway:3005"` add:

```yaml
      # With mcp-gateway's BFF_PRIVILEGE_LINK_URL set, a missing Privilege AI
      # Gateway session on the façade's privilege-gateway door answers 401, so
      # MCP clients re-authenticate and the broker-chained sign-in restores it.
      # Unset = the old 503 + "sign in at /privilege-mcp-client" remedy.
      MCP_FACADE_PRIVILEGE_LINK: "true"
```

After the line `      BFF_BROKER_PROMPT_URL: "https://demo-api-server:3001/mcp-facade/broker-prompt"` add:

```yaml
      # Privilege-door gateway link: after its own PingOne hop, the broker sends
      # the browser here so the BFF signs it in to the Privilege AI Gateway for
      # the requested app, then back to /oauth/resume. Browser-facing on purpose
      # (it is a redirect, and the BFF session cookie lives on this host).
      # Unset = no chaining. See
      # docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md.
      BFF_PRIVILEGE_LINK_URL: "https://local.ping-devops.com:4000/api/privilege-mcp/facade-link"
```

Run: `docker compose config --quiet > /tmp/t5.txt 2>&1; echo "exit=$?"; head -5 /tmp/t5.txt`
Expected: `exit=0` (compose still parses; missing `.env` warnings are fine in a worktree).

- [ ] **Step 2: lmstudio/README.md**

In the `MCP Privilege-OpenSearch` row, replace the last cell `the façade holds the gateway leg — sign in once at \`/privilege-mcp-client\` after a gateway restart` with:

```text
the façade holds the gateway leg, and LM Studio's own **Authenticate** signs it in (a browser tab passes through). Expect it about hourly: the gateway issues no refresh token
```

In the `MCP Direct-OpenSearch` row, replace `(\`cm-mcpgw\` in K8s)` with `(\`opensearch-mcp-server\` in K8s)`.

Replace the port-forward line:

```bash
kubectl --context us -n ping-devops-curtismuir port-forward svc/cm-mcpgw-opensearch-mcp-server 9900:80
```

with:

```bash
kubectl --context us -n ping-devops-curtismuir port-forward svc/opensearch-mcp-server 9900:80
```

- [ ] **Step 3: REGRESSION_PLAN.md**

Insert directly under `## §4 — Bug Fix Log` (and its blank line):

```markdown
### 2026-09-11 — LM Studio's Privilege entries needed a visit to /privilege-mcp-client, and said "SSE error: Non-200 status code (405)"

**Files changed:** `demo_api_server/services/privilegeGatewaySession.js`,
new `demo_api_server/services/lmdb/privilegeGatewaySessionStore.lmdb.js`,
`demo_api_server/routes/mcpFacade.js`, `demo_api_server/routes/privilegeMcpClient.js`,
`demo_mcp_gateway/src/oauth/BrokerTokenStore.ts`,
`demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts`, `docker-compose.yml`, and tests.

**What was broken:** the façade's `privilege-gateway/<app>` door only worked
after a human signed in at `/privilege-mcp-client` (Privilege mode). The session
was in memory — lost on every BFF container recreate — and gateway tokens live
60 minutes with no refresh token. Without it the door answered 503; LM Studio
0.4.23 treats any non-auth error as "try SSE", hit the façade's deliberate 405
on GET, and showed only "Authentication failed — SSE error: Non-200 status
code (405)".

**Fixed by** chaining the gateway sign-in into the MCP client's own OAuth: the
broker keeps `resource`, and for a Privilege door (with `BFF_PRIVILEGE_LINK_URL`)
parks the authorization and sends the browser to `/api/privilege-mcp/facade-link`,
which runs the existing gateway sign-in for that app and returns to the broker's
`/oauth/resume`. Sessions are per app and persisted in LMDB. With
`MCP_FACADE_PRIVILEGE_LINK=true` a missing session answers 401 so clients
re-authenticate.

**Do not break:** `/privilege-mcp-client`'s own sign-in, `pendingAuth` and
selected door (the link uses its own session slot and callback); the broker for
every non-Privilege door; `/state`'s `gatewaySession` shape (per-app status is
the sibling `gatewaySessionsByApp`); the 503 when the flag is off; `/facade-link`
redirects only to the configured broker's `/oauth/resume`.

**Verify:** `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/services/privilegeGatewaySession.test.js tests/services/privilegeGatewaySessionStore.test.js tests/routes/mcpFacade.privilegeGatewayDoor.test.js tests/routes/privilegeMcpClient.facadeLink.test.js tests/routes/privilegeMcpClient.gatewaySessionRemember.test.js tests/routes/privilegeMcpClient.gatewaySessionState.test.js tests/routes/privilegeMcpClient.dcrReregister.test.js --forceExit`;
`cd demo_mcp_gateway && npm run build && ./node_modules/.bin/jest tests/oauth-broker-token-store.test.ts tests/oauth-broker-router-authorize.test.ts --forceExit`.
Results: RESULTS_FROM_TASK_6.
```

(Task 6 replaces `RESULTS_FROM_TASK_6` with the real counts and revert-to-RED evidence.)

- [ ] **Step 4: TECH_DEBT.md**

Insert directly above the first `### ` entry:

```markdown
### [ ] 2026-09-11 — The Privilege gateway link is wired for the local Docker stack only

**What's wrong.** The MCP-client-driven Privilege gateway sign-in
(`/api/privilege-mcp/facade-link`, broker `/oauth/resume`) is switched on by two
env vars set only in `docker-compose.yml`: `BFF_PRIVILEGE_LINK_URL` (mcp-gateway)
and `MCP_FACADE_PRIVILEGE_LINK` (demo-api-server). The SE k8s deployment sets
neither, so its privilege-gateway door keeps the old 503 + "sign in at
/privilege-mcp-client" behaviour.

**Why it wasn't fixed now.** Scoped to the local stack LM Studio uses; the SE
façade is reached on a different host and its broker/BFF public URLs differ,
so the link URL and the resume-origin check (`MCP_FACADE_AGENT_GATEWAY_AS`)
need SE values and an SE test.

**Real fix.** Set both vars in the SE Helm values with the SE BFF's public
`/api/privilege-mcp/facade-link` URL, set `MCP_FACADE_AGENT_GATEWAY_AS` to the SE
broker's public origin, and drive one SE sign-in end to end.
```

- [ ] **Step 5: Check copy for emoji and commit**

Run (macOS grep has no `-P`, so scan with Python): `git diff -- lmstudio/README.md REGRESSION_PLAN.md TECH_DEBT.md docker-compose.yml > /tmp/t5-diff.txt; python3 -c "import unicodedata; t=[l for l in open('/tmp/t5-diff.txt',encoding='utf-8') if l.startswith('+')]; bad={c for l in t for c in l if ord(c)>0x2000 and unicodedata.category(c)=='So'}; print(sorted(bad) or 'no emoji added')"`
Expected: `no emoji added`.

```bash
git branch --show-current
git add docker-compose.yml lmstudio/README.md REGRESSION_PLAN.md TECH_DEBT.md
git commit -m "chore(privilege): switch on the gateway link locally; document it" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Prove it, then open the PR

**Files:** `REGRESSION_PLAN.md` (fill in results).

- [ ] **Step 1: Full scoped run, both services**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/services/privilegeGatewaySession.test.js tests/services/privilegeGatewaySessionStore.test.js tests/routes/mcpFacade.privilegeGatewayDoor.test.js tests/routes/mcpFacade.privilegeEntryPath.test.js tests/routes/mcpFacade.multiApp.test.js tests/routes/privilegeMcpClient.facadeLink.test.js tests/routes/privilegeMcpClient.gatewaySessionRemember.test.js tests/routes/privilegeMcpClient.gatewaySessionState.test.js tests/routes/privilegeMcpClient.dcrReregister.test.js tests/routes/privilegeMcpClient.authStartNoClientId.test.js tests/routes/privilegeMcpClient.config.test.js tests/checks/privilegeMcpFirstCheck.test.js --forceExit > /tmp/t6-bff.txt 2>&1; echo "exit=$?"; grep -E "Tests:|Suites:" /tmp/t6-bff.txt`
Expected: `exit=0`.

Run: `cd demo_mcp_gateway && npm run build > /tmp/t6-gw.txt 2>&1 && ./node_modules/.bin/jest tests/oauth-broker-token-store.test.ts tests/oauth-broker-router-authorize.test.ts tests/oauth-broker-router-token.test.ts tests/oauth-broker-router-metadata.test.ts tests/gateway-oauth-broker-wiring.test.ts tests/oauth-client-registry.test.ts --forceExit >> /tmp/t6-gw.txt 2>&1; echo "exit=$?"; grep -E "error TS|Tests:|Suites:" /tmp/t6-gw.txt`
Expected: `exit=0`.

- [ ] **Step 2: Revert-to-RED, one guard at a time**

For each row: make the revert, run the named suite, confirm ONLY the named test goes red, then `git checkout -- <file>` and re-run green.

| Revert | Suite | Must go red |
|---|---|---|
| In `getOrRegisterDcrClient`, `const cacheKey = registerUrl;` | `privilegeMcpClient.facadeLink.test.js` | `registers its own gateway client for the link callback` |
| In `mcpFacade.js`, delete the `if (process.env.MCP_FACADE_PRIVILEGE_LINK === 'true') { … }` block | `mcpFacade.privilegeGatewayDoor.test.js` | `with the gateway link on, a missing session answers a 401 challenge…` |
| In `privilegeGatewaySession.js`, `function keyFor() { return defaultApp(); }` | `privilegeGatewaySession.test.js` | `keeps a separate session per app` (and the per-app door test) |
| In `linkResumeUrl`, drop the `url.origin !== brokerOrigin \|\|` clause | `privilegeMcpClient.facadeLink.test.js` | `refuses a resume URL that is not the broker's own /oauth/resume` |
| In `OAuthBrokerRouter.handleCallback`, change `if (linkApp !== null && linkUrl)` to `if (false)` | `oauth-broker-router-authorize.test.ts` | `parks the authorization and sends the browser to the BFF link…` and `omits app for the bare door…` |

After the table, confirm the tree is clean except for your intended changes: `git status --short`.

- [ ] **Step 3: Record the results and push**

Replace `RESULTS_FROM_TASK_6` in `REGRESSION_PLAN.md` with the BFF and broker `Tests:` lines from Step 1 and one line naming the five revert-to-RED checks and that each went red alone.

```bash
git branch --show-current
git add REGRESSION_PLAN.md
git commit -m "docs(regression-plan): verify results for the Privilege gateway link" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --head worktree-lmstudio-privilege-link \
  --title "feat(privilege): LM Studio's own sign-in establishes the façade's Privilege gateway leg" \
  --body-file /tmp/pr-body.md
```

Write `/tmp/pr-body.md` first with: the problem (the REGRESSION_PLAN "What was broken" paragraph), the flow (the spec's six steps), the two env switches, test evidence from Step 1 and Step 2, what does not change, and the post-merge live check below. End it with:

```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then `gh pr checks <number> --watch` once (not repeated polling). Stop here and report to the user; merging is their call.

- [ ] **Step 5: After the user merges — deploy and verify live**

1. `scripts/sync-main-checkout.sh`, then grep the merged code in the main checkout: `grep -c "facade-link" /Users/cmuir/Development/AI-DEMO2/demo_api_server/routes/privilegeMcpClient.js` (expect ≥ 1).
2. Check `npm run serve:worktree` shows main is served; then `scripts/deploy-live.sh > /tmp/deploy.txt 2>&1; echo "exit=$?"` (rebuilds mcp-gateway, restarts the BFF; can take 20+ minutes).
3. Confirm env and code by content: `docker exec ai-demo-api-server printenv MCP_FACADE_PRIVILEGE_LINK` → `true`; `docker exec ai-demo-mcp-gateway printenv BFF_PRIVILEGE_LINK_URL` → the link URL; and prove the rebuilt broker has the new route by behaviour, not by a file path: `curl -s http://localhost:3005/oauth/resume?rs=probe` → `{"error":"invalid_grant",…}` (the old image does not route `/oauth/resume` at all).
4. `gen="$(npm run -s stack:generation)"`, then ask the user to click **Authenticate** on `MCP Privilege-OpenSearch22` in LM Studio. Expect: a browser tab passes through, tools list; `curl -sk https://localhost:3001/api/privilege-mcp/state` shows `gatewaySessionsByApp.opensearch22.ready: true`; the gateway log shows `has policy based capabilities` for `opensearch22`. Then `npm run -s stack:generation -- --check "$gen"` — non-zero voids the run.
5. `docker compose up -d --force-recreate demo-api-server` (from the main checkout, only if nobody else holds the stack), wait for healthy, and confirm `gatewaySessionsByApp.opensearch22.ready` is still `true` and LM Studio still lists tools without a new sign-in.
6. Repeat step 4 for `MCP Privilege-OpenSearch-Blocked` and confirm a separate `gatewaySessionsByApp.opensearch` entry.
7. Run `graphify update .` in the main checkout.
