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

const axios = require('axios');
const crypto = require('crypto');
const oauthConfig = require('../config/oauth');
const configStore = require('./configStore');
const { PINGONE_OIDC_DEFAULT_SCOPES_SPACE } = require('../config/scopes');
const { logEvent: logAppEvent } = require('./appEventService');
const { decodeJwt } = require('../utils/tokenUtils');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _credentials() {
  const clientId     = oauthConfig.clientId;
  const clientSecret = oauthConfig.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error('Admin client credentials are not configured');
  }
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

function _cibaEndpoint() {
  return oauthConfig.cibaEndpoint;
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _generateNotificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initiate a CIBA authentication request.
 *
 * @param {string} loginHint    User's email address or sub
 * @param {string} bindingMessage  Short string shown in the approval email or push (PingOne)
 * @param {string} scope        Space-separated OAuth scopes
 * @param {string} [acrValues]  ACR values for step-up (e.g. 'Multi_factor')
 * @returns {Promise<{ auth_req_id: string, expires_in: number, interval: number }>}
 */
async function initiateBackchannelAuth(loginHint, bindingMessage, scope = PINGONE_OIDC_DEFAULT_SCOPES_SPACE, acrValues = '') {
  const endpoint = _cibaEndpoint();
  if (!endpoint) {
    throw new Error('PingOne environment not configured — cannot build CIBA endpoint');
  }

  const deliveryMode = configStore.getEffective('ciba_token_delivery_mode') || 'poll';
  const message = bindingMessage
    || configStore.getEffective('ciba_binding_message')
    || 'Banking App Authentication';

  const params = new URLSearchParams({
    login_hint: loginHint,
    scope,
    binding_message: message,
  });

  if (acrValues) {
    params.set('acr_values', acrValues);
  }

  if (deliveryMode === 'ping') {
    params.set('client_notification_token', _generateNotificationToken());
    const notifyEndpoint = configStore.getEffective('ciba_notification_endpoint');
    if (notifyEndpoint) {
      params.set('client_notification_endpoint', notifyEndpoint);
    }
  }

  logAppEvent('auth_lifecycle', 'info', `CIBA: initiating backchannel auth for ${loginHint}`,
    { tag: 'ciba/initiate', metadata: { loginHint, scope, deliveryMode, hasAcrValues: !!(acrValues), bindingMessage: bindingMessage || undefined, request: { scope, deliveryMode, loginHintType: typeof loginHint, bindingMessage: bindingMessage || undefined } } });
  const response = await axios.post(endpoint, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${_credentials()}`,
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
  };
}

/**
 * Single poll attempt against the token endpoint.
 * Throws with err.response.data.error === 'authorization_pending' while waiting.
 *
 * @param {string} authReqId
 * @returns {Promise<object>} token response
 */
async function pollForTokens(authReqId) {
  const params = new URLSearchParams({
    grant_type: 'urn:openid:params:grant-type:ciba',
    auth_req_id: authReqId,
  });

  const response = await axios.post(oauthConfig.tokenEndpoint, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${_credentials()}`,
    },
    timeout: 10000,
  });

  return response.data; // { access_token, id_token, refresh_token, token_type, expires_in }
}

/**
 * Poll repeatedly until the user approves or the request expires / is denied.
 *
 * @param {string} authReqId
 * @param {number} intervalSeconds  Initial poll interval (from bc-authorize response)
 * @param {number} maxAttempts      Safety ceiling (default 60 = 5 min at 5s interval)
 * @returns {Promise<object>} token set
 */
async function waitForApproval(authReqId, intervalSeconds = 5, maxAttempts = 60) {
  let interval = intervalSeconds;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await _sleep(interval * 1000);

    try {
      const tokens = await pollForTokens(authReqId);
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
  waitForApproval,
  isEnabled,
};
