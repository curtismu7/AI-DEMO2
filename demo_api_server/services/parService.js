'use strict';

const axios = require('axios');

/**
 * Pushed Authorization Request (RFC 9126) for PingOne
 * Handles pre-submission of authorization parameters and retrieval of request_uri
 */

async function pushAuthorizationRequest(parEndpoint, clientId, clientSecret, authPayload, signatureMode = 'default') {
  if (!parEndpoint || !clientId || !clientSecret) {
    throw new Error('PAR requires parEndpoint, clientId, and clientSecret');
  }

  try {
    const parParams = {
      client_id: clientId,
      response_type: 'code',
      scope: authPayload.scope || 'openid profile email',
    };

    // Add authorization_details if provided (same as RAR but submitted to PAR)
    if (authPayload.authorization_details) {
      parParams.authorization_details = JSON.stringify(authPayload.authorization_details);
    }

    // TODO: Support 3 PingOne signature modes
    // - 'default': no signature required
    // - 'require-signed': client must sign request with client_assertion_jwt
    // - 'allow-unsigned': legacy, accept unsigned
    if (signatureMode === 'require-signed') {
      // Would need to generate client_assertion_jwt here
      // For now: basic auth only
    }

    const response = await axios.post(
      parEndpoint,
      new URLSearchParams(parParams),
      {
        auth: {
          username: clientId,
          password: clientSecret,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 5000,
      }
    );

    const { request_uri, expires_in } = response.data;
    if (!request_uri) {
      throw new Error('PAR endpoint did not return request_uri');
    }

    return {
      requestUri: request_uri,
      expiresIn: expires_in || 600,
      timestamp: Date.now(),
    };
  } catch (err) {
    const errorDetail = err.response?.data?.error_description || err.response?.data?.error || err.message;
    throw new Error(`PAR push failed: ${errorDetail}`);
  }
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
  buildTokenExchangeWithPar,
};
