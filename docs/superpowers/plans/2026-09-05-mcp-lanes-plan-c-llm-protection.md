# MCP Lanes Plan C — Reproducible config and the Privilege LLM protection panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fresh clone reproduces the Privilege LLM protection feature without hand-patching a secret, and the page can demonstrate — live — that Privilege denies an LLM call by policy.

**Architecture:** No new services. `services/privilegeLlmProxyService.js` already calls Anthropic and Google through a Privilege virtual key and already normalises a policy denial into `err.code = 'llm_policy_denied'`; this plan adds the OpenAI lane to that same file behind the same contract, exposes all three through one BFF route, and renders a panel on `/privilege-mcp-client`. Config comes first because the panel is untestable live without it.

**Tech Stack:** Node >= 22 CommonJS (BFF), Express 4.18, Jest 29.7 + supertest (BFF tests), React 19.2 + Vitest 3.2 (UI).

**Spec:** [`docs/superpowers/specs/2026-09-04-mcp-lanes-and-privilege-llm-design.md`](../specs/2026-09-04-mcp-lanes-and-privilege-llm-design.md) — workstreams **W6**, **W5**.

**Scope note:** Plan C of three. Plan A (merged, PR #2794) covered W1/W2/W7; Plan B covers W8/W3/W4. Spec §6 puts W6 before W5 and marks the pair independent of Plan B — **Plan C can be executed in parallel with Plan B**, and touches none of the same files except the shared page.

**Verified 2026-09-05, not assumed:** `PRIVILEGE_LLM_GATEWAY_URL`, `PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE` and `PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC` are read by `privilegeLlmProxyService.js` but appear in **none** of `k8s/03-secrets.yaml.template`, `demo_api_server/.env.example`, or `docker-compose.yml`. That is the whole of W6's problem statement, confirmed by grep.

## Global Constraints

- **Do not change the Privilege transport.** Out of scope (spec §9).
- **Do not change any frozen LLM setting** (resident tiers, `LLAMACPP_MAX_TOKENS`, `REASON_LOOP_TIMEOUT_MS`, `reasoning_effort`). This plan adds a *provider lane*, it does not touch local LLM config.
- **Do not touch the existing agent modes** `privilege_llm` and `privilege_claude` — spec §W5 says they stay as they are. Adding an export to `privilegeLlmProxyService.js` must not change the two existing exports' behaviour.
- `demo_api_server` is **CommonJS** (`'use strict'` + `require`), not ESM.
- BFF error responses use `{ error }`, never `{ message }`.
- UI: **Vitest, not jest.** `PrivilegeMcpClientPage.jsx` uses its own `api()` helper (line 78) — it checks `r.ok` and throws an Error carrying `data.error`. **Use it, do not hand-roll a `fetch`.**
- **Emoji allowlist only** (`REGRESSION_PLAN.md` §0). Allowed here: `⚠️` `✅` `❌`.
- **Theming:** no colour, background, or `font-size` in inline `style={{ }}`. **Grep `demo_api_ui/src/index.css` for a token before using it** — Plan A found five invented `--th-*` names. Confirmed-real for this plan: `--th-bg-card`, `--th-bg-hover`, `--th-border`, `--th-text`, `--th-text-muted`, `--th-status-error`, `--th-status-warning-bg`, `--th-status-warning-border`, `--th-status-warning-text`, `--font-size-xs`, `--font-size-2xs`.
- **Worktree required.** Stage explicitly with `git add <files>` — never `git add -A`. Verify `git branch --show-current` before each commit.
- BFF test command: `CI=true npx jest <paths> --forceExit` from `demo_api_server/`. `CI=true` is mandatory.
- **Virtual keys are credentials.** They go through the secrets path, **never a configmap**. `k8s/03-secrets.yaml.template` ships them **empty**. **Never print a secret's value** — log presence, never content. Do not rotate any existing secret.

---

### Task 1: Put the LLM gateway config on the reproducible path

**Files:**
- Modify: `k8s/03-secrets.yaml.template`
- Modify: `scripts/create-secrets.sh`
- Modify: `demo_api_server/.env.example`
- Modify: `docker-compose.yml`
- Test: `scripts/check-privilege-llm-config.test.js` (create)

**Interfaces:**
- Produces: four config keys wired end to end —
  - `PRIVILEGE_LLM_GATEWAY_URL` (not secret; the gateway origin)
  - `PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC` (secret)
  - `PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE` (secret)
  - `PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI` (secret, consumed by Task 2)

**Design note:** the test is a drift guard, not a value check. It asserts that every key the service *reads* appears in every place a deployment *supplies* it — the failure being fixed is a key that exists in code and nowhere else, which is invisible until a fresh clone fails at runtime with an empty string.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-privilege-llm-config.test.js`:

```js
#!/usr/bin/env node
/**
 * Every config key the Privilege LLM proxy reads must appear everywhere a
 * deployment supplies one. Run: node --test scripts/check-privilege-llm-config.test.js
 *
 * node:test rather than jest, matching the other root-level check-*.test.js
 * gates: this file sits at the repo root where CI installs no jest.
 *
 * The bug this pins: PRIVILEGE_LLM_GATEWAY_URL and the virtual keys were read
 * by services/privilegeLlmProxyService.js and present in NO template, so a
 * fresh clone got empty strings and a runtime failure with no setup step that
 * would have prevented it.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const KEYS = [
  'PRIVILEGE_LLM_GATEWAY_URL',
  'PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC',
  'PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE',
  'PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI',
];

const SURFACES = [
  ['k8s secrets template', 'k8s/03-secrets.yaml.template'],
  ['create-secrets.sh', 'scripts/create-secrets.sh'],
  ['.env.example', 'demo_api_server/.env.example'],
  ['docker-compose.yml', 'docker-compose.yml'],
];

describe('Privilege LLM config is reproducible', () => {
  for (const [label, file] of SURFACES) {
    for (const key of KEYS) {
      it(`${label} mentions ${key}`, () => {
        assert.match(read(file), new RegExp(key));
      });
    }
  }

  // A virtual key is a credential. A populated template would commit one.
  it('the k8s template ships the virtual keys empty', () => {
    const tpl = read('k8s/03-secrets.yaml.template');
    for (const key of KEYS.filter((k) => k.includes('VIRTUAL_KEY'))) {
      assert.match(
        tpl,
        new RegExp(`${key}:\\s*""\\s*$`, 'm'),
        `${key} must be present and empty in the template`,
      );
    }
  });

  // Guards the reverse drift: a key added to the service but to no surface.
  it('the service reads no PRIVILEGE_LLM_* key this test does not cover', () => {
    const svc = read('demo_api_server/services/privilegeLlmProxyService.js');
    const found = [...svc.matchAll(/process\.env\.(PRIVILEGE_LLM_[A-Z0-9_]+)/g)].map((m) => m[1]);
    const uncovered = [...new Set(found)].filter(
      (k) => !KEYS.includes(k) && !k.startsWith('PRIVILEGE_LLM_MODEL_'),
    );
    assert.deepEqual(uncovered, [], `uncovered keys: ${uncovered.join(', ')}`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/check-privilege-llm-config.test.js
```

Expected: FAIL — many cases, because none of the four keys is in any surface today.

- [ ] **Step 3: Add the keys to the k8s secrets template**

In `k8s/03-secrets.yaml.template`, beside the existing `ANTHROPIC_API_KEY: ""` (line 52), add:

```yaml
  # PingOne Privilege LLM protection. The gateway injects the real provider key
  # server-side and can deny a call by policy before it reaches the provider.
  # Virtual keys are issued in the Privilege console — they are credentials and
  # ship EMPTY here; create-secrets.sh mirrors real values from the BFF .env.
  PRIVILEGE_LLM_GATEWAY_URL: ""
  PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC: ""
  PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE: ""
  PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI: ""
```

- [ ] **Step 4: Mirror them in `create-secrets.sh`**

Find the block that mirrors `ANTHROPIC_API_KEY` from the BFF `.env` and add the four keys to the same list, following whatever loop or explicit-name pattern is already there:

```bash
grep -n "ANTHROPIC_API_KEY" scripts/create-secrets.sh
```

Match the existing style exactly rather than introducing a second mechanism. If the script uses an explicit array of key names, append these four to it; if it iterates a list, extend the list.

- [ ] **Step 5: Document them in `.env.example`**

In `demo_api_server/.env.example`, beside the existing `# ANTHROPIC_API_KEY=sk-ant-...` (line 438):

```bash
# --- PingOne Privilege LLM protection -----------------------------------
# Calls an LLM provider THROUGH Privilege: the gateway injects the real
# provider API key server-side, so this app never holds one, and a Privilege
# policy can deny the call before it reaches the provider.
#
# The gateway origin (no trailing slash). Routes appended by the service:
#   /llm/anthropic/v1/messages          native Anthropic Messages API
#   /llm/google/v1/chat/completions     OpenAI-compatible
#   /llm/openai/v1/chat/completions     OpenAI-compatible
# PRIVILEGE_LLM_GATEWAY_URL=https://mcpgw.ai-demo.ping-devops.com
#
# Virtual keys are issued per provider in the Privilege console
# (Virtual Keys > Add). They are NOT provider API keys — the provider key
# stays in Privilege. A missing key fails with a named error, not a 401.
# PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC=
# PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE=
# PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI=
```

- [ ] **Step 6: Pass them through `docker-compose.yml`**

In the `demo-api-server` service's `environment:` block, add:

```yaml
      PRIVILEGE_LLM_GATEWAY_URL: ${PRIVILEGE_LLM_GATEWAY_URL:-}
      PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC: ${PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC:-}
      PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE: ${PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE:-}
      PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI: ${PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI:-}
```

**Careful:** `environment:` **beats** `env_file` in Compose. An unset variable with the `:-` default becomes an empty string that *overrides* whatever `env_file` supplied. Confirm the service's `.env` route still wins for anyone already setting these — if the service relies on `env_file` for other LLM keys, add these to the `env_file` path instead and leave `environment:` alone.

- [ ] **Step 7: Run the test to verify it passes**

```bash
node --test scripts/check-privilege-llm-config.test.js
```

Expected: PASS, 18 tests.

- [ ] **Step 8: Prove a fresh container actually receives them**

A template mentioning a key does not prove the process gets it:

```bash
docker exec ai-demo-api-server printenv | grep -c PRIVILEGE_LLM_
```

Expected: `4`. Paste the count. Do **not** print the values.

- [ ] **Step 9: Commit**

```bash
git add k8s/03-secrets.yaml.template scripts/create-secrets.sh demo_api_server/.env.example docker-compose.yml scripts/check-privilege-llm-config.test.js
git commit -m "feat(privilege-llm): put the gateway URL and virtual keys on the reproducible path"
```

---

### Task 2: Add the OpenAI lane to the proxy service

**Files:**
- Modify: `demo_api_server/services/privilegeLlmProxyService.js`
- Test: `demo_api_server/tests/services/privilegeLlmProxyService.openai.test.js` (create)

**Interfaces:**
- Consumes: `llmFetch(url, init, opts)` from `./llmFetch`; `throwForResponse(res, data, label)` and `gatewayUrl()`, both already in this file.
- Produces: `callPrivilegeOpenAI(messages, config)` → `Promise<string>`, added to `module.exports` alongside `callPrivilegeGemini` and `callPrivilegeClaude`, plus `DEFAULT_MODEL_OPENAI`.

**Design note:** OpenAI's route is **OpenAI-compatible**, the same wire shape as the existing Google lane — not the Anthropic one. Model the new function on `callPrivilegeGemini`, not `callPrivilegeClaude`: no `anthropic-version` header, `system` stays a message role, and the reply is at `data.choices[0].message.content`, not `data.content[0].text`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/services/privilegeLlmProxyService.openai.test.js`:

```js
'use strict';

// The OpenAI lane must behave exactly like the other two at the contract level:
// same llm_policy_denied code on a policy denial, same named failure when a
// key is missing. It differs only in wire shape — OpenAI-compatible, like the
// Google lane, NOT the Anthropic one.

jest.mock('../../services/llmFetch', () => ({ llmFetch: jest.fn() }));

const { llmFetch } = require('../../services/llmFetch');
const svc = require('../../services/privilegeLlmProxyService');

const OK = {
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: 'hello from openai' } }] }),
};

describe('callPrivilegeOpenAI', () => {
  const env = { ...process.env };

  beforeEach(() => {
    llmFetch.mockReset();
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test';
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI = 'vk-openai';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('posts to the OpenAI-compatible route with the virtual key', async () => {
    llmFetch.mockResolvedValue(OK);

    const text = await svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }]);

    expect(text).toBe('hello from openai');
    const [url, init] = llmFetch.mock.calls[0];
    expect(url).toBe('https://gw.test/llm/openai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer vk-openai');
    // OpenAI-compatible, not Anthropic: no anthropic-version header.
    expect(init.headers['anthropic-version']).toBeUndefined();
  });

  it('keeps a trailing slash on the gateway URL from doubling the path', async () => {
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test/';
    llmFetch.mockResolvedValue(OK);

    await svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }]);

    expect(llmFetch.mock.calls[0][0]).toBe('https://gw.test/llm/openai/v1/chat/completions');
  });

  it('sends system as a message role, not a top-level field', async () => {
    llmFetch.mockResolvedValue(OK);

    await svc.callPrivilegeOpenAI([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);

    const body = JSON.parse(llmFetch.mock.calls[0][1].body);
    expect(body.system).toBeUndefined();
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be terse' });
  });

  // The security story: a denial is a structured, attributable outcome, not a
  // generic error the UI renders as a failure.
  it.each([403, 400])('turns a %s into llm_policy_denied carrying the reason', async (status) => {
    llmFetch.mockResolvedValue({
      ok: false,
      status,
      statusText: 'Forbidden',
      json: async () => ({ error: { message: 'blocked by policy: no PII' } }),
    });

    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'llm_policy_denied',
      reason: 'blocked by policy: no PII',
      provider: 'openai',
    });
  });

  it('does not call llm_policy_denied for a 500', async () => {
    llmFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({}),
    });

    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.not.toMatchObject({
      code: 'llm_policy_denied',
    });
  });

  it('names the missing config rather than failing at the provider', async () => {
    delete process.env.PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI;
    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI not configured/,
    );

    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI = 'vk';
    delete process.env.PRIVILEGE_LLM_GATEWAY_URL;
    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /PRIVILEGE_LLM_GATEWAY_URL not configured/,
    );

    expect(llmFetch).not.toHaveBeenCalled();
  });

  // An empty 200 is the failure that reads as success.
  it('rejects an empty response rather than returning an empty string', async () => {
    llmFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [] }) });

    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.toThrow(/empty/i);
  });

  it('leaves the two existing lanes exported and untouched', () => {
    expect(typeof svc.callPrivilegeGemini).toBe('function');
    expect(typeof svc.callPrivilegeClaude).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/services/privilegeLlmProxyService.openai.test.js --forceExit
```

Expected: FAIL — `svc.callPrivilegeOpenAI is not a function`.

- [ ] **Step 3: Add the lane**

In `demo_api_server/services/privilegeLlmProxyService.js`, add `DEFAULT_MODEL_OPENAI` beside the other two defaults:

```js
const DEFAULT_MODEL_OPENAI = 'gpt-4o-mini';
```

Extend the file header's route list so the comment stays true:

```js
//   /llm/openai/v1/chat/completions    OpenAI-compatible
```

Add the function after `callPrivilegeClaude`:

```js
/**
 * Call OpenAI through the Privilege virtual key and return assistant text.
 * OpenAI-compatible wire shape — the same as the Google lane, NOT Anthropic's:
 * `system` stays a message role and the reply is at choices[0].message.content.
 * Throws an Error with `code: 'llm_policy_denied'` when Privilege's policy
 * layer denies the request.
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [config]
 * @returns {Promise<string>}
 */
async function callPrivilegeOpenAI(messages, config = {}) {
  const base = gatewayUrl();
  const key = process.env.PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI || '';
  if (!base) throw new Error('PRIVILEGE_LLM_GATEWAY_URL not configured');
  if (!key) throw new Error('PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI not configured');

  const model = config.openai_model || config.model || process.env.PRIVILEGE_LLM_MODEL_OPENAI || DEFAULT_MODEL_OPENAI;

  const url = `${base.replace(/\/+$/, '')}/llm/openai/v1/chat/completions`;
  const res = await llmFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, max_tokens: 512, messages }),
  }, { label: 'privilege-llm-openai', timeoutMs: 12000, retryOn429: false });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throwForResponse(res, data, 'openai');

  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Privilege LLM proxy (openai) returned empty response');
  return text;
}
```

Extend the exports line — **add to it, do not replace it**:

```js
module.exports = {
  callPrivilegeGemini,
  callPrivilegeClaude,
  callPrivilegeOpenAI,
  DEFAULT_MODEL_GOOGLE,
  DEFAULT_MODEL_ANTHROPIC,
  DEFAULT_MODEL_OPENAI,
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/services/privilegeLlmProxyService.openai.test.js --forceExit
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the existing lanes still work — the agent modes depend on them**

```bash
cd demo_api_server && CI=true npx jest tests/services/privilegeLlmProxyService --forceExit
```

Expected: PASS, including any pre-existing Anthropic/Google specs. `privilege_llm` and `privilege_claude` agent modes must be unaffected.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/privilegeLlmProxyService.js demo_api_server/tests/services/privilegeLlmProxyService.openai.test.js
git commit -m "feat(privilege-llm): add the OpenAI lane behind the same denial contract"
```

---

### Task 3: One BFF route for all three providers

**Files:**
- Modify: `demo_api_server/routes/privilegeMcpClient.js`
- Test: `demo_api_server/tests/routes/privilegeMcpClient.llmPanel.test.js` (create)

**Interfaces:**
- Consumes: `callPrivilegeGemini`, `callPrivilegeClaude`, `callPrivilegeOpenAI` from Task 2.
- Produces: `POST /api/privilege-mcp/llm/call` with body `{ provider: 'anthropic'|'google'|'openai', prompt: string }` →
  - `200 { reply, provider, route, latencyMs }`
  - `403 { error, code: 'llm_policy_denied', reason, provider }` on a policy denial
  - `400 { error }` on a bad provider or empty prompt
  - `503 { error }` when that provider is not configured

**Design note:** a policy denial is **not** a 500. It gets its own status and its own `code`, because the panel renders it as the security story — "Privilege stopped this" — rather than as a broken feature. That distinction is the entire point of W5's "prove the policy" control.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/routes/privilegeMcpClient.llmPanel.test.js`:

```js
'use strict';

// A Privilege policy denial is the DEMO, not an error state. It gets its own
// status and code so the panel can render it as "Privilege stopped this"
// rather than as a broken feature.

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ appendHop: jest.fn() }));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
  get: jest.fn(() => ''),
  setConfig: jest.fn(async () => {}),
}));
jest.mock('../../services/privilegeLlmProxyService', () => ({
  callPrivilegeGemini: jest.fn(),
  callPrivilegeClaude: jest.fn(),
  callPrivilegeOpenAI: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const session = require('express-session');

const proxy = require('../../services/privilegeLlmProxyService');
const router = require('../../routes/privilegeMcpClient');

function app() {
  return express()
    .use(session({ secret: 't', resave: false, saveUninitialized: true }))
    .use('/api/privilege-mcp', router);
}

function post(body) {
  return request(app()).post('/api/privilege-mcp/llm/call').send(body);
}

beforeEach(() => {
  proxy.callPrivilegeClaude.mockReset();
  proxy.callPrivilegeGemini.mockReset();
  proxy.callPrivilegeOpenAI.mockReset();
});

describe('POST /llm/call', () => {
  it.each([
    ['anthropic', 'callPrivilegeClaude', '/llm/anthropic/v1/messages'],
    ['google', 'callPrivilegeGemini', '/llm/google/v1/chat/completions'],
    ['openai', 'callPrivilegeOpenAI', '/llm/openai/v1/chat/completions'],
  ])('routes %s to the right lane and reports the route used', async (provider, fn, route) => {
    proxy[fn].mockResolvedValue('the answer');

    const res = await post({ provider, prompt: 'hi' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('the answer');
    expect(res.body.provider).toBe(provider);
    // The panel shows the gateway route — that is what makes the demo legible.
    expect(res.body.route).toBe(route);
    expect(typeof res.body.latencyMs).toBe('number');
  });

  it('answers a policy denial with 403 and a structured reason, not a 500', async () => {
    const err = new Error('blocked by policy: no PII');
    err.code = 'llm_policy_denied';
    err.reason = 'blocked by policy: no PII';
    err.provider = 'anthropic';
    proxy.callPrivilegeClaude.mockRejectedValue(err);

    const res = await post({ provider: 'anthropic', prompt: 'my SSN is 123' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('llm_policy_denied');
    expect(res.body.reason).toMatch(/no PII/);
    expect(res.body.provider).toBe('anthropic');
    // BFF error shape: `error`, never `message`.
    expect(typeof res.body.error).toBe('string');
    expect(res.body.message).toBeUndefined();
  });

  it('answers 503 when the provider is not configured', async () => {
    proxy.callPrivilegeOpenAI.mockRejectedValue(
      new Error('PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI not configured'),
    );

    const res = await post({ provider: 'openai', prompt: 'hi' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/);
  });

  it('rejects an unknown provider without calling anything', async () => {
    const res = await post({ provider: 'llama', prompt: 'hi' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/provider/i);
    expect(proxy.callPrivilegeClaude).not.toHaveBeenCalled();
    expect(proxy.callPrivilegeGemini).not.toHaveBeenCalled();
    expect(proxy.callPrivilegeOpenAI).not.toHaveBeenCalled();
  });

  it.each([[''], ['   '], [undefined]])('rejects an empty prompt (%p)', async (prompt) => {
    const res = await post({ provider: 'anthropic', prompt });

    expect(res.status).toBe(400);
    expect(proxy.callPrivilegeClaude).not.toHaveBeenCalled();
  });

  it('surfaces an unexpected failure as 502 rather than crashing the route', async () => {
    proxy.callPrivilegeClaude.mockRejectedValue(new Error('socket hang up'));

    const res = await post({ provider: 'anthropic', prompt: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/socket hang up/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.llmPanel.test.js --forceExit
```

Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Add the route**

At the top of `demo_api_server/routes/privilegeMcpClient.js`, extend the existing require of the proxy service (or add it if absent):

```js
const { callPrivilegeGemini, callPrivilegeClaude, callPrivilegeOpenAI } = require('../services/privilegeLlmProxyService');
```

Add the route beside the other `POST` handlers:

```js
// One lane per provider, one route. The panel needs the gateway path back so
// the demo can show WHERE the call went — that is the visible difference
// between "we called Anthropic" and "we called Anthropic through Privilege".
const LLM_LANES = {
  anthropic: { call: callPrivilegeClaude, route: '/llm/anthropic/v1/messages' },
  google: { call: callPrivilegeGemini, route: '/llm/google/v1/chat/completions' },
  openai: { call: callPrivilegeOpenAI, route: '/llm/openai/v1/chat/completions' },
};

router.post('/llm/call', express.json(), async (req, res) => {
  const provider = String(req.body?.provider || '');
  const lane = LLM_LANES[provider];
  if (!lane) {
    return res.status(400).json({ error: `Unknown provider "${provider}". Use one of: ${Object.keys(LLM_LANES).join(', ')}` });
  }
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

  const t0 = Date.now();
  try {
    const reply = await lane.call([{ role: 'user', content: prompt }]);
    return res.json({ reply, provider, route: lane.route, latencyMs: Date.now() - t0 });
  } catch (err) {
    // A denial is the demo, not a failure: its own status, its own code, and
    // the reason and provider carried through for the panel to render.
    if (err.code === 'llm_policy_denied') {
      return res.status(403).json({
        error: err.message,
        code: 'llm_policy_denied',
        reason: err.reason || err.message,
        provider: err.provider || provider,
        route: lane.route,
        latencyMs: Date.now() - t0,
      });
    }
    // Missing config is an operator problem with a named fix, not a bad gateway.
    if (/not configured/.test(err.message || '')) {
      return res.status(503).json({ error: err.message });
    }
    return res.status(502).json({ error: err.message || 'Privilege LLM call failed' });
  }
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.llmPanel.test.js --forceExit
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Run the route suite**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient --forceExit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/privilegeMcpClient.js demo_api_server/tests/routes/privilegeMcpClient.llmPanel.test.js
git commit -m "feat(privilege-llm): one route for all three provider lanes"
```

---

### Task 4: The LLM protection panel

**Files:**
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.css`
- Test: `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.llmPanel.test.jsx` (create)

**Interfaces:**
- Consumes: `POST /llm/call` from Task 3, through the page's `api()` helper.
- Produces: nothing.

**Design note — the one that matters.** A denial must not render as an error. It is the security story: the panel shows the provider, the gateway route and the policy's reason, styled as a *warning with an explanation*, not a red failure. `api()` throws on a 403, so the handler has to inspect the thrown error rather than treat every rejection alike — see step 3.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.llmPanel.test.jsx`:

```jsx
// Privilege LLM protection: the app never holds a provider API key — the
// gateway injects it — and a policy can deny the call before it reaches the
// provider. The denial is the demo, so it renders as an explained block with
// the provider, the route and the reason, never as a generic failure.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

function stateBody() {
  return JSON.stringify({
    config: { mcpUrl: "https://gw.test/opensearch22/mcp", clientId: "", scopes: "" },
    gatewayMode: "privilege",
    gatewayConfigs: {},
    oauth: { authenticated: true },
    mainAppAuthenticated: true,
    tools: [],
    presets: [],
    gatewaySession: { ready: true },
  });
}

function mockFetch(llmCall) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => stateBody() });
    }
    if (u.endsWith("/api/privilege-mcp/llm/call")) return Promise.resolve(llmCall());
    return new Promise(() => {});
  });
}

beforeEach(() => {
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

async function ask(text = "hello") {
  fireEvent.change(await screen.findByLabelText(/prompt/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
}

describe("Privilege LLM panel", () => {
  it("shows the reply, the gateway route and the latency", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          reply: "hello from claude",
          provider: "anthropic",
          route: "/llm/anthropic/v1/messages",
          latencyMs: 412,
        }),
    }));
    renderPage();
    await ask();

    expect(await screen.findByText(/hello from claude/)).toBeInTheDocument();
    expect(await screen.findByText(/\/llm\/anthropic\/v1\/messages/)).toBeInTheDocument();
    expect(await screen.findByText(/412\s*ms/i)).toBeInTheDocument();
  });

  // The load-bearing case: a denial is the security story, not an error.
  it("renders a policy denial with its reason and provider, not as a failure", async () => {
    mockFetch(() => ({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          error: "blocked by policy: no PII",
          code: "llm_policy_denied",
          reason: "blocked by policy: no PII",
          provider: "anthropic",
          route: "/llm/anthropic/v1/messages",
        }),
    }));
    renderPage();
    await ask("my SSN is 123");

    const denial = await screen.findByTestId("llm-denial");
    expect(denial).toHaveTextContent(/no PII/);
    expect(denial).toHaveTextContent(/anthropic/i);
    // Not rendered through the generic error channel.
    expect(screen.queryByTestId("llm-error")).not.toBeInTheDocument();
  });

  it("shows a real failure through the error channel instead", async () => {
    mockFetch(() => ({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: "socket hang up" }),
    }));
    renderPage();
    await ask();

    expect(await screen.findByTestId("llm-error")).toHaveTextContent(/socket hang up/);
    expect(screen.queryByTestId("llm-denial")).not.toBeInTheDocument();
  });

  it("says which config is missing when the provider is not set up", async () => {
    mockFetch(() => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: "PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI not configured" }),
    }));
    renderPage();
    await ask();

    expect(await screen.findByTestId("llm-error")).toHaveTextContent(/VIRTUAL_KEY_OPENAI/);
  });

  it("does not send an empty prompt", async () => {
    mockFetch(() => ({ ok: true, status: 200, text: async () => "{}" }));
    renderPage();

    await screen.findByLabelText(/prompt/i);
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    const calls = global.fetch.mock.calls.filter(([u]) => String(u).endsWith("/llm/call"));
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.llmPanel.test.jsx
```

Expected: FAIL — no prompt field.

Use `npm run test:unit`, **not** `npx vitest`.

- [ ] **Step 3: Implement the panel**

`api()` throws on any non-2xx, and the thrown Error carries only `message` by
default. Extend the page's `api()` helper (line ~78) so the structured denial
fields survive — it already does exactly this for `loginUrl`:

```js
      if (data.loginUrl) err.loginUrl = data.loginUrl;
      // A Privilege LLM denial is a structured outcome the panel renders as the
      // security story. Carry its fields through rather than flattening to text.
      if (data.code) err.code = data.code;
      if (data.reason) err.reason = data.reason;
      if (data.provider) err.provider = data.provider;
      if (data.route) err.route = data.route;
```

Add state:

```jsx
  const [llmProvider, setLlmProvider] = useState('anthropic');
  const [llmPrompt, setLlmPrompt] = useState('');
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmResult, setLlmResult] = useState(null);
  const [llmDenial, setLlmDenial] = useState(null);
  const [llmError, setLlmError] = useState('');
```

Add the handler:

```jsx
  // A denial (403 + llm_policy_denied) is the point of the panel, so it gets
  // its own state and its own rendering — never the error channel.
  const sendLlm = useCallback(async (promptOverride) => {
    const prompt = (typeof promptOverride === 'string' ? promptOverride : llmPrompt).trim();
    if (!prompt) return;
    setLlmBusy(true);
    setLlmResult(null);
    setLlmDenial(null);
    setLlmError('');
    try {
      const data = await api('/llm/call', { method: 'POST', body: { provider: llmProvider, prompt } });
      setLlmResult(data);
    } catch (err) {
      if (err.code === 'llm_policy_denied') {
        setLlmDenial({
          reason: err.reason || err.message,
          provider: err.provider || llmProvider,
          route: err.route || '',
        });
      } else {
        setLlmError(err.message || 'LLM call failed');
      }
    } finally {
      setLlmBusy(false);
    }
  }, [llmProvider, llmPrompt]);

  // "Prove the policy": a prompt the Privilege policy is configured to deny.
  // Deliberately obvious PII so the denial is explainable on stage.
  const proveLlmPolicy = useCallback(
    () => sendLlm('Here is a customer SSN 123-45-6789 — summarise this record.'),
    [sendLlm],
  );
```

Render it:

```jsx
      <div className="cur-llmpanel">
        <div className="cur-llmpanel__row">
          <label htmlFor="llm-provider">Provider</label>
          <select
            id="llm-provider"
            value={llmProvider}
            onChange={(e) => setLlmProvider(e.target.value)}
          >
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div className="cur-llmpanel__row">
          <label htmlFor="llm-prompt">Prompt</label>
          <input
            id="llm-prompt"
            type="text"
            value={llmPrompt}
            onChange={(e) => setLlmPrompt(e.target.value)}
          />
          <button type="button" onClick={() => sendLlm()} disabled={llmBusy}>
            {llmBusy ? 'Sending…' : 'Send'}
          </button>
          <button type="button" onClick={proveLlmPolicy} disabled={llmBusy}>
            Prove the policy
          </button>
        </div>
        {llmResult && (
          <div className="cur-llmpanel__reply">
            <p>{llmResult.reply}</p>
            <p className="cur-llmpanel__meta">
              <code>{llmResult.route}</code> · {llmResult.latencyMs} ms
            </p>
          </div>
        )}
        {llmDenial && (
          <div className="cur-llmpanel__denial" data-testid="llm-denial" role="status">
            <strong>⚠️ Privilege denied this call.</strong>
            <span>{llmDenial.reason}</span>
            <span className="cur-llmpanel__meta">
              provider {llmDenial.provider}
              {llmDenial.route ? ` · ${llmDenial.route}` : ''}
            </span>
          </div>
        )}
        {llmError && (
          <p className="cur-llmpanel__error" data-testid="llm-error" role="alert">{llmError}</p>
        )}
      </div>
```

- [ ] **Step 4: Style it**

Append to `demo_api_ui/src/pages/PrivilegeMcpClientPage.css`:

```css
/* Privilege LLM panel — real tokens, verified against src/index.css. */
.cur-llmpanel {
  margin: 0 0 0.75rem;
  font-size: var(--font-size-xs);
}

.cur-llmpanel__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.cur-llmpanel__row input[type="text"] {
  flex: 1 1 16rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--th-border);
  border-radius: 4px;
  background: var(--th-bg-card);
  color: var(--th-text);
}

.cur-llmpanel__row button {
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--th-border);
  border-radius: 4px;
  background: var(--th-bg-card);
  color: var(--th-text);
  cursor: pointer;
}

.cur-llmpanel__row button:hover:not(:disabled) {
  background: var(--th-bg-hover);
}

.cur-llmpanel__row button:disabled {
  cursor: progress;
  opacity: 0.7;
}

.cur-llmpanel__reply {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--th-border);
  border-radius: 4px;
  background: var(--th-bg-card);
  color: var(--th-text);
}

/* A denial is the demo, not a failure: warning tones, with the reason shown. */
.cur-llmpanel__denial {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--th-status-warning-border);
  border-radius: 4px;
  background: var(--th-status-warning-bg);
  color: var(--th-status-warning-text);
}

.cur-llmpanel__meta {
  color: var(--th-text-muted);
  font-size: var(--font-size-2xs);
}

.cur-llmpanel__error {
  margin: 0.4rem 0 0;
  color: var(--th-status-error);
  font-size: var(--font-size-2xs);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.llmPanel.test.jsx
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Run the whole page suite and the build gate**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage && npm run build
```

Expected: PASS across every spec file, build exit 0.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx demo_api_ui/src/pages/PrivilegeMcpClientPage.css demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.llmPanel.test.jsx
git commit -m "feat(privilege-llm): protection panel with a live policy-denial proof"
```

---

### Task 5: Document the feature

**Files:**
- Create: `docs/privilege-llm-protection.md`
- Modify: `README.md` (one link)

**Interfaces:** none.

**Why this is a task and not a step:** spec §W6.4 — "currently the only prose is a source header." An operator cannot issue a virtual key from a comment inside a service file.

- [ ] **Step 1: Write the doc**

Create `docs/privilege-llm-protection.md` covering, in this order:

1. **What it is.** The app never holds a provider API key. The Privilege gateway injects the real key server-side and can deny a call by policy *before* it reaches the provider. That is the difference from calling Anthropic directly.
2. **The three routes**, copied from the service header so they stay checkable:
   - `/llm/anthropic/v1/messages` — native Anthropic Messages API (`anthropic-version` header, `system` is top-level)
   - `/llm/google/v1/chat/completions` — OpenAI-compatible
   - `/llm/openai/v1/chat/completions` — OpenAI-compatible
3. **Setup**, as numbered steps: issue a virtual key per provider in the Privilege console; set `PRIVILEGE_LLM_GATEWAY_URL` and the three `PRIVILEGE_LLM_VIRTUAL_KEY_*` values; for k8s, `create-secrets.sh` mirrors them from the BFF `.env`; verify with `docker exec ai-demo-api-server printenv | grep -c PRIVILEGE_LLM_` → `4`. **Never paste a key value into a doc, a ticket, or a log.**
4. **How to demo it.** Open `/privilege-mcp-client`, pick a provider, send a prompt, point at the route and latency. Then click **Prove the policy** and read the denial aloud: provider, route, reason.
5. **What a failure means.** `403` + `llm_policy_denied` = Privilege denied it, working as designed. `503` = a key or the gateway URL is missing — the message names which. `502` = the gateway or provider is unreachable.

- [ ] **Step 2: Link it from `README.md`**

Add one line to whichever list of docs the README already keeps. Do not restructure the README.

- [ ] **Step 3: Commit**

```bash
git add docs/privilege-llm-protection.md README.md
git commit -m "docs(privilege-llm): how to set up and demo LLM protection"
```

---

### Task 6: Prove it live — USER-SIDE GATE

**This task cannot be executed by an agent.** It needs an **OpenAI virtual key
issued in the Privilege console** (spec §W5, "User-side"), and a Privilege
policy authored to deny something.

- [ ] **Step 1: Issue the OpenAI virtual key**

Privilege console → Virtual Keys → Add, for OpenAI. Put it in
`demo_api_server/.env` as `PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI`. Restart the BFF.

- [ ] **Step 2: Confirm the process has all four keys**

```bash
docker exec ai-demo-api-server printenv | grep -c PRIVILEGE_LLM_
```

Expected: `4`. Paste the count, never the values.

- [ ] **Step 3: One real call per provider**

Anthropic, Google, OpenAI. Paste the reply, the route and the latency for each.
A reply is required — an empty 200 is not a pass.

- [ ] **Step 4: One real denial**

Click **Prove the policy**. Paste the rendered denial: provider, route, reason.
If it returns a normal reply instead, the policy does not deny that prompt — fix
the policy or the prompt; do **not** call the feature proven.

- [ ] **Step 5: The fresh-clone claim (spec §7 criterion 5)**

The criterion is that a fresh clone plus documented setup reproduces the panel
**without hand-patching a secret**. Follow `docs/privilege-llm-protection.md`
from step 1 as written, changing nothing else, and confirm the panel works.
Anything you had to do that the doc does not say is a doc bug — fix the doc.

---

## Final verification

- [ ] **Config gate**

```bash
node --test scripts/check-privilege-llm-config.test.js
```

- [ ] **Server tests**

```bash
cd demo_api_server && CI=true npx jest tests/services/privilegeLlmProxyService tests/routes/privilegeMcpClient --forceExit
```

- [ ] **UI tests and the build gate**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage && npm run build
```

- [ ] **The existing agent modes still work**

`privilege_llm` and `privilege_claude` were explicitly out of scope. Confirm both
still answer through the agent, since Task 2 edited the file they depend on.

- [ ] **Spec §7 criterion 5, pasted not asserted**

A fresh clone plus `docs/privilege-llm-protection.md` reproduces the panel with
no hand-patched secret (Task 6 step 5).

Before and after any live UI drive, pin the stack generation:

```bash
gen="$(npm run -s stack:generation)"
# ... drive the UI ...
npm run -s stack:generation -- --check "$gen"
```

A non-zero `--check` means the run is void, not that you found a defect.
