'use strict';

const express = require('express');
const crypto = require('crypto');
const { agentSessionMiddleware } = require('../middleware/agentSessionMiddleware');
const { requestEventEmitterMiddleware } = require('../services/requestEventEmitter');
const { orchestrateDelegation } = require('../services/a2aOrchestratorService');
const appEventService = require('../services/appEventService');
const { prependRefreshEvent } = require('../services/agentMcpTokenService');

const router = express.Router();
router.use(agentSessionMiddleware);
router.use(requestEventEmitterMiddleware);

// POST /init — Initialize A2A orchestrator session
router.post('/init', async (req, res) => {
  try {
    const { userId, accessToken } = req.agentContext || {};
    if (!userId || !accessToken) {
      return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
    }

    const allTokenEvents = prependRefreshEvent(req, req.tokenEvents || []);

    return res.json({
      sessionId: req.session.id,
      initialized: true,
      agentReady: true,
      agentConfigured: true,
      agentType: 'a2a-orchestrator',
      availableTools: [{ name: 'orchestrate_delegation', description: 'Analyze and decide on task delegation' }],
      tokenEvents: allTokenEvents,
    });
  } catch (error) {
    console.error('[a2a-agent/init] Unexpected error:', error.message);
    return res.status(500).json({
      error: error.code || 'agent_init_error',
      message: error.message,
      initialized: false,
      agentConfigured: false,
      agentReady: false,
    });
  }
});

// POST /message — Process A2A orchestration request
router.post('/message', async (req, res) => {
  try {
    appEventService.logEvent('agent', 'info', 'A2A orchestrator request received', { tag: 'agent/a2a_route' });

    const { message, vertical } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message must be a non-empty string' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Message too long (max 4000 characters)' });
    }

    const { userId, accessToken, tokenEvents } = req.agentContext || {};
    if (!userId || !accessToken) {
      return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
    }

    const activeVertical = vertical || req.session?.verticalId || 'banking';
    const runId = crypto.randomUUID();
    void runId; // available for future correlation

    // Orchestrate the delegation decision AND execute delegation
    // orchestrateDelegation now handles both the decision (via heuristics/CrewAI)
    // and the RFC 8693 token exchange if approved.
    const orchestrationResult = await orchestrateDelegation({
      req,
      message,
      vertical: activeVertical,
      userId,
      availableSpecialists: [], // Could be populated from config
    });

    // If delegation is not approved, return a clear response
    if (!orchestrationResult.shouldDelegate || !orchestrationResult.authorized) {
      const allTokenEvents = prependRefreshEvent(req, orchestrationResult.tokenEvents || []);
      return res.json({
        reply:
          orchestrationResult.reason ||
          'This request does not require delegation to a specialist.',
        success: false,
        toolsCalled: [],
        tokenEvents: allTokenEvents,
        requiresConsent: false,
        agentConfigured: true,
        delegationDecision: orchestrationResult,
      });
    }

    // Delegation was approved and executed
    if (orchestrationResult.error) {
      const allTokenEvents = prependRefreshEvent(req, orchestrationResult.tokenEvents || []);
      console.error('[a2a-agent/message] Delegation execution failed:', orchestrationResult.error);
      return res.status(502).json({
        reply: `Delegation approved but execution failed: ${orchestrationResult.error}`,
        success: false,
        toolsCalled: [],
        tokenEvents: allTokenEvents,
        requiresConsent: false,
        agentConfigured: true,
        error: 'delegation_execution_failed',
        delegationDecision: orchestrationResult,
      });
    }

    // Successful delegation with nested act chain
    const allTokenEvents = prependRefreshEvent(req, orchestrationResult.tokenEvents || []);
    const reply = `Delegation complete — ${orchestrationResult.specialist} received narrowed token with ${
      orchestrationResult.scopes?.join(' ') || 'specialist scopes'
    } (act-chain depth ${orchestrationResult.actChainDepth || 0}).`;

    return res.json({
      reply,
      success: true,
      toolsCalled: ['orchestrate_delegation', 'delegate_to_specialist'],
      tokenEvents: allTokenEvents,
      requiresConsent: false,
      agentConfigured: true,
      delegationDecision: orchestrationResult,
      delegationResult: {
        token: orchestrationResult.token,
        specialist: orchestrationResult.specialist,
        scopes: orchestrationResult.scopes,
        actChainDepth: orchestrationResult.actChainDepth,
        claims: orchestrationResult.claims,
      },
    });
  } catch (error) {
    console.error('[a2a-agent/message] Unexpected error:', error.message);
    return res.status(500).json({
      error: 'internal_error',
      message: error.message,
      reply: `A2A orchestrator error: ${error.message}`,
      success: false,
      toolsCalled: [],
      tokenEvents: [],
    });
  }
});

module.exports = router;
