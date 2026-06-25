/**
 * Intent Authorization Route
 * POST /api/authorize-intent — evaluate intent-based authorization
 */

const express = require('express');
const { evaluateIntentAuthorization } = require('../services/intentAuthService');
const { authenticateToken } = require('../middleware/auth');
const appEventService = require('../services/appEventService');

const router = express.Router();

/**
 * POST /api/authorize-intent
 * Evaluate whether an intent is authorized based on confidence and amount
 *
 * Request body:
 *   {
 *     intent: string,        // Intent type (e.g., "transfer", "delete_account")
 *     confidence: number,    // Confidence score (0–1)
 *     amount?: number,       // Transaction amount in USD (optional)
 *     toolName?: string      // MCP tool name (optional, for logging)
 *   }
 *
 * Response (200 OK):
 *   {
 *     authorized: boolean,        // Whether intent is authorized
 *     requires_consent: boolean,  // Whether HITL consent is needed
 *     reason: string              // Decision explanation
 *   }
 *
 * Response (428 Precondition Required) — when authorized but requires_consent=true:
 *   {
 *     authorized: true,
 *     requires_consent: true,
 *     reason: string
 *   }
 */
router.post('/authorize-intent', authenticateToken, express.json(), async (req, res) => {
  try {
    const { intent, confidence, amount, toolName } = req.body;

    // Validate inputs
    if (!intent || typeof intent !== 'string') {
      return res.status(400).json({ error: 'intent is required and must be a string' });
    }
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
      return res.status(400).json({ error: 'confidence must be a number between 0 and 1' });
    }

    console.log('[intentAuthRoute] Evaluating intent:', {
      intent,
      confidence: confidence.toFixed(2),
      amount,
      toolName,
      userId: req.user?.sub,
    });

    const decision = await evaluateIntentAuthorization({
      intent,
      confidence,
      amount,
      toolName,
    });

    console.log('[intentAuthRoute] Decision:', decision);
    appEventService.logEvent('intent_auth', 'info', {
      endpoint: '/authorize-intent',
      intent,
      confidence,
      amount,
      toolName,
      decision: decision.authorized ? (decision.requires_consent ? 'consent_required' : 'permit') : 'deny',
      reason: decision.reason,
      userId: req.user?.sub,
    });

    // If authorized but requires consent, return 428
    if (decision.authorized && decision.requires_consent) {
      return res.status(428).json(decision);
    }

    // If not authorized, return 403
    if (!decision.authorized) {
      return res.status(403).json(decision);
    }

    // If authorized and no consent required, return 200
    return res.status(200).json(decision);
  } catch (error) {
    console.error('[intentAuthRoute] Error:', error.message);
    res.status(500).json({ error: 'Intent authorization failed', message: error.message });
  }
});

module.exports = router;
