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
    ActClientId: 'agent-1',
    TokenScopes: 'read write transfer',
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
  // Rule 2 is act-only now: baseParams' default actor ('agent-1') must be a
  // recognized authorized actor, not just may_act-matched.
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = 'agent-1';
  // NNP-6 thresholds — reset to defaults so tests don't bleed into each other.
  process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT = '250';
  process.env.SIMULATED_AUTHORIZE_STEPUP_AMOUNT = '500';
  process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT = '2000';
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

// NNP-6: HITL thresholds moved from ruleStore.hitlThresholdUsd to two separate env vars
// (SIMULATED_AUTHORIZE_CONFIRM_AMOUNT / SIMULATED_AUTHORIZE_STEPUP_AMOUNT). This test
// verifies the STEP_UP vs HITL_CONSENT split via env vars, with no overlay set.
test('amount above step-up threshold -> INDETERMINATE reason=STEP_UP (NNP-6)', async () => {
  process.env.SIMULATED_AUTHORIZE_STEPUP_AMOUNT = '5';
  process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT = '5';
  fresh(); // reload handler with new env
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams({ TransactionAmount: '10' }) } }, res);
  assert.strictEqual(res.body.decision, 'INDETERMINATE');
  assert.strictEqual(res.body.reason, 'STEP_UP');
});

// Bug fix (BUGS.md #18): ruleStore.hitlThresholdUsd is exposed as a live,
// admin-editable knob (PUT /rules), persists, and shows overridden:true, but Rule 4
// used to read only the env vars above and never consulted the overlay — an admin
// edit silently did nothing to live enforcement. It now overrides the CONFIRM_AMOUNT
// (HITL_CONSENT) tier, which is what the knob was always documented (routes/rules.js
// hitl-gate) to control; STEP_UP (MFA) is a separate, not-admin-editable control and
// stays env-only.
test('overlay hitlThresholdUsd overrides the HITL_CONSENT (confirm) tier at request time', async () => {
  // Env default (250) would normally PERMIT a $10 transfer; lower the admin
  // override below the transaction amount and confirm it now takes effect live.
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 5 } });
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams({ TransactionAmount: '10' }) } }, res);
  assert.strictEqual(res.body.decision, 'INDETERMINATE');
  assert.strictEqual(res.body.reason, 'HITL_CONSENT');
});

test('overlay hitlThresholdUsd does not leak into the STEP_UP (MFA) threshold', async () => {
  // Override the confirm tier far above the transaction amount so HITL_CONSENT
  // cannot fire; STEP_UP still uses its own env default (500, unset here). A $600
  // transfer must still hit STEP_UP — proving the overlay only wires CONFIRM_AMOUNT,
  // not STEP_UP_AMOUNT.
  ruleStore.applyPatch({ global: { hitlThresholdUsd: 5000 } });
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams({ TransactionAmount: '600' }) } }, res);
  assert.strictEqual(res.body.decision, 'INDETERMINATE');
  assert.strictEqual(res.body.reason, 'STEP_UP');
});

test('overriding requiredScopes flips PERMIT to DENY on missing scope', async () => {
  ruleStore.applyPatch({ tools: { create_transfer: { requiredScopes: ['read', 'write', 'admin:write'] } } });
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

test('act-only Rule 2: actor != authorized actor denies', async () => {
  ruleStore.applyPatch({ global: { authorizedActorClientId: 'agent-good' } });
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams({ ActClientId: 'agent-bad' }) } }, res);
  assert.strictEqual(res.body.decision, 'DENY');
});

test('with no overlay, a normal call still permits (regression)', async () => {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams() } }, res);
  assert.strictEqual(res.body.decision, 'PERMIT');
});
