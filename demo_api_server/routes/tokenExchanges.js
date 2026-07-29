'use strict';

const express = require('express');
const router = express.Router();

// In-memory store for token exchanges (would be persistent in production)
const tokenExchangeLog = [];

/**
 * POST /api/token-exchanges/log
 * Logs a token exchange event
 */
router.post('/log', (req, res) => {
  const { timestamp, exchangeType, subjectToken, resultToken, metadata } = req.body;

  // Validate required fields
  if (!timestamp || !exchangeType) {
    return res.status(400).json({ error: 'Missing required fields: timestamp, exchangeType' });
  }

  const entry = {
    timestamp,
    exchangeType,
    subjectToken,
    resultToken,
    metadata,
    loggedAt: new Date().toISOString()
  };

  tokenExchangeLog.push(entry);

  res.status(200).json({ logged: true });
});

/**
 * GET /api/token-exchanges
 * Retrieves paginated token exchanges
 */
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 100);
  const offset = parseInt(req.query.offset, 10) || 0;

  const total = tokenExchangeLog.length;
  const exchanges = tokenExchangeLog.slice(offset, offset + limit);

  res.status(200).json({
    exchanges,
    total,
    limit,
    offset
  });
});

module.exports = router;
