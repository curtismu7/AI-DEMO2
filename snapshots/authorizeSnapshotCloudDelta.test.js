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
    sotResources['Super Banking PingGateway MCP - API-Key'].uri,
    sotResources['Super Banking A2A MCP Gateway'].uri,
  ];
  // Literal pin: the identities the runtime accepts — MCP_GW_RESOURCE_URI on the
  // Node gateway and p1az-decision.groovy's acceptedAuds (PG_GATEWAY_RESOURCE_URI,
  // PG_GATEWAY_RESOURCE_ID, PG_APIKEY_RESOURCE_ID) carry exactly these four.
  //
  // The A2A entry was MISSING here and in GATEWAY_RESOURCE_NAMES once before.
  // Its resource was added to the SoT after both were written, so the generated
  // snapshot accepted only 2 of the 3 identities the runtime accepted at the
  // time. Importing it would have made HasValidMcpAudience false for every A2A
  // token — and rule 45678901-0004 denies NOT that condition — so ALL A2A
  // TRAFFIC WOULD HAVE BEEN DENIED. Same all-or-nothing shape is why the
  // api-key-disposition identity (/mcp/apikey — see 00-mcp-apikey.json's
  // McpProtectionFilter.resourceId) is pinned here too, not just derived: a
  // derivation that silently drops a resource looks correct.
  assert.deepStrictEqual(expected, [
    'mcpgateway.ping.demo',
    'https://api.ping.demo:3036/mcp',
    'https://api.ping.demo:3036/mcp/apikey',
    'mcpgateway-a2a.ping.demo',
  ]);

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

// ─────────────────────────────────────────────────────────────────────────────
// UC2 — A2A delegation depth. This rule shipped INVERTED.
// ─────────────────────────────────────────────────────────────────────────────

test('a2a: RequiresA2aDelegation denies a SHALLOW chain, never a valid two-hop one', () => {
  const cond = findById(reconciled(), COND.RequiresA2aDelegation);
  assert.ok(cond, 'RequiresA2aDelegation must exist');

  // depth < 2 is expressed as NOT(depth > 1): the bare comparison keeps the
  // inherited `GreaterThan "1"` and the NOT wrapper is what inverts it.
  const negated = cond.condition.and.conditions.find((c) => c.not);
  assert.ok(negated, 'the depth test must be NEGATED — an un-negated GreaterThan denies the CORRECT two-hop chain');

  const depth = negated.not.condition.comparison;
  assert.strictEqual(depth.left.attribute.id, ATTR.ActChainDepth);
  assert.strictEqual(depth.op, 'GreaterThan');
  assert.strictEqual(depth.right.constant.value, '1');
  // STRING, not a number. The whole snapshot is 163 string constants, 2 booleans
  // and zero numbers; `Amount GreaterThan "2000"` is a string and demonstrably
  // denies a 5000 transfer live. A first draft used `LessThan` with a numeric 2,
  // introducing an untested operator AND value type at once.
  assert.strictEqual(typeof depth.right.constant.value, 'string');
});

test('a2a: the depth test uses only operators this snapshot already exercises', () => {
  // Guards the class of bug above rather than the one instance: an operator or
  // value type that appears exactly once is unproven against the live DSL, and
  // the import is the last place to discover that.
  const snap = reconciled();
  const ops = new Set();
  const valueTypes = new Set();
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.comparison) {
      ops.add(n.comparison.op);
      const c = n.comparison.right?.constant;
      if (c && 'value' in c) valueTypes.add(typeof c.value);
    }
    for (const v of Object.values(n)) visit(v);
  };
  snap.forEach(visit);
  assert.ok(!ops.has('LessThan'), 'LessThan is not used anywhere else in this snapshot');
  assert.ok(!valueTypes.has('number'), 'numeric constants are unprecedented here — use the quoted form');
});

test('a2a: the gated tool list comes from scope-topology a2aDelegated, not hand-typed', () => {
  const cond = findById(reconciled(), COND.RequiresA2aDelegation);
  const tools = comparisons(cond.condition)
    .filter((c) => c.left?.attribute?.id === ATTR.ToolName)
    .map((c) => c.right.constant.value)
    .sort();
  const expected = Object.entries(readSot().tools)
    .filter(([, m]) => m && m.a2aDelegated === true)
    .map(([n]) => n)
    .sort();
  assert.ok(expected.length > 0, 'SoT must declare a2aDelegated tools');
  assert.deepStrictEqual(tools, expected,
    'adding a specialist tool to the SoT must gate it here automatically');
});

test('actor chain: every A2A specialist in the env is a registered actor', () => {
  // The four specialists missing from this list (tax, finaid, supplier,
  // holdings) mapped EXACTLY to the four verticals that failed
  // verify:a2a-policy with depth2=DENY after the policy import. They were
  // rejected by THIS rule as mcp-invalid-actor — a correct two-hop chain denied
  // for having an unrecognised specialist, which reads like a delegation
  // failure and is not one.
  const cond = findById(reconciled(), COND.HasValidActorChain);
  assert.ok(cond, 'HasValidActorChain must exist');
  const registered = comparisons(cond.condition).map((c) => c.right.constant.value);

  const fromEnv = Object.keys(process.env)
    .filter((k) => /^PINGONE_A2A_[A-Z0-9]+_AGENT_CLIENT_ID$/.test(k))
    .map((k) => (process.env[k] || '').trim())
    .filter(Boolean);
  // Skips rather than fails without .env — gitignored, so CI has no ids to check.
  for (const id of fromEnv) {
    assert.ok(registered.includes(id), `specialist ${id} is not a registered actor`);
  }
});

test('actor chain: the list can only grow — regeneration never drops an id', () => {
  // The union is what makes this safe to regenerate anywhere. A checkout with
  // no .env (CI, fresh clone, worktree) must not shrink the allowlist and
  // silently un-register a specialist that IS provisioned in the tenant.
  const committed = comparisons(findById(readSnapshot(), 'HasValidActorChain')
    ? findById(readSnapshot(), 'HasValidActorChain').condition
    : findById(reconciled(), COND.HasValidActorChain).condition)
    .map((c) => c.right.constant.value);
  const after = comparisons(findById(reconciled(), COND.HasValidActorChain).condition)
    .map((c) => c.right.constant.value);
  for (const id of committed) {
    assert.ok(after.includes(id), `regeneration dropped registered actor ${id}`);
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
    res['Super Banking MCP Invest'].uri,     // mcp-resource-server.ping.demo
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
// 3e — RAR amount ceiling (RFC 9396 / NNP-1, landed on main via #611/#612/#615)
// ─────────────────────────────────────────────────────────────────────────────

test('3e: RarMaxAmount NUMBER attribute + RarAmountExceeded condition + deny rule', () => {
  const snap = reconciled();
  // NUMBER with defaultValue 0 (not a '' sentinel): an ABSENT grant must
  // resolve to 0 so the RarMaxAmount>0 guard is false — an unresolved NUMBER
  // makes the whole MCP decision INDETERMINATE (#612).
  assertAttr(snap, ATTR.RarMaxAmount, 'RarMaxAmount', 'NUMBER', 0);

  const cond = findById(snap, COND.RarAmountExceeded);
  assert.ok(cond && cond.objectType === 'ConditionDefinition');
  assert.deepStrictEqual(cond.condition, { and: { conditions: [
    { comparison: { left: { attribute: { id: ATTR.RarMaxAmount } }, op: 'GreaterThan', right: { constant: { value: '0' } } } },
    { comparison: { left: { attribute: { id: ATTR.Amount } }, op: 'GreaterThan', right: { attribute: { id: ATTR.RarMaxAmount } } } },
  ] } }, 'a grant is present (RarMaxAmount > 0) AND Amount exceeds it');

  // The RAR rule pre-dates the round-3 denyRule helper: it carries ONLY its
  // specific statement (no shared mcp-authorization-denied) and mirrors the
  // "Deny Large Transactions" shape. It must NOT be reshaped to the helper.
  const rule = findById(snap, RULE.rarAmountExceeded);
  assert.ok(rule && rule.type === 'Rule', 'RAR deny rule must exist');
  assert.strictEqual(rule.effectSettings.type, 'conditionalDenyElsePermit');
  assert.deepStrictEqual(rule.effectSettings.condition,
    { and: { conditions: [{ reference: { id: COND.RarAmountExceeded } }] } });
  assert.deepStrictEqual(rule.statements, [STMT.rarAmountExceeded]);

  const stmt = findById(snap, STMT.rarAmountExceeded);
  assert.ok(stmt && stmt.type === 'Statement');
  assert.strictEqual(stmt.code, 'rar_amount_exceeded');
  assert.strictEqual(stmt.appliesTo, 'DENY');
  assert.strictEqual(stmt.shared, false);

  // #615 bumped the four RAR object versions (id …-0020, version …-0021) so
  // the defaultValue-0 fix re-imports — pinned so a helper "cleanup" reverting
  // them to the id-digit pattern (which would make the live import SKIP the
  // fix) fails here instead of in production.
  assert.strictEqual(findById(snap, ATTR.RarMaxAmount).version, 'aaaaaaaa-0021-4321-abcd-000000000021');
  assert.strictEqual(cond.version, 'bbbbbbbb-0021-4321-abcd-000000000021');
  assert.strictEqual(stmt.version, 'cccccccc-0021-4321-abcd-000000000021');
  assert.strictEqual(rule.version, 'dddddddd-0021-4321-abcd-000000000021');

  // Membership: MCP Delegation policy, before the catch-all permit, and not
  // in the Transaction policy.
  const mcpPolicy = findById(snap, '56789012-0002-4321-abcd-000000000002');
  const txPolicy = findById(snap, '56789012-0001-4321-abcd-000000000001');
  const childIds = mcpPolicy.children.map((c) => c.id);
  assert.ok(childIds.includes(RULE.rarAmountExceeded), 'RAR rule must be a child of the MCP policy');
  assert.ok(childIds.indexOf(RULE.rarAmountExceeded) < childIds.indexOf(RULE.mcpPermitValid));
  assert.ok(!txPolicy.children.some((c) => c.id === RULE.rarAmountExceeded));
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
// Signing-key identity (mcp-invalid-kid)
// ─────────────────────────────────────────────────────────────────────────────

test('kid: TokenKidKnown defaults TRUE so an omitted value can never deny', () => {
  const attr = findById(reconciled(), ATTR.TokenKidKnown);
  assert.strictEqual(attr.valueType, 'BOOLEAN');
  // This is the whole fail-open contract. The BFF OMITS TokenKidKnown when it
  // cannot resolve membership (no kid, or the JWKS fetch failed). A false
  // default would make every such request match TokenKidUnpublished and DENY —
  // turning a PingOne JWKS outage into a demo-wide outage.
  assert.strictEqual(attr.defaultValue, true,
    'defaultValue MUST be true — an absent TokenKidKnown means "unknown", never "verified absent"');
});

test('kid: the deny condition matches only an explicit false', () => {
  const cond = findById(reconciled(), COND.TokenKidUnpublished);
  assert.deepStrictEqual(cond.condition, {
    comparison: {
      left: { attribute: { id: ATTR.TokenKidKnown } },
      op: 'Equals',
      right: { constant: { value: false } },
    },
  });
  // Equals-false on a BOOLEAN is the shape GroupMembershipFailed already uses
  // (InRequiredGroup). No new operator/valueType combination is introduced —
  // #1009 shipped a depth fix using an operator and value type this DSL had
  // never exercised, and it silently did not evaluate.
  const snap = reconciled();
  const booleanIds = new Set(snap
    .filter((o) => o.type === 'ATTRIBUTE' && o.valueType === 'BOOLEAN')
    .map((o) => o.id));
  const opsOnBooleans = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const c = node.comparison;
    if (c && booleanIds.has(c.left?.attribute?.id)) opsOnBooleans.add(c.op);
    Object.values(node).forEach(walk);
  };
  walk(snap);
  assert.ok(opsOnBooleans.has('Equals'),
    'Equals-on-BOOLEAN must remain an operator/valueType combination this snapshot actually exercises (#1009)');
});

test('kid: exactly one rule carries the invalid-kid statement, as a conditional deny', () => {
  const snap = reconciled();
  const stmt = findById(snap, STMT.invalidKid);
  assert.strictEqual(stmt.code, 'mcp-invalid-kid');
  assert.strictEqual(stmt.appliesTo, 'DENY');
  // The payload must not claim a signature was verified — this rule only knows
  // that the named key is unpublished.
  assert.ok(!/signature (was )?(verified|valid)/i.test(stmt.payload),
    'payload must not claim signature verification');

  const rulesUsingCond = snap.filter((o) => o.type === 'Rule'
    && JSON.stringify(o).includes(COND.TokenKidUnpublished));
  assert.deepStrictEqual(rulesUsingCond.map((o) => o.id), [RULE.mcpDenyInvalidKid]);
  assert.strictEqual(rulesUsingCond[0].effectSettings.type, 'conditionalDenyElsePermit');
});

// ─────────────────────────────────────────────────────────────────────────────
// Structure — exactly the intended delta, idempotent, committed
// ─────────────────────────────────────────────────────────────────────────────

test('structure: the committed snapshot carries all 30 new objects (103 total) and is reconciled', () => {
  const committed = readSnapshot();
  assert.strictEqual(committed.length, 103, '73 pre-delta objects + 9 attrs + 7 conds + 7 stmts + 7 rules');
  assert.deepStrictEqual(reconcile(clone(committed), loadSot()), committed,
    'committed snapshot is out of date — run: node snapshots/gen-authorize-snapshot.js');

  const newIds = [
    ATTR.TokenAudActual, ATTR.ResourceOwnerId, ATTR.RarMaxAmount,
    ATTR.IntentTokenValid, ATTR.IntentMatchesTool, ATTR.IntentTokenError, ATTR.UserRole,
    COND.TokenAudTargetsUpstream, COND.ResourceOwnerMismatch, COND.RarAmountExceeded,
    COND.IntentTokenTampered, COND.IntentToolMismatch, COND.AdminRoleOnWriteTool,
    STMT.bypassAttempt, STMT.resourceOwnerMismatch, STMT.rarAmountExceeded,
    STMT.intentInvalid, STMT.intentMismatch, STMT.adminRole,
    RULE.mcpDenyUpstreamAud, RULE.mcpDenyResourceOwner, RULE.rarAmountExceeded,
    RULE.mcpDenyIntentInvalid, RULE.mcpDenyIntentMismatch, RULE.mcpDenyAdminRole,
    // Signing-key identity (mcp-invalid-kid).
    ATTR.TokenKidKnown, ATTR.TokenKid, COND.TokenKidUnpublished,
    STMT.invalidKid, RULE.mcpDenyInvalidKid,
  ];
  assert.strictEqual(new Set(newIds).size, 30, 'the 30 new ids must be distinct');
  for (const id of newIds) assert.ok(findById(committed, id), `committed snapshot must contain ${id}`);
});

test('structure: all seven deny rules run before the MCP catch-all permit, in order', () => {
  const mcpPolicy = findById(reconciled(), '56789012-0002-4321-abcd-000000000002');
  const childIds = mcpPolicy.children.map((c) => c.id);
  // The RAR deny landed first (on main, #611) so it sits ahead of the five
  // round-3 denies added after it; the signing-key deny landed last.
  const denies = [
    RULE.rarAmountExceeded, RULE.mcpDenyUpstreamAud, RULE.mcpDenyResourceOwner,
    RULE.mcpDenyIntentInvalid, RULE.mcpDenyIntentMismatch, RULE.mcpDenyAdminRole,
    RULE.mcpDenyInvalidKid,
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
