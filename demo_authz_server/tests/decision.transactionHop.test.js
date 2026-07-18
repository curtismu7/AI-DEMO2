'use strict';

/**
 * Task 8 wiring gap (Important finding): the only test exercising transaction-hop
 * emission drove `emitHop()` in isolation (tests/transactionHop.test.js). Nothing
 * proved that driving a REAL decision through routes/decision.js actually produces
 * a hop with the right fields — a later task's invariant engine consumes
 * `decision.outcome` from these hops and its reconciler joins on
 * {correlationId, op, sub, outcome}, so a silently wrong outcome string or a
 * dropped tool/sub/actor would go uncaught.
 *
 * This file drives decisionHandler end-to-end (request in, JSON response out)
 * with a fetch double injected via transactionHop.__setFetchForTests, wrapped in
 * the same runWithCorrelation() the production correlationId middleware uses
 * (see ../decision.correlation.test.js), and asserts on the captured hop body.
 *
 * Request/response construction follows tests/decision.rar.test.js and
 * tests/decision-nnp3-nnp2.test.js (fresh() + decide()/makeRes() idiom).
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let OVERLAY;
let decisionHandler;
let userLookup;
let runWithCorrelation;
let transactionHop;
let calls;

function fresh() {
  for (const m of [
    '../ruleStore',
    '../pingOneUserLookup',
    '../routes/decision',
    '../scopeTopology',
    '../correlationContext',
    '../transactionHop',
    '../logger',
  ]) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  userLookup = require('../pingOneUserLookup');
  mock.method(userLookup, 'lookupUser', async () => ({ found: true, enabled: true, status: 'ACTIVE' }));
  ({ runWithCorrelation } = require('../correlationContext'));
  transactionHop = require('../transactionHop');
  decisionHandler = require('../routes/decision');
}

function makeRes() {
  return { body: null, json(b) { this.body = b; return this; } };
}

// Drives decisionHandler inside the same correlation scope the production
// correlationId middleware establishes per request, then flushes the
// fire-and-forget hop POST (mirrors tests/transactionHop.test.js's setImmediate
// flush — emitHop's fetch call is not awaited by the handler).
async function decide(params, correlationId) {
  const res = makeRes();
  await runWithCorrelation(correlationId, () =>
    decisionHandler({ params: { workerId: 'p' }, body: { parameters: params } }, res),
  );
  await new Promise((r) => setImmediate(r));
  return res.body;
}

// Base params that reach the final PERMIT (all guards pass). Proven combo —
// identical to decision-nnp3-nnp2.test.js's baseParams({ResourceOwnerId: ''}),
// which asserts PERMIT for this exact shape.
function baseWriteParams(extra) {
  return Object.assign({
    DecisionContext: 'McpToolCall',
    ToolName: 'update_contact_email',
    ClientId: 'user-alice',
    ActClientId: 'agent-1',
    TokenScopes: 'write',
    TokenAudience: 'test-aud',
    TokenAudActual: 'test-aud',
    TransactionAmount: '',
    ToAccountId: '',
    HitlApproved: '',
    ResourceOwnerId: '',
    RequiredGroup: '',
  }, extra || {});
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), 'dec-hop-' + process.pid + '-' + Math.floor(process.hrtime()[1]) + '.json');
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  // Rule 2 is act-only: the fixtures' baseline actor ('agent-1') must be a
  // recognized authorized actor.
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = 'agent-1';
  process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT = '2000';
  process.env.SIMULATED_AUTHORIZE_STEPUP_AMOUNT = '500';
  process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT = '250';
  process.env.BFF_TRANSACTION_HOP_URL = 'http://bff/internal/transaction-hop';
  process.env.BFF_INTERNAL_SECRET = 'sekrit';
  delete process.env.REQUIRE_ACT_FOR_AGENT_TOOLS;
  delete process.env.FF_RAR;
  delete process.env.FF_AUTHORIZE_GROUP_POLICY;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
  calls = [];
  transactionHop.__setFetchForTests(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true };
  });
});

afterEach(() => {
  transactionHop.__setFetchForTests(undefined);
  delete process.env.BFF_TRANSACTION_HOP_URL;
  delete process.env.BFF_INTERNAL_SECRET;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

test('WIRE-1: a PERMIT decision emits exactly one hop with phase/service/outcome/by', async () => {
  const body = await decide(baseWriteParams(), 'cid-permit-1');
  assert.strictEqual(body.decision, 'PERMIT', 'expected PERMIT: ' + JSON.stringify(body));
  assert.strictEqual(calls.length, 1, 'expected exactly one hop emitted');
  const hop = calls[0].body;
  assert.strictEqual(hop.phase, 'authz.decision');
  assert.strictEqual(hop.service, 'authz-server');
  assert.strictEqual(hop.decision.outcome, 'permit');
  assert.strictEqual(hop.decision.by, 'mock');
});

test('WIRE-2: a DENY decision emits a hop with outcome deny and carries the deny reason', async () => {
  // Resource-owner mismatch (proven DENY combo from decision-nnp3-nnp2.test.js).
  const body = await decide(
    baseWriteParams({ ResourceOwnerId: 'user-bob', ClientId: 'user-alice' }),
    'cid-deny-1',
  );
  assert.strictEqual(body.decision, 'DENY', 'expected DENY: ' + JSON.stringify(body));
  assert.strictEqual(calls.length, 1, 'expected exactly one hop emitted');
  const hop = calls[0].body;
  assert.strictEqual(hop.decision.outcome, 'deny');
  assert.ok(
    hop.decision.reason && hop.decision.reason.includes('resource_owner_mismatch'),
    'hop should carry the deny reason, got: ' + hop.decision.reason,
  );
  assert.strictEqual(hop.decision.reason, body.reason, 'hop reason must match the response reason');
});

test('WIRE-3: an INDETERMINATE decision emits outcome n/a, NOT deny (false-violation guard)', async () => {
  // Write-tool amount at/over the step-up threshold -> INDETERMINATE(STEP_UP).
  const body = await decide(
    baseWriteParams({
      ToolName: 'create_transfer',
      TokenScopes: 'write transfer',
      TransactionAmount: '600',
    }),
    'cid-indeterminate-1',
  );
  assert.strictEqual(body.decision, 'INDETERMINATE', 'expected INDETERMINATE: ' + JSON.stringify(body));
  assert.strictEqual(calls.length, 1, 'expected exactly one hop emitted');
  const hop = calls[0].body;
  assert.strictEqual(hop.decision.outcome, 'n/a', 'INDETERMINATE must map to n/a, not deny');
  assert.notStrictEqual(hop.decision.outcome, 'deny');
});

test('WIRE-4: the hop carries the correlation id and identity.sub/identity.act/op populated (not null)', async () => {
  const body = await decide(baseWriteParams(), 'cid-identity-1');
  assert.strictEqual(body.decision, 'PERMIT');
  assert.strictEqual(calls.length, 1);
  const hop = calls[0].body;
  assert.strictEqual(hop.correlationId, 'cid-identity-1');
  assert.strictEqual(hop.op, 'update_contact_email');
  assert.strictEqual(hop.identity.sub, 'user-alice');
  assert.deepStrictEqual(hop.identity.act, ['agent-1']);
});

test('WIRE-5: hop emission does not alter the decision response body shape', async () => {
  const body = await decide(baseWriteParams(), 'cid-shape-1');
  assert.strictEqual(body.decision, 'PERMIT');
  assert.strictEqual(typeof body.decision_id, 'string');
  assert.ok(body.decision_id.length > 0);
  assert.strictEqual(body.policy_version, 'mock-v1');
});
