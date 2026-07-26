// demo_api_server/scripts/useCaseSweepCauses.js
'use strict';

/**
 * Classification tables for the use-case sweep.
 *
 * Kept separate from the runner so the runner stays about control flow and this
 * stays about "what does this failure mean" — the part that needs editing when
 * a new failure mode shows up.
 */

/**
 * Heuristic actions that are DISPATCHED CLIENT-SIDE, not by the BFF.
 *
 * dispatchBankingAction returns null for these ("heuristic matched but requires
 * client-side / LLM formatting") and demo_api_ui/src/components/AIAgent.js
 * handles them in its own switch — e.g. `case "mortgage_demo"` calls the gateway
 * MCP tool show_mortgage and navigates to /path/mortgage.
 *
 * This matters for scoring: driving them through POST /api/agent/invoke does NOT
 * exercise the demo's real path. The request falls through to the LLM, which
 * answers non-deterministically — sometimes with the right data, sometimes with
 * a generic greeting. Scoring that yields false PASSes (a long, plausible reply)
 * and false FAILs (a transient), which is exactly how a chip that works fine in
 * the UI got reported as broken during this sweep's own development.
 *
 * Mirrors the list in services/nlIntentSanitize.js.
 */
const CLIENT_DISPATCHED_ACTIONS = new Set([
  'mcp_tools',
  'jwt_decode_demo',
  'mortgage_demo',
  'invest_demo',
  'vertical_feature_demo',
  'biggest_purchase',
  'spending_summary',
  'unusual_patterns',
  'afford_check',
  'api_key_demo',
  'dual_token_demo',
  'logout',
  'web_search',
]);

/**
 * Free-form LLM-analysis use cases: primaryTool is null by design, the LLM picks
 * its own tools at runtime. Same set the routing gates skip
 * (LLM_ANALYSIS_UNROUTABLE in useCases.primaryTool.test.js).
 */
const LLM_ANALYSIS_UNROUTABLE = new Set(['UC34', 'UC35']);

/**
 * Cause classes. Deliberately reuses the errorClass vocabulary from
 * services/stepVerificationLedger.js so a sweep row and a ledger row can be
 * compared, plus sweep-only classes for defects in the catalog or the harness
 * rather than the runtime.
 */
const CAUSE = {
  // runtime (shared with the ledger errorClass enum)
  MISSING_PREREQ: 'missing_prereq',
  SERVER_ERROR: 'server_error',
  WRONG_GATE: 'wrong_gate',
  WRONG_RESPONSE: 'wrong_response',
  EXCHANGE_FAILED: 'exchange_failed',
  // sweep-only — not runtime failures, so they must never be reported as FAIL
  NOT_RUNNABLE: 'not_runnable',
  CLIENT_DISPATCHED: 'client_dispatched',
  LLM_ANALYSIS: 'llm_analysis',
  NO_PRIMARY_TOOL: 'no_primary_tool',
};

/**
 * Identity-layer signatures, matched in order against one haystack per row.
 * First hit wins. `hint` is what an operator should actually do about it.
 */
const SIGNATURES = [
  {
    detail: 'invalid_scope_multi_resource',
    re: /invalid_scope[\s\S]*multiple resources|May not request scopes for multiple resources/i,
    hint: 'A single RFC 8693 exchange may narrow to exactly ONE PingOne resource '
      + '(scope vocabularies are per-resource, T-10). Check which audience the hop targets.',
  },
  {
    detail: 'invalid_aud',
    re: /invalid_aud|GATEWAY_AUDIENCE_MISMATCH|Audience mismatch/i,
    hint: 'MCP_GW_RESOURCE_URI must list every audience the gateway accepts, '
      + 'including the PingGateway-minted one.',
  },
  {
    detail: 'scope_mismatch',
    re: /SCOPE_MISMATCH/i,
    hint: 'User scopes do not match the allowed set for that audience — see '
      + 'configStore.buildAllowedScopesByAudience().',
  },
  {
    detail: 'insufficient_scope',
    re: /insufficient_scope/i,
    hint: 'The bearer lacks a scope the tool requires; check tools[].requiredScopes '
      + 'in scope-topology.json and the gateway edge scope.',
  },
  {
    detail: 'policy_not_found',
    re: /policy_not_found|POLICY_NOT_FOUND|no matching policy/i,
    hint: 'The configured P1AZ decision endpoint id does not resolve — a deleted '
      + 'endpoint silently denies everything.',
  },
  {
    detail: 'user_lookup_failed',
    re: /user_lookup_failed/i,
    hint: 'authz-server cannot reach PingOne for the user lookup — usually missing '
      + 'worker credentials on that service.',
  },
  {
    detail: 'unknown_tool',
    re: /-32602|Unknown tool/i,
    hint: 'PingGateway is serving a stale mcp-tool-schemas.json, or the tool is not '
      + 'registered. Regenerate with gen:tool-schemas.',
  },
  {
    detail: 'authorize_unavailable',
    re: /mcp_authorize_unavailable|authorize_worker|invalid_client/i,
    hint: 'PingOne Authorize credentials are unusable — check the worker secret.',
  },
  {
    detail: 'delegation_chain_broken',
    re: /delegation_chain_broken|Delegation chain validation failed/i,
    hint: 'An exchange in the chain failed. The underlying PingOne error is in the '
      + 'BFF log; this string alone does not say which hop.',
  },
];

/**
 * Classify a free-text failure reason into a stable detail label.
 * Unmatched text is bucketed explicitly rather than dropped, so a novel failure
 * mode stays visible instead of silently collapsing into "other".
 * @param {string} haystack
 * @returns {{ detail: string, hint: string|null }}
 */
function classifyReason(haystack) {
  const text = String(haystack || '');
  for (const sig of SIGNATURES) {
    if (sig.re.test(text)) return { detail: sig.detail, hint: sig.hint };
  }
  return { detail: text ? `unmatched:${text.slice(0, 60)}` : 'unmatched:(empty)', hint: null };
}

/**
 * Whether this catalog entry can be scored by driving POST /api/agent/invoke.
 * @param {object} uc resolved catalog entry
 * @param {string|null} action heuristic action, when known
 * @returns {{ scorable: boolean, cause: string|null, note: string|null }}
 */
function dispatchClassification(uc, action) {
  const maturity = String(uc.maturity || '');
  if (maturity !== 'works' && !maturity.startsWith('flag:')) {
    return { scorable: false, cause: CAUSE.NOT_RUNNABLE, note: `maturity=${maturity || '(none)'}` };
  }
  if (LLM_ANALYSIS_UNROUTABLE.has(uc.id)) {
    return {
      scorable: false,
      cause: CAUSE.LLM_ANALYSIS,
      note: 'free-form LLM analysis; primaryTool is null by design',
    };
  }
  if (action && CLIENT_DISPATCHED_ACTIONS.has(action)) {
    return {
      scorable: false,
      cause: CAUSE.CLIENT_DISPATCHED,
      note: `action "${action}" is dispatched by the UI, not the BFF — the API path `
        + 'falls through to the LLM and cannot be scored',
    };
  }
  const isChip = (uc.trigger || {}).type === 'chip';
  if (isChip && !uc.primaryTool) {
    return {
      scorable: false,
      cause: CAUSE.NO_PRIMARY_TOOL,
      note: 'chip declares no primaryTool',
    };
  }
  return { scorable: true, cause: null, note: null };
}

module.exports = {
  CAUSE,
  SIGNATURES,
  CLIENT_DISPATCHED_ACTIONS,
  LLM_ANALYSIS_UNROUTABLE,
  classifyReason,
  dispatchClassification,
};
