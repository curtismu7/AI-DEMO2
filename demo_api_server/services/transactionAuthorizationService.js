/**
 * transactionAuthorizationService.js
 *
 * Single entry for transaction policy evaluation aligned with docs/PINGONE_AUTHORIZE_PLAN.md:
 * - **Simulated** (education): in-process, same Trust Framework parameter shape as Phase 2
 * - **PingOne Authorize**: decision endpoint (preferred) or legacy PDP
 *
 * Used by POST /api/transactions so behavior and HTTP shapes stay consistent between engines.
 *
 * ## Failover mode (F6)
 * When the PingOne Authorize engine is unreachable (network error, 5xx), the service
 * applies the configured failover policy rather than propagating a raw error:
 *
 *   authorize_failover_mode = 'fallback_simulated' (default)
 *     → Switch to in-process simulated engine. Demo continues; policy gates still enforced.
 *   authorize_failover_mode = 'deny'
 *     → Return 503 — block all transactions when live policy is unavailable (fail-closed).
 *   authorize_failover_mode = 'permit'
 *     → Allow transaction with a warning log (fail-open). Weakest posture.
 *
 * Legacy: ff_authorize_fail_open=true is treated as authorize_failover_mode=permit.
 */

'use strict';

const configStore = require('./configStore');
const pingOneAuthorizeService = require('./pingOneAuthorizeService');
const simulatedAuthorizeService = require('./simulatedAuthorizeService');
const { logEvent, EVENT_CATEGORIES } = require('./appEventService');
const { buildChallengeHeader } = require('./rfc9470');

/**
 * Build 428/403 bodies shared between engines (Feature Flags + Config labels).
 */
function buildStepUpBody({ useSimulated, policyId, runtimeSettings }) {
  const STEP_UP_ACR = runtimeSettings.get('stepUpAcrValue');
  const stepUpMethod = configStore.getEffective('step_up_method') || runtimeSettings.get('stepUpMethod') || 'ciba';
  return {
    error: 'step_up_required',
    hitl: { type: 'step_up' },
    error_description: useSimulated
      ? 'This transaction requires additional authentication (MFA) as required by the simulated authorization policy (education mode).'
      : 'This transaction requires additional authentication (MFA) as required by the authorization policy.',
    step_up_acr: STEP_UP_ACR,
    step_up_method: stepUpMethod,
    step_up_url: '/api/auth/oauth/user/stepup',
    authorize_policy_id: policyId || undefined,
    authorize_engine: useSimulated ? 'simulated' : 'pingone',
  };
}

/**
 * Wrap the step-up body in a transport block — the RFC 9470 mode switch.
 * ff_rfc9470_challenge ON (default): RFC 9470 — 401 + WWW-Authenticate
 * insufficient_user_authentication challenge. Explicitly OFF ('false'):
 * legacy 428 + JSON body (RFC 6585 demo format) — default-ON check style
 * matches ff_hitl_enabled.
 * The JSON body is kept in BOTH modes (step_up_url / step_up_method are demo
 * conveniences); in RFC mode the header is the normative signal clients parse.
 */
function buildStepUpBlock({ useSimulated, policyId, runtimeSettings, extra = {} }) {
  const body = { ...buildStepUpBody({ useSimulated, policyId, runtimeSettings }), ...extra };
  if (configStore.getEffective('ff_rfc9470_challenge') === 'false') {
    return { status: 428, body };
  }
  const maxAge = parseFloat(runtimeSettings.get('stepUpMaxAge')) || 0;
  return {
    status: 401,
    headers: {
      'WWW-Authenticate': buildChallengeHeader({
        acrValues: [runtimeSettings.get('stepUpAcrValue')],
        maxAge,
        errorDescription: 'A different authentication level is required',
      }),
    },
    body,
  };
}

function buildConsentBody() {
  return {
    error: 'hitl_required',
    hitl: { type: 'consent' },
    error_description: 'This transaction requires explicit human approval. Create a consent challenge first.',
  };
}

function buildDenyBody({ useSimulated, policyId }) {
  return {
    error: 'transaction_denied',
    error_description: useSimulated
      ? 'This transaction was denied by the simulated authorization policy (education mode). See server logs for rule details.'
      : 'This transaction was denied by the authorization policy.',
    authorize_policy_id: policyId || undefined,
    authorize_engine: useSimulated ? 'simulated' : 'pingone',
  };
}

/**
 * Run PingOne Authorize or simulated policy when enabled. Admin users skip entirely.
 *
 * @param {object} opts
 * @param {object} opts.runtimeSettings - runtimeSettings module
 * @param {string} opts.userRole
 * @param {string} opts.userId
 * @param {number} opts.amount
 * @param {string} opts.type
 * @param {string} [opts.acr]
 * @returns {Promise<
 *   | { ran: false, reason: string }
 *   | { ran: true, permit: true, evaluation: object }
 *   | { ran: true, block: { status: number, body: object } }
 *   | { ran: true, simulatedError: Error }
 *   | { ran: true, pingoneError: Error }
 * >}
 */
async function evaluateTransactionPolicy({
  runtimeSettings,
  userRole,
  userId,
  amount,
  type,
  acr,
  useCaseId,
}) {
  // Authorization is ALWAYS ENABLED for security — no ff to disable it.
  // Either use simulated Authorize (education) or live PingOne (when configured).
  const USE_SIMULATED = simulatedAuthorizeService.isSimulatedModeEnabled(configStore);
  const AUTHORIZE_ENABLED = true;
  const AUTHORIZE_DEPOSITS = configStore.get('ff_authorize_deposits') === 'true';
  const AUTHORIZE_DECISION_ENDPOINT_ID = configStore.get('authorize_decision_endpoint_id');
  const AUTHORIZE_POLICY_ID =
    configStore.get('authorize_policy_id') || runtimeSettings.get('authorizePolicyId');

  const AUTHORIZE_TYPES = AUTHORIZE_DEPOSITS
    ? ['transfer', 'withdrawal', 'deposit']
    : ['transfer', 'withdrawal'];

  const PINGONE_READY = !!(AUTHORIZE_DECISION_ENDPOINT_ID || AUTHORIZE_POLICY_ID);
  if (!AUTHORIZE_ENABLED) {
    return { ran: false, reason: 'authorize_disabled' };
  }
  if (userRole === 'admin') {
    return { ran: false, reason: 'admin_role_exempt' };
  }
  if (!AUTHORIZE_TYPES.includes(type)) {
    return { ran: false, reason: 'type_not_in_scope' };
  }

  // Live PingOne selected but no decision endpoint/policy is configured. Honor
  // the failover policy instead of silently skipping the gate (which would let
  // an unconfigured install run UNGATED — the opposite of "PingOne-only"):
  //   deny (strict, default)  → fail CLOSED (503)
  //   fallback_simulated      → evaluate with the in-process simulated engine
  //   permit (legacy)         → skip (fail open, explicit opt-in)
  let runSimulated = USE_SIMULATED;
  if (!USE_SIMULATED && !PINGONE_READY) {
    const { failoverMode } = simulatedAuthorizeService.resolveAuthorizeMode(configStore);
    if (failoverMode === 'deny') {
      logEvent(EVENT_CATEGORIES.AUTHORIZE, 'error',
        '[Authorize] PingOne-only but not configured — failing closed (deny)',
        { tag: 'authorize/not-configured-deny', metadata: { type, amount, userId } });
      return {
        ran: true,
        block: {
          status: 503,
          body: {
            error: 'authorization_service_unavailable',
            error_description:
              'PingOne Authorize is not configured (no decision endpoint) and failover is deny — transactions are blocked.',
            failover_mode: 'deny',
            authorizeFallback: simulatedAuthorizeService.buildAuthorizeFallbackSignal(
              'deny', new Error('not_configured'), 'transaction'),
          },
        },
      };
    }
    if (failoverMode === 'fallback_simulated') {
      runSimulated = true; // evaluate via the simulated engine below
    } else {
      return { ran: false, reason: 'not_configured' };
    }
  }

  try {
    if (runSimulated) {
      const r = await simulatedAuthorizeService.evaluateTransaction({
        userId,
        amount,
        type,
        acr,
      });

      logEvent(EVENT_CATEGORIES.AUTHORIZE, 'info',
        `Authorize simulated — ${type} $${amount} — decision=${r.decision} consent=${r.consentRequired} stepUp=${r.stepUpRequired}`,
        { tag: 'authorize/simulated-result', metadata: { type, amount, userId, decision: r.decision, consentRequired: r.consentRequired, stepUpRequired: r.stepUpRequired, ...(useCaseId ? { useCaseId } : {}) } });

      // Check stepUpRequired before consentRequired: step-up is the stronger gate
      // and must not be bypassed by the ff_hitl_enabled=false consent-skip path.
      // A $600 transfer satisfies both thresholds; step-up takes priority.
      if (r.stepUpRequired) {
        return {
          ran: true,
          block: buildStepUpBlock({
            useSimulated: true,
            policyId: AUTHORIZE_POLICY_ID,
            runtimeSettings,
          }),
        };
      }

      if (r.consentRequired) {
        logEvent(EVENT_CATEGORIES.HITL, 'info',
          `HITL consent required — ${type} $${amount}`,
          { tag: 'hitl/consent-required-authz', metadata: { type, amount, userId, ...(useCaseId ? { useCaseId } : {}) } });
        return { ran: true, block: { status: 428, body: buildConsentBody() } };
      }

      if (r.decision === 'DENY') {
        return {
          ran: true,
          block: { status: 403, body: buildDenyBody({ useSimulated: true, policyId: AUTHORIZE_POLICY_ID }) },
        };
      }

      return {
        ran: true,
        permit: true,
        evaluation: {
          engine: 'simulated',
          decision: r.decision,
          path: r.path,
          decisionId: r.decisionId,
          parameters: r.raw?.parameters || null,
        },
      };
    }

    const r = await pingOneAuthorizeService.evaluateTransaction({
      decisionEndpointId: AUTHORIZE_DECISION_ENDPOINT_ID,
      policyId: AUTHORIZE_POLICY_ID,
      userId,
      amount,
      type,
      acr,
    });

    // Policy not found: P1AZ evaluated fine but no policy matched — code/policy
    // drift, not a deny and not an outage, so no failover applies. Block and
    // tell the operator exactly what is wrong. Read the side-channel flag:
    // _normalizeDecision stays fail-closed (DENY), so r.decision is never
    // 'NOT_APPLICABLE'.
    if (r.policyNotFound) {
      logEvent(EVENT_CATEGORIES.AUTHORIZE, 'error',
        '[Authorize] NOT_APPLICABLE — no PingOne policy matched this request (code/policy drift)',
        { tag: 'authorize/policy-not-found', metadata: { type, amount, userId, ...(useCaseId ? { useCaseId } : {}) } });
      return {
        ran: true,
        block: {
          status: 503,
          body: {
            error: 'policy_not_found',
            error_description: 'Policy not found, please contact administrator.',
            authorize_engine: 'pingone',
            authorize_policy_id: AUTHORIZE_DECISION_ENDPOINT_ID || AUTHORIZE_POLICY_ID,
          },
        },
      };
    }

    // Check stepUpRequired before consentRequired (parity with the simulated
    // branch above): step-up is the stronger gate and must not be bypassed by
    // satisfying the weaker consent flow when a transaction trips both thresholds.
    if (r.stepUpRequired) {
      return {
        ran: true,
        block: buildStepUpBlock({
          useSimulated: false,
          policyId: AUTHORIZE_POLICY_ID,
          runtimeSettings,
        }),
      };
    }

    if (r.consentRequired) {
      return { ran: true, block: { status: 428, body: buildConsentBody() } };
    }

    // Engine evaluated OK but no policy matched (drift). Fail closed with a clear
    // operator-facing message instead of a generic deny. Success response →
    // failover does not apply (amendment §A).
    if (r.policyNotFound) {
      return {
        ran: true,
        block: { status: 403, body: simulatedAuthorizeService.buildPolicyNotFoundBody('transaction') },
      };
    }

    if (r.decision === 'DENY') {
      return {
        ran: true,
        block: { status: 403, body: buildDenyBody({ useSimulated: false, policyId: AUTHORIZE_POLICY_ID }) },
      };
    }

    return {
      ran: true,
      permit: true,
      evaluation: {
        engine: 'pingone',
        decision: r.decision,
        path: r.path,
        decisionId: r.decisionId,
        authorizeRef: AUTHORIZE_DECISION_ENDPOINT_ID || AUTHORIZE_POLICY_ID,
      },
    };
  } catch (err) {
    if (USE_SIMULATED) {
      // Simulated engine failure is unexpected — propagate as-is (simulated never calls network).
      return { ran: true, simulatedError: err };
    }

    // PingOne engine failure — apply the configured failover policy (F6).
    // failoverMode is derived from authorize_mode (single source of truth):
    //   'pingone'                    → 'deny'              (P1 only, no demo fallback)
    //   'pingone_fallback_simulated' → 'fallback_simulated'
    // When authorize_mode is unset, this falls back to the legacy
    // ff_authorize_fail_open / authorize_failover_mode flags. See
    // simulatedAuthorizeService.resolveAuthorizeMode().
    const { failoverMode } = simulatedAuthorizeService.resolveAuthorizeMode(configStore);

    logEvent(EVENT_CATEGORIES.AUTHORIZE, 'error',
      `[Authorize] PingOne unreachable — failover_mode=${failoverMode}: ${err.message}`,
      { tag: 'authorize/failover', metadata: { failoverMode, error: err.message, type, amount, userId, ...(useCaseId ? { useCaseId } : {}) } });

    // Structured signal for the debug "PingOne fell back" modal. Surfaced on the
    // transaction response (success or block body) so the UI can tell the user
    // the live PingOne call genuinely failed and what the failover policy did.
    const authorizeFallback = simulatedAuthorizeService.buildAuthorizeFallbackSignal(
      failoverMode, err, 'transaction',
      err.code === 'policy_not_found' ? { reason: 'policy_not_found' }
        : err.code === 'authorize_circuit_open' ? { reason: 'circuit_open' } : {});

    if (failoverMode === 'permit') {
      // Fail-open: allow the transaction and log prominently.
      logEvent(EVENT_CATEGORIES.AUTHORIZE, 'warning',
        `[Authorize] FAIL-OPEN — transaction permitted without policy evaluation (failover_mode=permit)`,
        { tag: 'authorize/fail-open', metadata: { type, amount, userId, ...(useCaseId ? { useCaseId } : {}) } });
      return {
        ran: true,
        permit: true,
        evaluation: {
          engine: 'failover',
          decision: 'PERMIT',
          path: 'failover',
          failoverMode: 'permit',
          note: 'PingOne Authorize unreachable — permitted by failover policy',
          authorizeFallback,
        },
      };
    }

    if (failoverMode === 'deny') {
      // A missing decision endpoint (404) is a config bug, not an outage —
      // name it so the operator fixes P1AZ instead of waiting out an "outage".
      if (err.code === 'policy_not_found') {
        return {
          ran: true,
          block: {
            status: 503,
            body: {
              error: 'policy_not_found',
              error_description: 'Policy not found, please contact administrator.',
              failover_mode: 'deny',
              authorizeFallback,
            },
          },
        };
      }
      // Fail-closed: block all transactions when live policy is unavailable.
      return {
        ran: true,
        block: {
          status: 503,
          body: {
            error: 'authorization_service_unavailable',
            error_description:
              'The authorization service is temporarily unavailable. Transactions are blocked (failover mode: deny). Please try again shortly.',
            failover_mode: 'deny',
            authorizeFallback,
          },
        },
      };
    }

    // failoverMode === 'fallback_simulated' (default): run simulated engine.
    // This keeps the demo running and still enforces policy gates.
    try {
      const fallback = await simulatedAuthorizeService.evaluateTransaction({ userId, amount, type, acr });

      logEvent(EVENT_CATEGORIES.AUTHORIZE, 'warning',
        `[Authorize] Fell back to simulated engine — ${type} $${amount} — decision=${fallback.decision}`,
        { tag: 'authorize/fallback-simulated', metadata: { type, amount, userId, decision: fallback.decision, ...(useCaseId ? { useCaseId } : {}) } });

      if (fallback.stepUpRequired) {
        return {
          ran: true,
          block: buildStepUpBlock({
            useSimulated: true,
            policyId: AUTHORIZE_POLICY_ID,
            runtimeSettings,
            extra: { authorizeFallback },
          }),
        };
      }
      if (fallback.consentRequired) {
        return { ran: true, block: { status: 428, body: { ...buildConsentBody(), authorizeFallback } } };
      }
      if (fallback.decision === 'DENY') {
        return {
          ran: true,
          block: { status: 403, body: { ...buildDenyBody({ useSimulated: true, policyId: AUTHORIZE_POLICY_ID }), authorizeFallback } },
        };
      }
      return {
        ran: true,
        permit: true,
        evaluation: {
          engine: 'fallback_simulated',
          decision: fallback.decision,
          path: fallback.path,
          decisionId: fallback.decisionId,
          note: 'PingOne Authorize unreachable — evaluated by fallback simulated engine',
          authorizeFallback,
        },
      };
    } catch (fallbackErr) {
      // Even the fallback failed (should never happen) — hard deny.
      logEvent(EVENT_CATEGORIES.AUTHORIZE, 'error',
        `[Authorize] Fallback simulated engine also failed: ${fallbackErr.message}`,
        { tag: 'authorize/fallback-error', metadata: { type, amount, userId, ...(useCaseId ? { useCaseId } : {}) } });
      return {
        ran: true,
        block: {
          status: 503,
          body: {
            error: 'authorization_service_unavailable',
            error_description: 'Authorization evaluation failed. Please try again.',
          },
        },
      };
    }
  }
}

/**
 * Public read model for admin / education UIs (no secrets).
 */
function getAuthorizationStatusSummary() {
  // Prefer getEffective (env-aware) but fall back to get — some callers/tests
  // inject a minimal configStore without getEffective.
  const eff = (k) => (configStore.getEffective ? configStore.getEffective(k) : configStore.get(k));
  const { mode, useSimulated: USE_SIMULATED } = simulatedAuthorizeService.resolveAuthorizeMode(configStore);
  // env-aware so an endpoint/policy supplied only via .env
  // (PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID) counts — the same source the
  // PingOne engine actually reads via _getCredentials().
  const decisionEndpointId = eff('authorize_decision_endpoint_id');
  const policyId = eff('authorize_policy_id');
  const pingoneConfigured = pingOneAuthorizeService.isConfigured();

  // Authorization is always-on in this demo (evaluateTransactionPolicy hardcodes
  // AUTHORIZE_ENABLED=true). The steady-state config leaves authorize_mode UNSET
  // and lets ff_authorize_simulated drive the engine, so we must NOT gate
  // "enabled" on an explicit authorize_mode — otherwise the FF-derived steady
  // state would report activeEngine='off'. Treat it enabled when an engine will
  // actually run: explicit mode, legacy flag, simulated engine, or PingOne ready.
  const explicitMode = String(eff('authorize_mode') || '').trim();
  const modeIsExplicit = simulatedAuthorizeService.AUTHORIZE_MODES.includes(explicitMode);
  const legacyEnabled =
    (configStore.get('authorize_enabled') === 'true' || configStore.get('authorize_enabled') === true);
  const hasDecision = !!(decisionEndpointId && String(decisionEndpointId).trim());
  const hasPolicy = !!(policyId && String(policyId).trim());
  // "Enabled" means an engine will actually run: an explicit mode, the legacy
  // flag, the always-gating simulated engine, OR live PingOne that is BOTH
  // configured AND has a decision endpoint/policy (worker creds alone aren't
  // enough — without an endpoint the live engine can't decide).
  const authorizeEnabled =
    modeIsExplicit || legacyEnabled || USE_SIMULATED || (pingoneConfigured && (hasDecision || hasPolicy));
  let activeEngine = 'off';
  if (!authorizeEnabled) {
    activeEngine = 'off';
  } else if (USE_SIMULATED) {
    activeEngine = 'simulated';
  } else if (pingoneConfigured && (hasDecision || hasPolicy)) {
    activeEngine = 'pingone';
  } else {
    activeEngine = 'pending_config';
  }

  return {
    authorizeEnabledConfig: authorizeEnabled,
    authorizeMode: mode,
    simulatedMode: USE_SIMULATED,
    pingoneConfigured,
    hasDecisionEndpointId: hasDecision,
    hasPolicyId: hasPolicy,
    activeEngine,
  };
}

module.exports = {
  evaluateTransactionPolicy,
  getAuthorizationStatusSummary,
};
