# Mock Authz Server Round-Trip Rules Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin pull the mock authz server's policy rules in the `/pingone-authorize` page, edit them (thresholds, enforce-may-act, authorized actor, tool-discovery decision, per-tool scope mappings + write classification), and push them back — with edits driving live `decision.js` enforcement.

**Architecture:** A new `demo_authz_server/ruleStore.js` owns the editable policy state: it seeds defaults from `scope-topology.json` + env, layers a sparse persisted `rules-overlay.json` on top, and exposes request-time getters. `decision.js` and `routes/rules.js` read those getters instead of module-load constants. New `PUT /rules` + `POST /rules/reset` endpoints (env-gated `X-Authz-Admin-Token`) mutate the store; the BFF proxies them admin-gated; the page renders an inline admin editor.

**Tech Stack:** Node 20 (`node:test` for the authz server — no new dependency), Express, Jest + supertest (BFF), React (CRA, inline-style components).

**Spec:** `docs/superpowers/specs/2026-06-09-authz-rules-editor-design.md`

---

## File Structure

**demo_authz_server/**
- Create `ruleStore.js` — owns editable policy: defaults (SoT+env) ⊕ overlay; getters; `applyPatch`; `reset`; `getEditableBlock`.
- Create `ruleStore.test.js` — `node:test` unit tests for the store.
- Create `decision.ruleStore.test.js` — `node:test` for overlay-driven decision behavior.
- Modify `routes/decision.js` — read editable knobs from `ruleStore`; de-destructure `lookupUser` for testability.
- Modify `routes/rules.js` — source editable values from `ruleStore`, append `editable` block.
- Modify `index.js` — register `PUT /rules`, `POST /rules/reset` with env-gated guard.
- Create `routes/rulesWrite.js` — the PUT + reset handlers + guard.
- Create `routes/rulesWrite.test.js` — `node:test` for handlers + guard.
- Modify `package.json` — add `"test": "node --test"`.
- Modify `.gitignore` (repo root) — ignore `demo_authz_server/rules-overlay.json`.

**demo_api_server/**
- Modify `routes/authorize.js` — add `PUT /mock-authz-rules` + `POST /mock-authz-rules/reset` (admin, proxy, forward `X-Authz-Admin-Token`).
- Create `src/__tests__/mockAuthzRulesWrite.route.test.js` — Jest + supertest.

**demo_api_ui/**
- Modify `src/components/PingOneAuthorizePage.jsx` — add admin-only "Mock Authz Server Rules" editor card.
- Modify `src/App.js` — pass `user={user}` to the `/pingone-authorize` route.

---

## Task 1: `ruleStore` core + unit tests

**Files:**
- Create: `demo_authz_server/ruleStore.js`
- Test: `demo_authz_server/ruleStore.test.js`
- Modify: `demo_authz_server/package.json`

- [ ] **Step 1: Add the test script**

In `demo_authz_server/package.json`, change the `scripts` block to:

```json
  "scripts": {
    "start": "node index.js",
    "test": "node --test"
  },
```

- [ ] **Step 2: Write the failing test**

Create `demo_authz_server/ruleStore.test.js`:

```js
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the overlay file per test run via env, then require a FRESH module.
let OVERLAY;
let ruleStore;

function freshStore() {
  delete require.cache[require.resolve('./ruleStore')];
  ruleStore = require('./ruleStore');
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `rules-overlay-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.CONFIRM_THRESHOLD_USD = '250';
  process.env.ENFORCE_MAY_ACT = 'true';
  delete process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID;
  delete process.env.AGENT_OAUTH_CLIENT_ID;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  freshStore();
});

afterEach(() => {
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

test('defaults come from env when no overlay exists', () => {
  assert.strictEqual(ruleStore.getHitlThreshold(), 250);
  assert.strictEqual(ruleStore.getEnforceMayAct(), true);
  assert.strictEqual(ruleStore.getAuthorizedActorClientId(), '');
  assert.strictEqual(ruleStore.getToolDiscoveryDecision(), 'PERMIT');
});

test('applyPatch overrides a global knob and persists to the overlay file', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 50, toolDiscoveryDecision: 'DENY' } });
  assert.strictEqual(ruleStore.getHitlThreshold(), 50);
  assert.strictEqual(ruleStore.getToolDiscoveryDecision(), 'DENY');
  const onDisk = JSON.parse(fs.readFileSync(OVERLAY, 'utf8'));
  assert.strictEqual(onDisk.global.hitlThresholdUsd, 50);
  assert.strictEqual(onDisk.version, 1);
  assert.ok(onDisk.updatedAt);
});

test('overlay is reloaded from disk on fresh require', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 77 } });
  freshStore();
  assert.strictEqual(ruleStore.getHitlThreshold(), 77);
});

test('per-tool requiredScopes override falls back to SoT for untouched tools', () => {
  ruleStore.applyPatch({ tools: { create_transfer: { requiredScopes: ['read'] } } });
  assert.deepStrictEqual(ruleStore.requiredScopesForTool('create_transfer'), ['read']);
  // an unrelated known tool still uses scope-topology.json
  assert.notStrictEqual(ruleStore.requiredScopesForTool('get_my_accounts'), null);
});

test('isWrite override is honored; default falls back to SoT', () => {
  ruleStore.applyPatch({ tools: { get_my_accounts: { isWrite: true } } });
  assert.strictEqual(ruleStore.isWriteTool('get_my_accounts'), true);
});

test('reset clears the overlay and deletes the file', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 12 } });
  ruleStore.reset();
  assert.strictEqual(ruleStore.getHitlThreshold(), 250);
  assert.strictEqual(fs.existsSync(OVERLAY), false);
});

test('applyPatch rejects invalid values and leaves overlay unchanged', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 30 } });
  assert.throws(() => ruleStore.applyPatch({ global: { hitlThresholdUsd: -5 } }), /hitlThresholdUsd/);
  assert.throws(() => ruleStore.applyPatch({ global: { toolDiscoveryDecision: 'MAYBE' } }), /toolDiscoveryDecision/);
  assert.throws(() => ruleStore.applyPatch({ global: { nope: 1 } }), /unknown global key/);
  assert.throws(() => ruleStore.applyPatch({ tools: { not_a_real_tool: { isWrite: true } } }), /unknown tool/);
  assert.throws(() => ruleStore.applyPatch({ tools: { create_transfer: { requiredScopes: ['bogus'] } } }), /requiredScopes/);
  // unchanged
  assert.strictEqual(ruleStore.getHitlThreshold(), 30);
});

test('getEditableBlock reports value/default/overridden', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 99 } });
  const block = ruleStore.getEditableBlock();
  assert.strictEqual(block.global.hitlThresholdUsd.value, 99);
  assert.strictEqual(block.global.hitlThresholdUsd.default, 250);
  assert.strictEqual(block.global.hitlThresholdUsd.overridden, true);
  assert.strictEqual(block.global.enforceMayAct.overridden, false);
  assert.deepStrictEqual(block.allowedScopes, ['read', 'write', 'admin']);
  assert.ok(block.tools.create_transfer, 'gateway tools are listed');
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd demo_authz_server && npm test`
Expected: FAIL — `Cannot find module './ruleStore'`.

- [ ] **Step 4: Implement `ruleStore.js`**

Create `demo_authz_server/ruleStore.js`:

```js
'use strict';

/**
 * ruleStore — the single mutable owner of the EDITABLE mock-authz policy knobs.
 *
 * Effective value = factory default (scope-topology.json + env) ⊕ a sparse
 * overlay persisted to rules-overlay.json. decision.js and routes/rules.js read
 * these getters at REQUEST time so an admin edit changes live enforcement.
 *
 * Token-validity guards (aud/exp/iat/nbf/iss, user lookup, intent) are NOT owned
 * here — they stay env/SoT driven in decision.js and cannot be edited.
 */

const fs = require('fs');
const path = require('path');
const scopeTopology = require('./scopeTopology');

const OVERLAY_PATH =
  process.env.AUTHZ_RULES_OVERLAY_PATH || path.join(__dirname, 'rules-overlay.json');

const ALLOWED_SCOPES = ['read', 'write', 'admin'];

let toolsManifest = {};
try {
  toolsManifest = require(path.join(__dirname, '..', 'scope-topology.json')).tools || {};
} catch { /* ignore */ }

/** Factory defaults read at call time so operator env vars are still honored. */
function envDefaults() {
  return {
    hitlThresholdUsd: parseFloat(
      process.env.CONFIRM_THRESHOLD_USD || process.env.confirm_threshold_usd || '250'
    ),
    enforceMayAct:
      String(process.env.ENFORCE_MAY_ACT || process.env.AUTHZ_ENFORCE_MAY_ACT || 'true')
        .toLowerCase() !== 'false',
    authorizedActorClientId:
      process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID || process.env.AGENT_OAUTH_CLIENT_ID || '',
    toolDiscoveryDecision: 'PERMIT',
  };
}

function emptyOverlay() {
  return { global: {}, tools: {} };
}

function loadOverlay() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OVERLAY_PATH, 'utf8'));
    return {
      global: parsed && typeof parsed.global === 'object' && parsed.global ? parsed.global : {},
      tools: parsed && typeof parsed.tools === 'object' && parsed.tools ? parsed.tools : {},
    };
  } catch {
    return emptyOverlay();
  }
}

let overlay = loadOverlay();

function persist() {
  const out = { version: 1, updatedAt: new Date().toISOString(), ...overlay };
  fs.writeFileSync(OVERLAY_PATH, JSON.stringify(out, null, 2));
}

// ── Request-time getters ──────────────────────────────────────────────────────

function getHitlThreshold() {
  return overlay.global.hitlThresholdUsd ?? envDefaults().hitlThresholdUsd;
}
function getEnforceMayAct() {
  return overlay.global.enforceMayAct ?? envDefaults().enforceMayAct;
}
function getAuthorizedActorClientId() {
  return overlay.global.authorizedActorClientId ?? envDefaults().authorizedActorClientId;
}
function getToolDiscoveryDecision() {
  return overlay.global.toolDiscoveryDecision ?? 'PERMIT';
}
function requiredScopesForTool(toolName) {
  const o = overlay.tools[toolName];
  if (o && Array.isArray(o.requiredScopes)) return o.requiredScopes;
  return scopeTopology.requiredScopesForTool(toolName);
}
function isWriteTool(toolName) {
  const o = overlay.tools[toolName];
  if (o && typeof o.isWrite === 'boolean') return o.isWrite;
  return scopeTopology.isWriteTool(toolName);
}

// ── Editable description for the UI ────────────────────────────────────────────

function field(value, def, overridden) {
  return { value, default: def, overridden };
}

function getEditableBlock() {
  const d = envDefaults();
  const g = overlay.global;
  const tools = {};
  for (const [name, def] of Object.entries(toolsManifest)) {
    if (def.surface !== 'gateway') continue;
    const o = overlay.tools[name] || {};
    tools[name] = {
      requiredScopes: field(
        requiredScopesForTool(name) || [],
        scopeTopology.requiredScopesForTool(name) || [],
        Array.isArray(o.requiredScopes)
      ),
      isWrite: field(isWriteTool(name), scopeTopology.isWriteTool(name), typeof o.isWrite === 'boolean'),
    };
  }
  return {
    global: {
      hitlThresholdUsd: field(getHitlThreshold(), d.hitlThresholdUsd, g.hitlThresholdUsd !== undefined),
      enforceMayAct: field(getEnforceMayAct(), d.enforceMayAct, g.enforceMayAct !== undefined),
      authorizedActorClientId: field(getAuthorizedActorClientId(), d.authorizedActorClientId, g.authorizedActorClientId !== undefined),
      toolDiscoveryDecision: field(getToolDiscoveryDecision(), d.toolDiscoveryDecision, g.toolDiscoveryDecision !== undefined),
    },
    tools,
    allowedScopes: ALLOWED_SCOPES,
  };
}

// ── Mutators ────────────────────────────────────────────────────────────────

function applyPatch(patch) {
  if (!patch || typeof patch !== 'object') {
    const e = new Error('patch must be an object'); e.code = 'INVALID_PATCH'; throw e;
  }
  const errors = [];
  const next = { global: { ...overlay.global }, tools: { ...overlay.tools } };

  const unknownTop = Object.keys(patch).filter((k) => !['global', 'tools', 'version', 'updatedAt'].includes(k));
  if (unknownTop.length) errors.push(`unknown keys: ${unknownTop.join(',')}`);

  if (patch.global !== undefined) {
    if (typeof patch.global !== 'object' || patch.global === null) {
      errors.push('global must be an object');
    } else {
      for (const [key, val] of Object.entries(patch.global)) {
        if (key === 'hitlThresholdUsd') {
          if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) errors.push('hitlThresholdUsd must be a finite number >= 0');
          else next.global.hitlThresholdUsd = val;
        } else if (key === 'enforceMayAct') {
          if (typeof val !== 'boolean') errors.push('enforceMayAct must be boolean');
          else next.global.enforceMayAct = val;
        } else if (key === 'authorizedActorClientId') {
          if (typeof val !== 'string') errors.push('authorizedActorClientId must be a string');
          else next.global.authorizedActorClientId = val.trim();
        } else if (key === 'toolDiscoveryDecision') {
          if (val !== 'PERMIT' && val !== 'DENY') errors.push('toolDiscoveryDecision must be PERMIT or DENY');
          else next.global.toolDiscoveryDecision = val;
        } else {
          errors.push(`unknown global key: ${key}`);
        }
      }
    }
  }

  if (patch.tools !== undefined) {
    if (typeof patch.tools !== 'object' || patch.tools === null) {
      errors.push('tools must be an object');
    } else {
      for (const [toolName, entry] of Object.entries(patch.tools)) {
        if (scopeTopology.requiredScopesForTool(toolName) === null) { errors.push(`unknown tool: ${toolName}`); continue; }
        if (!entry || typeof entry !== 'object') { errors.push(`tool ${toolName}: entry must be an object`); continue; }
        const nextEntry = { ...(next.tools[toolName] || {}) };
        const unknownKeys = Object.keys(entry).filter((k) => !['requiredScopes', 'isWrite'].includes(k));
        if (unknownKeys.length) errors.push(`tool ${toolName}: unknown keys ${unknownKeys.join(',')}`);
        if (entry.requiredScopes !== undefined) {
          if (!Array.isArray(entry.requiredScopes) || entry.requiredScopes.some((s) => !ALLOWED_SCOPES.includes(s))) {
            errors.push(`tool ${toolName}: requiredScopes must be a subset of ${ALLOWED_SCOPES.join(',')}`);
          } else {
            nextEntry.requiredScopes = [...new Set(entry.requiredScopes)];
          }
        }
        if (entry.isWrite !== undefined) {
          if (typeof entry.isWrite !== 'boolean') errors.push(`tool ${toolName}: isWrite must be boolean`);
          else nextEntry.isWrite = entry.isWrite;
        }
        next.tools[toolName] = nextEntry;
      }
    }
  }

  if (errors.length) { const e = new Error(errors.join('; ')); e.code = 'INVALID_PATCH'; throw e; }
  overlay = next;
  persist();
  return getEditableBlock();
}

function reset() {
  try { fs.unlinkSync(OVERLAY_PATH); } catch { /* ignore */ }
  overlay = emptyOverlay();
  return getEditableBlock();
}

module.exports = {
  getHitlThreshold,
  getEnforceMayAct,
  getAuthorizedActorClientId,
  getToolDiscoveryDecision,
  requiredScopesForTool,
  isWriteTool,
  getEditableBlock,
  applyPatch,
  reset,
};
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `cd demo_authz_server && npm test`
Expected: PASS (all `ruleStore.test.js` tests green).

- [ ] **Step 6: Commit**

```bash
git add demo_authz_server/ruleStore.js demo_authz_server/ruleStore.test.js demo_authz_server/package.json
git commit -m "feat(authz): ruleStore owns editable policy with SoT+env defaults and sparse overlay"
```

---

## Task 2: Wire `decision.js` to `ruleStore` (live enforcement)

**Files:**
- Modify: `demo_authz_server/routes/decision.js`
- Test: `demo_authz_server/decision.ruleStore.test.js`

- [ ] **Step 1: Write the failing test**

Create `demo_authz_server/decision.ruleStore.test.js`:

```js
'use strict';

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let OVERLAY;
let decisionHandler;
let ruleStore;
let userLookup;

function fresh() {
  for (const m of ['./ruleStore', './pingOneUserLookup', './routes/decision']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  ruleStore = require('./ruleStore');
  userLookup = require('./pingOneUserLookup');
  mock.method(userLookup, 'lookupUser', async () => ({ found: true, enabled: true, status: 'ACTIVE' }));
  decisionHandler = require('./routes/decision');
}

function makeRes() {
  return { body: null, json(b) { this.body = b; return this; } };
}

// Base params that pass every token-validity guard so tests isolate the editable rules.
function baseParams(extra = {}) {
  return {
    DecisionContext: 'McpToolCall',
    ToolName: 'create_transfer',
    ClientId: 'user-1',
    TokenScopes: 'read write',
    TokenAudience: 'test-aud',
    TransactionAmount: '10',
    ...extra,
  };
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `dec-overlay-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  process.env.CONFIRM_THRESHOLD_USD = '250';
  process.env.ENFORCE_MAY_ACT = 'true';
  delete process.env.PINGONE_ENVIRONMENT_ID;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  mock.restoreAll();
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

test('write tool below default threshold permits', async () => {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams({ TransactionAmount: '10' }) } }, res);
  assert.strictEqual(res.body.decision, 'PERMIT');
});

test('lowering hitlThresholdUsd flips the same call to INDETERMINATE', async () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 5 } });
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams({ TransactionAmount: '10' }) } }, res);
  assert.strictEqual(res.body.decision, 'INDETERMINATE');
  assert.strictEqual(res.body.reason, 'HITL_REQUIRED');
});

test('overriding requiredScopes flips PERMIT to DENY on missing scope', async () => {
  ruleStore.applyPatch({ tools: { create_transfer: { requiredScopes: ['read', 'write', 'admin'] } } });
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams() } }, res);
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /insufficient_scope/);
});

test('toolDiscoveryDecision=DENY denies McpToolsList', async () => {
  ruleStore.applyPatch({ global: { toolDiscoveryDecision: 'DENY' } });
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams({ DecisionContext: 'McpToolsList' }) } }, res);
  assert.strictEqual(res.body.decision, 'DENY');
});

test('enforceMayAct=false + actor != authorized actor denies', async () => {
  ruleStore.applyPatch({ global: { enforceMayAct: false, authorizedActorClientId: 'agent-good' } });
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams({ ActClientId: 'agent-bad' }) } }, res);
  assert.strictEqual(res.body.decision, 'DENY');
});

test('with no overlay, a normal call still permits (regression)', async () => {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams() } }, res);
  assert.strictEqual(res.body.decision, 'PERMIT');
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd demo_authz_server && node --test decision.ruleStore.test.js`
Expected: FAIL — `ruleStore` not used by decision.js yet (e.g. threshold edit does not change decision), and/or `mock.method` cannot replace destructured `lookupUser`.

- [ ] **Step 3: De-destructure `lookupUser` for testability**

In `demo_authz_server/routes/decision.js`, replace:

```js
const { lookupUser } = require('../pingOneUserLookup');
```

with:

```js
const pingOneUserLookup = require('../pingOneUserLookup');
```

and change the one call site (currently `const userInfo = await lookupUser(ClientId);`) to:

```js
  const userInfo = await pingOneUserLookup.lookupUser(ClientId);
```

- [ ] **Step 4: Read editable knobs from `ruleStore`**

In `demo_authz_server/routes/decision.js`, add near the other requires:

```js
const ruleStore = require('../ruleStore');
```

Then make these four edits (leave Rules 0a–0f, 4b, `isStepUpTool`, `gatewayAudience` untouched):

1. **Rule 1 — tool discovery.** Replace:

```js
  if (DecisionContext === 'McpToolsList') {
    return permit(res, 'tool discovery permitted');
  }
```

with:

```js
  if (DecisionContext === 'McpToolsList') {
    if (ruleStore.getToolDiscoveryDecision() === 'DENY') {
      return deny(res, 'tool discovery denied by policy');
    }
    return permit(res, 'tool discovery permitted');
  }
```

2. **Rule 1b + Rule 3 — scope checks.** In both the `ChipAuthorization` block and Rule 3, replace `scopeTopology.requiredScopesForTool(ToolName)` with `ruleStore.requiredScopesForTool(ToolName)`.

3. **Rule 2 — actor identity.** Replace the `if (ENFORCE_MAY_ACT) {` guard with `if (ruleStore.getEnforceMayAct()) {`, and in the `else if` branch replace both references to `AUTHORIZED_ACTOR_CLIENT_ID` with `ruleStore.getAuthorizedActorClientId()`. (Capture it once: `const authorizedActor = ruleStore.getAuthorizedActorClientId();` just before the `else if`.)

4. **Rule 4 — HITL gate.** Replace:

```js
  const isWriteTool = scopeTopology.isWriteTool(ToolName);
  if (isWriteTool && !hitlApproved) {
    const amount = parseFloat(TransactionAmount) || 0;
    if (amount >= HITL_CONFIRM_THRESHOLD_USD || (TransactionAmount === '' && scopeTopology.isStepUpTool(ToolName))) {
```

with:

```js
  const isWriteTool = ruleStore.isWriteTool(ToolName);
  if (isWriteTool && !hitlApproved) {
    const amount = parseFloat(TransactionAmount) || 0;
    if (amount >= ruleStore.getHitlThreshold() || (TransactionAmount === '' && scopeTopology.isStepUpTool(ToolName))) {
```

The module-load constants `AUTHORIZED_ACTOR_CLIENT_ID`, `ENFORCE_MAY_ACT`, and `HITL_CONFIRM_THRESHOLD_USD` are now unused by enforcement — leave the `ENFORCE_MAY_ACT` value used only in the log line, or update the log line to `ruleStore.getEnforceMayAct()`. Remove the now-unused `const`s to avoid dead code (keep the explanatory comments above Rule 2). Leave `scopeTopology` required (still used for `isStepUpTool`).

- [ ] **Step 5: Run tests to confirm they pass**

Run: `cd demo_authz_server && node --test decision.ruleStore.test.js`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Run the full authz suite**

Run: `cd demo_authz_server && npm test`
Expected: PASS (ruleStore + decision tests).

- [ ] **Step 7: Commit**

```bash
git add demo_authz_server/routes/decision.js demo_authz_server/decision.ruleStore.test.js
git commit -m "feat(authz): decision.js reads editable knobs from ruleStore at request time"
```

---

## Task 3: Surface `ruleStore` values + `editable` block from `GET /rules`

**Files:**
- Modify: `demo_authz_server/routes/rules.js`
- Test: extend `demo_authz_server/ruleStore.test.js` is not enough — add a focused handler test `demo_authz_server/rules.route.test.js`

- [ ] **Step 1: Write the failing test**

Create `demo_authz_server/rules.route.test.js`:

```js
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let OVERLAY, rulesHandler, ruleStore;

function fresh() {
  for (const m of ['./ruleStore', './routes/rules']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  ruleStore = require('./ruleStore');
  rulesHandler = require('./routes/rules');
}

function makeRes() { return { body: null, json(b) { this.body = b; return this; } }; }

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `rules-route-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.CONFIRM_THRESHOLD_USD = '250';
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});
afterEach(() => { try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ } });

test('GET /rules includes an editable block and reflects the live threshold', () => {
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 60 } });
  const res = makeRes();
  rulesHandler({}, res);
  assert.ok(Array.isArray(res.body.rules));
  assert.ok(res.body.editable, 'editable block present');
  assert.strictEqual(res.body.editable.global.hitlThresholdUsd.value, 60);
  const hitlRule = res.body.rules.find((r) => r.id === 'hitl-gate');
  assert.strictEqual(hitlRule.config.thresholdUsd, 60);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd demo_authz_server && node --test rules.route.test.js`
Expected: FAIL — `res.body.editable` is undefined and `thresholdUsd` is the env constant, not the edited value.

- [ ] **Step 3: Update `rules.js`**

In `demo_authz_server/routes/rules.js`:

Add the require near the top:

```js
const ruleStore = require('../ruleStore');
```

Replace the module-load `HITL_THRESHOLD_USD` constant usage in the `hitl-gate` rule's `config.thresholdUsd` with `ruleStore.getHitlThreshold()`. (You can delete the now-unused `HITL_THRESHOLD_USD` const, or keep it — but the `config.thresholdUsd` value MUST come from `ruleStore.getHitlThreshold()`.)

For the `actor-identity` rule, set `config.authorizedActorClientId` and `config.configured` from `ruleStore.getAuthorizedActorClientId()` (so the displayed rule reflects edits):

```js
        config: (() => {
          const actor = ruleStore.getAuthorizedActorClientId();
          return {
            authorizedActorClientId: actor || null,
            configured: !!actor,
            note: actor ? null : 'No authorized actor configured — act claim check skipped in legacy static mode.',
          };
        })(),
```

For the `scope-enforcement` rule, build `toolScopes` from `ruleStore.requiredScopesForTool(toolName)` instead of `toolDef.requiredScopes` directly, and `writeTools` from `ruleStore.isWriteTool(toolName)`, so overrides show through.

Finally, append the editable block to the response object:

```js
    editable: ruleStore.getEditableBlock(),
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd demo_authz_server && node --test rules.route.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full authz suite**

Run: `cd demo_authz_server && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_authz_server/routes/rules.js demo_authz_server/rules.route.test.js
git commit -m "feat(authz): GET /rules reflects ruleStore values and returns an editable block"
```

---

## Task 4: `PUT /rules` + `POST /rules/reset` with env-gated guard

**Files:**
- Create: `demo_authz_server/routes/rulesWrite.js`
- Modify: `demo_authz_server/index.js`
- Test: `demo_authz_server/rulesWrite.test.js`

- [ ] **Step 1: Write the failing test**

Create `demo_authz_server/rulesWrite.test.js`:

```js
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let OVERLAY, putHandler, resetHandler, ruleStore;

function fresh() {
  for (const m of ['./ruleStore', './routes/rulesWrite']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  ruleStore = require('./ruleStore');
  ({ putHandler, resetHandler } = require('./routes/rulesWrite'));
}

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `rw-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.CONFIRM_THRESHOLD_USD = '250';
  delete process.env.AUTHZ_ADMIN_TOKEN;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});
afterEach(() => { try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ } });

test('PUT applies a valid patch and returns the editable block', () => {
  const res = makeRes();
  putHandler({ headers: {}, body: { global: { hitlThresholdUsd: 42 } } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.editable.global.hitlThresholdUsd.value, 42);
  assert.strictEqual(ruleStore.getHitlThreshold(), 42);
});

test('PUT rejects an invalid patch with 400 and leaves state unchanged', () => {
  const res = makeRes();
  putHandler({ headers: {}, body: { global: { hitlThresholdUsd: -1 } } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /hitlThresholdUsd/);
  assert.strictEqual(ruleStore.getHitlThreshold(), 250);
});

test('reset clears overrides', () => {
  putHandler({ headers: {}, body: { global: { hitlThresholdUsd: 42 } } }, makeRes());
  const res = makeRes();
  resetHandler({ headers: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(ruleStore.getHitlThreshold(), 250);
});

test('guard active when AUTHZ_ADMIN_TOKEN set: wrong/missing token -> 401, correct -> 200', () => {
  process.env.AUTHZ_ADMIN_TOKEN = 'sekret';
  fresh();
  const noTok = makeRes();
  putHandler({ headers: {}, body: { global: { hitlThresholdUsd: 5 } } }, noTok);
  assert.strictEqual(noTok.statusCode, 401);

  const wrong = makeRes();
  putHandler({ headers: { 'x-authz-admin-token': 'nope' }, body: { global: { hitlThresholdUsd: 5 } } }, wrong);
  assert.strictEqual(wrong.statusCode, 401);

  const ok = makeRes();
  putHandler({ headers: { 'x-authz-admin-token': 'sekret' }, body: { global: { hitlThresholdUsd: 5 } } }, ok);
  assert.strictEqual(ok.statusCode, 200);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd demo_authz_server && node --test rulesWrite.test.js`
Expected: FAIL — `Cannot find module './routes/rulesWrite'`.

- [ ] **Step 3: Implement `routes/rulesWrite.js`**

Create `demo_authz_server/routes/rulesWrite.js`:

```js
'use strict';

/**
 * PUT  /rules        — apply a sparse patch to the editable policy (ruleStore).
 * POST /rules/reset  — clear all overrides, revert to scope-topology.json + env.
 *
 * Env-gated guard: when AUTHZ_ADMIN_TOKEN is set, both require a matching
 * X-Authz-Admin-Token header. When unset, the guard is inactive (the server
 * binds 127.0.0.1 as a sidecar; the BFF admin role is the primary control).
 */

const crypto = require('crypto');
const ruleStore = require('../ruleStore');

function guardOk(req) {
  const expected = process.env.AUTHZ_ADMIN_TOKEN;
  if (!expected) return true;
  const got = req.headers['x-authz-admin-token'] || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function putHandler(req, res) {
  if (!guardOk(req)) return res.status(401).json({ error: 'unauthorized: bad or missing X-Authz-Admin-Token' });
  try {
    const editable = ruleStore.applyPatch(req.body || {});
    return res.json({ ok: true, editable });
  } catch (err) {
    if (err.code === 'INVALID_PATCH') return res.status(400).json({ error: err.message });
    console.error('[AuthzServer/rules PUT] error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
}

function resetHandler(req, res) {
  if (!guardOk(req)) return res.status(401).json({ error: 'unauthorized: bad or missing X-Authz-Admin-Token' });
  const editable = ruleStore.reset();
  return res.json({ ok: true, editable });
}

module.exports = { putHandler, resetHandler };
```

- [ ] **Step 4: Register the routes in `index.js`**

In `demo_authz_server/index.js`, after the existing `app.get('/rules', ...)` line add:

```js
const { putHandler, resetHandler } = require('./routes/rulesWrite');
app.put('/rules', putHandler);
app.post('/rules/reset', resetHandler);
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `cd demo_authz_server && node --test rulesWrite.test.js`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Run the full authz suite**

Run: `cd demo_authz_server && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add demo_authz_server/routes/rulesWrite.js demo_authz_server/index.js demo_authz_server/rulesWrite.test.js
git commit -m "feat(authz): PUT /rules + POST /rules/reset with env-gated X-Authz-Admin-Token guard"
```

---

## Task 5: BFF proxy write routes (admin-gated)

**Files:**
- Modify: `demo_api_server/routes/authorize.js`
- Test: `demo_api_server/src/__tests__/mockAuthzRulesWrite.route.test.js`

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/src/__tests__/mockAuthzRulesWrite.route.test.js`:

```js
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios');
jest.mock('../../middleware/auth');

const axios = require('axios');
const { authenticateToken } = require('../../middleware/auth');
const authorizeRouter = require('../../routes/authorize');

function buildApp({ user = { id: 'u1', role: 'admin' } } = {}) {
  const app = express();
  app.use(express.json());
  authenticateToken.mockImplementation((req, res, next) => {
    if (user === null) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  });
  app.use('/api/authorize', authorizeRouter);
  return app;
}

afterEach(() => jest.clearAllMocks());

test('PUT /mock-authz-rules → 403 for non-admin', async () => {
  const app = buildApp({ user: { id: 'u2', role: 'customer' } });
  const r = await request(app).put('/api/authorize/mock-authz-rules').send({ global: { hitlThresholdUsd: 5 } });
  expect(r.status).toBe(403);
  expect(axios.put).not.toHaveBeenCalled();
});

test('PUT /mock-authz-rules → admin proxies to authz server and relays body', async () => {
  axios.put.mockResolvedValue({ data: { ok: true, editable: { global: { hitlThresholdUsd: { value: 5 } } } } });
  const app = buildApp();
  const r = await request(app).put('/api/authorize/mock-authz-rules').send({ global: { hitlThresholdUsd: 5 } });
  expect(r.status).toBe(200);
  expect(r.body.editable.global.hitlThresholdUsd.value).toBe(5);
  expect(axios.put).toHaveBeenCalledWith(
    expect.stringContaining('/rules'),
    { global: { hitlThresholdUsd: 5 } },
    expect.objectContaining({ timeout: expect.any(Number) }),
  );
});

test('POST /mock-authz-rules/reset → admin proxies reset', async () => {
  axios.post.mockResolvedValue({ data: { ok: true, editable: {} } });
  const app = buildApp();
  const r = await request(app).post('/api/authorize/mock-authz-rules/reset').send();
  expect(r.status).toBe(200);
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/rules/reset'), {}, expect.any(Object));
});

test('PUT relays 400 validation error from authz server', async () => {
  axios.put.mockRejectedValue({ response: { status: 400, data: { error: 'hitlThresholdUsd must be a finite number >= 0' } } });
  const app = buildApp();
  const r = await request(app).put('/api/authorize/mock-authz-rules').send({ global: { hitlThresholdUsd: -1 } });
  expect(r.status).toBe(400);
  expect(r.body.error).toMatch(/hitlThresholdUsd/);
});

test('PUT returns 503 when authz server is down', async () => {
  axios.put.mockRejectedValue({ code: 'ECONNREFUSED' });
  const app = buildApp();
  const r = await request(app).put('/api/authorize/mock-authz-rules').send({ global: { hitlThresholdUsd: 5 } });
  expect(r.status).toBe(503);
  expect(r.body.error).toBe('authz_server_unavailable');
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd demo_api_server && npx jest src/__tests__/mockAuthzRulesWrite.route.test.js`
Expected: FAIL — routes return 404 (not yet defined).

- [ ] **Step 3: Add the proxy routes**

In `demo_api_server/routes/authorize.js`, immediately after the existing `GET /mock-authz-rules` handler (ends near line 469), add:

```js
/**
 * PUT /api/authorize/mock-authz-rules
 * Admin-only. Proxies a sparse rule patch to the mock authz server's PUT /rules.
 */
router.put('/mock-authz-rules', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_only', message: 'This endpoint requires admin role.' });
  }
  const authzEndpoint = _authzEndpoint();
  const headers = {};
  if (process.env.AUTHZ_ADMIN_TOKEN) headers['X-Authz-Admin-Token'] = process.env.AUTHZ_ADMIN_TOKEN;
  try {
    const response = await axios.put(`${authzEndpoint}/rules`, req.body || {}, { timeout: 4000, headers });
    return res.json(response.data);
  } catch (err) {
    if (err.response) return res.status(err.response.status).json(err.response.data);
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        ok: false,
        error: 'authz_server_unavailable',
        message: `Mock authorization server not running at ${authzEndpoint}. Start it with ./run.sh.`,
        endpoint: authzEndpoint,
      });
    }
    return res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/authorize/mock-authz-rules/reset
 * Admin-only. Clears all rule overrides on the mock authz server.
 */
router.post('/mock-authz-rules/reset', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_only', message: 'This endpoint requires admin role.' });
  }
  const authzEndpoint = _authzEndpoint();
  const headers = {};
  if (process.env.AUTHZ_ADMIN_TOKEN) headers['X-Authz-Admin-Token'] = process.env.AUTHZ_ADMIN_TOKEN;
  try {
    const response = await axios.post(`${authzEndpoint}/rules/reset`, {}, { timeout: 4000, headers });
    return res.json(response.data);
  } catch (err) {
    if (err.response) return res.status(err.response.status).json(err.response.data);
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        ok: false,
        error: 'authz_server_unavailable',
        message: `Mock authorization server not running at ${authzEndpoint}. Start it with ./run.sh.`,
        endpoint: authzEndpoint,
      });
    }
    return res.status(502).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd demo_api_server && npx jest src/__tests__/mockAuthzRulesWrite.route.test.js`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/authorize.js demo_api_server/src/__tests__/mockAuthzRulesWrite.route.test.js
git commit -m "feat(bff): admin-gated PUT + reset proxy for mock authz rules, forwarding X-Authz-Admin-Token"
```

---

## Task 6: Inline admin editor card in the page

**Files:**
- Modify: `demo_api_ui/src/App.js` (pass `user` to the route)
- Modify: `demo_api_ui/src/components/PingOneAuthorizePage.jsx`

- [ ] **Step 1: Pass `user` to the page route**

In `demo_api_ui/src/App.js`, change the `/pingone-authorize` route (around line 524) from:

```jsx
<Route path="/pingone-authorize" element={<PingOneAuthorizePage />} />
```

to:

```jsx
<Route path="/pingone-authorize" element={<PingOneAuthorizePage user={user} />} />
```

- [ ] **Step 2: Accept `user` and add the editor card**

In `demo_api_ui/src/components/PingOneAuthorizePage.jsx`:

1. Change the component signature:

```jsx
export default function PingOneAuthorizePage({ user }) {
```

2. Add this editor component above `export default function PingOneAuthorizePage` (uses the existing `S` styles + `bffAxios`):

```jsx
// ---------------------------------------------------------------------------
// Mock Authz Server rules — admin round-trip editor (pull → modify → push)
// ---------------------------------------------------------------------------
function MockAuthzRulesEditor({ isAdmin }) {
  const [editable, setEditable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await bffAxios.get('/api/authorize/mock-authz-rules');
      setEditable(res.data.editable || null);
      setDraft(null);
    } catch (e) {
      setErr(e.response?.data?.message || e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={S.cardBody}>Loading mock authz rules…</div>;
  if (err) return <div style={S.error}>{err}</div>;
  if (!editable) return <div style={S.empty}>No editable rules returned by the mock authz server.</div>;

  const view = draft || editable;
  const g = view.global;
  const setGlobal = (key, value) => {
    const base = draft || JSON.parse(JSON.stringify(editable));
    base.global[key] = { ...base.global[key], value, overridden: true };
    setDraft({ ...base });
  };
  const setToolScopes = (tool, scopes) => {
    const base = draft || JSON.parse(JSON.stringify(editable));
    base.tools[tool].requiredScopes = { ...base.tools[tool].requiredScopes, value: scopes, overridden: true };
    setDraft({ ...base });
  };
  const setToolWrite = (tool, isWrite) => {
    const base = draft || JSON.parse(JSON.stringify(editable));
    base.tools[tool].isWrite = { ...base.tools[tool].isWrite, value: isWrite, overridden: true };
    setDraft({ ...base });
  };

  const buildPatch = () => {
    const patch = { global: {}, tools: {} };
    patch.global.hitlThresholdUsd = Number(g.hitlThresholdUsd.value);
    patch.global.enforceMayAct = !!g.enforceMayAct.value;
    patch.global.authorizedActorClientId = g.authorizedActorClientId.value || '';
    patch.global.toolDiscoveryDecision = g.toolDiscoveryDecision.value;
    for (const [tool, fields] of Object.entries(view.tools)) {
      patch.tools[tool] = { requiredScopes: fields.requiredScopes.value, isWrite: !!fields.isWrite.value };
    }
    return patch;
  };

  const save = async () => {
    setSaving(true); setErr(null); setNotice(null);
    try {
      const res = await bffAxios.put('/api/authorize/mock-authz-rules', buildPatch());
      setEditable(res.data.editable); setDraft(null); setNotice('Rules saved — live enforcement updated.');
    } catch (e) {
      setErr(e.response?.data?.error || e.response?.data?.message || e.message);
    } finally { setSaving(false); }
  };

  const reset = async () => {
    setSaving(true); setErr(null); setNotice(null);
    try {
      const res = await bffAxios.post('/api/authorize/mock-authz-rules/reset');
      setEditable(res.data.editable); setDraft(null); setNotice('Reset to scope-topology.json + env defaults.');
    } catch (e) {
      setErr(e.response?.data?.error || e.response?.data?.message || e.message);
    } finally { setSaving(false); }
  };

  const ScopeChip = ({ tool, scope }) => {
    const on = view.tools[tool].requiredScopes.value.includes(scope);
    return (
      <button
        type="button"
        disabled={!isAdmin}
        onClick={() => {
          const cur = view.tools[tool].requiredScopes.value;
          setToolScopes(tool, on ? cur.filter((s) => s !== scope) : [...cur, scope]);
        }}
        style={{
          padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, cursor: isAdmin ? 'pointer' : 'default',
          border: `1px solid ${on ? '#1e40af' : '#cbd5e1'}`, background: on ? '#dbeafe' : '#fff', color: on ? '#1e40af' : '#94a3b8',
        }}
      >
        {scope}
      </button>
    );
  };
  const Mod = ({ on }) => on ? <span style={{ ...S.badge('simulated'), marginLeft: 6 }}>modified</span> : null;

  return (
    <div style={S.cardBody}>
      {notice && <div style={S.info}>{notice}</div>}
      {!isAdmin && <div style={S.warning}>Read-only — sign in as an admin to edit these rules.</div>}

      <div style={S.infoGrid}>
        <div style={S.infoItem}>
          <div style={S.infoLabel}>HITL threshold (USD)<Mod on={g.hitlThresholdUsd.overridden} /></div>
          <input style={S.input} type="number" disabled={!isAdmin} value={g.hitlThresholdUsd.value}
            onChange={(e) => setGlobal('hitlThresholdUsd', e.target.value)} />
        </div>
        <div style={S.infoItem}>
          <div style={S.infoLabel}>Enforce may_act<Mod on={g.enforceMayAct.overridden} /></div>
          <select style={S.select} disabled={!isAdmin} value={String(g.enforceMayAct.value)}
            onChange={(e) => setGlobal('enforceMayAct', e.target.value === 'true')}>
            <option value="true">true</option>
            <option value="false">false (legacy static actor)</option>
          </select>
        </div>
        <div style={S.infoItem}>
          <div style={S.infoLabel}>Authorized actor client ID<Mod on={g.authorizedActorClientId.overridden} /></div>
          <input style={S.input} disabled={!isAdmin} value={g.authorizedActorClientId.value}
            onChange={(e) => setGlobal('authorizedActorClientId', e.target.value)} placeholder="(none)" />
        </div>
        <div style={S.infoItem}>
          <div style={S.infoLabel}>Tool discovery<Mod on={g.toolDiscoveryDecision.overridden} /></div>
          <select style={S.select} disabled={!isAdmin} value={g.toolDiscoveryDecision.value}
            onChange={(e) => setGlobal('toolDiscoveryDecision', e.target.value)}>
            <option value="PERMIT">PERMIT</option>
            <option value="DENY">DENY</option>
          </select>
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', margin: '8px 0' }}>Per-tool scope &amp; write classification</div>
      <table style={S.table}>
        <thead>
          <tr><th style={S.th}>Tool</th><th style={S.th}>Required scopes</th><th style={S.th}>Write</th></tr>
        </thead>
        <tbody>
          {Object.keys(view.tools).map((tool) => (
            <tr key={tool}>
              <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>
                {tool}<Mod on={view.tools[tool].requiredScopes.overridden || view.tools[tool].isWrite.overridden} />
              </td>
              <td style={S.td}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(view.allowedScopes || ['read', 'write', 'admin']).map((s) => <ScopeChip key={s} tool={tool} scope={s} />)}
                </div>
              </td>
              <td style={S.td}>
                <input type="checkbox" disabled={!isAdmin} checked={!!view.tools[tool].isWrite.value}
                  onChange={(e) => setToolWrite(tool, e.target.checked)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {isAdmin && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button style={S.btn} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rules'}</button>
          <button style={S.refreshBtn} onClick={reset} disabled={saving}>Reset to defaults</button>
          {draft && <span style={{ fontSize: 12, color: '#92400e', alignSelf: 'center' }}>Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
```

3. Render the card inside the main page's returned JSX. Just before the closing `</div>` of `S.root` (after the "Setup guidance" block), add:

```jsx
      {/* Mock Authz Server rules — admin round-trip editor */}
      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Mock Authz Server Rules</span>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            {user?.role === 'admin' ? 'editable — drives live decisions' : 'read-only'}
          </span>
        </div>
        <MockAuthzRulesEditor isAdmin={user?.role === 'admin'} />
      </div>
```

- [ ] **Step 3: Build the UI (the gate)**

Run: `cd demo_api_ui && npm run build`
Expected: build completes with 0 errors. (Warnings tolerated only if pre-existing.)

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/App.js demo_api_ui/src/components/PingOneAuthorizePage.jsx
git commit -m "feat(ui): inline admin editor for mock authz rules on /pingone-authorize"
```

---

## Task 7: gitignore overlay, regression note, final verification

**Files:**
- Modify: `.gitignore` (repo root)
- Modify: `REGRESSION_PLAN.md`

- [ ] **Step 1: Ignore the runtime overlay file**

Append to the repo-root `.gitignore`:

```
# Mock authz server runtime rule overrides (editable via /pingone-authorize)
demo_authz_server/rules-overlay.json
```

- [ ] **Step 2: Add a regression-guard note**

In `REGRESSION_PLAN.md`, add a Bug Fix Log / change entry (match the file's existing entry format) recording: `demo_authz_server/routes/decision.js` now reads editable knobs (HITL threshold, enforce-may-act, authorized actor, tool-discovery decision, per-tool scope/write) from `ruleStore` at request time; token-validity guards (aud/exp/iat/nbf/iss, user lookup, intent, scope→tool *source*) and the decision wire contract are unchanged, so `authz-server-parity` is preserved.

- [ ] **Step 3: Run the full authz test suite**

Run: `cd demo_authz_server && npm test`
Expected: PASS (ruleStore, decision, rules.route, rulesWrite).

- [ ] **Step 4: Run the affected BFF tests**

Run: `cd demo_api_server && npx jest src/__tests__/mockAuthzRulesWrite.route.test.js src/__tests__/authorize.parity.test.js`
Expected: PASS (new route tests + existing parity test still green).

- [ ] **Step 5: Confirm the UI build**

Run: `cd demo_api_ui && npm run build`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add .gitignore REGRESSION_PLAN.md
git commit -m "chore(authz): gitignore rule overlay + regression note for editable rules"
```

---

## Self-Review

**Spec coverage:**
- §3 architecture / ruleStore → Task 1. ✅
- §4 editable vs non-editable (token guards untouched) → Task 2 (only Rules 1–4 rewired). ✅
- §5 sparse overlay + reset-to-SoT → Task 1 (`applyPatch`/`reset`/`persist`). ✅
- §6 ruleStore getters/mutators → Task 1. ✅
- §7 API surface (authz GET/PUT/reset + BFF proxy) → Tasks 3, 4, 5. ✅
- §8 validation → Task 1 (`applyPatch`) + Task 4 (400 relay) + Task 5 (BFF 400 relay). ✅
- §9 env-gated PDP guard → Task 4. ✅
- §10 enforcement wiring → Task 2. ✅
- §11 inline admin UI → Task 6. ✅
- §12 parity & safety → Task 7 regression note; wire contract unchanged. ✅
- §13 testing/success criteria → tests in Tasks 1–5; UI build in Tasks 6–7. ✅

**Placeholder scan:** none — every step has concrete code/commands.

**Type/name consistency:** `getEditableBlock`/`applyPatch`/`reset`/`requiredScopesForTool`/`isWriteTool`/`getHitlThreshold`/`getEnforceMayAct`/`getAuthorizedActorClientId`/`getToolDiscoveryDecision` are used consistently across ruleStore, decision.js, rules.js, rulesWrite.js, and the UI's `editable` shape (`{value, default, overridden}`, `allowedScopes`, `tools[name].requiredScopes/isWrite`).

**Note (discovered during planning):** the spec named `PingOneAuthorizePanel.js`; the route `/pingone-authorize` actually renders `PingOneAuthorizePage.jsx`. The plan targets the real page (Task 6) — a faithful refinement of the spec's "inline in the page you pointed at".
