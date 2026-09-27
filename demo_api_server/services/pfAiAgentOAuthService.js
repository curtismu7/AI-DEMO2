'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const REQUEST_TIMEOUT_MS = 10_000;
const ALLOWED_ID_TOKEN_ALGORITHMS = new Set(['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']);

function oauthError(code, message, httpStatus = 502) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function endpoint(value, issuerOrigin, field) {
  let parsed;
  try { parsed = new URL(value); } catch { throw oauthError('PF_AI_DISCOVERY_INVALID', `PF ${field} is invalid`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash
    || parsed.origin !== issuerOrigin) {
    throw oauthError('PF_AI_DISCOVERY_INVALID', `PF ${field} origin is invalid`);
  }
  return parsed.toString();
}

async function responseJson(response, code, label) {
  if (!response?.ok) throw oauthError(code, `PingFederate ${label} request failed`);
  try { return await response.json(); } catch { throw oauthError(code, `PingFederate ${label} response was invalid`); }
}

async function discoverPf(config, fetchImpl = fetch) {
  let issuerUrl;
  try { issuerUrl = new URL(config.issuer); } catch { throw oauthError('PF_AI_DISCOVERY_INVALID', 'PF issuer is invalid', 503); }
  if (issuerUrl.protocol !== 'https:' || issuerUrl.username || issuerUrl.password) {
    throw oauthError('PF_AI_DISCOVERY_INVALID', 'PF issuer must use HTTPS', 503);
  }
  const response = await fetchImpl(config.discoveryEndpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const document = await responseJson(response, 'PF_AI_DISCOVERY_FAILED', 'discovery');
  if (document.issuer !== config.issuer) {
    throw oauthError('PF_AI_DISCOVERY_INVALID', 'PF discovery issuer did not match configured issuer');
  }

  const discovery = {
    issuer: document.issuer,
    authorizationEndpoint: endpoint(document.authorization_endpoint, issuerUrl.origin, 'authorization endpoint'),
    tokenEndpoint: endpoint(document.token_endpoint, issuerUrl.origin, 'token endpoint'),
    jwksUri: endpoint(document.jwks_uri, issuerUrl.origin, 'JWKS URI'),
    parEndpoint: document.pushed_authorization_request_endpoint
      ? endpoint(document.pushed_authorization_request_endpoint, issuerUrl.origin, 'PAR endpoint')
      : '',
  };
  for (const [field, configured, actual] of [
    ['authorization endpoint', config.authorizationEndpoint, discovery.authorizationEndpoint],
    ['token endpoint', config.tokenEndpoint, discovery.tokenEndpoint],
    ['JWKS URI', config.jwksUri, discovery.jwksUri],
  ]) {
    if (configured !== actual) throw oauthError('PF_AI_DISCOVERY_INVALID', `PF ${field} did not match configured endpoint`);
  }
  if (config.parEndpoint && discovery.parEndpoint && config.parEndpoint !== discovery.parEndpoint) {
    throw oauthError('PF_AI_DISCOVERY_INVALID', 'PF PAR endpoint did not match configured endpoint');
  }
  return discovery;
}

function createPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildAuthorizationUrl({ metadata, clientId, redirectUri, scope, state, nonce, challenge }) {
  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function assertExpectedDiscoveryEndpoint(config, metadata, field, actual) {
  if (actual !== config[field]) throw oauthError('PF_AI_DISCOVERY_INVALID', `PF ${field} did not match configuration`);
  return actual;
}

function verifyIdToken(idToken, { config, metadata, clientId, nonce, jwks }) {
  const decoded = jwt.decode(idToken, { complete: true });
  const header = decoded?.header;
  if (!header?.kid || !ALLOWED_ID_TOKEN_ALGORITHMS.has(header.alg)) {
    throw oauthError('PF_AI_ID_TOKEN_INVALID', 'PF ID token signing algorithm is not supported');
  }
  const expectedKty = header.alg.startsWith('RS') ? 'RSA' : 'EC';
  const jwk = jwks?.keys?.find((candidate) => candidate.kid === header.kid
    && candidate.kty === expectedKty && (!candidate.use || candidate.use === 'sig')
    && (!candidate.alg || candidate.alg === header.alg));
  if (!jwk) throw oauthError('PF_AI_ID_TOKEN_INVALID', 'PF ID token signing key was not found');
  let claims;
  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    claims = jwt.verify(idToken, publicKey, {
      algorithms: [header.alg], issuer: config.issuer, audience: clientId,
    });
  } catch {
    throw oauthError('PF_AI_ID_TOKEN_INVALID', 'PF ID token signature or claims were invalid');
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!claims.sub || claims.nonce !== nonce || !Number.isFinite(claims.exp)
    || (audiences.length > 1 && claims.azp !== clientId)) {
    throw oauthError('PF_AI_ID_TOKEN_INVALID', 'PF ID token subject, nonce, audience, or expiry was invalid');
  }
  return {
    subject: String(claims.sub),
    issuer: String(claims.iss),
    audience: audiences.map(String),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    issuedAt: Number.isFinite(claims.iat) ? new Date(claims.iat * 1000).toISOString() : null,
  };
}

async function exchangeAuthorizationCode({ config, metadata, clientId, redirectUri, code, verifier, nonce }, fetchImpl = fetch) {
  if (typeof code !== 'string' || !code || typeof verifier !== 'string' || !verifier) {
    throw oauthError('PF_AI_CIMD_CALLBACK_INVALID', 'PF authorization response was invalid', 400);
  }
  assertExpectedDiscoveryEndpoint(config, metadata, 'tokenEndpoint', metadata.tokenEndpoint);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const tokenResponse = await fetchImpl(metadata.tokenEndpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const tokens = await responseJson(tokenResponse, 'PF_AI_TOKEN_EXCHANGE_FAILED', 'token endpoint');
  if (typeof tokens.id_token !== 'string' || !tokens.id_token
    || typeof tokens.access_token !== 'string' || !tokens.access_token) {
    throw oauthError('PF_AI_TOKEN_RESPONSE_INVALID', 'PF token response did not contain required tokens');
  }
  const jwksResponse = await fetchImpl(metadata.jwksUri, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const jwks = await responseJson(jwksResponse, 'PF_AI_JWKS_FAILED', 'JWKS');
  const identity = verifyIdToken(tokens.id_token, { config, metadata, clientId, nonce, jwks });
  return {
    tokenSet: {
      accessToken: tokens.access_token,
      refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null,
      idToken: tokens.id_token,
      tokenType: typeof tokens.token_type === 'string' ? tokens.token_type : 'Bearer',
      scope: typeof tokens.scope === 'string' ? tokens.scope : '',
      expiresAt: Number.isFinite(tokens.expires_in) ? Date.now() + tokens.expires_in * 1000 : null,
      authenticatedAt: Date.now(),
      issuer: identity.issuer,
      subject: identity.subject,
    },
    identity,
  };
}

module.exports = {
  REQUEST_TIMEOUT_MS,
  oauthError,
  discoverPf,
  createPkce,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  verifyIdToken,
};
