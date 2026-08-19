/**
 * Recognizing an authorization block on a THROWN error.
 *
 * Body-shaped blocks (`response.error === 'step_up_required'`) are read
 * directly where the agent gets a resolved response. These helpers are for the
 * paths that throw instead — callRestTransaction / callMcpTool reject on any
 * non-2xx, so the block arrives as an Error carrying `statusCode` + `code`.
 *
 * The status is NOT one value: `ff_rfc9470_challenge` (default ON) makes the
 * BFF answer 401 + WWW-Authenticate; only with the flag OFF does it answer the
 * legacy 428. Both carry the same code, so the code identifies the block and
 * the status only confirms it is a transport-level refusal.
 */

/** Consent and step-up, in the REST and MCP spellings. */
const APPROVAL_BLOCK_CODES = Object.freeze([
  'hitl_required',
  'mcp_hitl_required',
  'step_up_required',
  'mcp_step_up_required',
]);

const STEP_UP_CODES = Object.freeze(['step_up_required', 'mcp_step_up_required']);
const BLOCK_STATUSES = Object.freeze([401, 428]);

/** Any pending-approval block — consent or step-up. */
export function isApprovalBlockError(err) {
  return APPROVAL_BLOCK_CODES.includes(err?.code);
}

/**
 * A live step-up challenge the UI must answer with MFA/CIBA. Requires both the
 * code and a block status: a 401 WITHOUT a step-up code is session expiry and
 * must keep falling through to re-authentication.
 */
export function isStepUpBlockError(err) {
  const status = err?.statusCode ?? err?.response?.status;
  return BLOCK_STATUSES.includes(status) && STEP_UP_CODES.includes(err?.code);
}
