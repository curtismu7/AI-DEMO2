#!/usr/bin/env node
'use strict';

/**
 * Builds the "Agent Intent Governance" policy — attributes, conditions,
 * statements, rules and the Policy itself — for insertion into the AI Demo root
 * policy set by gen-authorize-snapshot.js.
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
 * WHY THIS IS NOT A STANDALONE POLICY SET
 * ---------------------------------------
 * It was, once, and that was wrong. A PingOne Authorize environment evaluates a
 * SINGLE root policy tree; every decision endpoint resolves to it. A sibling
 * root imports to nothing — verified live 2026-09-09: after importing the
 * standalone package and publishing, `GET /authorizationPolicies` still listed
 * exactly one root ("AI Demo Policies") and `GET /authorizationPolicies/<my
 * set id>` returned 404. So this builds a POLICY that gen-authorize-snapshot.js
 * attaches as a third child of that root, next to Transaction Authorization and
 * MCP Delegation Authorization.
 *
 * THE GATE — load-bearing, do not remove
 * -------------------------------------
 * The root is DENY_OVERRIDES with evaluateAll:true, so every child policy is
 * evaluated on EVERY decision. Ungated, this policy would deny all existing demo
 * traffic instantly: a normal tool call sends no IntentGrant* parameters, so
 * IntentGrantPresent defaults false and IntentRequestMutating defaults true
 * (both fail-closed), which fires intent-grant-missing.
 *
 * So the Policy carries its own condition, satisfied two ways:
 *
 *   DecisionContext == 'IntentGovernance'   the Intent Inspector, which exercises
 *                                           the policy without touching live traffic
 *   IntentEnforce   == true                 the gateway, once enforcement is armed
 *                                           via MCP_GW_INTENT_ENFORCE
 *
 * Both are opt-in and an ordinary tool call sends neither, so the policy stays
 * inert until someone deliberately arms it. IntentEnforce is a separate
 * attribute rather than a DecisionContext value on purpose: DecisionContext is
 * what the demo's OTHER policies route on (IsMcpFirstToolRequest), so changing
 * it for real calls would take the MCP Delegation policy out of the path.
 *
 * Arming it only produces useful denials once the grant can prove consent.
 * agentMcpTokenService stamps `consented` + `expires_at` onto a grant sourced
 * from a HITL human approval, and deliberately not onto one built from the
 * request's own params. So with enforcement armed, a HITL-approved transfer is
 * governed on its real constraints, while an unapproved mutating call denies as
 * intent-not-consented — the correct answer to "can we prove the user agreed".
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
 * randomise them. Versions are content-derived for the same reason the rest of
 * gen-authorize-snapshot.js derives them: PingOne SKIPS an object whose version
 * has not moved, so a mutated object at a frozen version is a silent no-op.
 */

const crypto = require('crypto');

const pad = (n) => String(n).padStart(12, '0');
const id = (kind, n) => `a1c7000${kind}-0000-4000-8000-${pad(n)}`;

/** Content-derived version: same contract as gen-authorize-snapshot.js's ver(). */
function ver(prefix, objId, content) {
  const group = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 4);
  return `${prefix}-${objId.slice(9, 13)}-${group}-8000-${objId.slice(24)}`;
}

const POLICY_ID = id(5, 1);

/**
 * @param {object} opts
 * @param {string} opts.decisionContextAttrId - the EXISTING DecisionContext
 *   attribute in the demo Trust Framework. Reused rather than redefined: two
 *   attributes named DecisionContext would collide on import.
 * @param {string} [opts.gateValue] - DecisionContext value that turns this
 *   policy on. Defaults to 'IntentGovernance'.
 */
function buildIntentGovernanceObjects({ decisionContextAttrId, gateValue = 'IntentGovernance' }) {
  if (!decisionContextAttrId) {
    throw new Error('buildIntentGovernanceObjects: decisionContextAttrId is required — the policy gate reads it');
  }

  // -------------------------------------------------------------- attributes
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
      version: ver('aaaaaaaa', objId, { name, valueType, defaultValue, description }),
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
  }

  // The grant — what the user actually consented to (RFC 9396 authorization_details).
  attribute('IntentGrantPresent', 'BOOLEAN', false,
    'Whether a user-consented intent grant (RFC 9396 authorization_details) is bound to the presenting token. Default false — an omitted value means NO grant was proven (fail closed).');
  attribute('IntentGrantConsented', 'BOOLEAN', false,
    'Whether a human approved this grant interactively at authorization time, as opposed to the client asserting it. Default false — client-asserted intent is not user consent.');
  attribute('IntentGrantExpired', 'BOOLEAN', true,
    'Whether the grant is past its validity window. Computed by the caller (P1AZ conditions have no attested time arithmetic). Default TRUE — an unknown grant lifetime is treated as expired.');
  attribute('IntentGrantAction', 'STRING', '',
    'The single action the grant authorizes, from authorization_details[].actions (e.g. "create_transfer"). One action per decision — a multi-action grant is evaluated once per action.');
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

  // Runtime enforcement switch — see the gate note in the file header.
  attribute('IntentEnforce', 'BOOLEAN', false,
    'Set true by the gateway when intent enforcement is armed (MCP_GW_INTENT_ENFORCE), so real agent tool calls are governed without changing DecisionContext — which the demo\'s other policies use for routing. Default FALSE: enforcement is opt-in, and an omitted value leaves this policy inert.');

  // Reserved extension point.
  attribute('IntentDriftScore', 'NUMBER', 0,
    'Optional 0..1 semantic-drift score from an external evaluator comparing the original request to the proposed action. Default 0 (no drift asserted), so this policy behaves identically when no scorer is deployed.');

  // -------------------------------------------------------------- conditions
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
      version: ver('bbbbbbbb', objId, { name, description, body }),
      type: 'CONDITION',
      name,
      fullName: name,
      description,
      parentId: null,
      numberOfChildren: null,
      condition: body,
    });
  }

  const attr = (name) => ({ attribute: { id: A[name] } });
  const constant = (value) => ({ constant: { value } });
  const cmp = (left, op, right) => ({ comparison: { left, op, right } });
  const ref = (name) => ({ reference: { id: C[name] } });
  const and = (...cs) => ({ and: { conditions: cs } });

  condition('IntentGovernanceRequested',
    `The policy-level gate — see the header note. True when DecisionContext is '${gateValue}' (the Intent Inspector, which exercises the policy without touching live traffic) OR when IntentEnforce is true (the gateway, once enforcement is armed). Both are opt-in: an ordinary tool call sends neither and this policy stays inert.`,
    { or: { conditions: [
      cmp({ attribute: { id: decisionContextAttrId } }, 'Equals', constant(gateValue)),
      cmp(attr('IntentEnforce'), 'Equals', constant(true)),
    ] } });

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

  // -------------------------------------------------------------- statements
  let stmtSeq = 0;
  const S = {};
  const statements = [];

  function statement(name, code, appliesTo, description, payload) {
    stmtSeq += 1;
    const objId = id(3, stmtSeq);
    S[code] = objId;
    statements.push({
      id: objId,
      version: ver('cccccccc', objId, { name, code, appliesTo, payload }),
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

  // ------------------------------------------------------------------- rules
  let ruleSeq = 0;
  const rules = [];

  function rule(name, description, body, effectSettings, statementCode) {
    ruleSeq += 1;
    const objId = id(4, ruleSeq);
    rules.push({
      id: objId,
      version: ver('dddddddd', objId, { name, description, body, effectSettings, statementCode }),
      type: 'Rule',
      targets: [],
      name,
      description,
      shared: false,
      disabled: false,
      statements: [S[statementCode]],
      effectSettings,
      condition: body,
    });
  }

  const denyRule = (name, conditionName, statementCode, description) => {
    const body = and(ref(conditionName));
    rule(name, description, body, { type: 'conditionalDenyElsePermit', condition: body }, statementCode);
  };

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
  rule('Intent Permit — Re-consent on Semantic Drift',
    'PERMIT with a RECONSENT obligation when an external evaluator scores the action as diverging, though it remains inside the grant. Inert unless a scorer supplies IntentDriftScore.',
    and(ref('SemanticDriftSuspected')), { type: 'unconditionalPermit' }, 'intent-reconsent-required');
  rule('Intent Permit — Within Grant',
    'Catch-all PERMIT. Required so an action matching no explicit rule resolves cleanly instead of INDETERMINATE.',
    { empty: {} }, { type: 'unconditionalPermit' }, 'intent-within-grant');

  // ------------------------------------------------------------------ policy
  const policy = {
    id: POLICY_ID,
    version: ver('eeeeeeee', POLICY_ID, { rules: rules.map((r) => r.version), gateValue }),
    type: 'Policy',
    targets: [],
    combiningAlgorithm: { algorithm: 'DenyOverrides' },
    name: 'Agent Intent Governance',
    description:
      `Evaluates a state-changing AI agent action against the RFC 9396 authorization_details the user consented to (pushed via RFC 9126 PAR) and bound to the presenting token. The PDP receives the grant and the request as separate facts and compares them itself. Denies on missing grant, expired grant, client-asserted (non-consented) grant, and action/payee/amount drift; optionally raises a re-consent obligation on scored semantic drift. GATED on DecisionContext == '${gateValue}' — the root policy set evaluates every child on every decision, and without this gate an ordinary tool call (no IntentGrant* parameters, fail-closed defaults) would be denied as intent-grant-missing. Reads are out of scope and fall through to the catch-all permit.`,
    shared: false,
    disabled: false,
    children: rules.map((r) => ({ id: r.id, type: 'Rule' })),
    repetitionSettings: null,
    statements: [],
    condition: and(ref('IntentGovernanceRequested')),
  };

  return { attributes, conditions, statements, rules, policy, POLICY_ID, gateValue };
}

module.exports = { buildIntentGovernanceObjects, POLICY_ID };
