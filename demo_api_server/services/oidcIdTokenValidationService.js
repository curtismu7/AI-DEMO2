'use strict';

const jwt = require('jsonwebtoken');
const { validateToken } = require('./tokenValidationService');

const ALLOWED_ID_TOKEN_ALGORITHMS = Object.freeze([
  'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512',
]);
const CLOCK_SKEW_SECONDS = 60;

function validationError(reasonCode) {
  const error = new Error('OIDC identity validation failed');
  error.reasonCode = reasonCode;
  return error;
}

async function validateIdToken(idToken, {
  config,
  expectedNonce,
  maxAgeSeconds,
  expectedAcr,
} = {}) {
  if (typeof idToken !== 'string' || !idToken) {
    throw validationError('id_token_missing');
  }
  if (typeof expectedNonce !== 'string' || !expectedNonce) {
    throw validationError('nonce_missing');
  }

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header || !ALLOWED_ID_TOKEN_ALGORITHMS.includes(decoded.header.alg)) {
    throw validationError('id_token_invalid');
  }
  if (!config?.jwksEndpoint || !config?.issuer || !config?.clientId) {
    throw validationError('id_token_validation_unconfigured');
  }

  let claims;
  try {
    claims = await validateToken(idToken, {
      jwksUri: config.jwksEndpoint,
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ALLOWED_ID_TOKEN_ALGORITHMS,
    });
  } catch (_error) {
    throw validationError('id_token_invalid');
  }

  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw validationError('id_token_invalid');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== config.issuer
    || typeof claims.sub !== 'string'
    || !claims.sub
    || claims.sub.length > 255
    || !/^[\x00-\x7F]+$/.test(claims.sub)
    || !Number.isFinite(claims.exp)
    || claims.exp <= nowSeconds
    || !Number.isFinite(claims.iat)
    || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS
    || !audiences.includes(config.clientId)
    || (audiences.length > 1 && claims.azp !== config.clientId)
    || (claims.azp !== undefined && claims.azp !== config.clientId)) {
    throw validationError('id_token_invalid');
  }

  if (typeof claims.nonce !== 'string' || !claims.nonce) {
    throw validationError('nonce_missing');
  }
  if (claims.nonce !== expectedNonce) {
    throw validationError('nonce_mismatch');
  }

  if (maxAgeSeconds !== undefined) {
    if (!Number.isFinite(claims.auth_time)) {
      throw validationError('auth_time_missing');
    }
    const authenticationAge = nowSeconds - claims.auth_time;
    if (authenticationAge < -CLOCK_SKEW_SECONDS
      || authenticationAge > maxAgeSeconds + CLOCK_SKEW_SECONDS) {
      throw validationError('authentication_too_old');
    }
  }

  const requestedAcrValues = typeof expectedAcr === 'string'
    ? expectedAcr.trim().split(/\s+/).filter(Boolean)
    : [];
  if (requestedAcrValues.length > 0 && !requestedAcrValues.includes(claims.acr)) {
    throw validationError('stepup_acr_mismatch');
  }

  return claims;
}

function assertUserInfoSubjectMatches(userInfo, idTokenClaims) {
  if (typeof userInfo?.sub !== 'string'
    || !userInfo.sub
    || userInfo.sub !== idTokenClaims?.sub) {
    throw validationError('userinfo_subject_mismatch');
  }
}

module.exports = {
  ALLOWED_ID_TOKEN_ALGORITHMS,
  validateIdToken,
  assertUserInfoSubjectMatches,
};
