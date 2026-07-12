# Pre-Demo Check — Gateway & Deep-LLM Heavy Checks (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two heavyweight backend checks that prove the **real Agent Gateway** path end-to-end (introspect → authorize → MCP tools/call through PingGateway, as the logged-in user) and the **deep LLM** probe (a real completion against every configured model). Both register as `heavy: true` so they slot into the Plan 1 engine with no engine changes.

**Architecture:** `POST /api/check/run` is authenticated, so heavy checks act as the current user: they read the user's access token from `req.session.oauthTokens.accessToken`, mint a gateway-audience token via the existing `oauthService.performTokenExchange`, and call PingGateway through a shared client extracted from the existing test route. The deep-LLM check drives real `/v1/chat/completions` calls through the model proxy, accepting model swaps. The chip end-to-end check is **not** here — it is frontend-driven in Plan 3 because it needs the live browser session and mirrors the real UI path.

**Tech Stack:** Node.js, Express, Jest + supertest, `oauthService`, `configStore`, `pinggatewayTestRoutes` client, the `demo_llm_proxy`.

## Global Constraints

- **Work in a git worktree, never the main checkout** (CLAUDE.md). Explicit staging; verify branch before commit.
- **Emoji allowlist** (`⚠️ ✅ ❌ 🔐 ✕ ✓` only) in all code/tests.
- Read/probe-only: never change flags/scopes/config. Gateway checks perform a **read-only** MCP tool call.
- Reuse existing services: `oauthService.performTokenExchange(subjectToken, audience, scopes)`, `configStore.getEffective`, the PingGateway HTTP client.
- Depends on Plan 1 (`checkService`, `services/checks/registry`, `routes/check.js`, the `services/checks/index.js` require list). This plan adds files and registers new descriptors; it changes the check-run ctx to include `req`.

---

### Task 1: Pass the authenticated request into check ctx

**Files:**
- Modify: `demo_api_server/routes/check.js` (the `POST /run` handler from Plan 1)
- Modify: `demo_api_server/tests/checkRoute.test.js` (extend)

**Interfaces:**
- Produces: `runChecks` ctx becomes `{ flags, req }` where `req` is the authenticated Express request (carries `session`, `user`). Light checks ignore `req`; heavy checks read the session token from it.

- [ ] **Step 1: Update the run handler to include `req` in ctx**

In `routes/check.js`, change the `runChecks` call inside `POST /run`:

```js
  const results = await runChecks(checks, { flags, req }, (r) => send('result', r));
```

- [ ] **Step 2: Add a test asserting ctx carries req**

Append to `tests/checkRoute.test.js` a check that echoes whether `ctx.req` is present:

```js
test('run passes req into check ctx', async () => {
  const { register } = require('../services/checks/registry');
  register({ id: 'ctxprobe', name: 'ctx', category: 'C', run: async (ctx) => ({ status: ctx.req ? 'pass' : 'fail', detail: ctx.req ? 'has req' : 'no req' }) });
  const res = await request(makeApp()).post('/api/check/run').send({ only: ['ctxprobe'] });
  expect(res.text).toContain('"id":"ctxprobe"');
  expect(res.text).toContain('"status":"pass"');
});
```

- [ ] **Step 3: Run tests**

Run: `cd demo_api_server && npx jest tests/checkRoute.test.js`
Expected: PASS (including the new ctx test).

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/routes/check.js demo_api_server/tests/checkRoute.test.js
git commit -m "feat(check): pass authenticated req into check ctx for heavy checks"
```

---

### Task 2: Shared PingGateway client

**Files:**
- Create: `demo_api_server/services/pingGatewayClient.js`
- Test: `demo_api_server/tests/pingGatewayClient.test.js`

**Interfaces:**
- Produces: `callPingGateway(method, path, body?) => Promise<{ statusCode, body }>` — copied verbatim from the helper in `routes/pinggatewayTestRoutes.js` (same env: `PINGGATEWAY_URL || 'https://localhost:3036'`, TLS-permissive for the dev self-signed cert). This is a straight extraction so both the test route and the new check share one implementation.

- [ ] **Step 1: Confirm the source helper**

Run: `cd demo_api_server && sed -n '20,66p' routes/pinggatewayTestRoutes.js`
Expected: prints the full `callPingGateway` function body. Copy it exactly in Step 3.

- [ ] **Step 2: Write the failing test**

```js
// demo_api_server/tests/pingGatewayClient.test.js
'use strict';
const { callPingGateway } = require('../services/pingGatewayClient');
test('callPingGateway is a function returning a promise', () => {
  expect(typeof callPingGateway).toBe('function');
  const p = callPingGateway('GET', '/nope').catch(() => 'rejected'); // no gateway in unit env
  expect(p).toBeInstanceOf(Promise);
  return expect(p).resolves.toBeDefined();
});
```

- [ ] **Step 3: Create the client by extracting the helper**

Create `services/pingGatewayClient.js` with the exact `callPingGateway` body from Step 1, wrapped as:

```js
'use strict';
const http = require('http');
const https = require('https');
const { URL } = require('url');

function callPingGateway(method, path, body = null) {
  // ← paste the verbatim body from routes/pinggatewayTestRoutes.js (Step 1)
}

module.exports = { callPingGateway };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/pingGatewayClient.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/pingGatewayClient.js demo_api_server/tests/pingGatewayClient.test.js
git commit -m "feat(check): extract shared PingGateway HTTP client"
```

---

### Task 3: Agent Gateway real-path check (heavy)

**Files:**
- Create: `demo_api_server/services/checks/gatewayCheck.js`
- Modify: `demo_api_server/services/checks/index.js` (add `require('./gatewayCheck')`)
- Test: `demo_api_server/tests/checks/gatewayCheck.test.js`

**Interfaces:**
- Consumes: `services/pingGatewayClient` → `callPingGateway`; `services/oauthService` → `performTokenExchange`; `services/configStore` → `getEffective`. Reads user token from `ctx.req.session.oauthTokens.accessToken`.
- Produces one descriptor `gateway.real_path` `{ heavy: true, appliesWhen: flags => flags.ff_mcp_gateway_pinggateway === true, category: 'Agent Gateway' }`. Steps run in order; a failing hop stops the chain and reports which hop broke. Verdicts:
  - `skip` when no user session token (e.g. run without a live login).
  - `fail` when token exchange fails, or introspect not `active`, or authorize denies, or mcp-call returns no `result`.
  - `pass` when introspect active + authorize permits + mcp-call returns a `result`. `meta.hops = [{name,status,detail}]`.
- Config: gateway audience `configStore.getEffective('pingone_resource_mcp_gateway_uri')`; scopes `['mcp:invoke']`; a read-only demo tool + resourceId (default `get_account_balance` / `account:demo` — **confirm against `mcp-tool-schemas.json`** in Step 1).

- [ ] **Step 1: Confirm a safe read-only tool name + resourceId**

Run: `cd demo_api_server && node -e "const s=require('../mcp-tool-schemas.json'); console.log(Object.keys(s).slice(0,20))" 2>/dev/null || sed -n '1,40p' ../mcp-tool-schemas.json`
Pick a read-only banking tool (e.g. a balance/read tool). Use its exact name as `TOOL_NAME` and a representative `RESOURCE_ID` in Step 3. Do not pick a mutating tool.

- [ ] **Step 2: Write the failing test**

```js
// demo_api_server/tests/checks/gatewayCheck.test.js
'use strict';
jest.mock('../../services/pingGatewayClient', () => ({ callPingGateway: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ performTokenExchange: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'gw-aud') }));

const { callPingGateway } = require('../../services/pingGatewayClient');
const oauth = require('../../services/oauthService');
const { realPath } = require('../../services/checks/gatewayCheck');

const ctxWithToken = { flags: { ff_mcp_gateway_pinggateway: true }, req: { session: { oauthTokens: { accessToken: 'user-jwt' } } } };

describe('gatewayCheck.real_path', () => {
  afterEach(() => jest.clearAllMocks());

  test('skips without a session token', async () => {
    const r = await realPath.run({ flags: { ff_mcp_gateway_pinggateway: true }, req: { session: {} } });
    expect(r.status).toBe('skip');
  });

  test('passes when all three hops succeed', async () => {
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway
      .mockResolvedValueOnce({ statusCode: 200, body: { active: true } })            // introspect
      .mockResolvedValueOnce({ statusCode: 200, body: { decision: 'PERMIT' } })       // authorize
      .mockResolvedValueOnce({ statusCode: 200, body: { result: { ok: true } } });    // mcp-call
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('pass');
    expect(r.meta.hops.map((h) => h.status)).toEqual(['pass', 'pass', 'pass']);
  });

  test('fails and pinpoints the hop when introspect is not active', async () => {
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway.mockResolvedValueOnce({ statusCode: 200, body: { active: false } });
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/introspect/i);
  });

  test('fails when token exchange throws', async () => {
    oauth.performTokenExchange.mockRejectedValue(new Error('exchange_failed'));
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/exchange_failed/);
  });
});
```

- [ ] **Step 3: Write the check**

```js
// demo_api_server/services/checks/gatewayCheck.js
'use strict';
const { callPingGateway } = require('../pingGatewayClient');
const oauth = require('../oauthService');
const configStore = require('../configStore');
const { register } = require('./registry');

const SCOPES = ['mcp:invoke'];
const TOOL_NAME = 'get_account_balance';   // confirmed read-only in Task 3 Step 1
const RESOURCE_ID = 'account:demo';

const realPath = {
  id: 'gateway.real_path', name: 'Real gateway path (introspect → authorize → mcp-call)',
  category: 'Agent Gateway', heavy: true,
  appliesWhen: (flags) => flags.ff_mcp_gateway_pinggateway === true,
  async run(ctx) {
    const userToken = ctx.req?.session?.oauthTokens?.accessToken;
    if (!userToken || userToken === '_cookie_session') {
      return { status: 'skip', detail: 'No live user session token — log in and re-run to test the real gateway' };
    }
    const hops = [];
    const fail = (name, detail) => { hops.push({ name, status: 'fail', detail }); return { status: 'fail', detail: `${name}: ${detail}`, meta: { hops } }; };

    let gwToken;
    try {
      const aud = configStore.getEffective('pingone_resource_mcp_gateway_uri');
      gwToken = await oauth.performTokenExchange(userToken, aud, SCOPES);
    } catch (err) { return fail('token-exchange', err.message); }

    // Hop 1: introspection
    let r = await callPingGateway('POST', '/introspect', { token: gwToken });
    if (!(r.statusCode < 300 && r.body?.active)) return fail('introspect', `active=${r.body?.active} status=${r.statusCode}`);
    hops.push({ name: 'introspect', status: 'pass', detail: 'active=true' });

    // Hop 2: authorize
    r = await callPingGateway('POST', '/authorize', { token: gwToken, resourceId: RESOURCE_ID });
    if (!(r.statusCode < 300 && r.body?.decision === 'PERMIT')) return fail('authorize', `decision=${r.body?.decision} status=${r.statusCode}`);
    hops.push({ name: 'authorize', status: 'pass', detail: 'PERMIT' });

    // Hop 3: MCP tools/call
    r = await callPingGateway('POST', '/mcp', { jsonrpc: '2.0', method: 'tools/call', params: { name: TOOL_NAME, arguments: {} } });
    if (!(r.statusCode < 300 && r.body?.result && !r.body?.error)) return fail('mcp-call', `status=${r.statusCode} error=${JSON.stringify(r.body?.error) || 'none'}`);
    hops.push({ name: 'mcp-call', status: 'pass', detail: 'tools/call result ok' });

    return { status: 'pass', detail: 'introspect + authorize + mcp-call all succeeded', meta: { hops } };
  },
};

register(realPath);
module.exports = { realPath };
```

- [ ] **Step 4: Add to the checks index**

In `services/checks/index.js` add after `require('./llmCheck');`:

```js
require('./gatewayCheck');
```

- [ ] **Step 5: Run tests**

Run: `cd demo_api_server && npx jest tests/checks/gatewayCheck.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/checks/gatewayCheck.js demo_api_server/services/checks/index.js demo_api_server/tests/checks/gatewayCheck.test.js
git commit -m "feat(check): real Agent Gateway end-to-end path check (heavy)"
```

---

### Task 4: Deep LLM check — real completion per model (heavy)

**Files:**
- Create: `demo_api_server/services/checks/llmDeepCheck.js`
- Modify: `demo_api_server/services/checks/index.js` (add `require('./llmDeepCheck')`)
- Test: `demo_api_server/tests/checks/llmDeepCheck.test.js`

**Interfaces:**
- Consumes: `axios`; proxy origin `process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8090'`; `GET /status` → `{models:[{name}]}`; `POST /v1/chat/completions` `{model, messages}` → `{choices:[{message:{content}}]}` (the proxy swaps to the requested model).
- Produces descriptor `llm.deep` `{ heavy: true, category: 'LLM' }` — for each model in `/status`, POST a tiny completion (`"reply READY"`), assert a non-empty `choices[0].message.content`. `pass` if all models respond; `warn` if some fail; `fail` if none respond or the proxy is unreachable. `meta.models = [{name, ok, error?}]`. Long per-model timeout (default 180000 ms) to allow a 20B swap.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/checks/llmDeepCheck.test.js
'use strict';
const axios = require('axios');
jest.mock('axios');
const { deep } = require('../../services/checks/llmDeepCheck');

describe('llmDeepCheck', () => {
  afterEach(() => jest.clearAllMocks());

  test('pass when every model returns content', async () => {
    axios.get.mockResolvedValue({ data: { models: [{ name: 'm1' }, { name: 'm2' }] } });
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'READY' } }] } });
    const r = await deep.run({});
    expect(r.status).toBe('pass');
    expect(r.meta.models.every((m) => m.ok)).toBe(true);
  });

  test('warn when one model fails', async () => {
    axios.get.mockResolvedValue({ data: { models: [{ name: 'm1' }, { name: 'm2' }] } });
    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'READY' } }] } })
      .mockRejectedValueOnce(new Error('load_failed'));
    const r = await deep.run({});
    expect(r.status).toBe('warn');
    expect(r.meta.models.find((m) => m.name === 'm2').ok).toBe(false);
  });

  test('fail when proxy unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await deep.run({})).status).toBe('fail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/checks/llmDeepCheck.test.js`
Expected: FAIL — cannot find `llmDeepCheck`.

- [ ] **Step 3: Write the check**

```js
// demo_api_server/services/checks/llmDeepCheck.js
'use strict';
const axios = require('axios');
const { register } = require('./registry');

const PROXY = (process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const PER_MODEL_TIMEOUT = 180000;

const deep = {
  id: 'llm.deep', name: 'Deep LLM test (all models)', category: 'LLM', heavy: true,
  async run() {
    let models;
    try {
      const { data } = await axios.get(`${PROXY}/status`, { timeout: 3000 });
      models = Array.isArray(data.models) ? data.models : [];
    } catch (err) {
      return { status: 'fail', detail: `LLM proxy unreachable: ${err.message}` };
    }
    if (!models.length) return { status: 'fail', detail: 'Proxy reported no models' };

    const results = [];
    for (const m of models) {
      try {
        const { data } = await axios.post(`${PROXY}/v1/chat/completions`,
          { model: m.name, messages: [{ role: 'user', content: 'reply READY' }], max_tokens: 8 },
          { timeout: PER_MODEL_TIMEOUT });
        const content = data?.choices?.[0]?.message?.content;
        results.push({ name: m.name, ok: !!(content && content.trim()) });
      } catch (err) {
        results.push({ name: m.name, ok: false, error: err.message });
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    const status = okCount === results.length ? 'pass' : okCount === 0 ? 'fail' : 'warn';
    return { status, detail: `${okCount}/${results.length} models generated`, meta: { models: results } };
  },
};

register(deep);
module.exports = { deep };
```

- [ ] **Step 4: Add to checks index & run tests**

Add `require('./llmDeepCheck');` to `services/checks/index.js`, then:

Run: `cd demo_api_server && npx jest tests/checks/llmDeepCheck.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/checks/llmDeepCheck.js demo_api_server/services/checks/index.js demo_api_server/tests/checks/llmDeepCheck.test.js
git commit -m "feat(check): deep LLM per-model completion check (heavy)"
```

---

### Task 5: Full backend check-suite verification

- [ ] **Step 1: Registry lists all checks**

Run: `cd demo_api_server && node -e "require('./services/checks'); console.log(require('./services/checks/registry').ALL_CHECKS.map(c=>({id:c.id,heavy:!!c.heavy})))"`
Expected: light — `servers.all_up, authorize.mode, authorize.real_decision, authorize.fail_open, config.prereqs, llm.status`; heavy — `gateway.real_path, llm.deep`.

- [ ] **Step 2: Run all backend check tests**

Run: `cd demo_api_server && npx jest tests/checkService.test.js tests/checkRoute.test.js tests/pingGatewayClient.test.js tests/checks/`
Expected: PASS (all green).

- [ ] **Step 3: Commit (if any fixups were needed)**

```bash
git add -u demo_api_server && git commit -m "test(check): full backend check suite green" || echo "nothing to commit"
```

---

## Self-Review

- Real gateway end-to-end (introspect → authorize → mcp-call, pinpoints hop) → Task 3. ✓
- Uses the live user session token via `req` in ctx → Task 1 + Task 3. ✓
- Deep LLM per-model real completion → Task 4. ✓
- Both heavy → excluded from default "Run all", included when `includeHeavy` → inherited from Plan 1 engine. ✓
- **Placeholder note:** Task 3 Step 1 confirms the exact read-only tool name/resourceId from `mcp-tool-schemas.json` before coding — a real verification step, not a placeholder (defaults are provided).
- Type consistency: descriptor + result shapes and `pass|fail|warn|skip` vocabulary match Plan 1. ctx is `{flags, req}` consistently.
