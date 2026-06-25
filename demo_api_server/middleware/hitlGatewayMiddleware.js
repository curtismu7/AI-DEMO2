/**
 * HITL Gateway Middleware
 * Evaluates MCP tool calls for high-value operations
 * Requires explicit user consent for transfers/withdrawals >$500
 */

const crypto = require('crypto');

// Configuration
const configStore = require('../services/configStore');
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
// Keep backward-compat alias used in evaluateToolCall below
const getThreshold = getHitlThreshold;
const HIGH_VALUE_TOOLS = ['create_transfer', 'create_withdrawal'];

/**
 * Middleware: Check if tool call requires HITL consent
 */
function hitlGatewayMiddleware(req, res, next) {
  // Attach HITL evaluator to request
  req.evaluateHitl = evaluateToolCall;
  req.hitlPending = {}; // Store pending consent requests
  next();
}

/**
 * Evaluate tool call for HITL requirement
 * Returns: { requiresConsent: boolean, consentId?: string, reason?: string }
 */
async function evaluateToolCall(toolCall, userId) {
  const { tool, params } = toolCall;

  // Check if tool is high-value operation
  if (!HIGH_VALUE_TOOLS.includes(tool)) {
    return { requiresConsent: false };
  }

  // Check amount threshold
  const rawAmount = params.amount;
  const parsedAmount = typeof rawAmount === 'number' ? rawAmount : parseFloat(rawAmount);
  const amount = Number.isFinite(parsedAmount) ? parsedAmount : Infinity;
  const displayAmount = Number.isFinite(amount) ? `${amount.toFixed(2)}` : 'unknown amount';
  if (amount > getThreshold()) {
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

/**
 * Generate a cryptographically random consent request ID.
 *
 * CR-03 fix: the previous implementation hashed deterministic inputs
 * (userId + tool + params + Date.now()) and truncated to 16 hex chars.
 * Three of the four inputs are known or time-bounded, making the ID
 * partially predictable. crypto.randomUUID() gives 122 bits of CSPRNG
 * entropy with no dependency on request inputs.
 *
 * Parameters are kept for backward-compat with any existing callers but
 * are intentionally ignored.
 */
// eslint-disable-next-line no-unused-vars
function generateConsentId(_userId, _tool, _params) {
  return crypto.randomUUID();
}

/**
 * Store consent request (in-memory or Redis)
 */
async function storeConsentRequest(consentId, consentData) {
  // For demo: in-memory map
  // Production: use Redis with 5-min TTL
  if (!global.pendingConsents) {
    global.pendingConsents = {};
  }

  global.pendingConsents[consentId] = {
    ...consentData,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    decision: null,
  };
}

/**
 * Retrieve + validate consent decision
 */
async function getConsentDecision(consentId) {
  const consent = global.pendingConsents?.[consentId];
  if (!consent) {
    return { valid: false, error: 'Consent request expired or not found' };
  }

  if (consent.expiresAt < Date.now()) {
    delete global.pendingConsents[consentId];
    return { valid: false, error: 'Consent request expired' };
  }

  if (consent.decision === null) {
    return { valid: false, error: 'Consent not yet decided' };
  }

  // Single-use: consume the record so the same consentId cannot be replayed.
  const { decision, operation } = consent;
  delete global.pendingConsents[consentId];
  return {
    valid: true,
    approved: decision === 'approve',
    operation,
  };
}

/**
 * Record consent decision
 */
async function recordConsentDecision(consentId, decision) {
  const consent = global.pendingConsents?.[consentId];
  if (!consent) {
    throw new Error('Consent request not found');
  }

  consent.decision = decision; // 'approve' or 'reject'
  consent.decidedAt = Date.now();

  return consent;
}

module.exports = {
  hitlGatewayMiddleware,
  evaluateToolCall,
  generateConsentId,
  storeConsentRequest,
  getConsentDecision,
  recordConsentDecision,
};
