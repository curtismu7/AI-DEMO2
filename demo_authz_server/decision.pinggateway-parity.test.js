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
    ActClientId:       'agent-1',
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
  // Rule 2 is act-only now: groovyParams' default actor ('agent-1') must be a
  // recognized authorized actor, not just may_act-matched.
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = 'agent-1';
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

test('PERMIT — PingGateway aud accepted when MCP_GW_RESOURCE_URI lists both audiences', async () => {
  process.env.MCP_GW_RESOURCE_URI = 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp';
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
  const res = makeRes();
  await decisionHandler(
    {
      params: { workerId: 'p' },
      body: {
        parameters: groovyParams({
          ToolName: 'get_my_accounts',
          TokenScopes: 'gateway:mcp:invoke',
          TokenAudActual: 'https://api.ping.demo:3036/mcp',
          TokenAudience: 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp',
          McpResourceUri: 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp',
        }),
      },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('PERMIT — user_profile_card (Path B) with PingGateway aud', async () => {
  process.env.MCP_GW_RESOURCE_URI = 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp';
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
  const res = makeRes();
  await decisionHandler(
    {
      params: { workerId: 'p' },
      body: {
        parameters: groovyParams({
          ToolName: 'user_profile_card',
          TokenScopes: 'gateway:mcp:invoke',
          TokenAudActual: 'https://api.ping.demo:3036/mcp',
          TokenAudience: 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp',
          McpResourceUri: 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp',
        }),
      },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
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

test('PERMIT — gateway:mcp:invoke (Exchange #2 default) bypasses banking-scope check', async () => {
  // The PingGateway-path token carries only the gateway-hop scope, no banking
  // scopes; Rule 3 must treat it as via-gateway or every tool call is denied.
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: groovyParams({ TokenScopes: 'gateway:mcp:invoke' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('PERMIT — legacy pinggateway:invoke scope still recognized', async () => {
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: groovyParams({ TokenScopes: 'pinggateway:invoke' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
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
