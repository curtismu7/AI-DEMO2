// banking_api_server/routes/tokens.js
/**
 * Token Chain API endpoints
 * Provides real-time token status and content for the token chain display
 */

const express = require('express');
const router = express.Router();
const configStore = require('../services/configStore');
const oauthService = require('../services/oauthService');
const { getSessionAccessToken } = require('../services/mcpWebSocketClient');
const agentMcpTokenService = require('../services/agentMcpTokenService');
const axios = require('axios');
const oauthUserConfig = require('../config/oauthUser');

/**
 * Parse token content for display
 * @param {string} token - JWT token or other token string
 * @returns {Promise<Object>} Parsed token content
 */
async function parseTokenContent(token) {
  if (!token) return null;

  try {
    // Try to parse as JWT
    if (typeof token === 'string' && token.split('.').length === 3) {
      const parts = token.split('.');
      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

      return {
        type: 'JWT',
        header: {
          alg: header.alg,
          typ: header.typ,
          kid: header.kid
        },
        payload: {
          iss: payload.iss,
          sub: payload.sub,
          aud: payload.aud,
          exp: payload.exp,
          iat: payload.iat,
          jti: payload.jti,
          scope: payload.scope,
          client_id: payload.client_id,
          // Include act/may_act claims if present
          act: payload.act,
          may_act: payload.may_act,
          // Include other relevant claims
          email: payload.email,
          name: payload.name,
          roles: payload.roles,
          permissions: payload.permissions
        },
        expires_at: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        issued_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : null
      };
    }
  } catch (error) {
    // Not a valid JWT or parsing failed
    console.warn('Failed to parse token as JWT:', error.message);
  }

  // If not a JWT, return basic info
  return {
    type: 'Opaque',
    token_preview: token.substring(0, 20) + '...',
    length: token.length
  };
}

/**
 * Build the same object as GET /api/tokens/chain (shared with GET /api/tokens/:tokenId).
 */
async function buildTokenChain(req) {
  const tokenChain = {};

  const sessionToken = getSessionAccessToken(req);
  if (sessionToken) {
    tokenChain['banking-app-token'] = {
      status: 'active',
      content: await parseTokenContent(sessionToken),
      error: null
    };
  } else {
    tokenChain['banking-app-token'] = {
      status: 'waiting',
      content: null,
      error: 'No session token found'
    };
  }

  try {
    if (process.env.AGENT_OAUTH_CLIENT_ID) {
      const agentToken = await oauthService.getAgentClientCredentialsToken();
      tokenChain['agent-token'] = {
        status: 'active',
        content: await parseTokenContent(agentToken),
        error: null
      };
    } else {
      tokenChain['agent-token'] = {
        status: 'waiting',
        content: null,
        error: 'Agent OAuth not configured'
      };
    }
  } catch (error) {
    tokenChain['agent-token'] = {
      status: 'error',
      content: null,
      error: error.message
    };
  }

  try {
    const mcpResourceUri = configStore.getEffective('mcp_resource_uri');
    if (mcpResourceUri && sessionToken) {
      // Derive scopes from the user's actual token — PingOne can only narrow, not grant
      // scopes not present in the subject token. Avoids "At least one scope must be granted"
      // when ENDUSER_AUDIENCE is configured and the login only carries agent:invoke.
      const userPayload = (() => {
        try {
          const parts = sessionToken.split('.');
          return parts.length === 3 ? JSON.parse(Buffer.from(parts[1], 'base64url').toString()) : {};
        } catch (_) { return {}; }
      })();
      const userScopeStr = typeof userPayload.scope === 'string' ? userPayload.scope : '';
      const bankingScopes = ['read', 'write', 'accounts:read',
        'transactions:read', 'mortgage:read', 'agent:invoke'];
      const exchangeScopes = bankingScopes.filter((s) => userScopeStr.split(' ').includes(s));
      // Fall back to read if the user token carries none of the above
      // (e.g. OIDC-only token) so there is always at least one scope to attempt.
      const scopesForExchange = exchangeScopes.length > 0 ? exchangeScopes : ['read'];
      const exchangedToken = await oauthService.performTokenExchange(
        sessionToken,
        mcpResourceUri,
        scopesForExchange
      );
      tokenChain['exchanged-token-mcp'] = {
        status: 'active',
        content: await parseTokenContent(exchangedToken),
        error: null
      };
    } else {
      tokenChain['exchanged-token-mcp'] = {
        status: 'waiting',
        content: null,
        error: mcpResourceUri ? 'No session token available' : 'MCP resource URI not configured'
      };
    }
  } catch (error) {
    tokenChain['exchanged-token-mcp'] = {
      status: 'error',
      content: null,
      error: error.message
    };
  }

  try {
    const mcpServerToken = await agentMcpTokenService.resolveMcpAccessToken(req, 'get_account_balance');
    if (mcpServerToken) {
      tokenChain['mcp-server-token'] = {
        status: 'active',
        content: await parseTokenContent(mcpServerToken),
        error: null
      };
    } else {
      tokenChain['mcp-server-token'] = {
        status: 'waiting',
        content: null,
        error: 'Unable to resolve MCP server token'
      };
    }
  } catch (error) {
    tokenChain['mcp-server-token'] = {
      status: 'error',
      content: null,
      error: error.message
    };
  }

  try {
    const mcpResourceUri = configStore.getEffective('mcp_resource_uri');
    if (mcpResourceUri && sessionToken) {
      const finalToken = await agentMcpTokenService.resolveMcpAccessToken(req, 'create_transfer');
      if (finalToken) {
        tokenChain['mcp-exchanged-token'] = {
          status: 'active',
          content: await parseTokenContent(finalToken),
          error: null
        };
      } else {
        tokenChain['mcp-exchanged-token'] = {
          status: 'waiting',
          content: null,
          error: 'Final token exchange pending'
        };
      }
    } else {
      tokenChain['mcp-exchanged-token'] = {
        status: 'waiting',
        content: null,
        error: 'Waiting for resource access request'
      };
    }
  } catch (error) {
    tokenChain['mcp-exchanged-token'] = {
      status: 'error',
      content: null,
      error: error.message
    };
  }

  return tokenChain;
}

/**
 * Get the current token chain status and content
 * GET /api/tokens/chain
 */
router.get('/chain', async (req, res) => {
  try {
    const tokenChain = await buildTokenChain(req);
    res.json(tokenChain);
  } catch (error) {
    console.error('Token chain API error:', error);
    res.status(500).json({ error: 'Failed to fetch token chain data' });
  }
});

/**
 * Token Chain dashboard preview: User Token from session + waiting/skipped rows (no exchange call).
 * GET /api/tokens/session-preview
 */
router.get('/session-preview', async (req, res) => {
  try {
    const { tokenEvents } = await agentMcpTokenService.buildSessionPreviewTokenEvents(req);
    res.json({ tokenEvents });
  } catch (error) {
    console.error('Token session-preview error:', error);
    res.status(500).json({ error: 'Failed to load session token preview' });
  }
});

/**
 * Prefetch agent CC token and return as decoded tokenEvent.
 * GET /api/tokens/agent-cc-preview
 *
 * Silently fetches the MCP Token Exchanger's client-credentials token server-side.
 * Returns only decoded claims (header + payload), never the raw JWT.
 * If AGENT_OAUTH_CLIENT_ID is not configured, returns a "not configured" placeholder event.
 * Cached for 10 minutes to avoid hammering PingOne on every page load.
 */
let _ccCache = { events: null, expiresAt: 0, clientId: null };
const CC_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
// Exported so server.js can register this under requireSession (not authenticateToken)
// since it fetches the agent's CC token server-side — it doesn't need the user's token.
async function agentCcPreviewHandler(req, res) {
  try {
    const clientId =
      configStore.getEffective('pingone_mcp_token_exchanger_client_id') ||
      process.env.AGENT_OAUTH_CLIENT_ID;

    // Return cached response if still valid and same clientId
    if (_ccCache.events && _ccCache.clientId === (clientId || null) && Date.now() < _ccCache.expiresAt) {
      return res.json({ tokenEvents: _ccCache.events });
    }

    // If not configured, return a helpful placeholder event
    if (!clientId) {
      const notConfigured = [
        agentMcpTokenService.buildTokenEvent(
          'agent-cc-not-configured',
          'Agent Actor Token (CC) — Not Configured',
          'skipped',
          null,
          'AGENT_OAUTH_CLIENT_ID is not set. Configure PingOne MCP Token Exchanger credentials ' +
          'in Admin → Config to enable dual-token exchange.',
          { rfc: 'RFC 8693 §2.1' }
        )
      ];
      _ccCache = { events: notConfigured, expiresAt: Date.now() + CC_CACHE_TTL_MS, clientId: null };
      return res.json({ tokenEvents: notConfigured });
    }

    // Fetch the CC token server-side
    try {
      const ccToken = await oauthService.getMcpExchangerToken();

      // Decode without storing raw token
      const decoded = agentMcpTokenService.decodeJwtClaims(ccToken);
      if (!decoded) {
        return res.json({
          tokenEvents: [
            agentMcpTokenService.buildTokenEvent(
              'agent-actor-token-prefetch',
              'Agent Actor Token (CC) — prefetch failed',
              'failed',
              null,
              'CC token was fetched but could not be decoded. Check token format.',
              { rfc: 'RFC 8693 §2.1' }
            )
          ]
        });
      }

      // Cache and return decoded token as event
      const events = [
        agentMcpTokenService.buildTokenEvent(
          'agent-actor-token-prefetch',
          'Agent Actor Token (CC) — prefetched',
          'active',
          decoded,
          `Client-credentials token for the AI Agent (${clientId.substring(0, 8)}...). ` +
          'This token is used as the actor_token in RFC 8693 Token Exchange when a banking tool is invoked via MCP. ' +
          'It carries the agent\'s identity — the resulting MCP access token will have act.client_id proving which agent performed the delegation.',
          { rfc: 'RFC 8693 §2.1' }
        )
      ];
      _ccCache = { events, expiresAt: Date.now() + CC_CACHE_TTL_MS, clientId };
      return res.json({ tokenEvents: events });
    } catch (fetchErr) {
      console.warn('[agent-cc-preview] CC token fetch failed:', fetchErr.message);
      return res.json({
        tokenEvents: [
          agentMcpTokenService.buildTokenEvent(
            'agent-actor-token-prefetch',
            'Agent Actor Token (CC) — fetch failed',
            'failed',
            null,
            `Could not fetch agent CC token: ${fetchErr.message}. Check AGENT_OAUTH_CLIENT_SECRET and PingOne app config.`,
            { rfc: 'RFC 8693 §2.1' }
          )
        ]
      });
    }
  } catch (error) {
    console.error('Token agent-cc-preview error:', error);
    res.status(500).json({ error: 'Failed to load agent CC token preview' });
  }
}
router.get('/agent-cc-preview', agentCcPreviewHandler);



 // IMPORTANT: /userinfo must be defined above /:tokenId wildcard
/**
 * Fetch enriched user info from PingOne userinfo endpoint.
 * Uses the session access token (BFF pattern — token never reaches frontend).
 * GET /api/tokens/userinfo
 */
router.get('/userinfo', async (req, res) => {
  try {
    const token = getSessionAccessToken(req);
    if (!token || token === '_cookie_session') {
      return res.status(401).json({
        source: 'PingOne userinfo',
        error: 'No valid session token',
        data: null
      });
    }

    const userInfoUrl = oauthUserConfig.userInfoEndpoint;
    const response = await axios.get(userInfoUrl, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000
    });

    res.json({
      source: 'PingOne userinfo',
      data: response.data,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      return res.status(401).json({
        source: 'PingOne userinfo',
        error: 'Token expired or invalid',
        data: null
      });
    }
    console.error('PingOne userinfo error:', err.message);
    res.status(err.response?.status || 502).json({
      source: 'PingOne userinfo',
      error: 'PingOne userinfo unavailable',
      data: null
    });
  }
});
/**
 * Get detailed information about a specific token in the chain (same keys as GET /chain).
 * GET /api/tokens/:tokenId
 */
router.get('/:tokenId', async (req, res) => {
  try {
    const { tokenId } = req.params;
    const chainData = await buildTokenChain(req);
    const tokenInfo = chainData[tokenId];
    if (!tokenInfo) {
      return res.status(404).json({
        error: 'Token not found',
        knownIds: Object.keys(chainData),
      });
    }
    res.json(tokenInfo);
  } catch (error) {
    console.error('Token detail API error:', error);
    res.status(500).json({ error: 'Failed to fetch token details' });
  }
});

/**
 * Validate a token
 * POST /api/tokens/validate
 */
router.post('/validate', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Use OAuth service to validate token
    try {
      const validation = await oauthService.validateToken(token);
      res.json({
        valid: true,
        validation: validation
      });
    } catch (error) {
      res.json({
        valid: false,
        error: error.message
      });
    }
  } catch (error) {
    console.error('Token validation API error:', error);
    res.status(500).json({ error: 'Failed to validate token' });
  }
});

/**
 * Perform RFC 8693 token exchange (interactive tester)
 * POST /api/tokens/exchange-test
 * Body: { audience, scopes (optional, array) }
 */
router.post('/exchange-test', async (req, res) => {
  try {
    const { audience, scopes } = req.body;
    const sessionToken = getSessionAccessToken(req);

    if (!sessionToken) {
      return res.status(401).json({ error: 'No session token available' });
    }

    if (!audience) {
      return res.status(400).json({ error: 'Audience is required' });
    }

    const exchangeScopes = scopes || ['read', 'write'];

    try {
      const exchangedToken = await oauthService.performTokenExchange(
        sessionToken,
        audience,
        exchangeScopes
      );

      const exchangedContent = await parseTokenContent(exchangedToken);

      res.json({
        success: true,
        original: {
          content: await parseTokenContent(sessionToken)
        },
        exchanged: {
          content: exchangedContent
        },
        request: {
          audience,
          scopes: exchangeScopes
        }
      });
    } catch (error) {
      // Always include the request details so the UI can show what was attempted,
      // even when the exchange itself fails (PingOne error, misconfigured grant, etc.)
      res.status(400).json({
        success: false,
        error: error.message,
        request: {
          audience,
          scopes: exchangeScopes,
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          client_id: oauthService.config?.clientId || '(not configured)',
          token_endpoint: oauthService.config?.tokenEndpoint || '(not configured)',
        },
        details: error.pingoneError ? {
          pingoneError: error.pingoneError,
          pingoneErrorDescription: error.pingoneErrorDescription,
          pingoneErrorDetail: error.pingoneErrorDetail,
          httpStatus: error.httpStatus,
        } : null,
        original: {
          content: await parseTokenContent(sessionToken).catch(() => null)
        },
      });
    }
  } catch (error) {
    console.error('Token exchange test API error:', error);
    res.status(500).json({ error: 'Failed to perform token exchange' });
  }
});

module.exports = router;
module.exports.agentCcPreviewHandler = agentCcPreviewHandler;
