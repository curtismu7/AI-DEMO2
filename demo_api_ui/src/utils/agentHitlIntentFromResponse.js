// demo_api_ui/src/utils/agentHitlIntentFromResponse.js
/**
 * Build HITL pending-intent fields from an /api/agent/invoke gated response.
 * The nlResumeAfterAuth path used to set form:{} while putting account ids only
 * on intentPayload — after consent, createTransferWithConsent then ran with
 * undefined fromId/toId and NaN amount, so the transfer never completed.
 *
 * @param {object} response - agent invoke response with transaction* fields
 * @param {number} [defaultThreshold]
 * @returns {{ actionId: string, form: object, intentPayload: object, threshold: number, hitlChallengeId: string|null } | null}
 */
export function buildBankingHitlPendingFromAgentResponse(response, defaultThreshold = 250) {
  if (!response || response.transactionAmount == null) return null;
  const error = response.error;
  const isHitl = error === "hitl_required" || error === "mcp_hitl_required";
  if (!isHitl) return null;

  const txType = response.transactionType || "transfer";
  const fromId = response.fromAccountId || response.from_account_id || null;
  const toId = response.toAccountId || response.to_account_id || null;
  const amount = response.transactionAmount;

  return {
    actionId: txType,
    // Must match runAction / createTransferWithConsent field names (fromId/toId/amount).
    form: {
      fromId,
      toId,
      amount: String(amount),
      accountId: fromId || toId,
      note: `Agent ${txType}`,
    },
    intentPayload: {
      type: txType,
      fromAccountId: fromId,
      toAccountId: toId,
      amount,
      description: `Agent ${txType}`,
    },
    threshold: response.hitl_threshold_usd ?? defaultThreshold,
    hitlChallengeId: response.hitlChallengeId || response.challengeId || null,
  };
}

/**
 * True when an agent invoke response is a money-move step-up that should open MFA.
 * @param {object} response
 * @returns {boolean}
 */
export function isBankingStepUpAgentResponse(response) {
  if (!response || response.transactionAmount == null) return false;
  const error = response.error;
  return error === "step_up_required" || error === "mcp_step_up_required";
}

/**
 * Build the form + actionId for replaying a banking step-up via runAction after OTP.
 * @param {object} response
 * @returns {{ actionId: string, form: object, hitlRetryChallengeId: string|null } | null}
 */
export function buildBankingStepUpReplayFromAgentResponse(response) {
  if (!isBankingStepUpAgentResponse(response)) return null;
  const txType = response.transactionType || "transfer";
  const fromId = response.fromAccountId || response.from_account_id || null;
  const toId = response.toAccountId || response.to_account_id || null;
  const amount = response.transactionAmount;
  return {
    actionId: txType,
    form: {
      fromId,
      toId,
      amount: String(amount),
      accountId: fromId || toId,
      note: `Agent ${txType}`,
    },
    hitlRetryChallengeId: response.hitlChallengeId || response.challengeId || null,
  };
}
