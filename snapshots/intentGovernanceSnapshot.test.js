/**
 * @file snapshots/intentGovernanceSnapshot.test.js
 *
 * Decision table for the "Agent Intent Governance" policy, as it sits inside
 * the AI Demo root policy set.
 *
 * Two things this protects, in order of how expensive getting them wrong is:
 *
 *  1. THE GATE. The root policy set is DenyOverrides with evaluateAll:true, so
 *     every child policy is evaluated on every decision. This policy's
 *     attributes are fail-closed — IntentGrantPresent defaults false,
 *     IntentRequestMutating defaults true — so an ordinary tool call, which
 *     sends no IntentGrant* parameters at all, matches "no grant + mutating"
 *     and would be DENIED as intent-grant-missing. Ungated, adding this policy
 *     denies the entire demo. The policy therefore carries its own condition,
 *     DecisionContext == 'IntentGovernance', and the "inert" tests below are
 *     the ones that must never be deleted.
 *
 *  2. The decision table itself. Structural validation only proves the package
 *     is well formed; it cannot catch a policy that imports cleanly and then
 *     permits a drifted transfer. Neither the mock PDP nor import-snapshot.js
 *     evaluates snapshot conditions, so this walks the generated conditions
 *     directly with a minimal evaluator for the attested grammar
 *     (comparison / and / reference / empty).
 *
 * The policy was briefly its own standalone policy set. That was wrong — a
 * PingOne Authorize environment evaluates one root tree and a sibling root
 * imports to nothing (verified live 2026-09-09). See intentGovernancePolicy.js.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { POLICY_ID } = require('./intentGovernancePolicy');

const SNAPSHOT = path.join(__dirname, 'AI_Demo_Transaction_Authorization_P1AZ.snapshot.json');
const entries = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));

const attributes = entries.filter((e) => e.type === 'ATTRIBUTE');
const conditions = entries.filter((e) => e.type === 'CONDITION');
const statements = entries.filter((e) => e.type === 'Statement');

const attrById = new Map(attributes.map((a) => [a.id, a]));
const attrByName = new Map(attributes.map((a) => [a.name, a]));
const condById = new Map(conditions.map((c) => [c.id, c]));
const stmtById = new Map(statements.map((s) => [s.id, s]));

const policy = entries.find((e) => e.type === 'Policy' && e.id === POLICY_ID);
const rootSet = entries.find((e) => e.type === 'PolicySet');
const ruleById = new Map(entries.filter((e) => e.type === 'Rule').map((r) => [r.id, r]));
const policyRules = policy.children.map((c) => ruleById.get(c.id));

function valueOf(attrId, params) {
  const def = attrById.get(attrId);
  assert.ok(def, `unknown attribute id ${attrId}`);
  const raw = Object.prototype.hasOwnProperty.call(params, def.name) ? params[def.name] : def.defaultValue;
  switch (def.valueType) {
    case 'NUMBER': return Number(raw);
    case 'BOOLEAN': return typeof raw === 'boolean' ? raw : String(raw) === 'true';
    default: return String(raw ?? '');
  }
}

function operandOf(node, params, leftType) {
  if (node.attribute) return valueOf(node.attribute.id, params);
  const raw = node.constant.value;
  if (leftType === 'NUMBER') return Number(raw);
  if (leftType === 'BOOLEAN') return typeof raw === 'boolean' ? raw : String(raw) === 'true';
  return String(raw);
}

function evaluate(node, params) {
  if ('empty' in node) return true;
  if (node.reference) return evaluate(condById.get(node.reference.id).condition, params);
  if (node.and) return node.and.conditions.every((c) => evaluate(c, params));
  if (node.or) return node.or.conditions.some((c) => evaluate(c, params));
  if (node.not) return !evaluate(node.not.condition, params);
  if (node.comparison) {
    const { left, op, right } = node.comparison;
    const leftType = attrById.get(left.attribute.id).valueType;
    const l = valueOf(left.attribute.id, params);
    const r = operandOf(right, params, leftType);
    if (op === 'Equals') return l === r;
    if (op === 'NotEquals') return l !== r;
    if (op === 'GreaterThan') return Number(l) > Number(r);
    throw new Error(`unattested operator: ${op}`);
  }
  throw new Error(`unknown condition node: ${JSON.stringify(node)}`);
}

/**
 * Evaluate the Agent Intent Governance policy alone, honouring its own gate.
 * `applies:false` means the root's other policies decide and this one is silent.
 */
function decide(params) {
  if (!evaluate(policy.condition, params)) return { applies: false, decision: null, codes: [], denyCodes: [] };
  const fired = policyRules.filter((r) => evaluate(r.condition, params));
  const denied = fired.filter((r) => r.effectSettings.type === 'conditionalDenyElsePermit');
  const code = (r) => r.statements.map((sid) => stmtById.get(sid).code);
  return {
    applies: true,
    decision: denied.length ? 'DENY' : 'PERMIT',
    codes: fired.flatMap(code),
    denyCodes: denied.flatMap(code),
  };
}

const GATE = { DecisionContext: 'IntentGovernance' };

const CONSENTED_GRANT = {
  IntentGrantPresent: true,
  IntentGrantConsented: true,
  IntentGrantExpired: false,
  IntentGrantAction: 'create_transfer',
  IntentGrantPayee: 'acme-utilities',
  IntentGrantMaxAmount: 100,
  IntentGrantRef: 'urn:ietf:params:oauth:request_uri:probe',
  IntentBindingMethod: 'par-rar',
};

const MATCHING_REQUEST = {
  IntentRequestAction: 'create_transfer',
  IntentRequestPayee: 'acme-utilities',
  IntentRequestAmount: 80,
  IntentRequestMutating: true,
};

// ---------------------------------------------------------------- the gate

test('policy is INERT for an ordinary decision that sends no intent parameters', () => {
  // The exact shape of live demo traffic. Were the gate removed, fail-closed
  // defaults would make this "mutating action, no grant" and DENY the demo.
  const r = decide({ DecisionContext: 'McpToolCall', ToolName: 'create_transfer' });
  assert.strictEqual(r.applies, false);
  assert.deepStrictEqual(r.denyCodes, []);
});

test('policy is INERT when DecisionContext is absent entirely', () => {
  assert.strictEqual(decide({}).applies, false);
});

test('removing the gate would deny ordinary traffic — proving the gate earns its place', () => {
  // Same parameters as the first test, evaluated against the RULES only, with
  // the policy condition deliberately bypassed. If this ever stops denying, the
  // fail-closed defaults have changed and the gate rationale needs revisiting.
  const params = { DecisionContext: 'McpToolCall', ToolName: 'create_transfer' };
  const fired = policyRules.filter((r) => evaluate(r.condition, params));
  const denied = fired.filter((r) => r.effectSettings.type === 'conditionalDenyElsePermit');
  const codes = denied.flatMap((r) => r.statements.map((sid) => stmtById.get(sid).code));
  assert.ok(codes.includes('intent-grant-missing'),
    'ungated, this policy denies ordinary traffic — the gate is load-bearing');
});

test('root policy set keeps all three policies', () => {
  const ids = rootSet.children.map((c) => c.id);
  assert.ok(ids.includes('56789012-0001-4321-abcd-000000000001'), 'Transaction Authorization must survive');
  assert.ok(ids.includes('56789012-0002-4321-abcd-000000000002'), 'MCP Delegation Authorization must survive');
  assert.ok(ids.includes(POLICY_ID), 'Agent Intent Governance must be attached');
});

// ------------------------------------------------------------ decision table

test('read with no grant is permitted — intent governs mutating actions only', () => {
  const r = decide({ ...GATE, IntentRequestAction: 'view_balance', IntentRequestMutating: false });
  assert.strictEqual(r.decision, 'PERMIT');
  assert.ok(r.codes.includes('intent-within-grant'));
});

test('mutating action with no grant is denied', () => {
  const r = decide({ ...GATE, IntentRequestAction: 'create_transfer', IntentRequestMutating: true });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-grant-missing'));
});

test('action inside the consented grant is permitted', () => {
  const r = decide({ ...GATE, ...CONSENTED_GRANT, ...MATCHING_REQUEST });
  assert.strictEqual(r.decision, 'PERMIT');
  assert.ok(r.codes.includes('intent-within-grant'));
  assert.deepStrictEqual(r.denyCodes, []);
});

test('amount drift is denied — same tool, injected amount', () => {
  const r = decide({ ...GATE, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestAmount: 5000 });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-amount-drift'));
});

test('payee drift is denied — same tool, injected counterparty', () => {
  const r = decide({ ...GATE, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestPayee: 'attacker-account' });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-payee-drift'));
});

test('action drift is denied — agent switches to an unconsented operation', () => {
  const r = decide({ ...GATE, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestAction: 'delete_account' });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-action-drift'));
});

test('expired grant is denied', () => {
  const r = decide({ ...GATE, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentGrantExpired: true });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-grant-expired'));
});

test('client-asserted grant is denied — self-asserted intent is not consent', () => {
  const r = decide({ ...GATE, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentGrantConsented: false });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-not-consented'));
});

test('semantic drift inside the grant permits with a re-consent obligation', () => {
  const r = decide({ ...GATE, ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentDriftScore: 0.8 });
  assert.strictEqual(r.decision, 'PERMIT');
  assert.ok(r.codes.includes('intent-reconsent-required'));
});

test('drift scorer absent leaves the re-consent rule inert', () => {
  const r = decide({ ...GATE, ...CONSENTED_GRANT, ...MATCHING_REQUEST });
  assert.ok(!r.codes.includes('intent-reconsent-required'));
});

// ----------------------------------------------------------- fail-closed

test('fail closed: omitted IntentGrantExpired defaults to expired', () => {
  const { IntentGrantExpired, ...grant } = CONSENTED_GRANT;
  const r = decide({ ...GATE, ...grant, ...MATCHING_REQUEST });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-grant-expired'));
});

test('fail closed: a grant stating no cap authorizes no value', () => {
  const { IntentGrantMaxAmount, ...grant } = CONSENTED_GRANT;
  const r = decide({ ...GATE, ...grant, ...MATCHING_REQUEST });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-amount-drift'));
});

test('fail closed: an unclassified action is treated as mutating', () => {
  const r = decide({ ...GATE, IntentRequestAction: 'unknown_tool' });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-grant-missing'));
});

// ---------------------------------------------------------------- structure

test('every rule statement and condition reference resolves', () => {
  for (const r of policyRules) {
    assert.ok(r, 'policy child rule must exist in the snapshot');
    for (const sid of r.statements) assert.ok(stmtById.has(sid), `rule ${r.name} -> statement ${sid}`);
    assert.doesNotThrow(() => evaluate(r.condition, GATE), `rule ${r.name} condition`);
    if (r.effectSettings.type === 'conditionalDenyElsePermit') {
      assert.deepStrictEqual(r.effectSettings.condition, r.condition,
        `rule ${r.name}: effectSettings.condition must match the rule condition`);
    }
  }
  const catchAll = policyRules.filter((r) => 'empty' in r.condition);
  assert.strictEqual(catchAll.length, 1, 'exactly one catch-all, or a decision can resolve INDETERMINATE');
  assert.strictEqual(policyRules[policyRules.length - 1].id, catchAll[0].id, 'catch-all must be last');
  assert.strictEqual(attrByName.size, attributes.length, 'attribute names must be unique across the snapshot');
});

test('intent attributes all carry a fail-safe default', () => {
  for (const a of attributes.filter((x) => x.name.startsWith('Intent') && x.id.startsWith('a1c7'))) {
    assert.notStrictEqual(a.defaultValue, undefined, `${a.name} has no defaultValue`);
    assert.notStrictEqual(a.defaultValue, null, `${a.name} has a null defaultValue — omitted values go INDETERMINATE`);
  }
});
