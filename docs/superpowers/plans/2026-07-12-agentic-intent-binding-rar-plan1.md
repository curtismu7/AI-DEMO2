# Agentic Intent Binding — Plan 1: Shared Core + RAR Use Case Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the legitimate PERMIT-path counterpart to the existing RAR (RFC 9396) attack demo (UC14 `rar-exceeded`), make the result visible everywhere token-chain/flow status renders, and give it a home on a new "Intent Binding" learning page — the first of four planned use cases (AP2, OAuth Transaction Tokens draft, and RFC 8693 Token Exchange follow in later plans).

**Architecture:** RAR enforcement already exists end-to-end in this codebase (`demo_mcp_gateway/src/rarEnforce.ts`, `agentMcpTokenService.buildRarAuthorizationDetails`, mock-authz Rule 3c) but only as a DENY-only attack simulation (`attackSimulatorService._runRarExceeded`). This plan adds a sibling PERMIT-path function that reuses the same minting/exchange/gateway-call machinery with a within-cap request, wires the resulting new token event into the one renderer that doesn't consume generic events (`buildTraceSteps.js`/`TokenChainTraceRail`), and exposes both paths through a new interactive learning-page section.

**Tech Stack:** Node/Express (BFF), React (UI), Jest (both).

## Global Constraints

- Emoji rule: only `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` are allowed anywhere in code/UI text (per `REGRESSION_PLAN.md` §0). No other emoji.
- Minimal diff: name the component, name the element, change only that — no unrelated cleanup.
- All work happens in the existing worktree `.claude/worktrees/agentic-intent-binding-spec` (branch `worktree-agentic-intent-binding-spec`) — do not create a new worktree, do not edit the main checkout.
- Stage files explicitly (`git add <files>`), never `git add -A`.
- Reuse existing RAR enforcement machinery (`rarEnforce.ts`, `buildRarAuthorizationDetails`, `buildTratContext`, `callToolViaGateway`, the mock-authz Rule 3c) — do not duplicate it. Confirmed by user decision during design.
- The new learning page cross-links the existing static education panels (`RARPanel`, `IntentDelegationPanel`) for RFC/background explainer content rather than re-authoring it. Confirmed by user decision during design.
- `configStore.getEffective(flag)` always returns a string (`'true'`/`'false'`), never a boolean — comparisons must use string literals (established codebase convention, see `demo_api_server/routes/attackSimulator.js`).

---

## File Structure

- **Modify** `demo_api_server/services/attackSimulatorService.js` — add `_runRarPermit()` (PERMIT-path RAR demo) and `runIntentBindingDemo(action, req, requestedAmount)` (public entry point dispatching to either the new permit path or the existing `runAttackSim('rar-exceeded', ...)` for drift).
- **Create** `demo_api_server/routes/intentBinding.js` — `POST /api/demo/intent-binding/run`, mirrors `routes/attackSimulator.js`'s guard structure.
- **Modify** `demo_api_server/server.js` — mount the new route.
- **Modify** `demo_api_server/config/useCases.js` — add one new use-case entry linking to the new learning page.
- **Modify** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js` — add the `intent-binding` step id, since this is the one renderer that doesn't consume generic token events (all other renderers — `TokenChainDisplay`, `SimpleStepperPanel`, `TokenAuditTimeline`, `ApiTrafficPanel` — already render new events generically via `resolveStatusVisual`/status string, confirmed no changes needed there; see Task 6).
- **Create** `demo_api_ui/src/pages/IntentBindingLearningPage.js` (+ `.css`) — new standalone learning page, RAR section only in this plan.
- **Modify** `demo_api_ui/src/routes/PublicRoutes.js` — add `IntentBindingLearningPageRoute` wrapper, mirroring `AuthzTestPageRoute`.
- **Modify** `demo_api_ui/src/App.js` — import + register the new route at `/intent-binding-learning`.
- **Create** `demo_api_server/src/__tests__/intentBindingDemo.test.js` — structural tests for the new service function.
- **Modify** `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js` — add a test case for the new step.
- **Create** `demo_api_ui/src/pages/__tests__/IntentBindingLearningPage.test.js` — render/interaction test for the new page.

---

## Task 1: Backend — `runIntentBindingDemo` PERMIT path

**Files:**
- Modify: `demo_api_server/services/attackSimulatorService.js`
- Test: `demo_api_server/src/__tests__/intentBindingDemo.test.js`

**Interfaces:**
- Produces: `runIntentBindingDemo(action: 'permit'|'drift', req: ExpressRequest, requestedAmount?: number) => Promise<{ sim, useCaseId, status, errorCode, reason, tokenChainEvents }>` — exported from `attackSimulatorService.js` alongside the existing `runAttackSim`.
- Consumes: existing private helpers in the same file — `_pushGatewayFlags`, `_exchangeGatewayToken`, `_denyFromGateway`, `_stampUseCaseId`, `configStore`, `buildTokenEvent`/`buildTratContext`/`buildRarAuthorizationDetails` (from `./agentMcpTokenService`), `callToolViaGateway` (from `./mcpGatewayClient`) — all already imported at the top of the file.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/src/__tests__/intentBindingDemo.test.js`:

```js
'use strict';

const { runIntentBindingDemo } = require('../../services/attackSimulatorService');

describe('runIntentBindingDemo — structural (no creds needed)', () => {
  test('returns no_session_token when session is missing (permit action)', async () => {
    const result = await runIntentBindingDemo('permit', { session: { oauthTokens: {} } });
    expect(result.status).toBe(401);
    expect(result.errorCode).toBe('no_session_token');
  });

  test('returns unknown_action for an unrecognized action', async () => {
    const result = await runIntentBindingDemo('nonsense', { session: { oauthTokens: { accessToken: 'x' } } });
    expect(result.status).toBe(400);
    expect(result.errorCode).toBe('unknown_action');
  });

  test('drift action delegates to the existing rar-exceeded attack sim', async () => {
    const result = await runIntentBindingDemo('drift', { session: { oauthTokens: {} } });
    // Same session-missing guard as runAttackSim('rar-exceeded', ...) — proves delegation, not a parallel no-op.
    expect(result.sim).toBe('rar-exceeded');
    expect(result.status).toBe(401);
    expect(result.errorCode).toBe('no_session_token');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && npx jest intentBindingDemo -v`
Expected: FAIL — `runIntentBindingDemo is not a function` (not yet exported).

- [ ] **Step 3: Implement `_runRarPermit` and `runIntentBindingDemo`**

In `demo_api_server/services/attackSimulatorService.js`, add the following directly after the existing `_runRarExceeded` function (after its closing `}` around line 931, before the `_runTamperedIntentToken` comment block):

```js
/**
 * Intent Binding demo (PERMIT path): mints the same $100 RAR grant UC14's
 * attack path denies, but requests a transfer within the granted cap. The
 * gateway/authz PERMIT and the response carries an 'intent-binding-verified'
 * token event — the legitimate counterpart to UC14's DENY.
 */
async function _runRarPermit(subjectToken, useCaseId, tokenChainEvents, req, requestedAmount) {
  const sim = 'rar-permit';
  const grantedAmount = 100;
  const amount = Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : grantedAmount;

  try {
    await configStore.setRaw({ ff_rar: 'true' });
  } catch (err) {
    return { sim, useCaseId, status: 500, errorCode: 'config_store_failed', reason: err.message, tokenChainEvents };
  }

  const pushResult = await _pushGatewayFlags({ requireRarIntent: true });
  if (!pushResult.ok) {
    tokenChainEvents.push(buildTokenEvent(
      'sim-rar-arm-failed',
      'Gateway RAR arm failed (non-fatal)',
      'warning',
      null,
      pushResult.error || 'Could not arm requireRarIntent on gateway',
    ));
  } else {
    tokenChainEvents.push(buildTokenEvent(
      'sim-rar-armed',
      'Gateway RAR enforcement armed (Intent Binding demo)',
      'active',
      null,
      'requireRarIntent enabled on Demo Agent Gateway for this call.',
    ));
  }

  const exchanged = await _exchangeGatewayToken(
    subjectToken, ['read', 'write', 'transfer'], useCaseId, tokenChainEvents, sim,
  );
  if (!exchanged.ok) return exchanged.result;

  const userSub = req?.session?.user?.sub || req?.user?.sub || '';
  const rarDetails = buildRarAuthorizationDetails(
    'create_transfer',
    { amount: grantedAmount, to_account_id: 'sim-acc-001' },
    userSub,
  );
  const tratCtx = buildTratContext(
    req,
    'create_transfer',
    userSub,
    configStore.getEffective('pingone_ai_agent_actor_client_id') || '',
    configStore.getEffective('admin_client_id') || '',
    { rarDetails },
  );
  const tratContextHeader = JSON.stringify({ ...tratCtx, trat_sim: true });

  tokenChainEvents.push(buildTokenEvent(
    'sim-rar-grant',
    `RAR grant ($${grantedAmount})`,
    'active',
    null,
    `Attested authorization_details cap the transfer at $${grantedAmount}. ` +
    `This call requests $${amount}, within the granted cap.`,
    { authorization_details: rarDetails },
  ));

  try {
    await callToolViaGateway(
      null,
      exchanged.token,
      'create_transfer',
      { amount, to_account_id: 'sim-acc-001' },
      { tratContextHeader },
    );
  } catch (err) {
    return _denyFromGateway(
      sim, useCaseId, tokenChainEvents, err, 403, 'rar_unexpected_deny',
      'Gateway DENY (unexpected — requested amount was within the granted cap)',
    );
  }

  tokenChainEvents.push(buildTokenEvent(
    'intent-binding-verified',
    'Intent Verified (RAR — RFC 9396)',
    'active',
    null,
    `Gateway PERMIT: requested $${amount} is within the RAR authorization_details cap of $${grantedAmount}. ` +
    'The MCP gateway and PingOne Authorize confirmed the transfer matches the declared intent.',
    { authorization_details: rarDetails, requestedAmount: amount, grantedAmount },
  ));
  _stampUseCaseId(tokenChainEvents, useCaseId);
  return { sim, useCaseId, status: 200, errorCode: null, reason: 'PERMIT — within granted RAR cap', tokenChainEvents };
}

/**
 * Public entry point for the Intent Binding learning-page demo. 'drift' reuses
 * the existing UC14 attack path unchanged (it already demonstrates the DENY
 * side); 'permit' is the new legitimate counterpart above.
 */
async function runIntentBindingDemo(action, req, requestedAmount) {
  if (action === 'drift') {
    return runAttackSim('rar-exceeded', req);
  }
  if (action !== 'permit') {
    return {
      sim: null, useCaseId: null, status: 400, errorCode: 'unknown_action',
      reason: `Unknown action: ${action}`, tokenChainEvents: [],
    };
  }
  const subjectToken = req?.session?.oauthTokens?.accessToken;
  if (!subjectToken) {
    return {
      sim: 'rar-permit', useCaseId: null, status: 401, errorCode: 'no_session_token',
      reason: 'No access token in session — user must be logged in', tokenChainEvents: [],
    };
  }
  const useCaseId = 'rar-intent-verified';
  const tokenChainEvents = [];
  return _runRarPermit(subjectToken, useCaseId, tokenChainEvents, req, requestedAmount);
}
```

Then update the `module.exports` line at the bottom of the file:

```js
module.exports = { runAttackSim, runIntentBindingDemo, _exchangeSimToken };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && npx jest intentBindingDemo -v`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/attackSimulatorService.js demo_api_server/src/__tests__/intentBindingDemo.test.js
git commit -m "feat: add RAR intent-binding PERMIT path alongside existing UC14 attack"
```

---

## Task 2: Backend route + per-demo Live toggle

**Files:**
- Create: `demo_api_server/routes/intentBinding.js`
- Modify: `demo_api_server/server.js`
- Test: `demo_api_server/src/__tests__/intentBindingDemo.test.js` (extend)

**Interfaces:**
- Consumes: `runIntentBindingDemo` from Task 1.
- Produces: `POST /api/demo/intent-binding/run` — body `{ action: 'permit'|'drift', requestedAmount?: number, live?: boolean }`, returns the same JSON shape `runAttackSim`/`runIntentBindingDemo` already returns.

- [ ] **Step 1: Write the failing test**

Append to `demo_api_server/src/__tests__/intentBindingDemo.test.js`:

```js
const request = require('supertest');

describe('POST /api/demo/intent-binding/run — route guards', () => {
  let app;
  beforeAll(() => {
    // server.js boots the full app; reuse it the same way other route tests do.
    app = require('../../server');
  });

  test('rejects an unknown action with 400', async () => {
    const res = await request(app)
      .post('/api/demo/intent-binding/run')
      .send({ action: 'nonsense' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_action');
  });
});
```

(If no existing route test in this file structure boots `server.js` directly via `supertest`, check `demo_api_server/routes/__tests__/useCases.test.js` for the established pattern first and mirror it exactly instead of the above — this codebase already has a convention for this and it must be followed rather than reinvented.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest intentBindingDemo -v`
Expected: FAIL — 404 (route not mounted) instead of 400.

- [ ] **Step 3: Create the route and mount it**

Create `demo_api_server/routes/intentBinding.js`:

```js
'use strict';

/**
 * Intent Binding Demo Route
 *
 * POST /api/demo/intent-binding/run
 * Body: { action: 'permit'|'drift', requestedAmount?: number, live?: boolean }
 *
 * Gating mirrors routes/attackSimulator.js: production hard guard, launcher
 * soft guard, session auth.
 */
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const configStore = require('../services/configStore');
const { runIntentBindingDemo } = require('../services/attackSimulatorService');

router.post('/run', authenticateToken, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'not_available_in_production' });
  }

  if (configStore.getEffective('ff_use_cases_launcher') === 'false') {
    return res.status(403).json({ error: 'feature_disabled' });
  }

  const { action, requestedAmount, live } = req.body || {};
  if (action !== 'permit' && action !== 'drift') {
    return res.status(400).json({ error: 'unknown_action', validActions: ['permit', 'drift'] });
  }

  // Live toggle: temporarily route the downstream PERMIT/DENY decision through
  // real PingOne Authorize for this call, mirroring the transient-flag-flip
  // pattern already used throughout attackSimulatorService.js (ff_rar,
  // requireRarIntent) rather than inventing new plumbing.
  if (live === true) {
    try {
      await configStore.setRaw({ ff_authorize_simulated: 'false' });
    } catch (err) {
      console.error('[intentBinding] failed to arm live mode (non-fatal):', err.message);
    }
  }

  try {
    const result = await runIntentBindingDemo(action, req, Number(requestedAmount));
    return res.status(200).json({ ...result, live: live === true });
  } catch (err) {
    console.error('[intentBinding] runIntentBindingDemo failed:', err.message);
    return res.status(500).json({ error: 'demo_execution_failed', message: err.message });
  }
});

module.exports = router;
```

In `demo_api_server/server.js`, immediately after the existing attack-sim mount (around line 1332-1333):

```js
const attackSimulatorRoutes = require('./routes/attackSimulator');
app.use('/api/demo/attack-sim', express.json(), attackSimulatorRoutes);
const intentBindingRoutes = require('./routes/intentBinding');
app.use('/api/demo/intent-binding', express.json(), intentBindingRoutes);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest intentBindingDemo -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/intentBinding.js demo_api_server/server.js demo_api_server/src/__tests__/intentBindingDemo.test.js
git commit -m "feat: mount POST /api/demo/intent-binding/run with live-mode toggle"
```

---

## Task 3: `useCases.js` entry

**Files:**
- Modify: `demo_api_server/config/useCases.js`
- Test: `demo_api_server/src/__tests__/useCases.config.test.js` (extend if it asserts catalog shape/uniqueness; otherwise skip test changes — read the file first)

**Interfaces:**
- Produces: one new entry in `RAW_USE_CASES` with `useCaseId: 'rar-intent-verified'`, consumed by `UseCaseLauncherPage.js` exactly like existing entries (no UI code changes needed — `trigger.type: 'link'` is already handled generically by `handleOpen`).

- [ ] **Step 1: Read `demo_api_server/src/__tests__/useCases.config.test.js`**

Open the file and check whether it asserts something like "every `useCaseId` is unique" or "every entry has required fields." If so, the new entry must satisfy those assertions as-is (no test changes needed, since it's a generic catalog-shape test, not one this task needs to extend).

- [ ] **Step 2: Add the entry**

In `demo_api_server/config/useCases.js`, add to `RAW_USE_CASES` (near the existing UC14 `rar-intent-violation` entry, for locality):

```js
{
  id: 'UC14b',
  useCaseId: 'rar-intent-verified',
  track: 'learn',
  title: 'RAR intent verified (PERMIT)',
  buyerStory: 'A transfer that stays within its declared RFC 9396 authorization_details cap is verified and permitted — the legitimate counterpart to the RAR overage attack.',
  pingOneSolution: 'RFC 9396 authorization_details bind the transfer to an amount cap; the MCP gateway and PingOne Authorize verify the requested transfer against it before permitting.',
  trigger: { type: 'link', path: '/intent-binding-learning#rar' },
  expectedOutcome: 'PERMIT',
  evidence: { tokenChain: ['sim-rar-armed', 'sim-rar-grant', 'intent-binding-verified'], activity: [] },
  codeRefs: [
    'demo_api_server/services/attackSimulatorService.js',
    'demo_api_server/services/agentMcpTokenService.js',
    'demo_mcp_gateway/src/rarEnforce.ts',
  ],
  maturity: 'flag:ff_rar',
  whatToSay: 'Same RAR grant UC14 attacks, but requested within the cap — the gateway and PingOne Authorize permit it and the token chain shows an Intent Verified step.',
  advanced: false,
  primaryTool: 'create_transfer',
},
```

- [ ] **Step 3: Run the config test**

Run: `cd demo_api_server && npx jest useCases.config -v`
Expected: PASS (new entry satisfies existing shape/uniqueness assertions).

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/config/useCases.js
git commit -m "feat: add rar-intent-verified use case linking to the intent binding learning page"
```

---

## Task 4: `buildTraceSteps.js` — new `intent-binding` step

**Files:**
- Modify: `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`

**Interfaces:**
- Produces: a new step object with `id: 'intent-binding'` in the array `buildTraceSteps(trace)` returns, `status` derived from `trace.tokenEvents`.

- [ ] **Step 1: Write the failing tests**

Add to `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`:

```js
describe("buildTraceSteps — intent-binding step", () => {
  test("pending with no tokenEvents", () => {
    const steps = buildTraceSteps(EMPTY_TRACE);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId["intent-binding"].status).toBe("pending");
  });

  test("done when an intent-binding-verified event is present", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "intent-binding-verified", label: "Intent Verified (RAR — RFC 9396)", status: "active" },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId["intent-binding"].status).toBe("done");
  });

  test("error when a gateway deny carries rar_unexpected_deny or rar_amount_exceeded", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "sim-gateway-deny", label: "Gateway DENY (rar_amount_exceeded)", status: "error", error: "rar_amount_exceeded" },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId["intent-binding"].status).toBe("error");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx jest buildTraceSteps -v`
Expected: FAIL — `byId["intent-binding"]` is `undefined` (step doesn't exist yet).

- [ ] **Step 3: Add the step**

Open `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`. Add `"intent-binding"` to the `LANES`, `TITLES`, and `NARRATIVES` objects (same pattern as the existing `"authorize"` entry — add it as a sibling key, do not remove or reorder existing keys), then add the evidence-detection block and `steps.push(...)` call in `buildTraceSteps()`, placed after the existing `authorize` step's push (RAR intent verification is conceptually part of the authorize decision):

```js
// In LANES:
"intent-binding": "Authorize",

// In TITLES:
"intent-binding": "Intent Binding Check",

// In NARRATIVES:
"intent-binding": "Verifies the requested transfer against the declared RFC 9396 authorization_details cap.",
```

```js
// In buildTraceSteps(), after the existing authorize step push:
const intentVerifiedEvent = (trace.tokenEvents || []).find((e) => e.id === "intent-binding-verified");
const intentDeniedEvent = (trace.tokenEvents || []).find(
  (e) => e.id === "sim-gateway-deny" && (e.error === "rar_amount_exceeded" || e.error === "rar_unexpected_deny"),
);
const intentBindingStatus = intentVerifiedEvent
  ? "done"
  : intentDeniedEvent
  ? "error"
  : traceComplete
  ? "notinpath"
  : "pending";
steps.push(makeStep("intent-binding", intentBindingStatus, { tokenEvent: intentVerifiedEvent || intentDeniedEvent || null }));
```

(`makeStep` and `traceComplete` already exist in this file per the `notinpath` pattern added in commit `264b8e6bf` — reuse them as-is, do not redefine.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx jest buildTraceSteps -v`
Expected: PASS — all 3 new tests plus the existing full-vocabulary tests green (check the "returns the 12 happy-path steps" test still passes with the new step appended — if it asserts an exact array of 12 ids, update that expected array to include `"intent-binding"` since the vocabulary genuinely grew).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js
git commit -m "feat: add intent-binding step to the token chain trace rail"
```

---

## Task 5: Confirm the other 4 renderers need no code changes (regression test)

**Files:**
- Test: `demo_api_ui/src/components/__tests__/TokenChainDisplay.intentBinding.test.js` (new)

**Interfaces:**
- Consumes: `resolveStatusVisual` (exported from `demo_api_ui/src/components/TokenChainDisplay.js`).

This task exists specifically to prevent the kind of gap noted in prior project history (a status-treatment sweep that missed the trace rail) from recurring here in the other direction — proving, not assuming, that `TokenChainDisplay`, `SimpleStepperPanel`, and `TokenAuditTimeline` (all three consume `resolveStatusVisual` generically) already handle the new event's status values correctly with zero code changes.

- [ ] **Step 1: Write the test**

Create `demo_api_ui/src/components/__tests__/TokenChainDisplay.intentBinding.test.js`:

```js
import { resolveStatusVisual } from "../TokenChainDisplay";

describe("resolveStatusVisual — intent-binding event statuses", () => {
  test("'active' (intent-binding-verified) resolves to the active/success bucket", () => {
    expect(resolveStatusVisual("active").bucket).toBe("active");
  });

  test("'error' (gateway deny) resolves to the failed bucket", () => {
    expect(resolveStatusVisual("error").bucket).toBe("failed");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd demo_api_ui && npx jest TokenChainDisplay.intentBinding -v`
Expected: PASS immediately — this confirms (rather than assumes) that `TokenChainDisplay`, `SimpleStepperPanel`, and `TokenAuditTimeline` (all downstream of `resolveStatusVisual`) render the new event correctly with no further changes. `ApiTrafficPanel.js` also needs no change since its own map only special-cases `failed`/`skipped` and defaults everything else (including `active`) to its generic `'tok'` badge, which is correct for this event.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/__tests__/TokenChainDisplay.intentBinding.test.js
git commit -m "test: confirm intent-binding event statuses render correctly via resolveStatusVisual"
```

---

## Task 6: New Intent Binding Learning Page (RAR section — pipeline header + permanent PERMIT/DRIFT split)

**Design:** matches the user-approved "B+C combined" mockup: a dark header band introduces a static 4-step pipeline (Declare intent → Build RAR grant → Agent requests transfer → Gateway + P1AZ check), followed by the declared grant shown as JSON, then a permanent two-column split — a green "Within the grant" column and a red "Drifts past the grant" column — each with its own amount input and its own **Run** button, so both outcomes are visible side by side rather than toggled between. A single Live-mode checkbox applies to whichever column is run.

**Files:**
- Create: `demo_api_ui/src/pages/IntentBindingLearningPage.js`
- Create: `demo_api_ui/src/pages/IntentBindingLearningPage.css`
- Modify: `demo_api_ui/src/routes/PublicRoutes.js`
- Modify: `demo_api_ui/src/App.js`
- Test: `demo_api_ui/src/pages/__tests__/IntentBindingLearningPage.test.js`

**Interfaces:**
- Consumes: `POST /api/demo/intent-binding/run` from Task 2.
- Produces: route `/intent-binding-learning`, section anchor `#rar` (matching the `useCases.js` entry's `trigger.path` from Task 3).

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/pages/__tests__/IntentBindingLearningPage.test.js`:

```js
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import IntentBindingLearningPage from "../IntentBindingLearningPage";

beforeEach(() => {
  global.fetch = jest.fn();
});

test("renders the pipeline, the grant, and both columns", () => {
  render(<IntentBindingLearningPage />);
  expect(screen.getByText(/RFC 9396/i)).toBeInTheDocument();
  expect(screen.getByText("Within the grant")).toBeInTheDocument();
  expect(screen.getByText("Drifts past the grant")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /run permit/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /run drift/i })).toBeInTheDocument();
});

test("running the permit column posts action:'permit' and shows PERMIT", async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status: 200, errorCode: null, reason: "PERMIT — within granted RAR cap",
      tokenChainEvents: [{ id: "intent-binding-verified", label: "Intent Verified (RAR — RFC 9396)", status: "active" }],
    }),
  });

  render(<IntentBindingLearningPage />);
  fireEvent.click(screen.getByRole("button", { name: /run permit/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    "/api/demo/intent-binding/run",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"action":"permit"'),
    }),
  ));
  expect(await screen.findByText(/Intent Verified/i)).toBeInTheDocument();
});

test("running the drift column posts action:'drift' and shows DENY", async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status: 403, errorCode: "rar_amount_exceeded",
      reason: "Gateway rejected the call with 403 rar_amount_exceeded",
      tokenChainEvents: [{ id: "sim-gateway-deny", label: "Gateway DENY (rar_amount_exceeded)", status: "error" }],
    }),
  });

  render(<IntentBindingLearningPage />);
  fireEvent.click(screen.getByRole("button", { name: /run drift/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    "/api/demo/intent-binding/run",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"action":"drift"'),
    }),
  ));
  expect(await screen.findByText(/DENY \(rar_amount_exceeded\)/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx jest IntentBindingLearningPage -v`
Expected: FAIL — module not found (`IntentBindingLearningPage` doesn't exist yet).

- [ ] **Step 3: Implement the page**

Create `demo_api_ui/src/pages/IntentBindingLearningPage.css`:

```css
.intent-binding-page { max-width: 980px; margin: 0 auto; padding: 24px; }

.ib-header-band {
  background: linear-gradient(135deg, var(--brand-navy, #1d4ed8), var(--brand-navy-dark, #1e3a8a));
  color: #fff;
  border-radius: 12px;
  padding: 24px 26px;
}
.ib-eyebrow { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #93c5fd; }
.ib-header-band h1 { margin: 8px 0 6px; font-size: 1.4rem; }
.ib-header-band p { margin: 0; color: #cbd5e1; font-size: 0.9rem; max-width: 62ch; }

.ib-pipeline {
  list-style: none;
  margin: 18px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.ib-step {
  background: var(--surface-color, #fff);
  border: 1px solid var(--border-color, #d8dde5);
  border-radius: 9px;
  padding: 12px;
}
.ib-step-num { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.05em; color: var(--text-secondary, #8991a0); }
.ib-step h3 { margin: 4px 0 4px; font-size: 0.85rem; }
.ib-step p { margin: 0; font-size: 0.76rem; color: var(--text-secondary, #5b6472); line-height: 1.4; }

.ib-grant-card {
  margin-top: 16px;
  background: var(--surface-color, #fff);
  border: 1px solid var(--border-color, #d8dde5);
  border-radius: 10px;
  padding: 14px 16px;
}
.ib-grant-json {
  margin: 8px 0 0;
  background: #12182380;
  color: #e6eaf1;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 0.78rem;
  overflow-x: auto;
}

.ib-split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
@media (max-width: 720px) { .ib-split { grid-template-columns: 1fr; } }

.ib-col { border-radius: 10px; padding: 16px; border: 1px solid var(--border-color, #d8dde5); background: var(--surface-color, #fff); }
.ib-col--permit { border-top: 3px solid var(--brand-success, #4caf50); }
.ib-col--drift { border-top: 3px solid var(--brand-error, #f44336); }
.ib-col-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.ib-col-head h2 { margin: 0; font-size: 0.95rem; }

.ib-pill { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; }
.ib-pill--permit { background: rgba(76, 175, 80, 0.12); color: var(--brand-success, #4caf50); border: 1px solid rgba(76, 175, 80, 0.3); }
.ib-pill--drift { background: rgba(244, 67, 54, 0.12); color: var(--brand-error, #f44336); border: 1px solid rgba(244, 67, 54, 0.3); }

.ib-amount { font-size: 1.4rem; font-weight: 700; font-family: monospace; margin: 4px 0; }
.ib-amount small { display: block; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-secondary, #8991a0); font-weight: 500; }
.ib-rationale { font-size: 0.82rem; color: var(--text-secondary, #5b6472); line-height: 1.5; min-height: 3.2em; }

.ib-controls { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.ib-controls input[type="number"] { width: 84px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border-color, #d8dde5); }
.ib-controls button { font-weight: 600; font-size: 0.85rem; padding: 8px 14px; border-radius: 7px; border: none; cursor: pointer; color: #fff; background: var(--brand-navy, #1d4ed8); }
.ib-controls button:disabled { opacity: 0.6; cursor: default; }

.ib-status { margin-top: 12px; padding: 10px 12px; border-radius: 8px; font-size: 0.82rem; }
.ib-status--permit { background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); }
.ib-status--deny, .ib-status--error { background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.3); }
.ib-status ul { margin: 6px 0 0; padding-left: 18px; }

.ib-live-toggle { margin-top: 16px; padding: 12px 16px; background: var(--surface-secondary, #eef1f5); border-radius: 8px; font-size: 0.85rem; }
.ib-edu-link { margin-top: 12px; font-size: 0.85rem; }
.ib-link-btn { background: none; border: none; padding: 0; color: var(--brand-navy, #1d4ed8); text-decoration: underline; cursor: pointer; font: inherit; }
```

Create `demo_api_ui/src/pages/IntentBindingLearningPage.js`:

```jsx
import React, { useState } from "react";
import "./IntentBindingLearningPage.css";

/**
 * New standalone Intent Binding learning page. This plan implements only the
 * RAR (RFC 9396) section; AP2, OAuth Transaction Tokens draft, and RFC 8693
 * Token Exchange sections are added by later plans. Layout matches the
 * user-approved "B+C combined" mockup: static pipeline header, then a
 * permanent PERMIT | DRIFT split so both outcomes are visible at once.
 */
const GRANT = { type: "banking_transaction", tool: "create_transfer", amount: 100, payee: "acme-utilities" };

const PIPELINE_STEPS = [
  { num: 1, title: "Declare intent", detail: "Customer authorizes: pay Acme Utilities, up to $100." },
  { num: 2, title: "Build RAR grant", detail: "authorization_details attached to the agent's token via RFC 9396." },
  { num: 3, title: "Agent requests transfer", detail: "MCP gateway receives the actual create_transfer call." },
  { num: 4, title: "Gateway + P1AZ check", detail: "Requested amount compared against the grant's cap." },
];

function useColumnRun(action, defaultAmount) {
  const [amount, setAmount] = useState(defaultAmount);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async (live) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/demo/intent-binding/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, requestedAmount: Number(amount), live }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.reason || data.error || "Request failed");
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { amount, setAmount, loading, result, error, run };
}

function IntentBindingColumn({ kind, title, outcomeLabel, rationale, col, live }) {
  return (
    <div className={`ib-col ib-col--${kind}`}>
      <div className="ib-col-head">
        <h2>{title}</h2>
        <span className={`ib-pill ib-pill--${kind}`}>{outcomeLabel}</span>
      </div>
      <div className="ib-amount">
        <small>Requested</small>${col.amount}
      </div>
      <p className="ib-rationale">{rationale}</p>
      <div className="ib-controls">
        <label>
          Amount
          <input type="number" value={col.amount} onChange={(e) => col.setAmount(e.target.value)} min={1} />
        </label>
        <button aria-label={`Run ${kind}`} onClick={() => col.run(live)} disabled={col.loading}>
          {col.loading ? "Running…" : "Run"}
        </button>
      </div>
      {col.error ? <div className="ib-status ib-status--error">{col.error}</div> : null}
      {col.result ? (
        <div className={`ib-status ib-status--${col.result.status === 200 ? "permit" : "deny"}`}>
          <strong>{col.result.status === 200 ? "PERMIT" : `DENY (${col.result.errorCode})`}</strong>
          <ul>
            {(col.result.tokenChainEvents || []).map((ev) => (
              <li key={ev.id}>
                <strong>{ev.label}</strong> — {ev.status}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function IntentBindingLearningPage() {
  const [live, setLive] = useState(false);
  const permitCol = useColumnRun("permit", 80);
  const driftCol = useColumnRun("drift", 500);

  return (
    <div className="intent-binding-page">
      <header className="ib-header-band">
        <div className="ib-eyebrow">Learning · Intent Binding</div>
        <h1>Watch an agent's intent get checked, step by step</h1>
        <p>
          Every transfer an agent makes runs this pipeline. The same RFC 9396 Rich Authorization
          Request grant is compared below against two requests — one within the agent's declared
          authority, one past it.
        </p>
      </header>

      <ol className="ib-pipeline">
        {PIPELINE_STEPS.map((step) => (
          <li key={step.num} className="ib-step">
            <div className="ib-step-num">Step {step.num}</div>
            <h3>{step.title}</h3>
            <p>{step.detail}</p>
          </li>
        ))}
      </ol>

      <div className="ib-grant-card">
        <strong>Grant on the agent&apos;s token (RFC 9396 authorization_details):</strong>
        <pre className="ib-grant-json">{JSON.stringify(GRANT, null, 2)}</pre>
      </div>

      <div id="rar" className="ib-split">
        <IntentBindingColumn
          kind="permit"
          title="Within the grant"
          outcomeLabel="Permit"
          rationale={`$${permitCol.amount} is within the $${GRANT.amount} cap. Steps 3-4 complete and the gateway confirms the request matches the declared intent.`}
          col={permitCol}
          live={live}
        />
        <IntentBindingColumn
          kind="drift"
          title="Drifts past the grant"
          outcomeLabel="Deny"
          rationale={`$${driftCol.amount} exceeds the $${GRANT.amount} cap. Step 4 stops the chain — the transfer never reaches the account.`}
          col={driftCol}
          live={live}
        />
      </div>

      <div className="ib-live-toggle">
        <label>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live mode — route this decision through real PingOne Authorize instead of the simulated engine
        </label>
      </div>

      <p className="ib-edu-link">
        For deeper RFC background, see the{" "}
        <button type="button" className="ib-link-btn" onClick={() => window.dispatchEvent(new CustomEvent("open-edu-panel", { detail: { id: "RAR", tab: "what" } }))}>
          RAR education panel
        </button>.
      </p>
    </div>
  );
}
```

The `open-edu-panel` custom event dispatch is a placeholder integration point — check `demo_api_ui/src/components/EducationBar.js`/`educationCommands.js` for the actual mechanism used to open an `EDU.*` panel imperatively from outside its own component tree (found during design-phase exploration to be an `openEdu(EDU.RAR, 'what')`-style call), and replace that button's `onClick` handler with the real imported call before this task is considered done. Do not leave the `CustomEvent` version in the final commit — verify the exact export and call it directly rather than trusting this placeholder.

- [ ] **Step 4: Wire the route**

In `demo_api_ui/src/routes/PublicRoutes.js`, add near `AuthzTestPageRoute`:

```js
import IntentBindingLearningPage from "../pages/IntentBindingLearningPage";

export function IntentBindingLearningPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <IntentBindingLearningPage />
    </AppShell>
  );
}
```

In `demo_api_ui/src/App.js`, add `IntentBindingLearningPageRoute` to the import list from `PublicRoutes` (alongside `AuthzTestPageRoute`), and add a `<Route>` next to the existing `/authz-test` one:

```jsx
<Route
  path="/intent-binding-learning"
  element={<IntentBindingLearningPageRoute user={user} logout={logout} />}
/>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_api_ui && npx jest IntentBindingLearningPage -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/IntentBindingLearningPage.js demo_api_ui/src/pages/IntentBindingLearningPage.css demo_api_ui/src/pages/__tests__/IntentBindingLearningPage.test.js demo_api_ui/src/routes/PublicRoutes.js demo_api_ui/src/App.js
git commit -m "feat: add Intent Binding learning page with the RAR section"
```

---

## Task 7: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend unit suite**

Run: `cd demo_api_server && npm test`
Expected: PASS, no new failures relative to the pre-Task-1 baseline.

- [ ] **Step 2: Run the full frontend unit suite**

Run: `cd demo_api_ui && npm test -- --watchAll=false`
Expected: PASS, no new failures relative to the pre-Task-1 baseline.

- [ ] **Step 3: Run topology/hygiene gates**

Run: `npm run topology:verify && npm run hygiene:check` (from repo root)
Expected: PASS.

- [ ] **Step 4: Manual smoke check**

Start the stack (`./run.sh` or `./run-docker.sh start optional`), log in as the demo customer, navigate to `/intent-binding-learning`. Confirm the header band and 4-step pipeline render, then click **Run** in the left ("Within the grant") column — expect a green PERMIT status with an `intent-binding-verified` event listed. Click **Run** in the right ("Drifts past the grant") column — expect a red DENY status with `rar_amount_exceeded` listed, independent of the left column's result (both should remain visible side by side). Confirm the same run also shows up correctly in `/dashboard`'s embedded Token Chain rail (`TokenChainTraceRail`) if the demo triggers a live trace update — if it doesn't yet (this plan's demo response is self-contained JSON, not piped through `TokenChainContext`), note this as a known follow-up rather than a regression: the plan's Task 4/5 work guarantees the *renderers* handle the new step/event correctly wherever they receive it, not that this specific demo currently feeds the global trace store — wiring the learning-page demo into the live global trace (so it shows in the Dashboard's rail during the same run) is in scope for a later plan once the AP2/txn-token use cases clarify the shared pattern for all four.

- [ ] **Step 5: No commit** — this task is verification-only.

---

## Self-Review Notes

- **Spec coverage:** Shared-core reuse (RAR machinery) — Task 1. Live toggle — Task 2. Use-case card — Task 3. Token-chain visibility — Tasks 4-5 (with Task 5 proving 4 of 5 renderers need zero changes, and Task 7 Step 4 flagging the one honest gap: this demo isn't yet wired into the *live* global trace store, only its own self-contained response). Learning page — Task 6, explicitly cross-linking the existing RAR education panel per the confirmed design decision. AP2, OAuth Transaction Tokens draft, and RFC 8693 Token Exchange use cases are explicitly out of scope for this plan (Plan 1 of a phased sequence) — each gets its own follow-up plan.
- **Type consistency:** `runIntentBindingDemo(action, req, requestedAmount)` signature is identical across Task 1 (definition), Task 2 (route call site), and Task 6 (test expectations of the request body). The token event id `intent-binding-verified` and step id `intent-binding` are used consistently across Tasks 1, 4, 5, and 6.
- **Known gap flagged, not hidden:** Task 7 Step 4 explicitly calls out that this demo doesn't yet feed the live global `TokenChainContext`/trace store — only its own dedicated result panel — since wiring that in is more naturally scoped once the pattern is proven across more than one use case.
