const express = require('express');
const router = express.Router();
const { getTokenChain, getCurrentTokens, synthesizeFromSession, getMCPToolCalls } = require('../services/tokenChainService');
const { logEvent: logAppEvent } = require('../services/appEventService');
const { scrubRawJwts } = require('../services/jwtScrubber');
const validationModeConfig = require('../config/validationModeConfig');

// Last activity-feed snapshot per user — GET /api/token-chain is polled ~every
// 15s; emitting the same "fetched" line on every poll floods the Academy /
// agent activity feed and makes operators think each prompt ran dozens of tools.
const _lastFetchTotalsByUser = new Map();

// GET /api/token-chain — get token chain for authenticated user (including MCP delegation trail)
router.get('/', async (req, res) => {
  try {
    let tokenChain = await getTokenChain(req.user.id);
    // Fallback: synthesize from session token if Map is empty (e.g. after server restart)
    if (tokenChain.length === 0 && req.session && req.session.oauthTokens && req.session.oauthTokens.accessToken) {
      tokenChain = synthesizeFromSession(req.session.oauthTokens.accessToken);
    }
    
    // Fetch MCP tool call delegation trail (req threaded so the service can mint
    // an agent CC token to authenticate the MCP /audit fetch)
    const mcpToolCallsChain = await getMCPToolCalls(req.user.id, req);

    // Surface the cold-start synthetic state so the UI can label the chain as
    // "synthesized — not verified" rather than presenting it as a normal
    // validated auth step.
    const synthetic = tokenChain.length > 0 && tokenChain.every(e => e._synthetic === true);

    // Defense-in-depth: scrub any JWT-shaped string before it leaves the BFF.
    // No raw token flows through today (every event carries decoded claims
    // only), but this matches the documented /identity + /accounts +
    // /transactions contract — the scrub is free and earns its keep the moment
    // a future field carries a token.
    res.json(scrubRawJwts({
      tokenChain,
      mcpToolCallsChain,
      validationMode: validationModeConfig.getValidationMode(),
      metadata: {
        userId: req.user.id,
        totalEvents: tokenChain.length,
        totalMCPToolCalls: mcpToolCallsChain.length,
        // Explicit so UIs don't imply these counts are "this prompt only".
        totalsScope: 'session_accumulated',
        totalsHint: 'Cumulative for this user session (BFF audit + MCP /audit), not a single chat or Academy turn.',
        synthetic,
        enterpriseManagedMode: (() => {
          try {
            const enterpriseMcpPolicy = require('../services/enterpriseMcpPolicyService');
            return enterpriseMcpPolicy.isEnabled();
          } catch {
            return false;
          }
        })(),
        mcpAuthMode: (() => {
          try {
            const enterpriseMcpPolicy = require('../services/enterpriseMcpPolicyService');
            return enterpriseMcpPolicy.isEnabled() ? 'enterprise-managed' : 'consumer';
          } catch {
            return 'consumer';
          }
        })(),
        idJagStandIn: (() => {
          try {
            const enterpriseMcpPolicy = require('../services/enterpriseMcpPolicyService');
            return enterpriseMcpPolicy.isEnabled();
          } catch {
            return false;
          }
        })(),
        lastUpdated: new Date().toISOString()
      }
    }));
    const next = { events: tokenChain.length, mcp: mcpToolCallsChain.length };
    const prev = _lastFetchTotalsByUser.get(req.user.id);
    if (!prev || prev.events !== next.events || prev.mcp !== next.mcp) {
      _lastFetchTotalsByUser.set(req.user.id, next);
      logAppEvent(
        'token_exchange',
        'info',
        `Token chain session totals — ${next.events} token events, ${next.mcp} MCP tool calls (accumulated this session, not this prompt alone)`,
        {
          tag: 'token_chain/fetched',
          metadata: {
            userId: req.user.id,
            chainLength: next.events,
            mcpToolCalls: next.mcp,
            totalsScope: 'session_accumulated',
          },
        },
      );
    }
  } catch (err) {
    console.error('[tokenChain] GET error:', err.message);
    logAppEvent('token_exchange', 'error', `Token chain fetch failed: ${err.message}`,
      { tag: 'token_chain/error', metadata: { userId: req.user?.id, error: err.message } }
    );
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// GET /api/token-chain/current — get current active tokens
router.get('/current', async (req, res) => {
  try {
    const currentTokens = await getCurrentTokens(req.user.id);
    res.json(scrubRawJwts({ currentTokens }));
  } catch (err) {
    console.error('[tokenChain] GET current error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

module.exports = router;
