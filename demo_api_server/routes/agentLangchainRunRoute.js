'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { requireSession } = require('../middleware/auth');
const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');
const { buildTokenChainEvents, proxyAgentSse } = require('../services/aguiSseProxy');
const { verticalManifest } = require('../services/verticalManifest');

const router = express.Router();

/**
 * POST /api/agent/langchain/run
 *
 * Starts a LangChain AG-UI agent run. Authenticates via session cookie,
 * performs RFC 8693 token exchange, injects CUSTOM token-chain events
 * into the SSE stream, then proxies the LangChain agent's SSE response to the browser.
 */
router.post('/run', requireSession, async (req, res) => {
  const { message, session_id: sessionId } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const sid = sessionId || req.session?.id || `sess_${randomUUID().slice(0, 8)}`;

  // Set SSE headers before any writes
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let tokenChainEvents = [];
  let authToken = '';

  try {
    const result = await resolveMcpAccessTokenWithEvents(req, 'agui_run');
    authToken = result.token || '';
    tokenChainEvents = buildTokenChainEvents(result.tokenEvents || []);
  } catch (err) {
    const tokenError = { type: 'CUSTOM', name: 'token_chain_error', value: { code: 'EXCHANGE_FAILED', message: err.message } };
    const errorEvent = { type: 'ERROR', message: 'Unable to obtain agent token' };
    const finishedEvent = { type: 'RUN_FINISHED', runId, threadId: sid };
    res.write(`data: ${JSON.stringify(tokenError)}\n\n`);
    res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
    res.write(`data: ${JSON.stringify(finishedEvent)}\n\n`);
    return res.end();
  }

  proxyAgentSse({ browserRes: res, runId, sessionId: sid, message, authToken, tokenChainEvents, vertical: verticalManifest.resolver.activeIdFor(req) });
});

module.exports = router;
