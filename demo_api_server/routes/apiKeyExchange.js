'use strict';

/**
 * API Key Exchange Endpoint — /api/mcp/apikey/exchange
 *
 * Internal endpoint (called by PingGateway) to exchange an API key for a bearer token.
 * Used by the apikey-dispatch.groovy filter to obtain JWTs for introspection.
 *
 * POST /api/mcp/apikey/exchange
 *   X-API-Key: sk-key-001
 *   → 200 + { token, userId, expiresIn }
 *   → 403 + { code: 'invalid_apikey' }
 *   → 500 + { code: 'token_generation_failed' }
 */

const express = require('express');
const router = express.Router();
const apiKeyService = require('../services/apiKeyService');
const { logger } = require('../utils/logger');

/**
 * POST /api/mcp/apikey/exchange
 * Exchange X-API-Key header for a signed JWT bearer token.
 */
router.post('/exchange', (req, res) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    logger.warn('[apiKeyExchange] Missing X-API-Key header', { ip: req.ip });
    return res.status(400).json({
      code: 'missing_apikey',
      message: 'X-API-Key header is required',
    });
  }

  try {
    const result = apiKeyService.exchangeKeyForToken(apiKey);

    if (result.error) {
      logger.warn('[apiKeyExchange] Key exchange failed', {
        error: result.error,
        keyPrefix: apiKey.substring(0, 5),
      });
      return res.status(result.statusCode || 403).json({
        code: result.error,
        message: result.message,
      });
    }

    logger.info('[apiKeyExchange] Token generated', {
      userId: result.userId,
      keyPrefix: apiKey.substring(0, 5),
    });

    return res.status(200).json({
      token: result.token,
      userId: result.userId,
      expiresIn: 3600, // 1 hour
      tokenType: 'Bearer',
    });
  } catch (err) {
    logger.error('[apiKeyExchange] Unexpected error', { err: err.message });
    return res.status(500).json({
      code: 'internal_error',
      message: 'Failed to generate bearer token',
    });
  }
});

module.exports = router;
