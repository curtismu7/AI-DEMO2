/**
 * Subject Token Service
 * Obtains scoped subject token from PingOne with delegation support
 * Per i4ai-ref-arch.mmd steps 19–23: User authorizes agent access
 */

'use strict';

const axios = require('axios');
const oauthConfig = require('../config/oauth');
const configStore = require('./configStore');
const { decodeJwt } = require('../utils/tokenUtils');

/**
 * Request scoped subject token from PingOne with delegation support
 * The token will have `may_act` claim allowing agent to act on behalf
 *
 * Per i4ai diagram step 20–21:
 *   WA->>PID: Token request (resource: agent1, scope: balance)
 *   PID-->>WA: Subject token (sub: user, aud: agent1, may_act: {sub: agent1}, scope: balance)
 *
 * @param {object} req - Express request (for token events, logging)
 * @param {string} userAccessToken - Current user's access token (from session)
 * @param {string} scope - Scope to request (e.g., 'read')
 * @param {object} options - Override defaults
 *   - resource: Agent resource/audience (default: agent1)
 *   - agentClientId: Agent to delegate to (default: PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID)
 * @returns {Promise<{
 *   access_token: string,
 *   token_type: string,
 *   expires_in: number,
 *   scope: string,
 *   may_act?: object,
 *   claims?: object
 * }>}
 */
async function requestSubjectToken(req, userAccessToken, scope, options = {}) {
  const {
    resource = 'agent1',
    agentClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id'),
  } = options;

  if (!userAccessToken) {
    const err = new Error('User access token required to request subject token');
    err.code = 'missing_user_token';
    err.httpStatus = 401;
    throw err;
  }

  if (!scope) {
    const err = new Error('Scope required for subject token request');
    err.code = 'missing_scope';
    err.httpStatus = 400;
    throw err;
  }

  if (!oauthConfig.tokenEndpoint) {
    const err = new Error('OAuth token endpoint not configured');
    err.code = 'oauth_endpoint_not_configured';
    err.httpStatus = 503;
    throw err;
  }

  try {
    // Build subject token request
    // This uses the authorization_code flow with an existing user token
    // to get a new scoped token with delegation support
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: userAccessToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      resource: resource,
      scope: scope,
    });

    // Add may_act claim to allow delegation
    if (agentClientId) {
      body.set('may_act', JSON.stringify({ sub: agentClientId }));
    }

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('subject_token_request_started', {
        resource,
        scope,
        agentClientId,
      });
    }

    console.log('[subjectTokenService] Requesting subject token with scope:', scope);

    // Request token from PingOne
    const tokenResponse = await axios.post(oauthConfig.tokenEndpoint, body.toString(), {
      headers,
      timeout: 10000,
    });

    const tokenData = tokenResponse.data;

    // Decode token to extract claims (for display in Token Chain)
    let claims;
    try {
      const decoded = decodeJwt(tokenData.access_token);
      claims = decoded?.claims || {};
    } catch (decodeErr) {
      console.warn('[subjectTokenService] Could not decode token claims:', decodeErr.message);
      claims = {};
    }

    // Log token event
    if (req?.recordTokenEvent) {
      req.recordTokenEvent('subject_token_obtained', {
        sub: claims.sub || 'user',
        aud: claims.aud || resource,
        scope: tokenData.scope || scope,
        may_act: claims.may_act || (agentClientId ? { sub: agentClientId } : undefined),
        expiresIn: tokenData.expires_in,
      });
    }

    console.log('[subjectTokenService] Subject token obtained for resource:', resource);

    return {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type || 'Bearer',
      expires_in: tokenData.expires_in || 3600,
      scope: tokenData.scope || scope,
      may_act: claims.may_act,
      claims, // For UI Token Chain panel
    };
  } catch (error) {
    const errorMessage = error.response?.data?.error_description || error.message;
    const statusCode = error.response?.status || 502;

    console.error('[subjectTokenService] Error requesting subject token:', errorMessage);

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('subject_token_failed', {
        error: error.response?.data?.error || 'token_request_failed',
        message: errorMessage,
      });
    }

    const err = new Error(`Failed to obtain subject token: ${errorMessage}`);
    err.code = error.response?.data?.error || 'subject_token_request_failed';
    err.originalError = error.message;
    err.httpStatus = statusCode;
    throw err;
  }
}

module.exports = {
  requestSubjectToken,
};
