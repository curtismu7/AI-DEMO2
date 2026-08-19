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

// ── The one seam the rework moves ────────────────────────────────────────────
// Today a pause is `decision=INDETERMINATE` + `reason=<kind>`. After the rework
// it becomes an obligation on a DENY/PERMIT. Rewrite THESE THREE helpers then —
// nothing below them.

function assertPauses(result, kind, label) {
  assert.strictEqual(
    result.decision, 'INDETERMINATE',
    `${label}: expected a PAUSE, got ${result.decision} (${result.reason})`
  );
  assert.strictEqual(
    result.reason, kind,
    `${label}: expected pause kind ${kind}, got ${result.reason}`
  );
}

function assertPermits(result, label) {
  assert.strictEqual(
    result.decision, 'PERMIT',
    `${label}: expected PERMIT, got ${result.decision} (${result.reason})`
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

// ── The two meanings, stated as a test ───────────────────────────────────────
// This is the defect the rework removes. While it still holds, it is recorded
// here so the day it stops holding is a visible, deliberate change rather than
// a silent one. Phase 4 (flip the PDP) is expected to REPLACE this test.

test('baseline: today a PAUSE is indistinguishable from an evaluation error by `decision` alone', async () => {
  const stepUp = await decide(paramsFor(VERTICAL_TOOLS[0], 600));
  const consent = await decide(paramsFor(VERTICAL_TOOLS[0], 300));

  // Both pauses carry the SAME decision value that cloud P1AZ uses for a failed
  // evaluation. Only `reason` separates them — which is the overload itself.
  assert.strictEqual(stepUp.decision, 'INDETERMINATE');
  assert.strictEqual(consent.decision, 'INDETERMINATE');
  assert.notStrictEqual(
    stepUp.reason, consent.reason,
    'the two pause kinds must remain distinguishable by reason'
  );
});
