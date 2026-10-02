// DaVinci flow invocation client — server-to-server API mode.
// See docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md.
'use strict';

const axios = require('axios');
const davinciConfig = require('../config/davinci');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');
const { getPingOneTokenEndpoint } = require('./oauthEndpointResolver');

const ORCHESTRATE_BASE = 'https://orchestrate-api.pingone.com/v1';

const FLOWS = {
  transactionAuthorization: () => davinciConfig.transaction,
};

async function invokeFlow(flowKey, params) {
  const resolve = FLOWS[flowKey];
  if (!resolve) {
    throw new Error(`davinciFlowClient: unknown flow "${flowKey}"`);
  }
  const { companyId, appId, flowId } = resolve();
  const url = `${ORCHESTRATE_BASE}/company/${companyId}/applications/${appId}/flows/${flowId}/start`;

  try {
    const res = await axios.post(url, params, {
      headers: {
        Authorization: `Bearer ${await _getApiToken()}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });
    return res.data;
  } catch (err) {
    throw normalizeAxiosError(err, { label: 'DaVinci flow invocation', timeoutMs: 10_000 });
  }
}

// client_credentials token for the DaVinci API client, fetched the way
// mfaService._getWorkerToken() does (PingOne token endpoint, client_secret_basic)
// and cached until shortly before expiry. Errors thrown here are already
// credential-safe; invokeFlow's normalizeAxiosError passes them through unchanged.
const TOKEN_REFRESH_MARGIN_MS = 60_000;
let _cachedToken = null;
let _cachedTokenExpiresAt = 0;

async function _getApiToken() {
  if (_cachedToken && Date.now() < _cachedTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return _cachedToken;
  }
  const clientId = davinciConfig.apiClientId;
  const clientSecret = davinciConfig.apiClientSecret;
  const tokenUrl = getPingOneTokenEndpoint();
  if (!clientId || !clientSecret || !tokenUrl) {
    const e = new Error(
      'DaVinci API client not configured. Set PINGONE_DAVINCI_API_CLIENT_ID/SECRET and the PingOne environment id.',
    );
    e.code = 'davinci_not_configured';
    e.httpStatus = 503;
    throw e;
  }
  let resp;
  try {
    resp = await axios.post(tokenUrl, 'grant_type=client_credentials', {
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    });
  } catch (err) {
    throw normalizeAxiosError(err, { label: 'DaVinci API token request', timeoutMs: 10_000 });
  }
  const token = resp.data && resp.data.access_token;
  if (!token) {
    const e = new Error('DaVinci API token request returned no access token');
    e.code = 'davinci_token_missing';
    e.httpStatus = 502;
    throw e;
  }
  _cachedToken = token;
  _cachedTokenExpiresAt = Date.now() + (Number(resp.data.expires_in) || 3600) * 1000;
  return token;
}

module.exports = { invokeFlow };
