// demo_api_server/services/stepVerificationExpectations.js
'use strict';

/**
 * Derive verifiable expectations from the use-case catalog.
 * Drive step-verification off expectedOutcome + chip text + match — not a
 * parallel hand-maintained matrix.
 */

const { USE_CASES, resolveUseCase } = require('../config/useCases.js');

/** Heuristic ACTION → MCP tool (keep in sync with tests/helpers/actionToTool.js). */
const ACTION_TO_TOOL = {
  transfer: 'create_transfer',
  transfer_600_test: 'create_transfer',
  deposit: 'create_deposit',
  withdraw: 'create_withdrawal',
  balance: 'get_account_balance',
  accounts: 'get_my_accounts',
  transactions: 'get_my_transactions',
  branch_hours: 'get_branch_hours',
  weather: 'get_weather',
};

/** Catalog expectedOutcome → agentPreflight decision string (or null if N/A). */
const OUTCOME_TO_GATE = {
  DENY: 'DENY',
  STEP_UP: 'STEP_UP',
  HITL_REQUIRED: 'HITL',
};

/**
 * Pull $amount from chip text (first $N or bare transfer amount).
 * @param {string} text
 * @returns {number|null}
 */
function amountFromChipText(text) {
  if (!text) return null;
  const m = String(text).match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  if (m) return Number(m[1]);
  return null;
}

/**
 * Normalize heuristic parse into { action, params, tool, amount }.
 * Mirrors demoAgentLangGraphService: transfer_600_test → transfer @ 600.
 * @param {object|null} parsed
 */
function normalizeParsedIntent(parsed) {
  if (!parsed) return null;
  const banking = parsed.banking || null;
  let action = banking?.action ?? parsed.action ?? null;
  let params = { ...(banking?.params || parsed.params || {}) };

  if (action === 'transfer_600_test') {
    action = 'transfer';
    params = {
      fromId: params.fromId || 'checking',
      toId: params.toId || 'savings',
      amount: params.amount != null ? Number(params.amount) : 600,
      ...params,
    };
  }

  const tool = ACTION_TO_TOOL[action] || action;
  const amount =
    params.amount != null && params.amount !== ''
      ? Number(params.amount)
      : null;

  return { action, params, tool, amount };
}

/**
 * @param {object} uc — resolved use case
 * @returns {{
 *   id: string,
 *   chipText: string|null,
 *   primaryTool: string|null,
 *   expectedOutcome: string,
 *   gate: string|null,
 *   amount: number|null,
 * }}
 */
function expectationFromUseCase(uc) {
  const chipText = uc.trigger?.type === 'chip' ? uc.trigger.text : null;
  const amount =
    amountFromChipText(chipText) ??
    (uc.match?.amountMin != null && uc.match?.amountMax == null
      ? Number(uc.match.amountMin)
      : null) ??
    (uc.match?.amountMin != null &&
    uc.match?.amountMax != null &&
    Number(uc.match.amountMin) === Number(uc.match.amountMax)
      ? Number(uc.match.amountMin)
      : amountFromChipText(chipText));

  return {
    id: uc.id,
    chipText,
    primaryTool: uc.primaryTool || null,
    expectedOutcome: uc.expectedOutcome,
    gate: OUTCOME_TO_GATE[uc.expectedOutcome] || null,
    amount: amount != null && Number.isFinite(amount) ? amount : null,
  };
}

/**
 * Banking works-maturity chips that are heuristic-routable.
 * @returns {ReturnType<typeof expectationFromUseCase>[]}
 */
function bankingWorksChipExpectations() {
  const out = [];
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, 'banking') || u;
    if (uc.maturity !== 'works') continue;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text) continue;
    if (/specialist/i.test(t.text)) continue;
    if (!uc.primaryTool) continue;
    out.push(expectationFromUseCase(uc));
  }
  return out;
}

/**
 * Amount-gated transfer chips whose catalog expectedOutcome matches the
 * amount tier (DENY >=2000, STEP_UP 500-1999.99, HITL below 500). Excludes cases
 * like UC27 that reuse a $600 chip text for a different story (bypass).
 */
function bankingAmountGateExpectations() {
  return bankingWorksChipExpectations().filter((e) => {
    if (!(e.gate && e.amount != null && e.primaryTool === 'create_transfer')) return false;
    if (e.gate === 'DENY') return e.amount >= 2000;
    if (e.gate === 'STEP_UP') return e.amount >= 500 && e.amount < 2000;
    if (e.gate === 'HITL') return e.amount > 0 && e.amount < 500;
    return false;
  });
}

/**
 * Assert invoke/attack responses carry Token Chain teaching detail — not just a
 * bare error code. Live step verification should FAIL when the rail would be blank.
 *
 * @param {Array<object>|null|undefined} tokenEvents
 * @param {{ requireFailureEvent?: boolean }} [opts]
 * @returns {{ ok: boolean, reason: string|null }}
 */
function scoreTokenChainDetail(tokenEvents, { requireFailureEvent = false } = {}) {
  if (!Array.isArray(tokenEvents) || tokenEvents.length === 0) {
    return { ok: false, reason: 'empty_token_events' };
  }
  const hasDetail = tokenEvents.some(
    (e) => e && (
      (typeof e.explanation === 'string' && e.explanation.length > 0)
      || e.exchangeRequest
      || e.requestContext
      || (e.claims && Object.keys(e.claims).length > 0)
      || e.error
      || e.pingoneError
      || e.authorization_details
      || e.decision
    ),
  );
  if (!hasDetail) {
    return { ok: false, reason: 'no_event_detail' };
  }
  if (requireFailureEvent) {
    const fail = tokenEvents.find(
      (e) => e && (
        e.id === 'exchange-failed'
        || e.id === 'sim-exchange-error'
        || e.id === 'sim-gateway-deny'
        || e.status === 'failed'
        || e.status === 'error'
      ),
    );
    if (!fail) {
      return { ok: false, reason: 'missing_failure_event' };
    }
    if (!(fail.explanation || fail.pingoneError || fail.error || fail.label)) {
      return { ok: false, reason: 'failure_without_detail' };
    }
  }
  return { ok: true, reason: null };
}

/** Token Summary accordion ids — keep in sync with TraceTokenSummary TOKEN_META. */
const TOKEN_SUMMARY_IDS_1EX = [
  'user-token',
  'agent-actor-token',
  'exchanged-token',
];
const TOKEN_SUMMARY_IDS_2EX = [
  'user-token',
  'two-ex-agent-actor',
  'two-ex-exchange1',
  'two-ex-mcp-actor',
  'two-ex-final-token',
];

/**
 * Detect exchange vocabulary from events (any two-ex-* ⇒ 2-exchange mode).
 * @param {Array<object>|null|undefined} tokenEvents
 * @returns {'1ex'|'2ex'}
 */
function detectTokenSummaryMode(tokenEvents) {
  const ids = (tokenEvents || []).map((e) => e && e.id).filter(Boolean);
  return ids.some((id) => String(id).startsWith('two-ex-')) ? '2ex' : '1ex';
}

/**
 * Whether an event id satisfies a required Token Summary slot.
 * `exchanged-token-fallback` counts as the 1-ex delegated token.
 * @param {Set<string>} present
 * @param {string} requiredId
 */
function hasSummaryToken(present, requiredId) {
  if (present.has(requiredId)) return true;
  if (requiredId === 'exchanged-token' && present.has('exchanged-token-fallback')) return true;
  return false;
}

/**
 * Assert Token Summary would list every token for this run's exchange mode.
 * Default demo path is 2-exchange; 1-exchange is the debug escape hatch.
 *
 * @param {Array<object>|null|undefined} tokenEvents
 * @returns {{
 *   ok: boolean,
 *   reason: string|null,
 *   mode: '1ex'|'2ex',
 *   required: string[],
 *   present: string[],
 *   missing: string[],
 * }}
 */
function scoreTokenSummaryCoverage(tokenEvents) {
  if (!Array.isArray(tokenEvents) || tokenEvents.length === 0) {
    return {
      ok: false,
      reason: 'empty_token_events',
      mode: '1ex',
      required: TOKEN_SUMMARY_IDS_1EX,
      present: [],
      missing: [...TOKEN_SUMMARY_IDS_1EX],
    };
  }
  const presentSet = new Set(tokenEvents.map((e) => e && e.id).filter(Boolean));
  const mode = detectTokenSummaryMode(tokenEvents);
  const required = mode === '2ex' ? TOKEN_SUMMARY_IDS_2EX : TOKEN_SUMMARY_IDS_1EX;
  const missing = required.filter((id) => !hasSummaryToken(presentSet, id));
  const present = required.filter((id) => hasSummaryToken(presentSet, id));
  if (missing.length) {
    return {
      ok: false,
      reason: 'missing_summary_tokens',
      mode,
      required,
      present,
      missing,
    };
  }
  return { ok: true, reason: null, mode, required, present, missing: [] };
}

module.exports = {
  OUTCOME_TO_GATE,
  TOKEN_SUMMARY_IDS_1EX,
  TOKEN_SUMMARY_IDS_2EX,
  amountFromChipText,
  normalizeParsedIntent,
  expectationFromUseCase,
  bankingWorksChipExpectations,
  bankingAmountGateExpectations,
  scoreTokenChainDetail,
  detectTokenSummaryMode,
  scoreTokenSummaryCoverage,
};
