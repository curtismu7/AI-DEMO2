/**
 * agentTransactionTracker.js
 *
 * Tracks delegated agent transactions and enforces configurable limits.
 * Works with RFC 8693 delegated access where an agent acts on behalf of a user.
 *
 * Limits are configured per-user-session (not per-global-agent) because the agent
 * acts within the context of a user's session. When the user approves new agent
 * access (Phase 94 HITL), the budget resets.
 *
 * Session state:
 * {
 *   agentTransactionTracker: {
 *     consumedCount: number,      // Transactions performed so far
 *     consumedValue: number,      // Total value transferred ($)
 *     lastResetAt: Date,          // When budget was last reset
 *     approvalTokenId: string,    // Links to Phase 94 HITL approval
 *   }
 * }
 */

const runtimeSettings = require('../config/runtimeSettings');

/**
 * Check if agent transaction would exceed budget.
 * Returns {ok: bool, remaining?: {count, value}, error?: {status, json}}
 *
 * @param {object} req - Express request with session and user
 * @param {number} amount - Transaction amount (USD)
 * @param {string} type - Transaction type (transfer/withdrawal/deposit)
 * @returns {object} Budget check result
 */

function checkAgentTransactionBudget(req, amount, type) {
  // Bypass tracking if not delegated or if user is admin
  if (!req.user?.isDelegated || req.user?.role === 'admin') {
    return { ok: true };
  }

  // Initialize session tracker if needed
  if (!req.session.agentTransactionTracker) {
    req.session.agentTransactionTracker = {
      consumedCount: 0,
      consumedValue: 0,
      lastResetAt: new Date(),
      approvalTokenId: null,
    };
  }

  const tracker = req.session.agentTransactionTracker;
  const countLimit = runtimeSettings.get('agentTransactionCountLimit') || 0; // 0 = unlimited
  const valueLimit = runtimeSettings.get('agentTransactionValueLimit') || 0; // 0 = unlimited

  // Check count limit
  if (countLimit > 0 && tracker.consumedCount >= countLimit) {
    const remaining = { count: 0, value: Math.max(0, valueLimit - tracker.consumedValue) };
    const message = `Agent transaction count limit exceeded (${tracker.consumedCount}/${countLimit}). New approval required.`;
    return {
      ok: false,
      remaining,
      error: {
        status: 429,
        json: {
          error: 'agent_transaction_limit_exceeded',
          error_description: message,
          limit_type: 'count',
          limit_value: countLimit,
          consumed: tracker.consumedCount,
          remaining: remaining.count,
        },
      },
    };
  }

  // Check value limit
  if (valueLimit > 0 && tracker.consumedValue + amount > valueLimit) {
    const remainingValue = Math.max(0, valueLimit - tracker.consumedValue);
    const remaining = { count: Math.max(0, countLimit - tracker.consumedCount), value: remainingValue };
    const message = `Agent transaction value limit would be exceeded ($${valueLimit}). Current: $${tracker.consumedValue}, Requested: $${amount}, Remaining: $${remainingValue}. New approval required.`;
    return {
      ok: false,
      remaining,
      error: {
        status: 429,
        json: {
          error: 'agent_transaction_limit_exceeded',
          error_description: message,
          limit_type: 'value',
          limit_value: valueLimit,
          consumed: tracker.consumedValue,
          requested: amount,
          remaining: remainingValue,
        },
      },
    };
  }

  // Budget OK
  const consumed = { count: tracker.consumedCount + 1, value: tracker.consumedValue + amount };
  const remaining = {
    count: countLimit > 0 ? countLimit - consumed.count : null,
    value: valueLimit > 0 ? valueLimit - consumed.value : null,
  };

  return { ok: true, consumed, remaining };
}

/**
 * Consume one transaction from budget.
 * Called AFTER transaction is successfully created.
 *
 * @param {object} req - Express request with session
 * @param {number} amount - Transaction amount ($)
 * @param {string} type - Transaction type
 */
function consumeAgentTransaction(req, amount, type) {
  if (!req.user?.isDelegated || req.user?.role === 'admin') {
    return; // No tracking needed
  }

  if (!req.session.agentTransactionTracker) {
    req.session.agentTransactionTracker = {
      consumedCount: 0,
      consumedValue: 0,
      lastResetAt: new Date(),
      approvalTokenId: null,
    };
  }

  req.session.agentTransactionTracker.consumedCount += 1;
  req.session.agentTransactionTracker.consumedValue += amount;

  console.log(
    `[AgentTxnTracker] Consumed transaction: count=${req.session.agentTransactionTracker.consumedCount}, value=$${req.session.agentTransactionTracker.consumedValue}`,
  );
}

/**
 * Reset agent transaction budget (called when user approves new agent access).
 * Integrates with Phase 94 HITL approval flow.
 *
 * @param {object} req - Express request with session
 * @param {string} [approvalTokenId] - Optional link to Phase 94 HITL approval token
 */
function resetAgentBudget(req, approvalTokenId) {
  if (!req.session) return;

  req.session.agentTransactionTracker = {
    consumedCount: 0,
    consumedValue: 0,
    lastResetAt: new Date(),
    approvalTokenId: approvalTokenId || null,
  };

  console.log(`[AgentTxnTracker] Budget reset for ${req.user?.id} at ${new Date().toISOString()}`);
}

/**
 * Get current agent transaction state (for debugging/UI).
 *
 * @param {object} req - Express request
 * @returns {object} Current tracker state or null if not applicable
 */
function getAgentTransactionState(req) {
  if (!req.user?.isDelegated) return null;

  if (!req.session.agentTransactionTracker) {
    return {
      consumedCount: 0,
      consumedValue: 0,
      lastResetAt: new Date(),
      approvalTokenId: null,
    };
  }

  const tracker = req.session.agentTransactionTracker;
  const countLimit = runtimeSettings.get('agentTransactionCountLimit') || 0;
  const valueLimit = runtimeSettings.get('agentTransactionValueLimit') || 0;

  return {
    ...tracker,
    limits: {
      countLimit,
      valueLimit,
    },
    remaining: {
      count: countLimit > 0 ? countLimit - tracker.consumedCount : null,
      value: valueLimit > 0 ? valueLimit - tracker.consumedValue : null,
    },
  };
}

module.exports = {
  checkAgentTransactionBudget,
  consumeAgentTransaction,
  resetAgentBudget,
  getAgentTransactionState,
};
