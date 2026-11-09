/**
 * @file snapshots/airlineBookingRules.test.js
 *
 * The two airline booking rules (Muse -> Agent Gateway -> PingOne Authorize):
 *   RULE A, user preference: "No tickets bought by an AI agent over $500"
 *           MCP Deny — Agent Booking Over User Limit  (mcp-airline-agent-spend-limit)
 *   RULE B, airline control: "Only premium members can book over $750"
 *           MCP Deny — Airline Premium-Only Over $750 (mcp-airline-premium-only)
 *
 *  - the generated attributes / conditions / statements / rules have the exact contracted shape
 *  - both rules sit ahead of the catch-all permit
 *  - the premium tier list in the rule is generated from the shared data file
 *  - merge-airline-booking-rules.js adds exactly those eight objects to an export that
 *    lacks them, is idempotent, and refuses an export it cannot merge into.
 *
 * Nothing here talks to PingOne. Run: node --test snapshots/airlineBookingRules.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { ATTR, COND, STMT, RULE, SNAP } = require('./gen-authorize-snapshot.js');
const { mergeAirlineBookingRules } = require('./merge-airline-booking-rules.js');

const MERGE = path.join(__dirname, 'merge-airline-booking-rules.js');
const DATA = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'demo_mcp_resource_server', 'seed', 'airline-booking-policy-data.json'), 'utf8'));
const readSnapshot = () => JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const byId = (snap, id) => snap.find((o) => o.id === id);
const MCP_POLICY = '56789012-0002-4321-abcd-000000000002';
const NEW_IDS = [
  ATTR.AgentSpendLimit, ATTR.MemberTier,
  COND.AgentBookingOverUserLimit, COND.PremiumOnlyBookingOver750,
  STMT.airlineAgentSpendLimit, STMT.airlinePremiumOnly,
  RULE.mcpDenyAirlineAgentSpendLimit, RULE.mcpDenyAirlinePremiumOnly,
];
const NEW_RULES = [RULE.mcpDenyAirlineAgentSpendLimit, RULE.mcpDenyAirlinePremiumOnly];
const ph = (id) => `{{${id}}}`;

/** The committed snapshot as a "live export" that predates the two rules. */
function exportWithoutRules() {
  const out = clone(readSnapshot()).filter((o) => !NEW_IDS.includes(o.id));
  const pol = byId(out, MCP_POLICY);
  pol.children = pol.children.filter((c) => !NEW_RULES.includes(c.id));
  return out;
}

const eq = (id, value) => ({ comparison: { left: { attribute: { id } }, op: 'Equals', right: { constant: { value } } } });

test('attributes: AgentSpendLimit NUMBER default 500 (request); MemberTier STRING default "none", read from the PingOne user airlineMemberTier', () => {
  const snap = readSnapshot();
  const limit = byId(snap, ATTR.AgentSpendLimit);
  const tier = byId(snap, ATTR.MemberTier);
  assert.strictEqual(limit.name, 'AgentSpendLimit');
  assert.strictEqual(limit.valueType, 'NUMBER');
  assert.strictEqual(limit.defaultValue, 500, 'the default is the user preference of $500');
  assert.strictEqual(tier.name, 'MemberTier');
  assert.strictEqual(tier.valueType, 'STRING');
  assert.strictEqual(tier.defaultValue, 'none', 'an absent tier must not be premium');
  assert.strictEqual(limit.resolvers[0].attributeResolverType, 'request');
  // MemberTier is NOT request-resolved: no caller or gateway can supply it. The exact snapshot token for
  // the PingOne User resolver is UNVERIFIED (see pingOneUserAttr in the generator); the semantics are pinned.
  assert.strictEqual(tier.resolvers.length, 1);
  const r = tier.resolvers[0];
  assert.notStrictEqual(r.attributeResolverType, 'request', 'MemberTier must not be request-resolved');
  assert.deepStrictEqual(r.userId, { attribute: { id: ATTR.UserId } }, 'keyed on the token sub (UserId)');
  assert.strictEqual(r.valueProcessor.expression, "$['airlineMemberTier']", 'reads the PingOne user custom attribute airlineMemberTier');
  assert.ok(/airlineMemberTier/.test(tier.description) && /UNVERIFIED/.test(tier.description));
});

test('RULE A condition: ToolName = book_airline_flight AND NOT(ActClientId = "") AND Amount > attribute AgentSpendLimit', () => {
  const cond = byId(readSnapshot(), COND.AgentBookingOverUserLimit);
  assert.strictEqual(cond.name, 'AgentBookingOverUserLimit');
  assert.deepStrictEqual(cond.condition, { and: { conditions: [
    eq(ATTR.ToolName, 'book_airline_flight'),
    { not: { condition: eq(ATTR.ActClientId, '') } },
    { comparison: { left: { attribute: { id: ATTR.Amount } }, op: 'GreaterThan', right: { attribute: { id: ATTR.AgentSpendLimit } } } },
  ] } });
});

test('RULE B condition: ToolName = book_airline_flight AND Amount > "750" AND NOT(OR(MemberTier = each premium tier))', () => {
  const cond = byId(readSnapshot(), COND.PremiumOnlyBookingOver750);
  assert.strictEqual(cond.name, 'PremiumOnlyBookingOver750');
  assert.deepStrictEqual(cond.condition, { and: { conditions: [
    eq(ATTR.ToolName, 'book_airline_flight'),
    { comparison: { left: { attribute: { id: ATTR.Amount } }, op: 'GreaterThan', right: { constant: { value: '750' } } } },
    { not: { condition: { or: { conditions: DATA.premiumTiers.map((t) => eq(ATTR.MemberTier, t)) } } } },
  ] } });
  assert.deepStrictEqual(DATA.premiumTiers, ['Premier Gold'], 'premium = Premier Gold is the documented assumption');
});

test('both comparisons are strict GreaterThan, never GreaterThanOrEqual (exactly 500 and exactly 750 pass)', () => {
  const snap = readSnapshot();
  for (const id of [COND.AgentBookingOverUserLimit, COND.PremiumOnlyBookingOver750]) {
    const text = JSON.stringify(byId(snap, id).condition);
    assert.ok(text.includes('"op":"GreaterThan"'));
    assert.ok(!/GreaterThanOrEqual|GreaterOrEqual|"op":"GreaterThanEqual/.test(text));
  }
});

test('RULE A statement and rule: exact name, code, payload', () => {
  const snap = readSnapshot();
  const stmt = byId(snap, STMT.airlineAgentSpendLimit);
  assert.strictEqual(stmt.name, 'MCP Denied — Agent Booking Over User Limit');
  assert.strictEqual(stmt.code, 'mcp-airline-agent-spend-limit');
  assert.strictEqual(stmt.appliesTo, 'DENY');
  assert.strictEqual(stmt.shared, false);
  const payload = JSON.parse(stmt.payload);
  assert.strictEqual(payload.denied, true);
  assert.strictEqual(payload.reason, 'agent_spend_limit');
  assert.strictEqual(payload.message,
    `Booking denied: an AI agent cannot buy a ticket over your limit of $${ph(ATTR.AgentSpendLimit)}. ` +
    `Fare $${ph(ATTR.Amount)} on '${ph(ATTR.ToolName)}'.`);
  assert.strictEqual(payload.amount, ph(ATTR.Amount));
  assert.strictEqual(payload.limit, ph(ATTR.AgentSpendLimit));

  const rule = byId(snap, RULE.mcpDenyAirlineAgentSpendLimit);
  assert.strictEqual(rule.name, 'MCP Deny — Agent Booking Over User Limit');
  assert.strictEqual(rule.effectSettings.type, 'conditionalDenyElsePermit');
  assert.deepStrictEqual(rule.statements, [STMT.airlineAgentSpendLimit, STMT.mcpSharedDeny]);
  assert.match(rule.description, /No tickets bought by an AI agent over \$500/);
});

test('RULE B statement and rule: exact name, code, payload', () => {
  const snap = readSnapshot();
  const stmt = byId(snap, STMT.airlinePremiumOnly);
  assert.strictEqual(stmt.name, 'MCP Denied — Airline Premium-Only Over $750');
  assert.strictEqual(stmt.code, 'mcp-airline-premium-only');
  assert.strictEqual(stmt.appliesTo, 'DENY');
  assert.strictEqual(stmt.shared, false);
  const payload = JSON.parse(stmt.payload);
  assert.strictEqual(payload.denied, true);
  assert.strictEqual(payload.reason, 'premium_only');
  assert.strictEqual(payload.message,
    `Booking denied: fares over $750 are for premium members only. Fare $${ph(ATTR.Amount)}, member tier '${ph(ATTR.MemberTier)}'.`);
  assert.strictEqual(payload.amount, ph(ATTR.Amount));
  assert.strictEqual(payload.tier, ph(ATTR.MemberTier));

  const rule = byId(snap, RULE.mcpDenyAirlinePremiumOnly);
  assert.strictEqual(rule.name, 'MCP Deny — Airline Premium-Only Over $750');
  assert.strictEqual(rule.effectSettings.type, 'conditionalDenyElsePermit');
  assert.deepStrictEqual(rule.statements, [STMT.airlinePremiumOnly, STMT.mcpSharedDeny]);
  assert.match(rule.description, /Only premium members can book over \$750/);
});

test('statement codes are distinct from each other and from the single-rule code of the earlier draft', () => {
  const codes = readSnapshot().filter((o) => o.type === 'Statement').map((o) => o.code);
  assert.strictEqual(codes.filter((c) => c === 'mcp-airline-agent-spend-limit').length, 1);
  assert.strictEqual(codes.filter((c) => c === 'mcp-airline-premium-only').length, 1);
  assert.ok(!codes.includes('mcp-airline-booking-over-cap'));
});

test('both rules are in the MCP policy, ahead of the catch-all permit (which stays last)', () => {
  const ids = byId(readSnapshot(), MCP_POLICY).children.map((c) => c.id);
  for (const r of NEW_RULES) {
    assert.ok(ids.includes(r));
    assert.ok(ids.indexOf(r) < ids.indexOf(RULE.mcpPermitValid));
  }
  assert.strictEqual(ids[ids.length - 1], RULE.mcpPermitValid);
});

test('the new conditions read only ToolName, Amount, ActClientId, AgentSpendLimit, MemberTier', () => {
  const snap = readSnapshot();
  const used = (id) => [...JSON.stringify(byId(snap, id).condition).matchAll(/"id":"([0-9a-f-]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(used(COND.AgentBookingOverUserLimit))].sort(),
    [ATTR.ToolName, ATTR.ActClientId, ATTR.Amount, ATTR.AgentSpendLimit].sort());
  assert.deepStrictEqual([...new Set(used(COND.PremiumOnlyBookingOver750))].sort(),
    [ATTR.ToolName, ATTR.Amount, ATTR.MemberTier].sort());
});

test('exactly the eight new objects exist; the old single-rule objects are gone', () => {
  const snap = readSnapshot();
  for (const id of NEW_IDS) assert.ok(byId(snap, id), `${id} must exist`);
  assert.ok(!snap.some((o) => /Airline Booking Over \$500|ExceedsAirlineBookingCap/.test(o.name || '')));
});

test('merge: adds exactly the eight objects and the policy children, result equals the committed rule set', () => {
  const generated = readSnapshot();
  const before = exportWithoutRules();
  const res = mergeAirlineBookingRules(before, generated);
  assert.strictEqual(res.changed, true);
  for (const id of NEW_IDS) {
    assert.deepStrictEqual(byId(res.merged, id), byId(generated, id), `${id} must equal the committed object`);
  }
  assert.strictEqual(res.merged.length, generated.length);
  const merged = byId(res.merged, MCP_POLICY);
  assert.deepStrictEqual(merged.children, byId(generated, MCP_POLICY).children);
  assert.notStrictEqual(merged.version, byId(before, MCP_POLICY).version, 'policy version must move or PingOne skips the new children');
  for (const o of before) {
    if (o.id === MCP_POLICY || !o.id) continue;
    assert.deepStrictEqual(byId(res.merged, o.id), o, `${o.id} must be unchanged`);
  }
  assert.strictEqual(res.merged.filter((o) => o.type === 'PolicySet').length, 1);
  // The merged rule set equals the committed snapshot's.
  const ruleSet = (s) => s.filter((o) => o.type === 'Rule').map((o) => o.id).sort();
  assert.deepStrictEqual(ruleSet(res.merged), ruleSet(generated));
});

test('merge: idempotent - a second run changes nothing', () => {
  const generated = readSnapshot();
  const first = mergeAirlineBookingRules(exportWithoutRules(), generated);
  const second = mergeAirlineBookingRules(first.merged, generated);
  assert.strictEqual(second.changed, false);
  assert.deepStrictEqual(second.merged, first.merged);
  assert.strictEqual(mergeAirlineBookingRules(clone(generated), generated).changed, false);
});

test('merge: an environment that already has an attribute of the same name keeps its id', () => {
  const generated = readSnapshot();
  const exp = exportWithoutRules();
  const own = { ...clone(byId(generated, ATTR.MemberTier)), id: '99999999-0001-4321-abcd-000000000001' };
  exp.splice(exp.findIndex((o) => o.objectType === 'AttributeDefinition'), 0, own);
  const res = mergeAirlineBookingRules(exp, generated);
  assert.strictEqual(res.merged.filter((o) => o.name === 'MemberTier').length, 1, 'no second MemberTier attribute');
  const condB = JSON.stringify(byId(res.merged, COND.PremiumOnlyBookingOver750).condition);
  assert.ok(condB.includes(own.id) && !condB.includes(ATTR.MemberTier), 'the condition reads the environment attribute');
});

test('merge: refuses an export whose MemberTier is still request-resolved (the old gateway-side design)', () => {
  const generated = readSnapshot();
  const exp = exportWithoutRules();
  const stale = { ...clone(byId(generated, ATTR.MemberTier)), id: '99999999-0002-4321-abcd-000000000002' };
  stale.resolvers = [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }];
  exp.splice(exp.findIndex((o) => o.objectType === 'AttributeDefinition'), 0, stale);
  assert.throws(() => mergeAirlineBookingRules(exp, generated), /still resolved from the request/);
});

test('merge: refuses an export without ToolName, Amount, ActClientId, the MCP policy or the shared denied statement', () => {
  const generated = readSnapshot();
  const drop = (pred) => exportWithoutRules().filter((o) => !pred(o));
  assert.throws(() => mergeAirlineBookingRules(drop((o) => o.type === 'ATTRIBUTE' && o.name === 'ToolName'), generated), /ToolName/);
  assert.throws(() => mergeAirlineBookingRules(drop((o) => o.type === 'ATTRIBUTE' && o.name === 'Amount'), generated), /Amount/);
  assert.throws(() => mergeAirlineBookingRules(drop((o) => o.type === 'ATTRIBUTE' && o.name === 'ActClientId'), generated), /ActClientId/);
  assert.throws(() => mergeAirlineBookingRules(drop((o) => o.id === MCP_POLICY), generated), /MCP Delegation policy/);
  assert.throws(() => mergeAirlineBookingRules(drop((o) => o.id === STMT.mcpSharedDeny), generated), /shared/);
  assert.throws(() => mergeAirlineBookingRules(drop((o) => o.type === 'PolicySet'), generated), /PolicySet/);
});

test('merge CLI: writes the merged package, never touches the input, exits 1 on a refusal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-merge-'));
  try {
    const input = path.join(dir, 'export.json');
    const out = path.join(dir, 'out.json');
    const out2 = path.join(dir, 'out2.json');
    fs.writeFileSync(input, JSON.stringify(exportWithoutRules()));
    const before = fs.readFileSync(input, 'utf8');
    const r1 = spawnSync(process.execPath, [MERGE, input, out], { encoding: 'utf8' });
    assert.strictEqual(r1.status, 0, r1.stderr);
    assert.strictEqual(fs.readFileSync(input, 'utf8'), before, 'the input export is never modified');
    const r2 = spawnSync(process.execPath, [MERGE, out, out2], { encoding: 'utf8' });
    assert.strictEqual(r2.status, 0, r2.stderr);
    assert.strictEqual(fs.readFileSync(out2, 'utf8'), fs.readFileSync(out, 'utf8'), 'second run output is byte-identical');

    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify([{ type: 'Policy', id: 'x', name: 'nope', children: [] }]));
    const r3 = spawnSync(process.execPath, [MERGE, bad, path.join(dir, 'never.json')], { encoding: 'utf8' });
    assert.strictEqual(r3.status, 1);
    assert.ok(!fs.existsSync(path.join(dir, 'never.json')), 'nothing written on a refusal');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
