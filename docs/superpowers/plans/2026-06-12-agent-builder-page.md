# Agent Builder Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single page (`/agent-builder`) where any logged-in user sees themselves, their AI agent (a PingOne OIDC app), the demo's resources and scopes — and can create/delete their own agent in PingOne, create their own resource servers + custom scopes, and grant scopes to their agent.

**Architecture:** New BFF service (`agentBuilderService.js`) calls the PingOne Management API server-side using the existing worker-token helper `getManagementToken()` from `pingOneClientService.js`. A thin route file exposes six session-authenticated endpoints. The React page is one screen with four zones hydrated by a single `/state` call. Spec: `docs/superpowers/specs/2026-06-12-agent-builder-page-design.md`.

**Tech Stack:** Node/Express (CommonJS), axios, jest (mocked unit tests + `tests/real/` HTTP suite), React (CRA) with `bffAxios`.

---

## Facts established during research (do not re-derive)

- **AI_AGENT is NOT available in this environment.** `GET /environments/{envId}/aiAgents` does not exist (AWS-gateway "Invalid key=value pair…" 403 = unknown route) and the bill of materials has no AI-agents product. Decision: **try `/aiAgents` first, fall back to a standard OIDC app**.
- **WORKER apps cannot receive resource-scope grants** (PingOne rejects POST /grants for WORKERs; see `pingoneProvisionService.js:911`). `client_credentials` is WORKER-only. Therefore the fallback agent app is **`WEB_APP` with `AUTHORIZATION_CODE`** (placeholder redirect URI) so "Apply grants" works.
- **Grant payload shape** (`pingoneProvisionService.js:892`): `POST /applications/{id}/grants` with `{ resource: { id }, scopes: [{ id }, …] }`; update via `PUT /applications/{id}/grants/{grantId}`; remove via `DELETE /applications/{id}/grants/{grantId}`. Scope **ids**, not names — resolve names via `GET /resources/{resourceId}/scopes`.
- **PingOne enforces one scope NAME per app across all grants.** Granting `read` from two different resources is rejected with INVALID_DATA "Multiple scopes with the same name cannot be added…". We surface this as a friendly error; we do not try to outsmart it.
- **Resource creation** (`pingoneProvisionService.js:399`): `POST /resources` with `{ name, description, type: 'CUSTOM', audience }` — `audience` is a **string**, not an array. Scopes: `POST /resources/{id}/scopes` with `{ name, description, schema: 'urn:pingone:common:scope' }`.
- **Worker token:** reuse `getManagementToken()` from `demo_api_server/services/pingOneClientService.js` (exported). Env/region via `configStore.getEffective('PINGONE_ENVIRONMENT_ID')` / `('PINGONE_REGION') || 'com'`. API base: `https://api.pingone.${region}/v1/environments/${envId}`.
- **Session auth:** `requireSession` exported from `demo_api_server/middleware/auth.js` (401 `{error:'unauthenticated'}` when `req.session.user` missing).
- **Session user shape:** the dataStore user record — `{ id, username, email, firstName, lastName, role, oauthId }`. `oauthId` is the PingOne sub (may be absent for non-OAuth logins → fall back to `id`).
- **Resource classification:** list `GET /resources?limit=100`; `type === 'CUSTOM'` resources are the demo's topology-provisioned ones; among those, a `description` starting with the builder marker = user-created (filter by owner key). Non-CUSTOM (`openid`, PingOne API) are excluded.
- **Nav:** append the new item at the **END** of `allNavItems` in `AdminSideNav.jsx` — the `sections` auto-expand map uses positional indices (`adminIdx`/`customerIdx`); inserting anywhere else shifts them. Do not touch icons/CSS/renderIcon (sidebar frozen).
- **Jest from a worktree:** `demo_api_server` jest ignores `.claude/worktrees` — run unit tests as
  `npx jest --testPathIgnorePatterns='=' --testPathPattern='agentBuilder'` from `demo_api_server/`.
- **Pre-commit hook** wants a `CHANGELOG.md` line under `[Unreleased]` (warning-only, but add it in the final task).
- All work happens in the worktree `/Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design` (branch `worktree-agent-builder-page-design`). Stage files explicitly; verify `git branch --show-current` before each commit.

## File structure

| File | Responsibility |
| --- | --- |
| Create `demo_api_server/services/agentBuilderService.js` | All Management-API logic: naming/marker, find/create/delete agent, list/create/delete user resources, get/set grants |
| Create `demo_api_server/src/__tests__/agentBuilderService.test.js` | Mocked unit tests for the service |
| Create `demo_api_server/routes/agentBuilder.js` | Six thin endpoints; session auth; error mapping |
| Modify `demo_api_server/server.js` (~line 1140) | Mount `/api/agent-builder` |
| Create `demo_api_ui/src/services/agentBuilderService.js` | bffAxios client wrappers |
| Create `demo_api_ui/src/components/AgentBuilderPage.jsx` + `.css` | The page: chain strip + 3 card zones |
| Modify `demo_api_ui/src/App.js` (~line 567) | `<Route path="/agent-builder">` |
| Modify `demo_api_ui/src/components/AdminSideNav.jsx` (end of `allNavItems`) | Nav item |
| Create `demo_api_server/tests/real/shared/agentBuilder.real.spec.js` | Real HTTP round-trip incl. PingOne create/delete + cleanup |
| Modify `CHANGELOG.md` | `[Unreleased]` → Added line |

---

### Task 1: `agentBuilderService` — agent find / create / delete

**Files:**
- Create: `demo_api_server/services/agentBuilderService.js`
- Test: `demo_api_server/src/__tests__/agentBuilderService.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// demo_api_server/src/__tests__/agentBuilderService.test.js
'use strict';

jest.mock('axios');
jest.mock('../../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('mock-mgmt-token'),
}));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => ({
    PINGONE_ENVIRONMENT_ID: 'env-123',
    PINGONE_REGION: 'com',
    PUBLIC_APP_URL: 'https://api.ping.demo:4000',
  })[key]),
}));

const axios = require('axios');
const svc = require('../../services/agentBuilderService');

const USER = { id: 'u1', username: 'demoUser', email: 'demoUser@demo.test', oauthId: 'sub-abc' };
const BASE = 'https://api.pingone.com/v1/environments/env-123';

// Helper: axios.get/post/delete are mocked per-URL via implementation maps.
function mockGet(map) {
  axios.get.mockImplementation((url) => {
    for (const [frag, val] of Object.entries(map)) {
      if (url.includes(frag)) return Promise.resolve({ data: val });
    }
    return Promise.reject(Object.assign(new Error('404'), { response: { status: 404, data: {} } }));
  });
}

beforeEach(() => jest.clearAllMocks());

describe('agent naming + lookup', () => {
  test('agentName is deterministic per user', () => {
    expect(svc.agentName(USER)).toBe('AI Agent - demoUser');
  });

  test('getAgentForUser returns null when no app matches', async () => {
    mockGet({ '/applications': { _embedded: { applications: [{ name: 'Other', description: '' }] } } });
    expect(await svc.getAgentForUser(USER)).toBeNull();
  });

  test('getAgentForUser returns summary when marked app exists', async () => {
    mockGet({
      '/applications': { _embedded: { applications: [{
        id: 'app-1', name: 'AI Agent - demoUser', type: 'WEB_APP',
        description: 'Created by Agent Builder for sub-abc',
        grantTypes: ['AUTHORIZATION_CODE'], tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
        createdAt: '2026-06-12T00:00:00Z', enabled: true,
      }] } },
    });
    const agent = await svc.getAgentForUser(USER);
    expect(agent).toMatchObject({ id: 'app-1', type: 'WEB_APP', fallback: true });
  });
});

describe('createAgentForUser', () => {
  test('falls back to WEB_APP when /aiAgents route does not exist', async () => {
    mockGet({ '/applications': { _embedded: { applications: [] } } });
    axios.post.mockImplementation((url, body) => {
      if (url.includes('/aiAgents')) {
        return Promise.reject(Object.assign(new Error('no route'), {
          response: { status: 403, data: { message: "Invalid key=value pair (missing equal-sign) in Authorization header" } },
        }));
      }
      if (url.includes('/applications')) {
        return Promise.resolve({ data: { id: 'app-new', ...body } });
      }
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
    const result = await svc.createAgentForUser(USER);
    expect(result.created).toBe(true);
    expect(result.agent.fallback).toBe(true);
    const appCall = axios.post.mock.calls.find(([url]) => url.includes('/applications'));
    expect(appCall[1]).toMatchObject({
      name: 'AI Agent - demoUser',
      type: 'WEB_APP',
      protocol: 'OPENID_CONNECT',
      grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN'],
      responseTypes: ['CODE'],
      tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
      description: 'Created by Agent Builder for sub-abc',
    });
  });

  test('is idempotent — returns existing agent with created:false and does not POST', async () => {
    mockGet({ '/applications': { _embedded: { applications: [{
      id: 'app-1', name: 'AI Agent - demoUser', type: 'WEB_APP',
      description: 'Created by Agent Builder for sub-abc',
    }] } } });
    const result = await svc.createAgentForUser(USER);
    expect(result.created).toBe(false);
    expect(result.agent.id).toBe('app-1');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('deleteAgentForUser', () => {
  test('refuses to delete an app without the builder marker', async () => {
    mockGet({ '/applications': { _embedded: { applications: [{
      id: 'app-x', name: 'AI Agent - demoUser', description: 'Provisioned by bootstrap',
    }] } } });
    await expect(svc.deleteAgentForUser(USER)).rejects.toMatchObject({ code: 'forbidden' });
    expect(axios.delete).not.toHaveBeenCalled();
  });

  test('deletes a marked app', async () => {
    mockGet({ '/applications': { _embedded: { applications: [{
      id: 'app-1', name: 'AI Agent - demoUser',
      description: 'Created by Agent Builder for sub-abc',
    }] } } });
    axios.delete.mockResolvedValue({ data: {} });
    await svc.deleteAgentForUser(USER);
    expect(axios.delete).toHaveBeenCalledWith(
      `${BASE}/applications/app-1`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer mock-mgmt-token' }) })
    );
  });

  test('throws not_found when user has no agent', async () => {
    mockGet({ '/applications': { _embedded: { applications: [] } } });
    await expect(svc.deleteAgentForUser(USER)).rejects.toMatchObject({ code: 'not_found' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `demo_api_server/`, worktree path):
```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design/demo_api_server
npx jest --testPathIgnorePatterns='=' --testPathPattern='agentBuilderService'
```
Expected: FAIL — `Cannot find module '../../services/agentBuilderService'`.

- [ ] **Step 3: Write the service (agent half)**

```js
// demo_api_server/services/agentBuilderService.js
/**
 * agentBuilderService.js
 *
 * Self-service per-user agent identity in PingOne, for the /agent-builder page.
 * All Management API calls run server-side with the worker token — the browser
 * never sees PingOne credentials. Every object this service creates carries a
 * description marker including the owner's sub; the marker is the ownership
 * guard on every delete path, so topology/provisioned objects are untouchable
 * from this page.
 *
 * AI_AGENT availability: this environment does not license the first-class
 * AI agent type (probed 2026-06-12 — /aiAgents route absent, BOM has no AI
 * product). createAgentForUser() tries POST /aiAgents first and falls back to
 * a standard OIDC WEB_APP. WEB_APP (not WORKER) because PingOne forbids
 * resource-scope grants on WORKER apps, which would break "Apply grants".
 */
'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const { getManagementToken } = require('./pingOneClientService');

const BUILDER_MARKER = 'Created by Agent Builder for ';

function ownerKey(user) {
  return user.oauthId || user.id;
}

function displayName(user) {
  return user.username || String(user.email || 'user').split('@')[0];
}

function agentName(user) {
  return `AI Agent - ${displayName(user)}`;
}

function markerFor(user) {
  return `${BUILDER_MARKER}${ownerKey(user)}`;
}

function ownsObject(user, obj) {
  return typeof obj.description === 'string' && obj.description.startsWith(BUILDER_MARKER)
    && obj.description.includes(ownerKey(user));
}

function apiBase() {
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  if (!envId) throw new Error('PINGONE_ENVIRONMENT_ID not configured');
  return `https://api.pingone.${region}/v1/environments/${envId}`;
}

async function authHeaders() {
  const token = await getManagementToken();
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Unknown PingOne routes surface as 404, or as the AWS-gateway 403
 *  "Invalid key=value pair…" — both mean "this surface doesn't exist here". */
function isRouteUnavailable(err) {
  const status = err.response?.status;
  const msg = String(err.response?.data?.message || '');
  return status === 404 || (status === 403 && msg.includes('Invalid key=value pair'));
}

function summarizeAgent(app) {
  return {
    id: app.id,
    name: app.name,
    type: app.type || 'AI_AGENT',
    enabled: app.enabled !== false,
    grantTypes: app.grantTypes || [],
    tokenEndpointAuthMethod: app.tokenEndpointAuthMethod || null,
    createdAt: app.createdAt || null,
    fallback: (app.type || 'AI_AGENT') !== 'AI_AGENT',
  };
}

async function listApplicationsRaw(headers) {
  const res = await axios.get(`${apiBase()}/applications?limit=100`, { headers, timeout: 20000 });
  return res.data?._embedded?.applications || [];
}

/** AI agents live on their own surface when licensed; [] when the route is absent. */
async function listAiAgentsRaw(headers) {
  try {
    const res = await axios.get(`${apiBase()}/aiAgents?limit=100`, { headers, timeout: 20000 });
    return res.data?._embedded?.aiAgents || [];
  } catch (err) {
    if (isRouteUnavailable(err)) return [];
    throw err;
  }
}

async function findAgentRaw(user, headers) {
  const name = agentName(user);
  const agents = await listAiAgentsRaw(headers);
  const aiHit = agents.find((a) => a.name === name);
  if (aiHit) return { ...aiHit, type: aiHit.type || 'AI_AGENT', _surface: 'aiAgents' };
  const apps = await listApplicationsRaw(headers);
  const hit = apps.find((a) => a.name === name);
  return hit ? { ...hit, _surface: 'applications' } : null;
}

async function getAgentForUser(user) {
  const headers = await authHeaders();
  const raw = await findAgentRaw(user, headers);
  return raw ? summarizeAgent(raw) : null;
}

async function createAgentForUser(user) {
  const headers = await authHeaders();
  const existing = await findAgentRaw(user, headers);
  if (existing) return { created: false, agent: summarizeAgent(existing) };

  const name = agentName(user);
  const description = markerFor(user);

  // First choice: the first-class AI agent surface.
  try {
    const res = await axios.post(`${apiBase()}/aiAgents`, { name, description }, { headers, timeout: 20000 });
    return { created: true, agent: summarizeAgent({ ...res.data, type: res.data.type || 'AI_AGENT' }) };
  } catch (err) {
    if (!isRouteUnavailable(err)) throw err;
  }

  // Fallback: standard OIDC WEB_APP (grant-capable; WORKER apps can't hold
  // resource-scope grants and client_credentials is WORKER-only).
  const publicUrl = configStore.getEffective('PUBLIC_APP_URL') || 'https://localhost:3000';
  const payload = {
    name,
    description,
    enabled: true,
    type: 'WEB_APP',
    protocol: 'OPENID_CONNECT',
    grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN'],
    responseTypes: ['CODE'],
    redirectUris: [`${publicUrl.replace(/\/$/, '')}/agent-builder/callback`],
    tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
    pkceEnforcement: 'OPTIONAL',
  };
  const res = await axios.post(`${apiBase()}/applications`, payload, { headers, timeout: 20000 });
  return { created: true, agent: summarizeAgent(res.data) };
}

async function deleteAgentForUser(user) {
  const headers = await authHeaders();
  const raw = await findAgentRaw(user, headers);
  if (!raw) throw Object.assign(new Error('No agent to delete'), { code: 'not_found' });
  if (!ownsObject(user, raw)) {
    throw Object.assign(new Error('Refusing to delete: app was not created by Agent Builder for this user'), { code: 'forbidden' });
  }
  const surface = raw._surface === 'aiAgents' ? 'aiAgents' : 'applications';
  await axios.delete(`${apiBase()}/${surface}/${raw.id}`, { headers, timeout: 20000 });
}

module.exports = {
  BUILDER_MARKER,
  agentName,
  getAgentForUser,
  createAgentForUser,
  deleteAgentForUser,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Same command as Step 2. Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design
git branch --show-current   # must print worktree-agent-builder-page-design
git add demo_api_server/services/agentBuilderService.js demo_api_server/src/__tests__/agentBuilderService.test.js
git commit -m "feat(agent-builder): service — per-user agent create/find/delete with ownership guard"
```

---

### Task 2: `agentBuilderService` — resources and grants

**Files:**
- Modify: `demo_api_server/services/agentBuilderService.js` (append before `module.exports`, extend exports)
- Test: `demo_api_server/src/__tests__/agentBuilderService.test.js` (append)

- [ ] **Step 1: Append the failing tests**

```js
// Append to demo_api_server/src/__tests__/agentBuilderService.test.js

describe('resources', () => {
  const RESOURCES = { _embedded: { resources: [
    { id: 'r-openid', name: 'openid', type: 'OPENID_CONNECT' },
    { id: 'r-demo', name: 'Banking API', type: 'CUSTOM', description: 'Demo resource', audience: 'api.ping.demo' },
    { id: 'r-mine', name: 'demoUser - Weather', type: 'CUSTOM', description: 'Created by Agent Builder for sub-abc', audience: 'weather' },
    { id: 'r-theirs', name: 'bob - Stocks', type: 'CUSTOM', description: 'Created by Agent Builder for sub-bob', audience: 'stocks' },
  ] } };
  const SCOPES = (names) => ({ _embedded: { scopes: names.map((n, i) => ({ id: `s-${n}-${i}`, name: n })) } });

  test('listResourcesForUser: CUSTOM only, marks ownership, excludes other users', async () => {
    mockGet({
      '/resources?limit=100': RESOURCES,
      '/resources/r-demo/scopes': SCOPES(['read', 'write', 'admin']),
      '/resources/r-mine/scopes': SCOPES(['read', 'forecast']),
    });
    const out = await svc.listResourcesForUser(USER);
    expect(out.map((r) => r.id).sort()).toEqual(['r-demo', 'r-mine']);
    expect(out.find((r) => r.id === 'r-demo').ownedByUser).toBe(false);
    expect(out.find((r) => r.id === 'r-mine').ownedByUser).toBe(true);
    expect(out.find((r) => r.id === 'r-mine').scopes).toEqual(['read', 'forecast']);
  });

  test('createUserResource creates resource + scopes with marker', async () => {
    mockGet({ '/resources?limit=100': { _embedded: { resources: [] } } });
    axios.post.mockImplementation((url) => {
      if (url.endsWith('/resources')) return Promise.resolve({ data: { id: 'r-new', name: 'demoUser - Weather' } });
      if (url.includes('/resources/r-new/scopes')) return Promise.resolve({ data: { id: 's-new' } });
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
    const res = await svc.createUserResource(USER, { name: 'Weather', audience: 'weather-api', scopes: ['read', 'forecast'] });
    expect(res.resource.id).toBe('r-new');
    const resourceCall = axios.post.mock.calls.find(([url]) => url.endsWith('/resources'));
    expect(resourceCall[1]).toMatchObject({
      name: 'demoUser - Weather', type: 'CUSTOM', audience: 'weather-api',
      description: 'Created by Agent Builder for sub-abc',
    });
    const scopeCalls = axios.post.mock.calls.filter(([url]) => url.includes('/scopes'));
    expect(scopeCalls).toHaveLength(2);
  });

  test('createUserResource rejects bad names', async () => {
    await expect(svc.createUserResource(USER, { name: 'a'.repeat(50), scopes: ['read'] }))
      .rejects.toMatchObject({ code: 'invalid' });
  });

  test('deleteUserResource refuses unowned resource', async () => {
    mockGet({ '/resources/r-theirs': { id: 'r-theirs', description: 'Created by Agent Builder for sub-bob' } });
    await expect(svc.deleteUserResource(USER, 'r-theirs')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('grants', () => {
  test('getAgentGrants resolves scope ids to names per resource', async () => {
    mockGet({
      '/applications/app-1/grants': { _embedded: { grants: [
        { id: 'g1', resource: { id: 'r-demo' }, scopes: [{ id: 's-read-0' }] },
      ] } },
      '/resources/r-demo/scopes': { _embedded: { scopes: [{ id: 's-read-0', name: 'read' }, { id: 's-write-1', name: 'write' }] } },
    });
    const grants = await svc.getAgentGrants('app-1');
    expect(grants).toEqual({ 'r-demo': ['read'] });
  });

  test('setAgentGrants creates, replaces, and removes grants to match desired state', async () => {
    mockGet({
      '/applications/app-1/grants': { _embedded: { grants: [
        { id: 'g1', resource: { id: 'r-old' }, scopes: [{ id: 's-x' }] },
        { id: 'g2', resource: { id: 'r-keep' }, scopes: [{ id: 's-read-0' }] },
      ] } },
      '/resources/r-keep/scopes': { _embedded: { scopes: [{ id: 's-read-0', name: 'read' }, { id: 's-write-1', name: 'write' }] } },
      '/resources/r-new/scopes': { _embedded: { scopes: [{ id: 's-read-9', name: 'read' }] } },
    });
    axios.put.mockResolvedValue({ data: {} });
    axios.post.mockResolvedValue({ data: {} });
    axios.delete.mockResolvedValue({ data: {} });

    await svc.setAgentGrants('app-1', [
      { resourceId: 'r-keep', scopes: ['read', 'write'] },  // existing → PUT merged set
      { resourceId: 'r-new', scopes: ['read'] },             // new → POST
    ]);

    expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/applications/app-1/grants/g1'), expect.anything());
    expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining('/applications/app-1/grants/g2'),
      { resource: { id: 'r-keep' }, scopes: [{ id: 's-read-0' }, { id: 's-write-1' }] },
      expect.anything()
    );
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/applications/app-1/grants'),
      { resource: { id: 'r-new' }, scopes: [{ id: 's-read-9' }] },
      expect.anything()
    );
  });

  test('setAgentGrants maps duplicate-scope-name rejection to a friendly error', async () => {
    mockGet({
      '/applications/app-1/grants': { _embedded: { grants: [] } },
      '/resources/r-a/scopes': { _embedded: { scopes: [{ id: 's1', name: 'read' }] } },
    });
    axios.post.mockRejectedValue(Object.assign(new Error('400'), {
      response: { status: 400, data: { code: 'INVALID_DATA', details: [{ message: 'Multiple scopes with the same name cannot be added to the same grant.' }] } },
    }));
    await expect(svc.setAgentGrants('app-1', [{ resourceId: 'r-a', scopes: ['read'] }]))
      .rejects.toMatchObject({ code: 'duplicate_scope_name' });
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design/demo_api_server
npx jest --testPathIgnorePatterns='=' --testPathPattern='agentBuilderService'
```
Expected: FAIL — `svc.listResourcesForUser is not a function` (and similar).

- [ ] **Step 3: Append the implementation**

```js
// Append to demo_api_server/services/agentBuilderService.js (before module.exports)

const RESOURCE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,39}$/;
const SCOPE_NAME_RE = /^[a-z][a-z0-9:_-]{0,39}$/;

async function listResourceScopes(resourceId, headers) {
  const res = await axios.get(`${apiBase()}/resources/${resourceId}/scopes`, { headers, timeout: 20000 });
  return res.data?._embedded?.scopes || [];
}

/** CUSTOM resources only (topology-provisioned + this user's own). Other
 *  users' builder-created resources are hidden. */
async function listResourcesForUser(user) {
  const headers = await authHeaders();
  const res = await axios.get(`${apiBase()}/resources?limit=100`, { headers, timeout: 20000 });
  const all = res.data?._embedded?.resources || [];
  const custom = all.filter((r) => r.type === 'CUSTOM');
  const visible = custom.filter((r) => {
    const isBuilderCreated = typeof r.description === 'string' && r.description.startsWith(BUILDER_MARKER);
    return !isBuilderCreated || ownsObject(user, r);
  });
  return Promise.all(visible.map(async (r) => ({
    id: r.id,
    name: r.name,
    audience: r.audience || null,
    ownedByUser: ownsObject(user, r),
    scopes: (await listResourceScopes(r.id, headers)).map((s) => s.name),
  })));
}

async function createUserResource(user, { name, audience, scopes }) {
  if (!RESOURCE_NAME_RE.test(String(name || ''))) {
    throw Object.assign(new Error('Resource name must be 2-40 chars: letters, digits, space, _ . -'), { code: 'invalid' });
  }
  const scopeNames = (scopes && scopes.length ? scopes : ['read', 'write', 'admin']).map(String);
  for (const s of scopeNames) {
    if (!SCOPE_NAME_RE.test(s)) {
      throw Object.assign(new Error(`Invalid scope name "${s}" (lowercase, may contain digits : _ -)`), { code: 'invalid' });
    }
  }
  const headers = await authHeaders();
  const fullName = `${displayName(user)} - ${name}`;

  // Idempotent by (user, name).
  const existingList = (await axios.get(`${apiBase()}/resources?limit=100`, { headers, timeout: 20000 }))
    .data?._embedded?.resources || [];
  const existing = existingList.find((r) => r.name === fullName && ownsObject(user, r));
  if (existing) return { created: false, resource: existing };

  const res = await axios.post(`${apiBase()}/resources`, {
    name: fullName,
    description: markerFor(user),
    type: 'CUSTOM',
    audience: audience || fullName.toLowerCase().replace(/[^a-z0-9.-]+/g, '-'),
  }, { headers, timeout: 20000 });
  const resource = res.data;

  for (const scopeName of scopeNames) {
    await axios.post(`${apiBase()}/resources/${resource.id}/scopes`, {
      name: scopeName,
      description: `Scope: ${scopeName}`,
      schema: 'urn:pingone:common:scope',
    }, { headers, timeout: 20000 });
  }
  return { created: true, resource };
}

async function deleteUserResource(user, resourceId) {
  const headers = await authHeaders();
  const res = await axios.get(`${apiBase()}/resources/${resourceId}`, { headers, timeout: 20000 });
  if (!ownsObject(user, res.data)) {
    throw Object.assign(new Error('Refusing to delete: resource was not created by Agent Builder for this user'), { code: 'forbidden' });
  }
  await axios.delete(`${apiBase()}/resources/${resourceId}`, { headers, timeout: 20000 });
}

/** { [resourceId]: [scopeName, …] } currently granted to the app. */
async function getAgentGrants(appId) {
  const headers = await authHeaders();
  const grants = (await axios.get(`${apiBase()}/applications/${appId}/grants`, { headers, timeout: 20000 }))
    .data?._embedded?.grants || [];
  const out = {};
  for (const g of grants) {
    const rid = g.resource?.id;
    if (!rid) continue;
    const scopeList = await listResourceScopes(rid, headers);
    const nameById = new Map(scopeList.map((s) => [s.id, s.name]));
    out[rid] = (g.scopes || []).map((s) => nameById.get(s.id)).filter(Boolean);
  }
  return out;
}

/**
 * Replace semantics: after this call the app's grants match `desired` exactly.
 * desired: [{ resourceId, scopes: [name, …] }] — entries with empty scopes are
 * treated as "no grant for that resource".
 */
async function setAgentGrants(appId, desired) {
  const headers = await authHeaders();
  const wanted = (desired || []).filter((d) => (d.scopes || []).length > 0);
  const wantedByResource = new Map(wanted.map((d) => [d.resourceId, d.scopes]));

  const existing = (await axios.get(`${apiBase()}/applications/${appId}/grants`, { headers, timeout: 20000 }))
    .data?._embedded?.grants || [];
  const existingByResource = new Map(existing.map((g) => [g.resource?.id, g]));

  try {
    // Remove grants for resources no longer wanted.
    for (const g of existing) {
      if (!wantedByResource.has(g.resource?.id)) {
        await axios.delete(`${apiBase()}/applications/${appId}/grants/${g.id}`, { headers, timeout: 20000 });
      }
    }
    // Create or replace the wanted ones.
    for (const d of wanted) {
      const scopeList = await listResourceScopes(d.resourceId, headers);
      const idByName = new Map(scopeList.map((s) => [s.name, s.id]));
      const scopeIds = d.scopes.map((n) => idByName.get(n)).filter(Boolean).map((id) => ({ id }));
      if (scopeIds.length === 0) continue;
      const payload = { resource: { id: d.resourceId }, scopes: scopeIds };
      const match = existingByResource.get(d.resourceId);
      if (match) {
        await axios.put(`${apiBase()}/applications/${appId}/grants/${match.id}`, payload, { headers, timeout: 20000 });
      } else {
        await axios.post(`${apiBase()}/applications/${appId}/grants`, payload, { headers, timeout: 20000 });
      }
    }
  } catch (err) {
    // PingOne global rule: one scope NAME per app across all grants.
    const detail = JSON.stringify(err.response?.data || {});
    if (err.response?.status === 400 && detail.includes('Multiple scopes with the same name')) {
      throw Object.assign(
        new Error('PingOne allows each scope name to be granted from only ONE resource per application. Uncheck the duplicate scope name on the other resource first.'),
        { code: 'duplicate_scope_name' }
      );
    }
    throw err;
  }
}
```

And extend `module.exports`:

```js
module.exports = {
  BUILDER_MARKER,
  agentName,
  getAgentForUser,
  createAgentForUser,
  deleteAgentForUser,
  listResourcesForUser,
  createUserResource,
  deleteUserResource,
  getAgentGrants,
  setAgentGrants,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design
git branch --show-current
git add demo_api_server/services/agentBuilderService.js demo_api_server/src/__tests__/agentBuilderService.test.js
git commit -m "feat(agent-builder): service — user resources + replace-semantics scope grants"
```

---

### Task 3: BFF routes + server mount

**Files:**
- Create: `demo_api_server/routes/agentBuilder.js`
- Modify: `demo_api_server/server.js` (after the `demoProvisioningRoutes` mount, ~line 1140)

- [ ] **Step 1: Write the route file**

```js
// demo_api_server/routes/agentBuilder.js
/**
 * /api/agent-builder — self-service per-user agent identity (AgentBuilderPage).
 * Session-authenticated (any logged-in user); Management API calls run
 * server-side in agentBuilderService with the worker token.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { requireSession } = require('../middleware/auth');
const svc = require('../services/agentBuilderService');

router.use(requireSession);

function sendError(res, err) {
  if (err.code === 'invalid') return res.status(400).json({ error: 'invalid', message: err.message });
  if (err.code === 'forbidden') return res.status(403).json({ error: 'forbidden', message: err.message });
  if (err.code === 'not_found') return res.status(404).json({ error: 'not_found', message: err.message });
  if (err.code === 'duplicate_scope_name') return res.status(409).json({ error: 'duplicate_scope_name', message: err.message });
  const pingone = err.response?.data;
  console.error('[agent-builder]', err.message, pingone ? JSON.stringify(pingone).slice(0, 500) : '');
  return res.status(502).json({
    error: 'pingone_error',
    message: pingone?.details?.[0]?.message || pingone?.message || err.message,
  });
}

// GET /api/agent-builder/state — hydrate the whole page in one call.
router.get('/state', async (req, res) => {
  try {
    const user = req.session.user;
    const [agent, resources] = await Promise.all([
      svc.getAgentForUser(user),
      svc.listResourcesForUser(user),
    ]);
    const granted = agent ? await svc.getAgentGrants(agent.id) : {};
    res.json({
      user: { username: user.username, email: user.email, sub: user.oauthId || user.id },
      agent,
      resources: resources.map((r) => ({ ...r, granted: granted[r.id] || [] })),
    });
  } catch (err) { sendError(res, err); }
});

router.post('/agent', async (req, res) => {
  try {
    const result = await svc.createAgentForUser(req.session.user);
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) { sendError(res, err); }
});

router.delete('/agent', async (req, res) => {
  try {
    await svc.deleteAgentForUser(req.session.user);
    res.json({ deleted: true });
  } catch (err) { sendError(res, err); }
});

// PUT /api/agent-builder/grants  { grants: [{ resourceId, scopes: [name] }] }
router.put('/grants', async (req, res) => {
  try {
    const agent = await svc.getAgentForUser(req.session.user);
    if (!agent) return res.status(404).json({ error: 'not_found', message: 'Build your agent first.' });
    await svc.setAgentGrants(agent.id, req.body?.grants || []);
    res.json({ applied: true });
  } catch (err) { sendError(res, err); }
});

// POST /api/agent-builder/resources  { name, audience?, scopes?: [name] }
router.post('/resources', async (req, res) => {
  try {
    const { name, audience, scopes } = req.body || {};
    const result = await svc.createUserResource(req.session.user, { name, audience, scopes });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) { sendError(res, err); }
});

router.delete('/resources/:id', async (req, res) => {
  try {
    await svc.deleteUserResource(req.session.user, req.params.id);
    res.json({ deleted: true });
  } catch (err) { sendError(res, err); }
});

module.exports = router;
```

- [ ] **Step 2: Mount in server.js**

In `demo_api_server/server.js`, directly after the `app.use('/api/demo', express.json(), demoProvisioningRoutes);` line (~1140), add:

```js
app.use('/api/agent-builder', express.json(), require('./routes/agentBuilder')); // AgentBuilderPage — self-service per-user agent identity
```

- [ ] **Step 3: Smoke-check route registration**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design/demo_api_server
node -e "require('./routes/agentBuilder'); console.log('route file loads OK')"
```
Expected: `route file loads OK` (no missing-module errors).

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design
git branch --show-current
git add demo_api_server/routes/agentBuilder.js demo_api_server/server.js
git commit -m "feat(agent-builder): session-authenticated /api/agent-builder routes"
```

---

### Task 4: UI API client

**Files:**
- Create: `demo_api_ui/src/services/agentBuilderService.js`

- [ ] **Step 1: Write the client**

```js
// demo_api_ui/src/services/agentBuilderService.js
// Thin bffAxios wrappers for /api/agent-builder (AgentBuilderPage).
import bffAxios from './bffAxios';

export async function fetchState() {
  const { data } = await bffAxios.get('/api/agent-builder/state');
  return data;
}

export async function buildAgent() {
  const { data } = await bffAxios.post('/api/agent-builder/agent');
  return data;
}

export async function deleteAgent() {
  const { data } = await bffAxios.delete('/api/agent-builder/agent');
  return data;
}

export async function applyGrants(grants) {
  const { data } = await bffAxios.put('/api/agent-builder/grants', { grants });
  return data;
}

export async function createResource({ name, audience, scopes }) {
  const { data } = await bffAxios.post('/api/agent-builder/resources', { name, audience, scopes });
  return data;
}

export async function deleteResource(id) {
  const { data } = await bffAxios.delete(`/api/agent-builder/resources/${id}`);
  return data;
}

/** Normalize axios errors to the BFF's { error, message } body. */
export function errorMessage(err) {
  return err?.response?.data?.message || err?.message || 'Request failed';
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design
git branch --show-current
git add demo_api_ui/src/services/agentBuilderService.js
git commit -m "feat(agent-builder): UI API client"
```

---

### Task 5: AgentBuilderPage component + CSS

**Files:**
- Create: `demo_api_ui/src/components/AgentBuilderPage.jsx`
- Create: `demo_api_ui/src/components/AgentBuilderPage.css`

Layout contract (one screen, top to bottom): chain strip → You card → Your AI Agent card → Resources & scopes card. All mutation handlers: set busy flag → call API → `refresh()` (re-fetch `/state`) → clear busy; errors land in a per-zone `error` string rendered as a solid high-contrast banner (`.ab-error` — no muted gray, house rule).

- [ ] **Step 1: Write the component**

```jsx
// demo_api_ui/src/components/AgentBuilderPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchState, buildAgent, deleteAgent, applyGrants,
  createResource, deleteResource, errorMessage,
} from '../services/agentBuilderService';
import './AgentBuilderPage.css';

/**
 * AgentBuilderPage — /agent-builder (any logged-in user).
 * One page: you → your AI agent (PingOne OIDC app) → resources & scopes.
 * Creates real objects in PingOne via the BFF (worker token stays server-side).
 */
export default function AgentBuilderPage() {
  const [state, setState] = useState(null);        // { user, agent, resources }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);          // 'agent' | 'grants' | 'resource' | resourceId
  const [agentError, setAgentError] = useState('');
  const [grantsError, setGrantsError] = useState('');
  const [resourceError, setResourceError] = useState('');
  const [checked, setChecked] = useState({});      // { [resourceId]: Set-like {scopeName: true} }
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [form, setForm] = useState({ name: '', audience: '', scopes: 'read, write, admin' });

  const refresh = useCallback(async () => {
    const data = await fetchState();
    setState(data);
    const initial = {};
    for (const r of data.resources) {
      initial[r.id] = Object.fromEntries(r.granted.map((s) => [s, true]));
    }
    setChecked(initial);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setAgentError(errorMessage(e))).finally(() => setLoading(false));
  }, [refresh]);

  const dirty = useMemo(() => {
    if (!state) return false;
    return state.resources.some((r) => {
      const want = Object.keys(checked[r.id] || {}).filter((s) => checked[r.id][s]).sort().join(',');
      return want !== [...r.granted].sort().join(',');
    });
  }, [state, checked]);

  const run = (zoneSetter, key, fn) => async () => {
    zoneSetter(''); setBusy(key);
    try { await fn(); await refresh(); }
    catch (e) { zoneSetter(errorMessage(e)); }
    finally { setBusy(null); }
  };

  const onBuild = run(setAgentError, 'agent', () => buildAgent());
  const onDelete = run(setAgentError, 'agent', async () => { await deleteAgent(); setShowDeleteConfirm(false); });
  const onApplyGrants = run(setGrantsError, 'grants', () => applyGrants(
    state.resources.map((r) => ({
      resourceId: r.id,
      scopes: Object.keys(checked[r.id] || {}).filter((s) => checked[r.id][s]),
    }))
  ));
  const onCreateResource = run(setResourceError, 'resource', () => createResource({
    name: form.name.trim(),
    audience: form.audience.trim() || undefined,
    scopes: form.scopes.split(',').map((s) => s.trim()).filter(Boolean),
  }).then(() => setForm({ name: '', audience: '', scopes: 'read, write, admin' })));

  if (loading) return <div className="ab-page"><div className="ab-loading">Loading Agent Builder…</div></div>;
  if (!state) return <div className="ab-page"><div className="ab-error">{agentError || 'Failed to load.'}</div></div>;

  const { user, agent, resources } = state;
  const demoResources = resources.filter((r) => !r.ownedByUser);
  const myResources = resources.filter((r) => r.ownedByUser);
  const grantedCount = resources.reduce((n, r) => n + r.granted.length, 0);

  const toggle = (rid, scope) => setChecked((c) => ({
    ...c, [rid]: { ...(c[rid] || {}), [scope]: !(c[rid] || {})[scope] },
  }));

  const scopeRow = (r) => (
    <div className="ab-resource" key={r.id}>
      <div className="ab-resource-head">
        <span className="ab-resource-name">{r.name}</span>
        {r.audience && <code className="ab-aud">aud: {r.audience}</code>}
        {r.ownedByUser && (
          <button className="ab-btn ab-btn-danger ab-btn-sm" disabled={busy === r.id}
            onClick={run(setResourceError, r.id, () => deleteResource(r.id))}>
            {busy === r.id ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
      <div className="ab-scopes">
        {r.scopes.map((s) => (
          <label className="ab-scope" key={s}>
            <input type="checkbox" disabled={!agent || busy === 'grants'}
              checked={!!(checked[r.id] || {})[s]} onChange={() => toggle(r.id, s)} />
            <code>{s}</code>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="ab-page">
      <h1>Agent Builder</h1>
      <p className="ab-intro">
        Build your own AI agent identity in PingOne, then decide exactly which resources and
        scopes it may use. This is the same identity model the demo's agent runs on.
      </p>

      {/* Zone 1 — identity chain strip */}
      <div className="ab-chain">
        <div className="ab-node ab-node-on">
          <div className="ab-node-label">You</div>
          <div className="ab-node-value">{user.username || user.email}</div>
        </div>
        <div className="ab-arrow">→</div>
        <div className={`ab-node ${agent ? 'ab-node-on' : ''}`}>
          <div className="ab-node-label">Your AI Agent</div>
          <div className="ab-node-value">{agent ? agent.name : 'not built yet'}</div>
        </div>
        <div className="ab-arrow">→</div>
        <div className={`ab-node ${grantedCount > 0 ? 'ab-node-on' : ''}`}>
          <div className="ab-node-label">Resources & scopes</div>
          <div className="ab-node-value">{grantedCount > 0 ? `${grantedCount} scope(s) granted` : 'no grants yet'}</div>
        </div>
      </div>

      {/* Zone 2 — You */}
      <section className="ab-card">
        <h2>You</h2>
        <dl className="ab-kv">
          <dt>Username</dt><dd>{user.username || '—'}</dd>
          <dt>Email</dt><dd>{user.email || '—'}</dd>
          <dt>Subject (sub)</dt><dd><code>{user.sub}</code></dd>
        </dl>
        <p className="ab-edu">This is the human identity. When an agent acts for you, tokens carry
          your <code>sub</code> as the subject and the agent as the actor.</p>
      </section>

      {/* Zone 3 — Your AI Agent */}
      <section className="ab-card">
        <h2>Your AI Agent</h2>
        {agentError && <div className="ab-error">{agentError}</div>}
        {!agent ? (
          <>
            <p className="ab-edu">An AI agent gets its <strong>own identity</strong> in PingOne — an OIDC
              application with its own client ID — so its actions are never confused with yours.</p>
            <button className="ab-btn ab-btn-primary" onClick={onBuild} disabled={busy === 'agent'}>
              {busy === 'agent' ? 'Building…' : 'Build my Agent'}
            </button>
          </>
        ) : (
          <>
            <dl className="ab-kv">
              <dt>Name</dt><dd>{agent.name}</dd>
              <dt>Client ID</dt><dd><code>{agent.id}</code></dd>
              <dt>Type</dt><dd><span className="ab-badge">{agent.type}</span></dd>
              <dt>Grant types</dt><dd>{agent.grantTypes.join(', ') || '—'}</dd>
              <dt>Token auth</dt><dd>{agent.tokenEndpointAuthMethod || '—'}</dd>
              <dt>Created</dt><dd>{agent.createdAt ? new Date(agent.createdAt).toLocaleString() : '—'}</dd>
            </dl>
            {agent.fallback && (
              <p className="ab-note">This environment doesn't license PingOne's first-class
                AI&nbsp;Agent type, so your agent was created as a standard OIDC app. Same identity
                model — it upgrades automatically when the feature is enabled.</p>
            )}
            {!showDeleteConfirm ? (
              <button className="ab-btn ab-btn-danger" onClick={() => setShowDeleteConfirm(true)}>Delete agent</button>
            ) : (
              <div className="ab-confirm">
                <span>Delete <strong>{agent.name}</strong> from PingOne? Its grants go with it.</span>
                <button className="ab-btn ab-btn-danger" onClick={onDelete} disabled={busy === 'agent'}>
                  {busy === 'agent' ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button className="ab-btn" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Zone 4 — Resources & scopes */}
      <section className="ab-card">
        <h2>Resources & scopes</h2>
        <p className="ab-edu">Scopes are the agent's permissions, granted per resource server.
          {!agent && ' Build your agent first to enable granting.'}</p>
        {grantsError && <div className="ab-error">{grantsError}</div>}

        <h3>Demo resources</h3>
        {demoResources.map(scopeRow)}

        <h3>Your resources</h3>
        {resourceError && <div className="ab-error">{resourceError}</div>}
        {myResources.length === 0 && <p className="ab-empty-note">None yet — create one below.</p>}
        {myResources.map(scopeRow)}

        <div className="ab-create-form">
          <input placeholder="Resource name (e.g. Weather)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="Audience (optional)" value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value })} />
          <input placeholder="Scopes, comma-separated" value={form.scopes}
            onChange={(e) => setForm({ ...form, scopes: e.target.value })} />
          <button className="ab-btn" onClick={onCreateResource}
            disabled={busy === 'resource' || !form.name.trim()}>
            {busy === 'resource' ? 'Creating…' : 'Create resource'}
          </button>
        </div>

        <div className="ab-apply-row">
          <button className="ab-btn ab-btn-primary" onClick={onApplyGrants}
            disabled={!agent || !dirty || busy === 'grants'}>
            {busy === 'grants' ? 'Applying…' : 'Apply grants'}
          </button>
          {dirty && <span className="ab-dirty">Unsaved changes</span>}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* demo_api_ui/src/components/AgentBuilderPage.css */
.ab-page { max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; }
.ab-page h1 { margin: 0 0 4px; }
.ab-intro { color: #243b53; margin: 0 0 20px; }

.ab-chain { display: flex; align-items: stretch; gap: 8px; margin-bottom: 24px; }
.ab-node { flex: 1; border: 2px solid #9aa5b1; border-radius: 10px; padding: 10px 14px; background: #f5f7fa; }
.ab-node-on { border-color: #1f7a33; background: #eaf7ed; }
.ab-node-label { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #102a43; }
.ab-node-value { font-size: 14px; color: #102a43; word-break: break-all; }
.ab-arrow { align-self: center; font-size: 20px; color: #102a43; }

.ab-card { border: 1px solid #d9e2ec; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; background: #fff; }
.ab-card h2 { margin: 0 0 10px; font-size: 18px; }
.ab-card h3 { margin: 16px 0 8px; font-size: 14px; text-transform: uppercase; color: #102a43; }

.ab-kv { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; margin: 0 0 10px; }
.ab-kv dt { font-weight: 600; color: #102a43; }
.ab-kv dd { margin: 0; word-break: break-all; }

.ab-edu { color: #243b53; font-size: 14px; }
.ab-note { color: #7c5e10; background: #fff8e1; border: 1px solid #e0c36a; border-radius: 6px; padding: 8px 12px; font-size: 14px; }
.ab-empty-note { color: #243b53; font-size: 14px; }
.ab-error { color: #fff; background: #b00020; border-radius: 6px; padding: 10px 14px; font-weight: 600; margin: 8px 0; }

.ab-badge { display: inline-block; background: #102a43; color: #fff; border-radius: 4px; padding: 2px 8px; font-size: 12px; font-weight: 700; }

.ab-resource { border: 1px solid #d9e2ec; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
.ab-resource-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.ab-resource-name { font-weight: 700; }
.ab-aud { font-size: 12px; color: #102a43; }
.ab-scopes { display: flex; flex-wrap: wrap; gap: 12px; }
.ab-scope { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

.ab-create-form { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; margin: 12px 0; }
.ab-create-form input { padding: 8px 10px; border: 1px solid #9aa5b1; border-radius: 6px; }

.ab-apply-row { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.ab-dirty { color: #7c5e10; font-weight: 600; }

.ab-btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #9aa5b1; background: #fff; color: #102a43; font-weight: 600; cursor: pointer; }
.ab-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ab-btn-primary { background: #0b69a3; border-color: #0b69a3; color: #fff; }
.ab-btn-danger { background: #b00020; border-color: #b00020; color: #fff; }
.ab-btn-sm { padding: 3px 10px; font-size: 12px; margin-left: auto; }
.ab-confirm { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.ab-loading { padding: 40px; text-align: center; color: #102a43; font-weight: 600; }
```

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design
git branch --show-current
git add demo_api_ui/src/components/AgentBuilderPage.jsx demo_api_ui/src/components/AgentBuilderPage.css
git commit -m "feat(agent-builder): AgentBuilderPage — chain strip, agent card, scope grants"
```

---

### Task 6: Route + nav wiring

**Files:**
- Modify: `demo_api_ui/src/App.js` (~line 567, next to the `/mcp-tools` route)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (END of `allNavItems`, ~line 317+)

- [ ] **Step 1: Add the route in App.js**

Import at the top with the other component imports:

```js
import AgentBuilderPage from "./components/AgentBuilderPage";
```

Next to the `/mcp-tools` route (~line 567), following the exact same guard pattern:

```jsx
<Route path="/agent-builder" element={
  user ? <AgentBuilderPage /> : <Navigate to="/" replace />
} />
```

- [ ] **Step 2: Add the nav item**

In `AdminSideNav.jsx`, append as the **LAST** element of the `allNavItems` array (appending does not shift the positional `adminIdx`/`customerIdx` used by the `sections` auto-expand map — do NOT insert it earlier, and do not touch icons/CSS/renderIcon):

```js
{ label: "Agent Builder", path: "/agent-builder", icon: "tool" },
```

(`"tool"` is an existing icon key — already used by the "MCP Tools" item.)

- [ ] **Step 3: Build gate**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design/demo_api_ui
npm run build
```
Expected: exit 0, no new warnings about AgentBuilderPage.

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design
git branch --show-current
git add demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx
git commit -m "feat(agent-builder): /agent-builder route + side-nav entry"
```

---

### Task 7: Real HTTP tests

**Files:**
- Create: `demo_api_server/tests/real/shared/agentBuilder.real.spec.js`

These hit the running BFF and create/delete REAL PingOne objects. Cleanup is in `afterAll` and the suite is written so reruns are safe (idempotent create, guarded delete). Requires the stack up (`./run.sh` with `VAULT_PASSWORD` set) and the real-test globalSetup session cache.

- [ ] **Step 1: Write the spec**

```js
// demo_api_server/tests/real/shared/agentBuilder.real.spec.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

describe('agent-builder real round-trip', () => {
  let client;

  beforeAll(() => { client = createBffClient('enduser'); });

  afterAll(async () => {
    if (!client) return;
    // Cleanup: delete test resource(s) and the agent. Guarded server-side, so
    // a half-failed run can never delete provisioned objects.
    const state = await client.get('/api/agent-builder/state');
    for (const r of state.data?.resources || []) {
      if (r.ownedByUser) await client.delete(`/api/agent-builder/resources/${r.id}`);
    }
    await client.delete('/api/agent-builder/agent');
  });

  test('state requires a session', async () => {
    const axios = require('axios');
    const { BFF_BASE } = require('../helpers/bffClient');
    const anon = await axios.get(`${BFF_BASE}/api/agent-builder/state`, { validateStatus: () => true });
    expect(anon.status).toBe(401);
  });

  test('full lifecycle: state → build agent (idempotent) → create resource → grant → delete', async () => {
    // 1. Initial state
    const s1 = await client.get('/api/agent-builder/state');
    expect(s1.status).toBe(200);
    expect(s1.data.user.sub).toBeTruthy();
    expect(Array.isArray(s1.data.resources)).toBe(true);

    // 2. Build agent — then build again, must be idempotent
    const b1 = await client.post('/api/agent-builder/agent');
    expect([200, 201]).toContain(b1.status);
    const b2 = await client.post('/api/agent-builder/agent');
    expect(b2.status).toBe(200);
    expect(b2.data.created).toBe(false);
    expect(b2.data.agent.id).toBe(b1.data.agent.id);

    // 3. Create a user resource with a custom scope
    const r1 = await client.post('/api/agent-builder/resources', {
      name: 'RealTest', scopes: ['read', 'forecast'],
    });
    expect([200, 201]).toContain(r1.status);
    const resourceId = r1.data.resource.id;

    // 4. Grant the custom scope to the agent (single resource → no
    //    duplicate-scope-name collision with demo resources).
    const g = await client.put('/api/agent-builder/grants', {
      grants: [{ resourceId, scopes: ['forecast'] }],
    });
    expect(g.status).toBe(200);

    // 5. State reflects the grant
    const s2 = await client.get('/api/agent-builder/state');
    const mine = s2.data.resources.find((r) => r.id === resourceId);
    expect(mine.ownedByUser).toBe(true);
    expect(mine.granted).toContain('forecast');

    // 6. Delete resource, then agent
    const dr = await client.delete(`/api/agent-builder/resources/${resourceId}`);
    expect(dr.status).toBe(200);
    const da = await client.delete('/api/agent-builder/agent');
    expect(da.status).toBe(200);

    // 7. Gone
    const s3 = await client.get('/api/agent-builder/state');
    expect(s3.data.agent).toBeNull();
  });
});
```

- [ ] **Step 2: Run it against the live stack**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server   # real tests read operator .env — run from MAIN checkout per flaky-tests memory
npx jest --testPathIgnorePatterns='=' --testPathPattern='agentBuilder.real' --runInBand
```
Expected: PASS (2 tests). NOTE: requires the stack running and the real-test session cache (globalSetup). If the suite errors with "No .test-session.json", run the full real suite setup first (see `tests/real/` README/helpers).

- [ ] **Step 3: Verify in PingOne that cleanup ran** (no leftover `AI Agent - …` / `… - RealTest` objects)

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
ENVID=$(rg -o '^PINGONE_ENVIRONMENT_ID=(.*)' -r '$1' .env | tail -1)
CID=$(rg -o '^PINGONE_WORKER_CLIENT_ID=(.*)' -r '$1' .env | tail -1)
CSEC=$(rg -o '^PINGONE_WORKER_CLIENT_SECRET=(.*)' -r '$1' .env | tail -1)
TOKEN=$(/usr/bin/curl -s -u "$CID:$CSEC" -d 'grant_type=client_credentials' "https://auth.pingone.com/$ENVID/as/token" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
/usr/bin/curl -s -H "Authorization: Bearer $TOKEN" "https://api.pingone.com/v1/environments/$ENVID/applications?limit=100" | python3 -c 'import sys,json;[print(a["name"]) for a in json.load(sys.stdin)["_embedded"]["applications"] if "Agent Builder" in str(a.get("description",""))]'
```
Expected: no output (no orphaned builder-created apps).

- [ ] **Step 4: Commit (test file lives in the worktree)**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design
git branch --show-current
git add demo_api_server/tests/real/shared/agentBuilder.real.spec.js
git commit -m "test(agent-builder): real HTTP lifecycle suite with PingOne cleanup"
```

---

### Task 8: CHANGELOG, full verification, wrap-up

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` → `### Added`)

- [ ] **Step 1: Add the CHANGELOG line**

Under `[Unreleased]` / `### Added`:

```markdown
- Agent Builder page (`/agent-builder`): any logged-in user can create their own AI agent identity in PingOne (AI_AGENT with OIDC fallback), create personal resource servers + custom scopes, and grant/revoke scopes — all server-side via the worker token.
```

- [ ] **Step 2: Full verification (success criteria from the spec)**

```bash
# Unit tests
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design/demo_api_server
npx jest --testPathIgnorePatterns='=' --testPathPattern='agentBuilderService'
# UI build gate
cd ../demo_api_ui && npm run build
```
Expected: all unit tests PASS; build exits 0.

Manual check (stack running): log in as `demoUser`, open `/agent-builder` from the side nav, Build my Agent → card shows WEB_APP badge + fallback note; create resource `Weather` with scope `forecast`; check + Apply grants; refresh page — state persists; delete resource and agent — page returns to empty state.

- [ ] **Step 3: Commit + merge prep**

```bash
cd /Users/curtismuir/Development/AI-Demo/.claude/worktrees/agent-builder-page-design
git branch --show-current
git add CHANGELOG.md
git commit -m "docs(changelog): Agent Builder page"
```

Then use superpowers:finishing-a-development-branch to merge/PR `worktree-agent-builder-page-design` → `main`.

---

## Phase 2 (separate plan, NOT this one)

Wiring the user's agent into the RFC 8693 token chain is specced in the design doc (`docs/superpowers/specs/2026-06-12-agent-builder-page-design.md`, "Phase 2") and ships as its own reviewed phase: token-exchange grant + vault secret custody for per-user agents, `may_act` updates on the user record, per-session actor-client resolution with seamless shared-agent fallback, mock-authz parity, and an executable end-to-end trace.
