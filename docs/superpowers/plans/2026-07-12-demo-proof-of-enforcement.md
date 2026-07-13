# Demo Proof-of-Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every triggered use case (chip, Use-Case Launcher, or attack simulation, in any agent mode — Heuristics, llama.cpp, any LLM) produce an unmissable, specific on-screen verdict that its declared evidence chain actually occurred and matched the expected outcome — not just a chat reply.

**Architecture:** Two layers. (1) Backend: every tool-execution path already funnels through `runMcpToolPipeline` (`demo_api_server/services/mcpToolPipeline.js`), so we thread a resolved `useCaseId` into that pipeline's `ctx` *before* it runs (today it's only derived *after*), and stamp it onto the authorize decision and activity-log events it already emits — not just onto `tokenEvents` as today. (2) Client: a new `ProofOfEnforcementContext`, sibling to the existing `TokenChainContext`, watches the same tagged event stream (via `tokenChainTraceStore`), matches it against each use case's declared `evidence` in `demo_api_server/config/useCases.js`, and computes one verdict per trigger. Three UI surfaces (inline strip, upgraded Token Chain panel, room-facing banner) all render that one verdict.

**Tech Stack:** Node/Express (`demo_api_server`), React (`demo_api_ui`), Jest (both), no new dependencies.

## Global Constraints

- Emoji rule (repo-wide): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟` are allowed in code/UI text (`CLAUDE.md` §0).
- Minimal diff: name the component, name the element, change only that — no incidental cleanup.
- Every file edit in this repo happens in a git worktree, never the main checkout (already satisfied — this plan executes from `.claude/worktrees/demo-proof-of-enforcement`, branch `worktree-demo-proof-of-enforcement`).
- Scope is the 27 demoable use cases (`maturity: 'works'` or `'flag:*'` in `demo_api_server/config/useCases.js`) — the 7 `needs-build` use cases are untouched.
- Known catalog quirk to preserve, not "fix": several use cases share an identical chip `trigger.text` for the same underlying tool call (e.g. `"show my balance"` is the trigger for `delegated-access-with-proof`, `may-act-gate`, `agent-identity-lifecycle`, `overscoped-agent`, `jit-ephemeral-credentials`, and others) — they are different narrative lenses over the same real trace, not different code paths. Where organic (non-Launcher) resolution must pick one, first-match-in-catalog-array-order wins, mirroring the existing `deriveUseCaseId` precedent (`demo_api_server/config/useCases.js:1085-1091`). The Launcher path is unambiguous by construction (it always supplies an explicit `useCaseId`).

---

### Task 1: Add `useCaseId` to every in-scope chip in every vertical's manifest

**Files:**
- Modify: `demo_api_server/config/verticals/banking/manifest.json`
- Modify: `demo_api_server/config/verticals/healthcare/manifest.json`
- Modify: `demo_api_server/config/verticals/retail/manifest.json`
- Modify: `demo_api_server/config/verticals/government/manifest.json`
- Modify: `demo_api_server/config/verticals/university/manifest.json`
- Modify: `demo_api_server/config/verticals/workforce/manifest.json`
- Modify: `demo_api_server/config/verticals/sporting-goods/manifest.json`
- Modify: `demo_api_server/config/verticals/manufacturing/manifest.json`
- Test: `demo_api_server/src/__tests__/manifestChipUseCaseId.test.js` (new)

**Interfaces:**
- Consumes: nothing (pure data).
- Produces: each `mode: 'both'` chip object in every vertical manifest's `dashboard.chips10` array gains an optional `useCaseId` string field — a slug from `demo_api_server/config/useCases.js`'s `USE_CASES[].useCaseId`. Later tasks (2, 11) read `chip.useCaseId`.

This task is a data-authoring pass, not code — but it must be verifiable, so the test enforces the invariant mechanically instead of relying on manual review.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/manifestChipUseCaseId.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { isValidUseCaseId } = require('../../config/useCases');

const VERTICALS_DIR = path.join(__dirname, '../../config/verticals');
const VERTICALS = ['banking', 'healthcare', 'retail', 'government', 'university', 'workforce', 'sporting-goods', 'manufacturing'];

describe('vertical manifest chips carry a valid useCaseId', () => {
  for (const vertical of VERTICALS) {
    const manifestPath = path.join(VERTICALS_DIR, vertical, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const chips = (manifest.dashboard && manifest.dashboard.chips10) || [];
    const bothChips = chips.filter((c) => c.mode === 'both');

    test(`${vertical}: has at least one 'both' chip`, () => {
      expect(bothChips.length).toBeGreaterThan(0);
    });

    for (const chip of bothChips) {
      test(`${vertical}/${chip.id} ("${chip.label}") declares a valid useCaseId`, () => {
        expect(typeof chip.useCaseId).toBe('string');
        expect(chip.useCaseId.length).toBeGreaterThan(0);
        expect(isValidUseCaseId(chip.useCaseId)).toBe(true);
      });
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/manifestChipUseCaseId.test.js`
Expected: FAIL — every chip test fails with `expect(typeof chip.useCaseId).toBe('string')` receiving `undefined` (no manifest has the field yet).

- [ ] **Step 3: Add `useCaseId` to each `mode: 'both'` chip**

For each vertical manifest, add a `useCaseId` field to every `mode: 'both'` chip object, matching it to the catalog entry whose declared behavior it actually exercises. Use `node -e "console.log(require('./demo_api_server/config/useCases.js').USE_CASES.map(u=>u.useCaseId))"` to see all valid slugs. Worked example for `banking/manifest.json` (apply the same reasoning to the other 7 verticals — read each chip's `message`/`tool`/`hitlTrigger` field and match against the catalog's per-use-case `trigger.text`/`match` fields you already inspected in `useCases.js`):

```json
{ "id": "bk1",  "label": "My accounts",           "message": "show my accounts",                       "mode": "both", "tool": "get_my_accounts",   "useCaseId": "delegated-access-with-proof" }
{ "id": "bk2",  "label": "Check balance",         "message": "what is my balance",                     "mode": "both", "tool": "get_account_balance", "useCaseId": "delegated-access-with-proof" }
{ "id": "bk3",  "label": "Recent transactions",   "message": "recent transactions",                    "mode": "both", "tool": "get_my_transactions", "useCaseId": "delegated-access-with-proof" }
{ "id": "bk4",  "label": "Transfer $100",         "message": "transfer $100 from checking to savings", "mode": "both", "tool": "create_transfer",     "useCaseId": "delegated-access-with-proof" }
{ "id": "bk-hitl", "label": "🔐 Transfer $500",   "message": "transfer $500 from checking to savings", "mode": "both", "hitlTrigger": true, "challenge": "both", "tool": "create_transfer", "useCaseId": "hitl-consent" }
```

(`$500` falls in the `amountMin:500, amountMax:2000` band that `useCases.js` maps to `hitl-consent`; `$100` and the read-only chips fall back to the foundational `delegated-access-with-proof` narrative, matching `deriveUseCaseId`'s existing `create_transfer < 250` and `get_balance` fallbacks.) Continue for every `mode: 'both'` chip in all 8 manifests, checking each amount-banded transfer chip against `useCases.js`'s `match.amountMin`/`amountMax` fields (`authz-denied` for >2000, `step-up-required` for 500–2000 non-HITL, `hitl-consent` for 250–499.99) and each vertical-specific write/read action against the closest matching catalog `trigger.text`/`buyerStory`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/manifestChipUseCaseId.test.js`
Expected: PASS for all 8 verticals.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/verticals/*/manifest.json demo_api_server/src/__tests__/manifestChipUseCaseId.test.js
git commit -m "Add useCaseId to every demoable chip across all vertical manifests"
```

---

### Task 2: Thread chip `useCaseId` from click through to tool-execution requests

**Files:**
- Modify: `demo_api_ui/src/services/demoAgentService.js:157` (`callMcpTool` signature), `:256` (request body)
- Modify: `demo_api_ui/src/components/AIAgent.js:5924-5935` (main send path), `:6755` (`onChipClick` payload)
- Test: `demo_api_ui/src/services/demoAgentService.test.js` (existing — add cases; if it doesn't cover `callMcpTool`'s body, create `demo_api_ui/src/services/__tests__/callMcpTool.useCaseId.test.js`)

**Interfaces:**
- Consumes: chip objects now carry `useCaseId` (Task 1) via whatever fetches `dashboard.chips10` (`fetchAgentTools` in `demoAgentService.js:107`, or the manifest served to the chip-rendering component).
- Produces: `callMcpTool(tool, params, { signal, useCaseId })` — new 4th option; `sendAgentMessage(message, consentId, { ..., useCaseId })` already accepts it (`demoAgentService.js:912`, no change needed there). Both send `useCaseId` in the outgoing POST body when present. Task 3/4 (backend) read it as `req.body.useCaseId`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/services/__tests__/callMcpTool.useCaseId.test.js
import { callMcpTool } from '../demoAgentService';

describe('callMcpTool useCaseId plumbing', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ result: {}, tokenEvents: [] }),
      }),
    );
  });

  test('includes useCaseId in the request body when provided', async () => {
    await callMcpTool('get_balance', {}, { useCaseId: 'delegated-access-with-proof' });
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.useCaseId).toBe('delegated-access-with-proof');
  });

  test('omits useCaseId when not provided (back-compat)', async () => {
    await callMcpTool('get_balance', {});
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.useCaseId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx jest src/services/__tests__/callMcpTool.useCaseId.test.js`
Expected: FAIL — first test fails because `body.useCaseId` is `undefined` (not threaded yet).

- [ ] **Step 3: Update `callMcpTool`'s signature and request body**

In `demo_api_ui/src/services/demoAgentService.js`, change the signature at line 157 and the body construction at line 256:

```js
// line 157 — was: export async function callMcpTool(tool, params = {}, { signal } = {}) {
export async function callMcpTool(tool, params = {}, { signal, useCaseId } = {}) {
```

```js
// line 256 — was: const requestBody = { tool, params: params || {}, flowTraceId };
const requestBody = { tool, params: params || {}, flowTraceId, ...(useCaseId ? { useCaseId } : {}) };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx jest src/services/__tests__/callMcpTool.useCaseId.test.js`
Expected: PASS.

- [ ] **Step 5: Thread `useCaseId` from the chip click into the send call**

In `demo_api_ui/src/components/AIAgent.js`, `onChipClick` (line 6755) currently destructures `{ message, label, requiresLlm, chipId, direct, showcase, caption, stepUpMethod, denyTool }` — add `useCaseId`:

```js
// line 6755 — was: onChipClick={({ message, label, requiresLlm, chipId, direct, showcase, caption, stepUpMethod, denyTool }) => {
onChipClick={({ message, label, requiresLlm, chipId, direct, showcase, caption, stepUpMethod, denyTool, useCaseId: chipUseCaseId }) => {
```

At the main send call (around line 5924-5935), the existing launcher-only resolution:

```js
// was:
const useCaseId = pendingUcIdRef.current ?? undefined;
```

becomes (chip-supplied `useCaseId` wins when present; launcher deep-link is the fallback, since a chip click always has a definite catalog identity while the launcher link is consumed once):

```js
const useCaseId = chipUseCaseId ?? pendingUcIdRef.current ?? undefined;
```

Wire the same `chipUseCaseId` into the `direct`-mode branch immediately below (wherever it calls `callMcpTool(tool, params)` for `direct: true` chips instead of `sendAgentMessage`), passing `{ useCaseId: chipUseCaseId }` as the third argument.

- [ ] **Step 6: Run the AIAgent test suite to confirm no regression**

Run: `cd demo_api_ui && npx jest src/components/__tests__/AIAgent -w 1` (or the closest existing suite covering `onChipClick`)
Expected: PASS, no new failures.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/services/demoAgentService.js demo_api_ui/src/components/AIAgent.js demo_api_ui/src/services/__tests__/callMcpTool.useCaseId.test.js
git commit -m "Thread chip useCaseId through to tool-execution requests"
```

---

### Task 3: Resolve `useCaseId` before the pipeline runs in `bffMcpToolExecutor.js`

**Files:**
- Modify: `demo_api_server/services/bffMcpToolExecutor.js:169-199`
- Test: `demo_api_server/src/__tests__/bffMcpToolExecutorUseCaseId.test.js` (new)

**Interfaces:**
- Consumes: `req.body.useCaseId` (from Task 2), `deriveUseCaseId(name, args)` (existing, `config/useCases.js:1081`), `isValidUseCaseId` (existing).
- Produces: `ctx.useCaseId` — a new field on the pipeline context object, consumed by Task 5 (`mcpToolPipeline.js`).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/bffMcpToolExecutorUseCaseId.test.js
'use strict';

jest.mock('../../services/mcpToolPipeline', () => ({
  runMcpToolPipeline: jest.fn(),
}));

const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');
const { executeBffTool, setPipelineDeps } = require('../../services/bffMcpToolExecutor');

describe('executeBffTool resolves useCaseId before invoking the pipeline', () => {
  beforeEach(() => {
    runMcpToolPipeline.mockReset();
    runMcpToolPipeline.mockResolvedValue({ kind: 'result', httpStatus: 200, tokenEvents: [], body: { result: {} } });
    setPipelineDeps({});
  });

  test('client-supplied useCaseId reaches ctx.useCaseId', async () => {
    const req = { body: { useCaseId: 'delegated-access-with-proof' }, session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'get_balance', args: {}, userId: 'u1', userToken: 't', req, tokenEvents: [], sessionId: 's1' });
    const ctxArg = runMcpToolPipeline.mock.calls[0][0];
    expect(ctxArg.useCaseId).toBe('delegated-access-with-proof');
  });

  test('an invalid client-supplied useCaseId is ignored in favor of the organic derivation', async () => {
    const req = { body: { useCaseId: 'not-a-real-slug' }, session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'get_balance', args: {}, userId: 'u1', userToken: 't', req, tokenEvents: [], sessionId: 's1' });
    const ctxArg = runMcpToolPipeline.mock.calls[0][0];
    expect(ctxArg.useCaseId).toBe('delegated-access-with-proof'); // deriveUseCaseId('get_balance', {}) fallback
  });

  test('no client-supplied id falls back to organic derivation', async () => {
    const req = { body: {}, session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'get_balance', args: {}, userId: 'u1', userToken: 't', req, tokenEvents: [], sessionId: 's1' });
    const ctxArg = runMcpToolPipeline.mock.calls[0][0];
    expect(ctxArg.useCaseId).toBe('delegated-access-with-proof');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/bffMcpToolExecutorUseCaseId.test.js`
Expected: FAIL — `ctxArg.useCaseId` is `undefined` (not set on `ctx` yet).

- [ ] **Step 3: Move the resolution above the pipeline call**

In `demo_api_server/services/bffMcpToolExecutor.js`, the existing post-hoc block (lines 180-198) reads:

```js
  const outcome = await runMcpToolPipeline(ctx);

  // Tag the flow's token events with a useCaseId: launcher-supplied wins (if it is a
  // known catalog slug — arbitrary client strings are rejected), else derive organically
  // from (tool, args). stampUseCaseId never overwrites an existing tag.
  const clientId = req?.body?.useCaseId;
  const useCaseId = (clientId && isValidUseCaseId(clientId))
    ? clientId
    : deriveUseCaseId(name, args);

  // Merge any token events the pipeline produced into the caller's tokenEvents array.
  if (Array.isArray(outcome.tokenEvents)) {
    stampUseCaseId(outcome.tokenEvents, useCaseId);
    for (const ev of outcome.tokenEvents) {
      if (!tokenEvents.includes(ev)) tokenEvents.push(ev);
    }
  } else if (outcome.body && Array.isArray(outcome.body.tokenEvents)) {
    stampUseCaseId(outcome.body.tokenEvents, useCaseId);
    for (const ev of outcome.body.tokenEvents) {
      if (!tokenEvents.includes(ev)) tokenEvents.push(ev);
    }
  }
```

Replace with (resolve `useCaseId` first, add it to `ctx`, keep the existing post-hoc stamping of `tokenEvents` unchanged since Task 5 needs the pipeline to have already run to read `outcome`, but the *authorize* tagging needs it in `ctx` beforehand):

```js
  const clientId = req?.body?.useCaseId;
  const useCaseId = (clientId && isValidUseCaseId(clientId))
    ? clientId
    : deriveUseCaseId(name, args);
  ctx.useCaseId = useCaseId;

  const outcome = await runMcpToolPipeline(ctx);

  // Merge any token events the pipeline produced into the caller's tokenEvents array.
  if (Array.isArray(outcome.tokenEvents)) {
    stampUseCaseId(outcome.tokenEvents, useCaseId);
    for (const ev of outcome.tokenEvents) {
      if (!tokenEvents.includes(ev)) tokenEvents.push(ev);
    }
  } else if (outcome.body && Array.isArray(outcome.body.tokenEvents)) {
    stampUseCaseId(outcome.body.tokenEvents, useCaseId);
    for (const ev of outcome.body.tokenEvents) {
      if (!tokenEvents.includes(ev)) tokenEvents.push(ev);
    }
  }
```

Since `ctx` is built at lines 169-176 before this point, add the field to the object literal instead if that reads more naturally in context — either placement is correct as long as `ctx.useCaseId` is set before `runMcpToolPipeline(ctx)` is called.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/bffMcpToolExecutorUseCaseId.test.js`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Run the existing bffMcpToolExecutor test suite to confirm no regression**

Run: `cd demo_api_server && npx jest services/bffMcpToolExecutor` (or the matching existing test path)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/bffMcpToolExecutor.js demo_api_server/src/__tests__/bffMcpToolExecutorUseCaseId.test.js
git commit -m "Resolve useCaseId before the pipeline runs so authorize tagging can use it"
```

---

### Task 4: Resolve `useCaseId` before the pipeline runs in `server.js`'s `/api/mcp/tool`

**Files:**
- Modify: `demo_api_server/config/useCases.js:32` (new export `resolveChipUseCaseId`, alongside the existing `deriveUseCaseId`)
- Modify: `demo_api_server/server.js:32` (import), `:1780` (ctx literal), `:1902` (pipeline call), `:1926-1931` (existing post-hoc stamp)
- Test: `demo_api_server/src/__tests__/useCaseTagging.test.js` (existing file, already covers `deriveUseCaseId`/`isValidUseCaseId`/`stampUseCaseId` — add cases for the new function there instead of a new file)

**Interfaces:**
- Consumes: `useCaseId` (already parsed at `server.js:1721`), `deriveUseCaseId` (existing, `config/useCases.js:1081`), `isValidUseCaseId` (existing, `config/useCases.js:1070` — note: **not currently imported in `server.js`**, only `deriveUseCaseId` is, per `server.js:32`).
- Produces: `resolveChipUseCaseId(clientId, toolName, args, vertical)` — a new pure, exported function; `ctx.useCaseId` on the chip-path pipeline context, same contract as Task 3.

**Addendum (post-Task-3 decision):** `useCaseId` slugs are shared across verticals by design (e.g. `delegated-access-with-proof` demonstrates the same narrative in every vertical) — no event today tags which vertical produced it, so two verticals firing the same `useCaseId` are indistinguishable downstream. Task 3 was extended to add a parallel `ctx.vertical` field alongside `ctx.useCaseId`, stamped via a new `stampVertical(events, vertical)` in `useCaseTagging.js` (mirrors `stampUseCaseId`'s exact non-destructive behavior — see the updated `demo_api_server/src/__tests__/useCaseTagging.test.js` for its contract). This task must do the same: add `ctx.vertical: req.body?.vertical` (already parsed elsewhere in this handler) alongside `ctx.useCaseId`, and call `stampVertical(outcome.body.tokenEvents, req.body?.vertical)` alongside the existing `stampUseCaseId` call in the post-hoc block.

`server.js`'s inline route handlers are not independently mountable for HTTP-level integration testing the way the smaller router modules are (confirmed: the one existing test that touches `/api/mcp/tool`, `demo_api_server/tests/routes/allChips.pipeline.integration.test.js:79-104`, builds an entirely separate sentinel Express app to test middleware ordering — it does not exercise the real inline handler at all, because that handler closes over dozens of module-level services). So instead of testing the route, extract the one new piece of logic — "resolve which useCaseId applies" — into a pure function in `config/useCases.js` (which already owns `deriveUseCaseId`/`isValidUseCaseId`) and unit-test that directly; `server.js` becomes a thin caller.

- [ ] **Step 1: Write the failing test**

Add to the existing `demo_api_server/src/__tests__/useCaseTagging.test.js` (it already imports `deriveUseCaseId`/`isValidUseCaseId` from `../../config/useCases` at the top — add the new import alongside):

```js
// add to the existing top-of-file import:
const { deriveUseCaseId, isValidUseCaseId, resolveChipUseCaseId } = require('../../config/useCases');

// add a new describe block:
describe('resolveChipUseCaseId (client-supplied wins, else organic derivation)', () => {
  test('a valid client-supplied id wins outright', () => {
    expect(resolveChipUseCaseId('step-up-required', 'get_balance', {}, 'banking')).toBe('step-up-required');
  });

  test('an invalid client-supplied id is ignored in favor of derivation', () => {
    expect(resolveChipUseCaseId('not-a-real-slug', 'get_balance', {}, 'banking')).toBe('delegated-access-with-proof');
  });

  test('no client-supplied id falls back to organic derivation', () => {
    expect(resolveChipUseCaseId('', 'create_transfer', { amount: 600 }, 'banking')).toBe('step-up-required');
  });

  test('empty/undefined client id and an unmapped tool returns undefined', () => {
    expect(resolveChipUseCaseId(undefined, 'list_branches', {}, 'banking')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/useCaseTagging.test.js`
Expected: FAIL — `resolveChipUseCaseId` is not exported yet (`TypeError: resolveChipUseCaseId is not a function`).

- [ ] **Step 3: Add `resolveChipUseCaseId` to `config/useCases.js`**

In `demo_api_server/config/useCases.js`, immediately after the existing `deriveUseCaseId` function (ends at line 1098) and before its `module.exports` line (1100), add:

```js
/**
 * Single entry point for "which useCaseId applies to this call" — client-supplied
 * wins when it's a real catalog slug, else fall back to the organic tool+amount
 * derivation. Centralizes the pattern already duplicated across server.js and
 * bffMcpToolExecutor.js so both call sites resolve identically.
 * @param {string|undefined} clientId
 * @param {string} toolName
 * @param {object} args
 * @param {string} [vertical]
 * @returns {string|undefined}
 */
function resolveChipUseCaseId(clientId, toolName, args, vertical) {
  if (clientId && isValidUseCaseId(clientId)) return clientId;
  return deriveUseCaseId(toolName, args, vertical);
}
```

Update the `module.exports` line (1100) from:

```js
module.exports = { USE_CASES, VERTICALS, getUseCase, resolveUseCase, listUseCases, deriveUseCaseId, isValidUseCaseId };
```

to:

```js
module.exports = { USE_CASES, VERTICALS, getUseCase, resolveUseCase, listUseCases, deriveUseCaseId, isValidUseCaseId, resolveChipUseCaseId };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/useCaseTagging.test.js`
Expected: PASS, all cases including the 4 new ones.

- [ ] **Step 5: Wire it into `server.js`'s `/api/mcp/tool` handler**

`server.js:32` currently imports only `deriveUseCaseId`:

```js
const { deriveUseCaseId } = require('./config/useCases');
```

Change to:

```js
const { deriveUseCaseId, resolveChipUseCaseId } = require('./config/useCases');
```

Before the `const ctx = { tool, params, flowTraceId, startTime, req, deps: {...} };` literal at line 1780, add:

```js
    const _resolvedUseCaseId = resolveChipUseCaseId(useCaseId, tool, params, req.body?.vertical);
```

Add `useCaseId: _resolvedUseCaseId,` as a field in the `ctx` object literal at line 1780-1839 (alongside `tool, params, flowTraceId, startTime, req,`).

Then simplify the existing post-hoc block at lines 1926-1931 from:

```js
    // Stamp useCaseId on chip-path token events (A2.2).
    // Derive from tool name if the caller didn't supply one.
    // stampUseCaseId never overwrites a launcher-supplied tag.
    const _chipUseCaseId = useCaseId || deriveUseCaseId(tool, params, req.body?.vertical);
    if (_chipUseCaseId && outcome.body && Array.isArray(outcome.body.tokenEvents)) {
      stampUseCaseId(outcome.body.tokenEvents, _chipUseCaseId);
    }
```

to reuse the already-resolved value instead of re-deriving it:

```js
    // Stamp useCaseId on chip-path token events (A2.2). stampUseCaseId never
    // overwrites a launcher-supplied tag. Resolved once, above, into ctx.useCaseId.
    if (_resolvedUseCaseId && outcome.body && Array.isArray(outcome.body.tokenEvents)) {
      stampUseCaseId(outcome.body.tokenEvents, _resolvedUseCaseId);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/mcpToolRouteUseCaseId.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full `/api/mcp/tool` route test suite to confirm no regression**

Run: `cd demo_api_server && npx jest -t "mcp/tool"` (or the specific existing suite file covering this route)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/server.js demo_api_server/src/__tests__/mcpToolRouteUseCaseId.test.js
git commit -m "Resolve useCaseId before the /api/mcp/tool pipeline call"
```

---

### Task 5: Tag the authorize decision and pipeline activity-log calls with `useCaseId`

**Files:**
- Modify: `demo_api_server/services/mcpToolPipeline.js:390-406` (block-path `mcpAuthorizeEvaluation`), `:432-448` (permit/skip `appEventLog` calls), `:768-772` (permit-path `out.mcpAuthorizeEvaluation`)
- Test: `demo_api_server/src/__tests__/mcpToolPipelineUseCaseId.test.js` (new, or add to the existing pipeline test file if `mcpToolPipeline.js` already has one — check `demo_api_server/src/__tests__/` or `demo_api_server/tests/services/` first)

**Interfaces:**
- Consumes: `ctx.useCaseId`, `ctx.vertical` (Tasks 3 & 4).
- Produces: `mcpAuthorizeEvaluation.useCaseId` and `mcpAuthorizeEvaluation.vertical` on both the block-path body and the permit-path `out` object; `metadata.useCaseId`/`metadata.vertical` on the pipeline's own `appEventLog` calls. Task 7 (client `ProofOfEnforcementContext`) reads `trace.authorize.useCaseId`/`trace.authorize.vertical`.

**Addendum (post-Task-3 decision):** apply the exact same pattern this task already uses for `useCaseId` to `ctx.vertical` too — every place you add `useCaseId: ctx.useCaseId` below, add `vertical: ctx.vertical` alongside it (both to the `mcpAuthorizeEvaluation` objects and to the `appEventLog` `metadata` objects). This is purely additive, same shape as the `useCaseId` change — do not restructure anything else.

**Scope note:** this task only tags the two `appEventLog` calls that live directly inside `mcpToolPipeline.js` (the ones verified with exact line numbers above). Other activity-log call sites for the `evidence.activity` categories some use cases declare (e.g. `token_exchange` inside `agentMcpTokenService.js`, `hitl`/`ciba` inside the HITL service client) are deeper, separately-owned modules not traced in this plan. Task 11's authenticated replay test is the backstop that will surface, per use case, whether any of those deeper categories are still missing a `useCaseId` tag (it warns rather than hard-fails when a category is absent from the tagged-event set) — treat any such warning as a follow-up, not a blocker for this task.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/mcpToolPipelineUseCaseId.test.js
'use strict';

const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

// Build the minimal ctx.deps double this pipeline needs to reach the PERMIT
// branch quickly. Mirror whatever fixture the existing mcpToolPipeline test
// (if any) already uses for a PERMIT path — check for one before writing this
// from scratch, since runMcpToolPipeline has many required deps.
function permitDeps(overrides = {}) {
  return {
    resolveMcpAccessTokenWithEvents: async () => ({ token: 'tok', tokenEvents: [] }),
    evaluateMcpFirstToolGate: async () => ({ ran: true, permit: true, evaluation: { decisionId: 'd1', decisionContext: {} } }),
    introspectToken: async () => ({ active: true }),
    getSessionAccessToken: () => 'tok',
    callToolLocal: async () => ({ result: 'ok' }),
    mcpCallTool: async () => ({ result: 'ok' }),
    callToolViaGateway: async () => ({ result: 'ok' }),
    http2Bridge: null,
    pingoneAdapter: null,
    buildTokenEvent: () => ({}),
    mcpNoBearerResponse: () => null,
    createPendingDecision: () => null,
    createHitlChallenge: async () => null,
    decodeAgentId: () => undefined,
    recordMcpToolCall: () => {},
    recordComplianceAudit: () => {},
    publishMcpResultToSse: () => {},
    publishTokenEventsToSse: () => {},
    appEventLog: jest.fn(),
    emit: () => {},
    config: { introspectionConfigured: false, useGateway: false, gatewayHttpUrl: null, mcpUrl: 'http://x', useHttp2: false, pingoneAdminEnabled: false, pingoneAdminTools: () => false },
    ...overrides,
  };
}

describe('runMcpToolPipeline tags useCaseId onto the authorize evaluation and activity logs', () => {
  test('permit path stamps mcpAuthorizeEvaluation.useCaseId', async () => {
    const deps = permitDeps();
    const outcome = await runMcpToolPipeline({
      tool: 'get_balance', params: {}, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps, useCaseId: 'delegated-access-with-proof',
    });
    expect(outcome.body.mcpAuthorizeEvaluation.useCaseId).toBe('delegated-access-with-proof');
  });

  test('the gate-permitted appEventLog call carries useCaseId in metadata', async () => {
    const deps = permitDeps();
    await runMcpToolPipeline({
      tool: 'get_balance', params: {}, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps, useCaseId: 'delegated-access-with-proof',
    });
    const call = deps.appEventLog.mock.calls.find((c) => c[3] && c[3].tag === 'authorize/gate-permitted');
    expect(call[3].metadata.useCaseId).toBe('delegated-access-with-proof');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/mcpToolPipelineUseCaseId.test.js`
Expected: FAIL — `mcpAuthorizeEvaluation.useCaseId` and `metadata.useCaseId` are both `undefined`.

(If the permit-path fixture doesn't reach the branch as written — `mcpToolPipeline.js` is a large hand-built state machine — adjust `permitDeps()`'s return shapes to match whatever the real `evaluateMcpFirstToolGate`/`callToolLocal` contract requires by reading the surrounding 100 lines around `mcpToolPipeline.js:300-450` again; the test's *intent* — assert `useCaseId` lands in both places — must not change.)

- [ ] **Step 3: Stamp the block-path `mcpAuthorizeEvaluation`**

In `demo_api_server/services/mcpToolPipeline.js`, the block-path return (around line 401-406) reads:

```js
                mcpAuthorizeEvaluation: {
                    decisionContext: mcpAuthz.block.body.decisionContext,
                    decisionId: mcpAuthz.block.body.decisionId,
                },
```

Change to:

```js
                mcpAuthorizeEvaluation: {
                    decisionContext: mcpAuthz.block.body.decisionContext,
                    decisionId: mcpAuthz.block.body.decisionId,
                    ...(ctx.useCaseId ? { useCaseId: ctx.useCaseId } : {}),
                },
```

- [ ] **Step 4: Stamp the permit-path evaluation and the pipeline's own activity logs**

Around line 432-439 (permit branch):

```js
        if (mcpAuthz.ran && mcpAuthz.permit) {
            deps.emit({
                phase: 'authorize_permitted'
            });
            mcpAuthorizeEvaluationThisRequest = mcpAuthz.evaluation;
            deps.appEventLog('authorize', 'info',
                `Authorize gate permitted — ${tool}`,
                { tag: 'authorize/gate-permitted', metadata: { tool } });
        }
```

Change to:

```js
        if (mcpAuthz.ran && mcpAuthz.permit) {
            deps.emit({
                phase: 'authorize_permitted'
            });
            mcpAuthorizeEvaluationThisRequest = ctx.useCaseId
              ? { ...mcpAuthz.evaluation, useCaseId: ctx.useCaseId }
              : mcpAuthz.evaluation;
            deps.appEventLog('authorize', 'info',
                `Authorize gate permitted — ${tool}`,
                { tag: 'authorize/gate-permitted', metadata: { tool, useCaseId: ctx.useCaseId } });
        }
```

And the skip branch immediately below (around line 441-448):

```js
        if (!mcpAuthz.ran) {
            deps.emit({
                phase: 'authorize_gate_skipped',
                reason: mcpAuthz.reason,
            });
            deps.appEventLog('authorize', 'info',
                `Authorize gate skipped — ${mcpAuthz.reason || 'unknown'}`,
                { tag: 'authorize/gate-skipped', metadata: { reason: mcpAuthz.reason } });
        }
```

Change to:

```js
        if (!mcpAuthz.ran) {
            deps.emit({
                phase: 'authorize_gate_skipped',
                reason: mcpAuthz.reason,
            });
            deps.appEventLog('authorize', 'info',
                `Authorize gate skipped — ${mcpAuthz.reason || 'unknown'}`,
                { tag: 'authorize/gate-skipped', metadata: { reason: mcpAuthz.reason, useCaseId: ctx.useCaseId } });
        }
```

The permit-path final assembly at line 768-772 already does `if (mcpAuthorizeEvaluationThisRequest) { out.mcpAuthorizeEvaluation = mcpAuthorizeEvaluationThisRequest; }` — no change needed there, since Step 4 already put `useCaseId` onto `mcpAuthorizeEvaluationThisRequest` itself.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/mcpToolPipelineUseCaseId.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full mcpToolPipeline test suite to confirm no regression**

Run: `cd demo_api_server && npx jest mcpToolPipeline`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/services/mcpToolPipeline.js demo_api_server/src/__tests__/mcpToolPipelineUseCaseId.test.js
git commit -m "Tag the authorize decision and pipeline activity logs with useCaseId"
```

---

### Task 6: Consolidate `attackSimulatorService`'s private stamping into the shared module

**Files:**
- Modify: `demo_api_server/services/attackSimulatorService.js:1-20` (imports), `:144-147` (delete private fn), all ~13 call sites of `_stampUseCaseId(` (lines ~260, 418, 441, 538, 558, 695, 700, 751, 791, 830, 923, 994, 1062 — re-grep after Step 3 to get the current exact list, since earlier edits in this task may shift line numbers)
- Test: existing `demo_api_server/tests/` suite for `attackSimulatorService` (find it via `grep -rl attackSimulatorService demo_api_server/tests demo_api_server/src/__tests__`) — add one case; do not create a new test file for this, since the service already has coverage of its deny paths.

**Interfaces:**
- Consumes: `stampUseCaseId` from `demo_api_server/services/useCaseTagging.js` (existing, unmodified).
- Produces: no external contract change — `attackSimulatorService`'s public functions still return the same shapes. The only observable difference: `useCaseId` is no longer force-overwritten on events that already carry one (shared module's non-destructive semantics replace the private function's unconditional overwrite) — safe, because every call site pushes freshly-built events via `buildTokenEvent(...)` that never carry a pre-existing `useCaseId`.

**Addendum (post-Task-3 decision, optional):** if this task's exploration confirms attack simulations always pin to a single vertical (the "attacks demonstrate the security infrastructure, banking is the reference" convention already found in `AIAgent.js`'s showcase branches during earlier planning), stamping a companion `vertical` tag here is lower-value than in Tasks 3-5 (there's no cross-vertical ambiguity to resolve if only one vertical is ever involved). If it turns out sims DO vary by active vertical, import and call the new `stampVertical` (added in Task 3) alongside `stampUseCaseId` at the same call sites, passing whatever vertical value the sim already carries. Do not block this task on it either way — note your finding in the report.

- [ ] **Step 1: Write the failing test**

Add to the existing attack-simulator test file (find its exact path first with `grep -rl "attackSimulatorService" demo_api_server/tests demo_api_server/src/__tests__ 2>/dev/null`):

```js
test('uses the shared stampUseCaseId module, not a private duplicate', () => {
  const src = require('fs').readFileSync(
    require.resolve('../../services/attackSimulatorService'), 'utf8',
  );
  expect(src).toMatch(/require\(['"]\.\/useCaseTagging['"]\)/);
  expect(src).not.toMatch(/function _stampUseCaseId/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest -t "shared stampUseCaseId module"`
Expected: FAIL — `attackSimulatorService.js` doesn't yet `require('./useCaseTagging')` and still defines `_stampUseCaseId`.

- [ ] **Step 3: Replace the private function with the shared import**

In `demo_api_server/services/attackSimulatorService.js`, add near the top (alongside its other `require`s):

```js
const { stampUseCaseId } = require('./useCaseTagging');
```

Delete the private function (around line 144-147):

```js
function _stampUseCaseId(events, useCaseId) {
  if (!useCaseId) { return events; }
  events.forEach(function (ev) { ev.useCaseId = useCaseId; });
  return events;
}
```

Then find-and-replace every call site of `_stampUseCaseId(` with `stampUseCaseId(` throughout the file (run `grep -n "_stampUseCaseId(" demo_api_server/services/attackSimulatorService.js` to get the current, authoritative list of lines — expect roughly a dozen, matching the `_denyFromGateway` helper and each sim's individual deny path). `stampUseCaseId` takes the same `(events, useCaseId)` argument order, so no call-site logic changes beyond the function name.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest -t "shared stampUseCaseId module"`
Expected: PASS.

- [ ] **Step 5: Run the full attackSimulatorService test suite to confirm no regression**

Run: `cd demo_api_server && npx jest attackSimulatorService`
Expected: PASS — every existing deny-path assertion on `tokenChainEvents[].useCaseId` still holds, since the shared function's only behavioral difference (non-destructive on pre-tagged events) never triggers here.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/attackSimulatorService.js
git commit -m "Consolidate attackSimulatorService's useCaseId stamping into the shared module"
```

---

### Task 7: Client `ProofOfEnforcementContext` — the shared verdict engine

**Files:**
- Create: `demo_api_ui/src/context/ProofOfEnforcementContext.js`
- Test: `demo_api_ui/src/context/__tests__/ProofOfEnforcementContext.test.js`

**Interfaces:**
- Consumes: `tokenChainTraceStore` (existing, `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js` — `subscribe(fn)`, `getState()` returning `{trace: {tokenEvents, authorize, mcpResult, phases, outcome, ...}, steps}`), and the use-case catalog fetched from `GET /api/use-cases?vertical=X` (existing endpoint, `demo_api_server/routes/useCases.js` — returns each entry's `evidence: {tokenChain, activity}` and `expectedOutcome`, per `resolveUseCase`).
- Produces: `ProofOfEnforcementProvider` (context provider component) and `useProofOfEnforcement()` hook returning `{ verdict, history }`, where `verdict` is `null` (the "untagged" case — no useCaseId could be resolved, so the engine stays silent rather than guess, per the design doc's posture) or `{ useCaseId, title, state: 'verified'|'denied-as-expected'|'mismatch'|'incomplete', matchedSteps: string[], missingSteps: string[], vertical }`. Tasks 8, 9, 10 (the three UI components) all consume `useProofOfEnforcement()`.

**Addendum (post-Task-3 decision):** Tasks 3-5 now stamp a companion `vertical` field onto `tokenEvents`/`trace.authorize` alongside `useCaseId` (`useCaseId` slugs are shared across verticals by design, so `vertical` is what disambiguates which vertical instance of a narrative fired). Add a `verticalOf(trace)` helper (mirroring `firstUseCaseId`) that reads `trace.tokenEvents[].vertical` first, falling back to `trace.authorize.vertical`, and include the result as `verdict.vertical` in `computeVerdict`'s return value. This is purely additive to the verdict shape — no change to the state-computation logic (`matchedSteps`/`missingSteps`/`state`), and no new test cases beyond asserting `verdict.vertical` is populated in the existing "verified" test case.

**Scoping simplification:** the design doc called for scoping verdicts by `flowTraceId` so two rapid, overlapping triggers can't cross-contaminate. `tokenChainTraceStore` (the existing store this engine reads) is already a **singleton, one-trace-at-a-time** store — `beginTrace()` resets it at the start of each new user turn, which is the same reset the existing `TokenChainPanel`/`FloatingTokenChainPanel` already depend on for correctness. This plan piggybacks on that existing reset semantic instead of building a second, parallel `flowTraceId`-keyed store: sequential triggers (the normal case — one chip click resolves before the next fires) are correctly isolated for free. Two genuinely concurrent triggers (a second chip clicked before the first's trace settles) are a narrower, pre-existing risk shared with the current Token Chain panel, not a new one introduced here — out of scope for this plan.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/context/__tests__/ProofOfEnforcementContext.test.js
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { ProofOfEnforcementProvider, useProofOfEnforcement } from '../ProofOfEnforcementContext';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';

const CATALOG = [
  {
    useCaseId: 'delegated-access-with-proof',
    title: 'Delegated access with proof',
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: ['token', 'authorize', 'mcp'] },
  },
  {
    useCaseId: 'authz-denied',
    title: 'Authz denied',
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp'] },
  },
];

function Probe() {
  const { verdict } = useProofOfEnforcement();
  return <div data-testid="verdict">{verdict ? `${verdict.useCaseId}:${verdict.state}` : 'none'}</div>;
}

beforeEach(() => {
  tokenChainTraceStore.reset();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ useCases: CATALOG }) }));
});

test('a fully-matched PERMIT trace verdicts as verified', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    tokenChainTraceStore.ingestTokenEvents([
      { id: 'user-token', useCaseId: 'delegated-access-with-proof' },
      { id: 'token-exchange', useCaseId: 'delegated-access-with-proof' },
    ]);
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd1', decision: 'PERMIT', useCaseId: 'delegated-access-with-proof' });
    tokenChainTraceStore.ingestMcpResult({ toolName: 'get_balance', status: 'success' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('delegated-access-with-proof:verified'));
});

test('a DENY outcome for an attack use case verdicts as denied-as-expected', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd2', decision: 'DENY', useCaseId: 'authz-denied' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('authz-denied:denied-as-expected'));
});

test('an outcome that contradicts expectedOutcome verdicts as mismatch', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd3', decision: 'PERMIT', useCaseId: 'authz-denied' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('authz-denied:mismatch'));
});

test('untagged events produce no verdict', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    tokenChainTraceStore.ingestTokenEvents([{ id: 'user-token' }]);
  });
  expect(getByTestId('verdict').textContent).toBe('none');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx jest src/context/__tests__/ProofOfEnforcementContext.test.js`
Expected: FAIL — module `../ProofOfEnforcementContext` doesn't exist.

- [ ] **Step 3: Implement `ProofOfEnforcementContext`**

```js
// demo_api_ui/src/context/ProofOfEnforcementContext.js
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';

const ProofContext = createContext(null);

function firstUseCaseId(trace) {
  const fromTokens = (trace.tokenEvents || []).find((e) => e && e.useCaseId)?.useCaseId;
  if (fromTokens) return fromTokens;
  if (trace.authorize && trace.authorize.useCaseId) return trace.authorize.useCaseId;
  return null;
}

function decisionOf(trace) {
  // NOTE (discovered during planning, not fixed by this plan): the PERMIT
  // branch of mcpToolAuthorizationService.js populates evaluation.decision
  // (e.g. 'PERMIT'), but its plain-DENY branch (services/mcpToolAuthorizationService.js:442-455)
  // never sets `decision` on the block body at all — only `decisionContext`
  // (a fixed string like 'McpFirstTool') and `decisionId`. So `trace.authorize.decision`
  // is reliably present for PERMIT outcomes but absent for DENY/HITL/STEP_UP block
  // outcomes. Fast-follow fix (out of scope here — touches mcpToolAuthorizationService.js,
  // not just the tagging this plan adds): add `decision: r.decision` to that DENY
  // branch's returned body, mirroring the PERMIT branch, then pass it through
  // mcpToolPipeline.js's block-path mcpAuthorizeEvaluation alongside useCaseId.
  // Until then, `computeVerdict` below treats a missing `decision` as "can't
  // contradict expectedOutcome" (see outcomeMatches) rather than fabricate one —
  // it relies on the evidence-step-completeness check (matchedSteps/missingSteps)
  // as the primary signal, which does not depend on this field.
  const d = trace.authorize && trace.authorize.decision;
  return d || null;
}

/**
 * Compares an in-flight trace against a catalog entry's declared evidence and
 * computes a verdict. Pure function — no side effects, easy to unit-test in
 * isolation from the store/context plumbing above.
 */
export function computeVerdict(trace, catalogEntry) {
  const useCaseId = catalogEntry.useCaseId;
  const evidence = catalogEntry.evidence || { tokenChain: [], activity: [] };
  const seenTokenIds = new Set((trace.tokenEvents || []).map((e) => e.id));
  const matchedSteps = (evidence.tokenChain || []).filter((step) => {
    if (step === 'authorize-decision') return !!trace.authorize;
    if (step === 'tool-dispatched') return !!trace.mcpResult;
    return seenTokenIds.has(step);
  });
  const missingSteps = (evidence.tokenChain || []).filter((s) => !matchedSteps.includes(s));

  if (missingSteps.length > 0) {
    return { useCaseId, title: catalogEntry.title, state: 'incomplete', matchedSteps, missingSteps };
  }

  const decision = decisionOf(trace);
  const expected = catalogEntry.expectedOutcome;
  const outcomeMatches = !expected || !decision || expected === decision;
  return {
    useCaseId,
    title: catalogEntry.title,
    state: outcomeMatches
      ? (expected === 'DENY' || expected === 'STEP_UP' || expected === 'HITL' ? 'denied-as-expected' : 'verified')
      : 'mismatch',
    matchedSteps,
    missingSteps: [],
  };
}

export function ProofOfEnforcementProvider({ children, vertical = 'banking' }) {
  const [catalog, setCatalog] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/use-cases?vertical=${encodeURIComponent(vertical)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { useCases: [] }))
      .then((data) => { if (!cancelled) setCatalog(data.useCases || []); })
      .catch(() => { if (!cancelled) setCatalog([]); });
    return () => { cancelled = true; };
  }, [vertical]);

  const recompute = useCallback((snap) => {
    const trace = snap.trace;
    const useCaseId = firstUseCaseId(trace);
    if (!useCaseId) { setVerdict(null); return; }
    const entry = catalog.find((u) => u.useCaseId === useCaseId);
    if (!entry) { setVerdict(null); return; }
    const next = computeVerdict(trace, entry);
    setVerdict(next);
    setHistory((prev) => [next, ...prev].slice(0, 20));
  }, [catalog]);

  useEffect(() => tokenChainTraceStore.subscribe(recompute), [recompute]);

  const value = useMemo(() => ({ verdict, history }), [verdict, history]);

  return <ProofContext.Provider value={value}>{children}</ProofContext.Provider>;
}

export function useProofOfEnforcement() {
  const ctx = useContext(ProofContext);
  if (!ctx) throw new Error('useProofOfEnforcement must be used within ProofOfEnforcementProvider');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx jest src/context/__tests__/ProofOfEnforcementContext.test.js`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Mount the provider in the app shell**

In `demo_api_ui/src/App.js`, find where `TokenChainProvider` wraps the app tree (`grep -n TokenChainProvider demo_api_ui/src/App.js`) and nest `ProofOfEnforcementProvider` inside it (it depends on `tokenChainTraceStore`, which `TokenChainProvider` also feeds, but the two are independent siblings — order between them doesn't matter, only that both wrap the routes that render chat/dashboard/token-chain UI):

```js
import { ProofOfEnforcementProvider } from './context/ProofOfEnforcementContext';
// ...
<TokenChainProvider activePath={activePath}>
  <ProofOfEnforcementProvider vertical={activeVertical}>
    {/* existing app tree */}
  </ProofOfEnforcementProvider>
</TokenChainProvider>
```

Use whatever variable this file already has for the active vertical (`grep -n "vertical" demo_api_ui/src/App.js` to find it) in place of `activeVertical` above.

- [ ] **Step 6: Run the full demo_api_ui test suite to confirm no regression**

Run: `cd demo_api_ui && npx jest`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/context/ProofOfEnforcementContext.js demo_api_ui/src/context/__tests__/ProofOfEnforcementContext.test.js demo_api_ui/src/App.js
git commit -m "Add ProofOfEnforcementContext: the shared verdict engine"
```

---

### Task 8: Component A — inline proof strip under the chat bubble

**Files:**
- Create: `demo_api_ui/src/components/ProofStrip.jsx`
- Create: `demo_api_ui/src/components/ProofStrip.css`
- Modify: `demo_api_ui/src/components/AIAgent.js` (message-rendering loop — find via `grep -n "addMessage\|messages.map" demo_api_ui/src/components/AIAgent.js`)
- Test: `demo_api_ui/src/components/__tests__/ProofStrip.test.jsx`

**Interfaces:**
- Consumes: `useProofOfEnforcement()` (Task 7).
- Produces: `<ProofStrip />` — a self-contained component with no props (reads the shared verdict directly), rendered once per assistant message in `AIAgent.js`'s message list, immediately below the chat bubble content.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/ProofStrip.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import ProofStrip from '../ProofStrip';
import * as proofCtx from '../../context/ProofOfEnforcementContext';

test('renders nothing when there is no verdict', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({ verdict: null, history: [] });
  const { container } = render(<ProofStrip />);
  expect(container).toBeEmptyDOMElement();
});

test('renders the checked-off chain for a verified verdict', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: {
      useCaseId: 'step-up-required', title: 'Step-up required', state: 'verified',
      matchedSteps: ['user-token', 'authorize-decision', 'tool-dispatched'], missingSteps: [],
    },
    history: [],
  });
  render(<ProofStrip />);
  expect(screen.getByText(/Step-up required/)).toBeInTheDocument();
  expect(screen.getByText(/Verified/)).toBeInTheDocument();
});

test('renders a mismatch state distinctly', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: { useCaseId: 'authz-denied', title: 'Authz denied', state: 'mismatch', matchedSteps: ['authorize-decision'], missingSteps: [] },
    history: [],
  });
  render(<ProofStrip />);
  expect(screen.getByTestId('proof-strip')).toHaveClass('proof-strip--mismatch');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx jest src/components/__tests__/ProofStrip.test.jsx`
Expected: FAIL — `../ProofStrip` doesn't exist.

- [ ] **Step 3: Implement `ProofStrip`**

```jsx
// demo_api_ui/src/components/ProofStrip.jsx
import React from 'react';
import { useProofOfEnforcement } from '../context/ProofOfEnforcementContext';
import './ProofStrip.css';

const STATE_LABEL = {
  verified: 'Verified',
  'denied-as-expected': 'Verified (denied as expected)',
  mismatch: 'Mismatch',
  incomplete: 'Incomplete',
};

export default function ProofStrip() {
  const { verdict } = useProofOfEnforcement();
  if (!verdict) return null;

  const icon = verdict.state === 'verified' || verdict.state === 'denied-as-expected' ? '✅' : '⚠️';

  return (
    <div className={`proof-strip proof-strip--${verdict.state}`} data-testid="proof-strip">
      <div className="proof-strip-head">
        <span>{verdict.title} — {STATE_LABEL[verdict.state] || verdict.state}</span>
        <span>{icon}</span>
      </div>
      <div className="proof-strip-chain">
        {verdict.matchedSteps.map((step, i) => (
          <React.Fragment key={step}>
            <span className="proof-strip-step">{step}</span>
            {i < verdict.matchedSteps.length - 1 && <span className="proof-strip-arrow">→</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
```

```css
/* demo_api_ui/src/components/ProofStrip.css */
.proof-strip {
  margin-top: 8px;
  border-radius: 9px;
  padding: 8px 11px;
  font-size: 12.5px;
  border: 1px solid #16a34a;
  background: #e9f7ef;
}
.proof-strip--mismatch, .proof-strip--incomplete {
  border-color: #d97706;
  background: #fdf1e0;
}
.proof-strip-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 650;
  margin-bottom: 6px;
}
.proof-strip-chain {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11.5px;
  color: #57667a;
}
.proof-strip-step { color: #17212e; }
.proof-strip-arrow { color: #8695a8; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx jest src/components/__tests__/ProofStrip.test.jsx`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Render it under assistant messages in `AIAgent.js`**

Find the message-rendering loop (`grep -n "messages.map\|role === .assistant" demo_api_ui/src/components/AIAgent.js`) and render `<ProofStrip />` once, immediately after the last assistant message's bubble content (not per-message — the verdict reflects only the latest trigger). Import at the top: `import ProofStrip from './ProofStrip';`. Place it directly below wherever the last message's content is rendered, guarded to only the final assistant message so it doesn't repeat on every historical message re-render.

- [ ] **Step 6: Run the AIAgent test suite to confirm no regression**

Run: `cd demo_api_ui && npx jest src/components/__tests__/AIAgent`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/ProofStrip.jsx demo_api_ui/src/components/ProofStrip.css demo_api_ui/src/components/__tests__/ProofStrip.test.jsx demo_api_ui/src/components/AIAgent.js
git commit -m "Add Component A: inline proof strip under the chat bubble"
```

---

### Task 9: Component B — upgrade the Token Chain panel with a use-case-aware checklist

**Files:**
- Modify: `demo_api_ui/src/components/education/TokenChainPanel.js` (add a new accordion card, following the existing `token-chain-card` pattern already used for "MCP Delegation Trail")
- Modify: `demo_api_ui/src/components/education/TokenChainPanel.css` (reuse existing classes; add only what's new)
- Test: `demo_api_ui/src/components/education/__tests__/TokenChainPanel.test.js` (existing — add cases)

**Interfaces:**
- Consumes: `useProofOfEnforcement()` (Task 7).
- Produces: no new exports — this is a visual addition to the existing default-exported `TokenChainPanel` component.

- [ ] **Step 1: Write the failing test**

Add to the existing `TokenChainPanel` test file (find it via `grep -rl "TokenChainPanel" demo_api_ui/src/components/education/__tests__ demo_api_ui/src/components/__tests__ 2>/dev/null`; if none exists yet, create `demo_api_ui/src/components/education/__tests__/TokenChainPanel.test.js` following the same render/provider-wrapping pattern the sibling `education` tests already use):

```jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import TokenChainPanel from '../TokenChainPanel';
import * as proofCtx from '../../../context/ProofOfEnforcementContext';

jest.mock('../../../hooks/useAgentCCTokenPrefetch', () => ({ useAgentCCTokenPrefetch: () => {} }));

test('shows a use-case checklist card when a verdict is active', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: {
      useCaseId: 'step-up-required', title: 'Step-up required', state: 'verified',
      matchedSteps: ['user-token', 'authorize-decision', 'tool-dispatched'], missingSteps: [],
    },
    history: [],
  });
  render(<TokenChainPanel />);
  expect(screen.getByText(/Step-up required/)).toBeInTheDocument();
  expect(screen.getByText(/3 \/ 3 steps matched/)).toBeInTheDocument();
});

test('renders nothing extra when there is no active verdict', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({ verdict: null, history: [] });
  render(<TokenChainPanel />);
  expect(screen.queryByText(/steps matched/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx jest src/components/education/__tests__/TokenChainPanel.test.js`
Expected: FAIL — no checklist card exists yet.

- [ ] **Step 3: Add the checklist card**

In `demo_api_ui/src/components/education/TokenChainPanel.js`, import the hook:

```js
import { useProofOfEnforcement } from '../../context/ProofOfEnforcementContext';
```

Inside the component body (after the existing `const liveEvents = tokenChain?.events || [];` line), add:

```js
  const { verdict } = useProofOfEnforcement();
```

Insert a new accordion card, following the exact same structural pattern as the existing "MCP Delegation Trail" card (`token-chain-card` / `token-chain-card-head` / `token-chain-card-title`), placed directly above it:

```jsx
      {verdict && (
        <div className="token-chain-card">
          <div className="token-chain-card-head" style={{ cursor: 'default' }}>
            <div>
              <div className="token-chain-card-title">
                {verdict.title} <span className="token-chain-badge">{verdict.useCaseId.toUpperCase()}</span>
              </div>
              <div className="token-chain-card-sub">
                {verdict.matchedSteps.length} / {verdict.matchedSteps.length + verdict.missingSteps.length} steps matched
                {(verdict.state === 'verified' || verdict.state === 'denied-as-expected') ? ' ✅' : ' ⚠️'}
              </div>
            </div>
          </div>
          <ul className="token-chain-list">
            {verdict.matchedSteps.map((step) => (
              <li key={step} className="token-chain-item">
                <div className="token-chain-row">
                  <span className="token-chain-label">✅ {step}</span>
                </div>
              </li>
            ))}
            {verdict.missingSteps.map((step) => (
              <li key={step} className="token-chain-item">
                <div className="token-chain-row">
                  <span className="token-chain-label">⚠️ {step} (not yet observed)</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
```

Place this JSX block immediately before the existing `{/* MCP Delegation Trail */}` comment's `<div className="token-chain-card">` block, inside the component's returned `<div className="token-chain-root">`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx jest src/components/education/__tests__/TokenChainPanel.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full education-components test suite to confirm no regression**

Run: `cd demo_api_ui && npx jest src/components/education`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/education/TokenChainPanel.js demo_api_ui/src/components/education/__tests__/TokenChainPanel.test.js
git commit -m "Add Component B: use-case checklist card in the Token Chain panel"
```

---

### Task 10: Component C — room-facing "Verified" banner

**Files:**
- Create: `demo_api_ui/src/components/VerifiedBanner.jsx`
- Create: `demo_api_ui/src/components/VerifiedBanner.css`
- Modify: `demo_api_ui/src/App.js` (mount once, near where `FloatingTokenChainPanel` is mounted)
- Test: `demo_api_ui/src/components/__tests__/VerifiedBanner.test.jsx`

**Interfaces:**
- Consumes: `useProofOfEnforcement()` (Task 7).
- Produces: `<VerifiedBanner />` — self-contained, no props. Portal-rendered, auto-collapses after 6s, click-to-expand opens the existing `FloatingTokenChainPanel` (Task 9's content) by dispatching the same open mechanism that panel already uses (`grep -n "FloatingTokenChainPanel\|setShowTokenChain\|isOpen" demo_api_ui/src/App.js` to find its existing open/close state setter and reuse it — do not invent a second one).

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/VerifiedBanner.test.jsx
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import VerifiedBanner from '../VerifiedBanner';
import * as proofCtx from '../../context/ProofOfEnforcementContext';

jest.useFakeTimers();

test('renders nothing when there is no verdict', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({ verdict: null, history: [] });
  const { container } = render(<VerifiedBanner onExpand={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

test('shows the full banner then collapses to a pill after 6s', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: { useCaseId: 'step-up-required', title: 'Step-up required', state: 'verified', matchedSteps: ['authorize-decision'], missingSteps: [] },
    history: [],
  });
  render(<VerifiedBanner onExpand={() => {}} />);
  expect(screen.getByText(/VERIFIED/)).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(6100); });
  expect(screen.queryByText(/VERIFIED/)).not.toBeInTheDocument();
  expect(screen.getByTestId('verified-pill')).toBeInTheDocument();
});

test('a mismatch verdict renders in warning styling, not the success treatment', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: { useCaseId: 'authz-denied', title: 'Authz denied', state: 'mismatch', matchedSteps: [], missingSteps: [] },
    history: [],
  });
  render(<VerifiedBanner onExpand={() => {}} />);
  expect(screen.getByTestId('verified-banner')).toHaveClass('verified-banner--mismatch');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx jest src/components/__tests__/VerifiedBanner.test.jsx`
Expected: FAIL — `../VerifiedBanner` doesn't exist.

- [ ] **Step 3: Implement `VerifiedBanner`**

```jsx
// demo_api_ui/src/components/VerifiedBanner.jsx
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProofOfEnforcement } from '../context/ProofOfEnforcementContext';
import './VerifiedBanner.css';

const GOOD_STATES = new Set(['verified', 'denied-as-expected']);

export default function VerifiedBanner({ onExpand }) {
  const { verdict } = useProofOfEnforcement();
  const [collapsed, setCollapsed] = useState(false);
  const timerRef = useRef(null);
  const lastKeyRef = useRef(null);

  useEffect(() => {
    if (!verdict) return;
    const key = `${verdict.useCaseId}:${verdict.state}:${verdict.matchedSteps.join(',')}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    setCollapsed(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCollapsed(true), 6000);
    return () => clearTimeout(timerRef.current);
  }, [verdict]);

  if (!verdict) return null;
  const good = GOOD_STATES.has(verdict.state);
  const modifier = good ? '' : ' verified-banner--mismatch';

  if (collapsed) {
    return createPortal(
      <button
        type="button"
        data-testid="verified-pill"
        className={`verified-pill${modifier}`}
        onClick={() => { setCollapsed(false); onExpand && onExpand(); }}
      >
        {good ? '✅' : '⚠️'} {verdict.useCaseId} {good ? 'verified' : verdict.state}
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div data-testid="verified-banner" className={`verified-banner${modifier}`} role="status">
      <div className="verified-banner-check">{good ? '✓' : '!'}</div>
      <div>
        <div className="verified-banner-title">
          {verdict.useCaseId.toUpperCase()} — {verdict.title} — {good ? 'VERIFIED' : verdict.state.toUpperCase()}
        </div>
        <div className="verified-banner-detail">{verdict.matchedSteps.join(' → ') || 'no evidence yet'}</div>
      </div>
      <button type="button" className="verified-banner-link" onClick={onExpand}>View trace ▸</button>
    </div>,
    document.body,
  );
}
```

```css
/* demo_api_ui/src/components/VerifiedBanner.css */
.verified-banner {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9990;
  background: #fff;
  border: 1.5px solid #16a34a;
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 12px 28px -10px rgba(22, 163, 74, 0.35);
  font-size: 13.5px;
  max-width: 92vw;
}
.verified-banner--mismatch { border-color: #d97706; box-shadow: 0 12px 28px -10px rgba(217, 119, 6, 0.35); }
.verified-banner-check {
  width: 26px; height: 26px; border-radius: 50%;
  background: #16a34a; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; flex: none;
}
.verified-banner--mismatch .verified-banner-check { background: #d97706; }
.verified-banner-title { font-weight: 700; color: #16a34a; }
.verified-banner--mismatch .verified-banner-title { color: #d97706; }
.verified-banner-detail { color: #57667a; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; }
.verified-banner-link { margin-left: auto; font-weight: 650; color: #2563eb; background: none; border: none; cursor: pointer; white-space: nowrap; }
.verified-pill {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 9990;
  background: #e9f7ef;
  color: #16a34a;
  border: 1px solid #16a34a;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  cursor: pointer;
}
.verified-pill--mismatch { background: #fdf1e0; color: #d97706; border-color: #d97706; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx jest src/components/__tests__/VerifiedBanner.test.jsx`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Mount it in `App.js`**

Find where `FloatingTokenChainPanel` is rendered and its open-state setter (`grep -n "FloatingTokenChainPanel\|showTokenChain\|setShowTokenChain" demo_api_ui/src/App.js`). Import and render `VerifiedBanner` alongside it, wiring `onExpand` to that same setter:

```js
import VerifiedBanner from './components/VerifiedBanner';
// ...
<VerifiedBanner onExpand={() => setShowTokenChain(true)} />
```

(Substitute the actual state setter name found by the grep above — do not introduce a new one.)

- [ ] **Step 6: Run the full demo_api_ui test suite to confirm no regression**

Run: `cd demo_api_ui && npx jest`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/VerifiedBanner.jsx demo_api_ui/src/components/VerifiedBanner.css demo_api_ui/src/components/__tests__/VerifiedBanner.test.jsx demo_api_ui/src/App.js
git commit -m "Add Component C: room-facing Verified banner"
```

---

### Task 11: Assert verdicts in the authenticated all-chips pipeline test

**Files:**
- Modify: `demo_api_server/tests/real/shared/all-chips-pipeline.test.js:123-186` (the per-chip `it(...)` block)

**Interfaces:**
- Consumes: `chip.useCaseId` (Task 1), `GET /api/admin/app-events` (existing, already polled at line 172-181), `GET /api/use-cases/:id` (existing, `demo_api_server/routes/useCases.js`) for `expectedOutcome`.
- Produces: no new exports — this is a test-only change. Deviates from the original design doc's plan to extend `scripts/preflight-demo.sh` directly: that script's chip-replay section (its section 5) only resolves intent anonymously via `/api/demo-agent/nl` and never executes a tool, so it has no authorize/activity trace to assert against. The authenticated `--deep` path (`scripts/run-real-tests.sh shared`, which runs this exact file) is where a real trace exists — asserting here is both correct and reached by preflight's existing `--deep` flag with zero preflight.sh changes needed.

**Addendum (post-Task-3 decision):** since `useCaseId` slugs are shared across verticals (Tasks 3-5 now also stamp a companion `vertical` field), this test's assertion must filter `app-events` by BOTH `useCaseId` AND `vertical` matching the current `vertical` loop variable — not `useCaseId` alone. Without this, a chip in one vertical could pass its assertion using events actually produced by a different vertical's chip sharing the same `useCaseId` in an adjacent test (the suite runs verticals sequentially, so this is a real, not theoretical, false-pass risk once vertical tagging exists). Filter as `events.filter(e => (e.useCaseId || e.metadata?.useCaseId) === chip.useCaseId && (e.vertical || e.metadata?.vertical) === vertical)`.

- [ ] **Step 1: Write the failing assertion**

In `demo_api_server/tests/real/shared/all-chips-pipeline.test.js`, inside the `if (depth === 'mcp-pipeline')` block (lines 160-182), extend the existing admin app-events check (lines 172-181) from a loose category-presence warning into a hard assertion when the chip declares a `useCaseId`:

```js
          if (depth === 'mcp-pipeline') {
            if (bearer) {
              const inv = await client.post('/api/agent/invoke', { prompt: chip.message, forceHeuristic: true, useCaseId: chip.useCaseId }, {
                headers: { Authorization: `Bearer ${bearer}` },
              });
              expect([200, 428, 403]).toContain(inv.status);
            }
            if (adminClient) {
              const ev = await adminClient.get(`/api/admin/app-events?since=${encodeURIComponent(since)}&limit=50`);
              if (ev.status === 200) {
                const events = ev.data.events || [];
                const cats = new Set(events.map((e) => e.category));
                if (!cats.has('agent') && !cats.has('mcp') && !cats.has('token_exchange')) {
                  console.warn(`[all-chips-pipeline] ${vertical}/${chip.label}: no pipeline events in window — async flush may be slow`);
                }
                if (chip.useCaseId) {
                  const taggedEvents = events.filter((e) =>
                    (e.useCaseId || (e.metadata && e.metadata.useCaseId)) === chip.useCaseId
                    && (e.vertical || (e.metadata && e.metadata.vertical)) === vertical);
                  if (taggedEvents.length > 0) {
                    // Belt-and-suspenders: if any event for this useCaseId made it
                    // into the window, at least one must be an authorize category —
                    // proof the decision itself (not just token exchange) was tagged.
                    expect(taggedEvents.some((e) => e.category === 'authorize')).toBe(true);
                  } else {
                    console.warn(`[all-chips-pipeline] ${vertical}/${chip.label}: no ${chip.useCaseId}-tagged events in window — async flush may be slow`);
                  }
                }
              }
            }
          }
```

- [ ] **Step 2: Run the suite to verify the new assertion exercises real data**

Run: `cd demo_api_server && ./scripts/run-real-tests.sh shared 2>&1 | tail -60`
Expected: this requires a running stack with PingOne creds configured (per the file's existing preconditions) — if creds aren't available in this environment, this step is a manual/CI-only verification; note in the PR description that it needs to run once against a live stack before merge. If the stack is available, expect PASS with no new failures; any `console.warn` about missing tagged events (not a hard failure) should be investigated — it means Task 3/4/5's `useCaseId` isn't reaching the activity log for that specific chip, likely because Task 1 mis-mapped that chip's `useCaseId`.

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/tests/real/shared/all-chips-pipeline.test.js
git commit -m "Assert useCaseId-tagged authorize events in the authenticated all-chips replay"
```

---

## Post-plan verification checklist

- [ ] `cd demo_api_server && npx jest` — full backend suite green.
- [ ] `cd demo_api_ui && npx jest` — full frontend suite green.
- [ ] Manual: start the stack (`./run.sh`), open the banking dashboard, click a read chip (e.g. "Check balance") and a write chip crossing the step-up band (e.g. "Transfer $600") — confirm the inline strip (A), the Token Chain panel's new checklist card (B), and the Verified banner (C) all appear and agree with each other.
- [ ] Manual: repeat once with `LLM_BACKEND` pointed at llama.cpp/another configured LLM mode (not just Heuristics) — confirm the same three surfaces fire identically, proving the mode-agnostic claim.
- [ ] Manual: trigger an attack simulation (e.g. UC10 cross-owner-account) from the Use-Case Launcher — confirm the banner shows `denied-as-expected`, not a false "mismatch".
