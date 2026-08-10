# PingOne Protect Agent-Dispatch Risk Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a PingOne Protect risk evaluation into the point where a human's browser request triggers an AI agent action, so the demo can show Coupa's "detect an agent acting outside approved bounds" and "agentic AI / bot detection" asks running against a live Protect risk evaluation — not a diagram.

**Architecture:** The Protect Signals SDK runs client-side in `demo_api_ui` and attaches a device signal to the `/api/agent/invoke` request. A new `demo_api_server/services/protectRiskService.js` calls PingOne's risk-evaluations API with that signal, and a new middleware in `agentInvokeRoute.js` reads the recommendation (`ALLOW`/`CHALLENGE`/`BLOCK`) and gates dispatch accordingly, feeding the result into the existing ProofStrip/audit trail. Gated behind a new feature flag so it defaults off and never breaks the current demo path.

**Tech Stack:** Express (BFF), React 19 + Vite (UI), PingOne Protect risk-evaluations Management API, PingOne Signals SDK (`@forgerock/protect-js` / PingOne-hosted signals script — confirm exact package name against the entitlement check below before Task 2).

## Global Constraints

- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` (REGRESSION_PLAN.md §0).
- Auth/session/UI files are protected — invoke `.claude/skills/regression-guard/` before touching `demo_api_ui/src` or `agentInvokeRoute.js`.
- New behavior must be feature-flagged OFF by default (repo convention — every flag in `demo_api_server/routes/featureFlags.js` follows this).
- Server: CommonJS + Express + jest + supertest. UI: React 19 + Vite + vitest (not jest) + Playwright.
- Use Super Sports as the default vertical for manual validation.

---

## Entitlement check — do this before Task 1

This plan assumes PingOne Protect risk evaluation is licensed on environment `01d89b06-66d5-430e-9f28-65636843788b` (the demo tenant). Unlike the AI_AGENT application type (confirmed **absent** via a live probe recorded in `docs/superpowers/plans/2026-06-12-agent-builder-page.md:15`), **Protect entitlement has not been probed on this tenant.**

Before writing any code:

1. Authorize the `pingone` MCP server for this session (`/mcp` in an interactive session), or check the PingOne admin console directly under **Threat Protection → Risk Policies**.
2. Confirm a risk policy exists, or that `POST /environments/{envId}/riskPolicies` / `POST /environments/{envId}/riskEvaluations` returns something other than a licensing error.
3. If Protect is **not** licensed on this tenant: stop here. Do not build a simulated/mocked version under the "real integration" instruction the user gave — flag it back and ask whether to (a) request trial entitlement, or (b) fall back to a mocked proof point as a separate, explicitly-labeled decision.
4. If Protect **is** licensed: note the risk policy ID and continue to Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `demo_api_server/routes/featureFlags.js` | Add `ff_protect_agent_dispatch` flag definition |
| `demo_api_server/services/protectRiskService.js` (new) | Calls PingOne Protect risk-evaluations API, returns `{ recommendation, riskLevel, evaluationId }` |
| `demo_api_server/src/__tests__/protectRiskService.test.js` (new) | Unit tests for the service, PingOne API mocked |
| `demo_api_server/middleware/protectRiskGate.js` (new) | Express middleware: calls the service, attaches `req.protectRisk`, blocks/challenges per recommendation when the flag is ON |
| `demo_api_server/src/__tests__/protectRiskGate.test.js` (new) | Unit tests for the middleware, service mocked |
| `demo_api_server/routes/agentInvokeRoute.js:139` | Insert `protectRiskGate` into the middleware chain after `agentGuestSessionMiddleware`, before `express.json()` |
| `demo_api_ui/src/services/protectSignalService.js` (new) | Loads the Signals SDK, collects a device signal, attaches it to the invoke request payload |
| `demo_api_ui/src/services/__tests__/protectSignalService.test.js` (new) | vitest unit test for payload shape |
| `demo_api_ui/src/components/ProofStrip*.jsx` (existing — locate via grep for `ProofStrip` before editing) | Render the Protect recommendation as a new evidence row |

---

### Task 1: Feature flag definition

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js` (append to the "Agent Security" category block, near `ff_require_act_for_agent_tools`)
- Test: `demo_api_server/src/__tests__/featureFlags.test.js` (extend if it exists; check with `find demo_api_server/src/__tests__ -iname "featureFlags*"` first — if none exists, add assertions inline into whichever test currently asserts the flag list shape)

**Interfaces:**
- Produces: flag id `ff_protect_agent_dispatch`, `type: 'boolean'`, `defaultValue: false` — consumed by `protectRiskGate.js` in Task 3.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/featureFlags.test.js (add this test)
const { FEATURE_FLAGS } = require('../../routes/featureFlags');

test('ff_protect_agent_dispatch flag is registered and defaults off', () => {
  const flag = FEATURE_FLAGS.find((f) => f.id === 'ff_protect_agent_dispatch');
  expect(flag).toBeDefined();
  expect(flag.type).toBe('boolean');
  expect(flag.defaultValue).toBe(false);
  expect(flag.category).toBe('Agent Security');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest featureFlags -t "ff_protect_agent_dispatch"`
Expected: FAIL — flag not found (`flag` is `undefined`).

- [ ] **Step 3: Add the flag definition**

```javascript
// demo_api_server/routes/featureFlags.js — insert after the ff_require_act_for_agent_tools block
{
  id:           'ff_protect_agent_dispatch',
  name:         'PingOne Protect — agent dispatch risk evaluation',
  category:     'Agent Security',
  description:
    'When **ON**, every /api/agent/invoke request is risk-scored by PingOne Protect using a ' +
    'client-collected device signal before the agent dispatches. BLOCK denies the request; ' +
    'CHALLENGE is recorded but does not block (no step-up UI wired yet — see plan follow-up). ' +
    'Requires Protect risk-evaluation entitlement on the tenant.',
  impact:
    'OFF (default) = no risk call, current behavior unchanged. ON = adds one Protect API call ' +
    'per dispatch; BLOCK recommendation returns 403 before the agent runs.',
  type:         'boolean',
  defaultValue: false,
  warnIfEnabled: true,
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest featureFlags -t "ff_protect_agent_dispatch"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/src/__tests__/featureFlags.test.js
git commit -m "feat(protect): register ff_protect_agent_dispatch flag"
```

---

### Task 2: `protectRiskService` — call PingOne Protect risk-evaluations API

**Files:**
- Create: `demo_api_server/services/protectRiskService.js`
- Test: `demo_api_server/src/__tests__/protectRiskService.test.js`

**Interfaces:**
- Consumes: PingOne Management API base URL + worker token from `configStore.js` (same pattern as `pingOneClientService.js` — read that file first to match its auth-header helper exactly).
- Produces: `async function evaluateAgentDispatchRisk({ signal, userId, agentId }) -> { recommendation: 'ALLOW'|'CHALLENGE'|'BLOCK', riskLevel: string, evaluationId: string }` — consumed by `protectRiskGate.js` in Task 3.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/protectRiskService.test.js
jest.mock('axios');
const axios = require('axios');
const { evaluateAgentDispatchRisk } = require('../../services/protectRiskService');

test('returns ALLOW recommendation on a low-risk evaluation', async () => {
  axios.post.mockResolvedValueOnce({
    data: {
      id: 'eval-123',
      result: { level: 'LOW', recommendation: 'ALLOW' },
    },
  });

  const result = await evaluateAgentDispatchRisk({
    signal: 'mock-device-signal',
    userId: 'user-1',
    agentId: 'agent-generalist',
  });

  expect(result).toEqual({
    recommendation: 'ALLOW',
    riskLevel: 'LOW',
    evaluationId: 'eval-123',
  });
});

test('propagates BLOCK recommendation on a high-risk evaluation', async () => {
  axios.post.mockResolvedValueOnce({
    data: {
      id: 'eval-456',
      result: { level: 'HIGH', recommendation: 'BLOCK' },
    },
  });

  const result = await evaluateAgentDispatchRisk({
    signal: 'mock-device-signal',
    userId: 'user-1',
    agentId: 'agent-generalist',
  });

  expect(result.recommendation).toBe('BLOCK');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest protectRiskService`
Expected: FAIL with "Cannot find module '../../services/protectRiskService'".

- [ ] **Step 3: Write the implementation**

```javascript
// demo_api_server/services/protectRiskService.js
const axios = require('axios');
const configStore = require('./configStore');
const { getWorkerAccessToken } = require('./pingOneClientService');

async function evaluateAgentDispatchRisk({ signal, userId, agentId }) {
  const envId = configStore.get('PINGONE_ENVIRONMENT_ID');
  const apiBase = configStore.get('PINGONE_API_BASE_URL') || 'https://api.pingone.com/v1';
  const token = await getWorkerAccessToken();

  const res = await axios.post(
    `${apiBase}/environments/${envId}/riskEvaluations`,
    {
      event: {
        origin: 'AGENT_DISPATCH',
        user: { id: userId },
        agent: { id: agentId },
      },
      signals: { device: signal },
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return {
    recommendation: res.data.result.recommendation,
    riskLevel: res.data.result.level,
    evaluationId: res.data.id,
  };
}

module.exports = { evaluateAgentDispatchRisk };
```

Adjust the request body shape to match the actual PingOne Protect risk-evaluations API contract confirmed during the entitlement check — the shape above is illustrative; verify field names (`event.origin`, `signals.device`) against a real `POST` before merging.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest protectRiskService`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/protectRiskService.js demo_api_server/src/__tests__/protectRiskService.test.js
git commit -m "feat(protect): add protectRiskService for agent-dispatch risk evaluation"
```

---

### Task 3: `protectRiskGate` middleware

**Files:**
- Create: `demo_api_server/middleware/protectRiskGate.js`
- Test: `demo_api_server/src/__tests__/protectRiskGate.test.js`
- Modify: `demo_api_server/routes/agentInvokeRoute.js:139` — insert `protectRiskGate` into the chain

**Interfaces:**
- Consumes: `evaluateAgentDispatchRisk` from Task 2; `configStore.isFlagEnabled('ff_protect_agent_dispatch')` (match the exact helper name used elsewhere in this file — grep `configStore.isFlagEnabled\|configStore.getFlag` in `agentInvokeRoute.js` first and use whichever is the real one).
- Produces: middleware `(req, res, next)` that sets `req.protectRisk = { recommendation, riskLevel, evaluationId }` when the flag is ON, or skips straight to `next()` when OFF. On `BLOCK`, responds `403 { error: 'agent_dispatch_blocked', riskLevel }` instead of calling `next()`.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/protectRiskGate.test.js
jest.mock('../../services/protectRiskService');
jest.mock('../../services/configStore');
const { evaluateAgentDispatchRisk } = require('../../services/protectRiskService');
const configStore = require('../../services/configStore');
const protectRiskGate = require('../../middleware/protectRiskGate');

function mockReqRes(body = {}) {
  const req = { body, user: { sub: 'user-1' } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

test('flag OFF: skips risk evaluation entirely', async () => {
  configStore.isFlagEnabled.mockReturnValue(false);
  const { req, res, next } = mockReqRes();

  await protectRiskGate(req, res, next);

  expect(evaluateAgentDispatchRisk).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalled();
});

test('flag ON, ALLOW recommendation: attaches req.protectRisk and calls next', async () => {
  configStore.isFlagEnabled.mockReturnValue(true);
  evaluateAgentDispatchRisk.mockResolvedValue({
    recommendation: 'ALLOW', riskLevel: 'LOW', evaluationId: 'eval-1',
  });
  const { req, res, next } = mockReqRes({ agentId: 'agent-generalist', protectSignal: 'sig' });

  await protectRiskGate(req, res, next);

  expect(req.protectRisk.recommendation).toBe('ALLOW');
  expect(next).toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalled();
});

test('flag ON, BLOCK recommendation: returns 403 and does not call next', async () => {
  configStore.isFlagEnabled.mockReturnValue(true);
  evaluateAgentDispatchRisk.mockResolvedValue({
    recommendation: 'BLOCK', riskLevel: 'HIGH', evaluationId: 'eval-2',
  });
  const { req, res, next } = mockReqRes({ agentId: 'agent-generalist', protectSignal: 'sig' });

  await protectRiskGate(req, res, next);

  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'agent_dispatch_blocked' }));
  expect(next).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest protectRiskGate`
Expected: FAIL with "Cannot find module '../../middleware/protectRiskGate'".

- [ ] **Step 3: Write the implementation**

```javascript
// demo_api_server/middleware/protectRiskGate.js
const configStore = require('../services/configStore');
const { evaluateAgentDispatchRisk } = require('../services/protectRiskService');

async function protectRiskGate(req, res, next) {
  if (!configStore.isFlagEnabled('ff_protect_agent_dispatch')) {
    return next();
  }

  const { agentId, protectSignal } = req.body || {};
  const userId = req.user?.sub;

  const risk = await evaluateAgentDispatchRisk({ signal: protectSignal, userId, agentId });
  req.protectRisk = risk;

  if (risk.recommendation === 'BLOCK') {
    return res.status(403).json({ error: 'agent_dispatch_blocked', riskLevel: risk.riskLevel });
  }

  return next();
}

module.exports = protectRiskGate;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest protectRiskGate`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Wire into the route**

In `demo_api_server/routes/agentInvokeRoute.js:139`, change:

```javascript
router.post('/agent/invoke', optionalAuthenticateToken, agentGuestSessionMiddleware, express.json(), nrTransactionMiddleware, async (req, res) => {
```

to:

```javascript
const protectRiskGate = require('../middleware/protectRiskGate');
// ...
router.post('/agent/invoke', optionalAuthenticateToken, agentGuestSessionMiddleware, express.json(), protectRiskGate, nrTransactionMiddleware, async (req, res) => {
```

`protectRiskGate` needs `req.body` parsed, so it must come after `express.json()` — confirmed placement above.

- [ ] **Step 6: Run the full agentInvokeRoute test suite to confirm no regression**

Run: `cd demo_api_server && npx jest agentInvoke --maxWorkers=4` (memory: BFF jest suite flakes under worker contention — always pass `--maxWorkers=4`)
Expected: PASS, same count as before this change (flag defaults OFF so existing tests are unaffected).

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/middleware/protectRiskGate.js demo_api_server/src/__tests__/protectRiskGate.test.js demo_api_server/routes/agentInvokeRoute.js
git commit -m "feat(protect): gate agent dispatch on Protect risk evaluation behind flag"
```

---

### Task 4: Client-side signal collection (`demo_api_ui`)

**Files:**
- Create: `demo_api_ui/src/services/protectSignalService.js`
- Test: `demo_api_ui/src/services/__tests__/protectSignalService.test.js`
- Modify: the component that POSTs to `/api/agent/invoke` — locate with `grep -rn "agent/invoke" demo_api_ui/src` before editing; attach `protectSignal` to the request body when `ff_protect_agent_dispatch` is reported ON by `/api/config/flags`.

**Interfaces:**
- Produces: `async function collectProtectSignal() -> string` — the raw signal payload the Signals SDK produces, or `null` if the SDK failed to load (never throws — dispatch must not hard-fail if Protect is unreachable).

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_ui/src/services/__tests__/protectSignalService.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectProtectSignal } from '../protectSignalService';

describe('collectProtectSignal', () => {
  beforeEach(() => {
    delete window.PingOneSignals;
  });

  it('returns null when the Signals SDK is not loaded', async () => {
    const signal = await collectProtectSignal();
    expect(signal).toBeNull();
  });

  it('returns the signal string when the SDK is loaded', async () => {
    window.PingOneSignals = { getData: vi.fn().mockResolvedValue('device-signal-abc') };
    const signal = await collectProtectSignal();
    expect(signal).toBe('device-signal-abc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run protectSignalService`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// demo_api_ui/src/services/protectSignalService.js
export async function collectProtectSignal() {
  if (typeof window === 'undefined' || !window.PingOneSignals) {
    return null;
  }
  try {
    return await window.PingOneSignals.getData();
  } catch {
    return null;
  }
}
```

The actual `window.PingOneSignals` global name and script tag depend on which Signals SDK distribution the entitlement check confirms (hosted `<script>` from the PingOne console vs. an npm package) — adjust the loader script placement (`demo_api_ui/index.html` or a dynamic `<script>` injection in this same file) once confirmed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run protectSignalService`
Expected: PASS

- [ ] **Step 5: Attach the signal to the invoke request**

In the component found by the earlier grep, add before the POST:

```javascript
import { collectProtectSignal } from '../services/protectSignalService';
// ...
const protectSignal = await collectProtectSignal();
// include in the invoke request body:
// { ...existingBody, protectSignal }
```

- [ ] **Step 6: Run the UI unit suite and build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: PASS / build succeeds.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/services/protectSignalService.js demo_api_ui/src/services/__tests__/protectSignalService.test.js
git commit -m "feat(protect): collect device signal on agent dispatch"
```

---

### Task 5: Surface the risk result in ProofStrip / audit trail

**Files:**
- Modify: the ProofStrip component — locate with `grep -rln "ProofStrip" demo_api_ui/src/components` and confirm the exact file before editing.
- Modify: whatever server-side function writes the audit/token-chain evidence for a dispatch (`grep -rln "ProofStrip\|proofStrip" demo_api_server/services` — find the evidence-writer service).

**Interfaces:**
- Consumes: `req.protectRisk` set in Task 3.
- Produces: one new evidence row `{ type: 'protect_risk_evaluation', recommendation, riskLevel, evaluationId }` appended alongside the existing token-chain steps.

- [ ] **Step 1: Write the failing test** for the evidence-writer service — mirror whatever test pattern already covers it (read the existing test file for that service first, do not invent a new pattern).

- [ ] **Step 2: Run it, confirm failure.**

- [ ] **Step 3: Add the evidence row** in the same shape as neighboring evidence entries in that file — copy the existing entry's field names exactly (do not invent new field names for existing concepts like `timestamp` or `outcome`).

- [ ] **Step 4: Run the test, confirm it passes.**

- [ ] **Step 5: Manual verification** — with `ff_protect_agent_dispatch` ON and a real Protect-licensed tenant, dispatch an agent action in Super Sports vertical, confirm the ProofStrip panel shows the Protect row with a real `evaluationId`.

- [ ] **Step 6: Commit**

```bash
git add -A  # review `git status` output first — this task touches UI + server evidence files, add explicitly per file, not with -A blindly
git commit -m "feat(protect): surface risk evaluation in ProofStrip evidence"
```

---

## Self-review notes

- Spec coverage: entitlement check (blocking gate) → flag → server risk service → gating middleware → client signal collection → forensic surfacing. All five "what would real integration require" pieces from the comparison doc are covered.
- Known open question carried into Task 2/4: the exact PingOne Protect risk-evaluations request/response shape and Signals SDK distribution are illustrative until the entitlement check confirms them against the real tenant — do not merge Task 2/Task 4 code without that live verification.
- `CHALLENGE` recommendation is recorded but not enforced (no step-up UI) — intentionally out of scope for this plan; call it out as a explicit follow-up, not a silent gap.
