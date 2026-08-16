'use strict';

/**
 * decision.d05-bypass.test.js  (SP-2)
 *
 * Proves the mock authz-server decision route enforces the anti-bypass (D-05)
 * invariant at parity with the Node gateway's GatewayTokenPolicy: a token whose
 * ACTUAL introspected aud (TokenAudActual) targets a backend/upstream audience —
 * even in a multi-aud [gateway, backend] token that passes the "aud includes
 * gateway" check — must DENY as bypass_attempt. A gateway-only aud must NOT trip
 * the rule.
 *
 * This closes the one true mock-side logic gap for P1AZ policy parity; the mock
 * already implements per-tool filtering, act/UC16, and RAR subset.
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GATEWAY_AUD = 'mcpgateway.ping.demo';
const OLB_AUD = 'mcpserver.ping.demo';
// The invest backend's audience, per scope-topology.json "Super Banking MCP Invest".
// It must track the manifest: TokenAudTargetsUpstream is GENERATED from that
// resource list, so a stale literal here silently stops exercising the D-05 rule
// (the token no longer looks like an upstream audience, so nothing denies it).
const MCP_RS_AUD = 'mcp-invest.ping.demo';
const BANKING_RS_AUD = 'https://banking-resource-server.ping.demo';
const AI_AGENT_ACTOR = 'test-ai-agent';

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

// A minimal allowed tools/call payload; override aud per case.
function params(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    DecisionContext:   'McpToolCall',
    ToolName:          'create_transfer',
    ClientId:          'user-1',
    // create_transfer is agent-mediated, so Rule 2.5 (UC16) requires an act
    // claim; AI_AGENT_ACTOR satisfies Rule 2's authorized-actor check. Without
    // it every case DENYs on missing_act and never reaches the D-05 rule.
    ActClientId:       AI_AGENT_ACTOR,
    TokenScopes:       'read write transfer',
    TokenAudience:     GATEWAY_AUD,
    TokenAudActual:    GATEWAY_AUD,
    McpResourceUri:    GATEWAY_AUD,
    TokenExp:          String(now + 300),
    TokenIat:          String(now - 30),
    TokenNbf:          String(now - 30),
    TransactionAmount: '10',
    ToAccountId:       'acct-2',
    Vertical:          'banking',
    ...extra,
  };
}

async function decide(extra) {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: params(extra) } }, res);
  return res.body;
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `d05-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = GATEWAY_AUD;
  process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID = AI_AGENT_ACTOR;
  delete process.env.PINGONE_ENVIRONMENT_ID; // disable iss check
  delete process.env.BANKING_RESOURCE_SERVER_RESOURCE_URI; // use the default literal
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  mock.restoreAll();
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

test('gateway-only actual aud does NOT trip D-05 (baseline PERMIT)', async () => {
  const body = await decide({ TokenAudActual: GATEWAY_AUD });
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body && body.reason}`);
});

test('DENY bypass_attempt — multi-aud [gateway, OLB backend] (space-separated)', async () => {
  const body = await decide({ TokenAudActual: `${GATEWAY_AUD} ${OLB_AUD}` });
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /bypass_attempt/);
  assert.match(body.reason, new RegExp(OLB_AUD.replace(/[.]/g, '\\.')));
});

test('DENY bypass_attempt — multi-aud [gateway, invest] (JSON-array form)', async () => {
  const body = await decide({ TokenAudActual: JSON.stringify([GATEWAY_AUD, MCP_RS_AUD]) });
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /bypass_attempt/);
});

test('DENY bypass_attempt — multi-aud [gateway, banking RS]', async () => {
  const body = await decide({ TokenAudActual: `${GATEWAY_AUD} ${BANKING_RS_AUD}` });
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /bypass_attempt/);
});

test('DENY bypass_attempt — comma-joined multi-aud [gateway, banking RS]', async () => {
  // Rule 0b splits TokenAudActual on /[\s,]+/, so a comma-joined multi-aud passes
  // the "aud includes gateway" check; Rule 0b-2 must split the SAME way or the
  // upstream aud collapses into one token and escapes the anti-bypass check.
  const body = await decide({ TokenAudActual: `${GATEWAY_AUD},${BANKING_RS_AUD}` });
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /bypass_attempt/);
  assert.match(body.reason, new RegExp(BANKING_RS_AUD.replace(/[.]/g, '\\.')));
});

test('missing TokenAudActual keeps legacy behaviour (D-05 skipped, PERMIT)', async () => {
  const body = await decide({ TokenAudActual: '' });
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body && body.reason}`);
});
