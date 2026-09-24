'use strict';

const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/hostedAccess');
const { validateToken } = require('./tokenValidationService');
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

function generateAuthorizationUrl({ state, codeVerifier, redirectUri, nonce, loginHint }) {
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
  return `${config.authorizationEndpoint}?${params.toString()}`;
}

async function exchangeCodeForToken(code, codeVerifier, redirectUri) {
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

async function validateIdentity(tokenData) {
  if (!tokenData?.id_token || !tokenData?.access_token) {
    const error = new Error('Hosted front-door identity response was incomplete');
    error.reasonCode = 'userinfo_failed';
    throw error;
  }
  let idTokenClaims;
  try {
    idTokenClaims = await validateToken(tokenData.id_token, {
      jwksUri: config.jwksEndpoint,
      issuer: config.issuer,
      audience: config.clientId,
    });
  } catch (error) {
    const wrapped = new Error('Hosted front-door identity validation failed', { cause: error });
    wrapped.reasonCode = 'userinfo_failed';
    throw wrapped;
  }
  try {
    const response = await axios.get(config.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      timeout: 10000,
    });
    return { idTokenClaims, userInfo: response.data };
  } catch (error) {
    const wrapped = new Error('Hosted front-door userinfo failed', { cause: sanitizeAxiosCause(error) });
    wrapped.reasonCode = 'userinfo_failed';
    throw wrapped;
  }
}

module.exports = {
  generateState,
  generateCodeVerifier,
  generateAuthorizationUrl,
  exchangeCodeForToken,
  validateIdentity,
};
