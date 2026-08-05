/**
 * pingOneClientService.js
 *
 * Calls the PingOne Management API to create / list OAuth applications.
 * Uses a client_credentials grant with the admin (worker) client so that
 * Management-API tokens are obtained server-side and never exposed to the UI.
 *
 * Trust boundary (PingOne egress):
 * - Browser → this BFF only (/api/* with session or Bearer). The SPA does not call api.pingone or auth.pingone.
 * - Human OAuth (authorize, token, JWKS) runs in routes/oauth*.js and config/oauth*.js — must stay on the BFF.
 * - banking_mcp_server calls PingOne for token introspection / CIBA for MCP tools, then calls this API for data.
 *   Banking tools are not intended to re-implement full Management API; keep worker credentials on the BFF.
 */
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const configStore = require('./configStore');
const { authMethodOrder, isInvalidClientError } = require('./pingOneTokenAuth');

// ── Internal: build a client_assertion JWT (client_secret_jwt or private_key_jwt) ──
function buildClientAssertion(clientId, tokenUrl, authMethod, clientSecret, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientId,
    sub: clientId,
    aud: tokenUrl,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 300,
  };
  if (authMethod === 'client_secret_jwt') {
    return jwt.sign(payload, clientSecret, { algorithm: 'HS256' });
  }
  // private_key_jwt — RS256 or ES256 depending on key type
  const keyObj = crypto.createPrivateKey(privateKeyPem);
  const alg = keyObj.asymmetricKeyType === 'ec' ? 'ES256' : 'RS256';
  return jwt.sign(payload, privateKeyPem, { algorithm: alg });
}

// ── Internal: resolve the management (worker) client id + secret as a matched pair ──
// The management identity IS the worker app (client_credentials-enabled, holds the
// management role). We try credential families in order and return the first whose id
// (and secret, when required) are BOTH present, so a worker id is never paired with a
// stray management secret. The legacy PINGONE_MGMT_*/MANAGEMENT_* keys are honored only
// as a fallback: a drifted PINGONE_MGMT_CLIENT_ID pointing at a non-CC app produced live
// "Unsupported grant type: client_credentials" 400s (see PR #121); the worker always works.
function resolveWorkerCredentials(secretRequired) {
  const FAMILIES = [
    ['PINGONE_WORKER_CLIENT_ID',       'PINGONE_WORKER_CLIENT_SECRET'],
    ['PINGONE_WORKER_TOKEN_CLIENT_ID', 'PINGONE_WORKER_TOKEN_CLIENT_SECRET'],
    ['PINGONE_MGMT_CLIENT_ID',         'PINGONE_MGMT_CLIENT_SECRET'],
    ['PINGONE_MANAGEMENT_CLIENT_ID',   'PINGONE_MANAGEMENT_CLIENT_SECRET'],
  ];
  for (const [idKey, secretKey] of FAMILIES) {
    const id = configStore.getEffective(idKey);
    if (!id) continue;
    const secret = configStore.getEffective(secretKey);
    if (secretRequired && !secret) continue; // need a matching secret for this id
    return { clientId: id, clientSecret: secret || null };
  }
  return { clientId: null, clientSecret: null };
}

// ── Internal: obtain a Management-API access token ────────────────────────────
async function getManagementToken() {
  const envId   = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region  = configStore.getEffective('PINGONE_REGION') || 'com';
  const authMethod   = (configStore.getEffective('pingone_mgmt_token_auth_method') || 'basic').toLowerCase();
  const needsSecret = authMethod !== 'none' && authMethod !== 'private_key_jwt';
  const { clientId, clientSecret } = resolveWorkerCredentials(needsSecret);

  if (!envId || !clientId || (needsSecret && !clientSecret)) {
    throw new Error('PingOne management worker credentials not configured. Set pingone_worker_client_id + pingone_worker_client_secret (or pingone_mgmt_client_id + pingone_mgmt_client_secret) via the Worker App tab at /config.');
  }

  const tokenUrl = `https://auth.pingone.${region}/${envId}/as/token`;

  // Build the token request for a given client-auth method.
  const buildRequest = (method) => {
    let body = 'grant_type=client_credentials';
    const axiosConfig = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
    if (method === 'none') {
      body += `&client_id=${encodeURIComponent(clientId)}`;
    } else if (method === 'post') {
      body += `&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
    } else if (method === 'client_secret_jwt' || method === 'private_key_jwt') {
      const privateKeyPem = method === 'private_key_jwt'
        ? configStore.getEffective('pingone_mgmt_private_key')
        : null;
      if (method === 'private_key_jwt' && !privateKeyPem) {
        throw new Error('private_key_jwt selected but no private key configured. Generate or paste a PEM key in the Worker App config tab.');
      }
      const assertion = buildClientAssertion(clientId, tokenUrl, method, clientSecret, privateKeyPem);
      body += `&client_id=${encodeURIComponent(clientId)}&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer&client_assertion=${encodeURIComponent(assertion)}`;
    } else {
      // default: basic — manual base64 to avoid axios Basic-auth encoding issues with PingOne
      axiosConfig.headers['Authorization'] = 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64');
    }
    return { body, axiosConfig };
  };

  // Self-heal a basic/post mismatch (a stale pingone_mgmt_token_auth_method vs the app's
  // actual tokenEndpointAuthMethod): try the configured method, then the alternate on an
  // invalid_client rejection. JWT/none methods are explicit — no fallback.
  const order = authMethodOrder(authMethod);
  for (let i = 0; i < order.length; i++) {
    const { body, axiosConfig } = buildRequest(order[i]);
    try {
      const response = await axios.post(tokenUrl, body, axiosConfig);
      return response.data.access_token;
    } catch (err) {
      if (!(isInvalidClientError(err) && i < order.length - 1)) throw err;
    }
  }
}

// ── Map CIMD/OIDC grant_types to PingOne enum values ─────────────────────────
function mapGrantTypes(grantTypes) {
  const map = {
    authorization_code: 'AUTHORIZATION_CODE',
    implicit:           'IMPLICIT',
    client_credentials: 'CLIENT_CREDENTIALS',
    refresh_token:      'REFRESH_TOKEN',
    'urn:openid:params:grant-type:ciba': 'CIBA',
    'urn:ietf:params:oauth:grant-type:token-exchange': 'TOKEN_EXCHANGE',
  };
  return (grantTypes || ['authorization_code']).map(g => map[g] || g.toUpperCase().replace(/-/g, '_'));
}

// ── Map application_type to PingOne type ─────────────────────────────────────
function mapAppType(applicationType) {
  if (applicationType === 'native') return 'NATIVE_APP';
  if (applicationType === 'service') return 'WORKER';
  return 'WEB_APP'; // default: "web" or anything else
}

// ── Map token_endpoint_auth_method ───────────────────────────────────────────
function mapTokenAuthMethod(method) {
  if (method === 'none') return 'NONE';
  if (method === 'client_secret_post') return 'CLIENT_SECRET_POST';
  return 'CLIENT_SECRET_BASIC'; // default
}

/**
 * Create a new OAuth/OIDC application in PingOne via the Management API.
 *
 * @param {object} metadata  Client metadata (CIMD / RFC 7591 field names)
 * @returns {object}  PingOne application object including id, clientId, clientSecret
 */
async function createApplication(metadata) {
  const envId  = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const token  = await getManagementToken();

  const grantTypes   = mapGrantTypes(metadata.grant_types);
  const responseTypes = (metadata.response_types || ['code']).map(r => r.toUpperCase());

  const appPayload = {
    name:        metadata.client_name || 'CIMD Registered Client',
    description: metadata.client_description || 'Created via Client ID Metadata Document interface',
    enabled:     true,
    type:        mapAppType(metadata.application_type),
    protocol:    'OPENID_CONNECT',
    grantTypes,
    responseTypes,
    redirectUris:              metadata.redirect_uris              || [],
    postLogoutRedirectUris:    metadata.post_logout_redirect_uris  || [],
    tokenEndpointAuthMethod:   mapTokenAuthMethod(metadata.token_endpoint_auth_method),
    pkceEnforcement:           'OPTIONAL',
    refreshTokenDuration:      metadata.grant_types?.includes('refresh_token') ? 86400 : undefined,
  };

  // Remove undefined values to avoid PingOne validation errors
  Object.keys(appPayload).forEach(k => appPayload[k] === undefined && delete appPayload[k]);

  const url = `https://api.pingone.${region}/v1/environments/${envId}/applications`;
  const response = await axios.post(url, appPayload, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const app = response.data;

  // Fetch client secret separately (PingOne stores it under /secret sub-resource)
  let clientSecret = null;
  if (mapTokenAuthMethod(metadata.token_endpoint_auth_method) !== 'NONE') {
    try {
      const secretUrl = `https://api.pingone.${region}/v1/environments/${envId}/applications/${app.id}/secret`;
      const secretResp = await axios.get(secretUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      clientSecret = secretResp.data.secret;
    } catch (err) {
      // Non-fatal – secret may not be available for all app types
      console.warn('[pingOneClientService] Could not fetch client secret:', err.message);
    }
  }

  return { ...app, clientSecret };
}

/**
 * Raw OIDC application objects from PingOne (for bootstrap idempotency / matching by name).
 * @returns {Promise<object[]>}
 */
async function listOidcApplicationsRaw() {
  const envId  = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const token  = await getManagementToken();

  const url = `https://api.pingone.${region}/v1/environments/${envId}/applications?filter=protocol%20eq%20%22OPENID_CONNECT%22`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
  });

  return response.data?._embedded?.applications || [];
}

/**
 * List all OIDC applications in the PingOne environment.
 * Returns a summarised array (id, name, type, enabled, createdAt).
 */
async function listApplications() {
  const items = await listOidcApplicationsRaw();
  return items.map(a => ({
    id:        a.id,
    name:      a.name,
    type:      a.type,
    enabled:   a.enabled,
    createdAt: a.createdAt,
    protocol:  a.protocol,
  }));
}

async function cloneApplicationGrants(sourceApplicationId, targetApplicationId) {
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const token = await getManagementToken();
  const baseUrl = `https://api.pingone.${region}/v1/environments/${envId}/applications`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const response = await axios.get(`${baseUrl}/${sourceApplicationId}/grants`, {
    headers,
    timeout: 20000,
  });
  const grants = response.data?._embedded?.grants || [];
  if (grants.length === 0) {
    throw new Error('The configured AI agent application has no resource grants to clone.');
  }
  for (const grant of grants) {
    await axios.post(`${baseUrl}/${targetApplicationId}/grants`, {
      resource: { id: grant.resource.id },
      scopes: (grant.scopes || []).map(({ id }) => ({ id })),
    }, { headers, timeout: 20000 });
  }
  return grants.length;
}

async function deleteApplication(applicationId) {
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const token = await getManagementToken();
  await axios.delete(
    `https://api.pingone.${region}/v1/environments/${envId}/applications/${applicationId}`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 },
  );
}

module.exports = {
  createApplication,
  listApplications,
  listOidcApplicationsRaw,
  cloneApplicationGrants,
  deleteApplication,
  getManagementToken,
  resolveWorkerCredentials,
};
