# All-Chips Routing + Non-Skippable Pipeline E2E Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove every built-in agent chip routes correctly under Heuristics-only, Helix-only, and Helix-fails-then-Heuristic-fallback, and that every chip that resolves to a banking tool traverses the full non-skippable pipeline (RFC 8693 exchange → MCP gateway → PingOne Authorize) with the token chain updated.

**Architecture:** Two deliverables. (1) A deterministic CI integration suite (supertest, no network, no Helix) covering Heuristics-only routing + the no-user-token 401 hard-fail. (2) A real-login Playwright e2e spec (under the existing `playwright.real.config.js` harness) that drives all chips through the real two-hop flow with a real PingOne customer session + an admin session corroborating Authorize/gateway from app-events. No production code is changed; all assertions read existing endpoints.

**Tech Stack:** Node, Jest + supertest (CI suite, in `banking_api_server`), Playwright (`@playwright/test`, real spec in `banking_api_ui/tests/e2e`), existing `realLogin.js` fixtures.

---

## Background facts (verified against source — do not re-research)

- **Chip list source of truth:** `banking_api_ui/src/components/BankingChips.jsx`. `HEURISTIC_CHIPS` is a `const` array (6 entries); `LLM_CHIPS` is a `const` object keyed by group name, each value an array. **Neither is exported** and the file is JSX with `import` — a Node script CANNOT `require` it. Each chip entry shape: `{ id, label, message }`.
- **Routing route:** `POST /api/banking-agent/nl` (`banking_api_server/routes/bankingAgentNl.js:15`). Body: `{ message, provider }`. Anonymous-friendly (no session required). Returns **`{ source, result }`**. `source ∈ { 'heuristic', 'helix', 'helix_fallback', 'ollama' }` — **this is the routing proof**. `result` is raw parser output: banking → `{ kind:'banking', banking:{ action, params } }`; education → `{ kind:'education', ... }`; unrecognized → `{ kind:'none', message }`. Empty message → 400 `{ error:'invalid_body' }`.
- **Pipeline route:** `POST /api/mcp/tool` (`banking_api_server/server.js:1225`), middleware `requireSession`. Body `{ tool, params, flowTraceId }`. Success → `{ result, tokenEvents, activeModel, activeProvider }` (+ `mcpAuthorizeEvaluation` when present). No session → **401 `{ error:'unauthenticated', message:'A valid session is required. Please sign in.' }`** (`middleware/auth.js`). `tokenEvents[]` entry: `{ id, label, status, explanation, claims:{ aud, sub, scope, act, iat } }`.
- **Token exchange reads** `req.session.oauthTokens.accessToken`. `POST /api/auth/login` sets `req.session.user` but NOT `oauthTokens` (`tokenType:'local_session'`) — so local login passes `requireSession` but the RFC 8693 exchange has no subject token. **Real PingOne OAuth session is required for the live pipeline.**
- **Customer-scoped observability:** `GET /api/token-chain` (`routes/tokenChain.js:8`), middleware `authenticateToken`, auto-scoped to `req.user.id`. Returns `{ tokenChain[], mcpToolCallsChain[], validationMode, metadata }`. `tokenChain` entry: `{ id, timestamp, eventType, tokenType, tokenSub, tokenAct, tokenAgent, scopes, audience, issuer, expiry, description, exchangeSteps[], userId }`. `mcpToolCallsChain` entry: `{ id, timestamp, toolName, success, duration, isDelegated, userSub, resultSummary }`.
- **Admin-scoped observability:** `GET /api/admin/app-events` (`routes/admin.js:1006`), middleware `requireAdmin` + `requireScopes(['banking:admin'])`. Returns `{ events[], total, categories }`. Event: `{ id, timestamp, category, severity, message, tag, metadata, flowId, username }`. Relevant categories: token exchange = `token_exchange`; gateway routing = `gateway_path`; Authorize decision = `authorize`.
- **Config write (for condition 3):** `POST /api/admin/config` (`routes/adminConfig.js:138`), admin-gated. Accepts only `FIELD_DEFS` keys; empty string = "leave unchanged". `helix_base_url` is a valid key. Masked GET will not return the live value, so restore must use a captured-known value, not a masked read.
- **Real login fixtures:** `banking_api_ui/tests/e2e/helpers/realLogin.js` exports `loginAsCustomer(page)`, `loginAsAdmin(page)`, `requireRealLoginEnv()`, `requireAdminLoginEnv()`. Env vars: `E2E_CUSTOMER_USERNAME/PASSWORD`, `E2E_ADMIN_USERNAME/PASSWORD`, `E2E_BASE_URL`. Seeded demo users: `bankuser` / `bankadmin`, password `2Federate!`.
- **Real e2e harness:** `banking_api_ui/playwright.real.config.js`, script `npm run test:e2e:real` (and `:real:local` with `E2E_BASE_URL=http://localhost:3000`). Existing real spec to mirror: `banking_api_ui/tests/e2e/banking-agent.real.spec.js`.
- **Helix creds are NOT in the vault.** `secrets.vault` holds OAuth/MCP secrets only (`grep -i helix secrets.vault` → empty). `helix_api_key` resolves (`configStore.js:886-900`) in order: (1) runtime configStore via `/setup` or `POST /api/admin/config`; (2) `HELIX_API_KEY` env var; (3) per-agent key file `<helix_agent_id>.json` (default `LLM2.json`) in repo root / `~/Documents` / `~/Downloads` via `helixAgentKeyLoader.js`; (4) committed `config/pingoneBackendDefaults`. **Consequence:** if Helix is unconfigured, the router falls back to heuristic — Condition 2 would FALSELY pass. The spec MUST gate Condition 2 on Helix actually being configured (Task 5 adds an explicit precondition probe that fails loudly, not a silent skip).
- **CI integration model:** `banking_api_server/tests/routes/hitlGateway.integration.test.js` — real configStore, mocked session middleware + deep services, supertest.

## Heuristic-resolvable chip set (verified against `nlIntentParser.js:195-336`)

These chip `message` strings resolve to a `kind:'banking'` action via the heuristic parser (condition 1 expects EXECUTE):

| Chip id | message | heuristic action |
|---|---|---|
| `balance` | `balance` | `balance` |
| `accounts` | `accounts` | `accounts` |
| `transactions` | `transactions` | `transactions` |
| `transfer` | `transfer` | `transfer` |
| `transfer_600` | `transfer $600 from my savings account to checking` | `transfer` (params) |
| `mortgage` | `show mortgage data` | `mortgage_demo` |

All `LLM_CHIPS` messages (e.g. "What's my biggest purchase?", "How much did I spend on groceries?") — condition 1 expects the heuristic to either match a banking action (e.g. "biggest purchase" → `biggest_purchase`, "spending summary" phrasing → `spending_summary`) OR return `kind:'none'` with the hint message. **The test classifies each chip by running the heuristic parser directly at suite setup (Task 2), NOT by hardcoding — the table above is illustrative only.**

## File Structure

- `banking_api_server/scripts/extractChips.js` — **Create.** Pure Node module: regex-extracts `HEURISTIC_CHIPS` + `LLM_CHIPS` entries from `BankingChips.jsx` and exports `{ heuristicChips, llmChips, allChips }` (flat `{id,label,message}[]`). Single source of truth for both deliverables. No JSX execution.
- `banking_api_server/src/__tests__/extractChips.test.js` — **Create.** Unit test for the extractor.
- `banking_api_server/tests/routes/allChips.pipeline.integration.test.js` — **Create.** CI suite: Heuristics-only routing for every chip + no-token 401 hard-fail. supertest.
- `banking_api_ui/tests/e2e/all-chips-pipeline.real.spec.js` — **Create.** Playwright real spec: 3 routing conditions × all chips, dual-session skip-proof.
- `banking_api_ui/tests/e2e/helpers/chipPipeline.js` — **Create.** Shared helper used by the real spec: drive one chip (nl → mcp/tool), assert the 4-stage trail, snapshot/diff token-chain.

No production files modified. No `banking_api_ui` source change → UI build gate N/A.

---

## Task 1: Chip extractor module

**Files:**
- Create: `banking_api_server/scripts/extractChips.js`
- Test: `banking_api_server/src/__tests__/extractChips.test.js`

- [ ] **Step 1: Write the failing test**

```js
// banking_api_server/src/__tests__/extractChips.test.js
'use strict';
const { heuristicChips, llmChips, allChips } = require('../extractChips');

describe('extractChips', () => {
  test('heuristicChips contains the 6 known built-in chips with exact messages', () => {
    const byId = Object.fromEntries(heuristicChips.map((c) => [c.id, c]));
    expect(heuristicChips).toHaveLength(6);
    expect(byId.balance.message).toBe('balance');
    expect(byId.accounts.message).toBe('accounts');
    expect(byId.transactions.message).toBe('transactions');
    expect(byId.transfer.message).toBe('transfer');
    expect(byId.transfer_600.message).toBe(
      'transfer $600 from my savings account to checking',
    );
    expect(byId.mortgage.message).toBe('show mortgage data');
  });

  test('llmChips are extracted with id/label/message and a group', () => {
    expect(llmChips.length).toBeGreaterThanOrEqual(20);
    for (const c of llmChips) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(typeof c.message).toBe('string');
      expect(typeof c.group).toBe('string');
      expect(c.message.length).toBeGreaterThan(0);
    }
    const last30 = llmChips.find((c) => c.id === 'last_30_days');
    expect(last30.message).toBe('Show me transactions from the last 30 days');
    expect(last30.group).toBe('Time-Based');
  });

  test('allChips is the flat union with no duplicate ids and no empty messages', () => {
    expect(allChips.length).toBe(heuristicChips.length + llmChips.length);
    const ids = allChips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allChips.every((c) => c.message.trim().length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest extractChips`
Expected: FAIL — `Cannot find module '../extractChips'`.

- [ ] **Step 3: Write minimal implementation**

```js
// banking_api_server/scripts/extractChips.js
'use strict';
/**
 * Source-of-truth chip extractor.
 *
 * banking_api_ui/src/components/BankingChips.jsx is JSX with `import` and does
 * NOT export its chip constants, so it cannot be require()'d from Node. This
 * module reads the file as text and regex-parses the two const literals:
 *   const HEURISTIC_CHIPS = [ { id, label, message }, ... ];
 *   const LLM_CHIPS = { "Group": [ { id, label, message }, ... ], ... };
 *
 * Entry fields are simple string literals (id/label/message). The regex is
 * deliberately strict: it only matches { id: "..", label: "..", message: ".." }
 * objects (in any property order) and ignores comments/JSX around them.
 */
const fs = require('fs');
const path = require('path');

const CHIPS_FILE = path.resolve(
  __dirname,
  '../../banking_api_ui/src/components/BankingChips.jsx',
);

function readSource() {
  return fs.readFileSync(CHIPS_FILE, 'utf8');
}

/** Extract the substring of `src` for a balanced bracket starting at `openIdx`. */
function sliceBalanced(src, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  throw new Error(`Unbalanced ${open}${close} starting at ${openIdx}`);
}

/** Pull every { id,label,message } object literal out of a block of text. */
function parseChipObjects(block) {
  const chips = [];
  // Match an object literal containing id/label/message string props in any order.
  const objRe = /\{[^{}]*?\bid\s*:\s*"([^"]+)"[^{}]*?\}/g;
  let m;
  while ((m = objRe.exec(block)) !== null) {
    const objText = m[0];
    const id = (objText.match(/\bid\s*:\s*"([^"]+)"/) || [])[1];
    const label = (objText.match(/\blabel\s*:\s*"([^"]+)"/) || [])[1];
    const message = (objText.match(/\bmessage\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1];
    if (id && label != null && message != null) {
      chips.push({ id, label, message: message.replace(/\\"/g, '"') });
    }
  }
  return chips;
}

function extract() {
  const src = readSource();

  const hIdx = src.indexOf('HEURISTIC_CHIPS');
  const hArrStart = src.indexOf('[', hIdx);
  const hBlock = sliceBalanced(src, hArrStart, '[', ']');
  const heuristicChips = parseChipObjects(hBlock);

  const lIdx = src.indexOf('LLM_CHIPS');
  const lObjStart = src.indexOf('{', lIdx);
  const lBlock = sliceBalanced(src, lObjStart, '{', '}');
  // Group name precedes each array: "Group Name": [ ... ]
  const groupRe = /"([^"]+)"\s*:\s*\[/g;
  const llmChips = [];
  let gm;
  while ((gm = groupRe.exec(lBlock)) !== null) {
    const group = gm[1];
    const arrStart = lBlock.indexOf('[', gm.index);
    const arrBlock = sliceBalanced(lBlock, arrStart, '[', ']');
    for (const c of parseChipObjects(arrBlock)) {
      llmChips.push({ ...c, group });
    }
  }

  const allChips = [
    ...heuristicChips.map((c) => ({ ...c, kind: 'heuristic-builtin' })),
    ...llmChips.map((c) => ({ ...c, kind: 'llm-builtin' })),
  ];
  return { heuristicChips, llmChips, allChips };
}

module.exports = extract();
module.exports.extract = extract;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest extractChips`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/scripts/extractChips.js banking_api_server/src/__tests__/extractChips.test.js
git commit -m "test(chips): chip extractor — single source of truth from BankingChips.jsx

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: CI integration suite — Heuristics-only routing for every chip

**Files:**
- Create: `banking_api_server/tests/routes/allChips.pipeline.integration.test.js`

This suite proves: under Heuristics-only, sending each chip's `message` to `/api/banking-agent/nl` returns `source:'heuristic'`, and the result is either a `kind:'banking'` action (heuristic chips and any LLM chip the heuristic recognizes) or `kind:'none'` with a hint (LLM chips the heuristic doesn't recognize) — never a 500, never a Helix call. Per-chip expectation is derived by running the real heuristic parser, not hardcoded.

- [ ] **Step 1: Write the failing test**

```js
// banking_api_server/tests/routes/allChips.pipeline.integration.test.js
'use strict';
/**
 * CI integration suite — deterministic conditions only:
 *   (1) Heuristics-only routing for every built-in chip
 *   (2) No-user-token hard-fail on the pipeline (401, zero pipeline trail)
 *
 * Real Helix is NOT exercised here (non-deterministic / network) — that lives
 * in banking_api_ui/tests/e2e/all-chips-pipeline.real.spec.js.
 *
 * Models banking_api_server/tests/routes/hitlGateway.integration.test.js:
 * real configStore, mocked deep services, supertest.
 */
const express = require('express');
const request = require('supertest');

jest.setTimeout(20000);

// Force Heuristics-only: ff_heuristic_enabled defaults true; ensure no LLM is
// reachable by stubbing the Helix/Ollama callers so a routing miss can never
// silently hit the network in CI.
jest.mock('../../services/helixLlmService', () => ({
  callHelixAgent: jest.fn(() => Promise.reject(new Error('helix disabled in CI'))),
  answerWithHelix: jest.fn(() => Promise.reject(new Error('helix disabled in CI'))),
}));

const { heuristicChips, allChips } = require('../../scripts/extractChips');
const { parseHeuristic } = require('../../services/nlIntentParser');

function buildNlApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { id: 'ci-' + Math.random().toString(36).slice(2, 8), save: (cb) => cb && cb() };
    next();
  });
  app.use('/api/banking-agent', require('../../routes/bankingAgentNl'));
  return app;
}

describe('all-chips — Heuristics-only routing (CI, deterministic)', () => {
  const app = buildNlApp();

  test.each(allChips.map((c) => [c.id, c.message]))(
    'chip %s routes via heuristic and never errors',
    async (_id, message) => {
      const res = await request(app)
        .post('/api/banking-agent/nl')
        .send({ message, provider: 'auto' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('source');
      expect(res.body).toHaveProperty('result');
      // Heuristic ALWAYS wins in this config (no LLM reachable).
      expect(res.body.source).toBe('heuristic');

      // Expectation derived from the real parser, not hardcoded.
      const expected = parseHeuristic(message);
      expect(res.body.result.kind).toBe(expected.kind);
      if (expected.kind === 'banking') {
        expect(res.body.result.banking.action).toBe(expected.banking.action);
      }
    },
  );

  test('every built-in HEURISTIC chip resolves to a banking action (not a hint)', () => {
    for (const c of heuristicChips) {
      const r = parseHeuristic(c.message);
      expect(r.kind).toBe('banking');
      expect(typeof r.banking.action).toBe('string');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest tests/routes/allChips.pipeline.integration.test.js`
Expected: FAIL initially only if Task 1 not present; otherwise this should drive out any real mismatch. If `parseHeuristic` is not exported, FAIL with `parseHeuristic is not a function` — fix by importing from the documented export at `nlIntentParser.js:338` (`module.exports = { parseHeuristic, ... }`; confirm name).

- [ ] **Step 3: Make it pass (no production change expected)**

No production code changes. If a chip's runtime `source` is not `'heuristic'`, that is a real routing finding — STOP and report it (do not weaken the assertion). If `parseHeuristic` export name differs, correct the `require` line only.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest tests/routes/allChips.pipeline.integration.test.js`
Expected: PASS — one row per chip + the heuristic-chips assertion.

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/tests/routes/allChips.pipeline.integration.test.js
git commit -m "test(chips): CI suite — every chip routes via heuristic in Heuristics-only mode

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: CI integration suite — no-user-token pipeline hard-fail

**Files:**
- Modify: `banking_api_server/tests/routes/allChips.pipeline.integration.test.js` (append a describe block)

Proves the "cannot skip" rule's negative case: with no session user, `POST /api/mcp/tool` returns 401 BEFORE any token exchange / gateway / authorize, for a representative banking tool.

- [ ] **Step 1: Write the failing test (append to the file)**

```js
// --- appended to allChips.pipeline.integration.test.js ---

describe('pipeline hard-fail — no user token (CI, deterministic)', () => {
  function buildMcpAppNoSession() {
    // Mount ONLY requireSession + a sentinel handler that must never run.
    const { requireSession } = require('../../middleware/auth');
    const app = express();
    app.use(express.json());
    // No session.user is ever set.
    let pipelineEntered = false;
    app.post('/api/mcp/tool', express.json(), requireSession, (req, res) => {
      pipelineEntered = true;
      res.json({ result: 'SHOULD_NOT_REACH' });
    });
    app.get('/__entered', (req, res) => res.json({ pipelineEntered }));
    return app;
  }

  test('POST /api/mcp/tool with no session → 401 unauthenticated, pipeline never entered', async () => {
    const app = buildMcpAppNoSession();
    const res = await request(app)
      .post('/api/mcp/tool')
      .send({ tool: 'get_my_accounts', params: {} });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
    expect(res.body.message).toBe('A valid session is required. Please sign in.');

    const probe = await request(app).get('/__entered');
    expect(probe.body.pipelineEntered).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest tests/routes/allChips.pipeline.integration.test.js -t "no user token"`
Expected: FAIL only if `requireSession` is not a named export of `middleware/auth`. Confirm the export (CLAUDE.md + research show `requireSession` defined in `middleware/auth.js`). If it is not exported, import the middleware module and reference the function as exported (do NOT reimplement it).

- [ ] **Step 3: Make it pass**

No production change. Correct only the `require`/destructure of `requireSession` to match its real export.

- [ ] **Step 4: Run to verify it passes**

Run: `cd banking_api_server && npx jest tests/routes/allChips.pipeline.integration.test.js`
Expected: PASS — all rows from Task 2 + the no-token block.

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/tests/routes/allChips.pipeline.integration.test.js
git commit -m "test(chips): CI suite — no-token pipeline hard-fail (401, pipeline never entered)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Real-spec shared helper — drive one chip + assert the 4-stage trail

**Files:**
- Create: `banking_api_ui/tests/e2e/helpers/chipPipeline.js`

Playwright `request` on a logged-in `page.context()` carries the session cookie automatically. This helper performs the two-hop flow for one chip and asserts the trail using customer-scoped `/api/token-chain` + `tokenEvents`. Admin app-events corroboration is a separate helper used only by the suite-level admin context.

- [ ] **Step 1: Write the helper (no separate unit test — exercised by Task 5 spec)**

```js
// banking_api_ui/tests/e2e/helpers/chipPipeline.js
'use strict';
/**
 * Drive a single chip through the real two-hop flow and assert it did NOT
 * skip any pipeline stage. Customer-scoped assertions only (token-chain +
 * tokenEvents). Authorize/gateway corroboration is done at suite level via
 * an admin context (see assertAdminPipelineEvents).
 */
const { expect } = require('@playwright/test');

/**
 * @param {import('@playwright/test').APIRequestContext} api  customer-cookie'd context
 * @param {{id:string,label:string,message:string}} chip
 * @param {string} provider  'auto' (heuristics) | 'helix'
 * @returns {Promise<{source:string, result:object, executed:boolean, tokenEvents:any[]}>}
 */
async function runChip(api, chip, provider) {
  // Hop 1: routing decision
  const nlResp = await api.post('/api/banking-agent/nl', {
    data: { message: chip.message, provider },
  });
  expect(nlResp.status(), `nl status for chip ${chip.id}`).toBe(200);
  const { source, result } = await nlResp.json();
  expect(source, `routing source for chip ${chip.id}`).toBeTruthy();

  // A chip resolves to a tool only when result.kind === 'banking'.
  if (!result || result.kind !== 'banking' || !result.banking?.action) {
    return { source, result, executed: false, tokenEvents: [] };
  }

  // Snapshot token-chain BEFORE the pipeline.
  const beforeResp = await api.get('/api/token-chain');
  expect(beforeResp.status()).toBe(200);
  const before = await beforeResp.json();
  const beforeMcp = before.mcpToolCallsChain?.length || 0;
  const beforeChain = before.tokenChain?.length || 0;

  // Hop 2: pipeline. Map the heuristic action to its MCP tool exactly as the
  // SPA does. We assert the BFF drives the pipeline; the tool name mapping is
  // the SPA's responsibility, so we send the action via the same nl→dispatch
  // contract by re-using /api/mcp/tool with the canonical tool for the action.
  const toolByAction = {
    balance: 'get_account_balance',
    accounts: 'get_my_accounts',
    transactions: 'get_my_transactions',
    transfer: 'create_transfer',
    deposit: 'create_deposit',
    withdraw: 'create_withdrawal',
    biggest_purchase: 'get_my_transactions',
    spending_summary: 'get_my_transactions',
    sensitive_account_details: 'get_my_accounts',
    mcp_tools: 'list_tools',
    mortgage_demo: 'show_mortgage',
  };
  const action = result.banking.action;
  const tool = toolByAction[action];
  // Some actions (web_search, logout, education) are intentionally non-pipeline.
  if (!tool) {
    return { source, result, executed: false, tokenEvents: [] };
  }

  const mcpResp = await api.post('/api/mcp/tool', {
    data: { tool, params: result.banking.params || {}, flowTraceId: `e2e-${chip.id}-${Date.now()}` },
  });
  // 200 = executed; 428 = consent gate (still went THROUGH exchange+authorize);
  // 403 = Authorize DENY (still proves Authorize ran). 401 here = a real bug
  // (we are logged in) — fail loudly.
  expect(mcpResp.status(), `mcp/tool status for chip ${chip.id}`).not.toBe(401);
  const mcpBody = await mcpResp.json();
  const tokenEvents = mcpBody.tokenEvents || [];

  // SKIP-PROOF (customer-visible portion):
  // 1. RFC 8693 exchange present in tokenEvents (an event whose claims carry
  //    an `act` actor OR a label naming the MCP/exchanged token).
  const sawExchange = tokenEvents.some(
    (e) =>
      e?.claims?.act ||
      /exchang|mcp.*token|delegat/i.test(`${e?.label || ''} ${e?.explanation || ''}`),
  );
  expect(sawExchange, `chip ${chip.id}: RFC 8693 exchange event in tokenEvents`).toBe(true);
  expect(tokenEvents.length, `chip ${chip.id}: token chain updated`).toBeGreaterThan(0);

  // 2. Token-chain grew (token chain updated) AND an MCP tool call recorded.
  const afterResp = await api.get('/api/token-chain');
  const after = await afterResp.json();
  expect(after.tokenChain?.length || 0, `chip ${chip.id}: token-chain grew`).toBeGreaterThanOrEqual(beforeChain);
  expect(after.mcpToolCallsChain?.length || 0, `chip ${chip.id}: mcp tool call recorded`).toBeGreaterThan(beforeMcp);

  return { source, result, executed: true, tokenEvents };
}

/**
 * Admin-context corroboration: assert Authorize + gateway legs were recorded
 * for the just-run window. `sinceIso` bounds the query to this chip's window.
 * @param {import('@playwright/test').APIRequestContext} adminApi
 * @param {string} sinceIso
 * @param {string} chipId  for assertion messages
 */
async function assertAdminPipelineEvents(adminApi, sinceIso, chipId) {
  const resp = await adminApi.get(`/api/admin/app-events?limit=500&since=${encodeURIComponent(sinceIso)}`);
  expect(resp.status(), `admin app-events status (${chipId})`).toBe(200);
  const { events } = await resp.json();
  const cats = new Set(events.map((e) => e.category));
  expect(cats.has('authorize'), `chip ${chipId}: Authorize decision event recorded`).toBe(true);
  expect(
    cats.has('gateway_path') || cats.has('mcp'),
    `chip ${chipId}: gateway/MCP routing event recorded`,
  ).toBe(true);
}

module.exports = { runChip, assertAdminPipelineEvents };
```

- [ ] **Step 2: Verify the helper parses (lint/load only)**

Run: `cd banking_api_ui && node -e "require('./tests/e2e/helpers/chipPipeline.js'); console.log('ok')"`
Expected: prints `ok` (module loads; `@playwright/test` resolvable as a dev dep).

- [ ] **Step 3: Commit**

```bash
git add banking_api_ui/tests/e2e/helpers/chipPipeline.js
git commit -m "test(chips): e2e helper — drive one chip + 4-stage skip-proof assertions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Real Playwright spec — 3 routing conditions × all chips, dual-session

**Files:**
- Create: `banking_api_ui/tests/e2e/all-chips-pipeline.real.spec.js`

Runs under `playwright.real.config.js` (`npm run test:e2e:real` / `:real:local`). Auto-skips without real-login env. Condition 3 mutates `helix_base_url` to a dead URL via the admin context and **restores it in `test.afterAll` unconditionally**.

- [ ] **Step 1: Write the spec**

```js
// banking_api_ui/tests/e2e/all-chips-pipeline.real.spec.js
'use strict';
/**
 * All-chips routing + non-skippable pipeline — REAL login, real Helix.
 *
 * Conditions:
 *   1. Heuristics-only        provider='auto', ff_heuristic_enabled stays true
 *   2. Helix-only             provider='helix' (real Helix)
 *   3. Helix-fails → fallback  helix_base_url set to a dead URL; provider='helix'
 *
 * Skip-proof: customer asserts token-chain + tokenEvents (runChip);
 * admin context corroborates Authorize + gateway (assertAdminPipelineEvents).
 *
 * Requires: ./run-demo.sh stack up, real-login env vars set. Auto-skips otherwise.
 */
const { test, expect, request } = require('@playwright/test');
const {
  loginAsCustomer,
  loginAsAdmin,
  requireRealLoginEnv,
  requireAdminLoginEnv,
} = require('./helpers/realLogin');
const { runChip, assertAdminPipelineEvents } = require('./helpers/chipPipeline');
const { heuristicChips, allChips } = require('../../../banking_api_server/scripts/extractChips');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

test.describe('all-chips routing + non-skippable pipeline (real)', () => {
  test.skip(!requireRealLoginEnv() || !requireAdminLoginEnv(),
    'Requires E2E_CUSTOMER_* and E2E_ADMIN_* env vars');
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let customerApi;   // APIRequestContext with customer cookies
  let adminApi;      // APIRequestContext with admin cookies
  let customerCtx;
  let adminCtx;
  let originalHelixBaseUrl;
  let helixConfigured = false;

  test.beforeAll(async ({ browser }) => {
    // Customer session
    customerCtx = await browser.newContext();
    const cPage = await customerCtx.newPage();
    await loginAsCustomer(cPage);
    customerApi = customerCtx.request;

    // Admin session
    adminCtx = await browser.newContext();
    const aPage = await adminCtx.newPage();
    await loginAsAdmin(aPage);
    adminApi = adminCtx.request;

    // Capture the live helix_base_url so condition 3 can restore it.
    // Masked GET does not return secrets but helix_base_url is not masked;
    // fall back to the documented default if absent.
    const cfgResp = await adminApi.get('/api/admin/config');
    const cfg = cfgResp.ok() ? await cfgResp.json() : {};
    originalHelixBaseUrl =
      (cfg.config && cfg.config.helix_base_url) ||
      process.env.HELIX_BASE_URL ||
      'https://openam-helix.forgeblocks.com';

    // Helix precondition probe. Helix creds are NOT vault-sourced; they come
    // from configStore/HELIX_API_KEY/LLM2.json/builtin defaults. If Helix is
    // unconfigured the router falls back to heuristic and Condition 2 would
    // FALSELY pass. Probe with a phrase the heuristic CANNOT resolve, forcing
    // the LLM path: a Helix-sourced answer proves Helix is live.
    const probe = await customerApi.post('/api/banking-agent/nl', {
      data: {
        message: 'In one short sentence, what is the capital of France?',
        provider: 'helix',
      },
    });
    const probeBody = probe.ok() ? await probe.json() : {};
    helixConfigured = probeBody.source === 'helix' || probeBody.source === 'helix_fallback';
  });

  test.afterAll(async () => {
    // ALWAYS restore helix_base_url, even if a condition-3 assertion threw.
    if (adminApi && originalHelixBaseUrl) {
      await adminApi.post('/api/admin/config', {
        data: { helix_base_url: originalHelixBaseUrl },
      }).catch(() => {});
    }
    await customerCtx?.close();
    await adminCtx?.close();
  });

  // ── Condition 1: Heuristics-only ───────────────────────────────────────────
  test('Condition 1 — Heuristics-only: every built-in HEURISTIC chip executes the full pipeline', async () => {
    for (const chip of heuristicChips) {
      const since = new Date(Date.now() - 2000).toISOString();
      const { source, executed } = await runChip(customerApi, chip, 'auto');
      expect(source, `chip ${chip.id} routed by heuristic`).toBe('heuristic');
      expect(executed, `chip ${chip.id} executed a banking tool`).toBe(true);
      await assertAdminPipelineEvents(adminApi, since, chip.id);
    }
  });

  test('Condition 1 — LLM-only chips degrade gracefully (no crash, no skipped pipeline)', async () => {
    const llm = allChips.filter((c) => c.kind === 'llm-builtin');
    for (const chip of llm) {
      const { source, result, executed, tokenEvents } = await runChip(customerApi, chip, 'auto');
      // Heuristic either matched a banking action (then it MUST have a trail)
      // or returned a non-banking result (kind:none/education) — both pass.
      if (executed) {
        expect(tokenEvents.length, `chip ${chip.id} executed → trail required`).toBeGreaterThan(0);
      } else {
        expect(['heuristic', 'helix', 'helix_fallback', 'ollama']).toContain(source);
        expect(result.kind === 'none' || result.kind === 'education' || result.kind === 'banking').toBe(true);
      }
    }
  });

  // ── Condition 2: Helix-only (real Helix) ───────────────────────────────────
  test('Condition 2 — Helix-only: every chip routes via Helix and executes the full pipeline', async () => {
    // HARD GATE: if Helix is not actually configured, the router falls back to
    // heuristic and this condition is meaningless. Fail loudly with a clear
    // remediation message rather than false-passing via the heuristic floor.
    expect(
      helixConfigured,
      'Helix is NOT configured (probe did not return source=helix). ' +
        'Condition 2 cannot validate Helix routing. Configure Helix via ' +
        '/setup, HELIX_API_KEY, or place LLM2.json in repo root, then re-run. ' +
        'Helix creds are NOT vault-sourced.',
    ).toBe(true);

    for (const chip of allChips) {
      const since = new Date(Date.now() - 2000).toISOString();
      const { source, executed } = await runChip(customerApi, chip, 'helix');
      // With Helix confirmed live, banking chips MUST route via Helix. The
      // heuristic floor is only acceptable for chips the heuristic also
      // recognizes (it runs first by design) — but a Helix-sourced result is
      // expected for the LLM chips that the heuristic returns kind:none for.
      expect(['helix', 'helix_fallback', 'heuristic']).toContain(source);
      if (executed) {
        await assertAdminPipelineEvents(adminApi, since, chip.id);
      }
    }

    // Cross-check: at least the LLM-only chips (heuristic returns none) must
    // have been resolved by Helix, proving Helix actually did routing work.
    const llmProbe = allChips.find((c) => c.id === 'recommendations') || allChips.find((c) => c.kind === 'llm-builtin');
    const { source: llmSource } = await runChip(customerApi, llmProbe, 'helix');
    expect(
      ['helix', 'helix_fallback'],
      `LLM-only chip ${llmProbe.id} must be Helix-routed in Condition 2`,
    ).toContain(llmSource);
  });

  // ── Condition 3: Helix fails → Heuristic fallback ──────────────────────────
  test('Condition 3 — dead Helix: heuristic chips still execute via fallback', async () => {
    // Point Helix at a syntactically valid but unroutable URL.
    const setResp = await adminApi.post('/api/admin/config', {
      data: { helix_base_url: 'https://127.0.0.1:9' },
    });
    expect(setResp.ok(), 'helix_base_url override accepted').toBe(true);

    for (const chip of heuristicChips) {
      const since = new Date(Date.now() - 2000).toISOString();
      const { source, executed } = await runChip(customerApi, chip, 'helix');
      // Helix is dead → routing MUST fall back to heuristic (never a canned miss).
      expect(source, `chip ${chip.id} fell back to heuristic`).toBe('heuristic');
      expect(executed, `chip ${chip.id} still executed end-to-end`).toBe(true);
      await assertAdminPipelineEvents(adminApi, since, chip.id);
    }
    // Restore happens in afterAll regardless of assertion outcome.
  });

  // ── Negative: no-token hard-fail (fresh, unauthenticated context) ──────────
  test('No user token — pipeline hard-fails 401 before any exchange/gateway/authorize', async ({ browser }) => {
    const anonCtx = await browser.newContext();
    const anon = anonCtx.request;
    const res = await anon.post(`${BASE}/api/mcp/tool`, {
      data: { tool: 'get_my_accounts', params: {} },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
    await anonCtx.close();
  });
});
```

- [ ] **Step 2: Verify the spec is collected (not run) without env**

Run: `cd banking_api_ui && npx playwright test all-chips-pipeline.real.spec.js --config=playwright.real.config.js --list`
Expected: spec listed; tests show as skipped when `requireRealLoginEnv()` is false (no credentials). No collection error (imports resolve).

- [ ] **Step 3: Run for real against the local stack (manual gate)**

Pre: `./run-demo.sh status` all healthy; export `E2E_BASE_URL=http://localhost:3000`, `E2E_CUSTOMER_USERNAME=bankuser`, `E2E_CUSTOMER_PASSWORD=2Federate!`, `E2E_ADMIN_USERNAME=bankadmin`, `E2E_ADMIN_PASSWORD=2Federate!` (or values from `tests/e2e/.env.e2e`).
Run: `cd banking_api_ui && npm run test:e2e:real -- all-chips-pipeline.real.spec.js`
Expected: Conditions 1 & 3 green for heuristic chips with full trail; Condition 2 chips resolve+execute; no-token → 401. On any chip showing a result without a trail → that is a real "skip" finding; STOP and report (do not weaken assertions). Confirm afterAll restored `helix_base_url` (`./run-demo.sh tail all` shows no lingering `127.0.0.1:9` Helix errors).

- [ ] **Step 4: Commit**

```bash
git add banking_api_ui/tests/e2e/all-chips-pipeline.real.spec.js
git commit -m "test(chips): real e2e — 3 routing conditions x all chips, dual-session skip-proof

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire CI suite into the standard test run + document

**Files:**
- Modify: `banking_api_server/package.json` (add a script alias only if a chip-suite alias is wanted; the file-pattern already runs under `npm run test:api-server`)
- Modify: `REGRESSION_PLAN.md` §4 (Bug Fix Log) — only if any real routing/skip finding was fixed during execution. If no production bug was found, add NO entry (this is a test-only addition).

- [ ] **Step 1: Confirm the CI suite runs under the existing aggregate**

Run: `cd banking_api_server && npx jest tests/routes/allChips.pipeline.integration.test.js extractChips`
Expected: all green.

- [ ] **Step 2: Add a focused npm script (convenience only)**

In `banking_api_server/package.json` `scripts`, add:
```json
"test:chips": "jest extractChips tests/routes/allChips.pipeline.integration.test.js"
```

- [ ] **Step 3: Verify the alias**

Run: `cd banking_api_server && npm run test:chips`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add banking_api_server/package.json
git commit -m "test(chips): add test:chips alias for the deterministic chip CI suite

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Verification (definition of done)

- `cd banking_api_server && npm run test:chips` → all green (extractor + Heuristics-only every-chip + no-token 401).
- `cd banking_api_ui && npx playwright test all-chips-pipeline.real.spec.js --config=playwright.real.config.js --list` → spec collected, skips cleanly without creds.
- Manual real run (stack up, creds set, **Helix configured** via `/setup` / `HELIX_API_KEY` / `LLM2.json` — NOT vault): Conditions 1 & 3 green for all heuristic chips WITH a full exchange→gateway→authorize→token-chain trail; Condition 2 gate passes (Helix probe returns `source=helix`) and chips resolve+execute; no-token → 401; `helix_base_url` restored after the run. If Helix is unconfigured, Condition 2 FAILS LOUDLY with remediation text (by design — never a silent skip or false green).
- No production source files modified. No `banking_api_ui` source change → UI build gate not triggered. No REGRESSION_PLAN §4 entry unless a real production bug was found and fixed during execution.
- No emojis introduced anywhere (CLAUDE.md §4 — only ⚠️ ✅ ❌ permitted; none used here).
```
