'use strict';

/**
 * Plan C Part A tests — NNP-5 (hard-deny ceiling) + NNP-6 (STEP_UP vs HITL_CONSENT split).
 *
 * Uses the same node:test + mock pattern as decision.a2a.test.js.
 * Each test group sets env vars BEFORE fresh() so the handler loads them
 * at require-time via the module-level constants.
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
  // Clear all relevant modules from cache so env changes take effect.
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

// Base params that pass all guards before Rule 3b / Rule 4.
// create_transfer has write+transfer scopes + challengeType:step_up + requiresAgentMediation.
function writeParams(extra) {
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
    HitlApproved: '',
  }, extra || {});
}

// get_my_accounts is read-only (requiredScopes:["read"]), no challengeType.
function readParams(extra) {
  return Object.assign({
    DecisionContext: 'McpToolCall',
    ToolName: 'get_my_accounts',
    ClientId: 'user-1',
    ActClientId: 'agent-1',
    MayActSub: 'agent-1',
    TokenScopes: 'read',
    TokenAudience: 'test-aud',
    TokenAudActual: 'test-aud',
    TransactionAmount: '',
    HitlApproved: '',
  }, extra || {});
}

// book_appointment: write + challengeType:consent, no amount.
function consentOnlyParams(extra) {
  return Object.assign({
    DecisionContext: 'McpToolCall',
    ToolName: 'book_appointment',
    ClientId: 'user-1',
    ActClientId: 'agent-1',
    MayActSub: 'agent-1',
    TokenScopes: 'write',
    TokenAudience: 'test-aud',
    TokenAudActual: 'test-aud',
    TransactionAmount: '',
    HitlApproved: '',
  }, extra || {});
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), 'dec-partA-' + process.pid + '-' + Math.floor(process.hrtime()[1]) + '.json');
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  process.env.ENFORCE_MAY_ACT = 'true';
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

// ── NNP-5: Hard-DENY ceiling ───────────────────────────────────────────────

test('NNP-5 A-1: write tool, amount=2500 (> deny ceiling 2000) -> DENY with amount_exceeds_ceiling', async () => {
  const result = await decide(writeParams({ TransactionAmount: '2500' }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(result.reason.includes('amount_exceeds_ceiling'), 'reason should include amount_exceeds_ceiling, got: ' + result.reason);
});

test('NNP-5 A-2: write tool, amount=1000 (< deny ceiling 2000) -> not denied by ceiling rule', async () => {
  // 1000 is above step-up threshold (500) so should get INDETERMINATE STEP_UP, not DENY
  const result = await decide(writeParams({ TransactionAmount: '1000' }));
  assert.strictEqual(result.decision, 'INDETERMINATE', 'Expected INDETERMINATE, got ' + result.decision + ': ' + result.reason);
  assert.strictEqual(result.reason, 'STEP_UP', 'reason should be STEP_UP, got: ' + result.reason);
});

test('NNP-5 A-3: read tool, amount=2500 -> PERMIT (not a write tool, ceiling rule does not apply)', async () => {
  const result = await decide(readParams({ TransactionAmount: '2500' }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});

// ── NNP-6: STEP_UP vs HITL_CONSENT split ─────────────────────────────────

test('NNP-6 A-4: write tool, amount=600 (>= step-up 500) -> INDETERMINATE reason=STEP_UP', async () => {
  const result = await decide(writeParams({ TransactionAmount: '600' }));
  assert.strictEqual(result.decision, 'INDETERMINATE', 'Expected INDETERMINATE, got ' + result.decision);
  assert.strictEqual(result.reason, 'STEP_UP', 'Expected STEP_UP, got: ' + result.reason);
});

test('NNP-6 A-5: write tool, amount=300 (>= confirm 250, < step-up 500) -> INDETERMINATE reason=HITL_CONSENT', async () => {
  const result = await decide(writeParams({ TransactionAmount: '300' }));
  assert.strictEqual(result.decision, 'INDETERMINATE', 'Expected INDETERMINATE, got ' + result.decision);
  assert.strictEqual(result.reason, 'HITL_CONSENT', 'Expected HITL_CONSENT, got: ' + result.reason);
});

test('NNP-6 A-6: write tool, amount=100 (< confirm 250) -> PERMIT', async () => {
  const result = await decide(writeParams({ TransactionAmount: '100' }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});

test('NNP-6 A-7: consent-only tool (book_appointment), no amount -> INDETERMINATE reason=HITL_CONSENT', async () => {
  const result = await decide(consentOnlyParams());
  assert.strictEqual(result.decision, 'INDETERMINATE', 'Expected INDETERMINATE, got ' + result.decision);
  assert.strictEqual(result.reason, 'HITL_CONSENT', 'Expected HITL_CONSENT, got: ' + result.reason);
});

test('NNP-6 A-7b: step-up tool (release_records), no amount -> INDETERMINATE reason=STEP_UP (not HITL_CONSENT)', async () => {
  // F3 regression: no-amount step-up tools must map to STEP_UP, not collapse
  // into HITL_CONSENT — parity with the P1AZ snapshot RequiresMcpStepUp.
  const result = await decide(consentOnlyParams({ ToolName: 'release_records' }));
  assert.strictEqual(result.decision, 'INDETERMINATE', 'Expected INDETERMINATE, got ' + result.decision);
  assert.strictEqual(result.reason, 'STEP_UP', 'Expected STEP_UP, got: ' + result.reason);
});

test('NNP-6 A-7c: step-up tool, no amount, HitlApproved=true -> STEP_UP (receipt cannot satisfy MFA, IMP-3)', async () => {
  const result = await decide(consentOnlyParams({ ToolName: 'release_records', HitlApproved: 'true' }));
  assert.strictEqual(result.decision, 'INDETERMINATE', 'Expected INDETERMINATE, got ' + result.decision);
  assert.strictEqual(result.reason, 'STEP_UP', 'Expected STEP_UP, got: ' + result.reason);
});

test('NNP-6 A-8: write tool, amount=300 (would need HITL_CONSENT), HitlApproved=true -> PERMIT', async () => {
  const result = await decide(writeParams({ TransactionAmount: '300', HitlApproved: 'true' }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});

// ── Regression: STEP_UP beats HITL_CONSENT (highest-gate-wins) ───────────

test('REG-1: amount exactly at step-up threshold (500) -> STEP_UP, not HITL_CONSENT', async () => {
  const result = await decide(writeParams({ TransactionAmount: '500' }));
  assert.strictEqual(result.decision, 'INDETERMINATE');
  assert.strictEqual(result.reason, 'STEP_UP');
});

test('REG-2: amount just below step-up (499) but above confirm (250) -> HITL_CONSENT', async () => {
  const result = await decide(writeParams({ TransactionAmount: '499' }));
  assert.strictEqual(result.decision, 'INDETERMINATE');
  assert.strictEqual(result.reason, 'HITL_CONSENT');
});

test('REG-3: amount exactly at deny ceiling (2000) -> not ceiling-denied (> not >=)', async () => {
  // Ceiling is strictly >, so exactly 2000 should proceed to STEP_UP
  const result = await decide(writeParams({ TransactionAmount: '2000' }));
  assert.strictEqual(result.decision, 'INDETERMINATE', 'Expected INDETERMINATE (STEP_UP), got ' + result.decision + ': ' + result.reason);
  assert.strictEqual(result.reason, 'STEP_UP');
});

// ── isAgentMediatedTool() unit checks via scopeTopology ───────────────────

// ── IMP-3 / IMP-1 / IMP-2 parity tests ───────────────────────────────────

test('IMP-3: amount=600 + HitlApproved=true + weak ACR -> STEP_UP (receipt does NOT discharge MFA)', async () => {
  // HITL receipt must NEVER satisfy MFA: STEP_UP fires regardless of hitlApproved.
  const result = await decide(writeParams({ TransactionAmount: '600', HitlApproved: 'true', Acr: '' }));
  assert.strictEqual(result.decision, 'INDETERMINATE', 'Expected INDETERMINATE, got ' + result.decision + ': ' + result.reason);
  assert.strictEqual(result.reason, 'STEP_UP', 'Expected STEP_UP (receipt must not suppress MFA), got: ' + result.reason);
});

test('IMP-3: amount=300 + HitlApproved=true + weak ACR -> PERMIT (receipt discharges consent)', async () => {
  // HITL receipt DOES discharge HITL_CONSENT: 300 >= confirm(250) but receipt present -> PERMIT.
  const result = await decide(writeParams({ TransactionAmount: '300', HitlApproved: 'true', Acr: '' }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT (receipt discharges consent), got ' + result.decision + ': ' + result.reason);
});

test('IMP-1: amount=600 + strong ACR -> PERMIT (ACR bypass skips STEP_UP)', async () => {
  // Strong ACR means user already did MFA: both STEP_UP and HITL_CONSENT candidates are skipped.
  const result = await decide(writeParams({ TransactionAmount: '600', Acr: 'mfa' }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT (strong ACR bypasses STEP_UP), got ' + result.decision + ': ' + result.reason);
});

test('IMP-1: amount=300 + strong ACR -> PERMIT (ACR bypass skips HITL_CONSENT)', async () => {
  // Strong ACR means user already did MFA: HITL_CONSENT candidate is skipped.
  const result = await decide(writeParams({ TransactionAmount: '300', Acr: 'mfa' }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT (strong ACR bypasses HITL_CONSENT), got ' + result.decision + ': ' + result.reason);
});

test('scopeTopology.isAgentMediatedTool: create_transfer -> true', () => {
  const st = require('../scopeTopology');
  assert.strictEqual(st.isAgentMediatedTool('create_transfer'), true);
});

test('scopeTopology.isAgentMediatedTool: get_my_accounts -> false (read-only, not flagged)', () => {
  const st = require('../scopeTopology');
  assert.strictEqual(st.isAgentMediatedTool('get_my_accounts'), false);
});

test('scopeTopology.isAgentMediatedTool: unknown_tool -> false (fail-open)', () => {
  const st = require('../scopeTopology');
  assert.strictEqual(st.isAgentMediatedTool('unknown_tool'), false);
});

test('scopeTopology.isAgentMediatedTool: empty string -> false', () => {
  const st = require('../scopeTopology');
  assert.strictEqual(st.isAgentMediatedTool(''), false);
});

// ── UC16: Require-act for agent-mediated tools ────────────────────────────

// create_transfer is agent-mediated (requiresAgentMediation: true in scope-topology.json).
// These tests toggle REQUIRE_ACT_FOR_AGENT_TOOLS and verify Rule 2.5 behaviour.
// Note: each test calls fresh() inside beforeEach which re-reads env vars at module load.

test('UC16 B-1: flag ON + agent-mediated tool + no ActClientId -> DENY missing_act', async () => {
  process.env.REQUIRE_ACT_FOR_AGENT_TOOLS = 'true';
  fresh();
  // No ActClientId (empty) — impersonation attempt
  const result = await decide(writeParams({ ActClientId: '', MayActSub: '', TransactionAmount: '100' }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(result.reason.includes('missing_act'), 'reason should include missing_act, got: ' + result.reason);
});

test('UC16 B-2: flag ON + agent-mediated tool + ActClientId present -> not denied by UC16 rule', async () => {
  process.env.REQUIRE_ACT_FOR_AGENT_TOOLS = 'true';
  fresh();
  // ActClientId present — proper delegation, should proceed past UC16 gate
  const result = await decide(writeParams({ TransactionAmount: '100' }));
  // 100 is below confirm threshold → PERMIT
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT (act present), got ' + result.decision + ': ' + result.reason);
});

test('UC16 B-3: flag OFF + agent-mediated tool + no ActClientId -> not denied by UC16 rule', async () => {
  // REQUIRE_ACT_FOR_AGENT_TOOLS is deleted in beforeEach → flag is OFF
  fresh();
  // No ActClientId but flag off — falls through to normal path
  const result = await decide(writeParams({ ActClientId: '', MayActSub: '', TransactionAmount: '100' }));
  // With ENFORCE_MAY_ACT=true and ActClientId empty → no delegation, passes may_act check (no actor = no delegation to validate)
  assert.notStrictEqual(result.decision, 'DENY', 'Should not get UC16 DENY when flag is OFF, got: ' + result.reason);
  // Expect PERMIT (amount 100 < confirm 250, no actor = clean path)
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT when flag OFF, got ' + result.decision + ': ' + result.reason);
});

test('UC16 B-4: flag ON + NON-agent-mediated tool + no ActClientId -> not denied by UC16 rule', async () => {
  process.env.REQUIRE_ACT_FOR_AGENT_TOOLS = 'true';
  fresh();
  // get_my_accounts is read-only and NOT agent-mediated — UC16 must not block it
  const result = await decide(readParams({ ActClientId: '', MayActSub: '' }));
  assert.notStrictEqual(result.decision, 'DENY', 'UC16 must not fire for non-agent-mediated tool, got: ' + result.reason);
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT for non-agent-mediated tool, got ' + result.decision + ': ' + result.reason);
});

// ── NNP-8 tier capability (UC21) — Rule 3d ───────────────────────────────────

// Helper: base params for tier tests (write tool, passes all earlier guards when flag is off)
function tierParams(extra) {
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
    HitlApproved: '',
    UserGroups: '',
    RequiredGroup: '',
  }, extra || {});
}

// T3-1: flag OFF (default) — tier check is inert even when UserGroups present
test('NNP-8 T3-1: flag off (default) — UserGroups present, no tier enforcement', async () => {
  // FF_AUTHORIZE_GROUP_POLICY is deleted in beforeEach — guard must be fully inert.
  const result = await decide(tierParams({
    ToolName: 'create_withdrawal',
    TokenScopes: 'write',
    UserGroups: JSON.stringify(['Standard']),
    TransactionAmount: '1000',
  }));
  // Standard tier would block create_withdrawal, but flag is off → INDETERMINATE STEP_UP for $1000.
  assert.strictEqual(result.decision, 'INDETERMINATE', 'Expected INDETERMINATE (flag off), got ' + result.decision + ': ' + result.reason);
  assert.strictEqual(result.reason, 'STEP_UP', 'Expected STEP_UP (flag off), got: ' + result.reason);
});

// T3-2: PrivateBanking member, wire tool, amount within tier limit — no tier deny
// Global ceiling raised to $60000 so Rule 3b doesn't pre-empt the tier check.
test('NNP-8 T3-2: PrivateBanking user, create_withdrawal $10000 (global ceiling $60000) -> not tier-denied', async () => {
  process.env.FF_AUTHORIZE_GROUP_POLICY = 'true';
  process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT = '60000';
  fresh();
  const result = await decide(tierParams({
    ToolName: 'create_withdrawal',
    TokenScopes: 'write',
    UserGroups: JSON.stringify(['PrivateBanking']),
    TransactionAmount: '10000',
  }));
  // PrivateBanking tier allows create_withdrawal and $10000 < $50000 tier limit — no tier deny fires.
  // Rule 4 STEP_UP fires for $10000 (above $500 threshold) — that is correct; tier allowed the call.
  assert.ok(
    !String(result.reason || '').includes('tier_tool_not_allowed'),
    'PrivateBanking user must not get tier_tool_not_allowed, got: ' + result.reason
  );
  assert.ok(
    !String(result.reason || '').includes('tier_amount_exceeded'),
    'PrivateBanking user $10000 (< $50000 tier limit) must not get tier_amount_exceeded, got: ' + result.reason
  );
  assert.strictEqual(result.decision, 'INDETERMINATE', 'Expected STEP_UP INDETERMINATE, got ' + result.decision + ': ' + result.reason);
  assert.strictEqual(result.reason, 'STEP_UP');
});

// T3-3: Standard user, privateBankingOnlyTool -> DENY tier_tool_not_allowed
test('NNP-8 T3-3: Standard user, create_withdrawal -> DENY tier_tool_not_allowed', async () => {
  process.env.FF_AUTHORIZE_GROUP_POLICY = 'true';
  fresh();
  const result = await decide(tierParams({
    ToolName: 'create_withdrawal',
    TokenScopes: 'write',
    UserGroups: JSON.stringify(['Standard']),
    TransactionAmount: '100',
  }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision);
  assert.ok(
    String(result.reason || '').includes('tier_tool_not_allowed'),
    'reason should include tier_tool_not_allowed, got: ' + result.reason
  );
});

// T3-4: Standard user, create_transfer $3000 -> DENY (global ceiling fires first at $2000)
test('NNP-8 T3-4: Standard user, create_transfer $3000 -> DENY (global ceiling Rule 3b fires first)', async () => {
  process.env.FF_AUTHORIZE_GROUP_POLICY = 'true';
  fresh();
  const result = await decide(tierParams({
    ToolName: 'create_transfer',
    TokenScopes: 'write transfer',
    UserGroups: JSON.stringify(['Standard']),
    TransactionAmount: '3000',
  }));
  // $3000 > $2000 global ceiling → Rule 3b fires (amount_exceeds_ceiling) before Rule 3d.
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision);
  assert.ok(
    String(result.reason || '').includes('amount_exceeds_ceiling'),
    'Expected amount_exceeds_ceiling (global ceiling fires before tier), got: ' + result.reason
  );
});

// T3-4b: Standard user, create_transfer $2500, global ceiling raised to $60000 -> DENY tier_amount_exceeded
test('NNP-8 T3-4b: Standard user, create_transfer $2500, global ceiling $60000 -> DENY tier_amount_exceeded', async () => {
  process.env.FF_AUTHORIZE_GROUP_POLICY = 'true';
  process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT = '60000';
  fresh();
  const result = await decide(tierParams({
    ToolName: 'create_transfer',
    TokenScopes: 'write transfer',
    UserGroups: JSON.stringify(['Standard']),
    TransactionAmount: '2500',
  }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision);
  assert.ok(
    String(result.reason || '').includes('tier_amount_exceeded'),
    'reason should include tier_amount_exceeded, got: ' + result.reason
  );
});

// T3-5: no UserGroups -> defaults to Standard tier
test('NNP-8 T3-5: no UserGroups -> Standard tier default, create_withdrawal DENY tier_tool_not_allowed', async () => {
  process.env.FF_AUTHORIZE_GROUP_POLICY = 'true';
  fresh();
  const result = await decide(tierParams({
    ToolName: 'create_withdrawal',
    TokenScopes: 'write',
    UserGroups: '',
    TransactionAmount: '100',
  }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision);
  assert.ok(
    String(result.reason || '').includes('tier_tool_not_allowed'),
    'reason should include tier_tool_not_allowed, got: ' + result.reason
  );
});

// T3-6: parity guard — deny codes are distinct from existing deny codes
test('NNP-8 T3-6: tier deny codes are distinct from existing deny codes', () => {
  assert.notStrictEqual('tier_tool_not_allowed', 'amount_exceeds_ceiling');
  assert.notStrictEqual('tier_tool_not_allowed', 'insufficient_scope');
  assert.notStrictEqual('tier_tool_not_allowed', 'user_not_in_group');
  assert.notStrictEqual('tier_amount_exceeded', 'amount_exceeds_ceiling');
  assert.notStrictEqual('tier_amount_exceeded', 'insufficient_scope');
});
