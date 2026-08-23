// banking_api_server/services/transactionConsentChallenge.js
/**
 * Server-bound consent challenges for high-value transactions (HITL).
 * State lives in express-session so it works across serverless instances when session store is Redis.
 *
 * Flow after user ticks consent checkbox:
 *   1. POST /consent-challenge              → createChallenge()  → status: 'pending'
 *   2. POST /consent-challenge/:id/confirm  → sendOtp()          → status: 'otp_pending' + otpHash stored
 *   3. POST /consent-challenge/:id/verify-otp → verifyOtp()      → status: 'confirmed'
 *   4. POST /transactions { consentChallengeId } → verifyAndConsumeChallenge() → executes
 */
'use strict';

const crypto = require('crypto');
const dataStore = require('../data/store');
const configStore = require('./configStore');
const { resolveAccountId } = require('../utils/accountUtils');
const mfaService = require('./mfaService');
const recognizeService = require('./recognizeService');
const { roundToCents } = require('../utils/money');
const scopeTopology = require('./scopeTopology');
const davinciFlowClient = require('./davinciFlowClient');
const appEventService = require('./appEventService');

function getConfirmThreshold(verticalId) {
  const { verticalManifest } = require('./verticalManifest');
  const vid = verticalId || verticalManifest.resolver.activeId();
  const vertKey = vid ? `confirm_threshold_usd_${vid}` : null;
  const vertRaw = vertKey ? configStore.getEffective(vertKey) : null;
  const vertN = Number(vertRaw);
  if (vertRaw && !isNaN(vertN) && vertN > 0) return vertN;
  const v = configStore.getEffective('confirm_threshold_usd');
  const n = Number(v);
  return (v && !isNaN(n) && n > 0) ? n : scopeTopology.highValueConsentThresholdUsd();
}
function getStepUpThreshold() {
  // Single source of truth with the AGENT authorize path: read mfa_threshold_usd
  // — the admin-facing step-up amount the thresholds API writes and fans out to
  // SIMULATED_AUTHORIZE_STEPUP_AMOUNT / step_up_amount_threshold. A separate
  // confirm_stepup_threshold_usd let this drift from the agent's value, so a
  // transfer the agent gated as step-up (>= mfa_threshold_usd) was treated here
  // as consent-only — the consent modal showed no MFA. Fall back to the legacy
  // key then topology; mfa_threshold_usd carries a 500 FIELD_DEFS default so the
  // fallbacks are only reached if it is ever explicitly cleared.
  const v = configStore.getEffective('mfa_threshold_usd')
    || configStore.getEffective('confirm_stepup_threshold_usd');
  const n = Number(v);
  return (v && !isNaN(n) && n > 0) ? n : scopeTopology.stepUpThresholdUsd();
}
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const CONFIRMED_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_PER_SESSION = 8;
const OTP_TTL_MS = 5 * 60 * 1000;   // 5 minutes to enter OTP
const OTP_MAX_ATTEMPTS = 3;          // lock after 3 wrong codes
const HITL_CREDIT_TTL_MS = 5 * 60 * 1000; // matches routes/ciba.js's STEP_UP_TTL_MS

/**
 * Mints the same session-level HITL credit CIBA out-of-band approval grants
 * (services/hitlCredit.js) once an in-page consent challenge (consent-only,
 * OTP, PingOne MFA, or Recognize) reaches its terminal 'confirmed' state.
 *
 * Until this existed, only routes/ciba.js ever wrote req.session.hitlVerified
 * — so a user who satisfied THIS consent flow still had no credit, and the
 * isRefire retry that follows re-tripped the MCP gateway's and REST route's
 * own independent HITL gates (mcpToolAuthorizationService.js, routes/
 * transactions.js), showing a second, redundant consent prompt for the exact
 * approval the user just gave.
 */
function _grantHitlCredit(req, ch) {
  req.session.hitlVerified = Date.now() + HITL_CREDIT_TTL_MS;
  req.session.hitlApprovedAmount = ch.snapshot?.amount ?? null;
}

/**
 * A challenge only ever reaches an OTP/MFA ceremony when the amount is at or
 * above the step-up threshold (below it, confirmChallenge confirms consent-only
 * with no ceremony) — so a verified ceremony here IS step-up MFA, and must
 * discharge routes/transactions.js's step-up gate the same way routes/mfa.js
 * and routes/ciba.js do. Without this stamp, the post-consent retry evaluated
 * the transaction policy on the un-upgraded acr and answered RFC 9470 401
 * step_up_required — a second MFA demand for the ceremony the user just
 * completed. Same single-use consume pattern (transactions.js reads and
 * zeroes it). Deliberately NOT in _grantHitlCredit: the consent-only and
 * Recognize confirms grant HITL credit without proving MFA.
 */
function _grantStepUpCredit(req) {
  req.session.stepUpVerified = Date.now() + HITL_CREDIT_TTL_MS;
}

/**
 * Classify a PingOne MFA-initiation failure into a route result.
 *
 * A PingOne auth rejection (HTTP 401 / code INVALID_TOKEN) only warrants a
 * "sign in again" (401 session_expired) when the user's session token is ACTUALLY
 * expired. PingOne *also* returns INVALID_TOKEN when a perfectly fresh token is
 * structurally unacceptable to the MFA API (e.g. a custom resource-server audience
 * like enduser.ping.demo). In that case re-login mints another identical token and
 * a "sign in again" prompt would loop forever — so surface an honest MFA-init
 * failure (502) instead. Pass the stored token's expiry (req.session.oauthTokens
 * .expiresAt); omit it on worker-token paths so their failures are never mistaken
 * for user-session expiry.
 *
 * @param {Error & { code?: string, status?: number, pingError?: { details?: Array<{ code?: string }> } }} err
 * @param {number} [tokenExpiresAt] epoch ms; session_expired only fires when now >= this
 * @returns {{ ok: false, status: number, json: object }}
 */
function _mfaInitFailureResult(err, tokenExpiresAt) {
  const details = Array.isArray(err?.pingError?.details) ? err.pingError.details : [];
  const pingOneAuthRejection =
    err?.code === 'token_expired' ||
    err?.status === 401 ||
    details.some((d) => d?.code === 'INVALID_TOKEN');
  const tokenActuallyExpired =
    typeof tokenExpiresAt === 'number' && Date.now() >= tokenExpiresAt;
  if (pingOneAuthRejection && tokenActuallyExpired) {
    return {
      ok: false,
      status: 401,
      json: {
        error: 'session_expired',
        requiresLogin: true,
        message: 'Your sign-in session has expired. Sign in again to continue.',
      },
    };
  }
  return { ok: false, status: 502, json: { error: 'mfa_init_failed', message: 'Could not start MFA challenge. Try again.' } };
}

/** @returns {Record<string, object>} */
function store(session) {
  if (!session.txConsentChallenges || typeof session.txConsentChallenges !== 'object') {
    session.txConsentChallenges = {};
  }
  return session.txConsentChallenges;
}

function pruneExpired(st) {
  const now = Date.now();
  for (const [id, ch] of Object.entries(st)) {
    if (!ch || typeof ch !== 'object') {
      delete st[id];
      continue;
    }
    if (ch.status === 'pending' && ch.expiresAt < now) delete st[id];
    if (ch.status === 'confirmed' && ch.confirmExpiresAt < now) delete st[id];
  }
}

/**
 * Serializes concurrent mutating calls for the SAME challengeId. `req.session`
 * is deserialized fresh per HTTP request, so two overlapping requests for one
 * challenge (a double-clicked Confirm/Verify-OTP, or a browser retry mid-flight)
 * each read+mutate their own independent copy of `ch` — the OTP lockout counter
 * could see `otpAttempts === 0` twice, and confirmChallenge's device-picker/OTP
 * init could fire twice with the last `session.save()` silently discarding the
 * other's result. A request that finds its challenge already busy is rejected
 * outright (409) instead of racing it — the caller retries and, by then, sees
 * the first request's already-persisted, correct state.
 */
const _challengeBusy = new Set();
async function _withChallengeLock(challengeId, fn) {
  if (_challengeBusy.has(challengeId)) {
    return {
      ok: false,
      status: 409,
      json: { error: 'challenge_busy', message: 'This request is already being processed for this challenge. Please wait a moment and try again.' },
    };
  }
  _challengeBusy.add(challengeId);
  try {
    return await fn();
  } finally {
    _challengeBusy.delete(challengeId);
  }
}

/**
 * Normalize transaction body fields for comparison (must match POST /api/transactions).
 * @param {object} body
 */
function normalizeSnapshot(body) {
  const parsedAmount = parseFloat(body.amount);
  const amount = roundToCents(parsedAmount);
  return {
    type: body.type,
    amount,
    fromAccountId: body.fromAccountId || null,
    toAccountId: body.toAccountId || null,
    description: String(body.description || '').trim(),
  };
}

function snapshotsEqual(a, b) {
  return (
    a.type === b.type &&
    a.amount === b.amount &&
    a.fromAccountId === b.fromAccountId &&
    a.toAccountId === b.toAccountId &&
    a.description === b.description
  );
}

// ── OTP helpers ──────────────────────────────────────────────────────────────

/** Generate a cryptographically random 6-digit OTP string. */
function generateOtp() {
  const buf = crypto.randomBytes(3);
  const num = (buf[0] << 16 | buf[1] << 8 | buf[2]) % 1_000_000;
  return String(num).padStart(6, '0');
}

/**
 * One-way hash of the raw OTP so we never store plaintext in the session.
 * Uses HMAC-SHA256 with a per-challenge random salt (stored alongside).
 */
function hashOtp(otp, salt) {
  return crypto.createHmac('sha256', salt).update(otp).digest('hex');
}

/** Constant-time comparison of two hex strings. */
function safeEqual(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Validates the same business rules as POST /api/transactions (without executing).
 * @returns {{ ok: true, normalized: object } | { ok: false, status: number, json: object }}
 */
function validateIntent(req, rawBody) {
  let { fromAccountId, toAccountId, amount, type, description } = rawBody;

  // Resolve account type names to IDs before validation
  const userAccounts = dataStore.getAccountsByUserId(req.user.id);
  if (fromAccountId) {
    fromAccountId = resolveAccountId(fromAccountId, userAccounts);
  }
  if (toAccountId) {
    toAccountId = resolveAccountId(toAccountId, userAccounts);
  }

  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return { ok: false, status: 400, json: { error: 'invalid_amount', message: 'Amount must be a positive number.' } };
  }
  if (parsedAmount > 1_000_000) {
    return { ok: false, status: 400, json: { error: 'amount_exceeds_limit', message: 'Transaction amount cannot exceed $1,000,000.' } };
  }

  const rounded = roundToCents(parsedAmount);
  if (!type) {
    return { ok: false, status: 400, json: { error: 'Missing required fields: amount and type' } };
  }
  if (type === 'deposit' && !toAccountId) {
    return { ok: false, status: 400, json: { error: 'Missing required field: toAccountId for deposit' } };
  }
  if (type === 'withdrawal' && !fromAccountId) {
    return { ok: false, status: 400, json: { error: 'Missing required field: fromAccountId for withdrawal' } };
  }
  if (type === 'transfer' && (!fromAccountId || !toAccountId)) {
    return { ok: false, status: 400, json: { error: 'Missing required fields: fromAccountId and toAccountId for transfer' } };
  }

  if (req.user.role !== 'admin') {
    if (fromAccountId) {
      const fromAccount = dataStore.getAccountById(fromAccountId);
      if (!fromAccount) return { ok: false, status: 404, json: { error: 'From account not found' } };
      if (fromAccount.userId !== req.user.id) {
        return { ok: false, status: 403, json: { error: 'Access denied. You can only transfer from your own accounts.' } };
      }
    }
    if (toAccountId) {
      const toAccount = dataStore.getAccountById(toAccountId);
      if (!toAccount) return { ok: false, status: 404, json: { error: 'To account not found' } };
      if (toAccount.userId !== req.user.id) {
        return { ok: false, status: 403, json: { error: 'Access denied. You can only deposit to your own accounts.' } };
      }
    }
  }

  if (fromAccountId && (type === 'withdrawal' || type === 'transfer')) {
    const fromAccount = dataStore.getAccountById(fromAccountId);
    if (!fromAccount) return { ok: false, status: 404, json: { error: 'From account not found' } };
    if (fromAccount.balance < rounded) {
      return { ok: false, status: 400, json: { error: 'Insufficient balance' } };
    }
  }

  const normalized = normalizeSnapshot({
    type,
    amount: rounded,
    fromAccountId: fromAccountId || null,
    toAccountId: toAccountId || null,
    description: description || '',
  });

  return { ok: true, normalized };
}

/**
 * @param {import('express').Request} req
 * @param {object} rawBody
 */
function createChallenge(req, rawBody) {
  if (req.user.role === 'admin') {
    return { ok: false, status: 400, json: { error: 'consent_challenge_not_applicable', message: 'Admin transactions do not use consent challenges.' } };
  }

  const v = validateIntent(req, rawBody);
  if (!v.ok) return v;

  if (!['transfer', 'withdrawal', 'deposit'].includes(v.normalized.type)) {
    return { ok: false, status: 400, json: { error: 'invalid_type', message: 'Consent challenges apply to transfer, withdrawal, or deposit only.' } };
  }

  // Session-scoped threshold: use THIS session's vertical (falls back to global).
  const _vid = require('./verticalManifest').verticalManifest.resolver.activeIdFor(req);
  const _confirmThreshold = getConfirmThreshold(_vid);
  // Transfer type ALWAYS requires consent challenge regardless of amount (Phase 170)
  if (v.normalized.type === 'transfer') {
    console.log(`[ConsentChallenge] TRANSFER requires HITL: user=${req.user.id} amount=${v.normalized.amount}`);
    // Skip amount check — proceed directly to challenge creation
  } else if (v.normalized.amount <= _confirmThreshold) {
    return {
      ok: false,
      status: 400,
      json: {
        error: 'consent_challenge_not_required',
        message: `Consent challenges are only issued for amounts over $${_confirmThreshold}.`,
        high_value_threshold_usd: _confirmThreshold,
      },
    };
  }

  const st = store(req.session);
  pruneExpired(st);

  const pendingCount = Object.values(st).filter((c) => c && c.userId === req.user.id && c.status === 'pending').length;
  if (pendingCount >= MAX_PENDING_PER_SESSION) {
    return { ok: false, status: 429, json: { error: 'too_many_challenges', message: 'Too many open consent challenges. Complete or wait for them to expire.' } };
  }

  const challengeId = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  st[challengeId] = {
    userId: req.user.id,
    snapshot: v.normalized,
    status: 'pending',
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
  };

  console.log(
    `[ConsentChallenge] created challenge=${challengeId.slice(0, 8)}… user=${req.user.id} amount=${v.normalized.amount} type=${v.normalized.type}`,
  );

  return { ok: true, challengeId, expiresAt: st[challengeId].expiresAt, snapshot: v.normalized };
}

function getChallenge(req, challengeId) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (ch.status !== 'pending') {
    return { ok: false, status: 409, json: { error: 'challenge_not_pending', message: 'This challenge is no longer awaiting review.' } };
  }
  return {
    ok: true,
    challengeId,
    snapshot: ch.snapshot,
    status: ch.status,
    expiresAt: ch.expiresAt,
  };
}

/**
 * confirmChallenge — user has ticked the consent checkbox and clicked "Agree".
 * Generates a 6-digit OTP, stores its hash in the session, and sends it
 * via PingOne email.  Challenge moves to status 'otp_pending'.
 *
 * NOTE: this function is async because it calls emailService.sendOtpEmail().
 * The caller (route handler) must await it.
 *
 * @param {import('express').Request} req
 * @param {string} challengeId
 * @param {object} [opts]
 * @param {string} [opts.userName]  Display name for the email greeting
 * @returns {Promise<{ ok: true, challengeId: string, otpSent: boolean }
 *                 | { ok: false, status: number, json: object }>}
 */
async function confirmChallenge(req, challengeId, opts = {}) {
  return _withChallengeLock(challengeId, () => _confirmChallengeImpl(req, challengeId, opts));
}

async function _confirmChallengeImpl(req, challengeId, opts = {}) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (ch.status !== 'pending') {
    return { ok: false, status: 409, json: { error: 'challenge_not_pending', message: 'Challenge already confirmed or consumed.' } };
  }
  const now = Date.now();
  if (ch.expiresAt < now) {
    delete st[challengeId];
    return { ok: false, status: 410, json: { error: 'challenge_expired', message: 'Consent challenge expired. Start again from the dashboard.' } };
  }

  const mfaMode = configStore.getEffective('hitl_consent_mfa_mode') || 'onetime';
  const userAccessToken = req.session?.oauthTokens?.accessToken;

  // Consent-only tier: at/above the consent threshold but BELOW the step-up
  // threshold. Authorize returns a plain HITL (consent) obligation for these —
  // human approval, NOT identity re-proof. The agent must not invent an OTP/MFA
  // step here (that made every $250–$500 transfer show a stray OTP field after
  // the consent modal). The consent tick IS the gate: promote straight to
  // 'confirmed' — the same terminal state a verified OTP reaches — so
  // verifyAndConsumeChallenge lets the transaction execute. Step-up amounts
  // (>= step-up threshold) fall through to the MFA/OTP branches below.
  if (ch.snapshot.amount < getStepUpThreshold()) {
    ch.status          = 'confirmed';
    ch.confirmedAt      = now;
    ch.confirmExpiresAt = now + CONFIRMED_TTL_MS;
    _grantHitlCredit(req, ch);
    console.log(`[ConsentChallenge] consent-only (amount ${ch.snapshot.amount} < step-up ${getStepUpThreshold()}) — confirmed without OTP/MFA challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
    return { ok: true, challengeId, consentOnly: true, confirmExpiresAt: ch.confirmExpiresAt };
  }

  if (mfaMode === 'device_picker' && ch.snapshot.amount >= getStepUpThreshold()) {
    let daId, devices;
    try {
      const initiated = await mfaService.initiateDeviceAuth(req.user.id, userAccessToken);
      daId = initiated.id;
      devices = initiated._embedded?.devices || [];
    } catch (err) {
      console.warn(`[ConsentChallenge] initiateDeviceAuth failed: ${err.message}`);
      // device-picker uses the user's session token — a 401/INVALID_TOKEN here is
      // only "sign in again" if that token is actually expired (see helper).
      return _mfaInitFailureResult(err, req.session?.oauthTokens?.expiresAt);
    }

    ch.mfaPath      = true;
    ch.daId         = daId;
    ch.devices      = devices;
    ch.otpAttempts  = 0;
    ch.otpExpiresAt = now + OTP_TTL_MS;
    ch.status       = 'otp_pending';

    console.log(`[ConsentChallenge] PingOne MFA initiated challenge=${challengeId.slice(0, 8)}… daId=${daId} user=${req.user.id}`);
    return { ok: true, challengeId, mfaRequired: true, devices };

  } else if (mfaMode === 'onetime') {
    let contact, deliveryType;
    try {
      const { email, mobilePhone } = await mfaService.getPingOneUserContact(req.user.id);
      if (email) { deliveryType = 'EMAIL'; contact = email; }
      else if (mobilePhone) { deliveryType = 'SMS'; contact = mobilePhone; }
    } catch (err) {
      console.warn(`[ConsentChallenge] getPingOneUserContact failed: ${err.message}`);
      return { ok: false, status: 502, json: { error: 'mfa_contact_lookup_failed', message: 'Could not look up MFA contact. Try again.' } };
    }

    if (!contact) {
      console.log(`[ConsentChallenge] one-time OTP: no contact for user=${req.user.id} — requesting from UI`);
      ch.oneTimePath    = true;
      ch.pendingContact = true;
      return { ok: true, challengeId, needsContact: true };
    }

    return _initiateOnetimeOtp(ch, challengeId, deliveryType, contact, userAccessToken, req.user.id, now);

  } else if (mfaMode === 'recognize') {
    // ── PingOne Recognize: face auth branch ───────────────────────────────
    try {
      const { sessionToken, sessionId } = await recognizeService.initiateSession(req.user.id);
      ch.recognizePath      = true;
      ch.recognizeSessionId = sessionId;
      ch.status             = 'recognize_pending';
      ch.otpExpiresAt       = now + OTP_TTL_MS;
      console.log(`[ConsentChallenge] Recognize session initiated challenge=${challengeId.slice(0, 8)}… sessionId=${sessionId} user=${req.user.id}`);
      return { ok: true, challengeId, mode: 'recognize', sessionToken, sessionId };
    } catch (err) {
      console.warn(`[ConsentChallenge] Recognize init failed, falling back to onetime OTP: ${err.message}`);
    }

    // Fallback: one-time OTP when Recognize is unavailable
    let contact, deliveryType;
    try {
      const p = await mfaService.getPingOneUserContact(req.user.id);
      if (p.email) { deliveryType = 'EMAIL'; contact = p.email; }
      else if (p.mobilePhone) { deliveryType = 'SMS'; contact = p.mobilePhone; }
    } catch (err) {
      console.warn(`[ConsentChallenge] recognize fallback: getPingOneUserContact failed: ${err.message}`);
      return { ok: false, status: 502, json: { error: 'mfa_init_failed', message: 'Face ID unavailable and could not start backup verification. Try again.' } };
    }
    if (!contact) {
      ch.oneTimePath    = true;
      ch.pendingContact = true;
      return { ok: true, challengeId, mode: 'onetime_fallback', needsContact: true };
    }
    const otpResult = await _initiateOnetimeOtp(ch, challengeId, deliveryType, contact, req.session?.oauthTokens?.accessToken, req.user.id, now);
    if (!otpResult.ok) return otpResult;
    return { ...otpResult, mode: 'onetime_fallback' };
  }

  // homegrown: BFF-generated OTP delivered via emailService
  // Generate OTP and store its hash
  const otpPlain = generateOtp();
  const otpSalt  = crypto.randomBytes(16).toString('hex');
  ch.otpHash       = hashOtp(otpPlain, otpSalt);
  ch.otpSalt       = otpSalt;
  ch.otpAttempts   = 0;
  ch.otpExpiresAt  = now + OTP_TTL_MS;
  ch.status        = 'otp_pending';

  console.log(`[ConsentChallenge] OTP generated challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);

  // Send via PingOne email (fire and collect result — failure is surfaced to caller)
  let otpSent = false;
  let otpCodeFallback = null; // only set when email fails — returned to UI for demo display
  try {
    const { sendOtpEmail } = require('./emailService');
    const performer = dataStore.getUserById(req.user.id);
    const userName = opts.userName ||
      (performer ? `${performer.firstName} ${performer.lastName}`.trim() : null) ||
      req.user.username || 'Valued Customer';
    await sendOtpEmail(req.user.id, {
      otpCode: otpPlain,
      amount: ch.snapshot.amount,
      transactionType: ch.snapshot.type,
      userName,
      expiresInMin: Math.ceil(OTP_TTL_MS / 60_000),
    });
    otpSent = true;
  } catch (emailErr) {
    // Email delivery unavailable (PingOne not configured or API error).
    // Return the plaintext code so the UI can display it inline for demo purposes.
    const detail = emailErr.response?.data ? JSON.stringify(emailErr.response.data) : emailErr.message;
    console.warn(`[ConsentChallenge] OTP email failed (challenge=${challengeId.slice(0, 8)}…): ${detail}`);
    otpCodeFallback = otpPlain;
  }

  return { ok: true, challengeId, otpSent, otpExpiresAt: ch.otpExpiresAt, otpCodeFallback };
}

/**
 * confirmChallengeViaDaVinci — DaVinci-orchestrated alternative to confirmChallenge,
 * used only when ff_davinci_orchestration is ON. Invokes the DaVinci transaction-
 * authorization flow (SSO + Protect + MFA + fraud-queue webhook + Authorize,
 * see docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md)
 * instead of the hand-coded OTP/MFA state machine. Fails closed: any DaVinci API
 * error falls back to confirmChallenge so a transaction is never blocked by a
 * DaVinci outage.
 *
 * @param {import('express').Request} req
 * @param {string} challengeId
 * @param {object} [opts]
 * @param {string} [opts.userName]
 */
async function confirmChallengeViaDaVinci(req, challengeId, opts = {}) {
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (ch.status !== 'pending') {
    return { ok: false, status: 409, json: { error: 'challenge_not_pending', message: 'Challenge already confirmed or consumed.' } };
  }

  const userName = opts.userName || req.user.username || 'Demo User';

  let flowResult;
  try {
    flowResult = await davinciFlowClient.invokeFlow('transactionAuthorization', {
      Amount: ch.snapshot.amount,
      TransactionType: ch.snapshot.type,
      Username: userName,
    });

    // Guard: flowResult must be a well-formed object with valid decision field
    if (!flowResult || typeof flowResult !== 'object' || !('decision' in flowResult)) {
      appEventService.logEvent('davinci', 'warn', 'DaVinci transaction flow returned malformed result — falling back to hand-coded consent path', {
        tag: 'davinci/fallback/malformed',
        metadata: { result: typeof flowResult, challengeId: challengeId.slice(0, 8) },
      });
      return confirmChallenge(req, challengeId, opts);
    }

    // Only PERMIT authorizes the transaction; DENY and any other value (INDETERMINATE, typo, etc.) does not
    if (flowResult.decision !== 'PERMIT') {
      return { ok: false, status: 403, json: { error: 'davinci_denied', message: 'Transaction denied by DaVinci authorization flow.' } };
    }
  } catch (err) {
    appEventService.logEvent('davinci', 'warn', 'DaVinci transaction flow failed — falling back to hand-coded consent path', {
      tag: 'davinci/fallback',
      metadata: { error: err.message, challengeId: challengeId.slice(0, 8) },
    });
    return confirmChallenge(req, challengeId, opts);
  }

  const now = Date.now();
  ch.status           = 'confirmed';
  ch.confirmedAt      = now;
  ch.confirmExpiresAt = now + CONFIRMED_TTL_MS;
  _grantHitlCredit(req, ch);
  if (flowResult.stepUpCompleted) _grantStepUpCredit(req);

  console.log(`[ConsentChallenge] DaVinci flow confirmed challenge=${challengeId.slice(0, 8)}… user=${req.user.id} decision=${flowResult.decision}`);
  return { ok: true, challengeId, viaDaVinci: true, confirmExpiresAt: ch.confirmExpiresAt };
}

/**
 * Shared helper — initiates one-time OTP once contact is known and mutates the challenge.
 * Called by both confirmChallenge (auto-resolved contact) and confirmOnetimeContact (user-supplied).
 */
async function _initiateOnetimeOtp(ch, challengeId, deliveryType, contact, userAccessToken, userId, now) {
  let daId, maskedContact;
  try {
    const initiated = await mfaService.initiateOneTimeOtp(userId, deliveryType, contact, userAccessToken);
    daId = initiated.id;
    maskedContact = initiated._embedded?.devices?.[0]?.[deliveryType.toLowerCase()] || null;
  } catch (err) {
    console.warn(`[ConsentChallenge] initiateOneTimeOtp failed: ${err.message}`);
    // one-time init runs on a worker token (not the user session token), so a
    // failure is never user-session expiry — no expiresAt → honest 502, never reauth.
    return _mfaInitFailureResult(err);
  }

  ch.oneTimePath    = true;
  ch.pendingContact = false;
  ch.daId           = daId;
  ch.otpAttempts    = 0;
  ch.otpExpiresAt   = now + OTP_TTL_MS;
  ch.status         = 'otp_pending';

  console.log(`[ConsentChallenge] PingOne one-time OTP initiated challenge=${challengeId.slice(0, 8)}… daId=${daId} user=${userId} via=${deliveryType}`);
  return { ok: true, challengeId, otpSent: true, otpExpiresAt: ch.otpExpiresAt, maskedContact };
}

/**
 * confirmOnetimeContact — user supplies their email/phone when none was found on their PingOne record.
 * Validates that the challenge is in oneTimePath+pendingContact state, then initiates the OTP.
 *
 * @param {import('express').Request} req
 * @param {string} challengeId
 * @param {{ email?: string, phone?: string }} contact
 */
async function confirmOnetimeContact(req, challengeId, contact) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (!ch.oneTimePath || !ch.pendingContact) {
    return { ok: false, status: 409, json: { error: 'contact_not_needed', message: 'This challenge does not require contact input.' } };
  }
  if (ch.status !== 'pending') {
    return { ok: false, status: 409, json: { error: 'challenge_not_pending', message: 'Challenge already confirmed or consumed.' } };
  }

  const { email, phone } = contact || {};
  let deliveryType, contactValue;
  if (email && typeof email === 'string' && email.includes('@')) {
    deliveryType = 'EMAIL';
    contactValue = email.trim().toLowerCase();
  } else if (phone && typeof phone === 'string' && phone.trim()) {
    deliveryType = 'SMS';
    contactValue = phone.trim();
  } else {
    return { ok: false, status: 400, json: { error: 'invalid_contact', message: 'Provide a valid email address or phone number.' } };
  }

  const userAccessToken = req.session?.oauthTokens?.accessToken;
  return _initiateOnetimeOtp(ch, challengeId, deliveryType, contactValue, userAccessToken, req.user.id, Date.now());
}

/**
 * verifyOtp — user submits the 6-digit code received by email.
 * On success, challenge moves to status 'confirmed' (ready for verifyAndConsumeChallenge).
 *
 * @param {import('express').Request} req
 * @param {string} challengeId
 * @param {string} otpCode  Raw 6-digit code from the user
 */
async function verifyOtp(req, challengeId, otpCode) {
  return _withChallengeLock(challengeId, () => _verifyOtpImpl(req, challengeId, otpCode));
}

function _verifyOtpImpl(req, challengeId, otpCode) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (ch.status !== 'otp_pending') {
    return { ok: false, status: 409, json: { error: 'otp_not_expected', message: 'No OTP is pending for this challenge.' } };
  }
  if (ch.mfaPath || ch.oneTimePath) {
    return { ok: false, status: 409, json: { error: 'not_mfa_path', message: 'Use verifyMfa for PingOne MFA challenges.' } };
  }
  if (Date.now() > ch.otpExpiresAt) {
    ch.status = 'expired';
    return { ok: false, status: 410, json: { error: 'otp_expired', message: 'The verification code has expired. Start the transaction again.' } };
  }
  if (!otpCode || typeof otpCode !== 'string' || !/^\d{6}$/.test(otpCode.trim())) {
    return { ok: false, status: 400, json: { error: 'otp_invalid_format', message: 'Enter a 6-digit verification code.' } };
  }

  ch.otpAttempts = (ch.otpAttempts || 0) + 1;
  // Always-on demo bypass — matches /oauth/user/verify-otp and verifyMfa.
  const isDemoBypass = otpCode.trim() === '123123';
  if (!isDemoBypass) {
    const expected = hashOtp(otpCode.trim(), ch.otpSalt);
    if (!safeEqual(ch.otpHash, expected)) {
      const remaining = OTP_MAX_ATTEMPTS - ch.otpAttempts;
      if (remaining <= 0) {
        delete st[challengeId];
        console.warn(`[ConsentChallenge] OTP locked after ${OTP_MAX_ATTEMPTS} attempts challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
        return { ok: false, status: 429, json: { error: 'otp_locked', message: 'Too many incorrect attempts. Please start the transaction again.' } };
      }
      return { ok: false, status: 400, json: { error: 'otp_incorrect', message: `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`, attemptsRemaining: remaining } };
    }
  } else {
    console.log(`[ConsentChallenge] Demo bypass OTP accepted challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
  }

  // ✅ Correct — promote to confirmed
  const now = Date.now();
  ch.status          = 'confirmed';
  ch.confirmedAt     = now;
  ch.confirmExpiresAt = now + CONFIRMED_TTL_MS;
  _grantHitlCredit(req, ch);
  _grantStepUpCredit(req);
  // Clear sensitive OTP fields
  delete ch.otpHash;
  delete ch.otpSalt;
  delete ch.otpAttempts;
  delete ch.otpExpiresAt;

  console.log(`[ConsentChallenge] OTP verified challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
  return { ok: true, challengeId, confirmExpiresAt: ch.confirmExpiresAt };
}

/**
 * verifyMfa — PingOne MFA path for HITL consent challenges.
 * Called when challenge.mfaPath === true (ff_hitl_pingone_mfa_enabled + amount >= threshold).
 * Delegates OTP or FIDO2 assertion to mfaService; on success promotes to 'confirmed'.
 *
 * @param {import('express').Request} req
 * @param {string} challengeId
 * @param {{ deviceId: string, otp?: string, fido2Assertion?: object }} params
 * @param {string} [origin]  Required for FIDO2 assertion (browser origin)
 */
async function verifyMfa(req, challengeId, params, origin) {
  return _withChallengeLock(challengeId, () => _verifyMfaImpl(req, challengeId, params, origin));
}

async function _verifyMfaImpl(req, challengeId, params, origin) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (!ch.mfaPath && !ch.oneTimePath) {
    return { ok: false, status: 409, json: { error: 'not_mfa_path', message: 'This challenge does not use PingOne MFA.' } };
  }
  if (ch.status !== 'otp_pending') {
    return { ok: false, status: 409, json: { error: 'otp_not_expected', message: 'No MFA challenge is pending for this challenge.' } };
  }
  if (Date.now() > ch.otpExpiresAt) {
    ch.status = 'expired';
    return { ok: false, status: 410, json: { error: 'otp_expired', message: 'The MFA challenge has expired. Start the transaction again.' } };
  }

  const { deviceId, otp, fido2Assertion } = params || {};
  const userAccessToken = req.session?.oauthTokens?.accessToken;

  // Demo bypass — same always-on 123123 as /oauth/user/verify-otp (stub OTP screen).
  // Previously gated on NODE_ENV !== 'production', so Docker/prod-like NODE_ENV made
  // device-list MFA reject 123123 while the old OTP-only screen still accepted it.
  if (otp && String(otp).trim() === '123123') {
    console.log(`[ConsentChallenge] MFA demo bypass accepted challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
  } else {
    try {
      let mfaResult;
      if (ch.oneTimePath) {
        // One-time OTP path: no device selection, just verify the OTP
        if (!otp) return { ok: false, status: 400, json: { error: 'missing_credential', message: 'Provide otp.' } };
        mfaResult = await mfaService.verifyOneTimeOtp(ch.daId, otp);
      } else if (fido2Assertion) {
        mfaResult = await mfaService.submitFido2Assertion(ch.daId, fido2Assertion, userAccessToken, origin);
      } else if (otp) {
        mfaResult = await mfaService.submitOtp(ch.daId, deviceId, otp, userAccessToken);
      } else {
        return { ok: false, status: 400, json: { error: 'missing_credential', message: 'Provide otp or fido2Assertion.' } };
      }
      // PingOne can return HTTP 200 with status FAILED (wrong OTP / lockout) —
      // do not promote the consent challenge unless the MFA step actually completed.
      if (mfaResult?.status && mfaResult.status !== 'COMPLETED') {
        console.warn(`[ConsentChallenge] MFA verify incomplete challenge=${challengeId.slice(0, 8)}… status=${mfaResult.status}`);
        return {
          ok: false,
          status: 400,
          json: {
            error: mfaResult.status === 'FAILED' ? 'otp_incorrect' : 'mfa_incomplete',
            message: mfaResult.status === 'FAILED'
              ? 'Incorrect code. Try again.'
              : `MFA not complete (status: ${mfaResult.status}).`,
          },
        };
      }
    } catch (err) {
      const code = err.code || 'mfa_failed';
      const msg = err.message || 'MFA verification failed.';
      const httpStatus = err.status || 400;
      console.warn(`[ConsentChallenge] MFA verify failed challenge=${challengeId.slice(0, 8)}… code=${code}`);
      return { ok: false, status: httpStatus, json: { error: code, message: msg } };
    }
  }

  // Promote to confirmed
  const now = Date.now();
  ch.status           = 'confirmed';
  ch.confirmedAt      = now;
  ch.confirmExpiresAt = now + CONFIRMED_TTL_MS;
  _grantHitlCredit(req, ch);
  _grantStepUpCredit(req);
  delete ch.otpHash;
  delete ch.otpSalt;
  delete ch.otpExpiresAt;
  delete ch.otpAttempts;

  console.log(`[ConsentChallenge] MFA verified challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
  return { ok: true, challengeId, confirmExpiresAt: ch.confirmExpiresAt };
}

/**
 * selectMfaDevice — user selects a device to receive the OTP on the PingOne MFA path.
 * Calls mfaService.selectDevice() to dispatch the OTP to the chosen device.
 *
 * @param {import('express').Request} req
 * @param {string} challengeId
 * @param {string} deviceId
 */
async function selectMfaDevice(req, challengeId, deviceId) {
  if (!challengeId) {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (!ch.mfaPath) {
    return { ok: false, status: 409, json: { error: 'not_mfa_path', message: 'This challenge does not use PingOne MFA.' } };
  }
  if (ch.status !== 'otp_pending') {
    return { ok: false, status: 409, json: { error: 'otp_not_expected', message: 'No OTP is pending for this challenge.' } };
  }
  if (Date.now() > ch.otpExpiresAt) {
    ch.status = 'expired';
    return { ok: false, status: 410, json: { error: 'otp_expired', message: 'The verification code has expired. Start the transaction again.' } };
  }
  const userAccessToken = req.session?.oauthTokens?.accessToken;
  try {
    const selected = await mfaService.selectDevice(ch.daId, deviceId, userAccessToken);
    ch.otpExpiresAt = Date.now() + OTP_TTL_MS;
    // FIDO2 devices don't get a typed code — PingOne answers ASSERTION_REQUIRED
    // with a WebAuthn challenge instead, which the client must run through
    // navigator.credentials.get() and submit as fido2Assertion to /verify-otp.
    // Passing status/options through (previously discarded) is what lets the
    // client tell the two cases apart instead of always showing a code field.
    return {
      ok: true,
      otpExpiresAt: ch.otpExpiresAt,
      status: selected?.status || null,
      publicKeyCredentialRequestOptions: selected?.publicKeyCredentialRequestOptions || null,
    };
  } catch (err) {
    console.warn(`[ConsentChallenge] selectDevice failed: ${err.message}`);
    return { ok: false, status: err.status || 502, json: { error: err.code || 'mfa_select_failed', message: err.message } };
  }
}

/**
 * verifyRecognize — validates the Recognize SDK result returned by the UI.
 * On success advances challenge to 'confirmed'. On failure signals fallback:true.
 */
async function verifyRecognize(req, challengeId, sdkResult) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (ch.status !== 'recognize_pending') {
    return { ok: false, status: 409, json: { error: 'recognize_not_expected', message: 'No face auth is pending for this challenge.' } };
  }
  if (Date.now() > ch.otpExpiresAt) {
    ch.status = 'expired';
    return { ok: false, status: 410, json: { error: 'recognize_expired', message: 'Face auth session expired. Start the transaction again.' } };
  }

  let accepted;
  try {
    accepted = await recognizeService.verifySession(ch.recognizeSessionId, sdkResult);
  } catch (err) {
    console.warn(`[ConsentChallenge] verifyRecognize error: ${err.message}`);
    accepted = false;
  }

  if (!accepted) {
    console.warn(`[ConsentChallenge] Recognize rejected challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
    return { ok: false, status: 401, fallback: true, json: { error: 'recognize_verify_failed', message: 'Face verification failed.' } };
  }

  ch.status           = 'confirmed';
  ch.confirmedAt      = Date.now();
  ch.confirmExpiresAt = Date.now() + CONFIRMED_TTL_MS;
  _grantHitlCredit(req, ch);
  console.log(`[ConsentChallenge] Recognize verified challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);
  return { ok: true };
}

/**
 * recognizeFallback — called when the UI signals the Recognize SDK failed.
 * Pivots a recognize_pending challenge to the one-time OTP path.
 */
async function recognizeFallback(req, challengeId) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'invalid_challenge', message: 'challengeId is required.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (ch.status !== 'recognize_pending') {
    return { ok: false, status: 409, json: { error: 'recognize_not_pending', message: 'Challenge is not in recognize state.' } };
  }

  // Reset to pending so the onetime path can re-use it
  ch.status        = 'pending';
  ch.recognizePath = false;

  let contact, deliveryType;
  try {
    const p = await mfaService.getPingOneUserContact(req.user.id);
    if (p.email) { deliveryType = 'EMAIL'; contact = p.email; }
    else if (p.mobilePhone) { deliveryType = 'SMS'; contact = p.mobilePhone; }
  } catch (err) {
    console.warn(`[ConsentChallenge] recognizeFallback contact lookup failed: ${err.message}`);
    return { ok: false, status: 502, json: { error: 'mfa_init_failed', message: 'Face ID unavailable and could not start backup verification. Try again.' } };
  }

  if (!contact) {
    ch.oneTimePath    = true;
    ch.pendingContact = true;
    return { ok: true, challengeId, mode: 'onetime_fallback', needsContact: true };
  }

  const otpResult = await _initiateOnetimeOtp(ch, challengeId, deliveryType, contact, req.session?.oauthTokens?.accessToken, req.user.id, Date.now());
  if (!otpResult.ok) return otpResult;
  return { ...otpResult, mode: 'onetime_fallback' };
}

/**
 * Verifies confirmed challenge matches POST body, then removes it (one-time use).
 * @returns {{ ok: true } | { ok: false, status: number, json: object }}
 */
function verifyAndConsumeChallenge(req, challengeId, postBody) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, status: 400, json: { error: 'consent_challenge_required', message: 'A valid consentChallengeId is required for this amount.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 400, json: { error: 'consent_challenge_invalid', message: 'Unknown or expired consent challenge. Complete the consent flow again.' } };
  }
  if (ch.status !== 'confirmed') {
    return { ok: false, status: 400, json: { error: 'consent_not_confirmed', message: 'Confirm the consent screen before submitting the transaction.' } };
  }
  if (ch.confirmExpiresAt < Date.now()) {
    delete st[challengeId];
    return { ok: false, status: 410, json: { error: 'consent_confirmation_expired', message: 'Confirmation expired. Open a new consent challenge from the dashboard.' } };
  }

  const postSnap = normalizeSnapshot(postBody);
  if (!snapshotsEqual(ch.snapshot, postSnap)) {
    return {
      ok: false,
      status: 400,
      json: {
        error: 'consent_payload_mismatch',
        message: 'Transaction details do not match the consent challenge. Start again from the dashboard.',
      },
    };
  }

  delete st[challengeId];
  console.log(`[ConsentChallenge] consumed challenge=${challengeId.slice(0, 8)}… user=${req.user.id}`);

  return { ok: true };
}

/**
 * getChallengePath — returns 'mfa' or 'otp' based on the challenge's mfaPath flag,
 * or null if the challenge does not exist or does not belong to the authenticated user.
 * Used by route handlers to avoid direct session shape access.
 *
 * @param {import('express').Request} req
 * @param {string} challengeId
 * @returns {'mfa' | 'otp' | null}
 */
function getChallengePath(req, challengeId) {
  if (!challengeId) return null;
  const st = req.session?.txConsentChallenges;
  if (!st || typeof st !== 'object') return null;
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user?.id) return null;
  if (ch.mfaPath) return 'mfa';
  if (ch.oneTimePath) return 'onetime';
  return 'otp';
}

/**
 * Re-run PingOne device authentication for a challenge already on the
 * device-picker path, refreshing its daId and device list.
 *
 * confirmChallenge() captures the device list once and then moves the challenge
 * to 'otp_pending', so it answers 409 if called again. That means a device the
 * user enrols *while the picker is open* (e.g. registering a passkey because
 * they have none) can never appear — the stored daId predates it. This gives
 * the UI a way to pick it up without cancelling and restarting the transfer.
 *
 * Deliberately narrow: it only refreshes daId/devices on a challenge that is
 * already mfaPath + otp_pending. It cannot start MFA, change the amount, or
 * revive a consumed challenge, so it adds no new way past the consent gate.
 *
 * @param {import('express').Request} req
 * @param {string} challengeId
 * @returns {Promise<{ok: boolean, status?: number, json?: object, challengeId?: string, devices?: Array}>}
 */
async function reinitMfaDevices(req, challengeId) {
  if (!req.user?.id) {
    return { ok: false, status: 401, json: { error: 'not_authenticated', message: 'Sign in to continue.' } };
  }
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (!ch.mfaPath || ch.status !== 'otp_pending') {
    return { ok: false, status: 409, json: { error: 'challenge_not_mfa_pending', message: 'This challenge is not awaiting device verification.' } };
  }
  if (ch.expiresAt < Date.now()) {
    delete st[challengeId];
    return { ok: false, status: 410, json: { error: 'challenge_expired', message: 'Consent challenge expired. Start again from the dashboard.' } };
  }

  let initiated;
  try {
    initiated = await mfaService.initiateDeviceAuth(req.user.id, req.session?.oauthTokens?.accessToken);
  } catch (err) {
    console.warn(`[ConsentChallenge] reinit initiateDeviceAuth failed: ${err.message}`);
    return _mfaInitFailureResult(err, req.session?.oauthTokens?.expiresAt);
  }

  ch.daId    = initiated.id;
  ch.devices = initiated._embedded?.devices || [];
  // A fresh challenge means the previous attempts no longer apply.
  ch.otpAttempts = 0;

  console.log(`[ConsentChallenge] MFA devices refreshed challenge=${challengeId.slice(0, 8)}… daId=${ch.daId} devices=${ch.devices.length}`);
  return { ok: true, challengeId, devices: ch.devices };
}

module.exports = {
  get HIGH_VALUE_CONSENT_USD() { return getConfirmThreshold(); },
  CHALLENGE_TTL_MS,
  CONFIRMED_TTL_MS,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  normalizeSnapshot,
  validateIntent,
  createChallenge,
  getChallenge,
  confirmChallenge,
  confirmChallengeViaDaVinci,
  reinitMfaDevices,
  confirmOnetimeContact,
  verifyOtp,
  verifyMfa,
  verifyRecognize,
  recognizeFallback,
  selectMfaDevice,
  getChallengePath,
  verifyAndConsumeChallenge,
};
