'use strict';

/**
 * CHARACTERISATION BASELINE — phase 1 of the INDETERMINATE rework.
 * Plan: docs/superpowers/plans/2026-08-18-indeterminate-rework.md
 *
 * WHY THIS EXISTS
 * ---------------
 * `INDETERMINATE` currently carries two unrelated meanings: from cloud PingOne
 * Authorize it means "evaluation FAILED" (fail closed), while this server
 * returns it deliberately as a PAUSE (`reason=STEP_UP` / `HITL_CONSENT`) that
 * UC7 and UC8 are built on. The rework (Option B) moves the pause onto
 * obligations so INDETERMINATE can mean only "error".
 *
 * This file freezes WHICH REQUESTS PAUSE, before anything moves. It is written
 * so the rework changes the SHAPE of the assertion in exactly one place — the
 * `assertPauses` / `assertPermits` / `assertDenies` helpers below — while the
 * per-band, per-vertical table stays byte-identical. If a later phase has to
 * edit the table, the rework changed behaviour, which is the thing this test
 * exists to catch.
 *
 * DO NOT "fix" a failure here by editing the expected band. Per the plan:
 * the table encodes the contract, not the implementation.
 *
 * WHAT IS FROZEN
 * --------------
 * The live baseline captured 2026-08-18 against the running stack (four amount
 * bands), asserted here against every vertical's amount-bearing write tool:
 *
 *   $2500 -> DENY          amount_exceeds_ceiling ($2000 absolute limit)
 *   $600  -> PAUSE/STEP_UP       (>= $500 step-up threshold)
 *   $300  -> PAUSE/HITL_CONSENT  ($250..$499 confirm band)
 *   $100  -> PERMIT              (below both thresholds)
 *
 * The tool set deliberately mixes `challengeType: 'consent'` and `'step_up'`
 * tools. Today the amount bands IGNORE the tool's declared challengeType (the
 * `declaresStepUp`/`declaresConsent` branches require `!hasAmount`), so all
 * tools band identically. That independence is itself part of the contract:
 * the rework must not let a tool's declared challengeType leak into the
 * amount path.
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

// ── The seam the rework moves — REWRITTEN for phase 4 ────────────────────────
// Before phase 4: a pause was `decision=INDETERMINATE` + `reason=<kind>`.
// After phase 4: a pause is `decision=PERMIT` carrying an unfulfilled
// `obligations[]` entry of type <kind> — matching live cloud PingOne Authorize
// for these three cases (confirmed live, probe-uc7-uc8-live.js) and the shape
// forced by both consumers of this endpoint (a DENY-with-obligation is
// silently dropped by each — see routes/decision.js's pausePermit() doc
// comment). `decision=PERMIT` alone is no longer sufficient to prove "really
// permitted" — assertPermits below must also prove NO obligation rode along,
// or it would pass on a pause by accident.

function assertPauses(result, kind, label) {
  assert.strictEqual(
    result.decision, 'PERMIT',
    `${label}: expected a PAUSE (PERMIT+obligation), got ${result.decision} (${result.reason})`
  );
  assert.strictEqual(
    result.reason, kind,
    `${label}: expected pause kind ${kind}, got ${result.reason}`
  );
  assert.ok(
    Array.isArray(result.obligations) && result.obligations.length === 1,
    `${label}: expected exactly one obligation, got ${JSON.stringify(result.obligations)}`
  );
  const ob = result.obligations[0];
  assert.strictEqual(ob.type, kind, `${label}: obligation type mismatch`);
  assert.strictEqual(ob.obligatory, true, `${label}: obligatory must be true — an "optional" pause is not a pause (#1310)`);
  assert.strictEqual(ob.fulfilled, false, `${label}: a freshly-issued pause cannot already be fulfilled`);
}

function assertPermits(result, label) {
  assert.strictEqual(
    result.decision, 'PERMIT',
    `${label}: expected PERMIT, got ${result.decision} (${result.reason})`
  );
  // The half of this check phase 4 makes necessary: PERMIT is now ALSO what a
  // pause returns, so proving "really permitted" means proving no obligation
  // rode along, not just checking the decision string.
  assert.ok(
    !result.obligations || result.obligations.length === 0,
    `${label}: expected a genuine PERMIT with no obligation, got ${JSON.stringify(result.obligations)}`
  );
}

function assertDenies(result, reasonFragment, label) {
  assert.strictEqual(
    result.decision, 'DENY',
    `${label}: expected DENY, got ${result.decision} (${result.reason})`
  );
  assert.ok(
    String(result.reason || '').includes(reasonFragment),
    `${label}: expected reason to include "${reasonFragment}", got ${result.reason}`
  );
}

// ── The table: one amount-bearing write tool per vertical ────────────────────
// Every entry is a non-a2aDelegated write tool, so no ActChainDepth applies and
// Rule 4 (the pause band) is genuinely the rule under test.
const VERTICAL_TOOLS = [
  { vertical: 'banking',        tool: 'create_transfer',     scopes: 'write transfer', challengeType: 'consent' },
  { vertical: 'retail',         tool: 'checkout',            scopes: 'write',          challengeType: 'consent' },
  { vertical: 'healthcare',     tool: 'release_records',     scopes: 'write',          challengeType: 'step_up' },
  { vertical: 'sporting-goods', tool: 'transfer_membership', scopes: 'write',          challengeType: 'step_up' },
  { vertical: 'investment',     tool: 'large_trade',         scopes: 'write',          challengeType: 'step_up' },
];

function paramsFor(entry, amount) {
  return {
    DecisionContext: 'McpToolCall',
    ToolName: entry.tool,
    ClientId: 'user-1',
    ActClientId: 'agent-1',
    MayActSub: 'agent-1',
    TokenScopes: entry.scopes,
    TokenAudience: 'test-aud',
    TokenAudActual: 'test-aud',
    TransactionAmount: String(amount),
    HitlApproved: '',
  };
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), 'dec-indet-' + process.pid + '-' + Math.floor(process.hrtime()[1]) + '.json');
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = 'agent-1';
  // The thresholds the baseline was captured against. Pinned explicitly so an
  // env change elsewhere cannot silently move the bands under this test.
  process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT = '2000';
  process.env.SIMULATED_AUTHORIZE_STEPUP_AMOUNT = '500';
  process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT = '250';
  delete process.env.PINGONE_ENVIRONMENT_ID;
  delete process.env.REQUIRE_ACT_FOR_AGENT_TOOLS;
  try { fs.unlinkSync(OVERLAY); } catch (e) { /* ignore */ }
  fresh();
});

afterEach(() => {
  try { fs.unlinkSync(OVERLAY); } catch (e) { /* ignore */ }
});

for (const entry of VERTICAL_TOOLS) {
  const label = `${entry.vertical}/${entry.tool}`;

  test(`baseline ${label}: $2500 -> DENY (above the $2000 ceiling)`, async () => {
    assertDenies(await decide(paramsFor(entry, 2500)), 'amount_exceeds_ceiling', label);
  });

  test(`baseline ${label}: $600 -> PAUSE for STEP_UP`, async () => {
    assertPauses(await decide(paramsFor(entry, 600)), 'STEP_UP', label);
  });

  test(`baseline ${label}: $300 -> PAUSE for HITL_CONSENT`, async () => {
    assertPauses(await decide(paramsFor(entry, 300)), 'HITL_CONSENT', label);
  });

  test(`baseline ${label}: $100 -> PERMIT (below both thresholds)`, async () => {
    assertPermits(await decide(paramsFor(entry, 100)), label);
  });
}

// ── Band edges ───────────────────────────────────────────────────────────────
// The thresholds are inclusive lower bounds (`amount >= X`). Frozen because an
// off-by-one here silently moves which transactions prompt a human.

test('baseline edges: $500 exactly -> STEP_UP, $499.99 -> HITL_CONSENT', async () => {
  const entry = VERTICAL_TOOLS[0];
  assertPauses(await decide(paramsFor(entry, 500)), 'STEP_UP', 'edge $500');
  assertPauses(await decide(paramsFor(entry, 499.99)), 'HITL_CONSENT', 'edge $499.99');
});

test('baseline edges: $250 exactly -> HITL_CONSENT, $249.99 -> PERMIT', async () => {
  const entry = VERTICAL_TOOLS[0];
  assertPauses(await decide(paramsFor(entry, 250)), 'HITL_CONSENT', 'edge $250');
  assertPermits(await decide(paramsFor(entry, 249.99)), 'edge $249.99');
});

// NOTE — the ceiling is EXCLUSIVE (`txAmount > DENY_CEILING_USD`, decision.js
// ~795) while both pause thresholds are INCLUSIVE (`amount >= X`, ~907-911).
// So $2000 exactly is NOT denied — it falls through to STEP_UP. That asymmetry
// was verified against the code, not assumed: an earlier draft of this test
// asserted DENY at $2000 and failed. Recorded deliberately; if the rework
// normalises the comparisons, this is the test that will say so.
test('baseline edges: $2000 exactly is NOT denied — ceiling is exclusive, so it pauses for STEP_UP', async () => {
  const entry = VERTICAL_TOOLS[0];
  assertPauses(await decide(paramsFor(entry, 2000)), 'STEP_UP', 'edge $2000');
  assertDenies(await decide(paramsFor(entry, 2000.01)), 'amount_exceeds_ceiling', 'edge $2000.01');
});

// ── The two meanings, no longer conflated — phase 4's replacement test ───────
// The original version of this test recorded the DEFECT: both pauses carried
// `decision: 'INDETERMINATE'`, the same value cloud P1AZ uses for "evaluation
// failed" — indistinguishable by decision alone. Phase 4 removed the overload
// at the source: this mock literally cannot emit `decision: 'INDETERMINATE'`
// anymore (grep the whole file — the only remaining occurrence is a doc
// comment). This test now proves the replacement property instead of the
// defect: every pause is PERMIT, distinguishable from a genuine PERMIT only by
// the presence of an obligation, and the two pause kinds stay distinguishable
// from EACH OTHER by that obligation's type.

test('phase 4: pauses are PERMIT+obligation, never INDETERMINATE, and stay distinguishable by obligation type', async () => {
  const stepUp = await decide(paramsFor(VERTICAL_TOOLS[0], 600));
  const consent = await decide(paramsFor(VERTICAL_TOOLS[0], 300));
  const permit = await decide(paramsFor(VERTICAL_TOOLS[0], 100));

  for (const [label, r] of [['step-up', stepUp], ['consent', consent], ['permit', permit]]) {
    assert.notStrictEqual(r.decision, 'INDETERMINATE', `${label}: this mock must never emit INDETERMINATE (phase 4)`);
    assert.strictEqual(r.decision, 'PERMIT', `${label}: expected PERMIT`);
  }

  assert.notStrictEqual(
    stepUp.obligations[0].type, consent.obligations[0].type,
    'the two pause kinds must remain distinguishable by obligation type'
  );
  assert.ok(
    !permit.obligations || permit.obligations.length === 0,
    'a genuine permit must carry no obligation — otherwise it is indistinguishable from a pause'
  );
});

// Structural guard for the mock half of phase 5: since this engine has no
// external attribute sources, it cannot fail to evaluate the way cloud P1AZ
// can — so it must never claim it did. A future code path that reintroduces
// `decision: 'INDETERMINATE'` breaks this, which is the point: the property
// phase 5 wants ("a bare INDETERMINATE is always an error") holds here as a
// STRUCTURAL fact, not a runtime check, because the value is unreachable.
test('phase 5 (mock half): grep-equivalent guard — this file never emits decision: INDETERMINATE', () => {
  const src = fs.readFileSync(require.resolve('../routes/decision.js'), 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(
    !/decision:\s*'INDETERMINATE'/.test(codeOnly),
    'routes/decision.js must not construct a decision:\'INDETERMINATE\' response — ' +
    'that value is reserved for a genuine evaluation failure this simulator cannot produce'
  );
});
