// Open ingest for the DaVinci showcase flows' HTTP connector callbacks
// (fraud_alert during step-up, transaction_decision on flow completion).
// Unauthenticated by design, same accepted tradeoff as webhookPingOne.js —
// DaVinci's Generic HTTP connector offers no request signing either.
'use strict';
const express = require('express');
const davinciEventStore = require('../services/lmdb/davinciEventStore.lmdb');

const router = express.Router();

router.post('/davinci', (req, res) => {
  const { eventType } = req.body || {};
  if (!eventType || typeof eventType !== 'string') {
    return res.status(400).json({ error: 'invalid_event' });
  }
  const stored = davinciEventStore.append(req.body);
  return res.status(200).json({ received: true, eventId: stored.eventId });
});

module.exports = router;
