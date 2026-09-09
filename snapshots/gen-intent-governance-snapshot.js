#!/usr/bin/env node
'use strict';

/**
 * Generates PingOne_Authorize_Agent_Intent_Governance.snapshot.json — a
 * standalone, importable PingOne Authorize package that governs AI agent
 * actions against a user-consented intent grant.
 *
 * PRODUCT MODEL
 * -------------
 * Intent is not a proprietary blob the agent stack mints for itself. It is the
 * RFC 9396 `authorization_details` the USER consented to at authorization time,
 * pushed via RFC 9126 PAR and bound to the token the agent presents. Drift is
 * therefore definitional rather than heuristic: an action outside the grant.
 *
 * The PDP is given the GRANT and the REQUEST as separate facts and performs the
 * comparison itself. It is never handed a pre-computed verdict — that is what
 * makes this a policy rather than a rubber stamp. (Contrast the demo's existing
 * IntentTokenValid / IntentMatchesTool attributes, where the gateway decides and
 * P1AZ only records the answer.)
 *
 * SCOPE OF GOVERNANCE
 * -------------------
 * Intent governs MUTATING actions. Reads are left to ordinary scope/role policy,
 * so every drift rule is gated on IntentGoverned = GrantPresent AND Mutating.
 * Without that gate a read under a transfer grant would deny on action drift.
 *
 * FAIL-CLOSED DEFAULTS
 * --------------------
 * Every attribute carries a default on the safe side, because an unresolved
 * comparison makes the whole decision INDETERMINATE, which callers treat as
 * DENY. Notably IntentGrantExpired defaults true and IntentRequestMutating
 * defaults true — an omitted value is the dangerous case, not the benign one.
 *
 * IDs are stable and hand-assigned so that re-importing an edited package
 * UPDATES these objects in place rather than creating duplicates. Do not
 * randomise them.
 *
 * Usage: node snapshots/gen-intent-governance-snapshot.js
 * Import: PingOne console -> Authorize -> policy editor -> kebab -> Import.
 * There is no API path; policy-editor endpoints reject worker tokens.
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'PingOne_Authorize_Agent_Intent_Governance.snapshot.json');

const pad = (n) => String(n).padStart(12, '0');
const id = (kind, n) => `a1c7000${kind}-0000-4000-8000-${pad(n)}`;
const ver = (kind, n) => `b1c7000${kind}-0000-4000-8000-${pad(n)}`;

// ---------------------------------------------------------------- attributes

let attrSeq = 0;
const A = {};
const attributes = [];

function attribute(name, valueType, defaultValue, description) {
  attrSeq += 1;
  const objId = id(1, attrSeq);
  A[name] = objId;
  attributes.push({
    objectType: 'AttributeDefinition',
    id: objId,
    version: ver(1, attrSeq),
    type: 'ATTRIBUTE',
    name,
    fullName: name,
    description,
    parentId: null,
    numberOfChildren: null,
    valueProcessor: null,
    valueType,
    resolvers: [
      { attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null },
    ],
    defaultValue,
    repetitionSource: null,
    valueSchema: null,
  });
  return objId;
}

// The grant — what the user actually consented to (RFC 9396 authorization_details).
attribute('IntentGrantPresent', 'BOOLEAN', false,
  'Whether a user-consented intent grant (RFC 9396 authorization_details) is bound to the presenting token. Default false — an omitted value means NO grant was proven (fail closed).');
attribute('IntentGrantConsented', 'BOOLEAN', false,
  'Whether a human approved this grant interactively at authorization time, as opposed to the client asserting it. Default false — client-asserted intent is not user consent.');
attribute('IntentGrantExpired', 'BOOLEAN', true,
  'Whether the grant is past its validity window. Computed by the caller (P1AZ conditions have no attested time arithmetic). Default TRUE — an unknown grant lifetime is treated as expired.');
attribute('IntentGrantAction', 'STRING', '',
  'The single action the grant authorizes, from authorization_details[].actions (e.g. "transfer"). One action per decision — a multi-action grant is evaluated once per action.');
attribute('IntentGrantPayee', 'STRING', '',
  'The counterparty the grant authorizes, from authorization_details[].payee. Empty when the granted action has no counterparty (e.g. a read).');
attribute('IntentGrantMaxAmount', 'NUMBER', 0,
  'The value ceiling the grant authorizes, from authorization_details[].amount. Default 0 — a grant that states no cap authorizes no value (fail closed).');
attribute('IntentGrantRef', 'STRING', '',
  'Opaque reference to the grant for audit: the PAR request_uri, or the grant/consent id. Not used in any condition — carried so a decision can be traced back to the consent that authorized it.');
attribute('IntentBindingMethod', 'STRING', 'none',
  'How intent reached this decision: "par-rar" (user-consented, RFC 9126 + 9396), "intent-token" (client-asserted), or "none". Provenance for audit; not used in any condition.');

// The request — what the agent is actually proposing to do.
attribute('IntentRequestAction', 'STRING', '',
  'The action the agent is attempting now (the tool/operation being invoked). Compared against IntentGrantAction.');
attribute('IntentRequestPayee', 'STRING', '',
  'The counterparty of the attempted action. Compared against IntentGrantPayee.');
attribute('IntentRequestAmount', 'NUMBER', 0,
  'The value of the attempted action. Compared against IntentGrantMaxAmount.');
attribute('IntentRequestMutating', 'BOOLEAN', true,
  'Whether the attempted action changes state. Intent governance applies only to mutating actions. Default TRUE — an unclassified action is treated as mutating (fail closed).');

// Reserved extension point.
attribute('IntentDriftScore', 'NUMBER', 0,
  'Optional 0..1 semantic-drift score from an external evaluator comparing the original request to the proposed action. Default 0 (no drift asserted), so this policy behaves identically when no scorer is deployed.');

// ---------------------------------------------------------------- conditions

let condSeq = 0;
const C = {};
const conditions = [];

function condition(name, description, body) {
  condSeq += 1;
  const objId = id(2, condSeq);
  C[name] = objId;
  conditions.push({
    objectType: 'ConditionDefinition',
    id: objId,
    version: ver(2, condSeq),
    type: 'CONDITION',
    name,
    fullName: name,
    description,
    parentId: null,
    numberOfChildren: null,
    condition: body,
  });
  return objId;
}

const attr = (name) => ({ attribute: { id: A[name] } });
const constant = (value) => ({ constant: { value } });
const cmp = (left, op, right) => ({ comparison: { left, op, right } });
const ref = (name) => ({ reference: { id: C[name] } });
const and = (...cs) => ({ and: { conditions: cs } });

condition('GrantPresent',
  'A user-consented intent grant is bound to the token.',
  cmp(attr('IntentGrantPresent'), 'Equals', constant(true)));

condition('ActionIsMutating',
  'The attempted action changes state. Reads are governed by scope policy, not by intent.',
  cmp(attr('IntentRequestMutating'), 'Equals', constant(true)));

condition('IntentGoverned',
  'Gate for every drift rule: a grant exists AND the action mutates state. Without this gate, a read performed under a transfer grant would fail the action-drift comparison.',
  and(ref('GrantPresent'), ref('ActionIsMutating')));

condition('NoGrantForMutatingAction',
  'A state-changing action is attempted with no intent grant bound to the token at all.',
  and(cmp(attr('IntentGrantPresent'), 'Equals', constant(false)), ref('ActionIsMutating')));

condition('GrantExpiredInScope',
  'The grant that would authorize this action is past its validity window.',
  and(ref('IntentGoverned'), cmp(attr('IntentGrantExpired'), 'Equals', constant(true))));

condition('GrantNotUserConsented',
  'The grant was asserted by the client rather than approved by a human.',
  and(ref('IntentGoverned'), cmp(attr('IntentGrantConsented'), 'Equals', constant(false))));

condition('ActionDrift',
  'The attempted action is not the action the user consented to.',
  and(ref('IntentGoverned'), cmp(attr('IntentRequestAction'), 'NotEquals', attr('IntentGrantAction'))));

condition('PayeeDrift',
  'The attempted counterparty is not the counterparty the user consented to.',
  and(ref('IntentGoverned'), cmp(attr('IntentRequestPayee'), 'NotEquals', attr('IntentGrantPayee'))));

condition('AmountDrift',
  'The attempted value exceeds the ceiling the user consented to.',
  and(ref('IntentGoverned'), cmp(attr('IntentRequestAmount'), 'GreaterThan', attr('IntentGrantMaxAmount'))));

condition('SemanticDriftSuspected',
  'An external evaluator scored this action as materially diverging from the original request, above 0.5, while still inside the grant envelope.',
  and(ref('IntentGoverned'), cmp(attr('IntentDriftScore'), 'GreaterThan', constant('0.5'))));

// ---------------------------------------------------------------- statements

let stmtSeq = 0;
const S = {};
const statements = [];

function statement(name, code, appliesTo, description, payload) {
  stmtSeq += 1;
  const objId = id(3, stmtSeq);
  S[code] = objId;
  statements.push({
    id: objId,
    version: ver(3, stmtSeq),
    type: 'Statement',
    name,
    shared: false,
    description,
    code,
    appliesTo,
    appliesIf: 'PATH_MATCHES',
    payload,
    obligatory: false,
    attributes: [],
    services: [],
  });
  return objId;
}

const iv = (name) => `{{${A[name]}}}`;

statement('Intent — No Grant Bound', 'intent-grant-missing', 'DENY',
  'The agent attempted a state-changing action with no user-consented intent grant on the token.',
  JSON.stringify({
    denied: true,
    reason: 'intent_grant_missing',
    message: `Action '${iv('IntentRequestAction')}' changes state but no user-consented intent grant is bound to this token. Obtain authorization_details via PAR and have the user approve them.`,
    action: iv('IntentRequestAction'),
    bindingMethod: iv('IntentBindingMethod'),
  }));

statement('Intent — Grant Expired', 'intent-grant-expired', 'DENY',
  'The intent grant is outside its validity window; consent must be refreshed.',
  JSON.stringify({
    denied: true,
    reason: 'intent_grant_expired',
    message: `The intent grant authorizing '${iv('IntentRequestAction')}' has expired. The user must re-consent before the agent may continue.`,
    grantRef: iv('IntentGrantRef'),
  }));

statement('Intent — Not User Consented', 'intent-not-consented', 'DENY',
  'The grant was client-asserted rather than approved by a human. Self-asserted intent is not consent.',
  JSON.stringify({
    denied: true,
    reason: 'intent_not_consented',
    message: `The intent grant for '${iv('IntentRequestAction')}' was asserted by the client, not approved by the user. A state-changing action requires human-consented authorization_details.`,
    bindingMethod: iv('IntentBindingMethod'),
  }));

statement('Intent — Action Drift', 'intent-action-drift', 'DENY',
  'The attempted action differs from the consented action. This is the canonical intent-drift denial.',
  JSON.stringify({
    denied: true,
    reason: 'intent_action_drift',
    message: `Agent attempted '${iv('IntentRequestAction')}' but the user consented only to '${iv('IntentGrantAction')}'.`,
    attempted: iv('IntentRequestAction'),
    granted: iv('IntentGrantAction'),
    grantRef: iv('IntentGrantRef'),
  }));

statement('Intent — Payee Drift', 'intent-payee-drift', 'DENY',
  'The attempted counterparty differs from the consented counterparty — the classic injected-payee substitution.',
  JSON.stringify({
    denied: true,
    reason: 'intent_payee_drift',
    message: `Agent attempted to act on '${iv('IntentRequestPayee')}' but the user consented only to '${iv('IntentGrantPayee')}'.`,
    attempted: iv('IntentRequestPayee'),
    granted: iv('IntentGrantPayee'),
    grantRef: iv('IntentGrantRef'),
  }));

statement('Intent — Amount Drift', 'intent-amount-drift', 'DENY',
  'The attempted value exceeds the consented ceiling.',
  JSON.stringify({
    denied: true,
    reason: 'intent_amount_drift',
    message: `Agent attempted ${iv('IntentRequestAmount')} but the user consented to at most ${iv('IntentGrantMaxAmount')}.`,
    attempted: iv('IntentRequestAmount'),
    granted: iv('IntentGrantMaxAmount'),
    grantRef: iv('IntentGrantRef'),
  }));

statement('Intent — Re-consent Required', 'intent-reconsent-required', 'PERMIT',
  'Obligation: the action is inside the grant envelope but an evaluator flagged semantic divergence. Re-confirm with the user before executing.',
  JSON.stringify({
    obligation: 'RECONSENT',
    reason: 'intent_semantic_drift',
    message: `Action '${iv('IntentRequestAction')}' is within the granted envelope but diverges from the original request (drift ${iv('IntentDriftScore')}). Re-confirm intent with the user before executing.`,
    driftScore: iv('IntentDriftScore'),
    grantRef: iv('IntentGrantRef'),
  }));

statement('Intent — Within Grant', 'intent-within-grant', 'PERMIT',
  'Catch-all approval: the action falls inside the user-consented grant, or intent governance does not apply (a read).',
  JSON.stringify({
    approved: true,
    reason: 'intent_within_grant',
    message: `Action '${iv('IntentRequestAction')}' is within the user-consented intent grant.`,
    grantRef: iv('IntentGrantRef'),
    bindingMethod: iv('IntentBindingMethod'),
  }));

// --------------------------------------------------------------------- rules

let ruleSeq = 0;
const rules = [];

function denyRule(name, conditionName, statementCode, description) {
  ruleSeq += 1;
  const body = and(ref(conditionName));
  rules.push({
    id: id(4, ruleSeq),
    version: ver(4, ruleSeq),
    type: 'Rule',
    targets: [],
    name,
    description,
    shared: false,
    disabled: false,
    statements: [S[statementCode]],
    effectSettings: { type: 'conditionalDenyElsePermit', condition: body },
    condition: body,
  });
  return rules[rules.length - 1].id;
}

function obligationRule(name, conditionName, statementCode, description) {
  ruleSeq += 1;
  rules.push({
    id: id(4, ruleSeq),
    version: ver(4, ruleSeq),
    type: 'Rule',
    targets: [],
    name,
    description,
    shared: false,
    disabled: false,
    statements: [S[statementCode]],
    effectSettings: { type: 'unconditionalPermit' },
    condition: and(ref(conditionName)),
  });
  return rules[rules.length - 1].id;
}

function catchAllRule(name, statementCode, description) {
  ruleSeq += 1;
  rules.push({
    id: id(4, ruleSeq),
    version: ver(4, ruleSeq),
    type: 'Rule',
    targets: [],
    name,
    description,
    shared: false,
    disabled: false,
    statements: [S[statementCode]],
    effectSettings: { type: 'unconditionalPermit' },
    condition: { empty: {} },
  });
  return rules[rules.length - 1].id;
}

denyRule('Intent Deny — No Grant Bound', 'NoGrantForMutatingAction', 'intent-grant-missing',
  'DENY a state-changing action when no user-consented intent grant is bound to the token.');
denyRule('Intent Deny — Grant Expired', 'GrantExpiredInScope', 'intent-grant-expired',
  'DENY when the grant authorizing this action is outside its validity window.');
denyRule('Intent Deny — Not User Consented', 'GrantNotUserConsented', 'intent-not-consented',
  'DENY when the grant was client-asserted rather than approved by a human.');
denyRule('Intent Deny — Action Drift', 'ActionDrift', 'intent-action-drift',
  'DENY when the attempted action is not the action the user consented to. The canonical intent-drift rule.');
denyRule('Intent Deny — Payee Drift', 'PayeeDrift', 'intent-payee-drift',
  'DENY when the attempted counterparty is not the one the user consented to.');
denyRule('Intent Deny — Amount Drift', 'AmountDrift', 'intent-amount-drift',
  'DENY when the attempted value exceeds the consented ceiling.');
obligationRule('Intent Permit — Re-consent on Semantic Drift', 'SemanticDriftSuspected', 'intent-reconsent-required',
  'PERMIT with a RECONSENT obligation when an external evaluator scores the action as diverging, though it remains inside the grant. Inert unless a scorer supplies IntentDriftScore.');
catchAllRule('Intent Permit — Within Grant', 'intent-within-grant',
  'Catch-all PERMIT. Required so an action matching no explicit rule resolves cleanly instead of INDETERMINATE.');

// ------------------------------------------------------------ policy / set

const POLICY_ID = id(5, 1);
const POLICYSET_ID = id(6, 1);

const policy = {
  id: POLICY_ID,
  version: ver(5, 1),
  type: 'Policy',
  targets: [],
  combiningAlgorithm: { algorithm: 'DenyOverrides' },
  name: 'Agent Intent Governance',
  description:
    'Evaluates every state-changing AI agent action against the RFC 9396 authorization_details the user consented to (pushed via RFC 9126 PAR) and bound to the presenting token. The PDP receives the grant and the request as separate facts and compares them itself. Denies on missing grant, expired grant, client-asserted (non-consented) grant, and action/payee/amount drift; optionally raises a re-consent obligation on scored semantic drift. Reads are out of scope and fall through to the catch-all permit.',
  shared: false,
  disabled: false,
  children: rules.map((r) => ({ id: r.id, type: 'Rule' })),
  repetitionSettings: null,
  statements: [],
  condition: { empty: {} },
};

const policySet = {
  id: POLICYSET_ID,
  version: ver(6, 1),
  type: 'PolicySet',
  targets: [],
  combiningAlgorithm: { algorithm: 'DenyOverrides', evaluateAll: true },
  name: 'PingOne Authorize — Agent Intent Governance',
  description:
    'Root policy set for intent-based access control of AI agents. Contains: Agent Intent Governance. Standalone and self-contained — it shares no attributes, conditions, statements or IDs with other packages in the environment, so it can be imported alongside existing policy sets.',
  shared: false,
  disabled: false,
  children: [{ id: POLICY_ID, type: 'Policy' }],
  statements: [],
  managedEntity: { owner: { service: { name: 'Editor Service' } } },
  condition: { empty: {} },
};

// ------------------------------------------------------------------ assemble

const entries = [
  { '@class': 'DataStreamHeader', kind: 'SnapshotHeader', version: 2 },
  {
    type: 'SnapshotPackageFile$PackageHeader',
    snapshotId: 'a1c70000-0000-4000-8000-000000000001',
    snapshotFileVersion: 2,
    applicationVersion: 'P1AZ-1.0.0.0',
  },
  ...attributes,
  ...conditions,
  ...statements,
  ...rules,
  { type: 'SnapshotPackageFile$PackageSeparator' },
  policy,
  policySet,
  { type: 'SnapshotPackageFile$PackageSeparator' },
  { type: 'SnapshotPackageFile$EndOfPackage' },
  { '@class': 'DataStreamFooter', digest: 'AgentIntentGovernance-v1' },
];

// ------------------------------------------------------------------ validate
// A dangling reference or a missing default fails the import opaquely, or worse
// imports and then returns INDETERMINATE at runtime. Check before writing.

function validate() {
  const ids = new Set();
  for (const e of entries) {
    if (!e.id) continue;
    if (ids.has(e.id)) throw new Error(`duplicate id: ${e.id}`);
    ids.add(e.id);
  }

  const referenced = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.reference?.id) referenced.push(['condition', node.reference.id]);
    if (node.attribute?.id) referenced.push(['attribute', node.attribute.id]);
    for (const v of Object.values(node)) walk(v);
  })(entries);
  for (const [kind, refId] of referenced) {
    if (!ids.has(refId)) throw new Error(`dangling ${kind} reference: ${refId}`);
  }

  for (const a of attributes) {
    if (a.defaultValue === undefined || a.defaultValue === null) {
      throw new Error(`attribute ${a.name} has no defaultValue — omitted values would go INDETERMINATE`);
    }
  }

  for (const s of statements) {
    for (const m of String(s.payload).matchAll(/\{\{([^}]+)\}\}/g)) {
      if (!ids.has(m[1])) throw new Error(`statement ${s.code} interpolates unknown id ${m[1]}`);
    }
  }

  const catchAll = rules.filter((r) => r.condition && 'empty' in r.condition);
  if (catchAll.length !== 1) {
    throw new Error(`expected exactly 1 catch-all rule, found ${catchAll.length}`);
  }
  if (rules[rules.length - 1].id !== catchAll[0].id) {
    throw new Error('catch-all rule must be listed last');
  }

  for (const r of rules) {
    if (r.effectSettings.type === 'conditionalDenyElsePermit') {
      if (JSON.stringify(r.effectSettings.condition) !== JSON.stringify(r.condition)) {
        throw new Error(`rule ${r.name}: effectSettings.condition must match rule condition`);
      }
    }
  }

  const stmtIds = new Set(statements.map((s) => s.id));
  for (const r of rules) {
    for (const sid of r.statements) {
      if (!stmtIds.has(sid)) throw new Error(`rule ${r.name} references unknown statement ${sid}`);
    }
  }
}

validate();

fs.writeFileSync(OUT, `[\n  ${entries.map((e) => JSON.stringify(e)).join(',\n  ')}\n]\n`);

console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
console.log(
  `  ${attributes.length} attributes, ${conditions.length} conditions, ` +
    `${statements.length} statements, ${rules.length} rules, 1 policy, 1 policy set`,
);
console.log('  validation: OK');
