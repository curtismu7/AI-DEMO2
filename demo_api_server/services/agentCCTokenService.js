/**
 * Agent Client Credentials Token Service
 * Obtains CC token for the agent (Digital Assistant) from PingOne
 * Per i4ai-ref-arch.mmd steps 3–4: Agent requests and receives CC token
 */

'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const oauthConfig = require('../config/oauth');
const { decodeJwt } = require('../utils/tokenUtils');

/**
 * Get client credentials token for the agent from PingOne
 * RFC 6749 §4.4 client_credentials grant
 *
 * @param {object} req - Express request (for token events, logging)
 * @param {object} options - Override defaults
 *   - clientId: agent OAuth client ID (default: PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID)
 *   - clientSecret: agent OAuth client secret
 *   - scope: scopes to request (default: ['mcp:invoke'])
 *   - authMethod: 'basic' or 'post' (default: 'basic')
 * @returns {Promise<{
 *   access_token: string,
 *   token_type: string,
 *   expires_in: number,
 *   scope: string,
 *   claims?: object
 * }>}
 */
async function getAgentCCToken(req, options = {}) {
  const {
    clientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id'),
    clientSecret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret'),
    scope = ['mcp:invoke'],
    authMethod = configStore.getEffective('pingone_mcp_token_exchanger_cc_auth_method') || 'post',
    // Active vertical for the agent session. Carried as a request parameter so
    // PingOne Authorize can scope tools/list per vertical (and baked as a claim
    // in the real-PingOne path). The BFF token cache keys on (vertical, scopeSet).
    vertical
  } = options;

  if (!clientId || !clientSecret) {
    const err = new Error('Agent not configured: missing PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID or secret');
    err.code = 'agent_not_configured';
    err.httpStatus = 503;
    throw err;
  }

  if (!oauthConfig.tokenEndpoint) {
    const err = new Error('OAuth token endpoint not configured');
    err.code = 'oauth_endpoint_not_configured';
    err.httpStatus = 503;
    throw err;
  }

  try {
    // Build token request
    const scopes = Array.isArray(scope) ? scope.join(' ') : scope;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: scopes,
      client_id: clientId,
    });
    // Carry the active vertical so PingOne Authorize can scope tools/list per
    // vertical. Harmless to the real PingOne CC grant (ignored if unrecognized);
    // the mock authz + gateway read it via the Vertical decision parameter.
    if (vertical) body.set('vertical', vertical);

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

    // Apply auth method
    if (authMethod === 'post') {
      body.set('client_secret', clientSecret);
    } else {
      // Default: CLIENT_SECRET_BASIC (Authorization: Basic header)
      const credentials = `${clientId}:${clientSecret}`;
      headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    // Request token from PingOne
    const tokenResponse = await axios.post(oauthConfig.tokenEndpoint, body.toString(), {
      headers,
      timeout: 10000,
      validateStatus: () => true,
    });

    const tokenData = tokenResponse.data;

    // Observability for the write-toggle: a client_credentials grant returns the
    // CLIENT's configured scopes — real PingOne may ignore the requested `scope`
    // subset, so the minted token can carry scopes (e.g. `write`) we did NOT ask
    // for. When that happens the Authorize tools/list decision sees those extra
    // scopes and the write-toggle won't visibly gate chips. Warn so an operator
    // can tell "demo works on the mock but not against this PingOne tenant" apart
    // from a real bug. (The mock honors the requested subset, so this stays quiet.)
    if (tokenData.scope) {
      const requested = new Set(scopes.split(/\s+/).filter(Boolean));
      const extra = tokenData.scope.split(/\s+/).filter((s) => s && !requested.has(s));
      if (extra.length) {
        console.warn(
          `[agentCCTokenService] IdP granted scopes beyond the requested set: [${extra.join(', ')}] ` +
          `(requested: [${scopes}]). The agent scope toggle may not visibly gate tools/list against this IdP — ` +
          'configure the CC client to honor requested-scope downscoping for the demo to show denial.'
        );
      }
    }

    // Decode token to extract claims (no verification — for display only)
    let claims;
    try {
      const decoded = decodeJwt(tokenData.access_token);
      claims = decoded?.claims || {};
    } catch (decodeErr) {
      console.warn('[agentCCTokenService] Could not decode token claims:', decodeErr.message);
      claims = {};
    }

    // Log token event if request has tracking
    if (req?.recordTokenEvent) {
      req.recordTokenEvent('agent_cc_token_obtained', {
        sub: claims.sub || clientId,
        aud: claims.aud || scopes,
        scope: tokenData.scope || scopes,
        expiresIn: tokenData.expires_in,
        tokenType: tokenData.token_type,
      });
    }

    return {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type || 'Bearer',
      expires_in: tokenData.expires_in || 3600,
      scope: tokenData.scope || scopes,
      vertical: vertical || undefined, // echoed for the (vertical, scopeSet) token cache key
      claims, // For UI Token Chain panel (decoded, sanitized)
      // WHICH OAuth client actually got this token. A client_credentials token
      // from PingOne frequently carries no `sub`, so a caller that wants to
      // display the acting identity has nothing to show and is tempted to
      // substitute a friendly name — which then displays an identity the token
      // does not contain. Returning the clientId gives callers something true
      // to fall back to.
      clientId,
    };
  } catch (error) {
    const errorMessage = error.response?.data?.error_description || error.message;
    const statusCode = error.response?.status || 502;

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('agent_cc_token_failed', {
        error: error.code || 'token_request_failed',
        message: errorMessage,
      });
    }

    const err = new Error(`Failed to obtain agent CC token: ${errorMessage}`);
    err.code = error.response?.data?.error || 'cc_token_request_failed';
    err.originalError = error.message;
    err.httpStatus = statusCode;
    throw err;
  }
}

module.exports = {
  getAgentCCToken,
};
