'use strict';

/**
 * cibaService.js
 *
 * Client-Initiated Backchannel Authentication (CIBA) — OIDC CIBA Core 1.0
 *
 * Provides server-to-server backchannel auth with PingOne so that users can
 * approve out-of-band (email link or device push — configured in PingOne / DaVinci)
 * without any browser redirect.
 *
 * Exported functions:
 *   initiateBackchannelAuth(loginHint, bindingMessage, scope, acrValues)
 *     → { auth_req_id, expires_in, interval }
 *
 *   pollForTokens(authReqId)
 *     → tokens | throws { error: 'authorization_pending' | 'access_denied' | ... }
 *
 *   waitForApproval(authReqId, intervalSeconds, maxAttempts)
 *     → tokens | throws on denial / expiry
 *
 *   isEnabled()
 *     → boolean
 */

const crypto = require('crypto');
const axios = require('axios');
const oauthConfig = require('../config/oauth');
const configStore = require('./configStore');
const { logEvent: logAppEvent } = require('./appEventService');
const { decodeJwt } = require('../utils/tokenUtils');
const { validateToken } = require('./tokenValidationService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// One PingOne CIBA app per delivery channel: each app has its own DaVinci flow
// policy (email-only or SMS-only), and an auth_req_id only works with the app
// that created it, so every call must use the same channel's credentials.
const CHANNELS = Object.freeze(['email', 'sms']);
function _channel(channel) { return channel === 'sms' ? 'sms' : 'email'; }
function _clientCreds(channel) {
  return _channel(channel) === 'sms'
    ? { id: process.env.PINGONE_CIBA_SMS_CLIENT_ID, secret: process.env.PINGONE_CIBA_SMS_CLIENT_SECRET }
    : { id: process.env.PINGONE_CIBA_CLIENT_ID, secret: process.env.PINGONE_CIBA_CLIENT_SECRET };
}
/** Channels whose CIBA app credentials are configured, e.g. ['email', 'sms']. */
function availableChannels() {
  return CHANNELS.filter((c) => { const k = _clientCreds(c); return Boolean(k.id && k.secret); });
}

function _credentials(channel) {
  // A separate CIBA app is required; the login app must retain its own grants.
  const { id: clientId, secret: clientSecret } = _clientCreds(channel);
  if (!clientId || !clientSecret) {
    throw new Error(_channel(channel) === 'sms'
      ? 'CIBA SMS client credentials are not configured'
      : 'CIBA client credentials are not configured');
  }
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

function _cibaEndpoint() {
  return oauthConfig.cibaEndpoint;
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// PingOne rejects any binding_message over 8 characters (invalid_binding_message).
// A longer or empty message becomes a 6-char match code the app shows next to
// the email, so the user can compare the two.
const MAX_BINDING_MESSAGE = 8;
const VERTICAL_CODES = require('../config/cibaVerticalCodes');
function _bindingMessage(raw, verticalId) {
  const s = String(raw || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  return s.length >= 1 && s.length <= MAX_BINDING_MESSAGE
    ? s
    : (VERTICAL_CODES[verticalId] || '') + crypto.randomBytes(3).toString('hex').toUpperCase();
}

/**
 * Initiate a CIBA authentication request.
 *
 * @param {string} loginHint    User's email address or sub
 * @param {string} bindingMessage  Shown in the approval email (PingOne max 8 chars; longer/empty becomes a 6-char code)
 * @param {string} scope        Space-separated OAuth scopes (defaults to openid)
 * @param {string} [acrValues]  Accepted for compatibility but NOT sent to PingOne (it would be read as a DaVinci policy ID); the CIBA flow comes from the app's policy assignment
 * @returns {Promise<{ auth_req_id: string, expires_in: number, interval: number, binding_message: string }>}
 */
async function initiateBackchannelAuth(loginHint, bindingMessage, scope = 'openid', acrValues = '', channel = 'email', verticalId = '') {
  const endpoint = _cibaEndpoint();
  if (!endpoint) {
    throw new Error('PingOne environment not configured — cannot build CIBA endpoint');
  }

  const deliveryMode = configStore.getEffective('ciba_token_delivery_mode') || 'poll';
  const message = _bindingMessage(bindingMessage || configStore.getEffective('ciba_binding_message'), verticalId);

  const params = new URLSearchParams({
    login_hint: loginHint,
    scope,
    binding_message: message,
  });

  // acr_values is deliberately NOT forwarded: PingOne CIBA reads acr_values as a
  // DaVinci flow policy ID and 400s on anything else (e.g. the step-up ACR
  // 'Multi_Factor'). The flow comes from the app's DaVinci policy assignment.

  if (deliveryMode !== 'poll') {
    throw new Error('Only CIBA poll delivery mode is supported; configure the PingOne CIBA application for poll mode');
  }

  logAppEvent('auth_lifecycle', 'info', `CIBA: initiating backchannel auth for ${loginHint}`,
    { tag: 'ciba/initiate', metadata: { loginHint, scope, deliveryMode, hasAcrValues: !!(acrValues), bindingMessage: bindingMessage || undefined, request: { scope, deliveryMode, loginHintType: typeof loginHint, bindingMessage: bindingMessage || undefined } } });
  const response = await axios.post(endpoint, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${_credentials(channel)}`,
    },
    timeout: 10000,
  });

  // PingOne returns: { auth_req_id, expires_in, interval }
  const { auth_req_id, expires_in, interval } = response.data;
  logAppEvent('auth_lifecycle', 'info', `CIBA: auth request accepted — auth_req_id received`,
    { tag: 'ciba/initiated', metadata: { expiresIn: expires_in, interval, deliveryMode, authReqId_length: auth_req_id ? auth_req_id.length : 0 } });
  return {
    auth_req_id,
    expires_in: expires_in || 300,
    interval: interval || 5,
    binding_message: message,
  };
}

/**
 * Single poll attempt against the token endpoint.
 * Throws with err.response.data.error === 'authorization_pending' while waiting.
 *
 * @param {string} authReqId
 * @returns {Promise<object>} token response
 */
async function pollForTokens(authReqId, channel = 'email') {
  const params = new URLSearchParams({
    grant_type: 'urn:openid:params:grant-type:ciba',
    auth_req_id: authReqId,
  });

  const response = await axios.post(`${oauthConfig._base}/token`, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${_credentials(channel)}`,
    },
    timeout: 10000,
  });

  return response.data; // { access_token, id_token, refresh_token, token_type, expires_in }
}

/** Verify that the CIBA result authenticates the user who initiated the request. */
async function validateCibaIdToken(idToken, expectedSubject, requestedAcr = '', channel = 'email') {
  if (!idToken || !expectedSubject) throw new Error('CIBA identity result is incomplete');
  const claims = await validateToken(idToken, {
    jwksUri: `${oauthConfig._base}/jwks`,
    issuer: oauthConfig._base,
    audience: _clientCreds(channel).id,
  });
  if (claims.sub !== expectedSubject) throw new Error('CIBA subject does not match the initiating user');
  if (requestedAcr && !String(requestedAcr).split(/\s+/).includes(claims.acr)) {
    throw new Error('CIBA authentication context does not satisfy the requested step-up');
  }
  return claims;
}

/**
 * Poll repeatedly until the user approves or the request expires / is denied.
 *
 * @param {string} authReqId
 * @param {number} intervalSeconds  Initial poll interval (from bc-authorize response)
 * @param {number} maxAttempts      Safety ceiling (default 60 = 5 min at 5s interval)
 * @returns {Promise<object>} token set
 */
async function waitForApproval(authReqId, intervalSeconds = 5, maxAttempts = 60, channel = 'email') {
  let interval = intervalSeconds;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await _sleep(interval * 1000);

    try {
      const tokens = await pollForTokens(authReqId, channel);
      logAppEvent('auth_lifecycle', 'info', 'CIBA: tokens received after user approval',
        { tag: 'ciba/tokens-received', metadata: { jwtFullDecode: decodeJwt(tokens?.access_token) || undefined } });
      return tokens;
    } catch (err) {
      const errorCode = err.response?.data?.error;

      if (errorCode === 'authorization_pending') {
        // Normal — user hasn't tapped yet
        continue;
      }
      if (errorCode === 'slow_down') {
        // Server asking us to back off
        interval = Math.min(interval + 5, 30);
        continue;
      }
      // access_denied, expired_token, invalid_grant, etc.
      logAppEvent('auth_lifecycle', 'error', `CIBA: auth denied or failed — ${errorCode || 'unknown'}`,
        { tag: 'ciba/denied', metadata: { errorCode, attempt } });
      throw err;
    }
  }

  logAppEvent('auth_lifecycle', 'error', 'CIBA: authentication timed out',
    { tag: 'ciba/timeout', metadata: { maxAttempts } });
  throw new Error('CIBA authentication timed out — user did not respond in time');
}

/**
 * True when CIBA_ENABLED env var or configStore flag is set.
 */
function isEnabled() {
  const envFlag = process.env.CIBA_ENABLED;
  if (envFlag !== undefined) return envFlag === 'true';
  return configStore.getEffective('ciba_enabled') === 'true';
}

module.exports = {
  initiateBackchannelAuth,
  pollForTokens,
  validateCibaIdToken,
  waitForApproval,
  isEnabled,
  availableChannels,
};
