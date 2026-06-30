'use strict';

const express = require('express');
const { agentSessionMiddleware } = require('../middleware/agentSessionMiddleware');
const { requestEventEmitterMiddleware } = require('../services/requestEventEmitter');
const { buildOpsPrompt } = require('../services/opsAgentService');
const appEventService = require('../services/appEventService');

const router = express.Router();
router.use(agentSessionMiddleware);
router.use(requestEventEmitterMiddleware);

/**
 * POST /prompt — Build Ops Assistant system prompt for a customer.
 *
 * Request body:
 *   {
 *     vertical: string (e.g. 'banking', 'healthcare'),
 *     customer: { name, id, ... } (customer object),
 *     records: { ...customer data to ground the prompt }
 *   }
 *
 * Response:
 *   {
 *     prompt: string (system prompt) | null,
 *     success: boolean,
 *     error?: string (error code),
 *     message?: string (user-friendly message)
 *   }
 */
router.post('/prompt', async (req, res) => {
  try {
    const { userId } = req.agentContext || {};
    if (!userId) {
      return res.status(401).json({ error: 'Session expired', success: false });
    }

    const { vertical, customer, records } = req.body || {};

    if (!vertical) {
      return res.status(400).json({
        error: 'missing_vertical',
        message: 'vertical is required',
        success: false,
      });
    }

    const result = await buildOpsPrompt({ vertical, customer, records });

    if (!result.success) {
      return res.status(result.error === 'NO_CUSTOMER_LOADED' ? 400 : 500).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('[ops-agent/prompt] Error:', err.message);
    appEventService.logEvent('agent', 'error', 'Ops agent prompt failed', { tag: 'agent/ops_error', error: err.message });
    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to build prompt',
      success: false,
    });
  }
});

module.exports = router;
