'use strict';

/**
 * PingOne client-secret rotation primitives.
 *
 * The regenerate call is verb- and content-type-sensitive: PUT returns 403 and
 * application/json returns 415, both of which read like auth failures. The old
 * secret dies the instant this returns — there is no grace period.
 */

const crypto = require('node:crypto');
const axios = require('axios');
const configStore = require('./configStore');
const { getManagementToken, WORKER_CREDENTIAL_FAMILIES } = require('./pingOneClientService');

const REGENERATE_CONTENT_TYPE = 'application/vnd.pingidentity.secret.regenerate+json';

function apiBase() {
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  return `https://api.pingone.${region}/v1/environments/${envId}`;
}

async function regenerateClientSecret(appId) {
  const token = await getManagementToken();
  const res = await axios.post(`${apiBase()}/applications/${appId}/secret`, {}, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': REGENERATE_CONTENT_TYPE },
    timeout: 20000,
  });
  const secret = res.data && res.data.secret;
  if (!secret) throw new Error('PingOne returned no secret from the regenerate call');
  return secret;
}

function fingerprint(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex').slice(0, 8);
}

/**
 * True when this app is — or could be — the credential the Management API calls
 * authenticate with. The one app this tool must never rotate.
 *
 * Checks EVERY configured credential family, not one resolveWorkerCredentials()
 * call: that helper returns the first family whose id (and, when
 * `secretRequired`, secret) is present, so resolveWorkerCredentials(false) and
 * the resolveWorkerCredentials(true) getManagementToken() actually uses can name
 * DIFFERENT apps — e.g. family 1 has an id but no secret. Guarding only one of
 * them leaves the real management-token holder rotatable.
 */
function isWorkerApp(app) {
  const ids = WORKER_CREDENTIAL_FAMILIES
    .map(([idKey]) => configStore.getEffective(idKey))
    .filter(Boolean);
  return ids.includes(app.clientId);
}

/**
 * Prove a secret is live by asking for a token.
 * `invalid_scope` / `unauthorized_client` mean the CREDENTIAL was accepted and the
 * request failed later on scope or grant type — that is a PASS, and the pair is how
 * you prove a rotated secret took effect.
 */
async function verifySecret(app, secret) {
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const tokenUrl = `https://auth.pingone.${region}/${envId}/as/token`;

  const usePost = String(app.tokenEndpointAuthMethod || '').toUpperCase() === 'CLIENT_SECRET_POST';
  let body = 'grant_type=client_credentials';
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (usePost) {
    body += `&client_id=${encodeURIComponent(app.clientId)}`
         + `&client_secret=${encodeURIComponent(secret)}`;
  } else {
    headers.Authorization = 'Basic '
      + Buffer.from(`${app.clientId}:${secret}`).toString('base64');
  }

  try {
    await axios.post(tokenUrl, body, { headers, timeout: 15000 });
    return { ok: true, code: 'token_issued' };
  } catch (err) {
    const code = (err.response && err.response.data && err.response.data.error) || 'request_failed';
    if (code === 'invalid_scope' || code === 'unauthorized_client') return { ok: true, code };
    return { ok: false, code };
  }
}

module.exports = { regenerateClientSecret, verifySecret, fingerprint, isWorkerApp };
