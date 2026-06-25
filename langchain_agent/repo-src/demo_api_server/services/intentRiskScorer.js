/**
 * Risk & Authority Dimension Scorer for Intent Authorization
 * Complements confidence scoring with industry best-practice dimensions.
 *
 * Per RFC 8693 + KYA Framework, intent authorization gates on:
 * 1. Intent confidence (likelihood the NL parse is correct)
 * 2. Risk score (fraud/anomaly signals in the transaction itself)
 * 3. Authority binding (is this agent authorized for this user/account?)
 */

const configStore = require('./configStore');
const dataStore = require('../data/store');

/**
 * Compute risk score (0–1, where 0 = high risk, 1 = low risk) based on:
 *   - Transaction amount (high amounts = higher risk)
 *   - Velocity (frequency of operations in short window)
 *   - Account type (sensitive account types = higher risk)
 *   - Device/geolocation changes (not implemented in this demo)
 */
async function scoreRisk(context) {
  const { amount, userId, accountId, action } = context;

  let riskScore = 0.8; // baseline: low-to-medium risk

  // Amount-based risk: scale up risk as amount increases
  if (amount && amount > 0) {
    if (amount > 10000) riskScore -= 0.35; // Very high-risk amount
    else if (amount > 5000) riskScore -= 0.25; // High-risk amount
    else if (amount > 1000) riskScore -= 0.15; // Medium-risk amount
    else if (amount < 10) riskScore += 0.05; // Low-risk small amount
  }

  // Action type: write operations are higher risk than reads
  if (action && ['transfer', 'deposit', 'withdraw'].includes(action)) {
    riskScore -= 0.1;
  }

  // Velocity: if user has multiple transactions in the last hour, flag as higher risk
  // (simplified demo: just check transaction count, not actual timing)
  try {
    const txns = await dataStore.getTransactionsByUserId(userId);
    if (txns && txns.length > 5) riskScore -= 0.1;
  } catch (_) {
    // If data store unavailable, don't adjust score
  }

  return Math.max(0, Math.min(1, riskScore));
}

/**
 * Compute authority binding score (0–1, where 1 = fully authorized).
 * Checks if the requesting agent is authorized for this user's operations.
 *
 * In a real implementation, this would check:
 *   - Is the agent in the user's delegated agent list?
 *   - Does the agent have the necessary scopes for this operation?
 *   - Is the agent's certificate/identity valid?
 *   - Are we within the agent's delegation scope (e.g., specific account)?
 */
async function scoreAuthorityBinding(context) {
  const { userId, agentId, action, targetAccountId } = context;

  // Baseline: full authority (demo assumes all agents are fully authorized)
  // In production, this would check:
  // 1. Agent is in user's delegation manifest
  // 2. Scopes match the action type
  // 3. No time/amount restrictions have been exceeded
  // 4. Agent certificate/signature is valid
  let authorityScore = 1.0;

  // If no agent ID provided (direct user action), score is undefined (not applicable)
  if (!agentId) return undefined;

  // In this demo, we don't track agent delegations yet, so return a placeholder
  // A real implementation would look up agentId in user's delegation list
  try {
    // Placeholder: if the agent ID is valid syntax, score high
    if (agentId && typeof agentId === 'string' && agentId.length > 0) {
      authorityScore = 0.95; // Assume valid unless proven otherwise
    }
  } catch (_) {
    authorityScore = 0.5; // Unknown agent = medium trust
  }

  return authorityScore;
}

/**
 * Combined risk + authority decision logic.
 * Returns a verdict object with a composite score and recommendation.
 *
 * Decision matrix (simplified):
 * - High confidence (>0.85) + Low risk (>0.7) + Full authority (>0.9) → PERMIT
 * - Medium confidence (0.65–0.85) + Any risk → REQUIRE CONSENT
 * - Low confidence (<0.65) + High risk (<0.7) → DENY
 */
async function evaluateRiskAndAuthority(context) {
  const { intent, confidence, userId, accountId, amount, action, agentId } = context;

  const riskScore = await scoreRisk({ amount, userId, accountId, action });
  const authorityScore = await scoreAuthorityBinding({ userId, agentId, action, targetAccountId: accountId });

  const verdict = {
    intent,
    confidence,
    riskScore,
    authorityScore,
    compositeScore: (confidence * 0.5 + riskScore * 0.35 + (authorityScore ?? 1.0) * 0.15),
    recommendation: 'unknown',
  };

  // Decision logic
  const highConfidence = confidence > 0.85;
  const lowRisk = riskScore > 0.7;
  const authorityOk = authorityScore === undefined || authorityScore > 0.9;

  if (highConfidence && lowRisk && authorityOk) {
    verdict.recommendation = 'permit';
  } else if (confidence < 0.65 && riskScore < 0.7 && !authorityOk) {
    verdict.recommendation = 'deny';
  } else {
    verdict.recommendation = 'consent_required';
  }

  return verdict;
}

module.exports = {
  scoreRisk,
  scoreAuthorityBinding,
  evaluateRiskAndAuthority,
};
