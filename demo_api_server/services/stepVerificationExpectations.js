// demo_api_server/services/stepVerificationExpectations.js
'use strict';

/**
 * Derive verifiable expectations from the use-case catalog.
 * Drive step-verification off expectedOutcome + chip text + match — not a
 * parallel hand-maintained matrix.
 */

const fs = require('fs');
const path = require('path');
const { USE_CASES, resolveUseCase, SECOND_PRODUCT_TOOL_BY_VERTICAL } = require('../config/useCases.js');
const { gwAuthorizeEventFrom } = require('../utils/gwAuthorizeUtils');

/**
 * Heuristic ACTION → MCP tool. THE single source; tests/helpers/actionToTool.js
 * re-exports this rather than keeping a parallel copy.
 *
 * It was two copies with a "keep in sync" comment as the only enforcement, and
 * they had already drifted: the service copy was missing `wire_transfer` and
 * `sensitive_account_details`, so normalizeParsedIntent() returned the ACTION name
 * where a tool name was expected for both. A comment is not a gate.
 */
const ACTION_TO_TOOL = {
  transfer: 'create_transfer',
  // Banking's own high-value action — step-up is gated on the TOOL, so it must map
  // to its own tool name rather than collapsing onto create_transfer.
  wire_transfer: 'create_wire_transfer',
  transfer_600_test: 'create_transfer',
  deposit: 'create_deposit',
  withdraw: 'create_withdrawal',
  balance: 'get_account_balance',
  accounts: 'get_my_accounts',
  transactions: 'get_my_transactions',
  // Inverse of banking's own TOOL_NAME_TO_ACTION map. The heuristic action is the
  // alias — tagged heuristicOnly so it is never LLM-callable — and
  // get_sensitive_account_details is the real MCP tool.
  sensitive_account_details: 'get_sensitive_account_details',
  branch_hours: 'get_branch_hours',
  weather: 'get_weather',
  brave_search: 'brave_news_search',
  mortgage_demo: 'show_mortgage',
  gear_warranty_demo: 'show_gear_warranty',
  // Cross-vertical portfolio chip — always dispatches show_investment whatever the
  // active vertical is, so unlike vertical_feature_demo it needs no per-vertical
  // lookup. This is investment's UC33 chip.
  invest_demo: 'show_investment',
};

/**
 * Resolve a heuristic action to the tool actually dispatched.
 *
 * `vertical_feature_demo` is the ONE action whose tool depends on the vertical:
 * AIAgent.js dispatches that vertical's manifest featurePage.mcpTool, so the same
 * action means show_health_record in healthcare and show_permit in government.
 * Everything else is a flat lookup with an identity fallback (vertical plugin
 * actions ARE their tool names).
 */
function toolForAction(action, vertical = null) {
  if (action === 'vertical_feature_demo' && vertical && SECOND_PRODUCT_TOOL_BY_VERTICAL[vertical]) {
    return SECOND_PRODUCT_TOOL_BY_VERTICAL[vertical];
  }
  return ACTION_TO_TOOL[action] || action;
}

/**
 * Catalog expectedOutcome → agentPreflight decision string (or null if N/A).
 *
 * SCOPE: this map is ONLY about the amount-gate ladder on a transfer-like tool
 * (see amountGateExpectationsFor: DENY >= 2000, STEP_UP 500-1999.99, HITL < 500).
 * Do NOT add DENY_401 / DENY_403 / DENY_429 / DENY_503 here. Those are
 * transport- and authz-layer refusals on `attack`-trigger use cases with no
 * amount and no primaryTool; adding them would pull them into amount-band
 * assertions that cannot apply. For "is this outcome a refusal at all", use
 * DENIED_LIKE_OUTCOMES below.
 */
const OUTCOME_TO_GATE = {
  DENY: 'DENY',
  STEP_UP: 'STEP_UP',
  HITL_REQUIRED: 'HITL',
};

/**
 * Catalog expectedOutcome values that represent "blocked or challenged".
 * MIRROR of DENIED_LIKE_OUTCOMES in
 * demo_api_ui/src/context/ProofOfEnforcementContext.js — the two are kept equal
 * by src/__tests__/deniedLikeOutcomes.parity.test.js. Scoring a refusal as a
 * success (or vice versa) is the failure this exists to prevent.
 */
const DENIED_LIKE_OUTCOMES = new Set([
  'DENY', 'DENY_401', 'DENY_403', 'DENY_429', 'DENY_503', 'STEP_UP', 'HITL_REQUIRED',
]);

/**
 * Which block kind each deny-like expectedOutcome demands. Comparing families
 * rather than "not PERMIT" is what stops a use case advertising a hard DENY
 * from going green on an approval gate. MIRROR of EXPECTED_OUTCOME_FAMILY in
 * ProofOfEnforcementContext.js (same parity test).
 */
const EXPECTED_OUTCOME_FAMILY = {
  DENY: 'DENY', DENY_401: 'DENY', DENY_403: 'DENY', DENY_429: 'DENY', DENY_503: 'DENY',
  STEP_UP: 'STEP_UP', HITL_REQUIRED: 'HITL_REQUIRED',
};

/**
 * Whether the catalog expects this run to be refused.
 * @param {string|null|undefined} expectedOutcome
 * @returns {boolean}
 */
function isDeniedLikeOutcome(expectedOutcome) {
  return DENIED_LIKE_OUTCOMES.has(String(expectedOutcome));
}

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
function normalizeParsedIntent(parsed, vertical = null) {
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

  const tool = toolForAction(action, vertical);
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
    // deniedLike/outcomeFamily answer "is a refusal expected, and of what kind"
    // for every deny-like outcome — including the DENY_401/403/429/503 attack
    // cases that `gate` deliberately excludes (see OUTCOME_TO_GATE's scope note).
    deniedLike: isDeniedLikeOutcome(uc.expectedOutcome),
    outcomeFamily: EXPECTED_OUTCOME_FAMILY[uc.expectedOutcome] || null,
    amount: amount != null && Number.isFinite(amount) ? amount : null,
  };
}

/** Primary tool used for amount-gated transfers per vertical. */
const GATE_TOOL_FOR_VERTICAL = {
  banking: 'create_transfer',
  healthcare: 'pay_bill',
};

/**
 * Works-maturity chips for a vertical that are heuristic-routable.
 * @param {string} vertical
 * @returns {ReturnType<typeof expectationFromUseCase>[]}
 */
function worksChipExpectationsFor(vertical) {
  const out = [];
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, vertical) || u;
    if (uc.maturity !== 'works') continue;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text) continue;
    if (/specialist/i.test(t.text)) continue;
    // Same class as the specialist exclusion: the (always-on) A2A overlay's
    // mismatch heuristic intercepts these phrases before tool routing, so the
    // parse yields the overlay action, not the catalog primaryTool (UC2.6).
    if (/\bagent\s+(identity\s+)?mismatch\b|\bunregistered\s+agent\b/i.test(t.text)) continue;
    if (!uc.primaryTool) continue;
    out.push(expectationFromUseCase(uc));
  }
  return out;
}

/**
 * Amount-gated chips for a vertical whose catalog expectedOutcome matches the
 * amount tier (DENY >=2000, STEP_UP 500-1999.99, HITL below 500).
 * Derives the gate tool from UC6's primaryTool so it works for any vertical.
 * @param {string} vertical
 */
function amountGateExpectationsFor(vertical) {
  const all = worksChipExpectationsFor(vertical);
  const uc6 = all.find((e) => e.id === 'UC6' && e.gate === 'DENY' && e.amount != null);
  const gateTool = uc6?.primaryTool || GATE_TOOL_FOR_VERTICAL[vertical] || 'create_transfer';
  return all.filter((e) => {
    if (!(e.gate && e.amount != null && e.primaryTool === gateTool)) return false;
    if (e.gate === 'DENY') return e.amount >= 2000;
    if (e.gate === 'STEP_UP') return e.amount >= 500 && e.amount < 2000;
    if (e.gate === 'HITL') return e.amount > 0 && e.amount < 500;
    return false;
  });
}

/**
 * Banking works-maturity chips that are heuristic-routable.
 * @returns {ReturnType<typeof expectationFromUseCase>[]}
 */
function bankingWorksChipExpectations() {
  return worksChipExpectationsFor('banking');
}

/**
 * Amount-gated transfer chips whose catalog expectedOutcome matches the
 * amount tier (DENY >=2000, STEP_UP 500-1999.99, HITL below 500). Excludes cases
 * like UC27 that reuse a $600 chip text for a different story (bypass).
 */
function bankingAmountGateExpectations() {
  return amountGateExpectationsFor('banking');
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

/**
 * Score UC1-style Demo Step invoke (`/api/agent/invoke` + forceHeuristic).
 * The ProofStrip needs user-token + token-exchange + authorize + tool dispatch.
 * A bare `/api/mcp/tool` check can pass while Demo Steps still Incomplete when
 * PingOne Authorize / gateway worker credentials are stale.
 *
 * @param {{ status?: number, body?: object }} invoke
 * @param {{ evidenceTokenChain?: string[] }} [opts]
 * @returns {{ ok: boolean, reason: string|null, matchedSteps: string[] }}
 */
function scoreDelegatedAccessInvoke(invoke, opts = {}) {
  const status = invoke?.status;
  const body = invoke?.body || {};
  const evidence = opts.evidenceTokenChain || [
    'user-token',
    'token-exchange',
    'authorize-decision',
    'tool-dispatched',
  ];

  if (status !== 200) {
    return { ok: false, reason: 'server_error', matchedSteps: [] };
  }
  if (body.success === false || body.error) {
    const blob = `${body.error || ''} ${body.reply || ''} ${body.message || ''}`;
    if (/mcp_authorize_unavailable|invalid_client|authorize_worker/i.test(blob)) {
      return { ok: false, reason: 'authorize_unavailable', matchedSteps: [] };
    }
    if (/access_denied|authorization_denied|mcp_authorization_denied/i.test(blob)) {
      return { ok: false, reason: 'authorize_denied', matchedSteps: [] };
    }
    return { ok: false, reason: 'invoke_failed', matchedSteps: [] };
  }
  if (!String(body.reply || '').trim()) {
    return { ok: false, reason: 'empty_reply', matchedSteps: [] };
  }

  const tokenEvents = Array.isArray(body.tokenEvents) ? body.tokenEvents : [];
  const seenIds = new Set(tokenEvents.map((e) => e && e.id).filter(Boolean));
  const hasExchange = tokenEvents.some((e) => e && e.exchangeStep != null);
  const hasAuthorize = !!(
    body.authorize
    || seenIds.has('authorize-decision')
    || gwAuthorizeEventFrom(tokenEvents)
  );
  const hasTool = Array.isArray(body.toolsCalled) && body.toolsCalled.length > 0;

  const matchedSteps = evidence.filter((step) => {
    if (step === 'user-token') return seenIds.has('user-token');
    if (step === 'token-exchange') return hasExchange;
    if (step === 'authorize-decision') return hasAuthorize;
    if (step === 'tool-dispatched') return hasTool;
    return seenIds.has(step);
  });
  const missing = evidence.filter((s) => !matchedSteps.includes(s));
  if (missing.length) {
    return { ok: false, reason: `missing_evidence:${missing.join(',')}`, matchedSteps };
  }

  const chain = scoreTokenChainDetail(tokenEvents);
  if (!chain.ok) {
    return { ok: false, reason: chain.reason || 'empty_token_events', matchedSteps };
  }

  return { ok: true, reason: null, matchedSteps };
}

/**
 * Score an attack-sim POST body (HTTP 200 envelope; teaching result in body.status /
 * body.errorCode / body.tokenChainEvents).
 *
 * Distinguishes:
 *   - teaching DENY (e.g. UC5 insufficient_scope + sim-gateway-deny) → PASS
 *   - infra exchange failure (invalid subject_token / exchange_failed) → FAIL
 *     with reason `exchange_failed` even when PingOne detail is present on the rail
 *   - blank Token Chain → FAIL (`empty_token_events` / `failure_without_detail`)
 *
 * @param {{ status?: number, body?: object }} res — fetch result (route always HTTP 200)
 * @param {{
 *   expectedErrorCode?: string,
 *   evidenceTokenChain?: string[],
 * }} [opts]
 * @returns {{ ok: boolean, reason: string|null, matchedSteps: string[] }}
 */
function scoreAttackSimDeny(res, opts = {}) {
  const http = res?.status;
  const body = res?.body || {};
  const expectedErrorCode = opts.expectedErrorCode || 'insufficient_scope';
  const evidence = opts.evidenceTokenChain || ['sim-exchange-ok', 'sim-gateway-deny'];

  // Route always returns HTTP 200 with the teaching status in the JSON body.
  if (http != null && http !== 200) {
    return { ok: false, reason: 'server_error', matchedSteps: [] };
  }
  if (body.error === 'unknown_sim' || body.error === 'feature_disabled' || body.error === 'not_available_in_production') {
    return { ok: false, reason: 'server_error', matchedSteps: [] };
  }
  if (body.errorCode === 'no_session_token') {
    return { ok: false, reason: 'missing_prereq', matchedSteps: [] };
  }

  const events = Array.isArray(body.tokenChainEvents)
    ? body.tokenChainEvents
    : (Array.isArray(body.tokenEvents) ? body.tokenEvents : []);
  const seenIds = new Set(events.map((e) => e && e.id).filter(Boolean));

  // Infra: preparatory RFC 8693 exchange failed (stale AT, wrong subject_token).
  // Never count this as the teaching DENY even if the rail now shows PingOne detail.
  const exchangeFailed = seenIds.has('sim-exchange-error') || seenIds.has('exchange-failed')
    || body.errorCode === 'exchange_failed'
    || /not a valid access token.*subject_token/i.test(String(body.reason || ''));
  if (exchangeFailed && !seenIds.has('sim-gateway-deny')) {
    const chain = scoreTokenChainDetail(events, { requireFailureEvent: true });
    return {
      ok: false,
      reason: chain.ok ? 'exchange_failed' : (chain.reason || 'exchange_failed'),
      matchedSteps: evidence.filter((id) => seenIds.has(id)),
    };
  }

  if (body.errorCode !== expectedErrorCode) {
    return {
      ok: false,
      reason: body.errorCode === 'unexpected_permit' ? 'wrong_gate' : 'wrong_gate',
      matchedSteps: evidence.filter((id) => seenIds.has(id)),
    };
  }

  const matchedSteps = evidence.filter((id) => seenIds.has(id));
  const missing = evidence.filter((id) => !matchedSteps.includes(id));
  if (missing.length) {
    return { ok: false, reason: `missing_evidence:${missing.join(',')}`, matchedSteps };
  }

  const chain = scoreTokenChainDetail(events, { requireFailureEvent: true });
  if (!chain.ok) {
    return { ok: false, reason: chain.reason || 'empty_token_events', matchedSteps };
  }

  return { ok: true, reason: null, matchedSteps };
}

/**
 * Token Summary event IDs required for a single-exchange delegated-access run.
 * The ProofStrip renders these three slots; "exchanged-token-fallback" covers
 * both the original-token and delegated-token slots when only one exchange fires.
 */
const TOKEN_SUMMARY_IDS_1EX = ['user-token', 'agent-actor-token', 'exchanged-token-fallback'];

/**
 * Token Summary event IDs required for a double-exchange (RFC 8693 chained)
 * delegated-access run.
 */
const TOKEN_SUMMARY_IDS_2EX = ['user-token', 'agent-actor-token', 'exchanged-token', 'two-ex-final-token'];

/**
 * Detect whether a token-event list represents a 1-exchange or 2-exchange flow.
 * @param {Array<object>} events
 * @returns {'1ex'|'2ex'}
 */
function detectTokenSummaryMode(events) {
  if (!Array.isArray(events)) return '2ex';
  const ids = new Set(events.map((e) => e && e.id).filter(Boolean));
  if (ids.has('exchanged-token-fallback')) return '1ex';
  return '2ex';
}

/**
 * Score Token Summary coverage for a run's token events.
 * @param {Array<object>} events
 * @returns {{ ok: boolean, reason: string|null, mode: string|null, present: string[], missing: string[] }}
 */
function scoreTokenSummaryCoverage(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, reason: 'empty_events', mode: null, present: [], missing: [] };
  }
  const mode = detectTokenSummaryMode(events);
  const required = mode === '1ex' ? TOKEN_SUMMARY_IDS_1EX : TOKEN_SUMMARY_IDS_2EX;
  const ids = new Set(events.map((e) => e && e.id).filter(Boolean));
  const present = required.filter((id) => ids.has(id));
  const missing = required.filter((id) => !ids.has(id));
  if (missing.length > 0) {
    return { ok: false, reason: 'missing_summary_tokens', mode, present, missing };
  }
  return { ok: true, reason: null, mode, present, missing: [] };
}

/** Account types that belong to the healthcare vertical (not banking). */
const HEALTHCARE_ACCOUNT_TYPES = new Set(['Primary Care', 'HSA', 'Deductible', 'FSA', 'HRA']);

/**
 * Verify that an account list is compatible with the banking vertical —
 * must contain a checking account and must not contain healthcare-only types.
 * @param {Array<{ accountType: string }>} accounts
 * @param {string} activeVertical
 * @returns {{ ok: boolean, reason: string|null, prereqErrors: string[], activeVertical: string }}
 */
function scoreBankingVerticalPrereq(accounts, activeVertical) {
  const prereqErrors = [];
  if (activeVertical !== 'banking') {
    prereqErrors.push(`active_vertical=${activeVertical} (expected banking)`);
  }
  const types = (accounts || []).map((a) => a && a.accountType).filter(Boolean);
  const hasChecking = types.some((t) => t.toLowerCase() === 'checking');
  if (!hasChecking) {
    prereqErrors.push('missing checking account (banking vertical requires checking+savings)');
  }
  const healthcareTypes = types.filter((t) => HEALTHCARE_ACCOUNT_TYPES.has(t));
  if (healthcareTypes.length > 0) {
    prereqErrors.push(`healthcare account types detected: ${healthcareTypes.join(', ')} — switch vertical to banking`);
  }
  const ok = prereqErrors.length === 0;
  return { ok, reason: ok ? null : 'missing_prereq', prereqErrors, activeVertical };
}

const GOLDENS_DIR = path.join(__dirname, '..', 'data', 'goldens');

/**
 * Load a captured golden reply for a use case from data/goldens/<vertical>/.
 * Matches by the `ucId` field stored in each golden file.
 * @param {string} vertical
 * @param {string} ucId — e.g. 'UC6', 'UC7', 'UC8'
 * @returns {{ reply: string, ucId: string, [key: string]: any }|null}
 */
function loadGoldenByUcId(vertical, ucId) {
  const dir = path.join(GOLDENS_DIR, vertical);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (data.ucId === ucId) return data;
    } catch {
      // skip malformed files
    }
  }
  return null;
}

/**
 * Score an agent reply against a golden (`exact`) or live-account (`grounded`) contract.
 *
 * - `exact`:    reply must equal expectedReply verbatim; reason `reply_mismatch` on failure.
 * - `grounded`: reply must contain at least one live account balance as a substring;
 *               reason `reply_ungrounded` on failure.
 *
 * @param {{ reply: string, style: 'exact'|'grounded', expectedReply?: string, liveAccounts?: Array<{ balance: number }> }} opts
 * @returns {{ ok: boolean, reason: string|null }}
 */
function scoreAgentReply({ reply, style, expectedReply, liveAccounts }) {
  if (style === 'exact') {
    const ok = reply === expectedReply;
    return { ok, reason: ok ? null : 'reply_mismatch' };
  }
  if (style === 'grounded') {
    if (!Array.isArray(liveAccounts) || liveAccounts.length === 0) {
      return { ok: false, reason: 'no_live_accounts' };
    }
    const replyStr = String(reply || '');
    const ok = liveAccounts.some(
      (acct) => acct.balance != null && replyStr.includes(String(acct.balance)),
    );
    return { ok, reason: ok ? null : 'reply_ungrounded' };
  }
  return { ok: false, reason: 'unknown_style' };
}

module.exports = {
  ACTION_TO_TOOL,
  toolForAction,
  OUTCOME_TO_GATE,
  DENIED_LIKE_OUTCOMES,
  EXPECTED_OUTCOME_FAMILY,
  isDeniedLikeOutcome,
  TOKEN_SUMMARY_IDS_1EX,
  TOKEN_SUMMARY_IDS_2EX,
  amountFromChipText,
  normalizeParsedIntent,
  expectationFromUseCase,
  bankingWorksChipExpectations,
  bankingAmountGateExpectations,
  scoreTokenChainDetail,
  scoreDelegatedAccessInvoke,
  scoreAttackSimDeny,
  detectTokenSummaryMode,
  scoreTokenSummaryCoverage,
  scoreBankingVerticalPrereq,
  loadGoldenByUcId,
  scoreAgentReply,
  worksChipExpectationsFor,
  amountGateExpectationsFor,
};
