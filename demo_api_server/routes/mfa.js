'use strict';
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const mfaService = require('../services/mfaService');
const oauthService = require('../services/oauthService');
const posthog = require('../services/posthog');
const configStore = require('../services/configStore');

// The FIDO2 relying-party id must equal (or be a registrable suffix of) the
// origin the app is served from, or the browser rejects passkey registration
// ("'rp.id' cannot be used with the current origin"). PingOne defaults it to
// its own domain. Resolve the rp.id from the public app origin.
function resolveFido2RpId() {
  const url =
    configStore.getEffective('PUBLIC_APP_URL') ||
    configStore.getEffective('REACT_APP_CLIENT_URL') ||
    process.env.PUBLIC_APP_URL ||
    'https://demo-api-server:3001';
  try { return new URL(url).hostname; } catch { return 'demo-api-server'; }
}

const STEP_UP_TTL_MS = 5 * 60 * 1000; // 5 min step-up validity

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
router.post('/challenge', authenticateToken, async (req, res) => {
  try {
    // PingOne MFA APIs key on the PingOne user UUID (oauthId/sub), NOT the
    // local datastore id (ARCHITECTURE-TRUTH T-6). Using .id makes PingOne 404
    // the user — the cause of FIDO2/SMS enroll + device-challenge failures.
    const userId = req.session.user?.oauthId || req.session.user?.id;
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
        const retryUserId = req.session.user?.oauthId || req.session.user?.id;
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
router.put('/challenge/:daId', authenticateToken, async (req, res) => {
  try {
    const { daId } = req.params;
    const { deviceId, otp, assertion, origin } = req.body;
    const userAccessToken = req.session.oauthTokens?.accessToken;
    if (!userAccessToken) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }

    let result;
    if (assertion) {
      result = await mfaService.submitFido2Assertion(daId, assertion, userAccessToken, origin || req.headers.origin);
    } else if (otp) {
      result = await mfaService.submitOtp(daId, deviceId, otp, userAccessToken);
    } else if (deviceId) {
      result = await mfaService.selectDevice(daId, deviceId, userAccessToken);
    } else {
      return res.status(400).json({
        error: 'invalid_body',
        message: 'Provide deviceId, otp, or assertion.',
      });
    }

    const completed = result.status === 'COMPLETED';
    if (completed) {
      req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
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
router.get('/challenge/:daId/status', authenticateToken, async (req, res) => {
  try {
    const { daId } = req.params;
    const userAccessToken = req.session.oauthTokens?.accessToken;
    if (!userAccessToken) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    const result = await mfaService.getDeviceAuthStatus(daId, userAccessToken);
    const completed = result.status === 'COMPLETED';
    if (completed) {
      req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
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
router.post('/test/otp-verify', authenticateToken, async (req, res) => {
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

// GET /api/auth/mfa/devices
// List active MFA devices for the logged-in user.
// Returns devices with masked contact (email masked, phone last-4 only).
router.get('/devices', authenticateToken, async (req, res) => {
  try {
    const userId = req.session.user?.oauthId || req.session.user?.id;
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
      } else if ((type === 'SMS' || type === 'PHONE' || type === 'MOBILE_PHONE') && d.phone?.number) {
        const digits = d.phone.number.replace(/\D/g, '');
        maskedContact = digits.length >= 4 ? '***-***-' + digits.slice(-4) : d.phone.number;
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
    const userId = req.session.user?.oauthId || req.session.user?.id;
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
    const userId = req.session.user?.oauthId || req.session.user?.id;
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
    const userId = req.session.user?.oauthId || req.session.user?.id;
    const userAccessToken = req.session.oauthTokens?.accessToken;
    const { phone } = req.body;
    if (!userId) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    if (!phone) {
      return res.status(400).json({ error: 'missing_phone', message: 'Provide phone in E.164 format.' });
    }
    const device = await mfaService.enrollSmsDevice(userId, phone, userAccessToken);
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
    const userId = req.session.user?.oauthId || req.session.user?.id;
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
    const userId = req.session.user?.oauthId || req.session.user?.id;
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
    const userId = req.session.user?.oauthId || req.session.user?.id;
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
    const userId = req.session.user?.oauthId || req.session.user?.id;
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
    const userId = req.session.user?.oauthId || req.session.user?.id;
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


// GET /api/auth/mfa/ensure-fido2-rp — dry-run: show the env's FIDO2 policies and
// whether their relying-party id matches this origin (diagnostic; admin only).
router.get('/ensure-fido2-rp', authenticateToken, async (req, res) => {
  if (req.session.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_required', message: 'Admin session required.' });
  }
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
router.post('/ensure-fido2-rp', authenticateToken, async (req, res) => {
  if (req.session.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_required', message: 'Admin session required.' });
  }
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
