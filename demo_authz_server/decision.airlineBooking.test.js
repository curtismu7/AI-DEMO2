'use strict';

/**
 * decision.airlineBooking.test.js - the mock PDP's Rule 3-airline: two airline booking rules.
 *
 *   RULE A (owner: the user)    No tickets bought by an AI agent over $500 (the user's AgentSpendLimit).
 *   RULE B (owner: the airline) Only premium members can book over $750.
 *
 * Both strict `>` (exactly 500 / 750 pass). Every failing rule is reported, A's code first.
 * The member tier is the PingOne USER's custom attribute airlineMemberTier: the mock reads it from a
 * mock user record keyed by the token subject (mockPingOneUsers), never from the request. A subject
 * with no record, or no value, is NOT premium.
 * The mock mirrors the cloud snapshot (snapshots/gen-authorize-snapshot.js step 8h); the
 * codes asserted here are checked against that snapshot below.
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GATEWAY_AUD = 'mcpgateway.ping.demo';
const ACTOR = 'agent-1';
const CODE_A = 'mcp-airline-agent-spend-limit';
const CODE_B = 'mcp-airline-premium-only';

const DATA = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'demo_mcp_resource_server', 'seed', 'airline-booking-policy-data.json'), 'utf8'));
const SEED = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'demo_mcp_resource_server', 'seed', 'airlines.seed.json'), 'utf8'));
const CLOUD_CODES = new Set(JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'snapshots', 'AI_Demo_Transaction_Authorization_P1AZ.snapshot.json'), 'utf8'))
  .filter((o) => o.type === 'Statement').map((o) => o.code));

const PREMIUM = 'Premier Gold';
const STANDARD = 'Premier Silver';

let OVERLAY;
let decisionHandler;
let users;

function fresh() {
  for (const m of ['./ruleStore', './pingOneUserLookup', './mockPingOneUsers', './routes/decision']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  const userLookup = require('./pingOneUserLookup');
  mock.method(userLookup, 'lookupUser', async () => ({ found: true, enabled: true, status: 'ACTIVE' }));
  users = require('./mockPingOneUsers');
  decisionHandler = require('./routes/decision');
}

const makeRes = () => ({ body: null, json(b) { this.body = b; return this; } });

function baseParams(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    DecisionContext: 'McpToolCall',
    McpMethod: 'tools/call',
    ToolName: 'book_airline_flight',
    ClientId: 'user-1',
    ActClientId: ACTOR,
    MayActSub: ACTOR,
    TokenScopes: 'airlines:read airlines:write',
    TokenAudience: GATEWAY_AUD,
    TokenAudActual: GATEWAY_AUD,
    McpResourceUri: GATEWAY_AUD,
    TokenExp: String(now + 300),
    TokenIat: String(now - 30),
    ...extra,
  };
}

async function decide(extra = {}) {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams(extra) } }, res);
  return res.body;
}

const codesOf = (body) => (body.statements || []).map((s) => s.code);
// The caller's token subject is the PingOne user. `tier` is that user's airlineMemberTier; undefined = a
// user with NO airlineMemberTier (no record at all), '' = the attribute present but empty.
function subjectWith(tier) {
  const sub = `user-${tier === undefined ? 'no-tier' : tier === '' ? 'empty-tier' : tier.replace(/\s+/g, '-')}`;
  if (tier !== undefined) users.setMockUser(sub, { airlineMemberTier: tier });
  return sub;
}
const agent = (fare, tier, extra = {}) => {
  const sub = subjectWith(tier);
  return { TransactionAmount: String(fare), Amount: String(fare), ClientId: sub, UserId: sub, ...extra };
};
const direct = (fare, tier, extra = {}) => ({ ...agent(fare, tier, extra), ActClientId: '', MayActSub: '' });

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `airline-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = GATEWAY_AUD;
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = ACTOR;
  delete process.env.PINGONE_ENVIRONMENT_ID;
  delete process.env.MCP_GW_RESOURCE_URI;
  delete process.env.FF_AUTHORIZE_GROUP_POLICY;
  // A direct caller (no agent) meets the identity rules (missing_act) before Rule 3-airline; the
  // existing opt-out is read per request. Q1 in the contract: left untouched, so the tests use it.
  process.env.REQUIRE_ACT_FOR_AGENT_TOOLS = 'false';
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  mock.restoreAll();
  delete process.env.REQUIRE_ACT_FOR_AGENT_TOOLS;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

// ── The nine scenarios of the contract ───────────────────────────────────────────────────────
const MATRIX = [
  // [label, params, expected codes ([] = not denied by A or B)]
  ['1 agent SH103 480 standard: allowed past both rules', () => agent(480, STANDARD), []],
  ['2 agent SH104 500 standard: allowed (500 is not over 500)', () => agent(500, STANDARD), []],
  ['3 agent SH106 620 standard: DENY by A', () => agent(620, STANDARD), [CODE_A]],
  ['4 agent SH107 940 premium: DENY by A only', () => agent(940, PREMIUM), [CODE_A]],
  ['5 direct SH106 620 standard: allowed (no agent, under 750)', () => direct(620, STANDARD), []],
  ['6 direct SH108 750 standard: allowed (750 is not over 750)', () => direct(750, STANDARD), []],
  ['7 direct SH107 940 standard: DENY by B only', () => direct(940, STANDARD), [CODE_B]],
  ['8 direct SH107 940 premium: allowed', () => direct(940, PREMIUM), []],
  ['9 agent SH107 940 standard: DENY by A and B (both listed, A first)', () => agent(940, STANDARD), [CODE_A, CODE_B]],
];

for (const [label, params, expected] of MATRIX) {
  test(`matrix ${label}`, async () => {
    const body = await decide(params());
    if (expected.length === 0) {
      assert.notStrictEqual(body.decision, 'DENY', `reason: ${body.reason}`);
      assert.ok(!codesOf(body).includes(CODE_A) && !codesOf(body).includes(CODE_B));
    } else {
      assert.strictEqual(body.decision, 'DENY');
      assert.deepStrictEqual(codesOf(body), expected);
      assert.strictEqual(body.policy_source, 'p1az-mock');
    }
  });
}

// ── Boundaries ───────────────────────────────────────────────────────────────────────────────
test('boundary RULE A: agent 500 passes, 500.01 is denied', async () => {
  assert.notStrictEqual((await decide(agent(500, STANDARD))).decision, 'DENY');
  const over = await decide(agent(500.01, STANDARD));
  assert.strictEqual(over.decision, 'DENY');
  assert.deepStrictEqual(codesOf(over), [CODE_A]);
});

test('boundary RULE B: direct standard 750 passes, 750.01 is denied', async () => {
  assert.notStrictEqual((await decide(direct(750, STANDARD))).decision, 'DENY');
  const over = await decide(direct(750.01, STANDARD));
  assert.strictEqual(over.decision, 'DENY');
  assert.deepStrictEqual(codesOf(over), [CODE_B]);
});

test('boundary: agent standard 750.01 fails A and B; agent premium 750 fails A only', async () => {
  assert.deepStrictEqual(codesOf(await decide(agent(750.01, STANDARD))), [CODE_A, CODE_B]);
  assert.deepStrictEqual(codesOf(await decide(agent(750, PREMIUM))), [CODE_A]);
});

// ── The limit is the user's data, not a constant in the rule ─────────────────────────────────
test('RULE A follows the user preference: AgentSpendLimit 800 lets 620 pass and still denies 940', async () => {
  assert.notStrictEqual((await decide(agent(620, STANDARD, { AgentSpendLimit: '800' }))).decision, 'DENY');
  const body = await decide(agent(940, PREMIUM, { AgentSpendLimit: '800' }));
  assert.strictEqual(body.decision, 'DENY');
  assert.deepStrictEqual(codesOf(body), [CODE_A]);
  assert.match(body.reason, /agent limit of 800/);
});

test('RULE A: a low user limit (200) denies a 300 agent booking and boundary 200 passes', async () => {
  assert.deepStrictEqual(codesOf(await decide(agent(300, STANDARD, { AgentSpendLimit: '200' }))), [CODE_A]);
  assert.notStrictEqual((await decide(agent(200, STANDARD, { AgentSpendLimit: '200' }))).decision, 'DENY');
});

test('missing, empty and garbage AgentSpendLimit fall back to 500 (fail closed, never "no limit")', async () => {
  for (const bad of [undefined, '', 'abc', 'NaN', '   ']) {
    const extra = bad === undefined ? {} : { AgentSpendLimit: bad };
    const over = await decide(agent(620, STANDARD, extra));
    assert.deepStrictEqual(codesOf(over), [CODE_A], `AgentSpendLimit=${JSON.stringify(bad)}`);
    assert.notStrictEqual((await decide(agent(500, STANDARD, extra))).decision, 'DENY');
  }
});

test('a user with no airlineMemberTier, an empty one or an unknown one is not premium (direct 940 = DENY by B)', async () => {
  for (const tier of [undefined, '', 'none', 'Premier Platinum', 'premier gold']) {
    assert.deepStrictEqual(codesOf(await decide(direct(940, tier))), [CODE_B], `airlineMemberTier=${JSON.stringify(tier)}`);
  }
  // A subject the store has never heard of, and a request with no subject at all.
  assert.deepStrictEqual(codesOf(await decide({ ...direct(940, undefined), ClientId: 'stranger', UserId: 'stranger' })), [CODE_B]);
  // No subject at all never reaches Rule B: the existing missing-user rule stops it first (still a DENY).
  const noSub = await decide({ ...direct(940, undefined), ClientId: '', UserId: '' });
  assert.strictEqual(noSub.decision, 'DENY');

});

test('the tier is read from the user, never from the request: a MemberTier the caller sends is ignored', async () => {
  // A standard user claiming premium on the wire is still standard ...
  assert.deepStrictEqual(codesOf(await decide({ ...direct(940, STANDARD), MemberTier: PREMIUM })), [CODE_B]);
  // ... and a premium user whose request claims 'none' is still premium.
  assert.notStrictEqual((await decide({ ...direct(940, PREMIUM), MemberTier: 'none' })).decision, 'DENY');
  // Flipping the user record flips the decision with the same request (the demo's 'set tier to Silver').
  const req = direct(940, PREMIUM);
  assert.notStrictEqual((await decide(req)).decision, 'DENY');
  users.setMockUser(req.UserId, { airlineMemberTier: STANDARD });
  assert.deepStrictEqual(codesOf(await decide(req)), [CODE_B]);
});

test('the premium tier set equals premiumTiers of the shared data file; every other seed tier is standard', async () => {
  for (const tier of DATA.premiumTiers) {
    assert.notStrictEqual((await decide(direct(940, tier))).decision, 'DENY', `${tier} must be premium`);
  }
  const seedTiers = new Set(SEED.passengers.map((p) => p.loyalty_tier));
  for (const tier of DATA.premiumTiers) assert.ok(seedTiers.has(tier), `${tier} must be a tier that exists in the seed`);
  for (const tier of [...seedTiers].filter((t) => !DATA.premiumTiers.includes(t))) {
    assert.deepStrictEqual(codesOf(await decide(direct(940, tier))), [CODE_B], `${tier} must be standard`);
  }
});

// ── Scope: only book_airline_flight, only tool calls ─────────────────────────────────────────
test('other tools at 940 are unaffected by both rules', async () => {
  const body = await decide({ ToolName: 'get_airline_bookings', TransactionAmount: '940', Amount: '940' });
  assert.ok(!codesOf(body).includes(CODE_A) && !codesOf(body).includes(CODE_B), `reason: ${body.reason}`);
});

test('non tools/call contexts are unaffected (McpRequest carries no tool)', async () => {
  const body = await decide({ DecisionContext: 'McpRequest', ...agent(940, STANDARD) });
  assert.ok(!codesOf(body).includes(CODE_A) && !codesOf(body).includes(CODE_B));
});

test('no amount at all is not denied by these rules (nothing to judge)', async () => {
  const body = await decide({});
  assert.ok(!codesOf(body).includes(CODE_A) && !codesOf(body).includes(CODE_B));
});

// ── Parity with the cloud snapshot ───────────────────────────────────────────────────────────
test('both deny codes exist as statements in the cloud snapshot', () => {
  assert.ok(CLOUD_CODES.has(CODE_A));
  assert.ok(CLOUD_CODES.has(CODE_B));
  assert.ok(!CLOUD_CODES.has('mcp-airline-booking-over-cap'), 'the single-rule code of the earlier draft is gone');
});

test('a deny entry carries ONLY `code` (a type/id field would shadow the code at the classifier)', async () => {
  const body = await decide(agent(940, STANDARD));
  for (const s of body.statements) assert.deepStrictEqual(Object.keys(s), ['code']);
});
