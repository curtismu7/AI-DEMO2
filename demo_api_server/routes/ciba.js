'use strict';

/**
 * routes/ciba.js — CIBA (Client-Initiated Backchannel Authentication) routes
 *
 * POST /api/auth/ciba/initiate
 *   Starts a backchannel auth request for the current session user.
 *   Returns { auth_req_id, expires_in, interval } — the browser uses these
 *   to display a "waiting for approval" UI and to start polling.
 *
 * GET  /api/auth/ciba/poll/:authReqId
 *   Single poll — returns { status: 'pending' | 'approved' | 'denied' }.
 *   When approved, tokens are stored in the server-side session (Backend-for-Frontend (BFF) pattern)
 *   and never sent to the browser.
 *
 * GET  /api/auth/ciba/status
 *   Returns whether CIBA is enabled and the delivery mode.
 *
 * POST /api/auth/ciba/notify
 *   Ping-mode callback: PingOne calls this when the user approves.
 *   Marks the auth_req_id as approved in the session store.
 *
 * POST /api/auth/ciba/cancel/:authReqId
 *   Allows the browser to cancel a pending CIBA request.
 */

const express = require('express');
const router  = express.Router();
const cibaService = require('../services/cibaService');
const cibaSimulatedService = require('../services/cibaSimulatedService');
const delegationService = require('../services/delegationService');
const { authenticateToken } = require('../middleware/auth');
const configStore = require('../services/configStore');
const { PINGONE_OIDC_DEFAULT_SCOPES_SPACE } = require('../config/scopes');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');
const { trackTokenEvent } = require('../services/tokenChainService');

const STEP_UP_TTL_MS = 5 * 60 * 1000; // 5 min step-up validity

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _cibaEnabled(res) {
  if (!cibaService.isEnabled()) {
    res.status(503).json({
      error: 'ciba_disabled',
      message: 'CIBA is not enabled. Set CIBA_ENABLED=true in your environment.',
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /api/auth/ciba/status  — public, no auth needed
// ---------------------------------------------------------------------------

router.get('/status', (req, res) => {
  const failoverMode = configStore.getEffective('ciba_failover_mode') || 'fallback_simulated';
  res.json({
    enabled:      cibaService.isEnabled(),
    deliveryMode: configStore.getEffective('ciba_token_delivery_mode') || 'poll',
    bindingMessage: configStore.getEffective('ciba_binding_message') || 'Banking App Authentication',
    engine: cibaService.isEnabled() ? 'pingone' : 'unavailable',
    failoverMode,
    // Show PingOne admin steps needed if not enabled
    setupRequired: !cibaService.isEnabled(),
    setupSteps: !cibaService.isEnabled() ? [
      'Set CIBA_ENABLED=true in your environment',
      'Enable the CIBA grant type on your PingOne application',
      'Configure DaVinci: email-only CIBA needs no MFA push; push path needs MFA policy + registered device',
    ] : [],
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/ciba/initiate — requires existing session
// ---------------------------------------------------------------------------

/**
 * Initiate a CIBA (Client-Initiated Backchannel Authentication) request for human approval.
 * Client initiates a transfer that requires human review via separate device or email.
 *
 * Body: {
 *   scope?:           default includes offline_access when omitted (PingOne must allow it for refresh_token)
 *   binding_message?: 'Approve $500 transfer'   — shown in email or push (PingOne / DaVinci)
 *   acr_values?:      'Multi_factor'             — for step-up auth
 *   login_hint?:      'user@example.com'         — override from session email
 * }
 *
 * @flow ciba-hitl
 * @name CIBA / HITL
 * @actor client-app
 * @to human-approver
 * @step 1
 */
router.post('/initiate', authenticateToken, async (req, res) => {
  if (!_cibaEnabled(res)) return;

  // Accept both snake_case (canonical, used by CIBAPanel) and camelCase
  // (used by the UserDashboard transfer step-up bridge). Normalizing here is
  // what makes the live transfer -> CIBA path work; see the `ciba` skill.
  const field = (snakeKey, camelKey) => req.body[snakeKey] ?? req.body[camelKey];

  const loginHint = field('login_hint', 'loginHint')
    || req.user?.email
    || req.session?.user?.email;

  if (!loginHint) {
    return res.status(400).json({
      error: 'missing_login_hint',
      message: 'User email is required to initiate CIBA. Ensure the user is logged in with an email claim.',
    });
  }

  const scope = req.body.scope;
  const acr_values = field('acr_values', 'acrValues') || '';
  let binding_message = field('binding_message', 'bindingMessage');

  // Optional transaction-display context (UC22's separate-device approval
  // page). Purely additive — no validation beyond type coercion, since
  // these only ever populate a display string, never a policy decision.
  const amount = req.body.amount != null ? Number(req.body.amount) : null;
  const fromAccountLabel = field('from_account_label', 'fromAccountLabel') || null;
  const toAccountLabel = field('to_account_label', 'toAccountLabel') || null;

  // Validate binding_message length and content (prevents log injection / oversized payloads)
  if (binding_message !== undefined) {
    if (typeof binding_message !== 'string') {
      return res.status(400).json({ error: 'invalid_binding_message', message: 'binding_message must be a string.' });
    }
    if (binding_message.length > 256) {
      return res.status(400).json({ error: 'invalid_binding_message', message: 'binding_message must not exceed 256 characters.' });
    }
    // Strip control characters (log injection prevention)
    binding_message = binding_message.replace(/[\x00-\x1f\x7f]/g, '');
  }

  let result;
  let simulated = false;
  try {
    result = await cibaService.initiateBackchannelAuth(
      loginHint,
      binding_message,
      scope || PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      acr_values,
    );
  } catch (realErr) {
    // Failover: PingOne's /as/bc-authorize can be unreachable OR entirely
    // unrouted at the platform level (see the "Known gap" note in the ciba
    // skill doc) — either way, fall back to the in-process simulated engine
    // by default so the demo stays usable. Set ciba_failover_mode=deny to
    // restore the old fail-loud behavior.
    const failoverMode = configStore.getEffective('ciba_failover_mode') || 'fallback_simulated';
    if (failoverMode !== 'fallback_simulated') {
      console.error('[CIBA] initiate failed:', realErr.response?.data || realErr.message);
      const pingError = realErr.response?.data;
      return res.status(502).json({
        error:   pingError?.error || 'ciba_initiation_failed',
        message: pingError?.error_description || realErr.message,
      });
    }
    result = cibaSimulatedService.initiateSimulated(
      loginHint,
      binding_message,
      scope || PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      acr_values,
    );
    simulated = true;
  }

  // Manager-as-approver: if the acting user is a workforce employee with an
  // active manager delegation carrying create_transfer scope, this becomes a
  // second-principal approval flow — the manager approves via their own
  // session on /delegation, not via this CIBA channel. Any lookup failure
  // falls through to today's plain self-approval behavior, unchanged.
  let delegationId = null;
  try {
    const activeDelegation = await delegationService.findActiveByDelegate(req.user?.id);
    if (activeDelegation) {
      delegationId = activeDelegation.id;
      await delegationService.requestApproval(delegationId, {
        authReqId: result.auth_req_id,
        amount,
        tool: req.body.tool || null,
        bindingMessage: binding_message || '',
      });
    }
  } catch (delegErr) {
    console.warn('[CIBA] manager-approval delegation lookup failed (continuing as self-approval):', delegErr.message);
  }

  try {
    // Track in session so poll endpoint can verify ownership
    req.session.cibaRequests = req.session.cibaRequests || {};

    // Enforce one-at-a-time: cancel any existing pending request
    req.session.cibaRequests = Object.fromEntries(
      Object.entries(req.session.cibaRequests).filter(
        ([, v]) => Date.now() < v.expiresAt
      )
    );

    req.session.cibaRequests[result.auth_req_id] = {
      initiatedAt: Date.now(),
      expiresAt:   Date.now() + result.expires_in * 1000,
      loginHint,
      scope: scope || PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      acr_values: acr_values || '',
      binding_message: binding_message || '',
      simulated,
      amount,
      fromAccountLabel,
      toAccountLabel,
      delegationId,
    };

    res.json({
      auth_req_id: result.auth_req_id,
      authReqId:   result.auth_req_id, // camelCase alias for the UserDashboard bridge
      expires_in:  result.expires_in,
      interval:    result.interval,
      login_hint_display: loginHint.replace(/(.{2}).*@/, '$1***@'), // mask for display only
      engine: simulated ? 'simulated' : 'pingone',
    });
  } catch (err) {
    console.error('[CIBA] initiate failed:', err.response?.data || err.message);
    const pingError = err.response?.data;
    res.status(502).json({
      error:   pingError?.error || 'ciba_initiation_failed',
      message: pingError?.error_description
        || normalizeAxiosError(err, { label: 'CIBA initiate' }).message,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/ciba/request/:authReqId
//
// Display details for the separate-device approval page. Session-gated,
// same ownership model as /poll — this page only ever opens in a new tab
// on the SAME browser (shared session cookie), never a different device.
// ---------------------------------------------------------------------------

router.get('/request/:authReqId', authenticateToken, (req, res) => {
  if (!_cibaEnabled(res)) return;

  const { authReqId } = req.params;
  const pending = req.session.cibaRequests?.[authReqId];

  if (!pending) {
    return res.status(404).json({
      error: 'unknown_request',
      message: 'No pending CIBA request with that ID in this session.',
    });
  }

  if (Date.now() > pending.expiresAt) {
    return res.status(410).json({
      error: 'request_expired',
      message: 'The CIBA authentication request has expired. Please try again.',
    });
  }

  res.json({
    binding_message: pending.binding_message || '',
    amount: pending.amount ?? null,
    from_account_label: pending.fromAccountLabel ?? null,
    to_account_label: pending.toAccountLabel ?? null,
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/ciba/poll/:authReqId
// ---------------------------------------------------------------------------

/**
 * Mark a session CIBA request as approved without deleting it.
 * Concurrent pollers (agent loop + approve tab) used to race: the first
 * successful poll deleted the entry and the second got 404 → false deny.
 * Keep an approved sentinel until expiresAt so later polls stay idempotent.
 */
function _markCibaApproved(pending) {
  pending.pollOutcome = 'approved';
  pending.approvedAt = Date.now();
}

router.get('/poll/:authReqId', authenticateToken, async (req, res) => {
  if (!_cibaEnabled(res)) return;

  const { authReqId } = req.params;
  const pending = req.session.cibaRequests?.[authReqId];

  if (!pending) {
    return res.status(404).json({
      error:  'unknown_request',
      message: 'No pending CIBA request with that ID in this session.',
    });
  }

  if (Date.now() > pending.expiresAt) {
    delete req.session.cibaRequests[authReqId];
    return res.status(410).json({
      error:  'request_expired',
      message: 'The CIBA authentication request has expired. Please try again.',
    });
  }

  // Idempotent: prior poll already applied step-up — do not 404 late pollers.
  if (pending.pollOutcome === 'approved') {
    return res.json({
      status: 'approved',
      scope: pending.scope,
      engine: pending.simulated ? 'simulated' : 'pingone',
    });
  }

  if (pending.simulated) {
    if (pending.deniedByUser) {
      delete req.session.cibaRequests[authReqId];
      return res.status(403).json({
        status: 'denied',
        error: 'access_denied',
        message: 'The user denied the authentication request.',
      });
    }

    let approvalStatus = 'approved';
    let approverUserId = null;
    if (pending.delegationId) {
      try {
        const approval = await delegationService.getApprovalStatus(pending.delegationId);
        // Bind the manager decision to THIS auth_req_id only. requestApproval
        // overwrites pendingApproval on the same delegation (one-at-a-time), so
        // without this check approving request B would also complete poll(A)
        // and mint hitlApprovedAmount from A's (possibly larger) session amount.
        if (approval.authReqId && approval.authReqId !== authReqId) {
          approvalStatus = 'pending';
        } else {
          approvalStatus = approval.status;
          approverUserId = approval.approverUserId;
        }
      } catch (approvalErr) {
        console.warn('[CIBA] manager-approval status lookup failed (treating as still pending):', approvalErr.message);
        approvalStatus = 'pending';
      }
    } else if (!cibaSimulatedService.isSimulatedApproved(pending)) {
      approvalStatus = 'pending';
    }

    if (approvalStatus === 'denied') {
      delete req.session.cibaRequests[authReqId];
      return res.status(403).json({
        status: 'denied',
        error: 'access_denied',
        message: 'The manager denied the approval request.',
      });
    }

    if (approvalStatus !== 'approved') {
      return res.json({ status: 'pending', engine: 'simulated' });
    }

    _markCibaApproved(pending);
    req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
    // CIBA out-of-band approval IS a human-in-the-loop event, so it discharges
    // the separate HITL gate too (see mcpToolAuthorizationService.js's
    // hitlAlreadyVerified) — otherwise a checkout/transfer that trips both
    // step-up AND HITL clears step-up on retry but 428s forever on HITL.
    // Amount-bound (services/hitlCredit.js): record what was approved so the
    // credit only discharges consent for a transfer at or below this amount.
    req.session.hitlVerified = Date.now() + STEP_UP_TTL_MS;
    req.session.hitlApprovedAmount = pending.amount ?? null;

    // Mirror the real path's token-chain tracking below so the "CIBA
    // Step-Up" tab and floating token-chain panel show an identical event —
    // never distinguishable from a real approval in the UI.
    // `engine: 'simulated'` is stashed in additionalData for our own
    // debugging only; CibaStepUpFlowPanel.jsx never renders additionalData.
    // No fake access token is ever stored in req.session.oauthTokens — the
    // step-up gate in routes/transactions.js only reads stepUpVerified.
    try {
      const jwt = require('jsonwebtoken');
      const subject = req.user?.sub || req.user?.id;
      if (subject) {
        const fakeAccessToken = jwt.sign({ sub: subject, scope: pending.scope }, 'ciba-simulated-local-only');
        trackTokenEvent({
          id: 'ciba-poll',
          eventType: 'auth',
          token: fakeAccessToken,
          userId: subject,
          description: 'CIBA backchannel step-up approved (out-of-band)',
          additionalData: {
            grantedVia: 'ciba',
            scope: pending.scope,
            engine: 'simulated',
            ...(approverUserId ? { approvedBy: approverUserId } : {}),
          },
        }).catch((err) => console.error('[CIBA] token-chain track failed (simulated):', err.message));
      }
    } catch (trackErr) {
      console.warn('[CIBA] could not build token-chain event for simulated approval:', trackErr.message);
    }

    return req.session.save((saveErr) => {
      if (saveErr) console.error('[CIBA] session save error on simulated approval:', saveErr);
      res.json({
        status: 'approved',
        scope:  pending.scope,
        engine: 'simulated',
      });
    });
  }

  try {
    const tokens = await cibaService.pollForTokens(authReqId);

    // Store tokens server-side (Backend-for-Frontend (BFF) pattern — never expose raw tokens to browser)
    req.session.oauthTokens = {
      accessToken:  tokens.access_token,
      idToken:      tokens.id_token,
      refreshToken: tokens.refresh_token,
      expiresAt:    Date.now() + (tokens.expires_in || 3600) * 1000,
      tokenType:    tokens.token_type || 'Bearer',
      scope:        pending.scope,
      grantedVia:   'ciba',
    };

    _markCibaApproved(pending);
    req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
    // See the matching comment in the simulated branch above.
    req.session.hitlVerified = Date.now() + STEP_UP_TTL_MS;
    req.session.hitlApprovedAmount = pending.amount ?? null;

    // Record the step-up in the token chain so the "CIBA Step-Up" tab and the
    // floating token-chain panel show the backchannel-granted token as a live
    // event. Fire-and-forget — a tracking failure must not break approval.
    try {
      const jwt = require('jsonwebtoken');
      const claims = jwt.decode(tokens.access_token) || {};
      if (claims.sub) {
        trackTokenEvent({
          id: 'ciba-poll',
          eventType: 'auth',
          token: tokens.access_token,
          userId: claims.sub,
          description: 'CIBA backchannel step-up approved (out-of-band)',
          additionalData: { grantedVia: 'ciba', scope: pending.scope },
        }).catch((err) => console.error('[CIBA] token-chain track failed:', err.message));
      }
    } catch (trackErr) {
      console.warn('[CIBA] could not decode token for chain tracking:', trackErr.message);
    }

    req.session.save((saveErr) => {
      if (saveErr) console.error('[CIBA] session save error on approval:', saveErr);
      res.json({
        status: 'approved',
        scope:  pending.scope,
        engine: 'pingone',
      });
    });
  } catch (err) {
    const errorCode = err.response?.data?.error;

    if (errorCode === 'authorization_pending') {
      return res.json({ status: 'pending', engine: 'pingone' });
    }
    if (errorCode === 'slow_down') {
      return res.json({ status: 'pending', slow_down: true, retry_after: 10, engine: 'pingone' });
    }

    // User denied or request expired at PingOne
    delete req.session.cibaRequests?.[authReqId];
    res.status(403).json({
      status: 'denied',
      error:  errorCode || 'access_denied',
      message: err.response?.data?.error_description || 'The user denied the authentication request.',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/ciba/approve-now/:authReqId
//
// Demo convenience: lets the presenter skip the fallback engine's timed
// auto-approve instead of waiting it out. Only valid for a pending.simulated
// request — real CIBA must be approved on its real out-of-band channel, so
// this route is a no-op (404) for a real pending request; the next /poll
// call resolves it exactly as a timed auto-approve would.
// ---------------------------------------------------------------------------

/**
 * Approve a pending transfer after human review via CIBA/HITL.
 * Human approver grants permission for the client-initiated transfer.
 *
 * @flow ciba-hitl
 * @actor human-approver
 * @to client-app
 * @step 2
 */
router.post('/approve-now/:authReqId', authenticateToken, (req, res) => {
  const { authReqId } = req.params;
  const pending = req.session.cibaRequests?.[authReqId];

  if (!pending || !pending.simulated) {
    return res.status(404).json({
      error: 'unknown_request',
      message: 'No pending request with that ID eligible for immediate approval.',
    });
  }

  pending.initiatedAt = Date.now() - cibaSimulatedService.SIMULATED_APPROVE_DELAY_MS;
  req.session.save((saveErr) => {
    if (saveErr) console.error('[CIBA] session save error on approve-now:', saveErr);
    res.json({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/ciba/deny/:authReqId
//
// Explicit user denial from the separate-device approval page — distinct
// from /cancel (give up waiting) or expiry (timed out). Same simulated-only
// constraint as /approve-now: a real bc-authorize request can only be
// denied on its actual out-of-band channel, not through this route.
// ---------------------------------------------------------------------------

router.post('/deny/:authReqId', authenticateToken, (req, res) => {
  const { authReqId } = req.params;
  const pending = req.session.cibaRequests?.[authReqId];

  if (!pending || !pending.simulated) {
    return res.status(404).json({
      error: 'unknown_request',
      message: 'No pending request with that ID eligible for denial.',
    });
  }

  pending.deniedByUser = true;
  req.session.save((saveErr) => {
    if (saveErr) console.error('[CIBA] session save error on deny:', saveErr);
    res.json({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/ciba/cancel/:authReqId
// ---------------------------------------------------------------------------

router.post('/cancel/:authReqId', authenticateToken, (req, res) => {
  const { authReqId } = req.params;
  if (req.session.cibaRequests?.[authReqId]) {
    delete req.session.cibaRequests[authReqId];
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/auth/ciba/notify  — PingOne ping-mode callback (no session auth)
// ---------------------------------------------------------------------------

router.post('/notify', (req, res) => {
  // In ping mode, PingOne sends a POST with the client_notification_token
  // in the Authorization: Bearer header and the auth_req_id in the body.
  // For now we acknowledge and note that ping-mode requires shared state (Redis).
  // Poll mode is fully functional without this endpoint.
  console.log('[CIBA] ping notification received:', req.body?.auth_req_id);
  res.sendStatus(204);
});

module.exports = router;
