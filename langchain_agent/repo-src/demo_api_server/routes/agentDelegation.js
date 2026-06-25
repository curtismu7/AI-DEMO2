// banking_api_server/routes/agentDelegation.js
/**
 * Option D: Agent-facing delegation endpoint.
 * External agent platforms (N8N, AWS Bedrock, Glean) pre-fetch a delegated token
 * by sending a user Bearer token. The BFF performs RFC 8693 token exchange and
 * returns a token with `act` claim they can use as standard Bearer to MCP.
 *
 * POST /api/agent/delegate
 *   Authorization: Bearer <user_access_token>
 *   X-Agent-Client-ID: <optional platform identifier>
 *   Body (JSON, optional): { scope: "read write" }
 *
 * Returns: { access_token, token_type, expires_in, scope, act }
 */
'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const oauthService = require('../services/oauthService');
const configStore = require('../services/configStore');

/**
 * Decode JWT payload without signature verification.
 * BFF trusts PingOne — the exchange call will reject invalid tokens.
 */
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return null;
  }
}

/**
 * Rate limiter keyed by user `sub` claim (10 req/min per user).
 */
const delegationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req._delegationSub || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded', message: 'Too many delegation requests. Try again in 1 minute.' },
});

/**
 * POST /delegate
 */
router.post('/delegate', express.json(), async (req, res) => {
  // --- Extract Bearer token ---
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token', message: 'Authorization: Bearer <token> required.' });
  }
  const userToken = authHeader.slice(7);
  if (!userToken) {
    return res.status(401).json({ error: 'missing_token', message: 'Bearer token is empty.' });
  }

  // --- Decode to get sub for rate limiting & audit ---
  const claims = decodeJwtPayload(userToken);
  if (!claims || !claims.sub) {
    return res.status(401).json({ error: 'invalid_token', message: 'Token could not be decoded or has no sub claim.' });
  }
  req._delegationSub = claims.sub;

  // --- Rate limit (applied after sub extraction so key is correct) ---
  // We call the limiter manually so the key uses the decoded sub
  await new Promise((resolve) => delegationLimiter(req, res, resolve));
  if (res.headersSent) return; // limiter already sent 429

  // --- Resolve agent credentials ---
  const agentClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || process.env.AGENT_OAUTH_CLIENT_ID;
  const agentClientSecret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret') || process.env.AGENT_OAUTH_CLIENT_SECRET;
  if (!agentClientId || !agentClientSecret) {
    return res.status(503).json({
      error: 'agent_not_configured',
      message: 'Agent delegation is not configured. Set AGENT_OAUTH_CLIENT_ID and AGENT_OAUTH_CLIENT_SECRET.',
    });
  }

  // --- Resolve audience ---
  const audience = configStore.getEffective('pingone_resource_mcp_server_uri');
  if (!audience) {
    return res.status(503).json({
      error: 'mcp_resource_not_configured',
      message: 'MCP resource URI is not configured (pingone_resource_mcp_server_uri).',
    });
  }

  // --- Scope handling: intersect requested with token scopes ---
  const tokenScopes = claims.scope ? claims.scope.split(' ') : [];
  let requestedScope = req.body?.scope;
  let finalScopes;
  if (requestedScope) {
    const requested = typeof requestedScope === 'string' ? requestedScope.split(' ') : requestedScope;
    // Only grant scopes the user actually has
    finalScopes = requested.filter((s) => tokenScopes.includes(s));
    if (finalScopes.length === 0) {
      return res.status(400).json({
        error: 'invalid_scope',
        message: 'None of the requested scopes are present on the user token.',
      });
    }
  } else {
    finalScopes = tokenScopes;
  }

  // --- Get agent actor token (client credentials) ---
  let actorToken;
  const agentAuthMethod = configStore.getEffective('pingone_mcp_token_exchanger_auth_method') || 'basic';
  try {
    actorToken = await oauthService.getClientCredentialsTokenAs(
      agentClientId, agentClientSecret, audience, agentAuthMethod
    );
  } catch (err) {
    console.error('[AgentDelegation] Failed to obtain actor token:', err.message);
    return res.status(502).json({
      error: 'actor_token_failed',
      message: 'Could not obtain agent actor credentials.',
    });
  }

  // --- Perform RFC 8693 token exchange ---
  try {
    const exchangedToken = await oauthService.performTokenExchangeWithActor(
      userToken, actorToken, audience, finalScopes
    );

    // Decode the exchanged token to extract act claim and expiry for the response
    const exchangedClaims = decodeJwtPayload(exchangedToken) || {};

    // --- Audit log ---
    console.log(JSON.stringify({
      event: 'agent_delegation',
      sub: claims.sub,
      act_sub: agentClientId,
      scope: finalScopes.join(' '),
      agent_client_id: req.headers['x-agent-client-id'] || 'unknown',
      timestamp: new Date().toISOString(),
    }));

    return res.json({
      access_token: exchangedToken,
      token_type: 'Bearer',
      expires_in: exchangedClaims.exp ? exchangedClaims.exp - Math.floor(Date.now() / 1000) : null,
      scope: finalScopes.join(' '),
      act: exchangedClaims.act || { sub: agentClientId },
    });
  } catch (err) {
    // PingOne rejected the exchange (invalid/expired user token, scope mismatch, etc.)
    const status = err.httpStatus || 401;
    console.error('[AgentDelegation] Token exchange failed:', {
      sub: claims.sub,
      error: err.pingoneError || err.message,
      description: err.pingoneErrorDescription,
      agent_client_id: req.headers['x-agent-client-id'] || 'unknown',
    });
    return res.status(status >= 400 && status < 600 ? status : 401).json({
      error: err.pingoneError || 'token_exchange_failed',
      message: err.pingoneErrorDescription || err.message,
    });
  }
});

module.exports = router;
