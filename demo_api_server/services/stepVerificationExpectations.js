// demo_api_server/services/stepVerificationExpectations.js
'use strict';

/**
 * Derive verifiable expectations from the use-case catalog.
 * Drive step-verification off expectedOutcome + chip text + match — not a
 * parallel hand-maintained matrix.
 */

const fs = require('fs');
const path = require('path');
const { USE_CASES, resolveUseCase } = require('../config/useCases.js');

const GOLDENS_ROOT = path.resolve(__dirname, '..', 'data', 'goldens');

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
 * Banking amount-gate chips need checking/savings. Healthcare leftovers
 * (Primary Care / HSA) fail before DENY/STEP_UP/HITL and must ledger as
 * missing_prereq — never as wrong_gate.
 *
 * @param {Array<{ accountType?: string, type?: string }>|null|undefined} accounts
 * @param {string|null|undefined} activeVerticalId from GET /api/verticals/me
 * @returns {{
 *   ok: boolean,
 *   reason: string|null,
 *   activeVertical: string|null,
 *   accountTypes: string[],
 *   prereqErrors: string[],
 * }}
 */
function scoreBankingVerticalPrereq(accounts, activeVerticalId) {
  const types = (Array.isArray(accounts) ? accounts : [])
    .map((a) => String(a?.accountType || a?.type || '').toLowerCase())
    .filter(Boolean);
  const activeVertical = activeVerticalId ? String(activeVerticalId) : null;
  const prereqErrors = [];

  if (activeVertical && activeVertical !== 'banking') {
    prereqErrors.push(`active_vertical=${activeVertical} (want banking)`);
  }
  const hasChecking = types.some((t) => t === 'checking');
  const hasSavings = types.some((t) => t === 'savings');
  if (!hasChecking) prereqErrors.push('missing checking account');
  if (!hasSavings) prereqErrors.push('missing savings account');
  if (types.some((t) => t.includes('primary care') || t === 'hsa' || t.includes('hsa'))) {
    prereqErrors.push(`healthcare account types present: ${types.join(', ')}`);
  }

  if (prereqErrors.length) {
    return {
      ok: false,
      reason: 'missing_prereq',
      activeVertical,
      accountTypes: types,
      prereqErrors,
    };
  }
  return {
    ok: true,
    reason: null,
    activeVertical: activeVertical || 'banking',
    accountTypes: types,
    prereqErrors: [],
  };
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
 * Load a banking (or other vertical) golden by catalog UC id (`ucId` or useCaseId).
 * @param {string} vertical
 * @param {string} ucId
 * @returns {object|null}
 */
function loadGoldenByUcId(vertical, ucId) {
  if (!vertical || !ucId) return null;
  const dir = path.join(GOLDENS_ROOT, vertical);
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const g = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (g.ucId === ucId || g.useCaseId === ucId) return g;
    } catch (_) {
      /* skip malformed */
    }
  }
  return null;
}

/**
 * Hybrid agent-reply check (step-verification check 4 — narration contract):
 * - `exact`: gate education strings must match the golden `reply` verbatim
 * - `grounded`: read replies must contain at least one live account balance
 *
 * @param {{
 *   reply: string|null|undefined,
 *   style: 'exact'|'grounded',
 *   expectedReply?: string|null,
 *   liveAccounts?: Array<{ balance?: number|string }>,
 * }} opts
 * @returns {{ ok: boolean, reason: string|null }}
 */
function scoreAgentReply({ reply, style, expectedReply = null, liveAccounts = null } = {}) {
  const text = typeof reply === 'string' ? reply : (reply == null ? '' : String(reply));
  if (!text.trim()) {
    return { ok: false, reason: 'empty_reply' };
  }

  if (style === 'exact') {
    if (expectedReply == null || String(expectedReply).trim() === '') {
      return { ok: false, reason: 'missing_expected_reply' };
    }
    if (text.trim() !== String(expectedReply).trim()) {
      return { ok: false, reason: 'reply_mismatch' };
    }
    return { ok: true, reason: null };
  }

  if (style === 'grounded') {
    const accounts = Array.isArray(liveAccounts) ? liveAccounts : [];
    if (accounts.length === 0) {
      return { ok: false, reason: 'no_live_accounts' };
    }
    const grounded = accounts.some((a) => {
      if (a == null || a.balance == null || a.balance === '') return false;
      return text.includes(String(a.balance));
    });
    if (!grounded) {
      return { ok: false, reason: 'reply_ungrounded' };
    }
    return { ok: true, reason: null };
  }

  return { ok: false, reason: 'unknown_reply_style' };
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
    || seenIds.has('gw-authorize')
    || seenIds.has('authorize-decision')
    || tokenEvents.some((e) => e && (e.decision === 'PERMIT' || e.id === 'gw-authorize'))
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

module.exports = {
  OUTCOME_TO_GATE,
  GOLDENS_ROOT,
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
  loadGoldenByUcId,
  scoreAgentReply,
  detectTokenSummaryMode,
  scoreTokenSummaryCoverage,
  scoreBankingVerticalPrereq,
};
