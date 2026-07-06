/**
 * HITL Gateway Middleware
 * Evaluates MCP tool calls for high-value operations
 * Requires explicit user consent for transfers/withdrawals above threshold.
 *
 * Storage: canonical demo_hitl_service (:3009) via hitlServiceClient — one HITL
 * solution shared with the MCP gateway and mcpDecisionPolling adapter.
 */

const crypto = require('crypto');

const configStore = require('../services/configStore');
const hitlServiceClient = require('../services/hitlServiceClient');
const { verticalManifest } = require('../services/verticalManifest');

// Returns the effective MFA threshold for the given vertical (falls back to global).
function getHitlThreshold(verticalId) {
  const vid = verticalId || verticalManifest.resolver.activeId();
  const vertKey = vid ? `mfa_threshold_usd_${vid}` : null;
  const vertRaw = vertKey ? configStore.getEffective(vertKey) : null;
  const vertN = Number(vertRaw);
  if (vertRaw && !isNaN(vertN) && vertN > 0) return vertN;
  const v = configStore.getEffective('mfa_threshold_usd');
  const n = Number(v);
  return (v && !isNaN(n)) ? n : 500;
}

const HIGH_VALUE_TOOLS = ['create_transfer', 'create_withdrawal'];

/**
 * Middleware: attach HITL evaluator bound to the request's active vertical.
 */
function hitlGatewayMiddleware(req, res, next) {
  const verticalId = verticalManifest.resolver.activeIdFor(req);
  req.evaluateHitl = (toolCall, userId) =>
    evaluateToolCall(toolCall, userId, { verticalId });
  req.hitlPending = {};
  next();
}

/**
 * Evaluate tool call for HITL requirement.
 * Returns: { requiresConsent: boolean, consentId?: string, reason?: string }
 */
async function evaluateToolCall(toolCall, userId, opts = {}) {
  const { tool, params } = toolCall;

  if (!HIGH_VALUE_TOOLS.includes(tool)) {
    return { requiresConsent: false };
  }

  const rawAmount = params.amount;
  const parsedAmount = typeof rawAmount === 'number' ? rawAmount : parseFloat(rawAmount);
  const amount = Number.isFinite(parsedAmount) ? parsedAmount : Infinity;
  const displayAmount = Number.isFinite(amount) ? `${amount.toFixed(2)}` : 'unknown amount';
  const threshold = getHitlThreshold(opts.verticalId);

  if (amount > threshold) {
    const consentId = generateConsentId(userId, tool, params);
    return {
      requiresConsent: true,
      consentId,
      reason: `High-value ${tool}: $${displayAmount} requires approval`,
      operation: {
        tool,
        params: {
          amount,
          account_id: params.account_id,
          from_account_id: params.from_account_id,
          to_account_id: params.to_account_id,
          description: params.description,
        },
      },
    };
  }

  return { requiresConsent: false };
}

// eslint-disable-next-line no-unused-vars
function generateConsentId(_userId, _tool, _params) {
  return crypto.randomUUID();
}

function _mapActionToTool(action) {
  const map = {
    transfer: 'create_transfer',
    create_transfer: 'create_transfer',
    withdrawal: 'create_withdrawal',
    create_withdrawal: 'create_withdrawal',
  };
  return map[action] || action || 'create_transfer';
}

/**
 * Create a pending HITL challenge in the canonical :3009 store.
 * @returns {Promise<string>} challengeId (used as consentId by demo-agent routes)
 */
async function storeConsentRequest(consentData) {
  const challenge = await hitlServiceClient.createChallenge({
    tool: _mapActionToTool(consentData.action),
    userId: consentData.userId || null,
    userEmail: consentData.userEmail || null,
    context: {
      amount: consentData.amount,
      details: consentData.details,
      sessionId: consentData.sessionId,
      action: consentData.action,
    },
  });
  return challenge.challengeId;
}

/**
 * Retrieve + validate consent decision from the canonical store.
 */
async function getConsentDecision(consentId, expected = {}) {
  let status;
  try {
    status = await hitlServiceClient.getChallengeStatus(consentId);
  } catch {
    return { valid: false, error: 'Consent request expired or not found' };
  }

  if (status.status === 'pending') {
    return { valid: false, error: 'Consent not yet decided' };
  }

  const verification = hitlServiceClient.verifyHitlReceipt(
    status,
    expected.userId,
    expected.agentId,
    expected.tool || status.tool,
  );
  if (!verification.ok) {
    return { valid: false, error: verification.message || 'HITL receipt invalid' };
  }

  const operation = {
    tool: status.tool,
    params: status.context?.details || status.context || {},
  };

  return {
    valid: true,
    approved: status.status === 'approved',
    operation,
  };
}

/**
 * Record consent decision in the canonical store.
 */
async function recordConsentDecision(consentId, decision) {
  const mapped = decision === 'approve' ? 'approved' : 'denied';
  await hitlServiceClient.respondToChallenge(consentId, mapped);
  return { challengeId: consentId, decision: mapped };
}

module.exports = {
  hitlGatewayMiddleware,
  evaluateToolCall,
  generateConsentId,
  getHitlThreshold,
  storeConsentRequest,
  getConsentDecision,
  recordConsentDecision,
};
