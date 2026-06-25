'use strict';

const express = require('express');
const router = express.Router();
const { formatTokenForDisplay, getTokenSummary } = require('../services/tokenDisplayService');

/**
 * POST /api/token-display/decode
 * Decode a JWT token for display/education purposes
 */
router.post('/decode', async (req, res) => {
  try {
    const { token, includeFullToken = false, includeClaims = true } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'token_required',
        message: 'Token is required'
      });
    }
    
    const result = formatTokenForDisplay(token, { includeFullToken, includeClaims });
    
    res.json(result);
  } catch (err) {
    console.error('[tokenDisplay] Decode error:', err.message);
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: err.message
    });
  }
});

/**
 * POST /api/token-display/raw-decode
 * Decode a JWT token returning raw header and payload (no claim descriptions).
 * Used by TokenCard — callers that need human-readable claim descriptions use /decode.
 */
router.post('/raw-decode', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'token_required', message: 'Token is required' });
    }
    const { decodeToken, classifyTokenType } = require('../services/tokenDisplayService');
    const decoded = decodeToken(token);
    if (!decoded) {
      return res.status(400).json({ success: false, error: 'decode_failed', message: 'Unable to decode token' });
    }
    res.json({
      success: true,
      header: decoded.header,
      payload: decoded.payload,
      tokenType: classifyTokenType(decoded.payload),
    });
  } catch (err) {
    console.error('[tokenDisplay] Raw decode error:', err.message);
    res.status(500).json({ success: false, error: 'internal_error', message: err.message });
  }
});

/**
 * POST /api/token-display/summary
 * Get summary information about a token (without full claims)
 */
router.post('/summary', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'token_required',
        message: 'Token is required'
      });
    }
    
    const summary = getTokenSummary(token);
    
    res.json({
      success: true,
      summary
    });
  } catch (err) {
    console.error('[tokenDisplay] Summary error:', err.message);
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: err.message
    });
  }
});

module.exports = router;
