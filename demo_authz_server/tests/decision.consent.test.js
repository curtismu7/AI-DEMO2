'use strict';

/**
 * Rule 2.6 — per-user consent (may_act re-architecture, Task 3).
 *
 * Default mode mints `act` from the actor token (no may_act involvement at
 * mint), so consent must be enforced HERE, per call: MayActSub (bridged from
 * the signed-in user's session may_act) must be present and equal the acting
 * agent (ActClientId) for every agent-mediated tool. A2A-delegated and
 * named-workload-agent calls are carved out — their authorization is the act
 * chain / workload identity (mirrors Rule 2's carve-outs).
 *
 * node:test pattern, same as decision.test.js.
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

let decisionHandler;
let userLookup;

function fresh() {
  for (const m of ['../ruleStore', '../pingOneUserLookup', '../routes/decision', '../scopeTopology', '../correlationContext', '../logger']) {
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

// get_my_accounts is NOT agent-mediated (SoT). create_transfer is the
// agent-mediated read/write tool (see decision.test.js writeParams).
function readParams(extra) {
  return Object.assign({
    DecisionContext: 'McpToolCall',
    ToolName: 'create_transfer',
    ClientId: 'user-1',
    ActClientId: 'agent-1',
    MayActSub: 'agent-1',
    TokenScopes: 'read write transfer accounts:read',
    TokenAudience: 'test-aud',
    TokenAudActual: 'test-aud',
    TransactionAmount: '',
    HitlApproved: '',
  }, extra || {});
}

const prev = {};
beforeEach(() => {
  for (const k of ['PINGONE_AI_AGENT_ACTOR_CLIENT_ID', 'PINGONE_WORKLOAD_AGENT_CLIENT_IDS']) {
    prev[k] = process.env[k];
  }
  process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID = 'agent-1';
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  fresh();
});
afterEach(() => {
  for (const k of Object.keys(prev)) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
});

test('Rule 2.6 pass: MayActSub === ActClientId → not denied by the consent rule', async () => {
  const r = await decide(readParams());
  assert.notStrictEqual(r.decision, 'DENY', `unexpected DENY: ${r.reason}`);
});

test('Rule 2.6 mismatch: MayActSub present but different actor → DENY may_act_mismatch', async () => {
  const r = await decide(readParams({ MayActSub: 'some-other-agent' }));
  assert.strictEqual(r.decision, 'DENY');
  assert.match(r.reason, /may_act_mismatch/);
});

test('Rule 2.6 absent: no MayActSub at all → DENY no_user_consent (fail closed)', async () => {
  const r = await decide(readParams({ MayActSub: '' }));
  assert.strictEqual(r.decision, 'DENY');
  assert.match(r.reason, /no_user_consent/);
});

test('Rule 2.6 skips A2A-delegated tools (act chain is their authorization)', async () => {
  // sensitive_holdings is the A2A-delegated sensitive tool (see decision.a2a.test.js).
  const r = await decide(readParams({
    ToolName: 'sensitive_holdings',
    MayActSub: '',
    ActClientId: 'specialist-agent',
    ActChainDepth: '2',
    NestedActClientId: 'agent-1',
    TokenScopes: 'read accounts:read sensitive:read',
  }));
  assert.notStrictEqual(r.decision, 'DENY', `A2A call must not hit Rule 2.6: ${r.reason}`);
});

test('Rule 2.6 skips named workload agents (UC38/44 — workload identity authorizes)', async () => {
  process.env.PINGONE_WORKLOAD_AGENT_CLIENT_IDS = 'workload-agent-1';
  fresh();
  const r = await decide(readParams({ ActClientId: 'workload-agent-1', MayActSub: '' }));
  assert.notStrictEqual(r.decision, 'DENY', `workload call must not hit Rule 2.6: ${r.reason}`);
});

test('Rule 2.6 skips non-agent-mediated tools', async () => {
  // get_my_accounts has no requiresAgentMediation flag in the SoT.
  const r = await decide(readParams({ ToolName: 'get_my_accounts', MayActSub: '', TokenScopes: 'read accounts:read' }));
  assert.notStrictEqual(r.decision, 'DENY', `non-agent-mediated call must not hit Rule 2.6: ${r.reason}`);
});

test('Rule 2.6 fires on the BFF context too (McpFirstTool, not just McpToolCall)', async () => {
  // docs §5.5: the BFF sends McpFirstTool; gating on McpToolCall alone would
  // skip the rule for every BFF-originated call.
  const r = await decide(readParams({ DecisionContext: 'McpFirstTool', MayActSub: '' }));
  assert.strictEqual(r.decision, 'DENY');
  assert.match(r.reason, /no_user_consent/);
});

test('Rule 2.6: REQUIRE_USER_CONSENT=false opts out (flag-ON legacy mode escape)', async () => {
  process.env.REQUIRE_USER_CONSENT = 'false';
  fresh();
  try {
    const r = await decide(readParams({ MayActSub: '' }));
    assert.notStrictEqual(r.decision, 'DENY', `escape must disable the guard: ${r.reason}`);
  } finally {
    delete process.env.REQUIRE_USER_CONSENT;
  }
});
