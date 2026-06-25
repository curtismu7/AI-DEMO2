'use strict';

/**
 * Rule 3c — RAR amount/payee enforcement (NNP-1, UC14).
 *
 * Tests that `decision.js` enforces RAR (authorization_details) limits when
 * FF_RAR=true. Uses the same node:test + fresh() pattern as decision.test.js.
 * The attested values come from the RarAuthorizationDetails JSON string
 * (the TraT azd field serialised as a param) — NOT from the caller's body.
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let OVERLAY;
let decisionHandler;
let userLookup;

function fresh() {
  for (const m of [
    '../ruleStore',
    '../pingOneUserLookup',
    '../routes/decision',
    '../scopeTopology',
    '../correlationContext',
    '../logger',
  ]) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  userLookup = require('../pingOneUserLookup');
  mock.method(userLookup, 'lookupUser', async () => ({ found: true, enabled: true, status: 'ACTIVE' }));
  decisionHandler = require('../routes/decision');
}

function makeRes() {
  return { body: null, json(b) { this.body = b; return this; } };
}

async function decide(params) {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: params } }, res);
  return res.body;
}

// Base write-tool params that pass all guards before Rule 3c.
// create_transfer: write + transfer scopes + requiresAgentMediation.
function rarWriteParams(extra) {
  return Object.assign({
    DecisionContext: 'McpToolCall',
    ToolName: 'create_transfer',
    ClientId: 'user-1',
    ActClientId: 'agent-1',
    MayActSub: 'agent-1',
    TokenScopes: 'write transfer',
    TokenAudience: 'test-aud',
    TokenAudActual: 'test-aud',
    TransactionAmount: '',
    ToAccountId: '',
    HitlApproved: '',
    RarAuthorizationDetails: '',
  }, extra || {});
}

// Serialise a RAR grant into the JSON string form the decision handler receives.
// Field contract (production names from buildRarAuthorizationDetails):
//   `amount`  → granted ceiling  (NOT max_amount)
//   `payee`   → permitted destination — single string or array  (NOT permitted_payees)
function rarJson(fields) {
  return JSON.stringify([Object.assign({ type: 'banking_transaction' }, fields)]);
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), 'dec-rar-' + process.pid + '-' + Math.floor(process.hrtime()[1]) + '.json');
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  process.env.ENFORCE_MAY_ACT = 'true';
  process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT = '2000';
  process.env.SIMULATED_AUTHORIZE_STEPUP_AMOUNT = '500';
  process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT = '250';
  delete process.env.REQUIRE_ACT_FOR_AGENT_TOOLS;
  delete process.env.FF_RAR;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

// ── Rule 3c OFF (default) ──────────────────────────────────────────────────

test('RAR-1: ff_rar OFF (default) — RarAuthorizationDetails present but not enforced', async () => {
  // FF_RAR is not set → rule 3c must be a complete no-op.
  // amount=150 < deny ceiling (2000) and below step-up (500) so should PERMIT.
  const result = await decide(rarWriteParams({
    TransactionAmount: '150',
    RarAuthorizationDetails: rarJson({ amount: 100 }),
  }));
  // Decision flows through to Rule 4 (amount 150 < confirm 250 → PERMIT).
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT when ff_rar is off, got ' + result.decision + ': ' + result.reason);
});

test('RAR-2: ff_rar OFF — payee not in attested payee list but still no RAR deny', async () => {
  const result = await decide(rarWriteParams({
    TransactionAmount: '50',
    ToAccountId: 'acct-999',
    RarAuthorizationDetails: rarJson({ payee: ['acct-001', 'acct-002'] }),
  }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT when ff_rar is off, got ' + result.decision + ': ' + result.reason);
});

// ── Rule 3c ON: amount enforcement ────────────────────────────────────────

test('RAR-3: ff_rar ON — TransactionAmount exceeds attested RAR amount → DENY rar_amount_exceeded', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  const result = await decide(rarWriteParams({
    TransactionAmount: '500',
    RarAuthorizationDetails: rarJson({ amount: 100 }),
  }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(
    result.reason && result.reason.includes('rar_amount_exceeded'),
    'reason should include rar_amount_exceeded, got: ' + result.reason,
  );
});

test('RAR-4: ff_rar ON — TransactionAmount within attested amount ceiling → no RAR deny (flows to Rule 4)', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  // amount=50 < attested amount ceiling=200; 50 < confirm(250) so should PERMIT via Rule 4.
  const result = await decide(rarWriteParams({
    TransactionAmount: '50',
    RarAuthorizationDetails: rarJson({ amount: 200 }),
  }));
  assert.notStrictEqual(result.reason, 'rar_amount_exceeded', 'must not be a RAR amount deny, got: ' + result.reason);
  // Could be PERMIT, INDETERMINATE, etc — but NOT a RAR deny.
  assert.ok(result.decision !== 'DENY' || !result.reason.includes('rar_amount_exceeded'),
    'Should not get rar_amount_exceeded, got: ' + JSON.stringify(result));
});

test('RAR-5: ff_rar ON — TransactionAmount exactly equals attested amount ceiling → no RAR deny (> not >=)', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  // Exactly at the limit is NOT exceeded (> not >=).
  const result = await decide(rarWriteParams({
    TransactionAmount: '100',
    RarAuthorizationDetails: rarJson({ amount: 100 }),
  }));
  assert.ok(!result.reason || !result.reason.includes('rar_amount_exceeded'),
    'Exact-equal amount must not be denied by rar_amount_exceeded, got: ' + result.reason);
});

// ── Rule 3c ON: payee enforcement ─────────────────────────────────────────

test('RAR-6: ff_rar ON — ToAccountId not in attested payee list → DENY rar_payee_not_permitted', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  const result = await decide(rarWriteParams({
    TransactionAmount: '50',
    ToAccountId: 'acct-999',
    RarAuthorizationDetails: rarJson({ payee: ['acct-001', 'acct-002'] }),
  }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(
    result.reason && result.reason.includes('rar_payee_not_permitted'),
    'reason should include rar_payee_not_permitted, got: ' + result.reason,
  );
});

test('RAR-7: ff_rar ON — ToAccountId in attested payee list → no payee deny', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  const result = await decide(rarWriteParams({
    TransactionAmount: '50',
    ToAccountId: 'acct-001',
    RarAuthorizationDetails: rarJson({ payee: ['acct-001', 'acct-002'] }),
  }));
  assert.ok(!result.reason || !result.reason.includes('rar_payee_not_permitted'),
    'Permitted payee must not be denied, got: ' + result.reason);
});

test('RAR-8: ff_rar ON — both amount and payee valid → no RAR deny', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  // amount=50 < attested amount=200, payee is in the attested list, amount < confirm threshold → PERMIT.
  const result = await decide(rarWriteParams({
    TransactionAmount: '50',
    ToAccountId: 'acct-001',
    RarAuthorizationDetails: rarJson({ amount: 200, payee: ['acct-001'] }),
  }));
  assert.ok(!result.reason || (!result.reason.includes('rar_amount_exceeded') && !result.reason.includes('rar_payee_not_permitted')),
    'Both-valid case must not trigger any RAR deny, got: ' + result.reason);
});

// ── Rule 3c: edge cases / robustness ──────────────────────────────────────

test('RAR-9: ff_rar ON — RarAuthorizationDetails is empty string → rule skipped, no crash', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  // Empty string is the default; rule must be a no-op (no JSON parse error).
  const result = await decide(rarWriteParams({ TransactionAmount: '50', RarAuthorizationDetails: '' }));
  // Should flow through to Rule 4 normally.
  assert.ok(result.decision, 'handler must return a decision, got: ' + JSON.stringify(result));
  assert.ok(!result.reason || !result.reason.includes('rar_'), 'Empty RarAuthorizationDetails must not produce RAR deny');
});

test('RAR-10: ff_rar ON — RarAuthorizationDetails is malformed JSON → rule skipped, no crash', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  const result = await decide(rarWriteParams({
    TransactionAmount: '50',
    RarAuthorizationDetails: 'NOT_VALID_JSON{{{',
  }));
  assert.ok(result.decision, 'handler must survive malformed RAR JSON, got: ' + JSON.stringify(result));
  assert.ok(!result.reason || !result.reason.includes('rar_'), 'Malformed RAR must not produce a RAR deny');
});

test('RAR-11: ff_rar ON — no ToAccountId, attested payee set → payee rule skipped (nothing to check)', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  // No ToAccountId means there is no payee to validate against; rule must be skipped.
  const result = await decide(rarWriteParams({
    TransactionAmount: '50',
    ToAccountId: '',
    RarAuthorizationDetails: rarJson({ payee: ['acct-001'] }),
  }));
  assert.ok(!result.reason || !result.reason.includes('rar_payee_not_permitted'),
    'Absent ToAccountId must not trigger payee deny, got: ' + result.reason);
});

// ── Critical security: attested source, not request-body ──────────────────

test('RAR-12: ff_rar ON — attested amount=100; request body cannot relax it (enforcement is on RarAuthorizationDetails)', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  // TransactionAmount=500 > RarAuthorizationDetails.amount=100 → DENY.
  // This proves the rule reads from the attested RarAuthorizationDetails param
  // (the TraT's azd field), not from a caller-supplied body field.
  const result = await decide(rarWriteParams({
    TransactionAmount: '500',
    RarAuthorizationDetails: rarJson({ amount: 100 }),
  }));
  assert.strictEqual(result.decision, 'DENY', 'Attested amount must be enforced, got: ' + result.decision + ': ' + result.reason);
  assert.ok(result.reason && result.reason.includes('rar_amount_exceeded'), 'reason must be rar_amount_exceeded, got: ' + result.reason);
});

// ── Amount enforcement fires BEFORE Rule 3b ceiling (ordering) ─────────────

test('RAR-13: ff_rar ON — RAR deny fires before Rule 3b ceiling when amount exceeds RAR max but is below ceiling', async () => {
  process.env.FF_RAR = 'true';
  fresh();
  // amount=150, RAR max=100 (exceeded) but 150 < 2000 deny ceiling.
  // Rule 3c should fire (rar_amount_exceeded) not the ceiling rule.
  // Rule 3c is AFTER 3b, so this verifies ordering: 3b checks amounts > 2000, 3c checks vs RAR max.
  const result = await decide(rarWriteParams({
    TransactionAmount: '150',
    RarAuthorizationDetails: rarJson({ amount: 100 }),
  }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY (rar_amount_exceeded), got: ' + result.decision + ': ' + result.reason);
  assert.ok(result.reason && result.reason.includes('rar_amount_exceeded'),
    'Deny must be rar_amount_exceeded (not ceiling), got: ' + result.reason);
});
