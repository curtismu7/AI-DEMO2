/**
 * Support Agent Routes
 * HTTP endpoints for customer support via Mastra framework
 */

const express = require('express');
const router = express.Router();
const { processSupportMessage } = require('../services/supportAgentService');
const agentSessionMiddleware = require('../middleware/agentSessionMiddleware');
const requestEventEmitterMiddleware = require('../middleware/requestEventEmitterMiddleware');

/**
 * POST /init
 * Initialize support agent session
 */
router.post('/init', agentSessionMiddleware, requestEventEmitterMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    res.json({
      success: true,
      session: {
        session_id: `support-${userId}`,
        user_id: userId,
        agent_type: 'support-agent',
        framework: 'mastra'
      },
      agentType: 'support-agent',
      framework: 'mastra'
    });
  } catch (error) {
    console.error('Support agent init error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /message
 * Send message to support agent
 */
router.post('/message', agentSessionMiddleware, requestEventEmitterMiddleware, async (req, res) => {
  try {
    const { message, sessionId, userId, tokenEvents = [] } = req.body;

    if (!message || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'message and sessionId are required'
      });
    }

    const result = await processSupportMessage(message, sessionId, tokenEvents);

    res.json(result);
  } catch (error) {
    console.error('Support agent message error:', error);
    res.status(500).json({
      success: false,
      reply: `Error processing your message: ${error.message}`,
      toolsCalled: [],
      tokenEvents: [],
      agentConfigured: true,
      framework: 'mastra'
    });
  }
});

module.exports = router;
