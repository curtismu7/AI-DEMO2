/**
 * Compliance Agent Routes
 * HTTP endpoints for compliance checking via Pydantic AI agent
 */

const express = require('express');
const router = express.Router();
const { initializeComplianceSession, processComplianceMessage } = require('../services/complianceAgentService');
const agentSessionMiddleware = require('../middleware/agentSessionMiddleware');
const requestEventEmitterMiddleware = require('../middleware/requestEventEmitterMiddleware');

/**
 * POST /init
 * Initialize compliance checking session
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

    const session = await initializeComplianceSession(userId);

    res.json({
      success: true,
      session,
      agentType: 'compliance-checker',
      framework: 'pydantic-ai'
    });
  } catch (error) {
    console.error('Compliance init error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /message
 * Send message to compliance checker
 */
router.post('/message', agentSessionMiddleware, requestEventEmitterMiddleware, async (req, res) => {
  try {
    const { message, transaction, userId, tokenEvents = [] } = req.body;

    if (!transaction || !userId) {
      return res.status(400).json({
        success: false,
        error: 'transaction and userId are required'
      });
    }

    const result = await processComplianceMessage(
      message,
      transaction,
      userId,
      tokenEvents
    );

    res.json(result);
  } catch (error) {
    console.error('Compliance message error:', error);
    res.status(500).json({
      success: false,
      reply: `Error processing compliance check: ${error.message}`,
      toolsCalled: [],
      tokenEvents: [],
      agentConfigured: true
    });
  }
});

module.exports = router;
