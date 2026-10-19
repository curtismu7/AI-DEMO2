'use strict';

const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/hostedAccess');
const { validateIdToken, assertUserInfoSubjectMatches } = require('./oidcIdTokenValidationService');
const { sanitizeAxiosCause } = require('../utils/sanitizeAxiosCause');

function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('hex');
}

function generateCodeChallenge(codeVerifier) {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
}

function generateAuthorizationUrl({ state, codeVerifier, redirectUri, nonce, loginHint, responseMode }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri || config.redirectUri,
    scope: config.scopes.join(' '),
    state,
    code_challenge: generateCodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    nonce,
  });
  if (loginHint) params.set('login_hint', loginHint);
  if (responseMode) params.set('response_mode', responseMode);
  return `${config.authorizationEndpoint}?${params.toString()}`;
}

async function exchangeCodeForToken(code, codeVerifier, redirectUri) {
  if (typeof codeVerifier !== 'string'
    || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    const error = new Error('Missing or invalid PKCE code_verifier');
    error.reasonCode = 'token_exchange_failed';
    throw error;
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: redirectUri || config.redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (config.tokenEndpointAuthMethod === 'post') {
    body.set('client_secret', config.clientSecret);
  } else if (config.tokenEndpointAuthMethod !== 'none') {
    headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
  }

  try {
    const response = await axios.post(config.tokenEndpoint, body.toString(), { headers, timeout: 10000 });
    return response.data;
  } catch (error) {
    const wrapped = new Error('Hosted front-door token exchange failed', { cause: sanitizeAxiosCause(error) });
    wrapped.reasonCode = 'token_exchange_failed';
    throw wrapped;
  }
}

async function validateIdentity(tokenData, expectedNonce) {
  if (!tokenData?.id_token || !tokenData?.access_token) {
    const error = new Error('Hosted front-door identity response was incomplete');
    error.reasonCode = 'userinfo_failed';
    throw error;
  }
  const idTokenClaims = await validateIdToken(tokenData.id_token, {
    config,
    expectedNonce,
  });
  let userInfo;
  try {
    const response = await axios.get(config.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      timeout: 10000,
    });
    userInfo = response.data;
  } catch (error) {
    const wrapped = new Error('Hosted front-door userinfo failed', { cause: sanitizeAxiosCause(error) });
    wrapped.reasonCode = 'userinfo_failed';
    throw wrapped;
  }
  assertUserInfoSubjectMatches(userInfo, idTokenClaims);
  return { idTokenClaims, userInfo };
}

module.exports = {
  generateState,
  generateCodeVerifier,
  generateAuthorizationUrl,
  exchangeCodeForToken,
  validateIdentity,
};
