'use strict';

/**
 * Intent-token tamper handling for the mock PingOne Authorize.
 *
 * IntentTokenValid='false' means the gateway received an intent token and
 * validation FAILED. A TAMPERED token (bad signature / malformed) must fail
 * closed — otherwise an attacker strips intent binding by corrupting the token.
 * A BENIGN 'expired' failure (the 5-min TTL lapsed mid agent-run) and an absent
 * token must be allowed through (the mock cannot re-mint an expired token, and
 * intent binding is opt-in). Only present-and-tampered denies.
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

async function decide(extra) {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: {
    DecisionContext: 'McpToolCall',
    ToolName: 'get_my_accounts',
    ClientId: 'user-1',
    TokenScopes: 'read',
    TokenAudience: 'test-aud',
    TransactionAmount: '',
    ...extra,
  } } }, res);
  return res.body;
}

beforeEach(() => {
  const overlay = path.join(os.tmpdir(), `it-dec-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = overlay;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  delete process.env.PINGONE_ENVIRONMENT_ID;
  try { fs.unlinkSync(overlay); } catch { /* ignore */ }
  fresh();
});

afterEach(() => mock.restoreAll());

test('tampered intent token (invalid_signature) is DENIED', async () => {
  const body = await decide({ IntentTokenValid: 'false', IntentTokenError: 'invalid_signature' });
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /intent_token_invalid/);
});

test('malformed intent token is DENIED', async () => {
  const body = await decide({ IntentTokenValid: 'false', IntentTokenError: 'malformed' });
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /intent_token_invalid/);
});

test('EXPIRED intent token is NOT denied on the tamper rule (benign — allowed through)', async () => {
  const body = await decide({ IntentTokenValid: 'false', IntentTokenError: 'expired' });
  assert.ok(!(body.decision === 'DENY' && /intent_token_invalid/.test(body.reason || '')),
    `expired IT must not trigger the tamper deny; got ${JSON.stringify(body)}`);
});

test('absent intent token (no error) is NOT denied on the tamper rule (backward compatible)', async () => {
  const body = await decide({ IntentTokenValid: 'false', IntentTokenError: '' });
  assert.ok(!(body.decision === 'DENY' && /intent_token_invalid/.test(body.reason || '')),
    `absent/legacy IT must not trigger the tamper deny; got ${JSON.stringify(body)}`);
});
