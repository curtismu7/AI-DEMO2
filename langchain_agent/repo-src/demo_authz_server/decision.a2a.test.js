'use strict';

/**
 * A2A act-chain authorization (Slice 2) for the mock PingOne Authorize.
 * An a2aDelegated tool (e.g. get_portfolio_summary) is DENIED unless the token's
 * act chain shows a specialist delegated by the generalist (ActChainDepth >= 2).
 * The decision is over the act chain — NOT may_act (which A2A intentionally omits).
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
  for (const m of ['./ruleStore', './pingOneUserLookup', './routes/decision']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  userLookup = require('./pingOneUserLookup');
  mock.method(userLookup, 'lookupUser', async () => ({ found: true, enabled: true, status: 'ACTIVE' }));
  decisionHandler = require('./routes/decision');
}

function makeRes() {
  return { body: null, json(b) { this.body = b; return this; } };
}

// get_portfolio_summary is a2aDelegated, requires invest:read, has no challengeType
// (so no HITL interference) — ideal for isolating the act-chain rule.
function a2aParams(extra = {}) {
  return {
    DecisionContext: 'McpToolCall',
    ToolName: 'get_portfolio_summary',
    ClientId: 'user-1',
    TokenScopes: 'invest:read',
    TokenAudience: 'test-aud',
    TransactionAmount: '',
    ...extra,
  };
}

async function decide(params) {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: params } }, res);
  return res.body;
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `a2a-dec-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  process.env.ENFORCE_MAY_ACT = 'true';
  delete process.env.PINGONE_ENVIRONMENT_ID;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  mock.restoreAll();
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

test('generalist (no delegation) is DENIED on an a2aDelegated tool', async () => {
  const body = await decide(a2aParams({ /* no ActChainDepth → depth 0 */ }));
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /a2a_delegation_required/);
});

test('single-actor token (act depth 1) is DENIED — must delegate', async () => {
  const body = await decide(a2aParams({ ActChainDepth: '1', ActClientId: 'generalist-agent' }));
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /a2a_delegation_required/);
});

test('specialist delegation (act depth 2) is PERMITTED', async () => {
  const body = await decide(a2aParams({ ActChainDepth: '2', ActClientId: 'investment-specialist' }));
  assert.strictEqual(body.decision, 'PERMIT');
});

test('act-chain decision IGNORES may_act (no MayActSub, enforceMayAct=true) — PERMIT at depth 2', async () => {
  // Without the Rule 2 bypass this would DENY with may_act_missing.
  const body = await decide(a2aParams({ ActChainDepth: '2', ActClientId: 'investment-specialist', MayActSub: '' }));
  assert.strictEqual(body.decision, 'PERMIT');
});

test('non-a2a tool is unaffected by the act-chain rule (regression)', async () => {
  const body = await decide({
    DecisionContext: 'McpToolCall',
    ToolName: 'get_my_accounts',
    ClientId: 'user-1',
    TokenScopes: 'read',
    TokenAudience: 'test-aud',
    TransactionAmount: '',
  });
  assert.strictEqual(body.decision, 'PERMIT');
});

test('a2aDelegated tool still enforces scope at depth 2 (missing invest:read → DENY)', async () => {
  const body = await decide(a2aParams({ ActChainDepth: '2', TokenScopes: 'read' }));
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /insufficient_scope/);
});
