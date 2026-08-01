/**
 * Intent-based Authorization Service
 * Authorizes user intents based on confidence scores, risk, and authority binding.
 *
 * Per RFC 8693 + KYA Framework, gates on three independent dimensions:
 * 1. Intent confidence (NL parse accuracy)
 * 2. Risk score (fraud/anomaly signals)
 * 3. Authority binding (agent delegation scope)
 *
 * Returns permit/deny/consent-required decisions.
 */

const configStore = require('./configStore');
const appEventService = require('./appEventService');
const { evaluateRiskAndAuthority } = require('./intentRiskScorer');

/**
 * Evaluate whether an intent is authorized based on confidence, risk, and authority.
 *
 * @param {object} intentContext
 *   intent: string (normalized intent label)
 *   confidence: number (0–1, from NL parser)
 *   amount?: number (transaction amount, optional)
 *   toolName?: string (the tool being invoked)
 *   userId?: string (for risk scoring)
 *   accountId?: string (for risk scoring)
 *   agentId?: string (for authority binding check)
 *
 * @returns {object}
 *   authorized: boolean (true if intent is approved)
 *   requires_consent: boolean (true if HITL approval needed)
 *   reason: string (explanation for the decision)
 *   riskScore?: number (0–1, if computed)
 *   authorityScore?: number (0–1, if computed)
 */
async function evaluateIntentAuthorization(intentContext) {
  const { intent, confidence, amount, toolName, userId, accountId, agentId } = intentContext;

  // Normalize intent: trim and lowercase
  const normalizedIntent = (intent || '').trim().toLowerCase();

  if (!normalizedIntent || typeof confidence !== 'number') {
    const decision = {
      authorized: false,
      requires_consent: false,
      reason: 'Intent and confidence are required'
    };
    appEventService.logEvent('intent_auth', 'error', {
      intent: normalizedIntent,
      confidence,
      decision: decision.authorized ? 'permit' : 'deny',
      reason: decision.reason,
      toolName
    });
    return decision;
  }

  const minConfidence = parseFloat(configStore.getEffective('intent_min_confidence')) || 0.7;
  const requiresConsentListStr = configStore.getEffective('intent_requires_consent') || '';
  const requiresConsentList = requiresConsentListStr
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const maxAmountLowConfidence = parseFloat(configStore.getEffective('intent_max_amount_low_confidence')) || 100;

  // Compute risk and authority scores (async)
  let riskScore = undefined;
  let authorityScore = undefined;
  try {
    const riskAndAuthority = await evaluateRiskAndAuthority({
      intent: normalizedIntent,
      confidence,
      userId,
      accountId,
      amount,
      action: normalizedIntent,
      agentId,
    });
    riskScore = riskAndAuthority.riskScore;
    authorityScore = riskAndAuthority.authorityScore;
  } catch (e) {
    console.warn('[intentAuthService] Risk/authority scoring failed:', e.message);
  }

  // Read-only intents never require HITL consent — they cannot cause harm.
  const READ_ONLY_INTENTS = new Set([
    'view_balance', 'view_accounts', 'view_transactions', 'view_records',
    'view_coverage', 'list_appointments', 'list_orders', 'pto_balance',
    'view_benefits', 'list_gear',
    // UC1 primary read per vertical — these four shipped after this set was
    // written, so their read chips fell through to the conservative-consent
    // fallback and returned 428.
    'view_permits', 'view_courses', 'view_work_orders', 'view_portfolios',
  ]);
  if (READ_ONLY_INTENTS.has(normalizedIntent)) {
    return {
      authorized: true,
      requires_consent: false,
      reason: `Read-only intent '${normalizedIntent}' — no HITL required`,
      riskScore,
      authorityScore,
    };
  }

  // Decision logic with 3 dimensions: confidence + risk + authority
  // High confidence (>0.85) + Low risk (>0.7) + Full authority (>0.9) → PERMIT
  const highConfidence = confidence > 0.85;
  const lowRisk = riskScore === undefined || riskScore > 0.7;
  const authorityOk = authorityScore === undefined || authorityScore > 0.9;

  // Low confidence (<0.65) + High risk (<0.7) + Bad authority (<0.5) → DENY
  const veryLowConfidence = confidence < 0.65;
  const highRisk = riskScore !== undefined && riskScore < 0.7;
  const badAuthority = authorityScore !== undefined && authorityScore < 0.5;

  // If all three dimensions are unfavorable, deny
  if (veryLowConfidence && highRisk && badAuthority) {
    const decision = {
      authorized: false,
      requires_consent: false,
      reason: `Intent '${normalizedIntent}' denied: low confidence (${confidence.toFixed(2)}), high risk (${riskScore?.toFixed(2) || 'N/A'}), and insufficient authority (${authorityScore?.toFixed(2) || 'N/A'})`,
      riskScore,
      authorityScore,
    };
    appEventService.logEvent('intent_auth', 'warning', {
      intent: normalizedIntent,
      confidence,
      amount,
      riskScore,
      authorityScore,
      decision: 'deny',
      reason: decision.reason,
      toolName
    });
    return decision;
  }

  // If high confidence + low risk + authority ok → PERMIT
  if (highConfidence && lowRisk && authorityOk) {
    const decision = {
      authorized: true,
      requires_consent: false,
      reason: `Intent '${normalizedIntent}' authorized (confidence: ${confidence.toFixed(2)}, risk: ${riskScore?.toFixed(2) || 'N/A'}, authority: ${authorityScore?.toFixed(2) || 'N/A'})`,
      riskScore,
      authorityScore,
    };
    appEventService.logEvent('intent_auth', 'info', {
      intent: normalizedIntent,
      confidence,
      amount,
      riskScore,
      authorityScore,
      decision: 'permit',
      reason: decision.reason,
      toolName
    });
    return decision;
  }

  // Intent in consent list always requires HITL approval
  if (requiresConsentList.includes(normalizedIntent)) {
    const decision = {
      authorized: true,
      requires_consent: true,
      reason: `Intent '${normalizedIntent}' requires HITL consent (policy rule)`,
      riskScore,
      authorityScore,
    };
    appEventService.logEvent('intent_auth', 'info', {
      intent: normalizedIntent,
      confidence,
      amount,
      riskScore,
      authorityScore,
      decision: 'consent_required',
      reason: decision.reason,
      toolName
    });
    return decision;
  }

  // Fallback: borderline cases → require consent (conservative)
  const decision = {
    authorized: true,
    requires_consent: true,
    reason: `Intent '${normalizedIntent}' requires HITL consent (confidence: ${confidence.toFixed(2)}, risk: ${riskScore?.toFixed(2) || 'N/A'}, authority: ${authorityScore?.toFixed(2) || 'N/A'})`,
    riskScore,
    authorityScore,
  };
  appEventService.logEvent('intent_auth', 'info', {
    intent: normalizedIntent,
    confidence,
    amount,
    riskScore,
    authorityScore,
    decision: 'consent_required_conservative',
    reason: decision.reason,
    toolName
  });
  return decision;
}

module.exports = {
  evaluateIntentAuthorization,
};
