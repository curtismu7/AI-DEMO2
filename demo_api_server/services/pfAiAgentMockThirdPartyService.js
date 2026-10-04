'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const configStore = require('./configStore');
const { resolveCrossDomainConfig } = require('./pfAiAgentFeatureConfig');
const { JWT_BEARER_GRANT, verifyIdJag } = require('./pfAiAgentCrossDomainExchangeService');

// A stand-in "third-party" authorization server for the PingFederate cross-domain demo. Its one job
// is the second hop: redeem the ID-JAG PingFederate issued at the JWT-bearer grant and hand back an
// access token for the third-party resource. It checks everything a real one would (client
// authentication, grant type, scope, resource, and the ID-JAG's type, signature, issuer, audience
// and expiry) but issues an opaque token, because nothing downstream validates it.
// Off unless pf_ai_third_party_mock_enabled is true: the route answers 404 as if it did not exist.
const ID_JAG_TYP = 'oauth-id-jag+jwt';
const TOKEN_TTL_SECONDS = 300;

function scopeList(value) {
  return String(value || '').split(/\s+/).filter(Boolean);
}

function sameSecret(presented, expected) {
  const a = Buffer.from(String(presented || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The client authenticates the way the BFF is configured to (basic or post), nothing else.
function presentedClient(headers, body, method) {
  if (method === 'post') {
    return body.client_id ? { id: String(body.client_id), secret: String(body.client_secret || '') } : null;
  }
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(String(headers.authorization || ''));
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const split = decoded.indexOf(':');
  return split < 1 ? null : { id: decoded.slice(0, split), secret: decoded.slice(split + 1) };
}

const refuse = (status, error, extra = {}) => ({ status, body: { error }, ...extra });

/**
 * Returns null when the mock is off, otherwise `{ status, body }` for the token endpoint.
 * Error codes are the RFC 6749 / 7523 / 8707 ones; no detail about why an assertion failed.
 */
async function redeemIdJag({ body = {}, headers = {}, store = configStore, fetchImpl = fetch } = {}) {
  if (String(store.getEffective('pf_ai_third_party_mock_enabled') || '').toLowerCase() !== 'true') return null;

  let config;
  try { config = resolveCrossDomainConfig(store); } catch { return refuse(503, 'temporarily_unavailable'); }

  const client = presentedClient(headers, body, config.thirdPartyAuthMethod);
  if (!client || !sameSecret(client.id, config.thirdPartyClientId) || !sameSecret(client.secret, config.thirdPartyClientSecret)) {
    return refuse(401, 'invalid_client', { challenge: config.thirdPartyAuthMethod === 'basic' });
  }
  if (body.grant_type !== JWT_BEARER_GRANT) return refuse(400, 'unsupported_grant_type');

  const requested = scopeList(body.scope);
  const allowed = scopeList(config.thirdPartyScope);
  if (!requested.length || requested.some((scope) => !allowed.includes(scope))) return refuse(400, 'invalid_scope');
  if (body.resource !== config.thirdPartyResource) return refuse(400, 'invalid_target');

  const assertion = typeof body.assertion === 'string' ? body.assertion : '';
  const typ = String(jwt.decode(assertion, { complete: true })?.header?.typ || '').toLowerCase();
  if (typ !== ID_JAG_TYP) return refuse(400, 'invalid_grant');
  try {
    await verifyIdJag(assertion, config, fetchImpl);
  } catch {
    return refuse(400, 'invalid_grant');
  }

  return {
    status: 200,
    body: {
      access_token: crypto.randomBytes(32).toString('base64url'),
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      scope: requested.join(' '),
    },
  };
}

module.exports = { ID_JAG_TYP, redeemIdJag };
