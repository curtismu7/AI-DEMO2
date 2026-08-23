'use strict';

/**
 * Rule 0b-2 (D-05 anti-bypass) — native ID-JAG exemption.
 *
 * Parity check with demo_mcp_gateway's GatewayTokenPolicy.ts
 * (isIdJagIssuedToken) and ping-gateway's p1az-decision.groovy
 * (isExternalDoorToken): a token whose TokenIss is oauth-mcp's own
 * embedded AS legitimately carries an upstream MCP-server audience —
 * that IS the MCP Enterprise-Managed Authorization extension's model,
 * a per-server grant with no gateway-exchange hop. Such a token is
 * otherwise indistinguishable from the one D-05 exists to block, so
 * the exemption is conditioned on TokenIss (the gateway's own
 * introspected/decoded claim), never on a caller-suppliable flag.
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let OVERLAY;
let decisionHandler;
let userLookup;

const ID_JAG_ISSUER = 'https://localhost:8080';
const UPSTREAM_OLB_AUD = 'mcpserver.ping.demo';

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

// get_my_accounts is read-only, no challengeType — clears every rule after 0b-2.
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

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), 'dec-idjag-' + process.pid + '-' + Math.floor(process.hrtime()[1]) + '.json');
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  // Matches the real docker-compose.yml config: mcpserver.ping.demo was added to
  // MCP_GW_RESOURCE_URI's comma-list (the "accepted inbound aud" list) specifically
  // so native ID-JAG-redeemed bearers pass Rule 0b — Rule 0b-2 (D-05) is the one
  // that then has to distinguish a legitimate ID-JAG token from an actual bypass
  // attempt, which is exactly what this file tests.
  process.env.MCP_GW_RESOURCE_URI = 'test-aud,' + UPSTREAM_OLB_AUD;
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = 'agent-1';
  delete process.env.PINGONE_ENVIRONMENT_ID;
  delete process.env.REQUIRE_ACT_FOR_AGENT_TOOLS;
  delete process.env.OAUTH_MCP_ID_JAG_ISSUER;
  delete process.env.OAUTH_MCP_ISSUER_URI;
  try { fs.unlinkSync(OVERLAY); } catch (e) { /* ignore */ }
  fresh();
});

afterEach(() => {
  try { fs.unlinkSync(OVERLAY); } catch (e) { /* ignore */ }
});

test('D-05: a PingOne-issued token whose aud targets the OLB server is still DENYed (unaffected)', async () => {
  const result = await decide(readParams({
    TokenAudActual: UPSTREAM_OLB_AUD,
    TokenIss: 'https://auth.pingone.com/env-id/as',
  }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(String(result.reason || '').includes('bypass_attempt'), 'reason should include bypass_attempt, got: ' + result.reason);
});

test('D-05: an ID-JAG-issued token whose aud targets the OLB server is exempt (PERMIT)', async () => {
  const result = await decide(readParams({
    TokenAudActual: UPSTREAM_OLB_AUD,
    TokenIss: ID_JAG_ISSUER,
  }));
  assert.ok(
    !String(result.reason || '').includes('bypass_attempt'),
    'ID-JAG-issued token must be exempt from D-05, got: ' + result.reason
  );
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});

test('D-05: a token merely claiming the ID-JAG issuer string still DENYs when OAUTH_MCP_ID_JAG_ISSUER is configured differently', async () => {
  process.env.OAUTH_MCP_ID_JAG_ISSUER = 'https://enterprise-idp.example.com';
  fresh();
  const result = await decide(readParams({
    TokenAudActual: UPSTREAM_OLB_AUD,
    TokenIss: ID_JAG_ISSUER, // does not match the configured issuer above
  }));
  assert.strictEqual(result.decision, 'DENY', 'Expected DENY, got ' + result.decision + ': ' + result.reason);
  assert.ok(String(result.reason || '').includes('bypass_attempt'), 'reason should include bypass_attempt, got: ' + result.reason);
});

test('D-05: OAUTH_MCP_ISSUER_URI (external-door convention) also exempts, for parity with p1az-decision.groovy', async () => {
  process.env.OAUTH_MCP_ISSUER_URI = 'https://enterprise-idp.example.com';
  fresh();
  const result = await decide(readParams({
    TokenAudActual: UPSTREAM_OLB_AUD,
    TokenIss: 'https://enterprise-idp.example.com',
  }));
  assert.ok(
    !String(result.reason || '').includes('bypass_attempt'),
    'OAUTH_MCP_ISSUER_URI-matched token must be exempt from D-05, got: ' + result.reason
  );
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});

test('D-05: a normal gateway-audienced token (no upstream aud at all) passes regardless of iss', async () => {
  const result = await decide(readParams({
    TokenAudActual: 'test-aud',
    TokenIss: 'https://auth.pingone.com/env-id/as',
  }));
  assert.strictEqual(result.decision, 'PERMIT', 'Expected PERMIT, got ' + result.decision + ': ' + result.reason);
});
