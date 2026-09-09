'use strict';

/**
 * Rule 4c — Agent Intent Governance, in the mock PDP.
 *
 * The Docker gateway talks to THIS PDP, not to cloud PingOne, so without these
 * rules arming MCP_GW_INTENT_ENFORCE would send IntentEnforce to a decision
 * point that ignores it — enforcement that looks armed and blocks nothing.
 *
 * These mirror the cloud "Agent Intent Governance" policy
 * (snapshots/intentGovernancePolicy.js). The two must stay in lockstep; the
 * cases below are the same decision table the snapshot test asserts against the
 * generated conditions, so a divergence shows up as one of them going red.
 *
 * The gate is the load-bearing part. Unarmed, none of this runs — otherwise the
 * fail-closed defaults would deny every ordinary tool call in the demo.
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

/** A request that clears every earlier rule, so only Rule 4c can decide. */
async function decide(extra) {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: {
    DecisionContext: 'McpToolCall',
    ToolName: 'create_transfer',
    ClientId: 'user-1',
    TokenScopes: 'read write transfer',
    TokenAudience: 'test-aud',
    TransactionAmount: '',
    // create_transfer is a WRITE tool: earlier rules require a delegated actor
    // and a resolvable owner before Rule 4c is ever reached.
    ActClientId: 'agent-1',
    ActChainDepth: '1',
    // create_transfer is consent-gated, and the HITL rule returns before Rule 4c.
    // Discharging it here is not a convenience: the consented grant these tests
    // describe is PRODUCED by exactly this approval (agentMcpTokenService stamps
    // consented/expires_at from the approved challenge), so a request carrying a
    // consented grant and no HITL receipt would not be a real shape.
    HitlApproved: 'true',
    HitlChallengeId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', // must be UUID-shaped
    ...extra,
  } } }, res);
  return res.body;
}

beforeEach(() => {
  const overlay = path.join(os.tmpdir(), `ig-dec-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = overlay;
  process.env.MCP_GATEWAY_RESOURCE_URI = 'test-aud';
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = 'agent-1';
  delete process.env.PINGONE_ENVIRONMENT_ID;
  try { fs.unlinkSync(overlay); } catch { /* ignore */ }
  fresh();
});

afterEach(() => mock.restoreAll());

const ARMED = { IntentEnforce: 'true' };

const CONSENTED_GRANT = {
  IntentGrantPresent: 'true',
  IntentGrantConsented: 'true',
  IntentGrantExpired: 'false',
  IntentGrantAction: 'create_transfer',
  IntentGrantPayee: 'acme-utilities',
  IntentGrantMaxAmount: '100',
};

const MATCHING_REQUEST = {
  IntentRequestAction: 'create_transfer',
  IntentRequestPayee: 'acme-utilities',
  IntentRequestAmount: '80',
  IntentRequestMutating: 'true',
};

const reasonOf = (body) => `${body && body.decision} ${body && body.reason}`;

test('UNARMED: an ordinary tool call is untouched by Rule 4c', async () => {
  // No IntentEnforce, no IntentGrant* — the exact shape of live demo traffic.
  // If this ever denies, the gate has been lost and the demo is dead.
  const body = await decide({});
  assert.ok(!reasonOf(body).includes('intent_'), `expected no intent deny, got ${reasonOf(body)}`);
});

test('UNARMED: even a blatantly drifted call is untouched', async () => {
  const body = await decide({ ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestAmount: '5000' });
  assert.ok(!reasonOf(body).includes('intent_amount_drift'), 'unarmed must not enforce');
});

test('ARMED: a mutating call with no grant is denied', async () => {
  const body = await decide({ ...ARMED, IntentRequestAction: 'create_transfer', IntentRequestMutating: 'true' });
  assert.ok(reasonOf(body).includes('intent_grant_missing'), reasonOf(body));
});

test('ARMED: a read with no grant is permitted — intent governs mutations only', async () => {
  const body = await decide({ ...ARMED, IntentRequestAction: 'view_balance', IntentRequestMutating: 'false' });
  assert.ok(!reasonOf(body).includes('intent_'), reasonOf(body));
});

test('ARMED: an action inside the consented grant is permitted', async () => {
  const body = await decide({ ...ARMED, ...CONSENTED_GRANT, ...MATCHING_REQUEST });
  assert.ok(!reasonOf(body).includes('intent_'), reasonOf(body));
});

test('ARMED: amount drift is denied — same tool, injected amount', async () => {
  const body = await decide({ ...ARMED, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestAmount: '5000' });
  assert.ok(reasonOf(body).includes('intent_amount_drift'), reasonOf(body));
});

test('ARMED: payee drift is denied — same tool, injected counterparty', async () => {
  const body = await decide({ ...ARMED, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestPayee: 'attacker-account' });
  assert.ok(reasonOf(body).includes('intent_payee_drift'), reasonOf(body));
});

test('ARMED: action drift is denied', async () => {
  const body = await decide({ ...ARMED, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestAction: 'delete_account' });
  assert.ok(reasonOf(body).includes('intent_action_drift'), reasonOf(body));
});

test('ARMED: an expired grant is denied', async () => {
  const body = await decide({ ...ARMED, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentGrantExpired: 'true' });
  assert.ok(reasonOf(body).includes('intent_grant_expired'), reasonOf(body));
});

test('ARMED: a client-asserted grant is denied', async () => {
  const body = await decide({ ...ARMED, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentGrantConsented: 'false' });
  assert.ok(reasonOf(body).includes('intent_not_consented'), reasonOf(body));
});

test('ARMED fail-closed: an omitted grant expiry is treated as expired', async () => {
  const { IntentGrantExpired, ...grant } = CONSENTED_GRANT;
  const body = await decide({ ...ARMED, ...grant, ...MATCHING_REQUEST });
  assert.ok(reasonOf(body).includes('intent_grant_expired'), reasonOf(body));
});

test('ARMED fail-closed: a grant stating no cap authorizes no value', async () => {
  const { IntentGrantMaxAmount, ...grant } = CONSENTED_GRANT;
  const body = await decide({ ...ARMED, ...grant, ...MATCHING_REQUEST });
  assert.ok(reasonOf(body).includes('intent_amount_drift'), reasonOf(body));
});

test('ARMED fail-closed: an unclassified action is treated as mutating', async () => {
  // IntentRequestMutating omitted entirely — must NOT be read as a read.
  const body = await decide({ ...ARMED, IntentRequestAction: 'unknown_tool' });
  assert.ok(reasonOf(body).includes('intent_grant_missing'), reasonOf(body));
});
