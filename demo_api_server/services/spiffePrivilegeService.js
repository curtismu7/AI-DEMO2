'use strict';

/**
 * SPIFFE workload identity → Privilege gateway (federated agent caller).
 *
 * Privilege's Non-Human Identity (Federated Identity) object verifies a
 * caller's JWT against a registered issuer + JWKS URL, matches audience and
 * required claims, then forwards the token to the backend (Pass Agent Token).
 * That is exactly the contract a SPIRE JWT-SVID satisfies — this service
 * presents one, three ways, so the demo can compare:
 *
 *   - `raw-svid`   the SPIRE JWT-SVID itself, verbatim. sub is a spiffe:// URI
 *                  with no client_id and no act — the honest "does Privilege
 *                  verify SPIFFE directly" test.
 *   - `pf-exchanged` the token PF minted in exchange for that SVID as
 *                  actor_token (spiffePingfederateService) — carries
 *                  client_id/act.sub, mirroring the verified PF NHI pattern.
 *   - `pf-client-credentials` a plain PF client_credentials token, the
 *                  2026-11-13 verified baseline (no SPIFFE in it at all).
 *
 * Reachability constraint (documented in spiffe/README.md): the gateway must
 * fetch the registered JWKS over the public internet. The SPIRE OIDC
 * Discovery Provider currently serves only on local.ping-devops.com:8443, so
 * the remote gateway cannot verify a raw SVID until that endpoint is exposed
 * publicly (SE cluster) — expect a JWKS/issuer failure there by design.
 */

const axios = require('axios');
const configStore = require('./configStore');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const TOKEN_MODES = ['raw-svid', 'pf-exchanged', 'pf-client-credentials'];

function cfg(key) {
  return String(configStore.getEffective(key) || '').trim();
}

function isFlagOn(key) {
  return ['true', '1', 'yes', 'on'].includes(cfg(key).toLowerCase());
}

/** Rebuild an error so none of the configured client secrets survive in any
 * message, stack, or field — errors from this service can reach the browser. */
function redactSecrets(err, secrets) {
  const clean = String((err && (err.message || err)) || '');
  let message = clean.length > 2000 ? clean.slice(0, 2000) : clean;
  for (const secret of secrets) {
    if (secret && typeof secret === 'string' && message.includes(secret)) {
      message = message.split(secret).join('[redacted]');
    }
  }
  const wrapped = new Error(message);
  wrapped.code = err && err.code;
  wrapped.httpStatus = (err && err.httpStatus) || 502;
  return wrapped;
}

/** Decode the SVID payload for display; no signature trust involved. */
function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Present a workload token to the Privilege gateway's agent-app entry point
 * (Pass Agent Token). The gateway verifies it against the registered
 * Non-Human Identity, applies the agent key's grant, and forwards the call
 * to the backend MCP server.
 *
 * @param {object} opts
 * @param {string} opts.tokenMode one of TOKEN_MODES
 * @param {string} [opts.resource] gateway path the agent app is served under
 * @param {string} [opts.body] raw request body to forward
 * @param {string} [opts.mcpMethod] JSON-RPC method when body is not given
 * @param {string} [opts.audience] SVID audience override
 * @param {string[]} [opts.scopes] scope request for the PF-minted shapes
 * @returns {Promise<{tokenMode:string, token:string, claims:object,
 *   gatewayStatus:number, gatewayBody:object, gatewayUrl:string}>}
 */
async function callPrivilegeWithWorkloadIdentity({
  tokenMode,
  resource = '/mcp',
  body,
  mcpMethod,
  audience,
  scopes,
} = {}) {
  if (!isFlagOn('ff_spiffe_privilege')) {
    const err = new Error('SPIFFE Privilege gateway calls are disabled (ff_spiffe_privilege)');
    err.code = 'SPIFFE_PRIVILEGE_DISABLED';
    err.httpStatus = 503;
    err.isConfigError = true;
    throw err;
  }
  if (!TOKEN_MODES.includes(tokenMode)) {
    const err = new Error(`Unknown token mode: ${tokenMode}. Expected one of: ${TOKEN_MODES.join(', ')}`);
    err.code = 'SPIFFE_PRIVILEGE_BAD_MODE';
    err.httpStatus = 400;
    err.isConfigError = true;
    throw err;
  }

  const gatewayUrl = cfg('spiffe_privilege_gateway_url');
  if (!gatewayUrl) {
    const err = new Error('spiffe_privilege_gateway_url is not configured');
    err.code = 'SPIFFE_PRIVILEGE_CONFIG_INVALID';
    err.httpStatus = 503;
    err.isConfigError = true;
    throw err;
  }
  const gatewayEndpoint = `${gatewayUrl.replace(/\/$/, '')}${resource.startsWith('/') ? resource : `/${resource}`}`;

  // 1. Obtain the caller token for the chosen shape.
  let token;
  let issuer;
  if (tokenMode === 'raw-svid') {
    // The SVID's audience should name whoever will verify it; for the
    // gateway path that is the gateway itself, not PF's token endpoint.
    token = await module.exports.mintSvidForGateway(audience || gatewayUrl);
    issuer = 'spiffe (SPIRE OIDC discovery provider)';
  } else if (tokenMode === 'pf-exchanged') {
    const spiffePingfederateService = require('./spiffePingfederateService');
    const exchange = await spiffePingfederateService.exchangeWithPingFederate({ scopes });
    token = exchange.accessToken;
    issuer = cfg('spiffe_pf_issuer');
  } else {
    const clientId = cfg('spiffe_pf_subject_client_id');
    const clientSecret = cfg('spiffe_pf_subject_client_secret');
    if (!clientId || !clientSecret) {
      const err = new Error('SPIFFE_PF_SUBJECT_CLIENT_ID / SPIFFE_PF_SUBJECT_CLIENT_SECRET are required for the pf-client-credentials mode');
      err.code = 'SPIFFE_PRIVILEGE_CONFIG_INVALID';
      err.httpStatus = 503;
      err.isConfigError = true;
      err.details = { missing: ['SPIFFE_PF_SUBJECT_CLIENT_ID', 'SPIFFE_PF_SUBJECT_CLIENT_SECRET'] };
      throw err;
    }
    const tokenEndpoint = cfg('spiffe_pf_token_endpoint') || 'https://local.ping-devops.com:9031/as/token.oauth2';
    let res;
    try {
      res = await axios.post(tokenEndpoint, new URLSearchParams({
        grant_type: 'client_credentials',
        scope: Array.isArray(scopes) ? scopes.join(' ') : (scopes || 'mcp:invoke'),
      }), { auth: { username: clientId, password: clientSecret }, httpsAgent: require('./spiffePingfederateService').pfHttpsAgent() });
    } catch (err) {
      throw redactSecrets(normalizeAxiosError(err, { label: 'SPIFFE Privilege pf-client-credentials token request' }), [clientSecret]);
    }
    token = res.data.access_token;
    issuer = cfg('spiffe_pf_issuer');
    if (!token) throw new Error('PingFederate client_credentials request returned no access_token');
  }

  // 2. Present it as Bearer to the gateway (Pass Agent Token semantics).
  const payload = body !== undefined
    ? body
    : { jsonrpc: '2.0', id: 1, method: mcpMethod || 'tools/list', params: {} };
  let gatewayRes;
  try {
    gatewayRes = await axios.post(gatewayEndpoint, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      timeout: 30000,
      validateStatus: () => true, // the gateway's 401/403 IS the demo result
    });
  } catch (err) {
    throw normalizeAxiosError(err, { label: 'SPIFFE Privilege gateway call' });
  }

  return {
    tokenMode,
    token,
    claims: decodeJwtPayload(token),
    gatewayStatus: gatewayRes.status,
    gatewayBody: gatewayRes.data,
    gatewayUrl: gatewayEndpoint,
    issuer,
  };
}

/**
 * Mint a fresh JWT-SVID aimed at the gateway (audience = the gateway URL),
 * separate from the PF exchange's audience so the two shapes stay distinct.
 */
async function mintSvidForGateway(audience) {
  const spiffePingfederateService = require('./spiffePingfederateService');
  const svid = await spiffePingfederateService.mintJwtSvid(audience);
  if (!svid) throw new Error('SPIRE agent did not return a JWT-SVID (is the spiffe compose profile running?)');
  return svid;
}

module.exports = { callPrivilegeWithWorkloadIdentity, mintSvidForGateway, TOKEN_MODES, decodeJwtPayload };
