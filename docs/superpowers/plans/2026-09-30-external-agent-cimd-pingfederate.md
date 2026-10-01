# External Agent CIMD (PingFederate lane + mock PingOne lane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in customer registers an external AI agent in Agent Builder through either the mock PingOne CIMD facade or real PingFederate CIMD, with RFC 9728 discovery as the first step, and the CIMD guide panel shows both engines side by side.

**Architecture:** A stand-in external agent publishes its own Client ID Metadata Document at an engine-specific URL. The mock lane reuses `oauthClientRegistry.registerClientByUrl`; the PingFederate lane reuses `pfAiAgentCimdService` begin/complete, parameterised (not forked) by an `agent` option. Registrations land in a new LMDB store and appear in the agent inventory with an `engine` field. A second RFC 9728 document names PingFederate as the authorization server for the resource this agent calls.

**Tech Stack:** Node 22 CommonJS + Express + jest/supertest (BFF, `demo_api_server/`); React 19 + vitest (UI, `demo_api_ui/`); LMDB; PingFederate 13.1 CIMD.

**Spec:** `docs/superpowers/specs/2026-09-30-external-agent-cimd-pingfederate-design.md`

**Spec refinement found while planning:** `oauthClientRegistry.registerClientByUrl` only accepts confidential clients with grants the mock AS can issue (the personal-agent doc uses `client_credentials` + `client_secret_basic`), while PingFederate needs a public `authorization_code` client. One document cannot satisfy both, so each lane gets its own document at `/api/external-agents/:slug/:engine/client-metadata.json` (`engine` = `mock` | `pingfederate`). Same agent, same slug, two documents. Intent of the spec is unchanged.

## Global Constraints

- BFF is CommonJS with `'use strict'`; error responses are `{ error }` (extra flags alongside, never instead).
- Never leak upstream detail: PF/discovery failures return an OAuth-style code only.
- New specs go in `demo_api_server/tests/` (jest) and `demo_api_ui/src/**/__tests__/` (vitest, `vi.mock`, `globals: true`).
- Scoped test runs only: `cd demo_api_server && CI=true ./node_modules/.bin/jest <paths> --forceExit --maxWorkers=2`; UI: `cd demo_api_ui && ./node_modules/.bin/vitest run <file>`. Worktree needs `bash scripts/bootstrap-worktree.sh` first (once). Never pass `--testPathIgnorePatterns`.
- UI: emoji allowlist only (`✅ ❌ ⚠ ✓ ✕` etc. per `REGRESSION_PLAN.md` §0); no inline `color`/`background`/`font-size`; use `--th-*` tokens and the `--font-size-*` scale; dark theme only via `:root[data-theme="dark"]`; HTTP through `bffAxios` (sibling `agentBuilderService.js` pattern); toasts via `utils/appToast` only.
- Protected areas untouched: login, session, token exchange (`routes/oauth*.js`, `middleware/auth.js`, `middleware/tokenRefresh.js`). New routes call the existing `requireSession`.
- Engine badge is always shown and always true. PF lane not configured means disabled with a reason, never a silent fallback to the mock.
- Live PF lane needs PingFederate 13.1 with CIMD enabled and a matching CIMD policy; without it only the disabled state and unit tests can be verified.
- Commit per task; stage explicit paths (`git add <files>`, never `-A`); verify `git branch --show-current` first.

## Review Focus

1. PF not configured or `pf_ai_cimd_enabled` off: register attempt returns 503 `{ error: 'pf_ai_cimd_not_configured' }`, no redirect, no record (Task 2).
2. Callback with wrong, missing or expired `state`, or PF returning `error=access_denied` (customer refuses consent): redirect to `?external_agent=error`, no registration record written (Task 2).
3. Unknown slug or engine in the metadata URL: 404 `{ error }`; `client_id` inside every served document equals the URL it was fetched from (Task 1).
4. PF AS metadata without `client_id_metadata_document_supported`: discovery reports `not_advertised`, never `true` (Task 3).
5. Registering the same agent twice by the same user: one record, one inventory row, status stays `registered` (Task 1 and Task 4).
6. Registration record and every API response carry no access/refresh/ID token and no client secret (Task 2).

## File Structure

Server (`demo_api_server/`):
- Create `services/lmdb/externalAgentCimdStore.lmdb.js` — durable per-user registration records (public-safe fields only).
- Create `services/externalAgentCimdService.js` — agent catalog, metadata documents, fetch evidence log, mock-lane registration, record helpers.
- Modify `services/pfAiAgentCimdService.js` — accept optional `agent` option in `beginCimd`/`completeCimd`.
- Create `services/externalAgentDiscovery.js` — RFC 9728 PRM builder, challenge header, discovery walk.
- Create `routes/externalAgents.js` — all `/api/external-agents/*` routes plus the RFC 9728 well-known route.
- Modify `server.js` — mount the router (two mounts) next to the existing CIMD mounts.
- Modify `services/agentRegistryService.js` — `externalCimd` inventory source.
- Modify `config/useCases.js` — UC43 wording (then regenerate docs).
- Tests: `tests/externalAgentCimdService.test.js`, `tests/externalAgentCimdFlow.test.js`, `tests/externalAgentDiscovery.test.js`, `tests/externalAgentsRoute.test.js`, extend `tests/agentRegistryService.test.js`.

UI (`demo_api_ui/src/`):
- Create `services/externalAgentService.js` — thin `bffAxios` wrappers.
- Create `components/ExternalAgentPanel.jsx` + `.css` — Agent Builder lane picker.
- Modify `components/AgentBuilderPage.jsx` — mount the panel.
- Modify `components/CimdSimPanel.js` + `.css` — PingFederate tab and Simulate engine selector.
- Tests: `components/__tests__/ExternalAgentPanel.test.jsx`, extend `components/__tests__/CimdSimPanel.test.js`.

Skills/docs: `.claude/skills/pingfederate-cimd/SKILL.md` (+ `se-skills-export/` copy and README row).

---

### Task 1: Stand-in external agent — catalog, documents, evidence, mock lane

**Files:**
- Create: `demo_api_server/services/lmdb/externalAgentCimdStore.lmdb.js`
- Create: `demo_api_server/services/externalAgentCimdService.js`
- Test: `demo_api_server/tests/externalAgentCimdService.test.js`

**Interfaces:**
- Produces (used by Tasks 2, 3, 4):
  - `AGENTS: Array<{ slug, clientName, clientUri, mockScope, pfScope }>`
  - `getAgent(slug) -> agent | null`
  - `metadataPath(slug, engine) -> string` (`/api/external-agents/${slug}/${engine}/client-metadata.json`)
  - `CALLBACK_PATH = '/api/external-agents/callback'`
  - `metadataDocument(slug, engine, origin) -> object | null` (`client_id` = `origin + metadataPath`)
  - `recordFetch(slug, engine, userAgent)`, `recentFetches(slug, engine) -> Array<{ at, userAgent }>` (newest first, max 20)
  - `registerMock(user, slug) -> { ok, engine:'mock', record, steps }`
  - `saveRegistration({ user, slug, engine, clientId, metadataUrl, subject?, steps? }) -> record`
  - `listRegistrations() -> record[]`, `getRegistration(user, slug, engine) -> record | null`
  - record shape: `{ userKey, slug, engine, agentName, clientId, metadataUrl, status:'registered', subject: string|null, steps: [], registeredAt }`

- [ ] **Step 1: Write the failing test**

```js
'use strict';

jest.mock('../services/lmdb/externalAgentCimdStore.lmdb', () => {
  const map = new Map();
  return {
    put: (r) => map.set(`${r.userKey}:${r.slug}:${r.engine}`, r),
    get: (u, s, e) => map.get(`${u}:${s}:${e}`) || null,
    loadAll: () => [...map.entries()],
    clearAll: () => map.clear(),
  };
});

const svc = require('../services/externalAgentCimdService');
const store = require('../services/lmdb/externalAgentCimdStore.lmdb');

const user = { oauthId: 'user-1', username: 'alex' };

beforeEach(() => store.clearAll());

describe('externalAgentCimdService', () => {
  test('publishes an engine-specific document whose client_id is its own URL', () => {
    const doc = svc.metadataDocument('acme-travel-agent', 'pingfederate', 'https://bff.example.test');
    expect(doc.client_id).toBe('https://bff.example.test/api/external-agents/acme-travel-agent/pingfederate/client-metadata.json');
    expect(doc.redirect_uris).toEqual(['https://bff.example.test/api/external-agents/callback']);
    expect(doc.grant_types).toEqual(['authorization_code']);
    expect(doc.token_endpoint_auth_method).toBe('none');
    expect(doc).not.toHaveProperty('client_secret');
  });

  test('the mock document is a confidential client the mock registry accepts', () => {
    const doc = svc.metadataDocument('acme-travel-agent', 'mock', 'http://127.0.0.1:3001');
    expect(doc.grant_types).toEqual(['client_credentials']);
    expect(doc.token_endpoint_auth_method).toBe('client_secret_basic');
  });

  test('unknown slug or engine yields no document', () => {
    expect(svc.metadataDocument('nope', 'mock', 'http://x')).toBeNull();
    expect(svc.metadataDocument('acme-travel-agent', 'other', 'http://x')).toBeNull();
  });

  test('records metadata fetches as evidence, newest first, capped', () => {
    for (let i = 0; i < 25; i += 1) svc.recordFetch('acme-travel-agent', 'pingfederate', `ua-${i}`);
    const fetches = svc.recentFetches('acme-travel-agent', 'pingfederate');
    expect(fetches).toHaveLength(20);
    expect(fetches[0].userAgent).toBe('ua-24');
    expect(svc.recentFetches('acme-travel-agent', 'mock')).toEqual([]);
  });

  test('registerMock registers through the mock registry and saves an engine=mock record; twice is one record', async () => {
    const first = await svc.registerMock(user, 'acme-travel-agent');
    expect(first.ok).toBe(true);
    expect(first.record).toMatchObject({ engine: 'mock', slug: 'acme-travel-agent', status: 'registered', subject: null });
    expect(first.record.steps.map((s) => s.step)).toEqual(['fetch', 'validate', 'register']);
    await svc.registerMock(user, 'acme-travel-agent');
    expect(svc.listRegistrations()).toHaveLength(1);
    expect(JSON.stringify(first)).not.toMatch(/client_secret/);
  });

  test('saveRegistration is an upsert keyed by user, slug and engine', () => {
    svc.saveRegistration({ user, slug: 'acme-travel-agent', engine: 'pingfederate', clientId: 'https://c', metadataUrl: 'https://c', subject: 'pf-sub' });
    svc.saveRegistration({ user, slug: 'acme-travel-agent', engine: 'pingfederate', clientId: 'https://c', metadataUrl: 'https://c', subject: 'pf-sub' });
    expect(svc.listRegistrations()).toHaveLength(1);
    expect(svc.getRegistration(user, 'acme-travel-agent', 'pingfederate').subject).toBe('pf-sub');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/externalAgentCimdService.test.js --forceExit --maxWorkers=2`
Expected: FAIL — `Cannot find module '../services/externalAgentCimdService'`.

- [ ] **Step 3: Write minimal implementation**

`services/lmdb/externalAgentCimdStore.lmdb.js`:

```js
'use strict';

/**
 * Durable, public-safe record of external agents a user registered through CIMD
 * (mock PingOne facade or PingFederate). Never holds tokens or client secrets.
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'external_agent_cimd';

function db() {
  return openEnv().openDB(DB_NAME, { encoding: 'json' });
}

function recordKey(userKey, slug, engine) {
  return `${userKey}:${slug}:${engine}`;
}

function put(record) {
  db().putSync(recordKey(record.userKey, record.slug, record.engine), record);
}

function get(userKey, slug, engine) {
  return db().get(recordKey(userKey, slug, engine)) || null;
}

function loadAll() {
  const records = [];
  for (const { key, value } of db().getRange()) records.push([key, value]);
  return records;
}

function clearAll() {
  const store = db();
  for (const key of store.getKeys()) store.removeSync(key);
}

module.exports = { put, get, loadAll, clearAll, recordKey, DB_NAME };
```

`services/externalAgentCimdService.js`:

```js
'use strict';

const oauthClientRegistry = require('./oauthClientRegistry');
const store = require('./lmdb/externalAgentCimdStore.lmdb');

const CALLBACK_PATH = '/api/external-agents/callback';
const ENGINES = ['mock', 'pingfederate'];
const MAX_FETCHES = 20;

const AGENTS = [
  {
    slug: 'acme-travel-agent',
    clientName: 'Acme Travel Agent (external)',
    clientUri: 'https://travel.acme.example',
    mockScope: 'agent:invoke',
    pfScope: 'openid profile email',
  },
];

const fetchLog = new Map();

function getAgent(slug) {
  return AGENTS.find((a) => a.slug === slug) || null;
}

function metadataPath(slug, engine) {
  return `/api/external-agents/${slug}/${engine}/client-metadata.json`;
}

function metadataDocument(slug, engine, origin) {
  const agent = getAgent(slug);
  if (!agent || !ENGINES.includes(engine)) return null;
  const base = String(origin).replace(/\/$/, '');
  const common = {
    client_id: `${base}${metadataPath(slug, engine)}`,
    client_name: agent.clientName,
    client_uri: agent.clientUri,
  };
  if (engine === 'pingfederate') {
    return {
      ...common,
      redirect_uris: [`${base}${CALLBACK_PATH}`],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: agent.pfScope,
      token_endpoint_auth_method: 'none',
    };
  }
  return {
    ...common,
    grant_types: ['client_credentials'],
    scope: agent.mockScope,
    token_endpoint_auth_method: 'client_secret_basic',
  };
}

function recordFetch(slug, engine, userAgent) {
  const key = `${slug}:${engine}`;
  const list = fetchLog.get(key) || [];
  list.unshift({ at: new Date().toISOString(), userAgent: String(userAgent || '').slice(0, 200) });
  fetchLog.set(key, list.slice(0, MAX_FETCHES));
}

function recentFetches(slug, engine) {
  return [...(fetchLog.get(`${slug}:${engine}`) || [])];
}

function userKey(user) {
  return String(user?.oauthId || user?.id || '').trim();
}

function mockOrigin() {
  const origin = process.env.BFF_CIMD_ORIGIN || process.env.PUBLIC_APP_URL;
  if (origin) return origin.replace(/\/$/, '');
  return `${process.env.BFF_LOOPBACK_SCHEME || 'http'}://127.0.0.1:${process.env.PORT || 3001}`;
}

function saveRegistration({ user, slug, engine, clientId, metadataUrl, subject = null, steps = [] }) {
  const key = userKey(user);
  if (!key) throw new Error('External agent registration requires a user subject');
  const record = {
    userKey: key,
    slug,
    engine,
    agentName: getAgent(slug)?.clientName || slug,
    clientId,
    metadataUrl,
    status: 'registered',
    subject,
    steps,
    registeredAt: new Date().toISOString(),
  };
  store.put(record);
  return record;
}

function getRegistration(user, slug, engine) {
  return store.get(userKey(user), slug, engine);
}

function listRegistrations() {
  return store.loadAll().map(([, record]) => record);
}

async function registerMock(user, slug) {
  const doc = metadataDocument(slug, 'mock', mockOrigin());
  if (!doc) return { ok: false, engine: 'mock', error: 'agent_not_found' };
  const result = await oauthClientRegistry.registerClientByUrl(
    doc.client_id,
    { registeredBy: 'external-agent-cimd-facade', sourceIP: 'bff' },
    { fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => ({ ...doc, client_id: url }) }) },
  );
  if (!result.ok) return { ok: false, engine: 'mock', error: 'mock_registration_failed', steps: result.steps || [] };
  const record = saveRegistration({
    user, slug, engine: 'mock', clientId: doc.client_id, metadataUrl: doc.client_id, steps: result.steps || [],
  });
  return { ok: true, engine: 'mock', record, steps: record.steps };
}

module.exports = {
  AGENTS,
  CALLBACK_PATH,
  ENGINES,
  getAgent,
  metadataPath,
  metadataDocument,
  recordFetch,
  recentFetches,
  userKey,
  saveRegistration,
  getRegistration,
  listRegistrations,
  registerMock,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/externalAgentCimdService.test.js --forceExit --maxWorkers=2`
Expected: PASS (6 tests). If `registerMock` fails on validation, read the `validateClientRegistration` error in `first.steps` and adjust only the `mock` document (it must stay a confidential `client_credentials` client with a scope from `personalAgentCimdService.PERSONAL_AGENT_SCOPES`).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/lmdb/externalAgentCimdStore.lmdb.js demo_api_server/services/externalAgentCimdService.js demo_api_server/tests/externalAgentCimdService.test.js
git commit -m "feat(cimd): stand-in external agent catalog, documents, evidence log and mock lane"
```

---

### Task 2: PingFederate lane — parameterise the PF CIMD flow, routes, callback

**Files:**
- Modify: `demo_api_server/services/pfAiAgentCimdService.js` (`beginCimd`, `completeCimd`)
- Create: `demo_api_server/routes/externalAgents.js`
- Modify: `demo_api_server/server.js` (mount next to `app.use('/api/cimd', ...)`, ~line 1944)
- Test: `demo_api_server/tests/externalAgentCimdFlow.test.js`, `demo_api_server/tests/externalAgentsRoute.test.js`

**Interfaces:**
- Consumes (Task 1): `getAgent`, `metadataPath`, `metadataDocument`, `recordFetch`, `saveRegistration`, `registerMock`, `listRegistrations`, `CALLBACK_PATH`, `userKey`.
- Consumes (existing): `resolveCimdConfig(store)`, `getFeatureStatus(store)` from `pfAiAgentFeatureConfig`; `oauthError` from `pfAiAgentOAuthService`.
- Produces (Task 3 extends the same router file): `createExternalAgentsRouter({ configStore, fetchImpl }) -> express.Router`; module export is the default-config router; `module.exports.createExternalAgentsRouter`.
- Produces: `beginCimd(req, { store, fetchImpl, now, agent })` / `completeCimd(...)` where `agent = { pendingKey, tokensKey, scope, clientId: (config) => string, redirectUri: (config) => string }`; omitted means today's behavior exactly.

- [ ] **Step 1: Write the failing tests**

`tests/externalAgentCimdFlow.test.js`:

```js
'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

const { beginCimd, completeCimd } = require('../services/pfAiAgentCimdService');

function makeStore() {
  const values = {
    pf_ai_cimd_enabled: 'true',
    pf_issuer: 'https://pf.example.test',
    pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
    pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
    pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
  };
  return { getEffective: (key) => values[String(key).toLowerCase()] || '' };
}

const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const discovery = {
  issuer: 'https://pf.example.test',
  authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
  token_endpoint: 'https://pf.example.test/as/token.oauth2',
  jwks_uri: 'https://pf.example.test/pf/JWKS',
};

const CLIENT_ID = 'https://local.ping-devops.com:4000/api/external-agents/acme-travel-agent/pingfederate/client-metadata.json';
const agent = {
  pendingKey: 'extCimdPending',
  tokensKey: 'extCimdTokens',
  scope: 'openid profile email',
  clientId: () => CLIENT_ID,
  redirectUri: () => 'https://local.ping-devops.com:4000/api/external-agents/callback',
};

describe('parameterised PF CIMD flow (external agent)', () => {
  test('begin uses the external agent client_id/redirect_uri and its own pending key', async () => {
    const req = { session: {} };
    const { redirectUrl } = await beginCimd(req, {
      store: makeStore(), fetchImpl: jest.fn().mockResolvedValue(json(discovery)), agent,
    });
    const url = new URL(redirectUrl);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(agent.redirectUri());
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(req.session.pfAiAgent.extCimdPending).toBeTruthy();
    expect(req.session.pfAiAgent.cimdPending).toBeUndefined();
  });

  test('complete stores tokens under the external key only and returns identity', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
    const idToken = jwt.sign(
      { sub: 'pf-user', nonce: 'n1', iss: 'https://pf.example.test', aud: CLIENT_ID },
      privateKey, { algorithm: 'RS256', keyid: 'k1', expiresIn: 300 },
    );
    const req = {
      session: { pfAiAgent: { extCimdPending: { state: 's1', nonce: 'n1', verifier: 'v1', createdAt: Date.now(), expiresAt: Date.now() + 300000 } } },
      query: { state: 's1', code: 'code-1' },
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(json(discovery))
      .mockResolvedValueOnce(json({ access_token: 'at', id_token: idToken, token_type: 'Bearer', expires_in: 300 }))
      .mockResolvedValueOnce(json({ keys: [jwk] }));
    const identity = await completeCimd(req, { store: makeStore(), fetchImpl, agent });
    expect(identity.subject).toBe('pf-user');
    expect(req.session.pfAiAgent.extCimdTokens.accessToken).toBe('at');
    expect(req.session.pfAiAgent.cimdTokens).toBeUndefined();
    expect(req.session.pfAiAgent.extCimdPending).toBeUndefined();
  });

  test('complete with a wrong state rejects with PF_AI_CIMD_CALLBACK_INVALID', async () => {
    const req = {
      session: { pfAiAgent: { extCimdPending: { state: 's1', nonce: 'n', verifier: 'v', createdAt: Date.now(), expiresAt: Date.now() + 300000 } } },
      query: { state: 'WRONG', code: 'c' },
    };
    await expect(completeCimd(req, { store: makeStore(), fetchImpl: jest.fn(), agent }))
      .rejects.toMatchObject({ code: 'PF_AI_CIMD_CALLBACK_INVALID' });
  });
});
```

`tests/externalAgentsRoute.test.js`:

```js
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));
jest.mock('../middleware/auth', () => ({
  requireSession: (req, res, next) => (req.session?.user ? next() : res.status(401).json({ error: 'unauthorized' })),
}));
jest.mock('../services/externalAgentCimdService', () => {
  const actual = jest.requireActual('../services/externalAgentCimdService');
  return { ...actual, registerMock: jest.fn(), saveRegistration: jest.fn(), listRegistrations: jest.fn(() => []) };
});
jest.mock('../services/pfAiAgentCimdService', () => ({
  beginCimd: jest.fn(),
  completeCimd: jest.fn(),
}));

const svc = require('../services/externalAgentCimdService');
const pf = require('../services/pfAiAgentCimdService');
const { createExternalAgentsRouter } = require('../routes/externalAgents');

const enabledStore = () => {
  const v = {
    pf_ai_cimd_enabled: 'true',
    pf_issuer: 'https://pf.example.test',
    pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
    pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
  };
  return { getEffective: (k) => v[String(k).toLowerCase()] || '' };
};
const disabledStore = () => ({ getEffective: () => '' });

function makeApp(store, session = { user: { oauthId: 'u1', username: 'alex' } }) {
  const app = express();
  app.use((req, res, next) => { req.session = session; next(); });
  app.use('/api/external-agents', createExternalAgentsRouter({ configStore: store, fetchImpl: jest.fn() }));
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('external agent metadata (public)', () => {
  test('serves the engine document with client_id equal to the requested URL and records the fetch', async () => {
    const app = makeApp(disabledStore(), null);
    const res = await request(app)
      .get('/api/external-agents/acme-travel-agent/pingfederate/client-metadata.json')
      .set('Host', 'bff.example.test').set('X-Forwarded-Proto', 'https').set('User-Agent', 'PingFederate-CIMD');
    expect(res.status).toBe(200);
    expect(res.body.client_id).toBe('https://bff.example.test/api/external-agents/acme-travel-agent/pingfederate/client-metadata.json');
    expect(svc.recentFetches('acme-travel-agent', 'pingfederate')[0].userAgent).toBe('PingFederate-CIMD');
  });

  test('404 for an unknown slug or engine', async () => {
    const app = makeApp(disabledStore(), null);
    expect((await request(app).get('/api/external-agents/nope/mock/client-metadata.json')).status).toBe(404);
    expect((await request(app).get('/api/external-agents/acme-travel-agent/other/client-metadata.json')).status).toBe(404);
  });
});

describe('PingFederate lane', () => {
  test('start is 503 with an error code and no redirect when PF CIMD is not configured', async () => {
    const res = await request(makeApp(disabledStore())).get('/api/external-agents/acme-travel-agent/register/pingfederate');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'pf_ai_cimd_not_configured' });
    expect(pf.beginCimd).not.toHaveBeenCalled();
  });

  test('start redirects to PF with the external-agent parameterisation', async () => {
    pf.beginCimd.mockResolvedValue({ redirectUrl: 'https://pf.example.test/as/authorization.oauth2?x=1' });
    const res = await request(makeApp(enabledStore())).get('/api/external-agents/acme-travel-agent/register/pingfederate');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://pf.example.test/as/authorization.oauth2?x=1');
    const opts = pf.beginCimd.mock.calls[0][1];
    expect(opts.agent.pendingKey).toBe('extCimdPending');
    expect(opts.agent.scope).toBe('openid profile email');
  });

  test('callback success saves a token-free record and redirects to Agent Builder', async () => {
    pf.completeCimd.mockResolvedValue({ subject: 'pf-user' });
    const session = { user: { oauthId: 'u1' }, pfAiAgent: { extCimdPending: { state: 's', slug: 'acme-travel-agent' } } };
    const res = await request(makeApp(enabledStore(), session)).get('/api/external-agents/callback?state=s&code=c');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://local.ping-devops.com:4000/agent-builder?external_agent=success');
    const saved = svc.saveRegistration.mock.calls[0][0];
    expect(saved).toMatchObject({ slug: 'acme-travel-agent', engine: 'pingfederate', subject: 'pf-user' });
    expect(JSON.stringify(saved)).not.toMatch(/token|secret/i);
  });

  test('callback failure (bad state, denied consent) redirects to error and writes nothing', async () => {
    pf.completeCimd.mockRejectedValue(Object.assign(new Error('x'), { code: 'PF_AI_CIMD_CALLBACK_INVALID' }));
    const session = { user: { oauthId: 'u1' }, pfAiAgent: { extCimdPending: { state: 's', slug: 'acme-travel-agent' } } };
    const res = await request(makeApp(enabledStore(), session)).get('/api/external-agents/callback?error=access_denied&state=s');
    expect(res.headers.location).toBe('https://local.ping-devops.com:4000/agent-builder?external_agent=error');
    expect(svc.saveRegistration).not.toHaveBeenCalled();
  });

  test('callback with no pending flow redirects to error', async () => {
    const res = await request(makeApp(enabledStore(), { user: { oauthId: 'u1' } })).get('/api/external-agents/callback?state=s&code=c');
    expect(res.headers.location).toBe('https://local.ping-devops.com:4000/agent-builder?external_agent=error');
    expect(pf.completeCimd).not.toHaveBeenCalled();
  });
});

describe('mock lane and listing', () => {
  test('POST register/mock returns the record without secrets', async () => {
    svc.registerMock.mockResolvedValue({ ok: true, engine: 'mock', record: { slug: 'acme-travel-agent', engine: 'mock', status: 'registered' }, steps: [] });
    const res = await request(makeApp(disabledStore())).post('/api/external-agents/acme-travel-agent/register/mock');
    expect(res.status).toBe(200);
    expect(res.body.record.engine).toBe('mock');
    expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
  });

  test('requires a session for register and listing', async () => {
    const app = makeApp(disabledStore(), {});
    expect((await request(app).post('/api/external-agents/acme-travel-agent/register/mock')).status).toBe(401);
    expect((await request(app).get('/api/external-agents')).status).toBe(401);
  });

  test('GET / lists agents with per-engine availability and the user registrations', async () => {
    svc.listRegistrations.mockReturnValue([
      { userKey: 'u1', slug: 'acme-travel-agent', engine: 'mock', status: 'registered' },
      { userKey: 'other', slug: 'acme-travel-agent', engine: 'mock', status: 'registered' },
    ]);
    const res = await request(makeApp(enabledStore())).get('/api/external-agents');
    expect(res.body.engines).toEqual({ mock: { available: true }, pingfederate: { available: true } });
    expect(res.body.agents[0].slug).toBe('acme-travel-agent');
    expect(res.body.registrations).toHaveLength(1);
  });

  test('GET / reports PF unavailable with a reason when not configured', async () => {
    const res = await request(makeApp(disabledStore())).get('/api/external-agents');
    expect(res.body.engines.pingfederate).toEqual({ available: false, reason: 'PingFederate CIMD is not enabled or configured' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/externalAgentCimdFlow.test.js tests/externalAgentsRoute.test.js --forceExit --maxWorkers=2`
Expected: FAIL — flow tests ignore `agent`; route module missing.

- [ ] **Step 3: Write minimal implementation**

`services/pfAiAgentCimdService.js` — replace the two functions (everything else unchanged):

```js
function agentTarget(config, agent) {
  return {
    pendingKey: agent?.pendingKey || 'cimdPending',
    tokensKey: agent?.tokensKey || 'cimdTokens',
    scope: agent?.scope || CIMD_SCOPE,
    clientId: agent ? agent.clientId(config) : config.clientMetadataUrl,
    redirectUri: agent ? agent.redirectUri(config) : config.redirectUri,
  };
}

async function beginCimd(req, { store = configStore, fetchImpl = fetch, now = Date.now, agent } = {}) {
  ensureEnabled(store);
  const featureSession = ensureSession(req);
  const pendingKey = agent?.pendingKey || 'cimdPending';
  for (const key of new Set(['cimdPending', 'rarPending', pendingKey])) {
    if (featureSession[key] && (!Number.isFinite(featureSession[key].expiresAt)
      || featureSession[key].expiresAt <= now())) delete featureSession[key];
  }
  if (featureSession.cimdPending || featureSession.rarPending || featureSession[pendingKey]) {
    throw oauthError('PF_AI_FLOW_ALREADY_PENDING', 'A PF AI Agent authorization flow is already pending', 409);
  }
  const config = resolveCimdConfig(store);
  const target = agentTarget(config, agent);
  const metadata = await discoverPf(config, fetchImpl);
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const { verifier, challenge } = createPkce();
  const createdAt = now();
  featureSession[target.pendingKey] = {
    state,
    nonce,
    verifier,
    createdAt,
    expiresAt: createdAt + FLOW_TTL_MS,
    ...(agent?.extra || {}),
  };
  delete featureSession[target.tokensKey];
  return {
    redirectUrl: buildAuthorizationUrl({
      metadata,
      clientId: target.clientId,
      redirectUri: target.redirectUri,
      scope: target.scope,
      state,
      nonce,
      challenge,
    }),
  };
}

async function completeCimd(req, { store = configStore, fetchImpl = fetch, now = Date.now, agent } = {}) {
  const featureSession = ensureSession(req);
  const pendingKey = agent?.pendingKey || 'cimdPending';
  const pending = featureSession[pendingKey];
  const queryState = req?.query?.state;
  if (!pending || !secureEqual(queryState, pending.state)) {
    throw noPendingFlow(queryState);
  }
  if (!Number.isFinite(pending.expiresAt) || pending.expiresAt <= now()) {
    delete featureSession[pendingKey];
    throw noPendingFlow(queryState);
  }
  delete featureSession[pendingKey];
  if (req?.query?.error || typeof req?.query?.code !== 'string' || !req.query.code) throw noPendingFlow(queryState);

  const config = resolveCimdConfig(store);
  const target = agentTarget(config, agent);
  const metadata = await discoverPf(config, fetchImpl);
  const { tokenSet, identity } = await exchangeAuthorizationCode({
    config,
    metadata,
    clientId: target.clientId,
    redirectUri: target.redirectUri,
    code: req.query.code,
    verifier: pending.verifier,
    nonce: pending.nonce,
  }, fetchImpl);
  featureSession[target.tokensKey] = tokenSet;
  return identity;
}
```

`routes/externalAgents.js`:

```js
'use strict';

const express = require('express');
const configStore = require('../services/configStore');
const { requireSession } = require('../middleware/auth');
const { getFrontendOrigin } = require('../services/oauthRedirectUris');
const { getFeatureStatus, resolveCimdConfig } = require('../services/pfAiAgentFeatureConfig');
const pfCimd = require('../services/pfAiAgentCimdService');
const svc = require('../services/externalAgentCimdService');

const PF_KEY = 'extCimdPending';
const PF_REASON = 'PingFederate CIMD is not enabled or configured';

function requestOrigin(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

function agentFor(slug, store) {
  const cimdAgent = svc.getAgent(slug);
  if (!cimdAgent) return null;
  return {
    pendingKey: PF_KEY,
    tokensKey: 'extCimdTokens',
    scope: cimdAgent.pfScope,
    clientId: (config) => `${new URL(config.clientMetadataUrl).origin}${svc.metadataPath(slug, 'pingfederate')}`,
    redirectUri: (config) => `${new URL(config.clientMetadataUrl).origin}${svc.CALLBACK_PATH}`,
    extra: { slug },
  };
}

function createExternalAgentsRouter({ configStore: store = configStore, fetchImpl = fetch } = {}) {
  const router = express.Router();

  // Public — the AS (PingFederate) fetches this by URL, no session.
  router.get('/:slug/:engine/client-metadata.json', (req, res) => {
    const { slug, engine } = req.params;
    const doc = svc.metadataDocument(slug, engine, requestOrigin(req));
    if (!doc) return res.status(404).json({ error: 'agent_not_found' });
    svc.recordFetch(slug, engine, req.get('user-agent'));
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(doc);
  });

  // Public — PF redirects the browser here; identity comes from the pending flow in the session.
  router.get('/callback', async (req, res) => {
    const fail = () => res.redirect(`${getFrontendOrigin()}/agent-builder?external_agent=error`);
    const pending = req.session?.pfAiAgent?.[PF_KEY];
    const slug = pending?.slug;
    const cimdAgent = slug ? agentFor(slug, store) : null;
    if (!cimdAgent || !req.session?.user) return fail();
    try {
      const identity = await pfCimd.completeCimd(req, { store, fetchImpl, agent: cimdAgent });
      const config = resolveCimdConfig(store);
      const clientId = cimdAgent.clientId(config);
      svc.saveRegistration({
        user: req.session.user, slug, engine: 'pingfederate', clientId, metadataUrl: clientId,
        subject: identity.subject,
        steps: [
          { step: 'fetch', status: 'success', engine: 'pingfederate' },
          { step: 'validate', status: 'success', engine: 'pingfederate' },
          { step: 'register', status: 'success', engine: 'pingfederate' },
        ],
      });
      return res.redirect(`${getFrontendOrigin()}/agent-builder?external_agent=success`);
    } catch {
      return fail();
    }
  });

  router.use(requireSession);

  router.get('/', (req, res) => {
    const pfOn = getFeatureStatus(store).cimd;
    const key = svc.userKey(req.session.user);
    res.json({
      agents: svc.AGENTS.map(({ slug, clientName, clientUri }) => ({ slug, clientName, clientUri })),
      engines: {
        mock: { available: true },
        pingfederate: pfOn ? { available: true } : { available: false, reason: PF_REASON },
      },
      registrations: svc.listRegistrations().filter((r) => r.userKey === key),
    });
  });

  router.post('/:slug/register/mock', async (req, res) => {
    if (!svc.getAgent(req.params.slug)) return res.status(404).json({ error: 'agent_not_found' });
    try {
      const result = await svc.registerMock(req.session.user, req.params.slug);
      if (!result.ok) return res.status(502).json({ error: result.error });
      return res.json({ engine: 'mock', record: result.record, steps: result.steps });
    } catch {
      return res.status(502).json({ error: 'mock_registration_failed' });
    }
  });

  router.get('/:slug/register/pingfederate', async (req, res) => {
    const cimdAgent = agentFor(req.params.slug, store);
    if (!cimdAgent) return res.status(404).json({ error: 'agent_not_found' });
    if (!getFeatureStatus(store).cimd) return res.status(503).json({ error: 'pf_ai_cimd_not_configured' });
    try {
      const { redirectUrl } = await pfCimd.beginCimd(req, { store, fetchImpl, agent: cimdAgent });
      return res.redirect(302, redirectUrl);
    } catch (error) {
      const code = /^[A-Z0-9_]+$/.test(String(error?.code || '')) ? error.code.toLowerCase() : 'pf_cimd_start_failed';
      return res.status(error.httpStatus || 502).json({ error: code });
    }
  });

  return router;
}

module.exports = createExternalAgentsRouter();
module.exports.createExternalAgentsRouter = createExternalAgentsRouter;
```

`server.js` — directly after the line `app.use('/api/cimd', require('./routes/cimdAgentMetadata'));` add:

```js
app.use('/api/external-agents', require('./routes/externalAgents'));
```

- [ ] **Step 4: Run tests to verify they pass, plus the existing PF CIMD suites (default behavior must be unchanged)**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/externalAgentCimdFlow.test.js tests/externalAgentsRoute.test.js src/__tests__/pfAiAgentCimdService.test.js src/__tests__/pfAiAgentCimdRoute.test.js src/__tests__/pfAiAgentRoute.test.js --forceExit --maxWorkers=2`
Expected: all PASS. If a pre-existing PF suite fails, the refactor changed default behavior; fix the refactor, not the old test.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/pfAiAgentCimdService.js demo_api_server/routes/externalAgents.js demo_api_server/server.js demo_api_server/tests/externalAgentCimdFlow.test.js demo_api_server/tests/externalAgentsRoute.test.js
git commit -m "feat(cimd): PingFederate lane for external agents via parameterised PF CIMD flow"
```

---

### Task 3: RFC 9728 discovery for the PingFederate lane

**Files:**
- Create: `demo_api_server/services/externalAgentDiscovery.js`
- Modify: `demo_api_server/routes/externalAgents.js` (add `/resource`, `/discovery`, `/evidence`); `demo_api_server/server.js` (well-known mount)
- Test: `demo_api_server/tests/externalAgentDiscovery.test.js`; extend `demo_api_server/tests/externalAgentsRoute.test.js`

**Interfaces:**
- Consumes (existing): `resolveCimdConfig(store)`; (Task 1) `recentFetches`.
- Produces: `prmDocument(store, origin) -> object` (throws config error when PF unconfigured); `challengeHeader(origin) -> string`; `prmUrl(origin) -> string`; `runDiscovery({ store, fetchImpl, selfBase, publicOrigin }) -> { steps: Array<{ step, status:'success'|'failed', detail }>, cimdSupport: 'true'|'false'|'not_advertised' }`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://local.ping-devops.com:4000',
}));

const { prmDocument, challengeHeader, prmUrl, runDiscovery } = require('../services/externalAgentDiscovery');

const store = () => {
  const v = {
    pf_ai_cimd_enabled: 'true',
    pf_issuer: 'https://pf.example.test',
    pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
    pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
    pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
    pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
  };
  return { getEffective: (k) => v[String(k).toLowerCase()] || '' };
};
const res = (body, status = 200, headers = {}) => ({
  ok: status < 400, status, json: async () => body, headers: { get: (h) => headers[h.toLowerCase()] || null },
});

const ORIGIN = 'https://local.ping-devops.com:4000';

describe('RFC 9728 for the external-agent resource', () => {
  test('PRM names PingFederate as the authorization server', () => {
    expect(prmDocument(store(), ORIGIN)).toMatchObject({
      resource: `${ORIGIN}/api/external-agents/resource`,
      authorization_servers: ['https://pf.example.test'],
      bearer_methods_supported: ['header'],
    });
  });

  test('challenge points at the path-inserted well-known URL', () => {
    expect(prmUrl(ORIGIN)).toBe(`${ORIGIN}/.well-known/oauth-protected-resource/api/external-agents/resource`);
    expect(challengeHeader(ORIGIN)).toBe(`Bearer resource_metadata="${prmUrl(ORIGIN)}"`);
  });

  test('PRM throws when PF is not configured', () => {
    expect(() => prmDocument({ getEffective: () => '' }, ORIGIN)).toThrow();
  });
});

describe('runDiscovery', () => {
  const selfBase = 'http://127.0.0.1:3001';
  const challenge = `Bearer resource_metadata="${prmUrl(ORIGIN)}"`;

  function fetchWith(asMeta) {
    return jest.fn(async (url) => {
      if (String(url).endsWith('/api/external-agents/resource')) return res({ error: 'unauthorized' }, 401, { 'www-authenticate': challenge });
      if (String(url).includes('/.well-known/oauth-protected-resource/')) return res(prmDocument(store(), ORIGIN));
      if (String(url).includes('openid-configuration')) return res(asMeta);
      throw new Error(`unexpected ${url}`);
    });
  }

  test('walks 401 challenge, PRM, AS metadata and reports advertised CIMD support', async () => {
    const out = await runDiscovery({ store: store(), fetchImpl: fetchWith({ issuer: 'https://pf.example.test', client_id_metadata_document_supported: true }), selfBase, publicOrigin: ORIGIN });
    expect(out.steps.map((s) => s.step)).toEqual(['challenge', 'resource_metadata', 'as_metadata']);
    expect(out.steps.every((s) => s.status === 'success')).toBe(true);
    expect(out.cimdSupport).toBe('true');
  });

  test('reports not_advertised when the AS metadata omits the parameter', async () => {
    const out = await runDiscovery({ store: store(), fetchImpl: fetchWith({ issuer: 'https://pf.example.test' }), selfBase, publicOrigin: ORIGIN });
    expect(out.cimdSupport).toBe('not_advertised');
  });

  test('reports false when explicitly false', async () => {
    const out = await runDiscovery({ store: store(), fetchImpl: fetchWith({ issuer: 'https://pf.example.test', client_id_metadata_document_supported: false }), selfBase, publicOrigin: ORIGIN });
    expect(out.cimdSupport).toBe('false');
  });

  test('fails the challenge step when the resource does not challenge', async () => {
    const fetchImpl = jest.fn(async () => res({}, 200));
    const out = await runDiscovery({ store: store(), fetchImpl, selfBase, publicOrigin: ORIGIN });
    expect(out.steps[0]).toMatchObject({ step: 'challenge', status: 'failed' });
    expect(out.steps).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/externalAgentDiscovery.test.js --forceExit --maxWorkers=2`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`services/externalAgentDiscovery.js`:

```js
'use strict';

const { resolveCimdConfig } = require('./pfAiAgentFeatureConfig');

const RESOURCE_PATH = '/api/external-agents/resource';
const PRM_PATH = `/.well-known/oauth-protected-resource${RESOURCE_PATH}`;
const TIMEOUT_MS = 10_000;

function prmUrl(origin) {
  return `${origin}${PRM_PATH}`;
}

function challengeHeader(origin) {
  return `Bearer resource_metadata="${prmUrl(origin)}"`;
}

function prmDocument(store, origin) {
  const config = resolveCimdConfig(store); // throws when PF is not configured
  return {
    resource: `${origin}${RESOURCE_PATH}`,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'profile', 'email'],
    resource_name: 'Super Banking external-agent resource',
    resource_documentation: 'https://datatracker.ietf.org/doc/html/rfc9728',
  };
}

function step(name, status, detail) {
  return { step: name, status, detail };
}

async function runDiscovery({ store, fetchImpl = fetch, selfBase, publicOrigin }) {
  const steps = [];
  const opts = { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) };

  // 1. RFC 9728 §5.1: the unauthenticated call is challenged and names the metadata URL.
  let challengeRes;
  try { challengeRes = await fetchImpl(`${selfBase}${RESOURCE_PATH}`, opts); } catch { challengeRes = null; }
  const header = challengeRes?.headers?.get('www-authenticate') || '';
  const match = /resource_metadata="([^"]+)"/.exec(header);
  if (!challengeRes || challengeRes.status !== 401 || !match) {
    steps.push(step('challenge', 'failed', { expected: '401 with resource_metadata', status: challengeRes?.status ?? null }));
    return { steps, cimdSupport: 'not_advertised' };
  }
  steps.push(step('challenge', 'success', { status: 401, resource_metadata: match[1] }));

  // 2. Fetch the Protected Resource Metadata and read authorization_servers.
  let prm;
  try {
    const r = await fetchImpl(`${selfBase}${PRM_PATH}`, opts);
    if (!r.ok) throw new Error('prm');
    prm = await r.json();
  } catch {
    steps.push(step('resource_metadata', 'failed', { url: match[1] }));
    return { steps, cimdSupport: 'not_advertised' };
  }
  steps.push(step('resource_metadata', 'success', { resource: prm.resource, authorization_servers: prm.authorization_servers }));

  // 3. Fetch the AS metadata and look for CIMD support (draft-ietf-oauth-client-id-metadata-document §6).
  const config = resolveCimdConfig(store);
  let asMeta;
  try {
    const r = await fetchImpl(config.discoveryEndpoint, opts);
    if (!r.ok) throw new Error('as');
    asMeta = await r.json();
  } catch {
    steps.push(step('as_metadata', 'failed', { url: config.discoveryEndpoint }));
    return { steps, cimdSupport: 'not_advertised' };
  }
  const flag = asMeta.client_id_metadata_document_supported;
  const cimdSupport = flag === true ? 'true' : flag === false ? 'false' : 'not_advertised';
  steps.push(step('as_metadata', 'success', { issuer: asMeta.issuer, client_id_metadata_document_supported: cimdSupport }));
  return { steps, cimdSupport };
}

module.exports = { RESOURCE_PATH, PRM_PATH, prmUrl, challengeHeader, prmDocument, runDiscovery };
```

`routes/externalAgents.js` — add imports at top:

```js
const discovery = require('../services/externalAgentDiscovery');
```

Add before `router.use(requireSession);` (public: an agent must reach these without a session):

```js
  // Public — RFC 9728: an unauthenticated call is challenged and pointed at the metadata.
  router.get('/resource', (req, res) => {
    res.set('WWW-Authenticate', discovery.challengeHeader(requestOrigin(req)));
    return res.status(401).json({ error: 'unauthorized' });
  });
```

Add after `router.use(requireSession);`:

```js
  router.get('/discovery', async (req, res) => {
    if (!getFeatureStatus(store).cimd) return res.status(503).json({ error: 'pf_ai_cimd_not_configured' });
    const selfBase = `${process.env.BFF_LOOPBACK_SCHEME || 'http'}://127.0.0.1:${process.env.PORT || 3001}`;
    try {
      const out = await discovery.runDiscovery({ store, fetchImpl, selfBase, publicOrigin: requestOrigin(req) });
      return res.json(out);
    } catch {
      return res.status(502).json({ error: 'discovery_failed' });
    }
  });

  // Evidence that the AS really fetched the agent's document (newest first).
  router.get('/:slug/evidence', (req, res) => {
    if (!svc.getAgent(req.params.slug)) return res.status(404).json({ error: 'agent_not_found' });
    return res.json({ pingfederate: svc.recentFetches(req.params.slug, 'pingfederate'), mock: svc.recentFetches(req.params.slug, 'mock') });
  });
```

The well-known PRM route needs its own router export. At the bottom of `routes/externalAgents.js`:

```js
const wellKnown = express.Router();
wellKnown.get('/api/external-agents/resource', (req, res) => {
  try {
    return res.json(discovery.prmDocument(configStore, requestOrigin(req)));
  } catch {
    return res.status(404).json({ error: 'pf_ai_cimd_not_configured' });
  }
});
module.exports.wellKnown = wellKnown;
```

`server.js` — next to the existing `app.use('/.well-known/oauth-protected-resource', protectedResourceMetadataRoutes);` add, **before** it (both fall through on a miss, but the more specific mount first is clearer):

```js
app.use('/.well-known/oauth-protected-resource', require('./routes/externalAgents').wellKnown);
```

Extend `tests/externalAgentsRoute.test.js` with:

```js
describe('RFC 9728 routes', () => {
  test('GET /resource is public and returns 401 with a resource_metadata challenge', async () => {
    const res = await request(makeApp(disabledStore(), null)).get('/api/external-agents/resource')
      .set('Host', 'bff.example.test').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer resource_metadata="https://bff.example.test/.well-known/oauth-protected-resource/api/external-agents/resource"');
  });

  test('GET /discovery is 503 when PF is not configured', async () => {
    const res = await request(makeApp(disabledStore())).get('/api/external-agents/discovery');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'pf_ai_cimd_not_configured' });
  });

  test('GET /:slug/evidence lists recorded fetches', async () => {
    svc.recordFetch('acme-travel-agent', 'pingfederate', 'PF-UA');
    const res = await request(makeApp(disabledStore())).get('/api/external-agents/acme-travel-agent/evidence');
    expect(res.body.pingfederate[0].userAgent).toBe('PF-UA');
  });
});
```

- [ ] **Step 4: Run tests to verify they pass; confirm the existing PingOne PRM is untouched**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/externalAgentDiscovery.test.js tests/externalAgentsRoute.test.js --forceExit --maxWorkers=2`
Then: `git grep -l "protectedResourceMetadata" -- demo_api_server/tests demo_api_server/src/__tests__` and run those files too.
Expected: PASS; existing PRM tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/externalAgentDiscovery.js demo_api_server/routes/externalAgents.js demo_api_server/server.js demo_api_server/tests/externalAgentDiscovery.test.js demo_api_server/tests/externalAgentsRoute.test.js
git commit -m "feat(cimd): RFC 9728 discovery for the PingFederate external-agent lane"
```

---

### Task 4: Inventory — external CIMD registrations with an engine badge

**Files:**
- Modify: `demo_api_server/services/agentRegistryService.js` (add source + `readSource` call in `buildRegistry`)
- Test: extend `demo_api_server/tests/agentRegistryService.test.js`

**Interfaces:**
- Consumes (Task 1): `listRegistrations()`.
- Produces: registry rows `{ id: clientId, name, identityType:'agent', source:'external-cimd', engine, registrationType:'cimd-mock'|'cimd-pingfederate', registrationStatus, metadataUrl, credentialType, status:'active', grantedScopes, expectedScopes:[], missingScopes:[], scopeStatus:'unverified', lifecycle }`.

- [ ] **Step 1: Write the failing test**

First read the top of `tests/agentRegistryService.test.js` to see how it mocks the other sources (`jest.mock` calls), then add a mock for `../services/externalAgentCimdService` in the same style and this test:

```js
test('lists external CIMD registrations with engine and registration type', async () => {
  externalAgentCimdService.listRegistrations.mockReturnValue([
    { userKey: 'u1', slug: 'acme-travel-agent', engine: 'pingfederate', agentName: 'Acme Travel Agent (external)',
      clientId: 'https://bff.example.test/api/external-agents/acme-travel-agent/pingfederate/client-metadata.json',
      metadataUrl: 'https://bff.example.test/api/external-agents/acme-travel-agent/pingfederate/client-metadata.json',
      status: 'registered' },
  ]);
  const out = await buildRegistry();
  expect(out.sources.externalCimd.ok).toBe(true);
  const row = out.rows.find((r) => r.source === 'external-cimd');
  expect(row).toMatchObject({
    name: 'Acme Travel Agent (external)', engine: 'pingfederate',
    registrationType: 'cimd-pingfederate', registrationStatus: 'registered', identityType: 'agent',
  });
});

test('an unreadable external CIMD store is named as a failed source, not a thrown error', async () => {
  externalAgentCimdService.listRegistrations.mockImplementation(() => { throw new Error('lmdb down'); });
  const out = await buildRegistry();
  expect(out.sources.externalCimd.ok).toBe(false);
});
```

Also check whether any existing test asserts the exact key set of `out.sources`; if so add `externalCimd` to that expectation.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/agentRegistryService.test.js --forceExit --maxWorkers=2`
Expected: FAIL — `sources.externalCimd` undefined.

- [ ] **Step 3: Write minimal implementation**

In `services/agentRegistryService.js`, add near the other requires: `const externalAgentCimdService = require('./externalAgentCimdService');` and this function above `buildRegistry`:

```js
/** External agents a user registered through CIMD (mock PingOne facade or PingFederate). */
function externalCimdAgents() {
  return externalAgentCimdService.listRegistrations().map((r) => ({
    id: r.clientId,
    name: r.agentName,
    identityType: 'agent',
    source: 'external-cimd',
    engine: r.engine,
    registrationType: `cimd-${r.engine}`,
    registrationStatus: r.status,
    metadataUrl: r.metadataUrl,
    credentialType: r.engine === 'pingfederate' ? 'public client (authorization_code + PKCE)' : 'client_credentials',
    status: 'active',
    grantedScopes: [],
    expectedScopes: [],
    missingScopes: [],
    scopeStatus: 'unverified',
    lifecycle: lifecycleFor(r.clientId),
  }));
}
```

and in `buildRegistry`, after the `runtime` line:

```js
  await readSource('externalCimd', async () => externalCimdAgents(), out);
```

- [ ] **Step 4: Run tests**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/agentRegistryService.test.js tests/agentRegistryRoute.test.js tests/controlPlaneOverview.test.js --forceExit --maxWorkers=2`
Expected: PASS. If `controlPlaneOverview` or the route test pins the source list, add `externalCimd` there.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/agentRegistryService.js demo_api_server/tests/agentRegistryService.test.js
git commit -m "feat(cimd): external CIMD registrations in the agent inventory with engine badge"
```

---

### Task 5: Agent Builder UI — "Connect an external agent" panel with lane picker

**Files:**
- Create: `demo_api_ui/src/services/externalAgentService.js`
- Create: `demo_api_ui/src/components/ExternalAgentPanel.jsx`, `demo_api_ui/src/components/ExternalAgentPanel.css`
- Modify: `demo_api_ui/src/components/AgentBuilderPage.jsx` (import + mount after the "Your AI Agent" section)
- Test: `demo_api_ui/src/components/__tests__/ExternalAgentPanel.test.jsx`

**Interfaces:**
- Consumes (Tasks 2–3): `GET /api/external-agents` -> `{ agents, engines, registrations }`; `GET /api/external-agents/discovery` -> `{ steps, cimdSupport }`; `POST /api/external-agents/:slug/register/mock` -> `{ engine, record, steps }`; `GET /api/external-agents/:slug/register/pingfederate` (browser navigation, 302); `GET /api/external-agents/:slug/evidence`.
- Produces: `externalAgentService`: `listExternalAgents()`, `runDiscovery()`, `registerMock(slug)`, `pingfederateStartUrl(slug)`, `fetchEvidence(slug)`.

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../../services/externalAgentService', () => ({
  listExternalAgents: vi.fn(),
  runDiscovery: vi.fn(),
  registerMock: vi.fn(),
  pingfederateStartUrl: (slug) => `/api/external-agents/${slug}/register/pingfederate`,
  fetchEvidence: vi.fn(),
}));

import ExternalAgentPanel from '../ExternalAgentPanel';
import * as svc from '../../services/externalAgentService';

const base = {
  agents: [{ slug: 'acme-travel-agent', clientName: 'Acme Travel Agent (external)', clientUri: 'https://travel.acme.example' }],
  engines: { mock: { available: true }, pingfederate: { available: true } },
  registrations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  svc.listExternalAgents.mockResolvedValue(base);
  svc.fetchEvidence.mockResolvedValue({ pingfederate: [], mock: [] });
  window.history.pushState({}, '', '/agent-builder');
});

test('shows both lanes with honest engine labels', async () => {
  render(<ExternalAgentPanel />);
  expect(await screen.findByText('Acme Travel Agent (external)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /register with mock pingone/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /register with pingfederate/i })).toBeInTheDocument();
  expect(screen.getByText(/mock/i, { selector: '.ea-engine-note--mock' })).toBeInTheDocument();
});

test('disables the PingFederate lane with the reason when it is not configured', async () => {
  svc.listExternalAgents.mockResolvedValue({
    ...base,
    engines: { mock: { available: true }, pingfederate: { available: false, reason: 'PingFederate CIMD is not enabled or configured' } },
  });
  render(<ExternalAgentPanel />);
  const button = await screen.findByRole('button', { name: /register with pingfederate/i });
  expect(button).toBeDisabled();
  expect(screen.getByText('PingFederate CIMD is not enabled or configured')).toBeInTheDocument();
});

test('runs RFC 9728 discovery and shows an unadvertised CIMD flag as not advertised', async () => {
  svc.runDiscovery.mockResolvedValue({
    cimdSupport: 'not_advertised',
    steps: [
      { step: 'challenge', status: 'success', detail: {} },
      { step: 'resource_metadata', status: 'success', detail: {} },
      { step: 'as_metadata', status: 'success', detail: {} },
    ],
  });
  render(<ExternalAgentPanel />);
  fireEvent.click(await screen.findByRole('button', { name: /run discovery/i }));
  expect(await screen.findByText(/not advertised/i)).toBeInTheDocument();
  expect(screen.getByText(/resource_metadata/)).toBeInTheDocument();
});

test('mock lane registers and shows the mock badge', async () => {
  svc.registerMock.mockResolvedValue({ engine: 'mock', record: { engine: 'mock', status: 'registered', slug: 'acme-travel-agent' }, steps: [] });
  svc.listExternalAgents
    .mockResolvedValueOnce(base)
    .mockResolvedValue({ ...base, registrations: [{ slug: 'acme-travel-agent', engine: 'mock', status: 'registered' }] });
  render(<ExternalAgentPanel />);
  fireEvent.click(await screen.findByRole('button', { name: /register with mock pingone/i }));
  await waitFor(() => expect(svc.registerMock).toHaveBeenCalledWith('acme-travel-agent'));
  expect(await screen.findByText('engine: mock')).toBeInTheDocument();
});

test('reports a failed PingFederate return', async () => {
  window.history.pushState({}, '', '/agent-builder?external_agent=error');
  render(<ExternalAgentPanel />);
  expect(await screen.findByText(/PingFederate registration did not complete/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/components/__tests__/ExternalAgentPanel.test.jsx`
Expected: FAIL — cannot resolve `../ExternalAgentPanel`.

- [ ] **Step 3: Write minimal implementation**

`services/externalAgentService.js`:

```js
// demo_api_ui/src/services/externalAgentService.js
// Thin bffAxios wrappers for /api/external-agents (Agent Builder external-agent panel).
import bffAxios from './bffAxios';

export async function listExternalAgents() {
  const { data } = await bffAxios.get('/api/external-agents');
  return data;
}

export async function runDiscovery() {
  const { data } = await bffAxios.get('/api/external-agents/discovery');
  return data;
}

export async function registerMock(slug) {
  const { data } = await bffAxios.post(`/api/external-agents/${slug}/register/mock`);
  return data;
}

// The PingFederate lane is a browser redirect (authorization request), not an XHR.
export function pingfederateStartUrl(slug) {
  return `/api/external-agents/${slug}/register/pingfederate`;
}

export async function fetchEvidence(slug) {
  const { data } = await bffAxios.get(`/api/external-agents/${slug}/evidence`);
  return data;
}
```

`components/ExternalAgentPanel.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  listExternalAgents, runDiscovery, registerMock, pingfederateStartUrl, fetchEvidence,
} from '../services/externalAgentService';
import './ExternalAgentPanel.css';

const CIMD_LABEL = { true: 'advertised: true', false: 'advertised: false', not_advertised: 'not advertised' };

function returnStatus() {
  const value = new URLSearchParams(window.location.search).get('external_agent');
  return value === 'success' || value === 'error' ? value : null;
}

/**
 * ExternalAgentPanel — the "connect an external agent" story on /agent-builder (UC43).
 * A customer's external agent identifies itself by its own metadata URL (CIMD). Two lanes:
 * a mock PingOne facade and real PingFederate CIMD. The engine label is always shown.
 */
export default function ExternalAgentPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [discovery, setDiscovery] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const returned = returnStatus();

  const refresh = useCallback(async () => {
    const next = await listExternalAgents();
    setData(next);
    if (next.agents[0]) setEvidence(await fetchEvidence(next.agents[0].slug));
  }, []);

  useEffect(() => {
    refresh().catch(() => setError('External agent data could not be loaded.'));
  }, [refresh]);

  const onDiscovery = async () => {
    setError(''); setBusy('discovery');
    try { setDiscovery(await runDiscovery()); }
    catch { setError('Discovery could not run.'); }
    finally { setBusy(null); }
  };

  const onMock = (slug) => async () => {
    setError(''); setBusy('mock');
    try { await registerMock(slug); await refresh(); }
    catch { setError('Mock registration failed.'); }
    finally { setBusy(null); }
  };

  const onPingFederate = (slug) => () => { window.location.assign(pingfederateStartUrl(slug)); };

  if (!data) return error ? <section className="ab-card"><div className="ab-error">{error}</div></section> : null;
  const pf = data.engines.pingfederate;

  return (
    <section className="ab-card ea-panel" aria-label="Connect an external agent">
      <h2>Connect an external agent</h2>
      <p className="ab-edu">
        An agent from outside your bank identifies itself with its <strong>own metadata URL</strong> (CIMD).
        Start by discovering how it reaches the protected resource (RFC 9728), then register it through one of two engines.
      </p>
      {returned === 'success' && <div className="ea-banner ea-banner--ok">✅ PingFederate registered the agent.</div>}
      {returned === 'error' && <div className="ab-error">❌ PingFederate registration did not complete. Nothing was registered.</div>}
      {error && <div className="ab-error">{error}</div>}

      <div className="ea-discovery">
        <button type="button" className="ab-btn" onClick={onDiscovery} disabled={busy === 'discovery' || !pf.available}>
          {busy === 'discovery' ? 'Running…' : 'Run discovery'}
        </button>
        {!pf.available && <span className="ea-reason">{pf.reason}</span>}
        {discovery && (
          <ol className="ea-steps">
            {discovery.steps.map((s) => (
              <li key={s.step}>{s.status === 'success' ? '✓' : '✕'} {s.step}</li>
            ))}
            <li>CIMD support in AS metadata: <strong>{CIMD_LABEL[discovery.cimdSupport]}</strong></li>
          </ol>
        )}
      </div>

      {data.agents.map((agent) => {
        const regs = data.registrations.filter((r) => r.slug === agent.slug);
        return (
          <div key={agent.slug} className="ea-agent">
            <h3>{agent.clientName}</h3>
            <p className="ea-uri">{agent.clientUri}</p>
            <div className="ea-lanes">
              <div className="ea-lane">
                <button type="button" className="ab-btn" onClick={onMock(agent.slug)} disabled={busy === 'mock'}>
                  Register with Mock PingOne
                </button>
                <p className="ea-engine-note ea-engine-note--mock">Mock: PingOne does not fetch CIMD. The BFF simulates the registration.</p>
              </div>
              <div className="ea-lane">
                <button type="button" className="ab-btn ab-btn-primary" onClick={onPingFederate(agent.slug)} disabled={!pf.available}>
                  Register with PingFederate
                </button>
                <p className="ea-engine-note">Real: PingFederate fetches the agent's metadata URL and you consent.</p>
              </div>
            </div>
            {regs.length > 0 && (
              <ul className="ea-registrations">
                {regs.map((r) => (
                  <li key={r.engine}><span className="ab-badge">engine: {r.engine}</span> {r.status}</li>
                ))}
              </ul>
            )}
            {evidence?.pingfederate?.length > 0 && (
              <p className="ea-evidence">PingFederate fetched this agent&apos;s document {evidence.pingfederate.length} time(s); latest {evidence.pingfederate[0].at}.</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
```

`components/ExternalAgentPanel.css` (tokens only; confirm each `--th-*` name exists with `git grep -n -e '--th-text-muted' -e '--th-bg-card' -e '--th-border' demo_api_ui/src/styles | head` before using it — do not invent token names):

```css
.ea-panel .ea-discovery { margin: 12px 0 16px; }
.ea-panel .ea-reason { margin-left: 10px; color: var(--th-text-muted); font-size: var(--font-size-xs); }
.ea-panel .ea-steps { margin: 10px 0 0 18px; font-size: var(--font-size-sm); }
.ea-panel .ea-agent { border-top: 1px solid var(--th-border); padding-top: 12px; margin-top: 12px; }
.ea-panel .ea-uri { color: var(--th-text-muted); font-size: var(--font-size-xs); margin: 0 0 8px; }
.ea-panel .ea-lanes { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.ea-panel .ea-lane { border: 1px solid var(--th-border); border-radius: 8px; padding: 12px; background: var(--th-bg-card); }
.ea-panel .ea-engine-note { margin: 8px 0 0; font-size: var(--font-size-xs); color: var(--th-text-muted); }
.ea-panel .ea-registrations { list-style: none; padding: 0; margin: 10px 0 0; }
.ea-panel .ea-evidence { font-size: var(--font-size-xs); color: var(--th-text-muted); }
.ea-panel .ea-banner { margin: 8px 0; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--th-border); }
```

`AgentBuilderPage.jsx`: add `import ExternalAgentPanel from './ExternalAgentPanel';` with the other imports. Run `grep -n "Zone" demo_api_ui/src/components/AgentBuilderPage.jsx` to find the marker after the "Your AI Agent" `</section>`; insert `<ExternalAgentPanel />` on its own line immediately after that closing tag (before the next Zone comment).

- [ ] **Step 4: Run tests, then the build gate and the existing Agent Builder tests**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/components/__tests__/ExternalAgentPanel.test.jsx src/components/__tests__/AgentBuilderPage.cimd.test.jsx`
Then: `npm run build > /tmp/ui-build.out 2>&1; echo exit=$?` and read `/tmp/ui-build.out`.
Expected: tests PASS, build exit 0. `AgentBuilderPage.cimd.test.jsx` mocks `agentBuilderService` only; add `vi.mock('../../services/externalAgentService', ...)` returning an empty `{ agents: [], engines: { mock:{available:true}, pingfederate:{available:false,reason:''} }, registrations: [] }` for `listExternalAgents` if the mount makes that test hit the network.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/externalAgentService.js demo_api_ui/src/components/ExternalAgentPanel.jsx demo_api_ui/src/components/ExternalAgentPanel.css demo_api_ui/src/components/AgentBuilderPage.jsx demo_api_ui/src/components/__tests__/ExternalAgentPanel.test.jsx demo_api_ui/src/components/__tests__/AgentBuilderPage.cimd.test.jsx
git commit -m "feat(cimd): Agent Builder external-agent panel with mock PingOne and PingFederate lanes"
```

---

### Task 6: CIMD guide panel — PingFederate tab and Simulate engine selector

**Files:**
- Modify: `demo_api_ui/src/components/CimdSimPanel.js` (new `PingFederateTab`, engine selector in `SimulateTab` idle state, `TABS` entry, tab render line)
- Modify: `demo_api_ui/src/components/CimdSimPanel.css`
- Test: extend `demo_api_ui/src/components/__tests__/CimdSimPanel.test.js`

**Interfaces:**
- Consumes (Task 5): `runDiscovery()` and `fetchEvidence(slug)` from `services/externalAgentService`.
- Produces: tab id `pingfederate` (label `PingFederate`); Simulate idle state gains a `role="radiogroup"` named "Registration engine" with radios "Mock PingOne" (default) and "PingFederate".

- [ ] **Step 1: Write the failing tests** (append to the existing file; it already mocks `axios` and has `openPanel`/`clickTab`)

```js
vi.mock('../../services/externalAgentService', () => ({
  runDiscovery: vi.fn(),
  fetchEvidence: vi.fn(),
}));
import { runDiscovery, fetchEvidence } from '../../services/externalAgentService';

describe('CimdSimPanel — PingFederate engine', () => {
  afterEach(() => vi.clearAllMocks());

  it('has a PingFederate tab that compares both engines honestly', () => {
    render(<CimdSimPanel />);
    openPanel();
    clickTab('PingFederate');
    expect(screen.getByText(/PingOne does not fetch CIMD/i)).toBeInTheDocument();
    expect(screen.getByText(/PingFederate 13\.1/i)).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent(/Mock PingOne/);
    expect(screen.getByRole('table')).toHaveTextContent(/PingFederate/);
  });

  it('Simulate defaults to the mock engine and offers PingFederate', () => {
    render(<CimdSimPanel />);
    openPanel();
    clickTab('Simulate');
    const group = screen.getByRole('radiogroup', { name: /registration engine/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /mock pingone/i })).toBeChecked();
    expect(screen.getByRole('button', { name: /run simulation/i })).toBeInTheDocument();
  });

  it('PingFederate engine shows real discovery and fetch evidence instead of the scripted steps', async () => {
    runDiscovery.mockResolvedValue({
      cimdSupport: 'not_advertised',
      steps: [{ step: 'challenge', status: 'success', detail: {} }],
    });
    fetchEvidence.mockResolvedValue({ pingfederate: [{ at: '2026-09-30T10:00:00Z', userAgent: 'PF' }], mock: [] });
    render(<CimdSimPanel />);
    openPanel();
    clickTab('Simulate');
    fireEvent.click(screen.getByRole('radio', { name: /^pingfederate/i }));
    fireEvent.click(screen.getByRole('button', { name: /run real check/i }));
    expect(await screen.findByText(/not advertised/i)).toBeInTheDocument();
    expect(await screen.findByText(/2026-09-30T10:00:00Z/)).toBeInTheDocument();
    expect(screen.queryByText(/① Auth Request/)).not.toBeInTheDocument();
  });

  it('a failed real check says so instead of falling back to the mock', async () => {
    runDiscovery.mockRejectedValue(new Error('503'));
    render(<CimdSimPanel />);
    openPanel();
    clickTab('Simulate');
    fireEvent.click(screen.getByRole('radio', { name: /^pingfederate/i }));
    fireEvent.click(screen.getByRole('button', { name: /run real check/i }));
    expect(await screen.findByText(/could not run/i)).toBeInTheDocument();
  });
});
```

Also: `grep -n "7 tabs\|toHaveLength(7)\|getAllByRole('tab')" demo_api_ui/src/components/__tests__/CimdSimPanel.test.js` — if an assertion counts tabs, change 7 to 8.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/components/__tests__/CimdSimPanel.test.js`
Expected: the four new tests FAIL (no PingFederate tab / radiogroup); existing tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `CimdSimPanel.js`:

1. Imports: `import { runDiscovery, fetchEvidence } from '../services/externalAgentService';`
2. Add before the `// ── Simulation Tab` section:

```jsx
// ── Tab content: PingFederate (real) vs mock PingOne ─────────────────────────

function PingFederateTab() {
  return (
    <>
      <div className="cimd-callout cimd-callout--info">
        <strong>Two engines, one story.</strong> PingOne does not fetch CIMD documents, so the demo
        simulates that half. PingFederate 13.1 does fetch them: the <code>client_id</code> URL is
        retrieved, validated against RFC 7591 rules, and an ephemeral client is created.
      </div>
      <table className="cimd-table">
        <thead>
          <tr><th>Step</th><th>Mock PingOne</th><th>PingFederate</th></tr>
        </thead>
        <tbody>
          <tr><td><strong>Discovery</strong></td><td>RFC 9728 document names PingOne</td><td>RFC 9728 document names PingFederate</td></tr>
          <tr><td><strong>Document fetch</strong></td><td>The BFF fetches its own document (simulated)</td><td>PingFederate fetches the agent&apos;s URL (evidence recorded)</td></tr>
          <tr><td><strong>Client created</strong></td><td>Mock registry entry, confidential client</td><td>Ephemeral PingFederate client, public client with PKCE</td></tr>
          <tr><td><strong>Customer consent</strong></td><td>Not shown</td><td>PingFederate authorization and consent</td></tr>
          <tr><td><strong>Badge</strong></td><td><code>engine: mock</code></td><td><code>engine: pingfederate</code></td></tr>
        </tbody>
      </table>
      <h3>PingFederate setup</h3>
      <ol>
        <li>System &gt; OAuth Settings &gt; CIMD Settings: enable CIMD.</li>
        <li>System &gt; OAuth Settings &gt; CIMD Policies: add a policy whose Metadata URL matches the agent&apos;s document URL (https, wildcard after the host).</li>
        <li>Enable the demo flag and open Agent Builder &gt; Connect an external agent.</li>
      </ol>
    </>
  );
}

function PingFederateRealCheck() {
  const [state, setState] = useState('idle'); // 'idle' | 'running' | 'done' | 'error'
  const [result, setResult] = useState(null);
  const [evidence, setEvidence] = useState(null);

  const run = useCallback(async () => {
    setState('running');
    try {
      const discovery = await runDiscovery();
      const fetched = await fetchEvidence('acme-travel-agent');
      setResult(discovery);
      setEvidence(fetched);
      setState('done');
    } catch {
      setState('error');
    }
  }, []);

  const label = { true: 'advertised: true', false: 'advertised: false', not_advertised: 'not advertised' };
  return (
    <div className="cimd-sim-real">
      <p>
        This runs the real RFC 9728 discovery against PingFederate and shows whether PingFederate
        has fetched the agent&apos;s metadata document. Nothing here is scripted.
      </p>
      <button className="cimd-btn cimd-btn--primary" onClick={run} disabled={state === 'running'}>
        {state === 'running' ? 'Running…' : 'Run real check'}
      </button>
      {state === 'error' && (
        <div className="cimd-callout cimd-callout--warn">
          The real check could not run. PingFederate CIMD may not be enabled or configured.
        </div>
      )}
      {state === 'done' && result && (
        <>
          <ol>
            {result.steps.map((s) => (
              <li key={s.step}>{s.status === 'success' ? '✓' : '✕'} {s.step}</li>
            ))}
          </ol>
          <p>CIMD support in AS metadata: <strong>{label[result.cimdSupport]}</strong></p>
          {evidence?.pingfederate?.length > 0
            ? <p>PingFederate fetched the document at <code>{evidence.pingfederate[0].at}</code>.</p>
            : <p>PingFederate has not fetched the document yet. Register the agent in Agent Builder first.</p>}
        </>
      )}
    </div>
  );
}
```

3. In `SimulateTab`, add state `const [engine, setEngine] = useState('mock');` and, at the top of the `simState === 'idle'` block (before the intro paragraph) insert:

```jsx
          <div role="radiogroup" aria-label="Registration engine" className="cimd-engine-select">
            <label>
              <input type="radio" name="cimd-engine" checked={engine === 'mock'} onChange={() => setEngine('mock')} />
              {' '}Mock PingOne
            </label>
            <label>
              <input type="radio" name="cimd-engine" checked={engine === 'pingfederate'} onChange={() => setEngine('pingfederate')} />
              {' '}PingFederate
            </label>
          </div>
          {engine === 'pingfederate' && <PingFederateRealCheck />}
```

and wrap the rest of the idle block (everything after the radiogroup/real-check, through the existing "Run Simulation" button) in `{engine === 'mock' && ( <> ... </> )}` so the scripted steps show only for the mock engine.

4. `TABS`: add `{ id: 'pingfederate', label: 'PingFederate' },` after the `setup` entry, and in the body list add `{activeTab === 'pingfederate' && <PingFederateTab />}`. Update the file-header comment tab list to include it.

5. `CimdSimPanel.css` (tokens only):

```css
.cimd-engine-select { display: flex; gap: 16px; margin-bottom: 12px; font-size: var(--font-size-sm); }
.cimd-sim-real { margin-top: 8px; }
```

- [ ] **Step 4: Run tests and the build gate**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/components/__tests__/CimdSimPanel.test.js`
Then: `npm run build > /tmp/ui-build.out 2>&1; echo exit=$?`
Expected: PASS (existing + 4 new), build exit 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/CimdSimPanel.js demo_api_ui/src/components/CimdSimPanel.css demo_api_ui/src/components/__tests__/CimdSimPanel.test.js
git commit -m "feat(cimd): PingFederate tab and real-check engine selector in the CIMD guide"
```

---

### Task 7: Skill, UC43 wording, generated docs

**Files:**
- Create: `.claude/skills/pingfederate-cimd/SKILL.md`, `se-skills-export/pingfederate-cimd/SKILL.md`
- Modify: `se-skills-export/README.md` (one row), `demo_api_server/config/useCases.js` (UC43 text only)
- Regenerate: `docs/use-cases/` via the repo generator

- [ ] **Step 1: Write the skill** — `.claude/skills/pingfederate-cimd/SKILL.md`:

```markdown
---
name: pingfederate-cimd
description: Use when configuring PingFederate 13.1+ to accept Client ID Metadata Documents (CIMD) so an OAuth client can use its own metadata URL as client_id, including CIMD Settings, CIMD Policies, metadata URL patterns, and debugging "no enabled CIMD policy matches". Also use for MCP or agent onboarding where the client_id is a URL, or when comparing PingFederate CIMD with the mock PingOne CIMD facade in AI-DEMO2.
---

# PingFederate CIMD

CIMD (draft-ietf-oauth-client-id-metadata-document, an IETF draft, not an RFC) makes `client_id` a URL. PingFederate 13.1 fetches the document at that URL during the authorization request, validates it against RFC 7591 rules, and creates an ephemeral client. PingOne does not; AI-DEMO2's PingOne lane is a labelled mock.

Verify every step against `https://docs.pingidentity.com/pingfederate/13.1/administrators_reference_guide/pf_cimd.md` (and `pf_configuring_cimd_settings.md`, `pf_configuring_cimd_policies.md`). A running PingFederate is assumed (`pingfederate-install`).

## Configure

1. **System > OAuth Settings > CIMD Settings:** tick *Enable CIMD*. Cache Minimum/Maximum Lifetime bound how long a fetched document is kept (max 86,400 s); Request/Read Timeout, Maximum Retry Attempts and Maximum Response Size (up to 65,536 bytes) bound the fetch. Keep documents small.
2. **System > OAuth Settings > CIMD Policies:** Add CIMD Policy. Set ID, Name and *Metadata URL*, a pattern matching incoming `client_id` values. It needs a valid scheme and host before any wildcard (for example `https://bff.example.com/api/external-agents/*`). HTTP is only acceptable for loopback. A request matching no enabled policy is rejected.
3. Set the policy defaults new clients inherit: default access token manager, *Require PKCE*, ID token signing algorithm, refresh-token settings, optional DPoP/JARM/signed requests.

## Request shape

Authorization request with `client_id=<the metadata URL>`, `redirect_uri` listed in the document's `redirect_uris`, PKCE. The document must be JSON, its `client_id` equal to its own URL, `token_endpoint_auth_method` `none` for a public client.

## Behaviour to know

- CIMD clients are ephemeral. Expired or no-longer-matching clients are removed lazily, when PingFederate next meets them in a CIMD request.
- PingFederate honours the document's `cache-control` within the administrator limits.
- The docs fetched do not say whether PingFederate advertises `client_id_metadata_document_supported` in its AS metadata. Check the live `/.well-known/openid-configuration` rather than assuming.

## AI-DEMO2

Agent Builder > Connect an external agent runs both lanes. The PingFederate lane needs `pf_ai_cimd_enabled`, the PF endpoint settings, and a CIMD policy matching `https://<public host>/api/external-agents/*`. The document PingFederate fetches is `/api/external-agents/<slug>/pingfederate/client-metadata.json`; each fetch is recorded as evidence.
```

- [ ] **Step 2: Mirror and index**

```bash
mkdir -p se-skills-export/pingfederate-cimd
cp .claude/skills/pingfederate-cimd/SKILL.md se-skills-export/pingfederate-cimd/SKILL.md
```

Add to `se-skills-export/README.md` before the `pingid-ai-demo` row:

```
| [`pingfederate-cimd/`](pingfederate-cimd/) | PingFederate 13.1+ Client ID Metadata Documents: settings, policies, and the AI-DEMO2 external-agent lane |
```

- [ ] **Step 3: Update UC43 wording** in `demo_api_server/config/useCases.js` (the entry with `useCaseId: 'consumer-partner-agent-cimd-registration'`): change only these strings.

  - `buyerStory`: `'Customers bring their own external AI agents. Each agent needs a discoverable registration path that establishes trust, with the real PingFederate CIMD engine shown beside the mock PingOne facade.'`
  - `pingOneSolution`: append ` A second lane registers an external agent through real PingFederate CIMD: the agent starts from RFC 9728 discovery, PingFederate fetches its metadata URL, and the customer consents. Every registration is badged mock or pingfederate.`
  - `whatToSay`: append ` Open Connect an external agent: run discovery, then register the same agent through both engines and compare the badges.`
  - `codeRefs`: add `'demo_api_server/routes/externalAgents.js'` and `'demo_api_server/services/externalAgentCimdService.js'`.

  Do not change `useCaseId`, `expectedOutcome`, `trigger`, or `maturity`.

- [ ] **Step 4: Regenerate and check**

Run: `grep -n "use-cases" demo_api_server/package.json package.json` to get the generator/check script names (`*:gen` / `*:check` per `demo_api_server/CLAUDE.md`), then run the gen script and the check script, each redirected to a file and read (`> /tmp/uc-gen.out 2>&1; echo exit=$?`). Also `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/authRequirements.test.js --forceExit` and `npm run authz:verify` from the repo root.
Expected: gen exit 0 and only the UC43 pages under `docs/use-cases/` change (`git diff --stat` shows `consumer-partner-agent-cimd-registration.md` and, if it lists wording, `audit-table.md`); checks pass. Never hand-edit a generated file.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/pingfederate-cimd/SKILL.md se-skills-export/pingfederate-cimd/SKILL.md se-skills-export/README.md demo_api_server/config/useCases.js docs/use-cases/consumer-partner-agent-cimd-registration.md docs/use-cases/audit-table.md
git commit -m "docs(cimd): pingfederate-cimd skill and UC43 external-agent wording"
```

(Stage only the regenerated files `git status --short` shows; if the generator touched others, stop and inspect why before staging.)

---

### Task 8: Live verification (needs PingFederate 13.1 with CIMD)

**Files:** none (evidence only). Do not skip: unit tests prove shapes, not that PingFederate accepts the document.

- [ ] **Step 1: Configure PingFederate** per `.claude/skills/pingfederate-cimd/SKILL.md`: enable CIMD Settings; add a CIMD Policy with Metadata URL `https://local.ping-devops.com:4000/api/external-agents/*` and *Require PKCE*; set `pf_ai_cimd_enabled=true` and the PF endpoint settings (PF admin work on the local PingFederate only; do not rotate or print any secret).
- [ ] **Step 2: Serve this worktree's code:** `npm run serve:worktree` (status), then `npm run serve:worktree here`. Verify by content, not the report: `docker exec ai-demo-api-server grep -c externalAgentCimdService /app/services/agentRegistryService.js` (adjust path to the bind mount) returns non-zero.
- [ ] **Step 3: Pin the stack generation:** `gen="$(npm run -s stack:generation)"`.
- [ ] **Step 4: Drive the flow** on `https://local.ping-devops.com:4000` with the Super Sports vertical (`tests/e2e/helpers/realLogin.js` + `uiProbe.js`, never `networkidle`): sign in, open `/agent-builder`, Run discovery, Register with Mock PingOne (badge `engine: mock`), Register with PingFederate (PF consent, return with `?external_agent=success`, badge `engine: pingfederate`), open the CIMD guide > Simulate > PingFederate > Run real check.
- [ ] **Step 5: Assert evidence:** `curl -s https://api.ping.demo:3001/api/external-agents/acme-travel-agent/evidence` (with a session cookie) shows a PingFederate fetch entry; the AS metadata flag shown matches `curl -s <pf issuer>/.well-known/openid-configuration | grep client_id_metadata_document_supported` (absent is reported as "not advertised").
- [ ] **Step 6:** `npm run -s stack:generation -- --check "$gen"`. Non-zero means the run is void, redo it; it is not a finding.
- [ ] **Step 7:** Record the outcome (what PingFederate did, whether it advertises CIMD support, any policy/pattern surprises) in the PR description, and if PingFederate rejects the document, fix the document in `externalAgentCimdService.js` with a failing test first. Add any knowingly-left gap to `TECH_DEBT.md`.

---

## Self-Review

**Spec coverage:** Discovery entry (RFC 9728 PRM + challenge + AS check): Task 3. Two lanes, engine badge: Tasks 1, 2, 4, 5. External stand-in agent with distinct path and fetch evidence: Tasks 1, 2. Reuse (not fork) of PF CIMD flow: Task 2. CimdSimPanel engine comparison + selector: Task 6. Agent Builder lane picker: Task 5. Inventory with `engine`: Task 4. `pingfederate-cimd` skill and UC43 SoT wording (no new use-case ID): Task 7. Honesty rules (disabled with reason, never mock-as-real, not-advertised): Tasks 2, 3, 5, 6. Out of scope items (PF token against banking API, login/session changes) are untouched. LibreChat: not in this plan; the spec's Open item 2 is a separate spike after Task 8 (if it works it is a follow-up plan, not a silent addition).

**Placeholder scan:** none; the two "read first" steps (Task 4 test mocking style, Task 5 token names and mount line) name the exact file and what to look for because the answer determines the edit and cannot be known from the spec.

**Type consistency:** `agent` option keys (`pendingKey`, `tokensKey`, `scope`, `clientId(config)`, `redirectUri(config)`, `extra`) match between Task 2's service, route and tests; `metadataPath(slug, engine)`, `metadataDocument(slug, engine, origin)`, `recordFetch/recentFetches(slug, engine)` match across Tasks 1–3; registry row fields in Task 4 match `saveRegistration` record fields from Task 1; UI service names in Task 5 match the Task 6 mock.

**Known risks the executor must watch:** Task 1 mock validation (registry rules may reject the scope; only the mock doc may change); Task 2 must leave `pfAiAgentCimd*` suites green; Task 3's `wellKnown` mount must not shadow the existing PingOne PRM (the existing router only matches `/`).
