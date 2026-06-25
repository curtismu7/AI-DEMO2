'use strict';

/**
 * Confused-deputy parity for the mock PingOne Authorize.
 *
 * The Security Showcase "confused deputy" chip fires a normal tool call but
 * overrides the bridged actor with a rogue, non-allowlisted client id
 * (_testActClientId → X-Act-Client-Id → ActClientId). Cloud P1AZ denies this
 * via HasValidActorChain; the mock must deny it identically (authz-server-parity).
 * Verified live: rogue actor → 403 on the simulated backend.
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

async function decide(params) {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: params } }, res);
  return res.body;
}

beforeEach(() => {
  const overlay = path.join(os.tmpdir(), `cd-dec-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = overlay;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  process.env.ENFORCE_MAY_ACT = 'true';
  delete process.env.PINGONE_ENVIRONMENT_ID;
  try { fs.unlinkSync(overlay); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  mock.restoreAll();
});

test('rogue actor (non-allowlisted ActClientId) is DENIED on an MCP tool call', async () => {
  const body = await decide({
    DecisionContext: 'McpToolCall',
    ToolName: 'get_my_accounts',
    ClientId: 'user-1',
    TokenScopes: 'read',
    TokenAudience: 'test-aud',
    TransactionAmount: '',
    ActClientId: 'rogue-agent-9f2a-not-allowlisted',
  });
  assert.strictEqual(body.decision, 'DENY');
});
