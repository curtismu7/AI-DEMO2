'use strict';

const axios = require('axios');
const crypto = require('crypto');

/**
 * Pushed Authorization Request (RFC 9126) for PingOne.
 *
 * Pre-submits authorization parameters to the /as/par endpoint and returns the
 * request_uri. The AI Agent Actor client (see docs) is configured
 * CLIENT_SECRET_POST + S256_REQUIRED + parRequirement OPTIONAL, so the push must
 * send credentials in the body, a registered redirect_uri, and a PKCE
 * code_challenge — HTTP basic or a missing challenge is rejected by PingOne.
 */

function generatePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function pushAuthorizationRequest(parEndpoint, clientId, clientSecret, authPayload, signatureMode = 'default') {
  if (!parEndpoint || !clientId || !clientSecret) {
    throw new Error('PAR requires parEndpoint, clientId, and clientSecret');
  }
  if (!authPayload.redirect_uri) {
    throw new Error('PAR requires a registered redirect_uri');
  }

  const { verifier, challenge } = generatePkce();

  try {
    const parParams = {
      client_id: clientId,
      client_secret: clientSecret,
      response_type: 'code',
      scope: authPayload.scope || 'openid profile email',
      redirect_uri: authPayload.redirect_uri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    };

    // RFC 9396 authorization_details carried inside the pushed request (RAR over
    // PAR). PingOne stores it against the request_uri; amount-cap enforcement is
    // applied by the caller against the declared intent.
    if (authPayload.authorization_details) {
      parParams.authorization_details = JSON.stringify(authPayload.authorization_details);
    }

    const response = await axios.post(
      parEndpoint,
      new URLSearchParams(parParams),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000,
      }
    );

    const { request_uri, expires_in } = response.data;
    if (!request_uri) {
      throw new Error('PAR endpoint did not return request_uri');
    }

    return {
      requestUri: request_uri,
      expiresIn: expires_in || 60,
      codeVerifier: verifier,
      timestamp: Date.now(),
    };
  } catch (err) {
    const errorDetail = err.response?.data?.error_description || err.response?.data?.error || err.message;
    throw new Error(`PAR push failed: ${errorDetail}`);
  }
}

/** @param {string|Error} errOrMsg */
function isParRedirectUriMismatch(errOrMsg) {
  const msg = typeof errOrMsg === 'string' ? errOrMsg : (errOrMsg && errOrMsg.message) || '';
  return /redirect uri mismatch/i.test(String(msg));
}

/**
 * Push PAR trying redirect_uri candidates in order. On PingOne "Redirect URI
 * mismatch", try the next known demo host before failing — covers the common
 * drift where PUBLIC_APP_URL is local.ping-devops.com but the Actor app was
 * provisioned with only api.ping.demo (and vice versa).
 *
 * Non-mismatch errors fail immediately (invalid_client, network, etc.).
 *
 * @param {string} parEndpoint
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {object} authPayloadBase payload without redirect_uri (or with a preferred one ignored)
 * @param {string[]} redirectCandidates ordered URIs to try
 * @param {string} [signatureMode]
 * @returns {Promise<object & { redirectUri: string, triedRedirects: string[], usedFallback: boolean }>}
 */
async function pushAuthorizationRequestWithRedirectFallback(
  parEndpoint,
  clientId,
  clientSecret,
  authPayloadBase,
  redirectCandidates,
  signatureMode = 'default',
) {
  const candidates = Array.from(new Set(
    (redirectCandidates || []).map((u) => String(u || '').trim()).filter(Boolean),
  ));
  if (!candidates.length) {
    throw new Error('PAR requires at least one redirect_uri candidate');
  }

  let lastErr = null;
  const tried = [];
  for (const redirect_uri of candidates) {
    tried.push(redirect_uri);
    try {
      const result = await pushAuthorizationRequest(
        parEndpoint,
        clientId,
        clientSecret,
        { ...authPayloadBase, redirect_uri },
        signatureMode,
      );
      return {
        ...result,
        redirectUri: redirect_uri,
        triedRedirects: tried,
        usedFallback: tried.length > 1,
      };
    } catch (err) {
      lastErr = err;
      if (!isParRedirectUriMismatch(err)) throw err;
    }
  }
  throw lastErr || new Error('PAR push failed: Redirect URI mismatch');
}

/**
 * Build token exchange parameters using PAR request_uri
 * Replaces inline authorization_details with request_uri
 */
function buildTokenExchangeWithPar(requestUri, subjectToken, grantType = 'urn:ietf:params:oauth:grant-type:token-exchange') {
  return {
    grant_type: grantType,
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    request_uri: requestUri,
  };
}

module.exports = {
  pushAuthorizationRequest,
  pushAuthorizationRequestWithRedirectFallback,
  isParRedirectUriMismatch,
  buildTokenExchangeWithPar,
};
