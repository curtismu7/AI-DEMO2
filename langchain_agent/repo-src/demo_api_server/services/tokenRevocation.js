/**
 * Token Revocation Service - RFC 7009
 * Implements OAuth 2.0 Token Revocation for secure logout
 */

const axios = require('axios');
const { logger } = require('../utils/logger');


/**
 * Revoke a token with PingOne
 * @param {string} token - Access or refresh token to revoke
 * @param {string} tokenTypeHint - 'access_token' or 'refresh_token'
 * @param {string} clientId - OAuth client ID
 * @param {string} clientSecret - OAuth client secret
 * @returns {Promise<boolean>} True if revocation succeeded
 */
async function revokeToken(token, tokenTypeHint = 'access_token', clientId, clientSecret) {
  const revocationEndpoint = process.env.PINGONE_REVOCATION_ENDPOINT;
  
  if (!revocationEndpoint) {
    logger.error('Token revocation endpoint not configured');
    throw new Error('PINGONE_REVOCATION_ENDPOINT not configured');
  }

  if (!clientId || !clientSecret) {
    logger.error('Client credentials not provided for revocation');
    throw new Error('Client credentials required for token revocation');
  }

  try {
    logger.info('Revoking token', { 
      tokenTypeHint,
      endpoint: revocationEndpoint,
      clientId 
    });

    const response = await axios.post(
      revocationEndpoint,
      new URLSearchParams({
        token,
        token_type_hint: tokenTypeHint
      }),
      {
        auth: {
          username: clientId,
          password: clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 5000,
        // RFC 7009 §2.2: The authorization server responds with HTTP 200
        // whether the token was revoked or not (prevents token scanning)
        validateStatus: (status) => status === 200
      }
    );

    logger.info('Token revocation successful', { 
      tokenTypeHint,
      status: response.status 
    });

    return true;
  } catch (error) {
    logger.error('Token revocation failed', {
      error: error.message,
      tokenTypeHint,
      status: error.response?.status
    });

    // RFC 7009 §2.2.1: If the server responds with an error,
    // the client should still consider the token invalid
    if (error.response?.status === 200) {
      return true;
    }

    throw error;
  }
}

/**
 * Revoke both access and refresh tokens
 * @param {string} accessToken - Access token to revoke
 * @param {string} refreshToken - Refresh token to revoke (optional)
 * @param {string} clientId - OAuth client ID
 * @param {string} clientSecret - OAuth client secret
 * @returns {Promise<object>} Revocation results
 */
async function revokeTokens(accessToken, refreshToken, clientId, clientSecret) {
  const results = {
    accessTokenRevoked: false,
    refreshTokenRevoked: false,
    errors: []
  };

  // Revoke access token
  if (accessToken) {
    try {
      await revokeToken(accessToken, 'access_token', clientId, clientSecret);
      results.accessTokenRevoked = true;
    } catch (error) {
      results.errors.push({
        type: 'access_token',
        error: error.message
      });
      logger.warn('Access token revocation failed but continuing', { 
        error: error.message 
      });
    }
  }

  // Revoke refresh token
  if (refreshToken) {
    try {
      await revokeToken(refreshToken, 'refresh_token', clientId, clientSecret);
      results.refreshTokenRevoked = true;
    } catch (error) {
      results.errors.push({
        type: 'refresh_token',
        error: error.message
      });
      logger.warn('Refresh token revocation failed but continuing', { 
        error: error.message 
      });
    }
  }

  return results;
}

/**
 * Revoke session tokens on logout
 * @param {object} session - Express session object
 * @param {string} clientId - OAuth client ID
 * @param {string} clientSecret - OAuth client secret
 * @returns {Promise<object>} Revocation results
 */
async function revokeSessionTokens(session, clientId, clientSecret) {
  const accessToken = session.accessToken;
  const refreshToken = session.refreshToken;

  if (!accessToken && !refreshToken) {
    logger.warn('No tokens found in session to revoke');
    return {
      accessTokenRevoked: false,
      refreshTokenRevoked: false,
      errors: []
    };
  }

  return revokeTokens(accessToken, refreshToken, clientId, clientSecret);
}

module.exports = {
  revokeToken,
  revokeTokens,
  revokeSessionTokens
};
