/**
 * @file snapshots/intentGovernanceSnapshot.test.js
 *
 * Decision table for PingOne_Authorize_Agent_Intent_Governance.snapshot.json.
 *
 * Structural validation (run inside the generator) only proves the package is
 * well formed. It cannot catch the failure that matters: a policy that imports
 * cleanly and then decides wrongly — permitting a drifted transfer, or denying
 * an ordinary read. Neither the mock PDP nor import-snapshot.js evaluates
 * snapshot conditions (import-snapshot only diffs names against
 * scope-topology), so there is nothing in the repo to borrow. This file walks
 * the generated conditions directly with a minimal evaluator for the attested
 * grammar (comparison / and / reference / empty) and asserts the outcome for
 * each case the policy exists to handle.
 *
 * The fail-closed cases at the end are the point of the defaults: an omitted
 * attribute must land on the safe side, because an unresolved comparison makes
 * the real PDP return INDETERMINATE, which callers treat as DENY.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const SNAPSHOT = path.join(__dirname, 'PingOne_Authorize_Agent_Intent_Governance.snapshot.json');

const entries = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
const attributes = entries.filter((e) => e.type === 'ATTRIBUTE');
const conditions = entries.filter((e) => e.type === 'CONDITION');
const statements = entries.filter((e) => e.type === 'Statement');
const rules = entries.filter((e) => e.type === 'Rule');

const attrById = new Map(attributes.map((a) => [a.id, a]));
const attrByName = new Map(attributes.map((a) => [a.name, a]));
const condById = new Map(conditions.map((c) => [c.id, c]));
const stmtById = new Map(statements.map((s) => [s.id, s]));

/** Resolve an attribute to the request value, or its fail-safe default. */
function valueOf(attrId, params) {
  const def = attrById.get(attrId);
  assert.ok(def, `unknown attribute id ${attrId}`);
  const raw = Object.prototype.hasOwnProperty.call(params, def.name)
    ? params[def.name]
    : def.defaultValue;
  switch (def.valueType) {
    case 'NUMBER':
      return Number(raw);
    case 'BOOLEAN':
      return typeof raw === 'boolean' ? raw : String(raw) === 'true';
    default:
      return String(raw);
  }
}

/** Right-hand operand: a constant, or another attribute. Coerced to the left operand's type. */
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
    switch (op) {
      case 'Equals':
        return l === r;
      case 'NotEquals':
        return l !== r;
      case 'GreaterThan':
        return Number(l) > Number(r);
      default:
        throw new Error(`unattested operator: ${op}`);
    }
  }
  throw new Error(`unknown condition node: ${JSON.stringify(node)}`);
}

/** DenyOverrides across all rules, mirroring the policy's combining algorithm. */
function decide(params) {
  const fired = rules.filter((r) => evaluate(r.condition, params));
  const codes = fired.flatMap((r) => r.statements.map((id) => stmtById.get(id).code));
  const denied = fired.filter((r) => r.effectSettings.type === 'conditionalDenyElsePermit');
  const denyCodes = denied.flatMap((r) => r.statements.map((id) => stmtById.get(id).code));
  return {
    decision: denied.length > 0 ? 'DENY' : 'PERMIT',
    codes,
    denyCodes,
  };
}

/** A grant the user actually consented to: transfer up to $100 to acme-utilities. */
const CONSENTED_GRANT = {
  IntentGrantPresent: true,
  IntentGrantConsented: true,
  IntentGrantExpired: false,
  IntentGrantAction: 'transfer',
  IntentGrantPayee: 'acme-utilities',
  IntentGrantMaxAmount: 100,
  IntentGrantRef: 'urn:ietf:params:oauth:request_uri:probe',
  IntentBindingMethod: 'par-rar',
};

/** The agent doing exactly what was asked: $80 to acme-utilities. */
const MATCHING_REQUEST = {
  IntentRequestAction: 'transfer',
  IntentRequestPayee: 'acme-utilities',
  IntentRequestAmount: 80,
  IntentRequestMutating: true,
};

test('read with no grant is permitted — intent governs mutating actions only', () => {
  const r = decide({ IntentRequestAction: 'view_balance', IntentRequestMutating: false });
  assert.strictEqual(r.decision, 'PERMIT');
  assert.ok(r.codes.includes('intent-within-grant'));
});

test('mutating action with no grant is denied', () => {
  const r = decide({ IntentRequestAction: 'create_transfer', IntentRequestMutating: true });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-grant-missing'));
});

test('action inside the consented grant is permitted', () => {
  const r = decide({ ...CONSENTED_GRANT, ...MATCHING_REQUEST });
  assert.strictEqual(r.decision, 'PERMIT');
  assert.ok(r.codes.includes('intent-within-grant'));
  assert.deepStrictEqual(r.denyCodes, []);
});

test('amount drift is denied — same tool, injected amount', () => {
  const r = decide({ ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestAmount: 5000 });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-amount-drift'));
});

test('payee drift is denied — same tool, injected counterparty', () => {
  const r = decide({
    ...CONSENTED_GRANT,
    ...MATCHING_REQUEST,
    IntentRequestPayee: 'attacker-account',
  });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-payee-drift'));
});

test('action drift is denied — agent switches to an unconsented operation', () => {
  const r = decide({ ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestAction: 'delete_account' });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-action-drift'));
});

test('expired grant is denied', () => {
  const r = decide({ ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentGrantExpired: true });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-grant-expired'));
});

test('client-asserted grant is denied — self-asserted intent is not consent', () => {
  const r = decide({ ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentGrantConsented: false });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-not-consented'));
});

test('semantic drift inside the grant permits with a re-consent obligation', () => {
  const r = decide({ ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentDriftScore: 0.8 });
  assert.strictEqual(r.decision, 'PERMIT');
  assert.ok(r.codes.includes('intent-reconsent-required'));
});

test('drift scorer absent leaves the re-consent rule inert', () => {
  const r = decide({ ...CONSENTED_GRANT, ...MATCHING_REQUEST });
  assert.ok(!r.codes.includes('intent-reconsent-required'));
});

test('fail closed: omitted IntentGrantExpired defaults to expired', () => {
  const { IntentGrantExpired, ...grantWithoutExpiry } = CONSENTED_GRANT;
  const r = decide({ ...grantWithoutExpiry, ...MATCHING_REQUEST });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-grant-expired'));
});

test('fail closed: a grant stating no cap authorizes no value', () => {
  const { IntentGrantMaxAmount, ...grantWithoutCap } = CONSENTED_GRANT;
  const r = decide({ ...grantWithoutCap, ...MATCHING_REQUEST });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-amount-drift'));
});

test('fail closed: an unclassified action is treated as mutating', () => {
  const r = decide({ IntentRequestAction: 'unknown_tool' });
  assert.strictEqual(r.decision, 'DENY');
  assert.ok(r.denyCodes.includes('intent-grant-missing'));
});

test('every rule statement and condition reference resolves', () => {
  for (const r of rules) {
    for (const sid of r.statements) assert.ok(stmtById.has(sid), `rule ${r.name} -> statement ${sid}`);
    assert.doesNotThrow(() => evaluate(r.condition, {}), `rule ${r.name} condition`);
  }
  assert.strictEqual(attrByName.size, attributes.length, 'attribute names must be unique');
});
