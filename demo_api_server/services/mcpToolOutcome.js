// demo_api_server/services/mcpToolOutcome.js
/**
 * Single canonical classifier for a parsed MCP tool result (the object form of
 * executeBffTool's output). It recognises BOTH code shapes the unified pipeline
 * can return for a blocked call:
 *   - the mcp_-prefixed authorize-gate codes emitted by runMcpToolPipeline's
 *     evaluateMcpFirstToolGate: `mcp_hitl_required` / `mcp_step_up_required`
 *   - the bare gateway/content forms: `hitl_required` / `step_up_required`
 *
 * Both agent paths (banking dispatchBankingAction + vertical parseMcpToolPayload)
 * route HITL/step-up/deny detection through this one function so they can never
 * drift on which codes they accept (issue #402). Callers layer their own domain
 * fields (transaction metadata, render mode, step-up acr defaults) on top of the
 * canonical outcome returned here.
 */
'use strict';

/**
 * @param {object|null|undefined} result parsed tool result (NOT the raw JSON string)
 * @returns {{
 *   kind: 'hitl'|'step_up'|'error'|'ok',
 *   isError: boolean,          // false for 'ok'/'hitl'/'step_up' (valid preconditions), true only for 'error'
 *   error?: string,            // normalised bare code ('hitl_required'|'step_up_required') or raw error code
 *   hitl?: { type: string },   // hitl/step_up only
 *   hitlChallengeId?: string|null,
 *   message?: string|null,     // human-readable reason
 *   step_up_method?: string|null, // step_up only — pass-through (caller defaults if null)
 *   step_up_acr?: string|null,    // step_up only — pass-through (caller defaults if null)
 *   hitl_threshold_usd?: number|undefined, // pass-through when present (banking)
 * }}
 */
function classifyMcpToolResult(result) {
  const errCode = result?.error;
  if (!errCode) return { kind: 'ok', isError: false };

  const isStepUp = errCode === 'step_up_required' || errCode === 'mcp_step_up_required';
  const isHitl = errCode === 'hitl_required' || errCode === 'mcp_hitl_required';

  if (isHitl || isStepUp) {
    return {
      kind: isStepUp ? 'step_up' : 'hitl',
      // A 428 precondition (MFA / human approval) is not a failure — callers
      // should branch on this instead of inferring it from the `error` string.
      isError: false,
      // Normalise to the bare code both callers' envelope handlers expect.
      error: isStepUp ? 'step_up_required' : 'hitl_required',
      hitl: result.hitl || { type: isStepUp ? 'step_up' : 'consent' },
      // The pipeline gate carries the id as `challengeId`; bare forms use `hitlChallengeId`.
      hitlChallengeId: result.hitlChallengeId || result.challengeId || null,
      // The gate carries the reason as `error_description`; bare forms use `message`.
      message: result.message || result.error_description || null,
      step_up_method: result.step_up_method || null,
      step_up_acr: result.step_up_acr || null,
      hitl_threshold_usd: result.hitl_threshold_usd,
    };
  }

  // Deny / generic tool error — prefer a human-readable reason over the bare code.
  return {
    kind: 'error',
    isError: true,
    error: errCode,
    message: result.error_description || result.deny_reason || result.message || errCode,
  };
}

module.exports = { classifyMcpToolResult };
