# PingOne Management API Runner (Headless Demo — Sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/mgmt-api` Inspector page that runs allow-listed PingOne Management API operations live (list apps/users/populations, and create app/user with an automatic delete round-trip), showing the equivalent curl and the JSON response.

**Architecture:** New Express route `/api/admin/mgmt-api` mints a worker token via `pingOneClientService.getManagementToken()`, initializes the existing `pingoneManagementService` with it, and dispatches allow-listed operations. Create operations create a tagged resource, capture the returned id, then DELETE it in the same request (auto-cleanup). The frontend is a new page built on the shared `InspectorShell` component set.

**Tech Stack:** Node/Express + `axios` (via the existing `pingoneManagementService`), Jest + supertest (backend), React 19 `.js`/JSX + Vite, `InspectorShell`/`InspectorTabs`/`InspectorListItem` shared components.

## Global Constraints

- Work only in worktree `worktree-headless-mgmt-api-runner`; stage files explicitly (`git add <files>`), never `git add -A`; verify `git branch --show-current` before each commit.
- Emoji allowlist only: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. The only emoji this feature needs is `⚠️` (cleanup-failure warning).
- **Worker token pattern (verified in `routes/pingoneTestRoutes.js`):** `const workerToken = await pingOneClientService.getManagementToken(); managementService.initialize(workerToken);`. NEVER call the no-arg `managementService.initialize()` — it requires the unset `PINGONE_MANAGEMENT_API_TOKEN` and throws.
- Service method style (match exactly, from `pingoneManagementService.js`): `this.ensureInitialized()` first; `axios.<verb>(\`${this.baseURL}/<path>\`, [payload], { headers: this.getHeaders() })`; return `{ success: true, ... }` on success; `return this.handleError(error, '<op>')` in catch. `this.baseURL` is `https://api.pingone.${region}/v1/environments/${env}`.
- **Auto-cleanup safety:** delete ONLY the exact id returned by the create call. If delete fails, return `cleanedUp:false` + `leakedId:<id>` + a `⚠️` note — never report a silent success.
- **curl redaction:** every generated curl string uses the literal `$TOKEN`, never a real bearer token.
- `demo_api_ui` is a protected area (REGRESSION_PLAN §1): invoke `regression-guard` before the first UI edit; run `cd demo_api_ui && npm run build` (exit 0) before done.
- Run backend tests with `CI=true npx jest <file> --maxWorkers=2 --testPathIgnorePatterns="/node_modules/"` from the worktree; a fresh worktree may need `node_modules` (symlink/reuse the main checkout's `demo_api_server/node_modules`).
- Do NOT modify `routes/adminManagement.js` (pre-existing, out of scope).

---

### Task 1: Backend — add 5 methods to `pingoneManagementService`

**Files:**
- Modify: `demo_api_server/services/pingoneManagementService.js` (add `deleteApplication`, `getPopulations`, `getUsers`, `createUser`, `deleteUser`)
- Test: `demo_api_server/tests/pingoneManagementService.methods.test.js` (new)

**Interfaces:**
- Consumes: existing `this.ensureInitialized()`, `this.getHeaders()`, `this.baseURL`, `this.handleError`, module export `{ managementService }`.
- Produces:
  - `deleteApplication(id)` → `{ success: true }` (HTTP 204, no body)
  - `getPopulations()` → `{ success: true, populations: [...] }`
  - `getUsers(limit = 20)` → `{ success: true, users: [...] }`
  - `createUser({ populationId, username, email })` → `{ success: true, user, id }`
  - `deleteUser(id)` → `{ success: true }`

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/pingoneManagementService.methods.test.js`:

```js
// Mock the axios instance the service creates at module load.
const mockAxios = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('axios', () => ({ create: () => mockAxios }));

const { managementService } = require('../services/pingoneManagementService');

beforeEach(() => {
  jest.clearAllMocks();
  managementService.initialize('test-worker-token'); // token arg => no env dependency
});

describe('pingoneManagementService added methods', () => {
  const base = () => managementService.baseURL;

  it('getPopulations GETs /populations and unwraps _embedded.populations', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { _embedded: { populations: [{ id: 'p1' }] } } });
    const r = await managementService.getPopulations();
    expect(mockAxios.get).toHaveBeenCalledWith(`${base()}/populations`, { headers: managementService.getHeaders() });
    expect(r).toEqual({ success: true, populations: [{ id: 'p1' }] });
  });

  it('getUsers GETs /users with a limit and unwraps _embedded.users', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { _embedded: { users: [{ id: 'u1' }] } } });
    const r = await managementService.getUsers(5);
    expect(mockAxios.get).toHaveBeenCalledWith(`${base()}/users?limit=5`, { headers: managementService.getHeaders() });
    expect(r).toEqual({ success: true, users: [{ id: 'u1' }] });
  });

  it('createUser POSTs /users with population + name and returns id', async () => {
    mockAxios.post.mockResolvedValueOnce({ data: { id: 'u9', username: 'demo' } });
    const r = await managementService.createUser({ populationId: 'p1', username: 'demo', email: 'demo@example.com' });
    expect(mockAxios.post).toHaveBeenCalledWith(
      `${base()}/users`,
      { population: { id: 'p1' }, username: 'demo', email: 'demo@example.com' },
      { headers: managementService.getHeaders() }
    );
    expect(r).toMatchObject({ success: true, id: 'u9' });
  });

  it('deleteApplication DELETEs /applications/:id', async () => {
    mockAxios.delete.mockResolvedValueOnce({ status: 204 });
    const r = await managementService.deleteApplication('a1');
    expect(mockAxios.delete).toHaveBeenCalledWith(`${base()}/applications/a1`, { headers: managementService.getHeaders() });
    expect(r).toEqual({ success: true });
  });

  it('deleteUser DELETEs /users/:id', async () => {
    mockAxios.delete.mockResolvedValueOnce({ status: 204 });
    const r = await managementService.deleteUser('u1');
    expect(mockAxios.delete).toHaveBeenCalledWith(`${base()}/users/u1`, { headers: managementService.getHeaders() });
    expect(r).toEqual({ success: true });
  });

  it('propagates errors through handleError (success:false)', async () => {
    mockAxios.get.mockRejectedValueOnce({ response: { status: 403, data: { message: 'nope' } } });
    const r = await managementService.getPopulations();
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/pingoneManagementService.methods.test.js --maxWorkers=2 --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL — the five methods don't exist yet.

- [ ] **Step 3: Add the methods**

In `demo_api_server/services/pingoneManagementService.js`, add these methods to the class (near `getApplications`), matching the existing style:

```js
  async getPopulations() {
    this.ensureInitialized();
    try {
      const response = await axios.get(`${this.baseURL}/populations`, { headers: this.getHeaders() });
      return { success: true, populations: response.data._embedded?.populations || [] };
    } catch (error) {
      return this.handleError(error, 'getPopulations');
    }
  }

  async getUsers(limit = 20) {
    this.ensureInitialized();
    try {
      const response = await axios.get(`${this.baseURL}/users?limit=${limit}`, { headers: this.getHeaders() });
      return { success: true, users: response.data._embedded?.users || [] };
    } catch (error) {
      return this.handleError(error, 'getUsers');
    }
  }

  async createUser({ populationId, username, email }) {
    this.ensureInitialized();
    const payload = { population: { id: populationId }, username, email };
    try {
      const response = await axios.post(`${this.baseURL}/users`, payload, { headers: this.getHeaders() });
      return { success: true, user: response.data, id: response.data.id };
    } catch (error) {
      return this.handleError(error, 'createUser');
    }
  }

  async deleteApplication(id) {
    this.ensureInitialized();
    try {
      await axios.delete(`${this.baseURL}/applications/${id}`, { headers: this.getHeaders() });
      return { success: true };
    } catch (error) {
      return this.handleError(error, 'deleteApplication');
    }
  }

  async deleteUser(id) {
    this.ensureInitialized();
    try {
      await axios.delete(`${this.baseURL}/users/${id}`, { headers: this.getHeaders() });
      return { success: true };
    } catch (error) {
      return this.handleError(error, 'deleteUser');
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/pingoneManagementService.methods.test.js --maxWorkers=2 --testPathIgnorePatterns="/node_modules/"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/pingoneManagementService.js demo_api_server/tests/pingoneManagementService.methods.test.js
git commit -m "feat(mgmt-api): add populations/users/delete methods to management service"
```

---

### Task 2: Backend — `/api/admin/mgmt-api` route (operations catalog + run + auto-cleanup + curl)

**Files:**
- Create: `demo_api_server/routes/mgmtApi.js`
- Modify: `demo_api_server/server.js` (mount the route)
- Test: `demo_api_server/tests/mgmtApi.route.test.js` (new)

**Interfaces:**
- Consumes: `pingOneClientService.getManagementToken()`; `{ managementService }` with methods from Task 1 plus existing `getApplications`, `createApplication`.
- Produces: `GET /api/admin/mgmt-api/operations` (catalog) and `POST /api/admin/mgmt-api/run` (`{ operationKey, params }` → run result described below).

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/mgmtApi.route.test.js`:

```js
const request = require('supertest');
const express = require('express');

jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('worker-tkn'),
}));
jest.mock('../services/pingoneManagementService', () => ({
  managementService: {
    initialize: jest.fn(),
    getApplications: jest.fn().mockResolvedValue({ success: true, applications: [{ id: 'a1' }] }),
    createApplication: jest.fn().mockResolvedValue({ success: true, id: 'newapp', application: { id: 'newapp' } }),
    deleteApplication: jest.fn().mockResolvedValue({ success: true }),
    getUsers: jest.fn().mockResolvedValue({ success: true, users: [] }),
    getPopulations: jest.fn().mockResolvedValue({ success: true, populations: [{ id: 'p1' }] }),
    createUser: jest.fn().mockResolvedValue({ success: true, id: 'newuser', user: { id: 'newuser' } }),
    deleteUser: jest.fn().mockResolvedValue({ success: true }),
  },
}));

const { managementService } = require('../services/pingoneManagementService');
const mgmtApiRoutes = require('../routes/mgmtApi');

const app = express();
app.use(express.json());
app.use('/api/admin/mgmt-api', mgmtApiRoutes);

describe('GET /operations', () => {
  it('returns the catalog grouped with mutates flags', async () => {
    const res = await request(app).get('/api/admin/mgmt-api/operations');
    expect(res.status).toBe(200);
    const keys = res.body.map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(['apps_list', 'apps_create', 'users_list', 'users_create', 'populations_list']));
    const create = res.body.find((o) => o.key === 'apps_create');
    expect(create).toMatchObject({ mutates: true, cleanup: true });
    expect(res.body.find((o) => o.key === 'apps_list')).toMatchObject({ mutates: false });
  });
});

describe('POST /run', () => {
  beforeEach(() => jest.clearAllMocks());

  it('read-only op returns the service JSON and a curl with $TOKEN (never a real token)', async () => {
    const res = await request(app).post('/api/admin/mgmt-api/run').send({ operationKey: 'apps_list' });
    expect(res.status).toBe(200);
    expect(managementService.getApplications).toHaveBeenCalled();
    expect(res.body.curl).toContain('$TOKEN');
    expect(res.body.curl).not.toContain('worker-tkn');
    expect(res.body.steps[0].status).toBeLessThan(400);
  });

  it('create op runs create then delete of the returned id (auto-cleanup)', async () => {
    const res = await request(app).post('/api/admin/mgmt-api/run').send({ operationKey: 'apps_create', params: { name: 'demo-x', type: 'SINGLE_PAGE_APP' } });
    expect(res.status).toBe(200);
    expect(managementService.createApplication).toHaveBeenCalled();
    expect(managementService.deleteApplication).toHaveBeenCalledWith('newapp');
    expect(res.body).toMatchObject({ cleanedUp: true, leakedId: null });
    expect(res.body.steps.map((s) => s.status)).toEqual([201, 204]);
  });

  it('create op with failing cleanup reports leakedId + not cleaned up', async () => {
    managementService.deleteApplication.mockResolvedValueOnce({ success: false, error: 'boom' });
    const res = await request(app).post('/api/admin/mgmt-api/run').send({ operationKey: 'apps_create', params: { name: 'demo-x', type: 'SINGLE_PAGE_APP' } });
    expect(res.body).toMatchObject({ cleanedUp: false, leakedId: 'newapp' });
  });

  it('unknown operation returns 400', async () => {
    const res = await request(app).post('/api/admin/mgmt-api/run').send({ operationKey: 'nope' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/mgmtApi.route.test.js --maxWorkers=2 --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL — `routes/mgmtApi.js` does not exist.

- [ ] **Step 3: Write `demo_api_server/routes/mgmtApi.js`**

```js
const { Router } = require('express');
const pingOneClientService = require('../services/pingOneClientService');
const { managementService } = require('../services/pingoneManagementService');

const ENV = process.env.PINGONE_ENVIRONMENT_ID || '<env>';
const REGION = process.env.PINGONE_REGION || 'com';
const API_BASE = `https://api.pingone.${REGION}/v1/environments/${ENV}`;

// Allow-list. read: fn(svc) -> service result. create: {create, del, idOf} for
// the create->delete round-trip. curl: fn(params) -> the equivalent curl string
// (token ALWAYS redacted as $TOKEN).
const OPERATIONS = {
  apps_list: {
    group: 'Applications', label: 'List Applications', method: 'GET',
    path: '/applications', mutates: false, params: [],
    read: (svc) => svc.getApplications(),
    listKey: 'applications',
  },
  apps_create: {
    group: 'Applications', label: 'Create Application', method: 'POST',
    path: '/applications', mutates: true, cleanup: true,
    params: [
      { name: 'name', type: 'text', default: 'demo-mgmt-api-<ts>' },
      { name: 'type', type: 'select', options: ['SINGLE_PAGE_APP', 'WEB_APP', 'WORKER'], default: 'SINGLE_PAGE_APP' },
    ],
    create: (svc, p) => svc.createApplication(p.name, 'Headless demo (auto-deleted)', p.type, ['authorization_code'], ['https://local.ping-devops.com:4000/callback']),
    del: (svc, id) => svc.deleteApplication(id),
    body: (p) => ({ name: p.name, type: p.type, protocol: 'OPENID_CONNECT', grantTypes: ['AUTHORIZATION_CODE'] }),
  },
  users_list: {
    group: 'Users', label: 'List Users', method: 'GET',
    path: '/users?limit=20', mutates: false, params: [],
    read: (svc) => svc.getUsers(20), listKey: 'users',
  },
  users_create: {
    group: 'Users', label: 'Create User', method: 'POST',
    path: '/users', mutates: true, cleanup: true,
    params: [
      { name: 'email', type: 'text', default: 'demo-mgmt-api-<ts>@example.com' },
      { name: 'populationId', type: 'select', optionsFrom: 'populations_list' },
    ],
    create: (svc, p) => svc.createUser({ populationId: p.populationId, username: p.email, email: p.email }),
    del: (svc, id) => svc.deleteUser(id),
    body: (p) => ({ population: { id: p.populationId }, username: p.email, email: p.email }),
  },
  populations_list: {
    group: 'Populations', label: 'List Populations', method: 'GET',
    path: '/populations', mutates: false, params: [],
    read: (svc) => svc.getPopulations(), listKey: 'populations',
  },
};

function buildCurl(op, params = {}) {
  const url = `${API_BASE}${op.path.startsWith('/') ? op.path : '/' + op.path}`;
  if (op.method === 'GET') {
    return `curl -X GET '${url}' -H 'Authorization: Bearer $TOKEN'`;
  }
  const body = op.body ? JSON.stringify(op.body(params)) : '{}';
  return `curl -X POST '${url}' -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' -d '${body}'`;
}

async function ensureManagement() {
  const workerToken = await pingOneClientService.getManagementToken();
  managementService.initialize(workerToken);
}

const router = Router();

router.get('/operations', (_req, res) => {
  res.json(
    Object.entries(OPERATIONS).map(([key, op]) => ({
      key, group: op.group, label: op.label, method: op.method, path: op.path,
      mutates: Boolean(op.mutates), cleanup: Boolean(op.cleanup), params: op.params || [],
    }))
  );
});

router.post('/run', async (req, res) => {
  const { operationKey, params = {} } = req.body || {};
  const op = OPERATIONS[operationKey];
  if (!op) return res.status(400).json({ error: 'unknown_operation', operationKey });

  const curl = buildCurl(op, params);
  try {
    await ensureManagement();
  } catch (e) {
    return res.json({ operation: op.label, curl, steps: [{ label: 'auth', status: 500, body: { error: String(e.message || e) } }], response: null });
  }

  // Read-only
  if (!op.mutates) {
    const result = await op.read(managementService);
    const ok = result.success !== false;
    return res.json({
      operation: op.label, curl,
      steps: [{ label: `${op.method} ${op.path}`, status: ok ? 200 : 502, body: result }],
      response: result,
    });
  }

  // Create -> delete round-trip
  const created = await op.create(managementService, params);
  if (created.success === false || !created.id) {
    return res.json({
      operation: op.label, curl,
      steps: [{ label: `POST ${op.path}`, status: 502, body: created }],
      response: created, cleanedUp: false, leakedId: null,
    });
  }
  const id = created.id;
  const del = await op.del(managementService, id);
  const cleanedUp = del.success !== false;
  return res.json({
    operation: op.label, curl,
    steps: [
      { label: `POST ${op.path}`, status: 201, body: created },
      { label: `DELETE ${op.path}/${id}`, status: cleanedUp ? 204 : 502, body: del },
    ],
    response: created,
    cleanedUp,
    leakedId: cleanedUp ? null : id,
    ...(cleanedUp ? {} : { warning: `⚠️ cleanup failed — leaked ${operationKey} id ${id}` }),
  });
});

module.exports = router;
```

- [ ] **Step 4: Mount the route in `server.js`**

Copy the pingcli mount pattern. Near the other `app.use('/api/admin/...')` lines (e.g. the `adminManagement` mount at ~line 1292):

```js
const mgmtApiRoutes = require('./routes/mgmtApi');
app.use('/api/admin/mgmt-api', authenticateToken, mgmtApiRoutes);
```

Use the same auth middleware the pingcli route uses (`authenticateToken`). Confirm the import name `authenticateToken` matches what `server.js` already imports (the pingcli mount is the reference).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/mgmtApi.route.test.js --maxWorkers=2 --testPathIgnorePatterns="/node_modules/"`
Expected: PASS (5 tests).

- [ ] **Step 6: Live sanity check in the running container**

The route mints a real worker token and hits live PingOne. After the code is live (copy files into `ai-demo-api-server` or `docker restart ai-demo-api-server`), exercise it via node inside the container (bypasses the admin cookie):

```bash
docker exec ai-demo-api-server node -e "
const c=require('/app/services/pingOneClientService');
const {managementService:m}=require('/app/services/pingoneManagementService');
(async()=>{const t=await c.getManagementToken();m.initialize(t);
console.log('apps', (await m.getApplications()).success);
console.log('pops', (await m.getPopulations()).success);
const cr=await m.createApplication('demo-mgmt-api-probe','probe','SINGLE_PAGE_APP',['authorization_code'],['https://local.ping-devops.com:4000/callback']);
console.log('create', cr.success, cr.id);
if(cr.id) console.log('delete', (await m.deleteApplication(cr.id)).success);
})().catch(e=>console.error('ERR', e.message));
"
```
Expected: `apps true`, `pops true`, `create true <id>`, `delete true`. **If create returns `success:false`**, read the error body and adjust `createApplication`'s payload / the `type` (PingOne SPA apps require `protocol: OPENID_CONNECT` and specific grantTypes; the existing `createApplication` may need those fields). Iterate until create→delete round-trips cleanly, then reflect any payload change in `OPERATIONS.apps_create.create`/`body`.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/routes/mgmtApi.js demo_api_server/server.js demo_api_server/tests/mgmtApi.route.test.js
git commit -m "feat(mgmt-api): add /api/admin/mgmt-api operations + run route with auto-cleanup"
```

---

### Task 3: Frontend — `/mgmt-api` Inspector page

**Files:**
- Create: `demo_api_ui/src/components/MgmtApiRunnerPage.jsx`
- Modify: `demo_api_ui/src/App.js` (import + route)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (nav entry in an existing group)

**Interfaces:**
- Consumes: `GET /api/admin/mgmt-api/operations` and `POST /api/admin/mgmt-api/run` from Task 2; shared `InspectorShell`, `InspectorTabs`, `InspectorListItem` from `./shared/InspectorShell.jsx` (+ `./shared/InspectorShell.css`); existing `JsonHighlight` component for JSON rendering.
- Produces: a default-exported `MgmtApiRunnerPage` React component; route `/mgmt-api`.

- [ ] **Step 1: Invoke regression-guard**

Invoke the `regression-guard` skill (Skill tool). State what you will NOT break: no change to existing routes/pages, auth, or the pingcli page; new page only.

- [ ] **Step 2: Build the page on InspectorShell**

Create `demo_api_ui/src/components/MgmtApiRunnerPage.jsx`. Model the structure on `demo_api_ui/src/components/PingOneAuthorizePage.jsx` (single full-height route on `InspectorShell`, tabbed output). Read the `inspector-template` skill's component reference for props. Behavior:

- On mount, `fetch('/api/admin/mgmt-api/operations', { credentials: 'include' })` → group rows by `op.group` in the **left** column using `InspectorListItem` (pass `dot="write"` and `badges={['write']}` for `op.mutates`).
- **Middle** column: when an op is selected, render its `params`. A `text` param is an `<input>` (replace `<ts>` in a default with `Date.now()` when first shown). A `select` with `options` is a `<select>`; a `select` with `optionsFrom: 'populations_list'` fetches that op (`POST /run { operationKey: 'populations_list' }`) and fills the dropdown from `response.populations` (value = population `id`, label = `name`). An **Execute** button (`.inspector-shell-btn-call`) POSTs `/api/admin/mgmt-api/run` with `{ operationKey, params }`.
- **Right** column: `InspectorTabs` with tabs `[{key:'response',label:'Response'},{key:'curl',label:'curl'}]`.
  - **Response** tab: render each `steps[]` entry as `METHOD path → <status>` followed by the pretty-printed `body` (use `JsonHighlight` inside `.inspector-shell-output-code`). If `cleanedUp === false`, show the `⚠️` `warning` prominently at the top.
  - **curl** tab: the `curl` string in a `<pre class="inspector-shell-output-code">` with a Copy button.
- `statusOn`/`statusText`: green "Ready" once operations load; red on fetch error.
- Use `credentials: 'include'` on all fetches (admin cookie). Handle a 401 with a "Please sign in as admin" empty state (`.inspector-shell-output-empty`).
- Emoji: only `⚠️` may appear.

(This is composition on a documented component set — follow the skill's reference and the `PingOneAuthorizePage` example rather than inventing topbar/grid CSS.)

- [ ] **Step 3: Wire the route in `App.js`**

Model on the `PingOneAuthorizePage` route (direct import at top; `<Route>` in the admin-guarded section):

```js
import MgmtApiRunnerPage from "./components/MgmtApiRunnerPage";
// ...in the routes:
<Route path="/mgmt-api" element={<MgmtApiRunnerPage user={user} logout={logout} />} />
```
Match the guard/props of a sibling admin route (e.g. how `PingOneAuthorizePage`/`McpInspectorPageRoute` is guarded).

- [ ] **Step 4: Add the nav entry in `AdminSideNav.jsx`**

Add an item to an existing topical group that fits (e.g. the "PingOne Demo Apps" or "Developer Tools" group — check the current groups in `allNavItems`, do not create a new group):

```js
{ label: "Mgmt API Runner", path: "/mgmt-api", icon: "tool" },
```

- [ ] **Step 5: Run the UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 6: Live click-through**

With the stack running, live-verify (the worktree UI on :4443 per the worktree-ui-live-verify memory, or copy the built file into the `ai-demo-ui` container per docker-serves-main-checkout). Sign in as admin, open `/mgmt-api`:
- Left tree shows Applications / Users / Populations groups; create rows show the write badge.
- List Applications / List Users / List Populations return live JSON.
- Create Application → Response tab shows `POST … → 201` then `DELETE …/<id> → 204`; run List Applications again → the demo app is gone.
- Create User → pick a population → `201` then `204`.
- curl tab shows `Bearer $TOKEN` (redacted).
Capture a screenshot of the page after a create round-trip.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/MgmtApiRunnerPage.jsx demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx
git commit -m "feat(mgmt-api-ui): add /mgmt-api Management API Runner inspector page"
```

---

## Self-Review

**1. Spec coverage:**
- Worker-token pattern (getManagementToken + initialize) → Task 2 `ensureManagement`. ✅
- Service additions (delete app, users, populations) → Task 1. ✅
- Operations catalog + run + read-only + create-cleanup + curl redaction → Task 2 route + tests. ✅
- Auto-cleanup with leakedId on failure → Task 2 Step 3 + test 3. ✅
- InspectorShell page (tool tree / param form / Response+curl tabs), route, nav → Task 3. ✅
- Success criteria (live lists, 201→204 round-trip, env unchanged, curl redacted, admin-only, build) → Task 2 Step 6 + Task 3 Step 6. ✅
- Test plan (operations/read/create/cleanup-fail/curl-no-token; live; regression) → Task 2 tests + Task 3 Step 6. ✅

**2. Placeholder scan:** No TBD/TODO. `<env>`/`<ts>` are literal sentinels the code replaces, not placeholders. App-create payload completeness is an explicit live-verify step (Task 2 Step 6), not a hidden gap.

**3. Type consistency:** `managementService` method names (`getPopulations`, `getUsers`, `createUser`, `deleteApplication`, `deleteUser`) identical across Task 1 (definition + tests) and Task 2 (`OPERATIONS` handlers + route test mocks). Route contract fields (`steps`, `curl`, `cleanedUp`, `leakedId`, `response`) identical between Task 2 route, Task 2 tests, and Task 3 consumption. Operation keys (`apps_list`/`apps_create`/`users_list`/`users_create`/`populations_list`) consistent across route, tests, and frontend.
