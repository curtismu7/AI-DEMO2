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
 *   Rejects ping-mode callbacks; this client implements poll mode only.
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
const { optionalAuthenticateToken } = require('../middleware/optionalAuth');
const configStore = require('../services/configStore');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');
const { trackTokenEvent } = require('../services/tokenChainService');
const hitlServiceClient = require('../services/hitlServiceClient');
const cibaTransactionReceipt = require('../services/cibaTransactionReceipt');
const dataStore = require('../data/store');

const STEP_UP_TTL_MS = 5 * 60 * 1000; // 5 min step-up validity
const CIBA_DEFAULT_SCOPE = 'openid';
const CIBA_TRANSACTION_TOOLS = Object.freeze({
  transfer: 'create_transfer',
  deposit: 'create_deposit',
  withdrawal: 'create_withdrawal',
});
const realPollInFlight = new Set();
// A successful token exchange is one-time. Retain verified claims until the
// session and HITL writes finish so a transient failure can be retried.
const validatedPollResults = new Map();
setInterval(() => {
  for (const [id, value] of validatedPollResults) {
    if (value.expiresAt <= Date.now()) validatedPollResults.delete(id);
  }
}, STEP_UP_TTL_MS).unref();

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
  const localSimulation = cibaSimulatedService.isLocalSimulationEnabled();
  const failoverMode = localSimulation ? 'fallback_simulated' : 'deny';
  const realConfigured = Boolean(process.env.PINGONE_CIBA_CLIENT_ID && process.env.PINGONE_CIBA_CLIENT_SECRET);
  const deliveryMode = configStore.getEffective('ciba_token_delivery_mode') || 'poll';
  res.json({
    enabled:      cibaService.isEnabled(),
    // Delivery channels with a configured PingOne CIBA app, e.g. ['email', 'sms'].
    channels:     cibaService.availableChannels(),
    deliveryMode,
    bindingMessage: configStore.getEffective('ciba_binding_message') || 'Approve',
    engine: cibaService.isEnabled() && realConfigured && deliveryMode === 'poll'
      ? 'pingone' : localSimulation && cibaService.isEnabled() ? 'simulated' : 'unavailable',
    failoverMode,
    // Show PingOne admin steps needed if not enabled
    setupRequired: !cibaService.isEnabled() || !realConfigured || deliveryMode !== 'poll',
    setupSteps: !cibaService.isEnabled() || !realConfigured || deliveryMode !== 'poll' ? [
      'Set CIBA_ENABLED=true in your environment',
      'Provision a dedicated PingOne application with the CIBA grant and set PINGONE_CIBA_CLIENT_ID/SECRET',
      'Attach a deployed DaVinci CIBA flow with an out-of-band approval channel',
      'Configure the CIBA application for poll token delivery mode',
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
 *   scope?:           defaults to openid
 *   binding_message?: 'Approve $500 transfer'   — shown in email or push (PingOne / DaVinci)
 *   acr_values?:      'Multi_factor'             — for step-up auth
 *   login_hint?:      'user@example.com'         — override from session email
 * }
 *
 * @flow ciba-hitl
 * @idp pingone
 * @name CIBA / HITL
 * @rfc https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html OpenID CIBA 1.0
 * @why CIBA (Client-Initiated Backchannel Authentication) decouples approval from the device where a request started: the client asks the authorization server to authenticate a user, and the user approves on their own device — a push notification or app prompt — with no browser redirect anywhere in the flow. HITL (human-in-the-loop) applies the same shape to authorization: a sensitive action pauses until a named human explicitly approves it.
 * @example You phone your bank's call center. Before the agent can discuss your account, the bank pushes an approval prompt to your mobile banking app — you tap Approve on your phone and the call proceeds. The call center never saw your password.
 * @ai An AI agent has no browser and no human sitting next to it. CIBA is how it requests a real person's explicit approval — "approve this $500 transfer" lands on the account owner's device, and the agent stays blocked until a human answers.
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
  // Delivery channel: 'email' (default) or 'sms'. Each has its own PingOne CIBA app + DaVinci flow.
  const channel = field('channel', 'channel') === 'sms' ? 'sms' : 'email';

  // Optional transaction-display context (UC22's separate-device approval
  // page). Purely additive — no validation beyond type coercion, since
  // these only ever populate a display string, never a policy decision.
  const amount = req.body.amount != null ? Number(req.body.amount) : null;
  const transactionType = req.body.transaction_type;
  const fromAccountLabel = field('from_account_label', 'fromAccountLabel') || null;
  const toAccountLabel = field('to_account_label', 'toAccountLabel') || null;
  const fromAccountId = field('from_account_id', 'fromAccountId') || null;
  const toAccountId = field('to_account_id', 'toAccountId') || null;
  const hitlChallengeId = field('hitl_challenge_id', 'hitlChallengeId') || null;
  if (CIBA_TRANSACTION_TOOLS[transactionType] && (
    !Number.isFinite(amount) || amount <= 0
    || (transactionType !== 'deposit' && !fromAccountId)
    || (transactionType !== 'withdrawal' && !toAccountId)
  )) {
    return res.status(400).json({
      error: 'invalid_transaction_context',
      message: 'CIBA approval requires the exact transaction amount and account IDs.',
    });
  }

  let hitlChallenge = null;
  if (hitlChallengeId) {
    try {
      hitlChallenge = await hitlServiceClient.getChallengeStatus(hitlChallengeId);
    } catch (_) {
      return res.status(400).json({ error: 'invalid_hitl_challenge', message: 'The approval request could not be found or has expired. Ask again to start a fresh approval.' });
    }
    const requestUserId = req.user?.id || req.user?.sub;
    const challengeAmount = Number(hitlChallenge.context?.amount);
    const challengeContext = hitlChallenge.context || {};
    // Banking money moves (transfer/deposit/withdrawal) bind tool, amount and
    // accounts exactly. A vertical tool (e.g. extend_rental) sends no banking
    // transaction_type: bind only to the user + pending state, and to the
    // amount when the caller supplied one. The challenge's own tool is kept in
    // hitlChallengeTool below, so the downstream receipt stays tool-exact.
    const banking = Boolean(CIBA_TRANSACTION_TOOLS[transactionType]);
    if (
      hitlChallenge.status !== 'pending'
      || hitlChallenge.userId !== requestUserId
      || (banking && (
        hitlChallenge.tool !== CIBA_TRANSACTION_TOOLS[transactionType]
        || !Number.isFinite(challengeAmount) || challengeAmount !== amount
        || (challengeContext.fromAccountId || null) !== fromAccountId
        || (challengeContext.toAccountId || null) !== toAccountId
      ))
      || (!banking && amount != null && Number.isFinite(challengeAmount) && challengeAmount !== amount)
    ) {
      return res.status(400).json({
        error: 'invalid_hitl_challenge',
        message: 'The approval request no longer matches this action (expired, already used, or a different amount). Ask again to start a fresh approval.',
      });
    }
  }

  if (CIBA_TRANSACTION_TOOLS[transactionType]) {
    const userId = req.user?.id || req.user?.sub;
    const accountIds = [fromAccountId, toAccountId].filter(Boolean);
    if (accountIds.some((id) => dataStore.getAccountById(id)?.userId !== userId)) {
      return res.status(400).json({ error: 'invalid_transaction_accounts', message: 'The accounts on this approval do not belong to the signed-in user.' });
    }
  }

  // Validate binding_message length and content (prevents log injection / oversized payloads)
  if (binding_message !== undefined) {
    if (typeof binding_message !== 'string') {
      return res.status(400).json({ error: 'invalid_binding_message', message: 'binding_message must be a string.' });
    }
    if (binding_message.length > 256) {
      return res.status(400).json({ error: 'invalid_binding_message', message: 'binding_message must not exceed 256 characters.' });
    }
    // Strip control characters (log injection prevention)
    binding_message = binding_message.replace(new RegExp('[\\x00-\\x1f\\x7f]', 'g'), '');
  }
  if (CIBA_TRANSACTION_TOOLS[transactionType] && Number.isFinite(amount) && amount > 0) {
    binding_message = `Approve $${amount.toFixed(2)} ${transactionType} from ${fromAccountId || 'external'} to ${toAccountId || 'external'}`;
    if (binding_message.length > 256) return res.status(400).json({ error: 'invalid_binding_message', message: 'binding_message must not exceed 256 characters.' });
  }
  // PingOne only shows an 8-char binding message in the email; cibaService swaps
  // anything longer for a 6-char code. The full text stays here for the app UI.
  const approvalSummary = binding_message || '';

  let result;
  let simulated = false;
  try {
    result = await cibaService.initiateBackchannelAuth(
      loginHint,
      binding_message,
      scope || CIBA_DEFAULT_SCOPE,
      acr_values,
      channel,
    );
  } catch (realErr) {
    // CIBA requires a real OP result. Simulated failover is an explicit
    // development setting, never the default for transaction approval.
    if (!cibaSimulatedService.isLocalSimulationEnabled()) {
      console.error('[CIBA] initiate failed:', realErr.response?.data || realErr.message);
      if (realErr.message === 'CIBA client credentials are not configured'
        || realErr.message === 'CIBA SMS client credentials are not configured') {
        return res.status(503).json({
          error: 'ciba_not_configured',
          message: channel === 'sms'
            ? 'Text-message CIBA requires its own PingOne CIBA application and SMS-only DaVinci flow.'
            : 'Real CIBA requires a dedicated PingOne CIBA application and DaVinci flow.',
        });
      }
      const pingError = realErr.response?.data;
      return res.status(502).json({
        error:   pingError?.error || 'ciba_initiation_failed',
        message: pingError?.error_description || realErr.message,
      });
    }
    console.warn('[CIBA] real initiate failed, falling back to local simulation:', realErr.response?.data?.error_description || realErr.message);
    result = cibaSimulatedService.initiateSimulated(
      loginHint,
      binding_message,
      scope || CIBA_DEFAULT_SCOPE,
      acr_values,
    );
    simulated = true;
  }
  if (result.binding_message) binding_message = result.binding_message;

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
        bindingMessage: approvalSummary || binding_message || '',
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
      scope: scope || CIBA_DEFAULT_SCOPE,
      acr_values: acr_values || '',
      channel,
      binding_message: binding_message || '',
      approval_summary: approvalSummary,
      simulated,
      pollIntervalMs: Math.max(5000, Number(result.interval || 5) * 1000),
      enforcePollInterval: true,
      nextPollAt: 0,
      amount,
      fromAccountLabel,
      toAccountLabel,
      fromAccountId,
      toAccountId,
      delegationId,
      hitlChallengeId,
      // The canonical HITL record is authoritative when present. A plain CIBA
      // step-up has no HITL challenge id, so retain only a recognized banking
      // transaction type for the exact downstream bearer-only write receipt.
      hitlChallengeTool: hitlChallenge?.tool
        || CIBA_TRANSACTION_TOOLS[transactionType]
        || null,
    };

    res.json({
      auth_req_id: result.auth_req_id,
      authReqId:   result.auth_req_id, // camelCase alias for the UserDashboard bridge
      expires_in:  result.expires_in,
      interval:    result.interval,
      login_hint_display: loginHint.replace(/(.{2}).*@/, '$1***@'), // mask for display only
      binding_message,
      approval_summary: approvalSummary,
      channel,
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
    approval_summary: pending.approval_summary || '',
    amount: pending.amount ?? null,
    from_account_label: pending.fromAccountLabel ?? null,
    to_account_label: pending.toAccountLabel ?? null,
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/ciba/requests — read-only enumeration of THIS session's
// tracked CIBA requests (the same req.session.cibaRequests structure
// initiate/poll/status already read and write). No mutation, no change to
// any transition logic — purely a list view for the Agentic Access Console's
// CIBA tab. Session-gated because entries carry real transfer amounts and
// recipient labels.
// ---------------------------------------------------------------------------

router.get('/requests', optionalAuthenticateToken, (req, res) => {
  const now = Date.now();
  const requests = Object.entries(req.session.cibaRequests || {}).map(([authReqId, pending]) => {
    let status = 'pending';
    if (now > pending.expiresAt) status = 'expired';
    else if (pending.pollOutcome === 'approved') status = 'approved';
    else if (pending.deniedByUser) status = 'denied';
    return {
      authReqId,
      status,
      engine: pending.simulated ? 'simulated' : 'pingone',
      amount: pending.amount ?? null,
      fromAccountLabel: pending.fromAccountLabel ?? null,
      toAccountLabel: pending.toAccountLabel ?? null,
      bindingMessage: pending.binding_message || '',
      approvalSummary: pending.approval_summary || '',
      tool: pending.hitlChallengeTool || null,
      initiatedAt: pending.initiatedAt,
      expiresAt: pending.expiresAt,
    };
  }).sort((a, b) => b.initiatedAt - a.initiatedAt);
  res.json({ requests });
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
    validatedPollResults.delete(authReqId);
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
    if (pending.hitlChallengeTool && !cibaSimulatedService.isLocalSimulationEnabled()) {
      delete req.session.cibaRequests[authReqId];
      return res.status(403).json({ status: 'denied', error: 'real_ciba_required' });
    }
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

    if (pending.hitlChallengeId) {
      try {
        await hitlServiceClient.respondToChallenge(pending.hitlChallengeId, 'approved', req.id);
      } catch (_) {
        return res.status(502).json({ error: 'hitl_approval_failed' });
      }
    }
    _markCibaApproved(pending);
    if (pending.hitlChallengeTool) req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
    // CIBA out-of-band approval IS a human-in-the-loop event, so it discharges
    // the separate HITL gate too (see mcpToolAuthorizationService.js's
    // hitlAlreadyVerified) — otherwise a checkout/transfer that trips both
    // step-up AND HITL clears step-up on retry but 428s forever on HITL.
    // Amount-bound (services/hitlCredit.js): record what was approved so the
    // credit only discharges consent for a transfer at or below this amount.
    if (pending.hitlChallengeTool) {
      req.session.hitlVerified = Date.now() + STEP_UP_TTL_MS;
      req.session.hitlApprovedAmount = pending.amount;
    }
    if (pending.hitlChallengeTool) req.session.cibaApprovedTransaction = {
      tool: pending.hitlChallengeTool,
      amount: pending.amount,
      fromAccountId: pending.fromAccountId,
      toAccountId: pending.toAccountId,
    };

    // Track the local approval while retaining its simulated provenance.
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
          description: 'Local simulated CIBA approval',
          additionalData: {
            grantedVia: 'local_ciba_simulation',
            scope: pending.scope,
            engine: 'simulated',
            ...(approverUserId ? { approvedBy: approverUserId } : {}),
          },
        }).catch((err) => console.error('[CIBA] token-chain track failed (simulated):', err.message));
      }
    } catch (trackErr) {
      console.warn('[CIBA] could not build token-chain event for simulated approval:', trackErr.message);
    }

    try {
      await new Promise((resolve, reject) => req.session.save((saveErr) => {
        if (saveErr) reject(saveErr);
        else resolve();
      }));
    } catch (saveErr) {
      console.error('[CIBA] session save error on simulated approval:', saveErr);
      return res.status(503).json({ error: 'ciba_session_unavailable' });
    }
    if (pending.hitlChallengeTool && pending.amount != null) {
      cibaTransactionReceipt.record(req.user?.id || req.user?.sub, pending.hitlChallengeTool, pending.amount, {
        fromAccountId: pending.fromAccountId, toAccountId: pending.toAccountId, proofType: 'simulated_ciba',
      });
    }
    return res.json({ status: 'approved', scope: pending.scope, engine: 'simulated' });
  }

  if ((pending.enforcePollInterval && pending.nextPollAt > Date.now()) || realPollInFlight.has(authReqId)) {
    return res.json({
      status: 'pending', engine: 'pingone',
      retry_after: Math.max(1, Math.ceil(((pending.nextPollAt || Date.now() + 5000) - Date.now()) / 1000)),
    });
  }
  realPollInFlight.add(authReqId);
  pending.pollIntervalMs = Number.isFinite(pending.pollIntervalMs) ? pending.pollIntervalMs : 5000;
  pending.nextPollAt = Date.now() + pending.pollIntervalMs;
  try {
    let tokens;
    let validated = validatedPollResults.get(authReqId);
    if (validated && (validated.sessionId !== req.sessionID || validated.expiresAt <= Date.now())) {
      validatedPollResults.delete(authReqId);
      validated = null;
    }
    if (!validated) {
      tokens = await cibaService.pollForTokens(authReqId, pending.channel);
      let verifiedClaims;
      try {
        // No ACR check: PingOne sets the token's acr to the DaVinci policy ID, so the
        // step-up ACR the client sent (e.g. 'Multi_Factor') can never match it.
        verifiedClaims = await cibaService.validateCibaIdToken(tokens.id_token, req.user?.sub || req.user?.id, '', pending.channel);
      } catch (validationError) {
        console.error('[CIBA] invalid identity result:', validationError.message);
        delete req.session.cibaRequests[authReqId];
        return res.status(502).json({ error: 'ciba_token_invalid' });
      }
      validated = {
        claims: verifiedClaims,
        sessionId: req.sessionID,
        expiresAt: pending.expiresAt,
        challengeApproved: false,
      };
      validatedPollResults.set(authReqId, validated);
    }

    if (pending.hitlChallengeId && !validated.challengeApproved) {
      try {
        await hitlServiceClient.respondToChallenge(pending.hitlChallengeId, 'approved', req.id);
        validated.challengeApproved = true;
      } catch (_) {
        return res.status(502).json({ status: 'pending', error: 'hitl_approval_failed', retry_after: Math.ceil(pending.pollIntervalMs / 1000) });
      }
    }
    // CIBA authenticates this approval; its dedicated app token must not replace
    // the user's banking session token or broaden the agent's delegated scopes.
    req.session.cibaProof = {
      subject: validated.claims.sub,
      acr: validated.claims.acr || null,
      authReqId,
      approvedAt: Date.now(),
    };

    _markCibaApproved(pending);
    if (pending.hitlChallengeTool) req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
    // See the matching comment in the simulated branch above.
    if (pending.hitlChallengeTool) {
      req.session.hitlVerified = Date.now() + STEP_UP_TTL_MS;
      req.session.hitlApprovedAmount = pending.amount;
    }
    if (pending.hitlChallengeTool) req.session.cibaApprovedTransaction = {
      tool: pending.hitlChallengeTool,
      amount: pending.amount,
      fromAccountId: pending.fromAccountId,
      toAccountId: pending.toAccountId,
    };

    // Record the step-up in the token chain so the "CIBA Step-Up" tab and the
    // floating token-chain panel show the backchannel-granted token as a live
    // event. Fire-and-forget — a tracking failure must not break approval.
    try {
      const jwt = require('jsonwebtoken');
      const claims = tokens?.access_token ? jwt.decode(tokens.access_token) || {} : {};
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

    if (!validated.receiptRecorded && pending.hitlChallengeTool && pending.amount != null) {
      cibaTransactionReceipt.record(req.user?.id || req.user?.sub, pending.hitlChallengeTool, pending.amount, {
        fromAccountId: pending.fromAccountId, toAccountId: pending.toAccountId, proofType: 'ciba',
      });
      validated.receiptRecorded = true;
    }
    try {
      await new Promise((resolve, reject) => req.session.save((saveErr) => {
        if (saveErr) reject(saveErr);
        else resolve();
      }));
    } catch (saveErr) {
      pending.pollOutcome = undefined;
      return res.status(502).json({ status: 'pending', error: 'ciba_session_unavailable', retry_after: Math.ceil(pending.pollIntervalMs / 1000) });
    }
    validatedPollResults.delete(authReqId);
    return res.json({ status: 'approved', scope: pending.scope, engine: 'pingone' });
  } catch (err) {
    const errorCode = err.response?.data?.error;

    if (errorCode === 'authorization_pending') {
      return res.json({ status: 'pending', engine: 'pingone' });
    }
    if (errorCode === 'slow_down') {
      pending.pollIntervalMs += 5000;
      pending.nextPollAt = Date.now() + pending.pollIntervalMs;
      return res.json({ status: 'pending', slow_down: true, retry_after: Math.ceil(pending.pollIntervalMs / 1000), engine: 'pingone' });
    }

    // Keep live requests on transient OP/network errors so the client can retry.
    const terminal = errorCode === 'expired_token' || errorCode === 'access_denied';
    if (terminal) delete req.session.cibaRequests?.[authReqId];
    res.status(errorCode === 'expired_token' ? 410 : errorCode === 'access_denied' ? 403 : 502).json({
      status: terminal ? 'denied' : 'pending',
      error:  errorCode || 'ciba_poll_failed',
      retry_after: terminal ? undefined : Math.ceil(pending.pollIntervalMs / 1000),
      message: errorCode === 'access_denied'
        ? 'The user denied the authentication request.'
        : errorCode === 'expired_token'
          ? 'The CIBA authentication request expired.'
          : 'CIBA authentication could not be completed.',
    });
  } finally {
    realPollInFlight.delete(authReqId);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/ciba/approve-now/:authReqId
//
// Explicit approval for the local simulation only. Real CIBA must be approved
// on the OpenID Provider's out-of-band channel.
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

  if (Date.now() > pending.expiresAt) return res.status(410).json({ error: 'request_expired' });
  if (pending.deniedByUser) return res.status(409).json({ error: 'request_denied' });
  if (!cibaSimulatedService.isLocalSimulationEnabled()) return res.status(403).json({ error: 'local_simulation_disabled' });

  pending.approvedByUser = true;
  req.session.save((saveErr) => {
    if (saveErr) {
      console.error('[CIBA] session save error on approve-now:', saveErr);
      return res.status(503).json({ error: 'ciba_session_unavailable' });
    }
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

  if (Date.now() > pending.expiresAt) return res.status(410).json({ error: 'request_expired' });
  if (pending.approvedByUser) return res.status(409).json({ error: 'request_approved' });

  pending.deniedByUser = true;
  req.session.save((saveErr) => {
    if (saveErr) {
      console.error('[CIBA] session save error on deny:', saveErr);
      return res.status(503).json({ error: 'ciba_session_unavailable' });
    }
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
  validatedPollResults.delete(authReqId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/auth/ciba/notify  — PingOne ping-mode callback (no session auth)
// ---------------------------------------------------------------------------

router.post('/notify', (_req, res) => {
  res.status(501).json({ error: 'unsupported_delivery_mode', message: 'Configure CIBA poll delivery mode.' });
});

module.exports = router;
