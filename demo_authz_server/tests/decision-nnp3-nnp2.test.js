'use strict';

/**
 * C2.2 parity tests — NNP-3 (resource-ownership, UC10) and NNP-2 (group-membership, UC9).
 *
 * Verifies that demo_authz_server/routes/decision.js Rule 3.5a and Rule 3.5b
 * match the exact semantics of simulatedAuthorizeService.js evaluateMcpFirstTool
 * (lines 307-328 for resource-ownership, 338-358 for group-membership).
 *
 * deny_reason codes mirrored:
 *   NNP-3: 'resource_owner_mismatch'
 *   NNP-2: 'user_not_in_group'
 *
 * Uses node:test (same runner as all other demo_authz_server tests).
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

// Base params that pass all guards before Rule 3.5a / 3.5b.
// update_contact_email has write scope, is the canonical resource-scoped tool.
function baseParams(extra) {
  return Object.assign({
    DecisionContext: 'McpToolCall',
    ToolName: 'update_contact_email',
    ClientId: 'user-alice',
    ActClientId: 'agent-1',
    MayActSub: 'agent-1',
    TokenScopes: 'write',
    TokenAudience: 'test-aud',
    TokenAudActual: 'test-aud',
    TransactionAmount: '',
    HitlApproved: '',
    ResourceOwnerId: '',
    RequiredGroup: '',
    UserGroups: '',
  }, extra || {});
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), 'dec-nnp3-nnp2-' + process.pid + '-' + Math.floor(process.hrtime()[1]) + '.json');
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  process.env.ENFORCE_MAY_ACT = 'true';
  process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT = '2000';
  process.env.SIMULATED_AUTHORIZE_STEPUP_AMOUNT = '500';
  process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT = '250';
  delete process.env.PINGONE_ENVIRONMENT_ID;
  delete process.env.REQUIRE_ACT_FOR_AGENT_TOOLS;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

// ── NNP-3: Rule 3.5a — resource-ownership check ──────────────────────────────

test('NNP-3 B-1: ResourceOwnerId absent → PERMIT (no resource-scoped gate)', async () => {
  const result = await decide(baseParams({ ResourceOwnerId: '' }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});

test('NNP-3 B-2: ResourceOwnerId matches ClientId (owner acting on own resource) → PERMIT', async () => {
  const result = await decide(baseParams({ ResourceOwnerId: 'user-alice', ClientId: 'user-alice' }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});

test('NNP-3 B-3: ResourceOwnerId differs from ClientId (cross-owner attack) → DENY resource_owner_mismatch', async () => {
  const result = await decide(baseParams({ ResourceOwnerId: 'user-bob', ClientId: 'user-alice' }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(result.reason.includes('resource_owner_mismatch'),
    'reason should include resource_owner_mismatch, got: ' + result.reason);
});

test('NNP-3 B-4: DENY reason contains both owner and requester identities', async () => {
  const result = await decide(baseParams({ ResourceOwnerId: 'user-bob', ClientId: 'user-alice' }));
  assert.strictEqual(result.decision, 'DENY');
  assert.ok(result.reason.includes('user-bob'), 'reason should mention owner user-bob, got: ' + result.reason);
  assert.ok(result.reason.includes('user-alice'), 'reason should mention requester user-alice, got: ' + result.reason);
});

// ── NNP-2: Rule 3.5b — group-membership check ────────────────────────────────

test('NNP-2 B-5: RequiredGroup absent → PERMIT (no group gate on this call)', async () => {
  const result = await decide(baseParams({ RequiredGroup: '', UserGroups: '["Standard"]' }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});

test('NNP-2 B-6: user is in RequiredGroup → PERMIT', async () => {
  const result = await decide(baseParams({ RequiredGroup: 'Premium', UserGroups: '["Standard","Premium"]' }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});

test('NNP-2 B-7: user not in RequiredGroup → DENY user_not_in_group', async () => {
  const result = await decide(baseParams({ RequiredGroup: 'Premium', UserGroups: '["Standard"]' }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(result.reason.includes('user_not_in_group'),
    'reason should include user_not_in_group, got: ' + result.reason);
});

test('NNP-2 B-8: UserGroups is empty array → DENY user_not_in_group', async () => {
  const result = await decide(baseParams({ RequiredGroup: 'Premium', UserGroups: '[]' }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(result.reason.includes('user_not_in_group'),
    'reason should include user_not_in_group, got: ' + result.reason);
});

test('NNP-2 B-9: UserGroups absent/empty with RequiredGroup set → DENY (fail closed)', async () => {
  const result = await decide(baseParams({ RequiredGroup: 'Premium', UserGroups: '' }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY when UserGroups absent, got ' + result.decision + ': ' + result.reason);
  assert.ok(String(result.reason).includes('missing_user_groups') || String(result.reason).includes('user_not_in_group'),
    'Expected missing_user_groups or user_not_in_group, got: ' + result.reason);
});

test('NNP-2 B-10: malformed UserGroups JSON → DENY (fail closed when RequiredGroup set)', async () => {
  const result = await decide(baseParams({ RequiredGroup: 'Premium', UserGroups: 'not-json' }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY on malformed UserGroups, got ' + result.decision + ': ' + result.reason);
  assert.ok(result.reason.includes('malformed_user_groups'),
    'reason should include malformed_user_groups, got: ' + result.reason);
});

test('NNP-2 B-11a: UserGroups as native array (real caller format), user not in group → DENY user_not_in_group', async () => {
  const result = await decide(baseParams({ RequiredGroup: 'Premium', UserGroups: ['Standard'] }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(result.reason.includes('user_not_in_group'),
    'reason should include user_not_in_group, got: ' + result.reason);
});

test('NNP-2 B-11b: UserGroups as native array, user in group → PERMIT', async () => {
  const result = await decide(baseParams({ RequiredGroup: 'Premium', UserGroups: ['Standard', 'Premium'] }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});

// ── Rule ordering: NNP-3 fires before NNP-2 ──────────────────────────────────

test('NNP-3+2 B-11: ownership mismatch + group mismatch → DENY for resource_owner_mismatch (NNP-3 wins, earlier rule)', async () => {
  const result = await decide(baseParams({
    ResourceOwnerId: 'user-bob',
    ClientId: 'user-alice',
    RequiredGroup: 'Premium',
    UserGroups: '["Standard"]',
  }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(result.reason.includes('resource_owner_mismatch'),
    'NNP-3 (resource_owner_mismatch) should take precedence over NNP-2 (user_not_in_group), got: ' + result.reason);
});
