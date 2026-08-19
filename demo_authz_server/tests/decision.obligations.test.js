'use strict';

/**
 * Obligation contract for a pause, spanning phase 2 (obligations introduced)
 * through phase 4 (INDETERMINATE retired — a pause is PERMIT+obligation).
 * Plan: docs/superpowers/plans/2026-08-18-indeterminate-rework.md
 *
 * Originally pinned `decision === 'INDETERMINATE'` for a pause as the
 * ADDITIVE, phase-2 contract ("nothing consumes the obligation yet"). Phase 4
 * changed that: this mock no longer emits INDETERMINATE at all (see
 * routes/decision.js's file-header comment and pausePermit()'s doc comment for
 * why PERMIT, not DENY, was the forced choice — a DENY-with-obligation is
 * silently dropped by both consumers of this endpoint). Updated in place
 * rather than deleted, since it is still the narrowest test of the obligation
 * SHAPE itself (id/type/obligatory/fulfilled) — the phase-1 baseline file's
 * `assertPauses` duplicates this at the higher, per-vertical level.
 *
 *   - every pause carries exactly one obligation, `obligatory: true` and
 *     `fulfilled: false` — the #1310 / llm-path-approval-gate traps say an
 *     "optional" pause is not a pause, so obligatory:false here is a bug;
 *   - a genuine PERMIT and a DENY both carry no obligations — which, post
 *     phase 4, is the ONLY thing distinguishing a real permit from a pause,
 *     since both now say `decision: 'PERMIT'`.
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

function params(amount, extra = {}) {
  return {
    DecisionContext: 'McpToolCall',
    ToolName: 'create_transfer',
    ClientId: 'user-1',
    ActClientId: 'agent-1',
    MayActSub: 'agent-1',
    TokenScopes: 'write transfer',
    TokenAudience: 'test-aud',
    TokenAudActual: 'test-aud',
    TransactionAmount: amount == null ? '' : String(amount),
    HitlApproved: '',
    ...extra,
  };
}

function assertObligation(result, id, type, label) {
  assert.ok(Array.isArray(result.obligations), `${label}: pause must carry an obligations array`);
  assert.strictEqual(result.obligations.length, 1, `${label}: exactly one obligation`);
  const o = result.obligations[0];
  assert.strictEqual(o.id, id, `${label}: obligation id`);
  assert.strictEqual(o.type, type, `${label}: obligation type`);
  assert.strictEqual(o.obligatory, true, `${label}: obligatory must be true (#1310 — an optional pause is not a pause)`);
  assert.strictEqual(o.fulfilled, false, `${label}: fulfilled must start false`);
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), 'dec-oblig-' + process.pid + '-' + Math.floor(process.hrtime()[1]) + '.json');
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = 'agent-1';
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

test('STEP_UP pause carries a single obligatory step-up obligation', async () => {
  const r = await decide(params(600));
  assert.strictEqual(r.decision, 'PERMIT', 'phase 4: a pause is PERMIT+obligation, never INDETERMINATE');
  assert.strictEqual(r.reason, 'STEP_UP');
  assertObligation(r, 'step-up', 'STEP_UP', '$600');
});

test('HITL_CONSENT pause carries a single obligatory hitl-consent obligation', async () => {
  const r = await decide(params(300));
  assert.strictEqual(r.decision, 'PERMIT', 'phase 4: a pause is PERMIT+obligation, never INDETERMINATE');
  assert.strictEqual(r.reason, 'HITL_CONSENT');
  assertObligation(r, 'hitl-consent', 'HITL_CONSENT', '$300');
});

test('ELICITATION pause carries a single obligatory elicitation obligation', async () => {
  const r = await decide(params(100, { ToolDestructive: 'true', ElicitationConfirmed: '' }));
  assert.strictEqual(r.decision, 'PERMIT', 'phase 4: a pause is PERMIT+obligation, never INDETERMINATE');
  assert.strictEqual(r.reason, 'ELICITATION');
  assertObligation(r, 'elicitation-confirm', 'ELICITATION', 'destructive');
});

test('PERMIT carries no obligations', async () => {
  const r = await decide(params(100));
  assert.strictEqual(r.decision, 'PERMIT');
  assert.strictEqual(r.obligations, undefined, 'PERMIT must not carry obligations');
});

test('DENY carries no obligations', async () => {
  const r = await decide(params(2500));
  assert.strictEqual(r.decision, 'DENY');
  assert.strictEqual(r.obligations, undefined, 'DENY must not carry obligations');
});
