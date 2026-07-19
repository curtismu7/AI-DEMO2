/**
 * @file snapshots/authorizeSnapshotCloudDelta.test.js
 *
 * Coverage for the cloud-policy delta steps in gen-authorize-snapshot.js:
 *
 *  0. BLOCKER — HasValidMcpAudience (cond 0007) must use set semantics.
 *     The in-tree condition was `TokenAudience Equals McpResourceUri`
 *     (attribute-to-attribute string equality). After the round-2 C1 fixes every
 *     caller sends the token's REAL single `aud` as TokenAudience and a
 *     comma-joined accepted-identity list as McpResourceUri — never equal, so
 *     importing that snapshot DENIES ALL MCP TRAFFIC. The fix is an OR of
 *     `TokenAudience Equals <accepted gateway identity>` derived from
 *     scope-topology.json resources (never hardcoded — REGRESSION_PLAN §3).
 *
 * Run: node --test snapshots/authorizeSnapshotCloudDelta.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  reconcile,
  loadSot,
  deriveSot,
  ATTR,
  COND,
  STMT,
  RULE,
  SNAP,
} = require('./gen-authorize-snapshot.js');

const SOT_PATH = path.join(__dirname, '..', 'scope-topology.json');

const readSnapshot = () => JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const readSot = () => JSON.parse(fs.readFileSync(SOT_PATH, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const findById = (snap, id) => snap.find((o) => o.id === id);
const reconciled = () => reconcile(clone(readSnapshot()), loadSot());

/** Collect every `comparison` node in a condition tree. */
function comparisons(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.comparison) out.push(node.comparison);
  if (node.and) (node.and.conditions || []).forEach((c) => comparisons(c, out));
  if (node.or) (node.or.conditions || []).forEach((c) => comparisons(c, out));
  if (node.not) comparisons(node.not.condition, out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 0 — HasValidMcpAudience set semantics (the import blocker)
// ─────────────────────────────────────────────────────────────────────────────

test('step 0: HasValidMcpAudience is an OR of TokenAudience Equals <SoT gateway identity>', () => {
  const cond = findById(reconciled(), COND.HasValidMcpAudience);
  assert.ok(cond, 'HasValidMcpAudience must exist');

  const sotResources = readSot().resources;
  const expected = [
    sotResources['Super Banking MCP Gateway'].uri,
    sotResources['Super Banking PingGateway MCP'].uri,
  ];
  // Literal pin: these are the two identities the runtime accepts
  // (PG_GATEWAY_RESOURCE_URI + PG_GATEWAY_RESOURCE_ID / groovy acceptedAuds).
  assert.deepStrictEqual(expected, ['mcpgateway.ping.demo', 'https://api.ping.demo:3036/mcp']);

  const branches = cond.condition.or.conditions;
  assert.deepStrictEqual(
    branches.map((c) => c.comparison.right.constant.value),
    expected,
    'accepted audience constants must come from scope-topology.json resources',
  );
  for (const c of branches) {
    assert.strictEqual(c.comparison.left.attribute.id, ATTR.TokenAudience);
    assert.strictEqual(c.comparison.op, 'Equals');
  }
});

test('step 0: no attribute-to-attribute comparison survives in HasValidMcpAudience', () => {
  const cond = findById(reconciled(), COND.HasValidMcpAudience);
  assert.ok(cond && cond.objectType === 'ConditionDefinition', 'HasValidMcpAudience must be addressable by stable id');
  const cmps = comparisons(cond.condition);
  assert.ok(cmps.length >= 2, 'expected one comparison per accepted gateway identity');
  for (const cmp of cmps) {
    assert.ok(
      !cmp.right.attribute,
      'the broken TokenAudience==McpResourceUri attribute equality must be gone',
    );
    assert.ok(cmp.right.constant, 'every branch must compare against a constant');
  }
});

test('step 0: rule 0004 (MCP Deny — Invalid Token Audience) is untouched', () => {
  const before = findById(readSnapshot(), RULE.mcpDenyAudience);
  const after = findById(reconciled(), RULE.mcpDenyAudience);
  assert.ok(before && after, 'rule 45678901-0004 must exist');
  assert.deepStrictEqual(after, before, 'only the CONDITION changes, not the rule');
  assert.deepStrictEqual(
    after.effectSettings.condition,
    { not: { condition: { reference: { id: COND.HasValidMcpAudience } } } },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for the fine-grained deny rules (3a/3d/3e/3f/3g)
// ─────────────────────────────────────────────────────────────────────────────

const SHARED_DENY_STMT = '34567890-0004-4321-abcd-000000000004';

/** Assert the standard deny-rule shape: conditional deny over condId, [specific stmt, shared stmt]. */
function assertDenyRule(snap, ruleId, condId, stmtId, code) {
  const rule = findById(snap, ruleId);
  assert.ok(rule && rule.type === 'Rule', `rule ${ruleId} must exist`);
  assert.strictEqual(rule.effectSettings.type, 'conditionalDenyElsePermit');
  assert.deepStrictEqual(rule.effectSettings.condition, { and: { conditions: [{ reference: { id: condId } }] } });
  assert.deepStrictEqual(rule.statements, [stmtId, SHARED_DENY_STMT],
    'deny rules carry the specific statement plus the shared mcp-authorization-denied');

  const stmt = findById(snap, stmtId);
  assert.ok(stmt && stmt.type === 'Statement', `statement ${stmtId} must exist`);
  assert.strictEqual(stmt.code, code);
  assert.strictEqual(stmt.appliesTo, 'DENY');
  assert.strictEqual(stmt.shared, false, 'single-parent statements stay shared:false');

  // Membership: in the MCP Delegation policy, BEFORE the catch-all permit, and
  // NOT in the Transaction policy.
  const mcpPolicy = findById(snap, '56789012-0002-4321-abcd-000000000002');
  const txPolicy = findById(snap, '56789012-0001-4321-abcd-000000000001');
  const childIds = mcpPolicy.children.map((c) => c.id);
  assert.ok(childIds.includes(ruleId), `rule ${ruleId} must be a child of the MCP policy`);
  assert.ok(
    childIds.indexOf(ruleId) < childIds.indexOf(RULE.mcpPermitValid),
    'deny rule must be evaluated before the catch-all MCP Permit Valid',
  );
  assert.ok(!txPolicy.children.some((c) => c.id === ruleId), 'must not leak into the Transaction policy');
}

/** Assert a request-resolved attribute definition. */
function assertAttr(snap, attrId, name, valueType, defaultValue) {
  const attr = findById(snap, attrId);
  assert.ok(attr && attr.objectType === 'AttributeDefinition', `attribute ${name} (${attrId}) must exist`);
  assert.strictEqual(attr.name, name);
  assert.strictEqual(attr.valueType, valueType);
  assert.strictEqual(attr.defaultValue, defaultValue);
  assert.deepStrictEqual(attr.resolvers, [
    { attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null },
  ], `${name} must be resolved from the request`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3a — D-05 anti-bypass: TokenAudActual must not target an upstream audience
// ─────────────────────────────────────────────────────────────────────────────

test('3a: loadSot derives the upstream audiences from the SoT (mock parity)', () => {
  const { upstreamAudiences } = loadSot();
  const res = readSot().resources;
  assert.deepStrictEqual(upstreamAudiences, [
    res['Super Banking MCP Server'].uri,     // mcpserver.ping.demo
    res['Super Banking MCP Invest'].uri,     // mcp-invest.ping.demo
    'https://banking-resource-server.ping.demo', // banking RS (env default, same as scopeTopology.js)
  ]);
  assert.ok(!upstreamAudiences.includes(res['Super Banking MCP Gateway'].uri),
    'the gateway itself is never an upstream (parity with scopeTopology.upstreamAudiences)');
});

test('3a: deriveSot fails loudly when an upstream resource is missing from the SoT', () => {
  for (const name of ['Super Banking MCP Server', 'Super Banking MCP Invest']) {
    const sot = readSot();
    delete sot.resources[name];
    assert.throws(() => deriveSot(sot), new RegExp(name));
  }
});

test('3a: TokenAudActual attribute + TokenAudTargetsUpstream condition + deny rule', () => {
  const snap = reconciled();
  assertAttr(snap, ATTR.TokenAudActual, 'TokenAudActual', 'STRING', '');

  const cond = findById(snap, COND.TokenAudTargetsUpstream);
  assert.ok(cond && cond.objectType === 'ConditionDefinition');
  const { upstreamAudiences } = loadSot();
  assert.deepStrictEqual(
    cond.condition.or.conditions.map((c) => c.comparison.right.constant.value),
    upstreamAudiences,
  );
  for (const c of cond.condition.or.conditions) {
    assert.strictEqual(c.comparison.left.attribute.id, ATTR.TokenAudActual);
    assert.strictEqual(c.comparison.op, 'Equals');
  }
  // The single-aud limitation must be documented on the object itself.
  assert.match(cond.description, /space-joined|single/i);

  assertDenyRule(snap, RULE.mcpDenyUpstreamAud, COND.TokenAudTargetsUpstream,
    STMT.bypassAttempt, 'mcp-bypass-attempt');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3d — resource owner mismatch (mock Rule 3.5a)
// ─────────────────────────────────────────────────────────────────────────────

test('3d: ResourceOwnerId attribute + ResourceOwnerMismatch condition + deny rule', () => {
  const snap = reconciled();
  assertAttr(snap, ATTR.ResourceOwnerId, 'ResourceOwnerId', 'STRING', '');

  const cond = findById(snap, COND.ResourceOwnerMismatch);
  assert.ok(cond && cond.objectType === 'ConditionDefinition');
  assert.deepStrictEqual(cond.condition, { and: { conditions: [
    { comparison: { left: { attribute: { id: ATTR.ResourceOwnerId } }, op: 'NotEquals', right: { constant: { value: '' } } } },
    { comparison: { left: { attribute: { id: ATTR.ResourceOwnerId } }, op: 'NotEquals', right: { attribute: { id: ATTR.UserId } } } },
  ] } }, 'owner set AND owner != requesting user (attribute-to-attribute NotEquals is supported)');

  assertDenyRule(snap, RULE.mcpDenyResourceOwner, COND.ResourceOwnerMismatch,
    STMT.resourceOwnerMismatch, 'mcp-resource-owner-mismatch');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3e — RAR amount ceiling (mock Rule 3c, amount half)
// ─────────────────────────────────────────────────────────────────────────────

test('3e: RarMaxAmount attribute + ExceedsRarAmountCeiling condition + deny rule', () => {
  const snap = reconciled();
  assertAttr(snap, ATTR.RarMaxAmount, 'RarMaxAmount', 'STRING', '');

  const cond = findById(snap, COND.ExceedsRarAmountCeiling);
  assert.ok(cond && cond.objectType === 'ConditionDefinition');
  assert.deepStrictEqual(cond.condition, { and: { conditions: [
    { comparison: { left: { attribute: { id: ATTR.RarMaxAmount } }, op: 'NotEquals', right: { constant: { value: '' } } } },
    { comparison: { left: { attribute: { id: ATTR.Amount } }, op: 'GreaterThan', right: { attribute: { id: ATTR.RarMaxAmount } } } },
  ] } }, 'RAR ceiling present AND Amount above it');

  assertDenyRule(snap, RULE.mcpDenyRarAmount, COND.ExceedsRarAmountCeiling,
    STMT.rarAmountExceeded, 'mcp-rar-amount-exceeded');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3f — intent token binding (mock Rules 4a/4b)
// ─────────────────────────────────────────────────────────────────────────────

test('3f: intent attributes + IntentTokenTampered condition + deny rule (Rule 4a)', () => {
  const snap = reconciled();
  assertAttr(snap, ATTR.IntentTokenValid, 'IntentTokenValid', 'STRING', '');
  assertAttr(snap, ATTR.IntentMatchesTool, 'IntentMatchesTool', 'STRING', '');
  assertAttr(snap, ATTR.IntentTokenError, 'IntentTokenError', 'STRING', '');

  const cond = findById(snap, COND.IntentTokenTampered);
  assert.ok(cond && cond.objectType === 'ConditionDefinition');
  assert.deepStrictEqual(cond.condition, { and: { conditions: [
    { comparison: { left: { attribute: { id: ATTR.IntentTokenValid } }, op: 'Equals', right: { constant: { value: 'false' } } } },
    { or: { conditions: ['malformed', 'invalid_signature', 'malformed_payload'].map((e) => ({
      comparison: { left: { attribute: { id: ATTR.IntentTokenError } }, op: 'Equals', right: { constant: { value: e } } },
    })) } },
  ] } }, 'present-and-TAMPERED only — expired and absent tokens pass (mock INTENT_TAMPER_ERRORS)');

  assertDenyRule(snap, RULE.mcpDenyIntentInvalid, COND.IntentTokenTampered,
    STMT.intentInvalid, 'mcp-intent-invalid');
});

test('3f: IntentToolMismatch condition + deny rule (Rule 4b)', () => {
  const snap = reconciled();
  const cond = findById(snap, COND.IntentToolMismatch);
  assert.ok(cond && cond.objectType === 'ConditionDefinition');
  assert.deepStrictEqual(cond.condition, { and: { conditions: [
    { comparison: { left: { attribute: { id: ATTR.IntentTokenValid } }, op: 'Equals', right: { constant: { value: 'true' } } } },
    { comparison: { left: { attribute: { id: ATTR.IntentMatchesTool } }, op: 'Equals', right: { constant: { value: 'false' } } } },
  ] } }, 'a VALID intent token whose permitted_tools does not cover the invoked tool');

  assertDenyRule(snap, RULE.mcpDenyIntentMismatch, COND.IntentToolMismatch,
    STMT.intentMismatch, 'mcp-intent-mismatch');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3g — UserRole admin restriction on write tools (mock Rule 2.95)
// ─────────────────────────────────────────────────────────────────────────────

test('3g: loadSot derives the write-tool list exactly like scopeTopology.isWriteTool', () => {
  const { writeTools } = loadSot();
  const tools = readSot().tools;
  const expected = Object.keys(tools)
    .filter((n) => (tools[n].requiredScopes || []).includes('write'))
    .sort();
  assert.deepStrictEqual(writeTools, expected);
  assert.ok(writeTools.includes('create_transfer') && writeTools.includes('create_withdrawal'));
  assert.ok(!writeTools.includes('get_my_accounts'), 'read tools must stay open to admins');
});

test('3g: UserRole attribute + AdminRoleOnWriteTool condition + deny rule (Rule 2.95)', () => {
  const snap = reconciled();
  assertAttr(snap, ATTR.UserRole, 'UserRole', 'STRING', 'none');

  const cond = findById(snap, COND.AdminRoleOnWriteTool);
  assert.ok(cond && cond.objectType === 'ConditionDefinition');
  const { writeTools } = loadSot();
  assert.deepStrictEqual(cond.condition, { and: { conditions: [
    { comparison: { left: { attribute: { id: ATTR.UserRole } }, op: 'Equals', right: { constant: { value: 'admin' } } } },
    { or: { conditions: writeTools.map((t) => ({
      comparison: { left: { attribute: { id: ATTR.ToolName } }, op: 'Equals', right: { constant: { value: t } } },
    })) } },
  ] } }, 'admin AND ToolName in the SoT write-tool list');

  assertDenyRule(snap, RULE.mcpDenyAdminRole, COND.AdminRoleOnWriteTool,
    STMT.adminRole, 'mcp-admin-role-not-permitted');
});

test('3g: UserRole is a RESTRICTION only — no permit branch consumes it', () => {
  const snap = reconciled();
  // The only condition reading UserRole is AdminRoleOnWriteTool …
  const condsUsingUserRole = snap.filter((o) =>
    o.objectType === 'ConditionDefinition' &&
    comparisons(o.condition).some((c) =>
      (c.left.attribute && c.left.attribute.id === ATTR.UserRole) ||
      (c.right.attribute && c.right.attribute.id === ATTR.UserRole)));
  assert.deepStrictEqual(condsUsingUserRole.map((o) => o.id), [COND.AdminRoleOnWriteTool]);
  // … and the only rule referencing that condition is the DENY rule (re-adding
  // a permit-for-admin branch would reinstate F5).
  const rulesUsingCond = snap.filter((o) => o.type === 'Rule' &&
    JSON.stringify(o).includes(COND.AdminRoleOnWriteTool));
  assert.deepStrictEqual(rulesUsingCond.map((o) => o.id), [RULE.mcpDenyAdminRole]);
  assert.strictEqual(rulesUsingCond[0].effectSettings.type, 'conditionalDenyElsePermit');
});

// ─────────────────────────────────────────────────────────────────────────────
// Structure — exactly the intended delta, idempotent, committed
// ─────────────────────────────────────────────────────────────────────────────

test('structure: the committed snapshot carries all 25 new objects (98 total) and is reconciled', () => {
  const committed = readSnapshot();
  assert.strictEqual(committed.length, 98, '73 pre-delta objects + 7 attrs + 6 conds + 6 stmts + 6 rules');
  assert.deepStrictEqual(reconcile(clone(committed), loadSot()), committed,
    'committed snapshot is out of date — run: node snapshots/gen-authorize-snapshot.js');

  const newIds = [
    ATTR.TokenAudActual, ATTR.ResourceOwnerId, ATTR.RarMaxAmount,
    ATTR.IntentTokenValid, ATTR.IntentMatchesTool, ATTR.IntentTokenError, ATTR.UserRole,
    COND.TokenAudTargetsUpstream, COND.ResourceOwnerMismatch, COND.ExceedsRarAmountCeiling,
    COND.IntentTokenTampered, COND.IntentToolMismatch, COND.AdminRoleOnWriteTool,
    STMT.bypassAttempt, STMT.resourceOwnerMismatch, STMT.rarAmountExceeded,
    STMT.intentInvalid, STMT.intentMismatch, STMT.adminRole,
    RULE.mcpDenyUpstreamAud, RULE.mcpDenyResourceOwner, RULE.mcpDenyRarAmount,
    RULE.mcpDenyIntentInvalid, RULE.mcpDenyIntentMismatch, RULE.mcpDenyAdminRole,
  ];
  assert.strictEqual(new Set(newIds).size, 25, 'the 25 new ids must be distinct');
  for (const id of newIds) assert.ok(findById(committed, id), `committed snapshot must contain ${id}`);
});

test('structure: all six deny rules run before the MCP catch-all permit, in order', () => {
  const mcpPolicy = findById(reconciled(), '56789012-0002-4321-abcd-000000000002');
  const childIds = mcpPolicy.children.map((c) => c.id);
  const denies = [
    RULE.mcpDenyUpstreamAud, RULE.mcpDenyResourceOwner, RULE.mcpDenyRarAmount,
    RULE.mcpDenyIntentInvalid, RULE.mcpDenyIntentMismatch, RULE.mcpDenyAdminRole,
  ];
  const permitIdx = childIds.indexOf(RULE.mcpPermitValid);
  assert.strictEqual(permitIdx, childIds.length - 1, 'the catch-all permit stays last');
  assert.deepStrictEqual(childIds.slice(permitIdx - denies.length, permitIdx), denies);
});

test('step 0: deriveSot fails loudly when a gateway resource is missing from the SoT', () => {
  const sot = readSot();
  delete sot.resources['Super Banking PingGateway MCP'];
  assert.throws(
    () => deriveSot(sot),
    /Super Banking PingGateway MCP/,
    'a missing gateway resource must abort generation, not emit a partial rule',
  );

  const sot2 = readSot();
  delete sot2.resources['Super Banking MCP Gateway'];
  assert.throws(() => deriveSot(sot2), /Super Banking MCP Gateway/);
});
