'use strict';
const axios = require('axios');
const configStore = require('./configStore');

// Mutex for _getDefaultMfaPolicy to prevent concurrent cache races.
// Only one request can fetch/update the cache at a time.
let _policyFetchInProgress = null;

function _authBaseUrl() {
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  return `https://auth.pingone.${region}/${envId}`;
}

function _apiBaseUrl() {
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  return `https://api.pingone.${region}/v1/environments/${envId}`;
}

async function _getWorkerToken() {
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  // Use PINGONE_WORKER_TOKEN credentials (worker app with Management API access)
  const clientId = process.env.PINGONE_WORKER_TOKEN_CLIENT_ID
    || configStore.getEffective('pingone_worker_token_client_id');
  const clientSecret = process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET
    || configStore.getEffective('pingone_worker_token_client_secret');
  const authMethod = (process.env.PINGONE_WORKER_TOKEN_AUTH_METHOD || 'basic').toLowerCase();
  if (!envId || !clientId || !clientSecret) throw new Error('PingOne worker credentials not configured (set PINGONE_WORKER_TOKEN_CLIENT_ID/SECRET)');
  const tokenUrl = `https://auth.pingone.${region}/${envId}/as/token`;
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const reqConfig = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 };
  if (authMethod === 'post') {
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
  } else {
    reqConfig.auth = { username: clientId, password: clientSecret };
  }
  const resp = await axios.post(tokenUrl, body.toString(), reqConfig);
  return resp.data.access_token;
}

let _cachedDefaultPolicyId = null;

async function _getDefaultMfaPolicy() {
  // Return cached value if available
  if (_cachedDefaultPolicyId) return _cachedDefaultPolicyId;

  // If a fetch is already in progress, wait for it to complete and return the cached value
  if (_policyFetchInProgress) {
    await _policyFetchInProgress;
    return _cachedDefaultPolicyId;
  }

  // Mark fetch as in progress
  _policyFetchInProgress = (async () => {
    try {
      // Double-check cache in case another request populated it while we were waiting
      if (_cachedDefaultPolicyId) return;

      const workerToken = await _getWorkerToken();
      const { data } = await axios.get(`${_apiBaseUrl()}/mfaPolicies`, {
        headers: { Authorization: `Bearer ${workerToken}` },
        timeout: 10000,
      });
      const policies = data._embedded?.mfaPolicies || [];
      const def = policies.find(p => p.default === true) || policies[0];
      if (!def) throw new Error('No MFA policies found in PingOne environment');
      console.log('[MFA] resolved default policy id=%s name=%s', def.id, def.name);
      _cachedDefaultPolicyId = def.id;
    } finally {
      _policyFetchInProgress = null;
    }
  })();

  await _policyFetchInProgress;
  return _cachedDefaultPolicyId;
}

function _wrapError(fnName, err) {
  const pingErr = err.response?.data;
  console.error(`[MFA] ${fnName} failed:`, pingErr || err.message);
  const e = new Error(pingErr?.message || pingErr?.detail || 'MFA operation failed');
  e.status = err.response?.status || 500;
  e.pingError = pingErr;
  // Attach semantic code for challenge lifecycle errors
  const status = err.response?.status;
  if (status === 401) e.code = 'token_expired';
  else if (status === 404 || status === 410) e.code = 'challenge_expired';
  return e;
}

/**
 * Initiate PingOne deviceAuthentications for a user.
 * Uses the user's own access token (not worker token).
 * Returns { id (daId), status, _embedded: { devices[] } }
 * Status at this point: DEVICE_SELECTION_REQUIRED
 */
async function initiateDeviceAuth(userId, userAccessToken) {
  let policyId = configStore.getEffective('pingone_mfa_policy_id');
  if (!policyId) {
    console.log('[MFA] PINGONE_MFA_POLICY_ID not set — resolving default policy from PingOne');
    try {
      policyId = await _getDefaultMfaPolicy();
    } catch (resolveErr) {
      const e = new Error('PINGONE_MFA_POLICY_ID is not configured and default policy could not be resolved: ' + resolveErr.message);
      e.status = 503;
      e.code = 'mfa_not_configured';
      throw e;
    }
  }
  try {
    const url = `${_authBaseUrl()}/deviceAuthentications`;
    const { data } = await axios.post(
      url,
      { user: { id: userId }, policy: { id: policyId } },
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    console.log('[MFA] initiated deviceAuth daId=%s status=%s', data.id, data.status);
    return data;
  } catch (err) {
    throw _wrapError('initiateDeviceAuth', err);
  }
}

/**
 * Select a device to use for authentication.
 * Body: { selectedDevice: { id: deviceId } }
 * Returns updated device authentication status.
 * Status transitions: DEVICE_SELECTION_REQUIRED → OTP_REQUIRED | ASSERTION_REQUIRED | PUSH_CONFIRMATION_REQUIRED
 */
async function selectDevice(daId, deviceId, userAccessToken) {
  try {
    const url = `${_authBaseUrl()}/deviceAuthentications/${daId}`;
    const { data } = await axios.put(
      url,
      { selectedDevice: { id: deviceId } },
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    return data;
  } catch (err) {
    throw _wrapError('selectDevice', err);
  }
}

/**
 * Submit an OTP or TOTP code for verification.
 * Body: { selectedDevice: { id: deviceId, otp: "123456" } }
 * Status transitions: OTP_REQUIRED → COMPLETED | FAILED
 */
async function submitOtp(daId, deviceId, otp, userAccessToken) {
  try {
    const url = `${_authBaseUrl()}/deviceAuthentications/${daId}`;
    const { data } = await axios.put(
      url,
      { selectedDevice: { id: deviceId, otp: String(otp) } },
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    return data;
  } catch (err) {
    throw _wrapError('submitOtp', err);
  }
}

/**
 * Poll or fetch the current device authentication status.
 * Used for:
 *   - Push: poll until COMPLETED or PUSH_CONFIRMATION_TIMED_OUT
 *   - FIDO2: retrieve publicKeyCredentialRequestOptions (status: ASSERTION_REQUIRED)
 */
async function getDeviceAuthStatus(daId, userAccessToken) {
  try {
    const url = `${_authBaseUrl()}/deviceAuthentications/${daId}`;
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${userAccessToken}` },
      timeout: 10000,
    });
    return data;
  } catch (err) {
    throw _wrapError('getDeviceAuthStatus', err);
  }
}

/**
 * Submit a FIDO2/WebAuthn assertion.
 * Body: { assertion: { ... } } — base64-encoded fields from navigator.credentials.get()
 * Status transitions: ASSERTION_REQUIRED → COMPLETED | FAILED
 */
async function submitFido2Assertion(daId, assertion, userAccessToken) {
  try {
    const url = `${_authBaseUrl()}/deviceAuthentications/${daId}`;
    const { data } = await axios.put(
      url,
      { assertion },
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return data;
  } catch (err) {
    throw _wrapError('submitFido2Assertion', err);
  }
}

/**
 * List active MFA devices for a user via Management API (worker token).
 * Used for device management UI — NOT required for the step-up challenge flow
 * (deviceAuthentications already returns devices at DEVICE_SELECTION_REQUIRED).
 */
async function listMfaDevices(userId) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices?filter=(status eq "ACTIVE")`;
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${workerToken}` },
      timeout: 10000,
    });
    return data._embedded?.devices || [];
  } catch (err) {
    throw _wrapError('listMfaDevices', err);
  }
}


/**
 * Enroll an email OTP device for a user via Management API (worker token).
 * @param {string} userId
 * @param {string} email   - User's email address to enroll
 * Returns { id, type, email, status }
 */
async function enrollEmailDevice(userId, email) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices`;
    const { data } = await axios.post(
      url,
      { type: 'EMAIL', email },
      { headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    console.log('[MFA] enrolled email device userId=%s deviceId=%s', userId, data.id);
    return data;
  } catch (err) {
    throw _wrapError('enrollEmailDevice', err);
  }
}

/**
 * Initiate FIDO2/passkey device registration for a user via Management API.
 * Returns { deviceId, publicKeyCredentialCreationOptions }
 */
async function initFido2Registration(userId) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices`;
    const { data } = await axios.post(
      url,
      { type: 'FIDO2_PLATFORM' },
      { headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    console.log('[MFA] initiated FIDO2 registration userId=%s deviceId=%s', userId, data.id);
    return { deviceId: data.id, publicKeyCredentialCreationOptions: data.publicKeyCredentialCreationOptions };
  } catch (err) {
    throw _wrapError('initFido2Registration', err);
  }
}

/**
 * Complete FIDO2/passkey device registration by sending the WebAuthn attestation.
 * Uses POST with the PingOne device-activation content-type (not PUT with application/json).
 * @param {string} userId
 * @param {string} deviceId  - from initFido2Registration
 * @param {object} attestation - base64-encoded fields from navigator.credentials.create()
 *   Must include: id, rawId, type, response.attestationObject, response.clientDataJSON
 *   The origin field is appended server-side from the configured auth base URL.
 * Returns { id, status }
 */
async function completeFido2Registration(userId, deviceId, attestation) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices/${deviceId}`;

    // PingOne device activation requires a dedicated content-type and the
    // attestation fields sent at the body root — NOT nested under { attestation }.
    // Origin must match the RP origin registered in PingOne (derived from auth base URL).
    const region = configStore.getEffective('PINGONE_REGION') || 'com';
    const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
    const origin = configStore.getEffective('PINGONE_FIDO2_ORIGIN')
      || `https://auth.pingone.${region}`;

    const body = {
      ...attestation,
      origin,
    };

    const { data } = await axios.post(
      url,
      body,
      {
        headers: {
          Authorization: `Bearer ${workerToken}`,
          'Content-Type': 'application/vnd.pingidentity.device.activate+json',
        },
        timeout: 15000,
      }
    );
    console.log('[MFA] completed FIDO2 registration userId=%s deviceId=%s status=%s', userId, deviceId, data.status);
    return data;
  } catch (err) {
    throw _wrapError('completeFido2Registration', err);
  }
}

module.exports = {
  initiateDeviceAuth,
  selectDevice,
  submitOtp,
  getDeviceAuthStatus,
  submitFido2Assertion,
  listMfaDevices,
  enrollEmailDevice,
  initFido2Registration,
  completeFido2Registration,
  // Test helper — resets the cached default policy ID (used in unit tests)
  _resetDefaultPolicyCache() { _cachedDefaultPolicyId = null; },
};
