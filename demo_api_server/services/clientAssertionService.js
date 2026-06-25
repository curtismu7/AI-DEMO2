/**
 * clientAssertionService — private_key_jwt (RFC 7521/7523) client authentication.
 *
 * When ff_token_auth_private_key_jwt is ON and a private key is configured, the
 * BFF authenticates to the PingOne token endpoint with a short-lived signed JWT
 * assertion instead of a client secret. PingOne verifies the assertion against
 * the public JWK registered on the application — no secret crosses the wire.
 *
 * Mirrors the proven pattern in demo_agent_service/src/agentIdentity.ts and
 * agent_token_service/src/pingoneAgentToken.ts (_acquireViaPrivateKeyJwt).
 *
 * Scope is the BFF/admin client only (see plan): callers route through
 * resolveAuthMethod()/buildClientAssertion() via applyAdminTokenEndpointClientAuth.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const configStore = require('./configStore');

const CLIENT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const PRIVATE_KEY_JWT = 'private_key_jwt';

let _warnedNoKey = false;

/** Raw PEM (PKCS#8) private key for admin client, or '' when unconfigured. */
function getPrivateKeyPem() {
  return (configStore.getEffective('pingone_client_jwt_private_key') || '').trim();
}

/** kid stamped into the JWK and the assertion JWT header for admin client. */
function getKid() {
  return (configStore.getEffective('pingone_client_jwt_kid') || '').trim() || undefined;
}

/** Raw PEM (PKCS#8) private key for dedicated token-exchange app, or '' when unconfigured. */
function getExchangerPrivateKeyPem() {
  return (configStore.getEffective('pingone_private_key_jwt_exchanger_private_key') || '').trim();
}

/** kid stamped into the JWK and the assertion JWT header for dedicated exchanger app. */
function getExchangerKid() {
  return (configStore.getEffective('pingone_private_key_jwt_exchanger_kid') || '').trim() || undefined;
}

/** Feature flag: private_key_jwt requested. */
function isFlagOn() {
  return configStore.getEffective('ff_token_auth_private_key_jwt') === 'true';
}

/** True when the flag is on AND a private key is actually configured. */
function isPrivateKeyJwtEnabled() {
  if (!isFlagOn()) return false;
  if (getPrivateKeyPem()) return true;
  if (!_warnedNoKey) {
    _warnedNoKey = true;
    console.warn(
      '[clientAssertionService] ff_token_auth_private_key_jwt is ON but no ' +
      'pingone_client_jwt_private_key is configured — falling back to client_secret.'
    );
  }
  return false;
}

/**
 * Resolve the effective token-endpoint auth method for the BFF/admin client.
 * Returns 'private_key_jwt' when enabled, otherwise the configured basic/post.
 */
function resolveAuthMethod(configuredMethod) {
  return isPrivateKeyJwtEnabled() ? PRIVATE_KEY_JWT : configuredMethod;
}

/**
 * Build a signed client assertion JWT.
 *   iss = sub = clientId, aud = token endpoint, jti = random, exp = iat + 60.
 * Header: { alg: RS256, kid }.
 */
function buildClientAssertion(clientId, audience) {
  const pem = getPrivateKeyPem();
  if (!pem) throw new Error('private_key_jwt: no private key configured');
  if (!audience) throw new Error('private_key_jwt: missing token endpoint (aud)');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientId,
    sub: clientId,
    aud: audience,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 60,
  };
  const header = { alg: 'RS256', typ: 'JWT' };
  const kid = getKid();
  if (kid) header.kid = kid;

  return jwt.sign(payload, pem, { algorithm: 'RS256', header });
}

/**
 * Public JWK derived from the configured private key (for the read-only
 * /api/oauth/jwks teaching endpoint). Returns null when unconfigured.
 */
function getPublicJwk() {
  const pem = getPrivateKeyPem();
  if (!pem) return null;
  try {
    const jwk = crypto.createPublicKey(pem).export({ format: 'jwk' });
    const kid = getKid();
    return { ...jwk, use: 'sig', alg: 'RS256', ...(kid ? { kid } : {}) };
  } catch (err) {
    console.warn('[clientAssertionService] could not derive public JWK:', err.message);
    return null;
  }
}

/**
 * Build a signed client assertion JWT for the dedicated token-exchange app.
 * Same signature as buildClientAssertion but uses the exchanger's private key.
 */
function buildExchangerClientAssertion(clientId, audience) {
  const pem = getExchangerPrivateKeyPem();
  if (!pem) throw new Error('private_key_jwt (exchanger): no private key configured');
  if (!audience) throw new Error('private_key_jwt (exchanger): missing token endpoint (aud)');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientId,
    sub: clientId,
    aud: audience,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 60,
  };
  const header = { alg: 'RS256', typ: 'JWT' };
  const kid = getExchangerKid();
  if (kid) header.kid = kid;

  return jwt.sign(payload, pem, { algorithm: 'RS256', header });
}

/** True when the flag is on AND a dedicated exchanger private key is actually configured. */
function isExchangerPrivateKeyJwtEnabled() {
  if (configStore.getEffective('ff_private_key_jwt_token_exchange') !== 'true') return false;
  if (configStore.getEffective('pingone_private_key_jwt_exchanger_client_id') && getExchangerPrivateKeyPem()) return true;
  return false;
}

module.exports = {
  CLIENT_ASSERTION_TYPE,
  PRIVATE_KEY_JWT,
  isPrivateKeyJwtEnabled,
  resolveAuthMethod,
  buildClientAssertion,
  getPublicJwk,
  // getExchangerPrivateKeyPem intentionally not exported — private key getter has no external callers
  getExchangerKid,
  buildExchangerClientAssertion,
  isExchangerPrivateKeyJwtEnabled,
};
