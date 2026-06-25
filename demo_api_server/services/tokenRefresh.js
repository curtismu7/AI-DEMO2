/**
 * Token Refresh Service
 * Implements automatic token refresh with rotation per RFC 6749 best practices
 */

const axios = require('axios');
const { logger } = require('../utils/logger');


/**
 * Refresh an access token using a refresh token
 * @param {string} refreshToken - Refresh token
 * @param {string} clientId - OAuth client ID
 * @param {string} clientSecret - OAuth client secret
 * @param {string} scope - Optional scope to request
 * @returns {Promise<object>} New token set
 */
async function refreshAccessToken(refreshToken, clientId, clientSecret, scope = null) {
  const tokenEndpoint = process.env.PINGONE_TOKEN_ENDPOINT;
  
  if (!tokenEndpoint) {
    throw new Error('PINGONE_TOKEN_ENDPOINT not configured');
  }

  if (!refreshToken) {
    throw new Error('Refresh token required');
  }

  if (!clientId || !clientSecret) {
    throw new Error('Client credentials required for token refresh');
  }

  try {
    logger.info('Refreshing access token', { clientId });

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });

    if (scope) {
      params.set('scope', scope);
    }

    const response = await axios.post(
      tokenEndpoint,
      params,
      {
        auth: {
          username: clientId,
          password: clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    const tokens = response.data;
    
    logger.info('Token refresh successful', {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken, // Use new refresh token if provided (rotation)
      idToken: tokens.id_token,
      expiresIn: tokens.expires_in,
      tokenType: tokens.token_type,
      scope: tokens.scope,
      issuedAt: Date.now()
    };
  } catch (error) {
    logger.error('Token refresh failed', {
      error: error.message,
      status: error.response?.status,
      errorCode: error.response?.data?.error
    });

    // Check if refresh token is invalid/expired
    const errorCode = error.response?.data?.error;
    if (errorCode === 'invalid_grant' || errorCode === 'invalid_token') {
      const enhancedError = new Error('Refresh token is invalid or expired');
      enhancedError.code = 'REFRESH_TOKEN_EXPIRED';
      enhancedError.requiresReauth = true;
      throw enhancedError;
    }

    throw error;
  }
}

/**
 * Refresh session tokens and update session
 * @param {object} session - Express session object
 * @param {string} clientId - OAuth client ID
 * @param {string} clientSecret - OAuth client secret
 * @returns {Promise<object>} Updated token set
 */
async function refreshSessionTokens(session, clientId, clientSecret) {
  const refreshToken = session.oauthTokens?.refreshToken || session.refreshToken;
  
  if (!refreshToken) {
    throw new Error('No refresh token in session');
  }

  const newTokens = await refreshAccessToken(refreshToken, clientId, clientSecret);
  
  // Update session with new tokens
  if (session.oauthTokens) {
    session.oauthTokens.accessToken = newTokens.accessToken;
    session.oauthTokens.refreshToken = newTokens.refreshToken;
    session.oauthTokens.idToken = newTokens.idToken;
    session.oauthTokens.expiresIn = newTokens.expiresIn;
    session.oauthTokens.issuedAt = newTokens.issuedAt;
  } else {
    session.accessToken = newTokens.accessToken;
    session.refreshToken = newTokens.refreshToken;
    session.idToken = newTokens.idToken;
    session.expiresIn = newTokens.expiresIn;
    session.issuedAt = newTokens.issuedAt;
  }

  return newTokens;
}

/**
 * Check if token needs refresh (within 5 minutes of expiry)
 * @param {object} session - Express session object
 * @param {number} bufferSeconds - Seconds before expiry to refresh (default: 300 = 5 minutes)
 * @returns {boolean} True if token should be refreshed
 */
function shouldRefreshToken(session, bufferSeconds = 300) {
  const tokens = session.oauthTokens || session;
  
  if (!tokens.issuedAt || !tokens.expiresIn) {
    // No expiry info, can't determine
    return false;
  }

  const issuedAt = tokens.issuedAt;
  const expiresIn = tokens.expiresIn;
  const expiresAt = issuedAt + (expiresIn * 1000);
  const now = Date.now();
  const timeUntilExpiry = expiresAt - now;
  const bufferMs = bufferSeconds * 1000;

  return timeUntilExpiry <= bufferMs && timeUntilExpiry > 0;
}

/**
 * Middleware to automatically refresh tokens if needed
 */
async function autoRefreshMiddleware(req, res, next) {
  // Skip if no session or not authenticated
  if (!req.session || !req.session.oauthTokens) {
    return next();
  }

  try {
    // Check if token needs refresh
    if (shouldRefreshToken(req.session)) {
      logger.info('Token expiring soon, auto-refreshing', {
        path: req.path,
        user: req.session.user?.id
      });

      const clientId = process.env.PINGONE_CLIENT_ID || process.env.ADMIN_CLIENT_ID;
      const clientSecret = process.env.PINGONE_CLIENT_SECRET || process.env.ADMIN_CLIENT_SECRET;

      await refreshSessionTokens(req.session, clientId, clientSecret);
      
      logger.info('Token auto-refresh successful');
    }

    next();
  } catch (error) {
    logger.error('Auto-refresh failed', { error: error.message });
    
    // If refresh token expired, clear session and require re-auth
    if (error.code === 'REFRESH_TOKEN_EXPIRED') {
      req.session.destroy(() => {
        res.status(401).json({ 
          error: 'Session expired',
          requiresReauth: true 
        });
      });
    } else {
      // Other errors - don't block request
      next();
    }
  }
}

/**
 * Calculate time until token expiry
 * @param {object} session - Express session object
 * @returns {number} Seconds until expiry, or null if unknown
 */
function getTimeUntilExpiry(session) {
  const tokens = session.oauthTokens || session;
  
  if (!tokens.issuedAt || !tokens.expiresIn) {
    return null;
  }

  const expiresAt = tokens.issuedAt + (tokens.expiresIn * 1000);
  const now = Date.now();
  const timeUntilExpiry = Math.max(0, expiresAt - now);
  
  return Math.floor(timeUntilExpiry / 1000);
}

module.exports = {
  refreshAccessToken,
  refreshSessionTokens,
  shouldRefreshToken,
  autoRefreshMiddleware,
  getTimeUntilExpiry
};
