'use strict';
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('../middleware/auth');
const mfaService = require('../services/mfaService');
const oauthService = require('../services/oauthService');
const posthog = require('../services/posthog');
const configStore = require('../services/configStore');
const pingOneUserService = require('../services/pingOneUserService');
const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');

/**
 * The PingOne user MFA runs against.
 *
 * MFA is always PingOne's. A PingOne session's subject already is that user.
 * A PingFederate session's subject is a PingFederate username, so the PingOne
 * account with the same username is used (PingOne matches it case-insensitively)
 * and remembered on the session. No match means there is nobody to challenge:
 * that is an error, never a fallback to the PingFederate subject.
 */
async function mfaUserId(req) {
  const user = req.session?.user;
  if (!user) return null;
  if (user.oauthProvider !== 'pingfederate') return user.oauthId || user.id;
  if (user.pingOneMfaUserId) return user.pingOneMfaUserId;
  const username = user.username || user.oauthId;
  const { user: linked } = await fetchPingOneUserByUsername(username);
  if (!linked?.id) {
    throw Object.assign(new Error(`No PingOne account matches the PingFederate user "${username}", so PingOne MFA cannot run for this sign-in.`), { status: 409, code: 'mfa_user_not_linked' });
  }
  user.pingOneMfaUserId = linked.id;
  return linked.id;
}

// ── MFA-specific rate limiting ──
// Prevents OTP brute-force: max 10 challenge submission attempts per minute per IP.
// Initiation (/challenge POST) is looser (20/min) — selecting a device triggers
// code delivery, which PingOne already rate-limits server-side.
const rateLimitDisabled = ['1', 'true', 'yes'].includes(
  String(process.env.DISABLE_RATE_LIMIT || '').toLowerCase()
);

const mfaSubmitLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'mfa_rate_limited', message: 'Too many MFA attempts. Please wait a moment before trying again.' },
  skip: () => rateLimitDisabled,
  keyGenerator: (req) => {
    // Key on session ID (per-user) when available, else IP
    return req.session?.id || req.ip;
  },
});

const mfaInitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'mfa_rate_limited', message: 'Too many MFA challenge requests. Please wait a moment.' },
  skip: () => rateLimitDisabled,
  keyGenerator: (req) => req.session?.id || req.ip,
});

// The FIDO2 relying-party id must equal (or be a registrable suffix of) the
// origin the app is served from, or the browser rejects passkey registration
// ("'rp.id' cannot be used with the current origin"). PingOne defaults it to
// its own domain. Resolve the rp.id from the public app origin.
// Honours the FIDO2_RP_ID / pingone_fido2_rp_id override, which is what lets a
// single PingOne environment serve passkeys to several origins at once (see
// mfaService.resolveRelyingPartyId).
function resolveFido2RpId() {
  const url =
    configStore.getEffective('PUBLIC_APP_URL') ||
    configStore.getEffective('REACT_APP_CLIENT_URL') ||
    process.env.PUBLIC_APP_URL ||
    'https://demo-api-server:3001';
  return mfaService.resolveRelyingPartyId(url) || 'demo-api-server';
}

const STEP_UP_TTL_MS = 5 * 60 * 1000; // 5 min step-up validity

// One-time warning: if session store is memory-only, step-up tokens do not
// survive restarts and may be lost under load. Logged once per process.
let _memoryStoreWarned = false;
function _warnIfMemoryStore(req) {
  if (_memoryStoreWarned) return;
  // express-session MemoryStore is the default when no external store is configured
  const storeName = req.sessionStore?.constructor?.name;
  if (storeName === 'MemoryStore') {
    console.warn(
      '[MFA] WARNING: Session store is in-memory (MemoryStore). MFA step-up tokens will be lost on server restart. ' +
      'Configure LMDB or another persistent session store for production reliability.'
    );
    _memoryStoreWarned = true;
  }
}

/**
 * Attempt a one-shot silent token refresh and update the session.
 * Returns the new accessToken if successful, throws if not.
 */
async function _tryRefresh(req) {
  const refreshToken = req.session?.oauthTokens?.refreshToken;
  if (!refreshToken) throw new Error('no_refresh_token');
  const tokenData = await oauthService.refreshAccessToken(refreshToken);
  req.session.oauthTokens = {
    ...req.session.oauthTokens,
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token || req.session.oauthTokens.refreshToken,
    expiresAt:    Date.now() + ((tokenData.expires_in || 3600) * 1000),
  };
  await new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve()))
  );
  return req.session.oauthTokens.accessToken;
}

// POST /api/auth/mfa/challenge
// Initiates PingOne deviceAuthentications for the logged-in user.
// Returns { daId, status, devices[] } with status DEVICE_SELECTION_REQUIRED.
router.post('/challenge', mfaInitLimiter, authenticateToken, async (req, res) => {
  try {
    // PingOne MFA APIs key on the PingOne user UUID (oauthId/sub), NOT the
    // local datastore id (ARCHITECTURE-TRUTH T-6). Using .id makes PingOne 404
    // the user — the cause of FIDO2/SMS enroll + device-challenge failures.
    const userId = await mfaUserId(req);
    const userAccessToken = req.session.oauthTokens?.accessToken;
    if (!userId || !userAccessToken) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    const result = await mfaService.initiateDeviceAuth(userId, userAccessToken);
    posthog.capture({
      distinctId: userId,
      event: 'mfa_challenge_initiated',
      properties: { da_id: result.id, device_count: result._embedded?.devices?.length || 0 },
    });
    res.json({
      daId: result.id,
      status: result.status,
      devices: result._embedded?.devices || [],
    });
  } catch (err) {
    console.error('[MFA route] POST /challenge failed:', err.message);
    if (err.code === 'challenge_expired') {
      return res.status(410).json({ error: 'challenge_expired', message: 'MFA session expired. Please start a new challenge.' });
    }
    if (err.code === 'mfa_service_auth_failed') {
      // deviceAuthentications rejected the worker token — a service/credential
      // misconfiguration. Refreshing the user session would not help.
      return res.status(502).json({ error: 'mfa_service_unavailable', message: 'MFA service is temporarily unavailable. Please try again later.', pingError: err.pingError });
    }
    if (err.code === 'token_expired') {
      try {
        const newToken = await _tryRefresh(req);
        const retryUserId = await mfaUserId(req);
        const result = await mfaService.initiateDeviceAuth(retryUserId, newToken);
        return res.json({ daId: result.id, status: result.status, devices: result._embedded?.devices || [] });
      } catch (_) {
        return res.status(401).json({ error: 'session_expired', message: 'Your session has expired. Please log in again.' });
      }
    }
    res.status(err.status || 500).json({ error: 'mfa_initiate_failed', message: err.message, pingError: err.pingError });
  }
});

// PUT /api/auth/mfa/challenge/:daId
// Dispatch based on body:
//   { deviceId }             → select device (transitions to next status)
//   { deviceId, otp }        → submit OTP code (email OTP or TOTP)
//   { assertion }            → relay FIDO2/WebAuthn assertion
// Sets req.session.stepUpVerified = true on COMPLETED.
router.put('/challenge/:daId', mfaSubmitLimiter, authOrReset, async (req, res) => {
  try {
    const { daId } = req.params;
    const { deviceId, otp, assertion, origin } = req.body;
    const reset = isResetChallenge(req);
    const userAccessToken = req.session.oauthTokens?.accessToken;
    if (!userAccessToken && !reset) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }

    let result;
    if (assertion) {
      result = await mfaService.submitFido2Assertion(daId, assertion, userAccessToken, origin || req.headers.origin);
    } else if (otp) {
      // Demo bypass — same code as stub /oauth/user/verify-otp and consent verifyMfa.
      // Device-list (PingOne) path used to call submitOtp only, so 123123 worked on
      // the old OTP-only screen but failed after picking Email/SMS from the list.
      if (!reset && String(otp).trim() === '123123') {
        console.log(`[MFA] demo bypass OTP accepted daId=${String(daId).slice(0, 8)}…`);
        result = { status: 'COMPLETED' };
      } else {
        result = await mfaService.submitOtp(daId, deviceId, otp, userAccessToken);
      }
    } else if (deviceId) {
      const pending = reset && activeReset(req);
      if (pending?.autoSent) {
        // PingOne already sent the code when it auto-selected the only device;
        // selecting again would send a second one and cancel the first.
        pending.autoSent = false;
        result = { status: 'OTP_REQUIRED' };
      } else {
        result = await mfaService.selectDevice(daId, deviceId, userAccessToken);
      }
    } else {
      return res.status(400).json({
        error: 'invalid_body',
        message: 'Provide deviceId, otp, or assertion.',
      });
    }

    const completed = result.status === 'COMPLETED';
    if (completed) {
      _warnIfMemoryStore(req);
      if (reset) activeReset(req).verified = true; else req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
      await new Promise((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
      const completedUserId = req.session.user?.id || req.user?.id;
      if (completedUserId) {
        posthog.capture({
          distinctId: completedUserId,
          event: 'mfa_challenge_completed',
          properties: { da_id: daId, method: assertion ? 'fido2' : otp ? 'otp' : 'push' },
        });
      }
    }

    res.json({ daId, status: result.status, completed });
  } catch (err) {
    console.error('[MFA route] PUT /challenge/:daId failed:', err.message);
    if (err.code === 'challenge_expired') {
      return res.status(410).json({ error: 'challenge_expired', message: 'MFA challenge has expired. Please start a new challenge.' });
    }
    if (err.code === 'mfa_service_auth_failed') {
      // Worker token rejected — a service/credential misconfiguration; refreshing the user session would not help.
      return res.status(502).json({ error: 'mfa_service_unavailable', message: 'MFA service is temporarily unavailable. Please try again later.', pingError: err.pingError });
    }
    if (err.code === 'token_expired') {
      try {
        const newToken = await _tryRefresh(req);
        const { daId } = req.params;
        const { deviceId, otp, assertion, origin } = req.body;
        let result;
        if (assertion) result = await mfaService.submitFido2Assertion(daId, assertion, newToken, origin || req.headers.origin);
        else if (otp && String(otp).trim() === '123123') result = { status: 'COMPLETED' };
        else if (otp) result = await mfaService.submitOtp(daId, deviceId, otp, newToken);
        else result = await mfaService.selectDevice(daId, deviceId, newToken);
        const completed = result.status === 'COMPLETED';
        if (completed) {
          req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
          await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
        }
        return res.json({ daId, status: result.status, completed });
      } catch (_) {
        return res.status(401).json({ error: 'session_expired', message: 'Your session has expired. Please log in again.' });
      }
    }
    res.status(err.status || 500).json({ error: 'mfa_challenge_failed', message: err.message, pingError: err.pingError });
  }
});

// GET /api/auth/mfa/challenge/:daId/status
// Poll device authentication status.
// Returns status and publicKeyCredentialRequestOptions when ASSERTION_REQUIRED (for FIDO2).
// Also sets stepUpVerified = true when COMPLETED (covers push poll completion).
router.get('/challenge/:daId/status', authOrReset, async (req, res) => {
  try {
    const { daId } = req.params;
    const reset = isResetChallenge(req);
    const userAccessToken = req.session.oauthTokens?.accessToken;
    if (!userAccessToken && !reset) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    const result = await mfaService.getDeviceAuthStatus(daId, userAccessToken);
    const completed = result.status === 'COMPLETED';
    if (completed) {
      if (reset) activeReset(req).verified = true; else req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
      await new Promise((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
    }
    res.json({
      daId,
      status: result.status,
      completed,
      publicKeyCredentialRequestOptions: result.publicKeyCredentialRequestOptions || null,
    });
  } catch (err) {
    console.error('[MFA route] GET /challenge/:daId/status failed:', err.message);
    if (err.code === 'challenge_expired') {
      return res.status(410).json({ error: 'challenge_expired', message: 'MFA challenge has expired. Please start a new challenge.' });
    }
    if (err.code === 'mfa_service_auth_failed') {
      // Worker token rejected — a service/credential misconfiguration; refreshing the user session would not help.
      return res.status(502).json({ error: 'mfa_service_unavailable', message: 'MFA service is temporarily unavailable. Please try again later.', pingError: err.pingError });
    }
    if (err.code === 'token_expired') {
      try {
        const newToken = await _tryRefresh(req);
        const { daId } = req.params;
        const result = await mfaService.getDeviceAuthStatus(daId, newToken);
        const completed = result.status === 'COMPLETED';
        if (completed) {
          req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
          await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
        }
        return res.json({ daId, status: result.status, completed, publicKeyCredentialRequestOptions: result.publicKeyCredentialRequestOptions || null });
      } catch (_) {
        return res.status(401).json({ error: 'session_expired', message: 'Your session has expired. Please log in again.' });
      }
    }
    res.status(err.status || 500).json({ error: 'mfa_status_failed', message: err.message });
  }
});

// POST /api/auth/mfa/test/otp-verify
// TEST MODE ONLY: Accept 123123 as valid OTP for testing purposes
// Logs OTP verification without hitting PingOne
router.post('/test/otp-verify', mfaSubmitLimiter, authenticateToken, async (req, res) => {
  try {
    const { daId, deviceId, otp } = req.body;
    if (!daId || !deviceId || !otp) {
      return res.status(400).json({ error: 'invalid_body', message: 'Provide daId, deviceId, and otp.' });
    }

    const timestamp = new Date().toISOString();
    const isTestOtp = String(otp) === '123123';

    console.log(`[MFA TEST MODE] ${timestamp}`);
    console.log(`[MFA TEST MODE] Received OTP verification request`);
    console.log(`[MFA TEST MODE]   daId: ${daId}`);
    console.log(`[MFA TEST MODE]   deviceId: ${deviceId}`);
    console.log(`[MFA TEST MODE]   otp: ${String(otp).slice(0, 1)}${'*'.repeat(Math.max(0, String(otp).length - 2))}${String(otp).slice(-1)}`);
    console.log(`[MFA TEST MODE]   Test OTP (123123)? ${isTestOtp ? 'YES' : 'NO'}`);

    if (isTestOtp) {
      console.log(`[MFA TEST MODE] ✓ OTP accepted (123123 test mode)`);
      req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
      await new Promise((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
      res.json({
        daId,
        status: 'COMPLETED',
        completed: true,
        testMode: true,
        message: 'Test OTP (123123) accepted'
      });
    } else {
      console.log(`[MFA TEST MODE] ✗ OTP rejected (expected 123123, got ${otp})`);
      res.status(400).json({
        error: 'invalid_otp',
        message: 'Invalid OTP. For testing, use 123123',
        testMode: true
      });
    }
  } catch (err) {
    console.error('[MFA TEST MODE] POST /test/otp-verify failed:', err.message);
    res.status(err.status || 500).json({ error: 'otp_verify_failed', message: err.message });
  }
});

// ── Forgot password (no sign-in) ──
// The BFF drives MFA and the password set with its worker token, so the caller
// needs no PingOne session. An anonymous session carries
// req.session.pwReset = { userId, daId, verified, expires }; the challenge
// routes accept it for that daId, and the reset only runs once MFA completed.
// Never touches an existing sign-in.
const PW_RESET_TTL_MS = 10 * 60 * 1000;

function activeReset(req) {
  const r = req.session?.pwReset;
  return r && r.expires > Date.now() ? r : null;
}

function isResetChallenge(req) {
  return !!req.params.daId && activeReset(req)?.daId === req.params.daId;
}

// The challenge routes serve a signed-in user or this reset session.
function authOrReset(req, res, next) {
  return isResetChallenge(req) ? next() : authenticateToken(req, res, next);
}

// POST /api/auth/mfa/forgot-password/start  { username } -> { daId, devices }
router.post('/forgot-password/start', mfaInitLimiter, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_username', message: 'Username is required.' });
    const { user } = await fetchPingOneUserByUsername(username);
    if (!user?.id) return res.status(404).json({ error: 'user_not_found', message: 'No account found for that username.' });
    const result = await mfaService.initiateDeviceAuth(user.id);
    req.session.pwReset = {
      userId: user.id, daId: result.id, verified: false, expires: Date.now() + PW_RESET_TTL_MS,
      autoSent: result.status === 'OTP_REQUIRED',
    };
    await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
    res.json({ daId: result.id, status: result.status, devices: result._embedded?.devices || [] });
  } catch (err) {
    console.error('[MFA route] POST /forgot-password/start failed:', err.message);
    res.status(err.status || 500).json({ error: 'forgot_password_failed', message: err.message });
  }
});

// POST /api/auth/mfa/forgot-password/complete  { newPassword }
router.post('/forgot-password/complete', mfaSubmitLimiter, async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ error: 'missing_password', message: 'New password is required.' });
    const reset = activeReset(req);
    if (!reset?.verified) return res.status(403).json({ error: 'mfa_required', message: 'Verify with MFA before resetting your password.' });
    delete req.session.pwReset;
    await pingOneUserService.setUserPassword(reset.userId, newPassword);
    res.json({ message: 'Password reset.' });
  } catch (err) {
    console.error('[MFA route] POST /forgot-password/complete failed:', err.message);
    res.status(err.status || 500).json({ error: 'forgot_password_failed', message: err.message });
  }
});

// GET /api/auth/mfa/devices
// List active MFA devices for the logged-in user.
// Returns devices with masked contact (email masked, phone last-4 only).
router.get('/devices', authenticateToken, async (req, res) => {
  try {
    const userId = await mfaUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    const { devices } = await mfaService.listMfaDevices(userId);

    const masked = devices.map((d) => {
      let maskedContact = null;
      const type = (d.type || '').toUpperCase();
      if (type === 'EMAIL' && d.email) {
        const [local, domain] = d.email.split('@');
        const vis = local.length > 2
          ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
          : local[0] + '*';
        maskedContact = vis + '@' + domain;
      } else if (type === 'SMS' || type === 'PHONE' || type === 'MOBILE_PHONE') {
        // PingOne returns an SMS device's number as a bare E.164 string
        // ("phone": "+19725551234"); accept the { number } shape too.
        const number = d.phone?.number || (typeof d.phone === 'string' ? d.phone : null);
        if (number) {
          const digits = number.replace(/\D/g, '');
          maskedContact = digits.length >= 4 ? '***-***-' + digits.slice(-4) : number;
        }
      } else if (type === 'TOTP') {
        maskedContact = d.nickname || d.applicationName || 'Authenticator app';
      } else if (type === 'FIDO2') {
        maskedContact = d.nickname || 'Security key / passkey';
      } else if (type === 'MOBILE') {
        maskedContact = d.name || 'PingOne mobile app';
      }
      return { id: d.id, type, maskedContact, name: d.name || d.nickname || null };
    });

    res.json({ devices: masked });
  } catch (err) {
    console.error('[MFA route] GET /devices failed:', err.message);
    res.status(err.status || 500).json({ error: 'list_devices_failed', message: err.message });
  }
});

// DELETE /api/auth/mfa/devices/:deviceId
// Remove a registered MFA device from PingOne.
router.delete('/devices/:deviceId', authenticateToken, async (req, res) => {
  try {
    const userId = await mfaUserId(req);
    const { deviceId } = req.params;
    if (!userId) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    if (!deviceId) {
      return res.status(400).json({ error: 'missing_device_id', message: 'deviceId is required.' });
    }
    await mfaService.deleteDevice(userId, deviceId);
    res.status(204).end();
  } catch (err) {
    console.error('[MFA route] DELETE /devices/:deviceId failed:', err.message);
    res.status(err.status || 500).json({ error: 'delete_device_failed', message: err.message, pingError: err.pingError });
  }
});

// PATCH /api/auth/mfa/devices/:deviceId/nickname
// Update the nickname for a registered MFA device.
router.patch('/devices/:deviceId/nickname', authenticateToken, async (req, res) => {
  try {
    const userId = await mfaUserId(req);
    const { deviceId } = req.params;
    const { nickname } = req.body;
    if (!userId) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    if (!deviceId) {
      return res.status(400).json({ error: 'missing_device_id', message: 'deviceId is required.' });
    }
    if (!nickname || typeof nickname !== 'string' || !nickname.trim()) {
      return res.status(400).json({ error: 'missing_nickname', message: 'nickname is required.' });
    }
    const updated = await mfaService.updateDeviceNickname(userId, deviceId, nickname.trim());
    res.json({ id: updated.id, nickname: updated.nickname });
  } catch (err) {
    console.error('[MFA route] PATCH /devices/:deviceId/nickname failed:', err.message);
    res.status(err.status || 500).json({ error: 'update_nickname_failed', message: err.message, pingError: err.pingError });
  }
});

// POST /api/auth/mfa/enroll/sms-init
// Enroll an SMS OTP device. Body: { phone } (E.164 format).
// PingOne sends an OTP to the phone — complete with /enroll/sms-complete.
router.post('/enroll/sms-init', authenticateToken, async (req, res) => {
  try {
    // PingOne MFA APIs key on the PingOne user UUID (oauthId/sub), NOT the
    // local datastore id (ARCHITECTURE-TRUTH T-6). Using .id makes PingOne 404
    // the user — the cause of FIDO2/SMS enroll + device-challenge failures.
    const userId = await mfaUserId(req);
    const userAccessToken = req.session.oauthTokens?.accessToken;
    const { phone } = req.body;
    if (!userId) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    if (!phone) {
      return res.status(400).json({ error: 'missing_phone', message: 'Provide phone in E.164 format.' });
    }
    // Normalize a bare 10-digit NANP number to E.164 (+1) — the UI accepts
    // "9725231586" and PingOne would otherwise store it without a country code.
    const digits = phone.replace(/[\s()-]/g, '');
    const normalizedPhone = /^\d{10}$/.test(digits) ? `+1${digits}` : phone;
    const device = await mfaService.enrollSmsDevice(userId, normalizedPhone, userAccessToken);
    res.json({ deviceId: device.id, type: device.type, phone: device.phone, status: device.status });
  } catch (err) {
    console.error('[MFA route] POST /enroll/sms-init failed:', err.message);
    res.status(err.status || 500).json({ error: 'enroll_sms_init_failed', message: err.message, pingError: err.pingError });
  }
});

// POST /api/auth/mfa/enroll/sms-complete
// Activate SMS device by submitting the OTP texted to the phone.
// Body: { deviceId, otp }
router.post('/enroll/sms-complete', authenticateToken, async (req, res) => {
  try {
    // PingOne MFA APIs key on the PingOne user UUID (oauthId/sub), NOT the
    // local datastore id (ARCHITECTURE-TRUTH T-6). Using .id makes PingOne 404
    // the user — the cause of FIDO2/SMS enroll + device-challenge failures.
    const userId = await mfaUserId(req);
    const { deviceId, otp } = req.body;
    if (!userId) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    if (!deviceId || !otp) {
      return res.status(400).json({ error: 'invalid_body', message: 'Provide deviceId and otp.' });
    }
    const result = await mfaService.completeSmsEnrollment(userId, deviceId, otp);
    posthog.capture({ distinctId: userId, event: 'mfa_device_enrolled', properties: { device_type: 'sms' } });
    res.json({ deviceId: result.id, status: result.status });
  } catch (err) {
    console.error('[MFA route] POST /enroll/sms-complete failed:', err.message);
    res.status(err.status || 500).json({ error: 'enroll_sms_complete_failed', message: err.message, pingError: err.pingError });
  }
});

// POST /api/auth/mfa/enroll/email
// Enroll an email OTP device for the logged-in user.
// Email is taken from the session user object.
// Returns { deviceId, type, email }
router.post('/enroll/email', authenticateToken, async (req, res) => {
  try {
    const userId = await mfaUserId(req);
    const email = req.body.email || req.session.user?.email;
    if (!userId || !email) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    const device = await mfaService.enrollEmailDevice(userId, email);
    posthog.capture({ distinctId: userId, event: 'mfa_device_enrolled', properties: { device_type: 'email' } });
    res.json({ deviceId: device.id, type: device.type, email: device.email });
  } catch (err) {
    console.error('[MFA route] POST /enroll/email failed:', err.message);
    res.status(err.status || 500).json({ error: 'enroll_failed', message: err.message, pingError: err.pingError });
  }
});

// POST /api/auth/mfa/enroll/email/verify
// Activate an email OTP device by submitting the OTP sent to the enrolled address.
// Body: { deviceId, otp }
// Returns { deviceId, status }
router.post('/enroll/email/verify', authenticateToken, async (req, res) => {
  try {
    const userId = await mfaUserId(req);
    const { deviceId, otp } = req.body;
    if (!userId) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    if (!deviceId || !otp) {
      return res.status(400).json({ error: 'invalid_body', message: 'deviceId and otp are required.' });
    }
    const result = await mfaService.completeEmailEnrollment(userId, deviceId, otp);
    res.json({ deviceId: result.id, status: result.status });
  } catch (err) {
    console.error('[MFA route] POST /enroll/email/verify failed:', err.message);
    const status = err.status || (err.pingError?.code === 'INVALID_OTP' ? 422 : 500);
    res.status(status).json({ error: 'verify_failed', message: err.message, pingError: err.pingError });
  }
});

// POST /api/auth/mfa/enroll/fido2-init
// Initiate FIDO2/passkey device registration.
// Returns { deviceId, publicKeyCredentialCreationOptions }
// Browser calls navigator.credentials.create(publicKeyCredentialCreationOptions)
// then sends result to /enroll/fido2-complete.
router.post('/enroll/fido2-init', authenticateToken, async (req, res) => {
  try {
    // PingOne MFA APIs key on the PingOne user UUID (oauthId/sub), NOT the
    // local datastore id (ARCHITECTURE-TRUTH T-6). Using .id makes PingOne 404
    // the user — the cause of FIDO2/SMS enroll + device-challenge failures.
    const userId = await mfaUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    const result = await mfaService.initFido2Registration(userId);
    res.json(result);
  } catch (err) {
    console.error('[MFA route] POST /enroll/fido2-init failed:', err.message);
    res.status(err.status || 500).json({ error: 'enroll_fido2_init_failed', message: err.message, pingError: err.pingError });
  }
});

// POST /api/auth/mfa/enroll/fido2-complete
// Complete FIDO2/passkey registration by submitting the WebAuthn attestation.
// Body: { deviceId, attestation, origin }
// Returns { deviceId, status }
router.post('/enroll/fido2-complete', authenticateToken, async (req, res) => {
  try {
    // PingOne MFA APIs key on the PingOne user UUID (oauthId/sub), NOT the
    // local datastore id (ARCHITECTURE-TRUTH T-6). Using .id makes PingOne 404
    // the user — the cause of FIDO2/SMS enroll + device-challenge failures.
    const userId = await mfaUserId(req);
    const { deviceId, attestation, origin } = req.body;
    if (!userId) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    if (!deviceId || !attestation) {
      return res.status(400).json({ error: 'invalid_body', message: 'Provide deviceId and attestation.' });
    }
    // origin MUST be the browser origin the WebAuthn ceremony ran at (the value
    // signed into clientDataJSON). PingOne rejects an origin mismatch — the #1
    // FIDO2 failure. Forward the client origin (header as fallback); only then
    // does mfaService's configStore/env default apply.
    const result = await mfaService.completeFido2Registration(
      userId, deviceId, attestation, origin || req.headers.origin,
    );
    posthog.capture({ distinctId: userId, event: 'mfa_device_enrolled', properties: { device_type: 'fido2' } });
    res.json({ deviceId: result.id, status: result.status });
  } catch (err) {
    console.error('[MFA route] POST /enroll/fido2-complete failed:', err.message);
    res.status(err.status || 500).json({
      error: 'enroll_fido2_complete_failed',
      message: err.message,
      pingError: err.pingError || err.response?.data || err._debug?.response || null,
    });
  }
});


// Named (not inline) so lib/openapiFromRoutes.js can see it via AUTH_MIDDLEWARE
// and document these routes as admin-gated. Reads the SESSION user, as the
// inline check did. async so a throw stays a rejected promise, exactly as it
// was inside the async handlers.
async function requireMfaAdminSession(req, res, next) {
  if (req.session.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_required', message: 'Admin session required.' });
  }
  next();
}

// GET /api/auth/mfa/ensure-fido2-rp — dry-run: show the env's FIDO2 policies and
// whether their relying-party id matches this origin (diagnostic; admin only).
router.get('/ensure-fido2-rp', authenticateToken, requireMfaAdminSession, async (req, res) => {
  try {
    const rpId = resolveFido2RpId();
    const result = await mfaService.ensureFido2RelyingParty(rpId, { dryRun: true });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'ensure_fido2_rp_failed', message: err.message, pingError: err.response?.data });
  }
});

// POST /api/auth/mfa/ensure-fido2-rp — apply: set the FIDO2 policy relying-party
// id to this origin so passkey registration works (admin only).
router.post('/ensure-fido2-rp', authenticateToken, requireMfaAdminSession, async (req, res) => {
  try {
    const rpId = req.body?.rpId || resolveFido2RpId();
    const result = await mfaService.ensureFido2RelyingParty(rpId);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'ensure_fido2_rp_failed', message: err.message, pingError: err.response?.data });
  }
});

module.exports = router;
module.exports.resolveFido2RpId = resolveFido2RpId;
