'use strict';

const express = require('express');
const crypto = require('crypto');
const { agentSessionMiddleware } = require('../middleware/agentSessionMiddleware');
const { requestEventEmitterMiddleware } = require('../services/requestEventEmitter');
const { orchestrateDelegation } = require('../services/a2aOrchestratorService');
const { delegateToSpecialist } = require('../services/a2aDelegationService');
const appEventService = require('../services/appEventService');
const { prependRefreshEvent } = require('../services/agentMcpTokenService');
const { specialistForVertical } = require('../config/a2aSpecialists');

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

    // Orchestrate the delegation decision using CrewAI (or heuristics fallback)
    const orchestrationDecision = await orchestrateDelegation({
      message,
      vertical: activeVertical,
      userId,
      availableSpecialists: [], // Could be populated from config
    });

    // If delegation is not approved, return a clear response
    if (!orchestrationDecision.shouldDelegate || !orchestrationDecision.authorized) {
      return res.json({
        reply:
          orchestrationDecision.reason ||
          'This request does not require delegation to a specialist.',
        success: false,
        toolsCalled: [],
        tokenEvents: tokenEvents || [],
        requiresConsent: false,
        agentConfigured: true,
        delegationDecision: orchestrationDecision,
      });
    }

    // Execute the actual delegation via a2aDelegationService
    let delegationResult;
    try {
      delegationResult = await delegateToSpecialist(req, {
        vertical: activeVertical,
        specialist: orchestrationDecision.specialist,
        scopes: orchestrationDecision.scopes,
        subtask: message,
      });
    } catch (delegationErr) {
      console.error('[a2a-agent/message] Delegation execution failed:', delegationErr.message);
      return res.status(502).json({
        reply: `Delegation approved but execution failed: ${delegationErr.message}`,
        success: false,
        toolsCalled: [],
        tokenEvents: tokenEvents || [],
        requiresConsent: false,
        agentConfigured: true,
        error: 'delegation_execution_failed',
        delegationDecision: orchestrationDecision,
      });
    }

    // Format the delegation result for the response
    let parsedResult;
    try {
      parsedResult = typeof delegationResult === 'string' ? JSON.parse(delegationResult) : delegationResult;
    } catch (_) {
      parsedResult = { delegated: false, error: delegationResult };
    }

    const reply = parsedResult.delegated
      ? `Delegation complete — ${parsedResult.specialist} retrieved ${
          parsedResult.tool ? parsedResult.tool.replace(/_/g, ' ') : 'the requested data'
        } on your behalf (act-chain depth ${parsedResult.actChainDepth}).`
      : `❌ ${parsedResult.error || 'Delegation failed'}`;

    return res.json({
      reply,
      success: parsedResult.delegated === true,
      toolsCalled: ['orchestrate_delegation', 'delegate_to_specialist'],
      tokenEvents: tokenEvents || [],
      requiresConsent: false,
      agentConfigured: true,
      delegationDecision: orchestrationDecision,
      delegationResult: parsedResult,
    });
  } catch (error) {
    console.error('[a2a-agent/message] Unexpected error:', error.message);
    return res.status(500).json({
      error: 'internal_error',
      message: error.message,
      success: false,
      toolsCalled: [],
      tokenEvents: [],
    });
  }
});

module.exports = router;
