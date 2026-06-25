'use strict';

/**
 * resolveAvailableTools — shared by /agent/init and POST /agent/tools.
 *
 * 1. Resolve the scope set for (vertical, allowWrite) via the write-toggle resolver.
 * 2. Reuse the session-cached delegated token for (vertical, scopeSet), or mint one
 *    via the RFC 8693 exchange and cache it. Switching vertical or flipping the
 *    toggle is a deliberate cache miss (re-exchange + re-list) — the visible
 *    Authorize moment.
 * 3. Discover tools through the WS gateway path (Authorize-filtered) and return
 *    the merged permitted + scope-denied list for the UI.
 *
 * Token model: discovery uses the DELEGATED token (RFC 8693: sub=user, act=agent,
 * aud=gateway) — the same token tool-calls use — NOT the agent client-credentials
 * token. The gateway's token pipeline requires a `sub`, which CC tokens lack
 * (they carry only client_id). The write toggle drives the exchange's requested
 * scopes (scopeOverride), narrowed to the user token's scopes by the exchange.
 *
 * Token custody stays server-side; the cache is cleared on logout with the session.
 */

const { resolveAgentScopes } = require('./agentScopes');
const agentTokenCache = require('./agentTokenCache');
const agentMcpTokenService = require('./agentMcpTokenService');
const agentGatewayClient = require('./agentGatewayClient');

// Pseudo-tool name for the discovery exchange — not a real MCP tool; the scope
// set comes from scopeOverride, so MCP_TOOL_SCOPES is not consulted for it.
const DISCOVERY_TOOL = '__tools_discovery__';

// Conservative cache TTL for the delegated discovery token (seconds). Short so a
// stale delegated token isn't reused for long; a (vertical, scopeSet) switch
// re-exchanges anyway.
const DISCOVERY_TOKEN_TTL_S = 600;

/**
 * @param {object} req - Express request (must have agentContext + session)
 * @param {{ vertical: string, allowWrite: boolean }} params
 * @returns {Promise<{ availableTools: object[], tokenEvents: object[], scopes: string[] }>}
 */
async function resolveAvailableTools(req, { vertical, allowWrite }) {
  const scopes = resolveAgentScopes(vertical, allowWrite);

  let tok = agentTokenCache.get(req.session, vertical, scopes);
  if (!tok) {
    // RFC 8693 exchange → delegated token (sub=user, act=agent, aud=gateway) with
    // the write-toggle scopes. The gateway accepts this (it has a sub); the agent
    // CC token does not.
    const resolved = await agentMcpTokenService.resolveMcpAccessTokenWithEvents(
      req,
      DISCOVERY_TOOL,
      { scopeOverride: scopes },
    );
    if (!resolved || !resolved.token) {
      const needAuth = !!(resolved && resolved.need_auth);
      const err = new Error(needAuth ? 'Session expired' : 'Could not resolve delegated token for tool discovery');
      err.code = needAuth ? 'need_auth' : 'discovery_token_failed';
      err.httpStatus = needAuth ? 401 : 502;
      throw err;
    }
    tok = { access_token: resolved.token, expires_in: DISCOVERY_TOKEN_TTL_S };
    agentTokenCache.set(req.session, vertical, scopes, tok);
  }

  const userSub = (req.agentContext && req.agentContext.userId) || null;

  // Discovery can blip (WS to the Node gateway, or the gateway → authz hop),
  // most often right after a cold start while the gateway/authz sidecar is still
  // warming up or the token exchange races. Retry with backoff before giving up;
  // if it still fails for a non-auth reason, degrade to the local catalog (all
  // permitted) so chips stay usable rather than greying out.
  const listOnce = () =>
    agentGatewayClient.listAvailableTools(req, tok.access_token, { vertical, userSub });

  // Backoffs between attempts (ms). N entries → N+1 total attempts.
  const DISCOVERY_RETRY_BACKOFFS_MS = [400, 900];

  let result;
  let lastErr;
  for (let attempt = 0; attempt <= DISCOVERY_RETRY_BACKOFFS_MS.length; attempt += 1) {
    try {
      result = await listOnce();
      lastErr = null;
      break;
    } catch (err) {
      if (err && err.code === 'need_auth') throw err;
      lastErr = err;
      const backoff = DISCOVERY_RETRY_BACKOFFS_MS[attempt];
      if (backoff != null) await new Promise((r) => setTimeout(r, backoff));
    }
  }
  if (lastErr) {
    const catalog = (agentGatewayClient.getLocalToolsCatalog() || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema || {},
      requiredScopes: t.requiredScopes || ['read'],
      readOnly: t.readOnly ?? true,
      // Discovery is down, so the Authorize-filtered scope decision is unavailable.
      // Permit only read-only tools (keep chips usable); never grant write-capable
      // tools (e.g. transfer_funds) by default — that would bypass authorization.
      permitted: t.readOnly ?? true,
    }));
    return {
      availableTools: catalog,
      tokenEvents: (req.tokenEvents || []).slice(),
      scopes,
      degraded: true,
      degradedReason: 'discovery_unreachable',
    };
  }

  const degradedByFailover = result.authzEngine === 'mock-failover';
  return {
    availableTools: result.tools || [],
    tokenEvents: (req.tokenEvents || []).slice(),
    scopes,
    ...(degradedByFailover ? { degraded: true, degradedReason: 'authz_failover' } : {}),
  };
}

module.exports = { resolveAvailableTools };
