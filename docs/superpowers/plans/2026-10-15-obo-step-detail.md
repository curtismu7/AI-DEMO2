# OBO Step Detail (real request/response/tokens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every trace line on `/obo-demo` show the real HTTP request and response of its hop and the real tokens (raw plus decoded), for the in-app Run button only; client secrets stay masked; the Claude path stays token-free.

**Architecture:** An optional `onWire` hook on the two PingOne calls captures the real wire. A pure `oboWire` module masks secrets and builds browser-safe hops and token blocks. `runObo({capture:true})` (only `/run` passes it) attaches `wire` and `tokens` to the steps it already returns. A new `OboStepWire` component renders them in the existing Step details column.

**Tech Stack:** demo_api_server (CommonJS, jest, axios mocks), demo_api_ui (React 19, vitest, Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-15-obo-step-detail-design.md` (rev 2; approved: real wire, raw tokens inline, no Reveal, client secrets masked, Claude path unchanged)

## Global Constraints

- Work only in worktree `/Users/cmuir/Development/AI-DEMO2-obo-detail`, branch `feat/obo-step-detail`. `git branch --show-current` before every commit; stage files explicitly (never `git add -A`); never bare `git stash`. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tests: BFF `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 node node_modules/jest/bin/jest.js <paths> --forceExit` (`npx jest` does not work in worktrees). UI `cd demo_api_ui && node node_modules/vitest/vitest.mjs run <paths>` (`npx vitest` does not work). vitest, not jest, for the UI. If a broad run rewrites tracked fixtures, restore them with `git checkout -- <path>`.
- **`client_secret`, `*_secret`, `*password*`, `*assertion*` values and `Authorization: Basic` credentials must never reach the browser, a log line, or a test snapshot.** Tokens (subject/actor/access tokens) are shown for the in-app Run only.
- **The Claude path must not change:** `runObo` without `capture` returns no `wire` and no raw token anywhere; the MCP tool result, the SSE/hub payload and `evidence` stay token-free (a test asserts it).
- Task 2 edits two files in the regression-protected area (`services/oauthService.js`, `services/agentCCTokenService.js`; REGRESSION_PLAN.md section 1). Read `.claude/skills/regression-guard/SKILL.md` and the plan's section 1 first; the change must be purely additive (optional hook, off when absent) and every existing test for those files must pass unchanged.
- UI hard rules (REGRESSION_PLAN.md section 0, THEMING.md): no inline `style={{ }}` for colour/background/font-size; colours only via `--th-*` tokens; font sizes via `--font-size-*` (floor `--font-size-3xs`); dark mode via `:root[data-theme="dark"]` only; emoji only from the allowlist. Do not alter the other session's existing page code or tests beyond the edits named in Task 4.
- `/run` responses carry `Cache-Control: no-store`.

## Review Focus

- A planted `client_secret`/Basic credential surviving into the browser-bound hop or the `/run` body (Tasks 1, 3).
- Raw tokens or wire data reaching the Claude path (MCP result, hub publish, evidence) when `capture` is off (Task 3).
- The `onWire` hook changing an exchange/CC result or throwing out of it (Task 2).
- The failed hop: PingOne's real error body is shown, no secret, partial trace intact (Tasks 2, 3).
- The UI crashing on a step with `wire` but no `tokens`, `tokens` with `decoded: null`, empty bodies, or a missing clipboard API (Task 4).

## File Structure

| File | Responsibility |
|---|---|
| Create `demo_api_server/services/oboWire.js` | Pure: mask secrets, `describeHop`, `decodeToken`, `tokenBlock`, `downstreamHop`, `withDetail` |
| Modify `demo_api_server/services/oauthService.js` | Optional `onWire` hook in `performTokenExchangeAs` |
| Modify `demo_api_server/services/agentCCTokenService.js` | Optional `onWire` hook in `getAgentCCToken` |
| Modify `demo_api_server/services/oboExchangeService.js` | `capture` option; attach `wire` and `tokens` to steps |
| Modify `demo_api_server/routes/obo.js` | `/run` passes `capture: true`, sets `Cache-Control: no-store` |
| Create `demo_api_ui/src/components/obo/OboStepWire.jsx` + `.css` | Render Request/Response/Token/Decoded blocks |
| Modify `demo_api_ui/src/pages/OboDemoPage.jsx` + `.css` | Mount `OboStepWire`; correct the copy that says tokens never reach the page |
| Modify `docs/runbooks/obo-demo.md` | Describe the new detail |
| Tests next to each file | See each task |

---

### Task 1: `oboWire` (pure)

**Files:**
- Create: `demo_api_server/services/oboWire.js`
- Test: `demo_api_server/src/__tests__/services/oboWire.test.js`

**Interfaces:**
- Produces:
  - `describeHop(info) -> { request:{method,url,headers,body}, response:{status,body} }` (secrets masked; tokens left real)
  - `decodeToken(jwt) -> { header, payload } | null`
  - `tokenBlock(role, label, raw) -> { role, label, raw, decoded }`
  - `downstreamHop(token, result) -> { request, response }` (in-process check, labelled)
  - `withDetail(step, wire, tokens) -> step` (adds `wire`/`tokens` only when given)
  - `MASK = '***'`

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/services/oboWire.test.js
'use strict';
const { describeHop, decodeToken, tokenBlock, downstreamHop, withDetail, MASK } = require('../../../services/oboWire');

const jwt = (header, payload) => [Buffer.from(JSON.stringify(header)).toString('base64url'), Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
const delegated = jwt({ alg: 'RS256', kid: 'k1' }, { sub: 'u1', act: { client_id: 'AGENT' }, aud: ['obo-demo.ping.demo'] });

describe('describeHop', () => {
  const info = {
    request: {
      method: 'POST', url: 'https://auth.pingone.com/env/as/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic c2VjcmV0LXN0dWZm' },
      body: { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', client_id: 'ex', client_secret: 'PLANTED-SECRET', subject_token: 'SUBJECT.JWT.X', actor_assertion: 'ASSERT', nested: { api_secret: 'PLANTED-2' } },
    },
    response: { status: 200, data: { access_token: delegated, token_type: 'Bearer', expires_in: 900 } },
  };

  test('masks client_secret, *_secret, *assertion* and Basic credentials, everywhere', () => {
    const hop = describeHop(info);
    const text = JSON.stringify(hop);
    expect(hop.request.body.client_secret).toBe(MASK);
    expect(hop.request.body.actor_assertion).toBe(MASK);
    expect(hop.request.body.nested.api_secret).toBe(MASK);
    expect(hop.request.headers.Authorization).toBe('Basic ***');
    for (const planted of ['PLANTED-SECRET', 'PLANTED-2', 'c2VjcmV0LXN0dWZm', 'ASSERT']) expect(text).not.toContain(planted);
  });

  test('keeps tokens and ordinary fields real', () => {
    const hop = describeHop(info);
    expect(hop.request.body.subject_token).toBe('SUBJECT.JWT.X');
    expect(hop.response.body.access_token).toBe(delegated);
    expect(hop).toMatchObject({ request: { method: 'POST', url: 'https://auth.pingone.com/env/as/token' }, response: { status: 200 } });
  });

  test('keeps a Bearer Authorization header (the downstream check shows it)', () => {
    const hop = describeHop({ request: { method: 'GET', url: '/x', headers: { Authorization: `Bearer ${delegated}` } }, response: { status: 200, data: {} } });
    expect(hop.request.headers.Authorization).toBe(`Bearer ${delegated}`);
  });

  test('tolerates a missing request/response', () => {
    expect(describeHop({})).toEqual({ request: { method: undefined, url: undefined, headers: {}, body: undefined }, response: { status: undefined, body: undefined } });
  });
});

describe('decodeToken / tokenBlock', () => {
  test('decodes header and payload', () => {
    expect(decodeToken(delegated)).toEqual({ header: { alg: 'RS256', kid: 'k1' }, payload: { sub: 'u1', act: { client_id: 'AGENT' }, aud: ['obo-demo.ping.demo'] } });
  });
  test('returns null for malformed input instead of throwing', () => {
    expect(decodeToken('not-a-jwt')).toBeNull();
    expect(decodeToken(undefined)).toBeNull();
  });
  test('tokenBlock carries role, label, raw and decoded', () => {
    expect(tokenBlock('delegated', 'Delegated token', delegated)).toMatchObject({ role: 'delegated', label: 'Delegated token', raw: delegated, decoded: { header: { alg: 'RS256' } } });
  });
});

describe('downstreamHop / withDetail', () => {
  test('labels the in-process check and shows the Authorization header and the verifier JSON', () => {
    const hop = downstreamHop(delegated, { status: 200, acting_for: 'u1', acted_by: { client_id: 'AGENT' } });
    expect(hop.request.method).toBe('GET');
    expect(hop.request.url).toMatch(/in-process/);
    expect(hop.request.headers.Authorization).toBe(`Bearer ${delegated}`);
    expect(hop.response).toEqual({ status: 200, body: { status: 200, acting_for: 'u1', acted_by: { client_id: 'AGENT' } } });
  });
  test('withDetail adds only what is given', () => {
    expect(withDetail({ id: 1 }, null, null)).toEqual({ id: 1 });
    expect(withDetail({ id: 1 }, { request: {} }, [{ role: 'user' }])).toEqual({ id: 1, wire: { request: {} }, tokens: [{ role: 'user' }] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd demo_api_server && CI=true node node_modules/jest/bin/jest.js src/__tests__/services/oboWire.test.js --forceExit`
Expected: FAIL, "Cannot find module '../../../services/oboWire'".

- [ ] **Step 3: Implement**

```js
// demo_api_server/services/oboWire.js
'use strict';
// Browser-safe description of the real PingOne hops for the /obo-demo page. Tokens are shown as-is
// (demo/training); client secrets, assertions and Basic credentials are always masked.
const MASK = '***';
const isSecretKey = (key) => /secret|password|assertion/i.test(key);

function maskDeep(value) {
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isSecretKey(k) ? MASK : maskDeep(v)]));
  }
  return value;
}

function maskHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => (
    /^authorization$/i.test(k) && /^basic\s/i.test(String(v)) ? [k, 'Basic ***'] : [k, v]
  )));
}

function describeHop(info = {}) {
  const request = info.request || {};
  const response = info.response || {};
  return {
    request: { method: request.method, url: request.url, headers: maskHeaders(request.headers), body: maskDeep(request.body) },
    response: { status: response.status, body: maskDeep(response.data) },
  };
}

function decodeToken(jwt) {
  try {
    const [header, payload] = String(jwt).split('.');
    return {
      header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    };
  } catch (_e) {
    return null;
  }
}

const tokenBlock = (role, label, raw) => ({ role, label, raw, decoded: decodeToken(raw) });

// Steps 5 and 6 call the verifier in-process; say so rather than pretend it was a network call.
const downstreamHop = (token, result) => ({
  request: { method: 'GET', url: '/api/obo/downstream (in-process check, same logic as the route)', headers: { Authorization: `Bearer ${token}` }, body: null },
  response: { status: result.status, body: result },
});

const withDetail = (step, wire, tokens) => ({ ...step, ...(wire ? { wire } : {}), ...(tokens ? { tokens } : {}) });

module.exports = { MASK, describeHop, decodeToken, tokenBlock, downstreamHop, withDetail };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd demo_api_server && CI=true node node_modules/jest/bin/jest.js src/__tests__/services/oboWire.test.js --forceExit`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_server/services/oboWire.js demo_api_server/src/__tests__/services/oboWire.test.js
git commit -m "feat(obo): oboWire - browser-safe hops with secrets masked and tokens decoded

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `onWire` hooks in the two PingOne calls (regression-protected files)

**Files:**
- Modify: `demo_api_server/services/oauthService.js` (`performTokenExchangeAs`)
- Modify: `demo_api_server/services/agentCCTokenService.js` (`getAgentCCToken`)
- Test: `demo_api_server/src/__tests__/oauthService.onWire.test.js` (new)
- Test: `demo_api_server/src/__tests__/agentCCTokenService.onWire.test.js` (new)

**Interfaces:**
- Produces: `performTokenExchangeAs(..., exchangeOptions)` accepts `exchangeOptions.onWire(info)`; `getAgentCCToken(req, options)` accepts `options.onWire(info)`. `info = { request:{method,url,headers,body}, response:{status,data} }` with real values (including secrets and tokens); the caller (`runObo`) masks via `oboWire`. Absent hook: behavior and return values identical.

- [ ] **Step 0: Read first**

Read `.claude/skills/regression-guard/SKILL.md` and REGRESSION_PLAN.md section 1 for the rows covering `oauthService.js` and `agentCCTokenService.js`. State in your report what you will not break. Confirm with `grep -rn "onWire" demo_api_server --include=*.js | grep -v node_modules` that no code uses that name yet (expect no hits).

- [ ] **Step 1: Write the failing tests**

```js
// demo_api_server/src/__tests__/oauthService.onWire.test.js
'use strict';
jest.mock('axios');
const axios = require('axios');
jest.mock('../../config/oauth', () => ({ tokenEndpoint: 'https://pingone.example/as/token', clientId: 'admin', clientSecret: 'admin-secret', tokenEndpointAuthMethod: 'post' }));
jest.mock('../../services/configStore', () => ({ getOAuthProvider: () => 'pingone', getEffective: () => '' }));
const oauthService = require('../../services/oauthService');

const call = (opts) => oauthService.performTokenExchangeAs('subj', 'act', 'ex', 'ex-secret', 'aud.example', 'obo:invoke', 'post', { tokenEndpoint: 'https://pingone.example/as/token', ...opts });

beforeEach(() => jest.clearAllMocks());

test('onWire receives the real request and response on success', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'delegated.jwt.x', token_type: 'Bearer', expires_in: 900 } });
  const onWire = jest.fn();
  const out = await call({ onWire });
  expect(out).toBe('delegated.jwt.x');
  const info = onWire.mock.calls[0][0];
  expect(info.request).toMatchObject({ method: 'POST', url: 'https://pingone.example/as/token' });
  expect(info.request.body).toMatchObject({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: 'subj', actor_token: 'act',
    audience: 'aud.example', scope: 'obo:invoke', client_id: 'ex', client_secret: 'ex-secret',
  });
  expect(info.response).toEqual({ status: 200, data: expect.objectContaining({ access_token: 'delegated.jwt.x', expires_in: 900 }) });
});

test('onWire receives PingOne\'s real error response when the exchange fails, and the call still throws', async () => {
  axios.post.mockRejectedValue(Object.assign(new Error('Request failed'), { response: { status: 400, data: { error: 'invalid_scope', error_description: 'bad scope' } } }));
  const onWire = jest.fn();
  await expect(call({ onWire })).rejects.toThrow(/invalid_scope|bad scope/);
  expect(onWire).toHaveBeenCalledTimes(1);
  expect(onWire.mock.calls[0][0].response).toEqual({ status: 400, data: { error: 'invalid_scope', error_description: 'bad scope' } });
});

test('a throwing hook changes nothing: success still returns the token', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'delegated.jwt.x' } });
  await expect(call({ onWire: () => { throw new Error('hook bug'); } })).resolves.toBe('delegated.jwt.x');
});

test('a 200 response without an access token is reported once (no double hook call)', async () => {
  axios.post.mockResolvedValue({ status: 200, data: {} });
  const onWire = jest.fn();
  await expect(call({ onWire })).rejects.toThrow(/missing access_token/);
  expect(onWire).toHaveBeenCalledTimes(1);
});

test('without a hook the result and the request are exactly as before', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'delegated.jwt.x' } });
  await expect(call({})).resolves.toBe('delegated.jwt.x');
  expect(axios.post).toHaveBeenCalledTimes(1);
});
```

```js
// demo_api_server/src/__tests__/agentCCTokenService.onWire.test.js
'use strict';
const axios = require('axios');
jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: (key) => ({ pingone_mcp_token_exchanger_client_id: 'agent-client', pingone_mcp_token_exchanger_client_secret: 'agent-secret', pingone_mcp_token_exchanger_cc_auth_method: 'post' })[key],
}));
jest.mock('../../config/oauth', () => ({ tokenEndpoint: 'https://pf.example.test/as/token.oauth2' }));
jest.mock('../../services/oauthEndpointResolver', () => ({ getPingOneTokenEndpoint: () => 'https://auth.pingone.com/test-env/as/token' }));
jest.mock('../../utils/tokenUtils', () => ({ decodeJwt: () => ({ claims: { sub: 'agent-client' } }) }));
const { getAgentCCToken } = require('../../services/agentCCTokenService');

beforeEach(() => jest.clearAllMocks());

test('onWire receives the real client-credentials request and response', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'actor.jwt.x', token_type: 'Bearer', expires_in: 3600, scope: 'agent:invoke' } });
  const onWire = jest.fn();
  const out = await getAgentCCToken({}, { clientId: 'AGENT', clientSecret: 'agent-sec', scope: ['agent:invoke'], authMethod: 'post', onWire });
  expect(out.access_token).toBe('actor.jwt.x');
  const info = onWire.mock.calls[0][0];
  expect(info.request).toMatchObject({ method: 'POST', url: 'https://auth.pingone.com/test-env/as/token' });
  expect(info.request.body).toMatchObject({ grant_type: 'client_credentials', scope: 'agent:invoke', client_id: 'AGENT', client_secret: 'agent-sec' });
  expect(info.response).toEqual({ status: 200, data: expect.objectContaining({ access_token: 'actor.jwt.x', expires_in: 3600 }) });
});

test('onWire also receives an error response (non-2xx), and the call still throws', async () => {
  axios.post.mockResolvedValue({ status: 401, data: { error: 'invalid_client' } });
  const onWire = jest.fn();
  await expect(getAgentCCToken({}, { clientId: 'AGENT', clientSecret: 'bad', scope: ['agent:invoke'], authMethod: 'post', onWire })).rejects.toThrow(/Failed to obtain agent CC token/);
  expect(onWire.mock.calls[0][0].response).toEqual({ status: 401, data: { error: 'invalid_client' } });
});

test('a throwing hook changes nothing', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'actor.jwt.x', scope: 'agent:invoke' } });
  const out = await getAgentCCToken({}, { clientId: 'AGENT', clientSecret: 's', scope: ['agent:invoke'], authMethod: 'post', onWire: () => { throw new Error('hook bug'); } });
  expect(out.access_token).toBe('actor.jwt.x');
});

test('without a hook the call is unchanged', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'actor.jwt.x', scope: 'agent:invoke' } });
  const out = await getAgentCCToken({}, { clientId: 'AGENT', clientSecret: 's', scope: ['agent:invoke'], authMethod: 'post' });
  expect(out).toMatchObject({ access_token: 'actor.jwt.x', clientId: 'AGENT' });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 node node_modules/jest/bin/jest.js src/__tests__/oauthService.onWire.test.js src/__tests__/agentCCTokenService.onWire.test.js --forceExit`
Expected: FAIL (the hook tests fail because `onWire` is never called; the no-hook tests may already pass).

- [ ] **Step 3: Implement (purely additive)**

`oauthService.js`, inside `performTokenExchangeAs`, directly after `const startTime = Date.now();` and before the `try {`, add:

```js
    // Optional display hook (OBO demo): hand the real request/response to the caller. Never affects the exchange.
    const wire = (response) => {
      if (typeof exchangeOptions.onWire !== 'function') return;
      try {
        exchangeOptions.onWire({
          request: { method: 'POST', url: tokenEndpoint, headers: { ...headers }, body: Object.fromEntries(body) },
          response: { status: response?.status, data: response?.data },
        });
      } catch (_hookError) { /* a display hook must never change the exchange */ }
    };
```
Right after `const response = managed ? await sidecarRelay.post('token', body) : await axios.post(tokenEndpoint, body.toString(), { headers });` add the line `wire(response);` (before `const exchanged = response.data.access_token;`). At the top of the `catch (error) {` block (before `const pingoneData = ...`), add `if (error.response) wire(error.response);`.

`agentCCTokenService.js`, inside `getAgentCCToken`, directly after `const tokenData = tokenResponse.data;` add:

```js
    // Optional display hook (OBO demo): the real request/response, including error responses. Never affects the call.
    if (typeof options.onWire === 'function') {
      try {
        options.onWire({
          request: { method: 'POST', url: tokenEndpoint, headers: { ...headers }, body: Object.fromEntries(body) },
          response: { status: tokenResponse.status, data: tokenData },
        });
      } catch (_hookError) { /* a display hook must never change the call */ }
    }
```

- [ ] **Step 4: Run to verify they pass, plus every existing test that touches these files**

Run: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 node node_modules/jest/bin/jest.js src/__tests__/oauthService.onWire.test.js src/__tests__/agentCCTokenService.onWire.test.js src/__tests__/oauthService.idJag.test.js src/__tests__/oauthService.dedicatedExchanger.test.js src/__tests__/agentCCTokenService.scopeVertical.test.js src/__tests__/agentCCTokenService.sidecarRelay.test.js src/__tests__/agentMcpTokenService.test.js --forceExit`
Expected: all PASS (existing ones unchanged). Also run `grep -rln "performTokenExchangeAs\|getAgentCCToken" demo_api_server/src/__tests__ demo_api_server/tests | head` and run any further suite that names either function; report the list and result.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_server/services/oauthService.js demo_api_server/services/agentCCTokenService.js demo_api_server/src/__tests__/oauthService.onWire.test.js demo_api_server/src/__tests__/agentCCTokenService.onWire.test.js
git commit -m "feat(obo): optional onWire hook on the exchange and client-credentials calls

Additive and off by default; a throwing hook cannot change either call.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `runObo` capture and the `/run` route

**Files:**
- Modify: `demo_api_server/services/oboExchangeService.js`
- Modify: `demo_api_server/routes/obo.js` (`POST /run` only)
- Test: `demo_api_server/src/__tests__/services/oboExchangeService.test.js` (append)
- Test: `demo_api_server/src/__tests__/routes/obo.test.js` (append inside the existing `POST /api/obo/run` describe)

**Interfaces:**
- Consumes: Task 1 (`describeHop`, `tokenBlock`, `downstreamHop`, `withDetail`), Task 2 (`onWire` options), existing `oboTrace` step builders.
- Produces: `runObo({ req, subjectToken, source, capture=false }, deps)`: with `capture` each step may carry `wire` and `tokens`; without it the return is identical to today. `/run` passes `capture: true` and sets `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing tests**

Append to `oboExchangeService.test.js` (it already mocks `oboConfig`, `agentCCTokenService`, `oauthEndpointResolver`, `oauthService`, and defines `jwt`, `user`, `delegated`, `deps`):

```js
describe('capture', () => {
  const actorWire = { request: { method: 'POST', url: 'https://pingone/as/token', headers: {}, body: { grant_type: 'client_credentials', client_id: 'AGENT', client_secret: 'PLANTED-AGENT-SECRET' } }, response: { status: 200, data: { access_token: 'actor.jwt.x', expires_in: 3600 } } };
  const exchangeWire = { request: { method: 'POST', url: 'https://pingone/as/token', headers: { Authorization: 'Basic cGxhbnRlZA==' }, body: { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: user, actor_token: 'actor.jwt.x', client_secret: 'PLANTED-EX-SECRET' } }, response: { status: 200, data: { access_token: delegated, expires_in: 900 } } };
  const capturingDeps = () => deps({
    getActorToken: jest.fn(async (_req, cfg) => { cfg.onWire?.(actorWire); return 'actor.jwt.x'; }),
    exchange: jest.fn(async (_s, _a, cfg) => { cfg.onWire?.(exchangeWire); return delegated; }),
    verifyDownstream: jest.fn(async (t) => (t === delegated ? { status: 200, acting_for: 'u1', acted_by: { client_id: 'AGENT' } } : { status: 401, error: 'no act object' })),
  });

  test('without capture there is no wire and no tokens on any step (the Claude path)', async () => {
    const ev = await runObo({ req: {}, subjectToken: user, source: 'claude' }, capturingDeps());
    for (const s of ev.steps) { expect(s.wire).toBeUndefined(); expect(s.tokens).toBeUndefined(); }
    expect(JSON.stringify(ev)).not.toContain(delegated);
    expect(JSON.stringify(ev)).not.toContain(user);
  });

  test('with capture each hop has its real wire and the token steps carry raw + decoded tokens', async () => {
    const ev = await runObo({ req: {}, subjectToken: user, source: 'page', capture: true }, capturingDeps());
    const by = Object.fromEntries(ev.steps.map((s) => [s.id, s]));
    expect(by[1].tokens[0]).toMatchObject({ role: 'user', raw: user, decoded: { payload: { sub: 'u1' } } });
    expect(by[2].wire.request.body.client_id).toBe('AGENT');
    expect(by[2].tokens[0].role).toBe('actor');
    expect(by[3].wire.request.body.subject_token).toBe(user);
    expect(by[3].wire.response.body.access_token).toBe(delegated);
    expect(by[3].tokens[0]).toMatchObject({ role: 'delegated', raw: delegated, decoded: { payload: { act: { client_id: 'AGENT' } } } });
    expect(by[4].tokens[0].role).toBe('delegated');
    expect(by[5].wire.request.headers.Authorization).toBe(`Bearer ${delegated}`);
    expect(by[5].wire.response.status).toBe(200);
    expect(by[6].wire.request.headers.Authorization).toBe(`Bearer ${user}`);
    expect(by[6].wire.response.status).toBe(401);
  });

  test('with capture, client secrets and Basic credentials never appear anywhere in the result', async () => {
    const ev = await runObo({ req: {}, subjectToken: user, source: 'page', capture: true }, capturingDeps());
    const text = JSON.stringify(ev);
    for (const planted of ['PLANTED-AGENT-SECRET', 'PLANTED-EX-SECRET', 'cGxhbnRlZA==']) expect(text).not.toContain(planted);
  });

  test('the evidence and checks stay token-free even with capture', async () => {
    const ev = await runObo({ req: {}, subjectToken: user, source: 'page', capture: true }, capturingDeps());
    const { steps, ...evidence } = ev;
    expect(JSON.stringify(evidence)).not.toContain(delegated);
    expect(JSON.stringify(evidence)).not.toContain(user);
  });

  test('a failed exchange attaches PingOne\'s real error response to the failed step', async () => {
    const failWire = { request: { method: 'POST', url: 'https://pingone/as/token', headers: {}, body: { subject_token: user, client_secret: 'PLANTED-EX-SECRET' } }, response: { status: 400, data: { error: 'invalid_scope', error_description: 'bad scope' } } };
    const d = capturingDeps();
    d.exchange = jest.fn(async (_s, _a, cfg) => { cfg.onWire?.(failWire); throw Object.assign(new Error('Token exchange failed'), { pingoneError: 'invalid_scope', pingoneErrorDescription: 'bad scope', httpStatus: 400 }); });
    const err = await runObo({ req: {}, subjectToken: user, source: 'page', capture: true }, d).catch((e) => e);
    const failed = err.trace.find((s) => s.status === 'fail');
    expect(failed.id).toBe(3);
    expect(failed.wire.response.body).toEqual({ error: 'invalid_scope', error_description: 'bad scope' });
    expect(JSON.stringify(err.trace)).not.toContain('PLANTED-EX-SECRET');
  });
});
```

Append to the `POST /api/obo/run` describe in `routes/obo.test.js` (it has `runApp(session)` and the mocked `runObo`):

```js
  test('passes capture: true and sets Cache-Control: no-store', async () => {
    runObo.mockResolvedValue({ source: 'page', checks: [], steps: [] });
    const res = await request(runApp({ oauthTokens: { accessToken: 'tok-sess' } })).post('/api/obo/run');
    expect(res.status).toBe(200);
    expect(runObo).toHaveBeenCalledWith(expect.objectContaining({ subjectToken: 'tok-sess', source: 'page', capture: true }));
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
```
and, in the `tools/call` tests of `POST /api/obo/mcp`, add one asserting the Claude path does not capture:

```js
    test('the MCP tool call does not ask for capture', async () => {
      runObo.mockResolvedValue(evidence);
      await post(rpc('tools/call', { name: 'act_on_my_behalf' }));
      expect(runObo).toHaveBeenCalledWith(expect.objectContaining({ source: 'claude' }));
      expect(runObo.mock.calls[0][0].capture).toBeUndefined();
    });
```
(Use the existing `post`, `rpc` and `evidence` helpers in that describe; if the helper names differ, adapt to the file.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 node node_modules/jest/bin/jest.js src/__tests__/services/oboExchangeService.test.js src/__tests__/routes/obo.test.js --forceExit`
Expected: the new tests FAIL; every pre-existing test still passes.

- [ ] **Step 3: Implement**

`oboExchangeService.js`: add `const { describeHop, tokenBlock, downstreamHop, withDetail } = require('./oboWire');` with the other requires. Change `defaultDeps` so the hook rides on the config copy:

```js
  getActorToken: async (req, cfg) => (await getAgentCCToken(req, {
    clientId: cfg.agent.id, clientSecret: cfg.agent.secret, scope: [cfg.actorScope], authMethod: 'post', onWire: cfg.onWire,
  })).access_token,
  exchange: (subjectToken, actorToken, cfg) => oauthService.performTokenExchangeAs(
    subjectToken, actorToken, cfg.exchanger.id, cfg.exchanger.secret, cfg.audience, cfg.scope, 'post',
    { tokenEndpoint: oauthEndpointResolver.getPingOneTokenEndpoint(), onWire: cfg.onWire },
  ),
```
Replace `runObo` with:

```js
async function runObo({ req, subjectToken, source, capture = false }, deps = {}) {
  const cfg = getOboConfig();
  assertConfigured(cfg);
  const d = { ...defaultDeps, ...deps };
  // Real wire per hop, only when the page asks (capture). The Claude path never captures.
  const wires = {};
  const cfgFor = (id) => (capture ? { ...cfg, onWire: (info) => { wires[id] = describeHop(info); } } : cfg);
  const detail = (step, wire, tokens) => (capture ? withDetail(step, wire, tokens) : step);

  const steps = [detail(trace.signedInStep(subjectToken), null, [tokenBlock('user', 'Your access token (session)', subjectToken)])];
  // A failed hop throws with the partial trace attached, so the page can show where it stopped.
  const fail = (id, started, err) => Object.assign(err, { trace: [...steps, detail(trace.failureStep(id, Date.now() - started, err, [subjectToken]), wires[id], null), ...trace.skipFrom(id + 1)] });

  let t = Date.now();
  let actorToken;
  try { actorToken = await d.getActorToken(req, cfgFor(2)); } catch (err) { throw fail(2, t, err); }
  steps.push(detail(trace.actorStep(actorToken, cfg, Date.now() - t), wires[2], [tokenBlock('actor', 'Agent (actor) token', actorToken)]));

  t = Date.now();
  let delegatedToken;
  try { delegatedToken = await d.exchange(subjectToken, actorToken, cfgFor(3)); } catch (err) { throw fail(3, t, err); }
  steps.push(detail(trace.exchangeStep(cfg, subjectToken, actorToken, Date.now() - t), wires[3], [tokenBlock('delegated', 'Delegated token', delegatedToken)]));

  const timed = async (token) => { const started = Date.now(); const r = await d.verifyDownstream(token); return { status: r.status, ms: Date.now() - started, body: r }; };
  const [accepted, refused] = await Promise.all([timed(delegatedToken), timed(subjectToken)]);
  const evidence = buildEvidence({
    source, subjectToken, delegatedToken, actorClientId: cfg.agent.id,
    downstream: { delegated: accepted.status, userToken: refused.status },
  });
  const result = trace.resultSteps(evidence, accepted, refused);
  if (capture) {
    result[0] = withDetail(result[0], null, [tokenBlock('delegated', 'Delegated token', delegatedToken)]);
    result[1] = withDetail(result[1], downstreamHop(delegatedToken, accepted.body), null);
    result[2] = withDetail(result[2], downstreamHop(subjectToken, refused.body), null);
  }
  return { ...evidence, steps: [...steps, ...result] };
}
```
(`resultSteps` returns steps 4, 5, 6, 7 in that order; indices 0, 1, 2 are steps 4, 5, 6. Confirm by reading `oboTrace.resultSteps` and say so in your report.)

`routes/obo.js`, `router.post('/run', ...)`: pass `capture: true` (`runObo({ req, subjectToken, source: 'page', capture: true })`) and, before `return res.json(evidence);`, add `res.set('Cache-Control', 'no-store');`. Also set the same header on the 502 failure response path (`res.set('Cache-Control', 'no-store')` before `res.status(502)...`) because the failed trace now carries tokens. Do not change anything else in that route; the existing failure log line stays token-free.

- [ ] **Step 4: Run to verify they pass**

Run: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 node node_modules/jest/bin/jest.js src/__tests__/services/oboExchangeService.test.js src/__tests__/routes/obo.test.js src/__tests__/services/oboWire.test.js --forceExit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_server/services/oboExchangeService.js demo_api_server/routes/obo.js demo_api_server/src/__tests__/services/oboExchangeService.test.js demo_api_server/src/__tests__/routes/obo.test.js
git commit -m "feat(obo): capture the real wire and tokens per step for the in-app run only

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `OboStepWire` component and page integration

**Files:**
- Create: `demo_api_ui/src/components/obo/OboStepWire.jsx`
- Create: `demo_api_ui/src/components/obo/OboStepWire.css`
- Test: `demo_api_ui/src/components/obo/__tests__/OboStepWire.test.jsx`
- Modify: `demo_api_ui/src/pages/OboDemoPage.jsx`, `demo_api_ui/src/pages/OboDemoPage.css`
- Test: `demo_api_ui/src/pages/__tests__/OboDemoPage.test.jsx` (append; do not edit existing tests)

**Interfaces:**
- Consumes: step objects from `/api/obo/run` with optional `wire = { request:{method,url,headers,body}, response:{status,body} }` and `tokens = [{ role, label, raw, decoded:{header,payload}|null }]`.
- Produces: `OboStepWire({ step })` default export; renders nothing when the step has no `wire` and no `tokens`.

- [ ] **Step 1: Write the failing tests**

```jsx
// demo_api_ui/src/components/obo/__tests__/OboStepWire.test.jsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import OboStepWire from "../OboStepWire";

const RAW = "HEADER.PAYLOAD.SIG";
const step = {
  id: 3,
  wire: {
    request: { method: "POST", url: "https://auth.pingone.com/env/as/token", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", client_id: "ex", client_secret: "***", subject_token: "SUBJ.JWT.X" } },
    response: { status: 200, body: { access_token: RAW, expires_in: 900 } },
  },
  tokens: [{ role: "delegated", label: "Delegated token", raw: RAW, decoded: { header: { alg: "RS256" }, payload: { sub: "u1", act: { client_id: "AGENT" }, aud: ["obo-demo.ping.demo"], scope: "obo:invoke", exp: 1792010389 } } }],
};

describe("OboStepWire", () => {
  it("shows the real request and response", () => {
    render(<OboStepWire step={step} />);
    const req = screen.getByRole("region", { name: "Request" });
    expect(req).toHaveTextContent("POST https://auth.pingone.com/env/as/token");
    expect(req).toHaveTextContent("grant_type=urn:ietf:params:oauth:grant-type:token-exchange");
    expect(req).toHaveTextContent("subject_token=SUBJ.JWT.X");
    const res = screen.getByRole("region", { name: "Response" });
    expect(res).toHaveTextContent("HTTP 200");
    expect(res).toHaveTextContent(`"access_token": "${RAW}"`);
  });

  it("shows the client secret only as ***", () => {
    render(<OboStepWire step={step} />);
    expect(screen.getByRole("region", { name: "Request" })).toHaveTextContent("client_secret=***");
  });

  it("shows the raw token and its decoded header and payload, with act as an object", () => {
    render(<OboStepWire step={step} />);
    const tok = screen.getByRole("region", { name: "Delegated token" });
    expect(tok).toHaveTextContent(RAW);
    expect(tok).toHaveTextContent('"alg": "RS256"');
    expect(tok).toHaveTextContent('"client_id": "AGENT"');
  });

  it("copies a block to the clipboard", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OboStepWire step={step} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Delegated token (raw)" }));
    expect(writeText).toHaveBeenCalledWith(RAW);
  });

  it("does not crash without a clipboard API", () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<OboStepWire step={step} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Copy Delegated token (raw)" }))).not.toThrow();
  });

  it("renders a wire-only step (no tokens) and a token-only step (no wire)", () => {
    const { rerender } = render(<OboStepWire step={{ wire: step.wire }} />);
    expect(screen.getByRole("region", { name: "Request" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Delegated token" })).toBeNull();
    rerender(<OboStepWire step={{ tokens: step.tokens }} />);
    expect(screen.queryByRole("region", { name: "Request" })).toBeNull();
    expect(screen.getByRole("region", { name: "Delegated token" })).toBeInTheDocument();
  });

  it("says so when a token cannot be decoded, and still shows it raw", () => {
    render(<OboStepWire step={{ tokens: [{ role: "actor", label: "Agent (actor) token", raw: "opaque", decoded: null }] }} />);
    expect(screen.getByRole("region", { name: "Agent (actor) token" })).toHaveTextContent("opaque");
    expect(screen.getByText(/could not decode/i)).toBeInTheDocument();
  });

  it("shows PingOne's real error response for a failed hop", () => {
    render(<OboStepWire step={{ wire: { request: { method: "POST", url: "u", headers: {}, body: {} }, response: { status: 400, body: { error: "invalid_scope", error_description: "bad scope" } } } }} />);
    expect(screen.getByRole("region", { name: "Response" })).toHaveTextContent("HTTP 400");
    expect(screen.getByRole("region", { name: "Response" })).toHaveTextContent('"error": "invalid_scope"');
  });

  it("renders nothing for a step with no detail", () => {
    const { container } = render(<OboStepWire step={{ id: 7 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Append to the page test file (reuse its existing `okSteps`, `post` mock and click helpers; do not edit existing tests):

```jsx
describe("OboDemoPage step wire detail", () => {
  const withWire = (steps) => steps.map((s) => (s.id === 3 ? {
    ...s,
    wire: { request: { method: "POST", url: "https://auth.pingone.com/env/as/token", headers: {}, body: { client_id: "exch", client_secret: "***" } }, response: { status: 200, body: { expires_in: 900 } } },
    tokens: [{ role: "delegated", label: "Delegated token", raw: "H.P.S", decoded: { header: { alg: "RS256" }, payload: { sub: "user-1" } } }],
  } : s));

  it("shows the request, response and tokens when a step with wire is opened", async () => {
    post.mockResolvedValue({ data: { steps: withWire(okSteps), checks: [{ id: "a", label: "ok", pass: true }] } });
    render(<OboDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: /Token exchange \(RFC 8693\)/ }));
    expect(screen.getByRole("region", { name: "Request" })).toHaveTextContent("POST https://auth.pingone.com/env/as/token");
    expect(screen.getByRole("region", { name: "Delegated token" })).toHaveTextContent("H.P.S");
  });

  it("shows nothing extra for a step without wire", async () => {
    post.mockResolvedValue({ data: { steps: okSteps, checks: [{ id: "a", label: "ok", pass: true }] } });
    render(<OboDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: /Token exchange \(RFC 8693\)/ }));
    expect(screen.queryByRole("region", { name: "Request" })).toBeNull();
  });

  it("no longer claims that tokens never reach the page", () => {
    render(<OboDemoPage />);
    expect(document.body.textContent).not.toMatch(/Tokens appear only as short hashes/i);
    expect(document.body.textContent).not.toMatch(/never sent to the browser/i);
  });
});
```
(If the page test file's helper names differ from `okSteps`/`post`, adapt to what is there.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd demo_api_ui && node node_modules/vitest/vitest.mjs run src/components/obo/__tests__/OboStepWire.test.jsx src/pages/__tests__/OboDemoPage.test.jsx`
Expected: FAIL (module not found; page tests for wire and copy).

- [ ] **Step 3: Implement**

```jsx
// demo_api_ui/src/components/obo/OboStepWire.jsx
import "./OboStepWire.css";

const pretty = (v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
const form = (b) => (b && typeof b === "object" ? Object.entries(b).map(([k, v]) => `${k}=${v}`).join("\n&") : pretty(b));
const copy = (text) => { try { navigator.clipboard?.writeText(text); } catch (_e) { /* no clipboard in this context */ } };

function Block({ label, text }) {
  if (!text) return null;
  return (
    <div className="obo-wire__block">
      <div className="obo-wire__label">
        <span>{label}</span>
        <button type="button" className="obo-wire__copy" aria-label={`Copy ${label}`} onClick={() => copy(text)}>Copy</button>
      </div>
      <pre className="obo-wire__pre">{text}</pre>
    </div>
  );
}

// The real request/response and tokens of one hop. Client secrets arrive already masked from the BFF.
export default function OboStepWire({ step }) {
  const wire = step?.wire;
  const tokens = step?.tokens || [];
  if (!wire && tokens.length === 0) return null;
  return (
    <div className="obo-wire">
      {wire ? (
        <>
          <section aria-label="Request">
            <h4 className="obo-wire__h">Request</h4>
            <p className="obo-wire__line">{wire.request?.method} {wire.request?.url}</p>
            <Block label="Request headers" text={pretty(wire.request?.headers)} />
            <Block label="Request body" text={form(wire.request?.body)} />
          </section>
          <section aria-label="Response">
            <h4 className="obo-wire__h">Response</h4>
            <p className="obo-wire__line">HTTP {wire.response?.status}</p>
            <Block label="Response body" text={pretty(wire.response?.body)} />
          </section>
        </>
      ) : null}
      {tokens.map((tk) => (
        <section key={tk.role} aria-label={tk.label}>
          <h4 className="obo-wire__h">{tk.label}</h4>
          <Block label={`${tk.label} (raw)`} text={tk.raw} />
          {tk.decoded ? (
            <>
              <Block label={`${tk.label} decoded header`} text={pretty(tk.decoded.header)} />
              <Block label={`${tk.label} decoded payload`} text={pretty(tk.decoded.payload)} />
            </>
          ) : <p className="obo-wire__line">Could not decode this token.</p>}
        </section>
      ))}
    </div>
  );
}
```
(The accessible names of the copy buttons come from the block labels, e.g. "Copy Delegated token (raw)".)

```css
/* demo_api_ui/src/components/obo/OboStepWire.css */
.obo-wire { margin-top: 1rem; display: grid; gap: 1rem; color: var(--th-text); }
.obo-wire__h { font-size: var(--font-size-base); margin: 0 0 0.35rem; }
.obo-wire__line { color: var(--th-text-muted); margin: 0 0 0.35rem; overflow-wrap: anywhere; }
.obo-wire__block { margin-bottom: 0.5rem; }
.obo-wire__label { display: flex; justify-content: space-between; align-items: center; color: var(--th-text-muted); font-size: var(--font-size-sm); margin-bottom: 0.2rem; }
.obo-wire__copy { border: 1px solid var(--th-border-strong); background: var(--th-bg-card); color: var(--th-text); border-radius: 4px; padding: 0.1rem 0.5rem; cursor: pointer; font-size: var(--font-size-sm); }
.obo-wire__pre { background: var(--th-bg-inset); border: 1px solid var(--th-border); border-radius: 6px; padding: 0.6rem; margin: 0; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-size-sm); }
```
(Verify each token exists in `demo_api_ui/src/index.css`; if one does not, use the nearest existing token and say so.)

`OboDemoPage.jsx` edits (additive; keep every other line):
1. `import OboStepWire from "../components/obo/OboStepWire";` after the other imports.
2. In `renderDetails()`'s final `return (...)`, directly after `{body}` add: `{step && st !== "idle" && st !== "skip" ? <OboStepWire step={step} /> : null}`.
3. Copy corrections (exact replacements):
   - `STEPS[1].why`: replace `"Your session holds a PingOne access token. The BFF reads it server-side; it is never sent to the browser or the model."` with `"Your session holds a PingOne access token. The BFF reads it server-side and uses it as the subject of the exchange. It is shown here because it is your own token; over MCP the model never receives it."`
   - `STEPS[7]`: title `"No token leaked"` -> `"No token reached the model"`; route `"BFF → browser / model"` -> `"BFF → MCP result / live event"`; why -> `"The MCP result text and the Claude live event are scanned for token text. This page shows tokens because you are the signed-in user who ran the exchange; the model never receives them."`; its row `["scanned", "evidence object and MCP result text"]` -> `["scanned", "MCP result text and live event evidence"]`.
   - The lede sentence `The model never sees either token.` -> `Over MCP the model never sees either token; this page shows them so you can follow each hop.`
   - The legend `Each line is one hop. Click a line to see what was sent and what came back. Tokens appear only as short hashes and claims.` -> `Each line is one hop. Click a line to see the real request, the real response and the tokens. Client secrets are always masked.`
   If any of these strings differs in the file, find the nearest equivalent and report it. If an existing test pins an old string (grep `demo_api_ui/src/pages/__tests__/OboDemoPage.test.jsx` for the old texts and "No token leaked"), update only that assertion and say so.

Append to `OboDemoPage.css` only if the integration needs a rule (the component carries its own CSS); otherwise leave it unchanged.

- [ ] **Step 4: Run to verify they pass, then the UI gate**

Run: `cd demo_api_ui && node node_modules/vitest/vitest.mjs run src/components/obo/__tests__ src/pages/__tests__/OboDemoPage.test.jsx && npm run build`
Expected: all PASS, build exits 0. From the repo root: `npm run authz:verify` (OK).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_ui/src/components/obo/OboStepWire.jsx demo_api_ui/src/components/obo/OboStepWire.css demo_api_ui/src/components/obo/__tests__/OboStepWire.test.jsx demo_api_ui/src/pages/OboDemoPage.jsx demo_api_ui/src/pages/__tests__/OboDemoPage.test.jsx
git commit -m "feat(obo-ui): real request, response and tokens in the step details

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(Add `demo_api_ui/src/pages/OboDemoPage.css` to the `git add` only if you changed it.)

---

### Task 5: Runbook and gates

**Files:**
- Modify: `docs/runbooks/obo-demo.md`

- [ ] **Step 1:** In "Demo A: from the app", replace the expectation line with: after Run, click any trace line; the Step details show the real request and response of that hop, the raw token(s) with a Copy button, and the decoded header and payload; step 3 shows the exact RFC 8693 request PingOne received and the delegated token it returned; steps 5 and 6 show the in-process downstream check with the `Authorization` header. Client secrets are masked (`***`). Add one talking point: "Paste the delegated token into jwt.io and point at `act`." Update the "Status" bullet that says the page "shows the checks only" to describe the new detail, and add a Troubleshooting row: a hop without a Request block means that hop was not captured (older BFF still running; restart it).
- [ ] **Step 2:** From the repo root run `npm run hygiene:check` on the committed tree and `npm run authz:verify`; from `demo_api_server` the full set: `CI=true ALLOW_TEST_NETWORK=1 node node_modules/jest/bin/jest.js src/__tests__/services/oboWire.test.js src/__tests__/services/oboExchangeService.test.js src/__tests__/routes/obo.test.js src/__tests__/oauthService.onWire.test.js src/__tests__/agentCCTokenService.onWire.test.js src/__tests__/oauthService.idJag.test.js src/__tests__/agentCCTokenService.scopeVertical.test.js src/__tests__/hostedAccessGate.test.js --forceExit`.
- [ ] **Step 3: Commit** `git add docs/runbooks/obo-demo.md` with message `docs(runbook): OBO demo step detail (real request/response/tokens)` and the trailer.

---

### Task 6: Live check (a person; no code)

- [ ] Restart the BFF so it runs the new code (the hooks and `capture` are BFF code), then open `/obo-demo`, click Run, and click all seven lines. Expect: step 2 and step 3 show the real PingOne request (with `client_secret=***`) and response; the raw tokens show with Copy; decoded payloads show `act` as an object; steps 5/6 show the in-process check with the `Authorization` header and the 200/401 responses.
- [ ] Paste the delegated token into jwt.io and confirm the `act` claim and audience match the page.
- [ ] Break something on purpose (for example an unknown scope in config) and confirm the failed hop shows PingOne's real error response.
- [ ] Confirm the Claude path is unchanged: call `act_on_my_behalf` from Claude Code; the result Claude shows has no token, and the "Live from Claude" card has no token or `wire` data.

---

## Self-Review

**Spec coverage:** S1 (details per step: Request, Response, tokens, decoded) = Tasks 3 and 4; S2 (real capture, failed hop shows PingOne's error) = Tasks 2 and 3; S3 (secrets masked) = Task 1 tests plus Task 3 planted-secret test; S4 (Claude path unchanged) = Task 3 tests (no wire/tokens without capture; MCP call does not request capture; evidence token-free); S5 (`no-store`, no logging) = Task 3 route test and the unchanged token-free failure log. Design sections 1 to 4 map to Tasks 2, 1, 3, 4; the copy changes and step 7 reword are in Task 4; runbook in Task 5. Non-goals respected (no Reveal, no run store, no Claude-path detail).

**Placeholders:** none; Task 4's page-test snippet and Task 3's route snippet say to adapt helper names to the existing files because those helpers were read from memory of the file shapes, but their assertions are fully specified.

**Type consistency:** `describeHop`, `decodeToken`, `tokenBlock`, `downstreamHop`, `withDetail`, `MASK` are defined in Task 1 and used with the same names in Task 3; the `onWire(info)` shape `{request:{method,url,headers,body}, response:{status,data}}` is identical in Tasks 2 and 3; the step fields `wire` and `tokens` (`{role,label,raw,decoded}`) are identical in Tasks 3 and 4; `resultSteps` returns steps 4 to 7 in order, so indices 0 to 2 are steps 4 to 6.
