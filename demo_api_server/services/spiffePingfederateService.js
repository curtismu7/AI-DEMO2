'use strict';

/**
 * Live SPIFFE → PingFederate exchange (real SPIRE, real PF 13).
 *
 * Mints a JWT-SVID for this workload (the BFF) from the spiffe-helper output
 * volume via the SPIRE agent Workload API socket, then runs an RFC 8693
 * token exchange against PingFederate with the SVID as actor_token. PF's JWT
 * Token Processor 2.0 validates the SVID (issuer = SPIRE OIDC discovery
 * provider, JWKS over mkcert TLS) and lands the workload identity
 * (spiffe://bxfinance.demo/ns/ai-agents/sa/workforce-ai-agent) as the issued
 * token's `client_id` and `act.sub` (see spiffe/pingfederate/spiffe-te-atm-mapping.json).
 *
 * Unlike services/mockSpiffeWorkloadApi.js this is not a mock: the SVID comes
 * from a real SPIRE server that attested this container. Unlike the locked
 * two-exchange delegation path in agentMcpTokenService.js this is a
 * demonstration endpoint, not part of any governed delegation chain.
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const axios = require('axios');
const configStore = require('./configStore');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const SPIRE_AGENT_IMAGE = 'ghcr.io/spiffe/spire-agent:1.15.2';

function cfg(key) {
  return String(configStore.getEffective(key) || '').trim();
}

/**
 * httpsAgent carrying the mkcert dev root. NODE_EXTRA_CA_CERTS proved
 * unreliable for this chain under Node 26 (CERT_SIGNATURE_FAILURE on the
 * PingFederate listener that raw openssl and an explicit `ca` both accept),
 * so the trust anchor is explicit. In the container the same CA is already
 * in the JVM truststore for PF itself; this covers the BFF's Node calls.
 */
function pfHttpsAgent() {
  const caPath = cfg('spiffe_pf_ca_path') || '/certs/ca-bundle-with-mkcert.pem';
  let ca;
  try { ca = fs.readFileSync(caPath); } catch {
    return undefined; // fall back to the default trust store
  }
  return new https.Agent({ ca });
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

/**
 * Mint a JWT-SVID for the workforce-ai-agent workload (spiffe://bxfinance.demo/
 * ns/ai-agents/sa/workforce-ai-agent — the identity this exchange acts as, not the
 * BFF's own `bff` SVID) with the requested audience by calling
 * the SPIRE agent Workload API. The agent's docker.sock mount lets a sibling
 * container present this container's docker labels, so the same one-shot
 * `spire-agent api fetch jwt` invocation that verified the integration works
 * here. The socket volume is shared, so no extra mounts are needed.
 */
function mintJwtSvid(audience) {
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      [
        'run', '--rm',
        '-v', '/var/run/docker.sock:/var/run/docker.sock',
        '-v', 'ai-demo_spiffe-agent-socket:/agent-sock',
        '--label', 'com.ai-demo.spiffe-workload=workforce-agent',
        '--entrypoint', '/opt/spire/bin/spire-agent',
        SPIRE_AGENT_IMAGE,
        'api', 'fetch', 'jwt',
        '-audience', audience,
        '-socketPath', '/agent-sock/agent.sock',
      ],
      { timeout: 15000, maxBuffer: 1024 * 512 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`SPIRE agent Workload API call failed: ${stderr || err.message}`));
        const line = String(stdout)
          .split('\n')
          .map((l) => l.replace(/^\s+/, ''))
          .find((l) => l.startsWith('eyJ'));
        if (!line || line.split('.').length !== 3) {
          return reject(new Error('SPIRE agent did not return a JWT-SVID (is the spiffe compose profile running?)'));
        }
        resolve(line);
      },
    );
  });
}

/**
 * Run the live PF token exchange.
 * @returns {Promise<{accessToken:string, spiffeId:string, actorSpiffeId:string}>}
 */
async function exchangeWithPingFederate({ audience, scopes } = {}) {
  if (!isFlagOn('ff_spiffe_pf_exchange')) {
    const err = new Error('SPIFFE PingFederate live exchange is disabled (ff_spiffe_pf_exchange)');
    err.code = 'SPIFFE_PF_EXCHANGE_DISABLED';
    err.httpStatus = 503;
    err.isConfigError = true;
    throw err;
  }
  const issuer = cfg('spiffe_pf_issuer') || 'https://local.ping-devops.com:8443';
  const pfTokenEndpoint = cfg('spiffe_pf_token_endpoint') || 'https://local.ping-devops.com:9031/as/token.oauth2';
  const exchangeClientId = cfg('spiffe_pf_exchange_client_id');
  const exchangeClientSecret = cfg('spiffe_pf_exchange_client_secret');
  const subjectClientId = cfg('spiffe_pf_subject_client_id');
  const subjectClientSecret = cfg('spiffe_pf_subject_client_secret');
  const svidAudience = audience || cfg('spiffe_pf_svid_audience') || 'https://local.ping-devops.com:9031';

  const missing = [
    ['SPIFFE_PF_EXCHANGE_CLIENT_ID', exchangeClientId],
    ['SPIFFE_PF_EXCHANGE_CLIENT_SECRET', exchangeClientSecret],
    ['SPIFFE_PF_SUBJECT_CLIENT_ID', subjectClientId],
    ['SPIFFE_PF_SUBJECT_CLIENT_SECRET', subjectClientSecret],
  ].filter(([, v]) => !v).map(([name]) => name);
  if (missing.length) {
    const err = new Error(`SPIFFE PingFederate exchange is not configured. Missing: ${missing.join(', ')}`);
    err.code = 'SPIFFE_PF_EXCHANGE_CONFIG_INVALID';
    err.httpStatus = 503;
    err.isConfigError = true;
    err.details = { missing };
    throw err;
  }

  // 1. Subject: a client-credentials token from PF (the machine identity on
  //    whose behalf the workload acts).
  let subjectRes;
  try {
    subjectRes = await axios.post(pfTokenEndpoint, new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'mcp:invoke',
    }), { auth: { username: subjectClientId, password: subjectClientSecret }, httpsAgent: pfHttpsAgent() });
  } catch (err) {
    throw redactSecrets(normalizeAxiosError(err, { label: 'SPIFFE PF subject token request' }), [subjectClientSecret, exchangeClientSecret]);
  }
  const subjectToken = subjectRes.data.access_token;
  if (!subjectToken) throw new Error('PingFederate subject token request returned no access_token');

  // 2. Actor: a real SPIRE JWT-SVID minted for this workload.
  const svid = await module.exports.mintJwtSvid(svidAudience);
  const actorSpiffeId = JSON.parse(
    Buffer.from(svid.split('.')[1], 'base64url').toString('utf8'),
  ).sub;

  // 3. RFC 8693 exchange at PF with the SVID as actor_token.
  let exchangeRes;
  try {
    exchangeRes = await axios.post(pfTokenEndpoint, new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    actor_token: svid,
    actor_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    scope: Array.isArray(scopes) ? scopes.join(' ') : (scopes || 'mcp:invoke'),
    }), { auth: { username: exchangeClientId, password: exchangeClientSecret }, httpsAgent: pfHttpsAgent() });
  } catch (err) {
    throw redactSecrets(normalizeAxiosError(err, { label: 'SPIFFE PF token exchange' }), [subjectClientSecret, exchangeClientSecret]);
  }
  const accessToken = exchangeRes.data.access_token;
  if (!accessToken) throw new Error('PingFederate token exchange returned no access_token');

  return { accessToken, spiffeId: actorSpiffeId, actorSpiffeId, issuer };
}

module.exports = { exchangeWithPingFederate, mintJwtSvid };
