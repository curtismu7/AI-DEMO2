'use strict';

/**
 * authorizeLearningDemos.js
 *
 * In-process, education-only demonstrations of PingOne Authorize (P1AZ) policy
 * capabilities that the amount-threshold transaction demo does not exercise:
 *   - abac          — attribute-based access control (user/resource/environment attrs)
 *   - indeterminate — unresolved attribute → INDETERMINATE → fail-closed deny
 *   - payloadFilter — a Statement that redacts/transforms an API payload by role
 *   - obligations   — obligations (STEP_UP) vs advice (audit-log) on a PERMIT
 *
 * These NEVER call PingOne and are wired ONLY to the /authz-test learning page.
 * Each handler returns a normalized shape including a policy-element `trace`
 * (policy set -> rule -> condition -> effect -> statements) so the UI can
 * annotate which element fired. Deny-by-default: unresolved inputs fail closed.
 *
 * @module services/authorizeLearningDemos
 */

const LEARNING_DEMO_TYPES = ['abac', 'indeterminate', 'payloadFilter', 'obligations'];

/** Normalize a policy-element decision trace for the annotated-result UI. */
function buildTrace({ policySet, rule, condition, effect, statements }) {
  return {
    policySet: policySet || '',
    rule: rule || '',
    condition: condition || '',
    effect: effect || 'INDETERMINATE',
    statements: Array.isArray(statements) ? statements : [],
  };
}

function acrLooksStrong(acr) {
  if (!acr) return false;
  const s = String(acr).toLowerCase();
  return s.includes('mfa') || s.includes('multi') || s.includes('fido') || s.includes('passkey');
}

// ── Demo: ABAC ───────────────────────────────────────────────────────────────
// Rule 1: user.region must equal resource.region (data residency).
// Rule 2: write actions require role == 'manager'. Combining algorithm: deny-overrides.
function evalAbac({ role, userRegion, resourceRegion, action }) {
  const wantsWrite = String(action || 'read').toLowerCase() === 'write';
  // All three outcomes share the same shape (effect === decision, no obligations,
  // raw keyed to this demo) — so build them through one local factory.
  const result = (decision, rule, condition, reason) => ({
    decision, effect: decision, obligations: [], statements: [],
    trace: buildTrace({ policySet: 'Account Access', rule, condition, effect: decision }),
    raw: { engine: 'simulated-learning', demoType: 'abac', reason },
  });
  const residencyRule = 'Data residency — region match';
  const residencyCondition = `user.region (${userRegion}) == resource.region (${resourceRegion})`;
  if (userRegion !== resourceRegion) {
    return result('DENY', residencyRule, residencyCondition, 'region_mismatch');
  }
  if (wantsWrite && String(role).toLowerCase() !== 'manager') {
    return result('DENY', 'Privilege — write requires manager',
      `action == write AND user.role (${role}) == manager`, 'insufficient_role_for_write');
  }
  return result('PERMIT', residencyRule, residencyCondition, 'attributes_satisfied');
}

// ── Demo: INDETERMINATE / fail-closed ────────────────────────────────────────
function evalIndeterminate({ attributeResolves }) {
  if (attributeResolves === false) {
    return {
      decision: 'INDETERMINATE', effect: 'INDETERMINATE', obligations: [], statements: [],
      trace: buildTrace({
        policySet: 'Account Access',
        rule: 'Requires resolved risk attribute',
        condition: 'attribute "customer.riskTier" could not be resolved',
        effect: 'INDETERMINATE',
      }),
      raw: { engine: 'simulated-learning', demoType: 'indeterminate', failClosed: true,
        reason: 'Attribute could not be resolved by the Trust Framework service; P1AZ returns INDETERMINATE and the PEP must fail closed (treat as DENY).' },
    };
  }
  return {
    decision: 'PERMIT', effect: 'PERMIT', obligations: [], statements: [],
    trace: buildTrace({
      policySet: 'Account Access',
      rule: 'Requires resolved risk attribute',
      condition: 'attribute "customer.riskTier" resolved successfully',
      effect: 'PERMIT',
    }),
    raw: { engine: 'simulated-learning', demoType: 'indeterminate', failClosed: false, reason: 'attribute_resolved' },
  };
}

// ── Demo: Statement payload filtering ────────────────────────────────────────
// A Statement post-processes the PERMITted response: redact/drop fields by role.
const PAYLOAD_VISIBILITY = {
  auditor: { full: true },
  teller: { full: false },
};
function maskSsn(ssn) {
  const s = String(ssn);
  return s.length >= 4 ? `***-**-${s.slice(-4)}` : '****';
}
function evalPayloadFilter({ role, payload }) {
  const src = payload && typeof payload === 'object' ? payload : {};
  const vis = PAYLOAD_VISIBILITY[String(role).toLowerCase()] || PAYLOAD_VISIBILITY.teller;
  let output;
  let statements;
  if (vis.full) {
    output = { ...src };
    statements = [{ type: 'FILTER', detail: `Role "${role}" — no redaction; full payload returned.` }];
  } else {
    output = { ...src };
    if ('ssn' in output) output.ssn = maskSsn(output.ssn);
    if ('balance' in output) delete output.balance;
    statements = [{ type: 'FILTER', detail: `Role "${role}" — Statement redacts ssn and drops balance.` }];
  }
  return {
    decision: 'PERMIT', effect: 'PERMIT', obligations: [], statements, output,
    trace: buildTrace({
      policySet: 'Account Read',
      rule: 'Read permitted for authenticated staff',
      condition: 'user.authenticated == true',
      effect: 'PERMIT',
      statements,
    }),
    raw: { engine: 'simulated-learning', demoType: 'payloadFilter', role, reason: 'payload_filtered' },
  };
}

// ── Demo: Obligations vs advice ──────────────────────────────────────────────
// PERMIT with an audit-log ADVICE always; STEP_UP obligation when amount is high
// and MFA (acr) not already satisfied.
function evalObligations({ amount, acr }) {
  const amt = Number(amount) || 0;
  const stepUpThreshold = 10000;
  const statements = [{ type: 'ADVICE', detail: 'Write an audit-log record for this high-value read (advice — advisory, not enforced).' }];
  const obligations = [];
  if (amt >= stepUpThreshold && !acrLooksStrong(acr)) {
    obligations.push({ type: 'STEP_UP', detail: 'Obligation — step-up MFA required before the PEP may release the resource.' });
  }
  return {
    decision: 'PERMIT', effect: 'PERMIT', obligations, statements,
    trace: buildTrace({
      policySet: 'High-Value Read',
      rule: 'Permit with obligations above threshold',
      condition: `amount (${amt}) >= ${stepUpThreshold} AND NOT mfaSatisfied(acr)`,
      effect: 'PERMIT',
      statements: [...statements, ...obligations],
    }),
    raw: { engine: 'simulated-learning', demoType: 'obligations', amount: amt, acrStrong: acrLooksStrong(acr) },
  };
}

async function evaluateLearningDemo({ demoType, input }) {
  const i = input || {};
  switch (demoType) {
    case 'abac': return evalAbac(i);
    case 'indeterminate': return evalIndeterminate(i);
    case 'payloadFilter': return evalPayloadFilter(i);
    case 'obligations': return evalObligations(i);
    default: throw new Error(`unknown demoType: ${demoType}`);
  }
}

module.exports = { LEARNING_DEMO_TYPES, buildTrace, evaluateLearningDemo };
