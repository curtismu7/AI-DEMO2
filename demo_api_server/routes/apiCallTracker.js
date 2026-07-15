/**
 * apiCallTracker.js
 *
 * API routes for tracking and retrieving API call information for educational purposes.
 */

const express = require('express');
const {
  GLOBAL_SESSION_ID,
  trackApiCall,
  getApiCalls,
  clearApiCalls,
  getApiCallStats,
  trackToken,
  getSessionTokens,
  clearSessionTokens,
} = require('../services/apiCallTrackerService');

const router = express.Router();

/**
 * Resolve which call bucket to read/clear.
 * Default is the shared global buffer so /monitoring/api-explorer shows
 * all recent traffic (including Bearer/agent calls without a browser cookie).
 * Pass ?sessionId=... to scope to a specific PingOne-test / debug session.
 */
function resolveCallSessionId(req) {
  if (req.query.sessionId) return req.query.sessionId;
  if (req.query.scope === 'session' && req.session?.id) return req.session.id;
  return GLOBAL_SESSION_ID;
}

/**
 * GET /api/api-calls
 * Retrieve tracked API calls (global buffer by default)
 */
router.get('/', (req, res) => {
  try {
    const sessionId = resolveCallSessionId(req);
    const limit = parseInt(req.query.limit, 10) || 50;

    const calls = getApiCalls(sessionId, limit);
    const stats = getApiCallStats(sessionId);

    res.json({
      success: true,
      sessionId,
      stats,
      calls
    });
  } catch (error) {
    console.error('[apiCallTracker] Error retrieving calls:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/api-calls
 * Clear tracked API calls (global buffer by default)
 */
router.delete('/', (req, res) => {
  try {
    const sessionId = resolveCallSessionId(req);
    clearApiCalls(sessionId);

    res.json({
      success: true,
      sessionId,
      message: 'API calls cleared'
    });
  } catch (error) {
    console.error('[apiCallTracker] Error clearing calls:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/api-calls
 * Track an API call (internal use)
 */
router.post('/', async (req, res) => {
  try {
    // Prefer explicit body.sessionId so diagnostics can target a bucket without
    // being overridden by an ephemeral express-session id.
    const sessionId = req.body?.sessionId || req.session?.id || 'default';
    const call = await trackApiCall({
      ...req.body,
      sessionId
    });

    res.json({
      success: true,
      call
    });
  } catch (error) {
    console.error('[apiCallTracker] Error tracking call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/api-calls/tokens
 * Retrieve tracked tokens for a session
 */
router.get('/tokens', (req, res) => {
  try {
    const sessionId = req.query.sessionId || req.session?.id || 'default';
    const tokens = getSessionTokens(sessionId);

    res.json({
      success: true,
      sessionId,
      tokens
    });
  } catch (error) {
    console.error('[apiCallTracker] Error retrieving tokens:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/api-calls/tokens
 * Clear tracked tokens for a session
 */
router.delete('/tokens', (req, res) => {
  try {
    const sessionId = req.query.sessionId || req.session?.id || 'default';
    clearSessionTokens(sessionId);

    res.json({
      success: true,
      sessionId,
      message: 'Tokens cleared'
    });
  } catch (error) {
    console.error('[apiCallTracker] Error clearing tokens:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
