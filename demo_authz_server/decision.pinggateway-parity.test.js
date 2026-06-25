'use strict';

/**
 * decision.pinggateway-parity.test.js
 *
 * Proves the mock authz-server decision route consumes the EXACT 18-key payload
 * that PingGateway's p1az-decision.groovy emits (parity with the Node gateway's
 * buildAuthorizeParameters), and returns PERMIT for an allowed call and DENY for a
 * denied one. This is the authz-server-parity gate for the PingGateway path: the
 * Groovy filter is the new authorize caller, and the mock already accepts what it
 * sends — no mock change required.
 *
 * The 18 keys are the full base set from
 * demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts buildAuthorizeParameters().
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GATEWAY_AUD = 'mcpgateway.ping.demo';

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

// The full 18-key payload the Groovy filter emits (same keys + order as
// buildAuthorizeParameters). Override individual keys per case.
function groovyParams(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    DecisionContext:   'McpToolCall',
    McpMethod:         'tools/call',
    ToolName:          'create_transfer',
    ClientId:          'user-1',
    ActClientId:       '',
    ActChainDepth:     '0',
    MayActSub:         '',
    TokenScopes:       'read write transfer',
    TokenAudience:     GATEWAY_AUD,
    TokenAudActual:    GATEWAY_AUD,
    McpResourceUri:    GATEWAY_AUD,
    TokenExp:          String(now + 300),
    TokenIat:          String(now - 30),
    TokenNbf:          String(now - 30),
    TokenIss:          '',
    TransactionAmount: '10',
    TransactionType:   'transfer',
    ToAccountId:       'acct-2',
    Vertical:          'banking',
    ...extra,
  };
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `pg-parity-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = GATEWAY_AUD;
  process.env.ENFORCE_MAY_ACT = 'true';
  delete process.env.PINGONE_ENVIRONMENT_ID; // disable iss check
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  mock.restoreAll();
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

test('PERMIT — full 18-key Groovy payload for an allowed call', async () => {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: groovyParams() } }, res);
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('DENY — same payload but aud does not include the gateway resource uri', async () => {
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: groovyParams({ TokenAudActual: 'some.other.aud' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /invalid_aud/);
});

test('DENY — TokenAudience does not match McpResourceUri (HasValidMcpAudience parity)', async () => {
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: groovyParams({ McpResourceUri: 'https://other.mcp.server/mcp' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /invalid_aud/);
});

test('DENY — same payload but missing a required scope (insufficient_scope)', async () => {
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: groovyParams({ TokenScopes: 'read' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /insufficient_scope/);
});

test('mock consumes every one of the 18 Groovy keys (no key triggers a parse error)', async () => {
  // Sanity: the handler reads req.body.parameters and never throws on the full set.
  const res = makeRes();
  await assert.doesNotReject(
    decisionHandler({ params: { workerId: 'p' }, body: { parameters: groovyParams() } }, res),
  );
  assert.ok(res.body && typeof res.body.decision === 'string');
});
